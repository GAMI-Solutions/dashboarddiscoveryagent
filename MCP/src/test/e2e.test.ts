/**
 * End-to-end smoke test: spins up the MCP server in-memory, mocks the
 * Metabase HTTP API with a local server, and exercises all four tools
 * through a real MCP client.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { MetabaseClient } from "../metabase.js";

/* ------------------------------ mock Metabase ------------------------------ */

function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

// Card 7: revenue by day+region with planted EU decline & NA concentration
const card7Rows: Record<string, unknown>[] = [];
for (let i = 39; i >= 0; i--) {
  const idx = 39 - i;
  card7Rows.push({ date: iso(i + 1), region: "NA", revenue: 1000 + idx * 30 });
  card7Rows.push({ date: iso(i + 1), region: "EU", revenue: 400 - idx * 8 });
  card7Rows.push({ date: iso(i + 1), region: "APAC", revenue: 150 + idx * 2 });
  card7Rows.push({ date: iso(i + 1), region: "LATAM", revenue: 60 + (idx % 5) });
  card7Rows.push({ date: iso(i + 1), region: "MEA", revenue: 50 + (idx % 3) });
}

const mockApi = http.createServer((req, res) => {
  const url = req.url ?? "";
  const send = (body: unknown) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  };
  if (req.headers["x-api-key"] !== "test-key") {
    res.statusCode = 401;
    return send({ message: "Unauthenticated" });
  }
  if (url === "/api/dashboard" && req.method === "GET") {
    return send([
      { id: 1, name: "Sales Overview", description: "Core sales KPIs", collection: { name: "Analytics" }, updated_at: "2026-07-01T00:00:00Z" },
      { id: 2, name: "Marketing Funnel", description: null, collection: null, updated_at: null },
    ]);
  }
  if (url === "/api/dashboard/1" && req.method === "GET") {
    return send({
      id: 1,
      name: "Sales Overview",
      description: "Core sales KPIs",
      collection: { name: "Analytics" },
      updated_at: "2026-07-01T00:00:00Z",
      dashcards: [
        { card: { id: 7, name: "Revenue by region", description: null, display: "line" } },
        { card: null }, // text tile — must be skipped
      ],
    });
  }
  if (url === "/api/card/7" && req.method === "GET") {
    return send({ id: 7, name: "Revenue by region", description: null, display: "line" });
  }
  if (url === "/api/card/7/query/json" && req.method === "POST") {
    return send(card7Rows);
  }
  res.statusCode = 404;
  send({ message: `no mock for ${req.method} ${url}` });
});

let baseUrl = "";
let client: Client;

before(async () => {
  await new Promise<void>((resolve) => mockApi.listen(0, "127.0.0.1", resolve));
  const addr = mockApi.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;

  const server = createServer(
    () => new MetabaseClient({ url: baseUrl, apiKey: "test-key" }),
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "0.0.1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

after(() => {
  mockApi.close();
});

function firstText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text: string }> })
    .content;
  return content?.[0]?.text ?? "";
}

test("lists all four tools", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "explain_finding",
    "get_underlying_data",
    "list_dashboards",
    "scan_for_unknowns",
  ]);
});

test("list_dashboards returns dashboards and cards", async () => {
  const res = await client.callTool({ name: "list_dashboards", arguments: {} });
  assert.match(firstText(res), /Sales Overview/);

  const detail = await client.callTool({
    name: "list_dashboards",
    arguments: { dashboard_id: 1 },
  });
  assert.match(firstText(detail), /Revenue by region/);
});

test("get_underlying_data returns rows with truncation info", async () => {
  const res = await client.callTool({
    name: "get_underlying_data",
    arguments: { card_id: 7, limit: 10 },
  });
  const parsed = JSON.parse(firstText(res));
  assert.equal(parsed.returnedRows, 10);
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.totalRows, card7Rows.length);
});

test("scan_for_unknowns (dashboard) finds the planted EU decline, explain_finding retrieves it", async () => {
  const res = await client.callTool({
    name: "scan_for_unknowns",
    arguments: { dashboard_id: 1 },
  });
  const out = firstText(res);
  assert.match(out, /finding/i);
  assert.match(out, /EU/);

  const idMatch = out.match(/F-[0-9a-f]{10}/);
  assert.ok(idMatch, "expected a finding ID in output");
  const explain = await client.callTool({
    name: "explain_finding",
    arguments: { finding_id: idMatch![0] },
  });
  const brief = JSON.parse(firstText(explain));
  assert.equal(brief.finding.id, idMatch![0]);
  assert.ok(brief.analysisBrief.length > 100);
});

test("explain_finding rejects unknown/guessed IDs", async () => {
  const res = await client.callTool({
    name: "explain_finding",
    arguments: { finding_id: "F-0000000001" },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.match(firstText(res), /Unknown or expired/);
});

test("scan_for_unknowns validates arguments", async () => {
  const res = await client.callTool({ name: "scan_for_unknowns", arguments: {} });
  assert.equal((res as { isError?: boolean }).isError, true);
});

test("errors from Metabase surface cleanly", async () => {
  const res = await client.callTool({
    name: "get_underlying_data",
    arguments: { card_id: 999 },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.match(firstText(res), /404/);
});
