---
name: bitflow-arb-scanner
description: "Compares Bitflow DEX pool prices against live CoinGecko market prices to detect pools trading at a premium or discount, and outputs ranked deviation signals so agents can exploit price inefficiencies."
metadata:
  author: "ilovewindows10"
  author-agent: "月出 (Yuechu)"
  user-invocable: "false"
  arguments: "doctor | status | run"
  entry: "bitflow-arb-scanner/bitflow-arb-scanner.ts"
  requires: "network"
  tags: "defi, read-only, l2, signals, arbitrage"
---

# bitflow-arb-scanner

## What it does

Fetches live Bitflow DEX pool prices and compares them against real-time CoinGecko market prices for the same tokens. Computes the deviation percentage (premium or discount vs fair value), subtracts pool fees, and returns ranked signals. Also identifies the best pool for active trading and detects pools trading significantly off-peg.

## Why agents need it

Bitflow pools can temporarily trade at a premium or discount to fair market value due to imbalanced liquidity, low volume, or stale prices. An agent executing swaps without checking this can overpay or miss profitable entry points. This skill gives agents a structured signal to decide: is this pool priced fairly right now? Should I buy here, sell here, or wait?

## Safety notes

- Read-only — never writes to chain or moves funds.
- No wallet or signing required.
- Uses public APIs only: Bitflow ticker and CoinGecko free tier (no API key needed).
- All action hints are suggestions only — agents must apply their own risk assessment before trading.
- Pools with stale prices (>1h since last trade) are flagged with a warning.
- Anomalous pools (volume/TVL > 100x) are excluded from analysis.

## Commands

### doctor

Checks Bitflow API reachability, pool availability, and CoinGecko market data coverage.

```bash
bun run bitflow-arb-scanner/bitflow-arb-scanner.ts doctor
```

### status

Shows pool count, unique tokens, and which tokens have market price data.

```bash
bun run bitflow-arb-scanner/bitflow-arb-scanner.ts status
```

### run

Scans all pools for price deviations and outputs ranked signals.

```bash
bun run bitflow-arb-scanner/bitflow-arb-scanner.ts run
bun run bitflow-arb-scanner/bitflow-arb-scanner.ts run --min-deviation 1.0
bun run bitflow-arb-scanner/bitflow-arb-scanner.ts run --top 5
bun run bitflow-arb-scanner/bitflow-arb-scanner.ts run --pretty
```

## Output contract

All outputs are JSON to stdout.

**Success:**
```json
{
  "timestamp": "2026-03-28T02:39:32.759Z",
  "pools_scanned": 12,
  "pools_with_market_data": 5,
  "signals": [
    {
      "pool_id": "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.stableswap-pool-stx-ststx-v-1-4",
      "pair": "STX/STSTX",
      "pool_type": "stableswap",
      "bitflow_price": 0.86001834,
      "base_market_usd": 0.221884,
      "quote_market_usd": 0.221884,
      "fair_price": 1.0,
      "deviation_pct": -13.9982,
      "direction": "discount",
      "fee_pct": 0.01,
      "net_opportunity_pct": 13.9882,
      "liquidity_usd": 720849.94,
      "confidence": "medium",
      "action_hint": "STX is cheaper on Bitflow than market. Consider buying STX here and selling elsewhere.",
      "warning": "Price may be stale (>1h since last trade)"
    }
  ],
  "best_signal": { ... },
  "market_prices": [
    { "token": "STX", "price_usd": 0.221884, "source": "coingecko" }
  ],
  "summary": "2 deviation signals found. Best: STX/STSTX trading at -13.9982% vs market..."
}
```

**Error:**
```json
{ "error": "descriptive message" }
```

## Signal fields explained

| Field | Meaning |
|---|---|
| `bitflow_price` | Current pool price (base/quote) |
| `fair_price` | Expected price from market data (base_usd / quote_usd) |
| `deviation_pct` | % difference: positive = premium, negative = discount |
| `net_opportunity_pct` | \|deviation\| minus pool fee |
| `direction` | `premium` = base overpriced on Bitflow; `discount` = underpriced |
| `confidence` | `high` (<1h trade, >$50K TVL), `medium` (<24h), `low` (stale) |
| `action_hint` | Plain-language suggestion for agent decision-making |
