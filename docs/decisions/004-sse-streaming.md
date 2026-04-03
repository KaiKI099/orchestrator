# ADR 004 — Server-Sent Events (SSE) for Real-Time Agent Streaming

**Date:** 2026-04-03  
**Status:** Accepted

## Context

Agent responses can take several seconds to generate. Users need real-time feedback (streaming tokens, tool execution status, intermediate thoughts) without polling or page refreshes. WebSocket would work but adds infrastructure complexity and firewall issues.

## Decision

Use Server-Sent Events (SSE) over HTTP for unidirectional streaming from backend to frontend:

| Event Type | Payload Structure | Use Case |
|------------|-------------------|----------|
| `token` | `{ "content": "string" }` | Stream LLM output token-by-token |
| `tool_start` | `{ "tool": "name", "args": {...} }` | Show tool invocation starting |
| `tool_result` | `{ "tool": "name", "result": {...} }` | Display tool output |
| `agent_switch` | `{ "from": "A", "to": "B" }` | Notify agent handoff |
| `error` | `{ "message": "string", "code": number }` | Report errors without closing connection |
| `done` | `{ "finish_reason": "stop" | "length" }` | Signal completion |

Backend endpoint: `POST /api/chat/stream` returns `Content-Type: text/event-stream`.

## Reasons

- **Simplicity** — SSE is native in browsers (`EventSource`) and requires no handshake.
- **HTTP-compatible** — Works through standard firewalls and proxies; no WebSocket upgrade needed.
- **Low overhead** — Text-based protocol with minimal framing; efficient for token streaming.
- **Resumability** — `Last-Event-ID` header allows reconnecting mid-stream if connection drops.

## Trade-offs

- Unidirectional only (server → client); client must use separate HTTP POST for messages.
- No binary data support; all payloads must be JSON-stringified.
- Connection limits: browsers cap concurrent SSE connections per domain (~6).

## Alternatives rejected

- **WebSocket** — bidirectional but requires custom server infrastructure and keepalive logic.
- **Long polling** — higher latency and server resource usage due to repeated request cycles.
- **GraphQL subscriptions** — overkill for simple streaming; adds dependency complexity.

## Implementation notes

1. Flask backend uses `flask-sse` or manual `Response(stream_generator(), mimetype='text/event-stream')`.
2. Frontend creates `new EventSource('/api/chat/stream')` and listens for typed events.
3. Each event includes a `type` field; frontend switches on type to update UI state.
4. Reconnection logic: on `error` event, wait 2s then resend last user message with `Last-Event-ID`.
5. Tool calls are shown as expandable blocks in the chat UI until `tool_result` arrives.
