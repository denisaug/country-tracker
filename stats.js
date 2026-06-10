"use strict";
/* ============================================================
   stats.js — Stats view: KPI cards, days-per-country bars,
   and a map (draggable d3 globe + flat choropleth). Reuses engine.js
   for day counting and reads the live app state via a getter passed in
   from app.js. Colours follow the active theme + accent.
   Loaded BEFORE app.js so window.Stats exists at boot.
   ============================================================ */
(function () {
  let getState = () => ({ countries: [], trips: [] });
  let mapMode = "d3globe";
  let geo = null;
  const YEARS_KEY = "stay_tracker_stats_years_v1";
  function loadYears() {
    try { const a = JSON.parse(localStorage.getItem(YEARS_KEY)); if (Array.isArray(a) && a.length && a.every(n => Number.isInteger(n))) return [...new Set(a)].sort((x, y) => x - y); } catch (e) {}
    return [+todayIso().slice(0, 4)];
  }
  let selectedYears = loadYears();                         // one or more calendar years, summed
  function saveYears() { localStorage.setItem(YEARS_KEY, JSON.stringify(selectedYears)); }
  let currentData = new Map();   // code -> days (summed over selectedYears)
  let currentCaps = new Map();   // code -> per-year cap, summed over selectedYears
  let currentMins = new Map();   // code -> required minimum, summed over selectedYears
  let currentOvers = new Map();  // code -> violated (overstay) days, summed over selectedYears
  let nameByCode = new Map();
  let booted = false;
  function fmtYears(ys) {
    const s = [...ys].sort((a, b) => a - b);
    if (s.length === 1) return `${s[0]}`;
    const contiguous = s.every((y, i) => i === 0 || y === s[i - 1] + 1);
    return contiguous ? `${s[0]}–${s[s.length - 1]}` : s.join(", ");
  }

  const GEO_URL = "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson";
  function flagSrc(code) { return `https://flagcdn.com/${code.toLowerCase()}.svg`; }
  function $(id) { return document.getElementById(id); }
  function cssVar(name) {
    const app = document.querySelector(".app");
    return app ? getComputedStyle(app).getPropertyValue(name).trim() : "";
  }

  function daysPerCountry(years) {
    const yset = new Set(years);
    const state = getState();
    const codeByProfile = new Map(state.countries.map(c => [c.id, c.code]));
    const byCode = new Map();
    for (const t of state.trips) {
      const code = codeByProfile.get(t.profileId);
      if (!code) continue;
      for (const d of eachDateInclusive(t.start, t.end)) {
        if (!yset.has(+d.slice(0, 4))) continue;
        if (!byCode.has(code)) byCode.set(code, new Set());
        byCode.get(code).add(d);
      }
    }
    const m = new Map();
    for (const [code, set] of byCode) if (set.size > 0) m.set(code, set.size);
    return m;
  }
  /* sum per-year maps (cap / min / overstay) over the selected years, by code */
  function sumByYear(years, fn) {
    const m = new Map();
    for (const y of years) for (const [code, v] of fn(y)) m.set(code, (m.get(code) || 0) + v);
    return m;
  }

  /* ---- year picker (multi-select; chart sums the chosen years) ---- */
  function toggleYear(y) {
    const set = new Set(selectedYears);
    if (set.has(y)) { if (set.size === 1) return; set.delete(y); }   // keep at least one
    else set.add(y);
    selectedYears = [...set].sort((a, b) => a - b);
    saveYears();
    render();
  }
  function renderYearPick() {
    const el = $("year-pick"); if (!el) return;
    const now = +todayIso().slice(0, 4);
    const years = [...new Set([now - 1, now, now + 1, ...selectedYears])].sort((a, b) => a - b);
    el.innerHTML = "";
    for (const y of years) {
      const b = document.createElement("button");
      b.className = "yr-chip" + (selectedYears.includes(y) ? " on" : "");
      b.textContent = y;
      b.addEventListener("click", () => toggleYear(y));
      el.appendChild(b);
    }
  }

  /* ---- KPI cards ---- */
  function daysInYear(yr) { return (yr % 4 === 0 && (yr % 100 !== 0 || yr % 400 === 0)) ? 366 : 365; }
  function uniqueTrackedDays(years) {
    const yset = new Set(years);
    const state = getState();
    const set = new Set();
    for (const t of state.trips) for (const d of eachDateInclusive(t.start, t.end)) if (yset.has(+d.slice(0, 4))) set.add(d);
    return set.size;
  }
  /* smallest per-calendar-year day cap per country code, in scope for yr (null = no cap) */
  function perYearCapByCode(yr) {
    const state = getState();
    const m = new Map();
    for (const c of state.countries) {
      if (!c.code) continue;
      const inScope = !c.years || c.years.length === 0 || c.years.includes(yr);
      if (!inScope) continue;
      const r = (c.rules || []).find(x => x.type === "perYear");
      if (!r) continue;
      const prev = m.get(c.code);
      m.set(c.code, prev == null ? r.maxDays : Math.min(prev, r.maxDays));
    }
    return m;
  }
  /* largest required minimum days per code, in scope for yr (null = no minimum) */
  function minPerYearByCode(yr) {
    const state = getState();
    const m = new Map();
    for (const c of state.countries) {
      if (!c.code) continue;
      const inScope = !c.years || c.years.length === 0 || c.years.includes(yr);
      if (!inScope) continue;
      const r = (c.rules || []).find(x => x.type === "minPerYear");
      if (!r) continue;
      const prev = m.get(c.code);
      m.set(c.code, prev == null ? r.minDays : Math.max(prev, r.minDays));
    }
    return m;
  }
  function renderKpis() {
    const el = $("kpi-row"); if (!el) return;
    const data = [...currentData.entries()].sort((a, b) => b[1] - a[1]);
    const top = data[0];
    const tracked = uniqueTrackedDays(selectedYears);
    const span = selectedYears.reduce((s, y) => s + daysInYear(y), 0);
    const untracked = Math.max(0, span - tracked);
    el.innerHTML =
      kpi("Days tracked", tracked, `of ${span} in ${fmtYears(selectedYears)} · ${untracked} untracked`) +
      kpi("Countries", data.length, data.length === 1 ? "destination" : "destinations") +
      (top
        ? `<div class="kpi"><div class="k-label">Most days</div><div class="k-val">${top[1]}</div>` +
          `<div class="k-sub"><img class="flag-img" src="${flagSrc(top[0])}" alt="${top[0]}" onerror="this.style.display='none'">${nameByCode.get(top[0]) || top[0]}</div></div>`
        : kpi("Most days", "—", "no trips yet"));
  }
  function kpi(label, val, sub) {
    return `<div class="kpi"><div class="k-label">${label}</div><div class="k-val">${val}</div><div class="k-sub">${sub}</div></div>`;
  }

  /* days that break any rule (the red calendar cells) per code, for the active year.
     This is the overstay for rolling/consecutive rules; for a perYear cap it equals n - cap. */
  function overstayDaysByCode(yr) {
    const state = getState();
    const m = new Map();
    for (const c of state.countries) {
      if (!c.code || !(c.rules && c.rules.length)) continue;
      let v = 0;
      const res = evaluateCountry(c, state.trips);
      for (const cell of res.cells) if (cell.violated && +cell.date.slice(0, 4) === yr) v++;
      if (v > 0) m.set(c.code, (m.get(c.code) || 0) + v);
    }
    return m;
  }
  /* ---- bar chart ---- */
  function renderChart() {
    const cy = $("chart-year"); if (cy) cy.textContent = fmtYears(selectedYears);
    const el = $("chart"); if (!el) return;
    const data = [...currentData.entries()].sort((a, b) => b[1] - a[1]);
    if (!data.length) { el.innerHTML = `<p class="empty">No days recorded in ${fmtYears(selectedYears)}.</p>`; return; }
    const caps = currentCaps, mins = currentMins, overs = currentOvers;
    const yearComplete = Math.max(...selectedYears) < +todayIso().slice(0, 4);   // all chosen years are in the past
    const usedMax = Math.max(...data.map(d => d[1]));
    const shownCaps = data.map(([code]) => caps.get(code)).filter(v => v != null);
    const shownMins = data.map(([code]) => mins.get(code)).filter(v => v != null);
    const scaleMax = Math.max(usedMax, ...shownCaps, ...shownMins, 1);
    el.innerHTML = data.map(([code, n]) => {
      const name = nameByCode.get(code) || code;
      const cap = caps.get(code);
      const minReq = mins.get(code);
      const over = Math.min(n, overs.get(code) || 0);   // violated days = overstay
      const compliant = n - over;
      const compPct = Math.round(compliant / scaleMax * 100);    // accent portion
      const overPct = Math.round(over / scaleMax * 100);         // red portion at the end
      const allOver = over > 0 && compliant <= 0;
      const nPct = Math.round(n / scaleMax * 100);
      const capPct = cap != null ? Math.min(100, Math.round(cap / scaleMax * 100)) : 0;
      const minPct = minReq != null ? Math.min(100, Math.round(minReq / scaleMax * 100)) : 0;
      const shortfall = minReq != null ? Math.max(0, minReq - n) : 0;   // days still owed
      const needPct = Math.round(shortfall / scaleMax * 100);
      const miss = shortfall > 0 && yearComplete;        // year is over and the minimum wasn't met
      // text priority: overstay > shortfall > headroom-left > minimum met
      let label = "", labelCls = "";
      if (over > 0) { label = `+${over} over`; labelCls = " over"; }
      else if (shortfall > 0) { label = miss ? `${shortfall} short` : `${shortfall} to go`; labelCls = miss ? " short" : " togo"; }
      else if (cap != null) { label = `${Math.max(0, cap - n)} left`; }
      else if (minReq != null) { label = "min met"; labelCls = " met"; }
      return `<div class="bar-row"><span class="bar-label">` +
        `<img class="bar-flag" src="${flagSrc(code)}" alt="${code}" onerror="this.style.display='none'">${name}</span>` +
        `<span class="bar-track${cap != null ? ' has-cap' : ''}">` +
        (cap != null ? `<span class="bar-headroom" style="width:${capPct}%"></span>` : ``) +
        (compliant > 0 ? `<span class="bar-fill${(over > 0 || shortfall > 0) ? ' cut' : ''}" style="width:${compPct}%"></span>` : ``) +
        (over > 0 ? `<span class="bar-over${allOver ? ' full' : ''}" style="left:${compliant > 0 ? compPct : 0}%;width:${overPct}%"></span>` : ``) +
        (shortfall > 0 ? `<span class="bar-need${miss ? ' miss' : ''}" style="left:${nPct}%;width:${needPct}%"></span>` : ``) +
        (cap != null ? `<span class="bar-limit" style="left:${capPct}%" title="limit ${cap}"></span>` : ``) +
        (minReq != null ? `<span class="bar-min${miss ? ' miss' : ''}" style="left:${minPct}%" title="min ${minReq}"></span>` : ``) +
        `</span>` +
        `<span class="bar-val">${n}${label ? `<small class="bar-cap${labelCls}">${label}</small>` : ``}</span></div>`;
    }).join("");
  }

  /* ---- maps ---- */
  function isoOf(f) { const p = f.properties; return p.ISO_A2_EH && p.ISO_A2_EH !== "-99" ? p.ISO_A2_EH : p.ISO_A2; }
  function nameOf(f) { const p = f.properties; return p.NAME || p.ADMIN || p.NAME_LONG || ""; }
  function daysOf(f) { return currentData.get(isoOf(f)) || 0; }
  function colorScale() {
    const accent = cssVar("--accent") || "#4b4ad1";
    const base = cssVar("--accent-soft") || "#e9e9fb";
    const max = Math.max(1, ...currentData.values());
    return d3.scaleSequential([0, max], t => d3.interpolateRgb(base, accent)(0.2 + t * 0.8));
  }
  function clearMap() { const m = $("map"); if (m) m.innerHTML = ""; hideMapPop(); }

  /* ---- hover popover + outline highlight ---- */
  let mapPop = null;
  function ensureMapPop() {
    if (mapPop) return mapPop;
    mapPop = document.createElement("div");
    mapPop.className = "map-pop";
    (document.querySelector(".app") || document.body).appendChild(mapPop);
    return mapPop;
  }
  function showMapPop(e, f) {
    const code = isoOf(f), name = nameOf(f) || code;
    const n = currentData.get(code) || 0;
    const cap = currentCaps.get(code);
    const flag = code ? `<img class="mp-flag" src="${flagSrc(code)}" alt="" onerror="this.style.display='none'">` : "";
    let html = `<div class="mp-head">${flag}<span class="mp-name">${name}</span></div>`;
    if (n > 0) {
      html += `<div class="mp-stat"><span class="mp-days">${n}</span><span class="mp-unit">day${n === 1 ? "" : "s"} in ${fmtYears(selectedYears)}</span></div>`;
      if (cap != null) {
        const over = n > cap, remaining = Math.max(0, cap - n);
        html += `<div class="mp-cap${over ? ' over' : ''}"><b>${cap}</b>-day cap · ${over ? `${n - cap} over` : `${remaining} left`}</div>`;
      }
    } else {
      html += `<div class="mp-empty">No days tracked in ${fmtYears(selectedYears)}</div>`;
    }
    const pop = ensureMapPop();
    pop.innerHTML = html;
    pop.style.display = "block";
    positionMapPop(e);
  }
  function positionMapPop(e) {
    if (!mapPop) return;
    const pad = 14, w = mapPop.offsetWidth, h = mapPop.offsetHeight;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
    mapPop.style.left = x + "px"; mapPop.style.top = y + "px";
  }
  function hideMapPop() { if (mapPop) mapPop.style.display = "none"; }
  function attachMapInteractions(lands) {
    const accent = cssVar("--accent") || "#4b4ad1";
    const baseStroke = cssVar("--panel") || "#fff";
    lands.style("cursor", "pointer")
      .on("mousemove", function (e, f) { showMapPop(e, f); })
      .on("mouseenter", function () { d3.select(this).raise().attr("stroke", accent).attr("stroke-width", 1.8); })
      .on("mouseleave", function () { d3.select(this).attr("stroke", baseStroke).attr("stroke-width", 0.4); hideMapPop(); });
  }

  function renderD3Globe(color) {
    const el = $("map"); clearMap();
    const W = el.clientWidth || 800, H = 540;
    const sphere = cssVar("--panel-2") || "#eef4fc", stroke = cssVar("--line") || "#cdd9ea", land0 = cssVar("--line") || "#dde4ee";
    const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("width", "100%").attr("height", H);
    const proj = d3.geoOrthographic().fitExtent([[20, 20], [W - 20, H - 20]], { type: "Sphere" });
    const path = d3.geoPath(proj);
    svg.append("path").datum({ type: "Sphere" }).attr("d", path).attr("fill", sphere).attr("stroke", stroke);
    const lands = svg.append("g").selectAll("path").data(geo).join("path")
      .attr("d", path).attr("fill", f => { const n = daysOf(f); return n ? color(n) : land0; })
      .attr("stroke", cssVar("--panel") || "#fff").attr("stroke-width", 0.4);
    attachMapInteractions(lands);
    function redraw() { svg.selectAll("path").attr("d", path); }
    let last = null;
    svg.style("cursor", "grab").call(d3.drag()
      .on("start", e => { last = [e.x, e.y]; svg.style("cursor", "grabbing"); })
      .on("drag", e => { const k = 0.5, r = proj.rotate(); proj.rotate([r[0] + (e.x - last[0]) * k, r[1] - (e.y - last[1]) * k]); last = [e.x, e.y]; redraw(); })
      .on("end", () => svg.style("cursor", "grab")));
  }
  function renderFlat(color) {
    const el = $("map"); clearMap();
    const W = el.clientWidth || 800, H = 480;
    const sphere = cssVar("--panel-2") || "#f3f7fc", land0 = cssVar("--line") || "#e6ecf4";
    const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("width", "100%").attr("height", H);
    const proj = d3.geoNaturalEarth1().fitExtent([[6, 6], [W - 6, H - 6]], { type: "Sphere" });
    const path = d3.geoPath(proj);
    svg.append("path").datum({ type: "Sphere" }).attr("d", path).attr("fill", sphere).attr("stroke", cssVar("--line") || "#dde6f1");
    const lands = svg.append("g").selectAll("path").data(geo).join("path")
      .attr("d", path).attr("fill", f => { const n = daysOf(f); return n ? color(n) : land0; })
      .attr("stroke", cssVar("--panel") || "#fff").attr("stroke-width", 0.4);
    attachMapInteractions(lands);
  }
  function renderMap() {
    const note = $("map-note"), mapEl = $("map");
    if (typeof d3 === "undefined") { if (mapEl) mapEl.innerHTML = `<p class="empty">d3 failed to load (offline?).</p>`; return; }
    if (!geo) { if (mapEl) mapEl.innerHTML = `<p class="empty">Loading map…</p>`; return; }
    const color = colorScale();
    if (mapMode === "d3globe") { renderD3Globe(color); if (note) note.textContent = ""; }
    else { renderFlat(color); if (note) note.textContent = ""; }
  }

  /* ---- public ---- */
  function render() {
    nameByCode = new Map(getState().countries.map(c => [c.code, c.name]));
    currentData = daysPerCountry(selectedYears);
    currentCaps = sumByYear(selectedYears, perYearCapByCode);
    currentMins = sumByYear(selectedYears, minPerYearByCode);
    currentOvers = sumByYear(selectedYears, overstayDaysByCode);
    renderYearPick();
    renderKpis();
    renderChart();
    renderMap();
  }

  window.Stats = {
    init(stateGetter) {
      getState = stateGetter || getState;
      if (booted) return; booted = true;
      const sw = $("map-switch");
      if (sw) sw.addEventListener("click", e => {
        const b = e.target.closest("button[data-map]"); if (!b) return;
        mapMode = b.dataset.map;
        [...sw.children].forEach(x => x.classList.toggle("on", x === b));
        renderMap();
      });
      fetch(GEO_URL).then(r => r.json()).then(j => { geo = j.features || j; renderMap(); })
        .catch(() => { const m = $("map"); if (m) m.innerHTML = `<p class="empty">Failed to load map data.</p>`; });
    },
    render,
    recolor() { renderChart(); renderMap(); }
  };
})();
