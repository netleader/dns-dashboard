import { type ServerStats, combineSeries, counters, mergeTop, mergeUpstreams } from './aggregate.ts';
import { type Alert, computeAlerts, updateAvailable } from './alerts.ts';
import type { StatsQueries } from './db/queries.ts';
import { HOUR_MS } from './db/history.ts';
import { type DriftReport, computeDrift } from './drift.ts';
import type { Poller, ServerState } from './poller.ts';

/** Maps client IPs / ClientIDs to friendly names from both servers and the history. */
export function clientNameResolver(servers: ServerState[], known?: Map<string, string>) {
  const names = new Map<string, string>(known);
  for (const s of servers) {
    for (const a of s.clients?.auto_clients ?? []) if (a.name) names.set(a.ip, a.name);
    for (const c of s.clients?.clients ?? []) for (const id of c.ids ?? []) names.set(id, c.name);
  }
  return (key: string) => names.get(key);
}

export function protectionState(s: ServerState, now = Date.now()) {
  const enabled = s.status?.protection_enabled ?? null;
  const left = s.status?.protection_disabled_duration ?? 0;
  return { enabled, pausedUntil: enabled === false && left > 0 ? now + left : null };
}

export function serverSummary(s: ServerState, originId: string, now = Date.now()) {
  const c = s.stats ? counters([s.stats]) : null;
  return {
    id: s.cfg.id,
    name: s.cfg.name,
    color: s.cfg.color,
    url: s.cfg.url,
    online: s.online,
    error: s.error ?? null,
    lastOk: s.lastOk ?? null,
    isOrigin: s.cfg.id === originId,
    version: s.status?.version ?? null,
    running: s.status?.running ?? null,
    startTime: s.status?.start_time ?? null,
    updateAvailable: updateAvailable(s),
    protection: protectionState(s, now),
    dns: s.dns ?? null,
    stats: c,
  };
}

export class OverviewBuilder {
  drift: DriftReport = { checkedAt: 0, differences: 0, areas: [] };
  alerts: Alert[] = [];
  private readonly poller: Poller;
  private readonly stats?: StatsQueries;

  constructor(poller: Poller, stats?: StatsQueries) {
    this.poller = poller;
    this.stats = stats;
  }

  build(now = Date.now()) {
    const { poller } = this;
    this.drift = computeDrift(poller.servers, now);
    this.alerts = computeAlerts(poller.servers, poller.sync, this.drift, now);
    const originId = poller.originId();
    const withStats: ServerStats[] = poller.servers.filter((s) => s.stats).map((s) => ({ id: s.cfg.id, stats: s.stats! }));
    const name = clientNameResolver(poller.servers, this.stats?.knownClientNames());
    const ids = poller.servers.map((s) => s.cfg.id);

    // Same 24h window one day earlier, from our own history (absent during the first day).
    const hourNow = Math.floor(now / HOUR_MS) * HOUR_MS;
    const prevWindow = { from: hourNow - 47 * HOUR_MS, to: hourNow - 23 * HOUR_MS };
    const prev = this.stats?.covers(prevWindow) ? this.stats.totals(prevWindow, ids) : undefined;
    const recentClients = this.stats?.totals({ from: hourNow - 23 * HOUR_MS, to: hourNow + HOUR_MS }, ids).clients ?? 0;

    const topClients = mergeTop(withStats.map((s) => ({ id: s.id, list: s.stats.top_clients })), 10);
    const sync = poller.sync;
    return {
      updatedAt: now,
      originId,
      servers: poller.servers.map((s) => serverSummary(s, originId, now)),
      combined: {
        ...counters(withStats.map((s) => s.stats)),
        activeClients: Math.max(recentClients, topClients.length),
        previous: prev && prev.queries > 0 ? { queries: prev.queries, blocked: prev.blocked, blockedPct: prev.blockedPct } : null,
        series: combineSeries(withStats, now),
        topDomains: mergeTop(withStats.map((s) => ({ id: s.id, list: s.stats.top_queried_domains })), 10),
        topBlocked: mergeTop(withStats.map((s) => ({ id: s.id, list: s.stats.top_blocked_domains })), 10),
        topClients: topClients.map((c) => ({ ...c, label: name(c.name) })),
        topUpstreams: mergeUpstreams(withStats, 8),
      },
      sync: {
        configured: sync.configured,
        reachable: sync.reachable,
        running: sync.status?.syncRunning ?? false,
        error: sync.error ?? null,
        lastSyncAt: sync.lastSyncAt ?? null,
        origin: sync.status?.origin ? { ...sync.status.origin, serverId: poller.serverIdFor(sync.status.origin.url) ?? null } : null,
        replicas: (sync.status?.replicas ?? []).map((r) => ({ ...r, serverId: poller.serverIdFor(r.url) ?? null })),
      },
      drift: { checkedAt: this.drift.checkedAt, differences: this.drift.differences },
      alerts: this.alerts,
    };
  }
}

export type Overview = ReturnType<OverviewBuilder['build']>;
