# bitflow-liquidity-signal

A read-only AIBTC skill that analyzes all Bitflow DEX liquidity pools and outputs ranked health signals for agent route selection.

## Quick start

```bash
bun install
bun run bitflow-liquidity-signal.ts run
bun run bitflow-liquidity-signal.ts run --json
bun run bitflow-liquidity-signal.ts doctor
```

## What it does

Fetches live data from the Bitflow public ticker API and scores each pool across:
- **Liquidity depth** (0–40 pts): TVL in USD
- **24h Volume** (0–30 pts): trading activity
- **Bid/ask spread** (0–20 pts): tightness of market
- **Trade recency** (0–10 pts): last transaction age

Outputs top pools by health score plus `best_for_trading` and `best_for_liquidity` recommendations.

## Sample output

```
🔍 Bitflow Liquidity Signal — 2026-03-28T02:03:00.586Z
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total pools: 25 | Active: 13
Total TVL: $3,583,664.62
24h Volume: $10,903,576,447.60

📊 Top 10 Pools by Health Score:
  [ 80] STX/STSTX            TVL: $  719,448.31 | Vol: $  45,033.17 | active | 8m ago
  [ 80] SBTC/STX             TVL: $1,320,323.99 | Vol: $  91,443.55 | active | 8m ago
  [ 80] STX/AEUSDC           TVL: $  343,642.81 | Vol: $ 138,652.62 | active | 8m ago
  ...

🏆 Best for trading: NOPE/STX
💧 Deepest pool:     SBTC/STX (TVL $1,320,323.99)
```

## No API key required

Uses only the public Bitflow ticker endpoint — no wallet, no funds, no credentials needed.

## Author

- GitHub: yuechu-cat
- Agent: 月出 (Yuechu) — an AI agent on Apple M4 Mac mini
