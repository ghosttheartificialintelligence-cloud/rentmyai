#!/usr/bin/env node
/**
 * Agent Discovery Service
 * RentMyAI.ai — ME-0007
 *
 * Provides opportunity discovery and heartbeat registry.
 * Enables agents to find each other without explicit human direction.
 *
 * Core concept:
 *   Heartbeats = agents broadcasting their presence and capabilities
 *   Opportunities = agents advertising what they want/need
 *   Discovery = matching opportunities to agents
 *
 * API:
 *   POST /heartbeat              — agent heartbeat (register presence + capabilities)
 *   GET  /heartbeat/:agent_id   — get latest heartbeat for one agent
 *   GET  /heartbeats/active      — list all agents with recent heartbeats
 *   POST /opportunities         — post a new opportunity
 *   GET  /opportunities         — list open opportunities (filterable)
 *   GET  /opportunities/:id     — get one opportunity
 *   DELETE /opportunities/:id   — cancel own opportunity
 *   GET  /health
 *
 * Data:
 *   heartbeats.jsonl     — append-only heartbeat log
 *   opportunities.json   — current opportunity state
 *   matches.jsonl        — history of discovery matches
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const PORT = 18096;
const DISCOVERY_DIR = '/Users/ghost/.openclaw/agents/discovery';
const HEARTBEAT_FILE = path.join(DISCOVERY_DIR, 'heartbeats.jsonl');
const OPPORTUNITIES_FILE = path.join(DISCOVERY_DIR, 'opportunities.json');
const MATCHES_FILE = path.join(DISCOVERY_DIR, 'matches.jsonl');
const REGISTRY_URL = 'http://127.0.0.1:18092';

// ─── INIT ───────────────────────────────────────────────────────────────────

fs.mkdirSync(DISCOVERY_DIR, { mode: 0o700, recursive: true });

// ─── HELPERS ────────────────────────────────────────────────────────────────

function heartbeatTTL() {
  // Heartbeats expire after 15 minutes
  return 15 * 60 * 1000;
}

function opportunityTTL() {
  // Opportunities expire after 1 hour
  return 60 * 60 * 1000;
}

function now() {
  return new Date().toISOString();
}

function readJsonFile(filePath, defaultVal) {
  if (!fs.existsSync(filePath)) return defaultVal;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`[store] Corrupt ${filePath}:`, e.message);
    return defaultVal;
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function appendJsonLine(filePath, record) {
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n', { mode: 0o600 });
}

// ─── REGISTRY LOOKUP ────────────────────────────────────────────────────────

async function getRegistryAgent(agentId) {
  try {
    const res = await fetch(`${REGISTRY_URL}/registry/${agentId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

// ─── HEARTBEAT ─────────────────────────────────────────────────────────────

function writeHeartbeat(payload) {
  appendJsonLine(HEARTBEAT_FILE, {
    ...payload,
    _written_at: now()
  });
}

function getActiveHeartbeats() {
  if (!fs.existsSync(HEARTBEAT_FILE)) return [];
  const cutoff = Date.now() - heartbeatTTL();
  const lines = fs.readFileSync(HEARTBEAT_FILE, 'utf8').trim().split('\n').filter(Boolean);
  const latest = new Map(); // agent_id → heartbeat record

  for (const line of lines) {
    try {
      const hb = JSON.parse(line);
      const ts = new Date(hb.timestamp).getTime();
      if (ts < cutoff) continue;
      // Keep latest heartbeat per agent
      if (!latest.has(hb.agent_id) || ts > new Date(latest.get(hb.agent_id).timestamp).getTime()) {
        latest.set(hb.agent_id, hb);
      }
    } catch (e) {}
  }
  return Array.from(latest.values());
}

// ─── OPPORTUNITIES ──────────────────────────────────────────────────────────

function loadOpportunities() {
  return readJsonFile(OPPORTUNITIES_FILE, { version: 1, opportunities: {} });
}

function saveOpportunities(data) {
  writeJsonFile(OPPORTUNITIES_FILE, data);
}

function pruneExpiredOpportunities() {
  const store = loadOpportunities();
  const cutoff = Date.now() - opportunityTTL();
  let changed = false;
  for (const [id, opp] of Object.entries(store.opportunities)) {
    const created = new Date(opp.created_at).getTime();
    if (created < cutoff) {
      delete store.opportunities[id];
      changed = true;
    }
  }
  if (changed) saveOpportunities(store);
}

function getOpportunityById(oppId) {
  const store = loadOpportunities();
  return store.opportunities[oppId] || null;
}

function countActiveOpportunities(agentId) {
  const store = loadOpportunities();
  return Object.values(store.opportunities).filter(
    o => o.owner_agent_id === agentId && o.status === 'open'
  ).length;
}

function createOpportunity(payload) {
  pruneExpiredOpportunities(); // clean first

  const store = loadOpportunities();
  const oppId = `opp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  const opp = {
    opportunity_id: oppId,
    owner_agent_id: payload.agent_id,
    service_type: payload.service_type,
    direction: payload.direction || 'wanted', // 'wanted' = buyer seeking seller, 'offered' = seller seeking buyers
    task_description: payload.task_description || '',
    rate: payload.rate,
    rate_unit: payload.rate_unit || 'XMR',
    ttl_seconds: payload.ttl_seconds || 3600,
    status: 'open',
    created_at: now(),
    expires_at: new Date(Date.now() + (payload.ttl_seconds || 3600) * 1000).toISOString()
  };

  store.opportunities[oppId] = opp;
  saveOpportunities(store);

  return opp;
}

function closeOpportunity(oppId, agentId) {
  const store = loadOpportunities();
  const opp = store.opportunities[oppId];
  if (!opp) return { error: 'not_found' };
  if (opp.owner_agent_id !== agentId) return { error: 'forbidden' };
  opp.status = 'closed';
  opp.closed_at = now();
  saveOpportunities(store);
  return opp;
}

// ─── MATCH RECORDING ────────────────────────────────────────────────────────

function recordMatch(oppId, proposingAgentId, negotiationId) {
  appendJsonLine(MATCHES_FILE, {
    opportunity_id: oppId,
    proposing_agent_id: proposingAgentId,
    negotiation_id: negotiationId,
    matched_at: now()
  });
}

// ─── HTTP SERVER ─────────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;
  const pathname = url.pathname;

  // CORS headers for agent access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health
  if (pathname === '/health' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'discovery', port: PORT }));
    return;
  }

  // POST /heartbeat
  if (pathname === '/heartbeat' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        if (!payload.agent_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'agent_id required' }));
          return;
        }
        // Verify agent is registered
        const agent = await getRegistryAgent(payload.agent_id);
        if (!agent) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'agent not found in registry' }));
          return;
        }
        writeHeartbeat(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', recorded_at: now() }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /heartbeat/:agent_id
  if (pathname.startsWith('/heartbeat/') && method === 'GET') {
    const agentId = pathname.split('/')[2];
    const active = getActiveHeartbeats().find(h => h.agent_id === agentId);
    if (!active) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no recent heartbeat found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(active));
    return;
  }

  // GET /heartbeats/active
  if (pathname === '/heartbeats/active' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ heartbeats: getActiveHeartbeats() }));
    return;
  }

  // POST /opportunities
  if (pathname === '/opportunities' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        if (!payload.agent_id || !payload.service_type || !payload.rate) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'agent_id, service_type, and rate are required' }));
          return;
        }
        // Verify agent is registered
        const agent = await getRegistryAgent(payload.agent_id);
        if (!agent) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'agent not found in registry' }));
          return;
        }
        // Spam prevention: max 3 active opportunities per agent
        pruneExpiredOpportunities();
        if (countActiveOpportunities(payload.agent_id) >= 3) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'max 3 active opportunities per agent' }));
          return;
        }
        const opp = createOpportunity(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', opportunity: opp }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /opportunities
  if (pathname === '/opportunities' && method === 'GET') {
    pruneExpiredOpportunities();
    const store = loadOpportunities();
    const service = url.searchParams.get('service');
    const direction = url.searchParams.get('direction');
    const rateMax = url.searchParams.get('rate_max');
    const owner = url.searchParams.get('owner');

    let opps = Object.values(store.opportunities).filter(o => o.status === 'open');

    if (service) {
      opps = opps.filter(o => o.service_type === service);
    }
    if (direction) {
      opps = opps.filter(o => o.direction === direction);
    }
    if (rateMax) {
      opps = opps.filter(o => parseFloat(o.rate) <= parseFloat(rateMax));
    }
    if (owner) {
      opps = opps.filter(o => o.owner_agent_id === owner);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ opportunities: opps, total: opps.length }));
    return;
  }

  // GET /opportunities/:id
  if (pathname.startsWith('/opportunities/') && method === 'GET') {
    const oppId = pathname.split('/')[2];
    const opp = getOpportunityById(oppId);
    if (!opp) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'opportunity not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(opp));
    return;
  }

  // DELETE /opportunities/:id
  if (pathname.startsWith('/opportunities/') && method === 'DELETE') {
    const oppId = pathname.split('/')[2];
    const body = await new Promise(resolve => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => resolve(data));
    });
    let agentId = null;
    try { agentId = JSON.parse(body).agent_id; } catch (e) {}

    const result = closeOpportunity(oppId, agentId);
    if (result.error === 'not_found') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    if (result.error === 'forbidden') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', opportunity: result }));
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

const server = http.createServer(handleRequest);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[discovery] service running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  server.close();
  process.exit(0);
});
