const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS races (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eventname TEXT,
  trackname TEXT,
  tracklength TEXT,
  groupname TEXT,
  runname TEXT,
  runtype TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  last_flag TEXT,
  best_lap_time TEXT,
  best_lap_by TEXT,
  race_id INTEGER REFERENCES races(id)
);

CREATE TABLE IF NOT EXISTS driver_results (
  run_id INTEGER NOT NULL REFERENCES runs(id),
  nr TEXT NOT NULL,
  transponder TEXT,
  fullname TEXT,
  club TEXT,
  teamname TEXT,
  class TEXT,
  position INTEGER,
  laps INTEGER,
  lasttime TEXT,
  secondlasttime TEXT,
  thirdlasttime TEXT,
  besttime TEXT,
  bestspeed TEXT,
  bestinlap TEXT,
  totaltime TEXT,
  difference TEXT,
  gap TEXT,
  lasttimeofday TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, nr)
);

CREATE TABLE IF NOT EXISTS lap_times (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  nr TEXT NOT NULL,
  lap_number INTEGER NOT NULL,
  laptime TEXT,
  recorded_at TEXT NOT NULL,
  UNIQUE(run_id, nr, lap_number)
);
CREATE INDEX IF NOT EXISTS idx_lap_times_run_nr ON lap_times(run_id, nr);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER,
  text TEXT,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_raw_snapshots_run ON raw_snapshots(run_id);
`;

let db;

function init(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  migrateRaces();
  return db;
}

// Older databases predate the races table/column - add it if it's missing.
// Runs stay unassigned until the operator sorts them into a race by hand.
function migrateRaces() {
  const cols = getDb().prepare(`PRAGMA table_info(runs)`).all();
  if (!cols.some((c) => c.name === "race_id")) {
    getDb().exec(`ALTER TABLE runs ADD COLUMN race_id INTEGER REFERENCES races(id)`);
  }
}

function getDb() {
  if (!db) throw new Error("db not initialized, call init() first");
  return db;
}

// --- runs -------------------------------------------------------------

function findOpenRun() {
  return getDb()
    .prepare(`SELECT * FROM runs WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1`)
    .get();
}

function createRun(info, startedAt) {
  const stmt = getDb().prepare(`
    INSERT INTO runs (eventname, trackname, tracklength, groupname, runname, runtype, started_at, last_flag, best_lap_time, best_lap_by)
    VALUES (@eventname, @trackname, @tracklength, @groupname, @runname, @runtype, @started_at, @flag, @bestlaptime, @bestlapby)
  `);
  const res = stmt.run({
    eventname: info.eventname ?? null,
    trackname: info.trackname ?? null,
    tracklength: info.tracklength ?? null,
    groupname: info.groupname ?? null,
    runname: info.runname ?? null,
    runtype: info.runtype ?? null,
    started_at: startedAt,
    flag: info.flag ?? null,
    bestlaptime: info.bestlaptime ?? null,
    bestlapby: info.bestlapby ?? null,
  });
  return res.lastInsertRowid;
}

function closeRun(runId, endedAt) {
  getDb().prepare(`UPDATE runs SET ended_at = ? WHERE id = ? AND ended_at IS NULL`).run(endedAt, runId);
}

function touchRun(runId, info) {
  getDb()
    .prepare(
      `UPDATE runs SET last_flag = ?, best_lap_time = ?, best_lap_by = ? WHERE id = ?`
    )
    .run(info.flag ?? null, info.bestlaptime ?? null, info.bestlapby ?? null, runId);
}

// --- driver_results -----------------------------------------------------

const upsertDriverStmt = () =>
  getDb().prepare(`
    INSERT INTO driver_results (
      run_id, nr, transponder, fullname, club, teamname, class, position, laps,
      lasttime, secondlasttime, thirdlasttime, besttime, bestspeed, bestinlap,
      totaltime, difference, gap, lasttimeofday, updated_at
    ) VALUES (
      @run_id, @nr, @transponder, @fullname, @club, @teamname, @class, @position, @laps,
      @lasttime, @secondlasttime, @thirdlasttime, @besttime, @bestspeed, @bestinlap,
      @totaltime, @difference, @gap, @lasttimeofday, @updated_at
    )
    ON CONFLICT(run_id, nr) DO UPDATE SET
      transponder=excluded.transponder, fullname=excluded.fullname, club=excluded.club,
      teamname=excluded.teamname, class=excluded.class, position=excluded.position,
      laps=excluded.laps, lasttime=excluded.lasttime, secondlasttime=excluded.secondlasttime,
      thirdlasttime=excluded.thirdlasttime, besttime=excluded.besttime, bestspeed=excluded.bestspeed,
      bestinlap=excluded.bestinlap, totaltime=excluded.totaltime, difference=excluded.difference,
      gap=excluded.gap, lasttimeofday=excluded.lasttimeofday, updated_at=excluded.updated_at
  `);

function upsertDriverResult(runId, pos, receivedAt) {
  upsertDriverStmt().run({
    run_id: runId,
    nr: String(pos.nr ?? ""),
    transponder: pos.transponder ?? null,
    fullname: pos.fullname ?? null,
    club: pos.club ?? null,
    teamname: pos.teamname ?? null,
    class: pos.class ?? null,
    position: pos.position != null && pos.position !== "" ? Number(pos.position) : null,
    laps: pos.laps != null && pos.laps !== "" ? Number(pos.laps) : null,
    lasttime: pos.lasttime ?? null,
    secondlasttime: pos.secondlasttime ?? null,
    thirdlasttime: pos.thirdlasttime ?? null,
    besttime: pos.besttime ?? null,
    bestspeed: pos.bestspeed ?? null,
    bestinlap: pos.bestinlap ?? null,
    totaltime: pos.totaltime ?? null,
    difference: pos.difference ?? null,
    gap: pos.gap ?? null,
    lasttimeofday: pos.lasttimeofday ?? null,
    updated_at: receivedAt,
  });
}

function getLastKnownLaps(runId, nr) {
  const row = getDb()
    .prepare(`SELECT laps FROM driver_results WHERE run_id = ? AND nr = ?`)
    .get(runId, String(nr));
  return row ? row.laps : null;
}

// --- lap_times ------------------------------------------------------------

const insertLapStmt = () =>
  getDb().prepare(`
    INSERT OR IGNORE INTO lap_times (run_id, nr, lap_number, laptime, recorded_at)
    VALUES (?, ?, ?, ?, ?)
  `);

function insertLapTime(runId, nr, lapNumber, laptime, recordedAt) {
  if (laptime == null || laptime === "") return;
  insertLapStmt().run(runId, String(nr), lapNumber, laptime, recordedAt);
}

// --- messages / raw_snapshots ----------------------------------------------

function insertMessage(runId, text, receivedAt) {
  getDb()
    .prepare(`INSERT INTO messages (run_id, text, received_at) VALUES (?, ?, ?)`)
    .run(runId ?? null, text ?? null, receivedAt);
}

function insertRawSnapshot(runId, type, payload, receivedAt) {
  getDb()
    .prepare(`INSERT INTO raw_snapshots (run_id, type, payload, received_at) VALUES (?, ?, ?, ?)`)
    .run(runId ?? null, type, JSON.stringify(payload), receivedAt);
}

function deleteRun(runId) {
  const run = getDb().transaction((id) => {
    getDb().prepare(`DELETE FROM driver_results WHERE run_id = ?`).run(id);
    getDb().prepare(`DELETE FROM lap_times WHERE run_id = ?`).run(id);
    getDb().prepare(`DELETE FROM messages WHERE run_id = ?`).run(id);
    getDb().prepare(`DELETE FROM raw_snapshots WHERE run_id = ?`).run(id);
    getDb().prepare(`DELETE FROM runs WHERE id = ?`).run(id);
  });
  run(runId);
}

// --- queries for the API ----------------------------------------------------

function listRuns() {
  return getDb()
    .prepare(
      `SELECT runs.id, runs.eventname, runs.trackname, runs.groupname, runs.runname, runs.runtype,
              runs.started_at, runs.ended_at, runs.race_id,
              races.name AS race_name,
              (SELECT COUNT(*) FROM driver_results d WHERE d.run_id = runs.id) AS driver_count
       FROM runs LEFT JOIN races ON races.id = runs.race_id
       ORDER BY runs.started_at DESC`
    )
    .all();
}

function getRun(runId) {
  return getDb()
    .prepare(
      `SELECT runs.*, races.name AS race_name
       FROM runs LEFT JOIN races ON races.id = runs.race_id
       WHERE runs.id = ?`
    )
    .get(runId);
}

// --- races --------------------------------------------------------------

function listRaces() {
  return getDb()
    .prepare(
      `SELECT races.id, races.name, races.created_at,
              COUNT(runs.id) AS run_count,
              SUM(CASE WHEN runs.id IS NOT NULL AND runs.ended_at IS NULL THEN 1 ELSE 0 END) AS live_count,
              MAX(runs.started_at) AS last_started_at
       FROM races LEFT JOIN runs ON runs.race_id = races.id
       GROUP BY races.id
       ORDER BY COALESCE(last_started_at, races.created_at) DESC`
    )
    .all();
}

function getRace(raceId) {
  return getDb().prepare(`SELECT * FROM races WHERE id = ?`).get(raceId);
}

function createRace(name) {
  const res = getDb()
    .prepare(`INSERT INTO races (name, archived, created_at) VALUES (?, 0, ?)`)
    .run(name, new Date().toISOString());
  return getRace(res.lastInsertRowid);
}

function assignRunRace(runId, raceId) {
  getDb().prepare(`UPDATE runs SET race_id = ? WHERE id = ?`).run(raceId, runId);
  return getRun(runId);
}

function getDriverResults(runId) {
  return getDb()
    .prepare(
      `SELECT * FROM driver_results WHERE run_id = ? ORDER BY (position IS NULL), position ASC`
    )
    .all(runId);
}

function getLapTimes(runId, nr) {
  if (nr) {
    return getDb()
      .prepare(`SELECT * FROM lap_times WHERE run_id = ? AND nr = ? ORDER BY lap_number ASC`)
      .all(runId, String(nr));
  }
  return getDb()
    .prepare(`SELECT * FROM lap_times WHERE run_id = ? ORDER BY nr, lap_number ASC`)
    .all(runId);
}

function getMessages(runId) {
  return getDb()
    .prepare(`SELECT * FROM messages WHERE run_id = ? ORDER BY id ASC`)
    .all(runId);
}

module.exports = {
  init,
  getDb,
  findOpenRun,
  createRun,
  closeRun,
  touchRun,
  upsertDriverResult,
  getLastKnownLaps,
  insertLapTime,
  insertMessage,
  insertRawSnapshot,
  deleteRun,
  listRuns,
  getRun,
  getDriverResults,
  getLapTimes,
  getMessages,
  listRaces,
  getRace,
  createRace,
  assignRunRace,
};
