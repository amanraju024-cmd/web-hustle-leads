// Posts automatic updates into the team WhatsApp group through Green-API (free Developer plan).
// The owner's WhatsApp is linked to Green-API like WhatsApp Web, so posts appear as sent by the owner.
// Config (GitHub secrets/variables):
//   GREEN_API_ID, GREEN_API_TOKEN  from the Green-API console (instance)
//   GREEN_API_URL                  optional, the instance's apiUrl (e.g. https://7103.api.greenapi.com)
//   WA_GROUP_NAME                  exact WhatsApp group name, e.g. "AR Methods Team" (or WA_GROUP_ID: 1203...@g.us)
// Quiet hours: nothing is posted 9pm–7am Perth; held updates go out on the next run after 7am (WA_FORCE=1 ignores this, for tests).
import { FieldValue } from "firebase-admin/firestore";
import { perthDay, addDays, prettyDay } from "../src/util.js";
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

/** The morning scoreboard: team-safe numbers only (no client money owed, no contact details). */
export async function morningScoreboard(db, now = new Date()) {
  const today = perthDay(now), day = addDays(today, -1);
  const stats = (await db.collection("stats").where("day", "==", day).get()).docs.map((d) => d.data());
  const won = (await db.collection("calls").where("day", "==", day).where("status", "==", "Won").get()).docs.map((d) => d.data());
  const t = teamTotals(stats);
  const ranked = stats.filter((s) => s.calls > 0).sort((a, b) => (b.points || 0) - (a.points || 0) || b.calls - a.calls);
  const medals = ["🥇", "🥈", "🥉"];
  const lines = [
    `☀️ *AR Methods: ${prettyDay(day)}*`,
    t.calls ? `📞 ${t.calls} calls · 🔥 ${t.interested} interested · 💰 ${t.won} won` : "No calls logged yesterday. Fresh start today 💪",
    ...ranked.slice(0, 3).map((r, i) => `${medals[i]} ${String(r.name).split(" ")[0]}: ${r.calls} calls, ${r.points || 0} pts`),
    ...won.filter((c) => c.value > 0).map((c) => `🎉 ${String(c.userName || "").split(" ")[0]} closed ${c.leadName} (${money(c.value)})`),
  ];
  const ladder = await ladderLine(db, now);
  if (ladder) lines.push("", ladder);
  lines.push("", "Let's have a big one today 🚀");
  return lines.join("\n");
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
  if (!next) return "🏆 Team ladder: every level unlocked this month!";
  const m = LADDER_METRICS[next.metric], gap = Math.max(0, next.target - next.value);
  return `🪜 Next prize: *${next.prize}*, ${next.metric === "revenue" ? `${m.fmt(gap)} more in sales` : `${gap} more ${ladderUnit(m.label, gap)}`} to go`;
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
  // 💰 deals
  const wins = (await db.collection("calls").where("status", "==", "Won").get()).docs.map((d) => d.data())
    .filter((c) => c.value > 0 && (c.createdAt?.toMillis?.() || 0) > since).sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  for (const c of wins) {
    await postToGroup(`💰 *${String(c.userName || "Someone").split(" ")[0]} just closed ${c.leadName}!* ${money(c.value)}${c.package ? ` · ${c.package}` : ""}\nLet's get another one 🔥`);
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
      for (const l of st.prog.filter((x) => x.unlocked && x.n > before)) await postToGroup(`🪜🎉 *Level ${l.n} unlocked: ${l.prize}!*\nThe whole team earned this. Next level's waiting 👀`);
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
      : `🌐 *New website enquiry:* ${q.business || q.name}${q.suburb ? `, ${q.suburb}` : ""}${q.package ? ` · wants ${q.package}` : ""}\nQuick callback wins these. Details in Admin.`);
    if (!env.DRY_RUN) await d.ref.update({ waPosted: true });
    log.push(`whatsapp group: enquiry ${q.business || q.name}`);
  }
  if (!env.DRY_RUN && Object.keys(patch).length) await stateRef.set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return log;
}
