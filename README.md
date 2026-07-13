# Dashboard Discovery Agent 🔎

**Finds what your dashboard isn't telling you.**

Dashboards show what someone *chose* to chart. The insights that matter are the unknown unknowns — a segment quietly declining under a healthy top line, an average hiding a bimodal split, a truncated axis manufacturing drama. Dashboard Discovery Agent gives Claude a rigorous, five-phase analyst methodology to hunt them down from a simple screenshot of **any** BI tool: Tableau, Power BI, Looker, Metabase, Grafana, Excel, or your homegrown dashboard.

## What it does

Drop in a dashboard screenshot and ask Claude to review it. You get:

- **Integrity findings** — truncated axes, dual-axis tricks, cherry-picked time windows, partial-period comparisons, arithmetic inconsistencies, each rated Critical / Warning / Note
- **Masking analysis** — the specific alternative realities your aggregates can't rule out ("this 8% average uplift is consistent with one whale deal masking a decline in typical deal size")
- **Blind-spot report** — the counter-metrics, segments, baselines, and denominators your dashboard is missing, ranked
- **Copy-paste follow-ups** — concrete questions and queries to hand your data team

## Install

From Claude Code:

```
/plugin marketplace add GAMI-Solutions/dashboarddiscoveryagent
/plugin install dashboarddiscoveryagent@dashboarddiscoveryagent-marketplace
```

## Use

1. Paste or attach a screenshot of any dashboard.
2. Ask anything like:
   - "Review this dashboard"
   - "What is this dashboard not telling me?"
   - "Is anything misleading in these charts?"
   - "Find insights I might be missing"
3. For a deep audit of one or several dashboards, the bundled **dashboarddiscoveryagent** subagent runs the full methodology end to end and can cross-check multiple dashboards for inconsistencies.

## What's inside

```
dashboarddiscoveryagent/
├── .claude-plugin/
│   ├── plugin.json                    # plugin manifest
│   └── marketplace.json               # makes this repo directly installable as a marketplace
├── skills/
│   └── dashboard-detective/
│       └── SKILL.md                   # the methodology (the "brain")
├── agents/
│   └── dashboarddiscoveryagent.md     # deep-analysis subagent
├── README.md
└── LICENSE
```

## Methodology (short version)

1. **Inventory** — extract every chart, KPI, filter, and freshness cue; never guess unreadable values
2. **Integrity checks** — is the dashboard lying? Axis, time-window, chart-type, and arithmetic checks
3. **Aggregation masking** — what could hide beneath each average, total, and rate
4. **Blind-spot hunt** — what a skeptical analyst in this domain would expect to see and doesn't
5. **Trend & anomaly cues** — breaks, suspicious smoothness, seasonality deviations, flatlines, stale data

Design principle: **be specific or be silent.** Every finding cites the exact chart or value; hypotheses are never presented as facts; two strong findings beat ten weak ones.

## Limitations

- Vision-based: it analyzes what's on screen. It cannot query the data beneath the dashboard — that's the job of the companion **Insight Discovery MCP server** (Metabase first; Looker and Power BI on the roadmap).
- Low-resolution screenshots reduce accuracy; the skill will tell you when values are unreadable rather than guess.

## Roadmap

- [x] v1.0 — vision-based methodology, any dashboard screenshot
- [ ] Insight Discovery MCP server (Metabase) — query underlying data, statistical anomaly scans
- [ ] Looker & Power BI connectors
- [ ] Scheduled dashboard monitoring

## Author

Gami Solutions — muthu@gami-solutions.com

## License

MIT — see [LICENSE](LICENSE).
