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

// Written the way people actually talk on the phone in Perth: short, a question first, never a speech.
const HOOKS = {
  beauty: (sub) => `when someone in ${sub} wants a new hairdresser or nails done, they Google it and go with whoever has photos and a way to book. If you're not there, they never even find out how good you are`,
  food: (sub) => `people in ${sub} check the menu and hours on their phone before they head out. If they can't find it, they just go to the place that comes up first`,
  trades: (sub) => `when someone in ${sub} has water through the ceiling at 9pm, they Google it and ring whoever looks legit first. Right now that's probably someone else, not you`,
  health: (sub) => `new clients in ${sub} look you up and want to see your services and book before they ever pick up the phone`,
  other: (sub) => `most people in ${sub} look a business up on Google before they ring, and if there's nothing there they just move on to the next one`,
};
const FEATURES = {
  beauty: "your services and prices, photos of your work, your Google reviews and a Book button",
  food: "your menu, hours, photos, reviews and a map so people can find you",
  trades: "what you do, the suburbs you cover, your reviews and a big Call button",
  health: "your services, your team, reviews and online booking",
  other: "what you do, your reviews, your contact details and a Call button",
};
const PEOPLE = { beauty: "salons", food: "cafés and restaurants", trades: "tradies", health: "clinics", other: "local businesses" };

export function scriptFor(lead, me) {
  const g = groupOf(lead.category);
  const first = (me?.name || "").split(" ")[0] || "I";
  const sub = lead.suburb || "your area";
  const opener = `Hey, is that the owner of ${lead.name}? Sorry, I'll be quick. It's ${first} from AR Methods, we're a small web design team here in Perth. Have you got 30 seconds? You can tell me to rack off after.`;
  const close = `Easiest thing: I'll text you a couple of sites we've done for other ${PEOPLE[g]} and the price, and you have a look when you've got a minute. Or if it's easier, I can give you a ring back tomorrow. Which suits?`;
  if (lead.oldSite) {
    const why = (lead.oldSite.reasons || [])[0] || "looking a bit dated";
    const problem = /mobile/i.test(why) ? "on my phone it's really hard to use, the text is tiny and I had to zoom in. Most of your customers will be looking on their phone too"
      : /load/i.test(why) ? "it wasn't loading when I tried it, so anyone looking you up right now just hits a dead end"
      : /padlock|secure/i.test(why) ? "my browser flagged it as 'Not secure', and that warning puts a lot of people off before they even read anything"
      : /slow/i.test(why) ? "it took ages to load on my phone, and most people give up after a few seconds and ring the next place"
      : /free/i.test(why) ? "it's on one of those free website addresses, which honestly makes the business look smaller than it is"
      : "it's looking a bit dated next to the other places around you";
    return {
      opener,
      hook: `I was having a look at your website before I called, and ${problem}. Did you know that?`,
      offer: `That's what we do: we rebuild sites for local businesses so they're quick, look sharp on a phone, and keep all the stuff that's working for you now. It's a one-off price from $500 and we do all the writing, so there's basically nothing for you to do.`,
      close,
    };
  }
  return {
    opener,
    hook: `Quick question: if someone Googles ${lead.name}, what do they find? I couldn't see a website for you. The reason I ask is ${HOOKS[g](sub)}.`,
    offer: `We build simple websites for local businesses: ${FEATURES[g]}. It's a one-off price from $500, no lock-in, and we write everything for you, so you don't have to do anything except check it.`,
    close,
  };
}

export const OBJECTIONS = [
  ["“We don't need a website.” / “We're busy enough.”", "Fair enough, sounds like business is good. Most owners I talk to aren't chasing more work, they just don't want to lose the good jobs to whoever shows up on Google first. Can I text you an example anyway, so you've got it for when things go quiet?"],
  ["“How much?”", "Starts at $500, one-off, no monthly lock-in. That's the full site, written and set up for you. If you want us to look after it after that, it's from $10 a month, but that's optional."],
  ["“That's too expensive.”", "Totally get it. Think of it this way: what's one normal job or customer worth to you? For most people the site pays for itself with one or two extra customers. And it's one payment, not a monthly thing."],
  ["“We've got Facebook / Instagram.”", "Keep them, they're great for people who already follow you. The website is for the people who've never heard of you and Google something like a plumber near them. It links straight back to your socials."],
  ["“I'm busy right now.”", "No worries at all. Is tomorrow morning or tomorrow arvo better? I'll keep it to two minutes."],
  ["“Just send me some info.”", "Yep, easy. Is text or email better? I'll send two or three sites we've done and the prices, nothing long."],
  ["“We already have someone.” / “My nephew does it.”", "All good, that's handy. If it ever needs a refresh or they get too busy, we're around. Mind if I text you my details so you've got them?"],
  ["“Where did you get my number?”", "Fair question. It's on your Google listing. We're a local Perth team, I'm just calling businesses around here that don't have a site yet. Happy to text you our details so you can check us out."],
  ["“I'll think about it.”", "Course, no pressure. Do you want me to text you the examples so you can have a look first, or give you a ring back later in the week?"],
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
    { id: "examples", label: "Examples after a call", text: `Hey, it's ${(me?.name || "").split(" ")[0] || "us"} from AR Methods, thanks for the chat just now. Here's some of our work: armethods.com. Sites start at $500 one-off and we write everything for you. Have a look when you get a sec and let me know what you think.\n${sig}` },
    { id: "missed", label: "Missed call", text: `Hey, just tried giving ${lead.name} a call. We're a small Perth web design team and I noticed you don't have a website yet. No stress, when's a good time for a quick 2 minute chat?\n${sig}` },
    { id: "followup", label: "Follow up", text: `Hey, just checking in about the website for ${lead.name}. Did you get a chance to have a look at the examples? Happy to answer anything, even if it's a no.\n${sig}` },
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

