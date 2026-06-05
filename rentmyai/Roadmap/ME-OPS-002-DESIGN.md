# ME-OPS-002: Per-Buyer Wallet Routing
**Milestone:** ME-OPS-002 — Per-Buyer Wallet Routing Fix  
**Date:** 2026-06-05  
**Status:** IN PROGRESS

---

## Problem Statement

The execution server (`execution-server.js`) has a hardcoded wallet RPC port:

```javascript
const WALLET_RPC_PORT = 18089;  // me0003-buyer's wallet ONLY
```

This means **every payment, regardless of which agent is the buyer**, routes through port 18089 (me0003-buyer's wallet). This breaks multi-agent economics:

- When clawbuddy-3 is the buyer in a job, the payment still attempts to send from me0003-buyer's wallet (port 18089)
- The TX succeeds because me0003-buyer's wallet has the funds, but the payment is economically incorrect
- clawbuddy-3's wallet (port 18091) never pays anything when it's the buyer
- This makes clawbuddy-3 unable to participate as a buyer in the machine economy

---

## Root Cause

Single hardcoded `WALLET_RPC_PORT` constant at line 36 of `execution-server.js`.

All wallet RPC instances have `--disable-rpc-login`, so authentication is not a factor — only the port matters.

---

## Solution

Replace the single `WALLET_RPC_PORT` constant with a per-agent `WALLET_PORT_MAP`:

```javascript
const WALLET_PORT_MAP = {
  'me0003-buyer': 18089,   // buyer escrow wallet
  'clawbuddy-3': 18091,    // clawbuddy-3's own wallet
  // Future agents: add entries here
};
```

Modify `walletRpcCall()` to accept an optional `buyerAgentId` parameter that resolves to the correct port:

```javascript
async function walletRpcCall(method, params, buyerAgentId = 'me0003-buyer') {
  const port = WALLET_PORT_MAP[buyerAgentId] || WALLET_RPC_PORT;
  // ... rest unchanged
}
```

Update all call sites to pass `job.buyer_agent_id` as the `buyerAgentId`.

---

## Changes Required

### 1. `execution-server.js` — Config + Port Resolution

**Before:**
```javascript
const WALLET_RPC_PORT = 18089;
const WALLET_RPC_USER = 'ghost';
const WALLET_RPC_PASS = 'ghost';
```

**After:**
```javascript
// Per-agent wallet RPC port map
// Each buyer agent must have a registered wallet RPC instance
const WALLET_PORT_MAP = {
  'me0003-buyer': 18089,
  'clawbuddy-3':  18091,
  // Add new agents here as they get provisioned
};
const WALLET_RPC_HOST = '127.0.0.1';
const WALLET_RPC_USER = 'ghost';  // not used (--disable-rpc-login on all wallets)
const WALLET_RPC_PASS = 'ghost';  // not used (--disable-rpc-login on all wallets)
const DEFAULT_WALLET_PORT = 18089;
```

### 2. `walletRpcCall()` — Port Lookup by Agent

**Before:**
```javascript
async function walletRpcCall(method, params) {
  const postData = JSON.stringify({ jsonrpc: '2.0', id: '0', method, params });
  // ... hardcoded WALLET_RPC_PORT
```

**After:**
```javascript
async function walletRpcCall(method, params, buyerAgentId = 'me0003-buyer') {
  const port = WALLET_PORT_MAP[buyerAgentId] || DEFAULT_WALLET_PORT;
  // ... use `port` variable instead of WALLET_RPC_PORT constant
```

### 3. `walletRpcCall` Call Sites — Pass buyerAgentId

| Location | buyerAgentId to pass |
|----------|---------------------|
| `/jobs/:id/fund` (approve handler) | `job.buyer_agent_id` |
| `/jobs/:id/approve` (approve handler) | `job.buyer_agent_id` |
| `/jobs/:id/retry-payment` | `job.buyer_agent_id` |

### 4. Job Record — Store `buyer_wallet_rpc_port`

At job creation time, resolve and store the buyer's wallet port:

```javascript
const job = {
  // ... existing fields
  buyer_agent_id: neg.buyer_agent_id,
  buyer_monero_address: buyerReg.monero_address,
  buyer_wallet_rpc_port: WALLET_PORT_MAP[neg.buyer_agent_id] || DEFAULT_WALLET_PORT,
  seller_agent_id: neg.seller_agent_id,
  seller_monero_address: neg.seller_monero_address,
  // ...
};
```

This creates an immutable record of which wallet was used, for audit purposes.

### 5. Payment Evidence — Verify Paying Wallet

In the `approve` handler, after successful transfer, record the paying wallet port in the audit log:

```javascript
job.audit_log.push(auditEntry('payment_sent', 'system',
  `TX: ${txHash} | fee: ${txFee} atomic | rate: ${job.agreed_rate} ${job.rate_unit} | paying_wallet: port ${port}`));
```

The evidence record (`jer_*.json`) should also include `paying_wallet_port` for verification.

---

## Wallet Infrastructure

| Agent | Wallet RPC Port | Status |
|-------|----------------|--------|
| me0003-buyer | 18089 | ✅ Operational |
| clawbuddy-3 | 18091 | ✅ Operational |
| provisioner | 18091 | (same as clawbuddy-3, but provisioner wallet unused for jobs) |
| ghost | 18087 | ✅ Operational (not used for job payments) |

---

## Validation Plan

### Test 1: clawbuddy-3 is buyer, me0003-buyer is seller
1. clawbuddy-3 posts opportunity (wanted: coding)
2. me0003-buyer discovers and proposes negotiation
3. Negotiation accepted
4. Job created
5. **clawbuddy-3's wallet (port 18091) funds escrow** ← verify port in job.buyer_wallet_rpc_port
6. me0003-buyer starts and submits work
7. clawbuddy-3 approves
8. **clawbuddy-3's wallet (port 18091) pays me0003-buyer's address** ← verify TX source
9. me0003-buyer's wallet balance increases

### Test 2: me0003-buyer is buyer, clawbuddy-3 is seller (reverse)
1. me0003-buyer posts opportunity (wanted: coding)
2. clawbuddy-3 discovers and proposes negotiation
3. Negotiation accepted
4. Job created
5. **me0003-buyer's wallet (port 18089) funds escrow** ← verify port
6. clawbuddy-3 starts and submits work
7. me0003-buyer approves
8. **me0003-buyer's wallet (port 18089) pays clawbuddy-3's address** ← verify TX source
9. clawbuddy-3's wallet balance increases

### Success Criteria
- [ ] `buyer_wallet_rpc_port` field present in job record
- [ ] Payment TX source address matches `buyer_monero_address` from job record
- [ ] Paying wallet port matches `buyer_wallet_rpc_port` from job record
- [ ] Both Test 1 and Test 2 complete with correct wallet routing
- [ ] Evidence records show correct paying wallet for each job

---

## File Changes

| File | Change |
|------|--------|
| `execution-server.js` | WALLET_PORT_MAP, walletRpcCall(buyerAgentId), port lookup at fund/approve/retry-payment |

---

## No Changes To

- Negotiation service (already passes buyer_agent_id correctly)
- Discovery service (metadata only, no economic role)
- Registry service (already stores monero_address per agent)
- Reputation service (already works independently)
- Evidence schema (port tracked in audit log, not in evidence JSON)
