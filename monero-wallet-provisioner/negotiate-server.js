#!/usr/bin/env node
/**
 * Agent Negotiation Service
 * RentMyAI.ai — Level 3 Phase 3.3
 *
 * Agents negotiate job contracts through this service.
 * Validates both parties exist in the registry.
 * No payment execution — agreement only.
 *
 * API:
 *   POST /negotiate/propose   — buyer proposes a job
 *   POST /negotiate/accept   — seller accepts (or buyer accepts counter)
 *   POST /negotiate/reject    — seller or buyer rejects
 *   POST /negotiate/counter   — seller proposes different rate
 *   GET  /negotiate/:job_id   — get one negotiation
 *   GET  /negotiate           — list all negotiations
 *   GET  /health
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const PORT = 18093;
const NEGOTIATE_DIR = '/Users/ghost/.openclaw/agents';
const NEGOTIATE_FILE = path.join(NEGOTIATE_DIR, 'negotiations.json');
const BACKUP_DIR = path.join(NEGOTIATE_DIR, 'negotiate-backups');
const REGISTRY_URL = 'http://127.0.0.1:18092';

// ─── STORE ───────────────────────────────────────────────────────────────────

function loadNegotiations() {
  if (!fs.existsSync(NEGOTIATE_FILE)) return { version: 1, negotiations: {} };
  try {
    return JSON.parse(fs.readFileSync(NEGOTIATE_FILE, 'utf8'));
  } catch (e) {
    console.error('[store] Corrupt file, returning empty:', e.message);
    return { version: 1, negotiations: {} };
  }
}

function saveNegotiations(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `negotiations-${timestamp}.json`;
  if (fs.existsSync(NEGOTIATE_FILE)) {
    fs.mkdirSync(BACKUP_DIR, { mode: 0o700, recursive: true });
    fs.copyFileSync(NEGOTIATE_FILE, path.join(BACKUP_DIR, backupName));
    const backups = fs.readdirSync(BACKUP_DIR).sort().reverse();
    for (const b of backups.slice(50)) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, b)); } catch (e) {}
    }
  }
  fs.writeFileSync(NEGOTIATE_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

// ─── REGISTRY HELPERS ────────────────────────────────────────────────────────

function registryGet(agentId) {
  return new Promise((resolve) => {
    const req = http.get(`${REGISTRY_URL}/registry/${encodeURIComponent(agentId)}`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

function registryList() {
  return new Promise((resolve) => {
    const req = http.get(`${REGISTRY_URL}/registry`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

// ─── VALIDATION ──────────────────────────────────────────────────────────────

function validateId(id, name) {
  if (!id || typeof id !== 'string' || id.length > 64) {
    throw Object.assign(new Error(`${name} agent_id required (max 64 chars)`), { code: 400 });
  }
}

function validateRate(rate, name) {
  const n = parseFloat(rate);
  if (isNaN(n) || n <= 0) {
    throw Object.assign(new Error(`${name} rate must be a positive number`), { code: 400 });
  }
  return n;
}

function validateStatus(status, allowed) {
  if (!allowed.includes(status)) {
    throw Object.assign(new Error(`Invalid status`), { code: 400 });
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function jobId() {
  return `job-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function now() {
  return new Date().toISOString();
}

function buildNegotiation(n) {
  return {
    job_id: n.job_id,
    buyer_agent_id: n.buyer_agent_id,
    seller_agent_id: n.seller_agent_id,
    seller_monero_address: n.seller_monero_address,
    requested_service: n.requested_service,
    job_definition: {
      task_description: n.job_description,
      upstream_evidence_id: n.upstream_evidence_id || null
    },
    job_description: n.job_description,
    upstream_evidence_id: n.upstream_evidence_id || null,
    proposed_rate: n.proposed_rate,
    counter_rate: n.counter_rate,
    final_rate: n.final_rate,
    rate_unit: n.rate_unit || 'XMR',
    status: n.status,
    created_at: n.created_at,
    updated_at: n.updated_at
  };
}

// ─── HTTP SERVER ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Content-Type', 'application/json');

  // GET /health
  if (url.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', service: 'negotiate', version: '1.0.0' }));
    return;
  }

  // GET /negotiate — list all
  if (url.pathname === '/negotiate' && req.method === 'GET') {
    const store = loadNegotiations();
    const list = Object.values(store.negotiations).map(buildNegotiation);
    res.writeHead(200);
    res.end(JSON.stringify({ negotiations: list, count: list.length }));
    return;
  }

  // GET /negotiate/:job_id
  const getMatch = url.pathname.match(/^\/negotiate\/(.+)$/);
  if (getMatch && req.method === 'GET') {
    const store = loadNegotiations();
    const n = store.negotiations[getMatch[1]];
    if (!n) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Negotiation not found' }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify(buildNegotiation(n)));
    return;
  }

  // POST /negotiate/propose
  if (url.pathname === '/negotiate/propose' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', async () => {
      try {
        const { buyer_agent_id, seller_agent_id, requested_service, job_definition, job_description, proposed_rate, rate_unit } = JSON.parse(body);

        validateId(buyer_agent_id, 'buyer');
        validateId(seller_agent_id, 'seller');
        if (!requested_service || typeof requested_service !== 'string') throw Object.assign(new Error('requested_service required'), { code: 400 });
        // job_definition.task_description is the preferred field; job_description is accepted for backward compatibility
        const taskDescription = job_definition?.task_description || job_description || null;
        // upstream_evidence_id: reference to a prior job's evidence record for chained workflows
        const upstreamEvidenceId = job_definition?.upstream_evidence_id || null;
        const rate = validateRate(proposed_rate, 'proposed_rate');

        if (buyer_agent_id === seller_agent_id) {
          throw Object.assign(new Error('buyer and seller must be different agents'), { code: 400 });
        }

        // Both agents must exist in registry
        const [buyerReg, sellerReg] = await Promise.all([
          registryGet(buyer_agent_id),
          registryGet(seller_agent_id)
        ]);

        if (!buyerReg || buyerReg.error) throw Object.assign(new Error(`Buyer agent '${buyer_agent_id}' not found in registry`), { code: 404 });
        if (!sellerReg || sellerReg.error) throw Object.assign(new Error(`Seller agent '${seller_agent_id}' not found in registry`), { code: 404 });

        // Seller must offer the requested service
        if (!Array.isArray(sellerReg.services_offered) || !sellerReg.services_offered.includes(requested_service)) {
          throw Object.assign(new Error(`Seller '${seller_agent_id}' does not offer service '${requested_service}'`), { code: 409 });
        }

        const store = loadNegotiations();
        const jid = jobId();
        const ts = now();

        const n = {
          job_id: jid,
          buyer_agent_id,
          seller_agent_id,
          seller_monero_address: sellerReg.monero_address,
          requested_service,
          job_description: taskDescription,
          upstream_evidence_id: upstreamEvidenceId,
          proposed_rate: rate,
          counter_rate: null,
          final_rate: null,
          rate_unit: rate_unit || 'XMR',
          status: 'proposed',
          created_at: ts,
          updated_at: ts
        };

        store.negotiations[jid] = n;
        saveNegotiations(store);

        console.log(`[api] PROPOSE: ${jid} | ${buyer_agent_id} → ${seller_agent_id} | ${requested_service} @ ${rate} ${n.rate_unit}`);
        res.writeHead(200);
        res.end(JSON.stringify(buildNegotiation(n)));
      } catch (err) {
        const code = err.code || 500;
        res.writeHead(code);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /negotiate/counter
  if (url.pathname === '/negotiate/counter' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', async () => {
      try {
        const { job_id, countering_agent_id, counter_rate } = JSON.parse(body);

        if (!job_id) throw Object.assign(new Error('job_id required'), { code: 400 });
        validateId(countering_agent_id, 'countering_agent');
        const rate = validateRate(counter_rate, 'counter_rate');

        const store = loadNegotiations();
        const n = store.negotiations[job_id];
        if (!n) { res.writeHead(404); res.end(JSON.stringify({ error: 'Negotiation not found' })); return; }

        // Only seller can counter a proposal; only buyer can counter a seller's counter
        const canCounter = (n.status === 'proposed' && countering_agent_id === n.seller_agent_id) ||
                          (n.status === 'countered' && countering_agent_id === n.buyer_agent_id);
        if (!canCounter) {
          throw Object.assign(new Error('Only the receiving party can counter'), { code: 403 });
        }

        // Can't counter an already-accepted, rejected, or expired negotiation
        if (['accepted', 'rejected', 'expired'].includes(n.status)) {
          throw Object.assign(new Error(`Cannot counter a ${n.status} negotiation`), { code: 409 });
        }

        n.counter_rate = rate;
        n.status = 'countered';
        n.updated_at = now();

        store.negotiations[job_id] = n;
        saveNegotiations(store);

        console.log(`[api] COUNTER: ${job_id} | ${countering_agent_id} counters @ ${rate} ${n.rate_unit}`);
        res.writeHead(200);
        res.end(JSON.stringify(buildNegotiation(n)));
      } catch (err) {
        const code = err.code || 500;
        res.writeHead(code);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /negotiate/accept
  if (url.pathname === '/negotiate/accept' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', async () => {
      try {
        const { job_id, accepting_agent_id } = JSON.parse(body);

        if (!job_id) throw Object.assign(new Error('job_id required'), { code: 400 });
        validateId(accepting_agent_id, 'accepting_agent');

        const store = loadNegotiations();
        const n = store.negotiations[job_id];
        if (!n) { res.writeHead(404); res.end(JSON.stringify({ error: 'Negotiation not found' })); return; }

        // Determine who can accept based on status
        let canAccept = false;
        if (n.status === 'proposed' && accepting_agent_id === n.buyer_agent_id) {
          // Buyer accepts seller's proposed rate (seller posted 'available')
          n.final_rate = n.proposed_rate;
          canAccept = true;
        } else if (n.status === 'proposed' && accepting_agent_id === n.seller_agent_id) {
          // Seller accepts buyer's proposed rate
          n.final_rate = n.proposed_rate;
          canAccept = true;
        } else if (n.status === 'countered' && accepting_agent_id === n.buyer_agent_id) {
          // Buyer accepts seller's counter rate
          n.final_rate = n.counter_rate;
          canAccept = true;
        } else if (n.status === 'countered' && accepting_agent_id === n.seller_agent_id) {
          // Seller accepts buyer's counter rate
          n.final_rate = n.counter_rate;
          canAccept = true;
        }

        if (!canAccept) {
          throw Object.assign(new Error('Only the addressed party can accept at this stage'), { code: 403 });
        }

        if (['accepted', 'rejected', 'expired'].includes(n.status)) {
          throw Object.assign(new Error(`Cannot accept a ${n.status} negotiation`), { code: 409 });
        }

        n.status = 'accepted';
        n.updated_at = now();

        store.negotiations[job_id] = n;
        saveNegotiations(store);

        console.log(`[api] ACCEPT: ${job_id} | final_rate=${n.final_rate} ${n.rate_unit}`);
        res.writeHead(200);
        res.end(JSON.stringify(buildNegotiation(n)));
      } catch (err) {
        const code = err.code || 500;
        res.writeHead(code);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /negotiate/reject
  if (url.pathname === '/negotiate/reject' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', async () => {
      try {
        const { job_id, rejecting_agent_id, reason } = JSON.parse(body);

        if (!job_id) throw Object.assign(new Error('job_id required'), { code: 400 });
        validateId(rejecting_agent_id, 'rejecting_agent');

        const store = loadNegotiations();
        const n = store.negotiations[job_id];
        if (!n) { res.writeHead(404); res.end(JSON.stringify({ error: 'Negotiation not found' })); return; }

        if (['accepted', 'rejected', 'expired'].includes(n.status)) {
          throw Object.assign(new Error(`Cannot reject a ${n.status} negotiation`), { code: 409 });
        }

        // Either party can reject at any point before accepted
        if (rejecting_agent_id !== n.buyer_agent_id && rejecting_agent_id !== n.seller_agent_id) {
          throw Object.assign(new Error('Only a party to the negotiation can reject it'), { code: 403 });
        }

        n.status = 'rejected';
        n.updated_at = now();

        store.negotiations[job_id] = n;
        saveNegotiations(store);

        console.log(`[api] REJECT: ${job_id} | by ${rejecting_agent_id}`);
        res.writeHead(200);
        res.end(JSON.stringify(buildNegotiation(n)));
      } catch (err) {
        const code = err.code || 500;
        res.writeHead(code);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ─── MAIN ───────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(NEGOTIATE_DIR, { mode: 0o700, recursive: true });
  fs.mkdirSync(BACKUP_DIR, { mode: 0o700, recursive: true });

  console.log('═══════════════════════════════════════════════════════════');
  console.log('   Agent Negotiation Service');
  console.log('   RentMyAI.ai — Level 3 Phase 3.3');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Data:   ${NEGOTIATE_FILE}`);
  console.log(`Backup: ${BACKUP_DIR}`);
  console.log(`HTTP:   localhost:${PORT}`);
  console.log('───────────────────────────────────────────────────────────');
  console.log('  POST /negotiate/propose  — buyer proposes a job');
  console.log('  POST /negotiate/counter — either party counters');
  console.log('  POST /negotiate/accept  — accept current rate');
  console.log('  POST /negotiate/reject  — reject negotiation');
  console.log('  GET  /negotiate         — list all');
  console.log('  GET  /negotiate/:job_id — get one');
  console.log('  GET  /health');
  console.log('═══════════════════════════════════════════════════════════');

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[init] Negotiation service listening on port ${PORT}`);
  });
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
