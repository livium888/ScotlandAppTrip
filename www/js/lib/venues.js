// Naming the cinemas and theatres in an area, for the question sent to a
// searching model. Pure, so it can be tested in Node directly.
//
// Names make the model look things up. Given "Cinemas in this area include:
// ..., check each one's own listings" it searches; given a generic question
// it often decides to answer from memory, and an answer from memory is set
// aside. So the app goes to some trouble to have names - from more than one
// place, and failing both, from the towns and the chains.
import { haversineKm } from "./geo.js";

// left,top,right,bottom - the order Nominatim's viewbox wants. A degree of
// longitude is shorter than a degree of latitude away from the equator.
export function viewboxFor(lat, lon, radiusMetres) {
  const dLat = radiusMetres / 111320;
  const dLon = radiusMetres / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return [lon - dLon, lat + dLat, lon + dLon, lat - dLat].map((n) => n.toFixed(5)).join(",");
}

const VENUE_LIMIT = 12;

// Nominatim's answer to "cinema" inside a box, as labels, nearest first.
export function parseNominatimVenues(results, { lat, lon, types }) {
  if (!Array.isArray(results)) return [];
  const labelled = [];
  for (const r of results) {
    if (!r || typeof r !== "object" || !types.includes(r.type) || r.class !== "amenity") continue;
    const la = Number(r.lat);
    const lo = Number(r.lon);
    const name = String((r.namedetails && r.namedetails.name) || String(r.display_name || "").split(",")[0] || "").trim();
    if (!name || !Number.isFinite(la) || !Number.isFinite(lo)) continue;
    const a = r.address || {};
    const town = a.town || a.city || a.village || a.suburb || "";
    labelled.push({ label: town && !name.includes(town) ? `${name} (${town})` : name, km: haversineKm(lat, lon, la, lo) });
  }
  return labelled
    .sort((x, y) => x.km - y.km)
    .filter((x, i, all) => all.findIndex((y) => y.label === x.label) === i)
    .slice(0, VENUE_LIMIT)
    .map((x) => x.label);
}

const CHAINS = "Vue, Odeon, Cineworld, Reel, Everyman, Picturehouse and independent cinemas";

// The sentence about venues. With names: check each. Without: name the towns
// and, for films, the chains, so the model has something concrete to look up
// rather than a general question it can answer from memory.
export function venuesLine({ film, named, towns }) {
  if (named && named.length) {
    return `${film ? "Cinemas" : "Theatres and arts centres"} in this area include: ${named.join(", ")}. Check each one's own listings.\n`;
  }
  const near = (towns || []).slice(0, VENUE_LIMIT);
  if (film) {
    return near.length
      ? `Cinemas in this area are in or near: ${near.join(", ")}. Look up the cinemas in each of those places, covering ${CHAINS}, then check each cinema's own listings.\n`
      : `Look up the cinemas in this area, covering ${CHAINS}, then check each cinema's own listings.\n`;
  }
  return near.length
    ? `Theatres and arts centres in this area are in or near: ${near.join(", ")}. Look up the theatres and arts centres in each of those places, then check each one's own listings.\n`
    : "";
}

// Several sources asked together: the first to come back with something wins,
// and a source that fails or is empty does not stop the others.
export function firstNonEmpty(promises) {
  return new Promise((resolve) => {
    let waiting = promises.length;
    if (!waiting) return resolve([]);
    const lose = () => {
      waiting -= 1;
      if (waiting === 0) resolve([]);
    };
    promises.forEach((p) =>
      Promise.resolve(p).then(
        (v) => (Array.isArray(v) && v.length ? resolve(v) : lose()),
        lose
      )
    );
  });
}
