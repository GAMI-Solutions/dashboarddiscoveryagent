#!/usr/bin/env node
/**
 * stdio entry point — for Claude Desktop / Claude Code local use.
 *
 * Env: METABASE_URL, METABASE_API_KEY
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, clientFromEnv } from "./server.js";

async function main() {
  const server = createServer(clientFromEnv);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Insight Discovery MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
