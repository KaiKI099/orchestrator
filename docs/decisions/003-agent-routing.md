# ADR 003 — Agent Routing Strategy with Intent Classification

**Date:** 2026-04-03  
**Status:** Accepted

## Context

The system supports multiple specialized agents (SEO analyst, content writer, technical auditor). Incoming user requests must be routed to the most appropriate agent based on intent. A naive round-robin or static assignment would waste capabilities and produce irrelevant responses.

## Decision

Implement a two-stage routing pipeline:

1. **Intent Classifier** — A lightweight LLM call analyzes the user's message and outputs a structured intent object:
   ```json
   {
     "primary_intent": "seo_analysis",
     "confidence": 0.92,
     "requires_tools": ["sitemap_parser", "keyword_research"],
     "suggested_agent": "seo_specialist"
   }
   ```

2. **Agent Dispatcher** — Routes the request to the selected agent, injecting required tool contexts and conversation history.

| Routing Rule | Trigger Condition | Target Agent |
|--------------|-------------------|--------------|
| SEO audit | Keywords: "ranking", "backlink", "SERP" | `seo_specialist` |
| Content creation | Keywords: "write", "draft", "article" | `content_writer` |
| Technical fix | Keywords: "bug", "error", "fix", "deploy" | `tech_lead` |
| Ambiguous | Confidence < 0.7 | `general_orchestrator` |

## Reasons

- **Specialization** — Each agent can maintain focused system prompts and tool sets.
- **Efficiency** — Smaller models can handle classification; larger models only run for complex tasks.
- **Extensibility** — New agents can be added by updating routing rules without touching core logic.
- **Transparency** — Users see which agent was selected and why (logged in UI).

## Trade-offs

- Extra LLM call adds ~200ms latency to initial routing.
- Misclassification can send requests to wrong agents; fallback mechanisms needed.
- Requires maintaining keyword lists and confidence thresholds.

## Alternatives rejected

- **Single generalist agent** — simpler but loses domain expertise and produces generic outputs.
- **User-selectable agent** — puts burden on users to know which agent fits their task.

## Implementation notes

1. Intent classifier uses the same backend as agents but with a minimal prompt template.
2. Confidence scores below 0.5 trigger a clarification question instead of routing.
3. Agent selection is logged with the full intent JSON for debugging.
4. Users can override routing via `/agent <name>` slash command in chat.
