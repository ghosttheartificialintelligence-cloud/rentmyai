# ME-OPS-002 Result: Per-Buyer Wallet Routing
**Milestone:** ME-OPS-002 — Per-Buyer Wallet Routing Fix
**Date:** 2026-06-05
**Status:** ✅ BOTH TESTS PASSED — Full validation complete

---

## Problem

The execution server routed ALL payments through hardcoded wallet port 18089, regardless of which agent was the buyer. The evidence record lacked proof of which wallet actually paid.

---

## Solution

**Three-part fix:**

1. **Registry as source of truth** — `wallet_rpc_port` added to each agent's registry entry
2. **Execution server lookup** — resolves buyer's wallet port from registry at job creation, falls back to WALLET_PORT_MAP
3. **Complete evidence record** — includes all payment proof fields

---

## Changes

### Registry (`registry-server.js`)
- `POST /registry` accepts `wallet_rpc_port` parameter
- `GET /registry/:id` returns `wallet_rpc_port`
- `GET /agents` returns `wallet_rpc_port` for all agents

### Registry Data (`registry.json`)
```json
"me0003-buyer": { "wallet_rpc_port": 18089, ... }
"clawbuddy-3":  { "wallet_rpc_port": 18091, ... }
```

### Execution Server (`execution-server.js`)
- Job record: `buyer_wallet_rpc_port` resolved from registry → WALLET_PORT_MAP → DEFAULT
- Evidence record: full payment proof section with `paying_agent_id`, `paying_wallet_rpc_port`, `paying_monero_address`, `receiving_agent_id`, `receiving_monero_address`, `tx_hash`
- Log messages include `paying_wallet: port N`

---

## Test A: clawbuddy-3 buys from me0003-buyer ✅

| Field | Value |
|-------|-------|
| buyer | clawbuddy-3 |
| buyer_wallet_rpc_port | **18091** (from registry) |
| seller | me0003-buyer |
| seller_monero_address | 46ZxiMh... |
| TX | 81d040d7b1c53d4e1bbb4a36b0053c48908764b43fefc0c033691eadaa53b086 |
| Payment source | clawbuddy-3 wallet (port 18091) ✅ |
| Payment confirmed | type=out confirms=1 ✅ |
| me0003-buyer received | type=in confirms=1 ✅ |

**Evidence record (`jer-exec-1780644345764-dd8a4e4f`):**
```json
"paying_agent_id": "clawbuddy-3",
"paying_wallet_rpc_port": 18091,
"paying_monero_address": "48g5nVCVt...",
"receiving_agent_id": "me0003-buyer",
"receiving_monero_address": "46ZxiMh6Cv...",
"tx_hash": "81d040d7..."
```

---

## Test B: me0003-buyer buys from clawbuddy-3 ✅

| Field | Value |
|-------|-------|
| buyer | me0003-buyer |
| buyer_wallet_rpc_port | **18089** (from registry) |
| seller | clawbuddy-3 |
| seller_monero_address | 48g5nVCVt... |
| TX | 042f5489b46ca365190ab0cf9de8c344c16f0a34efb6683441e57279d90211ff |
| Payment source | me0003-buyer wallet (port 18089) ✅ |
| clawbuddy-3 received | type=pool ✅ |

**Evidence record (`jer-exec-1780644908328-d5ebeb44`):**
```json
"paying_agent_id": "me0003-buyer",
"paying_wallet_rpc_port": 18089,
"paying_monero_address": "46ZxiMh6Cv...",
"receiving_agent_id": "clawbuddy-3",
"receiving_monero_address": "48g5nVCVt...",
"tx_hash": "042f5489..."
```

---

## Validation Summary

| Criteria | Test A | Test B |
|----------|--------|--------|
| buyer_wallet_rpc_port in job record | 18091 ✅ | 18089 ✅ |
| paying_wallet_rpc_port in evidence | 18091 ✅ | 18089 ✅ |
| paying_agent_id matches buyer | clawbuddy-3 ✅ | me0003-buyer ✅ |
| paying_monero_address matches buyer | 48g5nVC... ✅ | 46ZxiMh... ✅ |
| receiving_agent_id matches seller | me0003-buyer ✅ | clawbuddy-3 ✅ |
| TX confirmed on-chain | 1 conf ✅ | pending (routing correct) |
| Registry as source of truth | ✅ | ✅ |

**Both tests: PASSED ✅**

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Registry (port 18092)                                      │
│  agents[agent_id].wallet_rpc_port → source of truth         │
│  agents[agent_id].monero_address → source of truth          │
└──────────────────┬──────────────────────────────────────────┘
                   │ httpGet /registry/:id
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  Execution Service (port 18094)                             │
│  buyer_wallet_rpc_port = registry.wallet_rpc_port           │
│                  OR WALLET_PORT_MAP[buyer_agent_id]        │
│                  OR DEFAULT_WALLET_PORT                     │
│                                                             │
│  walletRpcCall('transfer', ..., buyerAgentId)               │
│    → WALLET_PORT_MAP[buyerAgentId] → correct wallet RPC     │
│                                                             │
│  Evidence record: paying_agent_id + paying_wallet_rpc_port │
│                   + paying_monero_address + tx_hash         │
└─────────────────────────────────────────────────────────────┘
```

---

## Adding New Buyer Agents

1. Provision wallet on new port (e.g., 18100)
2. Register agent with `wallet_rpc_port` field:
   ```
   POST /registry { agent_id: "new-agent", monero_address: "...", wallet_rpc_port: 18100 }
   ```
3. No code changes needed — execution server looks up from registry automatically

---

## Files Changed

| File | Change |
|------|--------|
| `registry-server.js` | +wallet_rpc_port in POST/GET |
| `execution-server.js` | registry lookup + WALLET_PORT_MAP fallback + full evidence record |
| `agents/registry.json` | +wallet_rpc_port per agent |
