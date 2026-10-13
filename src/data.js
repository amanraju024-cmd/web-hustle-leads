// Firebase setup and every read/write the app makes. Write shapes must match firestore.rules.
import { initializeApp, deleteApp } from "firebase/app";
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential,
} from "firebase/auth";
import {
  initializeFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, collection,
  query, where, orderBy, limit, onSnapshot, runTransaction, writeBatch, serverTimestamp, documentId, Timestamp,
} from "firebase/firestore";
import { firebaseConfig } from "./config.js";
import { perthDay, weekStart, chunk } from "./util.js";

const useEmulator = ["localhost", "127.0.0.1"].includes(location.hostname);

export const app = initializeApp(firebaseConfig);
// Email/password only: leaving out the popup/redirect helper stops phones from downloading
// Google's api.js and a hidden firebaseapp.com page before the app can start.
export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
if (useEmulator) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

export const STATUSES = ["New", "No answer", "Call back", "Interested", "Not interested", "Won"];
export const CALL_STATUSES = STATUSES.slice(1);
export const pointsFor = (status) => 1 + (status === "Interested" ? 3 : 0) + (status === "Won" ? 10 : 0);

export { onAuthStateChanged, Timestamp };

// ---------- auth ----------
export const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const signUp = (email, password) => createUserWithEmailAndPassword(auth, email, password);
export const logOut = () => signOut(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);
export async function changePassword(current, next) {
  const user = auth.currentUser;
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
  await updatePassword(user, next);
}

export function authMessage(err) {
  const code = err?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "That email and password don't match. Check them and try again.";
  if (code.includes("invalid-email")) return "That email address doesn't look right.";
  if (code.includes("email-already-in-use")) return "There's already an account with that email.";
  if (code.includes("weak-password")) return "Use a password with at least 6 characters.";
  if (code.includes("too-many-requests")) return "Too many attempts. Wait a few minutes and try again.";
  if (code.includes("network")) return "No internet connection. Check it and try again.";
  if (code.includes("permission-denied")) return "You don't have permission to do that.";
  return err?.message || "Something went wrong. Try again.";
}

// ---------- profiles ----------
export async function getProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: uid, ...snap.data() } : null;
}
export function createOwnerProfile(user, name) {
  return setDoc(doc(db, "users", user.uid), { name, email: user.email, role: "admin", active: true, createdAt: serverTimestamp() });
}
export async function listUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name));
}
/** Creates a login for a worker without signing the admin out (uses a throwaway second app). */
export async function createWorker({ name, email, password, role = "worker" }, adminUid) {
  const second = initializeApp(firebaseConfig, "create-" + Date.now());
  const secondAuth = initializeAuth(second, { persistence: inMemoryPersistence });
  if (useEmulator) connectAuthEmulator(secondAuth, "http://127.0.0.1:9099", { disableWarnings: true });
  try {
    const cred = await createUserWithEmailAndPassword(secondAuth, email, password);
    await setDoc(doc(db, "users", cred.user.uid), { name, email, role, active: true, createdAt: serverTimestamp(), createdBy: adminUid });
    await signOut(secondAuth);
    return cred.user.uid;
  } finally {
    await deleteApp(second).catch(() => {});
  }
}
export const updateUser = (uid, fields) => updateDoc(doc(db, "users", uid), { ...fields, updatedAt: serverTimestamp() });

// ---------- settings ----------
export async function getTeamSettings() {
  const snap = await getDoc(doc(db, "settings", "team"));
  const d = snap.exists() ? snap.data() : {};
  return { dailyGoal: d.dailyGoal || 30, commissionPct: d.commissionPct ?? 10, brandLink: d.brandLink || "", brandPhone: d.brandPhone || "" };
}
/** Brand details clients see (link + phone in texts and the website credit). Keeps the daily goal as is. */
export async function saveBrand({ brandLink, brandPhone }) {
  const { dailyGoal } = await getTeamSettings();
  return setDoc(doc(db, "settings", "team"), { dailyGoal, brandLink, brandPhone }, { merge: true });
}
export const getDailyGoal = async () => (await getTeamSettings()).dailyGoal;
export const saveTeamSettings = (dailyGoal) => setDoc(doc(db, "settings", "team"), { dailyGoal }, { merge: true });
export async function getGoogleToken() {
  const snap = await getDoc(doc(db, "settings", "integrations"));
  return snap.exists() ? snap.data().apifyToken || "" : "";
}
export const setGoogleToken = (token) => setDoc(doc(db, "settings", "integrations"), { apifyToken: token, updatedAt: serverTimestamp() });

/** Shared search results (7 days) so the team doesn't spend credit on the same search twice. */
export function searchCache(me) {
  return {
    async get(key) {
      const snap = await getDoc(doc(db, "searchCache", key));
      if (!snap.exists()) return null;
      const d = snap.data();
      return { leads: d.leads, at: d.at?.toMillis?.() || 0 };
    },
    put(key, leads) {
      return setDoc(doc(db, "searchCache", key), { uid: me.id, leads: leads.slice(0, 300), at: serverTimestamp() });
    },
  };
}

// ---------- activity ----------
export function logEvent(me, type, text, extra = {}) {
  return addDoc(collection(db, "events"), {
    type, text, uid: me.id, userName: me.name, day: perthDay(), createdAt: serverTimestamp(), ...extra,
  }).catch((e) => console.warn("event not saved", e));
}
export function recordSearch(me, result) {
  const noWebsite = result.leads.filter((l) => l.websiteKind === "none").length;
  const social = result.leads.filter((l) => l.websiteKind === "social").length;
  addDoc(collection(db, "searches"), {
    uid: me.id, userName: me.name, suburb: result.suburb, category: result.trade.label,
    googleRequests: result.googleRequests || 0, source: result.source || "osm",
    results: result.leads.length, noWebsite, social, day: perthDay(), createdAt: serverTimestamp(),
  }).catch((e) => console.warn("search not saved", e));
  logEvent(me, "search", `searched ${result.trade.label.toLowerCase()} in ${result.suburb} (${result.leads.length} results, ${noWebsite} with no website)`);
}

// ---------- claims ----------
/** Returns Map(leadId -> {uid, name}) for the given lead ids. */
export async function getClaims(ids) {
  const out = new Map();
  for (const part of chunk([...new Set(ids)], 30)) {
    const snap = await getDocs(query(collection(db, "claims"), where(documentId(), "in", part)));
    snap.forEach((d) => out.set(d.id, d.data()));
  }
  return out;
}

function leadDoc(lead, assignedTo, assignedName, createdBy) {
  return {
    name: lead.name, phone: lead.phone || "", address: lead.address || "", suburb: lead.suburb || "",
    category: lead.category || "", website: lead.website || "", websiteKind: lead.websiteKind || "none",
    maybeSite: lead.maybeSite || "", mapsUrl: lead.mapsUrl || "",
    rating: lead.rating ?? null, reviews: lead.reviews ?? 0,
    source: lead.source || "", lat: lead.lat ?? null, lon: lead.lon ?? null,
    assignedTo, assignedName, status: "New", notes: "", callbackAt: null, lastCalledAt: null,
    createdBy, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
}

export class TakenError extends Error {
  constructor(name) { super(`Already taken by ${name}`); this.takenBy = name; }
}

/** Atomically claims a business for `me`. Throws TakenError if someone already has it. */
export async function claimLead(me, lead) {
  await runTransaction(db, async (tx) => {
    const claimRef = doc(db, "claims", lead.id);
    const claim = await tx.get(claimRef);
    if (claim.exists()) throw new TakenError(claim.data().name);
    tx.set(claimRef, { uid: me.id, name: me.name, at: serverTimestamp() });
    tx.set(doc(db, "leads", lead.id), leadDoc(lead, me.id, me.name, me.id));
  });
  logEvent(me, "claim", `claimed ${lead.name} (${lead.suburb})`, { leadId: lead.id });
}

/** Admin: saves businesses to the unassigned pool (skips ones already saved). */
export async function addToPool(me, leads) {
  const existing = new Set();
  for (const part of chunk(leads.map((l) => l.id), 30)) {
    const snap = await getDocs(query(collection(db, "leads"), where(documentId(), "in", part)));
    snap.forEach((d) => existing.add(d.id));
  }
  const fresh = leads.filter((l) => !existing.has(l.id));
  for (const part of chunk(fresh, 400)) {
    const b = writeBatch(db);
    part.forEach((l) => b.set(doc(db, "leads", l.id), leadDoc(l, null, "", me.id)));
    await b.commit();
  }
  if (fresh.length) logEvent(me, "pool", `added ${fresh.length} lead${fresh.length === 1 ? "" : "s"} to the pool`);
  return fresh.length;
}

/** Admin: assign (worker) or unassign (null) leads, keeping claims in sync. */
export async function assignLeads(me, leadIds, worker) {
  for (const part of chunk(leadIds, 200)) {
    const b = writeBatch(db);
    for (const id of part) {
      b.update(doc(db, "leads", id), { assignedTo: worker ? worker.id : null, assignedName: worker ? worker.name : "", updatedAt: serverTimestamp() });
      if (worker) b.set(doc(db, "claims", id), { uid: worker.id, name: worker.name, at: serverTimestamp() });
      else b.delete(doc(db, "claims", id));
    }
    await b.commit();
  }
  logEvent(me, "assign", worker
    ? `assigned ${leadIds.length} lead${leadIds.length === 1 ? "" : "s"} to ${worker.name}`
    : `unassigned ${leadIds.length} lead${leadIds.length === 1 ? "" : "s"}`);
}

// ---------- leads ----------
export function watchMyLeads(uid, cb, onErr) {
  return onSnapshot(query(collection(db, "leads"), where("assignedTo", "==", uid)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onErr);
}
export function watchAllLeads(cb, onErr) {
  return onSnapshot(query(collection(db, "leads"), orderBy("updatedAt", "desc"), limit(2000)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onErr);
}
export async function getLeadsFor(uid) {
  const snap = await getDocs(query(collection(db, "leads"), where("assignedTo", "==", uid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export const saveNotes = (leadId, notes, callbackAt) =>
  updateDoc(doc(db, "leads", leadId), { notes, callbackAt: callbackAt ?? null, updatedAt: serverTimestamp() });

/**
 * Logs a call: updates the lead, writes the call record and bumps today's stats, all in one transaction.
 */
export async function logCall(me, lead, status, notes, callbackAt, dealValue = 0) {
  const day = perthDay();
  const week = weekStart(day);
  const callRef = doc(collection(db, "calls"));
  const statRef = doc(db, "stats", `${day}_${me.id}`);
  const points = pointsFor(status);
  await runTransaction(db, async (tx) => {
    const stat = await tx.get(statRef);
    const prev = stat.exists() ? stat.data() : { calls: 0, interested: 0, won: 0, revenue: 0 };
    const value = status === "Won" ? Math.max(0, Math.min(100000, Math.round(Number(dealValue) || 0))) : 0;
    const calls = prev.calls + 1;
    const interested = prev.interested + (status === "Interested" ? 1 : 0);
    const won = prev.won + (status === "Won" ? 1 : 0);
    tx.update(doc(db, "leads", lead.id), {
      status, notes, callbackAt: status === "Call back" ? (callbackAt ?? null) : null,
      lastCalledAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    tx.set(callRef, {
      leadId: lead.id, leadName: lead.name, uid: me.id, userName: me.name, status, notes, points,
      day, week, createdAt: serverTimestamp(), ...(status === "Won" ? { value } : {}),
    });
    tx.set(statRef, {
      uid: me.id, name: me.name, day, week, calls, interested, won,
      points: calls + 3 * interested + 10 * won, lastCallId: callRef.id,
      revenue: (prev.revenue || 0) + value,
    });
  });
  const note = notes.trim() ? `: “${notes.trim().slice(0, 120)}”` : "";
  const money = status === "Won" && dealValue ? ` ($${Math.round(dealValue).toLocaleString("en-AU")})` : "";
  logEvent(me, "call", `marked ${lead.name} as ${status}${money}${note}`, { leadId: lead.id, status });
  if (status === "Won") celebrate(me, "won", `${me.name} just closed ${lead.name}${money} 💰`);
  else if (status === "Interested") celebrate(me, "interested", `${me.name} got ${lead.name} interested 🔥`);
}

// ---------- stats ----------
export function watchStats(field, value, cb, onErr) {
  return onSnapshot(query(collection(db, "stats"), where(field, "==", value)),
    (snap) => cb(snap.docs.map((d) => d.data())), onErr);
}
export async function getStatsFor(uid) {
  const snap = await getDocs(query(collection(db, "stats"), where("uid", "==", uid)));
  return snap.docs.map((d) => d.data());
}

// ---------- live team pop-ups ----------
export function celebrate(me, type, text) {
  return addDoc(collection(db, "celebrations"), { uid: me.id, name: me.name, type, text: text.slice(0, 200), at: serverTimestamp() })
    .catch((e) => console.warn("celebration not saved", e));
}
export function watchCelebrations(sinceMs, cb) {
  return onSnapshot(query(collection(db, "celebrations"), where("at", ">", Timestamp.fromMillis(sinceMs))), (snap) => {
    snap.docChanges().forEach((ch) => { if (ch.type === "added") cb({ id: ch.doc.id, ...ch.doc.data() }); });
  }, () => {});
}

export async function getStatsSince(day) {
  const snap = await getDocs(query(collection(db, "stats"), where("day", ">=", day)));
  return snap.docs.map((d) => d.data());
}
export async function getCallsForWeek(week) {
  const snap = await getDocs(query(collection(db, "calls"), where("week", "==", week)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function getStatsForWeek(week) {
  const snap = await getDocs(query(collection(db, "stats"), where("week", "==", week)));
  return snap.docs.map((d) => d.data());
}

/** Sums stats rows per worker and ranks them by points, then won, then calls. */
export function leaderboard(rows) {
  const by = new Map();
  for (const r of rows) {
    const cur = by.get(r.uid) || { uid: r.uid, name: r.name, calls: 0, interested: 0, won: 0, points: 0, revenue: 0 };
    cur.calls += r.calls; cur.interested += r.interested; cur.won += r.won; cur.points += r.points; cur.revenue += r.revenue || 0;
    cur.name = r.name || cur.name;
    by.set(r.uid, cur);
  }
  return [...by.values()].sort((a, b) => b.points - a.points || b.won - a.won || b.calls - a.calls || a.name.localeCompare(b.name));
}

// ---------- admin feeds ----------
export function watchEventsForDay(day, cb, onErr) {
  return onSnapshot(query(collection(db, "events"), where("day", "==", day)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? Infinity) - (a.createdAt?.toMillis?.() ?? Infinity))), onErr);
}
export async function getCallsFor(uid) {
  const snap = await getDocs(query(collection(db, "calls"), where("uid", "==", uid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}
export async function getSearchesFor(uid) {
  const snap = await getDocs(query(collection(db, "searches"), where("uid", "==", uid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}
export async function getAllCalls() {
  const snap = await getDocs(query(collection(db, "calls"), orderBy("createdAt", "desc"), limit(5000)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export function watchSearchesForDay(day, cb, onErr) {
  return onSnapshot(query(collection(db, "searches"), where("day", "==", day)), (snap) => cb(snap.docs.map((d) => d.data())), onErr);
}
export async function getAllSearches() {
  const snap = await getDocs(query(collection(db, "searches"), orderBy("createdAt", "desc"), limit(5000)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
