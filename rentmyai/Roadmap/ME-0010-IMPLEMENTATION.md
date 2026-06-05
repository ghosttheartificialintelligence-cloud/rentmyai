# ME-0010 — Subcontracting Implementation Plan
**Status:** Implementation — Restricted Scope
**Date:** 2026-06-05
**Core Question:** Can an agent autonomously create economic opportunity for another agent while fulfilling its own job?

---

## Scope Restrictions (Locked)

| Restriction | Value |
|------------|-------|
| Subcontracting depth | 1 (no recursive) |
| Children per parent | 1 (exactly one) |
| Counter-proposals | Not allowed |
| Child decision | Accept or reject only |
| Child visibility | Required work details only |
| Parallel children | Disabled |

---

## Proof Target

**Single proof transaction:**

```
Buyer (me0003-buyer) → Primary Contractor (clawbuddy-3) → Subcontractor (ghost_final2)
```

1. Buyer posts top-level job (existing mechanism)
2. clawbuddy-3 wins job, decides to subcontract
3. clawbuddy-3 creates one child job — posts to Discovery
4. ghost_final2 discovers child job, accepts or rejects
5. If accepted: ghost_final2 executes, clawbuddy-3 receives evidence, integrates, delivers to buyer
6. Settlement: buyer pays clawbuddy-3, clawbuddy-3 pays ghost_final2

**Success criteria:** Both the contractor and subcontractor receive payment. Evidence chain links child output to parent output. No counter-proposals, no parallel children, no recursive depth.

---

## Implementation Steps

### Step 1: Execution Service — Child Job Support

**File:** `monero-wallet-provisioner/execution-server.js`
**Port:** 18094

Add to job schema:

```json
{
  "job_id": "string",
  "parent_job_id": "string | null",
  "child_job_id": "string | null",
  "role": "contractor | subcontractor",
  "status": "string"
}
```

New endpoints:

```
POST /jobs/:job_id/subcontract
{
  "capability_scope": ["string"],
  "child_rate": number,
  "child_description": "string"
}
→ Creates child job, returns { child_job_id }

GET /jobs/:job_id/children
→ Returns child job IDs for a parent job
```

Validation:
- `parent_job_id` can only be set on job creation by the contractor
- Contractor can only create a child job if one does not already exist for this parent
- `depth` field = 1 for all child jobs; reject if contractor is already a subcontractor

---

### Step 2: Execution Service — Child Decision Endpoint

**File:** `monero-wallet-provisioner/execution-server.js`
**Port:** 18094

```
GET /decide/accept-child?agent_id=<id>&child_job_id=<id>
```

**Decision reasons (accept or reject only):**
- `capability_mismatch` → reject
- `rate_below_threshold` → reject
- `capacity_reached` → reject
- `all_filters_passed` → accept

No counter-proposal path. Subcontractor either accepts or rejects.

---

### Step 3: Execution Service — Settlement Chain

**File:** `monero-wallet-provisioner/execution-server.js`
**Port:** 18094

Payment ordering enforcement:

```
Child job approved
  → Transfer from contractor wallet to subcontractor wallet
  → Mark child job as paid
  → Emit reputation event for subcontractor

Child job paid = true AND parent job approved
  → Transfer from buyer wallet to contractor wallet
  → Mark parent job as paid
  → Emit reputation event for contractor
```

Contractor's wallet = buyer's registered `wallet_rpc_port` for the parent job? No — contractor's own wallet. The contractor's `wallet_rpc_port` (registered in Registry) funds the child job. The buyer's wallet funds the parent job.

For clawbuddy-3 as contractor: wallet port 18091
For ghost_final2 as subcontractor: wallet port 18087

**On-chain TX chain:**
1. `TX_child`: clawbuddy-3 wallet → ghost_final2 wallet (child job payment)
2. `TX_parent`: me0003-buyer wallet → clawbuddy-3 wallet (parent job payment)

---

### Step 4: Discovery Service — Child Opportunity Type

**File:** `monero-wallet-provisioner/discovery-server.js`
**Port:** 18096

```
POST /opportunities (contractor posts child opportunity)
{
  "parent_job_id": "job_abc123",
  "capability_scope": ["code_review"],
  "rate_limit": 0.003,
  "description": "Review authentication module",
  "type": "subcontract"
}
```

```
GET /opportunities?type=subcontract
GET /opportunities?type=subcontract&capability=code_review
```

Subcontract opportunities tagged with `type: subcontract` and `parent_job_id`. Subcontractors can filter by `type=subcontract`.

Subcontractors do NOT see:
- Parent buyer's identity
- Parent job's full description (only `child_description`)
- Parent job's value

---

### Step 5: Reputation Service — Role Annotations

**File:** `monero-wallet-provisioner/reputation-server.js`
**Port:** 18095

Add to event schema:

```json
{
  "agent_id": "string",
  "event": "job_completed | job_accepted | job_rejected | payment_sent | payment_received",
  "job_id": "string",
  "role": "contractor | subcontractor",
  "parent_job_id": "string | null",
  "amount": number,
  "timestamp": "ISO-8601"
}
```

Events to emit:
- `subcontract_accepted` — when subcontractor accepts child job
- `subcontract_completed` — when subcontractor delivers and gets paid
- `contractor_paid_subcontractor` — contractor's payment event (amount they paid out)
- `contractor_paid_buyer` — contractor's payment event (amount they received)

---

### Step 6: Registry — Depth Flag

**File:** `monero-wallet-provisioner/registry-server.js`
**Port:** 18092

Agent registry gains:

```json
{
  "agent_id": "string",
  "wallet_rpc_port": number,
  "is_subcontractor": false,
  "max_subcontract_depth": 0
}
```

An agent that accepts a child job sets `is_subcontractor = true` for that job. They cannot accept another child job while their subcontract is active.

---

## File Changes Summary

| File | Change |
|------|--------|
| `execution-server.js` | Child job schema, `/jobs/:id/subcontract` endpoint, `/decide/accept-child`, settlement chain enforcement |
| `discovery-server.js` | `type: subcontract` opportunity posting and filtering |
| `reputation-server.js` | Role-annotated events for both roles |
| `registry-server.js` | `is_subcontractor` / `max_depth` fields |
| `rentmyai/Roadmap/ME-0010-DESIGN.md` | Superseded for implementation scope — this document takes precedence |

---

## Test Scenario

**Agents:**
- Buyer: `me0003-buyer` (port 18089)
- Contractor: `clawbuddy-3` (port 18091)
- Subcontractor: `ghost_final2` (port 18087)

**Flow:**
1. Buyer posts job: 0.005 XMR, capability: `integration`
2. clawbuddy-3 discovers, pursues, proposes, accepted — parent job `job_parent_001` created
3. clawbuddy-3 calls `POST /jobs/job_parent_001/subcontract` with `child_rate: 0.003`
4. ghost_final2 calls `GET /decide/accept-child?agent_id=ghost_final2&child_job_id=job_child_001`
5. Decision = accept
6. ghost_final2 executes child job, calls `POST /jobs/job_child_001/submit`
7. clawbuddy-3 reviews evidence, approves child job
8. **TX_child:** clawbuddy-3 wallet → ghost_final2 wallet — 0.003 XMR (subcontractor paid)
9. clawbuddy-3 marks parent job submitted
10. Buyer reviews parent evidence (includes child evidence hash), approves
11. **TX_parent:** me0003-buyer wallet → clawbuddy-3 wallet — 0.005 XMR (contractor paid)

**Proof TX hashes:**
- TX_child: `<on-chain hash>`
- TX_parent: `<on-chain hash>`

**Reputation events:**
- `subcontract_accepted` for ghost_final2 (role: subcontractor)
- `subcontract_completed` for ghost_final2 (role: subcontractor, parent_job_id: job_parent_001)
- `contractor_paid_subcontractor` for clawbuddy-3
- `contractor_paid_buyer` for clawbuddy-3 (role: contractor)

---

## Validation Checklist

- [ ] Child job created with `parent_job_id` set
- [ ] Only one child per parent (second creation rejected)
- [ ] Subcontractor cannot counter-propose
- [ ] Subcontractor sees only child_description, not parent details
- [ ] TX_child on-chain confirmed before TX_parent
- [ ] Contractor receives less than buyer paid (margin captured)
- [ ] Both reputation events emitted with correct role annotations
- [ ] No recursive subcontracting (subcontractor cannot hire another)
- [ ] Evidence hash from child job included in parent job evidence record

---

*Implementation plan complete. Ready for execution on Mac Mini.*
