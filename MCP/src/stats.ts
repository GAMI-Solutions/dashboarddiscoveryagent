/**
 * Statistical scan battery for "unknown unknowns" hidden in dashboard data.
 *
 * Design principle (shared with the Dashboard Discovery Agent skill):
 * be specific or be silent. Findings carry evidence and are framed as
 * "worth investigating", never verdicts.
 */

import type { Row } from "./metabase.js";

export type Severity = "critical" | "warning" | "note";

export interface Finding {
  id: string;
  type:
    | "outlier"
    | "trend_break"
    | "seasonality_deviation"
    | "segment_divergence"
    | "concentration"
    | "data_quality";
  severity: Severity;
  title: string;
  evidence: string;
  /** Small slice of rows/values backing the finding, for explain_finding. */
  dataSlice: unknown;
  suggestedFollowUp: string;
  cardId?: number;
  cardName?: string;
}

export interface ColumnProfile {
  name: string;
  kind: "numeric" | "date" | "categorical" | "other";
  distinct: number;
}

let findingCounter = 0;
export function nextFindingId(): string {
  findingCounter += 1;
  return `F-${String(findingCounter).padStart(3, "0")}`;
}

/* ---------------------------------- helpers --------------------------------- */

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parseDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v !== "string") return null;
  // Accept ISO-ish strings only, to avoid parsing "123" as a date.
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/* --------------------------------- profiling --------------------------------- */

export function profileColumns(rows: Row[]): ColumnProfile[] {
  if (rows.length === 0) return [];
  const names = Object.keys(rows[0]);
  return names.map((name) => {
    const values = rows.map((r) => r[name]).filter((v) => v !== null && v !== undefined);
    const distinct = new Set(values.map((v) => String(v))).size;
    const numericCount = values.filter(isFiniteNumber).length;
    const dateCount = values.filter((v) => parseDate(v) !== null).length;
    let kind: ColumnProfile["kind"] = "other";
    if (values.length > 0 && dateCount / values.length > 0.9) kind = "date";
    else if (values.length > 0 && numericCount / values.length > 0.9) kind = "numeric";
    else if (
      distinct > 1 &&
      (distinct <= 50 || distinct / Math.max(values.length, 1) < 0.3)
    )
      kind = "categorical";
    return { name, kind, distinct };
  });
}

/* ---------------------------------- scanners --------------------------------- */

/** Robust (median/MAD) outlier detection on each numeric column. */
export function scanOutliers(rows: Row[], profiles: ColumnProfile[]): Finding[] {
  const findings: Finding[] = [];
  for (const col of profiles.filter((p) => p.kind === "numeric")) {
    const vals = rows.map((r) => r[col.name]).filter(isFiniteNumber);
    if (vals.length < 8) continue;
    const med = median(vals);
    const mad = median(vals.map((v) => Math.abs(v - med)));
    if (mad === 0) continue; // constant-ish column
    const scored = rows
      .map((r, i) => ({ i, v: r[col.name] }))
      .filter((x): x is { i: number; v: number } => isFiniteNumber(x.v))
      .map((x) => ({ ...x, z: (0.6745 * (x.v - med)) / mad }))
      .filter((x) => Math.abs(x.z) > 3.5)
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
      .slice(0, 5);
    if (scored.length === 0) continue;
    const worst = scored[0];
    findings.push({
      id: nextFindingId(),
      type: "outlier",
      severity: Math.abs(worst.z) > 7 ? "critical" : "warning",
      title: `${scored.length} extreme value(s) in "${col.name}"`,
      evidence: `Median is ${fmt(med)}; the most extreme value is ${fmt(worst.v)} (robust z ≈ ${worst.z.toFixed(1)}). Values this far out can single-handedly move averages and totals shown on the dashboard.`,
      dataSlice: scored.map((s) => ({ rowIndex: s.i, value: s.v, robustZ: +s.z.toFixed(2), row: rows[s.i] })),
      suggestedFollowUp: `Verify whether these ${col.name} values are legitimate (whale customer, bulk order, currency/unit error, test data). Re-compute the headline metric with and without them.`,
    });
  }
  return findings;
}

/**
 * Trend-break detection on (date, numeric) series via best two-segment split:
 * flags the split point with the largest mean shift relative to noise.
 */
export function scanTrendBreaks(rows: Row[], profiles: ColumnProfile[]): Finding[] {
  const findings: Finding[] = [];
  const dateCols = profiles.filter((p) => p.kind === "date");
  const numCols = profiles.filter((p) => p.kind === "numeric");
  if (dateCols.length === 0) return findings;
  const dateCol = dateCols[0];

  for (const col of numCols) {
    const series = rows
      .map((r) => ({ d: parseDate(r[dateCol.name]), v: r[col.name] }))
      .filter((x): x is { d: Date; v: number } => x.d !== null && isFiniteNumber(x.v))
      .sort((a, b) => a.d.getTime() - b.d.getTime());
    if (series.length < 12) continue;

    const vals = series.map((s) => s.v);
    const overallSd = stdev(vals);
    if (overallSd === 0) continue;

    let best = { idx: -1, shift: 0, before: 0, after: 0 };
    const minSeg = Math.max(4, Math.floor(vals.length / 8));
    for (let i = minSeg; i <= vals.length - minSeg; i++) {
      const before = mean(vals.slice(0, i));
      const after = mean(vals.slice(i));
      const pooledSd =
        Math.sqrt((stdev(vals.slice(0, i)) ** 2 + stdev(vals.slice(i)) ** 2) / 2) ||
        overallSd;
      const shift = Math.abs(after - before) / (pooledSd || 1);
      if (shift > best.shift) best = { idx: i, shift, before, after };
    }

    const relChange =
      best.before !== 0
        ? Math.abs(best.after - best.before) / Math.abs(best.before)
        : Infinity;
    if (best.idx >= 0 && best.shift > 2 && relChange > 0.05) {
      const when = series[best.idx].d.toISOString().slice(0, 10);
      const pct =
        best.before !== 0 ? ((best.after - best.before) / Math.abs(best.before)) * 100 : NaN;
      findings.push({
        id: nextFindingId(),
        type: "trend_break",
        severity: best.shift > 3 ? "critical" : "warning",
        title: `Level shift in "${col.name}" around ${when}`,
        evidence: `Mean ${col.name} moved from ${fmt(best.before)} to ${fmt(best.after)}${Number.isFinite(pct) ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)` : ""} around ${when} (shift ≈ ${best.shift.toFixed(1)}× local volatility). A line chart smoothing over this break would misrepresent both periods.`,
        dataSlice: series
          .slice(Math.max(0, best.idx - 5), best.idx + 5)
          .map((s) => ({ date: s.d.toISOString().slice(0, 10), value: s.v })),
        suggestedFollowUp: `What changed around ${when}? Check deployments, pricing changes, campaign launches, tracking/schema changes, and new data sources landing on that date.`,
      });
    }
  }
  return findings;
}

/**
 * Day-of-week seasonality deviation: recent points that break their weekday's
 * historical profile. Only runs on plausibly-daily data spanning ≥ 4 weeks.
 */
export function scanSeasonality(rows: Row[], profiles: ColumnProfile[]): Finding[] {
  const findings: Finding[] = [];
  const dateCols = profiles.filter((p) => p.kind === "date");
  if (dateCols.length === 0) return findings;
  const dateCol = dateCols[0];

  for (const col of profiles.filter((p) => p.kind === "numeric")) {
    const series = rows
      .map((r) => ({ d: parseDate(r[dateCol.name]), v: r[col.name] }))
      .filter((x): x is { d: Date; v: number } => x.d !== null && isFiniteNumber(x.v))
      .sort((a, b) => a.d.getTime() - b.d.getTime());
    if (series.length < 28) continue;
    const spanDays =
      (series[series.length - 1].d.getTime() - series[0].d.getTime()) / 86_400_000;
    if (spanDays < 27 || series.length / spanDays < 0.6) continue; // not daily-ish

    const byDow = new Map<number, number[]>();
    for (const s of series.slice(0, -7)) {
      const dow = s.d.getUTCDay();
      byDow.set(dow, [...(byDow.get(dow) ?? []), s.v]);
    }
    const recent = series.slice(-7);
    const deviants: { date: string; value: number; expected: number; z: number }[] = [];
    for (const s of recent) {
      const hist = byDow.get(s.d.getUTCDay()) ?? [];
      if (hist.length < 3) continue;
      const m = mean(hist);
      const sd = stdev(hist);
      if (sd === 0) continue;
      const z = (s.v - m) / sd;
      if (Math.abs(z) > 2.5)
        deviants.push({
          date: s.d.toISOString().slice(0, 10),
          value: s.v,
          expected: +m.toFixed(2),
          z: +z.toFixed(1),
        });
    }
    if (deviants.length > 0) {
      const worst = deviants.reduce((a, b) => (Math.abs(b.z) > Math.abs(a.z) ? b : a));
      findings.push({
        id: nextFindingId(),
        type: "seasonality_deviation",
        severity: Math.abs(worst.z) > 4 ? "critical" : "warning",
        title: `Recent "${col.name}" broke its weekday pattern`,
        evidence: `${deviants.length} of the last 7 days deviate >2.5σ from their weekday baseline. Worst: ${worst.date} at ${fmt(worst.value)} vs an expected ~${fmt(worst.expected)} for that weekday (z ≈ ${worst.z}).`,
        dataSlice: deviants,
        suggestedFollowUp: `Check whether ${worst.date} coincides with an outage, holiday, campaign, or tracking change. If not explainable, treat as an early trend signal, not noise.`,
      });
    }
  }
  return findings;
}

/**
 * Segment-level scans beneath aggregates:
 *  - concentration: one segment dominating a total the dashboard shows as one number
 *  - divergence: a major segment trending opposite to the aggregate
 */
export function scanSegments(rows: Row[], profiles: ColumnProfile[]): Finding[] {
  const findings: Finding[] = [];
  const catCols = profiles.filter((p) => p.kind === "categorical" && p.distinct >= 3);
  const numCols = profiles.filter((p) => p.kind === "numeric");
  const dateCol = profiles.find((p) => p.kind === "date");

  for (const cat of catCols.slice(0, 3)) {
    for (const num of numCols.slice(0, 3)) {
      const groups = new Map<string, { sum: number; rows: Row[] }>();
      for (const r of rows) {
        const key = String(r[cat.name] ?? "(null)");
        const v = r[num.name];
        if (!isFiniteNumber(v)) continue;
        const g = groups.get(key) ?? { sum: 0, rows: [] };
        g.sum += v;
        g.rows.push(r);
        groups.set(key, g);
      }
      if (groups.size < 3) continue;
      const total = [...groups.values()].reduce((a, g) => a + Math.abs(g.sum), 0);
      if (total === 0) continue;

      // Concentration
      const ranked = [...groups.entries()].sort(
        (a, b) => Math.abs(b[1].sum) - Math.abs(a[1].sum),
      );
      const [topName, topGroup] = ranked[0];
      const topShare = Math.abs(topGroup.sum) / total;
      if (topShare > 0.5 && groups.size >= 5) {
        findings.push({
          id: nextFindingId(),
          type: "concentration",
          severity: topShare > 0.75 ? "critical" : "warning",
          title: `"${topName}" alone is ${(topShare * 100).toFixed(0)}% of ${num.name}`,
          evidence: `Across ${groups.size} ${cat.name} segments, "${topName}" contributes ${(topShare * 100).toFixed(0)}% of total ${num.name}. Any aggregate KPI on this data is effectively a "${topName}" KPI; movements elsewhere are invisible.`,
          dataSlice: ranked.slice(0, 8).map(([k, g]) => ({
            segment: k,
            total: +g.sum.toFixed(2),
            share: +((Math.abs(g.sum) / total) * 100).toFixed(1),
          })),
          suggestedFollowUp: `Chart ${num.name} for "${topName}" and for everything-else separately. Ask: is the business deliberately concentrated here, and is that concentration increasing?`,
        });
      }

      // Divergence vs aggregate (needs a date column)
      if (dateCol) {
        const half = (rs: Row[]): [number, number] | null => {
          const pts = rs
            .map((r) => ({ d: parseDate(r[dateCol.name]), v: r[num.name] }))
            .filter((x): x is { d: Date; v: number } => x.d !== null && isFiniteNumber(x.v))
            .sort((a, b) => a.d.getTime() - b.d.getTime());
          if (pts.length < 6) return null;
          const mid = Math.floor(pts.length / 2);
          return [mean(pts.slice(0, mid).map((p) => p.v)), mean(pts.slice(mid).map((p) => p.v))];
        };
        const agg = half(rows);
        if (agg && agg[0] !== 0) {
          const aggGrowth = (agg[1] - agg[0]) / Math.abs(agg[0]);
          const diverging: { segment: string; growth: number; share: number }[] = [];
          for (const [name, g] of ranked) {
            const share = Math.abs(g.sum) / total;
            if (share < 0.1) continue;
            const h = half(g.rows);
            if (!h || h[0] === 0) continue;
            const growth = (h[1] - h[0]) / Math.abs(h[0]);
            if (
              Math.sign(growth) !== Math.sign(aggGrowth) &&
              Math.abs(growth - aggGrowth) > 0.15
            ) {
              diverging.push({ segment: name, growth, share });
            }
          }
          if (diverging.length > 0) {
            const d = diverging[0];
            findings.push({
              id: nextFindingId(),
              type: "segment_divergence",
              severity: d.share > 0.25 ? "critical" : "warning",
              title: `${cat.name} "${d.segment}" moves opposite to the aggregate ${num.name}`,
              evidence: `Aggregate ${num.name} is ${aggGrowth >= 0 ? "up" : "down"} ${(Math.abs(aggGrowth) * 100).toFixed(0)}% (second half vs first half of the period), but "${d.segment}" (${(d.share * 100).toFixed(0)}% of the total) is ${d.growth >= 0 ? "up" : "down"} ${(Math.abs(d.growth) * 100).toFixed(0)}%. The top-line trend masks this segment. ${diverging.length > 1 ? `${diverging.length - 1} other segment(s) also diverge.` : ""}`,
              dataSlice: diverging.map((x) => ({
                segment: x.segment,
                growthPct: +(x.growth * 100).toFixed(1),
                sharePct: +(x.share * 100).toFixed(1),
                aggregateGrowthPct: +(aggGrowth * 100).toFixed(1),
              })),
              suggestedFollowUp: `Break the dashboard's ${num.name} chart down by ${cat.name}. Investigate what changed for "${d.segment}": churned accounts, pricing, competition, or a tracking gap.`,
            });
          }
        }
      }
    }
  }
  return findings;
}

/** Basic data-quality tripwires that silently corrupt dashboards. */
export function scanDataQuality(rows: Row[], profiles: ColumnProfile[]): Finding[] {
  const findings: Finding[] = [];
  if (rows.length === 0) {
    findings.push({
      id: nextFindingId(),
      type: "data_quality",
      severity: "critical",
      title: "Card returned zero rows",
      evidence: "The underlying query returned no data; whatever the dashboard renders for this card is stale or empty.",
      dataSlice: [],
      suggestedFollowUp: "Check the card's filters and the freshness of its source table.",
    });
    return findings;
  }
  for (const col of profiles) {
    const nulls = rows.filter((r) => r[col.name] === null || r[col.name] === undefined).length;
    const ratio = nulls / rows.length;
    if (ratio > 0.2) {
      findings.push({
        id: nextFindingId(),
        type: "data_quality",
        severity: ratio > 0.5 ? "critical" : "warning",
        title: `"${col.name}" is ${(ratio * 100).toFixed(0)}% null`,
        evidence: `${nulls} of ${rows.length} rows have no ${col.name}. Any chart grouping or filtering on this column silently drops or misattributes these rows.`,
        dataSlice: { nullCount: nulls, totalRows: rows.length },
        suggestedFollowUp: `Find out where the nulls come from (join misses, optional field, tracking gap) and whether dashboard filters exclude them.`,
      });
    }
  }
  // Stale data check on the first date column
  const dateCol = profiles.find((p) => p.kind === "date");
  if (dateCol) {
    const dates = rows
      .map((r) => parseDate(r[dateCol.name]))
      .filter((d): d is Date => d !== null);
    if (dates.length > 0) {
      const latest = new Date(Math.max(...dates.map((d) => d.getTime())));
      const ageDays = (Date.now() - latest.getTime()) / 86_400_000;
      if (ageDays > 7) {
        findings.push({
          id: nextFindingId(),
          type: "data_quality",
          severity: ageDays > 30 ? "critical" : "note",
          title: `Data ends ${Math.floor(ageDays)} days ago`,
          evidence: `Latest ${dateCol.name} is ${latest.toISOString().slice(0, 10)}. If the dashboard implies it is current, viewers are reading stale numbers.`,
          dataSlice: { latestDate: latest.toISOString().slice(0, 10), ageDays: Math.floor(ageDays) },
          suggestedFollowUp: "Confirm the pipeline feeding this table is running and the dashboard shows a freshness timestamp.",
        });
      }
    }
  }
  return findings;
}

/** Run the full battery over one card's rows. */
export function runScanBattery(rows: Row[]): Finding[] {
  const profiles = profileColumns(rows);
  const findings = [
    ...scanDataQuality(rows, profiles),
    ...scanOutliers(rows, profiles),
    ...scanTrendBreaks(rows, profiles),
    ...scanSeasonality(rows, profiles),
    ...scanSegments(rows, profiles),
  ];
  const order: Record<Severity, number> = { critical: 0, warning: 1, note: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}
