# Phase 3.3 Validation Report: Rate Negotiation
**Date:** 2026-06-03
**Status:** ✅ VALIDATED
**Parent:** Level 3 — Independent Agent Wallets

---

## What Was Built

Negotiation service on port 18093. Agents propose jobs, counter rates, accept or reject, and produce final agreements — all validated against the registry.

**Files:**
- Service: `monero-wallet-provisioner/negotiate-server.js`
- Data: `/Users/ghost/.openclaw/agents/negotiations.json`
- Backups: `/Users/ghost/.openclaw/agents/negotiate-backups/`
- LaunchAgent: `~/Library/LaunchAgents/com.ghost.agent-negotiate.plist`

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/negotiate/propose` | Buyer proposes a job at a rate |
| `POST` | `/negotiate/counter` | Receiving party counters the rate |
| `POST` | `/negotiate/accept` | Accept current rate |
| `POST` | `/negotiate/reject` | Either party rejects |
| `GET` | `/negotiate/:job_id` | Get one negotiation |
| `GET` | `/negotiate` | List all negotiations |
| `GET` | `/health` | Health check |

---

## Negotiation Record Schema

```json
{
  "job_id": "job-1780505536304-e380c55a",
  "buyer_agent_id": "clawbuddy-2",
  "seller_agent_id": "clawbuddy-3",
  "seller_monero_address": "48g5nVCVt66BjkeSFkT7qqMoBRFEyxxftK8AV9oMoLv5B9vZSVG1KHEGEiYwrm5tWX64t5WysVtvZUxcqEF3Tic3MWSM6L3",
  "requested_service": "coding",
  "job_description": "Write a Python script to parse JSON logs and output summary stats",
  "proposed_rate": 0.003,
  "counter_rate": 0.005,
  "final_rate": 0.005,
  "rate_unit": "XMR",
  "status": "accepted",
  "created_at": "2026-06-03T16:52:16.304Z",
  "updated_at": "2026-06-03T16:52:21.752Z"
}
```

---

## Status State Machine

```
proposed ──seller counters──→ countered ──buyer accepts──→ accepted
    │                              │
    └──seller accepts──→ accepted  └──buyer rejects──→ rejected
    │
    └──buyer|seller rejects──→ rejected
    │
    └──timeout──→ expired (Phase 4)
```

**Status rules:**
- `proposed`: Buyer proposed a rate. Only seller can counter or accept.
- `countered`: Seller countered with a different rate. Only buyer can counter back or accept.
- `accepted`: Agreement reached. `final_rate` set. Immutable.
- `rejected`: Either party rejected. Immutable.
- `expired`: Not implemented in Phase 3.3 — deferred to Phase 4.

---

## Validation Tests

| # | Test | Result |
|---|------|--------|
| 1 | Buyer proposes job to seller | ✅ Pass |
| 2 | Seller counters at higher rate | ✅ Pass |
| 3 | Buyer accepts counter → final_rate set | ✅ Pass |
| 4 | Get negotiation by job_id | ✅ Pass |
| 5 | Reject non-existent negotiation → 404 | ✅ Pass |
| 6 | Wrong party accepts (buyer can't accept proposed rate) | ✅ Pass |
| 7 | Reject accepted negotiation → 409 | ✅ Pass |
| 8 | Propose with non-registry buyer → 404 | ✅ Pass |
| 9 | Propose with non-registry seller → 404 | ✅ Pass |
| 10 | Propose service not offered → 409 | ✅ Pass |
| 11 | Counter from wrong party → 403 | ✅ Pass |
| 12 | Seller accepts proposed rate directly | ✅ Pass |
| 13 | List all negotiations | ✅ Pass |
| 14 | Seller rejects with reason | ✅ Pass |
| 15 | Backups created before each write | ✅ Pass |

---

## Protection Rules Enforced

| Rule | Enforcement |
|------|-------------|
| Both agents must be registered | Checked against registry (port 18092) on propose |
| Seller must offer requested service | `services_offered` array checked at propose |
| Seller address attached at agreement time | Pulled from registry at propose, stored in record |
| Only addressed party can accept at each stage | Enforced by agent_id check per status |
| Only party to negotiation can reject | Enforced by buyer/seller check |
| Immutable after accept/reject | Status guard prevents mutation |

---

## Validation Goal — Met

**clawbuddy-2 → clawbuddy-3 negotiation:**

1. clawbuddy-2 **proposes** coding job @ 0.003 XMR → status: `proposed`
2. clawbuddy-3 **counters** @ 0.005 XMR → status: `countered`
3. clawbuddy-2 **accepts** counter @ 0.005 XMR → status: `accepted`, `final_rate: 0.005`

**Final stored agreement contains:**
- `job_id`: `job-1780505536304-e380c55a`
- `buyer_agent_id`: `clawbuddy-2`
- `seller_agent_id`: `clawbuddy-3`
- `seller_monero_address`: `48g5nVCVt66BjkeSFkT7qqMoBRFEyxxftK8AV9oMoLv5B9vZSVG1KHEGEiYwrm5tWX64t5WysVtvZUxcqEF3Tic3MWSM6L3`
- `requested_service`: `coding`
- `final_rate`: `0.005`
- `rate_unit`: `XMR`
- `status`: `accepted`

---

## What's Missing (Phase 4)

- No escrow / payment execution — this is intentional (Phase 3.3 is negotiation only)
- No expiration / timeout on negotiations
- No signed challenges (Phase 4 adds cryptographic proof)
- No multi-round counter limits

---

## Infrastructure Now Running

| Port | Service |
|------|---------|
| 18081 | monerod |
| 18087 | ghost_final2 wallet RPC |
| 18089 | clawbuddy wallet RPC |
| 18090 | Wallet provisioning service |
| 18091 | Provisioning wallet RPC |
| 18092 | Agent registry |
| 18093 | Negotiation service |

---

*Validation complete. Phase 3.3 complete.*
