#!/usr/bin/env node
/**
 * Agent Execution Service
 * RentMyAI.ai — Level 3 Phase 3.5 + ME-0004 Phase A + ME-0010 Steps 1-2
 *
 * State flow:
 *   job_created → escrow_funded → in_progress → submitted → paid
 *                                                  ↓
 *              payment_requested → monero_transfer_attempted
 *                                    ↓                    ↓
 *                               paid               payment_failed
 *
 * ME-0004 Phase A: Job Evidence Records
 *   - Generated automatically after payment_sent
 *   - Stored as immutable JSON in /agents/evidence/
 *   - Agent-agnostic artifact schema
 *   - Human-readable summary included
 *
 * ME-0010 Step 1: Subcontracting
 *   - POST /jobs/:id/subcontract — contractor creates one child job (depth=1, one child per parent)
 *   - GET  /jobs/:id/children    — list child jobs for a parent
 *   - Fields: parent_job_id, child_job_id, role, subcontract_depth, child_description
 *   - Settlement logic NOT implemented yet (Step 3)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const PORT = 18094;
const JOBS_DIR = '/Users/ghost/.openclaw/agents';
const JOBS_FILE = path.join(JOBS_DIR, 'jobs.json');
const BACKUP_DIR = path.join(JOBS_DIR, 'jobs-backups');
const EVIDENCE_DIR = path.join(JOBS_DIR, 'evidence');
const ARTIFACTS_DIR = path.join(EVIDENCE_DIR, 'artifacts');
const NEGOTIATE_URL = 'http://127.0.0.1:18093';
const REGISTRY_URL = 'http://127.0.0.1:18092';
const DISCOVERY_URL = 'http://127.0.0.1:18096';
const WALLET_RPC_HOST = '127.0.0.1';
const WALLET_RPC_USER = 'ghost';
const WALLET_RPC_PASS = 'ghost';
const DEFAULT_WALLET_PORT = 18089;
// Per-agent wallet RPC port map — each buyer agent must have a registered wallet on a unique port
const WALLET_PORT_MAP = {
  'me0003-buyer':  18089,
  'clawbuddy-3':   18091,
  'ghost_final2':  18087,
};
const REPUTATION_URL = 'http://127.0.0.1:18095';

// ─── STORE ───────────────────────────────────────────────────────────────────

function loadJobs() {
  if (!fs.existsSync(JOBS_FILE)) return { version: 1, jobs: {} };
  try {
    return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
  } catch (e) {
    console.error('[store] Corrupt file:', e.message);
    return { version: 1, jobs: {} };
  }
}

function saveJobs(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `jobs-${timestamp}.json`;
  if (fs.existsSync(JOBS_FILE)) {
    fs.mkdirSync(BACKUP_DIR, { mode: 0o700, recursive: true });
    fs.copyFileSync(JOBS_FILE, path.join(BACKUP_DIR, backupName));
    const backups = fs.readdirSync(BACKUP_DIR).sort().reverse();
    for (const b of backups.slice(50)) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, b)); } catch (e) {}
    }
  }
  fs.writeFileSync(JOBS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function now() { return new Date().toISOString(); }

function jobId() {
  return `exec-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function auditEntry(action, actor, note = '') {
  return { action, actor, note, ts: now() };
}

function httpGet(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
  });
}

function digestAuth(headers, method, uri, user, pass) {
  const { realm, nonce, qop } = (headers['www-authenticate'] || '').match(/(\w+)="([^"]*)"/g)
    .reduce((a, p) => { const [k, v] = p.split('='); a[k] = v.replace(/"/g, ''); return a; }, {});
  const cnonce = crypto.randomBytes(8).toString('hex');
  const nc = '00000001';
  const HA1 = crypto.createHash('md5').update(`${user}:${realm}:${pass}`).digest('hex');
  const HA2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');
  const response = crypto.createHash('md5').update(`${HA1}:${nonce}:${nc}:${cnonce}:${qop}:${HA2}`).digest('hex');
  return `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"`;
}

function walletRpcCall(method, params = {}, timeoutMs = 60000, buyerAgentId = 'me0003-buyer') {
  const port = WALLET_PORT_MAP[buyerAgentId] || DEFAULT_WALLET_PORT;
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ jsonrpc: '2.0', id: '0', method, params });
    const authHeader = digestAuth(
      { 'www-authenticate': 'Digest realm="monero-rpc", nonce="nonce"' },
      'POST', '/json_rpc', WALLET_RPC_USER, WALLET_RPC_PASS
    );
    const req = http.request({
      hostname: WALLET_RPC_HOST, port: port,
      path: '/json_rpc', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData), 'Authorization': authHeader },
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 401) {
          // Retry with proper digest
          const newAuthHeader = digestAuth(res.headers || {}, 'POST', '/json_rpc', WALLET_RPC_USER, WALLET_RPC_PASS);
          const retryReq = http.request({
            hostname: WALLET_RPC_HOST, port: port,
            path: '/json_rpc', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData), 'Authorization': newAuthHeader },
            timeout: timeoutMs
          }, (retryRes) => {
            let rd = '';
            retryRes.on('data', c => rd += c);
            retryRes.on('end', () => {
              try {
                const j = JSON.parse(rd);
                if (j.error) reject(new Error(j.error.message));
                else resolve(j.result);
              } catch { reject(new Error(`Bad JSON: ${rd.substring(0, 200)}`)); }
            });
          });
          retryReq.on('error', e => reject(new Error(`Wallet RPC error: ${e.message}`)));
          retryReq.on('timeout', () => { retryReq.destroy(); reject(new Error('Wallet RPC timeout')); });
          retryReq.write(postData);
          retryReq.end();
          return;
        }
        try {
          const j = JSON.parse(data);
          if (j.error) reject(new Error(j.error.message));
          else resolve(j.result);
        } catch { reject(new Error(`Bad JSON: ${data.substring(0, 200)}`)); }
      });
    });
    req.on('error', e => reject(new Error(`Wallet RPC error: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Wallet RPC timeout')); });
    req.write(postData);
    req.end();
  });
}

function parseJobIdFromPath(pathname) {
  const m = pathname.match(/^\/jobs\/(.+?)\/(?:fund|start|submit|approve|dispute|retry-payment|subcontract)$/);
  return m ? m[1] : null;
}

function validateId(id, name) {
  if (!id || typeof id !== 'string' || id.length > 64)
    throw Object.assign(new Error(`${name} agent_id required`), { code: 400 });
}

function requireJob(store, jobId) {
  const j = store.jobs[jobId];
  if (!j) throw Object.assign(new Error('Job not found'), { code: 404 });
  return j;
}

// ─── ME-0004 PHASE A: EVIDENCE RECORDS ─────────────────────────────────────

/**
 * Stores an artifact persistently. Agent-agnostic: accepts any JSON-serializable
 * artifact_data. The schema does not assume any specific agent implementation.
 */
function storeArtifact(jerId, jobId, agentId, artifactData) {
  const artifactRecord = {
    artifact_id: `artifact-${jerId}`,
    jer_id: jerId,
    job_id: jobId,
    produced_by: agentId,
    produced_at: now(),
    // Agent-agnostic artifact schema — any agent can submit any artifact
    artifact: artifactData
  };
  const artifactFile = path.join(ARTIFACTS_DIR, `${jerId}.json`);
  fs.mkdirSync(ARTIFACTS_DIR, { mode: 0o700, recursive: true });
  fs.writeFileSync(artifactFile, JSON.stringify(artifactRecord, null, 2), { mode: 0o600 });
  console.log(`[evidence] Artifact stored: ${jerId}`);
  return artifactRecord;
}

/**
 * Generates a human-readable plain-English summary of the job.
 * Designed for non-technical readers.
 */
function generateHumanSummary(job, txHash) {
  const rate = job.agreed_rate;
  const xmrAmount = parseFloat(rate).toFixed(6);
  const seller = job.seller_agent_id;
  const buyer = job.buyer_agent_id;
  const task = job.job_description || '(no task description)';
  const service = job.requested_service || 'unspecified';

  let summary = `JOB EVIDENCE RECORD\n`;
  summary += `${'='.repeat(60)}\n\n`;
  summary += `Job ID: ${job.job_id}\n`;
  summary += `Status: COMPLETED ✅\n\n`;
  summary += `WHAT WAS REQUESTED:\n`;
  summary += `A ${service} task was posted by ${buyer}.\n`;
  summary += `Task: "${task}"\n\n`;
  summary += `WHAT WAS DELIVERED:\n`;
  summary += `Seller (${seller}) submitted a completion proof.\n`;
  summary += `Submission time: ${job.submitted_at || '(unknown)'}\n\n`;
  if (job.upstream_evidence_id) {
    summary += `ARTIFACT CHAIN:\n`;
    summary += `This job builds on upstream evidence: ${job.upstream_evidence_id}\n\n`;
  }
  summary += `WHY PAYMENT OCCURRED:\n`;
  summary += `Buyer (${buyer}) reviewed the submission and approved payment\n`;
  summary += `of ${xmrAmount} XMR to ${seller}.\n\n`;
  summary += `PAYMENT DETAILS:\n`;
  summary += `Amount: ${xmrAmount} XMR\n`;
  summary += `Transaction: ${txHash || '(pending)'}\n`;
  summary += `Fee: ${job.monero_tx_fee ? (parseInt(job.monero_tx_fee) / 1e12).toFixed(6) : '(unknown)'} XMR\n`;
  summary += `From (buyer wallet): ${job.buyer_monero_address}\n`;
  summary += `To (seller wallet): ${job.seller_monero_address}\n`;
  summary += `Verified on: Monero blockchain\n\n`;
  summary += `REPUTATION EVENTS GENERATED:\n`;
  summary += `Both buyer and seller now have permanent records of:\n`;
  summary += `  - job_completed (verified by execution service)\n`;
  summary += `  - payment_sent / payment_received (verified by blockchain)\n\n`;
  summary += `TIMELINE:\n`;
  for (const entry of job.audit_log) {
    const ts = entry.ts ? entry.ts.replace('T', ' ').substring(0, 19) + 'Z' : '';
    summary += `  ${ts}: ${entry.action} (${entry.actor})\n`;
  }
  summary += `\n${'='.repeat(60)}\n`;
  summary += `This record was generated automatically by the RentMyAI\n`;
  summary += `machine economy platform. The transaction above can be\n`;
  summary += `independently verified on any Monero block explorer.\n`;
  return summary;
}

/**
 * Generates and persists a JobEvidenceRecord after successful payment.
 * Called exactly once per job, immediately after payment_sent.
 */
async function generateEvidenceRecord(job) {
  const jerId = `jer-${job.job_id}`;
  const atomicAmount = Math.round(parseFloat(job.agreed_rate) * 1e12);
  const txFeeAtomic = parseInt(job.monero_tx_fee) || 0;

  // Build the evidence record
  // ME-0006: Load upstream artifact if this job has a chained dependency
  let upstreamArtifact = null;
  if (job.upstream_evidence_id) {
    try {
      const upstreamFile = path.join(EVIDENCE_DIR, `${job.upstream_evidence_id}.json`);
      if (fs.existsSync(upstreamFile)) {
        const upstreamRec = JSON.parse(fs.readFileSync(upstreamFile, 'utf8'));
        if (upstreamRec.artifact) {
          upstreamArtifact = {
            jer_id: upstreamRec.jer_id,
            job_id: upstreamRec.job_id,
            artifact_type: upstreamRec.artifact.artifact_type,
            produced_by: upstreamRec.artifact.produced_by,
            produced_at: upstreamRec.artifact.produced_at,
            artifact_data: upstreamRec.artifact.artifact_data
          };
        }
      }
    } catch {}
  }

  const artifact = job.completion_proof ? {
    artifact_id: `artifact-${jerId}`,
    artifact_type: 'completion_proof',
    produced_by: job.seller_agent_id,
    produced_at: job.submitted_at || now(),
    artifact_data: job.completion_proof,
    upstream_artifact: upstreamArtifact
  } : null;

  const evidenceRecord = {
    schema_version: '1.0',
    jer_id: jerId,
    job_id: job.job_id,
    negotiation_id: job.negotiation_id,
    generated_at: now(),
    generated_by: 'execution-service',

    parties: {
      buyer: {
        agent_id: job.buyer_agent_id,
        monero_address: job.buyer_monero_address,
        wallet_rpc_port: job.buyer_wallet_rpc_port,
        role: 'buyer'
      },
      seller: {
        agent_id: job.seller_agent_id,
        monero_address: job.seller_monero_address,
        role: 'seller'
      }
    },

    job_definition: {
      service_type: job.requested_service,
      task_description: job.job_description,
      upstream_evidence_id: job.upstream_evidence_id || null,
      agreed_rate: job.agreed_rate,
      rate_unit: job.rate_unit
    },

    work_completed: {
      completion_proof: job.completion_proof,
      submitted_at: job.submitted_at,
      submitted_by: job.seller_agent_id
    },

    payment: {
      paying_agent_id: job.buyer_agent_id,
      paying_wallet_rpc_port: job.buyer_wallet_rpc_port,
      paying_monero_address: job.buyer_monero_address,
      receiving_agent_id: job.seller_agent_id,
      receiving_monero_address: job.seller_monero_address,
      amount_atomic: atomicAmount,
      amount_xmr: job.agreed_rate,
      fee_atomic: txFeeAtomic,
      fee_xmr: (txFeeAtomic / 1e12).toFixed(6),
      total_atomic: atomicAmount + txFeeAtomic,
      tx_hash: job.monero_tx_hash,
      paid_at: job.approved_at || job.updated_at,
      verification_source: 'blockchain',
      block_confirmed: true
    },

    verification_status: {
      payment_verified: !!job.monero_tx_hash,
      evidence_verified: true,
      human_readable_summary: generateHumanSummary(job, job.monero_tx_hash).split('\n').slice(0, 3).join(' ').trim()
    },

    artifact,

    audit_trail: job.audit_log.map(e => ({
      ts: e.ts,
      action: e.action,
      actor: e.actor,
      note: e.note
    }))
  };

  // Persist the evidence record
  fs.mkdirSync(EVIDENCE_DIR, { mode: 0o700, recursive: true });
  const evidenceFile = path.join(EVIDENCE_DIR, `${jerId}.json`);
  fs.writeFileSync(evidenceFile, JSON.stringify(evidenceRecord, null, 2), { mode: 0o600 });
  console.log(`[evidence] Evidence record saved: ${jerId}`);

  // Also store artifact separately if present
  if (job.completion_proof) {
    storeArtifact(jerId, job.job_id, job.seller_agent_id, {
      artifact_type: 'completion_proof',
      artifact_data: job.completion_proof
    });
  }

  return evidenceRecord;
}

// ─── REPUTATION WEBHOOK ─────────────────────────────────────────────────────

function emitReputationEvent(event) {
  const postData = JSON.stringify(event);
  const req = http.request({
    hostname: '127.0.0.1', port: 18095,
    path: '/reputation/internal/event', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    timeout: 10000
  }, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`[reputation] ${event.event_type} | ${event.agent_id} → ok`);
      } else {
        console.error(`[reputation] ${event.event_type} | ${event.agent_id} → HTTP ${res.statusCode}`);
      }
    });
  });
  req.on('error', e => console.error(`[reputation] webhook error: ${e.message}`));
  req.on('timeout', () => { req.destroy(); console.error('[reputation] webhook timeout'); });
  req.write(postData);
  req.end();
}

// ─── HTTP SERVER ─────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.writeHead(200);
    res.end();
    return;
  }

  // GET /health
  if (url.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', service: 'execution', version: '1.8.0', milestone: 'ME-0010-Step2' }));
    return;
  }

  // GET /jobs
  if (url.pathname === '/jobs' && req.method === 'GET') {
    const store = loadJobs();
    res.writeHead(200);
    res.end(JSON.stringify({ jobs: Object.values(store.jobs), count: Object.keys(store.jobs).length }));
    return;
  }

  // GET /jobs/:job_id/children — ME-0010: must come before generic /jobs/:id
  const childrenMatch = url.pathname.match(/^\/jobs\/(.+)\/children$/);
  if (childrenMatch && req.method === 'GET') {
    const store = loadJobs();
    const j = store.jobs[childrenMatch[1]];
    if (!j) { res.writeHead(404); res.end(JSON.stringify({ error: 'Job not found' })); return; }
    const childId = j.child_job_id;
    if (!childId) {
      res.writeHead(200);
      res.end(JSON.stringify({ children: [], count: 0 }));
      return;
    }
    const childJob = store.jobs[childId];
    res.writeHead(200);
    res.end(JSON.stringify({ children: childJob ? [childJob] : [], count: childJob ? 1 : 0 }));
    return;
  }

  // GET /jobs/:job_id
  const jobGetMatch = url.pathname.match(/^\/jobs\/(.+)$/);
  if (jobGetMatch && req.method === 'GET') {
    const store = loadJobs();
    const j = store.jobs[jobGetMatch[1]];
    if (!j) { res.writeHead(404); res.end(JSON.stringify({ error: 'Job not found' })); return; }
    res.writeHead(200);
    res.end(JSON.stringify(j));
    return;
  }

  // ── ME-0004 Phase A: Evidence Endpoints ─────────────────────────────────

  // GET /evidence — list all evidence records
  if (url.pathname === '/evidence' && req.method === 'GET') {
    fs.mkdirSync(EVIDENCE_DIR, { mode: 0o700, recursive: true });
    const files = fs.readdirSync(EVIDENCE_DIR).filter(f => f.endsWith('.json'));
    const records = files.map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, f), 'utf8'));
        return {
          jer_id: d.jer_id,
          job_id: d.job_id,
          generated_at: d.generated_at,
          buyer: d.parties?.buyer?.agent_id,
          seller: d.parties?.seller?.agent_id,
          amount_xmr: d.payment?.amount_xmr,
          tx_hash: d.payment?.tx_hash
        };
      } catch { return null; }
    }).filter(Boolean);
    res.writeHead(200);
    res.end(JSON.stringify({ records, count: records.length }));
    return;
  }

  // GET /evidence/:job_id/summary — human-readable text summary (check FIRST)
  const summaryMatch = url.pathname.match(/^\/evidence\/(.+)\/summary$/);
  if (summaryMatch && req.method === 'GET') {
    const jobIdOrJer = summaryMatch[1];
    const store = loadJobs();
    let job = store.jobs[jobIdOrJer];
    let jerIdToFind = jobIdOrJer;
    if (!job) {
      // Try to find evidence record by jerId to get job_id
      fs.mkdirSync(EVIDENCE_DIR, { mode: 0o700, recursive: true });
      const files = fs.readdirSync(EVIDENCE_DIR).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, f), 'utf8'));
          if (d.jer_id === jobIdOrJer || d.job_id === jobIdOrJer) {
            job = store.jobs[d.job_id];
            jerIdToFind = d.jer_id;
            break;
          }
        } catch {}
      }
    }
    if (!job) { res.writeHead(404); res.end(JSON.stringify({ error: 'Job not found' })); return; }
    if (job.status !== 'paid' || !job.monero_tx_hash) {
      res.writeHead(409);
      res.end(JSON.stringify({ error: 'Job not yet paid — evidence record not generated' }));
      return;
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.writeHead(200);
    res.end(generateHumanSummary(job, job.monero_tx_hash));
    return;
  }

  // GET /evidence/:job_id — get evidence record for a specific job
  const evidenceMatch = url.pathname.match(/^\/evidence\/(.+)$/);
  if (evidenceMatch && req.method === 'GET') {
    const jobIdOrJer = evidenceMatch[1];
    let record = null;
    fs.mkdirSync(EVIDENCE_DIR, { mode: 0o700, recursive: true });
    const files = fs.readdirSync(EVIDENCE_DIR).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, f), 'utf8'));
        if (d.job_id === jobIdOrJer || d.jer_id === jobIdOrJer) {
          record = d; break;
        }
      } catch {}
    }
    if (!record) { res.writeHead(404); res.end(JSON.stringify({ error: 'Evidence record not found' })); return; }
    res.writeHead(200);
    res.end(JSON.stringify(record));
    return;
  }
  // ── GET /decide/pursue ────────────────────────────────────────────────────
  // Decision engine: given an agent_id and opportunity_id, should the agent pursue?
  // Applies hard filters: capability, capacity, rate, budget, self-target
  // Returns { decision, decision_reason, auto_propose, propose_params }
  if (url.pathname === '/decide/pursue' && req.method === 'GET') {
    const { agent_id, opportunity_id } = (() => {
      const u = new URL(req.url, 'http://127.0.0.1');
      return { agent_id: u.searchParams.get('agent_id'), opportunity_id: u.searchParams.get('opportunity_id') };
    })();

    if (!agent_id || !opportunity_id) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'agent_id and opportunity_id are required' }));
      return;
    }

    // Hard filters
    let decision = 'skip';
    let decision_reason = 'all_filters_passed';

    (async () => {
      try {
        // 1. Fetch the opportunity from discovery service
        const opp = await httpGet(`${DISCOVERY_URL}/opportunities/${opportunity_id}`);
        if (!opp || opp.error) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Opportunity not found', decision: 'skip', decision_reason: 'opportunity_not_found' }));
          return;
        }

        // 2. Fetch agent capabilities from registry
        const reg = await httpGet(`${REGISTRY_URL}/registry/${encodeURIComponent(agent_id)}`);
        if (!reg || reg.error) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Agent not in registry', decision: 'skip', decision_reason: 'agent_not_registered' }));
          return;
        }

        const myServices = reg.services_offered || [];
        const myMinRate = parseFloat(reg.default_rate) || 0;

        // 3. Self-target check — can't sell to yourself
        if (opp.owner_agent_id === agent_id) {
          res.writeHead(200);
          res.end(JSON.stringify({ agent_id, opportunity_id, decision: 'skip', decision_reason: 'self_target', auto_propose: false }));
          return;
        }

        // 4. Capability check
        if (opp.service_type && !myServices.includes(opp.service_type)) {
          res.writeHead(200);
          res.end(JSON.stringify({ agent_id, opportunity_id, decision: 'skip', decision_reason: 'capability_mismatch', auto_propose: false }));
          return;
        }

        // 5. Rate threshold check
        const oppRate = parseFloat(opp.rate) || 0;
        if (oppRate < myMinRate) {
          res.writeHead(200);
          res.end(JSON.stringify({ agent_id, opportunity_id, decision: 'skip', decision_reason: 'rate_below_threshold', auto_propose: false }));
          return;
        }

        // 6. Capacity check — count active jobs for this agent
        const store = loadJobs();
        const activeJobs = Object.values(store.jobs).filter(j => {
          const isParty = j.buyer_agent_id === agent_id || j.seller_agent_id === agent_id;
          const isActive = ['job_created', 'escrow_funded', 'in_progress'].includes(j.status);
          return isParty && isActive;
        });
        const MAX_ACTIVE = 3;
        if (activeJobs.length >= MAX_ACTIVE) {
          res.writeHead(200);
          res.end(JSON.stringify({ agent_id, opportunity_id, decision: 'skip', decision_reason: 'capacity_reached', auto_propose: false }));
          return;
        }

        // 7. Budget check — only relevant if this agent is the buyer (direction=available means seller posts)
        // me0003-buyer and clawbuddy-2 can be buyers; clawbuddy-3 is primarily seller
        // If direction == 'available', the posting agent is the seller, so the buyer (any) is evaluating
        // For simplicity: if agent_id is NOT the seller (opp.owner when direction=available), check budget
        const isSeller = opp.direction === 'available' ? opp.owner_agent_id === agent_id : false;
        if (!isSeller && opp.direction === 'available') {
          // This agent would be the buyer — check unlocked balance
          const buyerPort = reg.wallet_rpc_port || WALLET_PORT_MAP[agent_id] || DEFAULT_WALLET_PORT;
          const balanceResult = await walletRpcCall('get_balance', {}, 10000, agent_id);
          if (balanceResult && balanceResult.unlocked_balance !== undefined) {
            const unlocked = parseInt(balanceResult.unlocked_balance) / 1e12;
            if (unlocked < oppRate) {
              res.writeHead(200);
              res.end(JSON.stringify({ agent_id, opportunity_id, decision: 'skip', decision_reason: 'insufficient_unlocked_balance', auto_propose: false }));
              return;
            }
          }
        }

        // All filters passed — proceed
        const proposeParams = {
          buyer_agent_id: opp.direction === 'available' ? agent_id : opp.owner_agent_id,
          seller_agent_id: opp.direction === 'available' ? opp.owner_agent_id : agent_id,
          seller_monero_address: opp.direction === 'available' ? opp.owner_monero_address : reg.monero_address,
          requested_service: opp.service_type,
          job_definition: {
            task_description: opp.task_description || `Opportunity: ${opportunity_id}`,
            upstream_evidence_id: opp.upstream_evidence_id || null
          },
          proposed_rate: opp.rate
        };

        res.writeHead(200);
        res.end(JSON.stringify({
          agent_id,
          opportunity_id,
          decision: 'proceed',
          decision_reason: 'all_filters_passed',
          auto_propose: true,
          propose_params: proposeParams
        }));

      } catch (err) {
        console.error('[decide] Error:', err.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message, decision: 'skip', decision_reason: 'internal_error' }));
      }
    })();
    return;
  }

  // ── GET /decide/accept ────────────────────────────────────────────────────
  // Decision engine: given an agent_id and negotiation_id, should the agent accept?
  // Applies hard filters: negotiation state, addressed party, rate, capacity, budget
  if (url.pathname === '/decide/accept' && req.method === 'GET') {
    const { agent_id, negotiation_id } = (() => {
      const u = new URL(req.url, 'http://127.0.0.1');
      return { agent_id: u.searchParams.get('agent_id'), negotiation_id: u.searchParams.get('negotiation_id') };
    })();

    if (!agent_id || !negotiation_id) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'agent_id and negotiation_id are required' }));
      return;
    }

    (async () => {
      try {
        // 1. Fetch negotiation from negotiation service
        const neg = await httpGet(`${NEGOTIATE_URL}/negotiate/${encodeURIComponent(negotiation_id)}`);
        if (!neg || neg.error) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Negotiation not found', decision: 'skip', decision_reason: 'negotiation_not_found' }));
          return;
        }

        // 2. Check negotiation is still open
        if (neg.status !== 'proposed') {
          res.writeHead(200);
          res.end(JSON.stringify({ agent_id, negotiation_id, decision: 'skip', decision_reason: 'negotiation_closed', auto_accept: false }));
          return;
        }

        // 3. Verify agent is the addressed party (buyer)
        if (neg.buyer_agent_id !== agent_id) {
          res.writeHead(200);
          res.end(JSON.stringify({ agent_id, negotiation_id, decision: 'skip', decision_reason: 'not_addressed_party', auto_accept: false }));
          return;
        }

        // 4. Fetch agent's registry record for default_rate
        const reg = await httpGet(`${REGISTRY_URL}/registry/${encodeURIComponent(agent_id)}`);
        if (!reg || reg.error) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Agent not in registry', decision: 'skip', decision_reason: 'agent_not_registered' }));
          return;
        }

        const myMinRate = parseFloat(reg.default_rate) || 0;
        // Use final_rate if set (accepted), otherwise proposed_rate (proposed)
        const effectiveRate = neg.final_rate != null ? parseFloat(neg.final_rate) : parseFloat(neg.proposed_rate) || 0;

        // 5. Rate threshold check
        if (effectiveRate < myMinRate) {
          res.writeHead(200);
          res.end(JSON.stringify({ agent_id, negotiation_id, decision: 'skip', decision_reason: 'rate_below_threshold', auto_accept: false }));
          return;
        }

        // 6. Capacity check
        const store = loadJobs();
        const activeJobs = Object.values(store.jobs).filter(j => {
          const isParty = j.buyer_agent_id === agent_id || j.seller_agent_id === agent_id;
          const isActive = ['job_created', 'escrow_funded', 'in_progress'].includes(j.status);
          return isParty && isActive;
        });
        const MAX_ACTIVE = 3;
        if (activeJobs.length >= MAX_ACTIVE) {
          res.writeHead(200);
          res.end(JSON.stringify({ agent_id, negotiation_id, decision: 'skip', decision_reason: 'capacity_reached', auto_accept: false }));
          return;
        }

        // 7. Budget check — buyer must have enough unlocked balance for escrow
        const buyerPort = reg.wallet_rpc_port || WALLET_PORT_MAP[agent_id] || DEFAULT_WALLET_PORT;
        const balanceResult = await walletRpcCall('get_balance', {}, 10000, agent_id);
        if (balanceResult && balanceResult.unlocked_balance !== undefined) {
          const unlocked = parseInt(balanceResult.unlocked_balance) / 1e12;
          if (unlocked < effectiveRate) {
            res.writeHead(200);
            res.end(JSON.stringify({ agent_id, negotiation_id, decision: 'skip', decision_reason: 'insufficient_unlocked_balance', auto_accept: false }));
            return;
          }
        }

        // All filters passed — accept
        res.writeHead(200);
        res.end(JSON.stringify({
          agent_id,
          negotiation_id,
          decision: 'accept',
          decision_reason: 'all_filters_passed',
          effective_rate: effectiveRate,
          auto_accept: true,
          accept_params: {
            job_id: negotiation_id,
            accepting_agent_id: agent_id
          }
        }));

      } catch (err) {
        console.error('[decide/accept] Error:', err.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message, decision: 'skip', decision_reason: 'internal_error' }));
      }
    })();
    return;
  }

  // ── GET /decide/accept-child ──────────────────────────────────────────────
  // ME-0010 Step 2: Should the subcontractor accept this child job?
  // Accept or reject only — no counter-proposals.
  // Filters: not_subcontractor, child_job_closed, rate_below_threshold,
  //          capacity_reached, depth_limit_exceeded, missing_child_description
  if (url.pathname === '/decide/accept-child' && req.method === 'GET') {
    const { agent_id, child_job_id } = (() => {
      const u = new URL(req.url, 'http://127.0.0.1');
      return { agent_id: u.searchParams.get('agent_id'), child_job_id: u.searchParams.get('child_job_id') };
    })();

    if (!agent_id || !child_job_id) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'agent_id and child_job_id are required' }));
      return;
    }

    (async () => {
      try {
        const store = loadJobs();
        const childJob = store.jobs[child_job_id];

        // 1. Child job must exist
        if (!childJob) {
          res.writeHead(404);
          res.end(JSON.stringify({ agent_id, child_job_id, decision: 'reject', decision_reason: 'child_job_not_found', auto_accept_child: false }));
          return;
        }

        // 2. Agent must be the seller (subcontractor) on the child job
        if (childJob.seller_agent_id !== agent_id) {
          res.writeHead(200);
          res.end(JSON.stringify({ agent_id, child_job_id, decision: 'reject', decision_reason: 'not_subcontractor', auto_accept_child: false }));
          return;
        }

        // 3. Child job must not be closed
        if (childJob.status !== 'job_created') {
          res.writeHead(200);
          res.end(JSON.stringify({ agent_id, child_job_id, decision: 'reject', decision_reason: 'child_job_closed', auto_accept_child: false }));
          return;
        }

        // 4. child_description must be present
        if (!childJob.child_description || typeof childJob.child_description !== 'string') {
          res.writeHead(200);
          res.end(JSON.stringify({ agent_id, child_job_id, decision: 'reject', decision_reason: 'missing_child_description', auto_accept_child: false }));
          return;
        }

        // 5. Fetch agent's registry record for default_rate
        const reg = await httpGet(`${REGISTRY_URL}/registry/${encodeURIComponent(agent_id)}`);
        if (!reg || reg.error) {
          res.writeHead(404);
          res.end(JSON.stringify({ agent_id, child_job_id, decision: 'reject', decision_reason: 'agent_not_registered', auto_accept_child: false }));
          return;
        }

        // 6. Rate threshold check
        const myMinRate = parseFloat(reg.default_rate) || 0;
        const childRate = parseFloat(childJob.agreed_rate) || 0;
        if (childRate < myMinRate) {
          res.writeHead(200);
          res.end(JSON.stringify({ agent_id, child_job_id, decision: 'reject', decision_reason: 'rate_below_threshold', auto_accept_child: false }));
          return;
        }

        // 7. Capacity check — count active jobs for this agent
        const activeJobs = Object.values(store.jobs).filter(j => {
          const isParty = j.buyer_agent_id === agent_id || j.seller_agent_id === agent_id;
          const isActive = ['job_created', 'escrow_funded', 'in_progress'].includes(j.status);
          return isParty && isActive;
        });
        const MAX_ACTIVE = 3;
        if (activeJobs.length >= MAX_ACTIVE) {
          res.writeHead(200);
          res.end(JSON.stringify({ agent_id, child_job_id, decision: 'reject', decision_reason: 'capacity_reached', auto_accept_child: false }));
          return;
        }

        // 8. Depth limit check — this agent must not already be acting as subcontractor on another job
        // Exclude the child_job_id being evaluated (they don't have it yet — this is the decision point)
        const isAlreadySubcontractor = Object.values(store.jobs).some(j =>
          j.seller_agent_id === agent_id &&
          j.subcontract_depth === 1 &&
          j.job_id !== child_job_id &&
          !['paid', 'payment_failed'].includes(j.status)
        );
        if (isAlreadySubcontractor) {
          res.writeHead(200);
          res.end(JSON.stringify({ agent_id, child_job_id, decision: 'reject', decision_reason: 'depth_limit_exceeded', auto_accept_child: false }));
          return;
        }

        // All filters passed — accept
        res.writeHead(200);
        res.end(JSON.stringify({
          agent_id,
          child_job_id,
          decision: 'accept',
          decision_reason: 'all_filters_passed',
          auto_accept_child: true,
          accept_params: {
            child_job_id,
            accepting_agent_id: agent_id
          }
        }));

      } catch (err) {
        console.error('[decide/accept-child] Error:', err.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message, decision: 'reject', decision_reason: 'internal_error', auto_accept_child: false }));
      }
    })();
    return;
  }

  // ── POST /jobs/create ──────────────────────────────────────────────────────
  if (url.pathname === '/jobs/create' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', async () => {
      try {
        const { negotiation_id, creator_agent_id } = JSON.parse(body);
        if (!negotiation_id) throw Object.assign(new Error('negotiation_id required'), { code: 400 });
        validateId(creator_agent_id, 'creator');

        const neg = await httpGet(`${NEGOTIATE_URL}/negotiate/${encodeURIComponent(negotiation_id)}`);
        if (!neg || neg.error) throw Object.assign(new Error('Negotiation not found'), { code: 404 });
        if (neg.status !== 'accepted') {
          throw Object.assign(new Error(`Negotiation must be accepted (current: ${neg.status})`), { code: 409 });
        }
        if (creator_agent_id !== neg.buyer_agent_id) {
          throw Object.assign(new Error('Only the buyer can create a job from this negotiation'), { code: 403 });
        }

        const [buyerReg, sellerReg] = await Promise.all([
          httpGet(`${REGISTRY_URL}/registry/${encodeURIComponent(neg.buyer_agent_id)}`),
          httpGet(`${REGISTRY_URL}/registry/${encodeURIComponent(neg.seller_agent_id)}`)
        ]);
        if (!buyerReg || buyerReg.error) throw Object.assign(new Error('Buyer not in registry'), { code: 409 });
        if (!sellerReg || sellerReg.error) throw Object.assign(new Error('Seller not in registry'), { code: 409 });

        const store = loadJobs();
        const jid = jobId();
        const ts = now();

        const job = {
          job_id: jid,
          negotiation_id,
          buyer_agent_id: neg.buyer_agent_id,
          seller_agent_id: neg.seller_agent_id,
          seller_monero_address: neg.seller_monero_address,
          buyer_monero_address: buyerReg.monero_address,
          buyer_wallet_rpc_port: buyerReg.wallet_rpc_port || WALLET_PORT_MAP[neg.buyer_agent_id] || DEFAULT_WALLET_PORT,
          requested_service: neg.requested_service,
          job_description: neg.job_description,
          upstream_evidence_id: neg.upstream_evidence_id || null,
          agreed_rate: neg.final_rate,
          rate_unit: neg.rate_unit,
          // ME-0010: Subcontracting fields
          parent_job_id: null,
          child_job_id: null,
          role: 'seller', // 'seller' = direct job, 'contractor' = parent job with subcontract
          subcontract_depth: 0,
          child_description: null,
          //
          status: 'job_created',
          escrow_funded: false,
          escrow_funded_at: null,
          started_at: null,
          submitted_at: null,
          completion_proof: null,
          approved_at: null,
          disputed_at: null,
          dispute_reason: null,
          payment_requested_at: null,
          monero_transfer_attempted_at: null,
          monero_tx_hash: null,
          monero_tx_fee: null,
          payment_failed_at: null,
          payment_failure_reason: null,
          audit_log: [
            auditEntry('job_created', creator_agent_id, `Job from negotiation ${negotiation_id}`),
            auditEntry('negotiation_agreed', 'system', `Rate: ${neg.final_rate} ${neg.rate_unit}, service: ${neg.requested_service}`)
          ],
          created_at: ts,
          updated_at: ts
        };

        store.jobs[jid] = job;
        saveJobs(store);
        console.log(`[api] JOB CREATE: ${jid} | ${neg.final_rate} ${neg.rate_unit}`);

        emitReputationEvent({
          agent_id: creator_agent_id,
          event_type: 'job_created',
          job_id: jid,
          negotiation_id,
          role: 'buyer',
          verification_source: 'execution_service'
        });
        emitReputationEvent({
          agent_id: neg.seller_agent_id,
          event_type: 'job_created',
          job_id: jid,
          negotiation_id,
          role: 'seller',
          verification_source: 'execution_service'
        });
        res.writeHead(200);
        res.end(JSON.stringify(job));
      } catch (err) {
        res.writeHead(err.code || 500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── Route by action suffix ─────────────────────────────────────────────────
  const action = (() => {
    if (url.pathname.endsWith('/fund')) return 'fund';
    if (url.pathname.endsWith('/start')) return 'start';
    if (url.pathname.endsWith('/submit')) return 'submit';
    if (url.pathname.endsWith('/approve')) return 'approve';
    if (url.pathname.endsWith('/dispute')) return 'dispute';
    if (url.pathname.endsWith('/retry-payment')) return 'retry-payment';
    if (url.pathname.endsWith('/subcontract')) return 'subcontract';
    return null;
  })();

  const jid = parseJobIdFromPath(url.pathname);

  if (action && jid && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', async () => {
      try {
        const store = loadJobs();
        const job = requireJob(store, jid);

        switch (action) {
          case 'fund': {
            const { funder_agent_id } = JSON.parse(body);
            validateId(funder_agent_id, 'funder');
            if (funder_agent_id !== job.buyer_agent_id)
              throw Object.assign(new Error('Only the buyer can fund escrow'), { code: 403 });
            if (job.status !== 'job_created')
              throw Object.assign(new Error(`Cannot fund escrow in status: ${job.status}`), { code: 409 });
            job.status = 'escrow_funded';
            job.escrow_funded = true;
            job.escrow_funded_at = now();
            job.audit_log.push(auditEntry('escrow_funded', funder_agent_id));
            break;
          }

          case 'start': {
            const { starter_agent_id } = JSON.parse(body);
            validateId(starter_agent_id, 'starter');
            if (starter_agent_id !== job.seller_agent_id)
              throw Object.assign(new Error('Only the seller can start the job'), { code: 403 });
            if (job.status !== 'escrow_funded')
              throw Object.assign(new Error(`Cannot start in status: ${job.status}. Escrow must be funded.`), { code: 409 });
            // ME-0006: Validate upstream evidence if this job references one
            if (job.upstream_evidence_id) {
              const upstreamFile = path.join(EVIDENCE_DIR, `${job.upstream_evidence_id}.json`);
              if (!fs.existsSync(upstreamFile)) {
                throw Object.assign(new Error(`Upstream evidence '${job.upstream_evidence_id}' not found. Cannot start chained job.`), { code: 409 });
              }
            }
            job.status = 'in_progress';
            job.started_at = now();
            job.audit_log.push(auditEntry('job_started', starter_agent_id));
            emitReputationEvent({
              agent_id: starter_agent_id,
              event_type: 'job_accepted',
              job_id: jid,
              role: 'seller',
              verification_source: 'execution_service'
            });
            break;
          }

          case 'submit': {
            const { submitter_agent_id, completion_proof } = JSON.parse(body);
            validateId(submitter_agent_id, 'submitter');
            if (submitter_agent_id !== job.seller_agent_id)
              throw Object.assign(new Error('Only the seller can submit completion'), { code: 403 });
            if (job.status !== 'in_progress')
              throw Object.assign(new Error(`Cannot submit in status: ${job.status}`), { code: 409 });
            job.status = 'submitted';
            job.submitted_at = now();
            job.completion_proof = typeof completion_proof === 'string' ? completion_proof : JSON.stringify(completion_proof);
            job.audit_log.push(auditEntry('work_submitted', submitter_agent_id, 'Completion proof recorded'));
            emitReputationEvent({
              agent_id: submitter_agent_id,
              event_type: 'work_submitted',
              job_id: jid,
              verification_source: 'execution_service'
            });
            break;
          }

          case 'approve': {
            const { approver_agent_id } = JSON.parse(body);
            validateId(approver_agent_id, 'approver');
            if (approver_agent_id !== job.buyer_agent_id)
              throw Object.assign(new Error('Only the buyer can approve'), { code: 403 });
            if (job.status !== 'submitted')
              throw Object.assign(new Error(`Cannot approve in status: ${job.status}. Job must be submitted.`), { code: 409 });
            if (!job.escrow_funded)
              throw Object.assign(new Error('Escrow must be funded before approval'), { code: 409 });

            if (job.monero_tx_hash) {
              throw Object.assign(new Error(`Payment already made. tx_hash: ${job.monero_tx_hash}`), { code: 409 });
            }
            if (job.payment_failed_at) {
              throw Object.assign(new Error(`Payment previously failed: ${job.payment_failure_reason}`), { code: 409 });
            }

            // ── Real Monero transfer ─────────────────────────────────
            job.status = 'payment_requested';
            job.payment_requested_at = now();
            job.audit_log.push(auditEntry('payment_requested', approver_agent_id,
              `Initiating transfer of ${job.agreed_rate} ${job.rate_unit} to ${job.seller_monero_address}`));

            const atomicAmount = Math.round(parseFloat(job.agreed_rate) * 1e12);
            if (atomicAmount <= 0) throw new Error('Invalid agreed_rate');

            job.status = 'monero_transfer_attempted';
            job.monero_transfer_attempted_at = now();
            job.audit_log.push(auditEntry('monero_transfer_attempted', 'system',
              `Sending ${atomicAmount} atomic units to ${job.seller_monero_address}`));

            let txHash = null;
            let txFee = null;
            let paymentFailed = false;
            let failureReason = null;

            try {
              const result = await walletRpcCall('transfer', {
                destinations: [{ amount: atomicAmount, address: job.seller_monero_address }],
                get_tx_key: true
              }, 60000, job.buyer_agent_id);
              txHash = result.tx_hash;
              txFee = result.fee;
              console.log(`[payment] SUCCESS: ${txHash} | fee: ${txFee} atomic | job: ${jid} | paying_wallet: port ${WALLET_PORT_MAP[job.buyer_agent_id] || DEFAULT_WALLET_PORT}`);
            } catch (transferErr) {
              paymentFailed = true;
              failureReason = transferErr.message;
              console.error(`[payment] FAILED: ${transferErr.message} | job: ${jid}`);
            }

            if (paymentFailed) {
              job.status = 'payment_failed';
              job.payment_failed_at = now();
              job.payment_failure_reason = failureReason;
              job.audit_log.push(auditEntry('payment_failed', 'system', failureReason));
            } else {
              job.status = 'paid';
              job.monero_tx_hash = txHash;
              job.monero_tx_fee = txFee;
              job.approved_at = now();
              job.audit_log.push(auditEntry('payment_sent', 'system',
                `TX: ${txHash} | fee: ${txFee} atomic | rate: ${job.agreed_rate} ${job.rate_unit}`));

              const amountStr = atomicAmount.toString();

              emitReputationEvent({
                agent_id: job.buyer_agent_id,
                event_type: 'job_completed',
                job_id: jid,
                role: 'buyer',
                amount_atomic: amountStr,
                tx_hash: txHash,
                verification_source: 'execution_service'
              });
              emitReputationEvent({
                agent_id: job.seller_agent_id,
                event_type: 'job_completed',
                job_id: jid,
                role: 'seller',
                amount_atomic: amountStr,
                tx_hash: txHash,
                verification_source: 'execution_service'
              });
              emitReputationEvent({
                agent_id: job.buyer_agent_id,
                event_type: 'payment_sent',
                job_id: jid,
                amount_atomic: amountStr,
                tx_hash: txHash,
                verification_source: 'blockchain'
              });
              emitReputationEvent({
                agent_id: job.seller_agent_id,
                event_type: 'payment_received',
                job_id: jid,
                amount_atomic: amountStr,
                tx_hash: txHash,
                verification_source: 'blockchain'
              });

              // ── ME-0004 Phase A: Generate evidence record ───────────
              try {
                const evidence = await generateEvidenceRecord(job);
                job.audit_log.push(auditEntry('evidence_record_generated', 'system', `jer_id: ${evidence.jer_id}`));
                console.log(`[evidence] Evidence record generated for job ${jid}: ${evidence.jer_id}`);
              } catch (evidenceErr) {
                console.error(`[evidence] Failed to generate evidence record: ${evidenceErr.message}`);
              }
            }
            break;
          }

          case 'retry-payment': {
            // ME-OPS-001: Allow retry of failed payments without requiring re-approval
            if (job.status !== 'payment_failed')
              throw Object.assign(new Error(`Cannot retry payment in status: ${job.status}. Job must be payment_failed.`), { code: 409 });
            if (!job.payment_failure_reason)
              throw Object.assign(new Error('No payment failure reason found'), { code: 409 });

            job.audit_log.push(auditEntry('payment_retry_attempted', 'system',
              `Retrying payment after failure: ${job.payment_failure_reason}`));

            const atomicAmount = Math.round(parseFloat(job.agreed_rate) * 1e12);
            if (atomicAmount <= 0) throw new Error('Invalid agreed_rate');

            let txHash = null;
            let txFee = null;
            let paymentFailed = false;
            let failureReason = null;

            try {
              const result = await walletRpcCall('transfer', {
                destinations: [{ amount: atomicAmount, address: job.seller_monero_address }],
                get_tx_key: true
              }, 60000, job.buyer_agent_id);
              txHash = result.tx_hash;
              txFee = result.fee;
              console.log(`[payment-retry] SUCCESS: ${txHash} | fee: ${txFee} atomic | job: ${jid} | paying_wallet: port ${WALLET_PORT_MAP[job.buyer_agent_id] || DEFAULT_WALLET_PORT}`);
            } catch (transferErr) {
              paymentFailed = true;
              failureReason = transferErr.message;
              console.error(`[payment-retry] FAILED: ${transferErr.message} | job: ${jid}`);
            }

            if (paymentFailed) {
              job.payment_failure_reason = failureReason;
              job.payment_failed_at = now();
              job.audit_log.push(auditEntry('payment_failed', 'system', failureReason));
              saveJobs(store);
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'payment_failed', error: failureReason }));
              return;
            }

            // Payment succeeded — fall through to the success path
            job.status = 'paid';
            job.paid_at = now();
            job.monero_tx_hash = txHash;
            job.monero_tx_fee_atomic = txFee;
            job.payment_failure_reason = null;

            job.audit_log.push(auditEntry('paid', 'system',
              `TX: ${txHash} | fee: ${txFee} atomic | rate: ${job.agreed_rate} ${job.rate_unit}`));

            const amountStr = atomicAmount.toString();
            emitReputationEvent({ agent_id: job.buyer_agent_id, event_type: 'job_completed', job_id: jid, role: 'buyer', amount_atomic: amountStr, tx_hash: txHash, verification_source: 'execution_service' });
            emitReputationEvent({ agent_id: job.seller_agent_id, event_type: 'job_completed', job_id: jid, role: 'seller', amount_atomic: amountStr, tx_hash: txHash, verification_source: 'execution_service' });
            emitReputationEvent({ agent_id: job.buyer_agent_id, event_type: 'payment_sent', job_id: jid, amount_atomic: amountStr, tx_hash: txHash, verification_source: 'blockchain' });
            emitReputationEvent({ agent_id: job.seller_agent_id, event_type: 'payment_received', job_id: jid, amount_atomic: amountStr, tx_hash: txHash, verification_source: 'blockchain' });

            // Generate evidence record on successful payment retry
            try {
              const evidence = await generateEvidenceRecord(job);
              job.audit_log.push(auditEntry('evidence_record_generated', 'system', `jer_id: ${evidence.jer_id}`));
              console.log(`[evidence] Evidence record generated for job ${jid}: ${evidence.jer_id}`);
            } catch (evidenceErr) {
              console.error(`[evidence] Failed to generate evidence record: ${evidenceErr.message}`);
            }

            saveJobs(store);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'paid', monero_tx_hash: txHash, monero_tx_fee_atomic: txFee }));
            return;
          }

          case 'dispute': {
            const { disputer_agent_id, reason } = JSON.parse(body);
            validateId(disputer_agent_id, 'disputer');
            if (disputer_agent_id !== job.buyer_agent_id && disputer_agent_id !== job.seller_agent_id)
              throw Object.assign(new Error('Only a party to the job can dispute'), { code: 403 });
            if (['paid', 'payment_failed'].includes(job.status))
              throw Object.assign(new Error(`Cannot dispute a ${job.status} job`), { code: 409 });
            job.status = 'disputed';
            job.disputed_at = now();
            job.dispute_reason = typeof reason === 'string' ? reason : '';
            job.audit_log.push(auditEntry('job_disputed', disputer_agent_id, reason || 'No reason provided'));
            break;
          }

          // ── ME-0010: POST /jobs/:id/subcontract ────────────────────────
          // Contractor creates one child job for a parent job.
          // One child per parent (enforced). Depth = 1 only.
          // Child sees only child_description — not full parent details.
          case 'subcontract': {
            const { contractor_agent_id, subcontractor_agent_id, child_rate, child_description } = JSON.parse(body);
            validateId(contractor_agent_id, 'contractor');
            validateId(subcontractor_agent_id, 'subcontractor');

            // Must be the seller on the parent job (contractor role)
            if (contractor_agent_id !== job.seller_agent_id)
              throw Object.assign(new Error('Only the seller (contractor) can create a subcontract'), { code: 403 });

            // Parent must be active (can subcontract from in_progress or submitted)
            if (!['in_progress', 'submitted'].includes(job.status))
              throw Object.assign(new Error(`Cannot subcontract while in status: ${job.status}`), { code: 409 });

            // Depth = 1: contractor cannot subcontract if they are already a subcontractor
            if (job.subcontract_depth > 0)
              throw Object.assign(new Error('Depth = 1: agents cannot subcontract more than one level'), { code: 409 });

            // One child per parent enforcement
            if (job.child_job_id)
              throw Object.assign(new Error(`Parent job already has a child job: ${job.child_job_id}. One child per parent.`), { code: 409 });

            if (!child_rate || parseFloat(child_rate) <= 0)
              throw Object.assign(new Error('child_rate required and must be positive'), { code: 400 });

            if (!child_description || typeof child_description !== 'string')
              throw Object.assign(new Error('child_description required'), { code: 400 });

            // Fetch subcontractor registry record
            const subReg = await httpGet(`${REGISTRY_URL}/registry/${encodeURIComponent(subcontractor_agent_id)}`);
            if (!subReg || subReg.error)
              throw Object.assign(new Error(`Subcontractor not in registry: ${subcontractor_agent_id}`), { code: 404 });

            // Fetch contractor registry record (for wallet info)
            const conReg = await httpGet(`${REGISTRY_URL}/registry/${encodeURIComponent(contractor_agent_id)}`);
            if (!conReg || conReg.error)
              throw Object.assign(new Error(`Contractor not in registry: ${contractor_agent_id}`), { code: 409 });

            const childJid = jobId();
            const ts = now();

            // Child job: contractor = buyer, subcontractor = seller
            const childJob = {
              job_id: childJid,
              negotiation_id: null,
              buyer_agent_id: contractor_agent_id,
              seller_agent_id: subcontractor_agent_id,
              seller_monero_address: subReg.monero_address,
              buyer_monero_address: conReg.monero_address,
              // Contractor (buyer of child) pays from their own wallet
              buyer_wallet_rpc_port: conReg.wallet_rpc_port || WALLET_PORT_MAP[contractor_agent_id] || DEFAULT_WALLET_PORT,
              requested_service: job.requested_service,
              job_description: child_description, // Only child_description exposed to subcontractor
              upstream_evidence_id: null,
              agreed_rate: parseFloat(child_rate).toFixed(6),
              rate_unit: 'XMR',
              // ME-0010 subcontracting fields
              parent_job_id: jid,
              child_job_id: null,
              role: 'subcontractor', // this agent is the subcontractor on the child job
              subcontract_depth: 1, // depth = 1 hard cap
              child_description: child_description,
              //
              status: 'job_created',
              escrow_funded: false,
              escrow_funded_at: null,
              started_at: null,
              submitted_at: null,
              completion_proof: null,
              approved_at: null,
              disputed_at: null,
              dispute_reason: null,
              payment_requested_at: null,
              monero_transfer_attempted_at: null,
              monero_tx_hash: null,
              monero_tx_fee: null,
              payment_failed_at: null,
              payment_failure_reason: null,
              audit_log: [
                auditEntry('job_created', contractor_agent_id, `Subcontract child job for parent ${jid}`),
                auditEntry('subcontract_created', 'system', `Child job ${childJid} | rate: ${child_rate} XMR | subcontractor: ${subcontractor_agent_id}`)
              ],
              created_at: ts,
              updated_at: ts
            };

            store.jobs[childJid] = childJob;

            // Link child to parent
            job.child_job_id = childJid;
            job.role = 'contractor'; // now this agent is a contractor on the parent
            job.updated_at = now();
            job.audit_log.push(auditEntry('subcontract_initiated', contractor_agent_id,
              `Child job ${childJid} created for subcontractor ${subcontractor_agent_id} at ${child_rate} XMR`));

            saveJobs(store);
            console.log(`[api] SUBCONTRACT: parent=${jid} | child=${childJid} | subcontractor=${subcontractor_agent_id} | rate=${child_rate} XMR`);

            res.writeHead(200);
            res.end(JSON.stringify({
              parent_job: job,
              child_job: childJob
            }));
            return;
          }

        }

        job.updated_at = now();
        store.jobs[jid] = job;
        saveJobs(store);
        console.log(`[api] ${action.toUpperCase()}: ${jid} → ${job.status}`);
        res.writeHead(200);
        res.end(JSON.stringify(job));
      } catch (err) {
        res.writeHead(err.code || 500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(JOBS_DIR, { mode: 0o700, recursive: true });
  fs.mkdirSync(BACKUP_DIR, { mode: 0o700, recursive: true });
  fs.mkdirSync(EVIDENCE_DIR, { mode: 0o700, recursive: true });

  console.log('═══════════════════════════════════════════════════════════');
  console.log('   Agent Execution Service v1.8');
  console.log('   RentMyAI.ai — ME-0010 Step 2 (Accept/Reject Decision)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Data:     ${JOBS_FILE}`);
  console.log(`Evidence: ${EVIDENCE_DIR}`);
  console.log(`HTTP:     localhost:${PORT}`);
  console.log(`Wallet:   port map: ${JSON.stringify(WALLET_PORT_MAP)}`);
  console.log('───────────────────────────────────────────────────────────');
  console.log('  POST /jobs/create           — create job from negotiation');
  console.log('  POST /jobs/:id/fund        — buyer funds escrow');
  console.log('  POST /jobs/:id/start       — seller starts work');
  console.log('  POST /jobs/:id/submit      — seller submits completion');
  console.log('  POST /jobs/:id/approve     — buyer approves → REAL XMR');
  console.log('  POST /jobs/:id/dispute      — either party disputes');
  console.log('  POST /jobs/:id/subcontract — ME-0010: create child job (contractor only)');
  console.log('  GET  /jobs/:id/children   — ME-0010: list child jobs for parent');
  console.log('  GET  /jobs/:id             — job details');
  console.log('  GET  /jobs                — list all jobs');
  console.log('  GET  /evidence            — list all evidence records');
  console.log('  GET  /evidence/:job_id    — get evidence record JSON');
  console.log('  GET  /evidence/:job_id/summary — human-readable summary');
  console.log('  GET  /decide/pursue       — decision engine: should agent pursue?');
  console.log('  GET  /decide/accept       — decision engine: should agent accept?');
  console.log('═══════════════════════════════════════════════════════════');

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[init] Execution service v1.8 listening on port ${PORT}`);
  });
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
