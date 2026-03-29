---
name: bitflow-liquidity-signal
description: "Fetches all Bitflow DEX pools, scores each by liquidity depth, 24h volume, spread, and trade recency, and emits a ranked JSON signal so agents can select the optimal swap route or avoid illiquid pools."
metadata:
  author: "ilovewindows10"
  author-agent: "月出 (Yuechu)"
  user-invocable: "false"
  arguments: "doctor | status | run"
  entry: "bitflow-liquidity-signal/bitflow-liquidity-signal.ts"
  requires: "network"
  tags: "defi, read-only, l2"
---

# bitflow-liquidity-signal

## What it does

Fetches all 44 Bitflow DEX pools from the public ticker API, scores each pool across four dimensions (liquidity depth, 24h volume, bid/ask spread, trade recency), and returns a ranked JSON signal. Output includes top pools by health score, the best pool for active trading, and the deepest pool for large swaps.

## Why agents need it

Agents executing swaps on Bitflow need to know which pool has sufficient liquidity and active price discovery before routing a trade. This skill provides that routing signal — a composite health score and ranked pool list that lets agents avoid thin or idle pools, minimize slippage, and pick the best execution venue without trial-and-error.

## Safety notes

- Read-only — never writes to chain or moves funds.
- No wallet or signing required.
- Uses only the public Bitflow ticker API (no API key needed).
- Pools with < $1,000 TVL are filtered out by default to avoid dust pool noise.
- All errors return `{ "error": "descriptive message" }` and exit with code 1.

## Commands

### doctor

Checks API reachability, pool availability, and data freshness. Safe to run anytime.

```bash
bun run bitflow-liquidity-signal/bitflow-liquidity-signal.ts doctor
```

### status

Read-only snapshot of pool count, active pool count, and API health.

```bash
bun run bitflow-liquidity-signal/bitflow-liquidity-signal.ts status
```

### run

Fetches and scores all pools, returns ranked JSON signal.

```bash
bun run bitflow-liquidity-signal/bitflow-liquidity-signal.ts run
bun run bitflow-liquidity-signal/bitflow-liquidity-signal.ts run --top 5
bun run bitflow-liquidity-signal/bitflow-liquidity-signal.ts run --min-liquidity 10000
bun run bitflow-liquidity-signal/bitflow-liquidity-signal.ts run --pretty
```

## Output contract

All outputs are JSON to stdout.

**Success:**
```json
{
  "timestamp": "2026-03-28T02:24:30.204Z",
  "total_pools": 25,
  "active_pools": 13,
  "total_liquidity_usd": 3590180.37,
  "total_volume_24h_usd": 10898681068.66,
  "top_pools": [
    {
      "pool_id": "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-pool-sbtc-stx-v-1-1",
      "pair": "SBTC/STX",
      "liquidity_usd": 1321240.98,
      "volume_24h_usd": 91407.09,
      "spread_pct": null,
      "price_range_pct": 14.58,
      "last_trade_time": 1774662919,
      "health_score": 80,
      "status": "active"
    }
  ],
  "best_for_trading": { "pair": "NOPE/STX", "volume_24h_usd": 10810054206.49 },
  "best_for_liquidity": { "pair": "SBTC/STX", "liquidity_usd": 1321240.98 },
  "signal_summary": "13 active pools out of 25. Top pool: STX/STSTX ($721,961 TVL)."
}
```

**Error:**
```json
{ "error": "descriptive message" }
```

## Health score breakdown

| Dimension | Max pts | Signal |
|---|---|---|
| Liquidity depth (TVL) | 40 | Deeper = safer for large swaps |
| 24h volume | 30 | More volume = tighter real market |
| Bid/ask spread | 20 | Tighter spread = better execution |
| Trade recency | 10 | Recent trades = live price discovery |

## Pool status labels

| Status | Meaning |
|---|---|
| `active` | Traded within last 24h |
| `deep` | High TVL but no recent trades |
| `idle` | Low activity, avoid for time-sensitive trades |
