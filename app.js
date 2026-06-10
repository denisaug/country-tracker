"use strict";
/* ============================================================
   app.js — DOM, storage, rendering for the calendar + popup + modals,
   plus the view toggle and the (vanilla) theme/density controller.
   Pure date/visa logic lives in engine.js (loaded first). Stats live in
   stats.js (window.Stats, loaded before this file).
   ============================================================ */

/* ---------- flags ---------- */
function flagSrc(code) { return `https://flagcdn.com/${code.toLowerCase()}.svg`; }
function flagFallback(img) {
  const s = document.createElement("span");
  s.className = "flag-fallback"; s.textContent = (img.alt || "").toUpperCase();
  img.replaceWith(s);
}
function flagImg(code) {
  const img = document.createElement("img");
  img.className = "flag-img"; img.src = flagSrc(code); img.alt = code; img.loading = "lazy";
  img.onerror = () => flagFallback(img);
  return img;
}
function flagImgHTML(code) {
  return `<img class="flag-img" src="${flagSrc(code)}" alt="${code}" loading="lazy" onerror="flagFallback(this)">`;
}

/* monoline icons (single stroke weight, currentColor) */
const IC = {
  plus: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  trash: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>`,
  globe: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/></svg>`,
  upload: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M12 3v13M7 8l5-5 5 5"/></svg>`,
  download: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M12 16V3M7 11l5 5 5-5"/></svg>`,
  reset: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/></svg>`,
};

/* ---------- storage ---------- */
const STORAGE_KEY = "stay_tracker_v1";
function isTrip(x) { return x && typeof x === "object" && typeof x.profileId === "string" && typeof x.start === "string" && typeof x.end === "string"; }
function isCountry(x) { return x && typeof x === "object" && typeof x.id === "string" && typeof x.code === "string" && typeof x.name === "string" && Array.isArray(x.rules) && (x.years === undefined || (Array.isArray(x.years) && x.years.every(y => typeof y === "number"))); }
function parseState(raw) {
  const obj = JSON.parse(raw);
  if (!obj || typeof obj !== "object") throw new Error("not an object");
  if (!Array.isArray(obj.trips) || !Array.isArray(obj.countries)) throw new Error("bad arrays");
  const s = migrateState(obj);
  if (!s.trips.every(isTrip)) throw new Error("bad trips");
  if (!s.countries.every(isCountry)) throw new Error("bad countries");
  return s;
}
function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { countries: [], trips: [] };
  try { return parseState(raw); } catch (e) { return { countries: [], trips: [] }; }
}
function saveState(s) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }
function exportJson(s) { return JSON.stringify(s, null, 2); }
function importJson(json) { return parseState(json); }

const VIEW_KEY = "stay_tracker_view_v2";
function loadView() {
  try { const o = JSON.parse(localStorage.getItem(VIEW_KEY)); if (o && typeof o.rangeStart === "string" && typeof o.rangeEnd === "string") return o; } catch (e) {}
  return null;
}
function saveView() { localStorage.setItem(VIEW_KEY, JSON.stringify({ rangeStart, rangeEnd, mode: currentView })); }

/* ---------- country config helpers ---------- */
function defaultRule(type) {
  switch (type) {
    case "rolling": return { type: "rolling", maxDays: 90, windowDays: 180, count: "present" };
    case "consecutive": return { type: "consecutive", maxMonths: 2 };
    case "perYear": return { type: "perYear", maxDays: 183 };
    case "minPerYear": return { type: "minPerYear", minDays: 90 };
  }
}
function setRule(list, id, type, enabled) {
  return list.map(c => {
    if (c.id !== id) return c;
    if (!enabled) return { ...c, rules: c.rules.filter(r => r.type !== type) };
    if (c.rules.some(r => r.type === type && !(r.years && r.years.length))) return c;   // already on
    return { ...c, rules: [...c.rules, defaultRule(type)] };
  });
}
function applyRule(list, id, type, enabled, params) {
  return list.map(c => {
    if (c.id !== id) return c;
    // toggling a rule off keeps any year-scoped variant of it (e.g. the UK citizenship rule)
    if (!enabled) return { ...c, rules: c.rules.filter(r => r.type !== type || (r.years && r.years.length)) };
    let rule = defaultRule(type);
    if (type === "perYear" && params && params.maxDays > 0) rule = { ...rule, maxDays: params.maxDays };
    if (type === "minPerYear" && params && params.minDays > 0) rule = { ...rule, minDays: params.minDays };
    if (type === "rolling" && params) rule = {
      ...rule,
      maxDays: params.maxDays > 0 ? params.maxDays : rule.maxDays,
      windowDays: params.windowDays > 0 ? params.windowDays : rule.windowDays,
      count: params.count === "absent" ? "absent" : "present"
    };
    // replace the existing (unscoped) rule of this type IN PLACE so editing never
    // reorders the array — the displayed cell counter must stay stable
    const idx = c.rules.findIndex(r => r.type === type && !(r.years && r.years.length));
    if (idx >= 0) { const rules = c.rules.slice(); rules[idx] = rule; return { ...c, rules }; }
    return { ...c, rules: [...c.rules, rule] };
  });
}
function parseYears(str) {
  return [...new Set(String(str || "").split(/[\s,]+/).map(s => parseInt(s, 10)).filter(n => n >= 1900 && n <= 2999))].sort((a, b) => a - b);
}
function setCountryYears(list, id, years) { return list.map(c => c.id === id ? { ...c, years } : c); }
const RULE_TYPES = ["rolling", "consecutive", "perYear", "minPerYear"];
const RULE_LABELS = { rolling: "90 / 180 rolling", consecutive: "≤ 2 consecutive months", perYear: "≤ 183 days / year", minPerYear: "≥ 90 days / year" };
function rulesSummary(rules) { return rules.length ? rules.map(ruleLabel).join(" · ") : "no rules"; }
function defaultCountries() {
  return [{ id: newId(), code: "TR", name: "Turkey", rules: [defaultRule("rolling"), defaultRule("consecutive")] }];
}

/* ---------- app state ---------- */
let state = loadState();
// first run (empty storage): seed the plain Turkey catalog, no trips — same as Reset
if (localStorage.getItem(STORAGE_KEY) === null) { state = { countries: defaultCountries(), trips: [] }; saveState(state); }
const thisMonthFirst = todayIso().slice(0, 7) + "-01";
let rangeStart = addMonths(thisMonthFirst, -3);
let rangeEnd = addMonths(thisMonthFirst, 2);
const savedView = loadView();
if (savedView) { rangeStart = savedView.rangeStart; rangeEnd = savedView.rangeEnd; }
let pendingDate = null;
let currentView = "calendar";

const calendarEl = document.getElementById("calendar");
const tip = document.getElementById("violation-tip");

function persist() { saveState(state); }
function profileById(id) { return state.countries.find(c => c.id === id) || null; }
function tripCoveringDate(date) { return state.trips.find(t => date >= t.start && date <= t.end) || null; }
function tripsCoveringDate(date) { return state.trips.filter(t => date >= t.start && date <= t.end); }

function onDayClick(date) {
  if (pendingDate === null) { pendingDate = date; render(); return; }
  const profileId = state.countries.length === 1 ? state.countries[0].id : "";
  const trips = addTrip(state.trips, profileId, pendingDate, date);
  const newTrip = trips[trips.length - 1];
  pendingDate = null;
  state = { ...state, trips };
  commit();
  // straight after drawing a stay that isn't auto-assigned, open the country picker
  if (!profileId) {
    formTrip = newTrip;
    const cell = calendarEl.querySelector(`.cell[data-date="${date}"]`);
    if (cell) openTripForm(date, cell.getBoundingClientRect());
  }
}
function onDayContextMenu(e, date) {
  const ts = tripsCoveringDate(date);
  if (ts.length === 0) return;
  e.preventDefault();
  if (ts.length > 1) { openTripForm(date, e.target.closest(".cell").getBoundingClientRect()); return; }
  if (!confirmDeleteTrip(ts[0])) return;
  state = { ...state, trips: state.trips.filter(x => x !== ts[0]) };
  closeForm(); commit();
}
function commit() { persist(); render(); if (currentView === "stats" && window.Stats) window.Stats.render(); }

function buildCellIndex() {
  const idx = new Map();
  for (const country of state.countries) {
    for (const cell of evaluateCountry(country, state.trips).cells) {
      if (!idx.has(cell.date)) idx.set(cell.date, new Map());
      idx.get(cell.date).set(cell.profileId, cell);
    }
  }
  return idx;
}
function buildUnassignedDates() {
  const s = new Set();
  for (const t of state.trips) { if (t.profileId) continue; for (const d of eachDateInclusive(t.start, t.end)) s.add(d); }
  return s;
}
function buildViolationMessages() {
  const m = new Map();
  for (const country of state.countries) {
    for (const v of evaluateCountry(country, state.trips).violations) {
      for (const d of v.dates) { if (!m.has(d)) m.set(d, []); m.get(d).push(v.message); }
    }
  }
  return m;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function renderEmptyState() {
  const wrap = document.createElement("div");
  wrap.className = "empty-state";
  const h = document.createElement("h3"); h.textContent = "No stays logged yet";
  const p = document.createElement("p");
  p.textContent = "Click an arrival day on the calendar below, then a departure day, to log your first stay.";
  const cta = document.createElement("button");
  cta.className = "tbtn es-cta"; cta.textContent = "Add / manage countries";
  cta.addEventListener("click", openManage);
  wrap.appendChild(h); wrap.appendChild(p); wrap.appendChild(cta);
  return wrap;
}

function renderCalendar() {
  calendarEl.innerHTML = "";
  // while picking the departure day, the per-cell gear/start overlays would swallow the
  // click (they stopPropagation), so suppress them and let any cell complete the trip
  calendarEl.classList.toggle("picking", pendingDate !== null);
  if (pendingDate) {
    const bar = document.createElement("div");
    bar.className = "cal-bar";
    const left = document.createElement("div"); left.className = "cal-bar-left";
    left.innerHTML = `<span class="cal-pending"><span class="cal-pending-dot"></span>Arrival set to <b>${pendingDate}</b> — now click the departure day.</span>`;
    bar.appendChild(left);
    calendarEl.appendChild(bar);
  }

  if (state.trips.length === 0) calendarEl.appendChild(renderEmptyState());

  const topRow = document.createElement("div"); topRow.className = "look-row top";
  const behindBtn = document.createElement("button");
  behindBtn.className = "look-btn behind"; behindBtn.textContent = "Look behind more";
  behindBtn.addEventListener("click", () => { rangeStart = addMonths(rangeStart, -3); saveView(); render(); });
  const lessTop = document.createElement("button");
  lessTop.className = "look-btn less"; lessTop.textContent = "Show less";
  const topLimit = addMonths(rangeEnd, -2).slice(0, 7);
  lessTop.disabled = rangeStart.slice(0, 7) >= topLimit;
  lessTop.addEventListener("click", () => { let n = addMonths(rangeStart, 3); if (n.slice(0, 7) > topLimit) n = topLimit + "-01"; rangeStart = n; saveView(); render(); });
  topRow.appendChild(behindBtn); topRow.appendChild(lessTop);
  calendarEl.appendChild(topRow);

  const idx = buildCellIndex();
  const unassigned = buildUnassignedDates();
  const tripEnds = new Set(state.trips.map(t => t.end));   // last day of each stay → gets a "start next" button
  const wrap = document.createElement("div"); wrap.className = "months";

  const today = todayIso();
  const rollingWindows = [...new Set(state.countries.flatMap(c => c.rules.filter(r => r.type === "rolling").map(r => r.windowDays)))];
  const windowDays = rollingWindows.length ? Math.max(...rollingWindows) : null;
  const windowEdge = windowDays ? addDays(today, -(windowDays - 1)) : null;

  let cursor = rangeStart.slice(0, 7) + "-01";
  const lastMonth = rangeEnd.slice(0, 7) + "-01";
  while (cursor <= lastMonth) {
    const monthEl = document.createElement("div"); monthEl.className = "month";
    const h = document.createElement("h4");
    const dt = fromIso(cursor);
    h.innerHTML = `${dt.toLocaleString("en-US", { month: "long" })} <span>${dt.getFullYear()}</span>`;
    monthEl.appendChild(h);
    const grid = document.createElement("div"); grid.className = "grid";
    for (const w of WEEKDAYS) { const wd = document.createElement("div"); wd.className = "wd"; wd.textContent = w; grid.appendChild(wd); }

    const year = dt.getFullYear(), month = dt.getMonth();
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let i = 0; i < firstWeekday; i++) { const b = document.createElement("div"); b.className = "cell blank"; grid.appendChild(b); }
    for (let d = 1; d <= daysInMonth; d++) {
      const date = toIso(new Date(year, month, d));
      const cell = document.createElement("button");
      cell.className = "cell"; cell.dataset.date = date;
      const dn = document.createElement("span"); dn.className = "dn"; dn.textContent = d; cell.appendChild(dn);
      const cells = idx.get(date);
      let isTrip = false;
      if (cells && cells.size > 0) {
        const flags = document.createElement("span"); flags.className = "flags";
        const num = document.createElement("span"); num.className = "num";
        const parts = []; let anyViolated = false;
        for (const [pid, c] of cells) { flags.appendChild(flagImg(c.code)); parts.push(String(c.number)); if (c.violated) anyViolated = true; }
        num.textContent = parts.join("·");
        if (cells.size > 1) cell.classList.add("travel");
        if (anyViolated) cell.classList.add("violated");
        cell.appendChild(flags); cell.appendChild(num);
        isTrip = true;
      } else if (unassigned.has(date)) {
        cell.classList.add("unassigned");
        const num = document.createElement("span"); num.className = "num"; num.textContent = "?"; cell.appendChild(num);
        isTrip = true;
      }
      if (isTrip) {
        cell.classList.add("trip");
        const gear = document.createElement("span"); gear.className = "gear"; gear.title = "Set country & rules";
        gear.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"></circle><path d="M12 2.6l1.5 2.9 3.2-.6.6 3.2 2.9 1.5-1.7 2.7 1.7 2.7-2.9 1.5-.6 3.2-3.2-.6L12 21.4l-1.5-2.9-3.2.6-.6-3.2-2.9-1.5 1.7-2.7-1.7-2.7 2.9-1.5.6-3.2 3.2.6z"></path></svg>';
        gear.addEventListener("click", ev => { ev.stopPropagation(); openTripForm(date, cell.getBoundingClientRect()); });
        cell.appendChild(gear);
        // last day of a stay = travel day: offer to start the next stay from here.
        // gear + start then split the cell in half.
        if (tripEnds.has(date)) {
          cell.classList.add("has-start");
          const start = document.createElement("span"); start.className = "start"; start.title = "Start a new stay from this day";
          start.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3.5v17l13-8.5z"></path></svg>';
          start.addEventListener("click", ev => { ev.stopPropagation(); pendingDate = date; closeForm(); render(); });
          cell.appendChild(start);
        }
        cell.addEventListener("contextmenu", ev => onDayContextMenu(ev, date));
      }
      if (windowEdge && date < windowEdge) cell.classList.add("out-of-window");
      if (windowEdge && date === windowEdge) cell.classList.add("window-edge");
      if (date === today) cell.classList.add("today");
      if (date === pendingDate) cell.classList.add("pending");
      cell.addEventListener("click", () => onDayClick(date));
      grid.appendChild(cell);
    }
    monthEl.appendChild(grid);
    wrap.appendChild(monthEl);
    cursor = addMonths(cursor, 1);
  }
  calendarEl.appendChild(wrap);

  const botRow = document.createElement("div"); botRow.className = "look-row bottom";
  const aheadBtn = document.createElement("button");
  aheadBtn.className = "look-btn ahead"; aheadBtn.textContent = "Look ahead more";
  aheadBtn.addEventListener("click", () => { rangeEnd = addMonths(rangeEnd, 3); saveView(); render(); });
  const lessBot = document.createElement("button");
  lessBot.className = "look-btn less"; lessBot.textContent = "Show less";
  const botLimit = addMonths(rangeStart, 2).slice(0, 7);
  lessBot.disabled = rangeEnd.slice(0, 7) <= botLimit;
  lessBot.addEventListener("click", () => { let n = addMonths(rangeEnd, -3); if (n.slice(0, 7) < botLimit) n = botLimit + "-01"; rangeEnd = n; saveView(); render(); });
  botRow.appendChild(aheadBtn); botRow.appendChild(lessBot);
  calendarEl.appendChild(botRow);

  const msgs = buildViolationMessages();
  wrap.addEventListener("mouseover", e => {
    const cell = e.target.closest(".cell.violated");
    if (!cell || !cell.dataset.date) return;
    const list = msgs.get(cell.dataset.date); if (!list) return;
    tip.textContent = list.join("  ·  ");
    const r = cell.getBoundingClientRect();
    tip.style.left = r.left + "px"; tip.style.top = (r.bottom + 6) + "px"; tip.style.display = "block";
  });
  wrap.addEventListener("mouseout", () => { tip.style.display = "none"; });
}

/* ---------- trip form popup ---------- */
let tripForm = null, formTrip = null, formTrips = [], formRect = null, formDate = null;
function appRoot() { return document.querySelector(".app") || document.body; }
function ensureForm() { if (tripForm) return tripForm; tripForm = document.createElement("div"); tripForm.className = "trip-form"; appRoot().appendChild(tripForm); return tripForm; }
function tripLabelHTML(t) {
  const p = t.profileId ? profileById(t.profileId) : null;
  const flag = p ? flagImgHTML(p.code) : `<span class="tf-flag-none">?</span>`;
  return `<span class="tf-flag">${flag}</span><span class="tf-trip-range">${t.start} → ${t.end}</span>`;
}
function yearsBadge(c) { return c.years && c.years.length ? `<span class="tf-yrs">${c.years.join(", ")}</span>` : ""; }
function openTripForm(date, rect) {
  const ts = tripsCoveringDate(date); if (ts.length === 0) return;
  formTrips = ts;
  formTrip = (formTrip && ts.includes(formTrip)) ? formTrip : ts[0];
  formRect = rect; formDate = date; renderTripForm();
}
function renderTripForm() {
  if (!formTrip) return;
  const t = formTrip; const f = ensureForm();
  let html = "";
  if (formTrips.length > 1) {
    html += `<div class="tf-pick-label">Travel day — pick a trip</div><div class="tf-trips">`;
    formTrips.forEach((tr, i) => { const sel = tr === t ? " selected" : ""; html += `<button class="tf-trip${sel}" data-i="${i}">${tripLabelHTML(tr)}</button>`; });
    html += `</div>`;
  }
  const year = +formDate.slice(0, 4);
  const visible = state.countries.filter(c => yearInScope(c, formDate) || c.id === t.profileId);
  const filtered = visible.length !== state.countries.length;
  html += `<h5>Assign country</h5><div class="tf-range">${t.start} → ${t.end}</div>`;
  if (filtered) html += `<div class="tf-yearnote">Valid in ${year}</div>`;
  if (state.countries.length === 0) html += `<div class="tf-empty">No countries in catalog yet.</div>`;
  else if (visible.length === 0) html += `<div class="tf-empty">No countries valid in ${year}.</div>`;
  else {
    html += `<div class="tf-countries">`;
    for (const c of visible) {
      const sel = c.id === t.profileId ? " selected" : "";
      html += `<button class="tf-country${sel}" data-id="${c.id}"><span class="tf-flag">${flagImgHTML(c.code)}</span>` +
        `<span class="tf-cn"><b>${c.name}</b>${yearsBadge(c)}<span class="tf-rules-sum">${rulesSummary(c.rules)}</span></span>` +
        (sel ? `<span class="tf-check">✓</span>` : ``) + `</button>`;
    }
    html += `</div>`;
  }
  html += `<button class="tf-foot-btn tf-manage tf-manage-row">${IC.globe}<span>Manage countries &amp; rules</span></button>`;
  html += `<div class="tf-foot">` +
    `<button class="tf-foot-btn tf-newtrip">${IC.plus}<span>New stay from ${formDate}</span></button>` +
    `<button class="tf-foot-btn danger tf-delete">${IC.trash}<span>Delete this stay</span></button>` +
    `</div>`;
  f.innerHTML = html;
  f.querySelectorAll(".tf-trip").forEach(btn => btn.addEventListener("click", () => { formTrip = formTrips[+btn.dataset.i]; renderTripForm(); }));
  f.querySelectorAll(".tf-country").forEach(btn => btn.addEventListener("click", () => assignFromForm(btn.dataset.id)));
  f.querySelector(".tf-newtrip").addEventListener("click", () => { pendingDate = formDate; closeForm(); render(); });
  f.querySelector(".tf-delete").addEventListener("click", deleteFromForm);
  f.querySelector(".tf-manage").addEventListener("click", () => openManage());
  f.style.display = "block";
  const rect = formRect, fw = 274, fh = f.offsetHeight || 240;
  let left = rect.right + 10, top = rect.top;
  if (left + fw > window.innerWidth - 10) left = Math.max(10, rect.left - fw - 10);
  if (top + fh > window.innerHeight - 10) top = Math.max(10, window.innerHeight - fh - 10);
  f.style.left = left + "px"; f.style.top = top + "px";
}
function assignFromForm(id) { if (formTrip) { formTrip.profileId = id; state = { ...state, trips: state.trips.slice() }; } closeForm(); commit(); }
function confirmDeleteTrip(t) {
  const p = t.profileId ? profileById(t.profileId) : null;
  return confirm(`Delete this stay?\n${p ? p.name : "Unassigned"}: ${t.start} → ${t.end}`);
}
function deleteFromForm() {
  const t = formTrip;
  if (!t || !confirmDeleteTrip(t)) return;
  state = { ...state, trips: state.trips.filter(x => x !== t) };
  closeForm(); commit();
}
function closeForm() { if (tripForm) tripForm.style.display = "none"; formTrip = null; formTrips = []; formRect = null; formDate = null; }

/* ---------- help modal ---------- */
let helpEl = null;
function ensureHelp() {
  if (helpEl) return helpEl;
  helpEl = document.createElement("div");
  helpEl.className = "modal-overlay help-overlay";
  helpEl.innerHTML = `<div class="modal help-modal"></div>`;
  appRoot().appendChild(helpEl);
  helpEl.addEventListener("mousedown", e => { if (e.target === helpEl) closeHelp(); });
  return helpEl;
}
function openHelp() {
  closeForm();
  const m = ensureHelp(); m.style.display = "flex";
  m.querySelector(".modal").innerHTML =
    `<div class="modal-head"><h4>How Stay Tracker works</h4><button class="modal-close" title="Close">×</button></div>` +
    `<div class="help-body">` +
      helpItem("Add a stay", "Click an <b>arrival</b> day, then a <b>departure</b> day. The stay fills in between, and each day shows a running count.") +
      helpItem("Assign a country", "Hover a stay and click the <b>gear</b> to choose its country and see which rules apply.") +
      helpItem("Delete a stay", "<b>Right-click</b> a stay on the calendar, or use <b>Delete this stay</b> inside the stay popup.") +
      helpItem("The 180-day window", "A left edge marks the start of the rolling window — dimmed days to its left no longer count. <b>Today</b> is ringed in your accent colour.") +
      helpItem("When a rule breaks", "Days that exceed a country’s limit turn <b>red</b>. Hover one to see exactly which rule was broken.") +
      helpItem("Your data is private", "Your trips stay in this browser — never sent to a server. Use <b>Export</b>/<b>Import</b> to move them between devices.") +
    `</div>`;
  m.querySelector(".modal-close").addEventListener("click", closeHelp);
}
function helpItem(title, body) {
  return `<div class="help-item"><div class="help-bullet"></div><div class="help-text"><b>${title}</b><p>${body}</p></div></div>`;
}
function closeHelp() { if (helpEl) helpEl.style.display = "none"; }

/* ---------- manage-countries modal ---------- */
let manageEl = null;
let addDraft = { years: new Set() };
let manageOpen = new Set();
/* personal data is injected at deploy time (window.__AUTHOR__), never in source */
const AUTHOR = (typeof window !== "undefined" && window.__AUTHOR__) || {};
const CONTACT_EMAIL = AUTHOR.email || "you@example.com";
function yearChipsHTML(selected) {
  const sel = new Set(selected);
  const y = +todayIso().slice(0, 4);
  const base = [y - 1, y, y + 1];
  const all = [...new Set([...base, ...sel])].sort((a, b) => a - b);
  const chips = all.map(yr => `<button type="button" class="yr-chip${sel.has(yr) ? ' on' : ''}" data-year="${yr}">${yr}</button>`).join("");
  return `<div class="manage-years"><span class="my-label">Years</span>` +
    `<div class="yr-chips">${chips}<input class="cy-years" inputmode="numeric" placeholder="+ year"></div></div>`;
}
function wireYearControl(box, getSet, applySet) {
  const chipsEl = box.querySelector(".yr-chips"), input = box.querySelector(".cy-years");
  function toggle(chip) {
    const yr = +chip.dataset.year, set = getSet();
    if (set.has(yr)) { set.delete(yr); chip.classList.remove("on"); } else { set.add(yr); chip.classList.add("on"); }
    applySet(set);
  }
  chipsEl.querySelectorAll(".yr-chip").forEach(ch => ch.addEventListener("click", () => toggle(ch)));
  function addFromInput() {
    const yrs = parseYears(input.value); input.value = "";
    if (!yrs.length) return;
    const set = getSet();
    for (const yr of yrs) {
      set.add(yr);
      let chip = chipsEl.querySelector(`[data-year="${yr}"]`);
      if (!chip) {
        chip = document.createElement("button");
        chip.type = "button"; chip.className = "yr-chip on"; chip.dataset.year = yr; chip.textContent = yr;
        chip.addEventListener("click", () => toggle(chip));
        const after = [...chipsEl.querySelectorAll(".yr-chip")].find(c => +c.dataset.year > yr) || input;
        chipsEl.insertBefore(chip, after);
      } else chip.classList.add("on");
    }
    applySet(set);
  }
  input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addFromInput(); } });
  input.addEventListener("blur", addFromInput);
}
function ensureManage() {
  if (manageEl) return manageEl;
  manageEl = document.createElement("div"); manageEl.className = "modal-overlay";
  manageEl.innerHTML = `<div class="modal"></div>`;
  appRoot().appendChild(manageEl);
  manageEl.addEventListener("mousedown", e => { if (e.target === manageEl) closeManage(); });
  return manageEl;
}
function openManage() { closeForm(); addDraft = { years: new Set() }; const m = ensureManage(); m.style.display = "flex"; renderManage(); }
function closeManage() { if (manageEl) manageEl.style.display = "none"; }
/* the checkboxes edit the FIRST rule of each type; any further rules (e.g. the
   year-scoped UK citizenship rule) are shown here read-only with a remove button */
function extraRulesHTML(rules) {
  const seen = new Set(), extras = [];
  (rules || []).forEach((r, i) => { if (seen.has(r.type)) extras.push({ r, i }); else seen.add(r.type); });
  if (!extras.length) return "";
  return `<div class="extra-rules"><span class="er-label">Also applies</span>` +
    extras.map(({ r, i }) => `<span class="er-chip">${ruleLabel(r)}<button class="er-del" data-idx="${i}" title="Remove rule">×</button></span>`).join("") +
    `</div>`;
}
function ruleCheckboxes(rules) {
  return RULE_TYPES.map(rt => {
    const on = rules && rules.some(r => r.type === rt);
    if (rt === "rolling") {
      const r = rules && rules.find(x => x.type === "rolling");
      const days = r ? r.maxDays : 90, win = r ? r.windowDays : 180, count = r && r.count === "absent" ? "absent" : "present";
      return `<label class="tf-rule"><input type="checkbox" data-rule="rolling"${on ? ' checked' : ''}> ≤ ` +
        `<input type="number" class="rl-days" min="1" max="3660" value="${days}"> ` +
        `<select class="rl-count"><option value="present"${count === "present" ? " selected" : ""}>present</option><option value="absent"${count === "absent" ? " selected" : ""}>absent</option></select> / ` +
        `<input type="number" class="rl-win" min="1" max="3660" value="${win}"> rolling</label>`;
    }
    if (rt === "perYear") {
      const r = rules && rules.find(x => x.type === "perYear");
      const days = r ? r.maxDays : 183;
      return `<label class="tf-rule"><input type="checkbox" data-rule="perYear"${on ? ' checked' : ''}> ≤ ` +
        `<input type="number" class="ry-days" min="1" max="366" value="${days}"> days / calendar year</label>`;
    }
    if (rt === "minPerYear") {
      const r = rules && rules.find(x => x.type === "minPerYear");
      const days = r ? r.minDays : 90;
      return `<label class="tf-rule"><input type="checkbox" data-rule="minPerYear"${on ? ' checked' : ''}> ≥ ` +
        `<input type="number" class="rm-days" min="1" max="366" value="${days}"> days / calendar year</label>`;
    }
    return `<label class="tf-rule"><input type="checkbox" data-rule="${rt}"${on ? ' checked' : ''}> ${RULE_LABELS[rt]}</label>`;
  }).join("");
}
function countryNameByCode(code) {
  return (typeof COUNTRY_NAMES !== "undefined" && COUNTRY_NAMES[code]) || "";
}
/* read the editable rolling-rule fields (days, present/absent, window) from a scope element */
function readRolling(scope) {
  return {
    maxDays: parseInt(scope.querySelector(".rl-days").value, 10) || 90,
    windowDays: parseInt(scope.querySelector(".rl-win").value, 10) || 180,
    count: scope.querySelector(".rl-count").value === "absent" ? "absent" : "present"
  };
}
/* accept either a 2-letter code or a full country name and resolve to the code */
function resolveCountryCode(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.length === 2) return s.toUpperCase();
  if (typeof COUNTRY_NAMES !== "undefined") {
    const hit = Object.keys(COUNTRY_NAMES).find(c => COUNTRY_NAMES[c].toLowerCase() === s.toLowerCase());
    if (hit) return hit;
  }
  return s.toUpperCase();
}
/* suggestion list for the code field — value is the 2-letter code, the visible
   text is the country name, so the browser also matches by name while typing */
function countryDatalistHTML() {
  if (typeof COUNTRY_NAMES === "undefined") return "";
  const codes = Object.keys(COUNTRY_NAMES).sort((a, b) => COUNTRY_NAMES[a].localeCompare(COUNTRY_NAMES[b]));
  const codeOpts = codes.map(c => `<option value="${c}">${COUNTRY_NAMES[c]}</option>`).join("");   // value = code, label = name
  const nameOpts = codes.map(c => `<option value="${COUNTRY_NAMES[c]}"></option>`).join("");          // value = name
  return `<datalist id="cc-list">${codeOpts}</datalist><datalist id="cn-list">${nameOpts}</datalist>`;
}
function renderManage() {
  const box = manageEl.querySelector(".modal");
  let html = `<div class="modal-head"><h4>Countries &amp; rules</h4><button class="modal-close" title="Close">×</button></div>`;
  html += `<div class="manage-list">`;
  if (state.countries.length === 0) html += `<div class="tf-empty">No countries yet. Add one below.</div>`;
  for (const c of state.countries) {
    const open = manageOpen.has(c.id) ? " open" : "";
    html += `<div class="manage-row${open}" data-id="${c.id}">` +
      `<div class="manage-head"><span class="tf-flag">${flagImgHTML(c.code)}</span>` +
      `<span class="manage-name">${c.name}</span>` +
      `<span class="manage-sum">${rulesSummary(c.rules)}</span>` +
      `<button class="manage-del" title="Remove country">${IC.trash}</button>` +
      `<span class="manage-chev" aria-hidden="true">›</span></div>` +
      `<div class="manage-body"><label class="ce-name-row"><span class="ce-name-label">Name</span><input class="ce-name" maxlength="40" placeholder="Country name"></label>` +
      `<div class="manage-rules">${ruleCheckboxes(c.rules)}</div>` + extraRulesHTML(c.rules) + yearChipsHTML(c.years || []) + `</div></div>`;
  }
  html += `</div>`;
  const thisYear = +todayIso().slice(0, 4);
  html += `<div class="manage-add"><div class="ma-label">Add country</div><div class="tf-fields">` +
    `<input class="ma-code" placeholder="DE or name" list="cc-list" autocomplete="off" /><input class="ma-name" placeholder="Country name" list="cn-list" autocomplete="off" /></div>` +
    `<div class="ma-gen" hidden><button type="button" class="ma-gen-link">🇬🇧 Talent Visa Helper</button>` +
      `<div class="ma-gen-body" hidden><div class="ma-gen-head">UK Global Talent → ILR → citizenship</div>` +
        `<div class="ma-gen-row"><label>Route <select class="gen-route"><option value="5">5-year (Exceptional Promise)</option><option value="3">3-year (Exceptional Talent / prize)</option></select></label>` +
        `<label>From year <input class="gen-year" type="number" min="2000" max="2100" value="${thisYear}"></label>` +
        `<button type="button" class="gen-uk">Generate rules</button></div>` +
        `<p class="ma-gen-note">Creates United Kingdom with two rules: <b>≤ 180 absent / 365 rolling</b> (ILR continuity, all qualifying years) and <b>≤ 90 absent / 365 rolling</b> applied only to the final year (the 12 months before the citizenship application). If a UK profile already exists, it is updated in place.</p></div></div>` +
    `<div class="manage-rules">${ruleCheckboxes([])}</div>` + yearChipsHTML([...addDraft.years]) +
    `<button class="ma-add">${IC.plus}<span>Add to catalog</span></button></div>`;
  html += countryDatalistHTML();
  html += `<a class="manage-contact" href="mailto:${CONTACT_EMAIL}?subject=Stay%20Tracker%20—%20rule%20request"><span class="mc-q">?</span><span>Don’t see your visa rule? <b>Tell the author</b> and it can be added.</span></a>`;
  box.innerHTML = html;
  box.querySelector(".modal-close").addEventListener("click", closeManage);
  box.querySelectorAll(".manage-row").forEach(row => {
    const id = row.dataset.id;
    const nameInput = row.querySelector(".ce-name");
    if (nameInput) {
      const cur = state.countries.find(x => x.id === id);
      nameInput.value = cur ? cur.name : "";
      nameInput.addEventListener("click", e => e.stopPropagation());  // don't toggle the row
      nameInput.addEventListener("change", () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.value = (state.countries.find(x => x.id === id) || {}).name || ""; return; }
        state = { ...state, countries: state.countries.map(x => x.id === id ? { ...x, name } : x) };
        commit(); renderManage();
      });
    }
    row.querySelector(".manage-head").addEventListener("click", e => {
      if (e.target.closest(".manage-del")) return;
      if (manageOpen.has(id)) manageOpen.delete(id); else manageOpen.add(id);
      row.classList.toggle("open");
    });
    row.querySelectorAll(".manage-rules input[type=checkbox]").forEach(cb => {
      cb.addEventListener("change", () => {
        if (cb.dataset.rule === "perYear") {
          const days = parseInt(row.querySelector(".ry-days").value, 10) || 183;
          state = { ...state, countries: applyRule(state.countries, id, "perYear", cb.checked, { maxDays: days }) };
        } else if (cb.dataset.rule === "minPerYear") {
          const days = parseInt(row.querySelector(".rm-days").value, 10) || 90;
          state = { ...state, countries: applyRule(state.countries, id, "minPerYear", cb.checked, { minDays: days }) };
        } else if (cb.dataset.rule === "rolling") {
          state = { ...state, countries: applyRule(state.countries, id, "rolling", cb.checked, readRolling(row)) };
        } else state = { ...state, countries: setRule(state.countries, id, cb.dataset.rule, cb.checked) };
        commit(); renderManage();
      });
    });
    const ry = row.querySelector(".ry-days");
    if (ry) ry.addEventListener("change", () => { const days = parseInt(ry.value, 10) || 183; state = { ...state, countries: applyRule(state.countries, id, "perYear", true, { maxDays: days }) }; commit(); renderManage(); });
    const rm = row.querySelector(".rm-days");
    if (rm) rm.addEventListener("change", () => { const days = parseInt(rm.value, 10) || 90; state = { ...state, countries: applyRule(state.countries, id, "minPerYear", true, { minDays: days }) }; commit(); renderManage(); });
    row.querySelectorAll(".rl-days, .rl-win, .rl-count").forEach(inp => inp.addEventListener("change", () => {
      if (!row.querySelector('input[data-rule="rolling"]').checked) return;   // only when the rule is enabled
      state = { ...state, countries: applyRule(state.countries, id, "rolling", true, readRolling(row)) };
      commit(); renderManage();
    }));
    row.querySelectorAll(".er-del").forEach(btn => btn.addEventListener("click", e => {
      e.stopPropagation();
      const idx = +btn.dataset.idx;
      state = { ...state, countries: state.countries.map(x => x.id === id ? { ...x, rules: x.rules.filter((_, i) => i !== idx) } : x) };
      commit(); renderManage();
    }));
    wireYearControl(row.querySelector(".manage-years"), () => new Set((state.countries.find(x => x.id === id) || {}).years || []), set => { state = { ...state, countries: setCountryYears(state.countries, id, [...set].sort((a, b) => a - b)) }; commit(); });
    row.querySelector(".manage-del").addEventListener("click", () => {
      const c = state.countries.find(x => x.id === id);
      if (!confirm(`Remove ${c ? c.name : id}? Its trips become unassigned.`)) return;
      state = { countries: state.countries.filter(x => x.id !== id), trips: state.trips.map(t => t.profileId === id ? { ...t, profileId: "" } : t) };
      commit(); renderManage();
    });
  });
  wireYearControl(box.querySelector(".manage-add .manage-years"), () => addDraft.years, () => {});
  const maCode = box.querySelector(".ma-code"), maName = box.querySelector(".ma-name"), maGen = box.querySelector(".ma-gen");
  if (maCode && maName) {
    const syncGen = () => { if (maGen) maGen.hidden = resolveCountryCode(maCode.value) !== "GB"; };
    // bidirectional autofill: typing/picking either field fills the other (until the
    // other is hand-edited). Programmatic .value changes don't refire input → no loop.
    maCode.addEventListener("input", () => {
      delete maCode.dataset.auto;                                  // user is editing the code
      const name = countryNameByCode(resolveCountryCode(maCode.value));
      if (name && (!maName.value.trim() || maName.dataset.auto === "1")) { maName.value = name; maName.dataset.auto = "1"; }
      syncGen();
    });
    maName.addEventListener("input", () => {
      delete maName.dataset.auto;                                  // user is editing the name
      const code = resolveCountryCode(maName.value);               // name → 2-letter code
      if (countryNameByCode(code) && (!maCode.value.trim() || maCode.dataset.auto === "1")) {
        maCode.value = code; maCode.dataset.auto = "1"; syncGen();
      }
    });
  }
  const genLink = box.querySelector(".ma-gen-link"), genBody = box.querySelector(".ma-gen-body");
  if (genLink && genBody) genLink.addEventListener("click", () => { genBody.hidden = !genBody.hidden; genLink.classList.toggle("open", !genBody.hidden); });
  const genBtn = box.querySelector(".gen-uk");
  if (genBtn) genBtn.addEventListener("click", () => {
    const route = parseInt(box.querySelector(".gen-route").value, 10) || 5;
    const from = parseInt(box.querySelector(".gen-year").value, 10) || thisYear;
    const years = []; for (let y = from; y <= from + route; y++) years.push(y);   // qualifying years + citizenship year
    const rules = [
      { type: "rolling", maxDays: 180, windowDays: 365, count: "absent" },                          // ILR continuity: ≤180 days absent / 12 months
      { type: "rolling", maxDays: 90, windowDays: 365, count: "absent", years: [from + route] }      // citizenship final 12 months: ≤90 days absent
    ];
    const existing = state.countries.find(c => c.code === "GB");
    let countries;
    if (existing) countries = state.countries.map(c => c.code === "GB" ? { ...c, name: "United Kingdom", rules, years } : c);
    else countries = [...state.countries, { id: newId(), code: "GB", name: "United Kingdom", rules, years }];
    state = { ...state, countries };
    addDraft = { years: new Set() };
    commit(); renderManage();
  });
  box.querySelector(".ma-add").addEventListener("click", () => {
    const code = resolveCountryCode(box.querySelector(".ma-code").value);
    const name = box.querySelector(".ma-name").value.trim() || countryNameByCode(code) || code;
    if (code.length !== 2) { box.querySelector(".ma-code").focus(); return; }
    const id = newId();
    let countries = [...state.countries, { id, code, name, rules: [] }];
    box.querySelectorAll(".manage-add .manage-rules input[type=checkbox]").forEach(cb => {
      if (cb.dataset.rule === "perYear") { const days = parseInt(box.querySelector(".manage-add .ry-days").value, 10) || 183; countries = applyRule(countries, id, "perYear", cb.checked, { maxDays: days }); }
      else if (cb.dataset.rule === "minPerYear") { const days = parseInt(box.querySelector(".manage-add .rm-days").value, 10) || 90; countries = applyRule(countries, id, "minPerYear", cb.checked, { minDays: days }); }
      else if (cb.dataset.rule === "rolling") { countries = applyRule(countries, id, "rolling", cb.checked, readRolling(box.querySelector(".manage-add"))); }
      else countries = setRule(countries, id, cb.dataset.rule, cb.checked);
    });
    countries = setCountryYears(countries, id, [...addDraft.years].sort((a, b) => a - b));
    addDraft = { years: new Set() };
    state = { ...state, countries };
    commit(); renderManage();
  });
}

document.addEventListener("mousedown", e => {
  if (tripForm && tripForm.style.display === "block" && !tripForm.contains(e.target) && !e.target.classList.contains("gear")) closeForm();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") { closeForm(); closeManage(); closeHelp(); } });

function render() { renderCalendar(); }

/* ---------- view toggle ---------- */
function setView(v) {
  currentView = v;
  document.querySelectorAll(".viewseg button").forEach(b => b.classList.toggle("on", b.dataset.view === v));
  document.getElementById("view-calendar").hidden = v !== "calendar";
  document.getElementById("view-stats").hidden = v !== "stats";
  if (v === "stats" && window.Stats) window.Stats.render();
  saveView();
}
document.querySelector(".viewseg").addEventListener("click", e => {
  const b = e.target.closest("button[data-view]"); if (b) setView(b.dataset.view);
});

/* ---------- toolbar ---------- */
document.getElementById("export").addEventListener("click", () => {
  const blob = new Blob([exportJson(state)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "stay_tracker_export.json"; a.click();
  URL.revokeObjectURL(a.href);
});
document.getElementById("import").addEventListener("click", () => {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/json";
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (!f) return; f.text().then(txt => { try { state = importJson(txt); pendingDate = null; closeForm(); commit(); } catch (err) { alert("Import failed: " + err.message); } }); };
  inp.click();
});
document.getElementById("manage")?.addEventListener("click", openManage);
document.getElementById("reset").addEventListener("click", () => {
  if (!confirm("Clear all trips and reset the catalog to default (Turkey)?")) return;
  state = { countries: defaultCountries(), trips: [] };
  rangeStart = addMonths(thisMonthFirst, -3); rangeEnd = addMonths(thisMonthFirst, 2); saveView();
  pendingDate = null; closeForm(); closeManage(); commit();
});

/* ---------- theme + density (vanilla — replaces the prototype's React tweaks panel) ---------- */
const THEME_ORDER = ["passport", "studio", "cockpit"];
const THEME_ACCENT = { passport: "#bf5a36", studio: "#4b4ad1", cockpit: "#2fd9c4" };
const THEME_NAMES = { passport: "Passport", studio: "Studio", cockpit: "Cockpit" };
const TWEAK_KEY = "stay_tracker_tweaks_v1";
function loadTweaks() {
  // density is always "compact" now (the toggle was removed); ignore any stored "regular"
  try { const o = JSON.parse(localStorage.getItem(TWEAK_KEY)); if (o && THEME_ACCENT[o.theme]) return { theme: o.theme, density: "compact", accent: o.accent || THEME_ACCENT[o.theme] }; } catch (e) {}
  return { theme: "passport", density: "compact", accent: THEME_ACCENT.passport };
}
let tweaks = loadTweaks();
function saveTweaks() { localStorage.setItem(TWEAK_KEY, JSON.stringify(tweaks)); }
function applyTweaks(t) {
  const app = document.querySelector(".app");
  if (!app || !t) return;
  app.classList.add("no-trans");
  app.dataset.theme = t.theme || "passport";
  app.dataset.density = "compact";
  if (t.accent) app.style.setProperty("--accent", t.accent);
  const seg = document.getElementById("theme-switch");
  if (seg) {
    const n = seg.querySelector(".tname"); if (n) n.textContent = THEME_NAMES[t.theme] || "Passport";
    seg.querySelectorAll(".tdot").forEach(d => d.classList.toggle("on", d.dataset.themeOpt === (t.theme || "passport")));
  }
  void app.offsetWidth;
  requestAnimationFrame(() => app.classList.remove("no-trans"));
  if (window.Stats) window.Stats.recolor();
}
function setTheme(name) {
  if (!THEME_ACCENT[name]) return;
  tweaks = { ...tweaks, theme: name, accent: THEME_ACCENT[name] };
  saveTweaks(); applyTweaks(tweaks);
}
function cycleTheme() {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(tweaks.theme) + 1) % THEME_ORDER.length];
  setTheme(next);
}
window.getTrackerState = () => state;

const themeSeg = document.getElementById("theme-switch");
if (themeSeg) themeSeg.addEventListener("click", cycleTheme);

const helpTop = document.getElementById("help-top");
if (helpTop) helpTop.addEventListener("click", openHelp);

/* ---------- boot ---------- */
const footLinkedin = document.getElementById("foot-linkedin");
if (footLinkedin && AUTHOR.linkedin) { footLinkedin.href = AUTHOR.linkedin; footLinkedin.hidden = false; }
const footGithub = document.getElementById("foot-github");
if (footGithub && AUTHOR.github) { footGithub.href = AUTHOR.github; footGithub.hidden = false; }

/* one-time privacy toast: trips live only in localStorage, never sent anywhere */
const PRIVACY_KEY = "stay_tracker_privacy_seen_v1";
const privacyNote = document.getElementById("privacy-note");
if (privacyNote && localStorage.getItem(PRIVACY_KEY) === null) {
  const dismiss = () => {
    privacyNote.classList.add("out");
    setTimeout(() => { privacyNote.hidden = true; }, 400);
    try { localStorage.setItem(PRIVACY_KEY, "1"); } catch (e) {}
  };
  privacyNote.hidden = false;
  document.getElementById("privacy-note-x").addEventListener("click", dismiss);
  setTimeout(dismiss, 7000);
}

if (window.Stats) window.Stats.init(() => state);
applyTweaks(tweaks);
render();
if (savedView && (savedView.mode === "calendar" || savedView.mode === "stats")) setView(savedView.mode);
