import { ChevronDown, Pause, Play, RefreshCw, ShieldCheck, ShieldOff, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type Overview, type ServerSummary, postJson } from '../lib/api';
import { fmtAgo, fmtDuration, fmtMs } from '../lib/format';
import { useNow } from '../lib/hooks';
import { useToast } from './bits';
import { Dot, type Tone, cx } from './ui';

export function serverTone(s: ServerSummary): Tone {
  if (!s.online || s.dns?.ok === false || s.running === false) return 'critical';
  if (s.protection.enabled === false || (s.dns?.ms ?? 0) > 150) return 'warning';
  return 'good';
}

export function ServerPill({ s }: { s: ServerSummary }) {
  const tone = serverTone(s);
  const now = useNow(30_000);
  const title = [
    s.url,
    s.version && `Version ${s.version}`,
    s.startTime && `läuft seit ${fmtDuration(now - s.startTime)}`,
    s.error && `Fehler: ${s.error}`,
    s.dns?.error && `DNS: ${s.dns.error}`,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <div title={title} className="flex items-center gap-2 rounded-xl border border-line bg-white/[0.04] py-1.5 pr-3 pl-2.5">
      <span className="h-5 w-1 rounded-full" style={{ background: s.color }} />
      <Dot tone={tone} pulse={tone === 'good'} />
      <span className="text-[13px] font-medium whitespace-nowrap">{s.name}</span>
      <span className="tnum text-xs whitespace-nowrap text-ink-3">{s.online ? (s.dns?.ok ? fmtMs(s.dns.ms) : 'DNS ✕') : 'offline'}</span>
      {s.isOrigin && <span className="rounded-md bg-white/[0.07] px-1.5 py-px text-[10px] font-semibold tracking-wide text-ink-2 uppercase">Origin</span>}
    </div>
  );
}

export function SyncBadge({ o, onClick }: { o: Overview; onClick?: () => void }) {
  const now = useNow(15_000);
  if (!o.sync.configured && o.drift.differences === 0) return null;
  let tone: Tone = 'good';
  let text = o.sync.lastSyncAt ? `In Sync · ${fmtAgo(o.sync.lastSyncAt, now)}` : 'In Sync';
  if (o.sync.configured && !o.sync.reachable) {
    tone = 'critical';
    text = 'Sync nicht erreichbar';
  } else if (o.sync.running) {
    tone = 'neutral';
    text = 'Synchronisiere …';
  } else if (o.drift.differences > 0) {
    tone = 'warning';
    text = `${o.drift.differences} Abweichung${o.drift.differences > 1 ? 'en' : ''}`;
  }
  return (
    <button onClick={onClick} className="flex items-center gap-2 rounded-xl border border-line bg-white/[0.04] px-3 py-1.5 text-[13px] whitespace-nowrap hover:bg-white/[0.07]">
      {o.sync.running ? <RefreshCw className="size-3.5 animate-spin text-ink-2" /> : <Dot tone={tone} />}
      {text}
    </button>
  );
}

const PAUSES = [
  { ms: 30_000, label: '30 Sekunden' },
  { ms: 5 * 60_000, label: '5 Minuten' },
  { ms: 30 * 60_000, label: '30 Minuten' },
  { ms: 60 * 60_000, label: '1 Stunde' },
  { ms: 8 * 60 * 60_000, label: '8 Stunden' },
];

/** One switch for both servers: pause for a while, turn off, or resume. */
export function ProtectionControl({ o }: { o: Overview }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const now = useNow(1000);

  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [open]);

  const online = o.servers.filter((s) => s.online);
  const allOn = online.length > 0 && online.every((s) => s.protection.enabled);
  const pausedUntil = Math.max(0, ...online.map((s) => s.protection.pausedUntil ?? 0));
  const anyOff = online.some((s) => s.protection.enabled === false && !s.protection.pausedUntil);

  const set = async (enabled: boolean, durationMs?: number) => {
    setOpen(false);
    setBusy(true);
    try {
      const r = await postJson('api/actions/protection', { enabled, durationMs });
      const failed = r.results?.filter((x) => !x.ok) ?? [];
      if (failed.length) toast('critical', `Fehlgeschlagen auf ${failed.map((f) => `${f.name} (${f.error})`).join(', ')}`);
      else toast('good', enabled ? 'Schutz auf allen Servern aktiv' : durationMs ? `Schutz für ${fmtDuration(durationMs)} pausiert` : 'Schutz deaktiviert');
    } catch (err) {
      toast('critical', String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  const state = allOn
    ? { icon: <ShieldCheck className="size-4" />, text: 'Schutz aktiv', cls: 'border-good/40 bg-good/15 text-ink' }
    : pausedUntil > now
      ? { icon: <Pause className="size-4" />, text: `Pausiert · ${fmtDuration(pausedUntil - now)}`, cls: 'border-warning/40 bg-warning/15 text-ink' }
      : anyOff
        ? { icon: <ShieldOff className="size-4" />, text: 'Schutz aus', cls: 'border-critical/50 bg-critical/20 text-ink' }
        : { icon: <ShieldAlert className="size-4" />, text: 'Unbekannt', cls: 'border-line bg-white/[0.04] text-ink-2' };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy || online.length === 0}
        aria-expanded={open}
        className={cx('flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition hover:brightness-125 disabled:opacity-60', state.cls)}
      >
        {state.icon}
        <span className="tnum">{state.text}</span>
        <ChevronDown className="size-3.5 opacity-60" />
      </button>
      {open && (
        <div className="glass fade-up absolute right-0 z-40 mt-2 w-60 rounded-xl bg-[#0c111c]/95 p-1.5 shadow-2xl">
          {!allOn && (
            <MenuItem onClick={() => set(true)} icon={<Play className="size-4 text-good" />}>
              Schutz fortsetzen
            </MenuItem>
          )}
          <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Beide Server pausieren</div>
          {PAUSES.map((p) => (
            <MenuItem key={p.ms} onClick={() => set(false, p.ms)} icon={<Pause className="size-4 text-ink-3" />}>
              {p.label}
            </MenuItem>
          ))}
          <div className="my-1 h-px bg-line" />
          <MenuItem onClick={() => set(false)} icon={<ShieldOff className="size-4 text-critical" />}>
            Dauerhaft deaktivieren
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, icon, onClick }: { children: React.ReactNode; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-white/[0.07]">
      {icon}
      {children}
    </button>
  );
}
