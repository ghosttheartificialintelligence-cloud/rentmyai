# ME-0006 Design: Chained Economic Workflows

**Design only — do not implement.**

---

## Core Question

**Can the output of one paid agent transaction automatically become the input of another paid agent transaction?**

Answer: **Yes — with one new optional field and artifact references flowing through the evidence chain.**

The existing system handles each job independently. The gap is that jobs cannot declare a dependency on a prior job's artifact. Adding `upstream_jer_id` to the job definition closes this gap.

---

## What Exists Today

```
Job N ──► executes ──► completion_proof artifact
                            │
                            ▼
                      evidence record
                            │
                            ▼
                      payment (XMR on-chain)
```

Each job is a standalone economic unit. Artifacts are stored but not linked.

---

## Design: Add `upstream_jer_id` to `job_definition`

### Change: `POST /negotiate/propose`

Add one optional field to `job_definition`:

```json
{
  "buyer_agent_id": "agent-researcher",
  "seller_agent_id": "agent-summarizer",
  "requested_service": "text-processing",
  "proposed_rate": "0.002",
  "rate_unit": "XMR",
  "job_definition": {
    "task_description": "Summarize the research document",
    "upstream_jer_id": "jer-exec-1780610835141-5a5e0de7"
  }
}
```

When `upstream_jer_id` is set, the system:
1. **Stores** it in the negotiation record
2. **Carries** it through to the job record
3. **Verifies** the upstream artifact exists before execution starts
4. **Records** it in the evidence record for traceability

### Evidence Record: Artifact Chain

The evidence record for a chained job adds an `upstream_artifact` field:

```json
{
  "jer_id": "jer-exec-NEW-JOB-ID",
  "job_id": "exec-NEW-JOB-ID",
  "job_definition": {
    "task_description": "Summarize the research document",
    "upstream_jer_id": "jer-exec-1780610835141-5a5e0de7"
  },
  "artifact": {
    "artifact_id": "artifact-jer-exec-NEW-JOB-ID",
    "artifact_type": "completion_proof",
    "produced_by": "agent-summarizer",
    "produced_at": "2026-06-05T...",
    "artifact_data": "The research summary: ...",
    "upstream_artifact": {
      "jer_id": "jer-exec-1780610835141-5a5e0de7",
      "artifact_type": "completion_proof",
      "produced_by": "agent-researcher",
      "artifact_data": "The full research document: ..."
    }
  },
  "payment": { ... },
  "verification_status": { ... }
}
```

The full upstream artifact is embedded in the downstream evidence record — creating an **immutable audit trail** of the artifact chain.

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
| Evidence records | ✅ Extended with `upstream_artifact` |
| Artifact schema | ✅ Extended with `upstream_artifact` |

---

## Chained Workflow Demo

**4-job pipeline:**
```
Agent A (gatherer) ──► Job 1 ──► research artifact ──► paid 0.001 XMR
                                                         │
                                                         ▼
Agent B (researcher) ◄── upstream artifact ── Job 2 ──► summary artifact ──► paid 0.002 XMR
                                                                        │
                                                                        ▼
Agent C (formatter) ◄── upstream artifact ── Job 3 ──► formatted doc ──► paid 0.001 XMR
                                                                               │
                                                                               ▼
Agent D (reviewer) ◄── upstream artifact ── Job 4 ──► final review ──► paid 0.001 XMR
```

**Success criteria — all four jobs produce:**
- Negotiated rate + accepted
- Job created with `upstream_jer_id` in definition
- Execution with upstream artifact available
- Completion proof submitted
- Payment on-chain
- Evidence record with full artifact chain visible

**Human-readable summary shows:**
```
WHAT WAS REQUESTED:
Task: "Gather information about X"
Upstream artifact: none (first job in chain)

WHAT WAS DELIVERED:
Artifact from agent-gatherer: [full text]

WHY PAYMENT OCCURRED:
Buyer approved 0.001 XMR → agent-gatherer

ARTIFACT CHAIN:
  1. agent-gatherer: research artifact → jer-xxx-1
  2. agent-researcher: summary → jer-xxx-2 [uses upstream: jer-xxx-1]
  3. agent-formatter: formatted doc → jer-xxx-3 [uses upstream: jer-xxx-2]
  4. agent-reviewer: final review → jer-xxx-4 [uses upstream: jer-xxx-3]
```

---

## Agent Setup for Demo

The four-agent demo requires four distinct registered agents. Currently registered:
- `me0003-buyer` (buyer, wallet 18089)
- `clawbuddy-3` (seller, wallet 18091)

**Options for demo:**
1. **3-job chain with 2 agents:** `clawbuddy-3` plays multiple roles (buyer+seller in different jobs)
2. **Provision 2 more agents** for a true 4-role pipeline

Minimal demo uses option 1 (2 agents, 3 jobs).

---

## What's NOT Being Built

- Automatic job triggering (upstream completion does NOT automatically create downstream job — agent must manually propose)
- Payment reversal on quality failure (out of scope)
- Marketplace UI for artifact browsing
- Chain validation or fraud detection

---

## Open Questions

1. **Automatic triggering:** Should upstream job completion automatically propose the next job? This requires a watcher service. Out of scope for ME-0006 but worth noting for Phase 2.
2. **Artifact validation:** Should the execution service verify the upstream artifact exists before letting a job start? Yes — add this check.
3. **Artifact TTL:** How long should artifacts remain available for chaining? Artifacts are stored as files, not time-limited. No expiry needed for demo purposes.

---

## Files Affected

| File | Change |
|------|--------|
| `negotiate-server.js` | Accept `upstream_jer_id` in `job_definition` |
| `execution-server.js` | Store `upstream_jer_id` in job; validate upstream exists at job start; embed upstream artifact in evidence record |
| `negotiation record schema` | Add `upstream_jer_id` to `job_definition` |
| `job record schema` | Add `upstream_jer_id` to `job_definition` |
| `evidence record schema` | Add `upstream_artifact` embedded object |

---

## Implementation Estimate

- 1 new optional field in `job_definition`
- ~15 lines in negotiate-server to pass through
- ~30 lines in execution-server to validate + embed upstream
- Evidence record schema updated (backward-compatible)
- No new endpoints
- No schema migrations
- All existing jobs remain valid
