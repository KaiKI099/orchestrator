/**
 * MCP Manager — starts/stops MCP server processes and provides tool access.
 * Uses @modelcontextprotocol/sdk to connect via stdio transport.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, "../../mcp-config.json");

// name -> Client instance
const activeClients = new Map();

function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
}

function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function startServer(name, serverConfig) {
  if (activeClients.has(name)) return;
  try {
    const transport = new StdioClientTransport({
      command: serverConfig.command,
      args: serverConfig.args,
      env: { ...process.env, ...(serverConfig.env || {}) },
    });
    const client = new Client(
      { name: `orchestrator-${name}`, version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(transport);
    activeClients.set(name, client);
    console.log(`✅ MCP [${name}] connected`);
  } catch (e) {
    console.error(`❌ MCP [${name}] failed to start: ${e.message}`);
  }
}

async function stopServer(name) {
  const client = activeClients.get(name);
  if (client) {
    try { await client.close(); } catch {}
    activeClients.delete(name);
    console.log(`🛑 MCP [${name}] stopped`);
  }
}

/** Start all servers that are marked enabled in the config. */
export async function initialize() {
  const config = loadConfig();
  for (const [name, server] of Object.entries(config.servers)) {
    if (server.enabled) await startServer(name, server);
  }
}

/** Return config with live `running` status for each server. */
export function getConfig() {
  const config = loadConfig();
  for (const name of Object.keys(config.servers)) {
    config.servers[name].running = activeClients.has(name);
  }
  return config;
}

/**
 * Start any server that is marked enabled in the config but not yet running.
 * Call this on GET /api/mcp so externally-edited configs auto-connect.
 */
export async function ensureRunning() {
  const config = loadConfig();
  const promises = [];
  for (const [name, server] of Object.entries(config.servers)) {
    if (server.enabled && !activeClients.has(name)) {
      promises.push(startServer(name, server));
    }
  }
  if (promises.length) await Promise.all(promises);
}

/** Toggle a server on/off, persist the change, start/stop the process. */
export async function toggleServer(name, enabled) {
  const config = loadConfig();
  if (!config.servers[name]) throw new Error(`Unknown MCP server: ${name}`);
  config.servers[name].enabled = enabled;
  saveConfig(config);
  if (enabled) {
    await startServer(name, config.servers[name]);
  } else {
    await stopServer(name);
  }
  return getConfig();
}

/** Collect all tools from all running servers as OpenAI function-call definitions. */
export async function getAllTools() {
  const tools = [];
  for (const [serverName, client] of activeClients) {
    try {
      const { tools: serverTools } = await client.listTools();
      for (const tool of serverTools) {
        tools.push({
          type: "function",
          function: {
            name: `${serverName}__${tool.name}`,
            description: `[${serverName}] ${tool.description || ""}`,
            parameters: tool.inputSchema || { type: "object", properties: {} },
          },
        });
      }
    } catch (e) {
      console.error(`Error listing tools for ${serverName}: ${e.message}`);
    }
  }
  return tools;
}

/**
 * Call a tool by its qualified name (serverName__toolName).
 * Returns the text result as a string.
 */
export async function callTool(qualifiedName, args) {
  const sep = qualifiedName.indexOf("__");
  const serverName = qualifiedName.slice(0, sep);
  const toolName = qualifiedName.slice(sep + 2);
  const client = activeClients.get(serverName);
  if (!client) throw new Error(`MCP server '${serverName}' is not running`);
  const result = await client.callTool({ name: toolName, arguments: args });
  return result.content
    ?.map(c => (typeof c.text === "string" ? c.text : JSON.stringify(c)))
    .join("\n") ?? "";
}

/** How many servers are currently connected. */
export function activeCount() {
  return activeClients.size;
}
