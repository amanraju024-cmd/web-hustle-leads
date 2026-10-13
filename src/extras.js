// Call scripts, badges and the weekly report.
import { addDays, streakFrom } from "./util.js";

// =====================================================================
// Call scripts (by trade) and objection handlers
// =====================================================================
const GROUPS = {
  beauty: ["Barber", "Hair salon", "Beauty salon", "Nail salon", "Massage", "Tattoo"],
  food: ["Cafe", "Restaurant", "Takeaway", "Bakery"],
  trades: ["Mechanic", "Plumber", "Electrician", "Builder", "Painter", "Landscaper / gardener", "Cleaner"],
  health: ["Dentist", "Physiotherapist", "Gym / fitness", "Pet groomer / pet shop"],
};
function groupOf(category) {
  const c = String(category || "").toLowerCase();
  for (const [g, list] of Object.entries(GROUPS)) if (list.some((x) => c.includes(x.toLowerCase().split(" ")[0]))) return g;
  if (/barber|hair|salon|beauty|nail|spa|massage|tattoo/.test(c)) return "beauty";
  if (/cafe|café|coffee|restaurant|food|bakery|takeaway|pizza|bar/.test(c)) return "food";
  if (/plumb|electric|build|paint|garden|landscap|clean|mechanic|repair|auto|roof|concret/.test(c)) return "trades";
  if (/dent|physio|gym|fitness|clinic|vet|pet|health/.test(c)) return "health";
  return "other";
}

const HOOKS = {
  beauty: "most people pick a salon by searching on Google and looking at photos, and right now they can't book you or see your work in one place",
  food: "people look up your menu and opening hours on Google before they come in, and right now there's nowhere for them to see it properly",
  trades: "when someone's pipes burst or power goes out, they Google a tradie and call the first one with a proper website, and right now that isn't you",
  health: "new patients and members check your services and book online before they ever call, and right now they can't do that with you",
  other: "most customers Google a business before they buy, and right now there's no proper website for them to land on",
};
const FEATURES = {
  beauty: "your services and prices, a gallery of your work, reviews, and a Book Now button",
  food: "your menu, opening hours, photos, reviews and a map",
  trades: "your services, the suburbs you cover, reviews, and a big Call Now button",
  health: "your services, team, reviews and online booking",
  other: "your services, reviews, contact details and a clear call to action",
};

export function scriptFor(lead, me) {
  const g = groupOf(lead.category);
  const first = (me?.name || "").split(" ")[0] || "I";
  if (lead.oldSite) {
    const why = (lead.oldSite.reasons || [])[0] || "looking a bit dated";
    const problem = /mobile/i.test(why) ? "it doesn't display properly on phones, and most of your customers are looking you up on their phone"
      : /load/i.test(why) ? "it wasn't loading when I tried it, so anyone searching for you right now hits a dead end"
      : /padlock|secure/i.test(why) ? "browsers mark it as 'Not secure', which scares a lot of customers off before they even read it"
      : /slow/i.test(why) ? "it's really slow on phones, and most people give up after a few seconds and call the next business"
      : /free/i.test(why) ? "it's on a free builder address, which makes the business look smaller than it is"
      : "it's looking a bit dated compared to other businesses nearby";
    return {
      opener: `Hi, is this the owner of ${lead.name}? My name's ${first}, I'm with AR Methods, a local Perth web design business. Have you got 30 seconds?`,
      hook: `I was looking at your website and noticed ${problem}.`,
      offer: `We rebuild websites for local businesses: modern, fast, works perfectly on phones, and we keep everything that's working for you now. I can put together a free mockup of what yours could look like.`,
      close: "Can I send that mockup to this number by text when it's ready? Who's the best person to put it under?",
    };
  }
  return {
    opener: `Hi, is this the owner of ${lead.name}? My name's ${first}, I'm with AR Methods, a local Perth web design business. Have you got 30 seconds?`,
    hook: `I noticed ${lead.name} doesn't have its own website. The reason I'm calling is ${HOOKS[g]}.`,
    offer: `I'd like to build you a free mockup website — ${FEATURES[g]}. No cost, no obligation. If you like it, we talk. If not, no worries.`,
    close: "Can I send the mockup to this number by text when it's ready? What's the best name to put it under?",
  };
}

export const OBJECTIONS = [
  ["“We don't need a website.”", "Totally fair. Most of your customers still Google you before they come in though. The mockup's free — if it doesn't look like it'd bring in work, you've lost nothing."],
  ["“It's too expensive.”", "That's why the mockup is free, so you can see it first. And one extra customer a month usually pays for the whole thing. What does an average customer spend with you?"],
  ["“We use Facebook / Instagram.”", "Love that, keep it. The website just catches the people who Google you and don't use Facebook, and it links straight to your page. It works with your socials, not instead of them."],
  ["“I'm busy right now.”", "No stress, I'll be quick: can I just text you the free mockup when it's ready? You can look whenever suits."],
  ["“Send me some information.”", "Better than that, I'll send you an actual mockup of your website. What's the best number or email for it?"],
  ["“We already have someone.”", "No worries. If they ever drop the ball, keep my number. Want me to send a free mockup anyway so you've got something to compare?"],
];

// =====================================================================
// Branding on everything clients see
// =====================================================================
export const BRAND = { name: "AR Methods", ceo: "Aman Raju", tagline: "Perth web design" };

/** Sign-off for texts: "— Sam, AR Methods (Perth web design) · link · phone" */
export function signature(me, brand = {}) {
  const first = (me?.name || "").split(" ")[0] || BRAND.ceo.split(" ")[0];
  const extras = [brand.brandLink, brand.brandPhone].filter(Boolean).join(" · ");
  return `— ${first}, ${BRAND.name} (${BRAND.tagline})${extras ? "\n" + extras : ""}`;
}

/** Ready-to-send texts for a lead, all signed AR Methods. */
export function textsFor(lead, me, brand) {
  const sig = signature(me, brand);
  return [
    { id: "mockup", label: "Mockup ready", text: `Hi! Your free website mockup for ${lead.name} is ready. Can I send you the link to have a look? No cost, no obligation.\n${sig}` },
    { id: "missed", label: "Missed call", text: `Hi, I just tried calling ${lead.name}. I build websites for local Perth businesses and I'd love to make you a free mockup. Is now a bad time? Happy to call back whenever suits.\n${sig}` },
    { id: "followup", label: "Follow up", text: `Hi, just following up on the website for ${lead.name}. Did you get a chance to look at the mockup? Keen to hear what you think.\n${sig}` },
    { id: "thanks", label: "Thanks (after a sale)", text: `Thanks for choosing ${BRAND.name} for ${lead.name}'s website! We'll be in touch with the next steps soon. If you know anyone else who needs a site, send them our way.\n${sig}` },
  ];
}

/** HTML credit for the footer of every client site. */
export function creditHtml(brand = {}) {
  const name = brand.brandLink ? `<a href="${brand.brandLink.replace(/"/g, "&quot;")}" style="color:inherit;font-weight:600" target="_blank" rel="noopener">${BRAND.name}</a>` : `<b>${BRAND.name}</b>`;
  return `<p style="text-align:center;font-size:13px;opacity:.75;margin:16px 0">Website by ${name} · ${BRAND.tagline}</p>`;
}

// NFC review cards: tap a phone on the card and the business's Google review page opens
export const NFC = {
  price: "$50 per card",
  pitch: "One more thing: most of our clients grab a couple of tap-to-review cards for the counter. Your customer taps their phone on the card and your Google review page pops up, so getting reviews takes them five seconds. They're $50 each. Want me to add one or two?",
  bundle: "If it helps, I can do the website plus a tap-to-review card for $550. The card gets you Google reviews from day one.",
  objection: ["“Do people actually use them?”", "Asking for a review is awkward, so most businesses never do it. With the card on the counter you just say “tap here if you were happy” and it opens straight to the review page. More reviews means you show up higher on Google."],
  text: (name, me, brand) => `Hi, quick one: we've started doing tap-to-review cards for ${name}. Customers tap their phone on the card at the counter and it opens your Google review page, so you get way more reviews. They're $50 each and I'll set it up for you. Keen?\n${signature(me, brand)}`,
};

export const AFTER_WON = {
  upsell: "Most of our clients add our care plan — we host it, keep it updated and fix anything, so you never have to think about it. Packages start from just $10 a month, up to $45 depending on what you need. Want me to add that on?",
  referral: "Really glad we're working together. Do you know any other business owners who don't have a website yet? I'll look after them the same way.",
  review: "Once it's live, would you mind leaving us a quick Google review? It really helps a small business like ours.",
};

// =====================================================================
// Badges
// =====================================================================
export const BADGES = [
  { id: "first-call", icon: "📞", name: "Off the mark", desc: "Log your first call", test: (t) => t.calls >= 1 },
  { id: "first-interested", icon: "🔥", name: "Hooked one", desc: "Get your first Interested", test: (t) => t.interested >= 1 },
  { id: "first-won", icon: "💰", name: "First blood", desc: "Close your first deal", test: (t) => t.won >= 1 },
  { id: "day-10", icon: "⚡", name: "Warmed up", desc: "10 calls in one day", test: (t) => t.bestDay >= 10 },
  { id: "goal", icon: "🎯", name: "Goal getter", desc: "Hit the daily goal", test: (t) => t.goalDays >= 1 },
  { id: "day-30", icon: "🚀", name: "Dialing machine", desc: "30 calls in one day", test: (t) => t.bestDay >= 30 },
  { id: "day-50", icon: "🦾", name: "Absolute unit", desc: "50 calls in one day", test: (t) => t.bestDay >= 50 },
  { id: "streak-3", icon: "📆", name: "Consistent", desc: "3-day calling streak", test: (t) => t.streak >= 3 },
  { id: "streak-7", icon: "🗓️", name: "Locked in", desc: "7-day calling streak", test: (t) => t.streak >= 7 },
  { id: "calls-100", icon: "💯", name: "Century", desc: "100 calls all-time", test: (t) => t.calls >= 100 },
  { id: "calls-500", icon: "🏛️", name: "Phone legend", desc: "500 calls all-time", test: (t) => t.calls >= 500 },
  { id: "won-5", icon: "🥊", name: "Closer", desc: "Close 5 deals", test: (t) => t.won >= 5 },
  { id: "won-10", icon: "👑", name: "Rainmaker", desc: "Close 10 deals", test: (t) => t.won >= 10 },
  { id: "rev-5k", icon: "💎", name: "$5K club", desc: "$5,000 in deals", test: (t) => t.revenue >= 5000 },
];

export function totalsFrom(rows, goal, today) {
  const t = { calls: 0, interested: 0, won: 0, revenue: 0, bestDay: 0, goalDays: 0, streak: 0 };
  for (const r of rows) {
    t.calls += r.calls; t.interested += r.interested; t.won += r.won; t.revenue += r.revenue || 0;
    t.bestDay = Math.max(t.bestDay, r.calls);
    if (r.calls >= goal) t.goalDays++;
  }
  t.streak = streakFrom(rows.filter((r) => r.calls > 0).map((r) => r.day), today);
  return t;
}
export const earnedBadges = (totals) => BADGES.filter((b) => b.test(totals));

const seenKey = (uid) => `arm_badges_${uid}`;
export function newBadges(uid, earned) {
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(seenKey(uid)) || "null"); } catch {}
  const ids = earned.map((b) => b.id);
  try { localStorage.setItem(seenKey(uid), JSON.stringify(ids)); } catch {}
  if (seen === null) return []; // first visit on this device: don't replay old badges
  return earned.filter((b) => !seen.includes(b.id));
}

// =====================================================================
// Weekly report
// =====================================================================
export function weeklyReport(rows, users, week) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const byUser = new Map();
  for (const r of rows) {
    if (!days.includes(r.day)) continue;
    const u = byUser.get(r.uid) || { uid: r.uid, name: r.name, calls: 0, interested: 0, won: 0, revenue: 0, points: 0, activeDays: 0, best: { day: "", calls: 0 } };
    u.calls += r.calls; u.interested += r.interested; u.won += r.won; u.revenue += r.revenue || 0; u.points += r.points;
    if (r.calls > 0) u.activeDays++;
    if (r.calls > u.best.calls) u.best = { day: r.day, calls: r.calls };
    byUser.set(r.uid, u);
  }
  for (const u of users) if (u.active && !byUser.has(u.id)) byUser.set(u.id, { uid: u.id, name: u.name, calls: 0, interested: 0, won: 0, revenue: 0, points: 0, activeDays: 0, best: { day: "", calls: 0 } });
  const list = [...byUser.values()].map((u) => ({ ...u, conversion: u.calls ? u.won / u.calls : 0 }))
    .sort((a, b) => b.points - a.points || b.calls - a.calls);
  const team = list.reduce((t, u) => ({ calls: t.calls + u.calls, interested: t.interested + u.interested, won: t.won + u.won, revenue: t.revenue + u.revenue }), { calls: 0, interested: 0, won: 0, revenue: 0 });
  return { week, days, list, team };
}

export const money = (n) => "$" + Math.round(n || 0).toLocaleString("en-AU");
export const pct = (x) => `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`;

// =====================================================================
// Commission: $100 for a deal of $500 or more, otherwise 10% of the deal
// =====================================================================
export const commissionFor = (value) => {
  const v = Number(value) || 0;
  if (v <= 0) return 0;
  return v >= 500 ? 100 : Math.round(v * 10) / 100;
};
export const commissionTotal = (calls) => calls.filter((c) => c.status === "Won").reduce((n, c) => n + commissionFor(c.value), 0);

// =====================================================================
// Lead score: busy, well-reviewed businesses with no website are the most likely to pay
// =====================================================================
export function leadScore(l) {
  if (!l.phone) return 0;
  let s = 40;
  const reviews = Number(l.reviews) || 0;
  s += Math.min(30, Math.round(Math.log10(reviews + 1) * 15)); // 10 reviews ≈ +15, 100 ≈ +30
  if (l.rating != null) s += l.rating >= 4.5 ? 10 : l.rating >= 4 ? 6 : l.rating >= 3.5 ? 2 : -5;
  s += l.websiteKind === "none" ? 20 : l.websiteKind === "social" ? 12 : 0;
  if (l.maybeSite) s -= 15;
  if (l.referredBy) s += 25; // a client vouched for us
  if (l.oldSite) s = Math.max(s, 40 + Math.round(l.oldSite.score / 2)); // redesign leads: how outdated the site is
  return Math.max(1, Math.min(99, s));
}
export const isHot = (score) => score >= 75;

// =====================================================================
// Best hours to call (Perth time), from logged calls
// =====================================================================
const perthHour = (d) => Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Perth", hour: "numeric", hour12: false }).format(d)) % 24;
export function bestHours(calls, toDateFn) {
  const hours = new Map();
  for (const c of calls) {
    const d = toDateFn(c.createdAt);
    if (!d) continue;
    const h = perthHour(d);
    const row = hours.get(h) || { hour: h, calls: 0, answered: 0, won: 0 };
    row.calls++;
    if (c.status !== "No answer") row.answered++;
    if (c.status === "Won" || c.status === "Interested") row.won++;
    hours.set(h, row);
  }
  const rows = [...hours.values()].sort((a, b) => a.hour - b.hour).map((r) => ({ ...r, rate: r.calls ? r.answered / r.calls : 0 }));
  const ranked = rows.filter((r) => r.calls >= 5).sort((a, b) => b.rate - a.rate);
  return { rows, best: ranked[0] || null };
}
export const hourLabel = (h) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;

// =====================================================================
// Care plans: monthly recurring income
// =====================================================================
// Care plans are packages from $10 to $45 a month
export const CARE_PRESETS = [10, 20, 30, 45];
export const CARE_DEFAULT = 10;

/** Number of billing dates from startDay up to and including today (billed on the start date each month). */
export function monthsBilled(startDay, endDay) {
  if (!startDay || startDay > endDay) return 0;
  const [sy, sm, sd] = startDay.split("-").map(Number);
  const [ey, em, ed] = endDay.split("-").map(Number);
  let n = (ey - sy) * 12 + (em - sm) + 1;
  const lastOfEndMonth = new Date(Date.UTC(ey, em, 0)).getUTCDate();
  if (ed < Math.min(sd, lastOfEndMonth)) n--;
  return Math.max(0, n);
}

/** Next billing date on or after `today` (YYYY-MM-DD), clamped to the month's last day. */
export function nextBillDay(startDay, today) {
  const sd = Number(startDay.slice(8, 10));
  let [y, m] = today.split("-").map(Number);
  for (let i = 0; i < 3; i++) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const day = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(sd, last)).padStart(2, "0")}`;
    if (day >= today && day >= startDay) return day;
    m++; if (m > 12) { m = 1; y++; }
  }
  return startDay;
}

export function careStats(plans, today) {
  const active = plans.filter((p) => p.status === "active");
  const mrr = active.reduce((n, p) => n + p.monthly, 0);
  const collected = plans.reduce((n, p) => n + p.monthly * monthsBilled(p.startDay, p.status === "cancelled" && p.cancelDay ? p.cancelDay : today), 0);
  const in7 = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })();
  const dueSoon = active.map((p) => ({ ...p, due: nextBillDay(p.startDay, today) })).filter((p) => p.due <= in7).sort((a, b) => a.due.localeCompare(b.due));
  const month = today.slice(0, 7);
  return { active: active.length, mrr, arr: mrr * 12, collected, dueSoon,
    cancelledThisMonth: plans.filter((p) => p.status === "cancelled" && (p.cancelDay || "").startsWith(month)).length,
    newThisMonth: plans.filter((p) => p.startDay.startsWith(month)).length };
}

// =====================================================================
// Payment on won deals: commission only counts once the client has paid in full
// =====================================================================
export const PAY_STEPS = [["unpaid", "Unpaid"], ["deposit", "Deposit paid"], ["paid", "Paid in full"]];
export const payOf = (lead) => (lead && PAY_STEPS.some(([k]) => k === lead.payment) ? lead.payment : "unpaid");
export const payLabel = (k) => (PAY_STEPS.find(([id]) => id === k) || PAY_STEPS[0])[1];
/** Splits commission on won calls into paid (client paid in full) and pending. */
export function commissionSplit(calls, paymentByLead) {
  let paid = 0, pending = 0;
  for (const c of calls) {
    if (c.status !== "Won" || !(c.value > 0)) continue;
    const amt = commissionFor(c.value);
    if (paymentByLead.get(c.leadId) === "paid") paid += amt; else pending += amt;
  }
  return { paid: Math.round(paid * 100) / 100, pending: Math.round(pending * 100) / 100 };
}

// =====================================================================
// Website packages (admin can edit these in Admin → Packages)
// =====================================================================
export const DEFAULT_PACKAGES = [
  { name: "Starter", price: 500, items: ["Mobile-friendly website (up to 5 pages)", "Click-to-call and contact form", "Google Maps and opening hours", "Basic Google search setup"] },
  { name: "Pro", price: 850, items: ["Everything in Starter", "Google Business Profile setup", "1 tap-to-review card", "Photo gallery and reviews section"] },
  { name: "Premium", price: 1200, items: ["Everything in Pro", "Online booking or enquiry system", "3 months care plan included", "Priority support"] },
];

// =====================================================================
// Referrals: a client who sends you a business that buys earns a reward
// =====================================================================
export const REFERRAL_REWARD = 50;
