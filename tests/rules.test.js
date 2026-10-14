// Security rule tests. Run with: npm run test:rules (starts the Firestore + Auth emulators)
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { perthDay, weekStart } from "../src/util.js";
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, writeBatch, collection, getDocs, query, where,
  serverTimestamp, runTransaction,
} from "firebase/firestore";

let env;
const OWNER = { uid: "owner", email: "amanraju024@gmail.com" };

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-armethods",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});
after(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/owner"), { name: "Aman", email: OWNER.email, role: "admin", active: true });
    await setDoc(doc(db, "users/w1"), { name: "Sam", email: "sam@x.com", role: "worker", active: true });
    await setDoc(doc(db, "users/w2"), { name: "Jo", email: "jo@x.com", role: "worker", active: true });
    await setDoc(doc(db, "users/off"), { name: "Old", email: "old@x.com", role: "worker", active: false });
    await setDoc(doc(db, "settings/team"), { dailyGoal: 30 });
    await setDoc(doc(db, "leads/pool1"), lead({ name: "Pool Cafe", assignedTo: null, assignedName: "" }));
    await setDoc(doc(db, "leads/sam1"), lead({ name: "Sam Barber", assignedTo: "w1", assignedName: "Sam" }));
    await setDoc(doc(db, "claims/sam1"), { uid: "w1", name: "Sam" });
  });
});

function lead(extra) {
  return {
    name: "X", phone: "", address: "", suburb: "Willetton", category: "barber", website: "",
    websiteKind: "none", source: "osm", status: "New", notes: "", callbackAt: null, lastCalledAt: null,
    createdBy: "owner", ...extra,
  };
}
const as = (uid, email) => env.authenticatedContext(uid, email ? { email } : {}).firestore();

// ---------- accounts ----------
test("random sign-up with no profile can't read anything", async () => {
  const db = as("stranger");
  await assertFails(getDoc(doc(db, "settings/team")));
  await assertFails(getDoc(doc(db, "claims/sam1")));
  await assertFails(getDocs(collection(db, "stats")));
});

test("owner can bootstrap their admin profile, nobody else can", async () => {
  await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), "users/owner")));
  await assertFails(setDoc(doc(as("hacker", "hacker@x.com"), "users/hacker"), { name: "H", email: "hacker@x.com", role: "admin", active: true }));
  await assertSucceeds(setDoc(doc(as("owner", OWNER.email), "users/owner"), { name: "Aman", email: OWNER.email, role: "admin", active: true }));
});

test("workers can't make themselves admin or reactivate themselves", async () => {
  await assertFails(updateDoc(doc(as("w1"), "users/w1"), { role: "admin" }));
  await assertFails(updateDoc(doc(as("off"), "users/off"), { active: true }));
  await assertFails(setDoc(doc(as("w1"), "users/new"), { name: "N", email: "n@x.com", role: "worker", active: true }));
});

test("admin creates and deactivates workers but can't lock themselves out", async () => {
  const db = as("owner", OWNER.email);
  await assertSucceeds(setDoc(doc(db, "users/w3"), { name: "Lee", email: "lee@x.com", role: "worker", active: true }));
  await assertSucceeds(updateDoc(doc(db, "users/w1"), { active: false }));
  await assertFails(updateDoc(doc(db, "users/owner"), { active: false }));
  await assertFails(updateDoc(doc(db, "users/owner"), { role: "worker" }));
});

test("deactivated workers lose all access", async () => {
  const db = as("off");
  await assertFails(getDoc(doc(db, "settings/team")));
  await assertFails(getDoc(doc(db, "claims/sam1")));
});

test("users can read their own profile, only admin reads others", async () => {
  await assertSucceeds(getDoc(doc(as("w1"), "users/w1")));
  await assertFails(getDoc(doc(as("w1"), "users/w2")));
  await assertSucceeds(getDoc(doc(as("owner"), "users/w2")));
});

test("only admin changes the daily goal", async () => {
  await assertFails(setDoc(doc(as("w1"), "settings/team"), { dailyGoal: 1 }));
  await assertSucceeds(setDoc(doc(as("owner"), "settings/team"), { dailyGoal: 40 }));
  await assertFails(setDoc(doc(as("owner"), "settings/team"), { dailyGoal: 0 }));
});

// ---------- claiming ----------
async function claim(db, id, uid, name, data = {}) {
  const b = writeBatch(db);
  b.set(doc(db, `claims/${id}`), { uid, name });
  b.set(doc(db, `leads/${id}`), lead({ name: "New Biz", assignedTo: uid, assignedName: name, createdBy: uid, ...data }));
  return b.commit();
}

test("worker claims a new business with lead + claim together", async () => {
  await assertSucceeds(claim(as("w2"), "biz1", "w2", "Jo"));
});

test("second worker can't claim an already-claimed business", async () => {
  await assertSucceeds(claim(as("w2"), "biz1", "w2", "Jo"));
  await assertFails(claim(as("w1"), "biz1", "w1", "Sam"));
});

test("claiming in a transaction: loser sees it's taken", async () => {
  const dbA = as("w1"), dbB = as("w2");
  const tryClaim = (db, uid, name) => runTransaction(db, async (tx) => {
    const c = await tx.get(doc(db, "claims/race"));
    if (c.exists()) throw new Error("taken by " + c.data().name);
    tx.set(doc(db, "claims/race"), { uid, name });
    tx.set(doc(db, "leads/race"), lead({ name: "Race", assignedTo: uid, assignedName: name, createdBy: uid }));
  });
  const results = await Promise.allSettled([tryClaim(dbA, "w1", "Sam"), tryClaim(dbB, "w2", "Jo")]);
  assert1(results.filter((r) => r.status === "fulfilled").length === 1, "exactly one claim wins");
});

test("can't claim on behalf of someone else or without a claim doc", async () => {
  await assertFails(claim(as("w1"), "biz2", "w2", "Jo"));
  await assertFails(setDoc(doc(as("w1"), "leads/biz3"), lead({ assignedTo: "w1", assignedName: "Sam" })));
});

test("worker can claim an unassigned pool lead", async () => {
  const db = as("w2");
  const b = writeBatch(db);
  b.set(doc(db, "claims/pool1"), { uid: "w2", name: "Jo" });
  b.update(doc(db, "leads/pool1"), { assignedTo: "w2", assignedName: "Jo" });
  await assertSucceeds(b.commit());
});

test("worker can't take another worker's lead", async () => {
  await assertFails(updateDoc(doc(as("w2"), "leads/sam1"), { assignedTo: "w2", assignedName: "Jo" }));
  await assertFails(deleteDoc(doc(as("w2"), "claims/sam1")));
});

test("workers only see their own leads; everyone sees claims", async () => {
  await assertSucceeds(getDoc(doc(as("w1"), "leads/sam1")));
  await assertFails(getDoc(doc(as("w2"), "leads/sam1")));
  await assertSucceeds(getDoc(doc(as("w2"), "leads/pool1")));   // unassigned pool lead: readable so it can be claimed safely
  await assertSucceeds(getDoc(doc(as("w2"), "leads/does-not-exist")));
  await assertFails(getDoc(doc(as("off"), "leads/pool1")));
  await assertSucceeds(getDocs(query(collection(as("w1"), "leads"), where("assignedTo", "==", "w1"))));
  await assertFails(getDocs(collection(as("w1"), "leads")));
  await assertSucceeds(getDoc(doc(as("w2"), "claims/sam1")));
  await assertSucceeds(getDocs(collection(as("owner"), "leads")));
});

test("worker edits only notes/callback on their lead (status changes need a logged call)", async () => {
  const db = as("w1");
  await assertSucceeds(updateDoc(doc(db, "leads/sam1"), { notes: "call after 2" }));
  await assertFails(updateDoc(doc(db, "leads/sam1"), { notes: "call after 2", status: "Call back" }));
  await assertFails(updateDoc(doc(db, "leads/sam1"), { phone: "000" }));
  await assertFails(updateDoc(doc(db, "leads/sam1"), { status: "Paid" }));
});

test("admin can assign, reassign and unassign", async () => {
  const db = as("owner");
  const b = writeBatch(db);
  b.update(doc(db, "leads/sam1"), { assignedTo: "w2", assignedName: "Jo" });
  b.set(doc(db, "claims/sam1"), { uid: "w2", name: "Jo" });
  await assertSucceeds(b.commit());
  const b2 = writeBatch(db);
  b2.update(doc(db, "leads/sam1"), { assignedTo: null, assignedName: "" });
  b2.delete(doc(db, "claims/sam1"));
  await assertSucceeds(b2.commit());
});

// ---------- calls and stats ----------
const TODAY = perthDay();
const WEEK = weekStart(TODAY);
// Mirrors data.js logCall: lead + call + stats in one write. `lead` is the lead's state before the call.
function logCall(db, { uid = "w1", name = "Sam", leadId = "sam1", status = "No answer", callId = "c1",
  day = TODAY, week = WEEK, prev = null, lead: before = {}, value, callOverride = {}, statOverride = {}, leadOverride = {} } = {}) {
  const hadI = before.gotInterested ?? (before.status === "Interested" || before.status === "Won");
  const hadW = before.gotWon ?? before.status === "Won";
  const counted = before.countedDay !== day ? 1 : 0;
  const bonusI = status === "Interested" && !hadI ? 1 : 0;
  const bonusW = status === "Won" && !hadW ? 1 : 0;
  const v = bonusW ? (value ?? 500) : 0;
  const b = writeBatch(db);
  b.update(doc(db, `leads/${leadId}`), { status, notes: "n", callbackAt: null, lastCalledAt: serverTimestamp(), updatedAt: serverTimestamp(),
    lastCallId: callId, countedDay: day, gotInterested: hadI || status === "Interested", gotWon: hadW || status === "Won", ...leadOverride });
  b.set(doc(db, `calls/${callId}`), { leadId, leadName: "Sam Barber", uid, userName: name, status, notes: "n",
    counted, bonusI, bonusW, points: counted + 3 * bonusI + 10 * bonusW, day, week, createdAt: serverTimestamp(), ...(bonusW ? { value: v } : {}), ...callOverride });
  const base = prev || { calls: 0, interested: 0, won: 0, revenue: 0 };
  const calls = base.calls + counted, interested = base.interested + bonusI, won = base.won + bonusW;
  b.set(doc(db, `stats/${day}_${uid}`), { uid, name, day, week, calls, interested, won, points: calls + 3 * interested + 10 * won,
    lastCallId: callId, revenue: (base.revenue || 0) + v, ...statOverride });
  return b.commit();
}
const statNow = async (db, uid = "w1") => (await getDoc(doc(db, `stats/${TODAY}_${uid}`))).data();

test("worker logs calls and their stats update", async () => {
  const db = as("w1");
  await assertSucceeds(logCall(db, { status: "Interested", callId: "c1" }));
  const s = await statNow(db);
  assert1(s.calls === 1 && s.interested === 1 && s.points === 4, "1 call + Interested = 4 points");
});

test("fair points: a lead counts once a day; Interested and Won bonuses once per lead", async () => {
  const db = as("w1");
  await assertSucceeds(logCall(db, { status: "No answer", callId: "c1" }));
  // same lead again today: saved, but no call or point
  await assertSucceeds(logCall(db, { status: "No answer", callId: "c2", lead: { status: "No answer", countedDay: TODAY }, prev: { calls: 1, interested: 0, won: 0 } }));
  // Interested later today: +3 once
  await assertSucceeds(logCall(db, { status: "Interested", callId: "c3", lead: { status: "No answer", countedDay: TODAY }, prev: { calls: 1, interested: 0, won: 0 } }));
  await assertSucceeds(logCall(db, { status: "Interested", callId: "c4", lead: { status: "Interested", countedDay: TODAY, gotInterested: true }, prev: { calls: 1, interested: 1, won: 0 } }));
  let s = await statNow(db);
  assert1(s.calls === 1 && s.interested === 1 && s.points === 4, `repeat taps don't add (got ${JSON.stringify(s)})`);
  await assertSucceeds(logCall(db, { status: "Won", callId: "c5", value: 800, lead: { status: "Interested", countedDay: TODAY, gotInterested: true }, prev: { calls: 1, interested: 1, won: 0, revenue: 0 } }));
  await assertSucceeds(logCall(db, { status: "Won", callId: "c6", value: 800, lead: { status: "Won", countedDay: TODAY, gotInterested: true, gotWon: true }, prev: { calls: 1, interested: 1, won: 1, revenue: 800 } }));
  s = await statNow(db);
  assert1(s.won === 1 && s.revenue === 800 && s.points === 14, `Won counts once (got ${JSON.stringify(s)})`);
});

test("can't claim points the lead already earned", async () => {
  const db = as("w1");
  await assertSucceeds(logCall(db, { status: "Won", callId: "c1", value: 500 }));
  const won = { status: "Won", countedDay: TODAY, gotInterested: false, gotWon: true };
  const prev = { calls: 1, interested: 0, won: 1, revenue: 500 };
  // pretend the lead was never won / never called today
  await assertFails(logCall(db, { status: "Won", callId: "c2", value: 500, lead: { ...won, gotWon: false }, prev }));
  await assertFails(logCall(db, { status: "No answer", callId: "c3", lead: { ...won, countedDay: "" }, prev }));
  // reset the lead's flags while logging
  await assertFails(logCall(db, { status: "Not interested", callId: "c4", lead: won, prev, leadOverride: { gotWon: false } }));
});

test("leads that were Interested before this update don't earn the bonus again", async () => {
  await updateDoc(doc(as("owner"), "leads/sam1"), { status: "Interested" }); // old lead: no flags yet
  const db = as("w1");
  await assertFails(logCall(db, { status: "Interested", callId: "c1", lead: { status: "New" } }));      // pretends it's fresh
  await assertSucceeds(logCall(db, { status: "Interested", callId: "c2", lead: { status: "Interested" } })); // counts the call only
  const s = await statNow(db);
  assert1(s.calls === 1 && s.interested === 0 && s.points === 1, "call counted, no repeat bonus");
});

test("can't backdate or forward-date calls", async () => {
  const db = as("w1");
  await assertFails(logCall(db, { day: "2026-01-05", week: "2026-01-05" }));
  await assertFails(logCall(db, { week: "2026-01-05" }));
});

test("status only changes together with a logged call; notes alone are fine", async () => {
  const db = as("w1");
  await assertFails(updateDoc(doc(db, "leads/sam1"), { status: "Won", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, "leads/sam1"), { gotWon: false }));
  await assertSucceeds(updateDoc(doc(db, "leads/sam1"), { notes: "spoke to Dave", updatedAt: serverTimestamp() }));
});

test("can't inflate stats", async () => {
  const db = as("w1");
  await assertFails(logCall(db, { statOverride: { calls: 5, points: 5 } }));
  await assertFails(logCall(db, { status: "No answer", statOverride: { won: 1, points: 11 } }));
  await assertFails(logCall(db, { status: "Won", callOverride: { points: 50 } }));
  await assertFails(logCall(db, { status: "No answer", callOverride: { counted: 0, points: 0 }, statOverride: { calls: 1, points: 1 } }));
  await assertFails(logCall(db, { statOverride: { name: "Aman Raju" } }));
});

test("can't reuse an old call to bump stats again", async () => {
  const db = as("w1");
  await assertSucceeds(logCall(db, { callId: "c1" }));
  const b = writeBatch(db);
  b.set(doc(db, `stats/${TODAY}_w1`), { uid: "w1", name: "Sam", day: TODAY, week: WEEK, calls: 2, interested: 0, won: 0, points: 2, lastCallId: "c1" });
  await assertFails(b.commit());
});

test("can't log calls on someone else's lead or as someone else", async () => {
  await assertFails(logCall(as("w2"), { uid: "w2", name: "Jo", leadId: "sam1" }));
  await assertFails(logCall(as("w2"), { uid: "w1", name: "Sam" }));
});

test("leaderboard stats readable by all active users; calls private", async () => {
  await assertSucceeds(logCall(as("w1"), { callId: "c1" }));
  await assertSucceeds(getDocs(collection(as("w2"), "stats")));
  await assertFails(getDoc(doc(as("w2"), "calls/c1")));
  await assertSucceeds(getDoc(doc(as("w1"), "calls/c1")));
  await assertSucceeds(getDoc(doc(as("owner"), "calls/c1")));
});

// ---------- searches and events ----------
test("searches and events: create own, admin reads all", async () => {
  await assertSucceeds(setDoc(doc(as("w1"), "searches/s1"), { uid: "w1", suburb: "Willetton" }));
  await assertFails(setDoc(doc(as("w1"), "searches/s2"), { uid: "w2", suburb: "Willetton" }));
  await assertSucceeds(setDoc(doc(as("w1"), "events/e1"), { uid: "w1", text: "searched" }));
  await assertFails(getDoc(doc(as("w1"), "events/e1")));
  await assertSucceeds(getDoc(doc(as("owner"), "events/e1")));
  await assertFails(getDoc(doc(as("w2"), "searches/s1")));
});

// ---------- Google Maps connection + shared search cache ----------
test("only admin sets the Google Maps token; active team members can read it", async () => {
  await assertSucceeds(setDoc(doc(as("owner"), "settings/integrations"), { apifyToken: "apify_api_x" }));
  await assertFails(setDoc(doc(as("w1"), "settings/integrations"), { apifyToken: "mine" }));
  await assertSucceeds(getDoc(doc(as("w1"), "settings/integrations")));
  await assertFails(getDoc(doc(as("stranger"), "settings/integrations")));
  await assertFails(getDoc(doc(as("off"), "settings/integrations")));
});

test("search cache: active users read/write their own entries only", async () => {
  await assertSucceeds(setDoc(doc(as("w1"), "searchCache/k1"), { uid: "w1", leads: [{ name: "A" }] }));
  await assertSucceeds(getDoc(doc(as("w2"), "searchCache/k1")));
  await assertFails(setDoc(doc(as("w1"), "searchCache/k2"), { uid: "w2", leads: [] }));
  await assertFails(setDoc(doc(as("stranger"), "searchCache/k3"), { uid: "stranger", leads: [] }));
});

// ---------- deal values, commission, celebrations ----------
test("Won calls carry a deal value that adds to revenue", async () => {
  const db = as("w1");
  await assertSucceeds(logCall(db, { status: "Won", callId: "c1", value: 750 }));
  const s = await statNow(db);
  assert1(s.revenue === 750, "revenue = deal value");
});

test("can't fake revenue", async () => {
  const db = as("w1");
  await assertFails(logCall(db, { status: "Won", value: 500, statOverride: { revenue: 99999 } }));
  await assertFails(logCall(db, { status: "No answer", statOverride: { revenue: 500 } }));
  await assertFails(logCall(db, { status: "No answer", callOverride: { value: 500 } }));
  await assertFails(logCall(db, { status: "Won", value: 1000000 }));
});

test("commission % is admin-only and 0-100", async () => {
  await assertSucceeds(setDoc(doc(as("owner"), "settings/team"), { dailyGoal: 30, commissionPct: 15 }));
  await assertFails(setDoc(doc(as("owner"), "settings/team"), { dailyGoal: 30, commissionPct: 150 }));
  await assertFails(setDoc(doc(as("w1"), "settings/team"), { dailyGoal: 30, commissionPct: 90 }));
});

test("celebrations: post your own, everyone active sees them", async () => {
  await assertSucceeds(setDoc(doc(as("w1"), "celebrations/x1"), { uid: "w1", type: "won", text: "Sam just closed a deal" }));
  await assertFails(setDoc(doc(as("w1"), "celebrations/x2"), { uid: "w2", type: "won", text: "fake" }));
  await assertFails(setDoc(doc(as("w1"), "celebrations/x3"), { uid: "w1", type: "spam", text: "x" }));
  await assertSucceeds(getDoc(doc(as("w2"), "celebrations/x1")));
  await assertFails(getDoc(doc(as("off"), "celebrations/x1")));
});

function assert1(cond, msg) { if (!cond) throw new Error("Assertion failed: " + msg); }

test("brand link and phone: admin only, sensible lengths", async () => {
  await assertSucceeds(setDoc(doc(as("owner"), "settings/team"), { dailyGoal: 30, brandLink: "https://instagram.com/armethods", brandPhone: "0400 000 000" }));
  await assertFails(setDoc(doc(as("owner"), "settings/team"), { dailyGoal: 30, brandLink: "x".repeat(201) }));
  await assertFails(setDoc(doc(as("owner"), "settings/team"), { dailyGoal: 30, brandPhone: 400 }));
  await assertFails(setDoc(doc(as("w1"), "settings/team"), { dailyGoal: 30, brandLink: "https://evil.example" }));
});

test("team chat: post as yourself only, no editing, admin can delete", async () => {
  const msgs = (uid) => collection(as(uid), "messages");
  await assertSucceeds(addDoc(msgs("w1"), { uid: "w1", name: "Sam", role: "worker", text: "Just closed one!", at: serverTimestamp() }));
  await assertFails(addDoc(msgs("w1"), { uid: "owner", name: "Aman Raju", role: "admin", text: "fake boss", at: serverTimestamp() }));
  await assertFails(addDoc(msgs("w1"), { uid: "w1", name: "Aman Raju", role: "admin", text: "fake boss", at: serverTimestamp() }));
  await assertFails(addDoc(msgs("w1"), { uid: "w1", name: "Sam", role: "worker", text: "", at: serverTimestamp() }));
  await assertFails(addDoc(msgs("w1"), { uid: "w1", name: "Sam", role: "worker", text: "x".repeat(1001), at: serverTimestamp() }));
  await setDoc(doc(as("w1"), "messages/m1"), { uid: "w1", name: "Sam", role: "worker", text: "hi", at: serverTimestamp() });
  await assertFails(updateDoc(doc(as("w1"), "messages/m1"), { text: "edited" }));
  await assertFails(deleteDoc(doc(as("w1"), "messages/m1")));
  await assertSucceeds(deleteDoc(doc(as("owner"), "messages/m1")));
  await assertSucceeds(getDocs(msgs("w1")));
});

test("care plans: workers record their own, only admin sees all and edits", async () => {
  const plan = (o = {}) => ({ client: "Fade Factory", leadId: "sam1", monthly: 49, startDay: "2026-10-13", status: "active", cancelDay: "", notes: "", soldBy: "w1", soldByName: "Sam", createdAt: serverTimestamp(), ...o });
  await assertSucceeds(setDoc(doc(as("w1"), "carePlans/c1"), plan()));
  await assertFails(setDoc(doc(as("w1"), "carePlans/c2"), plan({ soldBy: "w2", soldByName: "Jo" })));
  await assertFails(setDoc(doc(as("w1"), "carePlans/c3"), plan({ monthly: 0 })));
  await assertFails(setDoc(doc(as("w1"), "carePlans/c4"), plan({ status: "cancelled" })));
  await assertFails(setDoc(doc(as("w1"), "carePlans/c5"), plan({ startDay: "tomorrow" })));
  await assertSucceeds(getDoc(doc(as("w1"), "carePlans/c1")));
  await assertFails(getDocs(collection(as("w2"), "carePlans")));
  await assertSucceeds(getDocs(collection(as("owner"), "carePlans")));
  await assertFails(updateDoc(doc(as("w1"), "carePlans/c1"), { monthly: 1 }));
  await assertSucceeds(updateDoc(doc(as("owner"), "carePlans/c1"), { status: "cancelled", cancelDay: "2026-11-01" }));
  await assertFails(updateDoc(doc(as("owner"), "carePlans/c1"), { soldBy: "w2" }));
  await assertSucceeds(deleteDoc(doc(as("owner"), "carePlans/c1")));
});

test("admin can correct a won deal's amount; workers can't", async () => {
  await assertSucceeds(logCall(as("w1"), { status: "Won", callId: "c1", value: 500 }));
  const fix = (db, value, extra = {}) => {
    const b = writeBatch(db);
    b.update(doc(db, "calls/c1"), { value, editedBy: db === undefined ? "" : extra.by ?? "owner", editedAt: serverTimestamp(), ...extra.call });
    b.update(doc(db, `stats/${TODAY}_w1`), { revenue: value, ...extra.stat });
    return b.commit();
  };
  await assertFails(fix(as("w1"), 5000, { by: "w1" }));
  await assertFails(fix(as("owner"), 800, { call: { status: "No answer" } }));
  await assertFails(fix(as("owner"), 800, { stat: { points: 999 } }));
  await assertSucceeds(fix(as("owner"), 800));
  const c = await getDoc(doc(as("owner"), "calls/c1"));
  assert1(c.data().value === 800, "amount corrected");
});

test("only admin marks a deal as paid", async () => {
  await assertFails(updateDoc(doc(as("w1"), "leads/sam1"), { payment: "paid", paymentAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(as("owner"), "leads/sam1"), { payment: "deposit", paymentAt: serverTimestamp(), updatedAt: serverTimestamp() }));
});

test("presence: everyone updates their own heartbeat, only admin sees who's live", async () => {
  const beat = (uid, o = {}) => setDoc(doc(as(uid), `presence/${uid}`), { name: "Sam", page: "leads", visible: true, at: serverTimestamp(), ...o });
  await assertSucceeds(beat("w1"));
  await assertFails(setDoc(doc(as("w1"), "presence/w2"), { name: "Jo", page: "leads", visible: true, at: serverTimestamp() }));
  await assertFails(beat("w1", { name: "Aman" }));
  await assertFails(beat("off", { name: "Old" }));
  await assertFails(getDoc(doc(as("w2"), "presence/w1")));
  await assertSucceeds(getDoc(doc(as("owner"), "presence/w1")));
});

test("packages: everyone reads, only admin edits", async () => {
  const list = [{ name: "Starter", price: 500, items: ["Site"] }];
  await assertSucceeds(setDoc(doc(as("owner"), "settings/packages"), { list }));
  await assertFails(setDoc(doc(as("w1"), "settings/packages"), { list }));
  await assertSucceeds(getDoc(doc(as("w1"), "settings/packages")));
});

test("won calls can record the package; other results can't", async () => {
  await assertSucceeds(logCall(as("w1"), { status: "Won", callId: "c1", value: 850, callOverride: { package: "Pro" } }));
});
test("package only on Won calls", async () => {
  await assertFails(logCall(as("w1"), { status: "Interested", callId: "c2", callOverride: { package: "Pro" } }));
});

test("site checks: shared by the team, must look like a check", async () => {
  const ok = { url: "http://a.com", score: 65, reasons: ["Not mobile-friendly"], mobile: false, speed: 20, https: false, full: true, checkedAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(as("w1"), "siteChecks/a.com"), ok));
  await assertSucceeds(getDoc(doc(as("w2"), "siteChecks/a.com")));
  await assertFails(setDoc(doc(as("w1"), "siteChecks/b.com"), { ...ok, score: 500 }));
  await assertFails(setDoc(doc(as("w1"), "siteChecks/c.com"), { ...ok, hacked: true }));
  await assertFails(setDoc(doc(as("stranger"), "siteChecks/d.com"), ok));
});

test("integrations: admin saves the website-check key without wiping the Google token", async () => {
  await assertSucceeds(setDoc(doc(as("owner"), "settings/integrations"), { apifyToken: "apify_api_x" }));
  await assertSucceeds(setDoc(doc(as("owner"), "settings/integrations"), { pageSpeedKey: "AIzaTEST" }, { merge: true }));
  await assertFails(setDoc(doc(as("w1"), "settings/integrations"), { pageSpeedKey: "AIzaMINE" }, { merge: true }));
});

test("break game: rounds must be earned with calls; scores can't be faked", async () => {
  const id = `${TODAY}_w1`;
  const round = (o = {}) => ({ uid: "w1", name: "Sam", day: TODAY, week: WEEK, plays: 1, best: 0, at: serverTimestamp(), ...o });
  // no calls yet → no rounds
  await assertFails(setDoc(doc(as("w1"), `gameScores/${id}`), round()));
  // 3 calls today → 1 round
  await env.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), `stats/${TODAY}_w1`), { uid: "w1", name: "Sam", day: TODAY, week: WEEK, calls: 3, interested: 0, won: 0, points: 3 }));
  await assertSucceeds(setDoc(doc(as("w1"), `gameScores/${id}`), round()));
  await assertSucceeds(setDoc(doc(as("w1"), `gameScores/${id}`), round({ best: 900 })));          // finish: raise best
  await assertFails(setDoc(doc(as("w1"), `gameScores/${id}`), round({ best: 100 })));             // can't lower
  await assertFails(setDoc(doc(as("w1"), `gameScores/${id}`), round({ best: 99999 })));           // impossible score
  await assertFails(setDoc(doc(as("w1"), `gameScores/${id}`), round({ plays: 2, best: 900 })));   // 2nd round needs 6 calls
  await assertFails(setDoc(doc(as("w1"), `gameScores/${id}`), round({ plays: 0, best: 900 })));   // can't reset plays
  await assertFails(setDoc(doc(as("w2"), `gameScores/${TODAY}_w2`), round({ uid: "w2", name: "Sam" }))); // wrong name / no calls
  await assertSucceeds(setDoc(doc(as("owner"), `gameScores/${TODAY}_owner`), round({ uid: "owner", name: "Aman" }))); // admin plays freely
  await assertSucceeds(getDocs(collection(as("w2"), "gameScores")));
});

test("admin can switch the break game off", async () => {
  await assertSucceeds(setDoc(doc(as("owner"), "settings/team"), { dailyGoal: 30, gamesOn: false }));
  await assertFails(setDoc(doc(as("owner"), "settings/team"), { dailyGoal: 30, gamesOn: "nah" }));
});

test("claiming a lead from the pool can't wipe its history or earned bonuses", async () => {
  await updateDoc(doc(as("owner"), "leads/pool1"), { status: "Won", gotWon: true, payment: "deposit", notes: "paid deposit" });
  const db = as("w2");
  const wipe = writeBatch(db);
  wipe.set(doc(db, "claims/pool1"), { uid: "w2", name: "Jo" });
  wipe.set(doc(db, "leads/pool1"), lead({ name: "Pool Cafe", assignedTo: "w2", assignedName: "Jo", status: "New" }));
  await assertFails(wipe.commit());
  const ok = writeBatch(db);
  ok.set(doc(db, "claims/pool1"), { uid: "w2", name: "Jo" });
  ok.update(doc(db, "leads/pool1"), { assignedTo: "w2", assignedName: "Jo", updatedAt: serverTimestamp() });
  await assertSucceeds(ok.commit());
  const l = await getDoc(doc(as("owner"), "leads/pool1"));
  assert1(l.data().gotWon === true && l.data().payment === "deposit" && l.data().notes === "paid deposit", "history kept");
});

test("search records must have numeric counts", async () => {
  await assertFails(setDoc(doc(as("w1"), "searches/x1"), { uid: "w1", results: "<img src=x onerror=alert(1)>" }));
  await assertSucceeds(setDoc(doc(as("w1"), "searches/x2"), { uid: "w1", results: 12, noWebsite: 3 }));
});
