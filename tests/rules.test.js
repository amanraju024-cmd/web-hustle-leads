// Security rule tests. Run with: npm run test:rules (starts the Firestore + Auth emulators)
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, collection, getDocs, query, where,
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
  await assertFails(getDoc(doc(as("w2"), "leads/pool1")));
  await assertSucceeds(getDocs(query(collection(as("w1"), "leads"), where("assignedTo", "==", "w1"))));
  await assertFails(getDocs(collection(as("w1"), "leads")));
  await assertSucceeds(getDoc(doc(as("w2"), "claims/sam1")));
  await assertSucceeds(getDocs(collection(as("owner"), "leads")));
});

test("worker edits only status/notes/callback on their lead", async () => {
  const db = as("w1");
  await assertSucceeds(updateDoc(doc(db, "leads/sam1"), { notes: "call after 2", status: "Call back" }));
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
function logCall(db, { uid = "w1", name = "Sam", leadId = "sam1", status = "No answer", callId = "c1",
  day = "2026-10-12", week = "2026-10-12", prev = null, points, statOverride = {} } = {}) {
  const p = points ?? 1 + (status === "Interested" ? 3 : 0) + (status === "Won" ? 10 : 0);
  const b = writeBatch(db);
  b.update(doc(db, `leads/${leadId}`), { status, notes: "n", lastCalledAt: serverTimestamp(), updatedAt: serverTimestamp() });
  b.set(doc(db, `calls/${callId}`), { leadId, leadName: "Sam Barber", uid, userName: name, status, notes: "n", points: p, day, week, createdAt: serverTimestamp() });
  const base = prev || { calls: 0, interested: 0, won: 0 };
  const calls = base.calls + 1;
  const interested = base.interested + (status === "Interested" ? 1 : 0);
  const won = base.won + (status === "Won" ? 1 : 0);
  b.set(doc(db, `stats/${day}_${uid}`), {
    uid, name, day, week, calls, interested, won, points: calls + 3 * interested + 10 * won, lastCallId: callId, ...statOverride,
  });
  return b.commit();
}

test("worker logs calls and their stats update", async () => {
  const db = as("w1");
  await assertSucceeds(logCall(db, { status: "No answer", callId: "c1" }));
  await assertSucceeds(logCall(db, { status: "Interested", callId: "c2", prev: { calls: 1, interested: 0, won: 0 } }));
  await assertSucceeds(logCall(db, { status: "Won", callId: "c3", prev: { calls: 2, interested: 1, won: 0 } }));
  const s = await getDoc(doc(db, "stats/2026-10-12_w1"));
  assert1(s.data().points === 3 + 3 + 10, "points = calls + 3*interested + 10*won");
});

test("can't inflate stats", async () => {
  const db = as("w1");
  await assertFails(logCall(db, { statOverride: { calls: 5, points: 5 } }));
  await assertFails(logCall(db, { status: "No answer", statOverride: { won: 1, points: 11 } }));
  await assertFails(logCall(db, { status: "Won", points: 50 }));
});

test("can't reuse an old call to bump stats again", async () => {
  const db = as("w1");
  await assertSucceeds(logCall(db, { callId: "c1" }));
  const b = writeBatch(db);
  b.set(doc(db, "stats/2026-10-12_w1"), { uid: "w1", name: "Sam", day: "2026-10-12", week: "2026-10-12", calls: 2, interested: 0, won: 0, points: 2, lastCallId: "c1" });
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

function assert1(cond, msg) { if (!cond) throw new Error("Assertion failed: " + msg); }
