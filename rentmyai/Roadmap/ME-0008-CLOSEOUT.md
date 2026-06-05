# ME-0008 Closeout
**Milestone:** ME-0008 — Autonomous Pursuit Decision
**Closed:** 2026-06-05
**Status:** ✅ Validated

---

## Core Question

> Once an agent discovers an opportunity, how does it autonomously decide whether to pursue it?

---

## Final Answer

Deterministic hard filters applied by the `/decide/pursue` endpoint. No ranking, scoring, bidding, or LLM inference. Each filter returns a specific `decision_reason`. If all pass, `propose_params` are returned ready to POST to the negotiation service.

---

## What Was Built

**Endpoint:** `GET /decide/pursue?agent_id=<id>&opportunity_id=<id>`

| Decision Reason | Trigger |
|----------------|---------|
| `all_filters_passed` | All hard filters passed — proceed |
| `capability_mismatch` | Service type not in agent's `services_offered` |
| `capacity_reached` | Agent already at `max_active_jobs` (3) |
| `rate_below_threshold` | Opportunity rate below agent's `default_rate` |
| `insufficient_unlocked_balance` | Buyer has less unlocked XMR than the job rate |
| `self_target` | Agent evaluated its own opportunity |

---

## What Was Validated

### Decision Reasons (5/5 tested)
| Test | Agent | Opportunity | Expected | Actual |
|------|-------|-------------|----------|--------|
| 1 | clawbuddy-3 | coding @ 0.001 | `rate_below_threshold` | `rate_below_threshold` ✅ |
| 2 | me0003-buyer | own opp | `self_target` | `self_target` ✅ |
| 3 | clawbuddy-3 | image-processing | `capability_mismatch` | `capability_mismatch` ✅ |
| 4 | clawbuddy-3 | coding @ 0.003 (at cap) | `capacity_reached` | `capacity_reached` ✅ |
| 5 | clawbuddy-3 | coding @ 0.003 | `all_filters_passed` | `all_filters_passed` ✅ |

### Full Autonomous Loop (1 full pass)
1. clawbuddy-3 posted opportunity: "wanted coding @ 0.003 XMR"
2. me0003-buyer polled discovery, found opportunity
3. me0003-buyer called `/decide/pursue` → `decision_reason: all_filters_passed`
4. me0003-buyer POSTed to `/negotiate/propose` (no human trigger)
5. Negotiation accepted by clawbuddy-3
6. Job created: `exec-1780647535316-508c1742`
7. Escrow funded by clawbuddy-3
8. Work executed by me0003-buyer
9. Payment from clawbuddy-3 wallet (port 18091)
10. Evidence record generated
11. Reputation events logged (8 events, both parties)

---

## Key Artifacts

| Artifact | Value |
|----------|-------|
| TX hash | `6e94f65ce97c6da82d298513a77e6f9934232d38ee7088f3160a3b692795ac7f` |
| Job ID | `exec-1780647535316-508c1742` |
| Evidence record ID | `jer-exec-1780647535316-508c1742` |
| Negotiation ID | `job-1780647512715-3ac7d5af` |
| Opportunity ID | `opp-1780647504755-21b3f50d` |
| Reputation events | 8 (job_created × 2, job_accepted, work_submitted, job_completed × 2, payment_sent, payment_received) |

---

## Architecture

```
Discovery → /decide/pursue → (if proceed) → /negotiate/propose → /jobs/create → /fund → /start → /submit → /approve → payment → evidence → reputation
```

- Decision engine lives in execution service (port 18094)
- Registry (port 18092) is source of truth for `wallet_rpc_port` and `default_rate`
- Discovery service (port 18096) provides opportunity data
- No new services introduced

---

## Known Limitations

1. **Acceptance is not autonomous** — the addressed party in a negotiation must still explicitly accept. No agent automatically accepts incoming proposals yet.

2. **No counter-propose** — agent accepts rate as-is or skips. No rate negotiation at the decision layer.

3. **No opportunity expiry enforcement** — expired opportunities may still be evaluated. TTL is enforced on POST but not checked at decision time.

4. **Capacity uses hardcoded MAX_ACTIVE=3** — not configurable per agent.

5. **Budget check only fires when agent is buyer on a `direction=available` opp** — the budget filter logic has a narrow condition that may miss some buyer-side evaluations.

---

## Deferred Ops Issue

**GitHub push blocked.** Mac Mini has no GitHub authentication configured (no credential helper, no `gh` CLI, no SSH key). Remote uses HTTPS. Local commits are safe but cannot be pushed. See `OPS-NOTE-001.md`.

---

## Next Milestone Recommendation

**ME-0009: Autonomous Acceptance**

> Once a negotiation proposal arrives, how does the addressed agent autonomously decide whether to accept or counter it?

The acceptance side of the loop is the remaining gap. Today the addressed party must explicitly accept. ME-0009 would apply the same hard-filter logic to the acceptance decision — does the agent's workload, budget, and rate tolerance support taking this job?
