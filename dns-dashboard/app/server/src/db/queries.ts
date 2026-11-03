import { round } from '../aggregate.ts';
import { HOUR_MS, type History } from './history.ts';

export const RANGES = { '24h': 24, '7d': 168, '30d': 720, '90d': 2160, '365d': 8760 } as const;
export type RangeKey = keyof typeof RANGES;

export interface Window {
  from: number;
  to: number;
}

export interface StatsContext {
  servers: string[];
  /** Filter list names per server – list ids are assigned per instance, so names are the common key. */
  listNames: Map<string, Map<number, string>>;
  clientName: (key: string) => string | undefined;
}

export interface KeyCount {
  key: string;
  count: number;
  blocked?: number;
  avgMs?: number;
}

export interface TopEntry {
  key: string;
  label?: string;
  count: number;
  blocked: number;
  perServer: Record<string, number>;
  rank: number;
  prevRank?: number;
  trend: number[];
}

export interface Totals {
  queries: number;
  blocked: number;
  blockedPct: number;
  safebrowsing: number;
  parental: number;
  avgMs: number | null;
  cacheHitPct: number | null;
  dnssecPct: number | null;
  nxdomainPct: number | null;
  servfailPct: number | null;
  clients: number;
  logged: number;
}

const US_PER_HOUR = HOUR_MS * 1000;
const DAY_HOURS = 24;

export function windowFor(range: RangeKey, now = Date.now()): Window {
  const to = Math.floor(now / HOUR_MS) * HOUR_MS + HOUR_MS;
  return { from: to - RANGES[range] * HOUR_MS, to };
}

function localDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Bucket start times: hourly up to 7 days, daily (local midnight) beyond. */
export function buckets(w: Window): { unit: 'hour' | 'day'; t: number[]; index: (hour: number) => number } {
  if (w.to - w.from <= 7 * DAY_HOURS * HOUR_MS) {
    const t: number[] = [];
    for (let h = w.from; h < w.to; h += HOUR_MS) t.push(h);
    return { unit: 'hour', t, index: (hour) => Math.floor((hour - w.from) / HOUR_MS) };
  }
  const t: number[] = [];
  for (let d = localDay(w.from); d < w.to; ) {
    t.push(d);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    d = next.getTime();
  }
  const pos = new Map(t.map((d, i) => [d, i]));
  return { unit: 'day', t, index: (hour) => pos.get(localDay(hour)) ?? -1 };
}

interface HourRow {
  server: string;
  hour: number;
  queries: number;
  blocked: number;
  safebrowsing: number;
  parental: number;
}

export class StatsQueries {
  private readonly h: History;

  constructor(h: History) {
    this.h = h;
  }

  private inServers(servers: string[]) {
    return { sql: `server IN (${servers.map(() => '?').join(',')})`, params: servers };
  }

  /**
   * Per server and hour: AdGuard's own counters where we have them,
   * otherwise counts derived from the query log.
   */
  hourly(w: Window, servers: string[]): HourRow[] {
    const s = this.inServers(servers);
    const stats = this.h.db
      .prepare(`SELECT server, hour, queries, blocked, safebrowsing, parental FROM hourly_stats
                WHERE hour >= ? AND hour < ? AND ${s.sql}`)
      .all(w.from, w.to, ...s.params) as unknown as HourRow[];
    const have = new Set(stats.map((r) => `${r.server}|${r.hour}`));
    const fromLog = this.h.db
      .prepare(`SELECT server, hour, count AS queries, blocked, 0 AS safebrowsing, 0 AS parental FROM rollup
                WHERE dim = 'total' AND hour >= ? AND hour < ? AND ${s.sql}`)
      .all(w.from, w.to, ...s.params) as unknown as HourRow[];
    return [...stats, ...fromLog.filter((r) => !have.has(`${r.server}|${r.hour}`))];
  }

  private dims(w: Window, servers: string[], dims: string[]) {
    const s = this.inServers(servers);
    return this.h.db
      .prepare(`SELECT dim, key, SUM(count) AS count, SUM(blocked) AS blocked, SUM(elapsed_sum) AS elapsed FROM rollup
                WHERE hour >= ? AND hour < ? AND ${s.sql} AND dim IN (${dims.map(() => '?').join(',')})
                GROUP BY dim, key`)
      .all(w.from, w.to, ...s.params, ...dims) as unknown as Array<{
      dim: string;
      key: string;
      count: number;
      blocked: number;
      elapsed: number;
    }>;
  }

  totals(w: Window, servers: string[]): Totals {
    const rows = this.hourly(w, servers);
    const sum = (f: (r: HourRow) => number) => rows.reduce((a, r) => a + f(r), 0);
    const queries = sum((r) => r.queries);
    const blocked = sum((r) => r.blocked);
    const d = this.dims(w, servers, ['total', 'cached', 'dnssec', 'rcode']);
    const of = (dim: string, key?: string) =>
      d.filter((r) => r.dim === dim && (key === undefined || r.key === key)).reduce((a, r) => a + r.count, 0);
    const logged = of('total');
    const pct = (n: number) => (logged ? round((n / logged) * 100, 1) : null);
    const elapsed = d.filter((r) => r.dim === 'total').reduce((a, r) => a + r.elapsed, 0);
    const s = this.inServers(servers);
    const clients = this.h.db
      .prepare(`SELECT COUNT(DISTINCT key) AS n FROM rollup WHERE dim = 'client' AND hour >= ? AND hour < ? AND ${s.sql}`)
      .get(w.from, w.to, ...s.params) as { n: number };
    return {
      queries,
      blocked,
      blockedPct: queries ? round((blocked / queries) * 100, 1) : 0,
      safebrowsing: sum((r) => r.safebrowsing),
      parental: sum((r) => r.parental),
      avgMs: logged ? round(elapsed / logged, 2) : null,
      cacheHitPct: pct(of('cached', '1')),
      dnssecPct: pct(of('dnssec', '1')),
      nxdomainPct: pct(of('rcode', 'NXDOMAIN')),
      servfailPct: pct(of('rcode', 'SERVFAIL')),
      clients: clients.n,
      logged,
    };
  }

  private top(w: Window, servers: string[], dim: string, limit: number) {
    const s = this.inServers(servers);
    return this.h.db
      .prepare(`SELECT key, SUM(count) AS count, SUM(blocked) AS blocked FROM rollup
                WHERE dim = ? AND hour >= ? AND hour < ? AND ${s.sql}
                GROUP BY key ORDER BY count DESC, key LIMIT ?`)
      .all(dim, w.from, w.to, ...s.params, limit) as unknown as Array<{ key: string; count: number; blocked: number }>;
  }

  topWithTrend(w: Window, prev: Window, servers: string[], dim: string, ctx: StatsContext, limit = 15): TopEntry[] {
    const rows = this.top(w, servers, dim, limit);
    if (!rows.length) return [];
    const prevRanks = new Map(this.top(prev, servers, dim, 200).map((r, i) => [r.key, i + 1]));
    const b = buckets(w);
    const keys = rows.map((r) => r.key);
    const s = this.inServers(servers);
    const detail = this.h.db
      .prepare(`SELECT key, server, hour, SUM(count) AS count FROM rollup
                WHERE dim = ? AND hour >= ? AND hour < ? AND ${s.sql} AND key IN (${keys.map(() => '?').join(',')})
                GROUP BY key, server, hour`)
      .all(dim, w.from, w.to, ...s.params, ...keys) as unknown as Array<{
      key: string;
      server: string;
      hour: number;
      count: number;
    }>;
    const entries = new Map<string, TopEntry>(
      rows.map((r, i) => [
        r.key,
        {
          key: r.key,
          label: dim === 'client' ? ctx.clientName(r.key) : undefined,
          count: r.count,
          blocked: r.blocked,
          perServer: {},
          rank: i + 1,
          prevRank: prevRanks.get(r.key),
          trend: new Array<number>(b.t.length).fill(0),
        },
      ]),
    );
    for (const d of detail) {
      const e = entries.get(d.key)!;
      e.perServer[d.server] = (e.perServer[d.server] ?? 0) + d.count;
      const i = b.index(d.hour);
      if (i >= 0) e.trend[i] += d.count;
    }
    return [...entries.values()];
  }

  /** Average queries and block rate per local weekday (Mon = 0) and hour. */
  heatmap(w: Window, servers: string[]) {
    const queries = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    const blocked = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    const hours = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => new Set<number>()));
    for (const r of this.hourly(w, servers)) {
      const d = new Date(r.hour);
      const wd = (d.getDay() + 6) % 7;
      const hr = d.getHours();
      queries[wd][hr] += r.queries;
      blocked[wd][hr] += r.blocked;
      hours[wd][hr].add(r.hour);
    }
    return {
      queries: queries.map((row, wd) => row.map((q, hr) => round(q / Math.max(1, hours[wd][hr].size)))),
      blockedPct: blocked.map((row, wd) => row.map((b, hr) => (queries[wd][hr] ? round((b / queries[wd][hr]) * 100, 1) : 0))),
    };
  }

  bundle(w: Window, ctx: StatsContext) {
    const { servers } = ctx;
    const span = w.to - w.from;
    const prev = { from: w.from - span, to: w.from };
    const b = buckets(w);

    const zero = () => new Array<number>(b.t.length).fill(0);
    const queries: Record<string, number[]> = Object.fromEntries(servers.map((id) => [id, zero()]));
    const blocked: Record<string, number[]> = Object.fromEntries(servers.map((id) => [id, zero()]));
    for (const r of this.hourly(w, servers)) {
      const i = b.index(r.hour);
      if (i < 0) continue;
      queries[r.server][i] += r.queries;
      blocked[r.server][i] += r.blocked;
    }

    const s = this.inServers(servers);
    const elapsedRows = this.h.db
      .prepare(`SELECT hour, SUM(count) AS count, SUM(elapsed_sum) AS elapsed FROM rollup
                WHERE dim = 'total' AND hour >= ? AND hour < ? AND ${s.sql} GROUP BY hour`)
      .all(w.from, w.to, ...s.params) as unknown as Array<{ hour: number; count: number; elapsed: number }>;
    const cnt = zero();
    const el = zero();
    for (const r of elapsedRows) {
      const i = b.index(r.hour);
      if (i < 0) continue;
      cnt[i] += r.count;
      el[i] += r.elapsed;
    }
    const avgMs = cnt.map((c, i) => (c ? round(el[i] / c, 2) : null));

    const dims = this.dims(w, servers, ['reason', 'qtype', 'rcode', 'proto', 'upstream', 'service']);
    const pick = (dim: string, limit = 12): KeyCount[] =>
      dims
        .filter((r) => r.dim === dim)
        .sort((a, z) => z.count - a.count)
        .slice(0, limit)
        .map((r) => ({ key: r.key, count: r.count, blocked: r.blocked, avgMs: r.count ? round(r.elapsed / r.count, 2) : 0 }));

    const listRows = this.h.db
      .prepare(`SELECT server, key, SUM(count) AS count FROM rollup
                WHERE dim = 'filter_list' AND hour >= ? AND hour < ? AND ${s.sql} GROUP BY server, key`)
      .all(w.from, w.to, ...s.params) as unknown as Array<{ server: string; key: string; count: number }>;
    const lists = new Map<string, number>();
    for (const r of listRows) {
      const name = ctx.listNames.get(r.server)?.get(Number(r.key)) ?? `#${r.key}`;
      lists.set(name, (lists.get(name) ?? 0) + r.count);
    }

    const heatWindow = span >= 7 * DAY_HOURS * HOUR_MS ? w : { from: w.to - 7 * DAY_HOURS * HOUR_MS, to: w.to };

    return {
      from: w.from,
      to: w.to,
      unit: b.unit,
      t: b.t,
      coverage: this.coverage(),
      totals: this.totals(w, servers),
      previous: this.covers(prev) ? this.totals(prev, servers) : null,
      series: { queries, blocked, avgMs },
      heatmap: this.heatmap(heatWindow, servers),
      reasons: pick('reason'),
      qtypes: pick('qtype'),
      rcodes: pick('rcode'),
      protos: pick('proto'),
      upstreams: pick('upstream', 10),
      services: pick('service', 10),
      filterLists: [...lists.entries()].map(([key, count]) => ({ key, count })).sort((a, z) => z.count - a.count),
      topDomains: this.topWithTrend(w, prev, servers, 'domain', ctx),
      topBlocked: this.topWithTrend(w, prev, servers, 'blocked_domain', ctx),
      topClients: this.topWithTrend(w, prev, servers, 'client', ctx),
    };
  }

  /** True when our history reaches back to the start of `w` – otherwise comparisons would be lopsided. */
  covers(w: Window): boolean {
    const c = this.coverage();
    const from = Math.min(c.statsFrom ?? Infinity, c.logFrom ?? Infinity);
    return from <= w.from;
  }

  coverage() {
    const stats = this.h.db.prepare('SELECT MIN(hour) AS h FROM hourly_stats').get() as { h: number | null };
    const log = this.h.db.prepare('SELECT MIN(hour) AS h FROM rollup').get() as { h: number | null };
    const raw = this.h.db.prepare('SELECT MIN(ts) AS ts FROM raw.queries').get() as { ts: number | null };
    return { statsFrom: stats.h, logFrom: log.h, rawFrom: raw.ts !== null ? Math.floor(raw.ts / 1000) : null };
  }

  clientActivity(w: Window, servers: string[]) {
    const s = this.inServers(servers);
    return this.h.db
      .prepare(`SELECT key, server, SUM(count) AS count, SUM(blocked) AS blocked, MAX(hour) AS last FROM rollup
                WHERE dim = 'client' AND hour >= ? AND hour < ? AND ${s.sql} GROUP BY key, server`)
      .all(w.from, w.to, ...s.params) as unknown as Array<{
      key: string;
      server: string;
      count: number;
      blocked: number;
      last: number;
    }>;
  }

  knownClientNames(): Map<string, string> {
    const rows = this.h.db.prepare('SELECT client, name FROM client_names').all() as unknown as Array<{ client: string; name: string }>;
    return new Map(rows.map((r) => [r.client, r.name]));
  }

  /** Detail for one client from the raw query table (limited to the raw retention). */
  clientDetail(client: string, w: Window) {
    const fromUs = w.from * 1000;
    const toUs = w.to * 1000;
    const b = buckets(w);
    const series = this.h.db
      .prepare(`SELECT (ts / ${US_PER_HOUR}) * ${HOUR_MS} AS hour, COUNT(*) AS count, SUM(blocked) AS blocked
                FROM raw.queries WHERE client = ? AND ts >= ? AND ts < ? GROUP BY hour`)
      .all(client, fromUs, toUs) as unknown as Array<{ hour: number; count: number; blocked: number }>;
    const queries = new Array<number>(b.t.length).fill(0);
    const blocked = new Array<number>(b.t.length).fill(0);
    for (const r of series) {
      const i = b.index(r.hour);
      if (i < 0) continue;
      queries[i] += r.count;
      blocked[i] += r.blocked;
    }
    const group = (col: string, extra = '', limit = 15) =>
      this.h.db
        .prepare(`SELECT ${col} AS key, COUNT(*) AS count, SUM(blocked) AS blocked FROM raw.queries
                  WHERE client = ? AND ts >= ? AND ts < ? ${extra} GROUP BY ${col} ORDER BY count DESC LIMIT ${limit}`)
        .all(client, fromUs, toUs) as unknown as KeyCount[];
    return {
      unit: b.unit,
      t: b.t,
      queries,
      blocked,
      topDomains: group('domain'),
      topBlocked: group('domain', 'AND blocked = 1'),
      servers: group('server'),
      qtypes: group('qtype', '', 8),
    };
  }
}
