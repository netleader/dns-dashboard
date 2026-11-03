# DNS Dashboard

A dashboard for two (or more) AdGuard Home servers. It combines status, statistics and the query log of all servers, shows the state of AdGuard Home Sync, and runs actions on every server at once.

The interface is available in English and German and follows the language of the Home Assistant user (English for every other language).

## Pages

- **Overview** – key figures for the last 24 hours, traffic over time, top lists, server comparison, upstreams, alerts
- **Statistics** – 24 hours up to 1 year: queries and blocks, load split, response times, weekly rhythm (heatmap), filtering results, query types, response codes, protocols, hits per filter list, blocked services, upstreams, top lists with trend – plus CSV export
- **Query log** – both servers merged live, with search and filters; allow or block a domain right from an entry
- **Clients** – every known client with activity, block rate and the server it uses
- **Servers & sync** – configuration of both servers, filter lists (including outdated ones), sync status and a configuration comparison

The control in the top right pauses (30 seconds to 8 hours) or disables protection on **all servers** at once.

## Setup

1. Add the repository in Home Assistant: **Settings → Apps → App store → ⋮ → Repositories** → `https://github.com/netleader/dns-dashboard`
2. Install **DNS Dashboard**.
3. Enter your servers under **Configuration**:

```yaml
servers:
  - name: "DNS1 · Pi"
    url: "http://192.168.10.11:8083"
    username: "admin"
    password: "…"
  - name: "DNS2 · HA"
    url: "http://192.168.10.10:8083"
    username: "admin"
    password: "…"
sync_url: "http://192.168.10.11:8080"
```

4. Start the app and enable **Show in sidebar**.

### AdGuard Home as a Home Assistant app

The AdGuard Home app for Home Assistant has its web port disabled by default and is only reachable through ingress. For the dashboard (and AdGuard Home Sync) to reach it, set a port under **Network** in the AdGuard Home app. Use the same URL that AdGuard Home Sync uses for the replica.

### AdGuard Home Sync

The sync API listens on port 8080 by default. If `API_USERNAME`/`API_PASSWORD` are set, enter them as `sync_username`/`sync_password`. The time of the last sync is derived from the sync status and – if `API_METRICS_ENABLED` is on – from its Prometheus metrics.

Custom rules (**Allow** / **Block**) are written to the **origin** and a sync is triggered afterwards. The dashboard detects the origin from AdGuard Home Sync (option `origin: auto`). Without sync, rules are written to every server.

## Notes

- **DNS probe:** the dashboard regularly resolves `dns_probe_domain` directly on port 53 (`dns_probe_interval`, 60 seconds by default). These queries appear in the query log. To hide them, add a client for Home Assistant's IP in AdGuard Home and enable "Ignore in query log" and "Ignore in statistics".
- **History:** AdGuard Home only provides hourly values for the last 24 hours. The dashboard stores them itself (`/data/history.db`), so longer ranges fill up over time. Individual queries are kept in `/data/raw.db` (7 days by default) and are excluded from backups.
- **Access:** the interface is only reachable through Home Assistant ingress; credentials never leave the backend.
