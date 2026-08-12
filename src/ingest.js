const db = require("./db");
const { MSG_TYPES } = require("./wsClient");
const { parseInfo, parsePosRow } = require("./fields");

// Tracks the run currently being written to, plus per-driver lap counters
// so we can backfill lap_times from the rolling lasttime/secondlasttime/
// thirdlasttime window the server sends on every snapshot.
class Ingest {
  constructor() {
    this.current = null; // { id, tuple, lapState: Map<nr, laps> }
    const open = db.findOpenRun();
    if (open) {
      this.current = {
        id: open.id,
        tuple: { eventname: open.eventname, groupname: open.groupname, runname: open.runname },
        lapState: new Map(),
      };
    }
  }

  handle(type, data) {
    const receivedAt = new Date().toISOString();
    switch (type) {
      case MSG_TYPES.raceResult:
        this._handleRaceResult(data, receivedAt);
        break;
      case MSG_TYPES.message:
        db.insertMessage(this.current ? this.current.id : null, data, receivedAt);
        break;
      case MSG_TYPES.timestamp:
      case MSG_TYPES.sponsor:
        // Live clock ticks / sponsor image, not race data worth persisting.
        break;
      default:
        // Unused types (an, ev, es, tr, cm) - keep the raw payload in
        // case they turn out to matter later; frontend ignores them today.
        db.insertRawSnapshot(this.current ? this.current.id : null, type, data, receivedAt);
        break;
    }
  }

  _handleRaceResult(data, receivedAt) {
    if (!data || !Array.isArray(data.info)) return;
    const info = parseInfo(data.info);
    const pos = Array.isArray(data.pos) ? data.pos.map(parsePosRow) : [];

    const tuple = {
      eventname: info.eventname || "",
      groupname: info.groupname || "",
      runname: info.runname || "",
    };
    const isEmptyTuple = !tuple.eventname && !tuple.groupname && !tuple.runname;

    if (isEmptyTuple) {
      // No event data yet (idle screen) - nothing meaningful to record.
      return;
    }

    const tupleChanged =
      !this.current ||
      this.current.tuple.eventname !== tuple.eventname ||
      this.current.tuple.groupname !== tuple.groupname ||
      this.current.tuple.runname !== tuple.runname;

    if (tupleChanged) {
      if (this.current) db.closeRun(this.current.id, receivedAt);
      const runId = db.createRun(info, receivedAt);
      this.current = { id: runId, tuple, lapState: new Map() };
    } else {
      db.touchRun(this.current.id, info);
    }

    db.insertRawSnapshot(this.current.id, MSG_TYPES.raceResult, data, receivedAt);

    for (const row of pos) {
      if (!row.nr && row.nr !== 0) continue;
      const nr = String(row.nr);
      this._backfillLaps(nr, row, receivedAt);
      db.upsertDriverResult(this.current.id, row, receivedAt);
    }
  }

  _backfillLaps(nr, row, receivedAt) {
    const newLaps = toInt(row.laps);
    if (newLaps == null) return;

    let lastLaps = this.current.lapState.get(nr);
    if (lastLaps == null) {
      lastLaps = db.getLastKnownLaps(this.current.id, nr);
    }
    this.current.lapState.set(nr, newLaps);
    if (lastLaps == null) return; // first time we see this driver, nothing to backfill

    const delta = newLaps - lastLaps;
    if (delta <= 0) return;

    // Server only exposes the last 3 laptimes per snapshot, so if the
    // recorder missed more than 3 updates in a row the older laps in the
    // gap are unrecoverable - we just fill what the buffer still covers.
    const buffer = [
      { lap: newLaps, time: row.lasttime },
      { lap: newLaps - 1, time: row.secondlasttime },
      { lap: newLaps - 2, time: row.thirdlasttime },
    ];
    for (const { lap, time } of buffer) {
      if (lap > lastLaps && lap <= newLaps) {
        db.insertLapTime(this.current.id, nr, lap, time, receivedAt);
      }
    }
  }
}

function toInt(v) {
  if (v == null || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

module.exports = { Ingest };
