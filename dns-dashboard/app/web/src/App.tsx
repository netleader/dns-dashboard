import { BarChart3, LayoutDashboard, ListTree, Server, Users } from 'lucide-react';
import { ToastProvider } from './components/bits';
import { ProtectionControl, ServerPill, SyncBadge } from './components/Header';
import { Skeleton, cx } from './components/ui';
import { useHashRoute, useOverview } from './lib/hooks';
import { ClientsPage } from './pages/Clients';
import { OverviewPage } from './pages/Overview';
import { QueryLogPage } from './pages/QueryLog';
import { ServersPage } from './pages/Servers';
import { StatisticsPage } from './pages/Statistics';

const NAV = [
  { id: 'overview', label: 'Übersicht', icon: LayoutDashboard },
  { id: 'stats', label: 'Statistiken', icon: BarChart3 },
  { id: 'log', label: 'Query-Log', icon: ListTree },
  { id: 'clients', label: 'Clients', icon: Users },
  { id: 'servers', label: 'Server & Sync', icon: Server },
];

export function App() {
  const { data: overview, live } = useOverview();
  const [route, go] = useHashRoute();
  const page = NAV.some((n) => n.id === route.split('?')[0]) ? route.split('?')[0] : 'overview';

  return (
    <ToastProvider>
      <div className="mx-auto max-w-[1520px] px-4 pt-4 pb-10 sm:px-6">
        <header className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex items-center gap-2.5 pr-2">
            <img src="./favicon.svg" alt="" className="size-8" />
            <div className="leading-tight">
              <div className="text-[15px] font-semibold">DNS-Dashboard</div>
              <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
                <span className={cx('size-1.5 rounded-full', live ? 'bg-good' : 'bg-ink-3')} />
                {live ? 'Live' : 'Verbinde …'}
              </div>
            </div>
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            {overview ? (
              <>
                {overview.servers.map((s) => (
                  <ServerPill key={s.id} s={s} />
                ))}
                <SyncBadge o={overview} onClick={() => go('servers')} />
                <ProtectionControl o={overview} />
              </>
            ) : (
              <Skeleton className="h-9 w-80" />
            )}
          </div>
        </header>

        <nav className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-line px-1">
          {NAV.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#/${id}`}
              className={cx(
                '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors',
                page === id ? 'border-allowed text-ink' : 'border-transparent text-ink-3 hover:text-ink-2',
              )}
            >
              <Icon className="size-4" />
              {label}
            </a>
          ))}
        </nav>

        <main>
          {page === 'overview' && <OverviewPage o={overview} go={go} />}
          {page === 'stats' && <StatisticsPage o={overview} />}
          {page === 'log' && <QueryLogPage o={overview} />}
          {page === 'clients' && <ClientsPage o={overview} />}
          {page === 'servers' && <ServersPage o={overview} />}
        </main>
      </div>
    </ToastProvider>
  );
}
