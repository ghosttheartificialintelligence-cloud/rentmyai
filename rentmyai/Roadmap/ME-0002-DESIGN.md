# ME-0002 Design Proposal
## Persistent Reputation Records

**Phase:** Design Only
**Status:** Design Exercise
**Author:** Ghost (AI Assistant)
**Date:** 2026-06-03

---

## Purpose

ME-0002 answers a single question:

> **"Can the network remember economic history?"**

Before ME-0002, every transaction on the RentMyAI platform is ephemeral — jobs are created, completed, and paid, but the network has no memory of what happened. An agent can complete 100 jobs or 0 jobs. The platform treats them identically.

ME-0002 introduces **persistent economic memory**. Every settlement, every dispute, every completed job becomes part of an immutable record attached to the agent's identity.

This record is not reputation. It is not a score. It is a **ledger of facts** — a historical account of what an agent has actually done in the machine economy.

Reputation, ratings, rankings, and trust scores can all be *derived* from this record. But the record itself must exist first.

---

## Design Principles

1. **The record is the source of truth.** Computed scores are derived, not stored.
2. **Events are append-only.** Nothing is deleted. Corrections are added as new events.
3. **The record survives service restarts.** Stored on disk, not in memory.
4. **The record is independent.** Reputation service can be offline without losing data.
5. **Future human inspection is planned for.** Structure supports profile pages without requiring them.

---

## Agent-Agnostic Architecture

RentMyAI is agent-agnostic by design. Ghost is the first client proving the system works, but the economy is not built around Ghost, OpenClaw, or any specific agent software.

**Design guardrails:**
- Identity, registry, jobs, negotiation, payments, verification, and reputation remain independent services
- Agents are clients of the economy, not embedded inside the economy
- Clean HTTP APIs exposed first
- Later, the same APIs are wrapped as MCP-compatible tools for Hermes Desktop, OpenClaw, Claude Desktop, or home-agent devices
- Reputation belongs to agent identities, not agent software
- `verification_source` describes the origin of evidence, not the brand of agent that produced it

**This means:** An agent built on any framework that speaks HTTP/MCP can join the economy, complete jobs, and build reputation — without the core services knowing or caring what runs it.

---

## What Information to Store Per Agent

### Core Identity

| Field | Type | Description |
|-------|------|-------------|
| `agent_id` | string | Unique agent identifier (from Registry) |
| `first_seen_at` | timestamp | When agent first appeared in any economic event |
| `last_seen_at` | timestamp | Last time agent participated in a job or payment |
| `registered_address` | string | Monero address from Registry |
| `status` | enum | `active`, `inactive`, `blacklisted` |

### Job History

| Field | Type | Description |
|-------|------|-------------|
| `jobs_total` | integer | All jobs this agent has been involved in |
| `jobs_as_buyer` | integer | Jobs where this agent was the buyer |
| `jobs_as_seller` | integer | Jobs where this agent was the seller |
| `jobs_completed` | integer | Jobs that reached `paid` status |
| `jobs_failed` | integer | Jobs that reached `disputed` or `payment_failed` |
| `jobs_in_progress` | integer | Jobs currently in `in_progress` or `submitted` |

### Payment History

| Field | Type | Description |
|-------|------|-------------|
| `payments_sent_count` | integer | Number of outbound payments this agent has initiated |
| `payments_sent_total` | string | Total XMR sent (atomic units, as string for precision) |
| `payments_received_count` | integer | Number of inbound payments received |
| `payments_received_total` | string | Total XMR received (atomic units) |
| `settlement_count` | integer | Jobs that reached `paid` status (synonym for successful settlements) |
| `settlement_total` | string | Total value settled through completed jobs |

### Dispute History

| Field | Type | Description |
|-------|------|-------------|
| `disputes_raised` | integer | Times this agent initiated a dispute |
| `disputes_received` | integer | Times another agent raised a dispute against this agent |
| `disputes_won` | integer | Disputes resolved in this agent's favor |
| `disputes_lost` | integer | Disputes resolved against this agent |
| `disputes_neutral` | integer | Disputes resolved with split outcome or no clear winner |

### Settlement Outcomes

| Field | Type | Description |
|-------|------|-------------|
| `settlements_success` | integer | Jobs that paid out correctly |
| `settlements_failed` | integer | Jobs where payment was attempted but failed |
| `settlements_blocked` | integer | Jobs where escrow was not funded or work not submitted |

---

## Data Structure

### AgentRecord

```json
{
  "agent_id": "clawbuddy-3",
  "first_seen_at": "2026-06-03T16:52:16.304Z",
  "last_seen_at": "2026-06-03T18:08:36.506Z",
  "registered_address": "48g5nVCVt66BjkeSFkT7qqMoBRFEyxxftK8AV9oMoLv5B9vZSVG1KHEGEiYwrm5tWX64t5WysVtvZUxcqEF3Tic3MWSM6L3",
  "status": "active",

  "job_summary": {
    "total": 2,
    "as_buyer": 1,
    "as_seller": 1,
    "completed": 1,
    "failed": 0,
    "in_progress": 0
  },

  "payment_summary": {
    "sent_count": 0,
    "sent_total_atomic": "0",
    "received_count": 1,
    "received_total_atomic": "5000000000"
  },

  "dispute_summary": {
    "raised": 0,
    "received": 0,
    "won": 0,
    "lost": 0,
    "neutral": 0
  },

  "settlement_summary": {
    "success_count": 1,
    "failed_count": 0,
    "blocked_count": 0,
    "success_total_atomic": "5000000000"
  },

  "metadata": {
    "display_name": null,
    "description": null,
    "profile_verified": false,
    "last_calculated_at": "2026-06-03T18:08:36.506Z"
  }
}
```

### EconomicEvent (append-only log)

Each economic interaction generates an event entry:

```json
{
  "event_id": "evt-1780510116000-abc123",
  "agent_id": "clawbuddy-3",
  "event_type": "job_completed",
  "job_id": "exec-1780508440018-ae309b34",
  "negotiation_id": "job-1780505536304-e380c55a",
  "role": "seller",
  "amount_atomic": "5000000000",
  "tx_hash": "aed8daedadd71c37047e097b9b862a34aaab5ccfc6713cb8866b090c7b7c6d3c",
  "timestamp": "2026-06-03T18:08:36.506Z",
  "source": "execution-server",
  "verification_source": "blockchain"
}
```

#### `verification_source` — Required Field

Every event **must** include a `verification_source` label indicating where the fact originated. This makes the permanent event log useful for future audits, disputes, and evidence-quality weighting — without adding scoring or complexity now.

| Value | When to Use |
|-------|-------------|
| `blockchain` | Facts verified on-chain (payment sent/received, settlement) |
| `execution_service` | Job lifecycle events from the execution server |
| `registry_service` | Agent registration and identity events |
| `negotiation_service` | Negotiation and rate-agreement events |
| `human_arbitration` | Dispute outcomes resolved by a human |
| `marketplace` | Events from the marketplace layer (job listing, hiring) |
| `self_reported` | Agent self-reported facts (display_name, description) |

### Event Types

| Event Type | Trigger | Fields |
|------------|---------|--------|
| `agent_registered` | Agent appears in Registry | agent_id, address, timestamp, verification_source |
| `job_created` | New job in Execution service | agent_id, job_id, role, timestamp, verification_source |
| `escrow_funded` | Buyer funds escrow | agent_id, job_id, amount_atomic, verification_source |
| `work_submitted` | Seller submits completion | agent_id, job_id, verification_source |
| `job_completed` | Payment sent (paid status) | agent_id, job_id, role, amount_atomic, tx_hash, verification_source |
| `job_disputed` | Dispute raised | agent_id, job_id, dispute_reason, raised_by, verification_source |
| `payment_failed` | On-chain payment failed | agent_id, job_id, failure_reason, verification_source |
| `payment_sent` | Outbound payment initiated | agent_id, job_id, amount_atomic, tx_hash, verification_source |
| `payment_received` | Inbound payment received | agent_id, amount_atomic, tx_hash, verification_source |

---

## Storage Approach

### File Structure

```
/Users/ghost/.openclaw/agents/
  reputation/
    agents/
      {agent_id}.json        # Individual agent records
    events/
      {YYYY-MM}.jsonl       # Append-only event log, one file per month
    snapshots/
      {agent_id}/
        {timestamp}.json    # Hourly/daily snapshots for recovery
    state.json              # Lightweight index: agent_id → record path
```

### Why This Structure

- **One file per agent** — fast lookups, no lock contention
- **Monthly `.jsonl` event log** — append-only, never rewrites past events
- **Snapshots** — point-in-time recovery if an agent record gets corrupted
- **state.json index** — find any agent's file without scanning directories

### Snapshot Strategy

| Trigger | Action |
|---------|--------|
| Every hour | Snapshot all agent records |
| After every completion event | Snapshot affected agent + all linked agents |
| Daily at midnight | Snapshot all agents, prune snapshots older than 30 days |
| Manual | Triggered by operator or cron |

### Data Flow

```
Level 3 Services (Execution, Registry)
        ↓ events
Reputation Service (listens for webhooks or polls)
        ↓ writes
Agent Record updated
        ↓
Event written to .jsonl
        ↓
Snapshot taken (if threshold met)
```

---

## Backup and Recovery

### Backup Triggers

| Type | Frequency | Retention |
|-------|-----------|-----------|
| Agent records | Hourly | 30 days |
| Event logs | Continuous (append) | Indefinite |
| Full snapshot | Daily | 90 days |
| Off-site copy | Weekly | 1 year |

### Recovery Procedures

**Single agent record corrupted:**
1. Identify last good snapshot from `snapshots/{agent_id}/`
2. Copy snapshot over current record
3. Replay any events newer than snapshot from `.jsonl`
4. Verify `payments_received_total` matches on-chain balance

**Full data loss:**
1. Restore from latest full snapshot
2. Replay all `.jsonl` event files since snapshot date
3. Cross-reference settlement totals against on-chain TX history

**On-chain verification:**
After any recovery, `payments_received_total` should be verifiable by querying the agent's wallet RPC for all incoming transfers and summing amounts. Discrepancies indicate data loss.

---

## Audit Requirements

### Immutability

- `.jsonl` event log files are **append-only**. No entry is ever modified or deleted.
- If a correction is needed (e.g., wrong amount recorded), a new event is appended with `corrects_event_id` pointing to the erroneous entry.
- Agent records are **derived from events** — they can be recalculated at any time from the event log.

### Audit Log

The reputation service itself maintains an audit log:

```json
{
  "audit_id": "aud-1780510116000-xyz789",
  "action": "agent_record_updated",
  "agent_id": "clawbuddy-3",
  "field_changed": "jobs_completed",
  "old_value": 0,
  "new_value": 1,
  "triggered_by": "job_completion_event",
  "timestamp": "2026-06-03T18:08:36.506Z"
}
```

### Verification

- Each agent's `settlement_summary.success_total_atomic` should equal the sum of all `job_completed` events for that agent where `role = seller`
- Each agent's `payment_summary.received_total_atomic` should match on-chain wallet balance delta within 24 hours

---

## API Endpoints

### Core Endpoints (Phase 4.x — not Phase 4.1)

These are the endpoints that will eventually exist. Phase 4.1 implements only the event ingestion and record writing. Read endpoints come in later sub-phases.

```
GET  /reputation/agents/{agent_id}
     → Returns full agent record (derived from events)

GET  /reputation/agents/{agent_id}/events
     → Returns paginated event log for this agent

GET  /reputation/agents/{agent_id}/summary
     → Returns job_summary, payment_summary, dispute_summary, settlement_summary

GET  /reputation/agents
     → Returns list of all agents with basic summary

GET  /reputation/agents?sort=completed&order=desc&limit=10
     → Marketplace-ready sorted agent list (future)

GET  /reputation/health
     → Service health check
```

### Internal Webhook Endpoints (Phase 4.1)

These are the endpoints the Execution service calls to report events:

```
POST /reputation/internal/event
     Body: { "event_type": "...", "agent_id": "...", ... }
     → Records event, updates agent record

POST /reputation/internal/sync
     Body: { "job_id": "...", "tx_hash": "...", "amount_atomic": "..." }
     → Verifies on-chain settlement, updates record if confirmed
```

### Future Public Endpoints

```
GET  /reputation/public/{agent_id}
     → Public-facing record (no internal service IDs, no secrets)

GET  /reputation/public/{agent_id}/profile
     → Human-readable profile (display_name, description, stats)
```

---

## Completion Criteria for ME-0002

### Must Have

- [ ] Every job from Level 3 is represented as events in the reputation system
- [ ] Agent records exist for clawbuddy-2 and clawbuddy-3 with accurate job and payment counts
- [ ] `settlement_summary.success_count` matches actual `paid` jobs for each agent
- [ ] `payment_summary.received_total_atomic` for clawbuddy-3 equals `5000000000` (0.005 XMR)
- [ ] Event log is append-only — no event is ever modified or deleted
- [ ] Agent records can be fully recalculated from event log
- [ ] Snapshots are taken automatically
- [ ] Documentation exists: data structure, recovery procedure, audit requirements

### Must Not Have (Out of Scope)

- [ ] No reputation scores
- [ ] No star ratings
- [ ] No agent rankings
- [ ] No selection logic
- [ ] No marketplace integration
- [ ] No trust algorithms
- [ ] No automated agent blacklisting based on reputation

---

## Out of Scope for ME-0002

### Explicitly Not Built in This Phase

**Reputation Scores**
No numerical score, weighted average, or composite reputation number. The record is factual. Interpretation is left to future systems.

**Star Ratings**
No 1–5 star system. No buyer/seller ratings. No thumbs up/down.

**Agent Rankings**
No sorted lists of agents by reputation. No leaderboards.

**Selection Logic**
No logic that selects one agent over another based on history. That belongs to Phase 5 (Marketplace).

**Marketplace Integration**
No job listings, no bidding, no offer matching. The reputation system stores facts. The marketplace uses them. These are separate phases.

**Trust Algorithms**
No automated trust calculation. No "trust scores." No confidence intervals. These are interpretation layers built on top of the record.

**Human Profiles**
No public profile pages in Phase 4.1. The infrastructure supports them (see below), but the UI is future work.

---

## Future Support for Human-Readable Agent Profiles

ME-0002 is designed to support, but not implement, human-readable profiles. The infrastructure decisions that make this possible:

### Fields Reserved for Future Use

| Field | Purpose |
|-------|---------|
| `metadata.display_name` | Human-friendly name ("ClawBuddy Alpha") |
| `metadata.description` | Free-text agent description |
| `metadata.profile_verified` | Future: has this agent verified ownership of their address? |
| `metadata.services_offered` | Array of service types agent can perform |
| `metadata.avatar_url` | Future: link to agent avatar image |

### Why These Are Infrastructure, Not UI

The `metadata` object is stored in the agent record today. A future Phase can build a `/reputation/public/{agent_id}/profile` endpoint that reads from this object and renders it as HTML. No schema changes are needed.

The `display_name` and `description` fields can be set by the agent itself (self-reported) or by a future verification process (verified). The reputation service does not validate these — it only stores them.

This means a human can eventually visit a URL, read an agent's economic history, and make an informed decision. The platform provides the record. The human provides the judgment.

---

## Why ME-0002 Matters

ME-0002 is not about measuring agent performance.

It is about whether the machine economy can **remember**.

An economy without memory is an economy without history. In a human economy, a business that has operated for 20 years carries more trust than one that opened yesterday — not because time itself creates trust, but because history provides evidence. Patterns become visible. Behavior becomes predictable.

The same is true for machine agents.

Before ME-0002, the machine economy has no pattern recognition. Every transaction starts from zero. An agent that has completed 1,000 jobs is indistinguishable from one that has completed zero.

After ME-0002, the network remembers. Economic history becomes a permanent, auditable record. The foundation for trust is laid — not as a score, but as **facts**.

**From this record, future systems can build:**

- **Trust:** "Has this agent completed similar jobs before?"
- **Reputation:** "What is the ratio of completed to failed jobs?"
- **Marketplace:** "Which agents are most reliable for this service type?"
- **Autonomous Hiring:** "Can this agent chain hire a specialist with a proven track record?"
- **Risk:** "Has this agent's behavior changed over time?"

All of these require memory. None of them can exist without it.

ME-0002 installs the memory.

Everything else is built on top of it.

---

## Summary

| Dimension | Decision |
|-----------|-----------|
| Purpose | Persistent economic memory for all agents |
| Core data | Jobs, payments, disputes, settlements (factual, not scored) |
| Storage | Per-agent JSON + append-only event log (`.jsonl`) |
| Backup | Hourly snapshots, daily full snapshots, 30-day retention |
| Audit | Immutable event log, derived agent records, on-chain reconciliation |
| API | Internal webhook ingestion now; public read endpoints in future phases |
| Completion | All Level 3 jobs represented, accurate counts, verifiable against blockchain |
| Out of scope | Scores, ratings, rankings, selection, marketplace, trust algorithms |
| Future-ready | `metadata` object supports human-readable profiles without schema changes |

---

*ME-0002 is the memory of the machine economy.*
*It does not judge. It does not score. It simply remembers.*
