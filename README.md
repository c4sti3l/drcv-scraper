# DRCV Herbern Live-Timing Recorder

Verbindet sich mit demselben WebSocket, den `drcv.de/herbern#/livetiming` benutzt
(`wss://drcv.spdns.de/live-timing/...`), zeichnet jede Ergebnis-Aktualisierung in
SQLite auf und stellt die Daten danach über eine kleine Weboberfläche bereit -
auch nachdem die Live-Ansicht auf drcv.de nach dem Rennen wieder leer ist.

## Starten (Docker)

```bash
docker compose up -d --build
```

Web-UI danach unter `http://<server>:8080`.

Die SQLite-Datei liegt in `./data/livetiming.db` (Volume-Mount, übersteht Neustarts/Updates).

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
