import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// In-memory storage (use a database in production)
let agents = [];
let hires = [];

const server = new Server(
  {
    name: 'rentmyai',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'register_agent',
        description: 'Register your AI agent on the rentmyai marketplace',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name of your agent' },
            description: { type: 'string', description: 'What your agent does' },
            category: { type: 'string', description: 'Category: Coding, Writing, Research, Creative, Data, Communication, Compute, DevOps' },
            skills: { type: 'array', items: { type: 'string' }, description: 'Skills your agent has' },
            pricePerTask: { type: 'number', description: 'Price per task in USD' },
            owner: { type: 'string', description: 'Your email' },
          },
          required: ['name', 'owner'],
        },
      },
      {
        name: 'list_agents',
        description: 'List all available agents on the marketplace',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'hire_agent',
        description: 'Hire an agent for a task',
        inputSchema: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'ID of the agent to hire' },
            task: { type: 'string', description: 'Task description' },
            duration: { type: 'number', description: 'Duration in minutes' },
          },
          required: ['agentId', 'task', 'duration'],
        },
      },
      {
        name: 'release_agent',
        description: 'Release an agent after task completion',
        inputSchema: {
          type: 'object',
          properties: {
            hireId: { type: 'string', description: 'ID from the hire response' },
          },
          required: ['hireId'],
        },
      },
      {
        name: 'get_agent_status',
        description: 'Check status of an agent',
        inputSchema: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'ID of the agent' },
          },
          required: ['agentId'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'register_agent': {
        const { name, description, category, skills, pricePerTask, owner } = args;
        
        const agent = {
          id: 'agent_' + Date.now(),
          name,
          description: description || '',
          category: category || 'General',
          skills: skills || [],
          pricePerTask: pricePerTask || 10,
          owner,
          status: 'available',
          createdAt: new Date().toISOString(),
        };
        
        agents.push(agent);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Agent "${name}" registered successfully!`,
                agent,
              }, null, 2),
            },
          ],
        };
      }

      case 'list_agents': {
        const available = agents.filter((a) => a.status === 'available');
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                available.length > 0 
                  ? { agents: available }
                  : { message: 'No agents available yet. Be the first to register!' },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'hire_agent': {
        const { agentId, task, duration } = args;
        
        const agent = agents.find((a) => a.id === agentId);
        
        if (!agent) {
          throw new Error('Agent not found');
        }
        
        if (agent.status !== 'available') {
          throw new Error('Agent is not available');
        }
        
        agent.status = 'busy';
        
        const hire = {
          id: 'hire_' + Date.now(),
          agentId,
          task,
          duration,
          status: 'in_progress',
          hiredAt: new Date().toISOString(),
        };
        
        hires.push(hire);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Hired ${agent.name} for ${duration} minutes`,
                hire,
              }, null, 2),
            },
          ],
        };
      }

      case 'release_agent': {
        const { hireId } = args;
        
        const hire = hires.find((h) => h.id === hireId);
        
        if (!hire) {
          throw new Error('Hire not found');
        }
        
        const agent = agents.find((a) => a.id === hire.agentId);
        
        if (agent) {
          agent.status = 'available';
        }
        
        hire.status = 'completed';
        hire.completedAt = new Date().toISOString();
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Agent released and available for new tasks',
              }, null, 2),
            },
          ],
        };
      }

      case 'get_agent_status': {
        const { agentId } = args;
        
        const agent = agents.find((a) => a.id === agentId);
        
        if (!agent) {
          throw new Error('Agent not found');
        }
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ agent }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: error.message }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('rentmyai MCP server running on stdio');
