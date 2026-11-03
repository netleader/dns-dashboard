import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BarList, Drawer, SplitBar } from '../components/bits';
import { CHART } from '../components/Chart';
import { StackedBars } from '../components/charts';
import { Card, CardHeader, Empty, ErrorNote, Segmented, SeriesKey, Skeleton } from '../components/ui';
import type { ClientDetail, ClientRow, Overview, RangeKey } from '../lib/api';
import { fmtAgo, fmtDateTime, fmtNum, fmtPct } from '../lib/format';
import { useApi } from '../lib/hooks';
import { t, tMaybe } from '../lib/i18n';

const RANGES = (['24h', '7d', '30d'] as const).map((value) => ({ value: value as RangeKey, label: t(`range.${value}`) }));
const sourceLabel = (s: string) => tMaybe(`cl.source.${s}`, s);

export function ClientsPage({ o }: { o: Overview | null }) {
  const [range, setRange] = useState<RangeKey>('24h');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ClientRow | null>(null);
  const { data, error } = useApi<{ clients: ClientRow[] }>(`api/clients?range=${range}`, 60_000);
  const servers = o?.servers ?? [];
  const colors = Object.fromEntries(servers.map((s) => [s.id, s.color]));
  const names = Object.fromEntries(servers.map((s) => [s.id, s.name]));

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = data?.clients ?? [];
    return q ? all.filter((c) => [c.name, c.key, ...c.ids, ...c.tags].some((v) => v?.toLowerCase().includes(q))) : all;
  }, [data, search]);
  const max = Math.max(1, ...rows.map((r) => r.count));
  const active = (data?.clients ?? []).filter((c) => c.count > 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('cl.search')}
            className="w-full rounded-xl border border-line bg-white/[0.04] py-2 pr-3 pl-9 text-[13px] placeholder:text-ink-3 focus:border-white/30 focus:outline-none"
          />
        </label>
        <Segmented value={range} onChange={setRange} options={RANGES} />
        {data && <span className="ml-auto text-xs text-ink-3">{t('cl.counts', { active, known: data.clients.length })}</span>}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}

      <Card className="overflow-hidden">
        {!data ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Empty>{t('cl.empty')}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-3">
                  <th className="px-4 py-2.5 font-medium">{t('cl.colClient')}</th>
                  <th className="hidden px-2 py-2.5 font-medium md:table-cell">{t('cl.colSource')}</th>
                  <th className="px-2 py-2.5 font-medium">{t('cl.colQueries')}</th>
                  <th className="px-2 py-2.5 text-right font-medium">{t('cl.colBlocked')}</th>
                  <th className="hidden w-32 px-4 py-2.5 font-medium sm:table-cell">{t('cl.colServer')}</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium lg:table-cell">{t('cl.colLast')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.key} onClick={() => setSelected(c)} className="cursor-pointer border-b border-line/60 hover:bg-white/[0.04]">
                    <td className="max-w-[280px] px-4 py-2.5">
                      <div className="truncate font-medium">{c.name ?? c.key}</div>
                      <div className="truncate text-xs text-ink-3">
                        {c.ids.join(', ')}
                        {c.tags.length > 0 && ` · ${c.tags.join(', ')}`}
                      </div>
                    </td>
                    <td className="hidden px-2 py-2.5 text-ink-3 md:table-cell">{sourceLabel(c.source)}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="tnum w-14 shrink-0 text-right">{fmtNum(c.count)}</span>
                        <div className="hidden h-1.5 w-24 rounded-full bg-white/[0.05] sm:block">
                          <div className="h-full rounded-full bg-allowed" style={{ width: `${(c.count / max) * 100}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="tnum px-2 py-2.5 text-right text-ink-2">{c.count ? fmtPct((c.blocked / c.count) * 100) : '–'}</td>
                    <td className="hidden px-4 py-2.5 sm:table-cell">
                      <SplitBar parts={Object.entries(c.perServer).map(([id, v]) => ({ color: colors[id], value: v, label: names[id] ?? id }))} />
                    </td>
                    <td className="hidden px-4 py-2.5 text-right text-xs text-ink-3 lg:table-cell">{c.lastSeen ? fmtAgo(c.lastSeen) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && <ClientDrawer client={selected} range={range} onClose={() => setSelected(null)} colors={colors} names={names} />}
    </div>
  );
}

function ClientDrawer({ client, range, onClose, colors, names }: { client: ClientRow; range: RangeKey; onClose: () => void; colors: Record<string, string>; names: Record<string, string> }) {
  const { data } = useApi<ClientDetail>(`api/clients/detail?ids=${encodeURIComponent(client.ids.join(','))}&range=${range}`);
  const series = useMemo(
    () =>
      data
        ? [
            { name: t('common.allowed'), color: CHART.allowed, data: data.queries.map((q, i) => q - data.blocked[i]) },
            { name: t('common.blocked'), color: CHART.blocked, data: data.blocked },
          ]
        : [],
    [data],
  );
  return (
    <Drawer open onClose={onClose} title={client.name ?? client.key} subtitle={`${client.ids.join(', ')} · ${sourceLabel(client.source)}`}>
      {!data ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-48" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <div className="space-y-2 pb-6">
          <div className="grid grid-cols-3 gap-3 px-5 pt-5">
            <Stat label={t('cl.colQueries')} value={fmtNum(client.count)} />
            <Stat label={t('cl.colBlocked')} value={client.count ? fmtPct((client.blocked / client.count) * 100) : '–'} />
            <Stat label={t('cl.lastActive')} value={client.lastSeen ? fmtAgo(client.lastSeen) : '–'} />
          </div>
          <CardHeader
            title={t('cl.history')}
            subtitle={data.rawFrom ? t('cl.detailSince', { from: fmtDateTime(data.rawFrom) }) : undefined}
            right={series.map((s) => <SeriesKey key={s.name} color={s.color} label={s.name} />)}
          />
          <div className="px-3">{data.queries.some(Boolean) ? <StackedBars t={data.t} unit={data.unit} series={series} height={190} /> : <Empty>{t('cl.noDetail')}</Empty>}</div>
          {data.servers.length > 0 && (
            <>
              <CardHeader title={t('cl.servers')} />
              <BarList items={data.servers} label={(k) => names[k] ?? k} color={colors[data.servers[0].key]} />
            </>
          )}
          <CardHeader title={t('cl.topDomains')} />
          {data.topDomains.length ? <BarList items={data.topDomains} /> : <Empty>–</Empty>}
          <CardHeader title={t('cl.topBlocked')} />
          {data.topBlocked.length ? <BarList items={data.topBlocked} color={CHART.blocked} /> : <Empty>{t('cl.nothingBlocked')}</Empty>}
          <CardHeader title={t('cl.qtypes')} />
          <BarList items={data.qtypes} />
        </div>
      )}
    </Drawer>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className="tnum mt-1 text-lg font-semibold">{value}</div>
    </Card>
  );
}
