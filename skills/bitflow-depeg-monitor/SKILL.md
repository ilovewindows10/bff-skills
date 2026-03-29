---
name: bitflow-depeg-monitor
description: "Monitors Bitflow DEX stablecoin pools for de-peg events by comparing pool prices against CoinGecko market prices, classifying severity (ok/warning/alert/critical), and diagnosing whether deviations are genuine de-pegs or pool-specific imbalances."
metadata:
  author: "ilovewindows10"
  author-agent: "Thin Teal"
  user-invocable: "false"
  arguments: "doctor | status | run"
  entry: "bitflow-depeg-monitor/bitflow-depeg-monitor.ts"
  requires: "network"
  tags: "defi, read-only, l2"
---

# bitflow-depeg-monitor

## What it does

Monitors all Bitflow DEX stablecoin pools (AEUSDC, USDCX, USDH, USDA) for de-peg events. For each pool, it computes the stablecoin's effective USD price from pool data, cross-checks it against CoinGecko market prices, classifies severity (ok / warning / alert / critical), and provides a plain-language diagnosis distinguishing genuine de-pegs from pool-specific imbalances.

## Why agents need it

Stablecoin de-pegs are among the most dangerous events in DeFi — they can cascade into LP losses, liquidations, and protocol failures. Agents holding stablecoin positions or executing stablecoin swaps on Bitflow need to know immediately if a peg is breaking. This skill provides a structured, severity-graded signal with actionable diagnosis, allowing agents to pause operations, withdraw liquidity, or alert users before losses occur.

## Safety notes

- Read-only — never writes to chain or moves funds.
- No wallet or signing required.
- Uses only public APIs: Bitflow ticker and CoinGecko free tier (no API key needed).
- Pools with no price data (last_price = 0) are excluded to avoid false positives.
- Diagnoses are advisory only — agents must apply their own risk policy before acting.
- Stale pools (>2h since last trade) are flagged with a warning.

## Commands

### doctor

Checks Bitflow API, stablecoin pool availability, and CoinGecko market data.

```bash
bun run bitflow-depeg-monitor/bitflow-depeg-monitor.ts doctor
```

### status

Shows stablecoin pool count, monitored tokens, and alert thresholds.

```bash
bun run bitflow-depeg-monitor/bitflow-depeg-monitor.ts status
```

### run

Runs the full de-peg monitor and returns severity-graded signals.

```bash
bun run bitflow-depeg-monitor/bitflow-depeg-monitor.ts run
bun run bitflow-depeg-monitor/bitflow-depeg-monitor.ts run --min-severity warning
bun run bitflow-depeg-monitor/bitflow-depeg-monitor.ts run --min-severity alert
bun run bitflow-depeg-monitor/bitflow-depeg-monitor.ts run --pretty
```

## Output contract

All outputs are JSON to stdout.

**Success:**
```json
{
  "timestamp": "2026-03-28T02:46:18.859Z",
  "pools_scanned": 44,
  "stablecoin_pools_found": 4,
  "signals": [
    {
      "token": "USDH",
      "full_name": "USDH",
      "pool_id": "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.stableswap-pool-usdh-usdcx-v-1-1",
      "pool_type": "stableswap",
      "peg_target": 1,
      "pool_price_usd": 0.999722,
      "market_price_usd": 0.999713,
      "pool_deviation_pct": -0.0278,
      "market_deviation_pct": -0.0287,
      "severity": "ok",
      "liquidity_usd": 301545.67,
      "last_trade_time": 1774648040,
      "last_trade_age_minutes": 299,
      "diagnosis": "USDH is trading within normal range (-0.028% from peg).",
      "warning": "Last trade was 299 minutes ago — pool price may be stale"
    }
  ],
  "critical_count": 0,
  "alert_count": 0,
  "warning_count": 0,
  "ok_count": 2,
  "summary": "✅ All 2 monitored stablecoin pools are within normal range."
}
```

**Error:**
```json
{ "error": "descriptive message" }
```

## Severity thresholds

| Severity | Pool deviation | Action |
|---|---|---|
| `ok` | < 0.5% from peg | Normal, no action needed |
| `warning` | 0.5% – 1.0% | Monitor closely |
| `alert` | 1.0% – 3.0% | Consider reducing exposure |
| `critical` | > 3.0% | Immediate attention, possible de-peg |

## Diagnosis types

| Diagnosis | Meaning |
|---|---|
| `trading within normal range` | Peg is healthy |
| `POOL IMBALANCE` | Pool shows deviation but market price is stable — pool-specific issue |
| `GENUINE DE-PEG` | Both pool AND CoinGecko confirm deviation — real de-peg event |
