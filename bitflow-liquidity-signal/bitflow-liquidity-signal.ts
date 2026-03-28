#!/usr/bin/env node
/**
 * bitflow-liquidity-signal
 * Analyzes Bitflow DEX pool liquidity health and ranks pools by depth,
 * volume activity, and price spread. Outputs a structured signal for
 * agents to select optimal trading routes.
 *
 * Author: yuechu-cat (月出)
 * Competition: AIBTC × Bitflow Skills Pay the Bills
 */

import { Command } from 'commander';

const TICKER_API = 'https://bitflow-sdk-api-gateway-7owjsmt8.uc.gateway.dev/ticker';
const MIN_LIQUIDITY_USD = 1000; // filter dust pools

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

interface PoolSignal {
  pool_id: string;
  pair: string;
  liquidity_usd: number;
  volume_24h_usd: number;
  spread_pct: number | null;
  price_range_pct: number | null;
  last_trade_time: number | null;
  health_score: number;
  status: 'active' | 'idle' | 'deep';
}

interface SignalOutput {
  timestamp: string;
  total_pools: number;
  active_pools: number;
  total_liquidity_usd: number;
  total_volume_24h_usd: number;
  top_pools: PoolSignal[];
  best_for_trading: PoolSignal | null;
  best_for_liquidity: PoolSignal | null;
  signal_summary: string;
}

function shortName(contract: string): string {
  if (contract === 'Stacks') return 'STX';
  // Extract token name from contract address (last part after .)
  const parts = contract.split('.');
  if (parts.length < 2) return contract.slice(0, 8);
  return parts[1]
    .replace(/^token-/, '')
    .replace(/-token$/, '')
    .replace(/-lp-token.*$/, '')
    .toUpperCase()
    .slice(0, 12);
}

function calcHealthScore(pool: TickerEntry): number {
  let score = 0;

  // Liquidity score (0-40 points)
  if (pool.liquidity_in_usd >= 100000) score += 40;
  else if (pool.liquidity_in_usd >= 50000) score += 30;
  else if (pool.liquidity_in_usd >= 10000) score += 20;
  else if (pool.liquidity_in_usd >= 1000) score += 10;

  // Volume score (0-30 points)
  const vol = pool.base_volume + pool.target_volume;
  if (vol > 10000) score += 30;
  else if (vol > 1000) score += 20;
  else if (vol > 100) score += 10;
  else if (vol > 0) score += 5;

  // Spread score (0-20 points) — tighter spread = better
  if (pool.ask && pool.bid && pool.ask > 0 && pool.bid > 0) {
    const spread = (pool.ask - pool.bid) / pool.ask;
    if (spread < 0.001) score += 20;
    else if (spread < 0.005) score += 15;
    else if (spread < 0.01) score += 10;
    else if (spread < 0.05) score += 5;
  }

  // Recency score (0-10 points)
  if (pool.last_trade_time) {
    const ageHours = (Date.now() / 1000 - pool.last_trade_time) / 3600;
    if (ageHours < 1) score += 10;
    else if (ageHours < 6) score += 7;
    else if (ageHours < 24) score += 4;
    else if (ageHours < 72) score += 1;
  }

  return score;
}

function classifyPool(pool: TickerEntry): 'active' | 'idle' | 'deep' {
  const vol = pool.base_volume + pool.target_volume;
  if (vol > 0 && pool.last_trade_time) return 'active';
  if (pool.liquidity_in_usd >= 50000) return 'deep';
  return 'idle';
}

async function fetchTicker(): Promise<TickerEntry[]> {
  const res = await fetch(TICKER_API);
  if (!res.ok) {
    throw new Error(`Ticker API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<TickerEntry[]>;
}

async function runSignal(options: { top: number; minLiquidity: number; json: boolean }): Promise<void> {
  const raw = await fetchTicker();

  // Filter out dust pools
  const pools = raw.filter(p => p.liquidity_in_usd >= options.minLiquidity);

  // Build pool signals
  const signals: PoolSignal[] = pools.map(p => {
    const vol24h = (p.base_volume || 0) + (p.target_volume || 0);
    const spread =
      p.ask && p.bid && p.ask > 0 && p.bid > 0
        ? ((p.ask - p.bid) / p.ask) * 100
        : null;
    const priceRange =
      p.high > 0 && p.low > 0
        ? ((p.high - p.low) / p.low) * 100
        : null;

    return {
      pool_id: p.pool_id,
      pair: `${shortName(p.base_currency)}/${shortName(p.target_currency)}`,
      liquidity_usd: Math.round(p.liquidity_in_usd * 100) / 100,
      volume_24h_usd: Math.round(vol24h * 100) / 100,
      spread_pct: spread !== null ? Math.round(spread * 10000) / 10000 : null,
      price_range_pct: priceRange !== null ? Math.round(priceRange * 100) / 100 : null,
      last_trade_time: p.last_trade_time || null,
      health_score: calcHealthScore(p),
      status: classifyPool(p),
    };
  });

  // Sort by health score
  signals.sort((a, b) => b.health_score - a.health_score);

  const topPools = signals.slice(0, options.top);
  const activePools = signals.filter(s => s.status === 'active');
  const totalLiquidity = signals.reduce((sum, s) => sum + s.liquidity_usd, 0);
  const totalVolume = signals.reduce((sum, s) => sum + s.volume_24h_usd, 0);

  const bestForTrading = activePools.sort((a, b) => b.volume_24h_usd - a.volume_24h_usd)[0] || null;
  const bestForLiquidity = [...signals].sort((a, b) => b.liquidity_usd - a.liquidity_usd)[0] || null;

  const summary =
    activePools.length > 0
      ? `${activePools.length} active pools out of ${signals.length}. ` +
        `Top pool: ${topPools[0]?.pair || 'N/A'} ($${topPools[0]?.liquidity_usd.toLocaleString()} TVL). ` +
        `Total DEX liquidity: $${Math.round(totalLiquidity).toLocaleString()} across ${signals.length} pools.`
      : `No active trading detected. ${signals.length} pools with $${Math.round(totalLiquidity).toLocaleString()} idle liquidity.`;

  const output: SignalOutput = {
    timestamp: new Date().toISOString(),
    total_pools: signals.length,
    active_pools: activePools.length,
    total_liquidity_usd: Math.round(totalLiquidity * 100) / 100,
    total_volume_24h_usd: Math.round(totalVolume * 100) / 100,
    top_pools: topPools,
    best_for_trading: bestForTrading,
    best_for_liquidity: bestForLiquidity,
    signal_summary: summary,
  };

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`\n🔍 Bitflow Liquidity Signal — ${output.timestamp}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Total pools: ${output.total_pools} | Active: ${output.active_pools}`);
    console.log(`Total TVL: $${output.total_liquidity_usd.toLocaleString()}`);
    console.log(`24h Volume: $${output.total_volume_24h_usd.toLocaleString()}`);
    console.log(`\n📊 Top ${options.top} Pools by Health Score:`);
    for (const p of topPools) {
      const age = p.last_trade_time
        ? `${Math.round((Date.now() / 1000 - p.last_trade_time) / 60)}m ago`
        : 'no trades';
      console.log(
        `  [${p.health_score.toString().padStart(3)}] ${p.pair.padEnd(20)} ` +
        `TVL: $${p.liquidity_usd.toLocaleString().padStart(12)} | ` +
        `Vol: $${p.volume_24h_usd.toLocaleString().padStart(10)} | ` +
        `${p.status.padEnd(6)} | ${age}`
      );
    }
    if (output.best_for_trading) {
      console.log(`\n🏆 Best for trading: ${output.best_for_trading.pair} (vol $${output.best_for_trading.volume_24h_usd.toLocaleString()})`);
    }
    if (output.best_for_liquidity) {
      console.log(`💧 Deepest pool:     ${output.best_for_liquidity.pair} (TVL $${output.best_for_liquidity.liquidity_usd.toLocaleString()})`);
    }
    console.log(`\n📝 ${output.signal_summary}`);
  }
}

async function runStatus(): Promise<void> {
  try {
    const raw = await fetchTicker();
    const pools = raw.filter(p => p.liquidity_in_usd >= MIN_LIQUIDITY_USD);
    const active = pools.filter(p => (p.base_volume + p.target_volume) > 0);
    console.log(JSON.stringify({
      status: 'ok',
      pools_total: raw.length,
      pools_with_liquidity: pools.length,
      pools_active: active.length,
      api_reachable: true,
    }));
  } catch (err) {
    console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  }
}

async function runDoctor(): Promise<void> {
  const checks: Array<{ check: string; ok: boolean; detail: string }> = [];

  // Check API reachability
  try {
    const res = await fetch(TICKER_API);
    const data: TickerEntry[] = await res.json() as TickerEntry[];
    checks.push({ check: 'api_reachable', ok: true, detail: `${data.length} pools returned` });
    checks.push({ check: 'pools_available', ok: data.length > 0, detail: `${data.length} pools` });
    const withLiquidity = data.filter(p => p.liquidity_in_usd >= MIN_LIQUIDITY_USD);
    checks.push({ check: 'pools_with_liquidity', ok: withLiquidity.length > 0, detail: `${withLiquidity.length} pools >= $${MIN_LIQUIDITY_USD}` });
  } catch (err) {
    checks.push({ check: 'api_reachable', ok: false, detail: err instanceof Error ? err.message : String(err) });
  }

  const allOk = checks.every(c => c.ok);
  console.log(JSON.stringify({ ok: allOk, checks }, null, 2));
  if (!allOk) process.exit(1);
}

const program = new Command();
program
  .name('bitflow-liquidity-signal')
  .description('Analyze Bitflow DEX pool liquidity health and rank pools for optimal routing')
  .version('1.0.0');

program
  .command('run')
  .description('Fetch and analyze current Bitflow pool liquidity signals')
  .option('--top <n>', 'Number of top pools to show', '10')
  .option('--min-liquidity <usd>', 'Minimum pool liquidity in USD', String(MIN_LIQUIDITY_USD))
  .option('--pretty', 'Output human-readable format instead of JSON', false)
  .action(async (opts) => {
    try {
      await runSignal({
        top: parseInt(opts.top, 10),
        minLiquidity: parseFloat(opts.minLiquidity),
        json: !opts.pretty,
      });
    } catch (err) {
      console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Check Bitflow API status and pool availability')
  .action(async () => { await runStatus(); });

program
  .command('doctor')
  .description('Run diagnostics: verify API connectivity and data freshness')
  .action(async () => { await runDoctor(); });

program.parse(process.argv);
