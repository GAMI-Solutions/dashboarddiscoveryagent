/**
 * Unit tests for the statistical scan battery (node:test).
 * Synthetic data with planted anomalies — each scanner must find its plant
 * and stay quiet on clean data.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  profileColumns,
  runScanBattery,
  scanOutliers,
  scanTrendBreaks,
  scanSeasonality,
  scanSegments,
} from "../stats.js";
import type { Row } from "../metabase.js";

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dailyDates(n: number, endDaysAgo = 1): Date[] {
  const out: Date[] = [];
  const end = Date.now() - endDaysAgo * 86_400_000;
  for (let i = n - 1; i >= 0; i--) out.push(new Date(end - i * 86_400_000));
  return out;
}

/** Deterministic pseudo-noise. */
function noise(i: number, scale = 1): number {
  return Math.sin(i * 12.9898) * 43758.5453 % 1 * scale;
}

test("profileColumns detects kinds", () => {
  const rows: Row[] = dailyDates(30).map((d, i) => ({
    date: iso(d),
    revenue: 100 + i,
    region: ["NA", "EU", "APAC"][i % 3],
  }));
  const profiles = profileColumns(rows);
  assert.equal(profiles.find((p) => p.name === "date")?.kind, "date");
  assert.equal(profiles.find((p) => p.name === "revenue")?.kind, "numeric");
  assert.equal(profiles.find((p) => p.name === "region")?.kind, "categorical");
});

test("scanOutliers finds a planted whale and is silent on clean data", () => {
  const clean: Row[] = Array.from({ length: 50 }, (_, i) => ({
    amount: 100 + noise(i, 5),
  }));
  assert.equal(scanOutliers(clean, profileColumns(clean)).length, 0);

  const dirty: Row[] = [...clean, { amount: 5000 }];
  const findings = scanOutliers(dirty, profileColumns(dirty));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "outlier");
  assert.match(findings[0].evidence, /5,000/);
});

test("scanTrendBreaks finds a planted level shift", () => {
  const dates = dailyDates(60);
  const rows: Row[] = dates.map((d, i) => ({
    date: iso(d),
    signups: (i < 30 ? 100 : 160) + noise(i, 6),
  }));
  const findings = scanTrendBreaks(rows, profileColumns(rows));
  assert.ok(findings.length >= 1, "expected a trend break finding");
  assert.equal(findings[0].type, "trend_break");
});

test("scanTrendBreaks silent on stable series", () => {
  const dates = dailyDates(60);
  const rows: Row[] = dates.map((d, i) => ({
    date: iso(d),
    signups: 100 + noise(i, 6),
  }));
  assert.equal(scanTrendBreaks(rows, profileColumns(rows)).length, 0);
});

test("scanSeasonality flags a weekday-pattern break in the last week", () => {
  const dates = dailyDates(70);
  const rows: Row[] = dates.map((d, i) => {
    const dow = d.getUTCDay();
    const base = dow === 0 || dow === 6 ? 40 : 100; // weekend dip
    // Crash the final 2 days far below any weekday baseline
    const v = i >= dates.length - 2 ? 5 : base + noise(i, 4);
    return { date: iso(d), sessions: v };
  });
  const findings = scanSeasonality(rows, profileColumns(rows));
  assert.ok(findings.length >= 1, "expected a seasonality finding");
  assert.equal(findings[0].type, "seasonality_deviation");
});

test("scanSegments finds divergence and concentration", () => {
  const dates = dailyDates(40);
  const rows: Row[] = [];
  for (let i = 0; i < dates.length; i++) {
    // Aggregate grows, but EU declines; NA dominates the total.
    rows.push({ date: iso(dates[i]), region: "NA", revenue: 1000 + i * 30 + noise(i, 20) });
    rows.push({ date: iso(dates[i]), region: "EU", revenue: 400 - i * 8 + noise(i + 7, 10) });
    rows.push({ date: iso(dates[i]), region: "APAC", revenue: 150 + i * 2 + noise(i + 13, 10) });
    rows.push({ date: iso(dates[i]), region: "LATAM", revenue: 60 + noise(i + 3, 5) });
    rows.push({ date: iso(dates[i]), region: "MEA", revenue: 50 + noise(i + 9, 5) });
  }
  const findings = scanSegments(rows, profileColumns(rows));
  const types = findings.map((f) => f.type);
  assert.ok(types.includes("segment_divergence"), `expected divergence, got ${types}`);
  assert.ok(types.includes("concentration"), `expected concentration, got ${types}`);
  const div = findings.find((f) => f.type === "segment_divergence")!;
  assert.match(div.title, /EU/);
});

test("runScanBattery orders by severity and flags empty data", () => {
  const empty = runScanBattery([]);
  assert.equal(empty[0].type, "data_quality");
  assert.equal(empty[0].severity, "critical");

  const dates = dailyDates(60);
  const rows: Row[] = dates.map((d, i) => ({
    date: iso(d),
    revenue: (i < 30 ? 100 : 200) + noise(i, 5),
  }));
  const findings = runScanBattery(rows);
  const sevRank = { critical: 0, warning: 1, note: 2 } as const;
  for (let i = 1; i < findings.length; i++) {
    assert.ok(sevRank[findings[i - 1].severity] <= sevRank[findings[i].severity]);
  }
});
