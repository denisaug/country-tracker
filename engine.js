"use strict";
/* ============================================================
   engine.js — pure date + visa-rule logic (NO DOM).
   Loaded as a plain <script> in the browser (functions become globals
   that app.js uses) and via require() in Node tests (engine.test.js).
   Keep this file free of document/localStorage/window references.
   ============================================================ */

/* ============================================================
   util/date
   ============================================================ */
function fromIso(s){ return new Date(s + "T00:00:00"); }
function toIso(d){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function addDays(iso,n){ const d=fromIso(iso); d.setDate(d.getDate()+n); return toIso(d); }
function diffDays(a,b){ return Math.round((fromIso(b)-fromIso(a))/86400000); }
function eachDateInclusive(start,end){ const out=[]; let cur=start; while(cur<=end){ out.push(cur); cur=addDays(cur,1);} return out; }
function addMonths(iso,n){
  const d=fromIso(iso), day=d.getDate();
  d.setDate(1); d.setMonth(d.getMonth()+n);
  const lastOfTarget=new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  d.setDate(Math.min(day,lastOfTarget));
  return toIso(d);
}
function todayIso(){ return toIso(new Date()); }

/* ============================================================
   util/id — stable identity for a country PROFILE. The flag `code` is
   display-only and may repeat across profiles (Turkey 2024 vs Turkey 2025);
   `id` is what trips reference and what the engine counts by.
   ============================================================ */
function newId(){ return "p_" + Math.random().toString(36).slice(2,10); }

/* ============================================================
   engine/days — `profileId` is an opaque identity string; the engine doesn't
   care whether it's a flag code (tests) or a generated profile id (app).
   ============================================================ */
function daysInCountry(trips, profileId){
  const set=new Set();
  for(const t of trips){ if(t.profileId!==profileId) continue; for(const d of eachDateInclusive(t.start,t.end)) set.add(d); }
  return [...set].sort();
}
/* `resetStarts` (optional Set of trip start dates) marks where the consecutive clock
   restarts: a separate trip means the user left and came back (an exit, or a same-day
   visa run that shares the border day), so the run must not walk back past a trip's
   first day even when the prior calendar day is present. Omitting it = pure day-set
   contiguity (only an empty calendar day breaks the run). */
function runContaining(daysSorted, date, resetStarts){
  const set=new Set(daysSorted);
  if(!set.has(date)) return null;
  let start=date;
  while(!(resetStarts && resetStarts.has(start)) && set.has(addDays(start,-1))) start=addDays(start,-1);
  return { start, lengthToDate: diffDays(start,date)+1 };
}

/* ============================================================
   engine/rules
   ============================================================ */
function rollingCount(daysSorted, date, windowDays){
  const windowStart=addDays(date,-(windowDays-1));
  let count=0; for(const d of daysSorted) if(d>=windowStart && d<=date) count++;
  return count;
}
function perYearCount(daysSorted, date){
  const year=date.slice(0,4);
  let count=0; for(const d of daysSorted) if(d.slice(0,4)===year && d<=date) count++;
  return count;
}
function ruleCountOn(daysSorted, date, rule, resetStarts){
  switch(rule.type){
    case "rolling": return rollingCount(daysSorted,date,rule.windowDays);
    case "perYear": return perYearCount(daysSorted,date);
    case "minPerYear": return perYearCount(daysSorted,date);
    case "consecutive": { const r=runContaining(daysSorted,date,resetStarts); return r?r.lengthToDate:0; }
  }
}
function ruleViolatedOn(daysSorted, date, rule, resetStarts){
  switch(rule.type){
    case "rolling": {
      const c=rollingCount(daysSorted,date,rule.windowDays);
      if(rule.count==="absent"){
        // counts days AWAY (window − present); can't be "too absent" until a full
        // window of residence history exists, else the pre-arrival gap reads as absence
        if(!daysSorted.length || date < addDays(daysSorted[0], rule.windowDays-1)) return false;
        return (rule.windowDays - c) > rule.maxDays;
      }
      return c > rule.maxDays;
    }
    case "perYear": return perYearCount(daysSorted,date) > rule.maxDays;
    // a minimum-presence rule is never "over" on a given day — a shortfall is a
    // year-level verdict (see minShortfall), so it doesn't paint calendar cells red
    case "minPerYear": return false;
    case "consecutive": { const r=runContaining(daysSorted,date,resetStarts); if(!r) return false; return date > addMonths(r.start, rule.maxMonths); }
  }
}
/* days present in `year` minus the required minimum; >0 means the requirement isn't met yet */
function minShortfall(daysSorted, year, rule){
  let count=0; for(const d of daysSorted) if(d.slice(0,4)===String(year)) count++;
  return { count, shortfall: Math.max(0, rule.minDays - count) };
}
function ruleLabel(rule){
  let base;
  switch(rule.type){
    case "rolling": base=rule.count==="absent"
      ? `≤ ${rule.maxDays} absent / ${rule.windowDays} rolling`
      : `≤ ${rule.maxDays} / ${rule.windowDays} rolling`; break;
    case "consecutive": base=`≤ ${rule.maxMonths} consecutive months`; break;
    case "perYear": base=`≤ ${rule.maxDays} days / year`; break;
    case "minPerYear": base=`≥ ${rule.minDays} days / year`; break;
  }
  if(rule.years && rule.years.length) base += ` · ${rule.years.join("/")}`;
  return base;
}
// human status value for the verdict panel (uses the most recent present day as "now")
function ruleStatus(daysSorted, rule, resetStarts){
  if(daysSorted.length===0) return { broken:false, text:"—" };
  const last=daysSorted[daysSorted.length-1];
  switch(rule.type){
    case "rolling": {
      const c=rollingCount(daysSorted,last,rule.windowDays);
      if(rule.count==="absent"){
        const ready=daysSorted.length && last >= addDays(daysSorted[0], rule.windowDays-1);
        const absent=rule.windowDays - c;
        return { broken: ready && absent>rule.maxDays, text:`${absent} of ${rule.maxDays} absent in last ${rule.windowDays}d` };
      }
      return { broken:c>rule.maxDays, text:`${c} of ${rule.maxDays} · ${Math.max(0,rule.maxDays-c)} left` };
    }
    case "perYear": {
      const c=perYearCount(daysSorted,last);
      return { broken:c>rule.maxDays, text:`${c} of ${rule.maxDays} in ${last.slice(0,4)}` };
    }
    case "consecutive": {
      const r=runContaining(daysSorted,last,resetStarts);
      const broken=ruleViolatedOn(daysSorted,last,rule,resetStarts);
      return { broken, text: r?`${r.lengthToDate} days in a row`:"—" };
    }
    case "minPerYear": {
      const { count, shortfall }=minShortfall(daysSorted,last.slice(0,4),rule);
      return { broken: shortfall>0, text:`${count} of ${rule.minDays} in ${last.slice(0,4)} · ${shortfall} to go` };
    }
  }
}
function violationMessage(country, rule, daysSorted, date){
  switch(rule.type){
    case "rolling": return rule.count==="absent"
      ? `${country.name} — absent ${rule.windowDays - rollingCount(daysSorted,date,rule.windowDays)} of max ${rule.maxDays} days in a ${rule.windowDays}-day window`
      : `${country.name} — exceeded ${rule.maxDays}/${rule.windowDays} (${rollingCount(daysSorted,date,rule.windowDays)} of ${rule.maxDays} days)`;
    case "perYear": return `${country.name} — over ${rule.maxDays} days in ${date.slice(0,4)} (${perYearCount(daysSorted,date)})`;
    case "consecutive": return `${country.name} — over ${rule.maxMonths} consecutive months`;
    case "minPerYear": return `${country.name} — under ${rule.minDays} days in ${date.slice(0,4)}`;
  }
}
/* a country may be scoped to specific calendar years (e.g. a visa valid only in 2025).
   empty/absent years = always in scope. */
function yearInScope(country, date){
  const ys=country.years;
  if(!ys || ys.length===0) return true;
  return ys.includes(+date.slice(0,4));
}
/* which rule drives the running number shown in each cell. Independent of the
   array order (editing a rule must not change the displayed counter): a rolling
   cumulative count is the most useful headline, then yearly, then run length.
   Year-scoped rules are skipped — they only apply in one year. */
const DISPLAY_RULE_PRIORITY=["rolling","perYear","minPerYear","consecutive"];
function displayRule(rules){
  if(!rules || !rules.length) return null;
  const unscoped=r=>!(r.years && r.years.length);
  for(const t of DISPLAY_RULE_PRIORITY){ const r=rules.find(x=>x.type===t && unscoped(x)); if(r) return r; }
  return rules.find(unscoped) || rules[0];
}
function evaluateCountry(country, trips){
  const daysSorted=daysInCountry(trips, country.id);
  // each trip start resets the "consecutive" clock — a separate trip means an exit
  // and return (including a same-day visa run), so adjacent/touching trips don't merge
  const resetStarts=new Set(trips.filter(t=>t.profileId===country.id).map(t=>t.start));
  const primary=displayRule(country.rules);
  const cells=[];
  const byRule=new Map();
  daysSorted.forEach((date,i)=>{
    let violated=false;
    // days outside the country's scoped years still show their flag/number — they just never violate
    if(yearInScope(country,date)){
      for(const rule of country.rules){
        // a rule may itself be scoped to specific years (e.g. the UK citizenship
        // final-year limit applies only in the year of application)
        if(rule.years && rule.years.length && !rule.years.includes(+date.slice(0,4))) continue;
        if(ruleViolatedOn(daysSorted,date,rule,resetStarts)){
          violated=true;
          const acc=byRule.get(rule) || { message: violationMessage(country,rule,daysSorted,date), dates: [] };
          acc.dates.push(date); byRule.set(rule,acc);
        }
      }
    }
    // a cell carries identity (profileId) AND display (code, for the flag) — two profiles
    // may share a code, so the calendar indexes cells by profileId to avoid collisions.
    // number = count per primary rule window; if no rules yet, cumulative days in country
    cells.push({ date, profileId: country.id, code: country.code, number: primary?ruleCountOn(daysSorted,date,primary,resetStarts):(i+1), violated });
  });
  const violations=[];
  for(const [rule,acc] of byRule) violations.push({ profileId:country.id, code:country.code, rule:rule.type, message:acc.message, dates:acc.dates });
  return { id: country.id, code: country.code, cells, violations };
}

/* ============================================================
   model/trips — each trip is an INDEPENDENT record (no merging).
   Day-counting rules (rolling/perYear) union a profile's days, so splitting/adjacency/
   overlap doesn't change THEIR counts. The "consecutive" rule is the exception: a trip
   boundary resets its clock (a separate trip = an exit and return, incl. a same-day visa
   run), so two adjacent/touching trips are two stays, not one — see resetStarts above.
   add/delete/manage operate on one trip at a time. A flight day (A->B) belongs to
   two trips at once, so it counts in both profiles — see tripsCoveringDate in app.js.
   A trip references its country PROFILE by `profileId` ("" = unassigned).
   ============================================================ */
function addTrip(trips, profileId, a, b){
  const start=a<=b?a:b, end=a<=b?b:a;
  return [...trips, {profileId, start, end}];
}

/* ============================================================
   model/migrate — normalise persisted/imported state to the profile model.
   Old format: countries lack `id`; trips reference a country by `country` (a code).
   New format: every country has a stable `id`; every trip has `profileId`.
   Idempotent — already-migrated state passes through unchanged.
   ============================================================ */
function migrateState(obj){
  const countries=(obj.countries||[]).map(c => c.id ? c : {...c, id:newId()});
  const idByCode={};                                   // first profile wins for a given code
  for(const c of countries) if(!(c.code in idByCode)) idByCode[c.code]=c.id;
  const trips=(obj.trips||[]).map(t=>{
    if(t.profileId!==undefined) return t;
    const profileId = t.country ? (idByCode[t.country] || "") : "";   // remap old code ref -> id
    const { country, ...rest } = t;
    return { ...rest, profileId };
  });
  return { countries, trips };
}

/* dual export: browser leaves these as globals; Node test files require() them */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    fromIso, toIso, addDays, diffDays, eachDateInclusive, addMonths, todayIso,
    newId, migrateState,
    daysInCountry, runContaining,
    rollingCount, perYearCount, minShortfall, ruleCountOn, ruleViolatedOn, ruleLabel, ruleStatus, violationMessage, yearInScope, displayRule, evaluateCountry,
    addTrip
  };
}
