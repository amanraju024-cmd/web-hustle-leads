// Small shared helpers.

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch { return ""; }
}

export function slug(text) {
  return String(text || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function normalise(text) { return slug(text).replace(/-/g, ""); }

export function telHref(phone) { return "tel:" + String(phone).replace(/[^\d+]/g, ""); }

// ---------- Perth dates ----------
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Perth", year: "numeric", month: "2-digit", day: "2-digit" });

/** "YYYY-MM-DD" for the given moment in Perth time. */
export function perthDay(date = new Date()) { return dayFmt.format(date); }

export function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Monday of the week containing `day` (weeks start Monday). */
export function weekStart(day) {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

export function prettyDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

const timeFmt = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Perth", hour: "numeric", minute: "2-digit" });
const dateTimeFmt = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Perth", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function toDate(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts.toDate === "function") return ts.toDate();
  return null;
}
export function fmtTime(ts) { const d = toDate(ts); return d ? timeFmt.format(d) : ""; }
export function fmtDateTime(ts) { const d = toDate(ts); return d ? dateTimeFmt.format(d) : ""; }

// ---------- streaks ----------
/** Consecutive days with calls, ending today (or yesterday if nothing logged yet today). */
export function streakFrom(daysWithCalls, today) {
  const set = new Set(daysWithCalls);
  let day = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(day)) { n++; day = addDays(day, -1); }
  return n;
}

// ---------- CSV ----------
export function csvCell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=@\t\r]/.test(s) || /^[+-](?![\d ])/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function downloadCsv(rows, cols, filename) {
  const csv = [cols.join(",")].concat(rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ---------- Australian phone numbers ----------
/**
 * Cleans an Australian phone number. Returns { display, tel, valid }.
 * Handles +61 / 61 prefixes, (08) brackets, Perth numbers missing the 08, and "a; b" lists.
 */
export function cleanPhone(raw) {
  const text = String(raw || "").trim();
  if (!text) return { display: "", tel: "", valid: false };
  for (const part of text.split(/[;,/]| or /i)) {
    let d = part.replace(/[^\d+]/g, "");
    if (d.startsWith("+61")) d = "0" + d.slice(3);
    else if (d.startsWith("61") && d.length === 11) d = "0" + d.slice(2);
    d = d.replace(/^0+(?=0[2-478]\d{8}$)/, "");
    if (d.startsWith("00")) continue; // other countries
    if (/^[69]\d{7}$/.test(d)) d = "08" + d; // Perth number written without the area code
    let display = "";
    if (/^04\d{8}$/.test(d)) display = `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
    else if (/^0[2378]\d{8}$/.test(d)) display = `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
    else if (/^1[38]00\d{6}$/.test(d)) display = `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
    else if (/^13\d{4}$/.test(d)) display = `${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4)}`;
    if (display) return { display, tel: "tel:" + (d.startsWith("0") ? "+61" + d.slice(1) : d), valid: true };
  }
  return { display: text, tel: "", valid: false };
}
