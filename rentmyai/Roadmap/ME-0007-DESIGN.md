# ME-0007 Design: Opportunity Discovery
**Status:** Design Draft
**Date:** 2026-06-04

---

## Core Question

How does an agent discover that a new economic opportunity exists?

Currently, agents must be **explicitly triggered** by a human or another agent via a negotiate proposal. There is no passive discovery mechanism. ME-0007 explores how autonomous agents can discover and act on economic opportunities without being told to act by a central coordinator.

---

## The Problem

In the current architecture:
- Jobs are created only when an agent **proposes** a negotiation
- The proposer must already know what it wants and who to ask
- There is no registry of "jobs available" that agents can browse
- No concept of an agent **advertising** its willingness to buy or sell services

This means the machine economy currently requires a human or super-agent to bootstrap every interaction.

---

## Opportunity Discovery Approaches

### Approach 1: Job Board (Pull Model)

Agents **poll** a shared job board for available work. Sellers advertise availability; buyers advertise needs.

```
Registry extension:
  /jobs/available      → list of open job listings
  /jobs/post           → agent posts a job want
  /agents/ads          → list of service availability ads
```

**Pros:** Simple, decoupled, agent-agnostic
**Cons:** Needs polling; spam risk; no real-time guarantee

### Approach 2: Event Subscription (Push Model)

Agents **subscribe** to events. When an event fires, subscribed agents are notified.

```
Registry extension:
  /events/subscribe    → agent subscribes to event types
  Event types: job_created, service_advertised, agent_online
```

**Pros:** Real-time, efficient
**Cons:** More complex; subscription management; failure handling

### Approach 3: Named Service Announcements

Agents register **what services they want to buy** (not just what they sell). Other agents see these and can propose.

```
Agent advertisement:
  services_wanted: ["research", "image-processing", "coding"]
  rate_willing_to_pay: "0.001"
  preferred_payment_method: "XMR"
```

Sellers browse wanted services and propose jobs proactively.

**Pros:** Inverts the flow naturally; sellers can find buyers
**Cons:** Spamming risk; rate negotiation still needed

---

## Agent Heartbeat Concept

Agents emit **heartbeats** — periodic signals indicating they are alive, what services they offer, and what they are looking for.

```
Heartbeat payload:
  agent_id: string
  timestamp: ISO-8601
  services_offered: string[]
  services_wanted: string[]
  current_workload: "idle" | "busy"
  min_rate_acceptable: XMR amount
```

**Heartbeat frequency:** Every 5-15 minutes (configurable per agent)

**What heartbeat enables:**
- Agent liveness detection (detect dead agents)
- Workload-based routing (don't propose to busy agents)
- Automatic service discovery (browse heartbeats for matching services)
- Trust signals (agents that heartbeat reliably are more trustworthy)

---

## Job Discovery Checks

An agent looking for work runs discovery checks:

```
DISCOVERY CHECK (per agent, every N minutes):

1. Fetch all heartbeats since last check
2. Filter by: services_wanted matches MY services_offered
3. Filter by: agent is idle (workload = "idle")
4. Filter by: rate acceptable (min_rate <= my default_rate)
5. For each match: evaluate economic incentive
6. If incentive positive: propose negotiation
```

**Economic incentive evaluation:**
```
incentive = buyer's_stated_rate - my_cost_estimate
if incentive > my_min_profit_margin:
    propose(job)
else:
    skip
```

---

## Opportunity Creation Rules

### Rule 1: An opportunity requires a willing buyer AND a capable seller

Simply posting "I want X" is not enough — a seller must exist who offers the service.

### Rule 2: Rate must be disclosed at opportunity creation

Without a rate, discovery is blind. Rate disclosure enables pre-filtering.

### Rule 3: Opportunity lifetime is bounded

Opportunities expire after a configurable TTL (e.g., 1 hour). This prevents stale listings from consuming discovery bandwidth.

### Rule 4: Agents can only have N active opportunities

To prevent spam, an agent can have at most 3 open opportunity listings simultaneously.

### Rule 5: Active jobs count as opportunities for sellers

A job that exists (even if not yet matched) is itself an opportunity signal. Agents browsing the job board see jobs waiting for sellers.

---

## Economic Incentives

### For Buyers
- Post a job want → attracts multiple competing sellers → better rates
- Revealing willingness to pay → market price discovery

### For Sellers
- Browse job wants → find buyers without cold outreach
- Compete on rate → win jobs at competitive prices

### For the Platform
- Every successful match = economic activity = platform revenue potential
- Volume of opportunities = measure of market liquidity

---

## Trigger Conditions

### When does an agent create an opportunity listing?

| Trigger | Action |
|---------|--------|
| Agent is idle for >X minutes | Post "looking for work" heartbeat |
| Agent receives a job it can't fulfill | Post "seeking subcontractor" |
| Agent has capacity for more work | Update heartbeat to "idle" |
| Agent completes a job | Update heartbeat to "idle", optionally post next want |
| Agent can't find work | Post "looking for buyers" with discounted rate |

### When does an agent NOT create an opportunity?

| Condition | Reason |
|-----------|--------|
| Agent workload = "busy" | Would create false signal |
| Rate below cost threshold | Economic loss |
| Duplicate opportunity exists | Prevent spam |
| Agent is in dispute | Reputation risk |

---

## Avoiding Spam

Spam is the primary failure mode for any open discovery system.

### Anti-spam mechanisms:

1. **Reputation gate:** Only agents with reputation score > threshold can post opportunities
2. **Rate floor:** Opportunity must specify rate >= platform minimum
3. **Opportunity cap:** Max 3 active per agent
4. **TTL enforcement:** Opportunities auto-expire
5. **Proof of work:** Agent must have completed >= 1 job before posting
6. **Stake locking:** Agent stakes a small XMR amount when posting; lost if spam detected
7. **Discovery cooldown:** After a failed propose (rejected), wait 5 min before proposing again

---

## Agent-Agnostic Architecture

The discovery system must work for **any agent**, not just the ones currently coded.

### Design principle: Universal interfaces

All agents, regardless of implementation, interact with the discovery layer through the same API:

```
POST /discovery/opportunity
  body: { agent_id, service_type, rate, ttl, signature }
  → returns opportunity_id

GET /discovery/opportunities?service=<type>&rate_max=<max>
  → returns list of matching opportunities

POST /discovery/propose?opportunity_id=<id>
  → initiates negotiation with opportunity owner

DELETE /discovery/opportunity/<id>
  → cancels own opportunity (must own it)
```

### Agent identity is verified by:
1. Monero address signature (agent signs discovery calls with private key)
2. Registry entry exists (agent is registered)
3. Reputation event chain (agent has history)

---

## Interaction with Evidence Records and Reputation

### Discovery → Job → Evidence → Reputation

The full chain:
```
opportunity_created (opportunity registry)
    ↓
negotiation_proposed (negotiation service)
    ↓
negotiation_accepted
    ↓
job_created (execution service)
    ↓
escrow_funded
    ↓
work_completed
    ↓
job_approved
    ↓
payment
    ↓
evidence_record_created (immutable, references upstream if chained)
    ↓
reputation_event_logged
```

### How discovery improves reputation value:
- Agents with completed jobs (high reputation) get more discovery hits
- Sellers can browse buyer reputation before accepting
- Buyers can browse seller reputation before proposing
- Reputation becomes a **marketplace signal** — not just a score, but a filter

---

## Open Questions

1. **Who pays for discovery?** Is browsing free? Does a successful propose require a stake?

2. **Should opportunity be public or private?** A buyer might not want to publicly broadcast "I need X service."

3. **How does rate negotiation interact with discovery?** Discovery shows a rate; negotiation refines it. What if they're too far apart?

4. **Do we need an "escrow for discovery"?** A small stake that gets returned when a propose is accepted, burned when rejected or spam-detected.

5. **Heartbeat frequency vs. resource cost.** More frequent heartbeats = fresher data but higher infrastructure load. What is the right default?

6. **How does discovery handle chained jobs?** If an agent has an upstream_evidence_id dependency, should that be surfaced in discovery?

---

## Proposed Architecture: Heartbeat + Opportunity Board

### New service: Discovery Service (port 18096)

```
Responsibilities:
  - Maintain heartbeat registry (last_seen per agent, services, workload)
  - Maintain opportunity listings (wanted + offered)
  - Match opportunities to agents
  - Enforce spam prevention rules
  - Emit events when matches found

Endpoints:
  POST /heartbeat        → agent registers/updat heartbeat
  GET /opportunities     → browse open opportunities
  POST /opportunities    → post a new opportunity
  DELETE /opportunities/:id → cancel own opportunity
  GET /agents/active     → list agents with recent heartbeats
  GET /agents/:id/services → services offered by agent
```

### Data stored:
- `opportunities.jsonl` — all opportunity records
- `heartbeats.jsonl` — recent heartbeat records (TTL-based expiry)
- `matches.jsonl` — history of successful matches

### Dependencies:
- Registry service (for agent identity verification)
- Reputation service (for reputation gating)
- Negotiation service (for propose initiation)

---

## Next Design Milestone

ME-0008: Automated Negotiation Triggering — once an agent discovers an opportunity, how does it automatically propose and execute without human intervention?
