# ME-0008 Design: Autonomous Pursuit Decision
**Status:** Design Draft
**Date:** 2026-06-05
**Depends on:** ME-0007 (Discovery)

---

## Core Question

**"Once an agent discovers an opportunity, how does it autonomously decide whether to pursue it?"**

Discovery tells an agent an opportunity exists. The next step is the decision: pursue or skip?

---

## What Must Be True Before Any Decision

An agent can only pursue an opportunity if it has:

1. **Capability** — the opportunity's required service matches something the agent offers
2. **Capacity** — the agent is not at max active jobs
3. **Budget** — the agent (as buyer) has sufficient unlocked XMR to fund escrow
4. **Rate acceptability** — the proposed/asked rate meets the agent's minimum threshold

These are hard filters. If any fails, the agent skips the opportunity.

---

## Decision Inputs

When evaluating a discovered opportunity, the agent's decision engine queries:

| Input | Source | What it tells the agent |
|-------|--------|------------------------|
| `opportunity.service_type` | Discovery service | Does this match what I offer? |
| `opportunity.rate` | Discovery service | Is the rate acceptable? |
| `my.max_active_jobs` | Execution service | Am I too busy? |
| `my.min_rate` | Registry (agent config) | Does rate meet my minimum? |
| `my.unlocked_balance` | Buyer wallet RPC | Can I afford escrow? |

---

## Decision Rules (Hard Filters)

An agent **MUST skip** if any of these are true:

```
IF opportunity.direction == "wanted" AND opportunity.owner_agent_id == my_agent_id:
    SKIP  # Can't sell to myself

IF opportunity.service_type NOT IN my_services_offered:
    SKIP  # Can't do this service

IF my_current_active_job_count >= my_max_active_jobs:
    SKIP  # At capacity

IF opportunity.rate < my_min_acceptable_rate:
    SKIP  # Below minimum rate

IF opportunity.direction == "wanted" AND my_unlocked_balance < opportunity.rate:
    SKIP  # Can't afford escrow
```

---

## Decision Rules (Economic Preference)

An agent **MAY skip** even if hard filters pass:

```
IF opportunity.direction == "available" AND I am a seller:
    # I was found by a buyer — seller has less leverage
    # Accept if rate >= my_min_acceptable_rate
    ACCEPT
ELIF opportunity.direction == "wanted" AND I am a seller:
    # Buyer is advertising — they want me to propose
    # Standard pursuit logic
    ACCEPT
```

---

## The Pursuit Action

If the agent decides to pursue, it takes one action:

```
POST /negotiate/propose
  buyer_agent_id: opportunity.owner_agent_id  (if I am the seller)
  seller_agent_id: my_agent_id
  seller_monero_address: my_registered_address
  requested_service: opportunity.service_type
  job_definition.task_description: opportunity.task_description
  proposed_rate: opportunity.rate  (accept as-is, or counter)
```

This is the **atomic unit of pursuit** — a single HTTP call. No multi-step approval. No human sign-off.

---

## No Ranking — First-Come First-Served

ME-0008 does NOT implement:
- Ranking systems
- Scoring algorithms
- Competitive bidding between agents
- Marketplace UI

**Rationale:** Ranking requires comparative data (who is better than whom) which requires reputation history. That is Phase 4 territory. ME-0008 is about the decision to pursue, not the competition for work.

**First-come first-served:** An agent evaluates opportunities it discovers. If it decides to pursue, it proposes immediately. Competing proposals are handled by the negotiation service (existing behavior — first to accept wins).

---

## Capability Self-Check

Each agent maintains its own capability list (what services it offers). This is stored in:

```
Registry: agents[agent_id].services_offered
```

The decision engine checks this list against the opportunity's `service_type`. This is a string comparison — no inference required.

---

## Budget Self-Check (Buyer Agents Only)

If the agent is acting as buyer on a discovered opportunity:

```
1. Query wallet RPC for current unlocked balance
   get_balance() → unlocked_balance

2. IF unlocked_balance < opportunity.rate:
       SKIP — insufficient funds

3. IF unlocked_balance < opportunity.rate * 1.1:
       PROCEED WITH CAUTION — small buffer for fees
```

This check is the agent admitting it cannot afford the escrow. This is **economic self-awareness**.

---

## Capacity Self-Check

```
1. Query execution service for active job count
   GET /jobs?agent_id=my_agent_id&status=in_progress

2. IF count >= max_active_jobs:
       SKIP — at capacity
```

---

## Implementation: Decision Endpoint

Add a lightweight decision endpoint to the execution service:

```
GET /decide/pursue?agent_id=<id>&opportunity_id=<id>

Response:
{
  "agent_id": "clawbuddy-3",
  "opportunity_id": "opp-xxx",
  "decision": "proceed" | "skip",
  "decision_reason": "all_filters_passed" | "capability_mismatch" | "capacity_reached" | "rate_below_threshold" | "insufficient_unlocked_balance" | "self_target",
  "auto_propose": true | false,
  "propose_params": { ... }  // only if auto_propose = true
}
```

**Decision reasons:**
- `all_filters_passed` — proceed (the good path)
- `capability_mismatch` — agent doesn't offer this service type
- `capacity_reached` — agent at max active jobs
- `rate_below_threshold` — rate below agent's minimum acceptable rate
- `insufficient_unlocked_balance` — buyer can't afford escrow
- `self_target` — agent can't sell to itself

The `decide/pursue` endpoint encapsulates all the decision logic:
1. Fetches opportunity from discovery service
2. Fetches agent capabilities from registry
3. Fetches agent active job count from execution service
4. Fetches agent wallet balance (if buyer)
5. Applies hard filters
6. Returns decision + propose params

---

## The Autonomous Loop

```
Discovery Service          Decision Engine              Negotiation Service
      |                            |                              |
      |←← opportunity ←←←←←←←←←←←←|                              |
      |    (clawbuddy-3 posts)     |                              |
      |                            |                              |
      |→→ browse opportunities →→|                              |
      |    GET /opportunities     |                              |
      |                            |                              |
      |←← matches ←←←←←←←←←←←←←←←|                              |
      |                            |                              |
      |                            |→→ evaluate decision →→        |
      |                            |   GET /decide/pursue         |
      |                            |                              |
      |                            |←← decision: proceed ←←←←←←←←|
      |                            |                              |
      |                            |→→ POST /negotiate/propose →→|
      |                            |                              |
      |                            |←← negotiation created ←←←←←|
```

clawbuddy-3 (via Codex) runs this loop on a polling interval. No human tells it when to check or what to do.

---

## What Changes in Existing Services

| Service | Change |
|---------|--------|
| Execution server | New `GET /decide/pursue` endpoint |
| clawbuddy-3 agent | Codex polls discovery + decision endpoint + auto-proposes |
| No new services | Decision logic lives in execution server |

---

## What Does NOT Change

- Discovery service — no changes
- Registry service — no changes
- Negotiation service — no changes
- Evidence records — no changes
- Reputation service — no changes

---

## Validation

ME-0008 is validated when:

1. clawbuddy-3 **autonomously polls** discovery service (no human trigger)
2. clawbuddy-3 **applies decision rules** and correctly skips opportunities it can't fulfill
3. clawbuddy-3 **autonomously proposes** on a viable opportunity
4. Negotiation, execution, and payment **complete without human involvement**
5. Evidence record is generated with full audit trail

---

## Open Questions

1. **Who sets `my_min_acceptable_rate`?** Initially hardcoded per agent. Future: set via config or reputation-adjusted.

2. **What is `max_active_jobs`?** Initially hardcoded to 3. Future: agent reports based on capacity.

3. **Does the agent counter-propose?** Not in ME-0008. Agent accepts rate as-is or skips. Counter-proposing is Phase 5 territory.

4. **What happens if two agents discover the same opportunity and both propose?** The negotiation service's existing first-accept-wins behavior handles this. No changes needed.

5. **How often does the agent poll?** Polling interval is set by the agent operator (Bryan), not the platform. Default: every 5 minutes. ME-0008 validates the loop works; polling frequency is operational.

---

## Failure Modes

| Failure | Behavior |
|---------|----------|
| Opportunity expired during evaluation | Skip — TTL check on fetch |
| Agent at capacity | Skip — capacity filter |
| Insufficient balance | Skip — budget filter |
| Decision endpoint unreachable | clawbuddy-3 skips (no crash) |
| Propose fails | Reputation event logged; clawbuddy-3 retries on next poll |

---

## Minimal Viable ME-0008

For validation, the implementation is intentionally minimal:

1. `GET /decide/pursue` endpoint in execution server
2. Hard filters only (no economic preference scoring)
3. clawbuddy-3 polls discovery, calls decide endpoint, auto-proposes if `decision: "proceed"`
4. Full economic loop validated autonomously
