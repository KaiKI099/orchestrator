# Orchestrator — Multi-Agent AI System

A multi-agent orchestration system with two specialist agent teams: **Marketing** (9 agents for SEO, ads, and growth research) and **ProCoder** (12 agents for local software development). Supports local models via **Ollama** and **LM Studio**, plus cloud models via **Anthropic Claude** and **NVIDIA NIM**.

---

## Agent Teams

Switch between teams in the UI. Each team has its own orchestrator and specialist agents.

### Marketing Team — 9 agents

| Agent | Emoji | Speciality |
|---|---|---|
| `findkey` | 🔍 | Broad SEO keyword research — primary, secondary, long-tail, LSI, intent |
| `findbuykey` | 🛒 | Buy-intent & transactional keywords — price, deal, review terms |
| `findadwords` | 📢 | Google Ads intelligence — CPC estimates, ad copy, competitor ads |
| `findbacklinks` | 🔗 | Backlink opportunities — forums, guest posts, directories, partnerships |
| `findcompetitors` | 🎯 | Competitor tier analysis — market leaders, mid-market, emerging players |
| `findcritics` | 🔬 | QA / quality control — reviews other agents, gives PASS / REVISE / REDO |
| `findfunnels` | 🌊 | Sales funnel reverse-engineering — CTAs, hooks, upsells, retention |
| `findideas` | 💡 | Creative ideas & 90-day roadmaps — channels, campaigns, strategies |
| `findregions` | 🌍 | Regional market intelligence — demand signals, buyer behaviour by region |

### ProCoder Team — 12 agents

A local coding assistant squad. Describe what you want to build — the orchestrator delegates to the right specialist.

| Agent | Emoji | Speciality |
|---|---|---|
| `architect` | 🏗️ | System design, tech stacks, API contracts, data flows, ADRs |
| `nodepro` | 🟩 | Node.js / TypeScript — APIs, Express, Fastify, NestJS, async patterns |
| `pythonpro` | 🐍 | Python — FastAPI, Django, Flask, data pipelines, scripting |
| `fullstackpro` | 🌐 | React, Next.js, Vue, HTML/CSS, UI components, accessibility |
| `dbpro` | 🗄️ | Schema design, SQL/NoSQL, migrations, indexing, query optimisation |
| `devopspro` | 🚀 | Docker, CI/CD, Kubernetes, cloud platforms, IaC, monitoring |
| `testpro` | 🧪 | Unit, integration & e2e tests — strategy, coverage, mocking, TDD |
| `secpro` | 🔒 | OWASP Top 10, auth/authz, secrets management, secure code review |
| `reviewpro` | 🔬 | Code quality — smells, performance, maintainability; PASS/REVISE/REDO |
| `docpro` | 📝 | README, API docs, inline comments, changelogs, ADRs |
| `uxpro` | 🎨 | UI/UX — wireframes, design systems, user flows, component specs |
| `upgradepro` | ⬆️ | Audits UIs and code for UX issues, performance bottlenecks, improvements |

```
You: "build a REST API with auth and postgres"
          ↓
  Orchestrator analyses intent
          ↓
  🏗️ architect → defines structure and contracts
  🟩 nodepro   → writes the API code
  🗄️ dbpro     → designs the schema
  🔒 secpro    → reviews auth implementation
```

---

## Architecture

```
┌──────────────────────────────────────┐
│          Web UI  (React)             │  ← Vite dev server :5173
│  chat · model picker · team switcher │
│  MCP toggles · system prompt editor  │
└──────────────┬───────────────────────┘
               │ SSE stream
┌──────────────▼───────────────────────┐
│       Backend API  (Express)         │  ← port 3001
│  /api/chat  /api/models  /mcp        │
└──────────────┬───────────────────────┘
               │
      ┌────────▼──────────┐
      │    Orchestrator   │  routes to specialist agents
      │  Marketing / Pro  │
      └────────┬──────────┘
               │
   ┌───────────▼──────────────────────────┐
   │  Ollama / LM Studio  (local)         │  ← your own hardware
   │  Claude / NVIDIA NIM (cloud)         │  ← API key required
   └───────────┬──────────────────────────┘
               │  (optional)
   ┌───────────▼──────────────────────────┐
   │  MCP Servers                         │
   │  memory · filesystem · github        │
   │  desktop-commander                   │
   └──────────────────────────────────────┘
```

---

## Setup

### Prerequisites

- [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai) for local models
- Node.js 18+
- **Cloud models (optional):** Anthropic API key and/or NVIDIA NIM API key

---

### 1 — Start your local model

**Ollama:**
```bash
ollama serve
ollama pull qwen2.5:14b
```

**LM Studio:**
Load a model → Local Server tab → Start Server (default port 1234)

---

### 2 — Configure environment

```bash
cp .env.example .env
```

```env
LM_STUDIO_URL=http://192.168.x.x:1234/v1
OLLAMA_URL=http://localhost:11434/v1
DEFAULT_BACKEND=ollama          # ollama | lmstudio | claude | nvidia
DEFAULT_MODEL=                  # leave blank = auto-detect
TEMPERATURE=0.7
MAX_TOKENS=32752
STREAM=true

# Cloud (optional)
ANTHROPIC_API_KEY=sk-ant-...
NVIDIA_API_KEY=nvapi-...
```

For ProCoder, place your coding system prompt in `use.txt` at the repo root. The backend loads it automatically at startup.

---

### 3 — Start the web UI

```bash
cd gui
./start.sh
```

Opens at [http://localhost:5173](http://localhost:5173). Use the team switcher in the UI to toggle between **Marketing** and **ProCoder**.

Or start manually:

```bash
# Backend
cd gui/backend && npm install && node server.js

# Frontend (new terminal)
cd gui/frontend && npm install && npm run dev
```

---

## MCP Tool Integration

Enable/disable MCP servers live from the UI without restarting:

| Server | What it gives agents |
|---|---|
| `memory` | Persistent cross-session memory |
| `filesystem` | Read/write access to local files |
| `github` | Repo browsing, issue/PR access |
| `desktop-commander` | Shell commands, process control |

Configure servers in `mcp-config.json`.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, lucide-react |
| Backend | Express 5, Node.js ESM |
| LLM runtime | Ollama · LM Studio (local) · Claude · NVIDIA NIM (cloud) |
| Tool protocol | Model Context Protocol (MCP) |
| Streaming | Server-Sent Events (SSE) |

---

## Project Structure

```
orchestrator/
├── .env                     Environment variables (not committed)
├── use.txt                  ProCoder system prompt (loaded at runtime)
├── mcp-config.json          MCP server configuration
│
└── gui/
    ├── start.sh
    ├── backend/
    │   ├── server.js        Express API — handles both agent teams
    │   ├── agents.js        Marketing agent definitions
    │   ├── agents-code.js   ProCoder agent definitions
    │   ├── vision-utils.js  Image description via vision models
    │   └── mcp-manager.js   MCP server lifecycle
    └── frontend/
        └── src/
            ├── App.jsx           Main chat interface + team switcher
            ├── ModelSelector.jsx  Backend & model picker
            └── McpSettings.jsx    MCP toggle UI
```

---

## License

MIT
