# dns-dashboard

Home-Assistant-App, die zwei AdGuard-Home-Server (plus AdGuard Home Sync) in einem modernen Dashboard zusammenführt: Status, Statistiken mit eigener Langzeit-Historie, zusammengeführtes Query-Log, Clients, Konfigurationsvergleich und Aktionen auf beiden Servern.

Installation und Bedienung: [dns-dashboard/DOCS.md](dns-dashboard/DOCS.md)

## Aufbau

```
repository.yaml              Home-Assistant-App-Repository
dns-dashboard/               die App (config.yaml, Dockerfile, Doku)
  app/server/                Node 24 + Fastify, TypeScript (läuft per Type-Stripping ohne Build)
    src/poller.ts            fragt AdGuard Home, Sync und DNS (Port 53) ab
    src/db/                  SQLite-Historie: Ingest, Rollups, Statistik-Abfragen
    src/routes/api.ts        REST + Server-Sent Events + Aktionen
  app/web/                   React + Vite + Tailwind + ECharts
  app/dev/mock-adguard.ts    simuliert zwei AdGuard-Home-Server und Sync
```

## Entwicklung

```bash
cd dns-dashboard/app
npm install
cp .env.example .env        # Mock-Werte; für echte Server URLs/Zugangsdaten eintragen
```

Mit simulierten Servern:

```bash
npm run mock
```

```bash
npm run dev:server
```

```bash
npm run dev:web
```

Das Frontend läuft dann auf http://localhost:5173 (API-Proxy auf :8099). Tests und Typecheck:

```bash
npm test && npm run typecheck
```
