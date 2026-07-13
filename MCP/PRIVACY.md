# Privacy Policy — Insight Discovery MCP Server

*Last updated: July 13, 2026*

**What this server does.** Insight Discovery is a Model Context Protocol (MCP) server that connects an MCP client (such as Claude) to a Metabase instance that you configure, retrieves query results, computes statistical summaries, and returns findings to the client.

**Data access.** The server accesses only the Metabase instance you configure, using credentials you provide (`METABASE_URL`, `METABASE_API_KEY`). It can read dashboards, cards, and card query results visible to that API key. Scope the API key to the minimum collections needed.

**Data storage.** The server is stateless. Query rows are processed in memory and discarded. A small in-memory cache of scan findings (statistics and small evidence slices, not full datasets) exists only for the lifetime of the server process and is never written to disk.

**Data sharing.** Data retrieved from your Metabase is returned only to the MCP client that requested it. The server sends no data to any third party, collects no analytics, and performs no telemetry.

**Credentials.** Credentials are supplied via environment variables by the operator and are never logged or transmitted anywhere except to your Metabase instance.

**Your responsibilities.** If you operate this server for others, you are responsible for securing the deployment (TLS, authentication tokens, network policy) and for the data-processing terms between you and your users.

**Contact.** Questions or concerns: **muthu@gami-solutions.com** (Gami Solutions).
