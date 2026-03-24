import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import { AGENTS } from './agents.js';
import {
  initialize as mcpInitialize,
  ensureRunning as mcpEnsureRunning,
  getConfig as mcpGetConfig,
  toggleServer as mcpToggle,
  getAllTools,
  callTool,
} from './mcp-manager.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;
const TEMPERATURE = parseFloat(process.env.TEMPERATURE || "0.7");
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || "4096", 10);

// ── Backend registry ──────────────────────────────────────────────────────────

const BACKENDS = {
  lmstudio: {
    key: 'lmstudio',
    name: 'LM Studio',
    icon: '🖥️',
    url: process.env.LM_STUDIO_URL || "http://localhost:1234/v1",
  },
  ollama: {
    key: 'ollama',
    name: 'Ollama',
    icon: '🦙',
    url: process.env.OLLAMA_URL || "http://localhost:11434/v1",
  },
};

// Active selection (in-memory, resets on restart — use .env to set defaults)
let activeBackend = process.env.DEFAULT_BACKEND || 'ollama';
let activeModel   = process.env.DEFAULT_MODEL   || '';

function getActiveUrl() {
  return BACKENDS[activeBackend]?.url ?? BACKENDS.ollama.url;
}

async function fetchModelsFromBackend(key) {
  const { url, name } = BACKENDS[key];
  try {
    const res = await fetch(`${url}/models`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.data || []).map(m => m.id).filter(Boolean);
    return { online: true, models };
  } catch (e) {
    return { online: false, models: [], error: e.message };
  }
}

async function resolveModel() {
  if (activeModel) return activeModel;
  // Auto-detect: first model from active backend
  const { models } = await fetchModelsFromBackend(activeBackend);
  return models[0] ?? 'default';
}

// ── Orchestrator system prompt ────────────────────────────────────────────────

const ORCHESTRATOR_SYSTEM = `You are an Orchestrator — the master coordinator of 9 specialist marketing agents.

Your team:
  🔍 findkey         — broad keyword research (SEO)
  🛒 findbuykey      — buy-intent / transactional keywords
  📢 findadwords     — Google Ads, CPC, competitor ad analysis
  🔗 findbacklinks   — backlink opportunities, link building
  🎯 findcompetitors — competitor intelligence, tier analysis
  🔬 findcritics     — quality control, PASS/REVISE/REDO verdicts
  🌊 findfunnels     — sales funnel reverse engineering
  💡 findideas       — marketing ideas, 90-day roadmaps
  🌍 findregions     — regional sales intelligence

Your job:
1. Understand what the user needs
2. Decide which agent (or combination) is best suited
3. If the task spans multiple agents, coordinate them and synthesize outputs
4. Be transparent: always state which agent you are routing to
5. If the user names an agent directly, route there immediately

Routing format: start your reply with "→ Routing to [emoji] [agent name]..."
For general questions, answer directly without routing.
Keep your own framing concise — let the specialist agents do the heavy lifting.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectAgent(msg) {
  const lower = msg.toLowerCase();
  for (const [id, agent] of Object.entries(AGENTS)) {
    for (const trigger of agent.triggers) {
      if (lower.includes(trigger)) return id;
    }
  }
  return null;
}

// ── Model API ─────────────────────────────────────────────────────────────────

app.get('/api/models', async (_req, res) => {
  const [lmstudio, ollama] = await Promise.all([
    fetchModelsFromBackend('lmstudio'),
    fetchModelsFromBackend('ollama'),
  ]);
  res.json({
    active: { backend: activeBackend, model: activeModel },
    backends: {
      lmstudio: { ...BACKENDS.lmstudio, ...lmstudio },
      ollama:   { ...BACKENDS.ollama,   ...ollama   },
    },
  });
});

app.post('/api/models/select', (req, res) => {
  const { backend, model } = req.body;
  if (!BACKENDS[backend]) return res.status(400).json({ error: `Unknown backend: ${backend}` });
  activeBackend = backend;
  activeModel   = model || '';
  console.log(`🔀 Backend: ${BACKENDS[backend].name}  Model: ${activeModel || '(auto)'}`);
  res.json({ active: { backend: activeBackend, model: activeModel } });
});

// ── MCP API ───────────────────────────────────────────────────────────────────

app.get('/api/mcp', async (_req, res) => {
  try {
    await mcpEnsureRunning();
    res.json(mcpGetConfig());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/mcp/toggle/:name', async (req, res) => {
  try {
    const config = await mcpToggle(req.params.name, Boolean(req.body.enabled));
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Chat API ──────────────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { messages, useAgent } = req.body;
  const lastUserMessage = messages[messages.length - 1]?.content || "";

  const agentId = useAgent || detectAgent(lastUserMessage);
  const agent   = agentId && AGENTS[agentId] ? AGENTS[agentId] : null;
  const systemPrompt = agent ? agent.system_prompt : ORCHESTRATOR_SYSTEM;

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Routing metadata
  res.write(`event: agent\n`);
  res.write(`data: ${JSON.stringify(
    agent
      ? { id: agentId, name: agent.name, emoji: agent.emoji }
      : { id: 'orchestrator', name: 'Orchestrator', emoji: '🤖' }
  )}\n\n`);

  const [tools, model] = await Promise.all([getAllTools(), resolveModel()]);
  const baseUrl = getActiveUrl();
  const backendLabel = BACKENDS[activeBackend]?.name ?? activeBackend;

  // Inject MCP tool descriptions into system prompt
  let activeSystemPrompt = systemPrompt;
  if (tools.length > 0) {
    const toolList = tools.map(t => `- ${t.function.name}: ${t.function.description}`).join('\n');
    activeSystemPrompt += `\n\nYou have access to the following MCP tools — use them proactively when relevant:\n${toolList}`;
  }

  try {
    if (tools.length === 0) {
      // ── Direct streaming (no tool loop needed) ────────────────────────────
      const fetchRes = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: activeSystemPrompt }, ...messages],
          temperature: TEMPERATURE,
          max_tokens: MAX_TOKENS,
          stream: true,
        }),
      });

      if (!fetchRes.ok) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `⚠️ ${backendLabel} error (${fetchRes.status})` } }] })}\n\n`);
        return res.end();
      }

      const reader = fetchRes.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value));
      }
      return res.end();
    }

    // ── MCP tool-call loop ────────────────────────────────────────────────────
    let loopMessages = [...messages];
    const MAX_ROUNDS = 6;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const fetchRes = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: activeSystemPrompt }, ...loopMessages],
          temperature: TEMPERATURE,
          max_tokens: MAX_TOKENS,
          stream: false,
          tools,
          tool_choice: "auto",
        }),
      });

      if (!fetchRes.ok) {
        const errText = await fetchRes.text();
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `⚠️ ${backendLabel} error: ${errText}` } }] })}\n\n`);
        res.write(`data: [DONE]\n\n`);
        return res.end();
      }

      const data = await fetchRes.json();
      const choice = data.choices?.[0];
      if (!choice) break;

      if (choice.finish_reason === "tool_calls" && choice.message?.tool_calls?.length) {
        loopMessages.push(choice.message);
        for (const toolCall of choice.message.tool_calls) {
          let result;
          try {
            result = await callTool(toolCall.function.name, JSON.parse(toolCall.function.arguments || "{}"));
          } catch (e) {
            result = `Error: ${e.message}`;
          }
          res.write(`event: tool\n`);
          res.write(`data: ${JSON.stringify({ name: toolCall.function.name, result: result.slice(0, 300) })}\n\n`);
          loopMessages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
        }
      } else {
        const content = choice.message?.content || "";
        const CHUNK = 30;
        for (let i = 0; i < content.length; i += CHUNK) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(i, i + CHUNK) } }] })}\n\n`);
        }
        res.write(`data: [DONE]\n\n`);
        return res.end();
      }
    }

    res.write(`data: [DONE]\n\n`);
    res.end();

  } catch (e) {
    console.error(e);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `⚠️ Error: ${e.message}` } }] })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

await mcpInitialize();

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log(`Active backend: ${BACKENDS[activeBackend].name} — model: ${activeModel || '(auto-detect)'}`);
});
