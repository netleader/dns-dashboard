import type { DriftReport } from './drift.ts';
import type { ServerState, SyncState } from './poller.ts';

export type AlertLevel = 'critical' | 'warning' | 'info';

/** Alerts carry a code + params; the frontend turns them into text in the viewer's language. */
export type AlertCode =
  | 'api_down'
  | 'dns_down'
  | 'dns_slow'
  | 'paused'
  | 'protection_off'
  | 'not_running'
  | 'slow_processing'
  | 'update'
  | 'stale_lists'
  | 'sync_down'
  | 'sync_error'
  | 'drift'
  | 'version_mismatch';

export interface Alert {
  id: string;
  level: AlertLevel;
  code: AlertCode;
  params?: Record<string, string | number>;
  /** Raw technical detail (error message, list names) shown as-is. */
  detail?: string;
  server?: string;
}

const SLOW_DNS_MS = 150;
const SLOW_PROCESSING_MS = 100;

/** A filter list is stale when it missed two update intervals (at least one day). */
export function isStale(lastUpdated: string | undefined, intervalHours: number, now = Date.now()): boolean {
  if (!lastUpdated || intervalHours <= 0) return false;
  const age = now - Date.parse(lastUpdated);
  return age > Math.max(2 * intervalHours, 24) * 3600_000;
}

/** AdGuard reports new_version even when it equals the running one. */
export function updateAvailable(s: ServerState): string | null {
  const v = s.version;
  if (!v || v.disabled || !v.new_version) return null;
  return v.new_version !== s.status?.version ? v.new_version : null;
}

export function computeAlerts(servers: ServerState[], sync: SyncState, drift: DriftReport, now = Date.now()): Alert[] {
  const alerts: Alert[] = [];
  for (const s of servers) {
    const id = s.cfg.id;
    const add = (a: Omit<Alert, 'id' | 'server'>, suffix: string) => alerts.push({ id: `${id}-${suffix}`, server: id, ...a });
    if (!s.online) add({ level: 'critical', code: 'api_down', detail: s.error }, 'api');
    if (s.dns && !s.dns.ok) {
      add({ level: 'critical', code: 'dns_down', detail: s.dns.error }, 'dns');
    } else if (s.dns?.ms !== undefined && s.dns.ms > SLOW_DNS_MS) {
      add({ level: 'warning', code: 'dns_slow', params: { ms: s.dns.ms } }, 'dns-slow');
    }
    if (s.status && !s.status.protection_enabled) {
      const left = s.status.protection_disabled_duration ?? 0;
      if (left > 0) add({ level: 'info', code: 'paused', params: { until: now + left } }, 'paused');
      else add({ level: 'warning', code: 'protection_off' }, 'protection');
    }
    if (s.status && !s.status.running) add({ level: 'critical', code: 'not_running' }, 'running');
    const avgMs = (s.stats?.avg_processing_time ?? 0) * 1000;
    if (avgMs > SLOW_PROCESSING_MS) add({ level: 'warning', code: 'slow_processing', params: { ms: Math.round(avgMs) } }, 'processing');
    const newVersion = updateAvailable(s);
    if (newVersion) add({ level: 'info', code: 'update', params: { version: newVersion } }, 'update');
    const interval = s.filtering?.interval ?? 0;
    const stale = [...(s.filtering?.filters ?? []), ...(s.filtering?.whitelist_filters ?? [])].filter(
      (f) => f.enabled && isStale(f.last_updated, interval, now),
    );
    if (stale.length) {
      add({ level: 'warning', code: 'stale_lists', params: { count: stale.length }, detail: stale.map((f) => f.name).join(', ') }, 'stale');
    }
  }

  if (sync.configured) {
    if (!sync.reachable) {
      alerts.push({ id: 'sync-down', level: 'warning', code: 'sync_down', detail: sync.error });
    } else {
      const instances = [sync.status?.origin, ...(sync.status?.replicas ?? [])].filter((i) => i !== undefined);
      for (const inst of instances) {
        if (inst.error || inst.status === 'danger' || inst.status === 'error') {
          alerts.push({
            id: `sync-${inst.url ?? inst.host}`,
            level: 'warning',
            code: 'sync_error',
            params: { host: inst.host ?? inst.url ?? '' },
            detail: inst.error,
          });
        }
      }
    }
  }

  const differing = drift.areas.filter((a) => a.status === 'differs');
  if (differing.length) {
    const onlyVersion = differing.length === 1 && differing[0].key === 'version';
    alerts.push({
      id: 'drift',
      level: onlyVersion ? 'info' : 'warning',
      code: onlyVersion ? 'version_mismatch' : 'drift',
      params: { areas: differing.map((a) => a.key).join(',') },
    });
  }

  const order: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.level] - order[b.level]);
}
