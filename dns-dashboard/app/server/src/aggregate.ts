import type { AgStats, AgTopArray } from './adguard/types.ts';

export interface TopItem {
  name: string;
  count: number;
  perServer: Record<string, number>;
}

export interface UpstreamItem {
  name: string;
  responses: number;
  avgMs: number;
}

export interface Counters {
  queries: number;
  blocked: number;
  blockedPct: number;
  safebrowsing: number;
  parental: number;
  safesearch: number;
  avgMs: number;
}

export interface ServerStats {
  id: string;
  stats: AgStats;
}

const HOUR_MS = 3600_000;

export function topEntries(arr: AgTopArray | undefined | null): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const entry of arr ?? []) {
    for (const [k, v] of Object.entries(entry)) out.push([k, v]);
  }
  return out;
}

/** Sums the per-server top lists by key and keeps the per-server split. */
export function mergeTop(lists: Array<{ id: string; list?: AgTopArray | null }>, limit = 10): TopItem[] {
  const byName = new Map<string, TopItem>();
  for (const { id, list } of lists) {
    for (const [name, count] of topEntries(list)) {
      const item = byName.get(name) ?? { name, count: 0, perServer: {} };
      item.count += count;
      item.perServer[id] = (item.perServer[id] ?? 0) + count;
      byName.set(name, item);
    }
  }
  return [...byName.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, limit);
}

/** Average upstream time weighted by the number of responses each server got from it. */
export function mergeUpstreams(servers: ServerStats[], limit = 10): UpstreamItem[] {
  const acc = new Map<string, { responses: number; weightedSec: number; unweighted: number[] }>();
  for (const { stats } of servers) {
    const responses = new Map(topEntries(stats.top_upstreams_responses));
    for (const [name, avgSec] of topEntries(stats.top_upstreams_avg_time)) {
      const a = acc.get(name) ?? { responses: 0, weightedSec: 0, unweighted: [] };
      const n = responses.get(name) ?? 0;
      a.responses += n;
      a.weightedSec += avgSec * n;
      a.unweighted.push(avgSec);
      acc.set(name, a);
    }
    for (const [name, n] of responses) {
      if (!acc.has(name)) acc.set(name, { responses: n, weightedSec: 0, unweighted: [] });
    }
  }
  return [...acc.entries()]
    .map(([name, a]) => {
      const sec =
        a.responses > 0 && a.weightedSec > 0
          ? a.weightedSec / a.responses
          : a.unweighted.reduce((s, v) => s + v, 0) / Math.max(1, a.unweighted.length);
      return { name, responses: a.responses, avgMs: round(sec * 1000, 1) };
    })
    .sort((a, b) => b.responses - a.responses)
    .slice(0, limit);
}

export function counters(stats: AgStats[]): Counters {
  const sum = (f: (s: AgStats) => number) => stats.reduce((acc, s) => acc + (f(s) || 0), 0);
  const queries = sum((s) => s.num_dns_queries);
  const blocked = sum((s) => s.num_blocked_filtering);
  const weightedSec = sum((s) => s.avg_processing_time * s.num_dns_queries);
  return {
    queries,
    blocked,
    blockedPct: queries ? round((blocked / queries) * 100, 1) : 0,
    safebrowsing: sum((s) => s.num_replaced_safebrowsing),
    parental: sum((s) => s.num_replaced_parental),
    safesearch: sum((s) => s.num_replaced_safesearch),
    avgMs: queries ? round((weightedSec / queries) * 1000, 2) : 0,
  };
}

export function hourStart(ts: number): number {
  return Math.floor(ts / HOUR_MS) * HOUR_MS;
}

/**
 * Bucket start times for a stats series. The last element is the current hour/day.
 * Day buckets are anchored to local midnight.
 */
export function seriesTimes(length: number, units: 'hours' | 'days', now = Date.now()): number[] {
  const out: number[] = [];
  if (units === 'hours') {
    const last = hourStart(now);
    for (let i = length - 1; i >= 0; i--) out.push(last - i * HOUR_MS);
  } else {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    for (let i = length - 1; i >= 0; i--) {
      const x = new Date(d);
      x.setDate(d.getDate() - i);
      out.push(x.getTime());
    }
  }
  return out;
}

export interface CombinedSeries {
  units: 'hours' | 'days';
  t: number[];
  queries: Record<string, number[]>;
  blocked: Record<string, number[]>;
}

/** Right-aligns the per-server series (they all end "now") to a common length. */
export function combineSeries(servers: ServerStats[], now = Date.now()): CombinedSeries {
  const units = servers.some((s) => s.stats.time_units === 'days') ? 'days' : 'hours';
  const usable = servers.filter((s) => s.stats.time_units === units);
  const len = Math.max(0, ...usable.map((s) => s.stats.dns_queries?.length ?? 0));
  const pad = (arr: number[] | undefined) => {
    const a = arr ?? [];
    return [...new Array<number>(Math.max(0, len - a.length)).fill(0), ...a.slice(-len)];
  };
  const queries: Record<string, number[]> = {};
  const blocked: Record<string, number[]> = {};
  for (const s of usable) {
    queries[s.id] = pad(s.stats.dns_queries);
    blocked[s.id] = pad(s.stats.blocked_filtering);
  }
  return { units, t: seriesTimes(len, units, now), queries, blocked };
}

export function round(v: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
