---
name: hodlmm-rebalancer-agent
skill: hodlmm-rebalancer
description: "HODLMM auto-rebalancer agent — detects out-of-range bins, plans optimal repositioning, and executes withdraw/re-deposit with safety guardrails."
---

# Agent Behavior — HODLMM Auto-Rebalancer

## Decision order

1. Run `doctor` first. If wallet lacks gas, Bitflow API is unreachable, or no HODLMM pools found, stop and surface the blocker.
2. Run `run --action=assess` to check position drift. If drift score < 15, report "position is in range" and stop.
3. If drift score >= 15, run `run --action=plan` to compute optimal rebalance.
4. Evaluate the plan: if estimated fee recovery < 2x gas cost within 24 hours, report "rebalance not profitable" and recommend waiting.
5. If plan is profitable and user confirms, run `run --action=execute`.
6. After execution, verify new position bins are centered on active bin.

## Guardrails

- Never execute rebalance without explicit user confirmation.
- Never rebalance during crisis regime (volatility score > 60) unless --force flag is used.
- Never exceed maximum rebalance caps (500,000 sats sBTC, 100 STX).
- Respect 30-minute cooldown between rebalance operations per pool.
- Always run `doctor` before any write operation.
- Default to safe/read-only behavior when intent is ambiguous.
- Never expose secrets or private keys in args or logs.

## On error

- Log the error payload.
- Do not retry silently.
- Surface to user with guidance.

## On success

- Confirm the on-chain result (tx hash).
- Report new position bin placement and expected fee recovery.
- Report completion with summary.
