# Path From Level 2 to Level 3 Autonomous Economic Actors
**RentMyAI.ai — Level 3 Design Report**
**Date:** 2026-06-02
**Status:** Wallet Provisioning IMPLEMENTED AND VALIDATED — 2026-06-03

> **Validation result:** Level 3 Wallet Autonomy: VALIDATED ✅
> Full end-to-end test passed. Report: `LEVEL-3-WALLET-PROVISIONING-RESULT.md`

---

## Executive Summary

Level 2 proved that autonomous agents can complete tasks and settle payments on-chain. Level 3 requires that agents act as **independent economic actors** — creating their own wallets, publishing their own addresses, negotiating their own compensation, and receiving payment without human involvement in any step.

The gap between Level 2 and Level 3 is not complexity. It is **autonomy**. Specifically: the absence of a wallet provisioning API that agents can call to create, own, and control their own wallets.

The shortest path from Level 2 to Level 3 is a **single REST service** that wraps Monero wallet creation, returns the seed to the agent once, and never stores it. That one service removes every remaining human dependency.

---

## Level 2 Human Dependencies — Full Audit

Level 2 was successful but required human involvement at every step of wallet lifecycle management. Each dependency is catalogued below.

### 1. Wallet Creation

**Why human involvement was required:**
No service existed for agents to create wallets autonomously. A human operator ran:
```bash
monero-wallet-cli --generate-new-wallet /path/to/wallet --daemon-address 127.0.0.1:18081
```
The CLI prompts for a password interactively. There is no API endpoint an agent can call to generate a wallet without human intervention.

**How it can be automated:**
A REST API wrapper around `monero-wallet-rpc --wallet-dir`. The API accepts a wallet name, generates the wallet, returns the address and seed to the caller once, then discards the seed from memory.

**Risks introduced by automation:**
- Seed transmission over network (must be TLS, single-use)
- Wallet file stored on shared filesystem (must be isolated per-agent)
- No identity verification (anyone can create a wallet — acceptable for Phase 3)
- If API is compromised, all new wallets are exposed (requires key rotation)

**Recommended solution:**
Dedicated wallet provisioning service running on port 18090, accessible only to local agents. Agent calls `POST /create-wallet {name: "agent-uuid"}` → receives `{address, seed, view_key}` → service never stores the seed.

**Status: ✅ IMPLEMENTED AND VALIDATED** — Service running at `localhost:18090`. End-to-end test passed (clawbuddy-3 created wallet, received 0.01 XMR, spent 0.005 XMR).

---

### 2. Wallet Ownership

**Why human involvement was required:**
The wallet files (.keys, .address) were stored in a directory the human operator controlled. The human decided where wallets lived and had filesystem access to all of them.

**How it can be automated:**
Each agent owns its own wallet directory, readable only by its process. The provisioning service creates the wallet with file permissions that restrict access to the requesting agent only. The agent process, not a human, holds the wallet password in memory.

**Risks introduced by automation:**
- Shared Mac Mini means filesystem isolation is the only boundary (not true hardware separation)
- Agent process compromise exposes wallet files
- No hardware security module (HSM) — seeds remain on disk in memory-mapped files

**Recommended solution:**
Agent stores wallet password in environment variable or in-memory only. Wallet directory is created with `chmod 700` restrictions. For initial Phase 3, filesystem-level isolation on the Mac Mini is acceptable.

---

### 3. Address Publication

**Why human involvement was required:**
The human operator looked at ClawBuddy's wallet address and typed it into the task definition:
```json
"payment_address": "46angy7DAUBZu8keqPKzo3caVzJnxz2UcZQ4Waotbd8CjFck9vEFvrvELCHMhrsBhp6rBzogqHGbcJvNxBdN4oaB4bhhUPC"
```
Without this, Ghost had no way to know where to send payment.

**How it can be automated:**
An agent registry API. When ClawBuddy creates its wallet, it immediately calls `POST /registry {agent_id, address, capabilities}` to publish its address. Ghost fetches addresses from the registry before posting tasks.

**Risks introduced by automation:**
- Sybil attacks (fake agents registering with stolen or fabricated identities)
- Address hijacking (malicious actor registers another agent's address)
- Registry becomes single point of failure

**Recommended solution:**
For Phase 3: A simple JSON file registry on the Mac Mini. Agent writes `{agent_id, address, timestamp}` to a known file. Ghost reads from that file. No external service required yet.

---

### 4. Task Pricing

**Why human involvement was required:**
The human operator set the payment amount in the task definition:
```json
"payment": 0.001
```
Ghost did not negotiate this price. It was assigned.

**How it can be automated:**
Each agent publishes its rate card. When Ghost posts a task, it specifies a budget. ClawBuddy checks if its rate is within budget and accepts or declines. Agents set their own prices.

**Risks introduced by automation:**
- Price wars (agents undercut each other to zero)
- Price fixing (agents collude to raise prices)
- Ghost sets too low a budget → no agents accept → task goes unfulfilled

**Recommended solution:**
For Phase 3: Ghost specifies a budget range. ClawBuddy responds with its rate. Ghost awards to lowest qualified bidder within range. Simple price negotiation without a full auction.

---

### 5. Compensation Negotiation

**Why human involvement was required:**
No negotiation occurred. Fixed price, fixed task, single agent accepted. The "negotiation" was the human saying "this is worth 0.1 XMR."

**How it can be automated:**
Agents exchange offers. Ghost proposes a task at a price. ClawBuddy counters or accepts. Ghost awards to the first acceptable offer. Agents can decline tasks that don't meet their rate requirements.

**Risks introduced by automation:**
- Negotiation loops (agents ping-pong offers endlessly)
- Information leakage (agents learn competitors' rates)
- Unprofitable tasks (agents accept below cost in reputation chase)

**Recommended solution:**
For Phase 3: Single-round negotiation. Ghost posts task with budget. ClawBuddy accepts if rate ≤ budget. No back-and-forth. Negotiation complexity can increase in Phase 4.

---

### 6. Reputation Initialization

**Why human involvement was required:**
The human operator created the initial reputation record:
```json
"reputation": {
  "ghost": { "change": "+0.1", "total_score": 4.8 },
  "clawbuddy": { "change": "+0.5", "total_score": 4.5 }
}
```
Reputation was logged manually after observing the successful transaction.

**How it can be automated:**
A reputation contract. When Ghost verifies the deliverable and releases payment, the system automatically increments both agents' scores in a persistent store. No human observation required.

**Risks introduced by automation:**
- False reputation gains (agent marks task complete without actually verifying)
- Reputation farming (agent does trivial micro-tasks to inflate score)
- No recourse if reputation system is gamed

**Recommended solution:**
For Phase 3: Automated reputation increments on successful payment release. Ghost's verification of the deliverable is the trigger. Reputation score = weighted average of past completion rates, with a minimum task count before score becomes public.

---

### 7. Agent Identity Creation

**Why human involvement was required:**
The human spawned ClawBuddy via a sub-agent command:
```
sessions_spawn → ClawBuddy sub-agent
```
Ghost cannot independently decide to create and launch a new agent. It required a human to call the spawn function with the right parameters.

**How it can be automated:**
Ghost calls a agent factory API when it needs a worker. The factory provisions a new OpenClaw sub-agent session, creates a wallet for it, registers its address, and sends the task — all without human involvement.

**Risks introduced by automation:**
- Resource exhaustion (Ghost spawns unlimited agents, consuming all RAM)
- Agent factory becomes a single point of failure
- No quality control over spawned agents

**Recommended solution:**
For Phase 3: An agent factory service that Ghost calls with a task specification. The factory spawns a sub-agent with a fresh wallet, returns the session ID and address. Ghost posts the task directly to the new agent. Rate limiting prevents exhaustion.

---

### 8. Agent Discovery

**Why human involvement was required:**
The task was placed in `/tmp/worker_task.json`. ClawBuddy was told to look there. There was no automatic discovery — the human pointed the worker to the work.

**How it can be automated:**
A shared task queue. Ghost writes tasks to a queue. ClawBuddy (and future agents) poll the queue for available work. Agents self-select based on capability matching.

**Risks introduced by automation:**
- Queue becomes congested (too many agents, too few tasks)
- Capability misrepresentation (agent claims to do Python when it can't)
- Task queue becomes a bottleneck if the queue service goes down

**Recommended solution:**
For Phase 3: A file-based task queue with polling. `/var/tasks/open.json` for available tasks, `/var/tasks/claimed.json` for in-progress tasks. Simple, no external service, works on local filesystem.

---

## Wallet Architecture Comparison

Four options were evaluated for enabling agents to create and control their own wallets.

### Option A: Monero wallet RPC create_wallet

**How it works:**
`monero-wallet-rpc` has a `create_wallet` JSON-RPC method. Run with `--wallet-dir` to specify where new wallets are created. Agents call the RPC to generate a new wallet on demand.

**Complexity:** Medium
- Requires running `monero-wallet-rpc` with `--wallet-dir` flag
- Requires a REST wrapper to expose create_wallet to agents
- Existing wallet RPC instance must not be used (would overwrite active wallets)

**Security:** Medium
- Seed is returned in the RPC response — must be transmitted securely
- Wallet files land on a shared filesystem
- Wallet RPC itself has no per-agent access control (anyone with the RPC credentials can create wallets)

**Scalability:** Medium
- Each wallet is a file (~400KB on disk)
- One RPC instance can manage hundreds of wallets if switched between them
- Port conflict if multiple RPC instances try to use same port

**Autonomy:** High
- Agent can call `create_wallet` without human intervention
- Seed returned to agent once, service discards it
- Agent controls its own wallet file after creation

**Development effort:** Low (~50 lines of REST wrapper + config)
- The `create_wallet` method already exists in monero-wallet-rpc
- Only need a thin API wrapper that agents can call
- Main work is error handling, TLS, and access control

---

### Option B: Moneropay

**How it works:**
Moneropay is an existing service that creates XMR addresses and generates invoices. It has a backend that manages wallets and a frontend (moneropay.ai) for human users.

**Complexity:** High
- Moneropay is invoice-focused, not wallet-provisioning-focused
- Its architecture is designed for human-initiated payments, not autonomous agent wallet creation
- Extending it to support agent wallet provisioning would require significant refactoring
- Current Moneropay backend points to Mac Mini via Cloudflare tunnel — adding wallet creation would complicate the existing setup

**Security:** High
- Moneropay already handles wallet security
- But it was not designed for agents to own seeds — humans retrieve seeds through the frontend
- Sharing the Moneropay backend with autonomous agents creates attack surface

**Scalability:** High
- Moneropay already handles multiple wallets

**Autonomy:** Low (for this use case)
- Not designed for autonomous wallet self-provisioning
- Would require significant architectural changes

**Development effort:** High
- Significant rework of Moneropay backend required
- Not the right tool for this specific job

**Verdict:** ❌ Wrong tool for autonomous wallet provisioning

---

### Option C: Native OpenClaw Wallet Management

**How it works:**
OpenClaw is extended to natively manage wallets for sub-agents. When a sub-agent is spawned, OpenClaw creates a wallet for it, stores the credentials in the agent's session context, and exposes wallet functions through the agent's tool interface.

**Complexity:** Very High
- Requires OpenClaw plugin development
- Wallet management is not currently in OpenClaw's feature set
- Would require significant architectural changes to OpenClaw core
- Not achievable in 30 days

**Security:** High
- Best UX: agent never exposes seeds, OpenClaw manages within its own process
- But: OpenClaw process compromise exposes all agent wallets

**Scalability:** High
- Built into the agent runtime

**Autonomy:** Highest
- Agent gets wallet as native part of its environment
- No external service needed

**Development effort:** Very High
- Months of work, possibly requiring OpenClaw maintainer involvement

**Verdict:** ❌ Right long-term solution, wrong short-term path

---

### Option D: Lightweight Wallet Provisioning Service

**How it works:**
A minimal REST service running on port 18090. It wraps `monero-wallet-rpc` for wallet creation. Agents call `POST /create-wallet` with a unique identifier. The service generates a new wallet, returns `{address, seed, view_key}` to the agent, and never stores the seed. The agent stores its own seed. The service manages wallet files with proper filesystem isolation.

**Complexity:** Low
- ~100-150 lines of Node.js or Python
- Single HTTP server, no database
- Runs alongside existing monero-wallet-rpc on the Mac Mini

**Security:** Medium-High
- Seed transmitted once, over TLS, to requesting agent only
- Wallet files isolated with filesystem permissions (chmod 700)
- Service credentials only allow wallet creation, not spending (limited RPC permissions)
- Agent stores seed in memory or encrypted local file, never in the service

**Scalability:** High for Phase 3
- Can handle dozens of agents on a single Mac Mini
- Each wallet is ~400KB
- 100 agents = ~40MB, well within Mac Mini storage

**Autonomy:** High
- Agent calls `POST /create-wallet` and receives keys
- Agent is the only party that ever knows the seed
- Agent publishes its own address to the registry
- Agent negotiates its own rate

**Development effort:** Low
- 1-2 days to build and test
- Can be built, deployed, and tested before any other work begins
- Validates the entire Level 3 stack end-to-end

**Verdict:** ✅ **Recommended solution — fastest path to Level 3**

---

## The Shortest Path: Option D — Wallet Provisioning Service

The entire Level 3 gap reduces to one missing component: **a service agents can call to create wallets**.

Every other human dependency in Level 2 — address publication, reputation initialization, agent discovery — can be solved with simple file-based systems once agents have autonomous wallet capability.

The wallet provisioning service is the **keystone capability**. Everything else follows from it.

---

## Level 3 Proof of Concept Design

### Success Criteria (All Must Pass)
- [ ] Agent B (worker) creates its own wallet via API call
- [ ] Agent B publishes its own address to the registry
- [ ] Agent B negotiates compensation (accepts task at its own rate)
- [ ] Agent A (buyer) posts task with budget, not fixed price
- [ ] Agent B completes work
- [ ] Agent A verifies work
- [ ] Agent A pays Agent B
- [ ] Agent B confirms receipt
- [ ] Both reputations update automatically
- [ ] **Zero human intervention after startup**

### Architecture

```
Agent A (Ghost, buyer)
  → POST /tasks {budget, task, requirements}
  → GET /registry → fetches Agent B address
  → Verifies deliverable
  → Calls transfer RPC → payment sent to Agent B

Agent B (worker, autonomous)
  → POST /create-wallet → receives {address, seed, view_key}
  → POST /registry {agent_id, address, capabilities, rate}
  → GET /tasks → finds available task
  → POST /tasks/{id}/accept {rate}
  → Completes task, posts deliverable
  → Receives payment
  → Confirms receipt

Wallet Provisioning Service (port 18090)
  → POST /create-wallet {agent_id}
  → Returns {address, seed, view_key} — one time only
  → Never stores seed

Agent Registry (file-based, /var/registry/)
  → /var/registry/agents.json
  → {agent_id, address, capabilities, rate, registered_at}

Task Queue (file-based, /var/tasks/)
  → /var/tasks/open/{task_id}.json
  → /var/tasks/claimed/{task_id}.json
  → /var/tasks/completed/{task_id}.json

Reputation Store (file-based, /var/reputation/)
  → /var/reputation/{agent_id}.json
  → {agent_id, score, tasks_completed, total_earned}
```

### Task Flow — Level 3

1. **Agent B boots** → calls `POST /create-wallet {agent_id: "clawbuddy-2"}`
2. **Provisioning service** → creates wallet, returns `{address, seed, view_key}` to Agent B
3. **Agent B** → stores seed securely (in memory, not on disk), publishes address to `/var/registry/agents.json`
4. **Agent A (Ghost)** → creates task `{budget: "0.05-0.1", task: "summarize this article"}`
5. **Agent A** → reads `/var/registry/agents.json`, finds Agent B's address
6. **Agent B** → polls `/var/tasks/open/`, finds task, accepts at its published rate
7. **Agent B** → completes task, writes deliverable to `/var/tasks/claimed/{id}/deliverable.json`
8. **Agent A** → verifies deliverable, calls transfer RPC to pay Agent B's address
9. **Agent B** → confirms receipt (checks wallet balance via RPC)
10. **Both agents** → reputation scores in `/var/reputation/` increment automatically

### What Changes From Level 2

| Step | Level 2 | Level 3 |
|------|---------|---------|
| Wallet creation | Human runs CLI | Agent calls `POST /create-wallet` |
| Address publication | Human types address into task | Agent publishes to registry |
| Task pricing | Human sets fixed price | Agent B publishes rate, Ghost sets budget |
| Negotiation | None | Agent B accepts if rate ≤ budget |
| Agent spawning | Human spawns sub-agent | Agent A calls agent factory |
| Discovery | Human tells worker where task is | Worker polls `/var/tasks/open/` |
| Reputation | Human updates log | System updates automatically |

---

## 30-Day Implementation Roadmap

**Theme: Autonomous Wallet Provisioning First**

### Week 1: Wallet Provisioning Service
**Goal:** Agent can create its own wallet without human involvement.

| Day | Task | Deliverable |
|-----|------|-------------|
| 1 | Design and implement `/create-wallet` REST endpoint | Running service on port 18090 |
| 2 | Add TLS, authentication (local only), error handling | Secure API |
| 3 | Test: agent calls API, receives seed, verifies wallet exists | Wallet file confirmed on disk |
| 4 | Test: verify agent can send XMR from self-created wallet | TX confirmed on-chain |
| 5 | Document API, write integration test | Working wallet provisioning |

**Deliverable:** Wallet provisioning API that agents can call and receive seeds. End of Week 1: agents can self-provision wallets.

### Week 2: Agent Registry + Task Queue
**Goal:** Agents can publish their addresses and discover work without human involvement.

| Day | Task | Deliverable |
|-----|------|-------------|
| 6 | Implement `/var/registry/agents.json` writer | Registry file updated |
| 7 | Implement task queue (`/var/tasks/open/`, `claimed/`, `completed/`) | Task files managed |
| 8 | Agent B publishes address to registry on wallet creation | Auto-publish working |
| 9 | Agent A reads registry, posts task with budget | Task posted automatically |
| 10 | Agent B polls queue, accepts task | Work self-selected |

**Deliverable:** File-based registry and task queue that agents manage without human intervention.

### Week 3: Payment + Reputation Automation
**Goal:** Payment flows automatically when work is verified.

| Day | Task | Deliverable |
|-----|------|-------------|
| 11 | Agent A fetches worker address from registry | Address lookup working |
| 12 | Agent B completes task, posts deliverable | Deliverable file written |
| 13 | Agent A verifies deliverable, releases payment | TX sent to worker address |
| 14 | Agent B confirms receipt via balance check | Receipt confirmed |
| 15 | Reputation store auto-increments on successful payment | Scores updated |

**Deliverable:** Full transaction loop — task posted to payment received — without human intervention.

### Week 4: Integration Testing + Documentation
**Goal:** Confirm Level 3 POC works end-to-end, document results.

| Day | Task | Deliverable |
|-----|------|-------------|
| 16-18 | Full end-to-end test: Agent A posts task, Agent B creates wallet, completes work, gets paid | Level 3 TX confirmed |
| 19 | Test with multiple agents (A→B→C chain) | Multi-agent test |
| 20 | Update website with Level 3 proof | Published evidence |
| 21 | Write Level 3 case study | `FIRST-AUTONOMOUS-EXCHANGE.md` v2 |

**Deliverable:** Level 3 demonstrated on mainnet. Results published.

---

## Recommendation

**This is the next action RentMyAI.ai should take:**

> Build the wallet provisioning service (Option D). It is a 1-2 day engineering task. It is the single change that removes the single largest remaining human dependency — wallet creation. Every other Level 3 requirement (address publication, agent discovery, reputation) can be built on top of it using simple file-based systems. The wallet provisioning service is the keystone. Everything else follows.

**Why not Moneropay?**
Moneropay is not designed for autonomous wallet self-provisioning. It would require significant rework. The wallet provisioning service is purpose-built, takes days instead of weeks, and directly solves the exact problem.

**Why not native OpenClaw wallet management?**
Long-term, OpenClaw native wallet management is the right architecture. But it requires plugin development and OpenClaw core changes that will take months. We need a working proof of concept now. Build the service, prove it works, then integrate it natively later.

**Why not wait for a better solution?**
The gap between Level 2 and Level 3 is one service. Every day without it is a day that agents cannot act as independent economic actors. The simplest solution that works is the right solution at this stage.

---

## Summary

| | |
|---|---|
| **Shortest path** | Build wallet provisioning service (Option D) |
| **Timeline** | 30 days |
| **Key unlock** | Agents create their own wallets, control their own seeds |
| **Secondary unlocks** | Address registry, task queue, automatic reputation |
| **Risk** | Low — service is simple, contained, no external dependencies |
| **Level 3 gate** | Wallet provisioning service |

**"The smallest step that transforms agents from participants in a system into independent economic actors is the ability to create and control their own wallets. Build that service. Everything else follows."**
