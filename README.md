# Insight Discovery MCP Server 🔬

**Connects Claude to the data beneath your dashboards.**

Companion to the [Dashboard Discovery Agent](https://github.com/GAMI-Solutions/dashboarddiscoveryagent) plugin. The plugin analyzes dashboard *screenshots*; this MCP server queries the data *underneath* (Metabase first) and runs a statistical scan battery to surface unknown unknowns — the segment quietly declining under a healthy top line, the level shift a smoothed chart hides, the whale value moving your average.

## Tools

| Tool | What it does |
|------|--------------|
| `list_dashboards` | Enumerate dashboards (and, with `dashboard_id`, their cards) |
| `get_underlying_data` | Pull the raw rows behind a card (capped at 200 rows) |
| `scan_for_unknowns` | Statistical battery over a card or a whole dashboard: robust (MAD) outliers, trend-break detection, weekday-seasonality deviations, segment divergence beneath aggregates, concentration risk, data-quality tripwires (nulls, staleness, empty results) |
| `explain_finding` | Retrieve a finding's full evidence slice + a root-cause analysis brief for Claude to narrate in plain language |

Design principle (shared with the plugin): **be specific or be silent.** Every finding carries evidence, a severity (critical / warning / note), and a concrete follow-up. Findings are framed as "worth investigating", never verdicts.

## Setup

Requirements: Node 18+, a Metabase instance, and a Metabase API key (Admin → Settings → Authentication → API Keys).

```bash
npm install
npm run build
```

### Local (Claude Desktop / Claude Code)

Add to your MCP config (Claude Desktop: `claude_desktop_config.json`; Claude Code: `claude mcp add`):

```json
{
  "mcpServers": {
    "insight-discovery": {
      "command": "node",
      "args": ["/absolute/path/to/insight-discovery-mcp/dist/index.js"],
      "env": {
        "METABASE_URL": "https://your-metabase.example.com",
        "METABASE_API_KEY": "mb_..."
      }
    }
  }
}
```

### Remote (Streamable HTTP)

```bash
METABASE_URL=https://your-metabase.example.com \
METABASE_API_KEY=mb_... \
MCP_AUTH_TOKEN=some-long-random-string \
npm run start:http
```

Endpoint: `POST /mcp` (stateless). Health check: `GET /healthz`. If `MCP_AUTH_TOKEN` is set, requests must send `Authorization: Bearer <token>`. See [DEPLOYMENT.md](DEPLOYMENT.md) for hosting and the Claude Connectors Directory path (which requires OAuth 2.0).

## Try it

With sample data (Metabase ships with the Sample Database):

> "List my dashboards, then scan the sales dashboard for unknowns and explain the most severe finding."

## Testing

```bash
npm test
```

13 tests: unit tests for every scanner (planted anomalies must be found; clean data must stay silent) plus an end-to-end suite that exercises all four tools through a real MCP client against a mocked Metabase API.

## Roadmap

- [x] v0.1 — Metabase, API-key auth, stdio + Streamable HTTP, scan battery
- [ ] OAuth 2.0 (Claude Connectors Directory requirement)
- [ ] Cloudflare Workers deployment
- [ ] Looker & Power BI connectors
- [ ] Scheduled scans / alerting

## Privacy & data handling

The server is a stateless proxy: it queries your Metabase with your API key, computes statistics in memory, and returns findings to the MCP client. No rows are persisted; the in-memory finding cache lives only for the process lifetime. See [PRIVACY.md](PRIVACY.md).

## Author & support

Gami Solutions — <muthu@gami-solutions.com>

## License

MIT — see [LICENSE](LICENSE).
