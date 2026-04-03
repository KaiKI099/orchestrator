# ADR 002 — MCP Integration for Tool Discovery and Execution

**Date:** 2026-04-03  
**Status:** Accepted

## Context

The orchestrator needs to expose tools (file system, web search, database queries) to agents. Hardcoding tool implementations in the backend creates tight coupling and makes it difficult to add new capabilities without modifying core code.

## Decision

Integrate the Model Context Protocol (MCP) to dynamically discover and invoke tools from external MCP servers:

| Component | Responsibility |
|-----------|----------------|
| `mcp_client.py` | Connect to MCP servers via stdio or SSE transport |
| `tool_registry.py` | Cache available tools and their schemas |
| `agent_router.py` | Map agent intents to MCP tool calls |

Agents request tools by name; the orchestrator forwards these requests to connected MCP servers and returns results as structured JSON.

## Reasons

- **Decoupling** — Tools live in separate processes/servers; core orchestrator remains unchanged when adding capabilities.
- **Standardization** — MCP provides a uniform schema for tool inputs/outputs across all providers.
- **Composability** — Multiple MCP servers can run simultaneously (e.g., one for filesystem, one for APIs).
- **Security boundary** — Sensitive operations (DB writes) can be isolated in dedicated MCP servers with their own auth.

## Trade-offs

- Added complexity: agents must wait for MCP round-trips before responding.
- Debugging is harder when tools fail inside remote MCP servers.
- Requires users to install and configure additional MCP server binaries.

## Alternatives rejected

- **Native Python tools** — simpler but requires redeploying the orchestrator for every new tool.
- **HTTP webhook tools** — lacks standardized schema discovery; more boilerplate per integration.

## Implementation notes

1. MCP servers are configured in `.env` via `MCP_SERVERS=json[...]`.
2. Each server entry specifies transport type (`stdio` or `sse`) and connection details.
3. On startup, the orchestrator connects to all configured servers and builds a unified tool catalog.
4. Agents receive the merged tool list and can invoke any tool by its fully qualified name (`server_name.tool_name`).
