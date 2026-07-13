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

**Verified July 13, 2026** against https://claude.com/docs/connectors/building/submission — re-check before submitting, they evolve.

Two accepted paths:

**Path A — Desktop extension (MCPB), no hosting/OAuth needed.** Package the stdio server as an [MCP Bundle](https://github.com/modelcontextprotocol/mcpb); users enter their Metabase URL/API key via manifest user-config. Requirements: privacy policy section in README + `privacy_policies` HTTPS URLs in `manifest.json` (manifest_version 0.2+). Submission form: https://clau.de/desktop-extention-submission. **Fastest route to a listing.**

**Path B — Remote MCP server.** Requirements:

- OAuth 2.0 for authenticated services — bearer-token mode will not pass. This is an architectural change (per-user Metabase credentials captured in the auth flow, per-session client routing): see **MULTITENANT-DESIGN.md**.
- Tool annotations: every tool needs `title` + `readOnlyHint`/`destructiveHint` — ✅ done in this repo (all four tools are read-only).
- HTTPS + `Origin`-header validation — ✅ implemented in `src/http.ts` (`MCP_ALLOWED_ORIGINS`).
- Public documentation link, privacy policy URL, support channel — host PRIVACY.md at a public URL (GitHub Pages or gami-solutions.com).
- Test account with step-by-step reviewer setup instructions (a demo Metabase with the Sample Database).
- Pre-submission checklist: https://claude.com/docs/connectors/building/review-criteria
- Submission form: https://clau.de/mcp-directory-submission

Common rejection reasons to pre-empt: thin wrappers (emphasize the statistical analysis layer in listing copy), flaky servers (load-test first), abandoned projects (keep commits flowing), missing/incomplete privacy policy (immediate rejection).

## 4. Suggested demo script

1. Spin up Metabase with the built-in Sample Database, create a simple sales dashboard.
2. "List my dashboards" → `list_dashboards`
3. "Scan the sales dashboard for things it isn't telling me" → `scan_for_unknowns`
4. "Explain F-001" → `explain_finding` → Claude narrates root cause.
5. Pair with the Dashboard Discovery Agent plugin on a screenshot of the same dashboard for the full story: *vision finds what the dashboard hides visually; the MCP server proves it in the data.*
