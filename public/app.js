const app = document.getElementById("app");

let runsCache = null;
let racesCache = null;
let resultsByRun = {};
let scrollHandler = null;
let activeFilter = "all";
let raceDetailFilter = "all";
let editMode = false;
let selectedRunIds = new Set();
let visibleRunIds = [];
let currentListView = "list"; // "list" | "race" - which page edit-mode actions apply to
let currentRunResults = [];
let currentRunFastestSec = Infinity;
let runSearchQuery = "";
let currentRaceId = null;

const ICON_CHEVRON = `<svg class="chevron" viewBox="0 0 8 14" fill="none" aria-hidden="true"><path d="M1 1L7 7L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_BACK = `<svg viewBox="0 0 12 20" fill="none" width="1.05em" height="1.05em" aria-hidden="true"><path d="M10 1L2 10L10 19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_TRASH = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 4h11M6 4V2.5h4V4M3.5 4l.6 9.5a1 1 0 0 0 1 .9h5.8a1 1 0 0 0 1-.9L12.5 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_SAVE = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const ICON_CLOSE = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const ICON_SUN = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="3.2" stroke="currentColor" stroke-width="1.4"/><path d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1M12.7 12.7l-1.1-1.1M4.4 4.4L3.3 3.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const ICON_MOON = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13.5 9.7A6 6 0 1 1 6.3 2.5a5 5 0 0 0 7.2 7.2Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

// ---------- theme ----------

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function applyThemeColorMeta(theme) {
  const meta = document.getElementById("theme-color-meta");
  if (meta) meta.content = theme === "light" ? "#f2f2f7" : "#000000";
}

function toggleTheme() {
  const next = currentTheme() === "light" ? "dark" : "light";
  if (next === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
  localStorage.setItem("drcv-theme", next);
  applyThemeColorMeta(next);
  document.querySelectorAll(".theme-btn").forEach((btn) => { btn.innerHTML = themeIcon(next); });
}

function themeIcon(theme) {
  return theme === "light" ? ICON_MOON : ICON_SUN;
}

function themeToggleHtml() {
  return `<button class="edit-btn theme-btn" onclick="toggleTheme()" aria-label="Zwischen Hell- und Dunkelmodus wechseln">${themeIcon(currentTheme())}</button>`;
}

applyThemeColorMeta(currentTheme());

function esc(s) {
  return (s ?? "").toString().replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("de-DE");
}

function fmtDateShort(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

function parseTimeToSeconds(t) {
  if (!t) return Infinity;
  const parts = t.split(":");
  return parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(t);
}

// A run without ended_at only counts as "live" while its start date is still
// today - otherwise it's a stale run that never got closed properly (e.g.
// after a restart) and belongs under "Beendet" instead of blinking forever.
function isLiveRun(r) {
  if (r.ended_at || !r.started_at) return false;
  const d = new Date(r.started_at);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// ---------- navigation / view transitions ----------

async function withTransition(update) {
  if (document.startViewTransition) {
    const t = document.startViewTransition(update);
    await t.finished.catch(() => {});
  } else {
    await update();
  }
}

async function render() {
  const hash = location.hash.replace(/^#\/?/, "");
  await withTransition(async () => {
    if (hash.startsWith("run/")) {
      await renderRun(hash.slice(4));
    } else if (hash === "races") {
      await renderRaces();
    } else if (hash.startsWith("race/")) {
      await renderRaceRuns(hash.slice(5));
    } else {
      await renderList();
    }
  });
  attachScrollListener();
}

function attachScrollListener() {
  if (scrollHandler) window.removeEventListener("scroll", scrollHandler);
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  scrollHandler = () => topbar.classList.toggle("scrolled", window.scrollY > 2);
  scrollHandler();
  window.addEventListener("scroll", scrollHandler, { passive: true });
}

// ---------- shared markup ----------

function topbarHtml({ backHash, backLabel, title, subtitleHtml, actionHtml }) {
  return `
    <header class="topbar">
      ${backHash || actionHtml ? `
        <div class="topbar-row">
          ${backHash ? `<a class="back-btn" href="${backHash}">${ICON_BACK}<span>${esc(backLabel || "Läufe")}</span></a>` : "<span></span>"}
          ${actionHtml || ""}
        </div>` : ""}
      <h1 class="title">${esc(title)}</h1>
      ${subtitleHtml ? `<div class="subtitle">${subtitleHtml}</div>` : ""}
    </header>`;
}

function emptyState(text) {
  return `<div class="empty">${esc(text)}</div>`;
}

function skeletonGroup(n) {
  return `<div class="group">${Array.from({ length: n }).map(() => '<div class="skeleton-row"></div>').join("")}</div>`;
}

// ---------- run list ----------

async function renderList() {
  if (!runsCache) {
    app.innerHTML = topbarHtml({ title: "Live-Timing" }) + `<main>${skeletonGroup(4)}</main>`;
  }
  await reloadListData(false);
}

async function reloadListData(animate) {
  const [runs, races] = await Promise.all([
    fetch("/api/runs").then((r) => r.json()),
    fetch("/api/races").then((r) => r.json()),
  ]);
  runsCache = runs;
  racesCache = races;
  const update = () => renderListFromCache();
  if (animate === false) {
    update();
  } else if (document.startViewTransition) {
    await document.startViewTransition(update).finished.catch(() => {});
  } else {
    update();
  }
}

function renderListFromCache() {
  currentListView = "list";
  const allRuns = runsCache || [];
  const races = racesCache || [];

  // Only runs nobody has sorted into a race yet show up here - as soon as a
  // run is assigned it moves to that race's page under "Vergangene Rennen".
  const runs = allRuns.filter((r) => r.race_id == null);

  const groups = [...new Set(runs.map((r) => r.groupname).filter(Boolean))];
  if (activeFilter !== "all" && !groups.includes(activeFilter)) activeFilter = "all";
  const filtered = activeFilter === "all" ? runs : runs.filter((r) => r.groupname === activeFilter);
  visibleRunIds = filtered.map((r) => r.id);

  const live = filtered.filter(isLiveRun);
  const done = filtered.filter((r) => !isLiveRun(r));

  const pills = ["all", ...groups]
    .map((g) => `<button class="filter-pill ${activeFilter === g ? "active" : ""}" onclick="setFilter('${esc(g)}')">${g === "all" ? "Alle" : esc(g)}</button>`)
    .join("");

  const pastRacesBtn = races.length
    ? `<button class="edit-btn" onclick="location.hash='#/races'">Vergangene Rennen</button>`
    : "";
  const editBtn = `<button class="edit-btn" onclick="toggleEditMode()">${editMode ? "Fertig" : "Bearbeiten"}</button>`;
  const actions = `<div class="topbar-actions">${pastRacesBtn}${editBtn}${themeToggleHtml()}</div>`;

  const eventnames = [...new Set(runs.map((r) => r.eventname).filter(Boolean))];
  const countLabel = races.length ? `${runs.length} Läufe ohne Rennen` : `${runs.length} Läufe aufgezeichnet`;
  const subtitle = eventnames.length === 1 ? `${esc(eventnames[0])} &middot; ${countLabel}` : countLabel;

  const emptyText = allRuns.length && !runs.length
    ? "Alle Läufe sind bereits einem Rennen zugeordnet."
    : "Noch keine Läufe aufgezeichnet.";

  app.innerHTML = `
    ${topbarHtml({ title: "Live-Timing", subtitleHtml: subtitle, actionHtml: actions })}
    <main>
      ${editMode ? selectionToolsHtml(visibleRunIds, races, null, false) : ""}
      ${groups.length > 1 ? `<div class="filter-scroll"><div class="filter-row">${pills}</div></div>` : ""}
      ${!filtered.length ? emptyState(emptyText) : [
        live.length ? sectionHtml("Live", live, true) : "",
        done.length ? sectionHtml("Beendet", done, false) : "",
      ].join("")}
    </main>`;
}

function setFilter(g) {
  activeFilter = g;
  const update = () => renderListFromCache();
  if (document.startViewTransition) document.startViewTransition(update);
  else update();
}

function currentViewRender() {
  if (currentListView === "race") renderRaceRunsFromCache();
  else renderListFromCache();
}

async function toggleEditMode() {
  if (!editMode) {
    const ok = await ensureAuth();
    if (!ok) return;
  } else {
    selectedRunIds.clear();
  }
  editMode = !editMode;
  const update = currentViewRender;
  if (document.startViewTransition) document.startViewTransition(update);
  else update();
}

// ---------- races ----------

// excludeRaceId hides that race from the assign targets (no point offering
// to "move" a run into the race it's already in); showUnassign adds a
// "Kein Rennen" action for fixing a run sorted into the wrong race.
function selectionToolsHtml(ids, races, excludeRaceId, showUnassign) {
  const n = selectedRunIds.size;
  const allSelected = ids.length > 0 && ids.every((id) => selectedRunIds.has(id));
  const selectionBar = ids.length ? `
    <div class="selection-bar">
      <button class="text-btn" onclick="toggleSelectAll()">${allSelected ? "Keine auswählen" : "Alle auswählen"}</button>
      <span class="selection-count">${n ? `${n} ausgewählt` : ""}</span>
      <div class="selection-actions">
        ${showUnassign ? `<button class="text-btn" ${n ? "" : "disabled"} onclick="assignSelectedToRace(null)">Kein Rennen</button>` : ""}
        <button class="text-btn danger" ${n ? "" : "disabled"} onclick="deleteSelectedRuns()">Löschen</button>
      </div>
    </div>` : "";
  const raceRows = races.filter((r) => r.id !== excludeRaceId).map((r) => `
    <div class="row race-row">
      <div class="row-main">
        <div class="row-title">${esc(r.name)}</div>
        <div class="row-meta">${r.run_count} ${r.run_count === 1 ? "Lauf" : "Läufe"}</div>
      </div>
      <button class="assign-btn" ${n ? "" : "disabled"} onclick="assignSelectedToRace(${r.id})">Zuordnen</button>
    </div>`).join("");
  return `
    ${selectionBar}
    <div class="section-header edit-races-header">Rennen</div>
    <div class="group race-manager-group">
      ${raceRows}
      <div class="row race-row" tabindex="0" role="button" onclick="createRacePrompt()" onkeydown="if(event.key==='Enter')createRacePrompt()">
        <div class="row-main"><div class="row-title new-race-title">+ Neues Rennen${n ? " & zuordnen" : ""}</div></div>
      </div>
    </div>`;
}

function toggleRunSelection(id) {
  if (selectedRunIds.has(id)) selectedRunIds.delete(id);
  else selectedRunIds.add(id);
  currentViewRender();
}

function toggleSelectAll() {
  const allSelected = visibleRunIds.length > 0 && visibleRunIds.every((id) => selectedRunIds.has(id));
  if (allSelected) visibleRunIds.forEach((id) => selectedRunIds.delete(id));
  else visibleRunIds.forEach((id) => selectedRunIds.add(id));
  currentViewRender();
}

function clearSelection() {
  selectedRunIds.clear();
  currentViewRender();
}

async function deleteSelectedRuns() {
  const ids = [...selectedRunIds];
  if (!ids.length) return;
  if (!confirm(`${ids.length} ${ids.length === 1 ? "Lauf" : "Läufe"} wirklich löschen?`)) return;
  const password = getCachedDeletePassword();
  const results = await Promise.all(ids.map((id) =>
    fetch(`/api/runs/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) })
  ));
  if (results.some((r) => r.status === 403)) alert("Falsches Passwort.");
  selectedRunIds.clear();
  await reloadCurrentView();
}

async function assignSelectedToRace(raceId) {
  const ids = [...selectedRunIds];
  if (!ids.length) return;
  const password = getCachedDeletePassword();
  const results = await Promise.all(ids.map((id) =>
    fetch(`/api/runs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, race_id: raceId }),
    })
  ));
  if (results.some((r) => r.status === 403)) alert("Falsches Passwort.");
  selectedRunIds.clear();
  await reloadCurrentView();
}

async function reloadCurrentView() {
  const [runs, races] = await Promise.all([
    fetch("/api/runs").then((r) => r.json()),
    fetch("/api/races").then((r) => r.json()),
  ]);
  runsCache = runs;
  racesCache = races;
  currentViewRender();
}

async function createRacePrompt() {
  const name = prompt("Name für das neue Rennen:");
  if (name == null || !name.trim()) return;
  const password = getCachedDeletePassword();
  const res = await fetch("/api/races", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim(), password }),
  });
  if (res.status === 403) { alert("Falsches Passwort."); return; }
  if (!res.ok) { alert("Rennen konnte nicht erstellt werden."); return; }
  const race = await res.json();
  if (selectedRunIds.size) await assignSelectedToRace(race.id);
  else await reloadCurrentView();
}

// ---------- password auth ----------

async function verifyPassword(password) {
  const res = await fetch("/api/verify-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return res.ok;
}

async function ensureAuth() {
  const cached = getCachedDeletePassword();
  if (cached != null) {
    if (await verifyPassword(cached)) return true;
    localStorage.removeItem(DELETE_AUTH_KEY);
  }
  const password = prompt("Passwort:");
  if (password === null) return false;
  if (!(await verifyPassword(password))) {
    alert("Falsches Passwort.");
    return false;
  }
  cacheDeletePassword(password);
  return true;
}

// ---------- Vergangene Rennen ----------

async function renderRaces() {
  editMode = false;
  if (!racesCache) {
    app.innerHTML = topbarHtml({ backHash: "#/", title: "Vergangene Rennen" }) + `<main>${skeletonGroup(3)}</main>`;
  }
  racesCache = await fetch("/api/races").then((r) => r.json());
  renderRacesFromCache();
}

function renderRacesFromCache() {
  const races = racesCache || [];
  const actions = `<div class="topbar-actions">${themeToggleHtml()}</div>`;
  app.innerHTML = `
    ${topbarHtml({ backHash: "#/", title: "Vergangene Rennen", subtitleHtml: `${races.length} ${races.length === 1 ? "Rennen" : "Rennen"}`, actionHtml: actions })}
    <main>
      ${!races.length ? emptyState("Noch keine Läufe einem Rennen zugeordnet.") : `<div class="group">${races.map(raceRowHtml).join("")}</div>`}
    </main>`;
}

function raceRowHtml(r) {
  return `
    <div class="row" tabindex="0" role="link" onclick="location.hash='#/race/${r.id}'" onkeydown="if(event.key==='Enter')location.hash='#/race/${r.id}'">
      <div class="row-main">
        <div class="row-title">${esc(r.name)}</div>
        <div class="row-meta">${r.run_count} ${r.run_count === 1 ? "Lauf" : "Läufe"}</div>
      </div>
      <div class="row-trail">${ICON_CHEVRON}</div>
    </div>`;
}

async function renderRaceRuns(id) {
  editMode = false;
  raceDetailFilter = "all";
  currentRaceId = Number(id);
  const [runs, races] = await Promise.all([
    fetch("/api/runs").then((r) => r.json()),
    fetch("/api/races").then((r) => r.json()),
  ]);
  runsCache = runs;
  racesCache = races;
  renderRaceRunsFromCache();
}

function renderRaceRunsFromCache() {
  currentListView = "race";
  const races = racesCache || [];
  const race = races.find((r) => r.id === currentRaceId);
  const allRuns = (runsCache || []).filter((r) => r.race_id === currentRaceId);

  const groups = [...new Set(allRuns.map((r) => r.groupname).filter(Boolean))];
  if (raceDetailFilter !== "all" && !groups.includes(raceDetailFilter)) raceDetailFilter = "all";
  const runs = raceDetailFilter === "all" ? allRuns : allRuns.filter((r) => r.groupname === raceDetailFilter);
  visibleRunIds = runs.map((r) => r.id);

  const pills = ["all", ...groups]
    .map((g) => `<button class="filter-pill ${raceDetailFilter === g ? "active" : ""}" onclick="setRaceDetailFilter('${esc(g)}')">${g === "all" ? "Alle" : esc(g)}</button>`)
    .join("");

  const live = runs.filter(isLiveRun);
  const done = runs.filter((r) => !isLiveRun(r));

  const editBtn = allRuns.length
    ? `<button class="edit-btn" onclick="toggleEditMode()">${editMode ? "Fertig" : "Bearbeiten"}</button>`
    : "";
  const actions = `<div class="topbar-actions">${editBtn}${themeToggleHtml()}</div>`;

  app.innerHTML = `
    ${topbarHtml({
      backHash: "#/races",
      backLabel: "Vergangene Rennen",
      title: race ? race.name : "Rennen",
      subtitleHtml: `${allRuns.length} ${allRuns.length === 1 ? "Lauf" : "Läufe"}`,
      actionHtml: actions,
    })}
    <main>
      ${editMode ? selectionToolsHtml(visibleRunIds, races, currentRaceId, true) : ""}
      ${groups.length > 1 ? `<div class="filter-scroll"><div class="filter-row">${pills}</div></div>` : ""}
      ${!runs.length ? emptyState("Keine Läufe in diesem Rennen.") : [
        live.length ? sectionHtml("Live", live, true) : "",
        done.length ? sectionHtml("Beendet", done, false) : "",
      ].join("")}
    </main>`;
}

function setRaceDetailFilter(g) {
  raceDetailFilter = g;
  const update = () => renderRaceRunsFromCache();
  if (document.startViewTransition) document.startViewTransition(update);
  else update();
}

function sectionHtml(label, runs, isLive) {
  return `
    <div class="section-header">${isLive ? '<span class="dot-live"></span>' : ""}${esc(label)}</div>
    <div class="group">${runs.map(runRowHtml).join("")}</div>`;
}

function runRowHtml(r) {
  const title = [r.groupname, r.runname].filter(Boolean).join(" &middot; ");
  const selected = selectedRunIds.has(r.id);
  return `
    <div class="row${editMode && selected ? " row-selected" : ""}" tabindex="0" role="link" onclick="onRunRowClick(event, ${r.id})" onkeydown="if(event.key==='Enter')onRunRowClick(event, ${r.id})">
      ${editMode ? `<span class="row-checkbox${selected ? " checked" : ""}">${selected ? ICON_CHECK : ""}</span>` : ""}
      <div class="row-main">
        <div class="row-title">${title || esc(r.eventname)}</div>
        <div class="row-meta">${esc(fmtDateShort(r.started_at))} &middot; ${r.driver_count} Fahrer</div>
      </div>
      <div class="row-trail">
        ${isLiveRun(r) ? '<span class="live-badge"><span class="dot"></span>LIVE</span>' : ""}
        ${editMode ? "" : ICON_CHEVRON}
      </div>
    </div>`;
}

function onRunRowClick(e, id) {
  if (editMode) { toggleRunSelection(id); return; }
  location.hash = `#/run/${id}`;
}

const DELETE_AUTH_KEY = "drcv-delete-auth";
const DELETE_AUTH_MS = 5 * 60 * 1000; // remember the password for a few minutes

function getCachedDeletePassword() {
  try {
    const raw = localStorage.getItem(DELETE_AUTH_KEY);
    if (!raw) return null;
    const { password, expiresAt } = JSON.parse(raw);
    if (!password || Date.now() > expiresAt) {
      localStorage.removeItem(DELETE_AUTH_KEY);
      return null;
    }
    return password;
  } catch {
    return null;
  }
}

function cacheDeletePassword(password) {
  localStorage.setItem(DELETE_AUTH_KEY, JSON.stringify({ password, expiresAt: Date.now() + DELETE_AUTH_MS }));
}

async function deleteRun(id) {
  const cached = getCachedDeletePassword();
  let password = cached;
  if (password == null) {
    password = prompt("Passwort zum Löschen dieses Laufs:");
    if (password === null) return;
  }
  const res = await fetch(`/api/runs/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (res.status === 403) {
    if (cached != null) localStorage.removeItem(DELETE_AUTH_KEY);
    alert("Falsches Passwort.");
    return;
  }
  if (!res.ok) {
    alert("Löschen fehlgeschlagen.");
    return;
  }
  cacheDeletePassword(password);
  location.hash = "#/";
}

// ---------- run detail ----------

async function renderRun(id) {
  const data = await fetch(`/api/runs/${id}`).then((r) => r.json());
  if (data.error) {
    app.innerHTML = topbarHtml({ backHash: "#/", title: "Nicht gefunden" }) + `<main>${emptyState("Lauf nicht gefunden.")}</main>`;
    return;
  }
  const { run, results, messages } = data;
  resultsByRun[run.id] = {};
  results.forEach((r) => { resultsByRun[run.id][r.nr] = r; });

  currentRunResults = results;
  runSearchQuery = "";
  currentRunFastestSec = results.reduce((min, r) => {
    const sec = parseTimeToSeconds(r.besttime);
    return sec < min ? sec : min;
  }, Infinity);

  const title = [run.groupname, run.runname].filter(Boolean).join(" · ") || run.eventname;
  const subtitle = `
    ${esc(run.trackname)} &middot; ${esc(fmtDateShort(run.started_at))}
    ${run.race_name ? `&middot; ${esc(run.race_name)}` : ""}
    ${isLiveRun(run) ? '<span class="live-badge"><span class="dot"></span>LIVE</span>' : ""}
  `;

  const deleteBtn = `<button class="edit-btn danger" onclick="deleteRun(${run.id})" aria-label="Lauf löschen">${ICON_TRASH}</button>`;
  const actions = `<div class="topbar-actions">${deleteBtn}${themeToggleHtml()}</div>`;

  app.innerHTML = `
    ${topbarHtml({ backHash: "#/", title, subtitleHtml: subtitle, actionHtml: actions })}
    <main>
      ${!results.length ? emptyState("Noch keine Ergebnisse.") : `
        ${results.length > 1 ? searchInputHtml() : ""}
        <div class="group" id="results-group">${resultRowsHtml(results)}</div>
      `}
      ${messages.length ? `<div class="section-header">Meldungen</div><div class="group">${messages.map(messageHtml).join("")}</div>` : ""}
    </main>`;
}

const SAVED_SEARCHES_KEY = "drcv-saved-searches";

function getSavedSearches() {
  try {
    const arr = JSON.parse(localStorage.getItem(SAVED_SEARCHES_KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function setSavedSearches(arr) {
  localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(arr));
}

function saveCurrentSearch() {
  const q = runSearchQuery.trim();
  if (!q) return;
  const saved = getSavedSearches();
  if (saved.includes(q)) return;
  saved.push(q);
  setSavedSearches(saved);
  renderSavedSearches();
}

function applySavedSearch(query) {
  runSearchQuery = query;
  const input = document.querySelector(".search-input");
  if (input) input.value = query;
  filterRunResults(query);
  toggleSearchClearBtn(query);
}

function deleteSavedSearch(query, e) {
  if (e) e.stopPropagation();
  setSavedSearches(getSavedSearches().filter((s) => s !== query));
  renderSavedSearches();
}

function savedSearchChipsHtml() {
  return getSavedSearches().map((q) => `
    <button class="saved-search-chip" data-query="${esc(q)}" onclick="applySavedSearch(this.dataset.query)">
      <span>${esc(q)}</span>
      <span class="saved-search-delete" data-query="${esc(q)}" onclick="deleteSavedSearch(this.dataset.query, event)" aria-label="Gespeicherte Suche löschen">&times;</span>
    </button>`).join("");
}

function renderSavedSearches() {
  const el = document.getElementById("saved-searches");
  if (el) el.innerHTML = savedSearchChipsHtml();
}

function searchInputHtml() {
  return `
    <div class="search-wrap">
      <div class="search-row">
        <div class="search-input-wrap">
          <input type="search" class="search-input" placeholder="Name oder Startnummer, mehrere mit Komma trennen"
                 autocomplete="off" autocorrect="off" spellcheck="false"
                 value="${esc(runSearchQuery)}" oninput="onRunSearchInput(this)" />
          <button type="button" class="search-clear-btn" onclick="clearRunSearch()" aria-label="Suche löschen"
                  style="display:${runSearchQuery ? "flex" : "none"}">${ICON_CLOSE}</button>
        </div>
        <button class="save-search-btn" onclick="saveCurrentSearch()" aria-label="Aktuelle Suche speichern" title="Aktuelle Suche speichern">${ICON_SAVE}</button>
      </div>
      <div class="saved-search-row" id="saved-searches">${savedSearchChipsHtml()}</div>
    </div>`;
}

function onRunSearchInput(el) {
  filterRunResults(el.value);
  toggleSearchClearBtn(el.value);
}

function toggleSearchClearBtn(value) {
  const btn = document.querySelector(".search-clear-btn");
  if (btn) btn.style.display = value ? "flex" : "none";
}

function clearRunSearch() {
  const input = document.querySelector(".search-input");
  if (input) input.value = "";
  filterRunResults("");
  toggleSearchClearBtn("");
  if (input) input.focus();
}

function isOverallFastest(r) {
  return Number.isFinite(currentRunFastestSec) && r.besttime && parseTimeToSeconds(r.besttime) === currentRunFastestSec;
}

function resultRowsHtml(results) {
  if (!results.length) return emptyState("Keine Treffer.");
  return results.map((r) => driverRowHtml(r)).join("");
}

function filterRunResults(query) {
  runSearchQuery = query;
  const terms = query.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const filtered = !terms.length ? currentRunResults : currentRunResults.filter((r) => {
    const name = (r.fullname || "").toLowerCase();
    const nr = String(r.nr ?? "").toLowerCase();
    return terms.some((t) => name.includes(t) || nr.includes(t));
  });
  const group = document.getElementById("results-group");
  if (group) group.innerHTML = resultRowsHtml(filtered);
}

function driverRowHtml(r) {
  const posClass = r.position === 1 ? "p1" : r.position === 2 ? "p2" : r.position === 3 ? "p3" : "";
  const sub = [r.club, r.teamname].filter(Boolean).join(" · ");
  const primary = r.besttime || r.lasttime || "–";
  const fastest = isOverallFastest(r);
  const caption = r.besttime ? "Beste Runde" : r.lasttime ? "Letzte" : "";
  return `
    <div class="row-wrap">
      <div class="row" tabindex="0" role="button" aria-expanded="false"
           data-run="${esc(r.run_id)}" data-nr="${esc(r.nr)}"
           onclick="toggleRow(this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleRow(this);}">
        <div class="pos-badge ${posClass}">${r.position ?? "–"}</div>
        <div class="nr-chip">${esc(r.nr)}</div>
        <div class="row-main">
          <div class="driver-name">${esc(r.fullname)}</div>
          ${sub ? `<div class="driver-sub">${esc(sub)}</div>` : ""}
        </div>
        <div class="row-trail">
          <div>
            <div class="stat-primary${fastest ? " fastest-time" : ""}">${esc(primary)}</div>
            ${caption ? `<div class="stat-caption">${caption}</div>` : ""}
          </div>
          ${ICON_CHEVRON}
        </div>
      </div>
      <div class="expand-wrap"><div class="expand-inner"><div class="expand-content" data-panel></div></div></div>
    </div>`;
}

function statGridHtml(r) {
  const cells = [
    ["Runden", r.laps],
    ["Beste Zeit", r.besttime],
    ["Top km/h", r.bestspeed],
    ["Rückstand", r.gap],
    ["Differenz", r.difference],
    ["Verein", r.club],
    ["Team", r.teamname],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");
  return `<div class="stat-grid">${cells.map(([l, v]) => `<div class="stat-cell"><div class="label">${esc(l)}</div><div class="value">${esc(v)}</div></div>`).join("")}</div>`;
}

function lapGridHtml(laps, isFastestDriver) {
  if (!laps.length) return `<div class="lap-grid"><span class="lap-gap">keine Rundenzeiten aufgezeichnet</span></div>`;
  const bestSec = Math.min(...laps.map((l) => parseTimeToSeconds(l.laptime)));
  let html = "";
  let prev = null;
  for (const l of laps) {
    if (prev != null && l.lap_number > prev + 1) {
      html += `<span class="lap-gap">⋯ Lücke (${l.lap_number - prev - 1}) ⋯</span>`;
    }
    const isPersonalBest = parseTimeToSeconds(l.laptime) === bestSec;
    const cls = isFastestDriver && isPersonalBest ? " fastest" : isPersonalBest ? " best" : "";
    html += `<div class="lap-chip${cls}"><span class="lap-num">#${l.lap_number}</span><span class="lap-time">${esc(l.laptime)}</span></div>`;
    prev = l.lap_number;
  }
  return `<div class="lap-grid">${html}</div>`;
}

function messageHtml(m) {
  return `<div class="message-item"><time>${esc(fmtDate(m.received_at))}</time>${esc(m.text)}</div>`;
}

async function toggleRow(rowEl) {
  const wrap = rowEl.nextElementSibling;
  const panel = wrap.querySelector("[data-panel]");
  const wasOpen = wrap.classList.contains("open");
  wrap.classList.toggle("open", !wasOpen);
  rowEl.setAttribute("aria-expanded", String(!wasOpen));
  if (wasOpen || panel.dataset.loaded) return;
  panel.dataset.loaded = "1";
  const runId = rowEl.dataset.run;
  const nr = rowEl.dataset.nr;
  const r = (resultsByRun[runId] || {})[nr] || {};
  panel.innerHTML = statGridHtml(r) + `<div class="lap-label">Rundenzeiten</div><div class="lap-grid">Lädt…</div>`;
  const laps = await fetch(`/api/runs/${runId}/laptimes?nr=${encodeURIComponent(nr)}`).then((res) => res.json());
  const lapsEl = panel.querySelector(".lap-grid");
  if (lapsEl) lapsEl.outerHTML = lapGridHtml(laps, isOverallFastest(r));
}

window.addEventListener("hashchange", render);
render();
