# DRCV Herbern Live-Timing Recorder

Verbindet sich mit demselben WebSocket, den `drcv.de/herbern#/livetiming` benutzt
(`wss://drcv.spdns.de/live-timing/...`), zeichnet jede Ergebnis-Aktualisierung in
SQLite auf und stellt die Daten danach über eine kleine Weboberfläche bereit -
auch nachdem die Live-Ansicht auf drcv.de nach dem Rennen wieder leer ist.

## Starten (Docker, lokal gebaut)

```bash
docker compose up -d --build
```

Web-UI danach unter `http://<server>:8080`.

Die SQLite-Datei liegt in `./data/livetiming.db` (Volume-Mount, übersteht Neustarts/Updates).

## Starten (Portainer / fertiges Image)

Bei jedem Push nach `main` baut [.github/workflows/docker-build.yml](.github/workflows/docker-build.yml)
automatisch ein Image und pusht es nach `ghcr.io/c4sti3l/drcv-scraper:latest`. Für Portainer
(Stacks → Add Stack → Web editor) reicht es, den Inhalt von
[docker-compose.portainer.yml](docker-compose.portainer.yml) einzufügen:

```yaml
services:
  drcv-livetiming:
    image: ghcr.io/c4sti3l/drcv-scraper:latest
    container_name: drcv-livetiming
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - drcv-data:/app/data

volumes:
  drcv-data:
```

**Wichtig:** Das GHCR-Package ist standardmäßig **privat**. Damit Portainer es ohne
Zugangsdaten pullen kann, einmalig auf public stellen:
GitHub → dein Profil → *Packages* → `drcv-scraper` → *Package settings* →
*Change visibility* → *Public*. Alternativ in Portainer unter *Registries* einen
GHCR-Zugang mit einem GitHub *Personal Access Token* (Scope `read:packages`) hinterlegen.

Nach jedem neuen Build in GitHub Actions muss der Stack in Portainer mit
*„Re-pull image and redeploy“* neu deployed werden, damit die neue Version gezogen wird.

## Ohne Docker

```bash
npm install
npm start
```

## Wie es funktioniert

- `src/wsClient.js` hält die WebSocket-Verbindung offen und reconnected automatisch
  (auch wenn der Server zwischen Rennen mit HTTP 502 antwortet, weil kein Live-Event läuft).
- `src/ingest.js` erkennt Lauf-Wechsel (Event/Gruppe/Lauf-Name), schreibt pro Fahrer den
  aktuellen Stand fort und rekonstruiert einzelne Rundenzeiten aus dem rollierenden
  3er-Fenster (`lasttime`/`secondlasttime`/`thirdlasttime`), das der Server mitschickt.
- `src/server.js` + `public/` stellen die aufgezeichneten Läufe als Liste und
  Ergebnistabelle (inkl. Rundenzeiten pro Fahrer) bereit.

## Bekannte Einschränkung

Wenn der Recorder mehr als 3 Updates hintereinander verpasst (z.B. Verbindungsabbruch
über mehrere Runden), können die dazwischenliegenden Einzelrundenzeiten nicht mehr
rekonstruiert werden - der Endstand (Platz, Gesamtzeit, Bestzeit) bleibt aber korrekt,
da er bei jedem Snapshot komplett mitgeschickt wird.
