// Finds local businesses from OpenStreetMap (free, no key) and optionally TomTom (free key, no card).
import { normalise, slug } from "./util.js";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const OVERPASS_TIMEOUT_MS = 20000;
const TOMTOM = "https://api.tomtom.com/search/2/poiSearch/";

// Business types: OpenStreetMap tag filters + the words TomTom searches for
export const TRADES = [
  { id: "barber", label: "Barber", osm: ['["shop"="hairdresser"]["hairdresser"~"barber|men",i]', '["shop"="barber"]', '["shop"="hairdresser"]["name"~"barber",i]'], tt: "barber" },
  { id: "hair", label: "Hair salon", osm: ['["shop"="hairdresser"]'], tt: "hair salon" },
  { id: "beauty", label: "Beauty salon", osm: ['["shop"="beauty"]', '["shop"="cosmetics"]'], tt: "beauty salon" },
  { id: "nails", label: "Nail salon", osm: ['["shop"="beauty"]["beauty"~"nails",i]', '["shop"="beauty"]["name"~"nail",i]'], tt: "nail salon" },
  { id: "massage", label: "Massage", osm: ['["shop"="massage"]', '["healthcare"="massage"]'], tt: "massage" },
  { id: "cafe", label: "Cafe", osm: ['["amenity"="cafe"]'], tt: "cafe" },
  { id: "restaurant", label: "Restaurant", osm: ['["amenity"="restaurant"]'], tt: "restaurant" },
  { id: "takeaway", label: "Takeaway", osm: ['["amenity"="fast_food"]'], tt: "takeaway" },
  { id: "bakery", label: "Bakery", osm: ['["shop"="bakery"]', '["shop"="pastry"]'], tt: "bakery" },
  { id: "florist", label: "Florist", osm: ['["shop"="florist"]'], tt: "florist" },
  { id: "mechanic", label: "Mechanic", osm: ['["shop"="car_repair"]', '["shop"="tyres"]'], tt: "car repair" },
  { id: "plumber", label: "Plumber", osm: ['["craft"="plumber"]'], tt: "plumber" },
  { id: "electrician", label: "Electrician", osm: ['["craft"="electrician"]'], tt: "electrician" },
  { id: "builder", label: "Builder", osm: ['["craft"="builder"]', '["office"="construction_company"]'], tt: "builder" },
  { id: "painter", label: "Painter", osm: ['["craft"="painter"]'], tt: "painter" },
  { id: "landscaper", label: "Landscaper / gardener", osm: ['["craft"="gardener"]', '["shop"="garden_centre"]'], tt: "landscaping" },
  { id: "cleaner", label: "Cleaner", osm: ['["shop"="dry_cleaning"]', '["shop"="laundry"]', '["craft"="cleaning"]'], tt: "cleaning" },
  { id: "dentist", label: "Dentist", osm: ['["amenity"="dentist"]', '["healthcare"="dentist"]'], tt: "dentist" },
  { id: "physio", label: "Physiotherapist", osm: ['["healthcare"="physiotherapist"]'], tt: "physiotherapist" },
  { id: "gym", label: "Gym / fitness", osm: ['["leisure"="fitness_centre"]', '["leisure"="sports_centre"]["sport"~"fitness|martial",i]'], tt: "gym" },
  { id: "pet", label: "Pet groomer / pet shop", osm: ['["shop"="pet"]', '["shop"="pet_grooming"]', '["amenity"="veterinary"]'], tt: "pet grooming" },
  { id: "tattoo", label: "Tattoo", osm: ['["shop"="tattoo"]'], tt: "tattoo" },
  { id: "accountant", label: "Accountant", osm: ['["office"="accountant"]', '["office"="tax_advisor"]'], tt: "accountant" },
  { id: "realestate", label: "Real estate agent", osm: ['["office"="estate_agent"]'], tt: "real estate agent" },
  { id: "retail", label: "Any shop", osm: ['["shop"]'], tt: "shop" },
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
    phone: (t.phone || t["contact:phone"] || t["contact:mobile"] || t.mobile || "").split(";")[0].trim(),
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

/** Asks every OpenStreetMap server at once and uses whichever answers first. */
export async function searchOsm(geo, trade) {
  if (!geo.bbox) return [];
  const body = buildOverpassQuery(trade.osm, geo);
  const ctrl = new AbortController();
  try {
    const data = await Promise.any(OVERPASS.map((endpoint) =>
      getJson(endpoint, { method: "POST", body: new URLSearchParams({ data: body }), signal: ctrl.signal }, "OpenStreetMap", OVERPASS_TIMEOUT_MS)
        .then((d) => { if (!Array.isArray(d.elements)) throw new SearchError("OpenStreetMap sent back something unexpected."); return d; })));
    ctrl.abort(); // stop the slower servers
    return data.elements.map((el) => osmToLead(el, geo, trade)).filter(Boolean)
      .map((l) => ({ ...l, inside: insideSuburb(geo, l.lat, l.lon) }));
  } catch (e) {
    ctrl.abort();
    const errs = e instanceof AggregateError ? e.errors : [e];
    throw errs.find((x) => x instanceof SearchError) || new SearchError("OpenStreetMap is busy right now. Try again in a minute.");
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
      phone: (poi.phone || "").replace(/^\+61\s?/, "0").trim(),
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
    for (const f of ["phone", "address", "website"]) if (!prev[f] && lead[f]) prev[f] = lead[f];
    if (KIND_ORDER[lead.websiteKind] > KIND_ORDER[prev.websiteKind]) prev.websiteKind = lead.websiteKind;
    if (!prev.source.includes(lead.source)) prev.source += " + " + lead.source;
  }
  return [...merged.values()].sort((a, b) =>
    KIND_ORDER[a.websiteKind] - KIND_ORDER[b.websiteKind] || (b.phone ? 1 : 0) - (a.phone ? 1 : 0) || a.name.localeCompare(b.name));
}

const resultCache = new Map(); // same search within 30 minutes is instant
const RESULT_TTL_MS = 30 * 60 * 1000;

export async function searchBusinesses({ suburb, tradeId, onlySuburb = true, tomtomKey = "", onProgress = () => {} }) {
  const trade = TRADES.find((t) => t.id === tradeId);
  if (!trade) throw new SearchError("Pick a business type.");
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
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") lists.push(r.value);
    else errors.push(`${i === 0 ? "OpenStreetMap" : "TomTom"}: ${r.reason?.message || "failed"}`);
  });
  if (!lists.length) throw new SearchError(errors.join(" "));
  const result = {
    suburb: geo.name,
    trade,
    leads: mergeLeads(lists, geo, onlySuburb),
    counts: { osm: settled[0].status === "fulfilled" ? settled[0].value.length : null, tomtom: tomtomKey ? (settled[1]?.status === "fulfilled" ? settled[1].value.length : null) : undefined },
    errors,
  };
  if (!errors.length) resultCache.set(cacheKey, { at: Date.now(), result });
  return result;
}
