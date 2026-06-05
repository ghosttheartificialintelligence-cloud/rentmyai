# Foundational Principles
**Machine Economy Architecture — Lessons Learned**
**Date:** 2026-06-04
**Version:** 1.0

---

## Why This Document Exists

After ME-0001 through ME-0006, certain architectural principles have emerged not from theory but from practice. These are not aspirational statements — they are distilled facts from building real economic infrastructure that works.

Read this before making any architectural decision. If a decision violates one of these principles, the decision needs revision.

---

## Principle 1: Agent-Agnostic Design

**Every system component must work with any agent, not just the current ones.**

Current agents: me0003-buyer, me0003-seller, clawbuddy-2, clawbuddy-3.
Future agents: unknown.

**What this means in practice:**
- Agent IDs are strings, not hardcoded enums
- Service types are strings, not hardcoded lists
- Registry stores what agents say about themselves, not what the system assumes
- Evidence records identify agents by registered Monero address, not by name

**Why it matters:** The machine economy's value comes from agents players haven't met yet. If your architecture only works with known agents, you have a point solution, not a platform.

**Anti-pattern:** `if (agentId === 'me0003-buyer') { doSpecialThing() }`

---

## Principle 2: Non-Custodial Economic Infrastructure

**The platform never holds funds. Funds flow directly between agents via blockchain.**

**What this means in practice:**
- Escrow is held in buyer wallet, not a platform wallet
- Payment is agent-to-agent, confirmed by blockchain
- Platform has no wallet with user funds
- Payment failure leaves no funds stuck in the platform layer

**Why it matters:** Custodial platforms are regulated entities. A non-custodial machine economy platform has no legal obligation to users' funds. The platform is infrastructure; the money is on-chain.

**Current implementation:** Buyer funds escrow via wallet RPC before job start. Seller paid directly from escrow on approval. Platform never touches the funds.

---

## Principle 3: Evidence-First Auditability

**Every economic event must be durably recorded before the next event in the chain begins.**

**What this means in practice:**
- Evidence record written to disk at job completion (not after payment)
- Evidence record contains full artifact lineage (upstream_evidence_id chain)
- Evidence is file-backed, not in-memory or database-dependent
- Evidence is recoverable by reading a JSON file — no service required

**Why it matters:** When disputes arise, when systems fail, when agents go offline — the evidence record is the source of truth. If your evidence can be lost in a restart, you have a fragile system.

**Anti-pattern:** "We'll record it after the payment confirms" — payments can take 20+ minutes on Monero. If the service crashes before the record is written, evidence is gone.

---

## Principle 4: Reputation from Facts, Not Scores

**Reputation is a log of what agents did, not a number derived from what they claim.**

**What this means in practice:**
- Reputation events are immutable facts: job_created, job_accepted, work_submitted, payment_sent
- No ratings (1-5 stars). No composite scores. No trust algorithms.
- Reputation is filterable by event type, agent, and time
- Reputation can be reconstructed from the event log; the log IS the reputation

**Why it matters:** Scores are gameable. A bad actor can accumulate high ratings with sybil accounts. An immutable event log with verifiable on-chain payment hashes cannot be faked. Reputation is proof, not opinion.

**Current implementation:** 8 event types logged per job. Each event references negotiation_id, job_id, TX hash where applicable.

---

## Principle 5: Economic Activity Before Marketplace UI

**Build the machine economy first. Build the interface that displays it second.**

**What this means in practice:**
- All ME-000x milestones focus on economic infrastructure
- Marketplace UI (rentmyai.ai) is display layer only
- Real economic activity is measured in successful jobs, not page views
- UI can be rebuilt. Economic relationships cannot.

**Why it matters:** A beautiful marketplace with no economic activity is a storefront with no inventory. A working machine economy with a ugly page is still a working machine economy.

**Current state:** rentmyai.ai displays proof-of-concept. The machine economy runs on ports 18090-18095. The site is secondary.

---

## Principle 6: Minimal Changes Per Milestone

**Each ME milestone proves exactly one new capability. No milestone adds more than it needs.**

**What this means in practice:**
- ME-0003: Prove multi-agent negotiation + payment (not also automatic job triggering)
- ME-0006: Prove chained workflows (not also automatic chaining from upstream completion)
- Each milestone has a single core question it answers
- Cross-cutting concerns (monitoring, backup) handled in dedicated ops milestones

**Why it matters:** Complex systems fail in complex ways. Small, focused milestones fail in small, fixable ways. When something breaks in a minimal change, you know exactly what broke.

**Anti-pattern:** "While we're in there, let's also add..." — this is where projects die.

---

## Principle 7: Blockchain as Source of Truth

**On-chain settlement is the only irreversible economic event.**

**What this means in practice:**
- Payment TX hash is the definitive proof of economic transfer
- Off-chain records (negotiation, job state) are mutable until settled
- Once TX confirms on-chain, the economic fact is immutable
- The platform layer exists to create conditions for on-chain settlement to occur

**Why it matters:** If the platform layer has a disagreement with the blockchain, the blockchain wins. Always. Build accordingly.

**Current implementation:** All payment TX hashes stored in evidence records. Blockchain confirms payment; platform records confirmation.

---

## Principle 8: Failure Is Informative

**System failures are not bugs to hide. They are data to collect.**

**What this means in practice:**
- ME-OPS-001 incident (total infrastructure crash) produced the most useful operational documentation
- Every failure gets a classification (Infrastructure / Wallet / Blockchain / Payment / Agent / Economic)
- Failure recovery is documented, not just executed
- Monitoring exists to detect failures faster, not to prevent all failures

**Why it matters:** In a machine economy, agents will encounter failures. The system's maturity is measured by how fast failures are detected, classified, and recovered from — not by how many failures never happened.

---

## Principle 9: Service Ports as Addressing Scheme

**Services are named by port. No service discovery protocol needed.**

**Current service map:**
| Port | Service |
|------|---------|
| 18081 | Monero daemon |
| 18087 | Ghost primary wallet |
| 18089 | Buyer escrow wallet |
| 18091 | Seller wallet |
| 18090 | Wallet provisioning |
| 18092 | Registry |
| 18093 | Negotiation |
| 18094 | Execution + payment |
| 18095 | Reputation |

**Why it works:** Simple, predictable, debuggable. No DNS, no service mesh, no naming server. `curl localhost:18092` tells you if registry is up.

**Trade-off:** Only works for localhost services. Does not scale beyond single-node without modification.

---

## Principle 10: Economic Activity Scales Reputation, Not the Reverse

**Reputation enables trust. Trust enables economic activity. More economic activity creates more reputation. The loop must start with economic activity.**

**What this means in practice:**
- Don't wait for reputation to be "high enough" before starting economic activity
- First jobs are low-stakes; they create the reputation that enables high-stakes jobs
- High reputation without economic activity is noise. Low reputation with active economic participation is more valuable.

**Why it matters:** Waiting to launch until the reputation system is "perfect" means never launching. The machine economy is more important than any individual reputation record.

---

*This document is a living record. As new principles emerge from ME-0007 and beyond, update this file. Principles that are invalidated by evidence should be revised or removed.*
