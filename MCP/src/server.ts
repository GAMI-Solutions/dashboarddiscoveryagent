/**
 * Insight Discovery MCP server — tool definitions.
 *
 * Companion to the Dashboard Discovery Agent plugin
 * (https://github.com/GAMI-Solutions/dashboarddiscoveryagent).
 * Where the plugin reads screenshots, this server reads the data
 * BENEATH the dashboard (Metabase first) and scans for unknown unknowns.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MetabaseClient, MetabaseError } from "./metabase.js";
import { runScanBattery, type Finding } from "./stats.js";

const MAX_ROWS_RETURNED = 200;
const MAX_CARDS_PER_DASHBOARD_SCAN = 8;

/** In-memory finding store so explain_finding can retrieve evidence. */
const findingStore = new Map<string, Finding>();

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function errorText(err: unknown) {
  const msg =
    err instanceof MetabaseError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  return {
    content: [{ type: "text" as const, text: `Error: ${msg}` }],
    isError: true,
  };
}

function summarizeFindings(findings: Finding[]): string {
  if (findings.length === 0) {
    return "No statistically notable findings. This means the battery found nothing above its thresholds — not that the data is clean. Consider pulling the underlying data for a manual look.";
  }
  const lines = findings.map(
    (f) =>
      `- [${f.severity.toUpperCase()}] ${f.id} (${f.type}${f.cardName ? `, card: ${f.cardName}` : ""}): ${f.title}\n  Evidence: ${f.evidence}\n  Follow-up: ${f.suggestedFollowUp}`,
  );
  return `${findings.length} finding(s), ordered by severity. Use explain_finding with a finding ID for the full evidence slice and a root-cause analysis brief.\n\n${lines.join("\n\n")}`;
}

export function createServer(getClient: () => MetabaseClient): McpServer {
  const server = new McpServer({
    name: "insight-discovery",
    version: "0.1.0",
  });

  server.registerTool(
    "list_dashboards",
    {
      title: "List Metabase dashboards",
      description:
        "List dashboards in the connected Metabase instance (id, name, description, collection). Optionally filter by a search term. Pass a dashboard_id to get its cards instead.",
      inputSchema: {
        search: z.string().optional().describe("Case-insensitive filter on name/description"),
        dashboard_id: z
          .number()
          .int()
          .optional()
          .describe("If set, return this dashboard's cards instead of the dashboard list"),
      },
    },
    async ({ search, dashboard_id }) => {
      try {
        const client = getClient();
        if (dashboard_id !== undefined) {
          const d = await client.getDashboard(dashboard_id);
          return text(JSON.stringify(d, null, 2));
        }
        const dashboards = await client.listDashboards(search);
        return text(
          dashboards.length === 0
            ? "No dashboards found."
            : JSON.stringify(dashboards, null, 2),
        );
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "get_underlying_data",
    {
      title: "Get a card's underlying data",
      description:
        `Run a Metabase card (saved question) and return its raw rows as JSON (capped at ${MAX_ROWS_RETURNED} rows, with column profile). Use list_dashboards with a dashboard_id first to find card IDs.`,
      inputSchema: {
        card_id: z.number().int().describe("Metabase card (question) ID"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_ROWS_RETURNED)
          .optional()
          .describe(`Max rows to return (default ${MAX_ROWS_RETURNED})`),
      },
    },
    async ({ card_id, limit }) => {
      try {
        const client = getClient();
        const [card, rows] = await Promise.all([
          client.getCard(card_id),
          client.getCardRows(card_id),
        ]);
        const cap = limit ?? MAX_ROWS_RETURNED;
        const returned = rows.slice(0, cap);
        return text(
          JSON.stringify(
            {
              card: card.name,
              display: card.display,
              totalRows: rows.length,
              returnedRows: returned.length,
              truncated: rows.length > returned.length,
              rows: returned,
            },
            null,
            2,
          ),
        );
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "scan_for_unknowns",
    {
      title: "Scan for unknown unknowns",
      description:
        "Run the statistical scan battery over a card's underlying data (or every card on a dashboard): robust outliers, trend breaks, weekday-seasonality deviations, segment divergence beneath aggregates, concentration risk, and data-quality tripwires. Returns findings with severity, evidence, and finding IDs for explain_finding. Provide exactly one of card_id or dashboard_id.",
      inputSchema: {
        card_id: z.number().int().optional().describe("Scan a single card"),
        dashboard_id: z
          .number()
          .int()
          .optional()
          .describe(`Scan all cards on a dashboard (first ${MAX_CARDS_PER_DASHBOARD_SCAN} cards)`),
      },
    },
    async ({ card_id, dashboard_id }) => {
      if ((card_id === undefined) === (dashboard_id === undefined)) {
        return errorText(new Error("Provide exactly one of card_id or dashboard_id."));
      }
      try {
        const client = getClient();
        const targets: { id: number; name: string }[] = [];
        if (card_id !== undefined) {
          const card = await client.getCard(card_id);
          targets.push({ id: card.id, name: card.name });
        } else {
          const dash = await client.getDashboard(dashboard_id!);
          targets.push(
            ...dash.cards
              .slice(0, MAX_CARDS_PER_DASHBOARD_SCAN)
              .map((c) => ({ id: c.id, name: c.name })),
          );
          if (targets.length === 0) {
            return text(`Dashboard "${dash.name}" has no queryable cards.`);
          }
        }

        const allFindings: Finding[] = [];
        const failures: string[] = [];
        for (const t of targets) {
          try {
            const rows = await client.getCardRows(t.id);
            const findings = runScanBattery(rows).map((f) => ({
              ...f,
              cardId: t.id,
              cardName: t.name,
            }));
            for (const f of findings) findingStore.set(f.id, f);
            allFindings.push(...findings);
          } catch (err) {
            failures.push(`Card ${t.id} ("${t.name}"): ${err instanceof Error ? err.message : err}`);
          }
        }
        let out = summarizeFindings(allFindings);
        if (failures.length > 0) {
          out += `\n\nCards that could not be scanned:\n${failures.map((f) => `- ${f}`).join("\n")}`;
        }
        return text(out);
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "explain_finding",
    {
      title: "Explain a finding",
      description:
        "Retrieve a finding's full evidence (including the backing data slice) plus a root-cause analysis brief, so Claude can narrate a plain-language explanation of what happened and why it matters. Use a finding ID returned by scan_for_unknowns (e.g. F-003).",
      inputSchema: {
        finding_id: z.string().describe("Finding ID from scan_for_unknowns, e.g. F-003"),
      },
    },
    async ({ finding_id }) => {
      const f = findingStore.get(finding_id.trim());
      if (!f) {
        return errorText(
          new Error(
            `Unknown finding ID "${finding_id}". Run scan_for_unknowns first; finding IDs are only valid for this server session.`,
          ),
        );
      }
      const brief = {
        finding: {
          id: f.id,
          type: f.type,
          severity: f.severity,
          title: f.title,
          card: f.cardName ?? null,
          evidence: f.evidence,
          dataSlice: f.dataSlice,
          suggestedFollowUp: f.suggestedFollowUp,
        },
        analysisBrief:
          "Using the evidence and dataSlice above, explain this finding to a business stakeholder in plain language: (1) what the anomaly is, in one sentence; (2) the 2-3 most plausible root causes, ranked, each tied to specific values in the data slice; (3) what it means for decisions being made off this dashboard; (4) the single next query or check that would confirm or kill the leading hypothesis. Frame everything as 'worth investigating' — the data supports a hypothesis, not a verdict.",
      };
      return text(JSON.stringify(brief, null, 2));
    },
  );

  return server;
}

export function clientFromEnv(): MetabaseClient {
  return new MetabaseClient({
    url: process.env.METABASE_URL ?? "",
    apiKey: process.env.METABASE_API_KEY ?? "",
  });
}
