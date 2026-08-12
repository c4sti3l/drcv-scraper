const db = require("./db");
const { LiveTimingClient } = require("./wsClient");
const { Ingest } = require("./ingest");
const { createServer } = require("./server");

const DATA_DIR = process.env.DATA_DIR || "./data";
const DB_PATH = process.env.DB_PATH || `${DATA_DIR}/livetiming.db`;
const PORT = process.env.PORT || 8080;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

db.init(DB_PATH);
const ingest = new Ingest();

const client = new LiveTimingClient();
client.on("connected", () => log("WS verbunden"));
client.on("disconnected", () => log("WS getrennt, versuche erneut..."));
client.on("down", (reason) => log("WS nicht erreichbar:", reason));
client.on("parseError", (err, text) => log("WS: konnte Nachricht nicht parsen", err.message, text));
client.on("message", (type, data) => {
  try {
    ingest.handle(type, data);
  } catch (err) {
    log("Fehler beim Verarbeiten einer Nachricht:", err);
  }
});
client.start();

const app = createServer();
app.listen(PORT, () => log(`Ergebnisse abrufbar auf Port ${PORT}`));

process.on("SIGTERM", () => {
  client.stop();
  process.exit(0);
});
