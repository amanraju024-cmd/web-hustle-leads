// AR Methods Leads — app shell, routing and screens.
import * as D from "./data.js";
import { TRADES, searchBusinesses, SearchError } from "./search.js";
import { OWNER_EMAIL, TOMTOM_KEY } from "./config.js";
import {
  esc, safeUrl, telHref, perthDay, weekStart, addDays, prettyDay, fmtTime, fmtDateTime, toDate,
  streakFrom, downloadCsv,
} from "./util.js";

const $ = (sel, root = document) => root.querySelector(sel);
const view = () => $("#view");
const KIND_LABEL = { none: "No website", social: "Social/booking page only", website: "Has website" };
const MEDALS = ["🥇", "🥈", "🥉"];

const state = {
  user: null,       // Firebase auth user
  me: null,         // users/{uid} profile
  goal: 30,
  unsub: [],        // listeners for the current screen
  search: null,     // last search result
  claims: new Map(),
  filter: "none",
  myLeads: [],
  leadFilter: "active",
};

function clearListeners() { state.unsub.forEach((u) => { try { u(); } catch {} }); state.unsub = []; }
function setTitle(t) { document.title = t ? `${t} · AR Methods Leads` : "AR Methods Leads"; }
const isAdmin = () => state.me?.role === "admin";

function toast(msg, kind = "ok") {
  document.querySelectorAll(".toast").forEach((old) => old.remove());
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 3200);
}

async function busy(btn, label, fn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>${esc(label)}`;
  try { return await fn(); }
  finally { btn.disabled = false; btn.innerHTML = old; }
}

function errorBox(msg) { return msg ? `<div class="notice error">${esc(msg)}</div>` : ""; }

// =====================================================================
// Shell
// =====================================================================
function renderShell() {
  const admin = isAdmin();
  const tabs = [
    ["home", "Home", "⌂"], ["find", "Find leads", "⌕"], ["leads", "My leads", "☎"], ["board", "Leaderboard", "★"],
    ...(admin ? [["admin", "Admin", "▦"]] : []),
  ];
  $("#app").innerHTML = `
    <header class="top">
      <a class="brand" href="#home">
        <img src="logo.png" alt="" width="34" height="43">
        <span><b>AR METHODS</b><small>WEBSITES • SYSTEMS • GROWTH</small></span>
      </a>
      <div class="who">
        <span class="who-name">${esc(state.me.name)}${admin ? ' <em class="role">Admin</em>' : ""}</span>
        <a href="#account" class="linkbtn">Account</a>
      </div>
    </header>
    <nav class="tabs" aria-label="Main">
      ${tabs.map(([id, label, icon]) => `<a href="#${id}" data-tab="${id}"><span aria-hidden="true">${icon}</span>${label}</a>`).join("")}
    </nav>
    <main id="view" tabindex="-1"></main>
    <footer class="foot">Made by <b>AR Methods</b> · CEO <b>Aman Raju</b></footer>`;
}

function markTab(name) {
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === name));
}

// =====================================================================
// Routing
// =====================================================================
async function route() {
  if (!state.me) return;
  clearListeners();
  state.routeId = (state.routeId || 0) + 1;
  const [name, arg] = (location.hash.replace(/^#\/?/, "") || "home").split("/");
  const routes = {
    home: screenHome, find: screenFind, leads: screenLeads, board: screenBoard, account: screenAccount,
    admin: screenAdmin, worker: screenWorker, pool: screenPool, team: screenTeam,
  };
  const adminOnly = ["admin", "worker", "pool", "team"];
  let fn = routes[name] || screenHome;
  if (adminOnly.includes(name) && !isAdmin()) fn = screenHome;
  markTab(adminOnly.includes(name) ? "admin" : name);
  window.scrollTo(0, 0);
  try { await fn(arg); }
  catch (e) { console.error(e); view().innerHTML = errorBox(D.authMessage(e)); }
}
window.addEventListener("hashchange", route);

// =====================================================================
// Login / access screens
// =====================================================================
function renderAuth(mode = "signin", msg = "") {
  setTitle("Sign in");
  const owner = mode === "owner";
  $("#app").innerHTML = `
    <div class="auth">
      <div class="auth-card">
        <img src="logo.png" alt="AR Methods" width="64" height="82" class="auth-logo">
        <h1 class="wordmark">AR METHODS</h1>
        <p class="tagline">WEBSITES • SYSTEMS • GROWTH</p>
        <h2>${owner ? "Owner setup" : "Sign in to Leads"}</h2>
        ${owner ? `<p class="muted">First time only. Create the owner account for ${esc(OWNER_EMAIL)}. Workers get their logins from you.</p>` : ""}
        ${errorBox(msg)}
        <form id="authForm" novalidate>
          ${owner ? `<label for="name">Your name</label><input id="name" autocomplete="name" value="Aman Raju" required>` : ""}
          <label for="email">Email</label>
          <input id="email" type="email" autocomplete="email" value="${owner ? esc(OWNER_EMAIL) : ""}" required>
          <label for="password">Password${owner ? " (at least 6 characters)" : ""}</label>
          <input id="password" type="password" autocomplete="${owner ? "new-password" : "current-password"}" required>
          <button class="primary wide" type="submit">${owner ? "Create owner account" : "Sign in"}</button>
        </form>
        <div class="auth-links">
          ${owner ? `<button class="linkbtn" data-mode="signin">Back to sign in</button>`
            : `<button class="linkbtn" id="forgot">Forgot password?</button><button class="linkbtn" data-mode="owner">Owner setup</button>`}
        </div>
      </div>
      <footer class="foot">Made by <b>AR Methods</b> · CEO <b>Aman Raju</b></footer>
    </div>`;
  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => renderAuth(b.dataset.mode)));
  $("#forgot")?.addEventListener("click", async () => {
    const email = $("#email").value.trim();
    if (!email) return renderAuth("signin", "Type your email above first, then tap “Forgot password?”.");
    try { await D.resetPassword(email); toast("Password reset email sent. Check your inbox."); }
    catch (e) { renderAuth("signin", D.authMessage(e)); }
  });
  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#email").value.trim();
    const password = $("#password").value;
    if (!email || !password) return renderAuth(mode, "Enter your email and password.");
    const btn = e.submitter || $("#authForm button");
    await busy(btn, owner ? "Creating" : "Signing in", async () => {
      try {
        if (owner) {
          if (email.toLowerCase() !== OWNER_EMAIL) return renderAuth(mode, "Only the owner can create an account here. Ask your admin for a login.");
          state.pendingOwnerName = $("#name").value.trim() || "Aman Raju";
          await D.signUp(email, password);
        } else {
          await D.signIn(email, password);
        }
      } catch (err) {
        const m = D.authMessage(err);
        renderAuth(owner && err.code?.includes("email-already-in-use") ? "signin" : mode,
          owner && err.code?.includes("email-already-in-use") ? "The owner account already exists. Sign in instead." : m);
      }
    });
  });
}

function renderBlocked(title, text) {
  $("#app").innerHTML = `
    <div class="auth"><div class="auth-card">
      <img src="logo.png" alt="AR Methods" width="64" height="82" class="auth-logo">
      <h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
      <button class="primary wide" id="out">Sign out</button>
    </div></div>`;
  $("#out").addEventListener("click", D.logOut);
}

D.onAuthStateChanged(D.auth, async (user) => {
  clearListeners();
  state.user = user;
  state.me = null;
  if (!user) return renderAuth();
  $("#app").innerHTML = `<div class="loading"><span class="spinner"></span>Loading…</div>`;
  try {
    let me = await D.getProfile(user.uid);
    if (!me && user.email?.toLowerCase() === OWNER_EMAIL) {
      await D.createOwnerProfile(user, state.pendingOwnerName || "Aman Raju");
      me = await D.getProfile(user.uid);
    }
    if (!me) return renderBlocked("No access yet", "This login hasn't been set up. Ask Aman to create your worker account.");
    if (!me.active) return renderBlocked("Account turned off", "Your account has been deactivated. Contact Aman if you think this is a mistake.");
    state.me = me;
    state.goal = await D.getDailyGoal().catch(() => 30);
    renderShell();
    route();
  } catch (e) {
    console.error(e);
    renderBlocked("Couldn't load your account", D.authMessage(e));
  }
});

// =====================================================================
// Home
// =====================================================================
async function screenHome() {
  setTitle("Home");
  const today = perthDay();
  view().innerHTML = `<h1 class="page">G'day, ${esc(state.me.name.split(" ")[0])}</h1><div id="homeBody"><div class="loading"><span class="spinner"></span></div></div>`;
  const rid = state.routeId;
  const [mine, leads] = await Promise.all([D.getStatsFor(state.me.id), D.getLeadsFor(state.me.id)]);
  if (rid !== state.routeId) return;
  const draw = (todayRows) => {
    if (!$("#homeBody")) return;
    const board = D.leaderboard(todayRows);
    const rank = board.findIndex((r) => r.uid === state.me.id);
    const t = board[rank] || { calls: 0, interested: 0, won: 0, points: 0 };
    const allMine = mine.filter((r) => r.day !== today).concat(todayRows.filter((r) => r.uid === state.me.id));
    const streak = streakFrom(allMine.filter((r) => r.calls > 0).map((r) => r.day), today);
    const best = allMine.reduce((b, r) => (r.calls > (b?.calls || 0) ? r : b), null);
    const pct = Math.min(100, Math.round((t.calls / state.goal) * 100));
    const endOfToday = new Date(`${addDays(today, 1)}T00:00:00+08:00`);
    const due = leads.filter((l) => l.status === "Call back" && toDate(l.callbackAt) && toDate(l.callbackAt) < endOfToday)
      .sort((a, b) => toDate(a.callbackAt) - toDate(b.callbackAt));
    const fresh = leads.filter((l) => l.status === "New").length;
    $("#homeBody").innerHTML = `
      <section class="goal card">
        <div class="goal-head"><span>Today's calls</span><b class="num">${t.calls} / ${state.goal}</b></div>
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${state.goal}" aria-valuenow="${t.calls}"><span style="width:${pct}%"></span></div>
        <p class="muted">${t.calls >= state.goal ? "Goal smashed. Keep going." : `${state.goal - t.calls} more to hit today's goal.`}</p>
      </section>
      <section class="tiles">
        <div class="tile"><span>Points today</span><b class="num">${t.points}</b></div>
        <div class="tile"><span>Rank today</span><b class="num">${rank >= 0 ? `${MEDALS[rank] || "#" + (rank + 1)}` : "—"}</b></div>
        <div class="tile"><span>Streak</span><b class="num">${streak} day${streak === 1 ? "" : "s"}</b></div>
        <div class="tile"><span>Best day</span><b class="num">${best ? best.calls : 0}</b><small>${best ? prettyDay(best.day) : "No calls yet"}</small></div>
      </section>
      <section class="card">
        <h2>Call-backs due</h2>
        ${due.length ? `<ul class="plain">${due.map((l) => `
          <li class="due ${toDate(l.callbackAt) < new Date() ? "overdue" : ""}">
            <a href="#leads">${esc(l.name)}</a>
            <span>${esc(fmtDateTime(l.callbackAt))}</span>
            ${l.phone ? `<a class="phone" href="${esc(telHref(l.phone))}">${esc(l.phone)}</a>` : ""}
          </li>`).join("")}</ul>` : `<p class="muted">Nothing due today.</p>`}
      </section>
      <section class="quick">
        <a class="primary" href="#find">Find new leads</a>
        <a class="ghost" href="#leads">My leads (${fresh} new)</a>
      </section>
      <p class="muted small">Points: each call 1 · Interested +3 · Won +10</p>`;
  };
  state.unsub.push(D.watchStats("day", today, draw, (e) => { $("#homeBody").innerHTML = errorBox(D.authMessage(e)); }));
}

// =====================================================================
// Find leads
// =====================================================================
function screenFind() {
  setTitle("Find leads");
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("arm_search") || "{}"); } catch {}
  view().innerHTML = `
    <h1 class="page">Find leads</h1>
    <form class="card search" id="searchForm" autocomplete="off">
      <div><label for="suburb">Suburb</label><input id="suburb" placeholder="e.g. Willetton" maxlength="60" value="${esc(saved.suburb || "")}" required></div>
      <div><label for="trade">Business type</label>
        <select id="trade">${TRADES.map((t) => `<option value="${t.id}" ${t.id === saved.trade ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select></div>
      <button class="primary" type="submit" id="searchBtn">Search</button>
      <label class="check"><input type="checkbox" id="onlySuburb" ${saved.only === false ? "" : "checked"}> Only inside this suburb</label>
    </form>
    <div id="searchMsg"></div>
    <div id="results"></div>`;
  $("#searchForm").addEventListener("submit", runSearch);
  if (state.search) drawResults();
}

async function runSearch(e) {
  e.preventDefault();
  const suburb = $("#suburb").value.trim();
  const tradeId = $("#trade").value;
  const onlySuburb = $("#onlySuburb").checked;
  if (!suburb) return;
  try { localStorage.setItem("arm_search", JSON.stringify({ suburb, trade: tradeId, only: onlySuburb })); } catch {}
  $("#searchMsg").innerHTML = "";
  await busy($("#searchBtn"), "Searching", async () => {
    try {
      const result = await searchBusinesses({
        suburb, tradeId, onlySuburb, tomtomKey: TOMTOM_KEY,
        onProgress: (msg) => { if ($("#searchMsg")) $("#searchMsg").innerHTML = `<div class="notice info"><span class="spinner"></span>${esc(msg)}</div>`; },
      });
      $("#searchMsg").innerHTML = "";
      state.search = result;
      state.claims = await D.getClaims(result.leads.map((l) => l.id));
      const c = countKinds(result.leads);
      state.filter = c.none ? "none" : c.social ? "social" : "all";
      if (!result.cached) D.recordSearch(state.me, result);
      drawResults();
    } catch (err) {
      console.error(err);
      $("#searchMsg").innerHTML = errorBox(err instanceof SearchError ? err.message : D.authMessage(err));
    }
  });
}

function countKinds(leads) {
  const c = { none: 0, social: 0, website: 0 };
  leads.forEach((l) => c[l.websiteKind]++);
  return c;
}

function drawResults() {
  const r = state.search;
  if (!r || !$("#results")) return;
  const c = countKinds(r.leads);
  const shown = state.filter === "all" ? r.leads : r.leads.filter((l) => l.websiteKind === state.filter);
  const sources = [`OpenStreetMap ${r.counts.osm ?? "failed"}`].concat(r.counts.tomtom !== undefined ? [`TomTom ${r.counts.tomtom ?? "failed"}`] : []);
  $("#results").innerHTML = `
    ${r.errors.length ? `<div class="notice warn">${esc(r.errors.join(" "))}</div>` : ""}
    <div class="chips" role="group" aria-label="Filter results">
      ${[["none", c.none], ["social", c.social], ["website", c.website], ["all", r.leads.length]].map(([k, n]) =>
        `<button type="button" class="chip ${state.filter === k ? "on" : ""}" data-filter="${k}">${k === "all" ? "All" : KIND_LABEL[k]} (${n})</button>`).join("")}
    </div>
    <p class="muted small">${esc(r.trade.label)} in ${esc(r.suburb)} · ${esc(sources.join(" · "))}.
      “No website” means none is listed. Tap <b>Check Google</b> before you call to confirm.</p>
    ${isAdmin() && shown.length ? `<div class="toolbar"><button class="ghost" id="poolAll">Add all shown to pool</button></div>` : ""}
    <div class="list">${shown.length ? shown.map(resultCard).join("") : `<div class="empty">${r.leads.length ? "Nothing in this group. Try another filter." : "No businesses found. Try another business type, a nearby suburb, or untick “Only inside this suburb”."}</div>`}</div>`;
  document.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { state.filter = b.dataset.filter; drawResults(); }));
  document.querySelectorAll("[data-claim]").forEach((b) => b.addEventListener("click", () => doClaim(b)));
  $("#poolAll")?.addEventListener("click", async (e) => {
    const unclaimed = shown.filter((l) => !state.claims.has(l.id));
    await busy(e.currentTarget, "Saving", async () => {
      try { const n = await D.addToPool(state.me, unclaimed); toast(n ? `Added ${n} to the pool` : "Those are already saved"); }
      catch (err) { toast(D.authMessage(err), "bad"); }
    });
  });
}

function leadLinks(l) {
  const q = encodeURIComponent(`${l.name} ${l.suburb} WA`);
  const site = safeUrl(l.website);
  return `
    <a href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">Check Google</a>
    <a href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">Map</a>
    ${site ? `<a href="${esc(site)}" target="_blank" rel="noopener">${esc(site.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 40))}</a>` : ""}`;
}

function resultCard(l) {
  const claim = state.claims.get(l.id);
  const action = claim
    ? (claim.uid === state.me.id ? `<span class="pill mine">Yours ✓</span>` : `<span class="pill taken">Taken by ${esc(claim.name)}</span>`)
    : `<button class="primary small" data-claim="${esc(l.id)}">Claim</button>`;
  return `
    <article class="lead">
      <div class="lead-main">
        <h3>${esc(l.name)} <span class="badge ${l.websiteKind}">${KIND_LABEL[l.websiteKind]}</span></h3>
        <p class="muted">${esc(l.category)}${l.address ? " · " + esc(l.address) : ""} · ${esc(l.suburb)}</p>
        <p class="row">${l.phone ? `<a class="phone" href="${esc(telHref(l.phone))}">📞 ${esc(l.phone)}</a>` : `<span class="muted">No phone listed</span>`} ${leadLinks(l)}</p>
      </div>
      <div class="lead-act">${action}</div>
    </article>`;
}

async function doClaim(btn) {
  const lead = state.search.leads.find((l) => l.id === btn.dataset.claim);
  await busy(btn, "Claiming", async () => {
    try {
      await D.claimLead(state.me, lead);
      state.claims.set(lead.id, { uid: state.me.id, name: state.me.name });
      toast(`${lead.name} is yours. It's in My leads.`);
    } catch (err) {
      if (err instanceof D.TakenError) {
        state.claims.set(lead.id, { uid: "?", name: err.takenBy });
        toast(err.message, "bad");
      } else toast(D.authMessage(err), "bad");
    }
  });
  drawResults();
}

// =====================================================================
// My leads
// =====================================================================
function screenLeads() {
  setTitle("My leads");
  view().innerHTML = `<h1 class="page">My leads</h1><div id="leadsBody"><div class="loading"><span class="spinner"></span></div></div>`;
  state.unsub.push(D.watchMyLeads(state.me.id, (leads) => { state.myLeads = leads; drawMyLeads(); },
    (e) => { $("#leadsBody").innerHTML = errorBox(D.authMessage(e)); }));
}

function drawMyLeads() {
  const body = $("#leadsBody");
  if (!body) return;
  // keep whatever the user is typing
  if (body.contains(document.activeElement) && document.activeElement.matches("textarea, input")) return;
  const now = new Date();
  const leads = state.myLeads;
  const groups = {
    active: (l) => !["Not interested", "Won"].includes(l.status),
    New: (l) => l.status === "New", "Call back": (l) => l.status === "Call back", Interested: (l) => l.status === "Interested",
    "No answer": (l) => l.status === "No answer", Won: (l) => l.status === "Won", "Not interested": (l) => l.status === "Not interested",
    all: () => true,
  };
  const label = { active: "To work", all: "All" };
  const shown = leads.filter(groups[state.leadFilter] || groups.active).sort((a, b) => {
    const ad = a.status === "Call back" && toDate(a.callbackAt), bd = b.status === "Call back" && toDate(b.callbackAt);
    if (ad && bd) return ad - bd;
    if (ad) return -1;
    if (bd) return 1;
    return (toDate(b.updatedAt) || 0) - (toDate(a.updatedAt) || 0);
  });
  body.innerHTML = `
    <div class="chips">${Object.keys(groups).map((k) =>
      `<button class="chip ${state.leadFilter === k ? "on" : ""}" data-lf="${esc(k)}">${esc(label[k] || k)} (${leads.filter(groups[k]).length})</button>`).join("")}</div>
    <div class="list">${shown.length ? shown.map((l) => myLeadCard(l, now)).join("")
      : `<div class="empty">${leads.length ? "No leads in this group." : `No leads yet. <a href="#find">Find and claim some</a>.`}</div>`}</div>`;
  body.querySelectorAll("[data-lf]").forEach((b) => b.addEventListener("click", () => { state.leadFilter = b.dataset.lf; drawMyLeads(); }));
  body.querySelectorAll("article[data-id]").forEach(wireLeadCard);
}

function toLocalInput(ts) {
  const d = toDate(ts);
  if (!d) return "";
  const p = new Date(d.getTime() + 8 * 3600 * 1000); // Perth is UTC+8 all year
  return p.toISOString().slice(0, 16);
}
function fromLocalInput(v) { return v ? D.Timestamp.fromDate(new Date(v + ":00+08:00")) : null; }

function myLeadCard(l, now) {
  const due = l.status === "Call back" && toDate(l.callbackAt);
  return `
    <article class="lead mylead ${due && due < now ? "overdue" : ""}" data-id="${esc(l.id)}">
      <div class="lead-main">
        <h3>${esc(l.name)} <span class="badge ${esc(l.websiteKind)}">${KIND_LABEL[l.websiteKind] || ""}</span> <span class="status s-${esc(l.status.replace(/\s/g, ""))}">${esc(l.status)}</span></h3>
        <p class="muted">${esc(l.category)}${l.address ? " · " + esc(l.address) : ""} · ${esc(l.suburb)}${l.lastCalledAt ? " · last called " + esc(fmtDateTime(l.lastCalledAt)) : ""}</p>
        ${due ? `<p class="due-line">Call back ${esc(fmtDateTime(l.callbackAt))}</p>` : ""}
        <p class="row">${l.phone ? `<a class="phone" href="${esc(telHref(l.phone))}">📞 ${esc(l.phone)}</a>` : `<span class="muted">No phone listed</span>`} ${leadLinks(l)}</p>
        <div class="log">
          <label for="n-${esc(l.id)}">Notes</label>
          <textarea id="n-${esc(l.id)}" rows="2" maxlength="2000" placeholder="Who you spoke to, what they said…">${esc(l.notes)}</textarea>
          <div class="cb ${l.status === "Call back" ? "" : "hidden"}"><label for="c-${esc(l.id)}">Call back at (Perth time)</label>
            <input type="datetime-local" id="c-${esc(l.id)}" value="${esc(toLocalInput(l.callbackAt))}"></div>
          <p class="small muted">Log this call as:</p>
          <div class="outcomes">${D.CALL_STATUSES.map((s) => `<button class="out o-${s.replace(/\s/g, "")}" data-status="${esc(s)}">${esc(s)}</button>`).join("")}</div>
          <button class="linkbtn" data-save>Save notes only</button>
        </div>
      </div>
    </article>`;
}

function wireLeadCard(card) {
  const lead = state.myLeads.find((l) => l.id === card.dataset.id);
  const notes = card.querySelector("textarea");
  const cbBox = card.querySelector(".cb");
  const cbInput = card.querySelector('input[type="datetime-local"]');
  card.querySelectorAll("[data-status]").forEach((btn) => btn.addEventListener("click", async () => {
    const status = btn.dataset.status;
    if (status === "Call back" && !cbInput.value) {
      cbBox.classList.remove("hidden");
      cbInput.focus();
      toast("Pick a call-back time, then tap Call back again.");
      return;
    }
    await busy(btn, "Saving", async () => {
      try {
        await D.logCall(state.me, lead, status, notes.value, status === "Call back" ? fromLocalInput(cbInput.value) : null);
        document.activeElement?.blur();
        toast(`Logged: ${status} (+${D.pointsFor(status)} pt${D.pointsFor(status) === 1 ? "" : "s"})`);
      } catch (err) { console.error(err); toast(D.authMessage(err), "bad"); }
    });
    drawMyLeads();
  }));
  card.querySelector("[data-save]").addEventListener("click", async (e) => {
    await busy(e.currentTarget, "Saving", async () => {
      try { await D.saveNotes(lead.id, notes.value, lead.status === "Call back" ? fromLocalInput(cbInput.value) : lead.callbackAt); toast("Notes saved"); document.activeElement?.blur(); }
      catch (err) { toast(D.authMessage(err), "bad"); }
    });
    drawMyLeads();
  });
}

// =====================================================================
// Leaderboard
// =====================================================================
function screenBoard() {
  setTitle("Leaderboard");
  const today = perthDay();
  const week = weekStart(today);
  let tab = sessionStorage.getItem("arm_board") || "today";
  view().innerHTML = `
    <h1 class="page">Leaderboard</h1>
    <div class="chips"><button class="chip" data-b="today">Today</button><button class="chip" data-b="week">This week</button></div>
    <div id="boardBody"><div class="loading"><span class="spinner"></span></div></div>
    <p class="muted small">Points: each call 1 · Interested +3 · Won +10. Weeks start Monday (Perth time).</p>`;
  let rows = { today: [], week: [] };
  const draw = () => {
    if (!$("#boardBody")) return;
    document.querySelectorAll("[data-b]").forEach((b) => b.classList.toggle("on", b.dataset.b === tab));
    $("#boardBody").innerHTML = boardTable(D.leaderboard(tab === "today" ? rows.week.filter((r) => r.day === today) : rows.week),
      tab === "today" ? prettyDay(today) : `Week of ${prettyDay(week)}`);
  };
  document.querySelectorAll("[data-b]").forEach((b) => b.addEventListener("click", () => {
    tab = b.dataset.b; try { sessionStorage.setItem("arm_board", tab); } catch {} draw();
  }));
  state.unsub.push(D.watchStats("week", week, (r) => { rows.week = r; draw(); }, (e) => { $("#boardBody").innerHTML = errorBox(D.authMessage(e)); }));
}

function boardTable(board, caption) {
  if (!board.length) return `<div class="empty">No calls logged yet. First call takes the lead.</div>`;
  return `
    <div class="tablewrap"><table class="board">
      <caption>${esc(caption)}</caption>
      <thead><tr><th>#</th><th>Name</th><th class="n">Calls</th><th class="n">Interested</th><th class="n">Won</th><th class="n">Points</th></tr></thead>
      <tbody>${board.map((r, i) => `
        <tr class="${r.uid === state.me.id ? "me" : ""} ${i < 3 ? "top" + (i + 1) : ""}">
          <td>${MEDALS[i] || i + 1}</td><td>${esc(r.name)}${r.uid === state.me.id ? ' <em class="you">You</em>' : ""}</td>
          <td class="n">${r.calls}</td><td class="n">${r.interested}</td><td class="n">${r.won}</td><td class="n"><b>${r.points}</b></td>
        </tr>`).join("")}</tbody>
    </table></div>`;
}

// =====================================================================
// Account
// =====================================================================
function screenAccount() {
  setTitle("Account");
  view().innerHTML = `
    <h1 class="page">Account</h1>
    <section class="card">
      <p><b>${esc(state.me.name)}</b><br><span class="muted">${esc(state.me.email)} · ${isAdmin() ? "Admin" : "Worker"}</span></p>
      <button class="ghost" id="signOut">Sign out</button>
    </section>
    <form class="card" id="pwForm">
      <h2>Change password</h2>
      <label for="pwOld">Current password</label><input id="pwOld" type="password" autocomplete="current-password" required>
      <label for="pwNew">New password (at least 6 characters)</label><input id="pwNew" type="password" autocomplete="new-password" minlength="6" required>
      <button class="primary" type="submit">Change password</button>
    </form>`;
  $("#signOut").addEventListener("click", D.logOut);
  $("#pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const next = $("#pwNew").value;
    if (next.length < 6) return toast("Use at least 6 characters.", "bad");
    await busy(e.submitter, "Saving", async () => {
      try { await D.changePassword($("#pwOld").value, next); toast("Password changed"); e.target.reset(); }
      catch (err) { toast(D.authMessage(err), "bad"); }
    });
  });
}

// =====================================================================
// Admin: overview
// =====================================================================
function adminNav(active) {
  return `<div class="subnav">
    ${[["admin", "Overview"], ["pool", "Leads"], ["team", "Team"]].map(([id, l]) => `<a href="#${id}" class="${active === id ? "on" : ""}">${l}</a>`).join("")}
  </div>`;
}

async function screenAdmin() {
  setTitle("Admin");
  const today = perthDay();
  const week = weekStart(today);
  const rid = state.routeId;
  const users = await D.listUsers();
  if (rid !== state.routeId) return;
  let weekRows = [], events = [], feedDay = today, feedWorker = "";
  view().innerHTML = `
    ${adminNav("admin")}
    <h1 class="page">Team performance</h1>
    <div id="kpis"></div>
    <section class="card"><h2>Workers</h2><div id="workerTable"></div></section>
    <section class="card">
      <div class="feed-head"><h2>Activity</h2>
        <div class="feed-filters">
          <select id="feedWorker" aria-label="Worker"><option value="">Everyone</option>${users.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join("")}</select>
          <input type="date" id="feedDay" value="${today}" max="${today}" aria-label="Day">
        </div>
      </div>
      <div id="feed"></div>
    </section>
    <section class="card"><h2>Download data</h2>
      <div class="toolbar"><button class="ghost" data-export="leads">Leads CSV</button><button class="ghost" data-export="calls">Calls CSV</button><button class="ghost" data-export="searches">Searches CSV</button></div>
    </section>`;

  let todayEvents = [];
  const drawKpis = () => {
    if (!$("#kpis")) return;
    const todayRows = weekRows.filter((r) => r.day === today);
    const sum = (rows, k) => rows.reduce((n, r) => n + r[k], 0);
    const evCount = (list, type) => list.filter((e) => e.type === type).length;
    const tile = (label, t, w) => `<div class="tile"><span>${label}</span><b class="num">${t}</b><small>${w}</small></div>`;
    $("#kpis").innerHTML = `<section class="tiles six">
      ${tile("Calls today", sum(todayRows, "calls"), `${sum(weekRows, "calls")} this week`)}
      ${tile("Interested", sum(todayRows, "interested"), `${sum(weekRows, "interested")} this week`)}
      ${tile("Won", sum(todayRows, "won"), `${sum(weekRows, "won")} this week`)}
      ${tile("Points", sum(todayRows, "points"), `${sum(weekRows, "points")} this week`)}
      ${tile("Searches today", evCount(todayEvents, "search"), "lead searches")}
      ${tile("Leads claimed", evCount(todayEvents, "claim"), "today")}
    </section>`;
    const tBoard = D.leaderboard(todayRows), wBoard = D.leaderboard(weekRows);
    const lastSeen = new Map();
    todayEvents.forEach((e) => { if (!lastSeen.has(e.uid)) lastSeen.set(e.uid, e.createdAt); });
    $("#workerTable").innerHTML = `<div class="tablewrap"><table class="board">
      <thead><tr><th>Name</th><th class="n">Today calls</th><th class="n">Today pts</th><th class="n">Week calls</th><th class="n">Interested</th><th class="n">Won</th><th class="n">Week pts</th><th>Last active</th></tr></thead>
      <tbody>${users.filter((u) => u.active).map((u) => {
        const t = tBoard.find((r) => r.uid === u.id) || {}; const w = wBoard.find((r) => r.uid === u.id) || {};
        return `<tr><td><a href="#worker/${esc(u.id)}">${esc(u.name)}</a>${u.role === "admin" ? ' <em class="role">Admin</em>' : ""}</td>
          <td class="n">${t.calls || 0}</td><td class="n">${t.points || 0}</td><td class="n">${w.calls || 0}</td><td class="n">${w.interested || 0}</td>
          <td class="n">${w.won || 0}</td><td class="n"><b>${w.points || 0}</b></td><td>${lastSeen.has(u.id) ? esc(fmtTime(lastSeen.get(u.id))) : '<span class="muted">Not today</span>'}</td></tr>`;
      }).join("")}</tbody></table></div>`;
  };
  const drawFeed = () => {
    if (!$("#feed")) return;
    const list = events.filter((e) => !feedWorker || e.uid === feedWorker);
    $("#feed").innerHTML = list.length ? `<ul class="feed">${list.slice(0, 300).map((e) => `
      <li class="ev ev-${esc(e.type)}"><time>${esc(fmtTime(e.createdAt) || "now")}</time><span><b>${esc(e.userName)}</b> ${esc(e.text)}</span></li>`).join("")}</ul>`
      : `<div class="empty">No activity ${feedDay === today ? "yet today" : "on " + esc(prettyDay(feedDay))}.</div>`;
  };
  let unFeed = null;
  const watchFeed = () => {
    if (unFeed) unFeed();
    unFeed = D.watchEventsForDay(feedDay, (ev) => { events = ev; if (feedDay === today) { todayEvents = ev; drawKpis(); } drawFeed(); },
      (e) => { $("#feed").innerHTML = errorBox(D.authMessage(e)); });
  };
  state.unsub.push(() => unFeed && unFeed());
  state.unsub.push(D.watchStats("week", week, (r) => { weekRows = r; drawKpis(); }, (e) => { $("#kpis").innerHTML = errorBox(D.authMessage(e)); }));
  if (feedDay !== today) state.unsub.push(D.watchEventsForDay(today, (ev) => { todayEvents = ev; drawKpis(); }));
  watchFeed();
  $("#feedWorker").addEventListener("change", (e) => { feedWorker = e.target.value; drawFeed(); });
  $("#feedDay").addEventListener("change", (e) => {
    const v = e.target.value || today;
    feedDay = v;
    if (v !== today) { const unToday = D.watchEventsForDay(today, (ev) => { todayEvents = ev; drawKpis(); }); state.unsub.push(unToday); }
    watchFeed();
  });
  document.querySelectorAll("[data-export]").forEach((b) => b.addEventListener("click", () => exportData(b, b.dataset.export)));
}

async function exportData(btn, kind) {
  await busy(btn, "Preparing", async () => {
    try {
      const stamp = perthDay();
      if (kind === "leads") {
        const rows = await new Promise((res, rej) => { const u = D.watchAllLeads((l) => { u(); res(l); }, rej); });
        downloadCsv(rows.map((l) => ({ ...l, callbackAt: fmtDateTime(l.callbackAt), lastCalledAt: fmtDateTime(l.lastCalledAt), updatedAt: fmtDateTime(l.updatedAt) })),
          ["name", "phone", "address", "suburb", "category", "website", "websiteKind", "status", "assignedName", "notes", "callbackAt", "lastCalledAt", "updatedAt", "source"], `leads-${stamp}.csv`);
      } else if (kind === "calls") {
        const rows = await D.getAllCalls();
        downloadCsv(rows.map((c) => ({ ...c, time: fmtDateTime(c.createdAt) })), ["time", "day", "userName", "leadName", "status", "points", "notes"], `calls-${stamp}.csv`);
      } else {
        const rows = await D.getAllSearches();
        downloadCsv(rows.map((s) => ({ ...s, time: fmtDateTime(s.createdAt) })), ["time", "day", "userName", "suburb", "category", "results", "noWebsite", "social"], `searches-${stamp}.csv`);
      }
    } catch (err) { toast(D.authMessage(err), "bad"); }
  });
}

// =====================================================================
// Admin: one worker
// =====================================================================
async function screenWorker(uid) {
  const user = await D.getProfile(uid);
  if (!user) { view().innerHTML = adminNav("") + errorBox("That worker doesn't exist."); return; }
  setTitle(user.name);
  view().innerHTML = `${adminNav("")}<h1 class="page">${esc(user.name)}</h1><div id="wBody"><div class="loading"><span class="spinner"></span></div></div>`;
  const rid = state.routeId;
  const [stats, leads, calls, searches] = await Promise.all([D.getStatsFor(uid), D.getLeadsFor(uid), D.getCallsFor(uid), D.getSearchesFor(uid)]);
  if (rid !== state.routeId || !$("#wBody")) return;
  const today = perthDay();
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const byDay = new Map(stats.map((s) => [s.day, s]));
  const series = days.map((d) => byDay.get(d)?.calls || 0);
  const max = Math.max(state.goal, ...series, 1);
  const total = (k) => stats.reduce((n, s) => n + s[k], 0);
  const statusCounts = {};
  leads.forEach((l) => { statusCounts[l.status] = (statusCounts[l.status] || 0) + 1; });
  const W = 560, H = 180, pad = 24, bw = (W - pad * 2) / 14;
  const goalY = H - pad - ((state.goal / max) * (H - pad * 2));
  $("#wBody").innerHTML = `
    <p class="muted">${esc(user.email)} · ${user.active ? "Active" : "Deactivated"} · ${user.role === "admin" ? "Admin" : "Worker"}</p>
    <section class="tiles six">
      <div class="tile"><span>All-time calls</span><b class="num">${total("calls")}</b></div>
      <div class="tile"><span>Interested</span><b class="num">${total("interested")}</b></div>
      <div class="tile"><span>Won</span><b class="num">${total("won")}</b></div>
      <div class="tile"><span>Points</span><b class="num">${total("points")}</b></div>
      <div class="tile"><span>Leads held</span><b class="num">${leads.length}</b></div>
      <div class="tile"><span>Searches</span><b class="num">${searches.length}</b></div>
    </section>
    <section class="card"><h2>Calls, last 14 days</h2>
      <div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Calls per day for the last 14 days">
        <line x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}" class="axis"/>
        <line x1="${pad}" x2="${W - pad}" y1="${goalY}" y2="${goalY}" class="goalline"/>
        <text x="${W - pad}" y="${goalY - 4}" text-anchor="end" class="lbl">goal ${state.goal}</text>
        ${series.map((v, i) => {
          const h = (v / max) * (H - pad * 2);
          const x = pad + i * bw + 3;
          return `<rect x="${x}" y="${H - pad - h}" width="${bw - 6}" height="${h}" rx="3" class="barfill"><title>${prettyDay(days[i])}: ${v} calls</title></rect>
            ${v ? `<text x="${x + (bw - 6) / 2}" y="${H - pad - h - 4}" text-anchor="middle" class="lbl">${v}</text>` : ""}
            ${i % 2 === 0 ? `<text x="${x + (bw - 6) / 2}" y="${H - 6}" text-anchor="middle" class="lbl">${days[i].slice(8)}</text>` : ""}`;
        }).join("")}
      </svg></div>
    </section>
    <section class="card"><h2>Leads by status</h2>
      <p>${D.STATUSES.map((s) => `<span class="status s-${s.replace(/\s/g, "")}">${esc(s)}: ${statusCounts[s] || 0}</span>`).join(" ")}</p>
    </section>
    <section class="card"><h2>Recent calls</h2>
      ${calls.length ? `<div class="tablewrap"><table class="board"><thead><tr><th>When</th><th>Business</th><th>Result</th><th>Notes</th></tr></thead><tbody>
        ${calls.slice(0, 50).map((c) => `<tr><td>${esc(fmtDateTime(c.createdAt))}</td><td>${esc(c.leadName)}</td><td><span class="status s-${esc(c.status.replace(/\s/g, ""))}">${esc(c.status)}</span></td><td>${esc(c.notes)}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">No calls yet.</div>`}
    </section>
    <section class="card"><h2>Recent searches</h2>
      ${searches.length ? `<ul class="plain">${searches.slice(0, 30).map((s) => `<li>${esc(fmtDateTime(s.createdAt))} · ${esc(s.category)} in ${esc(s.suburb)} · ${s.results} results, ${s.noWebsite} with no website</li>`).join("")}</ul>` : `<div class="empty">No searches yet.</div>`}
    </section>`;
}

// =====================================================================
// Admin: all leads / pool
// =====================================================================
async function screenPool() {
  setTitle("Leads");
  const rid = state.routeId;
  const users = (await D.listUsers()).filter((u) => u.active);
  if (rid !== state.routeId) return;
  const f = { status: "", worker: "", text: "" };
  const selected = new Set();
  let leads = [];
  view().innerHTML = `
    ${adminNav("pool")}
    <h1 class="page">All leads</h1>
    <div class="card filters">
      <input id="pText" placeholder="Search name, suburb or type" aria-label="Search leads">
      <select id="pStatus" aria-label="Status"><option value="">Any status</option>${D.STATUSES.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
      <select id="pWorker" aria-label="Worker"><option value="">Anyone</option><option value="__none">Unassigned</option>${users.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join("")}</select>
    </div>
    <div class="toolbar bulk">
      <span id="selCount" class="muted">0 selected</span>
      <select id="bulkTo" aria-label="Assign selected to"><option value="">Assign selected to…</option><option value="__none">Unassign</option>${users.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join("")}</select>
      <button class="primary small" id="bulkGo">Apply</button>
    </div>
    <div id="poolBody"><div class="loading"><span class="spinner"></span></div></div>`;
  const matches = (l) => (!f.status || l.status === f.status)
    && (!f.worker || (f.worker === "__none" ? !l.assignedTo : l.assignedTo === f.worker))
    && (!f.text || `${l.name} ${l.suburb} ${l.category}`.toLowerCase().includes(f.text));
  const draw = () => {
    if (!$("#poolBody")) return;
    const shown = leads.filter(matches);
    $("#selCount").textContent = `${selected.size} selected`;
    $("#poolBody").innerHTML = shown.length ? `<div class="tablewrap"><table class="board pool">
      <thead><tr><th><input type="checkbox" id="selAll" aria-label="Select all shown" ${shown.slice(0, 500).every((l) => selected.has(l.id)) ? "checked" : ""}></th><th>Business</th><th>Status</th><th>Worker</th><th>Phone</th><th>Updated</th></tr></thead>
      <tbody>${shown.slice(0, 500).map((l) => `<tr>
        <td><input type="checkbox" data-sel="${esc(l.id)}" ${selected.has(l.id) ? "checked" : ""} aria-label="Select ${esc(l.name)}"></td>
        <td><b>${esc(l.name)}</b><br><span class="muted small">${esc(l.category)} · ${esc(l.suburb)} · ${KIND_LABEL[l.websiteKind] || ""}</span>${l.notes ? `<br><span class="small">${esc(l.notes.slice(0, 120))}</span>` : ""}</td>
        <td><span class="status s-${esc(l.status.replace(/\s/g, ""))}">${esc(l.status)}</span></td>
        <td>${l.assignedName ? esc(l.assignedName) : '<span class="muted">Unassigned</span>'}</td>
        <td>${l.phone ? `<a href="${esc(telHref(l.phone))}">${esc(l.phone)}</a>` : ""}</td>
        <td class="small">${esc(fmtDateTime(l.updatedAt))}</td></tr>`).join("")}</tbody></table></div>
      ${shown.length > 500 ? `<p class="muted small">Showing the first 500 of ${shown.length}. Narrow the filters to see more.</p>` : ""}`
      : `<div class="empty">${leads.length ? "No leads match these filters." : `No leads yet. Search on <a href="#find">Find leads</a> and claim them or add them to the pool.`}</div>`;
    $("#selAll")?.addEventListener("change", (e) => { shown.slice(0, 500).forEach((l) => e.target.checked ? selected.add(l.id) : selected.delete(l.id)); draw(); });
    document.querySelectorAll("[data-sel]").forEach((c) => c.addEventListener("change", () => {
      c.checked ? selected.add(c.dataset.sel) : selected.delete(c.dataset.sel);
      $("#selCount").textContent = `${selected.size} selected`;
    }));
  };
  $("#pText").addEventListener("input", (e) => { f.text = e.target.value.trim().toLowerCase(); draw(); });
  $("#pStatus").addEventListener("change", (e) => { f.status = e.target.value; draw(); });
  $("#pWorker").addEventListener("change", (e) => { f.worker = e.target.value; draw(); });
  $("#bulkGo").addEventListener("click", async (e) => {
    const to = $("#bulkTo").value;
    if (!selected.size) return toast("Tick some leads first.", "bad");
    if (!to) return toast("Choose who to assign them to.", "bad");
    const worker = to === "__none" ? null : users.find((u) => u.id === to);
    await busy(e.currentTarget, "Saving", async () => {
      try { await D.assignLeads(state.me, [...selected], worker); toast(worker ? `Assigned ${selected.size} to ${worker.name}` : `Unassigned ${selected.size}`); selected.clear(); }
      catch (err) { toast(D.authMessage(err), "bad"); }
    });
  });
  state.unsub.push(D.watchAllLeads((l) => {
    leads = l;
    for (const id of [...selected]) if (!leads.some((x) => x.id === id)) selected.delete(id);
    if (!$("#poolBody")?.contains(document.activeElement)) draw();
  }, (e) => { $("#poolBody").innerHTML = errorBox(D.authMessage(e)); }));
}

// =====================================================================
// Admin: team
// =====================================================================
async function screenTeam() {
  setTitle("Team");
  view().innerHTML = `
    ${adminNav("team")}
    <h1 class="page">Team</h1>
    <form class="card" id="newWorker" autocomplete="off">
      <h2>Add a worker</h2>
      <div class="grid2">
        <div><label for="wName">Name</label><input id="wName" required maxlength="60"></div>
        <div><label for="wEmail">Email</label><input id="wEmail" type="email" required></div>
        <div><label for="wPass">Temporary password (6+ characters)</label><input id="wPass" minlength="6" required></div>
        <div><label for="wRole">Role</label><select id="wRole"><option value="worker">Worker</option><option value="admin">Admin</option></select></div>
      </div>
      <button class="primary" type="submit">Create login</button>
      <p class="muted small">Send them the email and temporary password. They can change it under Account.</p>
    </form>
    <form class="card" id="goalForm">
      <h2>Daily call goal</h2>
      <div class="inline"><input id="goal" type="number" min="1" max="500" value="${state.goal}" aria-label="Daily call goal"><button class="primary" type="submit">Save</button></div>
    </form>
    <section class="card"><h2>Everyone</h2><div id="teamList"><div class="loading"><span class="spinner"></span></div></div></section>`;
  const drawList = async () => {
    const users = await D.listUsers();
    if (!$("#teamList")) return;
    $("#teamList").innerHTML = `<div class="tablewrap"><table class="board"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr class="${u.active ? "" : "off"}"><td><a href="#worker/${esc(u.id)}">${esc(u.name)}</a></td><td>${esc(u.email)}</td>
        <td>${u.role === "admin" ? "Admin" : "Worker"}</td><td>${u.active ? "Active" : "Deactivated"}</td>
        <td>${u.id === state.me.id ? '<span class="muted small">You</span>' : `<button class="ghost small" data-toggle="${esc(u.id)}" data-active="${u.active}">${u.active ? "Deactivate" : "Reactivate"}</button>`}</td></tr>`).join("")}
    </tbody></table></div>`;
    document.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", async () => {
      const turnOff = b.dataset.active === "true";
      await busy(b, "Saving", async () => {
        try { await D.updateUser(b.dataset.toggle, { active: !turnOff }); toast(turnOff ? "Deactivated. They can't use the app now." : "Reactivated"); }
        catch (err) { toast(D.authMessage(err), "bad"); }
      });
      drawList();
    }));
  };
  $("#newWorker").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#wName").value.trim(), email = $("#wEmail").value.trim(), password = $("#wPass").value, role = $("#wRole").value;
    if (!name || !email || password.length < 6) return toast("Fill in a name, email and a password of 6+ characters.", "bad");
    await busy(e.submitter, "Creating", async () => {
      try {
        await D.createWorker({ name, email, password, role }, state.me.id);
        D.logEvent(state.me, "team", `added ${name} as a ${role}`);
        toast(`Login created for ${name}`);
        e.target.reset();
        drawList();
      } catch (err) { toast(D.authMessage(err), "bad"); }
    });
  });
  $("#goalForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const n = parseInt($("#goal").value, 10);
    if (!(n >= 1 && n <= 500)) return toast("Pick a goal between 1 and 500.", "bad");
    await busy(e.submitter, "Saving", async () => {
      try { await D.setDailyGoal(n); state.goal = n; toast("Daily goal saved"); }
      catch (err) { toast(D.authMessage(err), "bad"); }
    });
  });
  drawList();
}
