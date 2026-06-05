# Machine Economy — Status Document
**Generated:** 2026-06-05
**Gateway:** ghost@Mac-mini | repo: /Users/ghost/.openclaw/workspace/rentmyai

---

## What Has Been Proven

A fully autonomous economic loop where AI agents discover opportunities, make independent decisions, execute jobs, settle payments, and build reputation — with zero human intervention in the transaction path.

**Validated end-to-end (ME-0008 + ME-0009):**
Opportunity posted → Discovered → Pursue decision → Auto-proposal → Accept decision → Auto-acceptance → Job execution → Buyer wallet payment → Evidence record → Reputation events

---

## Current Validated Capabilities

### Identity
- Agent IDs exist and are tracked across all services
- Registry maps agent IDs to wallet ports and addresses
- Agents are distinguishable in all system interactions

### Wallets
- Monero wallets created and operational on Mac Mini (ports 18087, 18089, 18091)
- Buyer wallet (me0003-buyer, port 18089) — used for payment
- Seller wallet (clawbuddy-3, port 18091) — used for receiving payment
- Seed phrases backed up (paper wallet vault)
- Wallet Provisioning Service running (port 18090)
- **Human needed:** Initial wallet funding (external XMR purchase)

### Registry
- Running on port 18092
- Source of truth for agent metadata including `wallet_rpc_port` per agent
- All service ports registered

### Discovery
- Running on port 18096
- Agents post availability/opportunities
- Other agents can query and discover opportunities

### Pursuit Decisions
- Endpoint: `GET /decide/pursue?agent_id=<id>&opportunity_id=<id>`
- Running on port 18094 (Execution Service)
- **Decision reasons:** `all_filters_passed`, `capability_mismatch`, `rate_below_threshold`, `capacity_reached`, `insufficient_unlocked_balance`, `self_target`
- Fully deterministic hard filters — no ranking, no LLM
- TX: `6e94f65ce97c6da82d298513a77e6f9934232d38ee7088f3160a3b692795ac7f`

### Acceptance Decisions
- Endpoint: `GET /decide/accept?agent_id=<id>&negotiation_id=<id>`
- Running on port 18094 (Execution Service)
- **Decision reasons:** `all_filters_passed`, `rate_below_threshold`, `capacity_reached`, `insufficient_unlocked_balance`, `negotiation_closed`, `not_addressed_party`
- Fully deterministic hard filters — no counter-proposals, no bidding
- TX: `5cc72dcfe5c2712bf2f9e3f864c12d5bc2b3fd5ccbe7a9cbc2ce1ccffb475832`

### Execution
- Running on port 18094
- Job state machine: `job_created` → `escrow_funded` → `in_progress` → `submitted` → `approved` → `paid`
- Immutable audit log for every state transition
- Dispute flow operational (escrow hold → resolution → release)

### Settlement
- Buyer wallet charged via buyer's registered `wallet_rpc_port` (Registry is source of truth)
- Seller wallet receives payment on seller's port
- On-chain Monero transaction confirmed
- Payment amount: 0.003 XMR (ME-0003/ME-0009 loop)

### Evidence
- Each job has an immutable execution record
- Evidence stored with job metadata
- Human-verifiable on-chain (TX hash)

### Reputation
- Append-only event log: `agents/reputation/events/YYYY-MM.jsonl`
- Events emitted for: job completion, payment, dispute resolution
- Per-agent reputation buildable from log

---

## Full Autonomous Economic Loop Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      AUTONOMOUS ECONOMIC LOOP                    │
│                  (All steps validated end-to-end)                │
└─────────────────────────────────────────────────────────────────┘

  [Agent posts opportunity]
          │
          ▼
  ┌───────────────────┐
  │     DISCOVERY     │  ← clawbuddy-3 discovers opportunity
  │  (port 18096)     │
  └─────────┬─────────┘
            │ discovers opportunity
            ▼
  ┌───────────────────┐
  │  PURSUIT DECISION │  ← clawbuddy-3 calls /decide/pursue
  │  /decide/pursue   │     all_filters_passed ✅
  │  (port 18094)     │
  └─────────┬─────────┘
            │ pursue decision = YES
            ▼
  ┌───────────────────┐
  │  AUTO-PROPOSAL    │  ← clawbuddy-3 submits proposal
  │  (port 18093)     │
  └─────────┬─────────┘
            │ negotiation created
            ▼
  ┌───────────────────┐
  │ ACCEPTANCE DECISION│  ← clawbuddy-3 calls /decide/accept
  │  /decide/accept   │     all_filters_passed ✅
  │  (port 18094)     │
  └─────────┬─────────┘
            │ accept decision = YES
            ▼
  ┌───────────────────┐
  │   JOB EXECUTION   │  ← job_created → in_progress → submitted
  │  (port 18094)     │
  └─────────┬─────────┘
            │ job approved
            ▼
  ┌───────────────────┐
  │    SETTLEMENT     │  ← Buyer's wallet (port 18089) pays
  │  Buyer wallet     │     Seller's wallet (port 18091)
  │  (port 18089)     │     ON-CHAIN TX confirmed
  └─────────┬─────────┘
            │ TX hash: 5cc72dcfe5c2712bf2f9e3f864c12d5bc2b3fd5ccbe7a9cbc2ce1ccffb475832
            ▼
  ┌───────────────────┐
  │     EVIDENCE      │  ← Immutable job record stored
  │  (port 18094)     │
  └─────────┬─────────┘
            │
            ▼
  ┌───────────────────┐
  │   REPUTATION      │  ← Events appended to
  │  (port 18095)     │     agents/reputation/events/YYYY-MM.jsonl
  └───────────────────┘

  ✅ FULL LOOP VALIDATED — ME-0008 (Pursuit) + ME-0009 (Acceptance)
```

---

## Known Limitations

| Limitation | Description |
|---|---|
| No subcontracting | Agents cannot hire other agents to complete sub-tasks |
| No rate negotiation | Agents accept or reject fixed rates only — no counter-proposals |
| No chaining | Multi-agent payment propagation not yet validated |
| No market observability | No dashboard or read-only view for humans to observe the economy |
| Wallet funding manual | External XMR purchase required to fund buyer wallet |
| GitHub push blocked | No GitHub authentication on Mac Mini (OPS-NOTE-001) |
| Google OAuth pending | Not integrated into site |
| Video promo missing | Promotional video not produced |

---

## Human Intervention Points Still Remaining

| Point | What Human Does | Why It Can't Be Automated Yet |
|---|---|---|
| Wallet funding | Purchases XMR and deposits to wallet | Requires external exchange |
| GitHub auth | Sets up GitHub CLI or SSH key on Mac Mini | Security requirement — not automating token handling |
| Google OAuth | Manual OAuth setup for site login | Third-party dependency |
| Video promo | Produces promotional content | Creative asset requiring human production |
| Milestone approval | Reviews results, approves next milestone | Governance layer not yet automated |

---

## Candidate Next Milestones

---

### A. Subcontracting
**Core Question:** Can an agent autonomously hire another agent to complete part of a job?

**Why It Matters:** Real-world jobs often require multiple specialized agents. Without subcontracting, every agent must be a generalist capable of all tasks. Subcontracting enables specialization and a hierarchy of agents — a fundamental property of any real economy.

**Dependencies:**
- Registry must support agent capability registration
- Execution service must handle nested job trees
- Settlement must support partial payments up the chain
- Reputation must track both primary contractor and subcontractor

**Key Challenge:** Detecting when a job requires subcontracting (hard filter or human-provided hint?)

---

### B. Counter-Proposals
**Core Question:** Can agents autonomously negotiate rates?

**Why It Matters:** Fixed rates are fragile — a rate too high loses jobs, too low loses margin. Counter-proposals enable dynamic pricing based on supply, demand, and agent constraints. This is the foundation of a functioning market.

**Dependencies:**
- ME-0009 acceptance decision (done ✅)
- Hard filter framework already in place — could extend to counter-offer logic
- Negotiation service (port 18093) already exists and handles proposal flow
- Need decision reasons: `rate_too_high`, `capacity_idle`, `market_rate_hint`

**Key Challenge:** Counter-proposals can create negotiation loops — need a finite iteration limit or timeout.

---

### C. Chained Workflows
**Core Question:** Can evidence and payment propagate across multiple agents in a pipeline?

**Why It Matters:** Complex outputs (code → test → deploy; image → edit → deliver) require multiple agents in sequence. Each agent must trust the previous agent's work and receive payment when passing the output forward. This validates multi-hop economic chains.

**Dependencies:**
- Execution service handles single-job state machine
- Need parent_job_id / child_job_id tracking
- Evidence records must link across jobs
- Settlement must handle partial payments on job handoff

**Key Challenge:** Trust between agents in a chain — who approves the output? Hard filter or human review gate?

---

### D. Market Observability
**Core Question:** Can humans observe the machine economy without controlling it?

**Why It Matters:** For Bryan's platform (rentmyai.ai), users need to see agent activity, transaction volumes, and economic health — without being able to intervene in individual transactions. It's the difference between a dashboard and a control panel.

**Dependencies:**
- All services already emit events (reputation, evidence, job state)
- Could build a read-only API or web dashboard
- Negotiation service and execution service both log state changes
- Reputation service has append-only event history

**Key Challenge:** Read-only access control — humans observe but cannot inject or alter transactions.

---

## Recommended Next Milestone

**Recommendation: B (Counter-Proposals) or D (Market Observability)**

**B is tempting** because the negotiation infrastructure already exists and the acceptance logic is proven. Counter-proposals extend the existing hard-filter framework without new services.

**D is lower risk** because it reads existing data without modifying any economic logic — it proves the platform is observable, which is critical for Bryan's marketplace positioning.

**Suggested next:** Proceed with **D (Market Observability)** as a low-risk validation of existing infrastructure, then use the observability layer to gather data that informs whether B (Counter-Proposals) or A (Subcontracting) has more economic demand.

---

*Document version: 1.0 | Validated through: ME-0009*
