// Old website finder: scores how outdated a business's website is.
// Quick signals come from the address alone (no padlock, free site-builder address).
// Full checks use Google PageSpeed Insights (free, needs an API key the admin adds once).

export class SetupError extends Error {}
export class CheckQuotaError extends Error {}

const FREE_BUILDERS = [
  [/\.wixsite\.com$/, "Wix"], [/\.weebly\.com$/, "Weebly"], [/\.business\.site$/, "Google free site"],
  [/(^|\.)sites\.google\.com$/, "Google Sites"], [/\.wordpress\.com$/, "WordPress.com"], [/\.blogspot\./, "Blogger"],
  [/\.squarespace\.com$/, "Squarespace"], [/\.godaddysites\.com$/, "GoDaddy"], [/\.webs\.com$/, "Webs"],
  [/\.jimdosite\.com$/, "Jimdo"], [/\.yolasite\.com$/, "Yola"], [/\.site123\.me$/, "Site123"], [/\.square\.site$/, "Square"],
  [/\.webnode\./, "Webnode"], [/\.wix\.com$/, "Wix"],
];

export function siteKey(url) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase().replace(/[^a-z0-9.-]/g, "").slice(0, 200) || "x"; }
  catch { return String(url || "x").toLowerCase().replace(/[^a-z0-9.-]/g, "").slice(0, 200) || "x"; }
}

/** Signals readable from the address alone. */
export function quickSignals(url) {
  let host = "", https = false;
  try { const u = new URL(url); host = u.hostname.toLowerCase(); https = u.protocol === "https:"; } catch {}
  const builder = FREE_BUILDERS.find(([re]) => re.test(host));
  return { https, builder: builder ? builder[1] : null, host };
}

/** Runs Google PageSpeed Insights (mobile). Returns { down, mobile, speed, https, oldJquery }. */
export async function pageSpeed(url, key, { timeoutMs = 70000 } = {}) {
  const q = new URLSearchParams({ url, strategy: "mobile", key });
  ["performance", "best-practices", "seo"].forEach((c) => q.append("category", c));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res, data = null;
  try {
    res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: ctrl.signal });
    try { data = await res.json(); } catch {}
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") return { down: false, timedOut: true };
    throw new Error("Couldn't reach Google's website checker.");
  }
  clearTimeout(timer);
  if (!res.ok) {
    const msg = data?.error?.message || "";
    if (res.status === 429) throw new CheckQuotaError("Today's free website checks are used up. They reset tomorrow.");
    if (res.status === 403 || /API key|blocked|not been used|disabled/i.test(msg)) throw new SetupError(msg || "Website checks aren't switched on yet.");
    // Google couldn't load the site at all: that's an old/broken site
    if (/FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|DNS|unable to reliably load|NO_FCP|net::/i.test(msg)) return { down: true };
    return { down: false, error: msg || `error ${res.status}` };
  }
  const lh = data.lighthouseResult || {};
  const a = lh.audits || {};
  const speed = lh.categories?.performance?.score != null ? Math.round(lh.categories.performance.score * 100) : null;
  // Lighthouse 12 called it "viewport" (0/1); 13+ calls it "viewport-insight" (anything under 0.9 = not set up for phones)
  const vp = a.viewport || a["viewport-insight"];
  const mobile = vp && vp.score != null ? vp.score >= 0.9 : null;
  const noDoctype = a.doctype ? a.doctype.score === 0 : false;
  const https = a["is-on-https"] ? a["is-on-https"].score !== 0 : null;
  const libs = a["js-libraries"]?.details?.items || [];
  const jq = libs.find((l) => /jquery/i.test(l.name || "") && /^1\./.test(String(l.version || "")));
  return { down: false, mobile, speed, https, noDoctype, oldJquery: jq ? `jQuery ${jq.version}` : null };
}

/** 0–100: how outdated the site looks, with plain-English reasons. */
export function scoreSite({ quick, full }) {
  const reasons = [];
  let score = 0;
  if (full?.down) { score += 60; reasons.push("Website doesn't load"); }
  if (full && full.mobile === false) { score += 45; reasons.push("Not mobile-friendly"); }
  const https = full?.https ?? quick?.https;
  if (https === false) { score += 20; reasons.push("No padlock (not secure)"); }
  if (quick?.builder) { score += 25; reasons.push(`Free ${quick.builder} address`); }
  if (full?.speed != null) {
    if (full.speed < 30) { score += 20; reasons.push(`Very slow on phones (${full.speed}/100)`); }
    else if (full.speed < 50) { score += 10; reasons.push(`Slow on phones (${full.speed}/100)`); }
  }
  if (full?.oldJquery) { score += 10; reasons.push(`Old code (${full.oldJquery})`); }
  if (full?.noDoctype) { score += 15; reasons.push("Very old code (built the 90s/2000s way)"); }
  return { score: Math.min(100, score), reasons };
}

export const oldLabel = (score) => (score >= 50 ? "Very outdated" : score >= 25 ? "Outdated" : "Looks OK");
export const OLD_MIN = 25; // shown in the finder when "outdated only" is on
