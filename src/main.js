// AR Methods Leads — app shell, routing and screens.
import * as D from "./data.js";
import { quickSignals, pageSpeed, scoreSite, siteKey, oldLabel, OLD_MIN, SetupError, CheckQuotaError } from "./oldsite.js";
import { TRADES, searchBusinesses, SearchError, findHiddenWebsites, GOOGLE_COVERAGE, findPlaceForReview, reviewLink, leadKey } from "./search.js";
import { OWNER_EMAIL, TOMTOM_KEY, GOOGLE_MAPS_KEY, BRAND_LINK, BRAND_PHONE, PAGESPEED_KEY } from "./config.js";
import {
  scriptFor, OBJECTIONS, AFTER_WON, BADGES, totalsFrom, earnedBadges, newBadges, weeklyReport, money, pct,
  commissionFor, NFC, BRAND, signature, textsFor, creditHtml, leadScore, isHot, bestHours, hourLabel, CARE_DEFAULT, CARE_PRESETS, DEFAULT_PACKAGES, REFERRAL_REWARD, careStats, monthsBilled, PAY_STEPS, payOf, payLabel, commissionSplit,
  LADDER_METRICS, DEFAULT_LADDER, teamTotals, ladderProgress,
} from "./extras.js";
import {
  esc, safeUrl, perthDay, weekStart, addDays, prettyDay, fmtTime, fmtDateTime, toDate,
  streakFrom, downloadCsv, cleanPhone,
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

// ---------- motion ----------
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
function countUp(el) {
  const target = parseInt(el.textContent, 10);
  if (!Number.isFinite(target) || target <= 0 || reduceMotion() || String(target) !== el.textContent.trim()) return;
  const start = performance.now(), dur = 700;
  const step = (t) => {
    const k = Math.min(1, (t - start) / dur);
    el.textContent = String(Math.round(target * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  el.textContent = "0";
  requestAnimationFrame(step);
}
function animateIn(root) {
  let i = 0;
  root.querySelectorAll(".card, .tile, .lead, .tips li, .quote-card, .roast, .quick, .chips").forEach((el) => {
    if (el.dataset.anim) return;
    el.dataset.anim = "1";
    el.classList.add("rise");
    el.style.setProperty("--i", Math.min(i++, 12));
  });
  root.querySelectorAll(".tile b.num, .goal-head b.num [data-n]").forEach((el) => { if (!el.dataset.counted) { el.dataset.counted = "1"; countUp(el); } });
}
new MutationObserver((muts) => {
  const v = document.getElementById("view");
  if (v && muts.some((m) => m.addedNodes.length)) animateIn(v);
}).observe(document.getElementById("app"), { childList: true, subtree: true });

function confetti() {
  if (reduceMotion()) return;
  const colors = ["#5a0614", "#c9a45c", "#f6e3b4", "#8a1a28", "#ffffff"];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement("i");
    c.className = "confetti";
    c.style.left = Math.random() * 100 + "vw";
    c.style.background = colors[i % colors.length];
    c.style.setProperty("--x", (Math.random() * 40 - 20) + "vw");
    c.style.setProperty("--r", (Math.random() * 1080 - 540) + "deg");
    c.style.setProperty("--d", (1.2 + Math.random() * 1.2) + "s");
    c.style.animationDelay = Math.random() * 0.25 + "s";
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 2800);
  }
}

async function busy(btn, label, fn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>${esc(label)}`;
  try { return await fn(); }
  finally { btn.disabled = false; btn.innerHTML = old; }
}

function phoneHtml(raw) {
  const p = cleanPhone(raw);
  if (!p.display) return `<span class="muted">No phone listed</span>`;
  if (!p.valid) return `<span class="badphone" title="This doesn't look like a complete Australian number">⚠ ${esc(p.display)} (check number)</span>`;
  return `<a class="phone" href="${esc(p.tel)}">📞 ${esc(p.display)}</a>`;
}
function siteHint(l) {
  return l.websiteKind === "none" && l.maybeSite
    ? `<p class="maybe">Might have a website: <a href="https://${esc(l.maybeSite)}" target="_blank" rel="noopener">${esc(l.maybeSite)}</a>. Check before calling.</p>` : "";
}

function errorBox(msg) { return msg ? `<div class="notice error">${esc(msg)}</div>` : ""; }

// =====================================================================
// Shell
// =====================================================================
function renderShell() {
  const admin = isAdmin();
  const tabs = [
    ["home", "Home", "⌂"], ["find", "Find leads", "⌕"], ["leads", "My leads", "☎"], ["board", "Leaderboard", "★"], ["chat", "Chat", "💬"], ["reviews", "Review cards", "📲"], ["lockin", "Can't be bothered", "🔥"],
    ...(admin ? [["admin", "Admin", "▦"]] : []),
  ];
  $("#app").innerHTML = `
    <header class="top">
      <a class="brand" href="#home">
        <img src="logo.png" alt="" width="28" height="36">
        <span><b>AR METHODS</b><small>WEBSITES • SYSTEMS • GROWTH</small></span>
        <em class="by-ceo">by ${esc(BRAND.ceo)}</em>
      </a>
      <div class="who">
        <span class="who-name">${esc(state.me.name)}${admin ? ' <em class="role">Admin</em>' : ""}</span>
        <a href="#account" class="linkbtn">Account</a>
      </div>
    </header>
    <nav class="tabs" aria-label="Main">
      ${tabs.map(([id, label, icon]) => `<a href="#${id}" data-tab="${id}" class="${id === "lockin" ? "lockin-tab" : ""}"><span aria-hidden="true">${icon}</span>${label}${id === "chat" ? '<em class="tab-badge" id="chatBadge" hidden></em>' : ""}</a>`).join("")}
    </nav>
    <main id="view" tabindex="-1"></main>
    <footer class="foot sig"><img src="logo.png" alt="" width="34" height="44"><div><b class="sig-name">AR METHODS</b><span>Founded &amp; run by <b>${esc(BRAND.ceo)}</b>, CEO · Perth, WA</span></div></footer>`;
}

function markTab(name) {
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === name));
}

// ---------- live team pop-ups ----------
let celebrationsUnsub = null;
function startCelebrations() {
  if (celebrationsUnsub) celebrationsUnsub();
  celebrationsUnsub = D.watchCelebrations(Date.now() - 2000, (c) => {
    if (c.uid === state.me?.id) return;
    const el = document.createElement("div");
    el.className = `celebrate ${esc(c.type)}`;
    el.innerHTML = `<span class="ce-icon">${c.type === "won" ? "💰" : c.type === "badge" ? "🏆" : c.type === "goal" ? "🎯" : "🔥"}</span><span>${esc(c.text)}</span>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("show"), 20);
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 400); }, 5000);
    if (c.type === "won") confetti();
  });
}

// =====================================================================
// Presence: a heartbeat every minute while the app is open and on screen
// =====================================================================
const PAGE_LABELS = { home: "Home", find: "Finding leads", leads: "My leads", callmode: "In call mode 📞", board: "Leaderboard",
  chat: "Team chat", reviews: "Review cards", start: "Reading Start here", lockin: "Can't be bothered", account: "Account" };
let presenceTimer = null, presencePage = "home", presenceSent = 0;
const presenceVisible = () => document.visibilityState === "visible";
function beat(force) {
  if (!state.me) return;
  if (!force && Date.now() - presenceSent < 15000) return;
  presenceSent = Date.now();
  D.sendPresence(state.me, presencePage, presenceVisible()).catch(() => {});
}
function setPresencePage(name) {
  const page = PAGE_LABELS[name] ? name : (isAdmin() ? "admin" : "home");
  if (page === presencePage) return;
  presencePage = page;
  beat(true);
}
function onVisibility() { beat(true); }
function startPresence() {
  stopPresence();
  presenceSent = 0;
  beat(true);
  presenceTimer = setInterval(() => { if (presenceVisible()) beat(true); }, 60000);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onVisibility);
}
function stopPresence() {
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = null;
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("pagehide", onVisibility);
}
/** live: on screen in the last ~2.5 min · away: app open but in the background (last 30 min) · offline */
function presenceStatus(p) {
  const at = toDate(p?.at)?.getTime() || 0;
  const ago = Date.now() - at;
  if (!at) return { key: "off", label: "Never opened the app", ago };
  if (p.visible && ago < 150000) return { key: "live", label: `Live · ${PAGE_LABELS[p.page] || (p.page === "admin" ? "Admin" : "In the app")}`, ago };
  if (ago < 30 * 60000) return { key: "away", label: `Away · app in background ${minsAgo(ago)}`, ago };
  return { key: "off", label: `Offline · last seen ${lastSeenText(at)}`, ago };
}
const minsAgo = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`; };
function lastSeenText(at) {
  const d = new Date(at);
  return perthDay(d) === perthDay() ? fmtTime(d) : `${prettyDay(perthDay(d))} ${fmtTime(d)}`;
}
const presenceDot = (st) => `<span class="live-dot ${st.key}" aria-hidden="true"></span>`;

// =====================================================================
// Team chat
// =====================================================================
let chatUnsub = null;
const chatSeenKey = () => `arm_chat_seen_${state.me?.id}`;
const chatSeen = () => { try { return Number(localStorage.getItem(chatSeenKey())) || 0; } catch { return 0; } };
const msgTime = (m) => toDate(m.at)?.getTime() || Date.now();
function markChatSeen() {
  const last = state.messages?.length ? msgTime(state.messages[state.messages.length - 1]) : Date.now();
  try { localStorage.setItem(chatSeenKey(), String(last)); } catch {}
  updateChatBadge();
}
function updateChatBadge() {
  const el = $("#chatBadge");
  if (!el) return;
  const seen = chatSeen();
  const n = (state.messages || []).filter((m) => m.uid !== state.me?.id && msgTime(m) > seen).length;
  el.hidden = !n;
  el.textContent = n > 99 ? "99+" : String(n);
}
function stopChat() { if (chatUnsub) { chatUnsub(); chatUnsub = null; } state.messages = []; }
function startChat() {
  stopChat();
  const startedAt = Date.now();
  let first = true;
  chatUnsub = D.watchMessages((msgs) => {
    const before = new Set((state.messages || []).map((m) => m.id));
    state.messages = msgs;
    const onChat = location.hash.startsWith("#chat");
    if (onChat) { drawChat(); markChatSeen(); }
    else {
      updateChatBadge();
      if (!first) msgs.filter((m) => !before.has(m.id) && m.uid !== state.me?.id && msgTime(m) > startedAt - 5000).forEach(chatPopup);
    }
    first = false;
  }, () => {});
}
function chatPopup(m) {
  const el = document.createElement("a");
  el.href = "#chat";
  el.className = "celebrate chat";
  el.innerHTML = `<span class="ce-icon">💬</span><span><b>${esc(m.name)}${m.role === "admin" ? " (CEO)" : ""}:</b> ${m.text ? `${esc(m.text.slice(0, 90))}${m.text.length > 90 ? "…" : ""}` : m.file ? (m.file.kind === "image" ? "📷 Photo" : `📎 ${esc(m.file.name)}`) : m.poll ? "📊 New poll, go vote" : ""}</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("show"), 20);
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 400); }, 5000);
}

const QUICK_MSGS = ["Just closed one 💰", "On a roll today 🔥", "Anyone got a good line for “we use Facebook”?", "Taking a 10 min break ☕"];

function screenChat() {
  setTitle("Team chat");
  view().innerHTML = `
    <h1 class="page">Team chat</h1>
    <section class="chat card">
      <div class="chat-list" id="chatList" aria-live="polite"><div class="loading"><span class="spinner"></span></div></div>
      <div class="chat-quick">${QUICK_MSGS.map((q, i) => `<button class="chip" data-q="${i}">${esc(q)}</button>`).join("")}</div>
      <div class="chat-attach" id="chatAttach" hidden></div>
      <form class="chat-form" id="chatForm">
        <label class="chat-clip" title="Add a photo or file" aria-label="Add a photo or file">📎<input type="file" id="chatFile" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx,.zip" hidden></label>
        ${isAdmin() ? `<button type="button" class="chat-clip" id="chatPoll" title="Start a poll" aria-label="Start a poll">📊</button>` : ""}
        <textarea id="chatText" rows="1" maxlength="1000" placeholder="Message the team…" aria-label="Message"></textarea>
        <button class="primary" aria-label="Send" id="chatSend">Send</button>
      </form>
    </section>`;
  const input = $("#chatText");
  try { const draft = sessionStorage.getItem("arm_chat_draft"); if (draft) { input.value = draft; sessionStorage.removeItem("arm_chat_draft"); setTimeout(() => { input.focus(); input.setSelectionRange(draft.length, draft.length); }, 50); } } catch {}
  let pending = null; // attachment ready to send
  const drawPending = () => {
    const box = $("#chatAttach");
    box.hidden = !pending;
    box.innerHTML = pending ? `${pending.kind === "image" ? `<img src="${esc(pending.thumb)}" alt="">` : `<span class="file-ico">${fileIcon(pending.name)}</span>`}
      <div><b>${esc(pending.name)}</b><small>${esc(fmtSize(pending.size))}</small></div><button type="button" class="linkbtn" id="chatAttachX" aria-label="Remove attachment">✕</button>` : "";
    $("#chatAttachX")?.addEventListener("click", () => { pending = null; drawPending(); });
  };
  const pick = async (file) => {
    if (!file) return;
    try { pending = await prepareAttachment(file); drawPending(); input.focus(); }
    catch (e) { toast(e.message || "Couldn't add that file", "bad"); }
  };
  $("#chatFile").addEventListener("change", (e) => { pick(e.target.files[0]); e.target.value = ""; });
  input.addEventListener("paste", (e) => {
    const f = [...(e.clipboardData?.files || [])][0];
    if (f) { e.preventDefault(); pick(f); }
  });
  const send = async (text) => {
    text = text.trim();
    if (!text && !pending) return;
    const file = pending, btn = $("#chatSend");
    input.value = ""; input.style.height = ""; pending = null; drawPending();
    if (file) { btn.disabled = true; btn.textContent = "Sending…"; }
    try { await D.sendMessage(state.me, text, file); }
    catch (e) { input.value = text; pending = file; drawPending(); toast(D.authMessage(e), "bad"); }
    finally { btn.disabled = false; btn.textContent = "Send"; }
  };
  $("#chatForm").addEventListener("submit", (e) => { e.preventDefault(); send(input.value); input.focus(); });
  $("#chatPoll")?.addEventListener("click", openPollMaker);
  state.unsub.push(() => { for (const u of pollWatch.values()) u(); pollWatch.clear(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); } });
  input.addEventListener("input", () => { input.style.height = ""; input.style.height = Math.min(140, input.scrollHeight) + "px"; });
  view().querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => send(QUICK_MSGS[Number(b.dataset.q)])));
  drawChat();
  markChatSeen();
}

function drawChat() {
  const list = $("#chatList");
  if (!list) return;
  const msgs = state.messages || [];
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  if (!msgs.length) { list.innerHTML = `<div class="empty">No messages yet. Say hi to the team 👋</div>`; return; }
  let lastDay = "";
  list.innerHTML = msgs.map((m) => {
    const d = new Date(msgTime(m));
    const day = perthDay(d);
    const sep = day !== lastDay ? `<div class="chat-day">${esc(day === perthDay() ? "Today" : prettyDay(day))}</div>` : "";
    lastDay = day;
    const mine = m.uid === state.me.id;
    return `${sep}<div class="msg ${mine ? "mine" : ""} ${m.role === "admin" ? "ceo" : ""}">
      ${mine ? "" : `<span class="msg-name">${esc(m.name)}${m.role === "admin" ? ' <em class="role">CEO</em>' : ""}</span>`}
      ${m.file ? attachmentHtml(m.file) : ""}
      ${m.poll ? `<div class="poll" data-poll="${esc(m.poll.id)}">${pollCache.has(m.poll.id) ? pollHtml(pollCache.get(m.poll.id)) : `<div class="loading"><span class="spinner"></span></div>`}</div>` : ""}
      ${m.text ? `<div class="bubble">${esc(m.text).replace(/\n/g, "<br>")}</div>` : ""}
      <span class="msg-meta">${esc(fmtTime(d))}${isAdmin() ? ` · <button class="linkbtn" data-del="${esc(m.id)}" data-delfile="${esc(m.file?.id || "")}">Delete</button>` : ""}</span>
    </div>`;
  }).join("");
  if (nearBottom || !list.dataset.ready) list.scrollTop = list.scrollHeight;
  list.dataset.ready = "1";
  list.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Delete this message for everyone?")) return;
    try { await D.deleteMessage(b.dataset.del, b.dataset.delfile || null); } catch (e) { toast(D.authMessage(e), "bad"); }
  }));
  list.querySelectorAll("[data-open-file]").forEach((el) => el.addEventListener("click", () => openAttachment(el.dataset.openFile)));
  list.querySelectorAll("[data-poll]").forEach((el) => { wirePoll(el); watchPollCard(el.dataset.poll); });
  list.querySelectorAll(".att-img img").forEach((img) => img.addEventListener("load", () => { if (nearBottom || list.dataset.first !== "1") list.scrollTop = list.scrollHeight; }, { once: true }));
  list.dataset.first = "1";
}

// ---------- chat polls ----------
const pollWatch = new Map(), pollCache = new Map();
const POLL_TEMPLATES = [
  { label: "🎁 Ladder prize vote", question: "Which prize should we go for on this month's team ladder?", options: ["Team lunch", "$20 bonus each", "$30 gift card each", "Early finish Friday", "Team night out"] },
  { label: "📍 Next suburb", question: "Which area should we hit next?", options: ["Southern suburbs", "Northern suburbs", "Eastern suburbs", "Fremantle & coast"] },
  { label: "📅 Team catch-up", question: "Best time for a quick team catch-up?", options: ["Monday morning", "Wednesday arvo", "Friday morning"] },
  { label: "🎯 Daily goal", question: "What should our daily call goal be?", options: ["25 calls", "30 calls", "40 calls", "50 calls"] },
];
function openPollMaker() {
  showModal(`<h2>Start a poll</h2>
    <div class="chips poll-tpl">${POLL_TEMPLATES.map((t, i) => `<button type="button" class="chip" data-tpl="${i}">${esc(t.label)}</button>`).join("")}</div>
    <form id="pollForm">
      <label for="pollQ">Question</label><input id="pollQ" maxlength="140" placeholder="e.g. Which prize do we want?">
      <label>Options</label><div id="pollOpts"></div>
      <button type="button" class="linkbtn" id="pollAddOpt">+ Add option</button>
      <button type="submit" class="primary wide-btn">Post poll</button>
    </form>`, (wrap, close) => {
    let opts = ["", ""];
    const draw = () => {
      wrap.querySelector("#pollOpts").innerHTML = opts.map((o, i) => `<div class="poll-opt-row"><input data-o="${i}" maxlength="60" value="${esc(o)}" placeholder="Option ${i + 1}" aria-label="Option ${i + 1}">${opts.length > 2 ? `<button type="button" class="linkbtn" data-rm="${i}" aria-label="Remove option ${i + 1}">✕</button>` : ""}</div>`).join("");
      wrap.querySelectorAll("[data-o]").forEach((inp) => inp.addEventListener("input", () => { opts[Number(inp.dataset.o)] = inp.value; }));
      wrap.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { opts.splice(Number(b.dataset.rm), 1); draw(); }));
      wrap.querySelector("#pollAddOpt").hidden = opts.length >= 6;
    };
    draw();
    wrap.querySelector("#pollAddOpt").addEventListener("click", () => { if (opts.length < 6) { opts.push(""); draw(); wrap.querySelector(`[data-o="${opts.length - 1}"]`).focus(); } });
    wrap.querySelectorAll("[data-tpl]").forEach((b) => b.addEventListener("click", () => { const t = POLL_TEMPLATES[Number(b.dataset.tpl)]; wrap.querySelector("#pollQ").value = t.question; opts = [...t.options]; draw(); }));
    wrap.querySelector("#pollForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const q = wrap.querySelector("#pollQ").value.trim();
      const clean = opts.map((o) => o.trim()).filter(Boolean);
      if (!q) return toast("Add a question", "bad");
      if (clean.length < 2) return toast("Add at least 2 options", "bad");
      if (new Set(clean.map((o) => o.toLowerCase())).size !== clean.length) return toast("Two options are the same", "bad");
      await busy(e.submitter, "Posting", async () => {
        try { await D.sendPoll(state.me, q, clean); close(); } catch (err) { toast(D.authMessage(err), "bad"); }
      });
    });
  });
}
function pollHtml(p) {
  const total = p.votes.length;
  const mine = p.votes.find((v) => v.uid === state.me.id)?.choice;
  const counts = p.options.map((_, i) => p.votes.filter((v) => v.choice === i));
  const top = Math.max(0, ...counts.map((c) => c.length));
  const canClose = !p.closed && (p.uid === state.me.id || isAdmin());
  return `<div class="poll-q">📊 ${esc(p.question)}</div>
    <div class="poll-opts">${p.options.map((o, i) => {
      const n = counts[i].length, pct = total ? Math.round((n / total) * 100) : 0;
      const win = p.closed && n === top && n > 0;
      return `<button type="button" class="poll-opt ${mine === i ? "mine" : ""} ${win ? "win" : ""}" data-vote="${i}" ${p.closed ? "disabled" : ""}>
        <span class="poll-fill" style="width:${pct}%"></span>
        <span class="poll-label">${mine === i ? "✓ " : ""}${win ? "🏆 " : ""}${esc(o)}</span><span class="poll-pct">${total ? `${pct}%` : ""}</span>
        ${n ? `<small class="poll-who">${counts[i].map((v) => esc(String(v.name || "").split(" ")[0])).join(", ")}</small>` : ""}
      </button>`; }).join("")}</div>
    <div class="poll-foot">${total} vote${total === 1 ? "" : "s"}${p.closed ? " · Final result" : mine == null ? " · Tap to vote" : " · Tap another to change"}${canClose ? ` · <button type="button" class="linkbtn" data-close-poll>Close poll</button>` : ""}</div>`;
}
function wirePoll(el) {
  el.querySelectorAll("[data-vote]").forEach((b) => b.addEventListener("click", async () => {
    try { await D.votePoll(state.me, el.dataset.poll, Number(b.dataset.vote)); } catch (e) { toast(D.authMessage(e), "bad"); }
  }));
  el.querySelector("[data-close-poll]")?.addEventListener("click", async () => {
    if (!confirm("Close this poll? Nobody can vote after this.")) return;
    try { await D.closePoll(el.dataset.poll); } catch (e) { toast(D.authMessage(e), "bad"); }
  });
}
function watchPollCard(id) {
  if (pollWatch.has(id)) return;
  pollWatch.set(id, D.watchPoll(id, (p) => {
    pollCache.set(id, p);
    document.querySelectorAll(`[data-poll="${CSS.escape(id)}"]`).forEach((el) => { el.innerHTML = pollHtml(p); wirePoll(el); });
  }, () => {}));
}

// ---------- chat attachments (kept in Firestore: photos are shrunk, other files up to ~700 KB) ----------
const MAX_FILE = 700 * 1024;
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const fileIcon = (name) => { const ext = String(name).split(".").pop().toLowerCase();
  return /pdf/.test(ext) ? "📕" : /docx?/.test(ext) ? "📘" : /xlsx?|csv/.test(ext) ? "📗" : /pptx?/.test(ext) ? "📙" : /zip/.test(ext) ? "🗜️" : "📄"; };
const readAsDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("Couldn't read that file")); r.readAsDataURL(blob); });
async function shrinkImage(file, maxSide, quality) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That image couldn't be opened")); i.src = url; });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
    return { data: c.toDataURL("image/jpeg", quality), w, h };
  } finally { URL.revokeObjectURL(url); }
}
async function prepareAttachment(file) {
  const name = (file.name || "photo.jpg").slice(0, 120);
  if (/^image\/(png|jpe?g|webp|gif|heic|heif|bmp)$/i.test(file.type) || (/^image\//.test(file.type) && !/svg/.test(file.type))) {
    let full = await shrinkImage(file, 1600, 0.82);
    for (const [side, q] of [[1280, 0.75], [1024, 0.7], [800, 0.65]]) { if (full.data.length <= 950000) break; full = await shrinkImage(file, side, q); }
    if (full.data.length > 950000) throw new Error("That photo is too big to send");
    const thumb = await shrinkImage(file, 360, 0.6);
    return { kind: "image", name: name.replace(/\.(heic|heif|png|webp|bmp|gif)$/i, ".jpg"), type: "image/jpeg", size: Math.round(full.data.length * 0.75), data: full.data, thumb: thumb.data, w: full.w, h: full.h };
  }
  if (file.size > MAX_FILE) throw new Error(`That file is ${fmtSize(file.size)}. The limit is 700 KB, so send a link to it instead (Google Drive, Dropbox…).`);
  return { kind: "file", name, type: (file.type || "application/octet-stream").slice(0, 100), size: file.size, data: await readAsDataURL(file) };
}
function attachmentHtml(f) {
  if (f.kind === "image" && f.thumb) {
    const ratio = f.w && f.h ? ` style="aspect-ratio:${f.w}/${f.h}"` : "";
    return `<button type="button" class="att-img" data-open-file="${esc(f.id)}" aria-label="Open photo ${esc(f.name)}"><img src="${esc(f.thumb)}" alt="${esc(f.name)}"${ratio}></button>`;
  }
  return `<button type="button" class="att-file" data-open-file="${esc(f.id)}"><span class="file-ico">${fileIcon(f.name)}</span><span><b>${esc(f.name)}</b><small>${esc(fmtSize(f.size || 0))} · tap to open</small></span></button>`;
}
async function openAttachment(id) {
  try {
    const f = await D.getChatFile(id);
    if (!f) return toast("That attachment was deleted", "bad");
    if (/^image\//.test(f.type)) {
      showModal(`<img class="att-full" src="${esc(f.data)}" alt="${esc(f.name)}"><p class="muted small" style="text-align:center">${esc(f.name)} · <a href="${esc(f.data)}" download="${esc(f.name)}">Save</a></p>`);
      return;
    }
    const blob = await (await fetch(f.data)).blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) { toast(D.authMessage(e), "bad"); }
}

const modalQueue = [];
/** Shows a pop-up (queued behind any open one). Resolves once it's actually on screen. */
function showModal(html, onReady) {
  return new Promise((resolve) => openModal(html, (wrap, close) => { onReady?.(wrap, close); resolve(wrap); }));
}
function openModal(html, onReady) {
  if (document.querySelector(".modal-wrap")) { modalQueue.push([html, onReady]); return; }
  const wrap = document.createElement("div");
  wrap.className = "modal-wrap";
  wrap.innerHTML = `<div class="modal pop" role="dialog" aria-modal="true">${html}<button class="ghost wide-btn" data-close>Close</button></div>`;
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); const next = modalQueue.shift(); if (next) setTimeout(() => openModal(...next), 150); };
  wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest("[data-close]")) close(); });
  wrap.querySelector("[data-close]").focus();
  onReady?.(wrap, close);
}

async function checkBadges() {
  try {
    const rows = await D.getStatsFor(state.me.id);
    const earned = earnedBadges(totalsFrom(rows, state.goal, perthDay()));
    const fresh = newBadges(state.me.id, earned);
    if (!fresh.length) return;
    confetti();
    showModal(`<div class="badge-pop">${fresh.map((b) => `<div class="big-badge"><span>${b.icon}</span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`).join("")}</div>
      <h2 style="text-align:center">Badge${fresh.length > 1 ? "s" : ""} unlocked</h2>`);
    fresh.forEach((b) => D.celebrate(state.me, "badge", `${state.me.name} unlocked “${b.name}” ${b.icon}`));
  } catch (e) { console.warn("badge check failed", e); }
}

// =====================================================================
// Start here: a step-by-step guide new workers see on their first login
// =====================================================================
const startKey = () => `arm_start_${state.me.id}`;
function startProgress() {
  try { return JSON.parse(localStorage.getItem(startKey()) || "null") || { seen: false, done: [] }; } catch { return { seen: false, done: [] }; }
}
function saveStart(p) { try { localStorage.setItem(startKey(), JSON.stringify(p)); } catch {} }
const START_STEPS = () => [
  { id: "job", icon: "💼", title: "What you're doing", body: `
    <p>${esc(BRAND.name)} builds websites for local Perth businesses that don't have one, or have an old one. A website is about <b>$500</b>.</p>
    <p>Your job: <b>find</b> those businesses in the app, <b>call</b> them, and get them interested. ${esc(BRAND.ceo)} takes care of building the website.</p>
    <div class="start-pay"><b>How you get paid</b>
      <ul><li><b>$100</b> for every website you sell for $500 or more</li><li><b>10%</b> of the price for anything under $500</li>
      <li>It counts once the client has <b>paid in full</b>. You'll see it on Home as "pending" until then.</li></ul></div>` },
  { id: "find", icon: "🔎", title: "Search a suburb", body: `
    <ol class="start-list"><li>Tap <b>Find leads</b> in the menu at the top.</li>
      <li>Keep <b>🔎 No website</b> selected. These are businesses with no website, the ones we sell to.</li>
      <li>In <b>Suburb</b>, type a suburb name, e.g. <i>Bibra Lake</i>.</li>
      <li>In <b>Business type</b>, pick one, e.g. <i>Plumber</i>.</li>
      <li>Tap <b>Search</b>. A list of businesses comes up.</li></ol>
    <div class="start-tip">💡 <b>Pick a suburb that isn't common.</b> Big, popular suburbs have usually been searched by other workers already, so most businesses there are taken. Smaller suburbs, or ones further out, have more businesses nobody has called yet.</div>` },
  { id: "claim", icon: "✋", title: "Claim the businesses you'll call", body: `
    <p>Each business in the list has a button on the right. It looks like this:</p>
    <div class="start-demo lead"><div class="lead-main"><h3>Smith's Plumbing</h3><p class="muted">Plumber · Bibra Lake · ★ 4.6 (31)</p><p class="row"><span class="phone">📞 (08) 9418 0000</span></p></div>
      <div class="lead-act"><span class="primary small demo-btn">Claim</span></div></div>
    <dl class="start-outcomes">
      <dt><span class="primary small demo-btn">Claim</span></dt><dd><b>Tap it</b> to make the business yours. It moves into <b>My leads</b> and nobody else can call it.</dd>
      <dt><span class="pill taken">Taken by Jess</span></dt><dd>Another worker already claimed it. <b>Skip it and don't call it.</b></dd>
      <dt><span class="pill mine">Yours ✓</span></dt><dd>You've claimed it. It's waiting in My leads.</dd></dl>
    <p>Claim about <b>20–30</b> businesses, enough for your calling session. If most say "Taken", try a different suburb.</p>
    <p class="muted small">Only call businesses you've claimed. Not sure if one really has no website? Tap <b>Check Google</b> under its name first.</p>` },
  { id: "call", icon: "📞", title: "Go to My leads and call", body: `
    <ol class="start-list"><li>Tap <b>My leads</b> in the top menu. Every business you claimed is there.</li>
      <li>Tap <b>📞 Start call mode</b> to go through them one at a time, or just scroll the list.</li>
      <li>Tap the <b>phone number</b> on the card. That rings the business from your phone.
        <div class="start-demo-inline"><span class="phone">📞 (08) 9418 0000</span></div></li>
      <li>While it rings, open <b>📜 Call script &amp; objections</b> on the same card. It tells you what to say, and what to say back when they say no.</li>
      <li>During the call, type anything useful into <b>Notes</b> (the owner's name, when they're free, what they said).</li></ol>
    <div class="start-script"><b>How a call starts</b>
      <p>"Hi, is this Bob's Plumbing? … Hi, it's ${esc(state.me.name.split(" ")[0])} from ${esc(BRAND.name)}. We build websites for local businesses here in Perth. Do you have a website at the moment?"</p>
      <p class="muted small">Sound like a person, not a script. Ask a question, then listen. You're not begging, you're helping them get more customers. Never promise anything for free.</p></div>` },
  { id: "log", icon: "✅", title: "Log the status straight after the call", body: `
    <p>As soon as you hang up, scroll down the same card to <b>Log this call as:</b> and tap what happened. <b>Do this for every call</b>, even when nobody answers. It's how your calls, points and pay get counted.</p>
    <div class="start-demo-inline outcomes">${D.CALL_STATUSES.map((st) => `<span class="out o-${st.replace(/\s/g, "")} demo-btn">${esc(st)}</span>`).join("")}</div>
    <dl class="start-outcomes">
      <dt><span class="status s-Noanswer">No answer</span></dt><dd>Didn't pick up. It comes back for you to try again in 3 days.</dd>
      <dt><span class="status s-Callback">Call back</span></dt><dd>They said "call me later". Tap it, <b>pick the day and time</b> they said, then tap <b>Call back again</b>. It shows on Home when it's due.</dd>
      <dt><span class="status s-Interested">Interested</span></dt><dd>They want to hear more. Ask for their email and type it into <b>Their email</b> on the card before you tap Interested. The app then sends them friendly follow-up emails by itself until they reply. Still call or text them back within 3 days.</dd>
      <dt><span class="status s-Notinterested">Not interested</span></dt><dd>They said no. That's normal, move on to the next one.</dd>
      <dt><span class="status s-Won">Won</span></dt><dd>They said yes! Tap it, <b>pick the package</b> (or type the price), then tap <b>Won again</b>.</dd></dl>
    <p class="muted small">Points: <b>1</b> for each business you call in a day, <b>+3</b> when they're interested, <b>+10</b> for a sale. Calling the same business twice in one day doesn't add more.</p>` },
  { id: "won", icon: "💰", title: "When someone says yes", body: `
    <ol class="start-list"><li>Tap <b>Won</b>, pick the <b>package</b> they want, check the price, then tap <b>Won</b> again.</li>
      <li>Send ${esc(BRAND.ceo.split(" ")[0])} a message in <b>Chat</b> with the business name. ${esc(BRAND.ceo.split(" ")[0])} handles the website and payment.</li>
      <li>Your commission shows on <b>Home</b>. It turns from pending to paid when the client pays in full.</li></ol>
    <p class="muted small">If they're keen, offer review cards ($50 each) too. There's a line for it in the script.</p>` },
  { id: "day", icon: "🗓️", title: "Your day", body: `
    <ol class="start-list"><li>Open <b>Home</b> first: do your <b>call-backs due</b> and <b>follow-ups</b> before anything else. They're the easiest wins.</li>
      <li>Then <b>Start call mode</b> for new businesses. Aim for <b>${state.goal} calls</b> a day.</li>
      <li>Best times: <b>9–11:30am</b> and <b>2–4pm</b>. Avoid calling cafes and restaurants over lunch.</li>
      <li>Stuck or got a question? Ask in <b>Chat</b>.</li></ol>
    <p class="muted small">Most calls end in "no". That's normal for everyone. The people who keep dialling are the ones who make sales.</p>` },
];

async function screenStart() {
  setTitle("Start here");
  const prog = startProgress();
  if (!prog.seen) { prog.seen = true; saveStart(prog); }
  const steps = START_STEPS();
  const draw = () => {
    const done = new Set(startProgress().done);
    const count = steps.filter((st) => done.has(st.id)).length;
    const next = steps.find((st) => !done.has(st.id));
    view().innerHTML = `
      <h1 class="page">Start here</h1>
      <p class="muted">Welcome to ${esc(BRAND.name)}, ${esc(state.me.name.split(" ")[0])}. This takes about 5 minutes. Read each step, then tap <b>Got it</b> to move to the next one.</p>
      <div class="start-progress"><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="${count}"><span style="width:${Math.round((count / steps.length) * 100)}%"></span></div>
        <span class="muted small">${count} of ${steps.length} done</span></div>
      ${steps.map((st, i) => `<section class="card start-step ${done.has(st.id) ? "done" : ""} ${next && next.id === st.id ? "current" : ""}" id="step-${st.id}">
        <h2><span class="start-num">${done.has(st.id) ? "✓" : i + 1}</span>${st.icon} ${esc(st.title)}</h2>
        <div class="start-body">${st.body}</div>
        ${done.has(st.id) ? "" : `<button class="primary" data-got="${st.id}">Got it</button>`}
      </section>`).join("")}
      ${count === steps.length ? `<section class="card start-ready"><h2>🚀 You're ready</h2><p>Find your first businesses and start calling.</p>
        <a class="primary wide-btn" href="#find">Find leads</a></section>` : ""}`;
    view().querySelectorAll("[data-got]").forEach((b) => b.addEventListener("click", () => {
      const p = startProgress();
      if (!p.done.includes(b.dataset.got)) p.done.push(b.dataset.got);
      saveStart(p); draw();
      const nxt = view().querySelector(".start-step.current") || view().querySelector(".start-ready");
      nxt?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  };
  draw();
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
    home: screenHome, find: screenFind, leads: screenLeads, board: screenBoard, account: screenAccount, lockin: screenLockin, reviews: screenReviews, chat: screenChat, start: screenStart,
    admin: screenAdmin, worker: screenWorker, pool: screenPool, team: screenTeam, report: screenReport, brand: screenBrand, care: screenCare, packages: screenPackages, referrals: screenReferrals,
  };
  const adminOnly = ["admin", "worker", "pool", "team", "report", "brand", "care", "packages", "referrals"];
  let fn = routes[name] || screenHome;
  // new workers land on the Start here guide the first time they open the app
  if (!isAdmin() && (name === "home" || !routes[name]) && !startProgress().seen) { location.replace("#start"); return; }
  if (adminOnly.includes(name) && !isAdmin()) fn = screenHome;
  markTab(adminOnly.includes(name) ? "admin" : name);
  setPresencePage(name);
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
        <p class="founder"><span>Founded &amp; run by</span><b>${esc(BRAND.ceo)}</b><small>CEO · Perth, WA</small></p>
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
            : `<button class="linkbtn" id="forgot">Forgot password?</button>`}
        </div>
      </div>
      <footer class="foot sig"><img src="logo.png" alt="" width="34" height="44"><div><b class="sig-name">AR METHODS</b><span>Founded &amp; run by <b>${esc(BRAND.ceo)}</b>, CEO · Perth, WA</span></div></footer>
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

// Last-known profile + settings, so a returning user sees the app instantly while we re-check
const BOOT_KEY = (uid) => `arm_boot_${uid}`;
function readBoot(uid) { try { return JSON.parse(localStorage.getItem(BOOT_KEY(uid)) || "null"); } catch { return null; } }
function saveBoot(uid, data) { try { localStorage.setItem(BOOT_KEY(uid), JSON.stringify(data)); } catch {} }

function startApp() {
  renderShell();
  startCelebrations();
  startChat();
  startPresence();
  route();
}

// Start drawing straight away for the last person who used this device, before Firebase has
// finished restoring the login. Firestore waits for the login itself, so reads stay correct.
const LAST_KEY = "arm_last_uid";
let optimisticUid = null;
try {
  const uid = localStorage.getItem(LAST_KEY);
  const boot = uid && readBoot(uid);
  if (boot?.me?.active) {
    optimisticUid = uid;
    Object.assign(state, { user: { uid }, me: boot.me, goal: boot.goal || 30, googleToken: boot.googleToken || "", brand: boot.brand || {}, packages: boot.packages || null });
    // wait until this whole file has run, so every screen's helpers exist
    queueMicrotask(() => { if (state.me && optimisticUid === uid) startApp(); });
  }
} catch {}

D.onAuthStateChanged(D.auth, async (user) => {
  const alreadyShowing = optimisticUid && user?.uid === optimisticUid;
  optimisticUid = null;
  if (!alreadyShowing) {
    clearListeners();
    state.user = user;
    state.me = null;
  } else state.user = user;
  if (!user) { stopChat(); stopPresence(); try { localStorage.removeItem(LAST_KEY); } catch {} return renderAuth(); }
  try { localStorage.setItem(LAST_KEY, user.uid); } catch {}
  const boot = readBoot(user.uid);
  if (alreadyShowing) {
    // already on screen from the device's copy
  } else if (boot?.me?.active) {
    // Show the app straight away from the device's copy
    Object.assign(state, { me: boot.me, goal: boot.goal || 30, googleToken: boot.googleToken || "", brand: boot.brand || {} });
    startApp();
  } else {
    $("#app").innerHTML = `<div class="loading"><span class="spinner"></span>Loading…</div>`;
  }
  try {
    // Load profile and settings at the same time instead of one after another
    let [me, team, googleToken] = await Promise.all([
      D.getProfile(user.uid),
      D.getTeamSettings().catch(() => null),
      D.getGoogleToken().catch(() => ""),
    ]);
    if (!me && user.email?.toLowerCase() === OWNER_EMAIL) {
      await D.createOwnerProfile(user, state.pendingOwnerName || "Aman Raju");
      me = await D.getProfile(user.uid);
      team = await D.getTeamSettings().catch(() => null);
      googleToken = await D.getGoogleToken().catch(() => "");
    }
    if (state.user?.uid !== user.uid) return; // signed out meanwhile
    if (!me || !me.active) {
      try { localStorage.removeItem(BOOT_KEY(user.uid)); } catch {}
      clearListeners();
      state.me = null;
      return !me ? renderBlocked("No access yet", "This login hasn't been set up. Ask Aman to create your worker account.")
        : renderBlocked("Account turned off", "Your account has been deactivated. Contact Aman if you think this is a mistake.");
    }
    const goal = team?.dailyGoal || 30;
    const brand = { brandLink: team?.brandLink ?? BRAND_LINK, brandPhone: team?.brandPhone ?? BRAND_PHONE };
    state.brand = brand;
    const changed = !boot?.me || boot.me.role !== me.role || boot.me.name !== me.name || boot.goal !== goal || boot.googleToken !== googleToken;
    saveBoot(user.uid, { me, goal, googleToken, brand });
    Object.assign(state, { me, goal, googleToken });
    if (!boot?.me?.active || changed) startApp(); // first visit, or something changed: redraw with fresh data
    D.getPackages().then((list) => {
      state.packages = list;
      try { saveBoot(user.uid, { ...readBoot(user.uid), packages: list }); } catch {}
    }).catch(() => {});
  } catch (e) {
    console.error(e);
    renderBlocked("Couldn't load your account", D.authMessage(e));
  }
});

// =====================================================================
// Home
// =====================================================================
const slimLead = (l) => ({ id: l.id, name: l.name, phone: l.phone, status: l.status, suburb: l.suburb || "", payment: l.payment || "",
  callbackAt: toDate(l.callbackAt)?.getTime() ?? null, lastCalledAt: toDate(l.lastCalledAt)?.getTime() ?? null });
const slimCall = (c) => ({ status: c.status, value: c.value || 0, day: c.day, leadId: c.leadId });

async function screenHome() {
  setTitle("Home");
  const today = perthDay();
  const hour = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Perth", hour: "numeric", hour12: false }).format(new Date()));
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  view().innerHTML = `<h1 class="page">${greet}, ${esc(state.me.name.split(" ")[0])}</h1><div id="ladderBox"></div><div id="homeBody"><div class="loading"><span class="spinner"></span></div></div>`;
  drawLadder(state.routeId);
  const rid = state.routeId;
  const monthStart = today.slice(0, 8) + "01";
  const HOME_KEY = `arm_home2_${state.me.id}`; // v2: calls keep leadId (payment-aware commission)
  try { localStorage.removeItem(`arm_home_${state.me.id}`); } catch {}
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(HOME_KEY) || "null"); } catch {}
  const revive = (l) => ({ ...l, callbackAt: l.callbackAt ? D.Timestamp.fromMillis(l.callbackAt) : null, lastCalledAt: l.lastCalledAt ? D.Timestamp.fromMillis(l.lastCalledAt) : null });
  const load = Promise.all([D.getStatsFor(state.me.id), D.getLeadsFor(state.me.id), D.getCallsFor(state.me.id).catch(() => [])]);
  let mine, leads, myCalls;
  if (cached && cached.day === today) {
    [mine, leads, myCalls] = [cached.mine, cached.leads.map(revive), cached.calls];
    load.then(([m, l, c]) => {
      if (rid !== state.routeId) return;
      const sig = (ls, cs, ms) => JSON.stringify([ms.length, cs.length, ls.map((x) => [x.id, x.status, x.payment || "", toDate(x.callbackAt)?.getTime() ?? null])]);
      const same = sig(l, c, m) === sig(leads, myCalls, mine);
      try { localStorage.setItem(HOME_KEY, JSON.stringify({ day: today, mine: m, leads: l.map(slimLead), calls: c.map(slimCall) })); } catch {}
      if (!same) screenHome();
    }).catch(() => {});
  } else {
    [mine, leads, myCalls] = await load;
    try { localStorage.setItem(HOME_KEY, JSON.stringify({ day: today, mine, leads: leads.map(slimLead), calls: myCalls.map(slimCall) })); } catch {}
  }
  if (rid !== state.routeId) return;
  const monthWon = myCalls.filter((c) => c.status === "Won" && c.day >= monthStart);
  const comm = commissionSplit(monthWon, new Map(leads.map((l) => [l.id, payOf(l)])));
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
    const staleBefore = Date.now() - 3 * 864e5;
    const followUps = leads.filter((l) => l.status === "Interested" && (toDate(l.lastCalledAt)?.getTime() ?? 0) < staleBefore)
      .sort((a, b) => (toDate(a.lastCalledAt)?.getTime() ?? 0) - (toDate(b.lastCalledAt)?.getTime() ?? 0));
    const startDone = startProgress().done.length, startTotal = START_STEPS().length;
    $("#homeBody").innerHTML = `
      ${!isAdmin() && startDone < startTotal ? `<a class="card start-card" href="#start"><span aria-hidden="true">📘</span><div><b>Start here</b><small>How the app works and how you get paid · ${startDone} of ${startTotal} done</small></div><span aria-hidden="true">›</span></a>` : ""}
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
            ${l.phone ? phoneHtml(l.phone) : ""}
          </li>`).join("")}</ul>` : `<p class="muted">Nothing due today.</p>`}
      </section>
      ${followUps.length ? `<section class="card followups">
        <h2>🔥 Follow-ups due <span class="muted small">Interested, but no contact for 3+ days</span></h2>
        <ul class="plain">${followUps.map((l, i) => {
          const last = toDate(l.lastCalledAt);
          const days = last ? Math.floor((Date.now() - last.getTime()) / 864e5) : null;
          return `<li class="due"><a href="#leads">${esc(l.name)}</a><span>${days != null ? `${days} days ago` : "Never called"}</span>
            ${l.phone ? phoneHtml(l.phone) : ""}<button class="linkbtn" data-fu="${i}">💬 Text</button></li>`;
        }).join("")}</ul>
        <p class="muted small">Warm leads go cold fast. A quick follow-up text wins deals.</p>
      </section>` : ""}
      <section class="card earn">
        <div><span class="muted">Your commission this month</span><b class="num">${money(comm.paid)}</b>
          ${comm.pending ? `<small class="pending-line">+ ${money(comm.pending)} pending: counts once the client pays in full</small>` : ""}
          <small class="muted">${monthWon.length} deal${monthWon.length === 1 ? "" : "s"} closed · $100 per paid site of $500+, 10% under $500</small></div>
        <span class="earn-icon" aria-hidden="true">💵</span>
      </section>
      <section class="card">
        <h2>Badges <span class="muted small">${earnedBadges(totalsFrom(allMine, state.goal, today)).length} / ${BADGES.length}</span></h2>
        <div class="badges">${(() => { const tt = totalsFrom(allMine, state.goal, today); return BADGES.map((b) => {
          const got = b.test(tt);
          return `<div class="bdg ${got ? "got" : ""}"><span>${b.icon}</span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`;
        }).join(""); })()}</div>
      </section>
      <section class="quick">
        <a class="primary" href="#find">Find new leads</a>
        <a class="ghost" href="#leads">My leads (${fresh} new)</a>
      </section>
      <p class="muted small">Points: each lead you call 1 (once a day) · Interested +3 · Won +10 (once per lead)</p>`;
    $("#homeBody").querySelectorAll("[data-fu]").forEach((b) => b.addEventListener("click", () => showTexts(followUps[Number(b.dataset.fu)])));
  };
  state.unsub.push(D.watchStats("day", today, draw, (e) => { $("#homeBody").innerHTML = errorBox(D.authMessage(e)); }));
}

// =====================================================================
// Find leads
// =====================================================================
function screenFind() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("arm_search") || "{}"); } catch {}
  state.findMode = state.findMode || saved.mode || "none";
  const old = state.findMode === "old";
  setTitle(old ? "Old website finder" : "Find leads");
  view().innerHTML = `
    <div class="find-modes" role="tablist" aria-label="What to find">
      <button type="button" role="tab" class="find-mode ${old ? "" : "on"}" data-mode="none" aria-selected="${!old}">🔎 No website</button>
      <button type="button" role="tab" class="find-mode old ${old ? "on" : ""}" data-mode="old" aria-selected="${old}">🕰️ Old website</button>
    </div>
    ${old ? `<section class="old-hero">
        <span class="old-tag">Old website finder</span>
        <h1 class="page">Businesses with outdated websites</h1>
        <p>Every business here <b>already has a website</b>, but it looks old: not mobile-friendly, not secure, slow or on a free builder. Sell them a <b>redesign</b> ($800–$1,500). They already know they need a site.</p>
      </section>` : `<h1 class="page">Find leads</h1>`}
    <form class="card search ${old ? "search-old" : ""}" id="searchForm" autocomplete="off">
      <div><label for="suburb">Suburb</label><input id="suburb" placeholder="e.g. Willetton" maxlength="60" value="${esc(saved.suburb || "")}" required></div>
      <div><label for="trade">Business type</label>
        <select id="trade">${TRADES.map((t) => `<option value="${t.id}" ${t.id === saved.trade ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select></div>
      <button class="primary" type="submit" id="searchBtn">Search</button>
      <div class="search-opts">
        <label class="check"><input type="checkbox" id="onlySuburb" ${saved.only === false ? "" : "checked"}> Only inside this suburb</label>
        ${GOOGLE_MAPS_KEY || state.googleToken ? `<label class="check">Coverage
          <select id="coverage" aria-label="Coverage">
            <option value="quick" ${!saved.coverage || saved.coverage === "quick" ? "selected" : ""}>Quick (up to 60)</option>
            <option value="standard" ${saved.coverage === "standard" ? "selected" : ""}>Standard (up to 240)</option>
            <option value="thorough" ${saved.coverage === "thorough" ? "selected" : ""}>Thorough (up to 540)</option>
          </select></label>` : ""}
      </div>
      <p class="muted small source-line">${GOOGLE_MAPS_KEY || state.googleToken ? "Searching <b>Google Maps</b>. Results are saved for the team for 30 days, so repeat searches don&#39;t use the daily limit."
        : isAdmin() ? `Searching OpenStreetMap. <a href="#team">Connect Google Maps</a> for much better results.` : "Searching OpenStreetMap."}</p>
    </form>
    <div id="searchMsg"></div>
    <div id="results"></div>`;
  $("#searchForm").addEventListener("submit", runSearch);
  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
    if (state.findMode === b.dataset.mode) return;
    state.findMode = b.dataset.mode;
    try { localStorage.setItem("arm_search", JSON.stringify({ ...JSON.parse(localStorage.getItem("arm_search") || "{}"), mode: state.findMode })); } catch {}
    screenFind();
    if (state.findMode === "old" && state.search) startOldChecks(state.search);
  }));
  if (state.search) drawResults();
}

async function runSearch(e) {
  e.preventDefault();
  const suburb = $("#suburb").value.trim();
  const tradeId = $("#trade").value;
  const onlySuburb = $("#onlySuburb").checked;
  const coverage = $("#coverage")?.value || "quick";
  if (!suburb) return;
  try { localStorage.setItem("arm_search", JSON.stringify({ suburb, trade: tradeId, only: onlySuburb, coverage, mode: state.findMode })); } catch {}
  $("#searchMsg").innerHTML = "";
  await busy($("#searchBtn"), "Searching", async () => {
    try {
      const result = await searchBusinesses({
        suburb, tradeId, onlySuburb, tomtomKey: TOMTOM_KEY, googleToken: state.googleToken, placesKey: GOOGLE_MAPS_KEY, coverage, cache: D.searchCache(state.me),
        onProgress: (msg) => { if ($("#searchMsg")) $("#searchMsg").innerHTML = `<div class="notice info"><span class="spinner"></span>${esc(msg)}</div>`; },
      });
      const sm = $("#searchMsg"); if (sm) sm.innerHTML = "";
      state.search = result;
      state.claims = await D.getClaims(result.leads.map((l) => l.id));
      const c = countKinds(result.leads);
      state.filter = c.none ? "none" : c.social ? "social" : "all";
      if (!result.cached) D.recordSearch(state.me, result);
      drawResults();
      if (state.findMode === "old") startOldChecks(result);
      let pending = null;
      findHiddenWebsites(result.leads, () => {
        if (state.search !== result || pending) return;
        pending = setTimeout(() => { pending = null; if (state.search === result) drawResults(); }, 400);
      }).then(() => { if (state.search === result) drawResults(); });
    } catch (err) {
      console.error(err);
      const sm = $("#searchMsg"); if (sm) sm.innerHTML = errorBox(err instanceof SearchError ? err.message : D.authMessage(err));
    }
  });
}

function countKinds(leads) {
  const c = { none: 0, social: 0, website: 0 };
  leads.forEach((l) => c[l.websiteKind]++);
  return c;
}

function drawResults() {
  if (state.findMode === "old") return drawOldResults();
  const r = state.search;
  if (!r || !$("#results")) return;
  const c = countKinds(r.leads);
  const shown = (state.filter === "all" ? r.leads : r.leads.filter((l) => l.websiteKind === state.filter))
    .slice().sort((a, b) => (a.websiteKind === b.websiteKind ? leadScore(b) - leadScore(a) : 0));
  const maybeCount = r.leads.filter((l) => l.maybeSite).length;
  const sources = r.source === "google"
    ? [`Google Maps${r.cached ? " (saved search, no usage)" : r.googleRequests ? ` (${r.googleRequests} request${r.googleRequests === 1 ? "" : "s"})` : ""}`]
    : [`OpenStreetMap ${r.counts.osm ?? "failed"}`].concat(r.counts.tomtom !== undefined ? [`TomTom ${r.counts.tomtom ?? "failed"}`] : []);
  $("#results").innerHTML = `
    ${r.errors.length ? `<div class="notice warn">${esc(r.errors.join(" "))}</div>` : ""}
    <div class="chips" role="group" aria-label="Filter results">
      ${[["none", c.none], ["social", c.social], ["website", c.website], ["all", r.leads.length]].map(([k, n]) =>
        `<button type="button" class="chip ${state.filter === k ? "on" : ""}" data-filter="${k}">${k === "all" ? "All" : KIND_LABEL[k]} (${n})</button>`).join("")}
    </div>
    <p class="muted small">${esc(r.trade.label)} in ${esc(r.suburb)} · ${esc(sources.join(" · "))}.
      “No website” means none is listed${maybeCount ? `; ${maybeCount} might have one (marked below)` : ""}. Tap <b>Check Google</b> before you call to confirm.</p>
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
    <a href="${esc(safeUrl(l.mapsUrl) || `https://www.google.com/maps/search/?api=1&query=${q}`)}" target="_blank" rel="noopener">Map</a>
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
        <h3>${esc(l.name)} ${scoreChip(l)} <span class="badge ${esc(l.websiteKind)}">${KIND_LABEL[l.websiteKind] || ""}</span></h3>
        <p class="muted">${esc(l.category)}${l.address ? " · " + esc(l.address) : ""} · ${esc(l.suburb)}${l.rating ? ` · ★ ${Number(l.rating).toFixed(1)} (${Number(l.reviews) || 0})` : ""}</p>
        <p class="row">${phoneHtml(l.phone)} ${leadLinks(l)}</p>
        ${siteHint(l)}
      </div>
      <div class="lead-act">${action}</div>
    </article>`;
}

// =====================================================================
// Old website finder: checks every business that has a website
// =====================================================================
state.oldChecks = new Map();   // leadId → { status: "checking" | "done", score, reasons, full }
let oldRun = 0;
async function startOldChecks(result) {
  const run = ++oldRun;
  const sites = result.leads.filter((l) => l.websiteKind === "website" && safeUrl(l.website));
  state.oldSetup = null;
  if (state.psiKey === undefined) state.psiKey = await D.getPageSpeedKey().catch(() => "");
  let key = PAGESPEED_KEY || state.psiKey || firebaseApiKey();
  for (const l of sites) {
    const c = state.oldChecks.get(l.id);
    if (c?.status === "done") l.oldSite = { score: c.score, reasons: c.reasons, label: oldLabel(c.score) };
  }
  for (const l of sites) if (!state.oldChecks.has(l.id)) {
    const q = scoreSite({ quick: quickSignals(l.website) });
    state.oldChecks.set(l.id, { status: "checking", ...q });
  }
  drawResults();
  let fullOn = true;
  const queue = sites.filter((l) => state.oldChecks.get(l.id).status !== "done");
  const worker = async () => {
    while (queue.length && run === oldRun) {
      const l = queue.shift();
      const quick = quickSignals(l.website);
      const id = siteKey(l.website);
      let saved = null;
      try { saved = await D.getSiteCheck(id); } catch {}
      const fresh = saved && toDate(saved.checkedAt) && Date.now() - toDate(saved.checkedAt).getTime() < 60 * 864e5;
      let out;
      if (fresh && (saved.full || !fullOn)) out = { score: saved.score, reasons: saved.reasons, full: saved.full };
      else if (!fullOn) out = { ...scoreSite({ quick }), full: false };
      else {
        try {
          const full = await pageSpeed(l.website, key);
          out = { ...scoreSite({ quick, full }), full: !full.timedOut && !full.error, mobile: full.mobile ?? null, speed: full.speed ?? null };
          D.saveSiteCheck(id, { url: l.website, score: out.score, reasons: out.reasons, mobile: out.mobile, speed: out.speed, https: full.https ?? quick.https, full: out.full }).catch(() => {});
        } catch (e) {
          if (e instanceof SetupError || e instanceof CheckQuotaError) { fullOn = false; state.oldSetup = e instanceof SetupError ? "setup" : "quota"; state.oldSetupMsg = e.message || ""; }
          out = { ...scoreSite({ quick }), full: false };
        }
      }
      if (run !== oldRun) return;
      state.oldChecks.set(l.id, { status: "done", ...out });
      l.oldSite = { score: out.score, reasons: out.reasons, label: oldLabel(out.score) };
      drawResults();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}
const firebaseApiKey = () => { try { return D.app.options.apiKey; } catch { return ""; } };
const firebaseProjectId = () => { try { return D.app.options.projectId; } catch { return "armethods"; } };

function drawOldResults() {
  const r = state.search;
  if (!r || !$("#results")) return;
  const sites = r.leads.filter((l) => l.websiteKind === "website" && safeUrl(l.website));
  const checks = sites.map((l) => ({ l, c: state.oldChecks.get(l.id) || { status: "checking", score: 0, reasons: [] } }));
  const checking = checks.filter((x) => x.c.status === "checking").length;
  const outdated = checks.filter((x) => x.c.score >= OLD_MIN);
  state.oldFilter = state.oldFilter || "outdated";
  const shown = (state.oldFilter === "all" ? checks : checks.filter((x) => x.c.score >= OLD_MIN || x.c.status === "checking"))
    .sort((a, b) => b.c.score - a.c.score || (a.c.status === "checking") - (b.c.status === "checking"));
  const done = sites.length - checking;
  $("#results").innerHTML = `
    ${state.oldSetup === "setup" && PAGESPEED_KEY ? `<div class="notice warn old-setup"><b>Google's website checker didn't accept the request</b>, so only quick checks ran.
        <p class="small">Google said: “${esc(state.oldSetupMsg || "no reason given")}”</p>
        <p class="small">If you just updated the app, close it completely and reopen it. If this keeps happening, send Aman a screenshot of this box.</p>
        <button class="primary small" id="oldRetry">Try again</button></div>`
    : state.oldSetup === "setup" ? `<div class="notice warn old-setup">${isAdmin()
      ? `<b>Full website checks aren't switched on yet</b>, so only quick checks ran (no padlock, free builder address). To also catch <b>not mobile-friendly</b> and <b>slow</b> sites (free, no card, 2 minutes):
        <ol><li>Open <a href="https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com?project=armethods" target="_blank" rel="noopener">PageSpeed Insights API</a> (project <b>armethods</b>) and click <b>Enable</b>.</li>
        <li>Go to <a href="https://console.cloud.google.com/apis/credentials?project=armethods" target="_blank" rel="noopener">Credentials</a> → <b>Create credentials → API key</b>. Copy it.</li>
        <li>Paste it here: <span class="inline"><input id="psiKey" placeholder="AIza…" maxlength="100"><button class="primary small" id="psiSave">Save</button></span></li></ol>`
      : "Only quick website checks are on. Ask Aman to switch on full checks to find more outdated sites."}</div>`
      : state.oldSetup === "quota" ? `<div class="notice warn">Today's free full website checks are used up, so the rest got quick checks only. They reset tomorrow.</div>` : ""}
    ${checking ? `<div class="notice info old-progress"><span class="spinner"></span>Checking websites… ${done} of ${sites.length} done. Each full check takes about 10–20 seconds.</div>` : ""}
    <div class="chips" role="group" aria-label="Filter results">
      <button type="button" class="chip ${state.oldFilter === "outdated" ? "on" : ""}" data-of="outdated">🕰️ Outdated (${outdated.length})</button>
      <button type="button" class="chip ${state.oldFilter === "all" ? "on" : ""}" data-of="all">All with websites (${sites.length})</button>
    </div>
    <p class="muted small">${esc(r.trade.label)} in ${esc(r.suburb)} · ${sites.length} of ${r.leads.length} businesses have a website. Results are saved for the team for 60 days.</p>
    <div class="list">${shown.length ? shown.map(({ l, c }) => oldCard(l, c)).join("")
      : `<div class="empty">${sites.length ? (checking ? "Still checking…" : "None of these websites look outdated. Try another business type or suburb.") : "None of these businesses have a website listed. Switch to 🔎 No website to call them instead."}</div>`}</div>`;
  document.querySelectorAll("[data-of]").forEach((b) => b.addEventListener("click", () => { state.oldFilter = b.dataset.of; drawOldResults(); }));
  $("#oldRetry")?.addEventListener("click", () => { state.oldChecks = new Map(); state.oldSetup = null; startOldChecks(state.search); });
  document.querySelectorAll("[data-claim]").forEach((b) => b.addEventListener("click", () => doClaim(b)));
  $("#psiSave")?.addEventListener("click", async (e) => {
    const k = $("#psiKey").value.trim();
    if (!/^AIza[\w-]{20,}$/.test(k)) return toast("That doesn't look like a Google API key (it starts with AIza).", "bad");
    await busy(e.currentTarget, "Saving", async () => {
      try {
        await D.setPageSpeedKey(k); state.psiKey = k; toast("Saved. Re-checking websites…");
        state.oldChecks = new Map(); startOldChecks(state.search);
      } catch (err) { toast(D.authMessage(err), "bad"); }
    });
  });
}

function oldCard(l, c) {
  const claim = state.claims.get(l.id);
  const action = claim
    ? (claim.uid === state.me.id ? `<span class="pill mine">Yours ✓</span>` : `<span class="pill taken">Taken by ${esc(claim.name)}</span>`)
    : `<button class="primary small" data-claim="${esc(l.id)}">Claim</button>`;
  const level = c.status === "checking" ? "checking" : c.score >= 50 ? "very" : c.score >= OLD_MIN ? "some" : "ok";
  const site = safeUrl(l.website);
  return `
    <article class="lead old-lead old-${level}">
      <div class="lead-main">
        <h3>${esc(l.name)} <span class="old-badge old-${level}">${c.status === "checking" && !c.score ? "Checking…" : `🕰️ ${esc(oldLabel(c.score))} · ${c.score}`}</span></h3>
        <p class="muted">${esc(l.category)}${l.address ? " · " + esc(l.address) : ""} · ${esc(l.suburb)}${l.rating ? ` · ★ ${Number(l.rating).toFixed(1)} (${Number(l.reviews) || 0})` : ""}</p>
        ${c.reasons?.length ? `<div class="old-reasons">${c.reasons.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""}
        ${c.status === "checking" ? `<p class="small muted"><span class="spinner"></span>Running full check…</p>` : !c.full ? `<p class="small muted">Quick check only</p>` : ""}
        <p class="row">${phoneHtml(l.phone)} ${site ? `<a href="${esc(site)}" target="_blank" rel="noopener">View their website ↗</a>` : ""}
          <a href="https://www.google.com/search?q=${encodeURIComponent(`${l.name} ${l.suburb} WA`)}" target="_blank" rel="noopener">Check Google</a>
          <a href="${esc(safeUrl(l.mapsUrl) || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${l.name} ${l.suburb} WA`)}`)}" target="_blank" rel="noopener">Map</a></p>
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
  state.callMode = false;
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
  if (state.callMode) {
    const queue = callQueue(leads);
    const handled = state.callDone?.size || 0;
    if (!queue.length) {
      body.innerHTML = `<section class="card callmode-done"><span aria-hidden="true">🏁</span><h2>Queue cleared</h2>
        <p class="muted">${handled} lead${handled === 1 ? "" : "s"} handled. Find more leads to keep going.</p>
        <div class="toolbar"><a class="primary" href="#find">Find new leads</a><button class="ghost" data-exit>Back to my leads</button></div></section>`;
    } else {
      body.innerHTML = `<div class="callmode-bar"><div><b>📞 Call mode</b><span class="muted small">${handled} done · ${queue.length} to go</span></div>
          <div class="toolbar"><button class="ghost small" data-skip>Skip</button><button class="ghost small" data-exit>Exit</button></div></div>
        <div class="callmode-progress"><span style="width:${Math.round((handled / (handled + queue.length)) * 100)}%"></span></div>
        <div class="list callmode">${myLeadCard(queue[0], now)}</div>`;
      body.querySelectorAll("article[data-id]").forEach(wireLeadCard);
      body.querySelector("[data-skip]").addEventListener("click", () => { state.callDone.add(queue[0].id); drawMyLeads(); });
    }
    body.querySelectorAll("[data-exit]").forEach((b) => b.addEventListener("click", () => { state.callMode = false; drawMyLeads(); }));
    return;
  }
  const groups = {
    active: (l) => needsCallToday(l, now),
    New: (l) => l.status === "New", "Call back": (l) => l.status === "Call back", Interested: (l) => l.status === "Interested",
    "No answer": (l) => l.status === "No answer", Won: (l) => l.status === "Won", "Not interested": (l) => l.status === "Not interested",
    all: () => true,
  };
  const label = { active: "To call today", all: "All" };
  const shown = leads.filter(groups[state.leadFilter] || groups.active).sort((a, b) => {
    const ad = a.status === "Call back" && toDate(a.callbackAt), bd = b.status === "Call back" && toDate(b.callbackAt);
    if (ad && bd) return ad - bd;
    if (ad) return -1;
    if (bd) return 1;
    if (a.status === "New" && b.status === "New") return leadScore(b) - leadScore(a);
    return (toDate(b.updatedAt) || 0) - (toDate(a.updatedAt) || 0);
  });
  const queueSize = callQueue(leads).length;
  body.innerHTML = `
    ${queueSize ? `<button class="primary callmode-start" data-callmode>📞 Start call mode <span>${queueSize} to call, hottest first</span></button>` : ""}
    <div class="toolbar"><button class="ghost small" data-addref>🤝 Add a referral</button></div>
    <div class="chips">${Object.keys(groups).map((k) =>
      `<button class="chip ${state.leadFilter === k ? "on" : ""}" data-lf="${esc(k)}">${esc(label[k] || k)} (${leads.filter(groups[k]).length})</button>`).join("")}</div>
    ${(state.leadFilter || "active") === "active" ? `<p class="muted small">New leads, call-backs due today, and No answer leads you last tried ${RETRY_DAYS}+ days ago. Interested leads are in their own tab.</p>` : ""}
    <div class="list">${shown.length ? shown.map((l) => myLeadCard(l, now)).join("")
      : `<div class="empty">${!leads.length ? `No leads yet. <a href="#find">Find and claim some</a>.` : (state.leadFilter || "active") === "active" ? `Nothing left to call today 🎉 <a href="#find">Find new leads</a> to keep going.` : "No leads in this group."}</div>`}</div>`;
  body.querySelectorAll("[data-lf]").forEach((b) => b.addEventListener("click", () => { state.leadFilter = b.dataset.lf; drawMyLeads(); }));
  body.querySelector("[data-addref]")?.addEventListener("click", () => showReferralForm());
  body.querySelector("[data-callmode]")?.addEventListener("click", () => { state.callMode = true; state.callDone = new Set(); setPresencePage("callmode"); window.scrollTo(0, 0); drawMyLeads(); });
  body.querySelectorAll("article[data-id]").forEach(wireLeadCard);
}

function toLocalInput(ts) {
  const d = toDate(ts);
  if (!d) return "";
  const p = new Date(d.getTime() + 8 * 3600 * 1000); // Perth is UTC+8 all year
  return p.toISOString().slice(0, 16);
}
function fromLocalInput(v) { return v ? D.Timestamp.fromDate(new Date(v + ":00+08:00")) : null; }

const packages = () => (Array.isArray(state.packages) && state.packages.length ? state.packages : DEFAULT_PACKAGES);

function packagePicker(l) {
  const list = packages();
  return `<div class="pkg-pick" role="radiogroup" aria-label="Package">
    ${list.map((p, i) => `<button type="button" class="pkg ${i === 0 ? "on" : ""}" data-pkg="${i}" role="radio" aria-checked="${i === 0}">
      <span class="pkg-top"><b>${esc(p.name)}</b><span class="pkg-price">${esc(money(p.price))}</span></span>
      <ul>${(p.items || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></button>`).join("")}
    <button type="button" class="pkg custom" data-pkg="custom" role="radio" aria-checked="false"><span class="pkg-top"><b>Custom</b><span class="pkg-price">Any $</span></span><ul><li>Type the amount below</li></ul></button>
  </div>`;
}

function payHtml(l) {
  const cur = PAY_STEPS.findIndex(([k]) => k === payOf(l));
  return `<div class="pay pay-${esc(payOf(l))}">
    <span class="pay-label">💳 Payment</span>
    <div class="pay-steps">${PAY_STEPS.map(([k, label], i) => `<button class="pay-step ${i <= cur ? "done" : ""} ${i === cur ? "cur" : ""}" data-pay="${k}" ${isAdmin() ? "" : "disabled"}>${i <= cur && i > 0 ? "✓ " : ""}${esc(label)}</button>`).join('<span class="pay-arrow" aria-hidden="true">→</span>')}</div>
    <p class="small muted">${isAdmin() ? "Tap to update when the client pays." : "Aman updates this when the client pays. Your commission counts once it's paid in full."}</p>
  </div>`;
}

function scoreChip(l) {
  const sc = leadScore(l);
  return sc ? `<span class="score ${isHot(sc) ? "hot" : ""}" title="Lead score: busy, well-reviewed businesses with no website score highest">${isHot(sc) ? "🔥 " : ""}${sc}</span>` : "";
}

// Call mode: one lead at a time, next one comes up as soon as you log the call
// "To call today": new leads, call-backs due today (or overdue), and No answer leads last tried 3+ days ago.
// Interested leads live in their own tab and Home's follow-ups; future call-backs show up on the day.
const RETRY_DAYS = 3;
function needsCallToday(l, now = new Date()) {
  const today = perthDay();
  if (l.status === "New") return true;
  if (l.status === "Call back") {
    const at = toDate(l.callbackAt);
    return !at || at < new Date(`${addDays(today, 1)}T00:00:00+08:00`);
  }
  if (l.status === "No answer") {
    const last = toDate(l.lastCalledAt);
    return !last || perthDay(last) <= addDays(today, -RETRY_DAYS);
  }
  return false;
}
function callQueue(leads) {
  const now = new Date();
  const done = state.callDone || new Set();
  const due = (l) => l.status === "Call back" && (!toDate(l.callbackAt) || toDate(l.callbackAt) <= now);
  const rank = (l) => (due(l) ? 0 : l.status === "New" ? 1 : 2);
  return leads.filter((l) => !done.has(l.id) && l.phone && needsCallToday(l, now) && (l.status !== "Call back" || due(l)))
    .sort((a, b) => rank(a) - rank(b) || leadScore(b) - leadScore(a));
}

function myLeadCard(l, now) {
  const due = l.status === "Call back" && toDate(l.callbackAt);
  return `
    <article class="lead mylead ${due && due < now ? "overdue" : ""}" data-id="${esc(l.id)}">
      <div class="lead-main">
        <h3>${esc(l.name)} ${scoreChip(l)} ${l.oldSite ? `<span class="old-badge old-${l.oldSite.score >= 50 ? "very" : "some"}">🕰️ Redesign</span>` : `<span class="badge ${esc(l.websiteKind)}">${KIND_LABEL[l.websiteKind] || ""}</span>`} ${l.referredBy ? `<span class="ref-badge">🤝 Referred by ${esc(l.referredBy.name)}</span>` : ""} <span class="status s-${esc(l.status.replace(/\s/g, ""))}">${esc(l.status)}</span></h3>
        <p class="muted">${esc(l.category)}${l.address ? " · " + esc(l.address) : ""} · ${esc(l.suburb)}${l.lastCalledAt ? " · last called " + esc(fmtDateTime(l.lastCalledAt)) : ""}</p>
        ${due ? `<p class="due-line">Call back ${esc(fmtDateTime(l.callbackAt))}</p>` : ""}
        <p class="row">${phoneHtml(l.phone)} <button class="linkbtn" data-texts>💬 Texts</button> ${leadLinks(l)}</p>
        ${l.oldSite?.reasons?.length ? `<div class="old-reasons">${l.oldSite.reasons.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : siteHint(l)}
        ${D.hadWon(l) ? payHtml(l) : ""}
        <div class="log">
          <label for="n-${esc(l.id)}">Notes</label>
          <textarea id="n-${esc(l.id)}" rows="2" maxlength="2000" placeholder="Who you spoke to, what they said…">${esc(l.notes)}</textarea>
          <div class="cb ${l.status === "Call back" ? "" : "hidden"}"><label for="c-${esc(l.id)}">Call back at (Perth time)</label>
            <input type="datetime-local" id="c-${esc(l.id)}" value="${esc(toLocalInput(l.callbackAt))}"></div>
          <div class="deal hidden"><p class="small muted pkg-label">Which package did they buy?</p>${packagePicker(l)}
            <label for="v-${esc(l.id)}">Deal amount (what they're paying you)</label>
            <div class="inline"><span class="cur">$</span><input type="number" inputmode="decimal" min="0" max="100000" step="1" id="v-${esc(l.id)}" value="${esc(String(packages()[0]?.price ?? 500))}"></div>
            <p class="small muted">Commission: <b data-comm>$100</b></p></div>
          <p class="small muted">Log this call as:</p>
          <div class="outcomes">${D.CALL_STATUSES.map((s) => `<button class="out o-${s.replace(/\s/g, "")}" data-status="${esc(s)}">${esc(s)}</button>`).join("")}</div>
          <button class="linkbtn" data-save>Save notes only</button>
          ${followUpHtml(l)}
        </div>
        ${scriptHtml(l)}
      </div>
    </article>`;
}

function scriptHtml(l) {
  const sc = scriptFor(l, state.me);
  return `<details class="script"><summary>📜 Call script &amp; objections</summary>
    <ol class="script-steps">
      <li><b>Open</b><p>${esc(sc.opener)}</p></li>
      <li><b>Hook</b><p>${esc(sc.hook)}</p></li>
      <li><b>Offer</b><p>${esc(sc.offer)}</p></li>
      <li><b>Close</b><p>${esc(sc.close)}</p></li>
      <li class="upsell-step"><b>Bundle (if they're keen)</b><p>${esc(NFC.bundle)}</p></li>
    </ol>
    <h3 class="obj-h">If they say…</h3>
    <dl class="objections">${[...OBJECTIONS, NFC.objection].map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join("")}</dl>
  </details>`;
}

async function showTexts(lead) {
  const phone = cleanPhone(lead.phone || "");
  const texts = textsFor(lead, state.me, state.brand);
  await showModal(`<h2>Text ${esc(lead.name)}</h2>
    <p class="muted small">Every text is signed ${esc(BRAND.name)}, so they know who you are.</p>
    <div class="texts">${texts.map((t, i) => `<div class="text-tpl"><b>${esc(t.label)}</b><p>${esc(t.text).replace(/\n/g, "<br>")}</p>
      <div class="toolbar">${phone.valid ? `<a class="primary small" href="sms:${esc(phone.tel.replace(/^tel:/, ""))}?&body=${encodeURIComponent(t.text)}">Send</a>` : ""}<button class="ghost small" data-copy-text="${i}">Copy</button></div></div>`).join("")}</div>`);
  document.querySelectorAll("[data-copy-text]").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(texts[Number(b.dataset.copyText)].text); toast("Text copied"); }
    catch { toast("Couldn't copy", "bad"); }
  }));
}

// Automatic follow-up emails: the worker adds the business's email; the server sends 4 emails over 10 days
const FU_STEPS = 4;
const FU_ENDED = { replied: "they replied by email (check Aman's inbox)", unsubscribed: "they unsubscribed", done: "all 4 emails sent",
  status: "the lead moved on from Interested", bounced: "the email address didn't work" };
function followUpHtml(l) {
  const f = l.followUp;
  let line = "";
  if (f?.on) line = `<p class="fu-line on">📧 Auto follow-ups on · ${f.step || 0} of ${FU_STEPS} sent <button class="linkbtn" data-fu-stop>Stop</button></p>`;
  else if (f?.reason) line = `<p class="fu-line">📧 Follow-ups finished: ${esc(FU_ENDED[f.reason] || f.reason)}</p>`;
  else if (l.status === "Interested") line = `<p class="fu-line">${l.email ? `<button class="ghost small" data-fu-start>📧 Start auto follow-ups</button>` : "Add their email and they'll get friendly follow-up emails automatically until they reply."}</p>`;
  return `<div class="fu">
    <label for="e-${esc(l.id)}">Their email <span class="muted small">(for automatic follow-ups)</span></label>
    <div class="inline"><input type="email" id="e-${esc(l.id)}" data-email maxlength="120" placeholder="owner@business.com.au" value="${esc(l.email || "")}">
      <button class="ghost small" data-email-save>Save</button></div>
    ${line}
  </div>`;
}
const okEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

function wireLeadCard(card) {
  const lead = state.myLeads.find((l) => l.id === card.dataset.id);
  const emailIn = card.querySelector("[data-email]");
  card.querySelector("[data-email-save]")?.addEventListener("click", async (e) => {
    const v = emailIn.value.trim();
    if (v && !okEmail(v)) return toast("That email doesn't look right", "bad");
    await busy(e.currentTarget, "Saving", async () => {
      try { await D.saveLeadEmail(lead.id, v); lead.email = v; toast("Email saved"); } catch (err) { toast(D.authMessage(err), "bad"); }
    });
    drawMyLeads();
  });
  card.querySelector("[data-fu-start]")?.addEventListener("click", async (e) => {
    const v = emailIn.value.trim() || lead.email;
    if (!okEmail(v || "")) return toast("Add their email first", "bad");
    await busy(e.currentTarget, "Starting", async () => {
      try { await D.startFollowUp(state.me, lead.id, v); toast(`Follow-ups started. ${lead.name} gets the first email within 2 hours.`); } catch (err) { toast(D.authMessage(err), "bad"); }
    });
    drawMyLeads();
  });
  card.querySelector("[data-fu-stop]")?.addEventListener("click", async (e) => {
    await busy(e.currentTarget, "Stopping", async () => {
      try { await D.stopFollowUp(lead.id); toast("Follow-ups stopped"); } catch (err) { toast(D.authMessage(err), "bad"); }
    });
    drawMyLeads();
  });
  card.querySelector("[data-texts]")?.addEventListener("click", () => showTexts(lead));
  card.querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", async () => {
    if (!isAdmin() || b.dataset.pay === payOf(lead)) return;
    try { await D.setPayment(state.me, lead, b.dataset.pay); toast(`${lead.name}: ${payLabel(b.dataset.pay)}`); if (b.dataset.pay === "paid") confetti(); }
    catch (err) { toast(D.authMessage(err), "bad"); }
  }));
  const notes = card.querySelector("textarea");
  const cbBox = card.querySelector(".cb");
  const cbInput = card.querySelector('input[type="datetime-local"]');
  const dealBox = card.querySelector(".deal");
  const dealInput = card.querySelector('input[type="number"]');
  const commEl = card.querySelector("[data-comm]");
  dealInput.addEventListener("input", () => { commEl.textContent = money(commissionFor(dealInput.value)); });
  let pkgName = packages()[0]?.name || "";
  card.querySelectorAll("[data-pkg]").forEach((b) => b.addEventListener("click", () => {
    card.querySelectorAll("[data-pkg]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", String(x === b)); });
    if (b.dataset.pkg === "custom") { pkgName = ""; dealInput.focus(); dealInput.select(); return; }
    const p = packages()[Number(b.dataset.pkg)];
    pkgName = p.name;
    dealInput.value = p.price;
    commEl.textContent = money(commissionFor(p.price));
  }));
  card.querySelectorAll("[data-status]").forEach((btn) => btn.addEventListener("click", async () => {
    const status = btn.dataset.status;
    if (status === "Call back" && !cbInput.value) {
      cbBox.classList.remove("hidden");
      cbInput.focus();
      toast("Pick a call-back time, then tap Call back again.");
      return;
    }
    if (status === "Won" && D.hadWon(lead)) return toast("This deal is already counted as won. Ask Aman if the amount needs fixing.", "bad");
    if (status === "Won" && dealBox.classList.contains("hidden")) {
      dealBox.classList.remove("hidden");
      dealInput.focus();
      dealInput.select();
      toast("Pick the package (or type the amount), then tap Won again.");
      return;
    }
    if (status === "Won" && !(Number(dealInput.value) > 0)) return toast("Enter what they're paying (more than $0).", "bad");
    await busy(btn, "Saving", async () => {
      try {
        const value = status === "Won" ? Number(dealInput.value) : 0;
        const got = await D.logCall(state.me, lead, status, notes.value, status === "Call back" ? fromLocalInput(cbInput.value) : null, value, status === "Won" ? pkgName : "");
        if (state.callMode) state.callDone?.add(lead.id);
        document.activeElement?.blur();
        const why = !got.points ? (status === "Interested" ? " (already counted: Interested points only count once per lead)" : " (already counted today: each lead counts once a day)") : "";
        toast(got.bonusW ? `WON ${money(got.value)}. You'll earn ${money(commissionFor(got.value))} once they pay.` : `Logged: ${status} (+${got.points} pt${got.points === 1 ? "" : "s"})${why}`);
        if (got.bonusW || got.bonusI) confetti();
        if (got.bonusW) showAfterWon(lead, got.value);
        // Interested + an email → follow-up emails start by themselves
        const em = emailIn?.value.trim() || "";
        if (status === "Interested" && !lead.followUp?.on && okEmail(em)) {
          try { await D.startFollowUp(state.me, lead.id, em); toast(`Logged: Interested. Follow-up emails to ${em} start within 2 hours.`); }
          catch (err) { console.error(err); }
        }
        checkBadges();
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

async function showAfterWon(lead, value) {
  await showModal(`<div class="won-head"><span>💰</span><h2>${esc(lead.name)} is in. ${money(value)}.</h2>
      <p class="won-brand">Another ${esc(BRAND.name)} client. Send them the thank-you text from their lead card.</p>
      <p class="muted">You'll earn <b>${money(commissionFor(value))}</b> once they pay in full. Before you hang up, squeeze more out of it:</p></div>
    <div class="after-won">
      <div><b>1. Care plan (monthly money)</b><p>${esc(AFTER_WON.upsell)}</p>
        <form class="care-quick" id="careQuick">${carePresets("careAmt")}<span class="cur">$</span><input type="number" id="careAmt" min="1" max="10000" step="1" value="${CARE_DEFAULT}" aria-label="Monthly amount"><span class="muted small">/month</span>
          <button type="submit" class="primary small">They said yes: add care plan</button></form></div>
      <div class="upsell-step"><b>2. Tap-to-review cards (${esc(NFC.price)})</b><p>${esc(NFC.pitch)}</p>
        ${isAdmin() ? `<a class="ghost small" href="#reviews/${encodeURIComponent([lead.name, lead.suburb].filter(Boolean).join(" "))}" data-close>Make their review card link →</a>` : ""}</div>
      <div><b>3. Referral (free leads)</b><p>${esc(AFTER_WON.referral)}</p>
        <button type="button" class="ghost small" data-ref-from>🤝 They gave me one: add it</button></div>
      <div><b>4. Review (more trust)</b><p>${esc(AFTER_WON.review)}</p></div>
    </div>`);
  wireCarePresets(document);
  $("[data-ref-from]")?.addEventListener("click", () => {
    document.querySelector(".modal-wrap .wide-btn")?.click();
    setTimeout(() => showReferralForm({ leadId: lead.id, name: lead.name }), 350);
  });
  const form = $("#careQuick");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const monthly = Number($("#careAmt").value);
    if (!(monthly > 0)) return toast("Enter the monthly amount", "bad");
    await busy(e.submitter || form.querySelector("button[type=submit]"), "Saving", async () => {
      try {
        await D.addCarePlan(state.me, { client: String(lead.name).slice(0, 120), leadId: lead.id, monthly, startDay: perthDay() });
        form.outerHTML = `<p class="care-done">✓ Care plan added: ${esc(money(monthly))}/month. That's ${esc(money(monthly * 12))} a year.</p>`;
        confetti();
      } catch (err) { toast(D.authMessage(err), "bad"); }
    });
  });
}

// =====================================================================
// Leaderboard
// =====================================================================
// ---------- team goal ladder (shown on Home and the Leaderboard) ----------
async function drawLadder(rid) {
  try {
    const levels = await D.getLadder();
    const box = $("#ladderBox");
    if (!box || rid !== state.routeId) return;
    if (!levels?.length) {
      box.innerHTML = isAdmin() ? `<a class="card ladder-setup" href="#team">🪜 <span><b>Set up a team goal ladder</b><small>Shared monthly targets that unlock prizes for everyone. Admin → Team</small></span></a>` : "";
      return;
    }
    const today = perthDay();
    const month = today.slice(0, 7);
    const totals = teamTotals(await D.getStatsSince(`${month}-01`));
    if (!$("#ladderBox") || rid !== state.routeId) return;
    const prog = ladderProgress(levels, totals);
    const unlocked = prog.filter((l) => l.unlocked).length;
    const monthName = new Date(`${month}-15T12:00:00+08:00`).toLocaleString("en-AU", { month: "long", timeZone: "Australia/Perth" });
    const next = prog.find((l) => l.current);
    const [y, mo] = month.split("-").map(Number);
    const daysLeft = new Date(Date.UTC(y, mo, 0)).getUTCDate() - Number(today.slice(8, 10)) + 1;
    const M = (l) => LADDER_METRICS[l.metric];
    const gapText = (l) => { const gap = Math.max(0, l.target - l.value);
      return l.metric === "revenue" ? `${M(l).fmt(gap)} more in sales to unlock` : `${gap} more ${M(l).label} to unlock`; };
    const paceText = (l) => {
      const gap = Math.max(0, l.target - l.value);
      if (!gap) return "";
      const perDay = gap / Math.max(1, daysLeft);
      if (l.metric === "calls") return `about ${Math.ceil(perDay)} team calls a day gets it`;
      if (daysLeft <= 7) return `needed in the next ${daysLeft} day${daysLeft === 1 ? "" : "s"}, let's go`;
      if (l.metric === "revenue") return `about ${M(l).fmt(Math.ceil(perDay * 7))} a week gets it`;
      const perWeek = gap / Math.max(1, daysLeft / 7);
      return perWeek <= 1 ? `about 1 a week gets it` : `about ${Math.ceil(perWeek)} a week gets it`;
    };
    $("#ladderBox").innerHTML = `<section class="card ladder">
      <div class="ladder-head"><h2>🪜 Team goal · ${esc(monthName)}</h2><span class="muted small">${daysLeft} day${daysLeft === 1 ? "" : "s"} left</span></div>
      ${next ? `<div class="ladder-next">
          <span class="ladder-kicker">Next prize · level ${next.n} of ${prog.length}</span>
          <b class="ladder-prize">🎁 ${esc(next.prize)}</b>
          <div class="bar"><span style="width:${next.pct}%"></span></div>
          <div class="ladder-nums"><b>${esc(gapText(next))}</b><span>${M(next).fmt(next.value)} / ${M(next).fmt(next.target)}</span></div>
          ${paceText(next) ? `<span class="muted small">${esc(paceText(next))}</span>` : ""}
        </div>`
      : `<div class="ladder-next all"><b class="ladder-prize">🏆 Every level unlocked!</b><span class="muted small">Huge month. Enjoy the prizes.</span></div>`}
      <ol class="steps-track">${prog.map((l) => `<li class="${l.unlocked ? "done" : l.current ? "now" : "locked"}">
        <span class="dot">${l.unlocked ? "✓" : l.n}</span><small>${esc(l.prize)}</small></li>`).join("")}</ol>
      <div class="ladder-foot"><span class="muted small">Hit it as a team, everyone gets the prize.</span><button class="linkbtn" id="ladderIdea">💡 Suggest a prize</button></div>
    </section>`;
    $("#ladderIdea").addEventListener("click", () => { sessionStorage.setItem("arm_chat_draft", "Prize idea for the team ladder: "); location.hash = "#chat"; });
    // celebrate a level the first time this person sees it unlocked
    const key = `arm_ladder_${state.me.id}_${month}`;
    let seen = 0; try { seen = Number(localStorage.getItem(key) || 0); } catch {}
    if (unlocked > seen) {
      try { localStorage.setItem(key, String(unlocked)); } catch {}
      const got = prog.filter((l) => l.unlocked && l.n > seen);
      if (seen > 0 || got.length) { confetti(); showModal(`<div class="won-head"><span>🪜</span><h2>Level ${got[got.length - 1].n} unlocked!</h2>
        <p>${got.map((l) => `<b>${esc(l.prize)}</b>`).join("<br>")}</p><p class="muted">The whole team did this. Next level's waiting.</p></div>`); }
    }
  } catch (e) { console.warn("ladder", e); }
}

function screenBoard() {
  setTitle("Leaderboard");
  const today = perthDay();
  const week = weekStart(today);
  let tab = sessionStorage.getItem("arm_board") || "today";
  view().innerHTML = `
    <h1 class="page">Leaderboard</h1>
    <div id="ladderBox"></div>
    <div class="chips"><button class="chip" data-b="today">Today</button><button class="chip" data-b="week">This week</button></div>
    <div id="boardBody"><div class="loading"><span class="spinner"></span></div></div>
    <p class="muted small">Points: each lead you call 1 (once a day) · Interested +3 · Won +10 (once per lead). Weeks start Monday (Perth time).</p>`;
  drawLadder(state.routeId);
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
      <thead><tr><th>#</th><th>Name</th><th class="n">Calls</th><th class="n">Interested</th><th class="n">Won</th><th class="n">Sales</th><th class="n">Points</th></tr></thead>
      <tbody>${board.map((r, i) => `
        <tr class="${r.uid === state.me.id ? "me" : ""} ${i < 3 ? "top" + (i + 1) : ""}">
          <td>${MEDALS[i] || i + 1}</td><td>${esc(r.name)}${r.uid === state.me.id ? ' <em class="you">You</em>' : ""}</td>
          <td class="n">${r.calls}</td><td class="n">${r.interested}</td><td class="n">${r.won}</td><td class="n">${money(r.revenue)}</td><td class="n"><b>${r.points}</b></td>
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
    <a class="card start-card" href="#start"><span aria-hidden="true">📘</span><div><b>How the app works</b><small>Finding businesses, calling, and how you get paid</small></div><span aria-hidden="true">›</span></a>
    <section class="card"><h2>Install the app</h2>${installHtml()}</section>
    <form class="card" id="pwForm">
      <h2>Change password</h2>
      <label for="pwOld">Current password</label><input id="pwOld" type="password" autocomplete="current-password" required>
      <label for="pwNew">New password (at least 6 characters)</label><input id="pwNew" type="password" autocomplete="new-password" minlength="6" required>
      <button class="primary" type="submit">Change password</button>
    </form>`;
  $("#signOut").addEventListener("click", D.logOut);
  document.querySelector("[data-install]")?.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
  });
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
    ${[["admin", "Overview"], ["report", "Weekly report"], ["pool", "Leads"], ["care", "Care plans"], ["referrals", "Referrals"], ["packages", "Packages"], ["team", "Team"], ["brand", "Brand kit"]].map(([id, l]) => `<a href="#${id}" class="${active === id ? "on" : ""}">${l}</a>`).join("")}
  </div>`;
}

// Admin: money on the table + best hours to call
async function drawMoney(today, rid) {
  try {
    const [interested, calls, plans, wonCalls] = await Promise.all([D.getLeadsWithStatus("Interested"), D.getCallsSince(addDays(today, -30)), D.getCarePlans().catch(() => []), D.getWonCalls().catch(() => [])]);
    const wonLeads = await D.getLeadsByIds(wonCalls.map((c) => c.leadId)).catch(() => []);
    const payMap = new Map(wonLeads.map((l) => [l.id, payOf(l)]));
    const unpaid = wonCalls.filter((c) => payMap.get(c.leadId) !== "paid").map((c) => ({ ...c, pay: payMap.get(c.leadId) || "unpaid" }));
    const owedToYou = unpaid.reduce((n, c) => n + c.value, 0);
    const care = careStats(plans, today);
    if (rid !== state.routeId || !$("#moneyBox")) return;
    const wonVals = calls.filter((c) => c.status === "Won" && c.value > 0).map((c) => c.value);
    const avg = wonVals.length ? wonVals.reduce((a, b) => a + b, 0) / wonVals.length : 500;
    const answered = calls.filter((c) => c.status !== "No answer");
    const closeRate = answered.length ? calls.filter((c) => c.status === "Won").length / answered.length : 0;
    const { rows, best } = bestHours(calls, toDate);
    const work = rows.filter((r) => r.hour >= 7 && r.hour <= 20);
    const max = Math.max(1, ...work.map((r) => r.rate));
    const stale = interested.filter((l) => (toDate(l.lastCalledAt)?.getTime() ?? 0) < Date.now() - 3 * 864e5);
    $("#moneyBox").innerHTML = `<section class="money-grid">
      <div class="card pipeline">
        <span class="muted">Money on the table</span>
        <b class="num">${money(interested.length * avg)}</b>
        <small class="muted">${interested.length} interested lead${interested.length === 1 ? "" : "s"} × ${money(avg)} average deal${wonVals.length ? "" : " (default until you close some)"}</small>
        ${stale.length ? `<p class="warn-line">⚠️ ${stale.length} going cold: no contact for 3+ days. ${stale.slice(0, 3).map((l) => `<b>${esc(l.name)}</b> (${esc(l.assignedName || "unassigned")})`).join(", ")}${stale.length > 3 ? "…" : ""}</p>` : ""}
        <small class="muted">Close rate (last 30 days): <b>${pct(closeRate)}</b> of answered calls</small>
      </div>
      <div class="card unpaid-card">
        <span class="muted">Waiting to be paid</span>
        <b class="num">${money(owedToYou)}</b>
        <small class="muted">${unpaid.length} won deal${unpaid.length === 1 ? "" : "s"} not paid in full yet</small>
        ${unpaid.length ? `<ul class="plain unpaid-list">${unpaid.slice(0, 5).map((c) => `<li><a href="#worker/${esc(c.uid)}">${esc(c.leadName)}</a><span>${esc(money(c.value))}</span><span class="pay-tag pay-${esc(c.pay)}">${esc(payLabel(c.pay))}</span></li>`).join("")}</ul>` : ""}
      </div>
      <a class="card care-card" href="#care">
        <span class="muted">Care plans: monthly income</span>
        <b class="num">${money(care.mrr)}<small>/mo</small></b>
        <small class="muted">${care.active} active client${care.active === 1 ? "" : "s"} · ${money(care.arr)} a year${care.dueSoon.length ? ` · <b class="due-tag">${care.dueSoon.length} payment${care.dueSoon.length === 1 ? "" : "s"} due this week</b>` : ""}</small>
      </a>
      <div class="card hours">
        <span class="muted">Best time to call</span>
        <b class="num">${best ? hourLabel(best.hour) : "—"}</b>
        <small class="muted">${best ? `${pct(best.rate)} of calls get answered at ${hourLabel(best.hour)} (last 30 days)` : "Shows up once your team has logged more calls"}</small>
        ${work.length ? `<div class="hour-bars">${work.map((r) => `<div class="hb ${best && r.hour === best.hour ? "best" : ""}" title="${hourLabel(r.hour)}: ${r.answered}/${r.calls} answered">
          <span style="height:${Math.max(6, Math.round((r.rate / max) * 100))}%"></span><small>${hourLabel(r.hour).replace(/(am|pm)/, "")}</small></div>`).join("")}</div>` : ""}
      </div>
    </section>`;
  } catch (e) { console.warn("money box", e); }
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
    ${new Date(`${today}T12:00:00+08:00`).getUTCDay() === 1 ? `<div class="notice info">📊 Last week's report is ready. <a href="#report">View it</a></div>` : ""}
    <div id="enqBox"></div>
    <div id="briefBox"></div>
    <section class="card live-card"><h2>Who's on right now</h2><div id="liveNow"><div class="loading"><span class="spinner"></span></div></div></section>
    <div id="kpis"></div>
    <div id="moneyBox"></div>
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

  drawMoney(today, rid);
  const drawEnquiries = () => D.getEnquiries().then((list) => {
    const box = $("#enqBox");
    if (!box || rid !== state.routeId) return;
    if (!list.length) { box.innerHTML = ""; return; }
    const workers = users.filter((u) => u.active);
    box.innerHTML = `<section class="card enq-card"><h2>🌐 Website enquiries <span class="enq-count">${list.length} new</span></h2>
      ${list.map((q) => `<article class="enq" data-enq="${esc(q.id)}">
        <div class="enq-head"><b>${esc(q.business || q.name)}</b><span class="muted small">${esc(fmtDateTime(q.createdAt))}</span></div>
        <p class="muted small">${esc(q.name)}${q.suburb ? ` · ${esc(q.suburb)}` : ""}${q.package ? ` · wants <b>${esc(q.package)}</b>` : ""}</p>
        <p class="row">${q.phone ? phoneHtml(q.phone) : ""} ${q.email ? `<a href="mailto:${esc(q.email)}">${esc(q.email)}</a>` : ""}</p>
        ${q.message ? `<p class="enq-msg">${esc(q.message)}</p>` : ""}
        ${/^NFC order PAID/i.test(q.package || "") ? `<div class="toolbar"><span class="pay-tag pay-paid">💳 Paid NFC order</span><button class="primary small" data-enq-posted>Mark as posted</button></div>`
          : `<div class="toolbar"><select data-enq-to aria-label="Give to"><option value="">Add to the leads pool</option>${workers.map((u) => `<option value="${esc(u.id)}">Give to ${esc(u.name)}</option>`).join("")}</select>
          <button class="primary small" data-enq-add>Add</button><button class="linkbtn" data-enq-skip>Dismiss</button></div>`}
      </article>`).join("")}</section>`;
    box.querySelectorAll("[data-enq]").forEach((el) => {
      const q = list.find((x) => x.id === el.dataset.enq);
      el.querySelector("[data-enq-posted]")?.addEventListener("click", async (e) => {
        await busy(e.currentTarget, "Saving", async () => {
          try { await D.setEnquiryStatus(q.id, "posted"); toast(`${q.business || q.name}: marked as posted`); drawEnquiries(); } catch (err) { toast(D.authMessage(err), "bad"); }
        });
      });
      el.querySelector("[data-enq-add]")?.addEventListener("click", async (e) => {
        const to = workers.find((u) => u.id === el.querySelector("[data-enq-to]").value) || null;
        await busy(e.currentTarget, "Adding", async () => {
          try { await D.enquiryToLead(state.me, q, to); toast(`${q.business || q.name} added${to ? ` for ${to.name}` : " to the pool"}`); drawEnquiries(); }
          catch (err) { toast(D.authMessage(err), "bad"); }
        });
      });
      el.querySelector("[data-enq-skip]")?.addEventListener("click", async () => {
        try { await D.setEnquiryStatus(q.id, "dismissed"); drawEnquiries(); } catch (err) { toast(D.authMessage(err), "bad"); }
      });
    });
  }).catch(() => {});
  drawEnquiries();
  D.getLatestBrief().then((b) => {
    const box = $("#briefBox");
    if (!box || rid !== state.routeId) return;
    if (!b) { box.innerHTML = `<section class="card brief-card"><h2>☀️ Morning brief</h2><p class="muted small">Your first brief arrives tomorrow at 7:30am. Set up the phone call in <a href="#team">Team → Morning brief</a>.</p></section>`; return; }
    box.innerHTML = `<section class="card brief-card"><div class="brief-head"><h2>☀️ Morning brief <span class="muted small">${esc(prettyDay(b.day))}</span></h2>
        <button class="primary small" id="briefPlay">▶ Listen</button></div>
      <pre class="brief-text">${esc(b.text || "")}</pre>
      ${b.results?.length ? `<p class="muted small">Sent: ${esc(b.results.join(" · "))}</p>` : ""}</section>`;
    $("#briefPlay").addEventListener("click", (e) => {
      const synth = window.speechSynthesis;
      if (!synth) return toast("Your browser can't read text out loud", "bad");
      if (synth.speaking) { synth.cancel(); e.target.textContent = "▶ Listen"; return; }
      const u = new SpeechSynthesisUtterance(b.say || b.text);
      u.lang = "en-AU"; u.rate = 1;
      u.onend = () => { e.target.textContent = "▶ Listen"; };
      synth.speak(u); e.target.textContent = "■ Stop";
    });
  }).catch(() => {});
  let presence = new Map();
  const drawLive = () => {
    const box = $("#liveNow");
    if (!box) return;
    const rows = users.filter((u) => u.active && u.id !== state.me.id).map((u) => ({ u, st: presenceStatus(presence.get(u.id)) }))
      .sort((a, b) => ["live", "away", "off"].indexOf(a.st.key) - ["live", "away", "off"].indexOf(b.st.key) || a.st.ago - b.st.ago);
    const live = rows.filter((r) => r.st.key === "live").length;
    box.innerHTML = `<p class="muted small">${live ? `<b class="live-count">${live} live now</b>` : "Nobody's in the app right now"} · updates every minute</p>
      <ul class="live-list">${rows.map(({ u, st }) => `<li class="${st.key}">${presenceDot(st)}<a href="#worker/${esc(u.id)}"><b>${esc(u.name)}</b></a><span>${esc(st.label)}</span></li>`).join("")}</ul>`;
  };
  const paintStatus = () => document.querySelectorAll("[data-status-uid]").forEach((td) => {
    const st = presenceStatus(presence.get(td.dataset.statusUid));
    td.innerHTML = `${presenceDot(st)}<span class="${st.key === "live" ? "" : "muted"}">${esc(st.label)}</span>`;
  });
  state.unsub.push(D.watchPresence((m) => { presence = m; drawLive(); paintStatus(); }, (e) => { const box = $("#liveNow"); if (box) box.innerHTML = errorBox(D.authMessage(e)); }));
  const liveTick = setInterval(() => { if (!$("#liveNow")) return clearInterval(liveTick); drawLive(); paintStatus(); }, 30000);
  state.unsub.push(() => clearInterval(liveTick));
  let todayEvents = [];
  let googleToday = 0;
  let monthRevenue = 0;
  D.getStatsSince(today.slice(0, 8) + "01").then((rows) => { monthRevenue = rows.reduce((n, r) => n + (r.revenue || 0), 0); drawKpis(); }).catch(() => {});
  state.unsub.push(D.watchSearchesForDay(today, (rows) => { googleToday = rows.reduce((n, r) => n + (r.googleRequests || 0), 0); drawKpis(); }, () => {}));
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
      ${tile("Sales this week", money(weekRows.reduce((n, r) => n + (r.revenue || 0), 0)), `${money(monthRevenue)} this month`)}
      ${tile("Searches today", evCount(todayEvents, "search"), `${googleToday} Google requests used`)}
      ${tile("Leads claimed", evCount(todayEvents, "claim"), "today")}
    </section>`;
    const tBoard = D.leaderboard(todayRows), wBoard = D.leaderboard(weekRows);
    $("#workerTable").innerHTML = `<div class="tablewrap"><table class="board">
      <thead><tr><th>Name</th><th class="n">Today calls</th><th class="n">Today pts</th><th class="n">Week calls</th><th class="n">Interested</th><th class="n">Won</th><th class="n">Week pts</th><th>Status</th></tr></thead>
      <tbody>${users.filter((u) => u.active).map((u) => {
        const t = tBoard.find((r) => r.uid === u.id) || {}; const w = wBoard.find((r) => r.uid === u.id) || {};
        return `<tr><td><a href="#worker/${esc(u.id)}">${esc(u.name)}</a>${u.role === "admin" ? ' <em class="role">Admin</em>' : ""}</td>
          <td class="n">${t.calls || 0}</td><td class="n">${t.points || 0}</td><td class="n">${w.calls || 0}</td><td class="n">${w.interested || 0}</td>
          <td class="n">${w.won || 0}</td><td class="n"><b>${w.points || 0}</b></td><td class="status-cell" data-status-uid="${esc(u.id)}"></td></tr>`;
      }).join("")}</tbody></table></div>`;
    paintStatus();
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
  let unToday = null; // keeps today's KPIs live while the feed shows another day
  state.unsub.push(() => unToday && unToday());
  watchFeed();
  $("#feedWorker").addEventListener("change", (e) => { feedWorker = e.target.value; drawFeed(); });
  $("#feedDay").addEventListener("change", (e) => {
    const v = e.target.value || today;
    feedDay = v;
    if (v !== today && !unToday) unToday = D.watchEventsForDay(today, (ev) => { todayEvents = ev; drawKpis(); });
    if (v === today && unToday) { unToday(); unToday = null; }
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
  const rid = state.routeId;
  const user = await D.getProfile(uid);
  if (rid !== state.routeId) return;
  if (!user) { view().innerHTML = adminNav("") + errorBox("That worker doesn't exist."); return; }
  setTitle(user.name);
  view().innerHTML = `${adminNav("")}<h1 class="page">${esc(user.name)}</h1><div id="wBody"><div class="loading"><span class="spinner"></span></div></div>`;
  const [stats, leads, calls, searches] = await Promise.all([D.getStatsFor(uid), D.getLeadsFor(uid), D.getCallsFor(uid), D.getSearchesFor(uid)]);
  const wonLeads = await D.getLeadsByIds(calls.filter((c) => c.status === "Won").map((c) => c.leadId)).catch(() => []);
  const leadById = new Map(wonLeads.map((l) => [l.id, l]));
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
    ${(() => {
      const deals = calls.filter((c) => c.status === "Won" && c.value != null);
      return `<section class="card"><h2>Deals won</h2>
      ${deals.length ? (() => { const sp = commissionSplit(deals, new Map(wonLeads.map((l) => [l.id, payOf(l)]))); return `<p class="muted small">Commission owed (paid deals): <b>${esc(money(sp.paid))}</b>${sp.pending ? ` · ${esc(money(sp.pending))} pending until clients pay` : ""}</p>`; })() : ""}
      ${deals.length ? `<div class="tablewrap"><table class="board"><thead><tr><th>When</th><th>Business</th><th class="n">Amount</th><th class="n">Commission</th><th>Payment</th><th></th></tr></thead><tbody>
        ${deals.map((c) => `<tr><td>${esc(fmtDateTime(c.createdAt))}</td><td>${esc(c.leadName)}${c.package ? ` <span class="pkg-tag">${esc(c.package)}</span>` : ""}</td><td class="n"><b>${esc(money(c.value))}</b>${c.editedAt ? ' <span class="muted small" title="Edited by admin">(edited)</span>' : ""}</td>
          <td class="n">${esc(money(commissionFor(c.value)))}</td>
          <td>${leadById.has(c.leadId) ? `<select class="pay-select pay-${esc(payOf(leadById.get(c.leadId)))}" data-pay-lead="${esc(c.leadId)}" aria-label="Payment">${PAY_STEPS.map(([k, label]) => `<option value="${k}" ${payOf(leadById.get(c.leadId)) === k ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>` : '<span class="muted">—</span>'}</td>
          <td><button class="linkbtn" data-edit-deal="${esc(c.id)}">Edit amount</button></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">No deals yet.</div>`}</section>`;
    })()}
    <section class="card"><h2>Recent calls</h2>
      ${calls.length ? `<div class="tablewrap"><table class="board"><thead><tr><th>When</th><th>Business</th><th>Result</th><th>Notes</th></tr></thead><tbody>
        ${calls.slice(0, 50).map((c) => `<tr><td>${esc(fmtDateTime(c.createdAt))}</td><td>${esc(c.leadName)}</td><td><span class="status s-${esc(c.status.replace(/\s/g, ""))}">${esc(c.status)}</span></td><td>${esc(c.notes)}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">No calls yet.</div>`}
    </section>
    <section class="card"><h2>Recent searches</h2>
      ${searches.length ? `<ul class="plain">${searches.slice(0, 30).map((s) => `<li>${esc(fmtDateTime(s.createdAt))} · ${esc(s.category)} in ${esc(s.suburb)} · ${esc(s.results)} results, ${esc(s.noWebsite)} with no website</li>`).join("")}</ul>` : `<div class="empty">No searches yet.</div>`}
    </section>`;
  view().querySelectorAll("[data-pay-lead]").forEach((sel) => sel.addEventListener("change", async () => {
    const lead = leadById.get(sel.dataset.payLead);
    try { await D.setPayment(state.me, lead, sel.value); toast(`${lead.name}: ${payLabel(sel.value)}`); screenWorker(uid); }
    catch (err) { toast(D.authMessage(err), "bad"); }
  }));
  view().querySelectorAll("[data-edit-deal]").forEach((b) => b.addEventListener("click", async () => {
    const call = calls.find((c) => c.id === b.dataset.editDeal);
    await showModal(`<h2>Edit deal amount</h2>
      <p class="muted">${esc(call.leadName)} · won by ${esc(call.userName || user.name)} on ${esc(fmtDateTime(call.createdAt))}</p>
      <form id="dealEdit" class="deal">
        <label for="dealAmt">What they're paying</label>
        <div class="inline"><span class="cur">$</span><input type="number" id="dealAmt" min="0" max="100000" step="1" value="${esc(String(call.value || 0))}" required></div>
        <p class="small muted">Commission: <b id="dealComm">${esc(money(commissionFor(call.value)))}</b>. Sales totals, the leaderboard and commission all update.</p>
        <button class="primary">Save amount</button>
      </form>`);
    const amt = $("#dealAmt");
    amt.addEventListener("input", () => { $("#dealComm").textContent = money(commissionFor(amt.value)); });
    $("#dealEdit").addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = Number(amt.value);
      if (!(v >= 0)) return toast("Enter an amount", "bad");
      await busy(e.submitter || $("#dealEdit button"), "Saving", async () => {
        try {
          const saved = await D.editDealValue(state.me, call, v);
          document.querySelector(".modal-wrap .wide-btn")?.click();
          toast(`Deal updated to ${money(saved)}`);
          screenWorker(uid);
        } catch (err) { toast(D.authMessage(err), "bad"); }
      });
    });
  }));
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
        <td>${l.phone ? phoneHtml(l.phone) : ""}</td>
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
    <form class="card" id="gForm" autocomplete="off">
      <h2>Backup Google Maps connection (optional)</h2>
      <p class="muted small">Searches use Google Maps through the free Google key built into the app. If Google's daily limit runs out, this backup keeps searches on Google Maps. ${state.googleToken ? "✅ Backup connected." : "Backup not connected."}
        Uses a free <a href="https://apify.com" target="_blank" rel="noopener">Apify</a> account (no card): about US$5 of searches free each month. When it runs out, searches fall back to OpenStreetMap until next month.</p>
      <label for="gToken">Apify API token (Apify → Settings → API &amp; Integrations)</label>
      <div class="inline wide"><input id="gToken" type="password" placeholder="${state.googleToken ? "Saved. Paste a new one to replace it" : "apify_api_..."}" spellcheck="false">
        <button class="primary" type="submit">Save</button></div>
    </form>
    <form class="card" id="ladderForm">
      <h2>🪜 Team goal ladder</h2>
      <p class="muted small">Shared targets for the whole team this month. Each level unlocks a prize everyone gets, once the level before it is hit. Resets on the 1st. Tip: ask the team in chat what prizes they'd want, people don't fight a plan they helped make.</p>
      <div id="ladderRows"></div>
      <div class="toolbar"><button type="button" class="ghost small" id="ladderAdd">+ Add level</button><button type="button" class="linkbtn" id="ladderClear">Turn the ladder off</button></div>
      <button type="submit" class="primary">Save ladder</button>
    </form>
    <section class="card"><h2>📘 New worker guide</h2><p class="muted small">New workers see a step-by-step <b>Start here</b> guide the first time they log in: how to find businesses, call, log results, and how they get paid. Just give them their login.</p>
      <a class="ghost wide-btn" href="#start">Preview the guide</a></section>
    <form class="card" id="briefForm">
      <h2>☀️ Morning brief (7:30am)</h2>
      <p class="muted small">Every morning at 7:30 you get yesterday's numbers, who called, money owed and what's due today. Pick any of these, all free.</p>
      <h3>🟢 WhatsApp message</h3>
      <ol class="steps small">
        <li>Open <a href="https://www.callmebot.com/blog/free-api-whatsapp-messages/" target="_blank" rel="noopener">CallMeBot's WhatsApp page</a>, save their number in your contacts and send them the message it shows.</li>
        <li>They reply with your <b>API key</b>. Paste it below with your mobile number.</li>
      </ol>
      <div class="inline wide"><input id="bWaPhone" inputmode="tel" maxlength="20" placeholder="0493 523 482" aria-label="WhatsApp number">
        <input id="bWaKey" maxlength="40" placeholder="API key (just the number)" spellcheck="false" aria-label="WhatsApp API key"></div>
      <h3>🔊 iPhone reads it out loud</h3>
      <div id="speakBox"></div>
      <h3>📧 Email</h3>
      <input id="bEmail" type="email" maxlength="120" placeholder="amanraju024@gmail.com" aria-label="Email to">
      <p class="muted small">Needs a one-time Gmail app password saved in GitHub as GMAIL_APP_PASSWORD.</p>
      <details class="small" id="tgBox"><summary>📞 Telegram call (optional)</summary>
        <ol class="steps small">
          <li>Install <b>Telegram</b> and set a <b>username</b> (Settings → Username).</li>
          <li>In Telegram, search <b>@CallMeBot_txtbot</b> and press <b>Start</b>. This lets it call and message you.</li>
        </ol>
        <input id="bUser" maxlength="40" placeholder="@yourname" aria-label="Telegram username">
      </details>
      <div class="brief-opts">
        <label class="check"><input type="checkbox" id="bWa" checked> 🟢 WhatsApp</label>
        <label class="check"><input type="checkbox" id="bMail" checked> 📧 Email</label>
        <label class="check"><input type="checkbox" id="bCall" checked> 📞 Telegram call</label>
        <label class="check"><input type="checkbox" id="bMsg" checked> 💬 Telegram message</label>
      </div>
      <h3>👥 Team progress emails</h3>
      <label class="check"><input type="checkbox" id="bTeam" checked> Email each worker their progress every weekday morning</label>
      <p class="muted small">Tue–Fri: their calls yesterday vs the goal, rank, commission, and who to call back today. Monday: last week's recap. Praise when they hit the goal, a nudge when they fall behind, and a check-in if they go quiet for 3+ days. Uses the same Gmail app password.</p>
      <p class="muted small">The brief also shows at the top of Admin with a ▶ Listen button.</p>
      <button type="submit" class="primary">Save</button>
    </form>
    <form class="card" id="goalForm">
      <h2>Daily call goal</h2>
      <div class="inline"><input id="goal" type="number" min="1" max="500" value="${state.goal}" aria-label="Daily call goal"><button class="primary" type="submit">Save</button></div>
    </form>
    <section class="card"><h2>Everyone</h2><div id="teamList"><div class="loading"><span class="spinner"></span></div></div></section>`;
  // team goal ladder editor
  let ladder = [];
  const drawLadderRows = () => {
    $("#ladderRows").innerHTML = ladder.map((l, i) => `<div class="ladder-row" data-i="${i}">
      <span class="rung-n">${i + 1}</span>
      <select data-f="metric" aria-label="Level ${i + 1} target">${Object.entries(LADDER_METRICS).map(([k, m]) => `<option value="${k}" ${k === l.metric ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</select>
      <input data-f="target" type="number" min="1" max="1000000" value="${esc(String(l.target))}" aria-label="Level ${i + 1} amount">
      <input data-f="prize" maxlength="80" value="${esc(l.prize)}" placeholder="Prize, e.g. Team lunch" aria-label="Level ${i + 1} prize">
      <button type="button" class="linkbtn" data-del-level="${i}" aria-label="Remove level ${i + 1}">✕</button></div>`).join("") || `<p class="muted small">No levels. Add one, or save with none to turn the ladder off.</p>`;
    $("#ladderRows").querySelectorAll("[data-del-level]").forEach((b) => b.addEventListener("click", () => { readLadder(); ladder.splice(Number(b.dataset.delLevel), 1); drawLadderRows(); }));
    $("#ladderAdd").disabled = ladder.length >= 5;
  };
  const readLadder = () => { ladder = [...$("#ladderRows").querySelectorAll(".ladder-row")].map((r) => ({
    metric: r.querySelector('[data-f="metric"]').value, target: Math.round(Number(r.querySelector('[data-f="target"]').value) || 0), prize: r.querySelector('[data-f="prize"]').value.trim() })); };
  D.getLadder().then((l) => { ladder = l?.length ? l : DEFAULT_LADDER.map((x) => ({ ...x })); drawLadderRows(); }).catch(() => { ladder = []; drawLadderRows(); });
  $("#ladderAdd").addEventListener("click", () => { readLadder(); if (ladder.length < 5) ladder.push({ metric: "calls", target: 100, prize: "" }); drawLadderRows(); });
  $("#ladderClear").addEventListener("click", () => { ladder = []; drawLadderRows(); });
  $("#ladderForm").addEventListener("submit", async (e) => {
    e.preventDefault(); readLadder();
    if (ladder.some((l) => !(l.target > 0) || !l.prize)) return toast("Every level needs an amount and a prize", "bad");
    await busy(e.submitter || $("#ladderForm button[type=submit]"), "Saving", async () => {
      try { await D.saveLadder(ladder); toast(ladder.length ? "Ladder saved. The team can see it on Home and the Leaderboard." : "Ladder turned off"); }
      catch (err) { toast(D.authMessage(err), "bad"); }
    });
  });
  let briefTouched = false;
  $("#briefForm").addEventListener("input", () => { briefTouched = true; });
  D.getBriefSettings().then((b) => {
    if (!$("#briefForm") || briefTouched) return;
    $("#bUser").value = b.telegramUser || ""; if (b.telegramUser) $("#tgBox").open = true; $("#bEmail").value = b.email || "";
    $("#bCall").checked = b.call !== false; $("#bMsg").checked = b.message !== false; $("#bMail").checked = b.sendEmail !== false;
    $("#bWa").checked = b.whatsapp !== false; $("#bTeam").checked = b.teamEmails !== false; $("#bWaPhone").value = b.whatsappPhone || ""; $("#bWaKey").value = b.whatsappKey || "";
    briefSpeakKey = b.speakKey || ""; drawSpeak();
  }).catch(() => {});
  let briefSpeakKey = "";
  const drawSpeak = () => {
    const box = $("#speakBox");
    if (!box) return;
    if (!briefSpeakKey) { box.innerHTML = `<p class="muted small">Your iPhone can play the update out loud every morning using the built-in Shortcuts app. No extra apps.</p>
      <button type="button" class="ghost" id="speakMake">Set up iPhone</button>`; $("#speakMake").onclick = makeSpeak; return; }
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId()}/databases/(default)/documents/briefPublic/${briefSpeakKey}?key=${firebaseApiKey()}`;
    box.innerHTML = `<p class="muted small">Do this once on your iPhone (about 1 minute). Copy the link first:</p>
      <div class="inline wide"><input id="speakUrl" readonly value="${esc(url)}"><button type="button" class="primary" id="speakCopy">Copy</button></div>
      <ol class="steps small">
        <li>Open <b>Shortcuts</b> → <b>Automation</b> → <b>+</b> → <b>Time of Day</b>. Pick <b>7:55am</b>, <b>Daily</b>, and choose <b>Run Immediately</b>. Tap Next → <b>New Blank Automation</b>.</li>
        <li>Add <b>Get Contents of URL</b> and paste the link.</li>
        <li>Add <b>Get Dictionary Value</b>: Get <b>Value</b> for <b>fields</b>. Add it twice more: <b>say</b>, then <b>stringValue</b>.</li>
        <li>Add <b>Speak Text</b>. Done. Tap ▶ to test it.</li>
      </ol>
      <p class="muted small">Keep this link private. <button type="button" class="linkbtn" id="speakReset">Make a new link</button> if it ever gets shared.</p>`;
    $("#speakCopy").onclick = () => { navigator.clipboard?.writeText(url).then(() => toast("Link copied"), () => { $("#speakUrl").select(); }); };
    $("#speakReset").onclick = makeSpeak;
  };
  const makeSpeak = async () => {
    const key = [...crypto.getRandomValues(new Uint8Array(24))].map((n) => n.toString(16).padStart(2, "0")).join("");
    try { await D.saveBriefSettings({ ...(await D.getBriefSettings()), speakKey: key }); briefSpeakKey = key; drawSpeak(); toast("iPhone link ready. It starts working after tomorrow's brief."); }
    catch (err) { toast(D.authMessage(err), "bad"); }
  };
  drawSpeak();
  $("#briefForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const u = $("#bUser").value.trim().replace(/^@?/, "");
    if (u && !/^[A-Za-z0-9_]{5,32}$/.test(u)) return toast("Telegram usernames are 5–32 letters, numbers or _", "bad");
    if ($("#bWaPhone").value.trim() && !/^\+?[0-9 ]{8,16}$/.test($("#bWaPhone").value.trim())) return toast("Check the WhatsApp number", "bad");
    if (/^(1234567|123456)$/.test($("#bWaKey").value.trim())) return toast("That's the example key. Use the API key CallMeBot sends you on WhatsApp.", "bad");
    const data = { telegramUser: u ? "@" + u : "", email: $("#bEmail").value.trim(), call: $("#bCall").checked, message: $("#bMsg").checked, sendEmail: $("#bMail").checked,
      whatsapp: $("#bWa").checked, whatsappPhone: $("#bWaPhone").value.trim(), whatsappKey: ($("#bWaKey").value.match(/\d{4,}/) || [$("#bWaKey").value.trim()])[0], speakKey: briefSpeakKey, teamEmails: $("#bTeam").checked };
    await busy(e.submitter || $("#briefForm button[type=submit]"), "Saving", async () => {
      try { await D.saveBriefSettings(data); toast("Saved. Your next brief comes tomorrow at 7:30am."); }
      catch (err) { toast(D.authMessage(err), "bad"); }
    });
  });
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
  $("#gForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = $("#gToken").value.trim();
    if (!/^apify_api_[A-Za-z0-9]{20,}$/.test(token)) return toast("That doesn't look like an Apify token. It starts with apify_api_.", "bad");
    await busy(e.submitter, "Saving", async () => {
      try { await D.setGoogleToken(token); state.googleToken = token; toast("Google Maps connected"); screenTeam(); }
      catch (err) { toast(D.authMessage(err), "bad"); }
    });
  });
  $("#goalForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const n = parseInt($("#goal").value, 10);
    if (!(n >= 1 && n <= 500)) return toast("Pick a goal between 1 and 500.", "bad");
    await busy(e.submitter, "Saving", async () => {
      try { await D.saveTeamSettings(n); state.goal = n; toast("Daily goal saved"); }
      catch (err) { toast(D.authMessage(err), "bad"); }
    });
  });
  drawList();
}


// =====================================================================
// I CAN'T BE FUCKING BOTHERED
// =====================================================================
const QUOTES = [
  "Nobody is coming to save you. Pick up the phone.",
  "You don't need motivation. You need to stop being soft.",
  "Discipline is doing it when you don't feel like it. Which is right now.",
  "Someone hungrier than you made 30 calls while you were “getting ready”.",
  "Comfort is the most expensive thing you'll ever buy.",
  "Every call you skip is $500 you just handed to someone else.",
  "Hard calls, easy life. Easy calls, hard life.",
  "You're not tired. You're uncomfortable. Different thing.",
  "The phone weighs 200 grams. Lift it.",
  "Rejection won't kill you. Being broke might.",
  "Nobody remembers the calls you were scared to make. They remember the money you didn't make.",
  "You said you wanted it. Prove it or stop saying it.",
];
const ROASTS_GENERIC = [
  "You opened a page called “I can't be bothered”. That's the most effort you've put in all day.",
  "Scrolling won't pay your rent. Unless you're scrolling to the dial button.",
  "Your excuses have better attendance than you do.",
  "If overthinking paid, you'd be retired by now.",
  "The leads aren't going to call themselves. Weird, right?",
  "You've rearranged your desk three times. The phone is still on it.",
  "Imagine explaining to future you that you didn't call because you “weren't feeling it”.",
];
const TIPS = [
  ["First call in the next 60 seconds.", "Don't plan it. Don't rehearse it. Open My leads and dial the top number."],
  ["Close every other tab.", "Yes, that one too. The only thing open is this app and your phone."],
  ["Run a 25-minute sprint.", "Calls only. No breaks, no snacks, no “quick check” of your phone. Timer's below."],
  ["Stand up when you call.", "You sound more confident on your feet. People can hear it."],
  ["Use the script.", "Don't improvise when you're nervous. Read it word for word until it's automatic."],
  ["Count the no's, not the yes's.", "20 no's is a great day. Every no gets you closer to the yes."],
  ["Next number within 10 seconds.", "Got rejected? Log it, dial the next one. Sulking is not a status."],
  ["Reward after, not before.", "Food, games, phone: you earn them after the sprint. Not as a warm-up."],
];
const pick = (arr, not) => { let x; do { x = arr[Math.floor(Math.random() * arr.length)]; } while (arr.length > 1 && x === not); return x; };

function roastFor(calls, goal, name) {
  const first = name.split(" ")[0];
  if (calls === 0) return [`0 calls today, ${first}. Even your phone is bored of you.`, "Fix it: open My leads and make one call. Just one. Right now."];
  if (calls < goal / 3) return [`${calls} call${calls === 1 ? "" : "s"}. The goal is ${goal}. Maths clearly isn't the only thing you're avoiding.`, `${goal - calls} to go. Stop reading this and dial.`];
  if (calls < goal) return [`${calls} calls. Not bad. Not good either. ${goal - calls} short of the goal, ${first}.`, "Finish the job. Half-done calls pay half-nothing."];
  return [`${calls} calls. Goal smashed. Fine, you're not useless today.`, "Do 10 more and I might even be nice to you."];
}

// =====================================================================
// Review cards: Google review links for NFC cards, plus the upsell
// =====================================================================
// =====================================================================
// Referrals
// =====================================================================
async function showReferralForm(from = null) {
  let clients = (state.myLeads || []).filter((l) => D.hadWon(l));
  if (isAdmin()) clients = await D.getLeadsWithStatus("Won").catch(() => clients);
  if (from && !clients.some((c) => c.id === from.leadId)) clients.unshift({ id: from.leadId, name: from.name });
  await showModal(`<h2>🤝 Add a referral</h2>
    <p class="muted small">A business one of your clients told you about. Referrals close far more often, so they go to the top of your list.</p>
    <form id="refForm" class="ref-form">
      <label for="rName">Business name</label><input id="rName" maxlength="120" required>
      <label for="rPhone">Phone</label><input id="rPhone" type="tel" maxlength="30" required>
      <div class="ref-grid">
        <div><label for="rSuburb">Suburb</label><input id="rSuburb" maxlength="60" required></div>
        <div><label for="rType">Business type</label><select id="rType">${TRADES.map((t) => `<option>${esc(t.label)}</option>`).join("")}<option>Other</option></select></div>
      </div>
      <label for="rFrom">Referred by</label>
      <select id="rFrom" required><option value="">Choose the client…</option>${clients.map((c) => `<option value="${esc(c.id)}" ${from?.leadId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
      <p class="small muted">If they buy, ${esc(clients.find((c) => c.id === from?.leadId)?.name || "the client")} earns a ${esc(money(REFERRAL_REWARD))} thank-you.</p>
      <button type="submit" class="primary wide">Add referral</button>
    </form>`);
  $("#rFrom").addEventListener("change", () => {
    const c = clients.find((x) => x.id === $("#rFrom").value);
    $("#refForm .small.muted").textContent = `If they buy, ${c?.name || "the client"} earns a ${money(REFERRAL_REWARD)} thank-you.`;
  });
  $("#refForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#rName").value.trim(), phone = $("#rPhone").value.trim(), suburb = $("#rSuburb").value.trim();
    const client = clients.find((c) => c.id === $("#rFrom").value);
    if (!name || !phone || !suburb || !client) return toast("Fill in every field", "bad");
    if (!cleanPhone(phone).valid) return toast("That phone number doesn't look right", "bad");
    const lead = { name, phone: cleanPhone(phone).display, suburb, category: $("#rType").value, websiteKind: "none", source: "Referral", referredBy: { leadId: client.id, name: client.name } };
    lead.id = leadKey(lead);
    await busy(e.submitter || $("#refForm button[type=submit]"), "Adding", async () => {
      try {
        await D.addReferral(state.me, lead);
        document.querySelector(".modal-wrap .wide-btn")?.click();
        toast(`${name} added. It's in My leads with a 🤝 badge.`);
        confetti();
      } catch (err) {
        toast(err instanceof D.TakenError ? `${name} is already in the system (${err.takenBy} has it).` : D.authMessage(err), "bad");
      }
    });
  });
}

async function screenReferrals() {
  setTitle("Referrals");
  const rid = state.routeId;
  view().innerHTML = `${adminNav("referrals")}<h1 class="page">Referrals</h1><div id="refBody"><div class="loading"><span class="spinner"></span></div></div>`;
  const [refs, wonCalls] = await Promise.all([D.getReferrals(), D.getWonCalls().catch(() => [])]);
  if (rid !== state.routeId || !$("#refBody")) return;
  const valueBy = new Map(wonCalls.map((c) => [c.leadId, c.value]));
  const won = refs.filter((l) => D.hadWon(l));
  const owed = won.filter((l) => !l.referralRewardPaid);
  const sales = won.reduce((n, l) => n + (valueBy.get(l.id) || 0), 0);
  const byClient = new Map();
  refs.forEach((l) => { const k = l.referredBy?.name || "Unknown"; byClient.set(k, (byClient.get(k) || 0) + 1); });
  const top = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const sorted = refs.slice().sort((a, b) => (D.hadWon(b) - D.hadWon(a)) || ((toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0)));
  $("#refBody").innerHTML = `
    <section class="tiles">
      <div class="tile"><span>Referrals</span><b class="num">${refs.length}</b><small>businesses clients sent you</small></div>
      <div class="tile"><span>Became clients</span><b class="num">${won.length}</b><small>${refs.length ? pct(won.length / refs.length) + " close rate" : ""}</small></div>
      <div class="tile"><span>Sales from referrals</span><b class="num">${money(sales)}</b></div>
      <div class="tile ref-owed"><span>Rewards to pay</span><b class="num">${money(owed.length * REFERRAL_REWARD)}</b><small>${owed.length} × ${money(REFERRAL_REWARD)} thank-you</small></div>
    </section>
    ${top.length ? `<section class="card"><h2>Best referrers</h2><ul class="plain">${top.map(([n, c]) => `<li class="due"><b>${esc(n)}</b><span>${c} referral${c === 1 ? "" : "s"}</span></li>`).join("")}</ul></section>` : ""}
    <section class="card"><h2>All referrals</h2>
      ${refs.length ? `<div class="tablewrap"><table class="board"><thead><tr><th>Business</th><th>Referred by</th><th>Worker</th><th>Status</th><th class="n">Sale</th><th>Reward</th></tr></thead><tbody>
        ${sorted.map((l) => {
          const isWon = D.hadWon(l);
          return `<tr><td><b>${esc(l.name)}</b><br><small class="muted">${esc(l.suburb)} · ${esc(l.phone || "")}</small></td><td>${esc(l.referredBy?.name || "")}</td><td>${esc(l.assignedName || "—")}</td>
            <td><span class="status s-${esc((l.status || "New").replace(/\s/g, ""))}">${esc(l.status || "New")}</span></td>
            <td class="n">${isWon && valueBy.get(l.id) ? esc(money(valueBy.get(l.id))) : "—"}</td>
            <td>${!isWon ? '<span class="muted">When they buy</span>'
              : l.referralRewardPaid ? `<span class="pay-tag pay-paid">Paid ✓</span> <button class="linkbtn" data-rpay="${esc(l.id)}" data-v="0">Undo</button>`
              : `<span class="pay-tag">Owed ${esc(money(REFERRAL_REWARD))}</span> <button class="linkbtn" data-rpay="${esc(l.id)}" data-v="1">Mark paid</button>`}</td></tr>`;
        }).join("")}</tbody></table></div>` : `<div class="empty">No referrals yet. After every sale, ask: “Do you know any other business owners who need a website?” Then tap 🤝 Add a referral in My leads.</div>`}
    </section>`;
  $("#refBody").querySelectorAll("[data-rpay]").forEach((b) => b.addEventListener("click", async () => {
    try { await D.markReferralRewardPaid(b.dataset.rpay, b.dataset.v === "1"); toast(b.dataset.v === "1" ? "Reward marked as paid" : "Marked as not paid"); screenReferrals(); }
    catch (err) { toast(D.authMessage(err), "bad"); }
  }));
}

// =====================================================================
// Packages (admin): what's in Starter / Pro / Premium
// =====================================================================
function screenPackages() {
  setTitle("Packages");
  let list = JSON.parse(JSON.stringify(packages()));
  const draw = () => {
    view().innerHTML = `${adminNav("packages")}<h1 class="page">Website packages</h1>
      <p class="muted">These show up when someone marks a deal as Won: they pick the package and the price fills in. Edit what's included anytime.</p>
      <form id="pkgForm">
        <div class="pkg-edit-list">${list.map((p, i) => `<section class="card pkg-edit" data-i="${i}">
          <div class="pkg-edit-head">
            <div><label>Name</label><input data-f="name" maxlength="40" value="${esc(p.name)}" required></div>
            <div><label>Price ($)</label><input data-f="price" type="number" min="0" max="100000" step="1" value="${esc(String(p.price))}" required></div>
            <button type="button" class="linkbtn danger" data-del="${i}" ${list.length <= 1 ? "disabled" : ""}>Remove</button>
          </div>
          <label>What's included (one per line)</label>
          <textarea data-f="items" rows="5" maxlength="1000">${esc((p.items || []).join("\n"))}</textarea>
        </section>`).join("")}</div>
        <div class="toolbar">
          ${list.length < 6 ? `<button type="button" class="ghost" id="pkgAdd">+ Add a package</button>` : ""}
          <button type="button" class="linkbtn" id="pkgReset">Reset to the original three</button>
          <button type="submit" class="primary">Save packages</button>
        </div>
      </form>`;
    const read = () => { list = [...view().querySelectorAll(".pkg-edit")].map((sec) => ({
      name: sec.querySelector('[data-f="name"]').value.trim(),
      price: Math.max(0, Math.round(Number(sec.querySelector('[data-f="price"]').value) || 0)),
      items: sec.querySelector('[data-f="items"]').value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 12),
    })); };
    view().querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => { read(); list.splice(Number(b.dataset.del), 1); draw(); }));
    $("#pkgAdd")?.addEventListener("click", () => { read(); list.push({ name: "New package", price: 0, items: [] }); draw(); });
    $("#pkgReset").addEventListener("click", () => { if (confirm("Reset to Starter, Pro and Premium?")) { list = JSON.parse(JSON.stringify(DEFAULT_PACKAGES)); draw(); } });
    $("#pkgForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      read();
      if (list.some((p) => !p.name)) return toast("Every package needs a name", "bad");
      await busy(e.submitter || $("#pkgForm button[type=submit]"), "Saving", async () => {
        try {
          await D.savePackages(list);
          state.packages = list;
          try { saveBoot(state.me.id, { ...readBoot(state.me.id), packages: list }); } catch {}
          toast("Packages saved");
        } catch (err) { toast(D.authMessage(err), "bad"); }
      });
    });
  };
  draw();
}

// =====================================================================
// Care plans (admin): monthly recurring income
// =====================================================================
// Package quick-picks ($10–$45 a month); the number box still takes any amount
const carePresets = (inputId) => `<span class="care-presets">${CARE_PRESETS.map((v) => `<button type="button" class="chip ${v === CARE_DEFAULT ? "on" : ""}" data-preset="${v}" data-for="${inputId}">$${v}</button>`).join("")}</span>`;
function wireCarePresets(root) {
  root.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
    const input = document.getElementById(b.dataset.for);
    if (!input) return;
    input.value = b.dataset.preset;
    b.parentElement.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b));
  }));
  root.querySelectorAll(".care-presets + .cur + input, .care-presets + input").forEach((input) => input.addEventListener("input", () => {
    input.parentElement.querySelectorAll(`[data-for="${input.id}"]`).forEach((c) => c.classList.toggle("on", c.dataset.preset === input.value));
  }));
}

async function screenCare() {
  setTitle("Care plans");
  const rid = state.routeId;
  const today = perthDay();
  view().innerHTML = `${adminNav("care")}<h1 class="page">Care plans</h1><div id="careBody"><div class="loading"><span class="spinner"></span></div></div>`;
  const [plans, won] = await Promise.all([D.getCarePlans(), D.getLeadsWithStatus("Won").catch(() => [])]);
  if (rid !== state.routeId) return;
  const leadsById = new Map(won.map((l) => [l.id, l]));
  const st = careStats(plans, today);
  const fmtDay = (d) => prettyDay(d);
  const reminder = (p) => `Hi! Just a heads up, the ${money(p.monthly)} monthly care plan payment for ${p.client}'s website is due on ${fmtDay(p.due)}. Thanks for being with ${BRAND.name}!\n${signature(state.me, state.brand)}`;
  const sorted = plans.slice().sort((a, b) => (a.status === b.status ? b.monthly - a.monthly : a.status === "active" ? -1 : 1));
  $("#careBody").innerHTML = `
    <section class="tiles">
      <div class="tile care-mrr"><span>Monthly income</span><b class="num">${money(st.mrr)}</b><small>${st.newThisMonth} new this month${st.cancelledThisMonth ? ` · ${st.cancelledThisMonth} cancelled` : ""}</small></div>
      <div class="tile"><span>Per year</span><b class="num">${money(st.arr)}</b><small>if nobody cancels</small></div>
      <div class="tile"><span>Active clients</span><b class="num">${st.active}</b><small>${plans.length - st.active} cancelled</small></div>
      <div class="tile"><span>Collected so far</span><b class="num">${money(st.collected)}</b><small>all care plans, all time</small></div>
    </section>
    <section class="card">
      <h2>Payments due this week</h2>
      ${st.dueSoon.length ? `<ul class="plain">${st.dueSoon.map((p, i) => {
        const phone = cleanPhone(leadsById.get(p.leadId)?.phone || "");
        return `<li class="due"><b>${esc(p.client)}</b><span>${esc(money(p.monthly))} · ${esc(p.due === today ? "Today" : fmtDay(p.due))}</span>
          ${phone.valid ? `<a class="ghost small" href="sms:${esc(phone.tel.replace(/^tel:/, ""))}?&body=${encodeURIComponent(reminder(p))}">Text reminder</a>` : ""}
          <button class="linkbtn" data-rem="${i}">Copy reminder</button></li>`;
      }).join("")}</ul>` : `<p class="muted">Nothing due in the next 7 days.</p>`}
    </section>
    <form class="card" id="careForm">
      <h2>Add a care plan</h2>
      <div class="care-grid">
        <div><label for="cpClient">Client</label><input id="cpClient" list="cpWon" maxlength="120" required placeholder="Business name">
          <datalist id="cpWon">${won.map((l) => `<option value="${esc(l.name)}">`).join("")}</datalist></div>
        <div><label for="cpAmt">Per month ($)</label>${carePresets("cpAmt")}<input id="cpAmt" type="number" min="1" max="10000" step="1" value="${CARE_DEFAULT}" required></div>
        <div><label for="cpStart">Started</label><input id="cpStart" type="date" value="${today}" required></div>
      </div>
      <button type="submit" class="primary">Add care plan</button>
    </form>
    <section class="card">
      <h2>All care plans</h2>
      ${plans.length ? `<div class="tablewrap"><table class="board">
        <thead><tr><th>Client</th><th class="n">Per month</th><th>Since</th><th class="n">Months</th><th class="n">Collected</th><th>Sold by</th><th></th></tr></thead>
        <tbody>${sorted.map((p) => {
          const months = monthsBilled(p.startDay, p.status === "cancelled" && p.cancelDay ? p.cancelDay : today);
          return `<tr class="${p.status === "cancelled" ? "cancelled" : ""}"><td><b>${esc(p.client)}</b>${p.status === "cancelled" ? ` <span class="pill taken">Cancelled ${esc(p.cancelDay ? fmtDay(p.cancelDay) : "")}</span>` : ""}</td>
            <td class="n">${esc(money(p.monthly))}</td><td>${esc(fmtDay(p.startDay))}</td><td class="n">${months}</td><td class="n">${esc(money(months * p.monthly))}</td>
            <td>${esc(p.soldByName || "")}</td>
            <td class="actions">${p.status === "active" ? `<button class="linkbtn" data-cancel="${esc(p.id)}">Cancel</button>` : `<button class="linkbtn" data-react="${esc(p.id)}">Reactivate</button>`}
              <button class="linkbtn danger" data-delp="${esc(p.id)}">Delete</button></td></tr>`;
        }).join("")}</tbody></table></div>` : `<div class="empty">No care plans yet. Offer one on every sale. ${esc(money(CARE_DEFAULT))}/month from 20 clients is ${esc(money(CARE_DEFAULT * 20 * 12))} a year.</div>`}
    </section>`;
  wireCarePresets($("#careBody"));
  $("#careBody").querySelectorAll("[data-rem]").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(reminder(st.dueSoon[Number(b.dataset.rem)])); toast("Reminder copied"); } catch { toast("Couldn't copy", "bad"); }
  }));
  $("#careForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const client = $("#cpClient").value.trim();
    const monthly = Number($("#cpAmt").value);
    const startDay = $("#cpStart").value;
    if (!client || !(monthly > 0) || !startDay) return toast("Fill in the client, amount and start date", "bad");
    const lead = won.find((l) => l.name === client);
    await busy(e.submitter || $("#careForm button[type=submit]"), "Saving", async () => {
      try { await D.addCarePlan(state.me, { client, leadId: lead?.id || "", monthly, startDay }); toast(`Care plan added: ${money(monthly)}/month`); screenCare(); }
      catch (err) { toast(D.authMessage(err), "bad"); }
    });
  });
  const act = (sel, fn, msg) => $("#careBody").querySelectorAll(sel).forEach((b) => b.addEventListener("click", async () => {
    if (msg && !confirm(msg)) return;
    try { await fn(Object.values(b.dataset)[0]); screenCare(); } catch (err) { toast(D.authMessage(err), "bad"); }
  }));
  act("[data-cancel]", (id) => D.updateCarePlan(id, { status: "cancelled", cancelDay: today }), "Mark this care plan as cancelled from today?");
  act("[data-react]", (id) => D.updateCarePlan(id, { status: "active", cancelDay: "" }));
  act("[data-delp]", (id) => D.deleteCarePlan(id), "Delete this care plan completely? Use Cancel instead if they just stopped paying.");
}

// =====================================================================
// Brand kit (admin): what clients see
// =====================================================================
function screenBrand() {
  setTitle("Brand kit");
  const b = state.brand || {};
  const sample = { name: "Fade Factory" };
  view().innerHTML = `${adminNav("brand")}<h1 class="page">Brand kit</h1>
    <p class="muted">Get the ${esc(BRAND.name)} name in front of every client: in every text, on every website you build and on every review card.</p>
    <form class="card" id="brandForm">
      <h2>Your details</h2>
      <p class="muted small">Shown at the bottom of every text your team sends and linked from the website credit. Leave blank to skip.</p>
      <label for="bLink">Link (Instagram, Facebook, Linktree…)</label>
      <input id="bLink" type="url" maxlength="200" placeholder="https://instagram.com/armethods" value="${esc(b.brandLink || "")}">
      <label for="bPhone">Business phone</label>
      <input id="bPhone" type="tel" maxlength="30" placeholder="04xx xxx xxx" value="${esc(b.brandPhone || "")}">
      <button class="primary">Save</button>
    </form>
    <section class="card">
      <h2>Text signature</h2>
      <p class="muted small">Every text from the 💬 Texts button on a lead ends with this.</p>
      <pre class="sig-preview" id="sigPrev"></pre>
    </section>
    <section class="card">
      <h2>“Website by AR Methods” credit</h2>
      <p class="muted small">Paste this at the very bottom of every website you build. Every visitor to your client's site sees your name.</p>
      <div class="credit-prev" id="creditPrev"></div>
      <code class="credit-code" id="creditCode"></code>
      <div class="toolbar"><button class="primary small" id="copyCredit">Copy code</button></div>
    </section>`;
  const draw = () => {
    const cur = { brandLink: safeUrl($("#bLink").value.trim()) || "", brandPhone: $("#bPhone").value.trim() };
    $("#sigPrev").textContent = textsFor(sample, state.me, cur)[0].text;
    $("#creditPrev").innerHTML = creditHtml(cur);
    $("#creditCode").textContent = creditHtml(cur);
    return cur;
  };
  draw();
  $("#bLink").addEventListener("input", draw);
  $("#bPhone").addEventListener("input", draw);
  $("#copyCredit").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(creditHtml(draw())); toast("Credit code copied"); }
    catch { toast("Couldn't copy", "bad"); }
  });
  $("#brandForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const raw = $("#bLink").value.trim();
    if (raw && !safeUrl(raw)) return toast("That link doesn't look right. It should start with https://", "bad");
    const cur = draw();
    await busy(e.submitter || $("#brandForm button"), "Saving", async () => {
      try {
        await D.saveBrand(cur);
        state.brand = cur;
        try { const boot = readBoot(state.me.id); if (boot) saveBoot(state.me.id, { ...boot, brand: cur }); } catch {}
        toast("Brand details saved");
      } catch (err) { toast(D.authMessage(err), "bad"); }
    });
  });
}

function reviewCardMock(name, rating) {
  const stars = Math.round(rating ?? 5);
  return `<div class="rv-card" aria-hidden="true">
      <div class="rv-sheen"></div>
      <div class="rv-card-top"><span class="rv-g small">G</span><span class="rv-nfc"><i></i><i></i><i></i></span></div>
      <div class="rv-stars">${"★".repeat(stars)}<span>${"★".repeat(5 - stars)}</span></div>
      <b class="rv-name">${esc(name)}</b>
      <small>Tap your phone here to leave us a review</small>
      <span class="rv-by"><img src="logo.png" alt="" width="11" height="14">AR METHODS</span>
    </div>`;
}

async function screenReviews(arg) {
  setTitle("Review cards");
  const rid = state.routeId;
  const first = (state.me.name || "").split(" ")[0];
  const preset = arg ? decodeURIComponent(arg) : "";
  const hero = (locked) => `
    <section class="rv-hero${locked ? " rv-locked" : ""}">
      <div class="rv-copy">
        <span class="rv-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <h1 class="rv-title">Tap. Review.<br><span>Rank higher.</span></h1>
        <p>Tap-to-review NFC cards. A customer taps their phone on the card and the business's Google review page opens. No typing, no searching.</p>
        <span class="rv-price">${esc(NFC.price)}</span>
      </div>
      <div class="rv-stage">${reviewCardMock("Your business", 5)}</div>
      ${locked ? `<div class="rv-lock"><span aria-hidden="true">🔒</span><b>Admin only</b><small>Review cards are handled by Aman. If a client wants them, mark the deal as Won and let Aman know.</small></div>` : ""}
    </section>`;
  if (!isAdmin()) { view().innerHTML = `<div class="rv">${hero(true)}</div>`; return; }
  view().innerHTML = `<div class="rv">
    ${hero(false)}
    <section class="rv-panel">
      <div class="rv-head"><span class="rv-num">1</span><div><h2>Make the review link</h2><p class="muted small">Find the business on Google Maps and get its “write a review” link.</p></div></div>
      <form id="revForm" class="rv-search">
        <span class="rv-g" aria-hidden="true">G</span>
        <input id="revQ" placeholder="Business name and suburb, e.g. Fade Factory Willetton" value="${esc(preset)}" required autocomplete="off">
        <button class="primary" id="revBtn">Find</button>
      </form>
      <div id="revResults"></div>
    </section>
    <section class="rv-panel">
      <div class="rv-head"><span class="rv-num">2</span><div><h2>Sell more of them</h2><p class="muted small">Word-for-word lines that get the extra ${esc(NFC.price.split(" ")[0])}.</p></div></div>
      <div class="rv-pitches">
        <article class="rv-pitch hot"><span class="rv-tag">After they say yes</span><p>${esc(NFC.pitch)}</p></article>
        <article class="rv-pitch"><span class="rv-tag">Bundle on the call</span><p>${esc(NFC.bundle)}</p></article>
        <article class="rv-pitch"><span class="rv-tag">${esc(NFC.objection[0].replace(/[“”]/g, ""))}</span><p>${esc(NFC.objection[1])}</p></article>
      </div>
      <h3 class="obj-h">Text your past clients</h3>
      <div id="revClients"><div class="loading"><span class="spinner"></span></div></div>
    </section></div>`;

  const results = $("#revResults");
  const showLink = (p) => {
    const link = reviewLink(p.placeId);
    const stage = $(".rv-stage");
    if (stage) stage.innerHTML = reviewCardMock(p.name, p.rating);
    results.innerHTML = `<div class="rev-link">
        <p class="rv-ok"><span aria-hidden="true">✓</span> Link ready for <b>${esc(p.name)}</b></p>
        <p class="muted small">${esc(p.address)}</p>
        <code id="revUrl">${esc(link)}</code>
        <div class="toolbar">
          <button class="primary small" id="revCopy">Copy link</button>
          <a class="ghost small" href="${esc(link)}" target="_blank" rel="noopener">Test it</a>
          <button class="ghost small" id="revAgain">Search again</button>
        </div>
        <p class="muted small">Opens the "write a review" box for this business. Put this link on the NFC card.</p>
      </div>`;
    $("#revCopy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(link); toast("Review link copied"); }
      catch { toast("Couldn't copy. Press and hold the link to copy it.", "bad"); }
    });
    $("#revAgain").addEventListener("click", () => { results.innerHTML = ""; $("#revQ").focus(); });
  };
  const search = async () => {
    const q = $("#revQ").value.trim();
    if (!q) return;
    const btn = $("#revBtn");
    btn.disabled = true;
    results.innerHTML = `<div class="loading"><span class="spinner"></span>Searching Google Maps…</div>`;
    try {
      const places = await findPlaceForReview(/perth|wa\b|western australia/i.test(q) ? q : `${q} WA`, GOOGLE_MAPS_KEY);
      if (rid !== state.routeId) return;
      if (!places.length) { results.innerHTML = `<div class="notice">No match on Google Maps. Check the spelling or add the suburb. The business needs a Google Maps listing to get reviews.</div>`; return; }
      results.innerHTML = `<p class="muted small">Pick the right business:</p><div class="rev-picks">${places.map((p, i) =>
        `<button class="rev-pick" data-i="${i}"><b>${esc(p.name)}</b><span class="muted small">${esc(p.address)}</span>${p.rating != null ? `<span class="small">⭐ ${p.rating} (${p.reviews})</span>` : `<span class="small muted">No reviews yet</span>`}</button>`).join("")}</div>`;
      results.querySelectorAll(".rev-pick").forEach((b) => b.addEventListener("click", () => showLink(places[Number(b.dataset.i)])));
      if (places.length === 1) showLink(places[0]);
    } catch (e) {
      if (rid !== state.routeId) return;
      results.innerHTML = errorBox(e instanceof SearchError ? e.message : "Couldn't search Google Maps. Try again.");
    } finally { btn.disabled = false; }
  };
  $("#revForm").addEventListener("submit", (e) => { e.preventDefault(); search(); });
  if (preset) search();

  // Past clients (deals you've won) with a ready-to-send text
  try {
    const won = (await D.getLeadsFor(state.me.id)).filter((l) => l.status === "Won");
    if (rid !== state.routeId) return;
    const box = $("#revClients");
    if (!won.length) { box.innerHTML = `<p class="muted small">Once you win deals, your clients show up here with a text ready to send them.</p>`; return; }
    box.innerHTML = `<div class="rev-clients">${won.map((l, i) => {
      const phone = cleanPhone(l.phone || "");
      const body = encodeURIComponent(NFC.text(l.name, state.me, state.brand));
      return `<div class="rev-client"><div><b>${esc(l.name)}</b><span class="muted small">${esc(l.phone || "")}</span></div>
        <div class="toolbar">
          ${phone.valid ? `<a class="primary small" href="sms:${esc(phone.tel.replace(/^tel:/, ""))}?&body=${body}">Text them</a>` : ""}
          <button class="ghost small" data-copy="${i}">Copy text</button>
          <a class="ghost small" href="#reviews/${encodeURIComponent([l.name, l.suburb].filter(Boolean).join(" "))}">Make link</a>
        </div></div>`;
    }).join("")}</div>`;
    box.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(NFC.text(won[Number(b.dataset.copy)].name, state.me, state.brand)); toast("Text copied"); }
      catch { toast("Couldn't copy", "bad"); }
    }));
  } catch (e) { const box = $("#revClients"); if (box) box.innerHTML = errorBox(D.authMessage(e)); }
}

function screenLockin() {
  setTitle("Can't be bothered");
  const today = perthDay();
  let quote = pick(QUOTES);
  let generic = pick(ROASTS_GENERIC);
  let calls = 0;
  view().innerHTML = `
    <section class="lockin-hero">
      <h1 class="glitch">I can't be <span class="cross">fucking</span> bothered</h1>
      <p class="tough">Yeah? Tough. Read this, then pick up the phone.</p>
    </section>
    <div id="lockQuote"></div>
    <div id="lockRoast"></div>
    <section class="card sprint" id="sprint">
      <h2>25-minute call sprint</h2>
      <div class="clock" id="clock">25:00</div>
      <p class="muted small" id="sprintMsg">Calls only until the timer hits zero.</p>
      <div class="toolbar" style="justify-content:center"><button class="primary" id="sprintGo">Start sprint</button><button class="ghost" id="sprintReset">Reset</button><a class="ghost" href="#leads">Open My leads</a></div>
    </section>
    <h2>How to lock in</h2>
    <ol class="tips">${TIPS.map(([t, d]) => `<li><div><b>${esc(t)}</b><span class="muted">${esc(d)}</span></div></li>`).join("")}</ol>`;
  const drawQuote = () => {
    $("#lockQuote").innerHTML = `<div class="quote-card pop"><blockquote>${esc(quote)}</blockquote>
      <button class="ghost small hit" id="hitMe">Hit me again</button></div>`;
    $("#hitMe").addEventListener("click", () => { quote = pick(QUOTES, quote); generic = pick(ROASTS_GENERIC, generic); drawQuote(); drawRoast(); });
  };
  const drawRoast = () => {
    const [line, fix] = roastFor(calls, state.goal, state.me.name);
    $("#lockRoast").innerHTML = `<p class="roast pop">${esc(line)}<small>${esc(fix)} ${esc(generic)}</small></p>`;
  };
  drawQuote(); drawRoast();
  state.unsub.push(D.watchStats("day", today, (rows) => {
    const mine = rows.find((r) => r.uid === state.me.id);
    const n = mine ? mine.calls : 0;
    if (n !== calls) { calls = n; if ($("#lockRoast")) drawRoast(); }
  }, () => {}));

  // sprint timer
  let left = 25 * 60, timer = null, startCalls = 0;
  const fmt = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  const stop = () => { clearInterval(timer); timer = null; $("#sprint")?.classList.remove("running"); };
  state.unsub.push(stop);
  $("#sprintGo").addEventListener("click", () => {
    if (timer) { stop(); $("#sprintGo").textContent = "Resume"; $("#sprintMsg").textContent = "Paused. The leads didn't pause, by the way."; return; }
    if (left === 25 * 60) startCalls = calls;
    $("#sprint").classList.add("running");
    $("#sprintGo").textContent = "Pause";
    $("#sprintMsg").textContent = "Go. Dial. Now.";
    timer = setInterval(() => {
      left--;
      if ($("#clock")) $("#clock").textContent = fmt(left);
      if (left <= 0) {
        stop();
        const made = calls - startCalls;
        $("#sprintGo").textContent = "Start sprint";
        $("#sprintMsg").textContent = made > 0 ? `Sprint done: ${made} call${made === 1 ? "" : "s"}. Take 5, then go again.` : "Sprint done and 0 calls logged. Bold strategy. Try again.";
        if (made > 0) confetti();
        left = 25 * 60;
      }
    }, 1000);
  });
  $("#sprintReset").addEventListener("click", () => {
    stop(); left = 25 * 60; $("#clock").textContent = fmt(left); $("#sprintGo").textContent = "Start sprint"; $("#sprintMsg").textContent = "Calls only until the timer hits zero.";
  });
}

// =====================================================================
// Admin: weekly report
// =====================================================================
async function screenReport(arg) {
  setTitle("Weekly report");
  const thisWeek = weekStart(perthDay());
  const week = /^\d{4}-\d{2}-\d{2}$/.test(arg || "") ? weekStart(arg) : addDays(thisWeek, -7);
  view().innerHTML = `${adminNav("report")}<h1 class="page">Weekly report</h1><div id="repBody"><div class="loading"><span class="spinner"></span></div></div>`;
  const rid = state.routeId;
  const [rows, users, calls] = await Promise.all([D.getStatsForWeek(week), D.listUsers(), D.getCallsForWeek(week)]);
  const wonLeads = await D.getLeadsByIds(calls.filter((c) => c.status === "Won").map((c) => c.leadId)).catch(() => []);
  if (rid !== state.routeId || !$("#repBody")) return;
  const rep = weeklyReport(rows, users, week);
  const payMap = new Map(wonLeads.map((l) => [l.id, payOf(l)]));
  const splitBy = (uid) => commissionSplit(calls.filter((c) => c.uid === uid), payMap);
  const commissionBy = (uid) => splitBy(uid).paid;
  const totalCommission = rep.list.reduce((n, u) => n + commissionBy(u.uid), 0);
  const totalPending = rep.list.reduce((n, u) => n + splitBy(u.uid).pending, 0);
  const label = `${prettyDay(week)} – ${prettyDay(addDays(week, 6))}`;
  const winner = rep.list.find((u) => u.points > 0);
  $("#repBody").innerHTML = `
    <div class="toolbar">
      <a class="ghost small" href="#report/${addDays(week, -7)}">← Previous week</a>
      <b class="week-label">${esc(label)}${week === thisWeek ? " (so far)" : ""}</b>
      ${week < thisWeek ? `<a class="ghost small" href="#report/${addDays(week, 7)}">Next week →</a>` : ""}
    </div>
    <section class="tiles">
      <div class="tile"><span>Calls</span><b class="num">${rep.team.calls}</b></div>
      <div class="tile"><span>Interested</span><b class="num">${rep.team.interested}</b></div>
      <div class="tile"><span>Deals won</span><b class="num">${rep.team.won}</b><small>${rep.team.calls ? pct(rep.team.won / rep.team.calls) + " of calls" : ""}</small></div>
      <div class="tile"><span>Sales</span><b class="num">${money(rep.team.revenue)}</b><small>${money(totalCommission)} commission owed${totalPending ? ` · ${money(totalPending)} pending payment` : ""}</small></div>
    </section>
    ${winner ? `<div class="notice info">🏆 Worker of the week: <b>${esc(winner.name)}</b> with ${winner.points} points (${winner.calls} calls, ${winner.won} won).</div>` : ""}
    <section class="card"><h2>By worker</h2>
      <div class="tablewrap"><table class="board">
        <thead><tr><th>Name</th><th class="n">Calls</th><th class="n">Interested</th><th class="n">Won</th><th class="n">Win rate</th><th class="n">Sales</th><th class="n">Commission (paid)</th><th class="n">Days active</th><th>Best day</th></tr></thead>
        <tbody>${rep.list.map((u) => `<tr><td><a href="#worker/${esc(u.uid)}">${esc(u.name)}</a></td>
          <td class="n">${u.calls}</td><td class="n">${u.interested}</td><td class="n">${u.won}</td><td class="n">${pct(u.conversion)}</td>
          <td class="n">${money(u.revenue)}</td><td class="n"><b>${money(commissionBy(u.uid))}</b>${splitBy(u.uid).pending ? `<br><small class="muted">+${money(splitBy(u.uid).pending)} pending</small>` : ""}</td><td class="n">${u.activeDays}/7</td>
          <td>${u.best.calls ? `${esc(prettyDay(u.best.day))} (${u.best.calls})` : '<span class="muted">—</span>'}</td></tr>`).join("")}</tbody>
      </table></div>
      <div class="toolbar"><button class="primary small" id="copyRep">Copy summary</button><button class="ghost small" id="csvRep">Download CSV</button></div>
    </section>`;
  const summary = [`AR Methods — week of ${label}`, `Team: ${rep.team.calls} calls, ${rep.team.interested} interested, ${rep.team.won} won, ${money(rep.team.revenue)} in sales`, ""]
    .concat(rep.list.map((u, i) => `${i + 1}. ${u.name}: ${u.calls} calls, ${u.won} won, ${money(u.revenue)} sales, ${money(commissionBy(u.uid))} commission`), "", `${BRAND.name} · CEO ${BRAND.ceo}`).join("\n");
  $("#copyRep").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(summary); toast("Summary copied. Paste it in your group chat."); }
    catch { toast("Couldn't copy on this device.", "bad"); }
  });
  $("#csvRep").addEventListener("click", () => downloadCsv(rep.list.map((u) => ({ ...u, conversion: pct(u.conversion), commission: commissionBy(u.uid), bestDay: u.best.day })),
    ["name", "calls", "interested", "won", "conversion", "revenue", "commission", "activeDays", "bestDay"], `report-${week}.csv`));
}

// =====================================================================
// Install as an app (PWA)
// =====================================================================
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; document.querySelectorAll("[data-install]").forEach((b) => b.classList.remove("hidden")); });
window.addEventListener("appinstalled", () => { installPrompt = null; toast("Installed. Open AR Leads from your home screen."); });
if ("serviceWorker" in navigator && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
function installHtml() {
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone) return `<p class="muted">✅ You're using the installed app.</p>`;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return `
    <button class="primary ${installPrompt ? "" : "hidden"}" data-install>Install AR Leads</button>
    <p class="muted small">${ios
      ? "On iPhone: tap the Share button in Safari, then <b>Add to Home Screen</b>."
      : "On Android or desktop Chrome/Edge: use the button above, or the browser menu → <b>Install app</b> / <b>Add to Home screen</b>."}</p>`;
}
