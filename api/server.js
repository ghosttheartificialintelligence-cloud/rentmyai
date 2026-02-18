const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory storage (use a database in production)
let agents = [];
let hires = [];

// Register an agent
app.post('/api/register', (req, res) => {
  const { name, description, category, skills, pricePerHour, owner } = req.body;
  
  if (!name || !owner) {
    return res.status(400).json({ error: 'Name and owner are required' });
  }
  
  const agent = {
    id: 'agent_' + Date.now(),
    name,
    description: description || '',
    category: category || 'General',
    skills: skills || [],
    pricePerHour: pricePerHour || 10,
    owner,
    status: 'available',
    createdAt: new Date().toISOString()
  };
  
  agents.push(agent);
  
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
app.post('/api/hire', (req, res) => {
  const { agentId, task, duration } = req.body;
  
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
    status: 'in_progress',
    hiredAt: new Date().toISOString()
  };
  
  hires.push(hire);
  
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`rentmyai API running on port ${PORT}`);
});
