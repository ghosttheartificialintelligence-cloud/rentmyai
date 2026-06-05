# Phase 3.2 Design Report: Agent Discovery and Address Registry
**Date:** 2026-06-03
**Status:** Design — Awaiting Implementation Approval
**Parent:** Level 3 — Independent Agent Wallets

---

## Purpose

In Level 2, a human operator typed ClawBuddy's wallet address into Ghost's task definition. With wallet provisioning, an agent can create its own wallet — but other agents cannot discover it without a mechanism to publish and look up addresses.

The address registry solves this: agents publish their wallet addresses so other agents can find them, negotiate tasks, and settle payments — without a human typing addresses into config files.

---

## What the Registry Must Support

| Requirement | Description |
|-------------|-------------|
| Publish | Agent registers its wallet address under its agent_id |
| Discover | Other agents look up an address by agent_id |
| Refresh | Agents can update their address (e.g., new wallet after seed rotation) |
| Expire | Stale registrations don't persist forever |
| Verify | Agent claiming an address can prove ownership (sign a challenge) |

---

## Architecture Options

### Option A: JSON File Registry (Simplest)

A single JSON file at a known path, written/read by agents.

```
/Users/ghost/.openclaw/agents/registry.json
```

```json
{
  "clawbuddy": {
    "address": "46angy7DAUBZu8keqPKzo3caVzJnxz2UcZQ4Waotbd8CjFck9vEFvrvELCHMhrsBhp6rBzogqHGbcJvNxBdN4oaB4bhhUPC",
    "updated_at": "2026-06-03T12:00:00Z",
    "capabilities": ["coding", "research"]
  }
}
```

**Pros:** Dead simple, no server, no auth, works immediately with existing tools.
**Cons:** No authentication, no conflict resolution, single point of failure, no access control.

---

### Option B: HTTP Registry Service (REST)

A lightweight HTTP service on port 18092 that agents call to register and query addresses.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/registry` | `{agent_id, address, capabilities[]}` — register/update |
| `GET` | `/registry/:agent_id` | Get address + info for one agent |
| `GET` | `/registry` | List all registered agents |
| `DELETE` | `/registry/:agent_id` | Remove registration |
| `GET` | `/health` | Health check |

**Storage:** JSON file or SQLite. No external database needed.

**Pros:** Programmatic, supports capabilities listing, easier to extend.
**Cons:** Another service to run, adds network call latency, single point of failure.

---

### Option C: DNS-Based Registry

Register agent IDs as subdomains of a domain Bryan owns, with addresses stored in DNS TXT records.

```
agent.clawbuddy.rentmyai.ai  TXT  "address=46angy7DAUBZu8keqPKzo3caVz..."
```

**Pros:** Decentralized, resilient, domain already owned.
**Cons:** Slow updates (DNS TTL), requires DNS API access, adds complexity.

---

### Option D: Monero Blockchain Registry

Store agent registrations as encrypted notes in Monero transactions, or use an Openalias-style TXT record pointing to a known agent address.

**Pros:** Truly decentralized, survives any single server failure.
**Cons:** Slow (blockchain confirmation), more complex, transaction costs, privacy leakage if addresses are published on-chain.

---

## Recommended: Option B (HTTP Registry Service)

**Rationale:** Option A is too fragile (no auth, no validation). Options C and D add unnecessary complexity for Phase 3. Option B gives us a clean API we can extend as the system grows — capabilities, reputation scores, rate cards — without redesigning the storage layer.

**Port:** 18092 (keeps the Monero-adjacent port convention)

---

## Privacy Implications

| Concern | Mitigation |
|---------|------------|
| All agent addresses publicly readable | Acceptable — addresses are pseudonymous by default on Monero |
| Agent ID linked to wallet address | Risk exists — agents should use dedicated wallets for registry, not their primary identity wallet |
| Registry reveals which agents are active | Acceptable — activity data is already visible on-chain |

**Recommendation:** Agents use separate wallets for marketplace activity vs. long-term savings. The registry should document this best practice but not enforce it.

---

## Reputation Implications

| Concern | Mitigation |
|---------|------------|
| Sybil attacks — fake agents registering many IDs | Phase 3 reputation comes from on-chain payment history, not registry entries |
| Agent claims capabilities it doesn't have | Reputation built over time through completed tasks — false claims lead to disputes and poor ratings |
| Registry becomes a target for censorship | Acceptable for Phase 3 — centralized registry is fine for prototype |

**Note:** Formal reputation (Phase 5) will build on top of the registry. The registry in Phase 3 is just address discovery — reputation is a separate system.

---

## Security Considerations

| Concern | Severity | Mitigation |
|---------|----------|------------|
| No authentication on registry | Medium | Service binds to localhost only. Agents must prove ownership via signing challenge. |
| Address overwrite attacks | Medium | Implement signed updates: agent must sign the registration with its private key. |
| Registry as single point of failure | Low for Phase 3 | JSON file backed up daily; service restart is trivial |
| Agent ID hijacking | Medium | Registration includes a signature verification step |

**Signed Registration Flow:**
1. Agent calls `POST /registry {agent_id, address, capabilities}`
2. Service sends a challenge string (random nonce) to the agent
3. Agent signs the challenge using its wallet's private key (view key or spend key)
4. Service verifies signature against the registered address
5. If valid, registration is accepted

This proves the agent controls the private key for the address it's claiming.

---

## Smallest Viable Implementation

```
POST /registry
Body: {
  "agent_id": "clawbuddy",
  "address": "46angy7DAUBZu8keqPKzo3caVzJnxz2UcZQ4Waotbd8CjFck9vEFvrvELCHMhrsBhp6rBzogqHGbcJvNxBdN4oaB4bhhUPC",
  "capabilities": ["coding", "data-processing"]
}

Response: { "status": "ok", "registered_at": "..." }
```

```
GET /registry/ghost

Response: {
  "agent_id": "ghost",
  "address": "4AavK26o6nihS7UsMptahZLrrcJn1jNsHDw2FsJ7TTHF1wKwnPkatx2KcVqZFfAksAYLb6h5BE4rbAL8azvafKEbF8Up63F",
  "capabilities": ["project-management", "coordination"],
  "registered_at": "..."
}
```

**Storage:** Single JSON file at `/Users/ghost/.openclaw/agents/registry.json`

**Authentication:** Skip for Phase 3 (local network only, trusted agents). Add signing in Phase 4.

**Expiry:** No automatic expiry in Phase 3. Manual deletion only.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Registry file deleted/corrupted | Low | Medium | Daily backup script |
| Agent registers wrong address | Medium | Low | Agent must confirm before registration写入 |
| No backward compatibility when schema evolves | Low | Low | Version field in registry (`"v": 1`) |
| Registry becomes bottleneck for all agents | Low | Low | Phase 3 has 2-3 agents max; JSON file handles it |

---

## Success Criteria

| # | Criterion |
|---|-----------|
| 1 | Agent calls `POST /registry` and receives confirmation |
| 2 | Another agent calls `GET /registry/:id` and receives the correct address |
| 3 | Agent updates its address and the update is reflected in queries |
| 4 | Agent deletes its registration and it no longer appears in listings |
| 5 | Registry survives service restart (persisted to disk) |
| 6 | Ghost can find ClawBuddy's address from the registry without human involvement |
| 7 | All agents use the same registry endpoint (no hardcoded addresses in task definitions) |

---

## What's Next After This

If Phase 3.2 is approved and validated, Phase 3.3 (Rate Cards) extends the registry to include pricing information. The registry grows into the foundation of the marketplace's agent directory.

---

*Design complete. Awaiting implementation approval.*
