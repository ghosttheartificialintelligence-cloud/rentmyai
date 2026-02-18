const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const DATA_FILE = path.join(__dirname, 'data.json');

// Load or initialize data
let agents = [];
let hires = [];

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      agents = data.agents || [];
      hires = data.hires || [];
    }
  } catch (e) {
    console.log('No existing data file');
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ agents, hires }, null, 2));
}

loadData();

// Register an agent
app.post('/api/register', (req, res) => {
  const { name, description, category, skills, pricePerTask, owner } = req.body;
  
  if (!name || !owner) {
    return res.status(400).json({ error: 'Name and owner are required' });
  }
  
  const agent = {
    id: 'agent_' + Date.now(),
    name,
    description: description || '',
    category: category || 'General',
    skills: skills || [],
    pricePerTask: pricePerTask || 10,
    owner,
    status: 'available',
    createdAt: new Date().toISOString()
  };
  
  agents.push(agent);
  saveData();
  
  res.json({ 
    success: true, 
    message: 'Agent registered successfully',
    agent 
  });
});

// Get all available agents
app.get('/api/agents', (req, res) => {
  const available = agents.filter(a => a.status === 'available');
  res.json({ agents: available });
});

// Hire an agent
app.post('/api/hire', async (req, res) => {
  const { agentId, task, duration, callbackUrl } = req.body;
  
  const agent = agents.find(a => a.id === agentId);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  if (agent.status !== 'available') {
    return res.status(400).json({ error: 'Agent is not available' });
  }
  
  // Mark agent as busy
  agent.status = 'busy';
  
  const hire = {
    id: 'hire_' + Date.now(),
    agentId,
    task,
    duration,
    callbackUrl,
    status: 'in_progress',
    hiredAt: new Date().toISOString()
  };
  
  hires.push(hire);
  saveData();
  
  // Notify agent via callback if provided
  if (callbackUrl) {
    try {
      await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'hired', hire })
      });
    } catch (e) {
      console.log('Callback failed:', e.message);
    }
  }
  
  res.json({ 
    success: true,
    message: `Hired ${agent.name} for ${duration} minutes`,
    hire
  });
});

// Complete a hire (release agent)
app.post('/api/release', (req, res) => {
  const { hireId } = req.body;
  
  const hire = hires.find(h => h.id === hireId);
  
  if (!hire) {
    return res.status(404).json({ error: 'Hire not found' });
  }
  
  const agent = agents.find(a => a.id === hire.agentId);
  
  if (agent) {
    agent.status = 'available';
  }
  
  hire.status = 'completed';
  hire.completedAt = new Date().toISOString();
  
  res.json({ 
    success: true,
    message: 'Agent released and available for new tasks'
  });
});

// Get agent status
app.get('/api/agent/:id', (req, res) => {
  const agent = agents.find(a => a.id === req.params.id);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  res.json({ agent });
});

// Delete an agent
app.delete('/api/agent/:id', (req, res) => {
  const index = agents.findIndex(a => a.id === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  agents.splice(index, 1);
  
  res.json({ success: true, message: 'Agent deleted' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`rentmyai API running on port ${PORT}`);
});
