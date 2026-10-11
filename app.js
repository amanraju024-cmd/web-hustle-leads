// AR Methods Leads — runs entirely in the browser.
// Searches Google Places (New) directly with the user's own API key, which is
// kept in this browser's localStorage and sent only to Google.
(() => {
  "use strict";

  const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
  const STATE = "WA";
  const COUNTRY = "Australia";
  const MAX_PAGES_PER_AREA = 3; // Google returns at most 3 pages x 20 per query
  const STATUSES = ["New", "No answer", "Call back", "Interested", "Not interested", "Won"];
  const KIND_LABEL = { none: "No website", social: "Booking/social page only", website: "Has website" };
  const KIND_ORDER = { none: 0, social: 1, website: 2 };

  const SUBURB_FIELDS = "places.displayName,places.location,places.viewport,places.formattedAddress,places.types";
  const BUSINESS_FIELDS = [
    "places.id", "places.displayName", "places.formattedAddress", "places.addressComponents",
    "places.nationalPhoneNumber", "places.websiteUri", "places.businessStatus",
    "places.googleMapsUri", "places.rating", "places.userRatingCount",
    "places.primaryTypeDisplayName", "nextPageToken",
  ].join(",");

  // Sites that mean "no real website": social pages and booking platforms
  const SOCIAL_OR_BOOKING_HOSTS = [
    "facebook.com", "fb.com", "fb.me", "instagram.com", "linktr.ee", "linkin.bio", "tiktok.com",
    "fresha.com", "gettimely.com", "booksy.com", "setmore.com", "simplybook.me", "square.site",
    "squareup.com", "bookwell.com.au", "shortcutssoftware.com", "vagaro.com", "treatwell.com.au",
    "business.site", "google.com", "g.page", "yelp.com", "yellowpages.com.au", "truelocal.com.au",
    "hotdoc.com.au", "healthengine.com.au", "wa.me", "linkedin.com", "youtube.com",
  ];

  const $ = (id) => document.getElementById(id);

  // ---------------- storage (never throws) ----------------

  let storageWorks = true;
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { storageWorks = false; return false; }
  }

  // ---------------- helpers ----------------

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function safeUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
    } catch { return ""; }
  }
  function telHref(phone) { return "tel:" + String(phone).replace(/[^\d+]/g, ""); }
  function shortUrl(url) {
    try { const u = new URL(url); return (u.hostname.replace(/^www\./, "") + u.pathname).replace(/\/$/, ""); }
    catch { return url; }
  }
  function normalise(text) { return String(text || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function show(el, on) { el.classList.toggle("hidden", !on); }
  function setNotice(el, html) { el.innerHTML = html; show(el, !!html); }

  function websiteKind(url) {
    if (!url) return "none";
    let host;
    try { host = new URL(url.includes("://") ? url : "http://" + url).hostname.toLowerCase(); }
    catch { return "website"; }
    host = host.replace(/^www\./, "");
    return SOCIAL_OR_BOOKING_HOSTS.some((h) => host === h || host.endsWith("." + h)) ? "social" : "website";
  }

  function localityOf(place) {
    for (const comp of place.addressComponents || []) {
      if ((comp.types || []).includes("locality")) return comp.longText || comp.shortText || "";
    }
    return "";
  }

  function inSuburb(place, suburb) {
    const locality = localityOf(place);
    if (locality) return normalise(locality) === normalise(suburb);
    return new RegExp(`\\b${escapeRegex(suburb.trim())}\\b`, "i").test(place.formattedAddress || "");
  }

  function toLead(place, category) {
    const website = place.websiteUri || "";
    return {
      id: place.id || "",
      name: (place.displayName || {}).text || "",
      type: (place.primaryTypeDisplayName || {}).text || category,
      phone: place.nationalPhoneNumber || "",
      address: place.formattedAddress || "",
      suburb: localityOf(place),
      website,
      website_kind: websiteKind(website),
      rating: place.rating ?? null,
      reviews: place.userRatingCount || 0,
      maps_url: place.googleMapsUri || "",
    };
  }

  function gridCells(viewport, n) {
    const lat0 = viewport.low.latitude, lng0 = viewport.low.longitude;
    const dlat = (viewport.high.latitude - lat0) / n;
    const dlng = (viewport.high.longitude - lng0) / n;
    const cells = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        cells.push({
          low: { latitude: lat0 + i * dlat, longitude: lng0 + j * dlng },
          high: { latitude: lat0 + (i + 1) * dlat, longitude: lng0 + (j + 1) * dlng },
        });
      }
    }
    return cells;
  }

  // ---------------- Google Places ----------------

  class PlacesError extends Error {}

  async function placesRequest(payload, fieldMask, apiKey) {
    let res;
    try {
      res = await fetch(PLACES_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": fieldMask },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new PlacesError("Couldn't reach Google Maps. Check your internet connection and try again.");
    }
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const message = (data && data.error && data.error.message) || `HTTP ${res.status}`;
      let hint = "";
      if (/api key|API_KEY/i.test(message)) hint = " Check your Google key (tap “Change Google key” at the top).";
      else if (/referer|referrer/i.test(message)) hint = " Your key's website restriction doesn't include this page's address. Add it in Google Cloud → Credentials.";
      else if (res.status === 403) hint = " Make sure “Places API (New)” is enabled and billing is turned on in Google Cloud.";
      else if (res.status === 429) hint = " You've hit Google's limit. Wait a minute, or check your quota in Google Cloud.";
      throw new PlacesError(`Google Maps error: ${message}${/[.!?]$/.test(message) ? "" : "."}${hint}`);
    }
    if (!data) throw new PlacesError("Google Maps sent back an unexpected response. Try again.");
    return data;
  }

  async function findSuburb(suburb, apiKey) {
    const data = await placesRequest(
      { textQuery: `${suburb} ${STATE} ${COUNTRY}`, regionCode: "AU", pageSize: 5 }, SUBURB_FIELDS, apiKey);
    const places = data.places || [];
    if (!places.length) throw new PlacesError(`Couldn't find the suburb “${suburb}” on Google Maps. Check the spelling.`);
    // Prefer the suburb itself over a business that happens to share its name
    return places.find((p) => (p.types || []).some((t) => ["locality", "sublocality", "postal_code"].includes(t))) || places[0];
  }

  async function searchArea(category, area, apiKey) {
    let payload = { textQuery: category, regionCode: "AU", pageSize: 20, ...area };
    const places = [];
    let requests = 0;
    for (let page = 0; page < MAX_PAGES_PER_AREA; page++) {
      const data = await placesRequest(payload, BUSINESS_FIELDS, apiKey);
      requests++;
      places.push(...(data.places || []));
      if (!data.nextPageToken) break;
      payload = { ...payload, pageToken: data.nextPageToken };
    }
    return { places, requests };
  }

  // Runs fn over items with at most `limit` running at once; rejects on the first error.
  async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  async function searchBusinesses(suburb, category, grid, onlySuburb, apiKey) {
    const suburbPlace = await findSuburb(suburb, apiKey);
    let requests = 1;
    const vp = suburbPlace.viewport;
    let areas;
    if (vp && vp.low && vp.high) {
      areas = gridCells(vp, grid).map((rectangle) => ({ locationRestriction: { rectangle } }));
    } else if (suburbPlace.location && "latitude" in suburbPlace.location) {
      areas = [{ locationBias: { circle: { center: suburbPlace.location, radius: 3000.0 } } }];
    } else {
      throw new PlacesError(`Google didn't return a location for “${suburb}”.`);
    }

    const results = await mapLimit(areas, 4, (area) => searchArea(category, area, apiKey));
    const seen = new Set();
    const leads = [];
    let excludedOutside = 0, excludedClosed = 0;
    for (const { places, requests: n } of results) {
      requests += n;
      for (const place of places) {
        if (!place.id || seen.has(place.id)) continue;
        seen.add(place.id);
        if ((place.businessStatus || "OPERATIONAL") !== "OPERATIONAL") { excludedClosed++; continue; }
        if (onlySuburb && !inSuburb(place, suburb)) { excludedOutside++; continue; }
        leads.push(toLead(place, category));
      }
    }
    leads.sort((a, b) => KIND_ORDER[a.website_kind] - KIND_ORDER[b.website_kind] || (b.reviews || 0) - (a.reviews || 0));
    return {
      suburb: (suburbPlace.displayName || {}).text || suburb,
      category, leads, requests,
      excluded_outside: excludedOutside,
      excluded_closed: excludedClosed,
    };
  }

  // ---------------- state ----------------

  const state = {
    apiKey: load("whl_key", ""),
    result: null,
    filter: "none",
    saved: new Map(Object.entries(load("whl_saved", {}) || {})),
    statusFilter: "all",
    cache: new Map(),
    searching: false,
  };

  function persistSaved() {
    save("whl_saved", Object.fromEntries(state.saved));
    $("savedCount").textContent = state.saved.size;
    show($("storageWarning"), !storageWorks);
  }

  // ---------------- API key ----------------

  function showKeyPanel(on) {
    show($("keyPanel"), on);
    show($("changeKeyBtn"), !on && !!state.apiKey);
    if (on) { $("apiKey").value = state.apiKey; $("apiKey").focus(); }
  }
  $("keyForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const key = $("apiKey").value.trim();
    if (!key) return;
    state.apiKey = key;
    state.cache.clear();
    if (!save("whl_key", key)) {
      setNotice($("searchError"), "This browser isn't letting the page save your key, so you'll need to paste it again next time.");
    }
    showKeyPanel(false);
  });
  $("changeKeyBtn").addEventListener("click", () => showKeyPanel(true));

  // ---------------- tabs ----------------

  function switchView(view) {
    for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t.dataset.view === view);
    show($("viewSearch"), view === "search");
    show($("viewSaved"), view === "saved");
    if (view === "saved") renderSaved();
    save("whl_view", view);
  }
  for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => switchView(t.dataset.view));

  // ---------------- search ----------------

  $("searchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (state.searching) return;
    const suburb = $("suburb").value.trim();
    const category = $("category").value.trim();
    const grid = Number($("grid").value);
    const onlySuburb = $("onlySuburb").checked;
    if (!suburb || !category) return;
    if (!state.apiKey) {
      setNotice($("searchError"), "Paste your Google Maps API key above first.");
      showKeyPanel(true);
      return;
    }
    save("whl_form", { suburb, category, grid, onlySuburb });

    const cacheKey = [normalise(suburb), category.toLowerCase(), grid, onlySuburb].join("|");
    setNotice($("searchError"), "");
    if (state.cache.has(cacheKey)) {
      showResult({ ...state.cache.get(cacheKey), requests: 0, cached: true });
      return;
    }

    state.searching = true;
    const btn = $("searchBtn");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Searching';
    setNotice($("searchStatus"), `<span class="spinner"></span>Searching Google Maps for ${esc(category)} in ${esc(suburb)}…`);
    try {
      const result = await searchBusinesses(suburb, category, grid, onlySuburb, state.apiKey);
      state.cache.set(cacheKey, result);
      showResult({ ...result, cached: false });
    } catch (err) {
      setNotice($("searchError"), esc(err instanceof PlacesError ? err.message : `Something went wrong: ${err.message}`));
    } finally {
      setNotice($("searchStatus"), "");
      state.searching = false;
      btn.disabled = false;
      btn.textContent = "Search";
    }
  });

  function countKinds(leads) {
    const c = { none: 0, social: 0, website: 0 };
    for (const l of leads) c[l.website_kind]++;
    return c;
  }

  function showResult(result) {
    state.result = result;
    const c = countKinds(result.leads);
    state.filter = c.none ? "none" : c.social ? "social" : "all";
    renderResults();
  }

  function shownLeads() {
    if (!state.result) return [];
    return state.filter === "all" ? state.result.leads : state.result.leads.filter((l) => l.website_kind === state.filter);
  }

  function renderResults() {
    const data = state.result;
    if (!data) return;
    show($("results"), true);
    const c = countKinds(data.leads);
    const filters = [["none", c.none], ["social", c.social], ["website", c.website], ["all", data.leads.length]];
    const extra = [data.cached ? "repeat search, no Google requests used" : `${data.requests} Google request${data.requests === 1 ? "" : "s"} used`];
    if (data.excluded_outside) extra.push(`${data.excluded_outside} outside ${esc(data.suburb)} hidden`);
    if (data.excluded_closed) extra.push(`${data.excluded_closed} closed hidden`);
    $("summary").innerHTML =
      filters.map(([k, n]) => `<button type="button" class="filter${state.filter === k ? " active" : ""}" data-filter="${k}">${k === "all" ? "All" : KIND_LABEL[k]} (${n})</button>`).join("") +
      `<span class="meta">${esc(data.category)} in ${esc(data.suburb)} · ${extra.join(" · ")}</span>`;
    for (const b of $("summary").querySelectorAll(".filter")) {
      b.addEventListener("click", () => { state.filter = b.dataset.filter; renderResults(); });
    }

    const leads = shownLeads();
    $("saveAllBtn").disabled = !leads.some((l) => !state.saved.has(l.id));
    $("exportResultsBtn").disabled = !leads.length;
    if (!leads.length) {
      $("resultList").innerHTML = `<div class="empty">${data.leads.length ? "Nothing in this group. Try another filter above." : "No businesses found. Try a different business type, a nearby suburb, or untick “Only businesses inside this suburb”."}</div>`;
      return;
    }
    $("resultList").innerHTML = leads.map(leadCard).join("");
    for (const b of $("resultList").querySelectorAll("[data-save]")) {
      b.addEventListener("click", () => saveLeads([data.leads.find((l) => l.id === b.dataset.save)]));
    }
  }

  function infoRows(l) {
    const site = safeUrl(l.website);
    const maps = safeUrl(l.maps_url);
    const rating = l.rating ? `★ ${Number(l.rating).toFixed(1)} (${Number(l.reviews) || 0})` : "No reviews";
    return `
      <div class="row">
        ${l.phone ? `<a class="phone" href="${esc(telHref(l.phone))}">📞 ${esc(l.phone)}</a>` : `<span class="sub">No phone listed</span>`}
        <span class="sub">${esc(rating)}</span>
        ${maps ? `<a href="${esc(maps)}" target="_blank" rel="noopener">Google Maps</a>` : ""}
        ${site ? `<a href="${esc(site)}" target="_blank" rel="noopener">${esc(shortUrl(site))}</a>` : ""}
      </div>`;
  }

  function leadCard(l) {
    const saved = state.saved.has(l.id);
    return `
      <div class="card">
        <div>
          <h3>${esc(l.name)} <span class="pill ${esc(l.website_kind)}">${esc(KIND_LABEL[l.website_kind] || "")}</span></h3>
          <div class="sub">${esc(l.type)} · ${esc(l.address)}</div>
        </div>
        <div class="actions">
          <button class="ghost" type="button" data-save="${esc(l.id)}" ${saved ? "disabled" : ""}>${saved ? "Saved ✓" : "Save"}</button>
        </div>
        <div style="grid-column:1/-1">${infoRows(l)}</div>
      </div>`;
  }

  $("saveAllBtn").addEventListener("click", () => saveLeads(shownLeads().filter((l) => !state.saved.has(l.id))));

  // ---------------- CSV ----------------

  function csvCell(v) {
    let s = String(v ?? "");
    if (/^[=@\t\r]/.test(s) || /^[+-](?![\d ])/.test(s)) s = "'" + s; // stop spreadsheets running it as a formula
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function downloadCsv(rows, cols, filename) {
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
  const LEAD_COLS = ["name", "type", "phone", "address", "suburb", "website", "website_kind", "rating", "reviews", "maps_url"];

  $("exportResultsBtn").addEventListener("click", () => {
    const leads = shownLeads();
    if (!leads.length) return;
    const r = state.result;
    downloadCsv(leads, LEAD_COLS, `leads-${r.category}-${r.suburb}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-") + ".csv");
  });
  $("exportSavedBtn").addEventListener("click", () => {
    downloadCsv(sortedSaved(), LEAD_COLS.concat(["status", "notes", "category", "saved_at"]), "call-list.csv");
  });

  // ---------------- call list ----------------

  function saveLeads(leads) {
    const category = state.result ? state.result.category : "";
    const now = new Date().toISOString().slice(0, 19);
    for (const l of leads) {
      if (!l || !l.id) continue;
      const existing = state.saved.get(l.id);
      state.saved.set(l.id, existing
        ? { ...existing, ...l, status: existing.status, notes: existing.notes, saved_at: existing.saved_at }
        : { ...l, category, status: "New", notes: "", saved_at: now });
    }
    persistSaved();
    renderResults();
  }

  function sortedSaved() {
    return [...state.saved.values()].sort((a, b) => String(b.saved_at).localeCompare(String(a.saved_at)));
  }

  function renderStatusFilter() {
    const counts = {};
    for (const l of state.saved.values()) counts[l.status] = (counts[l.status] || 0) + 1;
    const opts = [["all", `All (${state.saved.size})`]].concat(STATUSES.map((s) => [s, `${s} (${counts[s] || 0})`]));
    $("statusFilter").innerHTML = opts.map(([v, t]) => `<option value="${esc(v)}"${v === state.statusFilter ? " selected" : ""}>${esc(t)}</option>`).join("");
  }
  $("statusFilter").addEventListener("change", (e) => { state.statusFilter = e.target.value; renderSaved(); });

  function renderSaved() {
    renderStatusFilter();
    $("exportSavedBtn").disabled = !state.saved.size;
    const list = sortedSaved().filter((l) => state.statusFilter === "all" || l.status === state.statusFilter);
    if (!list.length) {
      $("savedList").innerHTML = `<div class="empty">${state.saved.size ? "No leads with this status." : "Your call list is empty. Search for leads and tap Save."}</div>`;
      return;
    }
    $("savedList").innerHTML = list.map((l) => `
      <div class="card" data-id="${esc(l.id)}">
        <div>
          <h3>${esc(l.name)} <span class="pill ${esc(l.website_kind)}">${esc(KIND_LABEL[l.website_kind] || "")}</span></h3>
          <div class="sub">${esc(l.type)} · ${esc(l.address)}</div>
        </div>
        <div class="actions"><button class="danger" type="button" data-delete>Remove</button></div>
        <div style="grid-column:1/-1">${infoRows(l)}</div>
        <div class="saved-extra">
          <select data-status aria-label="Call status">${STATUSES.map((s) => `<option${s === l.status ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>
          <textarea data-notes rows="1" placeholder="Notes (who you spoke to, when to call back…)">${esc(l.notes)}</textarea>
        </div>
      </div>`).join("");

    for (const card of $("savedList").querySelectorAll(".card")) {
      const id = card.dataset.id;
      card.querySelector("[data-status]").addEventListener("change", (e) => {
        const lead = state.saved.get(id);
        if (!lead) return;
        lead.status = e.target.value;
        persistSaved();
        renderSaved();
      });
      const notes = card.querySelector("[data-notes]");
      notes.addEventListener("input", () => {
        const lead = state.saved.get(id);
        if (!lead) return;
        lead.notes = notes.value;
        persistSaved();
      });
      card.querySelector("[data-delete]").addEventListener("click", () => {
        const lead = state.saved.get(id);
        if (!confirm(`Remove ${lead ? lead.name : "this lead"} from your call list?`)) return;
        state.saved.delete(id);
        persistSaved();
        renderSaved();
        renderResults();
      });
    }
  }

  // ---------------- start ----------------

  const form = load("whl_form", null);
  if (form && typeof form === "object") {
    $("suburb").value = form.suburb || "";
    $("category").value = form.category || "";
    if ([1, 2, 3].includes(form.grid)) $("grid").value = String(form.grid);
    $("onlySuburb").checked = form.onlySuburb !== false;
  }
  // Drop anything malformed from older saves
  for (const [id, l] of state.saved) {
    if (!l || typeof l !== "object") state.saved.delete(id);
    else if (!STATUSES.includes(l.status)) l.status = "New";
  }
  $("savedCount").textContent = state.saved.size;
  showKeyPanel(!state.apiKey);
  if (load("whl_view", "search") === "saved") switchView("saved");
})();
