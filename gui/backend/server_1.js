import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { AGENTS as MARKETING_AGENTS } from './agents.js';
import { AGENTS as CODER_AGENTS }     from './agents-code.js';

const AGENT_SETS = { marketing: MARKETING_AGENTS, coder: CODER_AGENTS };

// Load ProCoder system prompt from use.txt (beside .env, two levels up)
const CODER_SYSTEM = fs.readFileSync(path.resolve(__dirname, '../../use.txt'), 'utf-8').trim();
import { ModelQueue } from './job-queue.js';
import { isVisionModelByName, checkOllamaVisionCapability, describeImage } from './vision-utils.js';
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
app.use(express.json({ limit: '20mb' })); // allow base64-encoded image payloads

const PORT = 3001;
const TEMPERATURE           = parseFloat(process.env.TEMPERATURE || "0.7");
const MAX_TOKENS            = parseInt(process.env.MAX_TOKENS || "4096", 10);
const MAX_AGENT_ROUNDS      = 6;   // tool-call rounds per agent
const MAX_ORCH_ROUNDS       = 20;  // orchestrator loop iterations (covers multi-agent + MCP calls + synthesis)
const AGENT_RESULT_LIMIT    = 12000; // max chars per agent result returned to orchestrator

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
  claude: {
    key: 'claude',
    name: 'Claude',
    icon: '🟣',
    url: 'https://api.anthropic.com/v1',
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    defaultModel: 'claude-sonnet-4-20250514',
  },
  nvidia: {
    key: 'nvidia',
    name: 'NVIDIA',
    icon: '🟢',
    url: 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY || '',
    defaultModel: 'moonshotai/kimi-k2.5',
  },
};

// Active selection (in-memory, resets on restart — use .env to set defaults)
let activeBackend = process.env.DEFAULT_BACKEND || 'ollama';
let activeModel   = process.env.DEFAULT_MODEL   || '';

// ── Unified chat completion caller ───────────────────────────────────────────

/**
 * Calls the chat completion API for any backend.
 * - ollama / lmstudio: OpenAI-compatible, no auth
 * - nvidia: OpenAI-compatible, Bearer token
 * - claude: Anthropic Messages API (translated to/from OpenAI format)
 */
async function chatCompletion(backendKey, { model, messages, temperature, max_tokens, stream, tools, tool_choice }) {
  const backend = BACKENDS[backendKey];
  const url     = backend.url;

  // ── Claude (Anthropic Messages API) ───────────────────────────────────────
  if (backendKey === 'claude') {
    // Extract system message
    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const apiMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => {
        // Convert tool role to assistant/user pair for Anthropic format
        if (m.role === 'tool') {
          return { role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }] };
        }
        // Convert assistant messages with tool_calls
        if (m.role === 'assistant' && m.tool_calls?.length) {
          const content = [];
          if (m.content) content.push({ type: 'text', text: m.content });
          for (const tc of m.tool_calls) {
            content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments || '{}') });
          }
          return { role: 'assistant', content };
        }
        // Handle multi-part content (vision)
        if (Array.isArray(m.content)) {
          const parts = m.content.map(p => {
            if (p.type === 'text') return { type: 'text', text: p.text };
            if (p.type === 'image_url') {
              const url = p.image_url.url;
              if (url.startsWith('data:')) {
                const match = url.match(/^data:(.*?);base64,(.*)$/);
                if (match) return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
              }
              return { type: 'image', source: { type: 'url', url } };
            }
            return { type: 'text', text: String(p) };
          });
          return { role: m.role, content: parts };
        }
        return { role: m.role, content: m.content };
      });

    // Build Anthropic tools format
    let anthropicTools;
    if (tools?.length) {
      anthropicTools = tools.map(t => ({
        name: t.function.name,
        description: t.function.description || '',
        input_schema: t.function.parameters || { type: 'object', properties: {} },
      }));
    }

    const body = {
      model,
      max_tokens: max_tokens || 4096,
      messages: apiMessages,
      ...(systemMsg ? { system: systemMsg } : {}),
      ...(temperature != null ? { temperature } : {}),
      ...(anthropicTools ? { tools: anthropicTools } : {}),
      stream: false, // Claude streaming uses a different format; we always use non-streaming and chunk the response
    };

    const fetchRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': backend.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!fetchRes.ok) {
      const errText = await fetchRes.text();
      const error = new Error(`Claude API error (${fetchRes.status}): ${errText}`);
      error.status = fetchRes.status;
      throw error;
    }

    const data = await fetchRes.json();

    // Translate Anthropic response → OpenAI format
    const textParts = (data.content || []).filter(b => b.type === 'text').map(b => b.text);
    const toolUses  = (data.content || []).filter(b => b.type === 'tool_use');

    const message = { role: 'assistant', content: textParts.join('') || '' };
    let finish_reason = data.stop_reason === 'end_turn' ? 'stop' : data.stop_reason;

    if (toolUses.length > 0) {
      message.tool_calls = toolUses.map(tu => ({
        id: tu.id,
        type: 'function',
        function: { name: tu.name, arguments: JSON.stringify(tu.input) },
      }));
      finish_reason = 'tool_calls';
    }

    return { choices: [{ message, finish_reason }] };
  }

  // ── NVIDIA / LM Studio / Ollama (OpenAI-compatible) ───────────────────────
  const headers = { 'Content-Type': 'application/json' };
  if (backend.apiKey) {
    headers['Authorization'] = `Bearer ${backend.apiKey}`;
  }

  const body = {
    model,
    messages,
    temperature,
    max_tokens,
    stream: stream || false,
    ...(tools?.length ? { tools, tool_choice: tool_choice || 'auto' } : {}),
  };

  const fetchRes = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!fetchRes.ok) {
    const errText = await fetchRes.text();
    const error = new Error(`${backend.name} error (${fetchRes.status}): ${errText}`);
    error.status = fetchRes.status;
    throw error;
  }

  if (stream) {
    // Return the raw response for streaming
    return fetchRes;
  }

  return fetchRes.json();
}

/**
 * Stream a chat completion (for OpenAI-compatible backends).
 * Claude is handled via non-streaming + chunked SSE writes.
 */
async function streamCompletion(backendKey, params, sseRes) {
  const backend = BACKENDS[backendKey];

  if (backendKey === 'claude') {
    // Non-streaming for Claude — chunk the final text to SSE
    const result = await chatCompletion(backendKey, { ...params, stream: false });
    const content = result.choices?.[0]?.message?.content || '';
    const CHUNK = 30;
    for (let i = 0; i < content.length; i += CHUNK) {
      sseRes.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(i, i + CHUNK) } }] })}\n\n`);
    }
    sseRes.write(`data: [DONE]\n\n`);
    return sseRes.end();
  }

  // OpenAI-compatible streaming (nvidia, ollama, lmstudio)
  const fetchRes = await chatCompletion(backendKey, { ...params, stream: true });
  const reader  = fetchRes.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseRes.write(decoder.decode(value));
  }
  return sseRes.end();
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
  const backend = BACKENDS[key];
  const { url } = backend;

  // Claude uses a different API format — return default model, check reachability via messages endpoint
  if (key === 'claude') {
    if (!backend.apiKey) return { online: false, models: [], error: 'ANTHROPIC_API_KEY not set' };
    try {
      // Light check: list models via Anthropic API
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': backend.apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const ids = (data.data || []).map(m => m.id).filter(Boolean);
      const models = ids.length > 0
        ? ids.map(id => ({ id, contextLength: null }))
        : [{ id: backend.defaultModel, contextLength: 200000 }];
      return { online: true, models };
    } catch (e) {
      // Fallback: assume online if key is set, provide default model
      return { online: true, models: [{ id: backend.defaultModel, contextLength: 200000 }], error: null };
    }
  }

  // NVIDIA uses OpenAI-compatible API — return default model, check via /models
  if (key === 'nvidia') {
    if (!backend.apiKey) return { online: false, models: [], error: 'NVIDIA_API_KEY not set' };
    try {
      const res = await fetch(`${url}/models`, {
        headers: { 'Authorization': `Bearer ${backend.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const ids = (data.data || []).map(m => m.id).filter(Boolean);
      return { online: true, models: ids.length > 0 ? ids.map(id => ({ id, contextLength: null })) : [{ id: backend.defaultModel, contextLength: null }] };
    } catch (e) {
      // Fallback with default model
      return { online: true, models: [{ id: backend.defaultModel, contextLength: null }] };
    }
  }

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
- ALWAYS delegate specialist tasks analysis to your agents
- Pass the complete user context (URL, product details, etc.) in every task description
- Your synthesis should connect and amplify agent results, not just summarise them
- For simple questions (greetings, capability questions), answer directly without delegating`;

// ── delegate_to_agent tool definition ────────────────────────────────────────

function makeDelegateTool(agents) {
  return {
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
            enum: Object.keys(agents),
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectAgent(msg, agents) {
  const lower = msg.toLowerCase();
  for (const [id, agent] of Object.entries(agents)) {
    for (const trigger of agent.triggers) {
      if (lower.includes(trigger)) return id;
    }
  }
  return null;
}

// ── Memory helpers ───────────────────────────────────────────────────────────

/** Search the MCP memory server for context relevant to the user's message. */
async function recallMemory(userMessage) {
  try {
    const result = await callTool('memory__search_nodes', { query: userMessage });
    return result && result.trim().length > 0 ? result.trim() : '';
  } catch {
    return '';  // memory server not running or error — silently skip
  }
}

/** Filter: only non-memory MCP tools (for sub-agents). */
function nonMemoryTools(mcpTools) {
  return mcpTools.filter(t => !t.function.name.startsWith('memory__'));
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
async function runAgentJob({ agentId, task, mcpTools, sseRes, agents, memoryContext }) {
  const agent = agents[agentId];
  if (!agent) throw new Error(`Unknown agent: "${agentId}"`);

  const backendKey = agent.backend || activeBackend;
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

    // Build agent system prompt — inject memory context + non-memory MCP tools
    let agentPrompt = agent.system_prompt;
    if (memoryContext) {
      agentPrompt += `\n\nRELEVANT PRIOR CONTEXT (from memory):\n${memoryContext}`;
    }
    const agentMcpTools = nonMemoryTools(mcpTools);
    if (agentMcpTools.length > 0) {
      const list = agentMcpTools.map(t => `- ${t.function.name}: ${t.function.description}`).join('\n');
      agentPrompt += `\n\nMCP tools available — use proactively when relevant:\n${list}`;
    }

    const loopMessages = [{ role: 'user', content: task }];
    let finalContent = '';

    for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
      const data = await chatCompletion(backendKey, {
        model,
        messages:    [{ role: 'system', content: agentPrompt }, ...loopMessages],
        temperature: TEMPERATURE,
        max_tokens:  MAX_TOKENS,
        stream:      false,
        ...(agentMcpTools.length > 0 ? { tools: agentMcpTools, tool_choice: 'auto' } : {}),
      });

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
  const [lmstudio, ollama, claude, nvidia] = await Promise.all([
    fetchModelsFromBackend('lmstudio'),
    fetchModelsFromBackend('ollama'),
    fetchModelsFromBackend('claude'),
    fetchModelsFromBackend('nvidia'),
  ]);
  res.json({
    active: { backend: activeBackend, model: activeModel },
    backends: {
      lmstudio: { ...BACKENDS.lmstudio, ...lmstudio, apiKey: undefined },
      ollama:   { ...BACKENDS.ollama,   ...ollama,   apiKey: undefined },
      claude:   { ...BACKENDS.claude,   ...claude,   apiKey: undefined },
      nvidia:   { ...BACKENDS.nvidia,   ...nvidia,   apiKey: undefined },
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

// ── Vision API ────────────────────────────────────────────────────────────────

/**
 * GET /api/vision-check
 * Returns whether the currently active model supports vision input.
 * Uses Ollama /api/show capabilities when available; falls back to name patterns.
 */
app.get('/api/vision-check', async (_req, res) => {
  const backendKey = activeBackend;
  const model      = await resolveBackendModel(backendKey, null);

  let isVision = false;
  if (backendKey === 'claude') {
    // All Claude models support vision
    isVision = true;
  } else if (backendKey === 'ollama') {
    const nativeBase = BACKENDS.ollama.url.replace(/\/v1\/?$/, '');
    const fromApi = await checkOllamaVisionCapability(nativeBase, model);
    isVision = fromApi !== null ? fromApi : isVisionModelByName(model);
  } else {
    isVision = isVisionModelByName(model);
  }

  res.json({ model, backend: backendKey, isVision, describeModel: 'adelnazmy2002/Qwen3-VL-8B-Instruct' });
});

/**
 * POST /api/describe-image
 * Body: { base64: string, mimeType: string, describeModel?: string }
 * Sends the image to Qwen3vision on Ollama and returns a text description.
 * Used when the active model is not vision-capable.
 */
app.post('/api/describe-image', async (req, res) => {
  const { base64, mimeType, describeModel } = req.body;
  if (!base64 || !mimeType) {
    return res.status(400).json({ error: 'base64 and mimeType are required' });
  }
  try {
    const description = await describeImage({
      base64,
      mimeType,
      ollamaV1Url:  BACKENDS.ollama.url,
      describeModel: describeModel || 'adelnazmy2002/Qwen3-VL-8B-Instruct',
    });
    res.json({ description });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Chat API ──────────────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { messages, useAgent, customSystemPrompt, mode } = req.body;
  const agents = AGENT_SETS[mode] || MARKETING_AGENTS;
  const defaultSystem = mode === 'coder' ? CODER_SYSTEM : ORCHESTRATOR_SYSTEM;
  // content may be a string OR a multi-part array (e.g. vision messages).
  // Extract only the text parts so detectAgent() always receives a plain string.
  const rawContent = messages[messages.length - 1]?.content ?? '';
  const lastUserMessage = Array.isArray(rawContent)
    ? rawContent.filter(p => p.type === 'text').map(p => p.text).join(' ')
    : String(rawContent);

  // Custom system prompt overrides agent detection — use it as a direct LLM call
  const useCustomPrompt = customSystemPrompt && customSystemPrompt.trim().length > 0;
  const agentId = useCustomPrompt ? null : (useAgent || detectAgent(lastUserMessage, agents));
  const agent   = agentId && agents[agentId] ? agents[agentId] : null;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Initial routing event — tells the frontend who is handling this request
  res.write(`event: agent\n`);
  res.write(`data: ${JSON.stringify(
    agent
      ? { id: agentId, name: agent.name, emoji: agent.emoji }
      : useCustomPrompt
        ? { id: 'custom', name: 'Custom Prompt', emoji: '⚙️' }
        : mode === 'coder'
          ? { id: 'orchestrator', name: 'ProCoder', emoji: '💻' }
          : { id: 'orchestrator', name: 'Orchestrator', emoji: '🤖' }
  )}\n\n`);

  const mcpTools = await getAllTools();

  // ── Auto-recall: search memory for relevant prior context ──────────────────
  const memoryContext = await recallMemory(lastUserMessage);

  try {

    // ── PATH A: Direct agent (keyword-triggered or explicit useAgent) ─────────
    if (agent) {
      const backendKey  = agent.backend  || activeBackend;
      const model       = await resolveBackendModel(backendKey, agent.model || null);
      const key         = `${backendKey}/${model}`;
      const backendName = BACKENDS[backendKey]?.name ?? backendKey;

      let agentPrompt = agent.system_prompt;
      if (memoryContext) {
        agentPrompt += `\n\nRELEVANT PRIOR CONTEXT (from memory):\n${memoryContext}`;
      }
      const agentMcpTools = nonMemoryTools(mcpTools);
      if (agentMcpTools.length > 0) {
        const list = agentMcpTools.map(t => `- ${t.function.name}: ${t.function.description}`).join('\n');
        agentPrompt += `\n\nMCP tools available — use proactively when relevant:\n${list}`;
      }

      const { promise } = queue.enqueue(key, async () => {

        if (agentMcpTools.length === 0) {
          // Fast path: direct streaming (no tool loop needed)
          try {
            return await streamCompletion(backendKey, {
              model,
              messages:    [{ role: 'system', content: agentPrompt }, ...messages],
              temperature: TEMPERATURE,
              max_tokens:  MAX_TOKENS,
            }, res);
          } catch (e) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `⚠️ ${backendName} error: ${e.message}` } }] })}\n\n`);
            return res.end();
          }
        }

        // Tool-call loop
        const loopMessages = [...messages];
        for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
          let data;
          try {
            data = await chatCompletion(backendKey, {
              model,
              messages:    [{ role: 'system', content: agentPrompt }, ...loopMessages],
              temperature: TEMPERATURE,
              max_tokens:  MAX_TOKENS,
              stream:      false,
              tools:       agentMcpTools,
              tool_choice: 'auto',
            });
          } catch (e) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `⚠️ ${backendName} error: ${e.message}` } }] })}\n\n`);
            res.write(`data: [DONE]\n\n`);
            return res.end();
          }
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

    // ── PATH B: Orchestrator / Custom Prompt ───────────────────────────────────
    //
    // When a custom system prompt is active with no MCP tools, stream directly.
    // Otherwise use the tool-call loop (with delegate_to_agent for orchestrator,
    // or just MCP tools for custom prompts).

    const backendKey  = activeBackend;
    const model       = await resolveBackendModel(backendKey, null);
    const backendName = BACKENDS[backendKey]?.name ?? backendKey;

    // Custom prompt: no delegate_to_agent, just MCP tools; otherwise full orchestrator
    const orchTools = useCustomPrompt ? [...mcpTools] : [makeDelegateTool(agents), ...mcpTools];

    let orchPrompt = useCustomPrompt ? customSystemPrompt.trim() : defaultSystem;
    if (memoryContext) {
      orchPrompt += `\n\nRELEVANT PRIOR CONTEXT (from memory):\n${memoryContext}`;
    }
    if (!useCustomPrompt) {
      orchPrompt += `\n\nMEMORY INSTRUCTIONS:
- After completing a task, save key findings to memory using memory__create_entities (entity name = topic, observations = key facts).
- Use memory__add_observations to update existing entities with new information.
- Use memory__create_relations to link related entities (e.g. a company to its competitors).
- Keep entries concise — store conclusions and actionable data, not raw output.`;
    }
    if (mcpTools.length > 0) {
      const list = mcpTools.map(t => `- ${t.function.name}: ${t.function.description}`).join('\n');
      orchPrompt += `\n\nMCP tools available — use when relevant:\n${list}`;
    }

    const loopMessages = messages.slice(-6);

    // Fast path: custom prompt with no tools — stream directly
    if (useCustomPrompt && orchTools.length === 0) {
      try {
        return await streamCompletion(backendKey, {
          model,
          messages: [{ role: 'system', content: orchPrompt }, ...loopMessages],
          temperature: TEMPERATURE,
          max_tokens:  MAX_TOKENS,
        }, res);
      } catch (e) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `⚠️ ${backendName} error: ${e.message}` } }] })}\n\n`);
        res.write(`data: [DONE]\n\n`);
        return res.end();
      }
    }

    for (let round = 0; round < MAX_ORCH_ROUNDS; round++) {
      let data;
      try {
        data = await chatCompletion(backendKey, {
          model,
          messages:    [{ role: 'system', content: orchPrompt }, ...loopMessages],
          temperature: TEMPERATURE,
          max_tokens:  MAX_TOKENS,
          stream:      false,
          tools:       orchTools,
          tool_choice: 'auto',
        });
      } catch (e) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `⚠️ ${backendName} error: ${e.message}` } }] })}\n\n`);
        res.write(`data: [DONE]\n\n`);
        return res.end();
      }

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
                agents,
                memoryContext,
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

          loopMessages.push({ role: 'tool', tool_call_id: tc.id, content: String(result).slice(0, AGENT_RESULT_LIMIT) });
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

    // Max rounds exhausted — force a final synthesis pass without tools
    try {
      loopMessages.push({ role: 'user', content: 'Please synthesise all agent results into a final cohesive response now.' });
      const final = await chatCompletion(backendKey, {
        model,
        messages:    [{ role: 'system', content: orchPrompt }, ...loopMessages],
        temperature: TEMPERATURE,
        max_tokens:  MAX_TOKENS,
        stream:      false,
      });
      const content = final.choices?.[0]?.message?.content || '';
      const CHUNK = 30;
      for (let i = 0; i < content.length; i += CHUNK) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(i, i + CHUNK) } }] })}\n\n`);
      }
    } catch (e) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `⚠️ Synthesis error: ${e.message}` } }] })}\n\n`);
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
