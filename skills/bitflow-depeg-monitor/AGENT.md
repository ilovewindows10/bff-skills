---
name: bitflow-depeg-monitor
skill: bitflow-depeg-monitor
description: "Monitors Bitflow stablecoin pools for de-peg events. Run before any stablecoin swap or when managing stablecoin LP positions on Bitflow."
---

# Agent Behavior Rules

## When to use this skill

- Before executing any stablecoin swap on Bitflow (AEUSDC, USDCX, USDH, USDA)
- When managing LP positions in Bitflow stablecoin pools
- As a periodic health check (every 15–30 minutes) during active stablecoin operations
- Immediately when other signals suggest market stress or stablecoin volatility

## How to interpret severity

- `ok` → All clear, proceed normally
- `warning` → Minor deviation, monitor but proceed with caution
- `alert` → Significant deviation, reduce new exposure, consider partial withdrawal
- `critical` → Possible de-peg event, halt stablecoin operations, alert user immediately

## How to interpret diagnosis

- `trading within normal range` → Peg is healthy, no action needed
- `POOL IMBALANCE` → Deviation is pool-specific (CoinGecko is stable). May indicate arbitrage opportunity or temporary imbalance. Do NOT treat as systemic de-peg.
- `GENUINE DE-PEG` → Both pool AND market confirm deviation. This is a real de-peg event. Halt operations and alert user.

## Decision order

1. Run `doctor` first. If it fails, stop and surface the blocker.
2. Run `run --min-severity warning` to get actionable signals.
3. If `critical_count > 0` AND diagnosis is `GENUINE DE-PEG` → halt all stablecoin ops, alert user immediately.
4. If `critical_count > 0` AND diagnosis is `POOL IMBALANCE` → avoid that specific pool only.
5. If `alert_count > 0` → reduce new stablecoin exposure, monitor every 5 minutes.
6. If `warning_count > 0` → proceed with caution, recheck before large trades.
7. If all `ok` → proceed normally.

## Guardrails

- Never proceed past an error without explicit user confirmation.
- Never expose secrets or private keys in args or logs.
- Always surface error payloads with a suggested next action.
- Default to safe/read-only behavior when intent is ambiguous.
- Stale pools (>120 min since trade) may show false deviations — check `warning` field.
- Small deviations (< 0.1%) in stablecoin pools are normal — do not alert on these.

## Important caveats

- Stale pools (last_trade_age_minutes > 120) may show false deviations — check the `warning` field
- AEUSDC/USDCX/USDH pools are stablecoin-to-stablecoin — small deviations (< 0.1%) are normal
- This skill is read-only — it cannot withdraw liquidity or cancel swaps. Pair with execution skills for automated response.
- CoinGecko free tier may occasionally be slow — if `coingecko_reachable: false` in doctor, market_price_usd will be null and diagnosis will be less precise
