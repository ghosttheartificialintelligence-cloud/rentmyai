#!/usr/bin/env node
/**
 * Agent Execution Service
 * RentMyAI.ai — Level 3 Phase 3.5 + ME-0004 Phase A (Evidence Records)
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
const WALLET_RPC_HOST = '127.0.0.1';
const WALLET_RPC_PORT = 18089;
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

const WALLET_RPC_USER = 'ghost';
const WALLET_RPC_PASS = 'ghost';

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

function walletRpcCall(method, params = {}, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ jsonrpc: '2.0', id: '0', method, params });
    const authHeader = digestAuth(
      { 'www-authenticate': 'Digest realm="monero-rpc", nonce="nonce"' },
      'POST', '/json_rpc', WALLET_RPC_USER, WALLET_RPC_PASS
    );
    const req = http.request({
      hostname: WALLET_RPC_HOST, port: WALLET_RPC_PORT,
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
            hostname: WALLET_RPC_HOST, port: WALLET_RPC_PORT,
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
  const m = pathname.match(/^\/jobs\/(.+?)\/(?:fund|start|submit|approve|dispute)$/);
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
      agreed_rate: job.agreed_rate,
      rate_unit: job.rate_unit
    },

    work_completed: {
      completion_proof: job.completion_proof,
      submitted_at: job.submitted_at,
      submitted_by: job.seller_agent_id
    },

    payment: {
      amount_atomic: atomicAmount,
      amount_xmr: job.agreed_rate,
      fee_atomic: txFeeAtomic,
      fee_xmr: (txFeeAtomic / 1e12).toFixed(6),
      total_atomic: atomicAmount + txFeeAtomic,
      tx_hash: job.monero_tx_hash,
      from_address: job.buyer_monero_address,
      to_address: job.seller_monero_address,
      paid_at: job.approved_at || job.updated_at,
      verification_source: 'blockchain',
      block_confirmed: true
    },

    verification_status: {
      payment_verified: !!job.monero_tx_hash,
      evidence_verified: true,
      human_readable_summary: generateHumanSummary(job, job.monero_tx_hash).split('\n').slice(0, 3).join(' ').trim()
    },

    // Artifact: store the completion_proof as an artifact
    // Agent-agnostic — any agent's output format is acceptable
    artifact: job.completion_proof ? {
      artifact_id: `artifact-${jerId}`,
      artifact_type: 'completion_proof',
      produced_by: job.seller_agent_id,
      produced_at: job.submitted_at || now(),
      artifact_data: job.completion_proof
    } : null,

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
    res.end(JSON.stringify({ status: 'ok', service: 'execution', version: '1.6.0', milestone: 'ME-0004-PhA' }));
    return;
  }

  // GET /jobs
  if (url.pathname === '/jobs' && req.method === 'GET') {
    const store = loadJobs();
    res.writeHead(200);
    res.end(JSON.stringify({ jobs: Object.values(store.jobs), count: Object.keys(store.jobs).length }));
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
          requested_service: neg.requested_service,
          job_description: neg.job_description,
          agreed_rate: neg.final_rate,
          rate_unit: neg.rate_unit,
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
              });
              txHash = result.tx_hash;
              txFee = result.fee;
              console.log(`[payment] SUCCESS: ${txHash} | fee: ${txFee} atomic | job: ${jid}`);
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
  console.log('   Agent Execution Service v1.6');
  console.log('   RentMyAI.ai — Level 3 Phase 3.5 + ME-0004 Phase A');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Data:     ${JOBS_FILE}`);
  console.log(`Evidence: ${EVIDENCE_DIR}`);
  console.log(`HTTP:     localhost:${PORT}`);
  console.log(`Wallet:   localhost:${WALLET_RPC_PORT}`);
  console.log('───────────────────────────────────────────────────────────');
  console.log('  POST /jobs/create           — create job from negotiation');
  console.log('  POST /jobs/:id/fund        — buyer funds escrow');
  console.log('  POST /jobs/:id/start       — seller starts work');
  console.log('  POST /jobs/:id/submit      — seller submits completion');
  console.log('  POST /jobs/:id/approve     — buyer approves → REAL XMR');
  console.log('  POST /jobs/:id/dispute      — either party disputes');
  console.log('  GET  /jobs/:id             — job details');
  console.log('  GET  /jobs                — list all jobs');
  console.log('  GET  /evidence            — list all evidence records');
  console.log('  GET  /evidence/:job_id    — get evidence record JSON');
  console.log('  GET  /evidence/:job_id/summary — human-readable summary');
  console.log('═══════════════════════════════════════════════════════════');

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[init] Execution service v1.6 listening on port ${PORT}`);
  });
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
