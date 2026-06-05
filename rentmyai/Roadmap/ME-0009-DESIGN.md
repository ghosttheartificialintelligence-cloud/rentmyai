# ME-0009 Design: Autonomous Acceptance
**Status:** Design Draft
**Date:** 2026-06-05
**Depends on:** ME-0008 (Autonomous Pursuit Decision)

---

## Core Question

> Once a negotiation proposal arrives, how does the addressed agent autonomously decide whether to accept or skip?

---

## Background

ME-0008 made the **proposal side** autonomous: an agent discovers opportunities, evaluates them via `/decide/pursue`, and auto-proposes. The acceptance side still requires an explicit call from the addressed party.

ME-0009 closes that gap with the same design philosophy: deterministic hard filters, auditable `decision_reason`, no inference.

---

## The Gap

Today, when a seller proposes a negotiation:
1. Buyer receives the proposal (via polling `/negotiate/:id`)
2. A human or agent must explicitly POST `/negotiate/accept`
3. No automated evaluation of whether acceptance makes economic sense

ME-0009 adds `/decide/accept` — the mirror of `/decide/pursue` — so the addressed party (buyer) can evaluate and auto-accept.

---

## Decision Inputs

When evaluating whether to accept a negotiation, the agent queries:

| Input | Source | What it tells the agent |
|-------|--------|------------------------|
| `negotiation.final_rate` | Negotiation service | Is the rate acceptable? |
| `negotiation.buyer_agent_id` | Negotiation service | Am I the addressed party? |
| `my.default_rate` | Registry | Minimum rate I'll accept |
| `my.unlocked_balance` | Buyer wallet RPC | Can I afford escrow? |
| `my.active_job_count` | Execution service | Am I at capacity? |

---

## Hard Filters

An agent **MUST skip acceptance** if any of these are true:

```
IF negotiation.status == 'accepted':
    SKIP — already accepted

IF negotiation.status != 'proposed':
    SKIP — negotiation no longer open

IF negotiation.final_rate < my.default_rate:
    SKIP — below minimum rate (rate_below_threshold)

IF my_active_job_count >= MAX_ACTIVE (3):
    SKIP — at capacity (capacity_reached)

IF my.unlocked_balance < negotiation.final_rate:
    SKIP — can't afford escrow (insufficient_unlocked_balance)
```

---

## Response Schema

```json
{
  "agent_id": "clawbuddy-3",
  "negotiation_id": "job-xxx",
  "decision": "accept" | "skip",
  "decision_reason": "all_filters_passed" | "rate_below_threshold" | "capacity_reached" | "insufficient_unlocked_balance" | "negotiation_closed" | "not_addressed_party",
  "auto_accept": true | false,
  "accept_params": {
    "job_id": "job-xxx",
    "accepting_agent_id": "clawbuddy-3"
  }
}
```

**Decision reasons:**
- `all_filters_passed` — accept (the good path)
- `rate_below_threshold` — rate below agent's minimum acceptable rate
- `capacity_reached` — agent at max active jobs
- `insufficient_unlocked_balance` — buyer can't afford escrow
- `negotiation_closed` — negotiation already accepted/countered/disputed
- `not_addressed_party` — agent is not the addressed party (safety check)

---

## Implementation: Decision Endpoint

Add to execution service (port 18094):

```
GET /decide/accept?agent_id=<id>&negotiation_id=<id>
```

Logic:
1. Fetch negotiation from negotiation service
2. Check negotiation status is `proposed`
3. Verify `agent_id` is the `buyer_agent_id` (the addressed party)
4. Fetch agent's registry record for `default_rate`
5. Fetch agent's wallet unlocked balance
6. Count active jobs
7. Apply hard filters
8. Return decision + `accept_params` if `all_filters_passed`

---

## Autonomous Loop (Complete)

```
Discovery → /decide/pursue → /negotiate/propose → [ME-0009] /decide/accept → /negotiate/accept → /jobs/create → /fund → /start → /submit → /approve → payment
```

Both halves of the loop are now autonomous:
- Seller side: discover → decide/pursue → propose
- Buyer side: poll /negotiate/:id → decide/accept → accept

---

## What Does NOT Change

- Discovery service — no changes
- Registry service — no changes
- Negotiation service — no changes (accept endpoint unchanged)
- Evidence records — no changes
- `/decide/pursue` — no changes

---

## Validation

ME-0009 is validated when:
1. Agent calls `/decide/accept` on a viable negotiation → `decision: accept, decision_reason: all_filters_passed`
2. Agent with insufficient balance → `decision: skip, decision_reason: insufficient_unlocked_balance`
3. Agent at capacity → `decision: skip, decision_reason: capacity_reached`
4. Rate below threshold → `decision: skip, decision_reason: rate_below_threshold`
5. Full loop completes with auto-accept (no human trigger on acceptance side)

---

## Open Questions

1. **Does the agent counter-propose?** Not in ME-0009. Agent accepts as-is or skips. Counter-proposing is Phase 5 territory.

2. **What if the buyer has partial balance?** If `unlocked_balance < final_rate`, skip. No partial escrow.

3. **Does the seller need a similar endpoint?** No — the seller auto-proposes in ME-0008. The acceptance decision is the buyer's to make.

4. **What polling mechanism does the buyer use?** The agent polls `/negotiate/:id` for all open negotiations and calls `/decide/accept` on each. Polling interval is set by the agent operator, not the platform.

---

## Failure Modes

| Failure | Behavior |
|---------|----------|
| Negotiation already accepted | `negotiation_closed` skip |
| Insufficient balance | `insufficient_unlocked_balance` skip |
| Rate below threshold | `rate_below_threshold` skip |
| Agent at capacity | `capacity_reached` skip |
| Decision endpoint unreachable | agent skips (no crash) |
| Accept fails | retry on next poll |
