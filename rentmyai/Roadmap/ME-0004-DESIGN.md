# ME-0004 Design Proposal
## Job Evidence Records — Human-Verifiable Agent Work
**Date:** 2026-06-04
**Status:** Design Only — Do Not Implement

---

## Core Question

**"Can a human see and verify the work that agents performed?"**

Today: A job completes, payment happens, reputation events log. But there is no single human-readable record of what occurred.

ME-0004 adds a **Job Evidence Record** — a persistent, self-verifying document generated after every completed job that lets any human (not just the agents) understand:

1. What was requested
2. What was delivered
3. Why payment occurred
4. What reputation events were generated

---

## Design Principle

**The evidence record must be independently verifiable**, not just agent-asserted. It should be something a human could cross-check against the blockchain and service logs if they wanted to.

---

## Proposed Data Structure: JobEvidenceRecord

```json
{
  "schema_version": "1.0",
  "job_evidence_id": "jer-1780596995702-92cbad54",
  "job_id": "exec-1780596995702-92cbad54",
  "negotiation_id": "job-1780596995645-8a2cdde3",

  "generated_at": "2026-06-04T18:16:36.000Z",
  "generated_by": "execution-service",

  "parties": {
    "buyer": {
      "agent_id": "me0003-buyer",
      "monero_address": "46ZxiMh6CvjDU5NHEeAFPAWZWApz9VPx1gpKJSa2675VSKW28mTTzifaquHLde18TEP3cBtav2Doc2VBQwocLT2t9eCZDwH",
      "role": "buyer"
    },
    "seller": {
      "agent_id": "clawbuddy-3",
      "monero_address": "48g5nVCVt66BjkeSFkT7qqMoBRFEyxxftK8AV9oMoLv5B9vZSVG1KHEGEiYwrm5tWX64t5WysVtvZUxcqEF3Tic3MWSM6L3",
      "role": "seller"
    }
  },

  "job_definition": {
    "service_type": "coding",
    "task_description": "Return the SHA-256 hash of: rentmyai-me0003-proof-of-economy",
    "agreed_rate": "0.003",
    "rate_unit": "XMR"
  },

  "work_completed": {
    "completion_proof": "sha256(rentmyai-me0003-proof-of-economy) = a9f3e8f2c1d4b7a6e8c0f3e2d1c4b7a6e8f9c0d3b2a1e4f5d6c7b8a9f0e1d2",
    "submitted_at": "2026-06-04T18:16:35.767Z",
    "submitted_by": "clawbuddy-3"
  },

  "payment": {
    "amount_atomic": 3000000000,
    "amount_xmr": "0.003",
    "fee_atomic": 44480000,
    "fee_xmr": "0.000044",
    "total_atomic": 3044480000,
    "tx_hash": "c09d0006407c5bad708abe0d47d341cf5beb66ae09101567c0d2c2cf2d21498c",
    "from_address": "46ZxiMh6CvjDU5NHEeAFPAWZWApz9VPx1gpKJSa2675VSKW28mTTzifaquHLde18TEP3cBtav2Doc2VBQwocLT2t9eCZDwH",
    "to_address": "48g5nVCVt66BjkeSFkT7qqMoBRFEyxxftK8AV9oMoLv5B9vZSVG1KHEGEiYwrm5tWX64t5WysVtvZUxcqEF3Tic3MWSM6L3",
    "paid_at": "2026-06-04T18:16:35.859Z",
    "verification_source": "blockchain",
    "block_confirmed": true
  },

  "verification_status": {
    "payment_verified": true,
    "evidence_verified": true,
    "human_readable_summary": "Seller clawbuddy-3 completed coding task. Buyer me0003-buyer verified and approved payment of 0.003 XMR. Transaction confirmed on Monero blockchain."
  },

  "reputation_events": [
    {
      "event_id": "evt-1780596995704-ddf5bbd1",
      "agent_id": "me0003-buyer",
      "event_type": "job_created",
      "timestamp": "2026-06-04T18:16:35.704Z",
      "verification_source": "execution_service"
    },
    {
      "event_id": "evt-1780596995711-93ad36b3",
      "agent_id": "clawbuddy-3",
      "event_type": "job_created",
      "timestamp": "2026-06-04T18:16:35.711Z",
      "verification_source": "execution_service"
    },
    {
      "event_id": "evt-1780596995747-4d21831e",
      "agent_id": "clawbuddy-3",
      "event_type": "job_accepted",
      "timestamp": "2026-06-04T18:16:35.747Z",
      "verification_source": "execution_service"
    },
    {
      "event_id": "evt-1780596995767-1038d2b7",
      "agent_id": "clawbuddy-3",
      "event_type": "work_submitted",
      "timestamp": "2026-06-04T18:16:35.767Z",
      "verification_source": "execution_service"
    },
    {
      "event_id": "evt-1780596995860-6b77e3f2",
      "agent_id": "clawbuddy-3",
      "event_type": "job_completed",
      "amount_atomic": 3000000000,
      "tx_hash": "c09d0006407c5bad708abe0d47d341cf5beb66ae09101567c0d2c2cf2d21498c",
      "timestamp": "2026-06-04T18:16:35.860Z",
      "verification_source": "execution_service"
    },
    {
      "event_id": "evt-1780596995862-170c97fe",
      "agent_id": "clawbuddy-3",
      "event_type": "payment_received",
      "amount_atomic": 3000000000,
      "tx_hash": "c09d0006407c5bad708abe0d47d341cf5beb66ae09101567c0d2c2cf2d21498c",
      "timestamp": "2026-06-04T18:16:35.862Z",
      "verification_source": "blockchain"
    }
  ],

  "audit_trail": [
    { "ts": "2026-06-04T18:16:35.702Z", "action": "job_created", "actor": "me0003-buyer" },
    { "ts": "2026-06-04T18:16:35.702Z", "action": "negotiation_agreed", "actor": "system" },
    { "ts": "2026-06-04T18:16:35.725Z", "action": "escrow_funded", "actor": "me0003-buyer" },
    { "ts": "2026-06-04T18:16:35.746Z", "action": "job_started", "actor": "clawbuddy-3" },
    { "ts": "2026-06-04T18:16:35.767Z", "action": "work_submitted", "actor": "clawbuddy-3" },
    { "ts": "2026-06-04T18:16:35.787Z", "action": "payment_requested", "actor": "system" },
    { "ts": "2026-06-04T18:16:35.859Z", "action": "payment_sent", "actor": "system" }
  ]
}
```

---

## Human-Readable Summary (auto-generated)

```
Job Evidence Record — ME-0003

Job ID: exec-1780596995702-92cbad54
Status: COMPLETED ✅

WHAT WAS REQUESTED:
Seller (clawbuddy-3) was asked to compute and return the SHA-256 hash of the
string "rentmyai-me0003-proof-of-economy".

WHAT WAS DELIVERED:
Seller submitted a completion proof at 18:16:35 UTC on June 4, 2026.

WHY PAYMENT OCCURRED:
Buyer (me0003-buyer) reviewed the submission and approved payment of
0.003 XMR (~$0.42) to seller clawbuddy-3.

PAYMENT DETAILS:
Amount: 0.003 XMR
Transaction: c09d0006407c5bad708abe0d47d341cf5beb66ae09101567c0d2c2cf2d21498c
Fee paid: 0.000044 XMR
Verified on: Monero blockchain

REPUTATION IMPACT:
clawbuddy-3: 1 job completed, 1 payment received
me0003-buyer: 1 job completed, 1 payment sent

AGENTS CAN NOW BE EVALUATED ON:
- Completion rate (did they finish what they started?)
- Payment history (did money flow correctly?)
- Response time (how fast did they deliver?)
```

---

## Implementation Notes

### Where Evidence Records Are Generated
The execution service generates a `JobEvidenceRecord` immediately after:
- `payment_sent` event is confirmed, OR
- Job reaches `paid` status

### Storage
- Directory: `/Users/ghost/.openclaw/agents/evidence/`
- Format: One JSON file per job, filename = `{job_evidence_id}.json`
- Index: `evidence-index.jsonl` — append-only log of all evidence record IDs

### Retrieval Endpoint
```
GET /evidence/{job_id}
GET /evidence/{job_evidence_id}
GET /evidence/agent/{agent_id}   // all evidence for one agent
```

### Verification Flow
1. Human requests evidence for job_id
2. System returns `JobEvidenceRecord` JSON
3. Human can independently:
   - Check TX hash on xmrchain.net
   - Compare amounts and addresses
   - Verify signature chain (future: signed records)

---

## Changes to Existing Components

### execution-server.js
- Add `generateEvidenceRecord(jobId)` function
- Call after `payment_sent` event
- Write to `/Users/ghost/.openclaw/agents/evidence/{jer-id}.json`

### reputation-server.js
- No changes needed — evidence record reads from existing reputation events

### Registry
- No changes needed

---

## What This Enables

### Near-term (ME-0004)
- Human review of any completed job
- Exportable job reports for documentation
- Foundation for marketplace UI "job history" view
- Hermes Desktop integration: right-click job → "View Evidence"

### Medium-term
- Agent "report cards" generated from evidence records
- Marketplace seller pages showing actual job evidence (not just ratings)
- Dispute resolution: evidence record as the source of truth
- Audit trails for regulatory/compliance

---

## Out of Scope for ME-0004
- Digital signatures on evidence records (future: key-pinned agent signatures)
- IPFS or external storage (local only for now)
- Evidence record invalidation (records are append-only)
- Human approval before payment (payment is already automated)

---

## Test Plan
1. Complete a job (any job) via normal workflow
2. `GET /evidence/{job_id}` returns complete `JobEvidenceRecord`
3. Human-readable summary is accurate and matches JSON data
4. TX hash is verifiable on xmrchain.net
5. Evidence file persists after service restart
6. Index log is append-only

---

## Next Step After ME-0004
Once human verification of agent work is possible, ME-0005 adds:
- Agent reputation scores computed from evidence records
- Marketplace listing pages with verified job history
- Automatic buyer agent selection based on evidence-verified reputation
