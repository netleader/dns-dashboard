// Response types come straight from the server code (type-only imports, erased at build time).
import type { Alert } from '../../../server/src/alerts.ts';
import type { StatsQueries } from '../../../server/src/db/queries.ts';
import type { DriftArea, DriftReport } from '../../../server/src/drift.ts';
import type { Overview } from '../../../server/src/overview.ts';
import type { LogEntry } from '../../../server/src/querylog.ts';

export type { Alert, DriftArea, DriftReport, LogEntry, Overview };
export type StatsBundle = ReturnType<StatsQueries['bundle']> & { range: RangeKey };
export type ServerSummary = Overview['servers'][number];
export type TopEntry = StatsBundle['topDomains'][number];
export type KeyCount = StatsBundle['reasons'][number];

export type RangeKey = '24h' | '7d' | '30d' | '90d' | '365d';

export interface QueryLogPage {
  entries: LogEntry[];
  next: string | null;
  errors: Array<{ server: string; error: string }>;
}

export interface FilterList {
  name: string;
  url: string;
  enabled: boolean;
  rules: number;
  lastUpdated: string | null;
  stale: boolean;
}

export interface ServerDetail extends ServerSummary {
  configAt: number | null;
  dnsInfo: {
    upstream_dns: string[];
    bootstrap_dns?: string[];
    upstream_mode?: string;
    blocking_mode?: string;
    ratelimit?: number;
    cache_enabled?: boolean;
    cache_size?: number;
    cache_optimistic?: boolean;
    dnssec_enabled?: boolean;
  } | null;
  filtering: {
    enabled: boolean;
    interval: number;
    filters: FilterList[];
    allowlists: FilterList[];
    userRules: number;
  } | null;
  features: { safebrowsing: boolean | null; parental: boolean | null; safesearch: boolean | null };
  counts: { clients: number | null; autoClients: number | null; rewrites: number | null; blockedServices: number | null };
}

export interface ServersResponse {
  servers: ServerDetail[];
  drift: DriftReport;
  sync: Overview['sync'];
}

export interface ClientRow {
  key: string;
  name?: string;
  source: string;
  ids: string[];
  tags: string[];
  count: number;
  blocked: number;
  perServer: Record<string, number>;
  lastSeen: number | null;
}

export interface ClientDetail {
  unit: 'hour' | 'day';
  t: number[];
  queries: number[];
  blocked: number[];
  topDomains: Array<{ key: string; count: number; blocked: number }>;
  topBlocked: Array<{ key: string; count: number; blocked: number }>;
  servers: Array<{ key: string; count: number; blocked: number }>;
  qtypes: Array<{ key: string; count: number; blocked: number }>;
  rawFrom: number | null;
}

export interface CheckHost {
  name: string;
  userRule: 'block' | 'allow' | null;
  results: Array<{
    server: string;
    reason?: string;
    service?: string | null;
    rules?: Array<{ text: string; listName: string | null }>;
    error?: string;
  }>;
}

export interface ActionResult {
  results?: Array<{ server: string; name: string; ok: boolean; error?: string }>;
  synced?: boolean;
  syncError?: string | null;
  ok?: boolean;
  error?: string;
}

export class ApiError extends Error {}

/** All URLs are relative so they resolve below the ingress path. */
export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  if (!res.ok) throw new ApiError((await res.text()) || res.statusText);
  return res.json() as Promise<T>;
}

export async function postJson<T = ActionResult>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? res.statusText);
  return data;
}
