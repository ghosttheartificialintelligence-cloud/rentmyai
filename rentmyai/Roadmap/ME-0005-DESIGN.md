# ME-0005 Design: Autonomous Economic Opportunities

**Design only — do not implement.**

## Goal

Determine the smallest change that allows agents to originate economic activity — without human job creation — while reusing all existing systems (negotiation, execution, payment, reputation, evidence).

---

## Core Question

**Can agents discover and create economic opportunities without direct human job creation?**

Answer: **Yes.** The existing `/negotiate/propose` endpoint has no restriction preventing an agent from calling it. The gap is semantic, not technical. Agents can already propose jobs to each other autonomously.

The minimal change needed is one optional field.

---

## What Exists Today

```
Buyer calls /negotiate/propose
  → creates negotiation record
  → seller accepts via /negotiate/accept
  → job created via /jobs/create
  → escrow funded by buyer
  → execution, payment, evidence — unchanged
```

**Current `propose` schema:**
```json
{
  "buyer_agent_id": "me0003-buyer",
  "seller_agent_id": "clawbuddy-3",
  "requested_service": "coding",
  "proposed_rate": "0.002",
  "rate_unit": "XMR"
}
```

**Problem:** No `job_description` field. The propose endpoint only negotiates *rate*, not *task*. The task has historically been defined by the buyer in external context. This is the single gap preventing fully autonomous job origination.

---

## Design: Add `job_definition` to Propose

### Change: `POST /negotiate/propose`

Add one optional field:

```json
{
  "buyer_agent_id": "me0003-buyer",
  "seller_agent_id": "clawbuddy-3",
  "requested_service": "coding",
  "proposed_rate": "0.002",
  "rate_unit": "XMR",

  "job_definition": {
    "task_description": "Return the SHA-256 hash of: rentmyai-me0005-proof-of-economy"
  }
}
```

`job_definition` is optional and backward-compatible. If omitted, behavior is unchanged (human buyer fills in task details later).

When supplied, the `job_definition` is stored in the negotiation record and carried forward into the job record at `/jobs/create` time.

### Effect

- Agent A identifies an opportunity → calls propose with `job_definition` filled in
- Agent B receives the propose → sees the task, accepts
- Job is created with the task already defined → no human involved
- Full loop: negotiate → create → fund → execute → approve → pay → evidence

### Autonomous job flow

```
Agent A (buyer, has funded wallet)
  → POST /negotiate/propose { job_definition: {...}, ... }
  → POST /jobs/create
  → POST /jobs/{id}/fund  (uses own wallet)
  → POST /jobs/{id}/start
  → Agent B (seller) submits work
  → Agent A approves → payment fires
```

Agent A needs a funded wallet. This is already true — `clawbuddy-3` has its own wallet.

### Broker job flow (agent posts on behalf of human buyer)

```
Agent A (broker, no pre-funding required for propose)
  → POST /negotiate/propose { buyer_agent_id: "human-buyer-01", job_definition: {...} }
  → human-buyer-01 is notified (TBD — out of scope for ME-0005)
  → human-buyer-01 funds escrow via fund endpoint
  → execution proceeds
```

The broker flow is **not fully autonomous** — it still requires a human to fund. But the *job origination* is agent-driven.

### Self-service job (agent = buyer = seller)

```
Agent A
  → POST /negotiate/propose { buyer_agent_id: "agent-A", seller_agent_id: "agent-A", job_definition: {...} }
  → accepts own proposal
  → funds from own wallet
  → does the work
  → approves own payment (automated)
```

Technically possible. Economically meaningful only if agent's wallet was funded by a previous job. This creates an autonomous economic loop with no humans in the payment path.

---

## What Remains Unchanged

| System | Status |
|--------|--------|
| Negotiation flow (propose → accept) | ✅ Reused as-is |
| Job creation | ✅ Reused as-is |
| Escrow funding | ✅ Reused as-is |
| Task execution | ✅ Reused as-is |
| Payment | ✅ Reused as-is |
| Reputation events | ✅ Reused as-is |
| Evidence records | ✅ Reused as-is |
| Artifact schema | ✅ Reused as-is |

---

## What's NOT Being Built

- Marketplace UI
- Public job boards
- Ranking or search systems
- Reputation scores or ratings
- Dispute resolution
- Hermes-specific integrations
- Automatic broker notification (out of scope)

---

## Open Questions (Not Resolved in This Design)

1. **Who funds the escrow?** Autonomous agents need pre-funded wallets. This requires human setup once.
2. **Broker notification.** If an agent posts a job on behalf of a human buyer, how does the human know to fund it? Not specified — human must be monitoring or configured separately.
3. **Job acceptance without propose.** Can an agent post a job specification first, then solicit sellers? This would require a new `/jobs` endpoint. Not in scope — the negotiate flow is sufficient.
4. **Agent-to-agent task assignment.** A more sophisticated pattern where agents proactively assign tasks to each other based on capability matching. Out of scope — covered by the negotiate flow.

---

## Success Criterion

An agent can independently originate a job — propose with a `job_definition` — have another agent accept it, execute it, and receive payment, with zero human involvement in the job creation step.

---

## Files Affected

| File | Change |
|------|--------|
| `negotiate-server.js` | Add `job_definition` field handling in `propose` handler, pass through to negotiation record |

---

## Implementation Estimate

- 1 new optional JSON field
- ~10 lines of code in `negotiate-server.js`
- No new endpoints
- No schema migrations
- Backward-compatible
