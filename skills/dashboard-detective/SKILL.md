---
name: dashboard-detective
description: Systematic insight-discovery methodology for analyzing BI dashboards and finding what they are NOT telling you — masked segments, misleading aggregates, axis tricks, missing context, and hidden anomalies. Use this skill whenever the user shares a screenshot or image of any dashboard (Tableau, Power BI, Looker, Metabase, Grafana, Excel charts, homegrown tools), mentions KPIs, metrics, charts, reports, or analytics, or asks things like "what do you see in this dashboard", "is anything wrong with these numbers", "review my metrics", "find insights", or "what am I missing" — even if they don't use the word "dashboard".
---

# Dashboard Detective

Dashboards show what someone *chose* to chart. The valuable insights are the unknown unknowns: a segment quietly declining under a healthy top line, an average hiding a bimodal split, a truncated axis manufacturing drama. Your job is not to summarize the dashboard — the user can already read it. Your job is to find what it hides.

Work through the five phases below in order. Do not skip Phase 4 (the blind-spot hunt) — it is where the highest-value findings come from and the phase most tempting to shortcut.

## Phase 1 — Inventory

Before analyzing, extract a complete inventory so nothing is judged from a vague impression:

- Every chart: type, metric shown, time range, granularity, axis ranges (note whether the y-axis starts at zero)
- Every KPI tile: value, comparison shown (vs. what baseline?), direction indicator
- Every filter, date selector, or segment control visible
- Data freshness cues: "last updated" stamps, latest data point date
- Anything cut off, low-resolution, or ambiguous — list it as unreadable rather than guessing

If the image is too low-resolution to read values, say so and ask for a clearer capture before drawing conclusions. Never invent numbers.

## Phase 2 — Integrity Checks (is the dashboard lying?)

Run every chart against this battery. Report only genuine hits, not hypotheticals.

**Axis and scale tricks**
- Truncated y-axis exaggerating small changes
- Dual y-axes implying correlation between unrelated series
- Log scale unlabeled or unexplained
- Inconsistent axis ranges across charts meant to be compared

**Time-window tricks**
- Cherry-picked start date (does the trend reverse if you extend the window?)
- Cumulative charts that can only go up, disguising slowing growth
- Partial current period compared against complete past periods (the classic "this month looks terrible" on day 5)
- Granularity chosen to smooth volatility (yearly bars hiding a bad recent quarter)

**Chart-type misuse**
- Pie charts with too many slices or near-equal slices
- 3D effects distorting proportion
- Area charts double-counting stacked series visually

**Arithmetic consistency**
- Do visible subtotals sum to visible totals?
- Do percentages sum to ~100% where they should?
- Do related charts agree (e.g., revenue chart vs. revenue KPI tile)?

## Phase 3 — Aggregation Masking (what the summary hides)

For each aggregate metric, ask what distribution or segment split could hide beneath it:

- **Averages**: could this be bimodal? One whale customer or outlier dragging the mean? Flag any average shown without a median or distribution.
- **Top-line totals**: could one growing segment be masking another's decline? (Aggregate up 5% is consistent with a key segment down 30%.)
- **Ratios and rates**: is the denominator shown anywhere? A rising conversion rate with falling traffic is a very different story than with rising traffic.
- **Period-over-period deltas**: is the comparison base itself anomalous (holiday, outage, promotion), making the delta meaningless?

For each hit, state the specific alternative reality the chart cannot rule out. Example: "Average deal size $42K, up 8% — a single large enterprise deal this quarter would produce exactly this picture while typical deal size falls. The dashboard cannot distinguish these."

## Phase 4 — Blind-Spot Hunt (what is NOT on the dashboard)

This is the core of the skill. Infer the business domain from the metrics shown, then ask what a skeptical analyst in that domain would expect to see and doesn't:

- **Missing counter-metrics**: revenue without churn; signups without activation; velocity without defect rate; cost savings without quality impact. Every optimistic metric has a natural counterweight — is it here?
- **Missing segments**: metrics shown only in aggregate. Which dimension (region, plan tier, cohort, channel, product line) is most likely to hide divergent behavior?
- **Missing baselines**: numbers with no comparison — no target, no prior period, no benchmark. "Is 4.2% good?" should never be an open question.
- **Missing distributions**: any average or total where the shape of the data matters.
- **Missing denominators and funnel context**: rates without volumes, stages without the stage before.
- **Survivorship framing**: metrics computed only over entities that still exist (active customers, retained employees, live SKUs).

Output of this phase: a ranked list of "unknowns to investigate," each phrased as a concrete, checkable question.

## Phase 5 — Trend and Anomaly Cues

From what IS visible:

- Trend breaks: level shifts, slope changes, and roughly when they occurred
- Suspicious smoothness: real operational data is noisy; perfectly smooth lines suggest heavy smoothing, interpolation, or synthetic data
- Seasonality: does the current move just repeat last year's pattern, or deviate from it?
- Flatlines and repeated exact values: often a broken pipeline, not stable performance
- Stale data: last data point noticeably older than "today"

## Output Format

ALWAYS structure the final response as:

# Dashboard Review: [inferred name/domain]

## What this dashboard says
2-3 sentences, the surface story. Keep it short — this is context, not the product.

## Findings
Each finding gets: **severity** (Critical / Warning / Note), **what**, **why it matters**, **evidence** (the specific chart/value). Order by severity. Only include real findings — an honest "the visualization integrity here is solid" is better than padded nitpicks.

## What this dashboard is NOT telling you
The ranked unknowns from Phase 4, each as a concrete question. This section must never be empty — every dashboard has blind spots.

## Questions for your data team
3-7 copy-paste-ready follow-up queries or questions, most valuable first. Where possible, phrase as a specific check: "Break Q2 revenue by customer tier — is growth concentrated in the top 5 accounts?" not "look deeper into revenue."

## Severity Calibration

- **Critical**: the dashboard could drive a wrong decision as-is (misleading visual, arithmetic inconsistency, partial-period comparison presented as complete)
- **Warning**: a plausible hidden risk the dashboard cannot rule out (masked segment, missing counter-metric)
- **Note**: hygiene and best-practice improvements (add baselines, show medians)

## Tone Rules

- Be specific or be silent: every finding must cite the exact chart, value, or visual feature. No generic advice that would apply to any dashboard.
- Distinguish "this IS misleading" (integrity hit, observable) from "this COULD be hiding something" (masking risk, hypothesis). Never present a hypothesis as a fact.
- Do not manufacture problems. Two strong findings beat ten weak ones.
- If the user asks a narrower question ("is this chart okay?"), still run the full battery mentally, answer their question first, then surface at most the top 2 other findings.

## Example (condensed)

Input: SaaS revenue dashboard — MRR line (y-axis starting at $80K), "New Customers: 45 ▲12%", pie of revenue by plan, "Churn 2.1%" tile, data through May 3, viewed in May.

Output findings would include:
- **Critical** — MRR y-axis starts at $80K, not zero: the ~6% growth is drawn as a ~60% visual climb.
- **Critical** — "May" appears in the monthly comparison but is 3 days old: partial period vs. complete Aprils.
- **Warning** — Churn 2.1% has no denominator or trend: 2.1% of what base, and is it customer or revenue churn? Logo churn can look flat while revenue churn spikes if large accounts leave.
- **Not telling you** — No expansion/contraction split of MRR; no cohort view; no CAC alongside new-customer growth.
- **Data team question** — "Split MRR movement into new / expansion / contraction / churn for the last 6 months — is growth new-business-driven or expansion-driven?"
