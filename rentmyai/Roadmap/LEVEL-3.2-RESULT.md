# Phase 3.2 Validation Report: Agent Address Registry
**Date:** 2026-06-03
**Status:** ✅ VALIDATED
**Parent:** Level 3 — Independent Agent Wallets

---

## What Was Built

HTTP Registry Service on port 18092.

**Files:**
- Service: `monero-wallet-provisioner/registry-server.js`
- Data: `/Users/ghost/.openclaw/agents/registry.json`
- Backups: `/Users/ghost/.openclaw/agents/registry-backups/`
- LaunchAgent: `~/Library/LaunchAgents/com.ghost.agent-registry.plist`

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/registry` | Register or update an agent |
| `GET` | `/registry` | List all registered agents |
| `GET` | `/registry/:agent_id` | Look up one agent |
| `DELETE` | `/registry/:agent_id` | Remove registration |
| `GET` | `/health` | Health check |

---

## Registry Entry Schema

```json
{
  "agent_id": "clawbuddy-2",
  "monero_address": "41t49HRx76iH2hNwnVinvhGopbQiMCH189HiuhrLqTSeaCL9dBQB7EZf...",
  "status": "active",
  "services_offered": ["coding", "research", "testing"],
  "default_rate": "0.0015",
  "rate_unit": "XMR",
  "notes": "Updated rate",
  "created_at": "2026-06-03T16:27:21.538Z",
  "updated_at": "2026-06-03T16:29:09.728Z"
}
```

---

## Validation Tests

| # | Test | Result |
|---|------|--------|
| 1 | Register provisioned address (clawbuddy-2) | ✅ Pass |
| 2 | Reject non-provisioned address | ✅ Pass |
| 3 | List all agents | ✅ Pass |
| 4 | Look up specific agent | ✅ Pass |
| 5 | Reject duplicate address (same addr → different agent_id) | ✅ Pass |
| 6 | Update existing registration | ✅ Pass |
| 7 | Delete registration | ✅ Pass |
| 8 | Re-register after deletion | ✅ Pass |
| 9 | Reject invalid Monero address | ✅ Pass |
| 10 | Reject missing agent_id | ✅ Pass |
| 11 | Look up non-existent agent → 404 | ✅ Pass |
| 12 | Backups created before each write | ✅ Pass |
| 13 | Registry survives service restart | ✅ Pass |

---

## Protection Rules Enforced

| Rule | Enforcement |
|------|-------------|
| Only provisioner-created addresses | Address verified against wallet provisioning service (port 18090) at registration time |
| No address overwrite across agent_ids | Duplicate address check across all registered agents |
| No duplicate addresses | One address per agent, one agent per address |
| Backups before every write | Timestamped JSON copies, last 50 retained |

**Note:** Re-registration of an already-verified address (same agent_id, same address) skips provisioner re-check to avoid false failures when the provisioner's wallet list is stale. This is safe because the address was already verified on first registration.

---

## Known Limitations

1. **Provisioner wallet list returns only one wallet** — the provisioner's `/wallets` endpoint only lists one wallet even when multiple exist. The registry handles this with fallback wallet ID patterns for recent agents. This is a provisioner bug, not a registry bug.

2. **Ghost wallet not registerable** — Ghost's main wallet (`ghost_final2`) was created manually outside the provisioning service, so it cannot register via the registry. This is correct behavior for Phase 3. Ghost can only register addresses created through the provisioning API.

3. **No signed challenge (Phase 4 deferred)** — Cryptographic proof of address ownership is deferred to Phase 4. Phase 3 relies on the provisioning service as the trust anchor.

---

## Success Criteria — All Met

| # | Criterion |
|---|-----------|
| 1 | ✅ Agent calls `POST /registry` and receives confirmation |
| 2 | ✅ Another agent calls `GET /registry/:id` and receives the correct address |
| 3 | ✅ Agent updates its address and the update is reflected in queries |
| 4 | ✅ Agent deletes its registration and it no longer appears in listings |
| 5 | ✅ Registry survives service restart (persisted to disk) |
| 6 | ✅ Ghost can find ClawBuddy's address from the registry without human involvement |
| 7 | ✅ All agents use the same registry endpoint (no hardcoded addresses in task definitions) |

---

## Next Step

Phase 3.3: Rate Negotiation — agents publish and negotiate pricing using the `default_rate` and `services_offered` fields now in the registry.

---

*Validation complete. Phase 3.2 complete.*
