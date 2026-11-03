import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(' ');
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <section className={cx('glass fade-up rounded-2xl', className)} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, right, icon }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; icon?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-2">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          {icon && <span className="text-ink-3">{icon}</span>}
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </header>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: ReactNode }>;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" className="inline-flex rounded-xl border border-line bg-white/[0.03] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-[10px] font-medium transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[13px]',
            o.value === value ? 'bg-white/[0.12] text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type Variant = 'primary' | 'ghost' | 'danger' | 'subtle';

export function Button({
  variant = 'subtle',
  loading,
  icon,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; icon?: ReactNode }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-allowed text-white hover:brightness-110',
    danger: 'bg-critical/90 text-white hover:bg-critical',
    subtle: 'border border-line bg-white/[0.05] text-ink hover:bg-white/[0.09]',
    ghost: 'text-ink-2 hover:bg-white/[0.06] hover:text-ink',
  };
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className,
      )}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral' | 'allowed' | 'blocked';

const TONE_DOT: Record<Tone, string> = {
  good: 'bg-good',
  warning: 'bg-warning',
  serious: 'bg-serious',
  critical: 'bg-critical',
  neutral: 'bg-ink-3',
  allowed: 'bg-allowed',
  blocked: 'bg-blocked',
};

export function Dot({ tone, pulse, className }: { tone: Tone; pulse?: boolean; className?: string }) {
  return <span className={cx('inline-block size-2 shrink-0 rounded-full', TONE_DOT[tone], pulse && 'live-dot', className)} />;
}

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border border-line bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-ink-2',
        className,
      )}
    >
      <Dot tone={tone} className="size-1.5" />
      {children}
    </span>
  );
}

export function SeriesKey({ color, label }: { color: string; label: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
      {label}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-5 py-10 text-center text-sm text-ink-3">{children}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-white/[0.05]', className)} />;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="mx-5 my-3 rounded-xl border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-ink">{children}</div>;
}
