import type { SyncConfig } from '../config.ts';
import { basicAuth, request } from '../http.ts';

/** One instance as reported by adguardhome-sync's /api/v1/status. */
export interface SyncInstanceStatus {
  host?: string;
  url?: string;
  status?: string;
  error?: string;
  protection_enabled?: boolean;
}

export interface SyncStatus {
  origin?: SyncInstanceStatus;
  replicas?: SyncInstanceStatus[];
  syncRunning?: boolean;
}

export class SyncClient {
  private readonly auth: Record<string, string>;

  readonly cfg: SyncConfig;

  constructor(cfg: SyncConfig) {
    this.cfg = cfg;
    this.auth = basicAuth(cfg.username, cfg.password);
  }

  status() {
    return request<SyncStatus>(`${this.cfg.url}/api/v1/status`, { headers: this.auth });
  }

  triggerSync() {
    return request<unknown>(`${this.cfg.url}/api/v1/sync`, { method: 'POST', headers: this.auth, timeoutMs: 60000 });
  }

  /** Total sync count from the Prometheus endpoint; undefined when metrics are disabled. */
  async syncCount(): Promise<number | undefined> {
    try {
      const text = await request<string>(`${this.cfg.url}/metrics`, { headers: this.auth, timeoutMs: 5000 });
      return parseSyncCount(text);
    } catch {
      return undefined;
    }
  }
}

export function parseSyncCount(metrics: string): number | undefined {
  let total: number | undefined;
  for (const line of metrics.split('\n')) {
    if (!line.startsWith('adguard_home_sync_sync_count_total')) continue;
    const value = Number(line.trim().split(/\s+/).at(-1));
    if (Number.isFinite(value)) total = (total ?? 0) + value;
  }
  return total;
}
