import type { ServerConfig } from '../config.ts';
import { HttpError, basicAuth, request } from '../http.ts';
import type {
  AgAccessList,
  AgBlockedServices,
  AgCheckHost,
  AgClients,
  AgDnsInfo,
  AgFilterStatus,
  AgQueryLog,
  AgRewrite,
  AgStats,
  AgStatus,
  AgVersionInfo,
} from './types.ts';

export interface QueryLogParams {
  limit?: number;
  olderThan?: string;
  search?: string;
  responseStatus?: string;
}

const DAY_MS = 24 * 3600 * 1000;

export class AdGuardClient {
  private readonly base: string;
  private readonly auth: Record<string, string>;
  /** Older AdGuard versions reject /stats?recent=… */
  private supportsRecent = true;
  private supportsBlockedServicesGet = true;

  readonly cfg: ServerConfig;

  constructor(cfg: ServerConfig) {
    this.cfg = cfg;
    this.base = `${cfg.url}/control`;
    this.auth = basicAuth(cfg.username, cfg.password);
  }

  private call<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}) {
    return request<T>(`${this.base}${path}`, { ...init, headers: this.auth });
  }

  status() {
    return this.call<AgStatus>('/status');
  }

  /** Statistics for the last 24 hours (hourly buckets) when supported. */
  async stats(): Promise<AgStats> {
    if (this.supportsRecent) {
      try {
        return await this.call<AgStats>(`/stats?recent=${DAY_MS}`);
      } catch (err) {
        if (!(err instanceof HttpError && err.status === 400)) throw err;
        this.supportsRecent = false;
      }
    }
    return this.call<AgStats>('/stats');
  }

  querylog(p: QueryLogParams = {}) {
    const q = new URLSearchParams();
    q.set('limit', String(p.limit ?? 100));
    if (p.olderThan) q.set('older_than', p.olderThan);
    if (p.search) q.set('search', p.search);
    if (p.responseStatus && p.responseStatus !== 'all') q.set('response_status', p.responseStatus);
    return this.call<AgQueryLog>(`/querylog?${q}`, { timeoutMs: 15000 });
  }

  filteringStatus() {
    return this.call<AgFilterStatus>('/filtering/status');
  }

  clients() {
    return this.call<AgClients>('/clients');
  }

  dnsInfo() {
    return this.call<AgDnsInfo>('/dns_info');
  }

  version(recheck = false) {
    return this.call<AgVersionInfo>('/version.json', { method: 'POST', body: { recheck_now: recheck }, timeoutMs: 20000 });
  }

  safebrowsing() {
    return this.call<{ enabled: boolean }>('/safebrowsing/status');
  }

  parental() {
    return this.call<{ enabled: boolean }>('/parental/status');
  }

  safesearch() {
    return this.call<{ enabled: boolean } & Record<string, boolean>>('/safesearch/status');
  }

  rewrites() {
    return this.call<AgRewrite[] | null>('/rewrite/list');
  }

  async blockedServices(): Promise<AgBlockedServices> {
    if (this.supportsBlockedServicesGet) {
      try {
        return await this.call<AgBlockedServices>('/blocked_services/get');
      } catch (err) {
        if (!(err instanceof HttpError && (err.status === 404 || err.status === 405))) throw err;
        this.supportsBlockedServicesGet = false;
      }
    }
    return { ids: (await this.call<string[] | null>('/blocked_services/list')) ?? [] };
  }

  accessList() {
    return this.call<AgAccessList>('/access/list');
  }

  checkHost(name: string) {
    return this.call<AgCheckHost>(`/filtering/check_host?name=${encodeURIComponent(name)}`);
  }

  setProtection(enabled: boolean, durationMs?: number) {
    return this.call<string>('/protection', {
      method: 'POST',
      body: enabled || !durationMs ? { enabled } : { enabled, duration: durationMs },
    });
  }

  clearCache() {
    return this.call<string>('/cache_clear', { method: 'POST' });
  }

  async refreshFilters() {
    await this.call<unknown>('/filtering/refresh', { method: 'POST', body: { whitelist: false }, timeoutMs: 60000 });
    await this.call<unknown>('/filtering/refresh', { method: 'POST', body: { whitelist: true }, timeoutMs: 60000 });
  }

  setUserRules(rules: string[]) {
    return this.call<string>('/filtering/set_rules', { method: 'POST', body: { rules } });
  }
}
