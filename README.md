# 🤖 Orchestrator — Local AI Marketing Agent

A multi-agent marketing research system that routes your questions to 9 specialist AI agents — running entirely on your own hardware via **Ollama** or **LM Studio** Select and start already installed Models on GUI dropdown menu. No cloud, no API keys, no cost per token.

![screenshot](https://github.com/user-attachments/assets/placeholder)

---

## What it does

You ask a marketing question. The orchestrator decides which specialist agent handles it (or chains multiple agents). Each agent has a deep system prompt tuned for its domain and returns structured, actionable output.

```
You: "find keywords for my SaaS landing page"
       ↓
Orchestrator detects intent
       ↓
🔍 findkey agent answers  (primary, secondary, long-tail, LSI, intent clusters)
```

---

## The 9 Agents

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

---

## Architecture

```
┌─────────────────────────────────┐
│         Web UI  (React)         │  ← Vite dev server
│  chat · model picker · MCP UI  │
└────────────┬────────────────────┘
             │ SSE stream
┌────────────▼────────────────────┐
│      Backend API  (Express)     │  ← port 3001
│  /api/chat  /api/models  /mcp   │
└────────────┬────────────────────┘
             │
    ┌────────▼─────────┐
    │  Orchestrator    │  routes to specialist agents
    │  (system prompt) │
    └────────┬─────────┘
             │
    ┌────────▼─────────────────────────┐
    │   LM Studio  or  Ollama          │  ← your local model
    │   OpenAI-compatible API          │
    └──────────────────────────────────┘
             │  (optional)
    ┌────────▼─────────────────────────┐
    │   MCP Servers                    │
    │   memory · filesystem · github   │
    │   desktop-commander              │
    └──────────────────────────────────┘
```

---

## Setup

### Prerequisites

- [Ollama](https://ollama.com) **or** [LM Studio](https://lmstudio.ai) running locally
- Node.js 18+
- Python 3.10+

---

### 1 — Start your local model

**Ollama (recommended):**
```bash
ollama serve
ollama pull qwen2.5:14b   # or any model you prefer
```

**LM Studio:**
- Load a model → Local Server tab → Start Server (default port 1234)

---

### 2 — Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
LM_STUDIO_URL=http://192.168.x.x:1234/v1   # your LM Studio IP
OLLAMA_URL=http://localhost:11434/v1
DEFAULT_BACKEND=ollama                       # ollama | lmstudio
DEFAULT_MODEL=                               # leave blank = auto-detect
TEMPERATURE=0.7
MAX_TOKENS=4096
STREAM=true
```

---

### 3 — Start the web UI

```bash
cd gui
./start.sh
```

This starts both the Express backend (port 3001) and the Vite frontend. Open [http://localhost:5173](http://localhost:5173).

Or start them separately:

```bash
# Backend
cd gui/backend
npm install
node server.js

# Frontend (new terminal)
cd gui/frontend
npm install
npm run dev
```

---

### 4 — (Optional) CLI interface

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python orchestrator.py
```

CLI commands:

| Command | Description |
|---|---|
| `/agents` | List all available agents |
| `/agent <name> <query>` | Call a specific agent directly |
| `/model` | Show currently loaded model |
| `/clear` | Clear conversation history |
| `/quit` | Exit |

---

## MCP Tool Integration

The web UI includes an MCP server manager. Enable/disable servers live without restarting:

| Server | What it gives agents |
|---|---|
| `memory` | Persistent cross-session memory |
| `filesystem` | Read/write access to local files |
| `github` | Repo browsing, issue/PR access |
| `desktop-commander` | Shell commands, process control |

Configure servers in `mcp-config.json`.

---

## Routing logic

```
User message
     │
     ├─ keyword trigger match? ──► Specialist agent (fast path)
     │
     └─ no match
          │
          ▼
     Orchestrator LLM
     (reads all agent descriptions, picks best fit)
          │
          ▼
     Specialist agent(s) → response
```

The orchestrator can chain agents — e.g. `findcompetitors` → `findideas` for "give me fresh ideas based on what my competitors are doing".

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, lucide-react |
| Backend | Express 5, Node.js ESM |
| CLI | Python 3, requests |
| LLM runtime | Ollama / LM Studio (OpenAI-compatible) |
| Tool protocol | Model Context Protocol (MCP) |
| Streaming | Server-Sent Events (SSE) |

---

## Project structure

```
orchestrator/
├── orchestrator.py          CLI entry point
├── agents.py                Agent system prompts (Python)
├── requirements.txt
├── mcp-config.json          MCP server configuration
├── .env                     Environment variables (not committed)
│
├── agents-preprompt/        Original HTML agent research files
│
└── gui/
    ├── start.sh             Starts both backend + frontend
    ├── backend/
    │   ├── server.js        Express API server
    │   ├── agents.js        Agent definitions (JS)
    │   └── mcp-manager.js   MCP server lifecycle
    └── frontend/
        └── src/
            ├── App.jsx           Main chat interface
            ├── ModelSelector.jsx  Backend & model picker
            └── McpSettings.jsx    MCP toggle UI
```

---

## License

MIT
