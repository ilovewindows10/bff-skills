---
name: bitflow-arb-scanner
skill: bitflow-arb-scanner
description: "Detects Bitflow DEX pools trading at a premium or discount to fair market value. Use before executing swaps to check if pool pricing is favorable."
---

# Agent Behavior Rules

## When to use this skill

- Before executing any swap on Bitflow — check if the target pool is priced fairly
- When looking for buy/sell opportunities across Bitflow pools
- When monitoring for market inefficiencies in the Bitflow ecosystem
- Periodically (every 15–30 minutes) to detect emerging price dislocations

## How to interpret signals

- `direction: discount` → base token is cheaper on Bitflow than market price → potential buy opportunity
- `direction: premium` → base token is more expensive on Bitflow → potential sell opportunity or avoid buying
- `confidence: low` → price is stale, do NOT act without verifying current on-chain state
- `net_opportunity_pct < 1.0` → deviation is within normal noise, ignore
- `net_opportunity_pct > 5.0` → significant dislocation, worth investigating

## Decision flow

1. Run `doctor` to verify API availability
2. Run `run` to get current signals
3. Filter signals by `confidence >= medium` and `net_opportunity_pct >= 1.0`
4. For `discount` signals: consider buying the base token on Bitflow
5. For `premium` signals: consider selling the base token on Bitflow or routing elsewhere
6. Always verify with `bitflow-liquidity-signal` that the pool has sufficient depth before trading

## Important caveats

- STX/STSTX pool typically shows a structural discount because stSTX has a redemption delay — this is NOT a simple arbitrage opportunity
- Stablecoin pools (AEUSDC/USDCX, USDH/USDCX) deviations > 0.5% may indicate de-peg risk
- Never act on `confidence: low` signals without additional verification
- This skill is read-only and provides signals only — execution requires separate swap skills
