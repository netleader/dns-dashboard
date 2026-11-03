import { AlertOctagon, AlertTriangle, Ban, Clock, Globe, Info, Laptop, Network, Server, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Delta, SplitBar, Sparkline } from '../components/bits';
import { CHART } from '../components/Chart';
import { StackedBars } from '../components/charts';
import { Card, CardHeader, Empty, Segmented, SeriesKey, Skeleton, cx } from '../components/ui';
import type { Alert, Overview } from '../lib/api';
import { fmtCompact, fmtDuration, fmtMs, fmtNum, fmtPct, fmtTime, shortUpstream } from '../lib/format';
import { useNow } from '../lib/hooks';
import { type Key, t } from '../lib/i18n';

type TopItem = Overview['combined']['topDomains'][number] & { label?: string };

export function OverviewPage({ o, go }: { o: Overview | null; go: (r: string) => void }) {
  if (!o) return <LoadingGrid />;
  const c = o.combined;
  const colors = Object.fromEntries(o.servers.map((s) => [s.id, s.color]));
  const names = Object.fromEntries(o.servers.map((s) => [s.id, s.name]));
  const total = (rec: Record<string, number[]>) => {
    const arrs = Object.values(rec);
    return arrs[0]?.map((_, i) => arrs.reduce((a, x) => a + (x[i] ?? 0), 0)) ?? [];
  };
  const queries = total(c.series.queries);
  const blocked = total(c.series.blocked);

  return (
    <div className="space-y-5">
      {o.alerts.length > 0 && <AlertList alerts={o.alerts} servers={o.servers} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          icon={<Globe className="size-4" />}
          label={t('ov.queries24')}
          value={fmtCompact(c.queries)}
          delta={<Delta now={c.queries} prev={c.previous?.queries} />}
          spark={{ values: queries, color: CHART.allowed }}
        />
        <Kpi
          icon={<Ban className="size-4" />}
          label={t('ov.blocked')}
          value={fmtPct(c.blockedPct)}
          sub={t('ov.blockedQueries', { n: fmtNum(c.blocked) })}
          delta={<Delta now={c.blockedPct} prev={c.previous?.blockedPct} unit="pp" />}
          spark={{ values: blocked, color: CHART.blocked }}
        />
        <Kpi
          icon={<Clock className="size-4" />}
          label={t('ov.avgProcessing')}
          value={fmtMs(c.avgMs)}
          sub={o.servers.map((s) => `${s.name.split(' ')[0]} ${fmtMs(s.stats?.avgMs)}`).join(' · ')}
        />
        <Kpi
          icon={<Users className="size-4" />}
          label={t('ov.activeClients')}
          value={fmtNum(c.activeClients)}
          sub={t('ov.last24h')}
          footer={
            <div className="mt-3">
              <div className="mb-1.5 flex justify-between text-[11px] text-ink-3">
                <span>{t('ov.loadSplit')}</span>
                <span className="tnum">
                  {o.servers.map((s) => `${fmtPct((100 * (s.stats?.queries ?? 0)) / Math.max(1, c.queries), 0)}`).join(' / ')}
                </span>
              </div>
              <SplitBar parts={o.servers.map((s) => ({ color: s.color, value: s.stats?.queries ?? 0, label: s.name }))} />
            </div>
          }
        />
      </div>

      <TrafficCard o={o} colors={colors} names={names} />

      <div className="grid gap-5 lg:grid-cols-3">
        <TopCard title={t('ov.topBlocked')} icon={<Ban className="size-4" />} items={c.topBlocked} colors={colors} names={names} onSelect={(d) => go(`log?q=${encodeURIComponent(d)}`)} />
        <TopCard title={t('ov.topDomains')} icon={<Globe className="size-4" />} items={c.topDomains} colors={colors} names={names} onSelect={(d) => go(`log?q=${encodeURIComponent(d)}`)} />
        <TopCard title={t('ov.topClients')} icon={<Laptop className="size-4" />} items={c.topClients} colors={colors} names={names} onSelect={(d) => go(`log?q=${encodeURIComponent(d)}`)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title={t('ov.compare')} icon={<Server className="size-4" />} subtitle={t('ov.compareHint')} />
          <ServerTable o={o} />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={t('ov.upstreams')} icon={<Network className="size-4" />} subtitle={t('ov.upstreamsHint')} />
          <UpstreamList items={c.topUpstreams} />
        </Card>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub, delta, spark, footer }: { icon: React.ReactNode; label: string; value: string; sub?: string; delta?: React.ReactNode; spark?: { values: number[]; color: string }; footer?: React.ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center gap-2 text-[13px] text-ink-2">
        <span className="text-ink-3">{icon}</span>
        {label}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="tnum text-[26px] leading-none font-semibold tracking-tight whitespace-nowrap sm:text-[30px]">{value}</div>
        {spark && (
          <div className="hidden 2xl:block">
            <Sparkline {...spark} />
          </div>
        )}
      </div>
      <div className="mt-2 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1">
        {delta}
        {sub && <span className="truncate text-xs text-ink-3">{sub}</span>}
      </div>
      {spark && (
        <div className="mt-3 2xl:hidden">
          <Sparkline {...spark} stretch height={26} />
        </div>
      )}
      {footer}
    </Card>
  );
}

function TrafficCard({ o, colors, names }: { o: Overview; colors: Record<string, string>; names: Record<string, string> }) {
  const [mode, setMode] = useState<'status' | 'server'>('status');
  const s = o.combined.series;
  const series = useMemo(() => {
    const ids = Object.keys(s.queries);
    if (mode === 'server') return ids.map((id) => ({ name: names[id], color: colors[id], data: s.queries[id] }));
    const sum = (rec: Record<string, number[]>) => s.t.map((_, i) => ids.reduce((a, id) => a + (rec[id]?.[i] ?? 0), 0));
    const q = sum(s.queries);
    const b = sum(s.blocked);
    return [
      { name: t('common.allowed'), color: CHART.allowed, data: q.map((v, i) => Math.max(0, v - b[i])) },
      { name: t('common.blocked'), color: CHART.blocked, data: b },
    ];
  }, [s, mode, colors, names]);

  return (
    <Card>
      <CardHeader
        title={t('ov.traffic')}
        subtitle={s.units === 'hours' ? t('ov.last24hHourly') : t('ov.daily')}
        right={
          <>
            <div className="mr-2 hidden gap-3 sm:flex">
              {series.map((x) => (
                <SeriesKey key={x.name} color={x.color} label={x.name} />
              ))}
            </div>
            <Segmented
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'status', label: t('ov.byStatus') },
                { value: 'server', label: t('ov.byServer') },
              ]}
            />
          </>
        }
      />
      <div className="px-3 pb-3">
        {s.t.length ? <StackedBars t={s.t} unit={s.units} series={series} height={280} /> : <Empty>{t('common.noData')}</Empty>}
      </div>
    </Card>
  );
}

function TopCard({ title, icon, items, colors, names, onSelect }: { title: string; icon: React.ReactNode; items: TopItem[]; colors: Record<string, string>; names: Record<string, string>; onSelect: (k: string) => void }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <Card>
      <CardHeader title={title} icon={icon} subtitle={t('ov.topHint')} />
      {items.length === 0 ? (
        <Empty>{t('common.none')}</Empty>
      ) : (
        <ol className="space-y-0.5 px-3 pb-4">
          {items.map((it, i) => (
            <li key={it.name}>
              <button onClick={() => onSelect(it.name)} className="group w-full rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.04]" title={t('ov.showInLog')}>
                <div className="flex items-baseline gap-2.5">
                  <span className="tnum w-4 shrink-0 text-right text-[11px] text-ink-3">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {it.label ? (
                      <>
                        {it.label} <span className="text-ink-3">{it.name}</span>
                      </>
                    ) : (
                      it.name
                    )}
                  </span>
                  <span className="tnum shrink-0 text-[13px] font-medium text-ink-2">{fmtNum(it.count)}</span>
                </div>
                <div className="mt-1 pl-6.5">
                  <div className="flex h-1.5 gap-[2px]" style={{ width: `${Math.max(4, (it.count / max) * 100)}%` }}>
                    {Object.entries(it.perServer)
                      .filter(([, v]) => v > 0)
                      .map(([id, v]) => (
                        <span key={id} className="h-full min-w-[2px] basis-0 rounded-[2px]" style={{ flexGrow: v, background: colors[id] }} title={`${names[id]}: ${fmtNum(v)}`} />
                      ))}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function ServerTable({ o }: { o: Overview }) {
  const now = useNow(30_000);
  const rows: Array<[string, (s: Overview['servers'][number]) => React.ReactNode]> = [
    [t('ov.row.queries'), (s) => fmtNum(s.stats?.queries)],
    [t('ov.row.blocked'), (s) => (s.stats ? `${fmtPct(s.stats.blockedPct)} · ${fmtNum(s.stats.blocked)}` : '–')],
    [t('ov.row.processing'), (s) => fmtMs(s.stats?.avgMs)],
    [t('ov.row.dns'), (s) => (s.dns?.ok ? fmtMs(s.dns.ms) : <span className="text-critical">{t('ov.noAnswer')}</span>)],
    [t('ov.row.safebrowsing'), (s) => fmtNum(s.stats?.safebrowsing)],
    [t('ov.row.version'), (s) => (s.updateAvailable ? `${s.version} → ${s.updateAvailable}` : (s.version ?? '–'))],
    [t('ov.row.uptime'), (s) => (s.startTime ? fmtDuration(now - s.startTime) : '–')],
  ];
  return (
    <div className="overflow-x-auto px-5 pb-4">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-xs text-ink-3">
            <th className="py-2 font-medium" />
            {o.servers.map((s) => (
              <th key={s.id} className="py-2 pl-4 font-medium">
                <span className="inline-flex items-center gap-2 text-ink-2">
                  <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
                  {s.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, fn]) => (
            <tr key={label} className="border-t border-line">
              <td className="py-2 pr-2 text-ink-3">{label}</td>
              {o.servers.map((s) => (
                <td key={s.id} className="tnum py-2 pl-4 text-ink">
                  {s.online ? fn(s) : <span className="text-ink-3">{t('common.offline')}</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UpstreamList({ items }: { items: Overview['combined']['topUpstreams'] }) {
  if (!items.length) return <Empty>{t('ov.noUpstreams')}</Empty>;
  const max = Math.max(1, ...items.map((u) => u.responses));
  const fastest = Math.min(...items.map((u) => u.avgMs));
  return (
    <ul className="space-y-3 px-5 pb-5">
      {items.map((u) => (
        <li key={u.name}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate" title={u.name}>
              {shortUpstream(u.name)}
            </span>
            <span className={cx('tnum shrink-0 text-xs', u.avgMs === fastest ? 'text-good' : 'text-ink-3')}>Ø {fmtMs(u.avgMs)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-white/[0.05]">
              <div className="h-full rounded-full bg-allowed" style={{ width: `${(u.responses / max) * 100}%` }} />
            </div>
            <span className="tnum w-16 shrink-0 text-right text-xs text-ink-2">{fmtCompact(u.responses)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

const ALERT_STYLE = {
  critical: { icon: AlertOctagon, cls: 'border-critical/45 bg-critical/12', iconCls: 'text-critical' },
  warning: { icon: AlertTriangle, cls: 'border-warning/35 bg-warning/10', iconCls: 'text-warning' },
  info: { icon: Info, cls: 'border-line bg-white/[0.04]', iconCls: 'text-ink-2' },
};

/** Alerts arrive as code + params; text is built here in the viewer's language. */
function alertText(a: Alert, servers: Overview['servers']) {
  const params: Record<string, string | number> = { ...a.params };
  if (a.code === 'paused' && typeof params.until === 'number') params.until = fmtTime(params.until);
  const title = t(`alert.${a.code}` as Key, params);
  const server = servers.find((s) => s.id === a.server)?.name;
  const areas = typeof a.params?.areas === 'string' ? a.params.areas.split(',').map((k) => t(`drift.${k}` as Key)).join(', ') : undefined;
  return { title: server ? `${server}: ${title}` : title, detail: a.detail ?? areas };
}

export function AlertList({ alerts, servers }: { alerts: Alert[]; servers: Overview['servers'] }) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {alerts.map((a) => {
        const st = ALERT_STYLE[a.level];
        const Icon = st.icon;
        const text = alertText(a, servers);
        return (
          <div key={a.id} className={cx('fade-up flex items-start gap-3 rounded-xl border px-4 py-3', st.cls)}>
            <Icon className={cx('mt-0.5 size-4 shrink-0', st.iconCls)} aria-label={t(`alert.level.${a.level}`)} />
            <div className="min-w-0 text-[13px]">
              <div className="font-medium">{text.title}</div>
              {text.detail && (
                <div className="mt-0.5 truncate text-xs text-ink-2" title={text.detail}>
                  {text.detail}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}
