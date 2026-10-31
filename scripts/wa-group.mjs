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
    const hof = hallOfFame(history.filter((r) => r.day >= lastWeek && r.day < weekStart(today)));
    if (hof.length) lines.push("", ...hof);
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

/** Hourly: new deals, ladder levels unlocked, new enquiries / NFC orders. Holds everything during quiet hours. */
export async function hourlyGroupUpdates(db, now = new Date()) {
  const log = [];
  if (!waConfigured()) return log;
  if (quietHours(now) && !env.WA_FORCE) { log.push("whatsapp group: quiet hours, held"); return log; }
  const stateRef = db.doc("settings/waGroup");
  const state = (await stateRef.get()).data() || {};
  const since = state.lastWonAt?.toMillis ? state.lastWonAt.toMillis() : Date.now() - 2 * 3600e3;
  const patch = {};
  // 🕐 1pm weekday check-in (once a day)
  const today = perthDay(now), dow = new Date(`${today}T12:00:00+08:00`).getUTCDay();
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
