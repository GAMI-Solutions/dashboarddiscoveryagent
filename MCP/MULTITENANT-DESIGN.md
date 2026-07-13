# Multi-Tenant Session Design (Directory-Ready Architecture)

The v0.1 server is single-tenant: one `METABASE_URL` + `METABASE_API_KEY` from env. A Connectors Directory listing serves many users, each with their own Metabase. This document is the design for that port. The key insight: **`createServer(getClient)` already takes a client factory, so the tool code never changes — only who supplies the factory.**

## The problem, precisely

OAuth for the directory is not "add a login screen." Metabase (self-hosted) is not a central OAuth provider Claude can talk to. So *our server* must be the OAuth authorization server, and the authorization step is where we capture each user's Metabase connection. Then every tool call must resolve to *that user's* Metabase client.

```
claude.ai ──OAuth 2.1 (PKCE + DCR)──▶ Insight Discovery server ──x-api-key──▶ user's Metabase
                                       (authorization server            (per-tenant
                                        + resource server)              credentials)
```

## Target platform: Cloudflare Workers

Use `workers-oauth-provider` + the `agents` package (`McpAgent`, one Durable Object per session). This template implements the MCP authorization spec (OAuth 2.1, PKCE, dynamic client registration, token issuance/refresh) so we write only the consent screen and credential handling.

## Components

1. **OAuth Provider (Worker)** — wraps everything; exposes `/.well-known/oauth-authorization-server`, `/authorize`, `/token`, `/register` (DCR). Claude discovers and drives this automatically when a user adds the connector.

2. **Consent/connect screen (`/authorize` handler)** — our only custom UI. A form asking for:
   - Metabase URL
   - Metabase API key
   Validate immediately by calling `GET /api/user/current` on that Metabase with the key. Fail here, at connect time — never let a bad credential surface as a confusing first tool-call error. On success, complete the grant with `props = { metabaseUrl, apiKey }`.

3. **Encrypted grant storage** — `workers-oauth-provider` encrypts `props` into the token grant (KV-backed), keyed by a Worker secret. The API key is never in our logs, never in the token the client holds (the client gets an opaque access token; props are server-side).

4. **McpAgent (Durable Object)** — per-session server instance. On each session, the provider hands us the decrypted `props`. Wiring:

   ```ts
   export class InsightDiscoveryAgent extends McpAgent<Env, State, Props> {
     server = createServer(() =>
       new MetabaseClient({
         url: this.props.metabaseUrl,
         apiKey: this.props.apiKey,
       }),
     );
   }
   ```

   That is the entire multi-tenant change to the tool layer. `clientFromEnv` stays for local stdio use.

5. **Finding store → Durable Object state** — replace the module-level `findingStore` with `this.state`/DO storage inside the agent. Findings become tenant-scoped by construction (a session can only ever see its own DO's findings), IDs stay crypto-random as defense in depth, and TTL eviction via DO alarms. This closes the cross-tenant leakage class entirely and survives stateless-HTTP scaling, since DOs are addressable state.

## Porting notes

- `src/server.ts`, `src/stats.ts` are transport-agnostic and move unchanged (stats uses `node:crypto.randomBytes` — switch to `crypto.getRandomValues` for Workers compat, 2 lines).
- `src/metabase.ts` uses global `fetch` — Workers-native already.
- `src/http.ts` (Express) is replaced by the Worker entry; keep it in-repo for self-hosted single-tenant users.
- Keep the repo dual-mode: `stdio` (local, env creds) and `worker` (multi-tenant OAuth). The directory listing points at the Worker URL.

## Security checklist for this port

- [ ] Validate Metabase credentials at authorize time (`/api/user/current`)
- [ ] Encrypt props at rest; never log URL+key pairs
- [ ] Token revocation deletes the grant (and thus the stored credentials)
- [ ] Rate-limit `/authorize` and tool calls per tenant (Workers rate limiting)
- [ ] Origin validation on the MCP endpoint
- [ ] Findings in DO state only (no module-level shared state anywhere)
- [ ] Advise users to create a Metabase API key scoped to a read-only group

## Alternative path worth knowing: MCPB desktop extension

The directory also accepts **desktop extensions** (local MCP servers packaged as [MCPB bundles](https://github.com/modelcontextprotocol/mcpb)) — no hosting, no OAuth. User config in `manifest.json` prompts for `METABASE_URL` / `METABASE_API_KEY` (stored in the OS keychain), and our existing stdio server is used as-is. Requirements: privacy policy section in README + `privacy_policies` array in manifest. This could put Insight Discovery in the directory **weeks earlier**; the remote OAuth listing can follow as v2. Submission form: https://clau.de/desktop-extention-submission

## Sequence for the remote build

1. Scaffold from Cloudflare's remote MCP + OAuth Provider template
2. Drop in `server.ts` / `stats.ts` / `metabase.ts`
3. Build the connect form + credential validation
4. Move findings to DO state; delete module-level store in the Worker build
5. Test end-to-end from claude.ai as a custom connector (two different Metabase instances, verify isolation)
6. Submit: https://clau.de/mcp-directory-submission
