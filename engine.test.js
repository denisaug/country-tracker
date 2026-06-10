"use strict";
/* Run with:  node --test
   Covers only the hard calculation logic in engine.js (no UI). */
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("./engine.js");

const rolling = (maxDays=90, windowDays=180) => ({ type:"rolling", maxDays, windowDays });
const perYear = (maxDays=183) => ({ type:"perYear", maxDays });
const consec  = (maxMonths=2) => ({ type:"consecutive", maxMonths });
// tests use the flag code AS the profile id (id===code) — the engine treats the
// identity as opaque, so this keeps fixtures terse while exercising the real path.
const country = (code, ...rules) => ({ id: code, code, name: code, rules });

/* ---------------------------------------------------------------
   date math — the parts everything else is built on
   --------------------------------------------------------------- */
test("addMonths clamps to the last day of a shorter target month", () => {
  assert.equal(E.addMonths("2026-01-31", 1), "2026-02-28"); // non-leap
  assert.equal(E.addMonths("2024-01-31", 1), "2024-02-29"); // leap
  assert.equal(E.addMonths("2026-01-31", 3), "2026-04-30"); // 31->30
});

test("diffDays / eachDateInclusive are inclusive and consistent", () => {
  assert.equal(E.diffDays("2026-01-01", "2026-01-10"), 9);
  assert.equal(E.eachDateInclusive("2026-01-01", "2026-01-10").length, 10);
  // crosses a non-leap February without losing/gaining a day
  assert.equal(E.eachDateInclusive("2026-02-27", "2026-03-01").join(","),
    "2026-02-27,2026-02-28,2026-03-01");
});

/* ---------------------------------------------------------------
   day-set construction — overlap is the headline behaviour
   --------------------------------------------------------------- */
test("a shared flight day counts in BOTH countries", () => {
  let trips = [];
  trips = E.addTrip(trips, "TR", "2026-01-05", "2026-01-10"); // arrive TR, fly out 10th
  trips = E.addTrip(trips, "GE", "2026-01-10", "2026-01-15"); // arrive GE the same day

  const tr = E.evaluateCountry(country("TR", rolling()), trips);
  const ge = E.evaluateCountry(country("GE", rolling()), trips);

  const trShared = tr.cells.find(c => c.date === "2026-01-10");
  const geShared = ge.cells.find(c => c.date === "2026-01-10");

  assert.ok(trShared, "flight day present in Turkey");
  assert.ok(geShared, "flight day present in Georgia");
  assert.equal(trShared.number, 6); // 6th consecutive TR day (Jan 5..10)
  assert.equal(geShared.number, 1); // 1st GE day
});

test("overlapping trips in the SAME country do not double-count a day", () => {
  let trips = [];
  trips = E.addTrip(trips, "TR", "2026-01-01", "2026-01-10");
  trips = E.addTrip(trips, "TR", "2026-01-05", "2026-01-15"); // overlaps Jan 5..10

  const days = E.daysInCountry(trips, "TR");
  assert.equal(days.length, 15);                 // Jan 1..15, deduped
  assert.equal(new Set(days).size, days.length); // no duplicates
  const ev = E.evaluateCountry(country("TR", rolling()), trips);
  assert.equal(ev.cells[ev.cells.length - 1].number, 15);
});

test("addTrip normalises reversed start/end", () => {
  const [t] = E.addTrip([], "TR", "2026-01-10", "2026-01-01");
  assert.equal(t.start, "2026-01-01");
  assert.equal(t.end, "2026-01-10");
});

/* ---------------------------------------------------------------
   rolling 90/180 — the window edges are where bugs hide
   --------------------------------------------------------------- */
test("rolling window includes day (n-1) before, excludes day n before", () => {
  const date = "2026-06-30";
  const edgeIn  = E.addDays(date, -179); // last day still inside a 180-day window
  const edgeOut = E.addDays(date, -180); // one day too old
  const days = [edgeOut, edgeIn, date].sort();
  assert.equal(E.rollingCount(days, date, 180), 2); // edgeIn + date, edgeOut dropped
});

test("rolling rule flags the day the count first exceeds the limit", () => {
  // Jan 1 .. Apr 1 (2026, non-leap) = 91 consecutive days
  const trips = E.addTrip([], "TR", "2026-01-01", "2026-04-01");
  const ev = E.evaluateCountry(country("TR", rolling(90, 180)), trips);

  const day90 = ev.cells.find(c => c.date === "2026-03-31"); // 90th day
  const day91 = ev.cells.find(c => c.date === "2026-04-01"); // 91st day
  assert.equal(day90.number, 90);
  assert.equal(day90.violated, false);
  assert.equal(day91.number, 91);
  assert.equal(day91.violated, true);
  assert.equal(ev.violations.length, 1);
  assert.equal(ev.violations[0].rule, "rolling");
});

/* ---------------------------------------------------------------
   perYear — must reset across the calendar boundary
   --------------------------------------------------------------- */
test("perYear counts each calendar year separately", () => {
  const trips = E.addTrip([], "TR", "2025-12-30", "2026-01-02"); // Dec30,31 | Jan1,2
  const ev = E.evaluateCountry(country("TR", perYear(183)), trips);

  assert.equal(ev.cells.find(c => c.date === "2025-12-31").number, 2); // 2 days in 2025
  assert.equal(ev.cells.find(c => c.date === "2026-01-02").number, 2); // reset -> 2 in 2026
});

/* ---------------------------------------------------------------
   consecutive months — depends on addMonths clamping
   --------------------------------------------------------------- */
test("consecutive rule violates only past start + maxMonths", () => {
  // run starts 2026-01-15; 2 months -> 2026-03-15 is the last allowed day
  const trips = E.addTrip([], "TR", "2026-01-15", "2026-03-20");
  const ev = E.evaluateCountry(country("TR", consec(2)), trips);

  assert.equal(ev.cells.find(c => c.date === "2026-03-15").violated, false); // == limit, ok
  assert.equal(ev.cells.find(c => c.date === "2026-03-16").violated, true);  // first over
});

test("consecutive run resets at a trip boundary even when trips are adjacent (no empty day)", () => {
  // a 2-month stay then a separate 1-month stay starting the very next day — a real
  // exit/return, not one continuous stay split for convenience. The clock must reset.
  let trips = [];
  trips = E.addTrip(trips, "TR", "2026-01-01", "2026-03-01"); // 2 months
  trips = E.addTrip(trips, "TR", "2026-03-02", "2026-04-02"); // back next day, fresh stay
  const ev = E.evaluateCountry(country("TR", consec(2)), trips);
  assert.equal(ev.violations.length, 0, "neither stay alone exceeds 2 months");
  assert.equal(ev.cells.find(c => c.date === "2026-03-02").number, 1, "second trip is day 1 of a new run");
  assert.equal(ev.cells.find(c => c.date === "2026-04-02").violated, false);
});

test("consecutive run resets on a same-day visa run (trips share the border day)", () => {
  // leave and re-enter the same day (Mar 1, a visa run): the two TR trips share that day.
  // The clock resets on Mar 1; the new stay is then judged on its own length.
  let trips = [];
  trips = E.addTrip(trips, "TR", "2026-01-01", "2026-03-01");
  trips = E.addTrip(trips, "TR", "2026-03-01", "2026-06-01"); // visa run on Mar 1, then 3 months
  const ev = E.evaluateCountry(country("TR", consec(2)), trips);

  assert.equal(ev.cells.find(c => c.date === "2026-03-01").number, 1, "Mar 1 restarts the run");
  // the shared border day is still a single present day for the country (no double count)
  assert.equal(E.daysInCountry(trips, "TR").filter(d => d === "2026-03-01").length, 1);
  // proof the runs did NOT merge: merged, Mar 2 would already be over 2 months
  assert.equal(ev.cells.find(c => c.date === "2026-03-02").violated, false);
  // the NEW stay still bites on its own: Mar 1 + 2 months = May 1 is the last allowed day
  assert.equal(ev.cells.find(c => c.date === "2026-05-01").violated, false);
  assert.equal(ev.cells.find(c => c.date === "2026-05-02").violated, true);
});

/* ---------------------------------------------------------------
   year scoping — a country/visa valid only in certain calendar years
   --------------------------------------------------------------- */
test("yearInScope: empty/absent years means always", () => {
  assert.equal(E.yearInScope({}, "2030-05-01"), true);
  assert.equal(E.yearInScope({ years: [] }, "2030-05-01"), true);
  assert.equal(E.yearInScope({ years: [2025] }, "2025-12-31"), true);
  assert.equal(E.yearInScope({ years: [2025] }, "2026-01-01"), false);
  assert.equal(E.yearInScope({ years: [2025, 2027] }, "2027-06-01"), true);
});

test("scoped years suppress violations but keep the days visible", () => {
  // Nov 1 2025 .. Mar 1 2026 — count crosses 90 on Jan 30 2026 (day 91)
  const trips = E.addTrip([], "TR", "2025-11-01", "2026-03-01");
  const scoped = { id: "TR", code: "TR", name: "TR", rules: [rolling(90, 180)], years: [2025] };
  const ev = E.evaluateCountry(scoped, trips);

  // nothing disappears — out-of-scope 2026 days are still present with their number
  assert.ok(ev.cells.some(c => c.date === "2026-02-15"));
  const over = ev.cells.find(c => c.date === "2026-01-30");
  assert.equal(over.number, 91);   // still counted
  assert.equal(over.violated, false); // but 2026 is out of scope -> no violation
  assert.equal(ev.violations.length, 0);

  // same trip with NO year scope -> that day IS a violation
  const open = E.evaluateCountry({ id: "TR", code: "TR", name: "TR", rules: [rolling(90, 180)] }, trips);
  assert.equal(open.cells.find(c => c.date === "2026-01-30").violated, true);
  assert.ok(open.violations.length >= 1);
});

/* ---------------------------------------------------------------
   profiles — two profiles can share a flag code but count independently
   --------------------------------------------------------------- */
test("two profiles sharing a code count only their own assigned trips", () => {
  // both are "TR" by flag, but distinct profiles p1 (2024 visa) and p2 (2025 visa)
  let trips = [];
  trips = E.addTrip(trips, "p1", "2024-01-01", "2024-01-10"); // 10 days, profile p1
  trips = E.addTrip(trips, "p2", "2025-01-01", "2025-01-05"); //  5 days, profile p2

  const p1 = E.evaluateCountry({ id:"p1", code:"TR", name:"Turkey 2024", rules:[rolling()] }, trips);
  const p2 = E.evaluateCountry({ id:"p2", code:"TR", name:"Turkey 2025", rules:[rolling()] }, trips);

  assert.equal(p1.cells.length, 10);              // p1 sees only its own days
  assert.equal(p2.cells.length, 5);               // p2 sees only its own days
  assert.equal(p1.cells[p1.cells.length-1].number, 10);
  assert.equal(p2.cells[p2.cells.length-1].number, 5);
  // identity is the profile id; the flag code is carried separately and may repeat
  assert.equal(p1.cells[0].profileId, "p1");
  assert.equal(p1.cells[0].code, "TR");
  assert.equal(p2.cells[0].code, "TR");
});

/* ---------------------------------------------------------------
   migrateState — old (code-referencing) state upgrades to the profile model
   --------------------------------------------------------------- */
test("migrateState gives countries ids and remaps trips from code to profileId", () => {
  const old = {
    countries: [{ code:"TR", name:"Turkey", rules:[] }, { code:"GE", name:"Georgia", rules:[] }],
    trips: [{ country:"TR", start:"2026-01-01", end:"2026-01-05" }, { country:"", start:"2026-02-01", end:"2026-02-02" }],
  };
  const m = E.migrateState(old);
  const tr = m.countries.find(c => c.code==="TR");
  assert.ok(tr.id, "country got an id");
  assert.equal(m.trips[0].profileId, tr.id);      // assigned trip remapped to the id
  assert.equal(m.trips[0].country, undefined);    // old field dropped
  assert.equal(m.trips[1].profileId, "");         // unassigned stays unassigned
});

test("migrateState is idempotent for already-migrated state", () => {
  const cur = { countries:[{ id:"p1", code:"TR", name:"Turkey", rules:[] }], trips:[{ profileId:"p1", start:"2026-01-01", end:"2026-01-02" }] };
  const m = E.migrateState(cur);
  assert.equal(m.countries[0].id, "p1");
  assert.equal(m.trips[0].profileId, "p1");
});

test("runContaining stops at a gap in the day-set", () => {
  let trips = [];
  trips = E.addTrip(trips, "TR", "2026-01-01", "2026-01-05");
  trips = E.addTrip(trips, "TR", "2026-01-10", "2026-01-12"); // gap on Jan 6..9
  const days = E.daysInCountry(trips, "TR");
  const run = E.runContaining(days, "2026-01-12");
  assert.equal(run.start, "2026-01-10");      // not Jan 1 — the gap breaks it
  assert.equal(run.lengthToDate, 3);
});

/* ---------------------------------------------------------------
   UK Global Talent — rolling ABSENCE cap (≤180 days absent in any rolling 12
   months for ILR continuity). Modelled as rolling with count:"absent".
   --------------------------------------------------------------- */
const rollingAbsent = (maxDays=180, windowDays=365) => ({ type:"rolling", maxDays, windowDays, count:"absent" });

test("rolling label distinguishes present cap from absent cap", () => {
  assert.equal(E.ruleLabel(rolling(90, 180)), "≤ 90 / 180 rolling");
  assert.equal(E.ruleLabel(rollingAbsent(180, 365)), "≤ 180 absent / 365 rolling");
});

test("UK absence rule does not flag before a full 365-day window has elapsed", () => {
  // present continuously from the start; early on there isn't a full window yet, so the
  // pre-arrival gap must NOT be mistaken for absence
  const days = E.eachDateInclusive("2025-01-01", "2025-06-30");
  assert.equal(E.ruleViolatedOn(days, "2025-02-01", rollingAbsent()), false);
  assert.equal(E.ruleViolatedOn([], "2025-02-01", rollingAbsent()), false); // empty history is safe
});

test("UK absence rule: continuous presence stays under the 180-day absence cap", () => {
  const days = E.eachDateInclusive("2025-01-01", "2026-12-31"); // two full years present
  // window is full of present days → ~0 absent → compliant
  assert.equal(E.ruleViolatedOn(days, "2026-06-15", rollingAbsent()), false);
});

test("UK absence rule: a long absence exceeds 180 days in the rolling window and breaks continuity", () => {
  // present Jan–Mar 2025 (90 days), then absent ~14 months, back from Jun 2026
  const days = [
    ...E.eachDateInclusive("2025-01-01", "2025-03-31"),
    ...E.eachDateInclusive("2026-06-01", "2026-06-30"),
  ].sort();
  // on 2026-06-15 only ~15 present days sit in the trailing 365 → ~350 absent ≫ 180
  assert.equal(365 - E.rollingCount(days, "2026-06-15", 365) > 180, true);
  assert.equal(E.ruleViolatedOn(days, "2026-06-15", rollingAbsent()), true);
});

test("UK absence rule integrates through evaluateCountry (only present days after a full window can break)", () => {
  let trips = [];
  trips = E.addTrip(trips, "GB", "2025-01-01", "2025-03-31"); // 90 days, then a long gap
  trips = E.addTrip(trips, "GB", "2026-06-01", "2026-06-30"); // back after ~14 months
  const ev = E.evaluateCountry({ id:"GB", code:"GB", name:"United Kingdom", rules:[rollingAbsent()] }, trips);
  const broken = ev.cells.filter(c => c.violated).map(c => c.date);
  assert.ok(broken.includes("2026-06-30"), "a present day after the over-long absence is flagged");
  assert.ok(!broken.includes("2025-02-01"), "early days inside the first window are never flagged");
  assert.equal(ev.violations[0].rule, "rolling");
});

test("the same rolling type still works as a present-day MAX cap by default (Schengen back-compat)", () => {
  // 100 present days inside a 180 window must trip a ≤90/180 cap
  const days = E.eachDateInclusive("2026-01-01", "2026-04-10"); // 100 days
  assert.equal(E.ruleViolatedOn(days, "2026-04-10", rolling(90, 180)), true);
  assert.equal(E.ruleViolatedOn(E.eachDateInclusive("2026-01-01","2026-03-01"), "2026-03-01", rolling(90,180)), false);
});

/* ---------------------------------------------------------------
   per-rule year scope — lets the UK citizenship final-year limit live
   alongside the always-on continuity rule on the same profile
   --------------------------------------------------------------- */
test("a rule scoped to specific years only flags violations within those years", () => {
  let trips = [];
  trips = E.addTrip(trips, "X", "2026-01-01", "2026-06-30"); // >90 in 180 — would break a Schengen cap
  trips = E.addTrip(trips, "X", "2027-01-01", "2027-06-30"); // same overage a year later
  const rule = { ...rolling(90, 180), years: [2027] };       // cap only "armed" in 2027
  const ev = E.evaluateCountry({ id:"X", code:"X", name:"X", rules:[rule] }, trips);
  const broken = ev.cells.filter(c => c.violated).map(c => c.date);
  assert.ok(broken.every(d => d.startsWith("2027")), "only 2027 days are flagged");
  assert.ok(broken.length > 0, "2027 overage is flagged");
  assert.ok(!broken.some(d => d.startsWith("2026")), "2026 overage is ignored (out of rule scope)");
});

test("UK generated pair on ONE profile: ≤180 holds everywhere, ≤90 bites only in the scoped citizenship year", () => {
  // present through to mid-2026, a 120-day absence (Aug 1 – Nov 28), then back
  let trips = [];
  trips = E.addTrip(trips, "GB", "2025-01-01", "2026-07-31");
  trips = E.addTrip(trips, "GB", "2026-11-29", "2026-12-31");
  const absent = 365 - E.rollingCount(E.daysInCountry(trips, "GB"), "2026-11-29", 365);
  assert.ok(absent > 90 && absent <= 180, "the dip sits between the two caps (≈120 absent)");

  // BOTH rules live on the SAME profile so they share one day-set (a trip can only
  // belong to one country, so two GB profiles could not see each other's days)
  const finalYear = {
    id:"GB", code:"GB", name:"United Kingdom",
    rules:[ rollingAbsent(180, 365), { ...rollingAbsent(90, 365), years:[2026] } ],
  };
  const evHit = E.evaluateCountry(finalYear, trips);
  assert.ok(evHit.cells.find(c => c.date === "2026-11-29").violated,
    "≤90 flags the dip because 2026 is the scoped final year");

  // same data, but the strict rule is scoped to a different year → no violation
  const otherYear = { ...finalYear, rules:[ rollingAbsent(180, 365), { ...rollingAbsent(90, 365), years:[2099] } ] };
  const evMiss = E.evaluateCountry(otherYear, trips);
  assert.equal(evMiss.cells.find(c => c.date === "2026-11-29").violated, false,
    "with ≤90 out of scope, ≤180 alone is satisfied (120 ≤ 180)");
});

/* ---------------------------------------------------------------
   displayed cell counter — must be stable, not dependent on rule order
   (editing a rule used to move it to the end and flip the shown number)
   --------------------------------------------------------------- */
test("displayRule prefers rolling, then yearly, and skips year-scoped rules", () => {
  assert.equal(E.displayRule([consec(2), rolling(90, 180)]).type, "rolling");
  assert.equal(E.displayRule([perYear(183), consec(2)]).type, "perYear");
  // a year-scoped rolling rule is ignored for the headline count → falls through to consecutive
  assert.equal(E.displayRule([{ ...rolling(90, 180), years:[2030] }, consec(2)]).type, "consecutive");
  assert.equal(E.displayRule([]), null);
});

test("cell counter is the rolling cumulative count even when consecutive is listed first", () => {
  let trips = [];
  trips = E.addTrip(trips, "TR", "2026-01-01", "2026-01-10"); // 10 days
  trips = E.addTrip(trips, "TR", "2026-02-01", "2026-02-05"); // gap in Jan, then 5 more
  const rules = [consec(2), rolling(90, 180)];                // the "broken" order: consecutive first
  const ev = E.evaluateCountry({ id:"TR", code:"TR", name:"TR", rules }, trips);
  const last = ev.cells[ev.cells.length - 1];
  // 15 = all days inside the 180-day window, NOT the 5-day run length of the second trip
  assert.equal(last.number, 15);
});
