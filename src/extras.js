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

export const AFTER_WON = {
  upsell: "Most of our clients add our care plan — we host it, keep it updated and fix anything for a small monthly fee, so you never have to think about it. Want me to add that on?",
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
