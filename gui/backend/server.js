import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import { AGENTS } from './agents.js';
import { ModelQueue } from './job-queue.js';
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
const TEMPERATURE           = parseFloat(process.env.TEMPERATURE || "0.7");
const MAX_TOKENS            = parseInt(process.env.MAX_TOKENS || "4096", 10);
const MAX_AGENT_ROUNDS      = 6;   // tool-call rounds per agent
const MAX_ORCH_ROUNDS       = 12;  // orchestrator loop iterations (covers multi-agent tasks)

// ── Model queue (serialises calls per model key) ──────────────────────────────
const queue = new ModelQueue();

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

function getUrlForBackend(backendKey) {
  return BACKENDS[backendKey]?.url ?? BACKENDS.ollama.url;
}

// ── Context-length helpers ────────────────────────────────────────────────────

async function fetchOllamaContextLength(nativeBase, modelId) {
  try {
    const res = await fetch(`${nativeBase}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId, verbose: false }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const info = data.model_info || {};
    const key = Object.keys(info).find(k => k.endsWith('.context_length'));
    return key ? info[key] : null;
  } catch {
    return null;
  }
}

async function fetchModelsFromBackend(key) {
  const { url } = BACKENDS[key];
  try {
    const res = await fetch(`${url}/models`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const ids = (data.data || []).map(m => m.id).filter(Boolean);

    let models;
    if (key === 'ollama') {
      const nativeBase = url.replace(/\/v1\/?$/, '');
      models = await Promise.all(
        ids.map(async id => ({ id, contextLength: await fetchOllamaContextLength(nativeBase, id) }))
      );
    } else {
      models = ids.map(id => ({ id, contextLength: null }));
    }
    return { online: true, models };
  } catch (e) {
    return { online: false, models: [], error: e.message };
  }
}

/**
 * Resolve the model ID for a given backend.
 * Priority: preferredModel → global activeModel (if same backend) → first available model
 */
async function resolveBackendModel(backendKey, preferredModel) {
  if (preferredModel) return preferredModel;
  const bk = backendKey ?? activeBackend;
  if (bk === activeBackend && activeModel) return activeModel;
  const { models } = await fetchModelsFromBackend(bk);
  return models[0]?.id ?? 'default';
}

// ── Orchestrator system prompt ────────────────────────────────────────────────

const ORCHESTRATOR_SYSTEM = `You are an Orchestrator — the master coordinator of 9 specialist marketing agents.

Your team (use these agent_ids with the delegate_to_agent tool):
  "findkey"         🔍 — broad keyword research: primary, secondary, long-tail, LSI, intent-based
  "findbuykey"      🛒 — buy-intent/transactional keywords for conversions and BOFU
  "findadwords"     📢 — Google Ads intelligence: CPC estimates, competitor ads, negative keywords
  "findbacklinks"   🔗 — backlink opportunities: forums, blogs, directories, editorial links
  "findcompetitors" 🎯 — competitor intelligence: 3-tier market landscape analysis
  "findcritics"     🔬 — quality control: reviews outputs with PASS/REVISE/REDO verdicts
  "findfunnels"     🌊 — sales funnel intelligence: reverse-engineer funnels, hooks, CTAs
  "findideas"       💡 — marketing ideas: promotions, campaigns, 90-day roadmaps
  "findregions"     🌍 — regional sales intelligence: best markets, demand signals, rollout plans

HOW TO WORK:
1. Analyse the user's request — determine which agent(s) are needed
2. Use delegate_to_agent for each needed sub-task, ONE AT A TIME (strictly sequential)
3. Wait for each agent's full result before proceeding to the next delegation
4. After all agents have responded, synthesise their outputs into a final cohesive response

STRICT RULES:
- ALWAYS delegate specialist tasks — never answer domain questions yourself
- Pass the complete user context (URL, product details, etc.) in every task description
- Your synthesis should connect and amplify agent results, not just summarise them
- For simple questions (greetings, capability questions), answer directly without delegating`;

// ── delegate_to_agent tool definition ────────────────────────────────────────

const DELEGATE_TOOL = {
  type: 'function',
  function: {
    name: 'delegate_to_agent',
    description:
      'Delegate a specific sub-task to a specialist agent and wait for their complete analysis. ' +
      'Call ONE agent at a time — wait for the result before calling the next.',
    parameters: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          enum: Object.keys(AGENTS),
          description: 'ID of the specialist agent to delegate to',
        },
        task: {
          type: 'string',
          description:
            'Full task description including all context (URL, product details, user goals, etc.)',
        },
      },
      required: ['agent_id', 'task'],
    },
  },
};

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

// ── Core: run one agent job through the model queue ──────────────────────────

/**
 * Executes an agent's task via the model queue (sequential per model).
 *
 * Emits SSE events to sseRes:
 *   delegating  → job registered (queued or starting immediately)
 *   agent_start → model is now free; agent is executing
 *   tool        → MCP tool calls made by the agent (tagged with agent_id)
 *   agent_done  → agent finished; duration_ms included
 *
 * Returns the agent's complete response text.
 */
async function runAgentJob({ agentId, task, mcpTools, sseRes }) {
  const agent = AGENTS[agentId];
  if (!agent) throw new Error(`Unknown agent: "${agentId}"`);

  const backendKey = agent.backend || activeBackend;
  const url        = getUrlForBackend(backendKey);
  const model      = await resolveBackendModel(backendKey, agent.model || null);
  const key        = `${backendKey}/${model}`;
  const isBusy     = queue.isBusy(key);

  // ① Notify frontend: delegation registered
  sseRes.write(`event: delegating\n`);
  sseRes.write(`data: ${JSON.stringify({
    agent_id: agentId,
    name:     agent.name,
    emoji:    agent.emoji,
    model,
    backend:  backendKey,
    queued:   isBusy,
  })}\n\n`);

  const { promise } = queue.enqueue(key, async () => {
    // ② Model is now free — agent starts executing
    sseRes.write(`event: agent_start\n`);
    sseRes.write(`data: ${JSON.stringify({ agent_id: agentId })}\n\n`);

    const startMs = Date.now();

    // Build agent system prompt — inject MCP tools but NOT delegate_to_agent (no recursion)
    let agentPrompt = agent.system_prompt;
    if (mcpTools.length > 0) {
      const list = mcpTools.map(t => `- ${t.function.name}: ${t.function.description}`).join('\n');
      agentPrompt += `\n\nMCP tools available — use proactively when relevant:\n${list}`;
    }

    const loopMessages = [{ role: 'user', content: task }];
    let finalContent = '';

    for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
      const fetchRes = await fetch(`${url}/chat/completions`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          model,
          messages:    [{ role: 'system', content: agentPrompt }, ...loopMessages],
          temperature: TEMPERATURE,
          max_tokens:  MAX_TOKENS,
          stream:      false,
          ...(mcpTools.length > 0 ? { tools: mcpTools, tool_choice: 'auto' } : {}),
        }),
      });

      if (!fetchRes.ok) {
        throw new Error(`${BACKENDS[backendKey]?.name ?? backendKey} error (${fetchRes.status})`);
      }

      const data   = await fetchRes.json();
      const choice = data.choices?.[0];
      if (!choice) break;

      if (choice.finish_reason === 'tool_calls' && choice.message?.tool_calls?.length) {
        loopMessages.push(choice.message);
        for (const tc of choice.message.tool_calls) {
          let result;
          try {
            result = await callTool(tc.function.name, JSON.parse(tc.function.arguments || '{}'));
          } catch (e) {
            result = `Error: ${e.message}`;
          }
          // ③ Emit tool call — tagged with agent_id so frontend can attribute it
          sseRes.write(`event: tool\n`);
          sseRes.write(`data: ${JSON.stringify({ agent_id: agentId, name: tc.function.name, result: result.slice(0, 300) })}\n\n`);
          loopMessages.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
      } else {
        finalContent = choice.message?.content || '';
        break;
      }
    }

    // ④ Agent done
    sseRes.write(`event: agent_done\n`);
    sseRes.write(`data: ${JSON.stringify({ agent_id: agentId, duration_ms: Date.now() - startMs })}\n\n`);

    return finalContent;
  });

  return promise;
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
  const lastUserMessage = messages[messages.length - 1]?.content || '';

  const agentId = useAgent || detectAgent(lastUserMessage);
  const agent   = agentId && AGENTS[agentId] ? AGENTS[agentId] : null;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Initial routing event — tells the frontend who is handling this request
  res.write(`event: agent\n`);
  res.write(`data: ${JSON.stringify(
    agent
      ? { id: agentId, name: agent.name, emoji: agent.emoji }
      : { id: 'orchestrator', name: 'Orchestrator', emoji: '🤖' }
  )}\n\n`);

  const mcpTools = await getAllTools();

  try {

    // ── PATH A: Direct agent (keyword-triggered or explicit useAgent) ─────────
    if (agent) {
      const backendKey  = agent.backend  || activeBackend;
      const url         = getUrlForBackend(backendKey);
      const model       = await resolveBackendModel(backendKey, agent.model || null);
      const key         = `${backendKey}/${model}`;
      const backendName = BACKENDS[backendKey]?.name ?? backendKey;

      let agentPrompt = agent.system_prompt;
      if (mcpTools.length > 0) {
        const list = mcpTools.map(t => `- ${t.function.name}: ${t.function.description}`).join('\n');
        agentPrompt += `\n\nMCP tools available — use proactively when relevant:\n${list}`;
      }

      const { promise } = queue.enqueue(key, async () => {

        if (mcpTools.length === 0) {
          // Fast path: direct streaming (no tool loop needed)
          const fetchRes = await fetch(`${url}/chat/completions`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              model,
              messages:    [{ role: 'system', content: agentPrompt }, ...messages],
              temperature: TEMPERATURE,
              max_tokens:  MAX_TOKENS,
              stream:      true,
            }),
          });
          if (!fetchRes.ok) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `⚠️ ${backendName} error (${fetchRes.status})` } }] })}\n\n`);
            return res.end();
          }
          const reader  = fetchRes.body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value));
          }
          return res.end();
        }

        // Tool-call loop
        const loopMessages = [...messages];
        for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
          const fetchRes = await fetch(`${url}/chat/completions`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              model,
              messages:    [{ role: 'system', content: agentPrompt }, ...loopMessages],
              temperature: TEMPERATURE,
              max_tokens:  MAX_TOKENS,
              stream:      false,
              tools:       mcpTools,
              tool_choice: 'auto',
            }),
          });
          if (!fetchRes.ok) {
            const err = await fetchRes.text();
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `⚠️ ${backendName} error: ${err}` } }] })}\n\n`);
            res.write(`data: [DONE]\n\n`);
            return res.end();
          }
          const data   = await fetchRes.json();
          const choice = data.choices?.[0];
          if (!choice) break;

          if (choice.finish_reason === 'tool_calls' && choice.message?.tool_calls?.length) {
            loopMessages.push(choice.message);
            for (const tc of choice.message.tool_calls) {
              let result;
              try {
                result = await callTool(tc.function.name, JSON.parse(tc.function.arguments || '{}'));
              } catch (e) {
                result = `Error: ${e.message}`;
              }
              res.write(`event: tool\n`);
              res.write(`data: ${JSON.stringify({ name: tc.function.name, result: result.slice(0, 300) })}\n\n`);
              loopMessages.push({ role: 'tool', tool_call_id: tc.id, content: result });
            }
          } else {
            const content = choice.message?.content || '';
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
      });

      await promise;
      return;
    }

    // ── PATH B: Orchestrator — tool-call loop with delegate_to_agent ──────────
    //
    // The orchestrator is NOT queued itself — it runs as the coordinator.
    // Agent sub-jobs go through the queue via runAgentJob().
    // Sequential execution is guaranteed because we `await runAgentJob()` before
    // processing the next tool call.

    const backendKey  = activeBackend;
    const model       = await resolveBackendModel(backendKey, null);
    const url         = getUrlForBackend(backendKey);
    const backendName = BACKENDS[backendKey]?.name ?? backendKey;

    // Orchestrator gets delegate_to_agent + any MCP tools
    const orchTools = [DELEGATE_TOOL, ...mcpTools];

    let orchPrompt = ORCHESTRATOR_SYSTEM;
    if (mcpTools.length > 0) {
      const list = mcpTools.map(t => `- ${t.function.name}: ${t.function.description}`).join('\n');
      orchPrompt += `\n\nAdditional MCP tools (passed through to agents):\n${list}`;
    }

    const loopMessages = [...messages];

    for (let round = 0; round < MAX_ORCH_ROUNDS; round++) {
      const fetchRes = await fetch(`${url}/chat/completions`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          model,
          messages:    [{ role: 'system', content: orchPrompt }, ...loopMessages],
          temperature: TEMPERATURE,
          max_tokens:  MAX_TOKENS,
          stream:      false,
          tools:       orchTools,
          tool_choice: 'auto',
        }),
      });

      if (!fetchRes.ok) {
        const err = await fetchRes.text();
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `⚠️ ${backendName} error: ${err}` } }] })}\n\n`);
        res.write(`data: [DONE]\n\n`);
        return res.end();
      }

      const data   = await fetchRes.json();
      const choice = data.choices?.[0];
      if (!choice) break;

      if (choice.finish_reason === 'tool_calls' && choice.message?.tool_calls?.length) {
        loopMessages.push(choice.message);

        for (const tc of choice.message.tool_calls) {
          let result;

          if (tc.function.name === 'delegate_to_agent') {
            // ── Delegate to specialist agent (sequential — awaited here) ──────
            const args = JSON.parse(tc.function.arguments || '{}');
            try {
              result = await runAgentJob({
                agentId:  args.agent_id,
                task:     args.task,
                mcpTools,
                sseRes:   res,
              });
            } catch (e) {
              result = `Agent error: ${e.message}`;
            }
          } else {
            // ── Regular MCP tool ──────────────────────────────────────────────
            try {
              result = await callTool(tc.function.name, JSON.parse(tc.function.arguments || '{}'));
              res.write(`event: tool\n`);
              res.write(`data: ${JSON.stringify({ name: tc.function.name, result: result.slice(0, 300) })}\n\n`);
            } catch (e) {
              result = `Error: ${e.message}`;
            }
          }

          loopMessages.push({ role: 'tool', tool_call_id: tc.id, content: String(result) });
        }

      } else {
        // Orchestrator's final synthesis — stream it to the frontend
        const content = choice.message?.content || '';
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
