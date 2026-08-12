const app = document.getElementById("app");

let runsCache = null;
let resultsByRun = {};
let scrollHandler = null;
let activeFilter = "all";
let editMode = false;

const ICON_CHEVRON = `<svg class="chevron" viewBox="0 0 8 14" fill="none" aria-hidden="true"><path d="M1 1L7 7L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_BACK = `<svg viewBox="0 0 12 20" fill="none" width="1.05em" height="1.05em" aria-hidden="true"><path d="M10 1L2 10L10 19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_TRASH = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 4h11M6 4V2.5h4V4M3.5 4l.6 9.5a1 1 0 0 0 1 .9h5.8a1 1 0 0 0 1-.9L12.5 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
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

function topbarHtml({ backHash, title, subtitleHtml, actionHtml }) {
  return `
    <header class="topbar">
      ${backHash || actionHtml ? `
        <div class="topbar-row">
          ${backHash ? `<a class="back-btn" href="${backHash}">${ICON_BACK}<span>Läufe</span></a>` : "<span></span>"}
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
  const runs = await fetch("/api/runs").then((r) => r.json());
  runsCache = runs;
  renderListFromCache();
}

function renderListFromCache() {
  const runs = runsCache || [];
  const groups = [...new Set(runs.map((r) => r.groupname).filter(Boolean))];
  if (activeFilter !== "all" && !groups.includes(activeFilter)) activeFilter = "all";
  const filtered = activeFilter === "all" ? runs : runs.filter((r) => r.groupname === activeFilter);
  const live = filtered.filter((r) => !r.ended_at);
  const done = filtered.filter((r) => r.ended_at);

  const pills = ["all", ...groups]
    .map((g) => `<button class="filter-pill ${activeFilter === g ? "active" : ""}" onclick="setFilter('${esc(g)}')">${g === "all" ? "Alle" : esc(g)}</button>`)
    .join("");

  const editBtn = runs.length
    ? `<button class="edit-btn" onclick="toggleEditMode()">${editMode ? "Fertig" : "Bearbeiten"}</button>`
    : "";
  const actions = `<div class="topbar-actions">${editBtn}${themeToggleHtml()}</div>`;

  const eventnames = [...new Set(runs.map((r) => r.eventname).filter(Boolean))];
  const subtitle = eventnames.length === 1
    ? `${esc(eventnames[0])} &middot; ${runs.length} Läufe aufgezeichnet`
    : `${runs.length} Läufe aufgezeichnet`;

  app.innerHTML = `
    ${topbarHtml({ title: "Live-Timing", subtitleHtml: subtitle, actionHtml: actions })}
    <main>
      ${groups.length > 1 ? `<div class="filter-scroll"><div class="filter-row">${pills}</div></div>` : ""}
      ${!filtered.length ? emptyState("Noch keine Läufe aufgezeichnet.") : [
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

function toggleEditMode() {
  editMode = !editMode;
  const update = () => renderListFromCache();
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
  return `
    <div class="row" tabindex="0" role="link" onclick="onRunRowClick(event, ${r.id})" onkeydown="if(event.key==='Enter')onRunRowClick(event, ${r.id})">
      ${editMode ? `<button class="delete-btn" onclick="event.stopPropagation();deleteRun(${r.id})" aria-label="Lauf löschen">${ICON_TRASH}</button>` : ""}
      <div class="row-main">
        <div class="row-title">${title || esc(r.eventname)}</div>
        <div class="row-meta">${esc(fmtDateShort(r.started_at))} &middot; ${r.driver_count} Fahrer</div>
      </div>
      <div class="row-trail">
        ${!r.ended_at ? '<span class="live-badge"><span class="dot"></span>LIVE</span>' : ""}
        ${editMode ? "" : ICON_CHEVRON}
      </div>
    </div>`;
}

function onRunRowClick(e, id) {
  if (editMode) return;
  location.hash = `#/run/${id}`;
}

async function deleteRun(id, redirectAfter) {
  if (!confirm("Diesen Lauf inklusive aller Rundenzeiten unwiderruflich löschen?")) return;
  const res = await fetch(`/api/runs/${id}`, { method: "DELETE" });
  if (!res.ok) {
    alert("Löschen fehlgeschlagen.");
    return;
  }
  runsCache = (runsCache || []).filter((r) => r.id !== id);
  if (redirectAfter) {
    location.hash = "#/";
    return;
  }
  const update = () => renderListFromCache();
  if (document.startViewTransition) document.startViewTransition(update);
  else update();
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

  const title = [run.groupname, run.runname].filter(Boolean).join(" · ") || run.eventname;
  const subtitle = `
    ${esc(run.trackname)} &middot; ${esc(fmtDateShort(run.started_at))}
    ${!run.ended_at ? '<span class="live-badge"><span class="dot"></span>LIVE</span>' : ""}
  `;

  const deleteBtn = `<button class="edit-btn danger" onclick="deleteRun(${run.id}, true)" aria-label="Lauf löschen">${ICON_TRASH}</button>`;
  const actions = `<div class="topbar-actions">${deleteBtn}${themeToggleHtml()}</div>`;

  app.innerHTML = `
    ${topbarHtml({ backHash: "#/", title, subtitleHtml: subtitle, actionHtml: actions })}
    <main>
      ${!results.length ? emptyState("Noch keine Ergebnisse.") : `<div class="group">${results.map(driverRowHtml).join("")}</div>`}
      ${messages.length ? `<div class="section-header">Meldungen</div><div class="group">${messages.map(messageHtml).join("")}</div>` : ""}
    </main>`;
}

function driverRowHtml(r) {
  const posClass = r.position === 1 ? "p1" : r.position === 2 ? "p2" : r.position === 3 ? "p3" : "";
  const sub = [r.club, r.teamname].filter(Boolean).join(" · ");
  const primary = r.totaltime || r.lasttime || "–";
  const caption = r.totaltime ? "Gesamt" : r.lasttime ? "Letzte" : "";
  return `
    <div class="row-wrap">
      <div class="row" tabindex="0" role="button" aria-expanded="false"
           data-run="${esc(r.run_id)}" data-nr="${esc(r.nr)}"
           onclick="toggleRow(this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleRow(this);}">
        <div class="pos-badge ${posClass}">${r.position ?? "–"}</div>
        <div class="row-main">
          <div class="driver-name">${esc(r.fullname)}</div>
          ${sub ? `<div class="driver-sub">${esc(sub)}</div>` : ""}
        </div>
        <div class="row-trail">
          <div>
            <div class="stat-primary">${esc(primary)}</div>
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
    ["Nr", r.nr],
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

function lapGridHtml(laps) {
  if (!laps.length) return `<div class="lap-grid"><span class="lap-gap">keine Rundenzeiten aufgezeichnet</span></div>`;
  const bestSec = Math.min(...laps.map((l) => parseTimeToSeconds(l.laptime)));
  let html = "";
  let prev = null;
  for (const l of laps) {
    if (prev != null && l.lap_number > prev + 1) {
      html += `<span class="lap-gap">⋯ Lücke (${l.lap_number - prev - 1}) ⋯</span>`;
    }
    const best = parseTimeToSeconds(l.laptime) === bestSec;
    html += `<div class="lap-chip${best ? " best" : ""}"><span class="lap-num">#${l.lap_number}</span><span class="lap-time">${esc(l.laptime)}</span></div>`;
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
  if (lapsEl) lapsEl.outerHTML = lapGridHtml(laps);
}

window.addEventListener("hashchange", render);
render();
