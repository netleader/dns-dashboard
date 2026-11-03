import { ArrowDown, ArrowUp, Minus, X } from 'lucide-react';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { fmtNum, fmtPct } from '../lib/format';
import { cx } from './ui';

/** 12–48 point trend line; the latest point is marked. */
export function Sparkline({ values, color = '#6f788c', width = 96, height = 28, stretch }: { values: number[]; color?: string; width?: number; height?: number; stretch?: boolean }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const max = Math.max(...values, 1);
  const step = width / (values.length - 1);
  const y = (v: number) => height - 3 - (v / max) * (height - 6);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg
      width={stretch ? '100%' : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={stretch ? 'none' : undefined}
      className="overflow-visible"
      aria-hidden
    >
      <polyline points={`0,${height} ${pts} ${width},${height}`} fill={color} opacity={0.08} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {!stretch && <circle cx={last * step} cy={y(values[last])} r={3} fill={color} stroke="#121826" strokeWidth={2} />}
    </svg>
  );
}

/**
 * Signed change vs. a named period. `goodWhenUp` decides the colour: more queries is neutral,
 * a higher block rate is neither good nor bad, a faster answer is good.
 */
export function Delta({ now, prev, unit = 'pct', goodWhenUp, label = 'Vortag' }: { now: number; prev: number | null | undefined; unit?: 'pct' | 'pp'; goodWhenUp?: boolean; label?: string }) {
  if (prev === null || prev === undefined || (unit === 'pct' && prev === 0)) return null;
  const diff = unit === 'pct' ? ((now - prev) / prev) * 100 : now - prev;
  const flat = Math.abs(diff) < 0.5;
  const up = diff > 0;
  const tone = flat || goodWhenUp === undefined ? 'text-ink-3' : up === goodWhenUp ? 'text-good' : 'text-serious';
  const Icon = flat ? Minus : up ? ArrowUp : ArrowDown;
  return (
    <span className={cx('inline-flex items-center gap-0.5 text-xs font-medium', tone)}>
      <Icon className="size-3.5" />
      {unit === 'pct' ? fmtPct(Math.abs(diff), 0) : `${Math.abs(diff).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Pp.`}
      <span className="ml-1 font-normal text-ink-3">ggü. {label}</span>
    </span>
  );
}

/** Horizontal magnitude bars – one hue, value at the tip. */
export function BarList({
  items,
  color = '#3987e5',
  colorOf,
  format = fmtNum,
  label = (k) => k,
  extra,
  max: forcedMax,
  onSelect,
}: {
  items: Array<{ key: string; count: number }>;
  color?: string;
  colorOf?: (key: string) => string;
  format?: (v: number) => string;
  label?: (key: string) => ReactNode;
  extra?: (item: { key: string; count: number }) => ReactNode;
  max?: number;
  onSelect?: (key: string) => void;
}) {
  const max = forcedMax ?? Math.max(1, ...items.map((i) => i.count));
  const total = items.reduce((a, i) => a + i.count, 0);
  return (
    <ul className="space-y-1.5 px-5 pb-4">
      {items.map((it) => {
        const c = colorOf?.(it.key) ?? color;
        return (
        <li key={it.key}>
          <button
            type="button"
            disabled={!onSelect}
            onClick={() => onSelect?.(it.key)}
            className="group relative flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left enabled:hover:bg-white/[0.04]"
            title={`${it.key}: ${fmtNum(it.count)} (${fmtPct((it.count / Math.max(1, total)) * 100)})`}
          >
            <span className="absolute inset-y-1 left-0 rounded-r-[4px] rounded-l-sm" style={{ width: `${(it.count / max) * 100}%`, background: c, opacity: 0.16 }} />
            <span className="absolute bottom-1 left-0 h-[2px] rounded-full" style={{ width: `${(it.count / max) * 100}%`, background: c }} />
            <span className="relative min-w-0 flex-1 truncate text-[13px] text-ink">{label(it.key)}</span>
            {extra && <span className="relative shrink-0">{extra(it)}</span>}
            <span className="tnum relative shrink-0 text-[13px] font-medium text-ink-2">{format(it.count)}</span>
          </button>
        </li>
        );
      })}
    </ul>
  );
}

/** Thin split bar showing how much each server contributed. */
export function SplitBar({ parts, className }: { parts: Array<{ color: string; value: number; label: string }>; className?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!total) return null;
  return (
    <div className={cx('flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full', className)} title={parts.map((p) => `${p.label}: ${fmtPct((p.value / total) * 100, 0)}`).join(' · ')}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
    </div>
  );
}

export function Drawer({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="Schließen" className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-xl flex-col border-l border-line bg-[#0c111c]/95 shadow-2xl backdrop-blur-xl" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-3 hover:bg-white/[0.06] hover:text-ink" aria-label="Schließen">
            <X className="size-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>
  );
}

// ---- Toasts -----------------------------------------------------------------

interface Toast {
  id: number;
  tone: 'good' | 'critical' | 'neutral';
  text: string;
}
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col gap-2" style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {toasts.map((t) => (
          <div key={t.id} className="glass fade-up pointer-events-auto flex max-w-sm items-start gap-2 rounded-xl bg-[#0c111c]/90 px-4 py-3 text-sm">
            <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', t.tone === 'good' ? 'bg-good' : t.tone === 'critical' ? 'bg-critical' : 'bg-ink-3')} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
