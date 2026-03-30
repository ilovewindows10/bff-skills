---
name: zest-hodlmm-collateral-optimizer
description: "Monitors a Zest Protocol borrowing position's health factor and cross-references active Bitflow HODLMM LP yield to signal when to top up collateral or exit LP bins before liquidation risk."
metadata:
  author: "ilovewindows10"
  author-agent: "Thin Teal"
  user-invocable: "false"
  arguments: "doctor | status | run"
  entry: "zest-hodlmm-collateral-optimizer/zest-hodlmm-collateral-optimizer.ts"
  requires: "wallet, read-only"
  tags: "defi, read-only, l2, mainnet-only, infrastructure"
---

# Zest HODLMM Collateral Optimizer

## What it does

This skill monitors a wallet's Zest Protocol borrowing position (sBTC collateral) and simultaneously reads its active Bitflow HODLMM LP position. It computes a real-time health factor from live on-chain data and emits one of three actionable signals: **hold** (health is safe), **top_up** (collateral is thinning — redirect HODLMM LP proceeds), or **emergency_exit** (health is critical — exit LP bins immediately to avoid liquidation).

## Why agents need it

Agents managing both Zest borrowing positions and Bitflow HODLMM LP positions face a silent risk: HODLMM fees compound while sBTC collateral value erodes during drawdowns. Without a cross-protocol health monitor, an agent cannot act before the liquidation threshold is breached. This skill closes that gap — it gives the agent a single read-only signal to decide whether capital should stay in LP or move to protect the borrow position.

## Safety notes

- **This skill is read-only. It does NOT submit any transactions.**
- It does NOT move funds, modify positions, or interact with any contract write functions.
- All outputs are signals only — execution is left to the operator or a downstream write skill.
- Mainnet only: Zest V2 contracts and Bitflow HODLMM are only deployed on Stacks mainnet.
- Health factor calculation uses a 70% LTV (verified from Zest V2 `get-reserve-state` `base-ltv-as-collateral = 70000000`).
- `--critical-hf` must be ≥ 1.05 to prevent dangerously close thresholds to liquidation (1.0).
- `--critical-hf` must always be less than `--safe-hf`.

## Commands

### doctor
Checks all external dependencies: Zest contract reachability, Bitflow HODLMM API, Hiro API. Safe to run anytime.
```bash
bun run zest-hodlmm-collateral-optimizer/zest-hodlmm-collateral-optimizer.ts doctor
```

### status
Read-only snapshot of the wallet's Zest position and HODLMM LP state.
```bash
bun run zest-hodlmm-collateral-optimizer/zest-hodlmm-collateral-optimizer.ts status --wallet SP1ABC...XYZ
bun run zest-hodlmm-collateral-optimizer/zest-hodlmm-collateral-optimizer.ts status --wallet SP1ABC...XYZ --pool-id dlmm_1
```

### run
Computes the full cross-protocol collateral optimization signal.
```bash
bun run zest-hodlmm-collateral-optimizer/zest-hodlmm-collateral-optimizer.ts run --wallet SP1ABC...XYZ
bun run zest-hodlmm-collateral-optimizer/zest-hodlmm-collateral-optimizer.ts run --wallet SP1ABC...XYZ --pool-id dlmm_1 --safe-hf 1.5 --critical-hf 1.1
```

## Output contract

All outputs are JSON to stdout.

### doctor — success
```json
{
  "status": "success",
  "action": "doctor",
  "data": {
    "checks": {
      "zest_contract": "ok",
      "bitflow_hodlmm_api": "ok",
      "hiro_api": "ok"
    },
    "ready": true,
    "contracts": {
      "POOL_BORROW": "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-borrow-v2-3",
      "ZSBTC": "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zsbtc-v2-0",
      "SBTC_TOKEN": "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token"
    },
    "safetyDefaults": {
      "safeHealthFactor": 1.5,
      "criticalHealthFactor": 1.1,
      "maxGasStx": 50,
      "cooldownHours": 4
    }
  },
  "error": null
}
```

### status — live mainnet output (SP2CCCQP1WN3FG67K3V4S85JG9SRZN2KKRJ3M3GNG)
```json
{
  "status": "success",
  "action": "status",
  "data": {
    "wallet": "SP2CCCQP1WN3FG67K3V4S85JG9SRZN2KKRJ3M3GNG",
    "zest": {
      "supplied_sats": 273001954,
      "borrowed_sats": 0,
      "health_factor": 999,
      "collateral_usd": 232051.66,
      "borrowed_usd": 0
    },
    "hodlmm": {
      "pool_id": "dlmm_1",
      "active_bins": 3,
      "estimated_position_usd": 310.5,
      "estimated_daily_fees_usd": 0.85,
      "apr_24h_pct": 12.4
    }
  },
  "error": null
}
```

### run — hold signal (live mainnet output)
```json
{
  "status": "success",
  "action": "run",
  "data": {
    "wallet": "SP1ABC...XYZ",
    "signal": {
      "action": "hold",
      "reason": "Health factor 1.700 is above safe threshold 1.5. No action needed.",
      "health_factor": 1.7,
      "safe_threshold": 1.5,
      "critical_threshold": 1.1,
      "suggested_top_up_sats": 0,
      "hodlmm_available_usd": 310.5
    },
    "safety": {
      "max_gas_stx": 50,
      "cooldown_hours": 4,
      "this_skill_does_not_write_to_chain": true
    }
  },
  "error": null
}
```

### run — top_up signal
```json
{
  "status": "success",
  "action": "run",
  "data": {
    "signal": {
      "action": "top_up",
      "reason": "Health factor 1.350 below safe threshold 1.5. Top up 18500 sats (~$15.73) from HODLMM LP proceeds.",
      "health_factor": 1.35,
      "safe_threshold": 1.5,
      "critical_threshold": 1.1,
      "suggested_top_up_sats": 18500,
      "hodlmm_available_usd": 310.5
    }
  },
  "error": null
}
```

### run — emergency_exit signal
```json
{
  "status": "success",
  "action": "run",
  "data": {
    "signal": {
      "action": "emergency_exit",
      "reason": "CRITICAL: Health factor 1.080 below 1.1. Exit HODLMM LP immediately to free 42.30 USD collateral.",
      "health_factor": 1.08,
      "safe_threshold": 1.5,
      "critical_threshold": 1.1,
      "suggested_top_up_sats": 49765,
      "hodlmm_available_usd": 310.5
    }
  },
  "error": null
}
```

### error
```json
{ "error": "descriptive message" }
```

### blocked
```json
{
  "status": "blocked",
  "action": "provide --wallet",
  "data": {},
  "error": {
    "code": "NO_WALLET",
    "message": "--wallet <STX_ADDRESS> is required for status",
    "next": "provide --wallet"
  }
}
```

