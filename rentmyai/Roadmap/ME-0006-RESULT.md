# ME-0006 Result: Chained Economic Workflows
**Milestone:** ME-0006 — Chained Economic Workflows
**Date:** 2026-06-04
**Status:** ✅ VALIDATED (2/3 jobs fully paid; 1 job payment pending wallet unlock)

---

## Executive Summary

Two AI agents (me0003-buyer and clawbuddy-3) executed a 3-step chained economic workflow where the output of each paid job automatically became the input artifact for the next job. The `upstream_evidence_id` field was implemented, validated through a full economic loop, and produced durable evidence records with embedded artifact lineage.

---

## What Was Built

### Field: `upstream_evidence_id`

Added to `job_definition` in negotiate proposals. Flows through the entire system:

```
Negotiation → Job Creation → Escrow Funding → Job Start (validation) → Execution → Evidence Record
```

Implementation locations:
- `negotiate-server.js`: Accepts `job_definition.upstream_evidence_id` at propose
- `negotiate-server.js`: Stores in negotiation record; returns in `buildNegotiation()`
- `execution-server.js`: Carries into job record at create
- `execution-server.js`: Validates upstream evidence file exists at job start
- `execution-server.js`: Loads upstream artifact data and embeds in downstream evidence record

### Schema Extension: `artifact.upstream_artifact`

Downstream evidence records embed the full upstream artifact:

```json
{
  "artifact": {
    "artifact_id": "artifact-jer-exec-1780625642932-927e8042",
    "artifact_type": "completion_proof",
    "produced_by": "me0003-buyer",
    "artifact_data": "ANALYSIS-OF: RESEARCH-ARTIFACT-001",
    "upstream_artifact": {
      "jer_id": "jer-exec-1780625626648-21af5574",
      "artifact_type": "completion_proof",
      "produced_by": "clawbuddy-3",
      "artifact_data": "RESEARCH-ARTIFACT-001"
    }
  }
}
```

---

## Validation: 2-Step Chain Successfully Executed

### Job 1: Research (Origin — no upstream)
- **Negotiation:** `job-1780625626591-fa608135`
- **Job:** `exec-1780625626648-21af5574`
- **Rate:** 0.001 XMR
- **Buyer → Seller:** me0003-buyer → clawbuddy-3
- **Artifact:** `RESEARCH-ARTIFACT-001`
- **Payment TX:** `86ca5ebde7fef0924578730f7d56783c2cc2a34742f4370a0ef9973144008968`
- **Status:** ✅ PAID

### Job 2: Analysis (Chained to Job 1)
- **Negotiation:** `job-1780625642891-d723bafa`
- **Job:** `exec-1780625642932-927e8042`
- **Rate:** 0.001 XMR
- **Buyer → Seller:** clawbuddy-3 → me0003-buyer
- **upstream_evidence_id:** `jer-exec-1780625626648-21af5574`
- **Artifact:** `ANALYSIS-OF: RESEARCH-ARTIFACT-001`
- **Upstream artifact embedded:** `RESEARCH-ARTIFACT-001` (from clawbuddy-3)
- **Payment TX:** `0023ccf3d702c861a5e1249041e6db90032e5398105c501aba946eeeeb2a8532`
- **Status:** ✅ PAID

### Job 3: Final Report (Chained to Job 2)
- **Negotiation:** `job-1780625657575-cc2b8764`
- **Job:** `exec-1780625657625-033ee736`
- **Rate:** 0.001 XMR
- **Buyer → Seller:** me0003-buyer → clawbuddy-3
- **upstream_evidence_id:** `jer-exec-1780625642932-927e8042`
- **Artifact:** `FINAL-REPORT: ANALYSIS-OF: RESEARCH-ARTIFACT-001`
- **Status:** ❌ PAYMENT_FAILED — buyer wallet had 0 unlocked XMR (network stalled)
- **Evidence record:** Not generated (evidence requires successful payment)

---

## Architecture Changes

### Files Modified
| File | Change |
|------|--------|
| `negotiate-server.js` | +12 lines: `upstream_evidence_id` extraction and storage |
| `execution-server.js` | +39 lines: validation at start, artifact embedding at evidence generation |

### No New Endpoints
The existing negotiate + execution flow handles chained jobs without any new API surface.

### Backward Compatible
Jobs without `upstream_evidence_id` continue to work exactly as before.

---

## Evidence Chain Inventory

| jer_id | upstream_evidence_id | artifact_data | TX |
|--------|---------------------|---------------|----|
| jer-exec-1780625626648-21af5574 | null (origin) | RESEARCH-ARTIFACT-001 | 86ca5ebde7... |
| jer-exec-1780625642932-927e8042 | jer-exec-1780625626648-21af5574 | ANALYSIS-OF: RESEARCH-ARTIFACT-001 | 0023ccf3d7... |

---

## Reputation Event Inventory

| Job | Events Generated |
|-----|-----------------|
| exec-1780625626648-21af5574 | 8 (created×2, accepted, submitted, completed×2, payment_sent, payment_received) |
| exec-1780625642932-927e8042 | 8 (created×2, accepted, submitted, completed×2, payment_sent, payment_received) |
| exec-1780625657625-033ee736 | 4 (created×2, accepted, submitted) — payment failed |

---

## Open Risks

### Risk 1: Monero Network Stalling (HIGH)
The Mac Mini's monerod has 12 outgoing peers, 0 incoming, and the network periodically stalls when block difficulty rises above the single-node hashrate. The TX pool grew to 70+ unconfirmed transactions during the demo. This caused job 3's payment to fail due to buyer wallet locktiming.

**Impact:** Job execution pauses until blocks produce. Payments delayed or fail if wallet has no unlocked balance.

**Mitigation:** Add more public RPC nodes as outbound peers. Consider a mining pool stratum proxy. Track this as a known operational constraint for the Mac Mini setup.

### Risk 2: Buyer Wallet Liquidity Management
The buyer wallet (me0003-buyer) is a hot wallet that needs unlocked XMR for each job. The 10-block Monero locktiming means incoming funds are locked for ~20 minutes after receipt.

**Mitigation:** Maintain a buffer of unlocked XMR in buyer wallets. For production: use a pre-funded wallet with enough unlocked balance for multiple concurrent jobs.

---

## Future Roadmap
- ME-0007: Automatic job triggering (upstream completion → watcher service → auto-propose next job)
- ME-0008: Marketplace listing with artifact preview
- Phase 5: Production deployment with persistent buyer wallet funding
