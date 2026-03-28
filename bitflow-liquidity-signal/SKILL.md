---
name: bitflow-liquidity-signal
description: "Analyzes all Bitflow DEX pools for liquidity health, ranks them by depth and trading activity, and outputs structured signals for agents to select optimal swap routes."
metadata:
  author: "ilovewindows10"
  author-agent: "月出 (Yuechu)"
  user-invocable: "false"
  arguments: "doctor | status | run"
  entry: "bitflow-liquidity-signal/bitflow-liquidity-signal.ts"
  requires: "network"
  tags: "defi, read-only, l2, infrastructure"
---

# bitflow-liquidity-signal

Analyzes all Bitflow DEX liquidity pools and outputs a ranked signal of pool health — covering TVL depth, 24h volume, bid/ask spread, and last trade recency. Designed to help agents choose the optimal pool for swaps, avoid illiquid routes, and monitor overall Bitflow DEX health.

## What it does

- Fetches live pool data from the Bitflow public ticker API (no API key required)
- Scores each pool across 4 dimensions: liquidity depth, 24h volume, spread tightness, trade recency
- Returns top-N pools ranked by composite health score
- Identifies the best pool for active trading and the deepest pool for large swaps
- Outputs a human-readable summary or structured JSON for agent consumption

## Commands

```bash
# Run full liquidity signal analysis
bun run bitflow-liquidity-signal/bitflow-liquidity-signal.ts run

# Output as JSON (for agent consumption)
bun run bitflow-liquidity-signal/bitflow-liquidity-signal.ts run --json

# Show top 5 pools with minimum $10,000 TVL
bun run bitflow-liquidity-signal/bitflow-liquidity-signal.ts run --top 5 --min-liquidity 10000

# Check API availability
bun run bitflow-liquidity-signal/bitflow-liquidity-signal.ts status

# Run diagnostics
bun run bitflow-liquidity-signal/bitflow-liquidity-signal.ts doctor
```

## Output (JSON mode)

```json
{
  "timestamp": "2026-03-28T02:00:00.000Z",
  "total_pools": 32,
  "active_pools": 8,
  "total_liquidity_usd": 1250000,
  "total_volume_24h_usd": 45000,
  "top_pools": [
    {
      "pool_id": "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stx-ststx-lp-token-v-1-2",
      "pair": "STX/STSTX",
      "liquidity_usd": 242000,
      "volume_24h_usd": 1200,
      "spread_pct": null,
      "price_range_pct": null,
      "last_trade_time": 1774651340,
      "health_score": 45,
      "status": "deep"
    }
  ],
  "best_for_trading": { ... },
  "best_for_liquidity": { ... },
  "signal_summary": "8 active pools out of 32. Top pool: STX/STSTX ($242,000 TVL)..."
}
```

## Error output

All errors return `{ "error": "descriptive message" }` and exit with code 1.

## Notes

- Uses the Bitflow public ticker API: `https://bitflow-sdk-api-gateway-7owjsmt8.uc.gateway.dev/ticker`
- No wallet, signing, or funds required — purely read-only
- Pools with < $1,000 TVL are filtered out by default (configurable via `--min-liquidity`)
- Health score: 0–100 composite (liquidity 40pt + volume 30pt + spread 20pt + recency 10pt)
