import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AgFilter } from '../adguard/types.ts';
import { isStale } from '../alerts.ts';
import { RANGES, type RangeKey, type StatsQueries, windowFor } from '../db/queries.ts';
import { errorMessage } from '../http.ts';
import { type Overview, type OverviewBuilder, clientNameResolver, serverSummary } from '../overview.ts';
import type { Poller, ServerState } from '../poller.ts';
import { type LogEntry, filterListNames, normalizeItem } from '../querylog.ts';

const RESPONSE_STATUSES = new Set([
  'all',
  'filtered',
  'blocked',
  'blocked_safebrowsing',
  'blocked_parental',
  'whitelisted',
  'rewritten',
  'safe_search',
  'processed',
]);
const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9*_-]+(\.[a-z0-9*_-]+)*\.?$/i;

interface Deps {
  poller: Poller;
  overview: OverviewBuilder;
  stats: StatsQueries;
  getOverview: () => Overview;
  /** Re-polls after an action and pushes the fresh overview to all SSE clients. */
  refresh: () => Promise<void>;
  subscribe: (fn: (o: Overview) => void) => () => void;
}

function rangeParam(v: unknown): RangeKey {
  return typeof v === 'string' && v in RANGES ? (v as RangeKey) : '24h';
}

export async function registerApi(app: FastifyInstance, d: Deps) {
  const { poller } = d;
  const serverIds = (v: unknown) => {
    const all = poller.servers.map((s) => s.cfg.id);
    return typeof v === 'string' && all.includes(v) ? [v] : all;
  };
  const listNames = () => new Map(poller.servers.map((s) => [s.cfg.id, filterListNames(s.filtering)]));
  const nameOf = () => clientNameResolver(poller.servers, d.stats.knownClientNames());

  /** Runs fn on every reachable server in parallel and reports per-server results. */
  async function onServers(targets: ServerState[], fn: (s: ServerState) => Promise<unknown>) {
    const res = await Promise.allSettled(targets.map(fn));
    return targets.map((s, i) => ({
      server: s.cfg.id,
      name: s.cfg.name,
      ok: res[i].status === 'fulfilled',
      error: res[i].status === 'rejected' ? errorMessage((res[i] as PromiseRejectedResult).reason) : undefined,
    }));
  }

  async function finish(reply: FastifyReply, body: object) {
    await d.refresh().catch(() => undefined);
    return reply.send(body);
  }

  app.get('/api/overview', async () => d.getOverview());

  app.get('/api/events', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (o: Overview) => reply.raw.write(`event: overview\ndata: ${JSON.stringify(o)}\n\n`);
    send(d.getOverview());
    const unsubscribe = d.subscribe(send);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 20_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  app.get<{ Querystring: { range?: string; server?: string } }>('/api/stats', async (req) => {
    const range = rangeParam(req.query.range);
    return {
      range,
      ...d.stats.bundle(windowFor(range), {
        servers: serverIds(req.query.server),
        listNames: listNames(),
        clientName: nameOf(),
      }),
    };
  });

  app.get<{ Querystring: { search?: string; status?: string; server?: string; before?: string; limit?: string } }>(
    '/api/querylog',
    async (req) => {
      const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 50));
      const status = RESPONSE_STATUSES.has(req.query.status ?? '') ? req.query.status : 'all';
      const targets = poller.servers.filter((s) => serverIds(req.query.server).includes(s.cfg.id) && s.online);
      const name = nameOf();
      const errors: Array<{ server: string; error: string }> = [];
      const entries: LogEntry[] = [];
      await Promise.all(
        targets.map(async (s) => {
          try {
            const res = await s.client.querylog({
              limit,
              olderThan: req.query.before || undefined,
              search: req.query.search?.trim() || undefined,
              responseStatus: status,
            });
            const lists = filterListNames(s.filtering);
            for (const item of res.data ?? []) entries.push(normalizeItem(s.cfg.id, item, lists));
          } catch (err) {
            errors.push({ server: s.cfg.id, error: errorMessage(err) });
          }
        }),
      );
      entries.sort((a, b) => b.tsUs - a.tsUs);
      const page = entries.slice(0, limit).map((e) => ({ ...e, clientName: e.clientName ?? name(e.client) }));
      return { entries: page, next: page.length === limit ? page.at(-1)!.time : null, errors };
    },
  );

  app.get<{ Querystring: { range?: string } }>('/api/clients', async (req) => {
    const ids = poller.servers.map((s) => s.cfg.id);
    const activity = d.stats.clientActivity(windowFor(rangeParam(req.query.range)), ids);
    const name = nameOf();

    type Row = {
      key: string;
      name?: string;
      source: string;
      ids: string[];
      tags: string[];
      count: number;
      blocked: number;
      perServer: Record<string, number>;
      lastSeen: number | null;
    };
    const rows = new Map<string, Row>();
    const configuredByName = new Map<string, Row>();
    // Configured clients are synced, so the same client appears on every server.
    for (const s of poller.servers) {
      for (const c of s.clients?.clients ?? []) {
        if (configuredByName.has(c.name)) continue;
        const row: Row = { key: c.name, name: c.name, source: 'configured', ids: c.ids ?? [], tags: c.tags ?? [], count: 0, blocked: 0, perServer: {}, lastSeen: null };
        configuredByName.set(c.name, row);
        rows.set(`cfg:${c.name}`, row);
      }
    }
    const byId = new Map<string, Row>();
    for (const row of configuredByName.values()) for (const id of row.ids) byId.set(id, row);
    for (const s of poller.servers) {
      for (const a of s.clients?.auto_clients ?? []) {
        if (byId.has(a.ip) || rows.has(a.ip)) continue;
        const row: Row = { key: a.ip, name: a.name || undefined, source: a.source, ids: [a.ip], tags: [], count: 0, blocked: 0, perServer: {}, lastSeen: null };
        rows.set(a.ip, row);
        byId.set(a.ip, row);
      }
    }
    for (const a of activity) {
      let row = byId.get(a.key);
      if (!row) {
        row = { key: a.key, name: name(a.key), source: 'querylog', ids: [a.key], tags: [], count: 0, blocked: 0, perServer: {}, lastSeen: null };
        rows.set(a.key, row);
        byId.set(a.key, row);
      }
      row.count += a.count;
      row.blocked += a.blocked;
      row.perServer[a.server] = (row.perServer[a.server] ?? 0) + a.count;
      row.lastSeen = Math.max(row.lastSeen ?? 0, a.last);
    }
    return { clients: [...rows.values()].sort((a, b) => b.count - a.count || (a.name ?? a.key).localeCompare(b.name ?? b.key)) };
  });

  app.get<{ Querystring: { ids?: string; range?: string } }>('/api/clients/detail', async (req) => {
    const ids = (req.query.ids ?? '').split(',').filter(Boolean).slice(0, 20);
    const w = windowFor(rangeParam(req.query.range));
    const details = ids.map((id) => d.stats.clientDetail(id, w));
    if (!details.length) return null;
    // Several ids (IP + MAC + ClientID) can belong to one configured client; add them up.
    const merge = (lists: Array<Array<{ key: string; count: number; blocked?: number }>>, limit = 15) => {
      const m = new Map<string, { key: string; count: number; blocked: number }>();
      for (const l of lists) {
        for (const r of l) {
          const e = m.get(r.key) ?? { key: r.key, count: 0, blocked: 0 };
          e.count += r.count;
          e.blocked += r.blocked ?? 0;
          m.set(r.key, e);
        }
      }
      return [...m.values()].sort((a, b) => b.count - a.count).slice(0, limit);
    };
    const sumArrays = (arrs: number[][]) => arrs[0].map((_, i) => arrs.reduce((a, x) => a + x[i], 0));
    return {
      unit: details[0].unit,
      t: details[0].t,
      queries: sumArrays(details.map((x) => x.queries)),
      blocked: sumArrays(details.map((x) => x.blocked)),
      topDomains: merge(details.map((x) => x.topDomains)),
      topBlocked: merge(details.map((x) => x.topBlocked)),
      servers: merge(details.map((x) => x.servers)),
      qtypes: merge(details.map((x) => x.qtypes), 8),
      rawFrom: d.stats.coverage().rawFrom,
    };
  });

  app.get('/api/servers', async () => {
    const originId = poller.originId();
    const now = Date.now();
    return {
      servers: poller.servers.map((s) => {
        const interval = s.filtering?.interval ?? 0;
        const lists = (all: AgFilter[] | null) =>
          (all ?? []).map((f) => ({
            name: f.name,
            url: f.url,
            enabled: f.enabled,
            rules: f.rules_count,
            lastUpdated: f.last_updated ?? null,
            stale: f.enabled && isStale(f.last_updated, interval, now),
          }));
        return {
          ...serverSummary(s, originId, now),
          configAt: s.configAt ?? null,
          dnsInfo: s.dnsInfo ?? null,
          filtering: s.filtering
            ? {
                enabled: s.filtering.enabled,
                interval,
                filters: lists(s.filtering.filters),
                allowlists: lists(s.filtering.whitelist_filters),
                userRules: (s.filtering.user_rules ?? []).filter((r) => r.trim() && !r.startsWith('!') && !r.startsWith('#')).length,
              }
            : null,
          features: { safebrowsing: s.safebrowsing ?? null, parental: s.parental ?? null, safesearch: s.safesearch ?? null },
          counts: {
            clients: s.clients ? (s.clients.clients?.length ?? 0) : null,
            autoClients: s.clients ? (s.clients.auto_clients?.length ?? 0) : null,
            rewrites: s.rewrites?.length ?? null,
            blockedServices: s.blockedServices?.ids?.length ?? null,
          },
        };
      }),
      drift: d.overview.drift,
      sync: d.getOverview().sync,
    };
  });

  app.get<{ Querystring: { name?: string } }>('/api/check-host', async (req, reply) => {
    const name = (req.query.name ?? '').trim().toLowerCase();
    if (!DOMAIN_RE.test(name)) return reply.code(400).send({ error: 'Invalid domain' });
    const origin = poller.server(poller.originId())!;
    const rules = origin.filtering?.user_rules ?? [];
    const results = await Promise.all(
      poller.servers.map(async (s) => {
        try {
          const r = await s.client.checkHost(name);
          const lists = filterListNames(s.filtering);
          return {
            server: s.cfg.id,
            reason: r.reason,
            service: r.service_name ?? null,
            rules: (r.rules ?? []).map((x) => ({ text: x.text, listName: lists.get(x.filter_list_id) ?? null })),
          };
        } catch (err) {
          return { server: s.cfg.id, error: errorMessage(err) };
        }
      }),
    );
    return {
      name,
      results,
      userRule: rules.includes(blockRule(name)) ? 'block' : rules.some((r) => allowRules(name).includes(r)) ? 'allow' : null,
    };
  });

  // ---- Actions -------------------------------------------------------------

  app.post<{ Body: { enabled?: boolean; durationMs?: number } }>('/api/actions/protection', async (req, reply) => {
    const enabled = req.body?.enabled === true;
    const durationMs = Number(req.body?.durationMs) || undefined;
    if (durationMs !== undefined && (durationMs < 1000 || durationMs > 24 * 3600_000)) {
      return reply.code(400).send({ error: 'Invalid duration' });
    }
    const results = await onServers(poller.servers, (s) => s.client.setProtection(enabled, durationMs));
    return finish(reply, { results });
  });

  app.post('/api/actions/cache-clear', async (_req, reply) =>
    finish(reply, { results: await onServers(poller.servers, (s) => s.client.clearCache()) }),
  );

  app.post('/api/actions/filters-refresh', async (_req, reply) =>
    finish(reply, { results: await onServers(poller.servers, (s) => s.client.refreshFilters()) }),
  );

  app.post('/api/actions/sync', async (_req, reply) => {
    try {
      await poller.triggerSync();
      return finish(reply, { ok: true });
    } catch (err) {
      return reply.code(502).send({ error: errorMessage(err) });
    }
  });

  app.post<{ Body: { domain?: string; action?: string } }>('/api/actions/rule', async (req, reply) => {
    const domain = (req.body?.domain ?? '').trim().toLowerCase().replace(/\.$/, '');
    const action = req.body?.action;
    if (!DOMAIN_RE.test(domain) || !['block', 'allow', 'remove'].includes(action ?? '')) {
      return reply.code(400).send({ error: 'Invalid domain or action' });
    }
    const apply = async (s: ServerState) => {
      const current = (await s.client.filteringStatus()).user_rules ?? [];
      const managed = new Set([blockRule(domain), ...allowRules(domain)]);
      const rules = current.filter((r) => !managed.has(r.trim()));
      if (action === 'block') rules.push(blockRule(domain));
      if (action === 'allow') rules.push(allowRules(domain)[0]);
      await s.client.setUserRules(rules);
    };

    // With AdGuard Home Sync, write to the origin only and let sync distribute the change.
    const origin = poller.server(poller.originId())!;
    const targets = poller.sync.configured ? [origin] : poller.servers;
    const results = await onServers(targets, apply);
    let synced = false;
    let syncError: string | undefined;
    if (poller.sync.configured && results[0].ok) {
      try {
        await poller.triggerSync();
        synced = true;
      } catch (err) {
        syncError = errorMessage(err);
      }
    }
    return finish(reply, { results, synced, syncError: syncError ?? null });
  });
}

function blockRule(domain: string) {
  return `||${domain}^`;
}

function allowRules(domain: string) {
  return [`@@||${domain}^$important`, `@@||${domain}^`];
}
