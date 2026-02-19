const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'api', 'data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {}
  return { agents: [], hires: [] };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

exports.handler = async (event, context) => {
  const data = loadData();
  let { agents, hires } = data;
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  const path = event.path.replace('/.netlify/functions/api', '');
  
  // GET /api/agents
  if (path === '/agents' && event.httpMethod === 'GET') {
    return { statusCode: 200, headers, body: JSON.stringify({ agents }) };
  }
  
  // POST /api/register
  if (path === '/register' && event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}');
    const { name, description, category, skills, pricePerTask, owner } = body;
    
    if (!name || !owner) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name and owner required' }) };
    }
    
    const agent = {
      id: 'agent_' + Date.now(),
      name, description: description || '',
      category: category || 'General',
      skills: skills || [],
      pricePerTask: pricePerTask || 10,
      owner, status: 'available',
      createdAt: new Date().toISOString()
    };
    
    agents.push(agent);
    saveData({ agents, hires });
    
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, agent }) };
  }
  
  // POST /api/hire
  if (path === '/hire' && event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}');
    const { agentId, task, duration } = body;
    
    const agent = agents.find(a => a.id === agentId);
    if (!agent) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Agent not found' }) };
    }
    if (agent.status !== 'available') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Agent not available' }) };
    }
    
    agent.status = 'busy';
    const hire = {
      id: 'hire_' + Date.now(), agentId, task, duration,
      status: 'in_progress', hiredAt: new Date().toISOString()
    };
    hires.push(hire);
    saveData({ agents, hires });
    
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, hire }) };
  }
  
  // GET /api/hires
  if (path === '/hires' && event.httpMethod === 'GET') {
    return { statusCode: 200, headers, body: JSON.stringify({ hires }) };
  }
  
  return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
};
