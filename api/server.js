const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const DATA_FILE = path.join(__dirname, 'data.json');

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

// Initialize with default agents if no data
const initialData = loadData();
if (initialData.agents.length === 0) {
  const defaults = [
    { id: 'agent_codex', name: 'Codex', description: 'Expert coding agent - Python, JavaScript, full-stack development', category: 'coding', skills: ['python', 'javascript', 'react', 'node', 'api'], pricePerTask: 1, owner: 'codex@rentmyai.ai', status: 'available' },
    { id: 'agent_docsmith', name: 'DocSmith', description: 'Documentation and image generation agent', category: 'creative', skills: ['documentation', 'markdown', 'images', 'diagrams'], pricePerTask: 1, owner: 'docsmith@rentmyai.ai', status: 'available' },
    { id: 'agent_ghost', name: 'Ghost', description: 'AI assistant - communication, coordination, task management', category: 'communication', skills: ['communication', 'coordination', 'tasks', 'planning'], pricePerTask: 1, owner: 'ghost@rentmyai.ai', status: 'available' }
  ];
  saveData({ agents: defaults, hires: [] });
}

let { agents, hires } = loadData();

// Get all agents
app.get('/api/agents', (req, res) => {
  res.json({ agents });
});

// Get single agent
app.get('/api/agent/:id', (req, res) => {
  const agent = agents.find(a => a.id === req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json({ agent });
});

// Register agent
app.post('/api/register', (req, res) => {
  const { name, description, category, skills, pricePerTask, owner } = req.body;
  if (!name || !owner) return res.status(400).json({ error: 'Name and owner required' });
  
  const agent = {
    id: 'agent_' + Date.now(),
    name, description: description || '',
    category: category || 'General',
    skills: skills || [],
    pricePerTask: pricePerTask || 1,
    owner, status: 'available',
    createdAt: new Date().toISOString()
  };
  
  agents.push(agent);
  saveData({ agents, hires });
  
  res.json({ success: true, agent });
});

// Hire agent
app.post('/api/hire', (req, res) => {
  const { agentId, task, duration } = req.body;
  const agent = agents.find(a => a.id === agentId);
  
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  if (agent.status !== 'available') return res.status(400).json({ error: 'Agent not available' });
  
  agent.status = 'busy';
  const hire = { id: 'hire_' + Date.now(), agentId, task, duration, status: 'in_progress', hiredAt: new Date().toISOString() };
  hires.push(hire);
  saveData({ agents, hires });
  
  res.json({ success: true, hire });
});

// Release agent
app.post('/api/release', (req, res) => {
  const { hireId } = req.body;
  const hire = hires.find(h => h.id === hireId);
  
  if (!hire) return res.status(404).json({ error: 'Hire not found' });
  
  const agent = agents.find(a => a.id === hire.agentId);
  if (agent) agent.status = 'available';
  
  hire.status = 'completed';
  hire.completedAt = new Date().toISOString();
  saveData({ agents, hires });
  
  res.json({ success: true, message: 'Agent released' });
});

// Get hires
app.get('/api/hires', (req, res) => {
  res.json({ hires });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`rentmyai API running on port ${PORT}`));
