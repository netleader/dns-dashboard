# dns-dashboard

A Home Assistant app that brings two AdGuard Home servers (plus AdGuard Home Sync) together in one dashboard: status, statistics with its own long-term history, a merged query log, clients, a configuration comparison, and actions on both servers.

Installation and usage: [dns-dashboard/DOCS.md](dns-dashboard/DOCS.md)

## Layout

```
repository.yaml              Home Assistant app repository
dns-dashboard/               the app (config.yaml, Dockerfile, docs)
  app/server/                Node 24 + Fastify, TypeScript (runs via type stripping, no build step)
    src/poller.ts            polls AdGuard Home, Sync and DNS (port 53)
    src/db/                  SQLite history: ingest, rollups, statistics queries
    src/routes/api.ts        REST + server-sent events + actions
  app/web/                   React + Vite + Tailwind + ECharts
    src/lib/i18n.ts          English (default) and German UI strings
  app/dev/mock-adguard.ts    simulates two AdGuard Home servers and Sync
```

## Development

```bash
cd dns-dashboard/app
npm install
cp .env.example .env        # mock values; enter URLs/credentials for real servers
```

With simulated servers:

```bash
npm run mock
```

```bash
npm run dev:server
```

```bash
npm run dev:web
```

The frontend then runs on http://localhost:5173 (API proxied to :8099); append `?lang=de` to check the German UI. Tests and typecheck:

```bash
npm test && npm run typecheck
```
