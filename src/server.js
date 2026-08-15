const path = require("path");
const express = require("express");
const db = require("./db");

// Simple shared password so casual visitors can't delete runs by accident.
// Not real access control - set via DELETE_PASSWORD in docker-compose.
const DELETE_PASSWORD = process.env.DELETE_PASSWORD || "drcv26!";

function createServer() {
  const app = express();
  app.use(express.json());

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
    if (req.body?.password !== DELETE_PASSWORD) {
      return res.status(403).json({ error: "falsches Passwort" });
    }
    const run = db.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "not found" });
    db.deleteRun(req.params.id);
    res.json({ ok: true });
  });

  app.use(express.static(path.join(__dirname, "..", "public")));

  return app;
}

module.exports = { createServer };
