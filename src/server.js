const path = require("path");
const express = require("express");
const db = require("./db");

// Simple shared password so casual visitors can't delete runs by accident.
// Not real access control - set via DELETE_PASSWORD in docker-compose.
const DELETE_PASSWORD = process.env.DELETE_PASSWORD || "drcv26!";

function requireAuth(req, res) {
  if (req.body?.password !== DELETE_PASSWORD) {
    res.status(403).json({ error: "falsches Passwort" });
    return false;
  }
  return true;
}

function createServer() {
  const app = express();
  app.use(express.json());

  app.post("/api/verify-password", (req, res) => {
    if (!requireAuth(req, res)) return;
    res.json({ ok: true });
  });

  app.get("/api/runs", (req, res) => {
    res.json(db.listRuns());
  });

  app.get("/api/runs/:id", (req, res) => {
    const run = db.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "not found" });
    res.json({
      run,
      results: db.getDriverResults(req.params.id),
      messages: db.getMessages(req.params.id),
    });
  });

  app.get("/api/runs/:id/laptimes", (req, res) => {
    res.json(db.getLapTimes(req.params.id, req.query.nr));
  });

  app.delete("/api/runs/:id", (req, res) => {
    if (!requireAuth(req, res)) return;
    const run = db.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "not found" });
    db.deleteRun(req.params.id);
    res.json({ ok: true });
  });

  app.patch("/api/runs/:id", (req, res) => {
    if (!requireAuth(req, res)) return;
    const run = db.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "not found" });
    if ("race_id" in req.body) {
      const raw = req.body.race_id;
      const raceId = raw === null || raw === "" ? null : Number(raw);
      if (raceId != null && (!Number.isInteger(raceId) || !db.getRace(raceId))) {
        return res.status(400).json({ error: "Rennen nicht gefunden" });
      }
      db.assignRunRace(req.params.id, raceId);
    }
    res.json(db.getRun(req.params.id));
  });

  app.get("/api/races", (req, res) => {
    res.json(db.listRaces());
  });

  app.post("/api/races", (req, res) => {
    if (!requireAuth(req, res)) return;
    const name = (req.body?.name || "").toString().trim();
    if (!name) return res.status(400).json({ error: "Name fehlt" });
    res.json(db.createRace(name));
  });

  app.use(express.static(path.join(__dirname, "..", "public")));

  return app;
}

module.exports = { createServer };
