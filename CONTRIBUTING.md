# Contributing

## Setup

```bash
cp .env.example .env      # fill in your values
cd gui && ./start.sh      # installs deps and starts backend + frontend
```

The dashboard runs at `http://localhost:5173`. The Express backend runs on port 3001.

## Adding a marketing agent

1. Add a new entry to `gui/backend/agents.js` following the existing pattern (name, emoji, description, triggers, system_prompt).
2. The orchestrator routes to it automatically via keyword triggers — no registration needed.

## Adding a coder agent

Same as above, but in `gui/backend/agents-code.js`.

## Adding a dependency

```bash
cd gui/backend && npm install <package>   # backend
cd gui/frontend && npm install <package>  # frontend
```

## Reporting issues

Open a GitHub issue with the agent name, your input, and the unexpected output.
