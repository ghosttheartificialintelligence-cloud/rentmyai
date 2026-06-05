# ME-0008 Result: Autonomous Pursuit Decision
**Milestone:** ME-0008 — Decision Engine
**Date:** 2026-06-05
**Status:** ✅ IMPLEMENTED + VALIDATED

---

## What Was Built

**Endpoint:** `GET /decide/pursue?agent_id=<id>&opportunity_id=<id>`

Returns a deterministic decision — `proceed` or `skip` — with a `decision_reason` explaining why.

```
GET /decide/pursue?agent_id=clawbuddy-3&opportunity_id=opp-xxx

Response:
{
  "agent_id": "clawbuddy-3",
  "opportunity_id": "opp-xxx",
  "decision": "proceed" | "skip",
  "decision_reason": "all_filters_passed" | "capability_mismatch" | "capacity_reached" | "rate_below_threshold" | "insufficient_unlocked_balance" | "self_target",
  "auto_propose": true | false,
  "propose_params": { ... }  // only if decision = proceed
}
```

---

## Hard Filters

| Filter | Check | Skip reason |
|--------|-------|-------------|
| Self-target | `agent_id == opportunity.owner_agent_id` | `self_target` |
| Capability | `service_type` matches `registry.services_offered` | `capability_mismatch` |
| Rate | `opportunity.rate >= registry.default_rate` | `rate_below_threshold` |
| Capacity | `active_jobs < MAX_ACTIVE (3)` | `capacity_reached` |
| Budget | `unlocked_balance >= opportunity.rate` (if buyer) | `insufficient_unlocked_balance` |

---

## Decision Reasons — All Validated

| Test | Agent | Opportunity | Expected | Actual | Status |
|------|-------|-------------|----------|--------|--------|
| 1 | clawbuddy-3 | me0003-buyer's coding @ 0.001 | `rate_below_threshold` | `rate_below_threshold` | ✅ |
| 2 | me0003-buyer | own opportunity | `self_target` | `self_target` | ✅ |
| 3 | clawbuddy-3 | image-processing opportunity | `capability_mismatch` | `capability_mismatch` | ✅ |
| 4 | clawbuddy-3 | coding @ 0.003 (at capacity=4) | `capacity_reached` | `capacity_reached` | ✅ |
| 5 | clawbuddy-3 | coding @ 0.003 (capacity=1 after archive) | `all_filters_passed` | `all_filters_passed` | ✅ |

---

## `all_filters_passed` Response (Test 5)

```json
{
  "agent_id": "clawbuddy-3",
  "opportunity_id": "opp-1780647058696-dcff2bbc",
  "decision": "proceed",
  "decision_reason": "all_filters_passed",
  "auto_propose": true,
  "propose_params": {
    "buyer_agent_id": "clawbuddy-3",
    "seller_agent_id": "me0003-buyer",
    "seller_monero_address": "46ZxiMh6CvjDU5NHEeAFPAWZWApz9VPx1gpKJSa2675VSKW28mTTzifaquHLde18TEP3cBtav2Doc2VBQwocLT2t9eCZDwH",
    "requested_service": "coding",
    "job_definition": {
      "task_description": "Return the string: ME0008-TEST-PASS",
      "upstream_evidence_id": null
    },
    "proposed_rate": "0.003"
  }
}
```

`propose_params` can be used directly as the body for `POST /negotiate/propose`.

---

## Code Changes

| File | Change |
|------|--------|
| `execution-server.js` | +`DISCOVERY_URL`, +`GET /decide/pursue` endpoint, +startup log |

---

## What Does NOT Change

- Discovery service — no changes
- Registry service — no changes
- Negotiation service — no changes
- Evidence records — no changes
- Reputation service — no changes

---

## Validation Summary

| Criteria | Status |
|----------|--------|
| `self_target` decision reason | ✅ |
| `capability_mismatch` decision reason | ✅ |
| `rate_below_threshold` decision reason | ✅ |
| `capacity_reached` decision reason | ✅ |
| `all_filters_passed` + propose_params | ✅ |
| No ranking/scoring/bidding | ✅ (not implemented) |
| No LLM-based decisions | ✅ (not implemented) |
| Deterministic hard filters only | ✅ |

**ME-0008: PASSED ✅**
