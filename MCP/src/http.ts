/**
 * Remote entry point — Streamable HTTP transport (stateless mode).
 *
 * Suitable for deployment to any Node host (Render, Railway, Fly.io,
 * Cloudflare Containers, a VPS). Endpoint: POST /mcp
 *
 * Env:
 *   METABASE_URL, METABASE_API_KEY  — Metabase connection
 *   PORT                            — listen port (default 3000)
 *   MCP_AUTH_TOKEN                  — optional bearer token; if set, requests
 *                                     must send `Authorization: Bearer <token>`
 *
 * NOTE for Claude Connectors Directory submission: the directory expects
 * OAuth 2.0 for user-scoped access. This bearer-token mode is Phase 2/3
 * scaffolding — see DEPLOYMENT.md for the OAuth upgrade path.
 */

import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, clientFromEnv } from "./server.js";

const app = express();
app.use(express.json({ limit: "4mb" }));

const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

/**
 * Origin-header validation (DNS-rebinding protection; also on Anthropic's
 * directory review checklist). Browsers send Origin; non-browser MCP clients
 * usually don't. Requests with no Origin pass; requests with an Origin must
 * match MCP_ALLOWED_ORIGINS (comma-separated, e.g. "https://claude.ai").
 */
const ALLOWED_ORIGINS = new Set(
  (process.env.MCP_ALLOWED_ORIGINS ?? "https://claude.ai,https://claude.com")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, server: "insight-discovery", version: "0.1.0" });
});

app.post("/mcp", async (req, res) => {
  if (!originAllowed(req.headers.origin)) {
    res.status(403).json({
      jsonrpc: "2.0",
      error: { code: -32003, message: "Origin not allowed" },
      id: null,
    });
    return;
  }
  if (AUTH_TOKEN) {
    const header = req.headers.authorization ?? "";
    if (header !== `Bearer ${AUTH_TOKEN}`) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
      return;
    }
  }
  // Stateless mode: fresh server + transport per request, no session state.
  try {
    const server = createServer(clientFromEnv);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless servers don't support GET (SSE notifications) or DELETE (sessions).
app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed in stateless mode" },
    id: null,
  });
});
app.delete("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed in stateless mode" },
    id: null,
  });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.error(`Insight Discovery MCP server listening on :${port} (POST /mcp)`);
});
