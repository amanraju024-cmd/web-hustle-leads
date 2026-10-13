// Finds local businesses from OpenStreetMap (free, no key) and optionally TomTom (free key, no card).
import { normalise, slug, cleanPhone } from "./util.js";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const OVERPASS_TIMEOUT_MS = 20000;
const TOMTOM = "https://api.tomtom.com/search/2/poiSearch/";
const APIFY_GMAPS = "https://api.apify.com/v2/acts/compass~crawler-google-places/run-sync-get-dataset-items";
export const GOOGLE_COVERAGE = { quick: 40, standard: 100, thorough: 200 }; // businesses per search (Apify)
const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_GRID = { quick: 1, standard: 2, thorough: 3 }; // suburb split into N x N squares, up to 60 results each

// Business types: OpenStreetMap tag filters + the words TomTom searches for
export const TRADES = [
  { id: "barber", nom: "barber", label: "Barber", osm: ['["shop"="hairdresser"]["hairdresser"~"barber|men",i]', '["shop"="barber"]', '["shop"="hairdresser"]["name"~"barber",i]'], tt: "barber" },
  { id: "hair", nom: "hairdresser", label: "Hair salon", osm: ['["shop"="hairdresser"]'], tt: "hair salon" },
  { id: "beauty", nom: "beauty salon", label: "Beauty salon", osm: ['["shop"="beauty"]', '["shop"="cosmetics"]'], tt: "beauty salon" },
  { id: "nails", nom: "nail salon", label: "Nail salon", osm: ['["shop"="beauty"]["beauty"~"nails",i]', '["shop"="beauty"]["name"~"nail",i]'], tt: "nail salon" },
  { id: "massage", nom: "massage", label: "Massage", osm: ['["shop"="massage"]', '["healthcare"="massage"]'], tt: "massage" },
  { id: "cafe", nom: "cafe", label: "Cafe", osm: ['["amenity"="cafe"]'], tt: "cafe" },
  { id: "restaurant", nom: "restaurant", label: "Restaurant", osm: ['["amenity"="restaurant"]'], tt: "restaurant" },
  { id: "takeaway", nom: "fast food", label: "Takeaway", osm: ['["amenity"="fast_food"]'], tt: "takeaway" },
  { id: "bakery", nom: "bakery", label: "Bakery", osm: ['["shop"="bakery"]', '["shop"="pastry"]'], tt: "bakery" },
  { id: "florist", nom: "florist", label: "Florist", osm: ['["shop"="florist"]'], tt: "florist" },
  { id: "mechanic", nom: "car repair", label: "Mechanic", osm: ['["shop"="car_repair"]', '["shop"="tyres"]'], tt: "car repair" },
  { id: "plumber", nom: "plumber", label: "Plumber", osm: ['["craft"="plumber"]'], tt: "plumber" },
  { id: "electrician", nom: "electrician", label: "Electrician", osm: ['["craft"="electrician"]'], tt: "electrician" },
  { id: "builder", nom: "builder", label: "Builder", osm: ['["craft"="builder"]', '["office"="construction_company"]'], tt: "builder" },
  { id: "painter", nom: "painter", label: "Painter", osm: ['["craft"="painter"]'], tt: "painter" },
  { id: "landscaper", nom: "garden centre", label: "Landscaper / gardener", osm: ['["craft"="gardener"]', '["shop"="garden_centre"]'], tt: "landscaping" },
  { id: "cleaner", nom: "dry cleaning", label: "Cleaner", osm: ['["shop"="dry_cleaning"]', '["shop"="laundry"]', '["craft"="cleaning"]'], tt: "cleaning" },
  { id: "dentist", nom: "dentist", label: "Dentist", osm: ['["amenity"="dentist"]', '["healthcare"="dentist"]'], tt: "dentist" },
  { id: "physio", nom: "physiotherapist", label: "Physiotherapist", osm: ['["healthcare"="physiotherapist"]'], tt: "physiotherapist" },
  { id: "gym", nom: "gym", label: "Gym / fitness", osm: ['["leisure"="fitness_centre"]', '["leisure"="sports_centre"]["sport"~"fitness|martial",i]'], tt: "gym" },
  { id: "pet", nom: "pet shop", label: "Pet groomer / pet shop", osm: ['["shop"="pet"]', '["shop"="pet_grooming"]', '["amenity"="veterinary"]'], tt: "pet grooming" },
  { id: "tattoo", nom: "tattoo", label: "Tattoo", osm: ['["shop"="tattoo"]'], tt: "tattoo" },
  { id: "accountant", nom: "accountant", label: "Accountant", osm: ['["office"="accountant"]', '["office"="tax_advisor"]'], tt: "accountant" },
  { id: "realestate", nom: "estate agent", label: "Real estate agent", osm: ['["office"="estate_agent"]'], tt: "real estate agent" },
  { id: "retail", nom: "shop", label: "Any shop", osm: ['["shop"]'], tt: "shop" },
];

const SOCIAL_OR_BOOKING_HOSTS = [
  "facebook.com", "fb.com", "fb.me", "instagram.com", "linktr.ee", "linkin.bio", "tiktok.com",
  "fresha.com", "gettimely.com", "booksy.com", "setmore.com", "simplybook.me", "square.site",
  "squareup.com", "bookwell.com.au", "shortcutssoftware.com", "vagaro.com", "treatwell.com.au",
  "business.site", "google.com", "g.page", "yelp.com", "yellowpages.com.au", "truelocal.com.au",
  "hotdoc.com.au", "healthengine.com.au", "wa.me", "linkedin.com", "youtube.com",
];

export function websiteKind(url) {
  if (!url) return "none";
  let host;
  try { host = new URL(url.includes("://") ? url : "http://" + url).hostname.toLowerCase(); }
  catch { return "website"; }
  host = host.replace(/^www\./, "");
  return SOCIAL_OR_BOOKING_HOSTS.some((h) => host === h || host.endsWith("." + h)) ? "social" : "website";
}

export class SearchError extends Error {}

function phoneFields(raw) {
  const p = cleanPhone(raw);
  return { phone: p.display, phoneValid: p.valid };
}

async function getJson(url, opts, what, timeoutMs = 15000) {
  let res;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const outer = opts?.signal;
  if (outer) outer.addEventListener("abort", () => ctrl.abort(), { once: true });
  try { res = await fetch(url, { ...opts, signal: ctrl.signal }); }
  catch (e) {
    if (outer?.aborted) throw e;
    if (ctrl.signal.aborted) throw new SearchError(`${what} took too long to answer. Try again.`);
    throw new SearchError(`Couldn't reach ${what}. Check your internet connection.`);
  }
  finally { clearTimeout(timer); }
  if (res.status === 429) throw new SearchError(`${what} is busy right now. Wait a minute and try again.`);
  if (!res.ok) throw new SearchError(`${what} returned an error (${res.status}). Try again in a minute.`);
  try { return await res.json(); }
  catch { throw new SearchError(`${what} sent back something unexpected. Try again.`); }
}

const PLACE_TYPES = ["suburb", "town", "city", "village", "quarter", "neighbourhood", "hamlet", "locality", "city_district", "municipality"];

const GEO_CACHE_KEY = "arm_geo_v1";
const GEO_CACHE_DAYS = 30;
function readGeoCache() { try { return JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || "{}"); } catch { return {}; } }
function writeGeoCache(key, geo) {
  try {
    const all = readGeoCache();
    all[key] = { at: Date.now(), geo };
    const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, 60);
    localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(Object.fromEntries(keys.map((k) => [k, all[k]]))));
  } catch { /* storage full or blocked: fine, just slower next time */ }
}

export async function findSuburb(suburb) {
  const key = normalise(suburb);
  const hit = readGeoCache()[key];
  if (hit && Date.now() - hit.at < GEO_CACHE_DAYS * 864e5) return hit.geo;
  const url = `${NOMINATIM}?format=jsonv2&addressdetails=1&limit=8&countrycodes=au&polygon_geojson=1&polygon_threshold=0.0003&q=${encodeURIComponent(suburb + ", Western Australia")}`;
  const results = await getJson(url, {}, "the map service");
  if (!Array.isArray(results) || !results.length) {
    throw new SearchError(`Couldn't find “${suburb}” in WA. Check the spelling.`);
  }
  const places = results.filter((r) => PLACE_TYPES.includes(r.addresstype) || PLACE_TYPES.includes(r.type));
  const pick = places.find((r) => r.osm_type === "relation") || places[0] || results[0];
  const [s, n, w, e] = (pick.boundingbox || []).map(Number);
  const name = (pick.address && (pick.address.suburb || pick.address.town || pick.address.city || pick.address.village)) || pick.name || suburb;
  const gj = pick.geojson;
  const polygons = gj?.type === "Polygon" ? [gj.coordinates] : gj?.type === "MultiPolygon" ? gj.coordinates : [];
  const geo = {
    name,
    lat: Number(pick.lat),
    lon: Number(pick.lon),
    bbox: Number.isFinite(s) ? { s, n, w, e } : null,
    polygons,
  };
  writeGeoCache(key, geo);
  return geo;
}

/** Point-in-polygon (GeoJSON rings, [lon, lat]); holes are respected. */
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function insideSuburb(geo, lat, lon) {
  if (lat == null || lon == null || !geo.polygons?.length) return null; // unknown
  return geo.polygons.some(([outer, ...holes]) => inRing(lon, lat, outer) && !holes.some((h) => inRing(lon, lat, h)));
}

export function buildOverpassQuery(filters, geo) {
  const { s, w, n, e } = geo.bbox;
  const parts = filters.map((f) => `nwr${f};`).join("");
  return `[out:json][timeout:20][bbox:${s},${w},${n},${e}];(${parts});out center tags 500;`;
}

function osmToLead(el, geo, trade) {
  const t = el.tags || {};
  if (!t.name) return null;
  const site = t.website || t["contact:website"] || t.url || "";
  const social = t["contact:facebook"] || t.facebook || t["contact:instagram"] || t.instagram || "";
  const website = site || (social.startsWith("http") ? social : "");
  const suburb = t["addr:suburb"] || t["addr:city"] || geo.name;
  return {
    name: t.name.trim(),
    ...phoneFields(t.phone || t["contact:phone"] || t["contact:mobile"] || t.mobile || ""),
    address: [t["addr:unit"] ? t["addr:unit"] + "/" : "", t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ").replace("/ ", "/"),
    suburb,
    category: trade.label,
    website,
    websiteKind: site ? websiteKind(site) : social ? "social" : "none",
    lat: el.lat ?? el.center?.lat ?? null,
    lon: el.lon ?? el.center?.lon ?? null,
    source: "OpenStreetMap",
  };
}

/** Backup when the Overpass servers can't be reached: OpenStreetMap's main search (max 40 results). */
export async function searchNominatim(geo, trade) {
  const { s, w, n, e } = geo.bbox;
  const url = `${NOMINATIM}?format=jsonv2&addressdetails=1&extratags=1&bounded=1&limit=40&countrycodes=au`
    + `&viewbox=${w},${n},${e},${s}&q=${encodeURIComponent(trade.nom || trade.tt)}`;
  const results = await getJson(url, {}, "OpenStreetMap");
  if (!Array.isArray(results)) throw new SearchError("OpenStreetMap sent back something unexpected.");
  return results.map((r) => {
    const a = r.address || {};
    const tags = {
      ...(r.extratags || {}),
      name: r.name || r.namedetails?.name || "",
      "addr:housenumber": a.house_number, "addr:street": a.road, "addr:suburb": a.suburb || a.town || a.city,
    };
    const lead = osmToLead({ tags, lat: Number(r.lat), lon: Number(r.lon) }, geo, trade);
    return lead && { ...lead, inside: insideSuburb(geo, lead.lat, lead.lon) };
  }).filter(Boolean);
}

/** Asks every OpenStreetMap server at once and uses whichever answers first. */
export async function searchOsm(geo, trade) {
  if (!geo.bbox) return [];
  const body = buildOverpassQuery(trade.osm, geo);
  const ctrl = new AbortController();
  try {
    const data = await Promise.any(OVERPASS.map((endpoint) =>
      getJson(`${endpoint}?data=${encodeURIComponent(body)}`, { signal: ctrl.signal }, "OpenStreetMap", OVERPASS_TIMEOUT_MS)
        .then((d) => { if (!Array.isArray(d.elements)) throw new SearchError("OpenStreetMap sent back something unexpected."); return d; })));
    ctrl.abort(); // stop the slower servers
    return data.elements.map((el) => osmToLead(el, geo, trade)).filter(Boolean)
      .map((l) => ({ ...l, inside: insideSuburb(geo, l.lat, l.lon) }));
  } catch (e) {
    ctrl.abort();
    console.warn("Overpass failed on every server:", e instanceof AggregateError ? e.errors.map((x) => x.message) : e);
    try {
      const leads = await searchNominatim(geo, trade);
      leads.usedBackup = true;
      return leads;
    } catch {
      const errs = e instanceof AggregateError ? e.errors : [e];
      throw errs.find((x) => x instanceof SearchError) || new SearchError("OpenStreetMap is busy right now. Try again in a minute.");
    }
  }
}

function radiusFor(geo) {
  if (!geo.bbox) return 3000;
  const { s, n, w, e } = geo.bbox;
  const dLat = (n - s) * 111000;
  const dLon = (e - w) * 111000 * Math.cos((geo.lat * Math.PI) / 180);
  return Math.round(Math.min(8000, Math.max(1500, Math.hypot(dLat, dLon) / 2)));
}

export async function searchTomTom(geo, trade, key) {
  const url = `${TOMTOM}${encodeURIComponent(trade.tt)}.json?key=${encodeURIComponent(key)}&lat=${geo.lat}&lon=${geo.lon}&radius=${radiusFor(geo)}&limit=100&countrySet=AU`;
  const data = await getJson(url, {}, "TomTom");
  return (data.results || []).map((r) => {
    const poi = r.poi || {};
    const a = r.address || {};
    const site = poi.url ? (poi.url.includes("://") ? poi.url : "http://" + poi.url) : "";
    return {
      name: (poi.name || "").trim(),
      ...phoneFields(poi.phone || ""),
      address: [a.streetNumber, a.streetName].filter(Boolean).join(" "),
      suburb: a.municipalitySubdivision || a.municipality || geo.name,
      category: trade.label,
      website: site,
      websiteKind: websiteKind(site),
      lat: r.position?.lat ?? null,
      lon: r.position?.lon ?? null,
      source: "TomTom",
    };
  }).filter((l) => l.name).map((l) => ({ ...l, inside: insideSuburb(geo, l.lat, l.lon) }));
}

// ---------- Google Maps directly (Places API New, free demo key) ----------
export class QuotaError extends SearchError {}

let placesRequestCount = 0;
async function placesRequest(payload, fieldMask, key) {
  placesRequestCount++;
  let res;
  try {
    res = await fetch(PLACES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": fieldMask },
      body: JSON.stringify(payload),
    });
  } catch { throw new SearchError("Couldn't reach Google Maps. Check your internet connection."); }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg = data?.error?.message || `error ${res.status}`;
    const status = data?.error?.status || "";
    if (res.status === 429 || status === "RESOURCE_EXHAUSTED" || /quota|limit/i.test(msg)) {
      throw new QuotaError("Today's free Google Maps searches are used up. They reset tomorrow.");
    }
    throw new SearchError(`Google Maps error: ${msg}`);
  }
  return data || {};
}

const PLACE_FIELDS = [
  "places.id", "places.displayName", "places.formattedAddress", "places.addressComponents", "places.location",
  "places.nationalPhoneNumber", "places.websiteUri", "places.businessStatus", "places.googleMapsUri",
  "places.rating", "places.userRatingCount", "places.primaryTypeDisplayName", "nextPageToken",
].join(",");

// ---------- review card links ----------
export const reviewLink = (placeId) => `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;

/** Finds a business on Google Maps so we can build its "leave a review" link. One request. */
export async function findPlaceForReview(text, key) {
  if (!key) throw new SearchError("Google Maps isn't set up.");
  const data = await placesRequest({ textQuery: text, regionCode: "AU", pageSize: 6 },
    "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.googleMapsUri", key);
  return (data.places || []).map((p) => ({
    placeId: p.id, name: p.displayName?.text || "", address: p.formattedAddress || "",
    rating: p.rating ?? null, reviews: p.userRatingCount ?? 0, mapsUrl: p.googleMapsUri || "",
  }));
}

function placesGrid(viewport, n) {
  const lo = viewport.low, hi = viewport.high;
  const dlat = (hi.latitude - lo.latitude) / n, dlng = (hi.longitude - lo.longitude) / n;
  const cells = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    cells.push({ low: { latitude: lo.latitude + i * dlat, longitude: lo.longitude + j * dlng },
      high: { latitude: lo.latitude + (i + 1) * dlat, longitude: lo.longitude + (j + 1) * dlng } });
  }
  return cells;
}

function placeToLead(p, trade) {
  const locality = (p.addressComponents || []).find((c) => (c.types || []).includes("locality"));
  const site = p.websiteUri || "";
  return {
    name: (p.displayName?.text || "").trim(),
    ...phoneFields(p.nationalPhoneNumber || ""),
    address: (p.formattedAddress || "").split(",")[0],
    suburb: locality?.longText || "",
    category: p.primaryTypeDisplayName?.text || trade.label,
    website: site,
    websiteKind: websiteKind(site),
    rating: p.rating ?? null,
    reviews: p.userRatingCount ?? 0,
    mapsUrl: p.googleMapsUri || "",
    lat: p.location?.latitude ?? null,
    lon: p.location?.longitude ?? null,
    closed: (p.businessStatus || "OPERATIONAL") !== "OPERATIONAL",
    fullAddress: p.formattedAddress || "",
    source: "Google Maps",
  };
}

/** Searches Google Maps across a grid over the suburb (beats Google's 60-results-per-search cap). */
const SUB_CACHE_KEY = "arm_gsub_v1";
async function googleSuburb(suburb, key, cache) {
  const k = normalise(suburb);
  try { const local = JSON.parse(localStorage.getItem(SUB_CACHE_KEY) || "{}")[k]; if (local) return local; } catch {}
  const shared = cache ? await cache.get(`sub_${k}`).catch(() => null) : null;
  if (shared?.leads?.[0]) return shared.leads[0];
  const found = await placesRequest({ textQuery: `${suburb} WA Australia`, regionCode: "AU", pageSize: 5 },
    "places.displayName,places.viewport,places.location,places.types", key);
  const places = found.places || [];
  if (!places.length) throw new SearchError(`Couldn't find “${suburb}” on Google Maps. Check the spelling.`);
  const p = places.find((x) => (x.types || []).some((t) => ["locality", "sublocality", "postal_code"].includes(t))) || places[0];
  const sub = { viewport: p.viewport || null, location: p.location || null };
  try { const all = JSON.parse(localStorage.getItem(SUB_CACHE_KEY) || "{}"); all[k] = sub; localStorage.setItem(SUB_CACHE_KEY, JSON.stringify(all)); } catch {}
  if (cache) cache.put(`sub_${k}`, [sub]).catch(() => {});
  return sub;
}

export async function searchPlaces(suburb, trade, key, coverage, onProgress = () => {}, cache = null) {
  const sub = await googleSuburb(suburb, key, cache);
  const areas = sub.viewport
    ? placesGrid(sub.viewport, PLACES_GRID[coverage] || 1).map((rectangle) => ({ locationRestriction: { rectangle } }))
    : [{ locationBias: { circle: { center: sub.location, radius: 3000 } } }];
  const all = [];
  let done = 0;
  await Promise.all(areas.map(async (area) => {
    let payload = { textQuery: trade.tt, regionCode: "AU", pageSize: 20, ...area };
    for (let page = 0; page < 3; page++) {
      const data = await placesRequest(payload, PLACE_FIELDS, key);
      all.push(...(data.places || []));
      if (!data.nextPageToken) break;
      payload = { ...payload, pageToken: data.nextPageToken };
    }
    done++;
    if (areas.length > 1) onProgress(`Searching Google Maps… ${done} of ${areas.length} areas done`);
  }));
  const seen = new Set();
  return all.filter((p) => p.id && !seen.has(p.id) && seen.add(p.id)).map((p) => placeToLead(p, trade)).filter((l) => l.name && !l.closed);
}

// ---------- Google Maps (via Apify's Google Maps Scraper, free monthly credit) ----------
export class CreditError extends SearchError {}

function googleToLead(p, trade, suburb) {
  const site = p.website || "";
  const city = p.city || p.neighborhood || "";
  return {
    name: (p.title || "").trim(),
    ...phoneFields(p.phoneUnformatted || p.phone || ""),
    address: p.street || "",
    suburb: city || suburb,
    category: p.categoryName || trade.label,
    website: site,
    websiteKind: websiteKind(site),
    rating: p.totalScore ?? null,
    reviews: p.reviewsCount ?? 0,
    mapsUrl: p.url || "",
    lat: p.location?.lat ?? null,
    lon: p.location?.lng ?? null,
    closed: !!(p.permanentlyClosed || p.temporarilyClosed),
    fullAddress: p.address || "",
    source: "Google Maps",
  };
}

export async function searchGoogle(suburb, trade, token, maxPlaces) {
  const body = {
    searchStringsArray: [trade.tt],
    locationQuery: `${suburb}, Western Australia, Australia`,
    maxCrawledPlacesPerSearch: maxPlaces,
    language: "en",
    countryCode: "au",
    skipClosedPlaces: true,
    scrapePlaceDetailPage: false,
    maxImages: 0,
    maxReviews: 0,
  };
  let res;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 280000);
    res = await fetch(`${APIFY_GMAPS}?token=${encodeURIComponent(token)}&timeout=270&format=json&clean=1`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
  } catch (e) {
    throw new SearchError(e?.name === "AbortError" ? "Google Maps search took too long. Try Quick coverage." : "Couldn't reach the Google Maps service. Check your internet connection.");
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg = (data && data.error && (data.error.message || data.error.type)) || `error ${res.status}`;
    if (res.status === 401 || /token|auth/i.test(msg)) throw new SearchError("The Google Maps connection key is wrong. An admin can fix it under Admin → Team.");
    if (res.status === 402 || /credit|usage|limit|insufficient|exceed/i.test(msg)) throw new CreditError("This month's free Google Maps credit is used up. It resets at the start of next month.");
    throw new SearchError(`Google Maps search failed (${msg}). Try again.`);
  }
  if (!Array.isArray(data)) throw new SearchError("Google Maps sent back something unexpected. Try again.");
  return data.map((p) => googleToLead(p, trade, suburb)).filter((l) => l.name && !l.closed);
}

function inSuburbByAddress(lead, suburb) {
  if (normalise(lead.suburb) === normalise(suburb)) return true;
  const escaped = suburb.trim().replace(/[.*+?^$()|[\]{}\\]/g, (c) => "\\" + c);
  return new RegExp("\\b" + escaped + "\\b", "i").test(lead.fullAddress || "");
}

export function leadKey(lead) { return `${slug(lead.name)}--${slug(lead.suburb)}`.slice(0, 300) || "unnamed"; }

const KIND_ORDER = { none: 0, social: 1, website: 2 };

/** Merges results from both sources, de-duplicated by business name + suburb. */
export function mergeLeads(lists, geo, onlySuburb) {
  const merged = new Map();
  for (const lead of lists.flat()) {
    if (onlySuburb) {
      const inside = lead.inside ?? (normalise(lead.suburb) === normalise(geo.name));
      if (!inside) continue;
      lead.suburb = geo.name;
    }
    delete lead.inside;
    const id = leadKey(lead);
    const prev = merged.get(id);
    if (!prev) { merged.set(id, { ...lead, id }); continue; }
    if (lead.phoneValid && !prev.phoneValid) { prev.phone = lead.phone; prev.phoneValid = true; }
    for (const f of ["address", "website"]) if (!prev[f] && lead[f]) prev[f] = lead[f];
    if (KIND_ORDER[lead.websiteKind] > KIND_ORDER[prev.websiteKind]) prev.websiteKind = lead.websiteKind;
    if (!prev.source.includes(lead.source)) prev.source += " + " + lead.source;
  }
  return [...merged.values()].sort((a, b) =>
    KIND_ORDER[a.websiteKind] - KIND_ORDER[b.websiteKind] || (b.phoneValid ? 1 : 0) - (a.phoneValid ? 1 : 0) || a.name.localeCompare(b.name));
}

const resultCache = new Map(); // same search within 30 minutes is instant
const RESULT_TTL_MS = 30 * 60 * 1000;

function finishGoogle(leads, suburb, trade, onlySuburb, fromCache, errors = []) {
  const displaySuburb = suburb.trim().replace(/\b\w/g, (c) => c.toUpperCase());
  const filtered = onlySuburb ? leads.filter((l) => inSuburbByAddress(l, suburb)) : leads;
  const merged = new Map();
  for (const l of filtered) {
    const lead = { ...l, suburb: onlySuburb ? displaySuburb : (l.suburb || displaySuburb) };
    const id = leadKey(lead);
    if (!merged.has(id)) merged.set(id, { ...lead, id });
  }
  const sorted = [...merged.values()].sort((a, b) =>
    KIND_ORDER[a.websiteKind] - KIND_ORDER[b.websiteKind] || (b.phoneValid ? 1 : 0) - (a.phoneValid ? 1 : 0) || (b.reviews || 0) - (a.reviews || 0));
  return { suburb: displaySuburb, trade, leads: sorted, counts: { google: leads.length }, errors, cached: fromCache, source: "google" };
}

export async function searchBusinesses({ suburb, tradeId, onlySuburb = true, tomtomKey = "", googleToken = "", placesKey = "",
  coverage = "standard", cache = null, onProgress = () => {} }) {
  const trade = TRADES.find((t) => t.id === tradeId);
  if (!trade) throw new SearchError("Pick a business type.");
  const notes = [];
  if (placesKey) {
    // A search with more coverage also answers smaller ones, so check thorough > standard > quick
    const order = ["thorough", "standard", "quick"];
    for (const c of order.slice(0, order.indexOf(coverage) + 1)) {
      const hit = cache ? await cache.get(`p_${normalise(suburb)}_${tradeId}_${c}`).catch(() => null) : null;
      if (hit && Date.now() - hit.at < 30 * 864e5) return finishGoogle(hit.leads, suburb, trade, onlySuburb, true);
    }
    onProgress(`Searching Google Maps for ${trade.label.toLowerCase()} in ${suburb}…`);
    const before = placesRequestCount;
    try {
      const leads = await searchPlaces(suburb, trade, placesKey, coverage, onProgress, cache);
      if (cache) cache.put(`p_${normalise(suburb)}_${tradeId}_${coverage}`, leads).catch(() => {});
      return { ...finishGoogle(leads, suburb, trade, onlySuburb, false), googleRequests: placesRequestCount - before };
    } catch (e) {
      if (!(e instanceof QuotaError)) throw e;
      notes.push(e.message + (googleToken ? " Using the backup Google Maps connection." : " Showing OpenStreetMap results instead."));
      onProgress(googleToken ? "Daily Google limit reached, using the backup connection…" : "Daily Google limit reached, searching OpenStreetMap…");
    }
  }
  if (googleToken) {
    const maxPlaces = GOOGLE_COVERAGE[coverage] || GOOGLE_COVERAGE.standard;
    const key = `g_${normalise(suburb)}_${tradeId}_${maxPlaces}`;
    let leads = null, fromCache = false;
    const hit = cache ? await cache.get(key).catch(() => null) : null;
    if (hit && Date.now() - hit.at < 7 * 864e5) { leads = hit.leads; fromCache = true; }
    if (!leads) {
      onProgress(`Searching Google Maps for ${trade.label.toLowerCase()} in ${suburb}… this usually takes 30–90 seconds.`);
      try {
        leads = await searchGoogle(suburb, trade, googleToken, maxPlaces);
        if (cache) cache.put(key, leads).catch(() => {});
      } catch (e) {
        if (!(e instanceof CreditError)) throw e;
        onProgress("Google Maps credit used up this month. Searching OpenStreetMap instead…");
        const fallback = await searchBusinesses({ suburb, tradeId, onlySuburb, tomtomKey, onProgress });
        return { ...fallback, errors: notes.concat([e.message + " Showing OpenStreetMap results instead."], fallback.errors) };
      }
    }
    return finishGoogle(leads, suburb, trade, onlySuburb, fromCache, notes);
  }
  const cacheKey = [normalise(suburb), tradeId, onlySuburb, !!tomtomKey].join("|");
  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.at < RESULT_TTL_MS) return { ...cached.result, leads: cached.result.leads.map((l) => ({ ...l })), cached: true };
  onProgress(`Finding ${suburb} on the map…`);
  const geo = await findSuburb(suburb);
  if (!geo.bbox) throw new SearchError(`Couldn't work out where “${suburb}” is. Try the full suburb name.`);
  onProgress(`Searching ${trade.label.toLowerCase()} businesses in ${geo.name}…`);
  const jobs = [searchOsm(geo, trade)];
  if (tomtomKey) jobs.push(searchTomTom(geo, trade, tomtomKey));
  const settled = await Promise.allSettled(jobs);
  const lists = [], errors = [];
  // notes from the Google step (if any) are carried through
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      lists.push(r.value);
      if (r.value.usedBackup) notes.push("OpenStreetMap's business search couldn't be reached (a VPN or ad blocker can cause this), so this is a shorter backup list of up to 40.");
    }
    else errors.push(`${i === 0 ? "OpenStreetMap" : "TomTom"}: ${r.reason?.message || "failed"}`);
  });
  if (!lists.length) throw new SearchError(errors.join(" ") + " If you're using a VPN or ad blocker, try turning it off.");
  const result = {
    suburb: geo.name,
    trade,
    leads: mergeLeads(lists, geo, onlySuburb),
    counts: { osm: settled[0].status === "fulfilled" ? settled[0].value.length : null, tomtom: tomtomKey ? (settled[1]?.status === "fulfilled" ? settled[1].value.length : null) : undefined },
    errors: errors.concat(notes),
  };
  if (!errors.length && !notes.length) resultCache.set(cacheKey, { at: Date.now(), result });
  return result;
}


// ---------- "does this business actually have a website?" check ----------
const DOMAIN_CACHE_KEY = "arm_dns_v1";
function readDomainCache() { try { return JSON.parse(localStorage.getItem(DOMAIN_CACHE_KEY) || "{}"); } catch { return {}; } }
function saveDomainCache(c) {
  try {
    const keys = Object.keys(c).slice(-800);
    localStorage.setItem(DOMAIN_CACHE_KEY, JSON.stringify(Object.fromEntries(keys.map((k) => [k, c[k]]))));
  } catch { /* fine */ }
}

/** Likely website addresses for a business name, e.g. "Ubai's Barbershop" -> ubaisbarbershop.com.au */
export function domainGuesses(name) {
  const base = slug(String(name).replace(/['’]/g, "")).replace(/^the-/, "").replace(/-(pty|ltd|pty-ltd)$/g, "").replace(/-/g, "");
  if (base.length < 4 || base.length > 50) return [];
  return [`${base}.com.au`, `${base}.au`];
}

async function domainExists(domain, cache) {
  if (domain in cache) return cache[domain];
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`, { headers: { accept: "application/dns-json" } });
    const data = await res.json();
    cache[domain] = data.Status === 0 && Array.isArray(data.Answer) && data.Answer.length > 0;
  } catch { return false; } // don't cache network failures
  return cache[domain];
}

/** For leads with no website listed, looks for a matching .com.au/.au domain. Calls onFound(lead) as matches come in. */
export async function findHiddenWebsites(leads, onFound) {
  const cache = readDomainCache();
  const todo = leads.filter((l) => l.websiteKind === "none" && !l.maybeSite).slice(0, 80);
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const lead = todo[i++];
      for (const d of domainGuesses(lead.name)) {
        if (await domainExists(d, cache)) { lead.maybeSite = d; onFound(lead); break; }
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  saveDomainCache(cache);
}
