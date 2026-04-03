# ADR 001 — Support multiple LLM backends with runtime switching

**Date:** 2026-04-03  
**Status:** Accepted

## Context

The GUI orchestrator needs to call LLMs for agent routing and task execution. Users have different setups — some run models locally, others use cloud APIs. Hardcoding a single backend would force everyone onto the same stack.

## Decision

Support four backends switchable at runtime via `DEFAULT_BACKEND` env var (or from the UI):

| Key | Provider | Type |
|-----|----------|------|
| `lmstudio` | LM Studio | Local |
| `ollama` | Ollama | Local |
| `claude` | Anthropic Claude | Cloud |
| `nvidia` | NVIDIA NIM | Cloud |

All backends expose an OpenAI-compatible `/v1/chat/completions` endpoint, so the backend code uses a single request shape regardless of which provider is active.

## Reasons

- **No vendor lock-in** — switch between local and cloud without code changes.
- **Cost flexibility** — local backends cost nothing; cloud keys are opt-in.
- **Single request path** — OpenAI-compatible APIs mean one `fetch` call handles all four backends.
- **Privacy** — sensitive SEO data can stay on local hardware by defaulting to Ollama/LM Studio.

## Trade-offs

- Local backends (LM Studio, Ollama) must be running before starting the server.
- Model availability varies per backend; `DEFAULT_MODEL` may need to be set per environment.
- NVIDIA NIM and Claude require API keys and have usage costs.

## Alternatives rejected

- **Single cloud API only** — cost and privacy concerns ruled this out as the default.
- **Ollama-only** — some users prefer LM Studio's GUI or Claude's capability ceiling.
