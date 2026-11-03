import type { DriftReport } from './drift.ts';
import type { ServerState, SyncState } from './poller.ts';

export type AlertLevel = 'critical' | 'warning' | 'info';

export interface Alert {
  id: string;
  level: AlertLevel;
  title: string;
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
    const { id, name } = s.cfg;
    if (!s.online) {
      alerts.push({ id: `${id}-api`, level: 'critical', server: id, title: `${name}: Web-API nicht erreichbar`, detail: s.error });
    }
    if (s.dns && !s.dns.ok) {
      alerts.push({ id: `${id}-dns`, level: 'critical', server: id, title: `${name}: DNS antwortet nicht`, detail: s.dns.error });
    } else if (s.dns?.ms !== undefined && s.dns.ms > SLOW_DNS_MS) {
      alerts.push({ id: `${id}-dns-slow`, level: 'warning', server: id, title: `${name}: DNS-Antwort langsam (${s.dns.ms} ms)` });
    }
    if (s.status && !s.status.protection_enabled) {
      const left = s.status.protection_disabled_duration ?? 0;
      alerts.push(
        left > 0
          ? {
              id: `${id}-paused`,
              level: 'info',
              server: id,
              title: `${name}: Schutz pausiert`,
              detail: `bis ${new Date(now + left).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`,
            }
          : { id: `${id}-protection`, level: 'warning', server: id, title: `${name}: Schutz ist deaktiviert` },
      );
    }
    if (s.status && !s.status.running) {
      alerts.push({ id: `${id}-running`, level: 'critical', server: id, title: `${name}: DNS-Server läuft nicht` });
    }
    const avgMs = (s.stats?.avg_processing_time ?? 0) * 1000;
    if (avgMs > SLOW_PROCESSING_MS) {
      alerts.push({
        id: `${id}-processing`,
        level: 'warning',
        server: id,
        title: `${name}: hohe Verarbeitungszeit (Ø ${Math.round(avgMs)} ms)`,
      });
    }
    if (updateAvailable(s)) {
      alerts.push({ id: `${id}-update`, level: 'info', server: id, title: `${name}: Update auf ${s.version!.new_version} verfügbar` });
    }
    const interval = s.filtering?.interval ?? 0;
    const stale = [...(s.filtering?.filters ?? []), ...(s.filtering?.whitelist_filters ?? [])].filter(
      (f) => f.enabled && isStale(f.last_updated, interval, now),
    );
    if (stale.length) {
      alerts.push({
        id: `${id}-stale`,
        level: 'warning',
        server: id,
        title: `${name}: ${stale.length} Filterliste(n) veraltet`,
        detail: stale.map((f) => f.name).join(', '),
      });
    }
  }

  if (sync.configured) {
    if (!sync.reachable) {
      alerts.push({ id: 'sync-down', level: 'warning', title: 'AdGuard Home Sync nicht erreichbar', detail: sync.error });
    } else {
      const instances = [sync.status?.origin, ...(sync.status?.replicas ?? [])].filter((i) => i !== undefined);
      for (const inst of instances) {
        if (inst.error || inst.status === 'danger' || inst.status === 'error') {
          alerts.push({
            id: `sync-${inst.url ?? inst.host}`,
            level: 'warning',
            title: `Sync-Fehler bei ${inst.host ?? inst.url}`,
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
      title: onlyVersion ? 'Unterschiedliche AdGuard-Versionen' : 'Konfiguration der Server weicht ab',
      detail: differing.map((a) => a.label).join(', '),
    });
  }

  const order: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.level] - order[b.level]);
}
