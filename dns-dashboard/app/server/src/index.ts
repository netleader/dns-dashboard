import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { loadConfig } from './config.ts';
import { History } from './db/history.ts';
import { Ingestor } from './db/ingest.ts';
import { StatsQueries } from './db/queries.ts';
import { errorMessage } from './http.ts';
import { type Overview, OverviewBuilder } from './overview.ts';
import { Poller } from './poller.ts';
import { registerApi } from './routes/api.ts';
import { registerStatic } from './static.ts';

/** Only the Supervisor's ingress proxy (and local health checks) may talk to us inside Home Assistant. */
const INGRESS_PEERS = new Set(['172.30.32.2', '127.0.0.1', '::1', '::ffff:172.30.32.2', '::ffff:127.0.0.1']);

const config = loadConfig();
const history = new History(config.dataDir, config.historyRawDays, config.historyHourlyDays);
const stats = new StatsQueries(history);
const poller = new Poller(config, history);
const builder = new OverviewBuilder(poller, stats);
const ingestor = new Ingestor(history, poller);

let overview: Overview = builder.build();
const listeners = new Set<(o: Overview) => void>();
const publish = () => {
  try {
    overview = builder.build();
  } catch (err) {
    console.error('overview failed:', errorMessage(err));
    return;
  }
  for (const fn of listeners) fn(overview);
};

poller.on('stats', (id, s) => {
  try {
    history.recordStats(id, s);
  } catch (err) {
    console.error('recordStats failed:', errorMessage(err));
  }
});
poller.on('update', publish);

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } });

if (config.ingressOnly) {
  app.addHook('onRequest', async (req, reply) => {
    if (!INGRESS_PEERS.has(req.socket.remoteAddress ?? '')) return reply.code(403).send('Forbidden');
  });
}

await registerApi(app, {
  poller,
  overview: builder,
  stats,
  getOverview: () => overview,
  refresh: async () => {
    await poller.refreshNow();
  },
  subscribe: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
});
registerStatic(app, process.env.WEB_DIST ?? fileURLToPath(new URL('../../web/dist', import.meta.url)));

poller.start();
ingestor.start();
await app.listen({ host: '0.0.0.0', port: config.port });
console.log(
  `DNS-Dashboard listening on :${config.port} – servers: ${config.servers.map((s) => `${s.name} (${s.url})`).join(', ')}` +
    (config.sync ? `, sync: ${config.sync.url}` : ''),
);

const shutdown = async () => {
  poller.stop();
  ingestor.stop();
  await app.close();
  history.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
