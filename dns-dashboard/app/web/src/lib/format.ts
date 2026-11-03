const nf = new Intl.NumberFormat('de-DE');
const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

export function fmtNum(v: number | null | undefined): string {
  return v === null || v === undefined ? '–' : nf.format(v);
}

/** 1.284 · 12,9 Tsd. · 4,2 Mio. */
export function fmtCompact(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–';
  const a = Math.abs(v);
  if (a >= 1e6) return `${nf1.format(v / 1e6)} Mio.`;
  if (a >= 1e4) return `${nf1.format(v / 1e3)} Tsd.`;
  return nf.format(Math.round(v));
}

/** Axis ticks: 0 · 2K · 1,5M */
export function fmtAxis(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${nf1.format(v / 1e6)}M`;
  if (a >= 1e3) return `${nf1.format(v / 1e3)}K`;
  return nf.format(v);
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return '–';
  return `${v.toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: digits })} %`;
}

export function fmtMs(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–';
  if (v < 1) return `${v.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ms`;
  if (v < 10) return `${v.toLocaleString('de-DE', { maximumFractionDigits: 1 })} ms`;
  return `${Math.round(v).toLocaleString('de-DE')} ms`;
}

export function pct(part: number, total: number): number {
  return total ? (part / total) * 100 : 0;
}

export function fmtTime(ts: number, withSeconds = false): string {
  return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: withSeconds ? '2-digit' : undefined });
}

export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fmtBucket(ts: number, unit: 'hour' | 'day' | 'hours' | 'days'): string {
  const d = new Date(ts);
  return unit.startsWith('hour')
    ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

export function fmtBucketLong(ts: number, unit: 'hour' | 'day' | 'hours' | 'days'): string {
  const d = new Date(ts);
  return unit.startsWith('hour')
    ? `${d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`
    : d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' });
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} Tage`;
}

export function fmtAgo(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'nie';
  const s = Math.round((now - ts) / 1000);
  if (s < 10) return 'gerade eben';
  if (s < 60) return `vor ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  if (h < 48) return `vor ${h} Std.`;
  return `vor ${Math.round(h / 24)} Tagen`;
}

/** Human labels for AdGuard filtering reasons. */
export const REASONS: Record<string, { label: string; tone: 'allowed' | 'blocked' | 'neutral' | 'warn' }> = {
  NotFilteredNotFound: { label: 'Erlaubt', tone: 'allowed' },
  NotFilteredAllowList: { label: 'Allowlist', tone: 'allowed' },
  NotFilteredWhiteList: { label: 'Allowlist', tone: 'allowed' },
  NotFilteredError: { label: 'Fehler', tone: 'warn' },
  FilteredBlackList: { label: 'Geblockt', tone: 'blocked' },
  FilteredBlockedService: { label: 'Dienst geblockt', tone: 'blocked' },
  FilteredSafeBrowsing: { label: 'Safe Browsing', tone: 'blocked' },
  FilteredParental: { label: 'Kinderschutz', tone: 'blocked' },
  FilteredInvalid: { label: 'Ungültig', tone: 'blocked' },
  FilteredSafeSearch: { label: 'SafeSearch', tone: 'neutral' },
  Rewrite: { label: 'Umgeschrieben', tone: 'neutral' },
  RewriteEtcHosts: { label: 'Hosts-Datei', tone: 'neutral' },
  RewriteRule: { label: 'Umgeschrieben', tone: 'neutral' },
};

export const reasonLabel = (r: string) => REASONS[r]?.label ?? r;

export const PROTOS: Record<string, string> = { dns: 'DNS (UDP/TCP)', doh: 'DNS-over-HTTPS', dot: 'DNS-over-TLS', doq: 'DNS-over-QUIC', dnscrypt: 'DNSCrypt' };

export function shortUpstream(u: string): string {
  return u.replace(/^(https?|tls|quic|sdns|udp|tcp):\/\//, '').replace(/\/dns-query$/, '');
}
