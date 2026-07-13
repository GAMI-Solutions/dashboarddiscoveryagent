# Deployment & Directory Submission Guide

## 1. Local development

```bash
npm install
npm test                 # build + full test suite
npm start                # stdio server (Claude Desktop / Claude Code)
npm run start:http       # HTTP server on :3000
```

Debugging: `npx @modelcontextprotocol/inspector node dist/index.js` (set `METABASE_URL` / `METABASE_API_KEY` in the inspector env).

## 2. Remote hosting (Phase 3)

The HTTP entry point (`dist/http.js`) is a plain Node/Express server using the MCP **Streamable HTTP** transport in stateless mode, so it runs anywhere Node runs:

- **Render / Railway / Fly.io** — point at this repo, build command `npm install && npm run build`, start command `npm run start:http`. Or use the included `Dockerfile`.
- **Cloudflare** — either Cloudflare Containers (Dockerfile as-is), or port to Cloudflare Workers using the [`agents`](https://developers.cloudflare.com/agents/) package (`McpAgent`); the tool logic in `src/server.ts`, `src/stats.ts`, and `src/metabase.ts` is transport-agnostic and moves over unchanged.

Set env vars: `METABASE_URL`, `METABASE_API_KEY`, `MCP_AUTH_TOKEN` (long random string), `PORT` if the host requires it.

Connect from claude.ai / Claude Desktop as a **custom connector**: URL `https://your-host/mcp`.

## 3. Claude Connectors Directory submission (Phase 4)

Requirements evolve — re-verify at [docs.claude.com](https://docs.claude.com) and [support.claude.com](https://support.claude.com) before submitting. As of the roadmap:

- ✅ Remote MCP server over Streamable HTTP (this repo)
- ⚠️ **OAuth 2.0 required** — the current bearer-token mode is not sufficient for the directory. Upgrade path: implement the MCP authorization spec (OAuth 2.1 with PKCE + dynamic client registration). The Cloudflare Workers OAuth Provider template handles most of this plumbing.
- ✅ Privacy policy (`PRIVACY.md` — also host it at a public URL)
- ✅ Support contact (muthu@gami-solutions.com)
- Reliability pass: timeouts (30s Metabase timeout built in), row caps (200), per-dashboard card caps (8), clean error surfacing — all implemented; add rate limiting at the host/proxy level.

Common rejection reasons to pre-empt: thin wrappers (this server adds a statistical analysis layer, emphasize it in listing copy), flaky servers (load-test before submitting), abandoned projects (keep commits flowing).

## 4. Suggested demo script

1. Spin up Metabase with the built-in Sample Database, create a simple sales dashboard.
2. "List my dashboards" → `list_dashboards`
3. "Scan the sales dashboard for things it isn't telling me" → `scan_for_unknowns`
4. "Explain F-001" → `explain_finding` → Claude narrates root cause.
5. Pair with the Dashboard Discovery Agent plugin on a screenshot of the same dashboard for the full story: *vision finds what the dashboard hides visually; the MCP server proves it in the data.*
