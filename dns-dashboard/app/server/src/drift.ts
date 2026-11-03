import type { ServerState } from './poller.ts';

export type DriftStatus = 'equal' | 'differs' | 'unknown';

export interface DriftArea {
  key: string;
  label: string;
  status: DriftStatus;
  /** Entries that are missing on at least one server, listed under the servers that have them. */
  onlyIn: Record<string, string[]>;
  /** Entries present everywhere but with different settings. */
  changed: string[];
}

export interface DriftReport {
  checkedAt: number;
  differences: number;
  areas: DriftArea[];
}

/** Each area maps a display key to a canonical value; equal keys with different values count as "changed". */
type Extractor = (s: ServerState) => Map<string, string> | undefined;

const set = (items: Iterable<string> | undefined | null) =>
  items ? new Map([...items].filter(Boolean).map((i) => [i, i] as [string, string])) : undefined;

const canon = (v: unknown) => JSON.stringify(v, (_k, val) => (Array.isArray(val) ? [...val].sort() : val));

const AREAS: Array<{ key: string; label: string; extract: Extractor }> = [
  {
    key: 'filters',
    label: 'Blocklisten',
    extract: (s) =>
      s.filtering ? new Map((s.filtering.filters ?? []).map((f) => [f.url, f.enabled ? 'an' : 'aus'])) : undefined,
  },
  {
    key: 'allowlists',
    label: 'Allowlisten',
    extract: (s) =>
      s.filtering
        ? new Map((s.filtering.whitelist_filters ?? []).map((f) => [f.url, f.enabled ? 'an' : 'aus']))
        : undefined,
  },
  {
    key: 'user_rules',
    label: 'Eigene Regeln',
    extract: (s) => (s.filtering ? set((s.filtering.user_rules ?? []).map((r) => r.trim())) : undefined),
  },
  {
    key: 'rewrites',
    label: 'DNS-Umschreibungen',
    extract: (s) =>
      s.rewrites !== undefined
        ? new Map((s.rewrites ?? []).map((r) => [`${r.domain} → ${r.answer}`, String(r.enabled ?? true)]))
        : undefined,
  },
  {
    key: 'clients',
    label: 'Clients',
    extract: (s) =>
      s.clients
        ? new Map(
            (s.clients.clients ?? []).map((c) => {
              const { name, ...settings } = c;
              return [name, canon(settings)];
            }),
          )
        : undefined,
  },
  {
    key: 'blocked_services',
    label: 'Blockierte Dienste',
    extract: (s) => (s.blockedServices ? set(s.blockedServices.ids ?? []) : undefined),
  },
  {
    key: 'access',
    label: 'Zugriffslisten',
    extract: (s) =>
      s.access
        ? set([
            ...(s.access.allowed_clients ?? []).map((v) => `erlaubt: ${v}`),
            ...(s.access.disallowed_clients ?? []).map((v) => `gesperrt: ${v}`),
            ...(s.access.blocked_hosts ?? []).map((v) => `Host gesperrt: ${v}`),
          ])
        : undefined,
  },
  {
    key: 'dns',
    label: 'DNS-Einstellungen',
    extract: (s) => {
      const d = s.dnsInfo;
      if (!d) return undefined;
      return new Map<string, string>([
        ...(d.upstream_dns ?? []).map((u) => [`Upstream ${u}`, 'ja'] as [string, string]),
        ['Upstream-Modus', String(d.upstream_mode ?? '')],
        ['Bootstrap-DNS', canon(d.bootstrap_dns ?? [])],
        ['Blocking-Modus', String(d.blocking_mode ?? '')],
        ['Cache', `${d.cache_enabled ?? ''}/${d.cache_size ?? ''}/${d.cache_optimistic ?? ''}`],
        ['DNSSEC', String(d.dnssec_enabled ?? '')],
        ['Ratelimit', String(d.ratelimit ?? '')],
      ]);
    },
  },
  {
    key: 'protection',
    label: 'Schutzfunktionen',
    extract: (s) => {
      if (s.safebrowsing === undefined && !s.filtering) return undefined;
      return new Map([
        ['Filterung', String(s.filtering?.enabled)],
        ['Filter-Update-Intervall', String(s.filtering?.interval)],
        ['Safe Browsing', String(s.safebrowsing)],
        ['Kinderschutz', String(s.parental)],
        ['SafeSearch', String(s.safesearch)],
      ]);
    },
  },
  {
    key: 'version',
    label: 'Version',
    extract: (s) => (s.status ? new Map([['AdGuard Home', s.status.version]]) : undefined),
  },
];

export function computeDrift(servers: ServerState[], now = Date.now()): DriftReport {
  const areas = AREAS.map(({ key, label, extract }) => {
    const maps = servers.map((s) => ({ id: s.cfg.id, map: extract(s) }));
    const area: DriftArea = { key, label, status: 'unknown', onlyIn: {}, changed: [] };
    if (servers.length < 2 || maps.some((m) => !m.map)) return area;

    const allKeys = new Set(maps.flatMap((m) => [...m.map!.keys()]));
    for (const k of allKeys) {
      const holders = maps.filter((m) => m.map!.has(k));
      if (holders.length < maps.length) {
        for (const h of holders) (area.onlyIn[h.id] ??= []).push(k);
      } else if (new Set(holders.map((h) => h.map!.get(k))).size > 1) {
        area.changed.push(k);
      }
    }
    const diff = Object.keys(area.onlyIn).length > 0 || area.changed.length > 0;
    area.status = diff ? 'differs' : 'equal';
    return area;
  });
  return { checkedAt: now, differences: areas.filter((a) => a.status === 'differs').length, areas };
}
