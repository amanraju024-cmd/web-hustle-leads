// Daily progress email for each worker, sent with the morning brief.
//  - Tue–Fri: how yesterday went against the daily goal, rank, commission, and who to call today
//  - Mon: last week's recap
//  - Sat/Sun: nothing (weekends off)
// The tone follows how they're going: on track → praise, close → push, quiet for days → check-in.
import { perthDay, addDays, weekStart, prettyDay, streakFrom } from "../src/util.js";
import { commissionFor } from "../src/extras.js";

const APP = "https://armethods.web.app";
const money = (n) => "$" + Math.round(n || 0).toLocaleString("en-AU");
const plural = (n, w, p = w + "s") => `${n} ${n === 1 ? w : p}`;
const ms = (t) => (t?.toMillis ? t.toMillis() : t ? new Date(t).getTime() : 0);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const weekday = (day) => new Date(`${day}T12:00:00+08:00`).getUTCDay(); // 0 Sun … 6 Sat

/** Builds one email per active worker. Returns [] on weekends. */
export async function buildWorkerEmails(db, now = new Date()) {
  const today = perthDay(now);
  const dow = weekday(today);
  if (dow === 0 || dow === 6) return [];
  const monday = dow === 1;
  // Monday looks back at last Mon–Fri; other days look at yesterday
  const from = monday ? addDays(today, -7) : addDays(today, -1);
  const to = monday ? addDays(today, -3) : from;
  const all = async (q) => (await q.get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const [users, team, recent, interested, callbacks, wonCalls] = await Promise.all([
    all(db.collection("users")),
    db.doc("settings/team").get().then((s) => (s.exists ? s.data() : {})),
    all(db.collection("stats").where("day", ">=", addDays(today, -30))),
    all(db.collection("leads").where("status", "==", "Interested")),
    all(db.collection("leads").where("status", "==", "Call back")),
    all(db.collection("calls").where("status", "==", "Won")),
  ]);
  const goal = team.dailyGoal || 30;
  const workers = users.filter((u) => u.active && u.role !== "admin" && u.email);
  const inRange = recent.filter((r) => r.day >= from && r.day <= to);
  // rank by points over the period, everyone who called
  const byUid = new Map();
  for (const r of inRange) {
    const c = byUid.get(r.uid) || { calls: 0, interested: 0, won: 0, points: 0 };
    c.calls += r.calls || 0; c.interested += r.interested || 0; c.won += r.won || 0; c.points += r.points || 0;
    byUid.set(r.uid, c);
  }
  const ranking = [...byUid.entries()].filter(([, c]) => c.calls > 0).sort((a, b) => b[1].points - a[1].points || b[1].calls - a[1].calls).map(([uid]) => uid);
  // payment status of won deals, for commission
  const ids = [...new Set(wonCalls.filter((c) => c.value > 0).map((c) => c.leadId))];
  const pay = new Map();
  for (let i = 0; i < ids.length; i += 30) {
    (await db.getAll(...ids.slice(i, i + 30).map((id) => db.collection("leads").doc(id)))).forEach((d) => d.exists && pay.set(d.id, d.data().payment || "unpaid"));
  }
  const monthStart = today.slice(0, 8) + "01";
  const endOfToday = new Date(`${addDays(today, 1)}T00:00:00+08:00`).getTime();
  const days = monday ? 5 : 1;

  return workers.map((u) => {
    const first = String(u.name || "").split(" ")[0] || "there";
    const me = byUid.get(u.id) || { calls: 0, interested: 0, won: 0, points: 0 };
    const target = goal * days;
    const rank = ranking.indexOf(u.id);
    const myDays = recent.filter((r) => r.uid === u.id && r.calls > 0).map((r) => r.day).sort();
    const lastDay = myDays[myDays.length - 1];
    const quietDays = lastDay ? Math.round((new Date(`${today}T12:00:00Z`) - new Date(`${lastDay}T12:00:00Z`)) / 864e5) : null;
    const streak = streakFrom(myDays, addDays(today, -1));
    const won = wonCalls.filter((c) => c.uid === u.id && c.value > 0 && c.day >= monthStart);
    const paid = won.filter((c) => pay.get(c.leadId) === "paid").reduce((n, c) => n + commissionFor(c.value), 0);
    const pending = won.filter((c) => pay.get(c.leadId) !== "paid").reduce((n, c) => n + commissionFor(c.value), 0);
    const due = callbacks.filter((l) => l.assignedTo === u.id && (!l.callbackAt || ms(l.callbackAt) < endOfToday));
    const cold = interested.filter((l) => l.assignedTo === u.id && ms(l.lastCalledAt) < now.getTime() - 3 * 864e5);
    const when = monday ? "last week" : "yesterday";

    // the headline depends on how they're tracking
    let mood, subject, opener;
    if (me.calls >= target) {
      mood = "great";
      subject = monday ? `🔥 Big week, ${first}: ${me.calls} calls` : `🔥 Goal smashed: ${me.calls} calls ${when}`;
      opener = me.won ? `You made ${plural(me.calls, "call")} and closed ${plural(me.won, "deal")} ${when}. That's exactly how it's done.`
        : `You made ${plural(me.calls, "call")} ${when} and hit the goal of ${target}. Keep that rhythm going, the sales follow the calls.`;
    } else if (me.calls > 0) {
      mood = "close";
      subject = monday ? `Your week: ${me.calls} of ${target} calls` : `${me.calls} of ${goal} calls ${when}. Let's finish strong today`;
      opener = `You made ${plural(me.calls, "call")} ${when}, ${target - me.calls} short of the ${monday ? "weekly" : "daily"} goal of ${target}. ${me.interested ? `You got ${plural(me.interested, "interested lead")} though, nice work. ` : ""}Today's a good day to catch up.`;
    } else if (quietDays == null || quietDays >= 3) {
      mood = "quiet";
      subject = quietDays == null ? `Ready to make your first calls, ${first}?` : `We haven't seen you in ${quietDays} days, ${first}`;
      opener = quietDays == null
        ? "You haven't made any calls yet. Open the app, go through the Start here guide, claim 20 businesses and make your first calls today. The first one is the hardest."
        : `Your last calls were ${quietDays} days ago. Everything all good? Even a short session of 10 calls today gets you back in the game. If something's stopping you, reply to this email.`;
    } else {
      mood = "restart";
      subject = monday ? `New week, fresh start, ${first}` : `No calls ${when}. Today's a fresh start`;
      opener = `There were no calls from you ${when}. No stress, today's a fresh start. Aim for ${goal} calls${due.length ? " and start with your call-backs" : ""}.`;
    }

    const todo = [];
    if (due.length) todo.push(`📞 Call back: ${due.slice(0, 5).map((l) => l.name).join(", ")}${due.length > 5 ? ` and ${due.length - 5} more` : ""}`);
    if (cold.length) todo.push(`🔥 Interested but going cold: ${cold.slice(0, 5).map((l) => l.name).join(", ")}${cold.length > 5 ? ` and ${cold.length - 5} more` : ""}`);
    todo.push(`🎯 ${goal} calls today`);
    const showStats = me.calls > 0;
    const stats = !showStats ? [] : [
      `Calls: ${me.calls} / ${target}`,
      `Interested: ${me.interested}`,
      `Won: ${me.won}`,
      `Points: ${me.points}${rank >= 0 ? ` (#${rank + 1} of ${ranking.length} on the team)` : ""}`,
      streak > 1 ? `Streak: ${streak} days in a row` : "",
    ].filter(Boolean);
    const earn = `Commission this month: ${money(paid)}${pending ? ` + ${money(pending)} pending (counts once the client pays in full)` : ""}`;
    const range = monday ? `${prettyDay(from)} to ${prettyDay(to)}` : prettyDay(from);

    const text = [
      `Hi ${first},`, "", opener, "",
      ...(showStats ? [`Your ${monday ? "week" : "day"} (${range})`, ...stats.map((s) => `• ${s}`), `• ${earn}`, ""] : paid + pending ? [earn, ""] : []),
      "Today", ...todo.map((s) => `• ${s}`), "",
      `Open the app: ${APP}`, "", "Aman", "AR Methods",
    ].join("\n");
    const accent = { great: "#2f8f5b", close: "#c48a1b", restart: "#9c1c30", quiet: "#9c1c30" }[mood];
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1d1a17;line-height:1.5">
  <div style="background:#5a0614;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0"><b style="letter-spacing:.12em">AR METHODS</b></div>
  <div style="border:1px solid #e7e1d8;border-top:0;border-radius:0 0 12px 12px;padding:20px">
    <p>Hi ${esc(first)},</p>
    <p style="border-left:4px solid ${accent};padding-left:12px">${esc(opener)}</p>
    ${showStats ? `<h3 style="margin:20px 0 6px;font-size:15px">Your ${monday ? "week" : "day"} <span style="color:#8a8178;font-weight:400">${esc(range)}</span></h3>
    <ul style="padding-left:18px;margin:0">${stats.map((s) => `<li>${esc(s)}</li>`).join("")}<li>${esc(earn)}</li></ul>` : paid + pending ? `<p>${esc(earn)}</p>` : ""}
    <h3 style="margin:20px 0 6px;font-size:15px">Today</h3>
    <ul style="padding-left:18px;margin:0">${todo.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
    <p style="margin:24px 0"><a href="${APP}" style="background:#e2b968;color:#1a0e07;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Open the app</a></p>
    <p style="color:#8a8178">Aman<br>AR Methods</p>
  </div></div>`;
    return { uid: u.id, name: u.name, to: u.email, mood, subject, text, html };
  });
}
