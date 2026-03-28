#!/usr/bin/env node
/**
 * bitflow-depeg-monitor
 * Monitors Bitflow DEX stablecoin pools for de-peg events.
 * Compares stablecoin pool prices against their $1.00 peg and
 * cross-checks with CoinGecko market prices to detect genuine
 * de-pegs vs. temporary pool imbalances.
 *
 * Read-only. No wallet or signing required.
 * Author: ilovewindows10 (月出 / Yuechu)
 * Competition: AIBTC × Bitflow Skills Pay the Bills
 */

import { Command } from 'commander';

const TICKER_API = 'https://bitflow-sdk-api-gateway-7owjsmt8.uc.gateway.dev/ticker';
const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/price';
const FETCH_TIMEOUT_MS = 30_000;

// Stablecoin definitions — expected peg price in USD
const STABLECOINS: Record<string, { peg: number; coingeckoId: string; fullName: string }> = {
  'AEUSDC': { peg: 1.0, coingeckoId: 'usd-coin', fullName: 'Allbridge USDC' },
  'USDCX':  { peg: 1.0, coingeckoId: 'usd-coin', fullName: 'USDCx' },
  'USDH':   { peg: 1.0, coingeckoId: 'usd-coin', fullName: 'USDH' },
  'USDA':   { peg: 1.0, coingeckoId: 'usd-coin', fullName: 'USDA' },
};

// Alert thresholds
const DEPEG_WARNING_PCT  = 0.5;   // 0.5% off peg → warning
const DEPEG_ALERT_PCT    = 1.0;   // 1.0% off peg → alert
const DEPEG_CRITICAL_PCT = 3.0;   // 3.0% off peg → critical

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

interface DepegSignal {
  token: string;
  full_name: string;
  pool_id: string;
  pool_type: 'stableswap' | 'xyk' | 'unknown';
  peg_target: number;
  pool_price_usd: number;       // price derived from pool + reference token
  market_price_usd: number | null;  // CoinGecko price
  pool_deviation_pct: number;   // % off peg from pool price
  market_deviation_pct: number | null; // % off peg from market price
  severity: 'ok' | 'warning' | 'alert' | 'critical';
  liquidity_usd: number;
  last_trade_time: number | null;
  last_trade_age_minutes: number | null;
  diagnosis: string;            // human-readable explanation
  warning?: string;
}

interface MonitorOutput {
  timestamp: string;
  pools_scanned: number;
  stablecoin_pools_found: number;
  signals: DepegSignal[];
  critical_count: number;
  alert_count: number;
  warning_count: number;
  ok_count: number;
  summary: string;
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

function detectPoolType(poolId: string): 'stableswap' | 'xyk' | 'unknown' {
  if (poolId.includes('stableswap')) return 'stableswap';
  if (poolId.includes('xyk')) return 'xyk';
  return 'unknown';
}

async function fetchTicker(): Promise<TickerEntry[]> {
  const res = await fetch(TICKER_API, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Ticker API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<TickerEntry[]>;
}

async function fetchMarketPrices(cgIds: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  const ids = [...new Set(cgIds)];
  if (ids.length === 0) return prices;
  try {
    const url = `${COINGECKO_API}?ids=${ids.join(',')}&vs_currencies=usd`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
    const data = await res.json() as Record<string, { usd: number }>;
    for (const [id, val] of Object.entries(data)) {
      if (val?.usd) prices.set(id, val.usd);
    }
  } catch { /* fallback: empty */ }
  return prices;
}

function getSeverity(deviationPct: number): 'ok' | 'warning' | 'alert' | 'critical' {
  const abs = Math.abs(deviationPct);
  if (abs >= DEPEG_CRITICAL_PCT) return 'critical';
  if (abs >= DEPEG_ALERT_PCT)    return 'alert';
  if (abs >= DEPEG_WARNING_PCT)  return 'warning';
  return 'ok';
}

function makeDiagnosis(
  token: string,
  poolDev: number,
  marketDev: number | null,
  severity: string,
  ageMinutes: number | null
): string {
  if (severity === 'ok') return `${token} is trading within normal range (${poolDev > 0 ? '+' : ''}${poolDev.toFixed(3)}% from peg).`;

  const dir = poolDev < 0 ? 'below' : 'above';
  const abs = Math.abs(poolDev).toFixed(3);

  if (marketDev !== null && Math.abs(marketDev) > DEPEG_WARNING_PCT) {
    return `GENUINE DE-PEG: ${token} is ${abs}% ${dir} peg on both Bitflow pool and CoinGecko market. Market price also confirms deviation (${marketDev > 0 ? '+' : ''}${marketDev.toFixed(3)}%). This may indicate a real de-peg event.`;
  }

  if (ageMinutes !== null && ageMinutes > 60) {
    return `POOL IMBALANCE (stale): ${token} pool shows ${abs}% ${dir} peg, but last trade was ${Math.round(ageMinutes)}min ago. May be stale liquidity, not a real de-peg.`;
  }

  return `POOL IMBALANCE: ${token} pool price is ${abs}% ${dir} peg on Bitflow. CoinGecko market price appears stable. Likely a pool-specific imbalance.`;
}

async function runMonitor(options: { json: boolean; minSeverity: string; top: number }): Promise<void> {
  const raw = await fetchTicker();

  // Collect unique CoinGecko IDs needed
  const cgIds = [...new Set(Object.values(STABLECOINS).map(s => s.coingeckoId))];
  const marketPrices = await fetchMarketPrices(cgIds);

  // Reference token prices in USD (for computing stablecoin USD price from pool)
  // We use STX price from CoinGecko to convert STX-paired pools
  const stxMarketUsd = marketPrices.get('blockstack') || null;

  const signals: DepegSignal[] = [];
  let stablecoinPoolCount = 0;

  for (const entry of raw) {
    const base = normalizeToken(entry.base_currency);
    const quote = normalizeToken(entry.target_currency);

    // Find stablecoin: could be base or quote
    let stableToken: string | null = null;
    let refToken: string | null = null;
    let stablecoinIsBase = true;

    if (STABLECOINS[base]) {
      stableToken = base;
      refToken = quote;
      stablecoinIsBase = true;
    } else if (STABLECOINS[quote]) {
      stableToken = quote;
      refToken = base;
      stablecoinIsBase = false;
    }

    if (!stableToken || !refToken) continue;
    if (entry.liquidity_in_usd < 1000) continue;
    if (!entry.last_price || entry.last_price <= 0) continue; // skip pools with no price data
    stablecoinPoolCount++;

    const stableInfo = STABLECOINS[stableToken];
    const marketPrice = marketPrices.get(stableInfo.coingeckoId) ?? null;

    // Compute pool-derived USD price of the stablecoin
    let poolPriceUsd: number;
    if (stablecoinIsBase) {
      // price = how much quote per 1 base
      // if quote is another stablecoin, price ≈ last_price USD
      if (STABLECOINS[refToken]) {
        // stablecoin/stablecoin pool — price is direct ratio
        poolPriceUsd = entry.last_price * (marketPrices.get(STABLECOINS[refToken].coingeckoId) ?? 1.0);
      } else if (refToken === 'STX' && stxMarketUsd) {
        // stablecoin/STX: price is in STX, convert to USD
        poolPriceUsd = entry.last_price * stxMarketUsd;
      } else {
        // Can't determine USD price without reference
        continue;
      }
    } else {
      // quote is stablecoin, base is reference
      // last_price = base/quote, so stablecoin price = 1/last_price * ref_usd
      if (STABLECOINS[refToken]) {
        poolPriceUsd = (1 / entry.last_price) * (marketPrices.get(STABLECOINS[refToken].coingeckoId) ?? 1.0);
      } else if (refToken === 'STX' && stxMarketUsd) {
        poolPriceUsd = (1 / entry.last_price) * stxMarketUsd;
      } else {
        continue;
      }
    }

    const poolDeviationPct = ((poolPriceUsd - stableInfo.peg) / stableInfo.peg) * 100;
    const marketDeviationPct = marketPrice !== null
      ? ((marketPrice - stableInfo.peg) / stableInfo.peg) * 100
      : null;

    const severity = getSeverity(poolDeviationPct);

    // Filter by minimum severity
    const severityOrder = ['ok', 'warning', 'alert', 'critical'];
    const minIdx = severityOrder.indexOf(options.minSeverity);
    const sigIdx = severityOrder.indexOf(severity);
    if (sigIdx < minIdx) continue;

    const now = Date.now() / 1000;
    const ageMinutes = entry.last_trade_time
      ? Math.round((now - entry.last_trade_time) / 60)
      : null;

    const diagnosis = makeDiagnosis(stableToken, poolDeviationPct, marketDeviationPct, severity, ageMinutes);

    let warning: string | undefined;
    if (ageMinutes !== null && ageMinutes > 120) {
      warning = `Last trade was ${ageMinutes} minutes ago — pool price may be stale`;
    }

    signals.push({
      token: stableToken,
      full_name: stableInfo.fullName,
      pool_id: entry.pool_id,
      pool_type: detectPoolType(entry.pool_id),
      peg_target: stableInfo.peg,
      pool_price_usd: Math.round(poolPriceUsd * 1e6) / 1e6,
      market_price_usd: marketPrice !== null ? Math.round(marketPrice * 1e6) / 1e6 : null,
      pool_deviation_pct: Math.round(poolDeviationPct * 10000) / 10000,
      market_deviation_pct: marketDeviationPct !== null ? Math.round(marketDeviationPct * 10000) / 10000 : null,
      severity,
      liquidity_usd: Math.round(entry.liquidity_in_usd * 100) / 100,
      last_trade_time: entry.last_trade_time || null,
      last_trade_age_minutes: ageMinutes,
      diagnosis,
      ...(warning ? { warning } : {}),
    });
  }

  // Sort: critical first, then by |deviation|
  signals.sort((a, b) => {
    const sev = ['critical', 'alert', 'warning', 'ok'];
    const sevDiff = sev.indexOf(a.severity) - sev.indexOf(b.severity);
    if (sevDiff !== 0) return sevDiff;
    return Math.abs(b.pool_deviation_pct) - Math.abs(a.pool_deviation_pct);
  });

  const topSignals = signals.slice(0, options.top);
  const critical = signals.filter(s => s.severity === 'critical').length;
  const alert    = signals.filter(s => s.severity === 'alert').length;
  const warning  = signals.filter(s => s.severity === 'warning').length;
  const ok       = signals.filter(s => s.severity === 'ok').length;

  let summary: string;
  if (critical > 0) {
    summary = `🚨 CRITICAL: ${critical} stablecoin(s) showing critical de-peg. Immediate attention required.`;
  } else if (alert > 0) {
    summary = `⚠️ ALERT: ${alert} stablecoin(s) showing significant de-peg. Monitor closely.`;
  } else if (warning > 0) {
    summary = `⚡ WARNING: ${warning} stablecoin(s) showing minor deviation from peg.`;
  } else {
    summary = `✅ All ${ok} monitored stablecoin pools are within normal range.`;
  }

  const output: MonitorOutput = {
    timestamp: new Date().toISOString(),
    pools_scanned: raw.length,
    stablecoin_pools_found: stablecoinPoolCount,
    signals: topSignals,
    critical_count: critical,
    alert_count: alert,
    warning_count: warning,
    ok_count: ok,
    summary,
  };

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    const icons: Record<string, string> = { critical: '🚨', alert: '⚠️', warning: '⚡', ok: '✅' };
    console.log(`\n🔍 Bitflow Stablecoin De-peg Monitor — ${output.timestamp}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Pools scanned: ${output.pools_scanned} | Stablecoin pools: ${output.stablecoin_pools_found}`);
    console.log(`Critical: ${critical} | Alert: ${alert} | Warning: ${warning} | OK: ${ok}`);
    for (const sig of topSignals) {
      const icon = icons[sig.severity] || '?';
      console.log(`\n  ${icon} ${sig.token} (${sig.full_name}) [${sig.pool_type}]`);
      console.log(`    Pool price: $${sig.pool_price_usd} | Market: $${sig.market_price_usd ?? 'N/A'} | Peg: $${sig.peg_target}`);
      console.log(`    Pool dev: ${sig.pool_deviation_pct > 0 ? '+' : ''}${sig.pool_deviation_pct}% | Market dev: ${sig.market_deviation_pct !== null ? (sig.market_deviation_pct > 0 ? '+' : '') + sig.market_deviation_pct + '%' : 'N/A'}`);
      console.log(`    ${sig.diagnosis}`);
      if (sig.warning) console.log(`    ⚠️  ${sig.warning}`);
    }
    console.log(`\n📝 ${output.summary}`);
  }
}

async function runStatus(): Promise<void> {
  const raw = await fetchTicker();
  const stablePools = raw.filter(e => {
    const base = normalizeToken(e.base_currency);
    const quote = normalizeToken(e.target_currency);
    return STABLECOINS[base] || STABLECOINS[quote];
  });
  const cgIds = [...new Set(Object.values(STABLECOINS).map(s => s.coingeckoId))];
  const prices = await fetchMarketPrices(cgIds);
  console.log(JSON.stringify({
    ok: true,
    total_pools: raw.length,
    stablecoin_pools: stablePools.length,
    monitored_tokens: Object.keys(STABLECOINS),
    market_prices_available: prices.size > 0,
    thresholds: { warning: DEPEG_WARNING_PCT, alert: DEPEG_ALERT_PCT, critical: DEPEG_CRITICAL_PCT },
  }, null, 2));
}

async function runDoctor(): Promise<void> {
  const checks: { check: string; ok: boolean; detail: string }[] = [];
  try {
    const raw = await fetchTicker();
    checks.push({ check: 'api_reachable', ok: true, detail: `${raw.length} pools returned` });
    const stablePools = raw.filter(e => {
      const base = normalizeToken(e.base_currency);
      const quote = normalizeToken(e.target_currency);
      return STABLECOINS[base] || STABLECOINS[quote];
    });
    checks.push({ check: 'stablecoin_pools_found', ok: stablePools.length > 0, detail: `${stablePools.length} stablecoin pools found` });
    const cgIds = [...new Set(Object.values(STABLECOINS).map(s => s.coingeckoId))];
    const prices = await fetchMarketPrices(cgIds);
    checks.push({ check: 'coingecko_reachable', ok: prices.size > 0, detail: `${prices.size} market prices fetched` });
  } catch (err) {
    checks.push({ check: 'api_reachable', ok: false, detail: String(err) });
  }
  const allOk = checks.every(c => c.ok);
  console.log(JSON.stringify({ ok: allOk, checks }, null, 2));
  if (!allOk) process.exit(1);
}

const program = new Command();
program.name('bitflow-depeg-monitor').description('Monitor Bitflow stablecoin pools for de-peg events').version('1.0.0');

program.command('doctor').description('Check API and stablecoin pool availability').action(async () => {
  try { await runDoctor(); }
  catch (err) { console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) })); process.exit(1); }
});

program.command('status').description('Show stablecoin pool count and monitoring thresholds').action(async () => {
  try { await runStatus(); }
  catch (err) { console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) })); process.exit(1); }
});

program.command('run')
  .description('Run de-peg monitor and output signals')
  .option('--min-severity <level>', 'Minimum severity to report (ok|warning|alert|critical)', 'ok')
  .option('--top <n>', 'Maximum signals to return', '20')
  .option('--pretty', 'Human-readable output instead of JSON')
  .action(async (opts) => {
    try { await runMonitor({ json: !opts.pretty, minSeverity: opts.minSeverity, top: parseInt(opts.top, 10) }); }
    catch (err) { console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) })); process.exit(1); }
  });

program.parse(process.argv);
