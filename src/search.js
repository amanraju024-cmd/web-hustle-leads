// Finds local businesses from OpenStreetMap (free, no key) and optionally TomTom (free key, no card).
import { normalise, slug } from "./util.js";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const TOMTOM = "https://api.tomtom.com/search/2/poiSearch/";

// Business types: OpenStreetMap tag filters + the words TomTom searches for
export const TRADES = [
  { id: "barber", label: "Barber", osm: ['["shop"="hairdresser"]["hairdresser"~"barber|men",i]', '["shop"="barber"]', '["shop"~"hairdresser"]["name"~"barber",i]'], tt: "barber" },
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

async function getJson(url, opts, what) {
  let res;
  try { res = await fetch(url, opts); }
  catch { throw new SearchError(`Couldn't reach ${what}. Check your internet connection.`); }
  if (res.status === 429) throw new SearchError(`${what} is busy right now. Wait a minute and try again.`);
  if (!res.ok) throw new SearchError(`${what} returned an error (${res.status}). Try again in a minute.`);
  try { return await res.json(); }
  catch { throw new SearchError(`${what} sent back something unexpected. Try again.`); }
}

const PLACE_TYPES = ["suburb", "town", "city", "village", "quarter", "neighbourhood", "hamlet", "locality", "city_district", "municipality"];

export async function findSuburb(suburb) {
  const url = `${NOMINATIM}?format=jsonv2&addressdetails=1&limit=8&countrycodes=au&q=${encodeURIComponent(suburb + ", Western Australia")}`;
  const results = await getJson(url, {}, "the map service");
  if (!Array.isArray(results) || !results.length) {
    throw new SearchError(`Couldn't find “${suburb}” in WA. Check the spelling.`);
  }
  const places = results.filter((r) => PLACE_TYPES.includes(r.addresstype) || PLACE_TYPES.includes(r.type));
  const pick = places.find((r) => r.osm_type === "relation") || places[0] || results[0];
  const [s, n, w, e] = (pick.boundingbox || []).map(Number);
  const name = (pick.address && (pick.address.suburb || pick.address.town || pick.address.city || pick.address.village)) || pick.name || suburb;
  return {
    name,
    lat: Number(pick.lat),
    lon: Number(pick.lon),
    bbox: Number.isFinite(s) ? { s, n, w, e } : null,
    areaId: pick.osm_type === "relation" ? 3600000000 + Number(pick.osm_id) : null,
  };
}

export function buildOverpassQuery(filters, geo) {
  const scope = geo.areaId ? "(area.a)" : `(${geo.bbox.s},${geo.bbox.w},${geo.bbox.n},${geo.bbox.e})`;
  const head = geo.areaId ? `area(id:${geo.areaId})->.a;` : "";
  const parts = filters.map((f) => `nwr${f}${scope};`).join("");
  return `[out:json][timeout:25];${head}(${parts});out center tags 400;`;
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

export async function searchOsm(geo, trade) {
  if (!geo.areaId && !geo.bbox) return [];
  const body = new URLSearchParams({ data: buildOverpassQuery(trade.osm, geo) });
  let lastErr;
  for (const endpoint of OVERPASS) {
    try {
      const data = await getJson(endpoint, { method: "POST", body }, "OpenStreetMap");
      return (data.elements || []).map((el) => osmToLead(el, geo, trade)).filter(Boolean);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
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
  }).filter((l) => l.name);
}

export function leadKey(lead) { return `${slug(lead.name)}--${slug(lead.suburb)}`.slice(0, 300) || "unnamed"; }

const KIND_ORDER = { none: 0, social: 1, website: 2 };

/** Merges results from both sources, de-duplicated by business name + suburb. */
export function mergeLeads(lists, geo, onlySuburb) {
  const merged = new Map();
  for (const lead of lists.flat()) {
    if (onlySuburb && normalise(lead.suburb) !== normalise(geo.name)) {
      // OSM results come from inside the suburb boundary already; trust them even if addr:suburb is missing/different
      if (lead.source !== "OpenStreetMap") continue;
      lead.suburb = geo.name;
    }
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

export async function searchBusinesses({ suburb, tradeId, onlySuburb = true, tomtomKey = "" }) {
  const trade = TRADES.find((t) => t.id === tradeId);
  if (!trade) throw new SearchError("Pick a business type.");
  const geo = await findSuburb(suburb);
  const jobs = [searchOsm(geo, trade)];
  if (tomtomKey) jobs.push(searchTomTom(geo, trade, tomtomKey));
  const settled = await Promise.allSettled(jobs);
  const lists = [], errors = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") lists.push(r.value);
    else errors.push(`${i === 0 ? "OpenStreetMap" : "TomTom"}: ${r.reason?.message || "failed"}`);
  });
  if (!lists.length) throw new SearchError(errors.join(" "));
  return {
    suburb: geo.name,
    trade,
    leads: mergeLeads(lists, geo, onlySuburb),
    counts: { osm: settled[0].status === "fulfilled" ? settled[0].value.length : null, tomtom: tomtomKey ? (settled[1]?.status === "fulfilled" ? settled[1].value.length : null) : undefined },
    errors,
  };
}
