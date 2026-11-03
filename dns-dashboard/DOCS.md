# DNS-Dashboard

Ein Dashboard für zwei (oder mehr) AdGuard-Home-Server. Es fasst Status, Statistiken und Query-Log beider Server zusammen, zeigt den Zustand von AdGuard Home Sync und erlaubt Aktionen auf allen Servern gleichzeitig.

## Seiten

- **Übersicht** – Kennzahlen der letzten 24 Stunden, Verlauf, Top-Listen, Server-Vergleich, Upstreams, Warnungen
- **Statistiken** – 24 h bis 1 Jahr: Anfragen und Blockierungen, Lastverteilung, Antwortzeiten, Wochenrhythmus (Heatmap), Block-Gründe, Anfragetypen, Antwortcodes, Protokolle, Treffer je Filterliste, blockierte Dienste, Upstreams, Top-Listen mit Trend – inkl. CSV-Export
- **Query-Log** – beide Server live zusammengeführt, mit Suche und Filtern; pro Eintrag „Freigeben“ / „Blockieren“
- **Clients** – alle bekannten Clients mit Aktivität, Block-Rate und genutztem Server
- **Server & Sync** – Konfiguration beider Server, Filterlisten (inkl. veralteter), Sync-Status und ein Konfigurationsvergleich

Oben rechts lässt sich der Schutz auf **beiden Servern** gleichzeitig pausieren (30 s bis 8 h) oder deaktivieren.

## Einrichtung

1. Repository in Home Assistant hinzufügen: **Einstellungen → Apps → App-Store → ⋮ → Repositories** → `https://github.com/netleader/dns-dashboard`
2. **DNS-Dashboard** installieren.
3. Unter **Konfiguration** die Server eintragen:

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

4. Starten und **In Seitenleiste anzeigen** aktivieren.

### AdGuard Home als Home-Assistant-App

Die AdGuard-Home-App in Home Assistant hat ihren Web-Port standardmäßig deaktiviert und ist nur über Ingress erreichbar. Damit das Dashboard (und AdGuard Home Sync) sie erreichen kann, muss in der AdGuard-App unter **Netzwerk** ein Port gesetzt sein. Verwende dieselbe URL, die AdGuard Home Sync für die Replica nutzt.

### AdGuard Home Sync

Die Sync-API läuft standardmäßig auf Port 8080. Ist `API_USERNAME`/`API_PASSWORD` gesetzt, trage beides als `sync_username`/`sync_password` ein. Der Zeitpunkt des letzten Syncs wird aus dem Status und – falls `API_METRICS_ENABLED` aktiv ist – aus den Prometheus-Metriken abgeleitet.

Eigene Regeln („Freigeben“/„Blockieren“) werden auf den **Origin** geschrieben und danach ein Sync ausgelöst. Den Origin erkennt das Dashboard automatisch aus AdGuard Home Sync (Option `origin: auto`). Ohne Sync werden Regeln auf alle Server geschrieben.

## Hinweise

- **DNS-Test:** Das Dashboard löst regelmäßig (`dns_probe_interval`, Standard 60 s) `dns_probe_domain` direkt über Port 53 auf. Diese Anfragen erscheinen im Query-Log. Wer das nicht möchte, legt in AdGuard Home einen Client für die IP von Home Assistant an und aktiviert dort „Query-Log ignorieren“ und „Statistik ignorieren“.
- **Historie:** AdGuard Home liefert stündliche Werte nur für die letzten 24 Stunden. Das Dashboard speichert sie selbst (`/data/history.db`), so dass längere Zeiträume mit der Zeit aufgefüllt werden. Einzelne Anfragen landen in `/data/raw.db` (Standard 7 Tage) und sind von Backups ausgeschlossen.
- **Zugriff:** Die Oberfläche ist nur über Home-Assistant-Ingress erreichbar; Zugangsdaten bleiben im Backend.
