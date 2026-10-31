// Posts automatic updates into the team WhatsApp group through Green-API (free Developer plan).
// The owner's WhatsApp is linked to Green-API like WhatsApp Web, so posts appear as sent by the owner.
// Config (GitHub secrets/variables):
//   GREEN_API_ID, GREEN_API_TOKEN  from the Green-API console (instance)
//   GREEN_API_URL                  optional, the instance's apiUrl (e.g. https://7103.api.greenapi.com)
//   WA_GROUP_NAME                  exact WhatsApp group name, e.g. "AR Methods Team" (or WA_GROUP_ID: 1203...@g.us)
// Quiet hours: nothing is posted 9pm–7am Perth; held updates go out on the next run after 7am (WA_FORCE=1 ignores this, for tests).
import { FieldValue } from "firebase-admin/firestore";
import { perthDay, addDays, prettyDay, weekStart, streakFrom } from "../src/util.js";
import { teamTotals, ladderProgress, LADDER_METRICS, ladderUnit } from "../src/extras.js";

const env = process.env;
const BASE = (env.GREEN_API_URL || "https://api.green-api.com").replace(/\/$/, "");
const money = (n) => "$" + Math.round(n || 0);
export const waConfigured = () => !!(env.GREEN_API_ID && env.GREEN_API_TOKEN && (env.WA_GROUP_ID || env.WA_GROUP_NAME));

export function perthHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Perth", hour: "numeric", hour12: false }).format(now)) % 24;
}
export const quietHours = (now = new Date()) => { const h = perthHour(now); return h < 7 || h >= 21; };

async function call(method, body) {
  const url = `${BASE}/waInstance${env.GREEN_API_ID}/${method}/${env.GREEN_API_TOKEN}`;
  const res = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const text = await res.text();
  if (!res.ok) throw new Error(`Green-API ${method} ${res.status}: ${text.slice(0, 160)}`);
  try { return JSON.parse(text); } catch { return text; }
}

let groupId = null;
async function resolveGroup() {
  if (groupId) return groupId;
  if (env.WA_GROUP_ID) return (groupId = env.WA_GROUP_ID);
  const want = String(env.WA_GROUP_NAME).trim().toLowerCase();
  const contacts = await call("getContacts");
  const g = (Array.isArray(contacts) ? contacts : []).find((c) => String(c.id || "").endsWith("@g.us") && String(c.name || "").trim().toLowerCase() === want);
  if (!g) throw new Error(`no WhatsApp group called "${env.WA_GROUP_NAME}" found on the linked number`);
  return (groupId = g.id);
}

/** Sends one message to the team group. DRY_RUN / MAIL_LOG print instead. */
export async function postToGroup(text) {
  if (env.DRY_RUN || env.MAIL_LOG) { console.log(`---- WHATSAPP GROUP ----\n${text}\n`); return; }
  await call("sendMessage", { chatId: await resolveGroup(), message: text.slice(0, 4000) });
}

const firstName = (n) => String(n || "").split(" ")[0] || "Someone";
const plural = (n, w, p = w + "s") => `${n} ${n === 1 ? w : p}`;

/** Recognition from the last few months of stats: personal bests and streaks hit yesterday. */
function recognition(history, day) {
  const out = [];
  const byUid = new Map();
  for (const r of history) { if (!byUid.has(r.uid)) byUid.set(r.uid, []); byUid.get(r.uid).push(r); }
  for (const rows of byUid.values()) {
    const y = rows.find((r) => r.day === day);
    if (!y || !(y.calls > 0)) continue;
    const before = rows.filter((r) => r.day < day);
    const best = Math.max(0, ...before.map((r) => r.calls || 0));
    if (before.length >= 3 && y.calls > best && y.calls >= 20) out.push(`⭐ ${firstName(y.name)} set a new personal best: ${y.calls} calls in a day`);
    const streak = streakFrom(rows.filter((r) => r.calls > 0).map((r) => r.day), day);
    if ([5, 10, 15, 20, 30, 50].includes(streak)) out.push(`🔥 ${firstName(y.name)} is on a ${streak}-day calling streak`);
  }
  return out;
}

/** Monday: last week's Hall of Fame. */
function hallOfFame(weekRows) {
  const by = new Map();
  for (const r of weekRows) {
    const c = by.get(r.uid) || { name: r.name, calls: 0, interested: 0, won: 0, revenue: 0 };
    c.calls += r.calls || 0; c.interested += r.interested || 0; c.won += r.won || 0; c.revenue += r.revenue || 0;
    by.set(r.uid, c);
  }
  const people = [...by.values()].filter((p) => p.calls > 0);
  if (!people.length) return [];
  const top = (k) => people.slice().sort((a, b) => b[k] - a[k] || b.calls - a.calls)[0];
  const lines = ["👑 *Hall of Fame: last week*"];
  const caller = top("calls");
  lines.push(`👑 Caller of the Week: *${firstName(caller.name)}* (${caller.calls} calls)`);
  const hot = top("interested");
  if (hot.interested > 0) lines.push(`🔥 Most interested leads: *${firstName(hot.name)}* (${hot.interested})`);
  const closer = people.slice().sort((a, b) => b.revenue - a.revenue || b.won - a.won)[0];
  if (closer.won > 0) lines.push(`💰 Top closer: *${firstName(closer.name)}* (${plural(closer.won, "site")}, ${money(closer.revenue)})`);
  lines.push("Well earned. Thank you for the effort, it shows.");
  return lines;
}

/** The morning scoreboard: team-safe numbers and recognition only (no money owed, no contact details, nobody called out). */
export async function morningScoreboard(db, now = new Date()) {
  const today = perthDay(now), day = addDays(today, -1);
  const isMonday = new Date(`${today}T12:00:00+08:00`).getUTCDay() === 1;
  const history = (await db.collection("stats").where("day", ">=", addDays(today, -120)).get()).docs.map((d) => d.data());
  const stats = history.filter((r) => r.day === day);
  const won = (await db.collection("calls").where("day", "==", day).where("status", "==", "Won").get()).docs.map((d) => d.data());
  const t = teamTotals(stats);
  const ranked = stats.filter((s) => s.calls > 0).sort((a, b) => (b.points || 0) - (a.points || 0) || b.calls - a.calls);
  const lines = [`☀️ *Good morning, AR Methods team*`, `_${prettyDay(day)} in review_`, ""];
  if (t.calls) {
    lines.push(`📞 ${t.calls} calls · 🔥 ${t.interested} interested · 💰 ${t.won} won`);
    if (ranked[0]) lines.push(`👑 Top of the board: *${firstName(ranked[0].name)}* with ${ranked[0].calls} calls and ${ranked[0].points || 0} points`);
    if (ranked.length > 1) lines.push(`Strong work too from ${ranked.slice(1, 4).map((r) => `${firstName(r.name)} (${r.calls})`).join(", ")}.`);
  } else if (!isMonday) lines.push("A quiet one yesterday. Fresh start today.");
  const deals = won.filter((c) => c.value > 0);
  if (deals.length) lines.push("", ...deals.map((c) => `🎉 ${firstName(c.userName)} signed ${c.leadName} (${money(c.value)}). Great result.`));
  const rec = recognition(history, day);
  if (rec.length) lines.push("", ...rec);
  if (isMonday) {
    const lastWeek = weekStart(addDays(today, -7));
    const weekRows = history.filter((r) => r.day >= lastWeek && r.day < weekStart(today));
    const hof = hallOfFame(weekRows);
    if (hof.length) lines.push("", ...hof);
    const [users, team] = await Promise.all([db.collection("users").get(), db.doc("settings/team").get()]);
    const workers = users.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.active && u.role !== "admin");
    if (workers.length) lines.push("", ...hallOfShame(weekRows, workers, (team.exists && team.data().dailyGoal) || 30));
  }
  const ladder = await ladderLine(db, now);
  if (ladder) lines.push("", ladder);
  lines.push("", "Have a great day of calls, team. Every conversation counts.");
  return lines.join("\n");
}

/** 1pm weekdays: how the team is tracking against today's goal (no names). */
export async function middayCheckIn(db, now = new Date()) {
  const today = perthDay(now);
  const [stats, team, users] = await Promise.all([
    db.collection("stats").where("day", "==", today).get().then((q) => q.docs.map((d) => d.data())),
    db.doc("settings/team").get().then((d) => (d.exists ? d.data() : {})),
    db.collection("users").get().then((q) => q.docs.map((d) => d.data())),
  ]);
  const workers = users.filter((u) => u.active && u.role !== "admin").length;
  if (!workers) return "";
  const goal = (team.dailyGoal || 30) * workers;
  const calls = teamTotals(stats).calls;
  const pct = Math.round((calls / goal) * 100);
  const head = `🕐 *Midday check-in*\nTeam's on ${calls} of ${goal} calls today (${pct}%).`;
  if (calls >= goal) return `${head}\nGoal already smashed. Outstanding work, everyone.`;
  if (pct >= 50) return `${head}\nRight on track. Keep that rhythm going this afternoon.`;
  return `${head}\nA strong afternoon gets us there. Best calling time is 2–4pm.`;
}

// 💡 Practical tips for the 9am shift message (one a day, rotating)
export const TIPS = [
  "Smile when you dial. People can hear it in your voice.",
  "Ask a question in the first 10 seconds: \"Do you have a website at the moment?\" Then listen.",
  "Use their suburb. \"People in Willetton Google you first\" lands better than a generic line.",
  "If they're busy, book a time: \"Morning or arvo tomorrow?\" Two options, not an open question.",
  "Write a note after every call. Future you will thank you on the call-back.",
  "Call-backs first, every day. They already said \"call me later\", so they're the warmest leads you've got.",
  "Best calling windows are roughly 9 to 11:30am and 2 to 4pm. Skip cafés over lunch.",
  "\"Too expensive?\" Ask what one normal customer is worth to them. One or two extra pays for the site.",
  "Don't argue with a no. Thank them, leave the door open, move on. Your next yes is a dial away.",
  "Stand up for your calls if you can. More energy, better calls.",
  "After a yes, text the examples while you're still on the phone. Strike while it's warm.",
  "Old website? Mention the exact problem the app found. Specific beats salesy.",
  "Ten calls in a row without a break beats thirty spread through the day.",
  "Interested leads go cold in three days. Follow up before then.",
  "Say their business name back to them. It shows you actually looked them up.",
  "If you get the owner's name, use it on the call-back. It changes the whole conversation.",
  "Short calls are fine. The goal of the first call is a next step, not a sale.",
  "Offer the review card when they hesitate on a website. A small yes now, a big yes later.",
  "Log every call honestly, even the no answers. The numbers only help you if they're real.",
  "End each call with what happens next: \"I'll text you now, have a look tonight.\"",
];
const tipFor = (day) => TIPS[Math.abs([...day].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % TIPS.length];

async function teamDay(db, today) {
  const [stats, team, users, callbacks] = await Promise.all([
    db.collection("stats").where("day", "==", today).get().then((q) => q.docs.map((d) => d.data())),
    db.doc("settings/team").get().then((d) => (d.exists ? d.data() : {})),
    db.collection("users").get().then((q) => q.docs.map((d) => ({ id: d.id, ...d.data() }))),
    db.collection("leads").where("status", "==", "Call back").get().then((q) => q.docs.map((d) => d.data())),
  ]);
  const workers = users.filter((u) => u.active && u.role !== "admin");
  return { stats, goal: team.dailyGoal || 30, workers, callbacks };
}

/** 9am weekdays: shift start, today's goal, call-backs due, tip of the day. */
export async function shiftStart(db, now = new Date()) {
  const today = perthDay(now);
  const { goal, workers, callbacks } = await teamDay(db, today);
  if (!workers.length) return "";
  const endOfToday = new Date(`${addDays(today, 1)}T00:00:00+08:00`).getTime();
  const due = callbacks.filter((l) => !l.callbackAt || (l.callbackAt.toMillis?.() || 0) < endOfToday).length;
  return [`🟢 *Shift's on, team*`,
    `🎯 Today's goal: *${goal} calls each* (${goal * workers.length} as a team)`,
    due ? `📞 ${due} call-back${due === 1 ? "" : "s"} due today. Do those first, they're the warmest leads.` : "📞 No call-backs due. Straight into new leads.",
    "", `💡 *Tip of the day:* ${tipFor(today)}`].join("\n");
}

/** 5pm weekdays: day wrap, who hit the goal (positive naming only). */
export async function dayWrap(db, now = new Date()) {
  const today = perthDay(now);
  const { stats, goal, workers } = await teamDay(db, today);
  if (!workers.length) return "";
  const t = teamTotals(stats), target = goal * workers.length;
  const hit = stats.filter((s) => (s.calls || 0) >= goal).sort((a, b) => b.calls - a.calls);
  const top = stats.filter((s) => s.calls > 0).sort((a, b) => (b.points || 0) - (a.points || 0) || b.calls - a.calls)[0];
  const lines = [`🔚 *Day wrap*`, `📞 ${t.calls} of ${target} calls (${Math.round((t.calls / Math.max(1, target)) * 100)}%) · 🔥 ${t.interested} interested · 💰 ${t.won} won`];
  if (hit.length) lines.push(`✅ Hit the goal today: ${hit.map((s) => `${firstName(s.name)} (${s.calls})`).join(", ")}`);
  if (top) lines.push(`👑 Top today: *${firstName(top.name)}*`);
  lines.push(t.calls >= target ? "Team goal done. Proud of this one." : "Get your call-backs booked for tomorrow and log your notes. We go again in the morning.");
  return lines.join("\n");
}

/** Monday: who did under half the weekly call target last week, with a way back. */
function hallOfShame(weekRows, workers, goal) {
  const target = goal * 5, half = Math.ceil(target / 2);
  const calls = new Map();
  for (const r of weekRows) calls.set(r.uid, (calls.get(r.uid) || 0) + (r.calls || 0));
  const low = workers.map((w) => ({ name: w.name, calls: calls.get(w.id) || 0 })).filter((w) => w.calls < half).sort((a, b) => a.calls - b.calls);
  if (!low.length) return ["🙌 Nobody in the Hall of Shame this week. Everyone pulled their weight."];
  return ["🐢 *Hall of Shame: last week* (under half the target of " + target + " calls)",
    ...low.map((w) => `• ${firstName(w.name)}: ${w.calls} calls`),
    "This week's a fresh start. Beat your number and you're off the list. Stuck on the script? Ask in chat, we'll help."];
}

async function ladderState(db, now) {
  const snap = await db.doc("settings/ladder").get();
  const levels = snap.exists ? snap.data().levels || [] : [];
  if (!levels.length) return null;
  const month = perthDay(now).slice(0, 7);
  const rows = (await db.collection("stats").where("day", ">=", `${month}-01`).get()).docs.map((d) => d.data());
  return { month, prog: ladderProgress(levels, teamTotals(rows)) };
}
async function ladderLine(db, now) {
  const st = await ladderState(db, now);
  if (!st) return "";
  const next = st.prog.find((l) => l.current);
  if (!next) return "🏆 Every team goal unlocked this month. Exceptional work.";
  const m = LADDER_METRICS[next.metric], gap = Math.max(0, next.target - next.value);
  return `🪜 Team goal: *${next.prize}* is ${next.metric === "revenue" ? `${m.fmt(gap)} in sales` : `${gap} ${ladderUnit(m.label, gap)}`} away`;
}

/** Posts anything that changed for the team since last run. First run only records a baseline. */
async function teamChanges(db, state, patch) {
  const log = [];
  const base = !state.changes; // first run: remember everything, post nothing
  const prev = state.changes || {};
  const next = { ...prev };
  const [ladderSnap, teamSnap, pkgSnap, usersSnap] = await Promise.all([
    db.doc("settings/ladder").get(), db.doc("settings/team").get(), db.doc("settings/packages").get(), db.collection("users").get()]);
  // 🪜 team goals set or changed
  const lad = ladderSnap.exists ? ladderSnap.data() : null;
  const ladAt = lad?.updatedAt?.toMillis?.() || 0;
  if (ladAt && ladAt !== prev.ladderAt) {
    if (!base && lad.levels?.length) await postToGroup(["🪜 *Team goals are set*", ...lad.levels.map((l, i) => `${i + 1}. ${LADDER_METRICS[l.metric]?.fmt(l.target) || l.target} ${l.metric === "revenue" ? "in sales" : LADDER_METRICS[l.metric]?.label || ""} → *${l.prize}*`), "Hit them together and everyone gets the prize. Track it on Home in the app."].join("\n"));
    if (!base && !lad.levels?.length) await postToGroup("🪜 The team goal ladder is off for now.");
    next.ladderAt = ladAt; if (!base) log.push("whatsapp group: ladder change");
  }
  // 🎯 daily goal
  const goal = teamSnap.exists ? teamSnap.data().dailyGoal || 30 : 30;
  if (goal !== prev.dailyGoal) { if (!base && prev.dailyGoal) await postToGroup(`🎯 *New daily goal: ${goal} calls each.*\nYou've got this.`); next.dailyGoal = goal; if (!base) log.push("whatsapp group: goal change"); }
  // 📦 packages
  const list = pkgSnap.exists ? pkgSnap.data().list || [] : [];
  const sig = JSON.stringify(list.map((p) => [p.name, p.price]));
  if (list.length && sig !== prev.packages) {
    if (!base && prev.packages) await postToGroup(["📦 *Package prices updated*", ...list.map((p) => `• ${p.name}: $${Math.round(p.price)}`), "The app already shows the new prices."].join("\n"));
    next.packages = sig; if (!base) log.push("whatsapp group: packages change");
  }
  // 👋 new team members
  const workers = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.active && u.role !== "admin");
  const known = new Set(prev.workers || []);
  for (const w of workers) if (!base && !known.has(w.id)) { await postToGroup(`👋 *Welcome ${firstName(w.name)} to the AR Methods team!*\nSay hi, and show them how it's done.`); log.push(`whatsapp group: welcome ${w.name}`); }
  next.workers = workers.map((w) => w.id);
  // 📊 polls and 📣 announcements from the app
  const since = prev.feedAt || Date.now();
  if (!base) {
    const polls = (await db.collection("polls").where("at", ">", new Date(since)).get()).docs.map((d) => d.data()).sort((a, b) => a.at.toMillis() - b.at.toMillis());
    for (const p of polls) { await postToGroup(`📊 *New poll:* ${p.question}\nVote in Team chat in the app.`); log.push("whatsapp group: poll"); }
    const ann = (await db.collection("messages").where("at", ">", new Date(since)).get()).docs.map((d) => d.data()).filter((m) => m.announce && m.role === "admin").sort((a, b) => a.at.toMillis() - b.at.toMillis());
    for (const m of ann) { await postToGroup(`📣 *From ${firstName(m.name)}:*\n${m.text}`); log.push("whatsapp group: announcement"); }
  }
  next.feedAt = Date.now();
  patch.changes = next;
  return log;
}

/** Hourly: new deals, ladder levels unlocked, new enquiries / NFC orders. Holds everything during quiet hours. */
export async function hourlyGroupUpdates(db, now = new Date()) {
  const log = [];
  if (!waConfigured()) return log;
  if (quietHours(now) && !env.WA_FORCE) { log.push("whatsapp group: quiet hours, held"); return log; }
  const stateRef = db.doc("settings/waGroup");
  const state = (await stateRef.get()).data() || {};
  const since = state.lastWonAt?.toMillis ? state.lastWonAt.toMillis() : Date.now() - 2 * 3600e3;
  const patch = {};
  const today = perthDay(now), dow = new Date(`${today}T12:00:00+08:00`).getUTCDay(), hour = perthHour(now);
  const weekday = dow >= 1 && dow <= 5;
  // 🟢 9am shift start / 🔚 5pm day wrap (weekdays, once a day)
  if (weekday && hour >= 9 && hour < 11 && state.shiftDay !== today) {
    const msg = await shiftStart(db, now);
    if (msg) { await postToGroup(msg); log.push("whatsapp group: shift start"); }
    patch.shiftDay = today;
  }
  if (weekday && hour >= 17 && hour < 19 && state.wrapDay !== today) {
    const msg = await dayWrap(db, now);
    if (msg) { await postToGroup(msg); log.push("whatsapp group: day wrap"); }
    patch.wrapDay = today;
  }
  // 📣 team changes and announcements
  log.push(...await teamChanges(db, state, patch));
  // 🕐 1pm weekday check-in (once a day)
  if (perthHour(now) >= 13 && perthHour(now) < 15 && dow >= 1 && dow <= 5 && state.middayDay !== today) {
    const msg = await middayCheckIn(db, now);
    if (msg) { await postToGroup(msg); log.push("whatsapp group: midday check-in"); }
    patch.middayDay = today;
  }
  // 💰 deals
  const wins = (await db.collection("calls").where("status", "==", "Won").get()).docs.map((d) => d.data())
    .filter((c) => c.value > 0 && (c.createdAt?.toMillis?.() || 0) > since).sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  for (const c of wins) {
    await postToGroup(`💰 *Congratulations ${firstName(c.userName)}!* ${c.leadName} just signed${c.package ? ` the ${c.package} package` : ""} (${money(c.value)}).\nAnother business we get to help. Great work.`);
    patch.lastWonAt = c.createdAt;
    log.push(`whatsapp group: deal ${c.leadName}`);
  }
  // 🪜 ladder
  const st = await ladderState(db, now);
  if (st) {
    const unlocked = st.prog.filter((l) => l.unlocked).length;
    const first = !state.ladder; // first run: just remember where we are, don't replay old unlocks
    const before = state.ladder?.month === st.month ? state.ladder.n || 0 : 0;
    if (!first && unlocked > before) {
      for (const l of st.prog.filter((x) => x.unlocked && x.n > before)) await postToGroup(`🏆 *Team goal unlocked: ${l.prize}*\nLevel ${l.n} done. Everyone earned this one, thank you.`);
      log.push(`whatsapp group: ladder level ${unlocked}`);
    }
    patch.ladder = { month: st.month, n: unlocked };
  }
  // 🌐 enquiries & NFC orders (no contact details in the group; they're in Admin)
  const enq = (await db.collection("enquiries").where("status", "==", "new").get()).docs.filter((d) => !d.data().waPosted);
  for (const d of enq) {
    const q = d.data();
    const paid = /^NFC order PAID/i.test(q.package || "");
    await postToGroup(paid
      ? `💳 *New NFC order (paid):* ${q.business || q.name}${q.suburb ? `, ${q.suburb}` : ""}\nDetails are in Admin.`
      : `🌐 *New website enquiry:* ${q.business || q.name}${q.suburb ? `, ${q.suburb}` : ""}${q.package ? ` · wants ${q.package}` : ""}\nA quick callback wins these. Details are in Admin.`);
    if (!env.DRY_RUN) await d.ref.update({ waPosted: true });
    log.push(`whatsapp group: enquiry ${q.business || q.name}`);
  }
  if (!env.DRY_RUN && Object.keys(patch).length) await stateRef.set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return log;
}

// `node scripts/wa-group.mjs test` (the "WhatsApp group test" workflow): one message to prove the connection works
if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === "test") {
  if (!waConfigured()) { console.error("Missing GREEN_API_ID / GREEN_API_TOKEN secrets or WA_GROUP_NAME variable"); process.exit(1); }
  postToGroup("✅ *AR Methods team updates are connected.*\nYou'll get the morning scoreboard at 7:30am, a midday check-in on weekdays, and shout-outs when deals are signed.")
    .then(() => console.log(`posted to "${process.env.WA_GROUP_NAME || process.env.WA_GROUP_ID}"`))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
