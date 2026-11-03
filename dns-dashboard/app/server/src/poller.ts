import { EventEmitter } from 'node:events';
import { AdGuardClient } from './adguard/client.ts';
import type {
  AgAccessList,
  AgBlockedServices,
  AgClients,
  AgDnsInfo,
  AgFilterStatus,
  AgRewrite,
  AgStats,
  AgStatus,
  AgVersionInfo,
} from './adguard/types.ts';
import type { AppConfig, ServerConfig } from './config.ts';
import { errorMessage } from './http.ts';
import { type DnsProbeResult, probeDns } from './probe/dns.ts';
import { SyncClient, type SyncStatus } from './sync/client.ts';

export interface ServerState {
  cfg: ServerConfig;
  client: AdGuardClient;
  online: boolean;
  error?: string;
  lastOk?: number;
  status?: AgStatus;
  stats?: AgStats;
  dns?: DnsProbeResult;
  /** Recent successful probe times; the shown latency is their median so one cache miss doesn't spike it. */
  dnsSamples: number[];
  // Slow-changing configuration, refreshed every minute.
  dnsInfo?: AgDnsInfo;
  filtering?: AgFilterStatus;
  clients?: AgClients;
  safebrowsing?: boolean;
  parental?: boolean;
  safesearch?: boolean;
  rewrites?: AgRewrite[];
  blockedServices?: AgBlockedServices;
  access?: AgAccessList;
  configAt?: number;
  version?: AgVersionInfo;
}

export interface SyncState {
  configured: boolean;
  reachable: boolean;
  error?: string;
  status?: SyncStatus;
  checkedAt?: number;
  lastSyncAt?: number;
  lastCount?: number;
}

export interface MetaStore {
  getMeta(key: string): string | undefined;
  setMeta(key: string, value: string): void;
}

const CONFIG_INTERVAL_MS = 60_000;
const VERSION_INTERVAL_MS = 6 * 3600_000;
const DNS_SAMPLES = 5;

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round(((v[mid - 1] + v[mid]) / 2) * 10) / 10;
}

export class Poller extends EventEmitter<{ update: []; stats: [serverId: string, stats: AgStats] }> {
  readonly servers: ServerState[];
  readonly sync: SyncState;
  private readonly syncClient?: SyncClient;
  private timers: NodeJS.Timeout[] = [];
  readonly config: AppConfig;
  private readonly meta?: MetaStore;

  constructor(config: AppConfig, meta?: MetaStore) {
    super();
    this.config = config;
    this.meta = meta;
    this.servers = config.servers.map((cfg) => ({ cfg, client: new AdGuardClient(cfg), online: false, dnsSamples: [] }));
    this.syncClient = config.sync ? new SyncClient(config.sync) : undefined;
    const lastSync = meta?.getMeta('sync_last_at');
    this.sync = { configured: !!config.sync, reachable: false, lastSyncAt: lastSync ? Number(lastSync) : undefined };
  }

  server(id: string) {
    return this.servers.find((s) => s.cfg.id === id);
  }

  start() {
    this.loop(() => this.pollFast(), this.config.pollInterval * 1000);
    this.loop(async () => {
      await this.pollConfig();
      this.emit('update');
    }, CONFIG_INTERVAL_MS);
    this.loop(() => this.pollVersions(), VERSION_INTERVAL_MS);
    this.loop(() => this.probeAll(), this.config.dnsProbeInterval * 1000);
  }

  stop() {
    this.timers.forEach(clearTimeout);
  }

  /** Re-runs fn every intervalMs without ever overlapping itself. */
  private loop(fn: () => Promise<void>, intervalMs: number) {
    const run = async () => {
      try {
        await fn();
      } catch (err) {
        console.error('poll failed:', errorMessage(err));
      }
      this.timers.push(setTimeout(run, intervalMs));
    };
    void run();
  }

  async pollFast() {
    await Promise.all([...this.servers.map((s) => this.pollServer(s)), this.pollSync()]);
    this.emit('update');
  }

  /** Refreshes everything right away, e.g. after an action. */
  async refreshNow() {
    await Promise.all([this.pollConfig(), this.pollFast()]);
  }

  private async probeAll() {
    await Promise.all(
      this.servers.map(async (s) => {
        const dns = await probeDns(s.cfg.dnsAddress ?? new URL(s.cfg.url).hostname, this.config.dnsProbeDomain);
        if (dns.ok && dns.ms !== undefined) {
          s.dnsSamples = [...s.dnsSamples.slice(-(DNS_SAMPLES - 1)), dns.ms];
          s.dns = { ...dns, ms: median(s.dnsSamples) };
        } else {
          s.dns = dns;
        }
      }),
    );
    this.emit('update');
  }

  private async pollServer(s: ServerState) {
    const api = await Promise.all([s.client.status(), s.client.stats()]).then(
      (v) => ({ ok: true as const, v }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    if (api.ok) {
      [s.status, s.stats] = api.v;
      s.online = true;
      s.error = undefined;
      s.lastOk = Date.now();
      this.emit('stats', s.cfg.id, s.stats);
    } else {
      s.online = false;
      s.error = errorMessage(api.err);
    }
  }

  async pollConfig() {
    await Promise.all(
      this.servers.map(async (s) => {
        const c = s.client;
        const r = await Promise.allSettled([
          c.dnsInfo(),
          c.filteringStatus(),
          c.clients(),
          c.safebrowsing(),
          c.parental(),
          c.safesearch(),
          c.rewrites(),
          c.blockedServices(),
          c.accessList(),
        ]);
        const val = <T>(p: PromiseSettledResult<T>) => (p.status === 'fulfilled' ? p.value : undefined);
        s.dnsInfo = val(r[0]) ?? s.dnsInfo;
        s.filtering = val(r[1]) ?? s.filtering;
        s.clients = val(r[2]) ?? s.clients;
        s.safebrowsing = val(r[3])?.enabled ?? s.safebrowsing;
        s.parental = val(r[4])?.enabled ?? s.parental;
        s.safesearch = val(r[5])?.enabled ?? s.safesearch;
        s.rewrites = val(r[6]) ?? s.rewrites ?? undefined;
        s.blockedServices = val(r[7]) ?? s.blockedServices;
        s.access = val(r[8]) ?? s.access;
        if (r.some((x) => x.status === 'fulfilled')) s.configAt = Date.now();
      }),
    );
  }

  private async pollVersions() {
    await Promise.all(
      this.servers.map(async (s) => {
        try {
          s.version = await s.client.version();
        } catch {
          // Update checks can be disabled or offline; not worth an alert.
        }
      }),
    );
  }

  private async pollSync() {
    if (!this.syncClient) return;
    try {
      const wasRunning = this.sync.status?.syncRunning;
      const [status, count] = await Promise.all([this.syncClient.status(), this.syncClient.syncCount()]);
      this.sync.status = status;
      this.sync.reachable = true;
      this.sync.error = undefined;
      // The sync API has no "last sync" timestamp; infer it from the counter or the running flag.
      const finished = wasRunning && !status.syncRunning;
      const counted = count !== undefined && this.sync.lastCount !== undefined && count > this.sync.lastCount;
      if (finished || counted) this.markSynced();
      if (count !== undefined) this.sync.lastCount = count;
    } catch (err) {
      this.sync.reachable = false;
      this.sync.error = errorMessage(err);
    }
    this.sync.checkedAt = Date.now();
  }

  markSynced() {
    this.sync.lastSyncAt = Date.now();
    this.meta?.setMeta('sync_last_at', String(this.sync.lastSyncAt));
  }

  async triggerSync() {
    if (!this.syncClient) throw new Error('AdGuard Home Sync is not configured');
    await this.syncClient.triggerSync();
    this.markSynced();
    // The sync runs asynchronously; look at the replicas again once it had time to finish.
    for (const delay of [5_000, 20_000]) {
      this.timers.push(setTimeout(() => void this.pollConfig().then(() => this.emit('update')).catch(() => undefined), delay));
    }
  }

  /** Maps a URL reported by AdGuard Home Sync to one of our servers. */
  serverIdFor(url: string | undefined): string | undefined {
    if (!url) return undefined;
    const resolved = this.config.sync ? resolveLoopback(url, this.config.sync.url) : url;
    return this.servers.find((s) => sameEndpoint(s.cfg.url, resolved))?.cfg.id;
  }

  /** The server that holds the source-of-truth config (writes go here). */
  originId(): string {
    if (this.config.origin !== 'auto' && this.server(this.config.origin)) return this.config.origin;
    // Sync running next to the origin often addresses it as localhost; serverIdFor maps that to the sync host.
    const fromSync = this.serverIdFor(this.sync.status?.origin?.url);
    if (fromSync) return fromSync;
    return this.servers[0].cfg.id;
  }
}

export function resolveLoopback(url: string, syncUrl: string): string {
  try {
    const u = new URL(url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return url;
    u.hostname = new URL(syncUrl).hostname;
    return u.toString();
  } catch {
    return url;
  }
}

export function sameEndpoint(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    const port = (u: URL) => u.port || (u.protocol === 'https:' ? '443' : '80');
    return ua.hostname === ub.hostname && port(ua) === port(ub);
  } catch {
    return false;
  }
}
