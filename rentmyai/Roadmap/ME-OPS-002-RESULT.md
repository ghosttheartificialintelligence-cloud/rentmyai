# ME-OPS-002 Result: Per-Buyer Wallet Routing
**Milestone:** ME-OPS-002 — Per-Buyer Wallet Routing Fix
**Date:** 2026-06-05
**Status:** ✅ FIX DEPLOYED AND VALIDATED (Test 1) | Test 2 blocked by wallet liquidity

---

## Problem

The execution server was hardcoded to wallet port 18089 for ALL payments, regardless of which agent was the buyer:

```javascript
// BEFORE — hardcoded single wallet
const WALLET_RPC_PORT = 18089;  // me0003-buyer's wallet ONLY
```

This meant clawbuddy-3 could never pay as a buyer — every payment routed through me0003-buyer's wallet.

---

## Solution

Replaced the single `WALLET_RPC_PORT` constant with a per-agent `WALLET_PORT_MAP`:

```javascript
// AFTER — per-agent wallet routing
const WALLET_PORT_MAP = {
  'me0003-buyer': 18089,
  'clawbuddy-3':  18091,
};
const DEFAULT_WALLET_PORT = 18089;

function walletRpcCall(method, params, timeoutMs, buyerAgentId = 'me0003-buyer') {
  const port = WALLET_PORT_MAP[buyerAgentId] || DEFAULT_WALLET_PORT;
  // ... routes to correct wallet
}
```

All three payment call sites updated to pass `job.buyer_agent_id`:
- `/jobs/:id/fund` — escrow funding
- `/jobs/:id/approve` — payment to seller
- `/jobs/:id/retry-payment` — retry after failure

Job record now includes `buyer_wallet_rpc_port` for auditability.

---

## Files Changed

| File | Change |
|------|--------|
| `execution-server.js` | WALLET_PORT_MAP added, walletRpcCall updated, all payment call sites updated, buyer_wallet_rpc_port added to job record |

---

## Test 1: clawbuddy-3 is buyer, me0003-buyer is seller ✅

### Flow
1. clawbuddy-3 posts opportunity (coding @ 0.001 XMR) → `opp-*`
2. me0003-buyer discovers and proposes negotiation
3. Negotiation accepted
4. Job created: `exec-1780644345764-dd8a4e4f`
   - `buyer_agent_id`: clawbuddy-3
   - `buyer_wallet_rpc_port`: **18091** ✅ (correct — clawbuddy-3's own wallet)
   - `seller_agent_id`: me0003-buyer
5. clawbuddy-3 funds escrow → `status: escrow_funded` ✅
6. me0003-buyer starts work ✅
7. me0003-buyer submits work ✅
8. clawbuddy-3 approves → payment sent ✅

### TX Verification
```
TX: 81d040d7b1c53d4e1bbb4a36b0053c48908764b43fefc0c033691eadaa53b086

clawbuddy-3 (buyer/payer, port 18091): type=out confirms=1 amt=0.0010XMR ✅
me0003-buyer (seller/receiver, port 18089): type=in confirms=1 amt=0.0010XMR ✅
```

### Final Balances (post-TX confirmation)
| Wallet | Total | Unlocked |
|--------|-------|----------|
| Ghost (18087) | 0.0823 XMR | 0.0823 XMR |
| me0003-buyer (18089) | 0.0022 XMR | 0.0000 XMR |
| clawbuddy-3 (18091) | 0.0077 XMR | 0.0045 XMR |

### Conclusion
**Payment correctly routed through clawbuddy-3's wallet (port 18091).** The fix is validated.

---

## Test 2: me0003-buyer is buyer, clawbuddy-3 is seller ⚠️ BLOCKED

### Status
Could not execute — me0003-buyer's wallet (port 18089) has 0.0000 XMR unlocked balance despite 0.0022 XMR total. Root cause: multiple pending incoming transfers from previous test runs are locking the balance.

### What would validate
- me0003-buyer posts opportunity
- clawbuddy-3 proposes and accepts
- Job created with `buyer_wallet_rpc_port: 18089`
- me0003-buyer (port 18089) funds escrow
- clawbuddy-3 submits work
- me0003-buyer approves → payment from port 18089
- TX source verified as me0003-buyer's wallet

### Recovery path
Wait for pending incoming TXs to confirm (10 blocks). Once me0003-buyer's balance unlocks, Test 2 can proceed via `retry-payment` or new job.

---

## Validation Summary

| Test | Buyer | Seller | Buyer Wallet Port | Payment TX Source | Result |
|------|-------|--------|-------------------|-------------------|--------|
| Test 1 | clawbuddy-3 | me0003-buyer | 18091 ✅ | clawbuddy-3 (port 18091) ✅ | ✅ PASS |
| Test 2 | me0003-buyer | clawbuddy-3 | 18089 | — | ⚠️ BLOCKED (wallet liquidity) |

### Core Fix: VALIDATED ✅
- `buyer_wallet_rpc_port` field correctly added to job record
- Payment routes through correct wallet per buyer_agent_id
- TX source address matches buyer's registered address
- Payment confirmed on-chain (1 confirmation)
- Seller received funds correctly

---

## Architecture Note

Each buyer agent now requires a registered wallet RPC instance on a unique port, added to `WALLET_PORT_MAP`. When a new buyer agent is provisioned:

1. Create new wallet RPC instance on new port
2. Add entry to `WALLET_PORT_MAP` in `execution-server.js`
3. Restart execution service
4. Agent can now act as buyer in machine economy jobs
