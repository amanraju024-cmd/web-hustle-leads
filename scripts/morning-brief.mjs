// Morning brief: runs every day at 7:30am Perth (GitHub Actions) and tells Aman what happened yesterday.
//  - 📞 rings his Telegram and reads the key numbers (CallMeBot, free)
//  - 💬 sends the full report as a Telegram message (CallMeBot, free)
//  - 🟢 sends the full report as a WhatsApp message (CallMeBot, free)
//  - 🔊 saves the spoken version to briefPublic/{speakKey} for the iPhone Shortcut that reads it out loud
//  - 📧 emails the report (Gmail, needs GMAIL_APP_PASSWORD secret)
//  - 📋 saves it to Firestore (briefs/latest) for the Admin page
//  - 👥 emails each worker their own progress (scripts/team-emails.mjs), weekdays only
// Settings live in Firestore settings/brief: { telegramUser, email, call, message, sendEmail, whatsapp, whatsappPhone, whatsappKey, speakKey, teamEmails }.
// DRY_RUN=1 prints everything instead of sending.
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { perthDay, addDays, weekStart, prettyDay } from "../src/util.js";
import { commissionFor, careStats, REFERRAL_REWARD } from "../src/extras.js";
import { buildWorkerEmails } from "./team-emails.mjs";

const DRY = !!process.env.DRY_RUN;
const PROJECT = process.env.FIREBASE_PROJECT || "armethods";
initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: PROJECT } : { credential: applicationDefault(), projectId: PROJECT });
const db = getFirestore();

const money = (n) => "$" + Math.round(n || 0).toLocaleString("en-AU");
const plural = (n, w, p = w + "s") => `${n} ${n === 1 ? w : p}`;
const ms = (t) => (t?.toMillis ? t.toMillis() : t ? new Date(t).getTime() : 0);

export async function buildBrief(now = new Date()) {
  const today = perthDay(now);
  const day = addDays(today, -1);
  const week = weekStart(day);
  const all = async (q) => (await q.get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const [users, stats, weekStats, interested, callbacks, wonCalls, plans, refs] = await Promise.all([
    all(db.collection("users")),
    all(db.collection("stats").where("day", "==", day)),
    all(db.collection("stats").where("week", "==", week)),
    all(db.collection("leads").where("status", "==", "Interested")),
    all(db.collection("leads").where("status", "==", "Call back")),
    all(db.collection("calls").where("status", "==", "Won")),
    all(db.collection("carePlans")),
    all(db.collection("leads").where("source", "==", "Referral")),
  ]);
  const active = users.filter((u) => u.active);
  const sum = (rows, k) => rows.reduce((n, r) => n + (r[k] || 0), 0);
  const team = { calls: sum(stats, "calls"), interested: sum(stats, "interested"), won: sum(stats, "won"), revenue: sum(stats, "revenue") };
  const ranked = stats.slice().sort((a, b) => b.points - a.points || b.calls - a.calls);
  const top = ranked[0];
  const idle = active.filter((u) => u.role !== "admin" && !stats.some((s) => s.uid === u.id && s.calls > 0)).map((u) => u.name);
  const weekCalls = sum(weekStats, "calls"), weekRevenue = sum(weekStats, "revenue");
  // money waiting: won deals not paid in full
  const wonLeadIds = [...new Set(wonCalls.filter((c) => c.value > 0).map((c) => c.leadId))];
  const pay = new Map();
  for (let i = 0; i < wonLeadIds.length; i += 30) {
    const snap = await db.getAll(...wonLeadIds.slice(i, i + 30).map((id) => db.collection("leads").doc(id)));
    snap.forEach((d) => d.exists && pay.set(d.id, d.data().payment || "unpaid"));
  }
  const unpaid = wonCalls.filter((c) => c.value > 0 && pay.get(c.leadId) !== "paid");
  const unpaidTotal = sum(unpaid, "value");
  const commissionOwed = wonCalls.filter((c) => c.value > 0 && pay.get(c.leadId) === "paid" && c.day >= today.slice(0, 8) + "01")
    .reduce((n, c) => n + commissionFor(c.value), 0);
  const cold = interested.filter((l) => ms(l.lastCalledAt) < now.getTime() - 3 * 864e5);
  const endOfToday = new Date(`${addDays(today, 1)}T00:00:00+08:00`).getTime();
  const dueToday = callbacks.filter((l) => !l.callbackAt || ms(l.callbackAt) < endOfToday);
  const care = careStats(plans, today);
  const careToday = care.dueSoon.filter((p) => p.due === today);
  const rewardsOwed = refs.filter((l) => (l.gotWon ?? l.status === "Won") && !l.referralRewardPaid).length;
  const deals = wonCalls.filter((c) => c.day === day && c.value > 0);

  // 📞 short version for the phone call (read out loud)
  const say = [
    `Good morning Aman. Here's your AR Methods update for ${prettyDay(day)}.`,
    team.calls ? `The team called ${plural(team.calls, "business", "businesses")}, got ${plural(team.interested, "interested lead")}, and closed ${plural(team.won, "deal")}${team.revenue ? ` worth ${money(team.revenue)}` : ""}.` : "Nobody made any calls yesterday.",
    top && top.calls ? `${top.name} led the way with ${plural(top.calls, "call")}.` : "",
    idle.length ? `${idle.join(" and ")} didn't make any calls.` : "",
    unpaidTotal ? `${money(unpaidTotal)} is still waiting to be paid.` : "",
    cold.length ? `${plural(cold.length, "interested lead")} ${cold.length === 1 ? "is" : "are"} going cold.` : "",
    dueToday.length ? `${plural(dueToday.length, "call back")} ${dueToday.length === 1 ? "is" : "are"} due today.` : "",
    "Have a big day.",
  ].filter(Boolean).join(" ");

  // 💬 / 📧 full version
  const lines = [
    `☀️ AR Methods morning brief, ${prettyDay(day)}`,
    "",
    `📞 Calls: ${team.calls}   🔥 Interested: ${team.interested}   💰 Won: ${team.won}${team.revenue ? ` (${money(team.revenue)})` : ""}`,
    `This week so far: ${weekCalls} calls, ${money(weekRevenue)} in sales`,
    "",
    ranked.length ? "🏆 Leaderboard (yesterday)" : "",
    ...ranked.slice(0, 8).map((r, i) => `${i + 1}. ${r.name}: ${r.calls} calls, ${r.interested} interested, ${r.won} won, ${r.points} pts`),
    idle.length ? `😴 No calls: ${idle.join(", ")}` : "",
    deals.length ? "" : "",
    ...(deals.length ? ["💵 Deals closed", ...deals.map((c) => `• ${c.leadName}: ${money(c.value)}${c.package ? ` (${c.package})` : ""} by ${c.userName}`)] : []),
    "",
    "📋 Today",
    `• Call-backs due: ${dueToday.length}`,
    `• Interested going cold (3+ days): ${cold.length}${cold.length ? ` (${cold.slice(0, 4).map((l) => l.name).join(", ")}${cold.length > 4 ? "…" : ""})` : ""}`,
    `• Waiting to be paid: ${money(unpaidTotal)} across ${plural(unpaid.length, "deal")}`,
    `• Commission owed this month (paid deals): ${money(commissionOwed)}`,
    `• Care plans: ${money(care.mrr)}/month from ${care.active} client${care.active === 1 ? "" : "s"}${careToday.length ? `, ${careToday.length} payment${careToday.length === 1 ? "" : "s"} due today` : ""}`,
    rewardsOwed ? `• Referral rewards to pay: ${money(rewardsOwed * REFERRAL_REWARD)}` : "",
    "",
    "Open the app: https://armethods.web.app",
  ].filter((l, i, a) => l !== "" || (a[i - 1] !== "" && i > 0));
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { day, today, say, text, team, top: top?.name || "", idle, unpaidTotal, cold: cold.length, dueToday: dueToday.length };
}

async function getJSON(url) {
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${body.slice(0, 200)}`);
  return body;
}

async function main() {
  const settingsSnap = await db.doc("settings/brief").get();
  const s = settingsSnap.exists ? settingsSnap.data() : {};
  const brief = await buildBrief();
  const results = [];
  const user = String(process.env.TELEGRAM_USER || s.telegramUser || "").trim().replace(/^@?/, "@");
  if (DRY) { console.log("---- CALL ----\n" + brief.say + "\n---- MESSAGE ----\n" + brief.text); }
  // 📞 Telegram call (CallMeBot reads the text out loud)
  if (user.length > 1 && s.call !== false) {
    const url = `https://api.callmebot.com/start.php?source=web&user=${encodeURIComponent(user)}&text=${encodeURIComponent(brief.say.slice(0, 900))}&lang=en-AU-Standard-B&rpt=2`;
    if (DRY) results.push("call: (dry run)");
    else try { await getJSON(url); results.push("call: ok"); } catch (e) { results.push("call: failed " + e.message); }
  }
  // 💬 Telegram message
  if (user.length > 1 && s.message !== false) {
    const url = `https://api.callmebot.com/text.php?user=${encodeURIComponent(user)}&text=${encodeURIComponent(brief.text.slice(0, 3500))}`;
    if (DRY) results.push("message: (dry run)");
    else try { if (s.call !== false) await new Promise((r) => setTimeout(r, 20000)); await getJSON(url); results.push("message: ok"); } catch (e) { results.push("message: failed " + e.message); }
  }
  // 🟢 WhatsApp message
  const waPhone = String(s.whatsappPhone || "").replace(/[^0-9]/g, "").replace(/^0/, "61");
  if (s.whatsapp !== false && waPhone && s.whatsappKey) {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${waPhone}&text=${encodeURIComponent(brief.text.slice(0, 3500))}&apikey=${encodeURIComponent(s.whatsappKey)}`;
    if (DRY) results.push("whatsapp: (dry run)");
    else try { await getJSON(url); results.push("whatsapp: ok"); } catch (e) { results.push("whatsapp: failed " + e.message); }
  }
  // 🔊 iPhone Shortcut reads this one out loud
  if (s.speakKey && !DRY) {
    const pub = db.collection("briefPublic");
    for (const d of (await pub.get()).docs) if (d.id !== s.speakKey) await d.ref.delete();
    await pub.doc(s.speakKey).set({ day: brief.day, say: brief.say, createdAt: FieldValue.serverTimestamp() });
    results.push("iphone: ready");
  }
  // 📧 Email (to Aman, then each worker)
  const to = s.email || process.env.BRIEF_EMAIL || "amanraju024@gmail.com";
  const from = process.env.GMAIL_ADDRESS || "amanraju024@gmail.com";
  let mailer = null;
  const mail = async (m) => {
    if (!mailer) mailer = (await import("nodemailer")).default.createTransport({ service: "gmail", auth: { user: from, pass: process.env.GMAIL_APP_PASSWORD } });
    return mailer.sendMail(m);
  };
  if (s.sendEmail !== false && process.env.GMAIL_APP_PASSWORD) {
    if (DRY) results.push("email: (dry run)");
    else try {
      await mail({ from: `AR Methods Brief <${from}>`, to, subject: `☀️ Morning brief: ${brief.team.calls} calls, ${brief.team.won} won (${prettyDay(brief.day)})`, text: brief.text });
      results.push("email: ok");
    } catch (e) { results.push("email: failed " + e.message); }
  } else results.push(process.env.GMAIL_APP_PASSWORD ? "email: off" : "email: skipped (no GMAIL_APP_PASSWORD secret)");
  // 👥 Each worker's progress email
  if (s.teamEmails !== false) {
    const emails = await buildWorkerEmails(db);
    if (DRY) { for (const m of emails) console.log(`---- TO ${m.to} (${m.mood}) ----\n${m.subject}\n\n${m.text}`); if (emails.length) results.push(`team emails: ${emails.length} (dry run)`); }
    else if (emails.length && !process.env.GMAIL_APP_PASSWORD) results.push("team emails: skipped (no GMAIL_APP_PASSWORD secret)");
    else if (emails.length) {
      let sent = 0; const bad = [];
      for (const m of emails) {
        try { await mail({ from: `Aman at AR Methods <${from}>`, replyTo: from, to: m.to, subject: m.subject, text: m.text, html: m.html }); sent++; }
        catch (e) { bad.push(`${m.name}: ${e.message}`); }
      }
      results.push(`team emails: ${sent} sent` + (bad.length ? `, failed ${bad.join("; ")}` : ""));
    }
  }
  // 📋 Save for the Admin page
  const doc = { ...brief, results, createdAt: FieldValue.serverTimestamp() };
  if (!DRY) { await db.doc("briefs/latest").set(doc); await db.doc(`briefs/${brief.day}`).set(doc); }
  console.log(results.join("\n"));
  if (results.some((r) => r.includes("failed"))) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
