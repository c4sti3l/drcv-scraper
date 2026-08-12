const WebSocket = require("ws");
const EventEmitter = require("events");

// Same endpoint the drcv.de frontend connects to (found in LiveTiming-*.js).
// The path segment is fixed, base64("live-timing") - not per-event.
const WS_URL = "wss://drcv.spdns.de/live-timing/bGl2ZS10aW1pbmc=";

const MSG_TYPES = {
  raceResult: "rr",
  announcements: "an",
  events: "ev",
  eventSchedule: "es",
  tracks: "tr",
  message: "ms",
  command: "cm",
  sponsor: "sp",
  timestamp: "ts",
};

const RECONNECT_MS = 5000;
// While the backend is down (no live event running) the reverse proxy answers
// with 502 on every handshake attempt. Don't spam the log for every retry.
const DOWN_LOG_INTERVAL_MS = 5 * 60 * 1000;

// A browser always sends the page's real origin and can't be told to send
// anything else. We can, so mimic drcv.de's frontend in case the handshake
// ever gets checked against these headers (harmless if it doesn't).
const WS_CONNECT_OPTIONS = {
  origin: "https://drcv.de",
  headers: { Referer: "https://drcv.de/herbern" },
};

class LiveTimingClient extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.reconnectTimer = null;
    this.connected = false;
    this.lastDownLogAt = 0;
  }

  start() {
    this._connect();
  }

  stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  _connect() {
    let ws;
    try {
      ws = new WebSocket(WS_URL, WS_CONNECT_OPTIONS);
    } catch (err) {
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on("open", () => {
      this.connected = true;
      this.emit("connected");
      const req = { t: MSG_TYPES.raceResult, d: "" };
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(req));
      }, 0);
    });

    ws.on("message", (data) => {
      const text = data.toString();
      if (!text) return;
      let msg;
      try {
        msg = JSON.parse(text);
      } catch (err) {
        this.emit("parseError", err, text);
        return;
      }
      if (typeof msg.t === "undefined") return;
      this.emit("message", msg.t, msg.d);
    });

    ws.on("unexpected-response", (req, res) => {
      res.resume();
      this._logDown(`handshake failed with HTTP ${res.statusCode}`);
      this._teardown();
      this._scheduleReconnect();
    });

    ws.on("error", (err) => {
      this._logDown(`connection error: ${err.message}`);
    });

    ws.on("close", () => {
      if (this.connected) {
        this.connected = false;
        this.emit("disconnected");
      }
      this._teardown();
      this._scheduleReconnect();
    });
  }

  _teardown() {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }
  }

  _logDown(reason) {
    const now = Date.now();
    if (now - this.lastDownLogAt > DOWN_LOG_INTERVAL_MS) {
      this.lastDownLogAt = now;
      this.emit("down", reason);
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, RECONNECT_MS);
  }
}

module.exports = { LiveTimingClient, MSG_TYPES, WS_URL };
