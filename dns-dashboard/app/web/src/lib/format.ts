import { locale, t, tMaybe } from './i18n';

const nf = new Intl.NumberFormat(locale);
const nf1 = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

export function fmtNum(v: number | null | undefined): string {
  return v === null || v === undefined ? '–' : nf.format(v);
}

/** 1,284 · 12.9K · 4.2M (de: 1.284 · 12,9 Tsd. · 4,2 Mio.) */
export function fmtCompact(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–';
  const a = Math.abs(v);
  if (a >= 1e6) return `${nf1.format(v / 1e6)}${t('unit.million')}`;
  if (a >= 1e4) return `${nf1.format(v / 1e3)}${t('unit.thousand')}`;
  return nf.format(Math.round(v));
}

/** Axis ticks: 0 · 2K · 1.5M */
export function fmtAxis(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${nf1.format(v / 1e6)}M`;
  if (a >= 1e3) return `${nf1.format(v / 1e3)}K`;
  return nf.format(v);
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return '–';
  const n = v.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  return locale.startsWith('de') ? `${n} %` : `${n}%`;
}

export function fmtMs(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–';
  if (v < 1) return `${v.toLocaleString(locale, { maximumFractionDigits: 2 })} ms`;
  if (v < 10) return `${v.toLocaleString(locale, { maximumFractionDigits: 1 })} ms`;
  return `${Math.round(v).toLocaleString(locale)} ms`;
}

export function fmtTime(ts: number, withSeconds = false): string {
  return new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: withSeconds ? '2-digit' : undefined });
}

export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fmtFull(ts: number): string {
  return new Date(ts).toLocaleString(locale);
}

export function fmtBucket(ts: number, unit: 'hour' | 'day' | 'hours' | 'days'): string {
  const d = new Date(ts);
  return unit.startsWith('hour')
    ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
}

export function fmtBucketLong(ts: number, unit: 'hour' | 'day' | 'hours' | 'days'): string {
  const d = new Date(ts);
  return unit.startsWith('hour')
    ? `${d.toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: '2-digit' })}, ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}${t('time.oClock')}`
    : d.toLocaleDateString(locale, { weekday: 'long', day: '2-digit', month: 'long' });
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return t('time.days', { n: Math.floor(h / 24) });
}

export function fmtAgo(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return t('common.never');
  const s = Math.round((now - ts) / 1000);
  if (s < 10) return t('time.justNow');
  if (s < 60) return t('time.secondsAgo', { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t('time.minutesAgo', { n: m });
  const h = Math.round(m / 60);
  if (h < 48) return t('time.hoursAgo', { n: h });
  return t('time.daysAgo', { n: Math.round(h / 24) });
}

/** Tone of AdGuard filtering reasons. */
export const REASONS: Record<string, { tone: 'allowed' | 'blocked' | 'neutral' | 'warn' }> = {
  NotFilteredNotFound: { tone: 'allowed' },
  NotFilteredAllowList: { tone: 'allowed' },
  NotFilteredWhiteList: { tone: 'allowed' },
  NotFilteredError: { tone: 'warn' },
  FilteredBlackList: { tone: 'blocked' },
  FilteredBlockedService: { tone: 'blocked' },
  FilteredSafeBrowsing: { tone: 'blocked' },
  FilteredParental: { tone: 'blocked' },
  FilteredInvalid: { tone: 'blocked' },
  FilteredSafeSearch: { tone: 'neutral' },
  Rewrite: { tone: 'neutral' },
  RewriteEtcHosts: { tone: 'neutral' },
  RewriteRule: { tone: 'neutral' },
};

export const reasonLabel = (r: string) => tMaybe(`reason.${r}`, r);

/** Filter list names: "@custom" etc. are AdGuard's built-in lists, "#12" an unknown id. */
export function listLabel(name: string | null | undefined, id?: number): string {
  if (!name) return t('list.unknown', { id: id ?? '?' });
  if (name.startsWith('@')) return tMaybe(`list.${name}`, name);
  if (/^#-?\d+$/.test(name)) return t('list.unknown', { id: name.slice(1) });
  return name;
}

export const PROTOS: Record<string, string> = { dns: 'DNS (UDP/TCP)', doh: 'DNS-over-HTTPS', dot: 'DNS-over-TLS', doq: 'DNS-over-QUIC', dnscrypt: 'DNSCrypt' };

export function shortUpstream(u: string): string {
  return u.replace(/^(https?|tls|quic|sdns|udp|tcp):\/\//, '').replace(/\/dns-query$/, '');
}
