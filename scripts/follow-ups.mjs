// Runs every hour (GitHub Actions):
//  1. 🌐 New website enquiries: emails Aman straight away and sends the business a "thanks, we'll call you" reply
//  2. 📧 Automatic follow-ups: leads marked Interested with an email get 4 emails over 10 days
//     (day 0, 2, 5, 10), weekdays 8am–6pm Perth only. They stop by themselves when the lead replies,
//     unsubscribes, or moves on from Interested (Won, Not interested, ...).
// Emails go out from Aman's Gmail (GMAIL_APP_PASSWORD). Replies land in that inbox.
// DRY_RUN=1 prints instead of sending.
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { randomBytes } from "node:crypto";
import { DEFAULT_PACKAGES } from "../src/extras.js";

const DRY = !!process.env.DRY_RUN;
const PROJECT = process.env.FIREBASE_PROJECT || "armethods";
const FROM = process.env.GMAIL_ADDRESS || "amanraju024@gmail.com";
export const SITE = "https://armethods.com";
const UNSUB_BASE = "https://armethods-perth.web.app"; // unsubscribe page (Firebase hosting, writes to Firestore)
const PHONE = "0493 523 482";
const INSTAGRAM = "https://www.instagram.com/ar.methods_/";
const STEP_DAYS = [0, 2, 5, 10];

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "$" + Math.round(n || 0).toLocaleString("en-AU");
const ms = (t) => (t?.toMillis ? t.toMillis() : t ? new Date(t).getTime() : 0);
const first = (s) => String(s || "").trim().split(/\s+/)[0] || "";
function perthClock(now) {
  const p = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Perth", weekday: "short", hour: "numeric", hour12: false }).formatToParts(now);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { weekday: get("weekday"), hour: Number(get("hour")) % 24 };
}
export const businessHours = (now) => { const c = perthClock(now); return !["Sat", "Sun"].includes(c.weekday) && c.hour >= 8 && c.hour < 18; };

/** The 4 follow-up emails. Short, friendly, signed by the worker who spoke to them. */
export function followUpEmail(step, lead, packages, unsubUrl) {
  const biz = lead.name;
  const hi = lead.contactName ? `Hi ${first(lead.contactName)},` : "Hi there,";
  const me = first(lead.followUp?.byName) || "The AR Methods team";
  const pk = packages.map((p) => `• ${p.name}, ${money(p.price)}: ${(p.items || []).slice(0, 3).join(", ")}`);
  const bodies = [
    { subject: `Your website, ${biz}`, lines: [hi, "",
      `Thanks for chatting with me today. As promised, here's what a website for ${biz} would look like with us.`, "",
      "We build simple, mobile-friendly websites for Perth businesses, so when people Google you they can see what you do and call you in one tap.", "",
      ...pk, "",
      `You can see more here: ${SITE}`, "",
      "Any questions, just reply to this email and we'll get straight back to you."] },
    { subject: `Quick question about ${biz}`, lines: [hi, "",
      `Just checking in. Did you get a chance to look at the website options I sent for ${biz}?`, "",
      "If something's holding you back (price, timing, not sure what you'd put on it), tell me and I'll sort it out. Most owners don't need to write anything, we put it together for you.", "",
      "Just reply to this email."] },
    { subject: `A few ideas for ${biz}`, lines: [hi, "",
      `I had a think about what would work best for ${biz}:`, "",
      "• A big \"Call now\" button, so people on their phone ring you straight away",
      "• Your Google reviews on the page, so new customers trust you",
      "• Your location and hours, so nobody has to message to ask", "",
      `Happy to put it together for you. ${packages[0] ? `It starts at ${money(packages[0].price)}.` : ""}`, "",
      "Just reply \"yes\" and we'll get started."] },
    { subject: `Should I close your file, ${biz}?`, lines: [hi, "",
      `I haven't heard back, so I'm guessing now isn't the right time for a website for ${biz}. No worries at all.`, "",
      "I'll stop emailing after this one. If you ever want to get it done, just reply to this email or call us and we'll pick it up from there.", "",
      "All the best with the business."] },
  ];
  const b = bodies[step];
  const sig = [`${me}`, "AR Methods · Web design, Perth WA", SITE];
  const text = [...b.lines, "", ...sig, "", `Don't want these emails? Unsubscribe: ${unsubUrl}`].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1d1a17;max-width:560px">
${b.lines.map((l) => (l ? `<p style="margin:0 0 4px">${esc(l).replace(/(https:\/\/[^\s]+)/g, '<a href="$1">$1</a>')}</p>` : `<div style="height:10px"></div>`)).join("\n")}
<div style="height:14px"></div>
<p style="margin:0"><b>${esc(me)}</b><br>AR Methods · Web design, Perth WA<br><a href="tel:+61${PHONE.replace(/\D/g, "").replace(/^0/, "")}">Call us</a> · <a href="${SITE}">${SITE.replace("https://", "")}</a> · <a href="${INSTAGRAM}">Instagram</a></p>
<p style="margin:22px 0 0;font-size:12px;color:#8a8178">You're getting this because you spoke with AR Methods about a website. <a href="${unsubUrl}" style="color:#8a8178">Unsubscribe</a></p></div>`;
  return { subject: b.subject, text, html, fromName: me === "The AR Methods team" ? "AR Methods" : `${me} at AR Methods` };
}

export function enquiryReply(q) {
  const hi = q.name ? `Hi ${first(q.name)},` : "Hi,";
  const lines = [hi, "", `Thanks for getting in touch with AR Methods${q.business ? ` about a website for ${q.business}` : ""}. We've got your message and someone from the team will call you soon${q.phone ? ` on ${q.phone}` : ""}.`, "",
    "If you have any questions in the meantime, just reply to this email.", "", "The AR Methods team", "Web design · Perth WA", SITE];
  return { subject: "Thanks, we got your enquiry", text: lines.join("\n") };
}

async function main() {
  initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: PROJECT } : { credential: applicationDefault(), projectId: PROJECT });
  const db = getFirestore();
  const now = new Date();
  const log = [];
  let mailer = null;
  const send = async (m) => {
    if (DRY || process.env.MAIL_LOG) { console.log(`---- TO ${m.to} (from ${m.fromName || "AR Methods"})\n${m.subject}\n\n${m.text}\n`); return; } // MAIL_LOG: tests, prints but keeps going
    if (!process.env.GMAIL_APP_PASSWORD) throw new Error("no GMAIL_APP_PASSWORD secret");
    if (!mailer) mailer = (await import("nodemailer")).default.createTransport({ service: "gmail", auth: { user: FROM, pass: process.env.GMAIL_APP_PASSWORD } });
    await mailer.sendMail({ from: `${m.fromName || "AR Methods"} <${FROM}>`, replyTo: FROM, to: m.to, subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) });
  };

  // 1. 🌐 new website enquiries
  const enq = (await db.collection("enquiries").where("status", "==", "new").get()).docs.filter((d) => !d.data().notified);
  for (const d of enq) {
    const q = d.data();
    try {
      await send({ to: process.env.BRIEF_EMAIL || FROM, fromName: "AR Methods website", subject: `🌐 New website enquiry: ${q.business || q.name}`,
        text: [`${q.name}${q.business ? ` from ${q.business}` : ""}${q.suburb ? ` (${q.suburb})` : ""} wants a website.`, "",
          q.phone ? `Phone: ${q.phone}` : "", q.email ? `Email: ${q.email}` : "", q.package ? `Package: ${q.package}` : "", q.message ? `\n"${q.message}"` : "", "",
          "Add it to your leads: https://armethods.web.app/#admin"].filter((l) => l !== "").join("\n") });
      if (q.email) await send({ to: q.email, fromName: "AR Methods", ...enquiryReply(q) });
      if (!DRY) await d.ref.update({ notified: true, notifiedAt: FieldValue.serverTimestamp() });
      log.push(`enquiry: ${q.business || q.name} handled`);
    } catch (e) { log.push(`enquiry: ${q.business || q.name} failed ${e.message}`); }
  }

  // 2. 📧 follow-ups (weekdays, business hours only)
  if (!businessHours(now) && !process.env.FORCE) { log.push("follow-ups: outside business hours, skipped"); }
  else {
    const leads = (await db.collection("leads").where("followUp.on", "==", true).get()).docs;
    const pkSnap = await db.doc("settings/packages").get();
    const packages = pkSnap.exists && pkSnap.data().list?.length ? pkSnap.data().list : DEFAULT_PACKAGES;
    let imap = null;
    const replied = async (email, since) => {
      if (DRY || process.env.MAIL_LOG || !process.env.GMAIL_APP_PASSWORD) return false;
      try {
        if (!imap) {
          const { ImapFlow } = await import("imapflow");
          imap = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: FROM, pass: process.env.GMAIL_APP_PASSWORD }, logger: false });
          await imap.connect();
        }
        const lock = await imap.getMailboxLock("INBOX");
        try { return ((await imap.search({ from: email, since: new Date(since) })) || []).length > 0; } finally { lock.release(); }
      } catch (e) { log.push(`reply check unavailable: ${e.message}`); imap = false; return false; }
    };
    for (const d of leads) {
      const l = d.data();
      const f = l.followUp || {};
      const stop = async (reason) => { if (!DRY) await d.ref.update({ "followUp.on": false, "followUp.reason": reason, "followUp.endedAt": FieldValue.serverTimestamp() }); log.push(`follow-up: ${l.name} stopped (${reason})`); };
      if (l.status !== "Interested") { await stop("status"); continue; }
      if ((await db.doc(`unsubs/${d.id}`).get()).exists) { await stop("unsubscribed"); continue; }
      if (f.step > 0 && imap !== false && await replied(l.email, ms(f.startedAt))) { await stop("replied"); continue; }
      const step = f.step || 0;
      if (step >= STEP_DAYS.length) { await stop("done"); continue; }
      if (now.getTime() < ms(f.startedAt) + STEP_DAYS[step] * 864e5) continue; // not due yet
      const token = f.token || randomBytes(18).toString("hex");
      const unsubUrl = `${UNSUB_BASE}/unsubscribe.html?u=${encodeURIComponent(d.id)}&t=${token}`;
      const m = followUpEmail(step, l, packages, unsubUrl);
      try {
        if (!f.token && !DRY) await d.ref.update({ "followUp.token": token }); // unsubscribe link must work before the email lands
        await send({ to: l.email, ...m });
        if (!DRY) await d.ref.update({ "followUp.step": step + 1, "followUp.lastSentAt": FieldValue.serverTimestamp(), ...(step + 1 >= STEP_DAYS.length ? { "followUp.on": false, "followUp.reason": "done" } : {}) });
        log.push(`follow-up: ${l.name} email ${step + 1} of ${STEP_DAYS.length} sent`);
      } catch (e) { log.push(`follow-up: ${l.name} failed ${e.message}`); }
    }
    if (imap) await imap.logout().catch(() => {});
    if (!leads.length) log.push("follow-ups: none running");
  }
  console.log(log.join("\n") || "nothing to do");
  if (log.some((r) => r.includes(" failed "))) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
