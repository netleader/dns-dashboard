import type { AgFilterStatus, AgQueryLogItem } from './adguard/types.ts';

/** Reasons that mean the answer was blocked (SafeSearch rewrites the answer instead). */
export const BLOCKED_REASONS = new Set([
  'FilteredBlackList',
  'FilteredBlockedService',
  'FilteredSafeBrowsing',
  'FilteredParental',
  'FilteredInvalid',
]);

export interface LogEntry {
  server: string;
  time: string;
  ts: number;
  tsUs: number;
  client: string;
  clientName?: string;
  domain: string;
  qtype: string;
  reason: string;
  blocked: boolean;
  rcode: string;
  cached: boolean;
  upstream: string;
  elapsedMs: number;
  proto: string;
  rules: Array<{ text: string; listId: number; listName?: string }>;
  answers: string[];
  service?: string;
  dnssec: boolean;
}

/** AdGuard timestamps carry nanoseconds ("…:01.123456789+01:00"); keep microseconds for de-duplication. */
export function parseTimeUs(time: string): number {
  const m = time.match(/^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$/);
  if (!m) return Date.parse(time) * 1000;
  const base = Date.parse(m[1] + m[3]);
  const micros = Number((m[2] ?? '').padEnd(6, '0').slice(0, 6));
  return base * 1000 + micros;
}

/**
 * AdGuard's built-in pseudo list ids (internal/filtering/filtering.go).
 * Names starting with "@" are translated by the frontend.
 */
const SPECIAL_LISTS: Array<[number, string]> = [
  [0, '@custom'],
  [-1, '@hosts'],
  [-2, '@blocked_services'],
  [-3, '@parental'],
  [-4, '@safebrowsing'],
  [-5, '@safesearch'],
];

export function filterListNames(f: AgFilterStatus | undefined): Map<number, string> {
  const names = new Map<number, string>(SPECIAL_LISTS);
  for (const l of [...(f?.filters ?? []), ...(f?.whitelist_filters ?? [])]) names.set(l.id, l.name || l.url);
  return names;
}

export function normalizeItem(server: string, item: AgQueryLogItem, listNames?: Map<number, string>): LogEntry {
  const tsUs = parseTimeUs(item.time);
  return {
    server,
    time: item.time,
    ts: Math.floor(tsUs / 1000),
    tsUs,
    client: item.client_id || item.client,
    clientName: item.client_info?.name || undefined,
    domain: item.question.unicode_name || item.question.name,
    qtype: item.question.type,
    reason: item.reason,
    blocked: BLOCKED_REASONS.has(item.reason),
    rcode: item.status ?? '',
    cached: !!item.cached,
    upstream: item.upstream ?? '',
    elapsedMs: Number(item.elapsedMs ?? 0),
    proto: item.client_proto || 'dns',
    rules: (item.rules ?? []).map((r) => ({
      text: r.text,
      listId: r.filter_list_id,
      listName: listNames?.get(r.filter_list_id),
    })),
    answers: (item.answer ?? []).map((a) => `${a.type} ${a.value}`),
    service: item.service_name || undefined,
    dnssec: !!item.answer_dnssec,
  };
}
