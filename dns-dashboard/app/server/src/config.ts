import { existsSync, readFileSync } from 'node:fs';

export interface ServerConfig {
  id: string;
  name: string;
  url: string;
  username?: string;
  password?: string;
  color: string;
  /** Address used for the port-53 probe; defaults to the URL's host. */
  dnsAddress?: string;
}

export interface SyncConfig {
  url: string;
  username?: string;
  password?: string;
}

export interface AppConfig {
  servers: ServerConfig[];
  sync?: SyncConfig;
  /** 'auto' = take the origin from AdGuard Home Sync, otherwise a server id. */
  origin: string;
  pollInterval: number;
  querylogPollInterval: number;
  historyRawDays: number;
  historyHourlyDays: number;
  dnsProbeDomain: string;
  /** Seconds between port-53 probes. Every probe is a real query and shows up in AdGuard's log. */
  dnsProbeInterval: number;
  dataDir: string;
  port: number;
  /** Inside Home Assistant only the ingress proxy may connect. */
  ingressOnly: boolean;
}

const DEFAULT_COLORS = ['#199e70', '#9085e9', '#e66767', '#c98500'];

/** Shape of /data/options.json written by the Supervisor from config.yaml. */
interface HaOptions {
  servers?: Array<{ name?: string; url?: string; username?: string; password?: string; color?: string; dns_address?: string }>;
  sync_url?: string;
  sync_username?: string;
  sync_password?: string;
  origin?: string;
  poll_interval?: number;
  querylog_poll_interval?: number;
  history_raw_days?: number;
  history_hourly_days?: number;
  dns_probe_domain?: string;
  dns_probe_interval?: number;
}

const blank = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : undefined);

/** Parses a numeric environment variable: unset or empty means "use the default", anything else must be finite. */
function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Invalid number for ${name}: "${raw}"`);
  return value;
}

function fromEnv(): HaOptions {
  const env = process.env;
  const servers: NonNullable<HaOptions['servers']> = [];
  for (const n of [1, 2, 3, 4]) {
    const url = env[`DNS${n}_URL`];
    if (!url) continue;
    servers.push({
      name: env[`DNS${n}_NAME`] ?? `DNS${n}`,
      url,
      username: env[`DNS${n}_USER`],
      password: env[`DNS${n}_PASS`],
      color: env[`DNS${n}_COLOR`],
      dns_address: env[`DNS${n}_DNS_ADDRESS`],
    });
  }
  return {
    servers,
    sync_url: env.SYNC_URL,
    sync_username: env.SYNC_USER,
    sync_password: env.SYNC_PASS,
    origin: env.ORIGIN,
    poll_interval: envNumber('POLL_INTERVAL'),
    querylog_poll_interval: envNumber('QUERYLOG_POLL_INTERVAL'),
    history_raw_days: envNumber('HISTORY_RAW_DAYS'),
    history_hourly_days: envNumber('HISTORY_HOURLY_DAYS'),
    dns_probe_domain: env.DNS_PROBE_DOMAIN,
    dns_probe_interval: envNumber('DNS_PROBE_INTERVAL'),
  };
}

export function loadConfig(): AppConfig {
  const optionsPath = process.env.OPTIONS_PATH ?? '/data/options.json';
  const inHa = existsSync(optionsPath);
  const o: HaOptions = inHa ? JSON.parse(readFileSync(optionsPath, 'utf8')) : fromEnv();

  const servers: ServerConfig[] = (o.servers ?? [])
    .filter((s) => blank(s.url))
    .map((s, i) => ({
      id: `dns${i + 1}`,
      name: blank(s.name) ?? `DNS${i + 1}`,
      url: s.url!.trim().replace(/\/+$/, ''),
      username: blank(s.username),
      password: blank(s.password),
      color: blank(s.color) ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      dnsAddress: blank(s.dns_address),
    }));
  if (servers.length === 0) {
    throw new Error('No AdGuard Home servers configured (options "servers" or DNS1_URL/DNS2_URL).');
  }

  const syncUrl = blank(o.sync_url);
  return {
    servers,
    sync: syncUrl
      ? { url: syncUrl.replace(/\/+$/, ''), username: blank(o.sync_username), password: blank(o.sync_password) }
      : undefined,
    origin: blank(o.origin) ?? 'auto',
    pollInterval: Math.max(3, o.poll_interval ?? 10),
    querylogPollInterval: Math.max(2, o.querylog_poll_interval ?? 5),
    historyRawDays: Math.max(1, o.history_raw_days ?? 7),
    historyHourlyDays: Math.max(7, o.history_hourly_days ?? 365),
    dnsProbeDomain: blank(o.dns_probe_domain) ?? 'example.com',
    dnsProbeInterval: Math.max(10, o.dns_probe_interval ?? 60),
    dataDir: process.env.DATA_DIR ?? (inHa ? '/data' : './.data'),
    port: envNumber('PORT') ?? 8099,
    ingressOnly: inHa && process.env.INGRESS_ONLY !== 'false',
  };
}
