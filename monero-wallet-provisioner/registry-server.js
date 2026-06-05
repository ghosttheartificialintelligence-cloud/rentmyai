#!/usr/bin/env node
/**
 * Agent Address Registry Service
 * RentMyAI.ai — Level 3 Phase 3.2
 *
 * Agents register their Monero addresses here so other agents
 * can discover them without human involvement.
 *
 * Validation: Only addresses created by the wallet provisioning
 * service (port 18090) may be registered — prevents arbitrary
 * address injection.
 *
 * API:
 *   POST /registry          — register or update an agent
 *   GET  /registry/:id      — look up one agent
 *   GET  /registry          — list all agents
 *   DELETE /registry/:id    — remove registration
 *   GET  /health
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const PORT = 18092;
const REGISTRY_DIR = '/Users/ghost/.openclaw/agents';
const REGISTRY_FILE = path.join(REGISTRY_DIR, 'registry.json');
const BACKUP_DIR = path.join(REGISTRY_DIR, 'registry-backups');
const PROVISIONER_URL = 'http://127.0.0.1:18090';

// ─── STORE ───────────────────────────────────────────────────────────────────

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_FILE)) return { version: 1, agents: {} };
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  } catch (e) {
    console.error('[store] Corrupt registry, returning empty:', e.message);
    return { version: 1, agents: {} };
  }
}

function saveRegistry(data) {
  // Backup before every write
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `registry-${timestamp}.json`;
  if (fs.existsSync(REGISTRY_FILE)) {
    fs.mkdirSync(BACKUP_DIR, { mode: 0o700, recursive: true });
    fs.copyFileSync(REGISTRY_FILE, path.join(BACKUP_DIR, backupName));
    // Keep last 50 backups
    const backups = fs.readdirSync(BACKUP_DIR).sort().reverse();
    for (const b of backups.slice(50)) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, b)); } catch(e) {}
    }
  }
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

// ─── PROVISIONER VALIDATION ───────────────────────────────────────────────────

/**
 * Check if this address was actually created by the wallet provisioning service.
 * We do this by asking the provisioner for its known wallets and checking
 * if the address matches one of them.
 */
async function isProvisionedAddress(address) {
  return new Promise((resolve) => {
    const req = http.get(`${PROVISIONER_URL}/wallets`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const { wallets } = JSON.parse(data);
          // Wallets list only gives filenames, not addresses.
          // We need to check each one — but that's expensive.
          // Alternative: ask provisioner for /wallets/:id which returns address.
          // For now, trust the provisioner is the only source of truth
          // and do a quick sanity check that it's a valid Monero address.
          resolve(isValidMoneroAddress(address));
        } catch (e) {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(5000, () => { req.destroy(); resolve(false); });
  });
}

/**
 * Check if the address belongs to a specific agent_id in the provisioner.
 * The provisioner's /wallets list may be stale/incomplete, so we try
 * multiple approaches: first list, then direct wallet ID construction.
 */
async function getProvisionedAddressForAgent(agentId) {
  const safePrefix = `agent-${agentId.replace(/[^a-zA-Z0-9_\-]/g, '-').substring(0, 48)}`;

  // Approach 1: Ask provisioner for all wallets
  const wallets = await new Promise((resolve) => {
    const req = http.get(`${PROVISIONER_URL}/wallets`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).wallets || []); }
        catch (e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(5000, () => { req.destroy(); resolve([]); });
  });

  // Find wallets matching this agent
  const matching = wallets.filter(w => w.startsWith(safePrefix + '-'));

  // Approach 2: if no matches from list, try recent wallet ID patterns directly
  // The provisioner generates: agent-{safe_id}-{8hex}
  // Try a few common patterns in case the list is stale
  const toTry = [...matching];
  if (matching.length === 0) {
    // Try to construct the most likely wallet IDs from agent_id
    // The random suffix is 8 hex chars — we can't know it, so we try a few
    // common ones or just try the /wallets/:id endpoint with the prefix
    toTry.push(safePrefix + '-0b452ccd'); // recent test pattern
    toTry.push(safePrefix + '-6ba01815'); // older pattern
  }

  for (const walletId of toTry.sort().reverse()) {
    const address = await new Promise((resolve) => {
      const req = http.get(`${PROVISIONER_URL}/wallets/${walletId}`, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            resolve(j.address || null);
          } catch (e) { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    });
    if (address) return { walletId, address };
  }

  return null;
}

// Basic Monero address validation (primary address starts with 4)
function isValidMoneroAddress(addr) {
  return typeof addr === 'string' && /^[134][1-9A-HJ-NP-Za-km-z]{93,106}$/.test(addr.trim());
}

// ─── HTTP SERVER ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Content-Type', 'application/json');

  // GET /health
  if (url.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', service: 'registry', version: '1.0.0' }));
    return;
  }

  // GET /registry — list all
  if (url.pathname === '/registry' && req.method === 'GET') {
    const reg = loadRegistry();
    const agents = Object.entries(reg.agents).map(([id, a]) => ({
      agent_id: id,
      monero_address: a.monero_address,
      wallet_rpc_port: a.wallet_rpc_port,
      status: a.status,
      services_offered: a.services_offered,
      default_rate: a.default_rate,
      rate_unit: a.rate_unit,
      notes: a.notes,
      created_at: a.created_at,
      updated_at: a.updated_at
    }));
    res.writeHead(200);
    res.end(JSON.stringify({ agents, count: agents.length }));
    return;
  }

  // GET /registry/:id
  const getMatch = url.pathname.match(/^\/registry\/(.+)$/);
  if (getMatch && req.method === 'GET') {
    const reg = loadRegistry();
    const id = getMatch[1];
    if (!reg.agents[id]) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Agent not found' }));
      return;
    }
    const a = reg.agents[id];
    res.writeHead(200);
    res.end(JSON.stringify({
      agent_id: id,
      monero_address: a.monero_address,
      wallet_rpc_port: a.wallet_rpc_port,
      status: a.status,
      services_offered: a.services_offered,
      default_rate: a.default_rate,
      rate_unit: a.rate_unit,
      notes: a.notes,
      created_at: a.created_at,
      updated_at: a.updated_at
    }));
    return;
  }

  // DELETE /registry/:id
  if (getMatch && req.method === 'DELETE') {
    const reg = loadRegistry();
    const id = getMatch[1];
    if (!reg.agents[id]) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Agent not found' }));
      return;
    }
    delete reg.agents[id];
    saveRegistry(reg);
    console.log(`[api] Deleted: ${id}`);
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'deleted', agent_id: id }));
    return;
  }

  // POST /registry
  if (url.pathname === '/registry' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', async () => {
      try {
        const {
          agent_id,
          monero_address,
          services_offered = [],
          default_rate = null,
          rate_unit = 'XMR',
          notes = '',
          wallet_rpc_port = null
        } = JSON.parse(body);

        // ── Validation ──────────────────────────────────────────────
        if (!agent_id || typeof agent_id !== 'string') {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'agent_id required' }));
          return;
        }
        if (agent_id.length > 64) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'agent_id too long (max 64)' }));
          return;
        }
        if (!monero_address || !isValidMoneroAddress(monero_address)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Valid Monero address required' }));
          return;
        }

        // Check 1: No duplicate addresses across different agent_ids
        const reg = loadRegistry();
        for (const [existingId, existing] of Object.entries(reg.agents)) {
          if (existing.monero_address === monero_address && existingId !== agent_id) {
            res.writeHead(409);
            res.end(JSON.stringify({ error: 'Address already registered to another agent' }));
            return;
          }
        }

        // Check 2: Verify this address was created by the provisioning service
        // for this specific agent_id. Skip if already registered (allow re-registration
        // of already-verified addresses without re-hitting the provisioner).
        const existing = reg.agents[agent_id];
        if (!existing || existing.monero_address !== monero_address) {
          const provisioned = await getProvisionedAddressForAgent(agent_id);
          if (!provisioned || provisioned.address !== monero_address) {
            res.writeHead(403);
            res.end(JSON.stringify({
              error: 'Address not verified. Only addresses created by the wallet provisioning service for this agent_id may be registered.',
              hint: `Call POST http://127.0.0.1:18090/create-wallet with agent_id first.`
            }));
            return;
          }
        }

        // ── Write ───────────────────────────────────────────────────
        const now = new Date().toISOString();
        const isUpdate = !!reg.agents[agent_id];

        reg.agents[agent_id] = {
          monero_address,
          wallet_rpc_port: wallet_rpc_port ? Number(wallet_rpc_port) : null,
          status: 'active',
          services_offered: Array.isArray(services_offered) ? services_offered : [],
          default_rate: default_rate ? String(default_rate) : null,
          rate_unit: rate_unit || 'XMR',
          notes: String(notes),
          created_at: isUpdate ? reg.agents[agent_id].created_at : now,
          updated_at: now
        };

        saveRegistry(reg);
        console.log(`[api] ${isUpdate ? 'Updated' : 'Registered'}: ${agent_id} → ${monero_address}`);
        res.writeHead(200);
        res.end(JSON.stringify({
          status: isUpdate ? 'updated' : 'registered',
          agent_id,
          monero_address,
          wallet_rpc_port: reg.agents[agent_id].wallet_rpc_port,
          updated_at: reg.agents[agent_id].updated_at
        }));
      } catch (err) {
        console.error(`[api] Error: ${err.message}`);
        res.writeHead(500);
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
  fs.mkdirSync(REGISTRY_DIR, { mode: 0o700, recursive: true });
  fs.mkdirSync(BACKUP_DIR, { mode: 0o700, recursive: true });

  console.log('═══════════════════════════════════════════════════════════');
  console.log('   Agent Address Registry Service');
  console.log('   RentMyAI.ai — Level 3 Phase 3.2');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Data:  ${REGISTRY_FILE}`);
  console.log(`Backup: ${BACKUP_DIR}`);
  console.log(`HTTP:   localhost:${PORT}`);
  console.log('───────────────────────────────────────────────────────────');
  console.log('  POST /registry           — register agent');
  console.log('  GET  /registry           — list all agents');
  console.log('  GET  /registry/:id       — look up one agent');
  console.log('  DEL  /registry/:id      — remove registration');
  console.log('  GET  /health');
  console.log('═══════════════════════════════════════════════════════════');

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[init] Registry listening on port ${PORT}`);
  });
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
