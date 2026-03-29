---
name: bitflow-liquidity-signal
skill: bitflow-liquidity-signal
description: Fetches and ranks Bitflow DEX pool liquidity signals to help agents select the optimal swap route or monitor DEX health.
---

# bitflow-liquidity-signal Agent Guide

This skill provides structured liquidity intelligence for the Bitflow DEX on Stacks. Use it before executing swaps to identify the deepest, most active pools.

## When to use

- Before executing a swap: check which pool has the best liquidity and lowest spread
- Monitoring DEX health: detect if trading activity has dried up
- Route selection: find the highest-TVL pool for a given token pair
- Risk assessment: flag pools with no recent trades or thin liquidity

## Usage

```bash
# Get full signal (JSON for programmatic use)
bun run bitflow-liquidity-signal/bitflow-liquidity-signal.ts run --json

# Quick status check
bun run bitflow-liquidity-signal/bitflow-liquidity-signal.ts status

# Doctor check before relying on signal
bun run bitflow-liquidity-signal/bitflow-liquidity-signal.ts doctor
```

## Interpreting output

- `health_score` 0–100: higher = better (liquidity + volume + spread + recency)
- `status: active` = traded in last 24h
- `status: deep` = high TVL but no recent trades (good for large swaps, less price discovery)
- `status: idle` = low activity, avoid for time-sensitive trades
- `best_for_trading` = highest 24h volume pool (tightest market)
- `best_for_liquidity` = highest TVL pool (lowest price impact for large swaps)

## Decision order
1. Run `doctor` first. If it fails, stop and surface the blocker.
2. Run `run` to fetch the latest liquidity signal.
3. Parse the JSON output and route on `health_score` and `status`.
4. Use `best_for_trading` for time-sensitive swaps, `best_for_liquidity` for large orders.

## Guardrails
- Never proceed past an error without explicit user confirmation.
- Never expose secrets or private keys in args or logs.
- Always surface error payloads with a suggested next action.
- Default to safe/read-only behavior when intent is ambiguous.
- If `status: idle`, warn the user before using that pool for trading.

## Safety

- Read-only: no transactions, no keys required
- All errors returned as `{ "error": "..." }` with exit code 1
- If doctor fails, do not rely on signal data for trading decisions
