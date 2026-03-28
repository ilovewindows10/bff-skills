#!/usr/bin/env node
/**
 * bitflow-arb-scanner
 * Compares Bitflow DEX pool prices against external market prices (CoinGecko/CoinCap)
 * to detect pools trading at a significant premium or discount to fair value.
 * Outputs structured signals for agents to exploit price inefficiencies.
 *
 * Read-only. No wallet or signing required.
 * Author: ilovewindows10 (月出 / Yuechu)
 * Competition: AIBTC × Bitflow Skills Pay the Bills
 */

import { Command } from 'commander';

const TICKER_API = 'https://bitflow-sdk-api-gateway-7owjsmt8.uc.gateway.dev/ticker';
const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/price';
const FETCH_TIMEOUT_MS = 15_000;

const XYK_FEE = 0.003;
const STABLE_FEE = 0.0001;
const MIN_LIQUIDITY_USD = 5000;
const MIN_DEVIATION_PCT = 0.5; // min % deviation from market price to report

// Token ID mapping for CoinGecko
const TOKEN_COINGECKO_ID: Record<string, string> = {
  'STX': 'blockstack',
  'SBTC': 'bitcoin',    // sBTC is pegged 1:1 to BTC
  'AEUSDC': 'usd-coin',
  'USDCX': 'usd-coin',
  'USDH': 'usd-coin',   // USDH-TOKEN-V is a USD stablecoin
  'STSTX': 'blockstack', // stSTX tracks STX price (liquid staking)
};

interface TickerEntry {
  base_currency: string;
  target_currency: string;
  ticker_id: string;
  pool_id: string;
  liquidity_in_usd: number;
  base_volume: number;
  target_volume: number;
  last_price: number;
  high: number;
  low: number;
  last_trade_time?: number;
  ask?: number;
  bid?: number;
}

interface MarketPrice {
  token: string;
  price_usd: number;
  source: string;
}

interface DeviationSignal {
  pool_id: string;
  pair: string;
  pool_type: 'stableswap' | 'xyk' | 'unknown';
  bitflow_price: number;        // price of base in terms of quote
  base_market_usd: number;      // base token market price in USD
  quote_market_usd: number;     // quote token market price in USD
  fair_price: number;           // expected price = base_usd / quote_usd
  deviation_pct: number;        // (bitflow_price - fair_price) / fair_price * 100
  direction: 'premium' | 'discount'; // premium = base overpriced on Bitflow
  fee_pct: number;
  net_opportunity_pct: number;  // |deviation| - fee
  liquidity_usd: number;
  confidence: 'high' | 'medium' | 'low';
  action_hint: string;          // what an agent should consider doing
  warning?: string;
}

interface ScanOutput {
  timestamp: string;
  pools_scanned: number;
  pools_with_market_data: number;
  signals: DeviationSignal[];
  best_signal: DeviationSignal | null;
  market_prices: MarketPrice[];
  summary: string;
}

function detectPoolType(poolId: string): 'stableswap' | 'xyk' | 'unknown' {
  if (poolId.includes('stableswap')) return 'stableswap';
  if (poolId.includes('xyk')) return 'xyk';
  return 'unknown';
}

function normalizeToken(currency: string): string {
  if (currency === 'Stacks') return 'STX';
  const parts = currency.split('.');
  if (parts.length < 2) return currency.toUpperCase().slice(0, 12);
  return parts[1]
    .replace(/^token-/, '')
    .replace(/-token.*$/, '')
    .replace(/-v-\d.*$/, '')
    .toUpperCase()
    .slice(0, 12);
}

async function fetchTicker(): Promise<TickerEntry[]> {
  const res = await fetch(TICKER_API, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Ticker API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<TickerEntry[]>;
}

async function fetchMarketPrices(tokens: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  const ids = [...new Set(tokens.map(t => TOKEN_COINGECKO_ID[t]).filter(Boolean))];
  if (ids.length === 0) return prices;

  try {
    const url = `${COINGECKO_API}?ids=${ids.join(',')}&vs_currencies=usd`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
    const data = await res.json() as Record<string, { usd: number }>;

    // Map back to token names
    for (const token of tokens) {
      const cgId = TOKEN_COINGECKO_ID[token];
      if (cgId && data[cgId]?.usd) {
        prices.set(token, data[cgId].usd);
      }
    }
  } catch {
    // fallback: return empty, caller will skip those tokens
  }

  return prices;
}

async function runScan(options: { json: boolean; minDeviation: number; top: number }): Promise<void> {
  const [raw] = await Promise.all([fetchTicker()]);

  // Filter usable pools
  const usable = raw.filter(e =>
    e.last_price > 0 &&
    e.liquidity_in_usd >= MIN_LIQUIDITY_USD
  );

  // Collect unique tokens
  const allTokens = new Set<string>();
  for (const e of usable) {
    allTokens.add(normalizeToken(e.base_currency));
    allTokens.add(normalizeToken(e.target_currency));
  }

  const marketPrices = await fetchMarketPrices([...allTokens]);

  const signals: DeviationSignal[] = [];
  let poolsWithData = 0;

  for (const entry of usable) {
    const base = normalizeToken(entry.base_currency);
    const quote = normalizeToken(entry.target_currency);

    const baseUsd = marketPrices.get(base);
    const quoteUsd = marketPrices.get(quote);

    if (!baseUsd || !quoteUsd) continue;
    poolsWithData++;

    const fairPrice = baseUsd / quoteUsd;
    if (fairPrice <= 0) continue;

    const bitflowPrice = entry.last_price;
    const deviationPct = ((bitflowPrice - fairPrice) / fairPrice) * 100;
    const poolType = detectPoolType(entry.pool_id);
    const feePct = (poolType === 'stableswap' ? STABLE_FEE : XYK_FEE) * 100;
    const netOpportunityPct = Math.abs(deviationPct) - feePct;

    if (netOpportunityPct < options.minDeviation) continue;

    // Anomaly filter: skip if pool volume/TVL is extreme
    const vol = (entry.base_volume || 0) + (entry.target_volume || 0);
    if (vol > 0 && entry.liquidity_in_usd > 0 && vol / entry.liquidity_in_usd > 100) continue;

    const direction = deviationPct > 0 ? 'premium' : 'discount';

    // Action hint
    let actionHint: string;
    if (direction === 'discount') {
      actionHint = `${base} is cheaper on Bitflow than market. Consider buying ${base} here and selling elsewhere.`;
    } else {
      actionHint = `${base} is more expensive on Bitflow than market. Consider selling ${base} here or buying elsewhere.`;
    }

    // Confidence
    const now = Date.now() / 1000;
    const age = entry.last_trade_time ? now - entry.last_trade_time : Infinity;
    let confidence: 'high' | 'medium' | 'low';
    let warning: string | undefined;

    if (age < 3600 && entry.liquidity_in_usd > 50000) {
      confidence = 'high';
    } else if (age < 86400) {
      confidence = 'medium';
      if (age > 3600) warning = 'Price may be stale (>1h since last trade)';
    } else {
      confidence = 'low';
      warning = 'Price is stale (>24h since last trade) — verify before acting';
    }

    signals.push({
      pool_id: entry.pool_id,
      pair: `${base}/${quote}`,
      pool_type: poolType,
      bitflow_price: Math.round(bitflowPrice * 1e8) / 1e8,
      base_market_usd: Math.round(baseUsd * 1e6) / 1e6,
      quote_market_usd: Math.round(quoteUsd * 1e6) / 1e6,
      fair_price: Math.round(fairPrice * 1e8) / 1e8,
      deviation_pct: Math.round(deviationPct * 10000) / 10000,
      direction,
      fee_pct: Math.round(feePct * 10000) / 10000,
      net_opportunity_pct: Math.round(netOpportunityPct * 10000) / 10000,
      liquidity_usd: Math.round(entry.liquidity_in_usd * 100) / 100,
      confidence,
      action_hint: actionHint,
      ...(warning ? { warning } : {}),
    });
  }

  // Sort by net opportunity
  signals.sort((a, b) => Math.abs(b.net_opportunity_pct) - Math.abs(a.net_opportunity_pct));
  const topSignals = signals.slice(0, options.top);
  const bestSignal = topSignals[0] || null;

  const marketPriceList: MarketPrice[] = [...marketPrices.entries()].map(([token, price]) => ({
    token,
    price_usd: Math.round(price * 1e6) / 1e6,
    source: 'coingecko',
  }));

  let summary: string;
  if (topSignals.length === 0) {
    summary = `No price deviations above ${options.minDeviation}% net found across ${poolsWithData} pools with market data.`;
  } else {
    const best = topSignals[0];
    summary = `${topSignals.length} deviation signal${topSignals.length > 1 ? 's' : ''} found. ` +
      `Best: ${best.pair} trading at ${best.deviation_pct > 0 ? '+' : ''}${best.deviation_pct}% vs market ` +
      `(${best.direction}, ${best.net_opportunity_pct}% net after fees). ${best.action_hint}`;
  }

  const output: ScanOutput = {
    timestamp: new Date().toISOString(),
    pools_scanned: usable.length,
    pools_with_market_data: poolsWithData,
    signals: topSignals,
    best_signal: bestSignal,
    market_prices: marketPriceList,
    summary,
  };

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`\n🔍 Bitflow Price Deviation Scanner — ${output.timestamp}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Pools scanned: ${output.pools_scanned} | With market data: ${output.pools_with_market_data}`);
    console.log(`\n📈 Market prices: ${marketPriceList.map(p => `${p.token}=$${p.price_usd}`).join(', ')}`);
    if (topSignals.length === 0) {
      console.log(`\n✅ No significant price deviations above ${options.minDeviation}% net.`);
    } else {
      console.log(`\n⚡ ${topSignals.length} signal${topSignals.length > 1 ? 's' : ''} found:`);
      for (const sig of topSignals) {
        console.log(`\n  ${sig.pair} [${sig.pool_type}] [${sig.confidence.toUpperCase()}]`);
        console.log(`    Bitflow: ${sig.bitflow_price} | Fair: ${sig.fair_price} | Dev: ${sig.deviation_pct > 0 ? '+' : ''}${sig.deviation_pct}%`);
        console.log(`    Net opportunity: ${sig.net_opportunity_pct}% after ${sig.fee_pct}% fee`);
        console.log(`    💡 ${sig.action_hint}`);
        if (sig.warning) console.log(`    ⚠️  ${sig.warning}`);
      }
    }
    console.log(`\n📝 ${output.summary}`);
  }
}

async function runStatus(): Promise<void> {
  const raw = await fetchTicker();
  const usable = raw.filter(e => e.last_price > 0 && e.liquidity_in_usd >= MIN_LIQUIDITY_USD);
  const tokens = new Set<string>();
  for (const e of usable) {
    tokens.add(normalizeToken(e.base_currency));
    tokens.add(normalizeToken(e.target_currency));
  }
  const knownTokens = [...tokens].filter(t => TOKEN_COINCAP_ID[t]);
  console.log(JSON.stringify({
    ok: true,
    pools_available: usable.length,
    unique_tokens: tokens.size,
    tokens_with_market_data: knownTokens.length,
    known_tokens: knownTokens,
  }, null, 2));
}

async function runDoctor(): Promise<void> {
  const checks: { check: string; ok: boolean; detail: string }[] = [];

  try {
    const raw = await fetchTicker();
    checks.push({ check: 'api_reachable', ok: true, detail: `${raw.length} pools returned` });
    const usable = raw.filter(e => e.last_price > 0 && e.liquidity_in_usd >= MIN_LIQUIDITY_USD);
    checks.push({ check: 'pools_available', ok: usable.length > 0, detail: `${usable.length} pools >= $${MIN_LIQUIDITY_USD}` });
    const tokens = new Set<string>();
    for (const e of usable) {
      tokens.add(normalizeToken(e.base_currency));
      tokens.add(normalizeToken(e.target_currency));
    }
    const knownTokens = [...tokens].filter(t => TOKEN_COINGECKO_ID[t]);
    checks.push({ check: 'market_data_available', ok: knownTokens.length > 0, detail: `${knownTokens.length} tokens with market prices: ${knownTokens.join(', ')}` });
    const prices = await fetchMarketPrices(knownTokens);
    checks.push({ check: 'coingecko_reachable', ok: prices.size > 0, detail: `${prices.size} prices fetched` });
  } catch (err) {
    checks.push({ check: 'api_reachable', ok: false, detail: String(err) });
  }

  const allOk = checks.every(c => c.ok);
  console.log(JSON.stringify({ ok: allOk, checks }, null, 2));
  if (!allOk) process.exit(1);
}

const program = new Command();
program
  .name('bitflow-arb-scanner')
  .description('Detect Bitflow pool price deviations vs market (CoinCap)')
  .version('1.0.0');

program
  .command('doctor')
  .description('Check API availability and market data coverage')
  .action(async () => {
    try { await runDoctor(); }
    catch (err) {
      console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show pool count and token coverage')
  .action(async () => {
    try { await runStatus(); }
    catch (err) {
      console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      process.exit(1);
    }
  });

program
  .command('run')
  .description('Scan for price deviations and output ranked signals')
  .option('--min-deviation <pct>', 'Minimum net deviation % to report', String(MIN_DEVIATION_PCT))
  .option('--top <n>', 'Maximum signals to return', '10')
  .option('--pretty', 'Human-readable output instead of JSON')
  .action(async (opts) => {
    try {
      await runScan({
        json: !opts.pretty,
        minDeviation: parseFloat(opts.minDeviation),
        top: parseInt(opts.top, 10),
      });
    } catch (err) {
      console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      process.exit(1);
    }
  });

program.parse(process.argv);
