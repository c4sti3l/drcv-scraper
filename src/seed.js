// Fills a brand-new (empty) database with demo runs so the archive isn't
// blank while waiting for a real event. Only ever called once, when
// index.js detects the db file didn't exist before this boot - real
// recorded data is never touched or overwritten by this.
const db = require("./db");

function fmt(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

let seed = 42;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

// Real entries from the RG Ahlen 08./09.08.2026 Nennungsliste
// (drcv.de/storage/Rennen/aktuell/Ahlen/3.1_Nennungsliste_Meisterschaft.pdf) -
// only lap times below are made up, names/clubs/numbers/classes are real.
const ROSTERS = {
  "Klasse 1": [
    { nr: "101", fullname: "Mike Hellweg", club: "AC Vellern e.V.", teamname: "Team Hellweg" },
    { nr: "109", fullname: "Hendrik Jahn", club: "ARCC Werlte e.V.", teamname: "Team Lerche Wichmann" },
    { nr: "113", fullname: "Hans Nijhuis", club: "MSC Herbern e.V.", teamname: "Racing Team Steinmeijer" },
    { nr: "120", fullname: "Jasper Jürries", club: "RG Itterbeck e.V.", teamname: "JJ Racing Team Jürries" },
    { nr: "122", fullname: "Gerhard Moskopp", club: "RCC Hamm e.V.", teamname: "Brickmann Racing Team" },
    { nr: "123", fullname: "Jan Tolksdorf", club: "ATC Osnabrück e.V.", teamname: "Team Tolksdorf" },
  ],
  "Klasse 5": [
    { nr: "501", fullname: "Marc Schauseil", club: "RG Ahlen e.V.", teamname: "Racing Team Velbert" },
    { nr: "502", fullname: "Rolf Busche", club: "AC Vellern e.V.", teamname: "Autocross Team Kerstingjohänner" },
    { nr: "505", fullname: "Christian Schulze-Wettendorf", club: "AC Vellern e.V.", teamname: "Plan B" },
    { nr: "566", fullname: "Michiel Tiggeloven", club: "", teamname: "Autocross Ripperda" },
    { nr: "588", fullname: "Werner Reibeholz", club: "", teamname: "Black Bomber Racing" },
    { nr: "589", fullname: "Björn Müller", club: "ACC Oldenburg e.V.", teamname: "Team Fast Farmer" },
  ],
  "Klasse 8": [
    { nr: "801", fullname: "Jordy Hindriksen", club: "RG Itterbeck e.V.", teamname: "Team Schoemaker" },
    { nr: "808", fullname: "Florian Schäfer", club: "MSC Hesb., MC Sachsenberg, ACT Dau.", teamname: "Schäfer Racing" },
    { nr: "815", fullname: "Andre Wibbeler", club: "AC Vellern e.V.", teamname: "08/15" },
    { nr: "826", fullname: "Markus Wibbeler", club: "RCC Münster e.V.", teamname: "ACT Dauborn/Team WKS" },
    { nr: "828", fullname: "Marvin Holzleitner", club: "AC Vellern e.V.", teamname: "WTM Motorsport" },
    { nr: "832", fullname: "Maurice Brickmann", club: "RCC Hamm e.V.", teamname: "Brickmann Racing Team" },
  ],
};

const CLASSES = [
  { groupname: "Klasse 1", laneBase: 38.5 },
  { groupname: "Klasse 5", laneBase: 33.0 },
  { groupname: "Klasse 8", laneBase: 31.5 },
];
const ROUNDS = [
  { runname: "Training 1", runtype: "Training", laps: 3 },
  { runname: "Training 2", runtype: "Training", laps: 3 },
  { runname: "Meisterschaftslauf 1", runtype: "Meisterschaft", laps: 6 },
  { runname: "Meisterschaftslauf 2", runtype: "Meisterschaft", laps: 6 },
  { runname: "Meisterschaftslauf 3", runtype: "Meisterschaft", laps: 6 },
];
const SCHEDULE = ROUNDS.flatMap((round, roundIdx) =>
  CLASSES.map((c) => ({
    groupname: c.groupname,
    runname: round.runname,
    runtype: round.runtype,
    laps: round.laps,
    laneBase: c.laneBase - roundIdx * 0.25,
  }))
);

function seedRun({ eventname, trackname, tracklength, groupname, runname, runtype, started_at, ended_at, lapsSoFar, laneBase }) {
  const roster = ROSTERS[groupname];
  const tracklengthMeters = parseInt(tracklength, 10) || 800;

  const driverLaps = roster.map((d, i) => {
    const baseLap = laneBase + i * 0.35;
    const laps = [];
    for (let l = 1; l <= lapsSoFar; l++) {
      const variance = (rnd() - 0.5) * 1.2;
      laps.push(Math.max(baseLap + variance, baseLap - 0.6));
    }
    return { ...d, laps };
  });

  const rows = driverLaps.map((d) => {
    const n = d.laps.length;
    const total = d.laps.reduce((a, b) => a + b, 0);
    const best = n ? Math.min(...d.laps) : null;
    return {
      nr: d.nr,
      fullname: d.fullname,
      club: d.club,
      teamname: d.teamname,
      class: groupname,
      laps: n,
      lasttime: n ? fmt(d.laps[n - 1]) : "",
      secondlasttime: n >= 2 ? fmt(d.laps[n - 2]) : "",
      thirdlasttime: n >= 3 ? fmt(d.laps[n - 3]) : "",
      besttime: best != null ? fmt(best) : "",
      bestspeed: best != null ? ((tracklengthMeters / best) * 3.6).toFixed(1) : "",
      totaltime_sec: total,
      totaltime: n ? fmt(total) : "",
      _laps: d.laps,
    };
  });

  const hasAnyLaps = rows.some((r) => r.laps > 0);
  rows.sort((a, b) => a.totaltime_sec - b.totaltime_sec);
  const leader = rows[0].totaltime_sec;
  rows.forEach((r, i) => {
    r.position = hasAnyLaps ? i + 1 : null;
    r.difference = !hasAnyLaps || i === 0 ? "" : "+" + fmt(r.totaltime_sec - leader);
    r.gap = !hasAnyLaps || i === 0 ? "" : "+" + fmt(r.totaltime_sec - rows[i - 1].totaltime_sec);
  });

  const overallBest = driverLaps.reduce((acc, d) => {
    if (!d.laps.length) return acc;
    const min = Math.min(...d.laps);
    return min < acc.time ? { time: min, by: d.fullname } : acc;
  }, { time: Infinity, by: "" });

  const info = {
    eventname,
    trackname,
    tracklength,
    groupname,
    runname,
    runtype,
    flag: ended_at ? "02" : "10",
    bestlaptime: Number.isFinite(overallBest.time) ? fmt(overallBest.time) : "",
    bestlapby: overallBest.by,
  };

  const runId = db.createRun(info, started_at);
  for (const r of rows) {
    db.upsertDriverResult(runId, r, started_at);
    r._laps.forEach((t, idx) => db.insertLapTime(runId, r.nr, idx + 1, fmt(t), started_at));
  }
  db.insertMessage(runId, "Rennen gestartet", started_at);
  if (ended_at) db.closeRun(runId, ended_at);
}

function run() {
  let clock = Date.parse("2026-08-08T09:00:00.000Z");
  SCHEDULE.forEach((s, i) => {
    const started_at = new Date(clock).toISOString();
    const durationMs = s.laps * (s.laneBase + 1) * 1000;
    clock += durationMs + 4 * 60 * 1000;
    const stillRunning = i === SCHEDULE.length - 1;
    seedRun({
      eventname: "RG Ahlen (Demo-Daten)",
      trackname: "Crossstrecke Ahlen",
      tracklength: "780 m",
      groupname: s.groupname,
      runname: s.runname,
      runtype: s.runtype,
      started_at,
      ended_at: stillRunning ? null : new Date(clock - 4 * 60 * 1000).toISOString(),
      lapsSoFar: s.laps,
      laneBase: s.laneBase,
    });
  });
}

module.exports = { run };
