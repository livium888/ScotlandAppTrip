(function () {
  "use strict";

  const view = document.getElementById("view");
  const tabbar = document.getElementById("tabbar");
  const topbarTitle = document.getElementById("topbarTitle");
  const topbarSub = document.getElementById("topbarSub");

  const STORAGE_KEY = "scotland-trip-packing-v1";

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function cityColor(city) {
    return CITY_COLORS[city] || CITY_COLORS.Travel;
  }

  function mapsUrlFor(mapsQuery) {
    return mapsQuery
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`
      : null;
  }

  // A place shared from Google Maps carries Google's own id for it, which we
  // turn into a "?cid=" link. That addresses the exact place, so prefer it
  // over a name search - the search can and does land on the wrong "Manchester".
  function pickGoogleUrl(p) {
    return p.googleUrl || mapsUrlFor(pickMapsQuery(p));
  }

  // Opens a link in an in-app Chrome Custom Tab when running natively. A
  // Custom Tab is real Chrome, so it reuses the browser's cookies - the
  // Google consent/sign-in already accepted there carries over, which a
  // plain embedded WebView (its own cookie jar) would not do.
  async function openExternal(url) {
    const browser = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
    if (browser) {
      try {
        await browser.open({ url, presentationStyle: "popover" });
        return;
      } catch (e) {
        // fall through to a normal navigation
      }
    }
    window.open(url, "_blank", "noopener");
  }

  // A raw "lat,lon" query just drops an unlabelled pin - no name, reviews,
  // hours, or photos attached. Searching by name (+ city for disambiguation)
  // resolves to the actual place listing instead, so always prefer that.
  function pickMapsQuery(p) {
    // Deliberately never falls back to p.city (the folder) - that's pure
    // organisation, not geography, and baking it into the search text can
    // send Maps looking in the wrong place entirely.
    return p.mapsQuery || scopedQuery(p.name);
  }

  function findPlace(name) {
    return PLACES.find((p) => p.name === name) || EATS.find((e) => e.name === name);
  }

  function goToMapsSearch(query) {
    const q = (query || "").trim();
    if (!q) return;
    window.open(mapsUrlFor(q), "_blank", "noopener");
  }

  function wireSearchBar(formId, inputId, buildQuery) {
    const form = document.getElementById(formId);
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const raw = document.getElementById(inputId).value;
      if (!raw.trim()) return;
      goToMapsSearch(buildQuery ? buildQuery(raw) : raw);
    });
  }

  // ---------- Trip settings ----------
  // Everything location-specific lives here rather than being baked into the
  // code. The bundled Scotland itinerary is just the default content; the
  // destination below is what search, geocoding and folders actually key off,
  // so pointing the app at anywhere else is a matter of editing it.
  const TRIP_KEY = "trip-settings-v1";

  function loadTripSettings() {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(TRIP_KEY)) || {};
    } catch (e) {
      stored = {};
    }
    return {
      title: stored.title || TRIP.title,
      // A region name used to bias place lookups ("Scotland", "Greater
      // Manchester", ""). Empty means search the whole world.
      destination: stored.destination !== undefined ? stored.destination : DEFAULT_DESTINATION,
      googleKey: stored.googleKey || "",
      geminiKey: stored.geminiKey || "",
      // Discovered model name, cached so a working key isn't re-probed on
      // every call. Cleared automatically if the model stops resolving.
      geminiModel: stored.geminiModel || "",
      // Models discovered from the key, cached so the picker has something to
      // show without re-probing every time Settings opens.
      geminiModels: Array.isArray(stored.geminiModels) ? stored.geminiModels : [],
      // Free text about who is travelling, so AI suggestions are tailored
      // rather than generic ("family of 3, 4-year-old who walks, no stroller").
      travellers: stored.travellers !== undefined ? stored.travellers : TRIP.traveler || "",
    };
  }

  function saveTripSettings(patch) {
    const next = Object.assign(loadTripSettings(), patch);
    localStorage.setItem(TRIP_KEY, JSON.stringify(next));
    return next;
  }

  // Appends the trip's region to a lookup so "Museum" finds the one you mean,
  // while staying empty-safe so a trip with no region set searches globally.
  function scopedQuery(text) {
    const dest = loadTripSettings().destination.trim();
    return dest ? `${text}, ${dest}` : text;
  }

  // ---------- Gemini (optional, free tier) ----------
  // Used for the things a database lookup is bad at: judgement, and turning a
  // vague ask into candidate places. Google Search grounding is switched on so
  // answers come from real search results with citations attached, rather than
  // from the model's memory.
  //
  // Deliberately never trusted for opening hours. Those change seasonally and
  // for holidays, and stale hours are the one error with a real cost here -
  // turning up to a closed museum with a small child. Hours are always
  // labelled as needing a check, and structured OSM data wins when it exists.
  const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

  // Model names come and go, and a name this app hardcoded can simply stop
  // existing for a given project - which surfaces as a 404 that looks
  // identical to "your key is broken". So the model is discovered from the
  // account rather than assumed, and the choice cached in settings.
  // Cheapest-capable first: the lite flash tiers cost a fraction of pro and
  // are more than adequate for naming places and ordering a day. Only used to
  // pick a sensible default - the Settings picker overrides it.
  const GEMINI_MODEL_PREFERENCE = ["flash-lite", "flash-latest", "flash", "pro"];

  async function geminiListModels(key) {
    const res = await fetch(`${GEMINI_BASE}/models?key=${encodeURIComponent(key)}`);
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = null;
    }
    if (!res.ok) {
      const err = new Error(describeGeminiError(res.status, data, text));
      err.status = res.status;
      throw err;
    }
    return (data && data.models ? data.models : []).filter(
      (m) => (m.supportedGenerationMethods || []).indexOf("generateContent") >= 0
    );
  }

  // Turns Google's error payloads into something worth showing a user, since
  // the raw JSON is long and the useful part is buried in it.
  function describeGeminiError(status, data, rawText) {
    const err = (data && data.error) || {};
    const msg = err.message || (rawText || "").slice(0, 300) || "no detail";
    const reason =
      (err.details || [])
        .map((d) => d.reason || "")
        .filter(Boolean)
        .join(", ") || err.status || "";

    if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(msg + reason)) {
      return `Key rejected by Google (400 API_KEY_INVALID). Check it was copied whole, and that it's a Gemini key from aistudio.google.com — a Maps/Places key won't work here.\n\n${msg}`;
    }
    if (status === 403 && /SERVICE_DISABLED|has not been used in project|is disabled/i.test(msg + reason)) {
      return `The Generative Language API isn't enabled on that key's project (403 SERVICE_DISABLED). Open the link in Google's message below and enable it, then wait a minute.\n\n${msg}`;
    }
    if (status === 403 && /referer|referrer|API_KEY_HTTP_REFERRER|blocked/i.test(msg + reason)) {
      return `The key has website (HTTP referrer) restrictions, and requests from this app don't send a matching referrer (403). In Google Cloud → Credentials, set Application restrictions to "None" for testing, or add an Android app restriction.\n\n${msg}`;
    }
    if (status === 403) {
      return `Google refused the key (403). Often this is API restrictions on the key limiting it to other APIs.\n\n${msg}`;
    }
    if (status === 404) {
      return `Model not found (404) — the model this app asked for isn't available to your key.\n\n${msg}`;
    }
    if (status === 429) {
      return `Rate limit or quota exceeded (429). Free tier limits are per-minute as well as per-day, so waiting a minute often clears it.\n\n${msg}`;
    }
    return `Gemini returned ${status}.\n\n${msg}`;
  }

  // Verifies the key end to end and reports precisely what happened. Used by
  // the Settings "Test key" button so a failure is visible on the device
  // rather than buried in a console nobody can read on a phone.
  async function testGeminiKey(key) {
    if (!key) return { ok: false, message: "No key entered." };
    let models;
    try {
      models = await geminiListModels(key);
    } catch (e) {
      return { ok: false, message: e.message || String(e) };
    }
    if (!models.length) {
      return { ok: false, message: "The key works, but no models on it support generateContent." };
    }
    // Keep the full list so Settings can offer a picker - model names change
    // often enough that hardcoding one is how this broke the first time.
    const names = models.map((m) => m.name);
    const chosen = chooseGeminiModel(models);
    saveTripSettings({ geminiModel: chosen, geminiModels: names });

    try {
      await callGemini(key, "Reply with the single word: ok");
    } catch (e) {
      return {
        ok: false,
        message: `Key is valid and ${models.length} models are visible, but the test message failed.\n\n${e.message || e}`,
      };
    }
    return {
      ok: true,
      models: names,
      message: `Working. Using ${chosen.replace(/^models\//, "")}. ${models.length} models available — pick a different one below if you prefer.`,
    };
  }

  function chooseGeminiModel(models) {
    const names = models.map((m) => m.name);
    for (const pref of GEMINI_MODEL_PREFERENCE) {
      const hit = names.find((n) => n.indexOf(pref) >= 0);
      if (hit) return hit;
    }
    return names[0];
  }

  // Returns the cached model, discovering one if this key hasn't been used
  // yet, so a first run works without the user having to press "Test key".
  async function resolveGeminiModel(key) {
    const cached = loadTripSettings().geminiModel;
    if (cached) return cached;
    const models = await geminiListModels(key);
    if (!models.length) throw new Error("No Gemini models on this key support generateContent.");
    const chosen = chooseGeminiModel(models);
    saveTripSettings({ geminiModel: chosen });
    return chosen;
  }

  async function callGemini(key, prompt, { grounded = false } = {}) {
    const model = await resolveGeminiModel(key);
    // Discovered names already include the "models/" prefix.
    const path = model.indexOf("models/") === 0 ? model : `models/${model}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    };
    if (grounded) body.tools = [{ google_search: {} }];

    const res = await fetch(`${GEMINI_BASE}/${path}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const rawText = await res.text();
    let data = null;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      data = null;
    }
    if (!res.ok) {
      // A cached model name can go stale; clear it so the next attempt
      // rediscovers rather than failing the same way forever.
      if (res.status === 404) saveTripSettings({ geminiModel: "" });
      const err = new Error(describeGeminiError(res.status, data, rawText));
      err.status = res.status;
      throw err;
    }
    if (!data) throw new Error("Gemini returned a response that wasn't JSON.");
    const cand = data.candidates && data.candidates[0];
    if (!cand) throw new Error("gemini returned no candidates");

    const text = (cand.content && cand.content.parts ? cand.content.parts : [])
      .map((p) => p.text || "")
      .join("");

    // Grounding metadata carries the pages the answer was based on, so the
    // user can check anything that matters rather than taking it on trust.
    const sources = [];
    const gm = cand.groundingMetadata;
    if (gm && Array.isArray(gm.groundingChunks)) {
      gm.groundingChunks.forEach((chunk) => {
        if (chunk.web && chunk.web.uri) {
          sources.push({ title: chunk.web.title || chunk.web.uri, uri: chunk.web.uri });
        }
      });
    }
    return { text, sources };
  }

  // Models wrap JSON in prose or code fences often enough that this is worth
  // doing properly rather than hoping for a clean parse.
  function extractJson(text) {
    if (!text) return null;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = fenced ? fenced[1] : text;
    const start = raw.search(/[[{]/);
    if (start < 0) return null;
    const lastArr = raw.lastIndexOf("]");
    const lastObj = raw.lastIndexOf("}");
    const end = Math.max(lastArr, lastObj);
    if (end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch (e) {
      return null;
    }
  }

  // Turns a vague ask ("quiet cafe near the castle for a tired toddler") into
  // named candidate places. Only names come from the model - coordinates and
  // address are then resolved against OSM, so nothing positional is invented.
  async function searchWithGemini(query, key) {
    const s = loadTripSettings();
    const where = s.destination.trim() ? ` in ${s.destination.trim()}` : "";
    const who = s.travellers.trim() ? `\nTravellers: ${s.travellers.trim()}` : "";

    const prompt =
      `Find up to 5 real, currently-open places matching this request${where}.` +
      `${who}\n\nRequest: ${query}\n\n` +
      `Use search to check they exist and are still trading. Reply with ONLY a JSON array, ` +
      `each item: {"name": exact official name, "area": neighbourhood or street, ` +
      `"why": one short sentence on why it fits}. No other text.`;

    const { text, sources } = await callGemini(key, prompt, { grounded: true });
    const parsed = extractJson(text);
    if (!Array.isArray(parsed) || !parsed.length) throw new Error("gemini returned no usable places");

    // Resolve each suggestion against OSM so the map pin and address are real
    // rather than model-generated.
    const resolved = await Promise.all(
      parsed.slice(0, 5).map(async (item) => {
        if (!item || !item.name) return null;
        let geo = null;
        try {
          geo = await geocodePlace(item.name, item.area || null);
        } catch (e) {
          geo = null;
        }
        return {
          name: item.name,
          displayName: geo && geo.address ? geo.address : item.area || "",
          lat: geo ? geo.lat : null,
          lon: geo ? geo.lon : null,
          type: geo ? geo.category : null,
          category: geo ? geo.category : null,
          website: geo ? geo.website : null,
          phone: geo ? geo.phone : null,
          openingHours: geo ? geo.openingHours : null,
          address: geo ? geo.address : null,
          description: item.why || "",
          aiSuggested: true,
          sources,
        };
      })
    );
    return resolved.filter(Boolean);
  }

  // ---------- Picks (bookmarks + custom places) ----------

  const PICKS_KEY = "scotland-trip-picks-v1";

  function loadPicks() {
    try {
      return JSON.parse(localStorage.getItem(PICKS_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function savePicks(picks) {
    localStorage.setItem(PICKS_KEY, JSON.stringify(picks));
  }

  // Folders are user-owned organisation, separate from geography - a pick's
  // folder should never be baked into its Google Maps search query, since a
  // rough nearest-city guess (or a folder the user deliberately renamed)
  // being injected into the search text can make Maps return the wrong place.
  const FOLDERS_KEY = "scotland-trip-folders-v1";

  function loadFolders() {
    try {
      const f = JSON.parse(localStorage.getItem(FOLDERS_KEY));
      return Array.isArray(f) && f.length ? f : ["Edinburgh", "Stirling", "Glasgow"];
    } catch (e) {
      return ["Edinburgh", "Stirling", "Glasgow"];
    }
  }

  function saveFolders(folders) {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
  }

  function addFolder(name) {
    const trimmed = (name || "").trim();
    if (!trimmed) return null;
    const folders = loadFolders();
    if (!folders.includes(trimmed)) {
      folders.push(trimmed);
      saveFolders(folders);
    }
    return trimmed;
  }

  function pickId(source, name) {
    return `${source}:${name}`;
  }

  function isPicked(source, name) {
    return loadPicks().some((p) => p.id === pickId(source, name));
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // How far a place can be from a known city anchor and still be filed under
  // it. Without a limit the "nearest" city is returned no matter how absurd -
  // somewhere in Manchester would be filed under Glasgow simply because it is
  // the least-distant of the three Scottish anchors.
  const CITY_MATCH_KM = 40;

  function nearestCity(lat, lon) {
    if (lat == null || lon == null) return null;
    let best = null;
    let bestDist = Infinity;
    Object.keys(CITY_COORDS).forEach((city) => {
      const c = CITY_COORDS[city];
      const d = haversineKm(lat, lon, c.lat, c.lon);
      if (d < bestDist) {
        bestDist = d;
        best = city;
      }
    });
    // Too far from anywhere we know about - let the caller ask instead of
    // silently filing it somewhere wrong.
    return bestDist <= CITY_MATCH_KM ? best : null;
  }

  function togglePick(source, item) {
    const id = pickId(source, item.name);
    let picks = loadPicks();
    const existing = picks.find((p) => p.id === id);
    if (existing) {
      picks = picks.filter((p) => p.id !== id);
      savePicks(picks);
      return;
    }
    const pick = {
      id,
      source,
      name: item.name,
      city: item.city || null,
      category: item.category || item.meal || "Custom",
      notes: item.notes || "",
      description: "",
      website: item.website || "",
      mapsQuery: item.mapsQuery || item.name,
      lat: null,
      lon: null,
      enrichStatus: item.website ? "done" : "idle",
      addedAt: Date.now(),
    };
    picks.push(pick);
    savePicks(picks);
    if (pick.enrichStatus === "idle") {
      enrichPick(pick.id); // full enrich: geocode + Wikipedia (custom/no-website items)
    } else {
      ensureGeocoded(pick.id); // already has a website/notes - just fetch coordinates for the map
    }
  }

  // Bookmarked catalog items (Places/Eats) already have good website/notes,
  // so enrichPick() is skipped for them - but the map and "explore nearby"
  // still need coordinates, so fetch those quietly without touching the
  // existing description/website.
  async function ensureGeocoded(id) {
    let picks = loadPicks();
    const pick = picks.find((p) => p.id === id);
    if (!pick || pick.lat != null) return;
    try {
      const geo = await geocodePlace(pick.name, pick.city);
      picks = loadPicks();
      const fresh = picks.find((p) => p.id === id);
      if (!fresh || fresh.lat != null || !geo) return;
      fresh.lat = geo.lat;
      fresh.lon = geo.lon;
      if (!fresh.city) fresh.city = nearestCity(geo.lat, geo.lon);
      savePicks(picks);
      if (view.dataset.activeTab === "picks") renderPicks();
    } catch (e) {
      // best-effort - the pick just won't get a mini-map/nearby search
    }
  }

  function removePick(id) {
    savePicks(loadPicks().filter((p) => p.id !== id));
  }

  // Small per-pick edits: a personal note ("buggy access round the back") and
  // whether it's actually booked - which matters when the trip lands in
  // festival season and half the plan needs reserving in advance.
  function updatePick(id, patch) {
    const picks = loadPicks();
    const p = picks.find((x) => x.id === id);
    if (!p) return;
    Object.assign(p, patch);
    savePicks(picks);
  }

  // Manually overrides the auto-assigned (nearest-city) grouping - e.g. to
  // pull something out of Edinburgh into a general "Other" bucket instead.
  function setPickCity(id, city) {
    const picks = loadPicks();
    const p = picks.find((x) => x.id === id);
    if (!p) return;
    p.city = city;
    savePicks(picks);
  }

  function wirePickToggles(rerender) {
    view.querySelectorAll("[data-toggle-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const source = btn.getAttribute("data-toggle-pick");
        const name = btn.getAttribute("data-name");
        const item = source === "places" ? PLACES.find((p) => p.name === name) : EATS.find((e) => e.name === name);
        if (!item) return;
        togglePick(source, item);
        rerender();
      });
    });
  }

  // Free, no-API-key enrichment: Nominatim (OpenStreetMap) for coordinates
  // and a fallback website, Wikidata + Wikipedia for a real description and
  // confirmed official website. Best-effort - failures just leave the pick
  // as-is rather than blocking anything.
  // Looks a place up on OpenStreetMap and returns everything useful it holds:
  // position, address, and whatever contact/opening details the mappers have
  // added. Tries the most specific query first and widens on a miss, because
  // a shared place isn't necessarily in Scotland (sharing "Manchester" is
  // perfectly reasonable) - the old query pinned every lookup to Scotland and
  // simply failed for anywhere else.
  async function geocodePlace(name, cityHint) {
    const queries = [];
    if (cityHint) queries.push(`${name}, ${cityHint}`);
    queries.push(scopedQuery(name));
    queries.push(name);

    for (const q of queries) {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&extratags=1&namedetails=1&q=${encodeURIComponent(
        q
      )}`;
      let data;
      try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) continue;
        data = await res.json();
      } catch (e) {
        continue;
      }
      if (data && data.length) return placeFromNominatim(data[0]);
    }
    return null;
  }

  // Pulls the fields worth showing out of a Nominatim result. extratags is
  // where OSM keeps contact details; it's only populated when the request
  // asked for extratags=1.
  function placeFromNominatim(r) {
    const tags = r.extratags || {};
    const addr = r.address || {};
    const addressLine = [
      [addr.house_number, addr.road].filter(Boolean).join(" "),
      addr.neighbourhood || addr.suburb,
      addr.city || addr.town || addr.village,
      addr.postcode,
    ]
      .filter(Boolean)
      .join(", ");

    return {
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      website: tags.website || tags["contact:website"] || tags.url || null,
      phone: tags.phone || tags["contact:phone"] || null,
      openingHours: tags.opening_hours || null,
      address: addressLine || r.display_name || null,
      category: prettyCategory(r.type || r.category),
      wikipedia: tags.wikipedia || null,
    };
  }

  function prettyCategory(value) {
    if (!value) return null;
    const cleaned = String(value).replace(/_/g, " ").trim();
    if (!cleaned) return null;
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  async function wikiEnrich(name) {
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
      name
    )}&language=en&format=json&origin=*`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) throw new Error("wikidata search error");
    const searchData = await searchRes.json();
    const hit = searchData.search && searchData.search[0];
    if (!hit) return null;

    let website = null;
    try {
      const entUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${hit.id}&props=claims&format=json&origin=*`;
      const entRes = await fetch(entUrl);
      const entData = await entRes.json();
      const claims = entData.entities[hit.id].claims;
      const p856 = claims && claims.P856;
      if (p856 && p856[0] && p856[0].mainsnak && p856[0].mainsnak.datavalue) {
        website = p856[0].mainsnak.datavalue.value;
      }
    } catch (e) {
      // no official-website claim available - not fatal
    }

    let description = hit.description || null;
    try {
      const title = (hit.label || name).replace(/ /g, "_");
      const sumRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      if (sumRes.ok) {
        const sum = await sumRes.json();
        if (sum.extract) description = sum.extract;
      }
    } catch (e) {
      // no Wikipedia page - Wikidata's short description is still fine
    }

    return { description, website };
  }

  async function enrichPick(id) {
    let picks = loadPicks();
    const pick = picks.find((p) => p.id === id);
    if (!pick) return;
    pick.enrichStatus = "loading";
    savePicks(picks);
    if (view.dataset.activeTab === "picks") renderPicks();

    const [geo, wiki] = await Promise.all([
      geocodePlace(pick.name, pick.city).catch(() => null),
      wikiEnrich(pick.name).catch(() => null),
    ]);

    picks = loadPicks();
    const fresh = picks.find((p) => p.id === id);
    if (!fresh) return; // removed while enriching
    if (geo) {
      fresh.lat = geo.lat;
      fresh.lon = geo.lon;
      if (!fresh.website && geo.website) fresh.website = geo.website;
      if (!fresh.city) fresh.city = nearestCity(geo.lat, geo.lon);
      if (!fresh.address && geo.address) fresh.address = geo.address;
      if (!fresh.phone && geo.phone) fresh.phone = geo.phone;
      if (!fresh.openingHours && geo.openingHours) fresh.openingHours = geo.openingHours;
      if ((!fresh.category || fresh.category === "Custom") && geo.category) fresh.category = geo.category;
    }
    if (wiki) {
      if (wiki.description) fresh.description = wiki.description;
      if (!fresh.website && wiki.website) fresh.website = wiki.website;
    }
    fresh.enrichStatus = geo || wiki ? "done" : "empty";
    savePicks(picks);
    if (view.dataset.activeTab === "picks") renderPicks();
  }

  // ---------- Place detail modal ----------

  const placeModal = document.getElementById("placeModal");

  function openPlaceModal(name) {
    const p = findPlace(name);
    if (!p) return;
    const mapsUrl = mapsUrlFor(p.mapsQuery);
    const subtitle = [p.category || p.meal, p.area].filter(Boolean).join(" · ");

    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="${esc(p.name)}">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">✕</button>
          <div class="modal-body">
            <span class="pill" style="background:${cityColor(p.city)}">${esc(p.city)}</span>
            <h2 class="modal-title">${esc(p.name)}</h2>
            ${subtitle ? `<div class="modal-subtitle">${esc(subtitle)}</div>` : ""}
            <div class="modal-price">${esc(p.price)}</div>
            ${
              p.nearAttraction
                ? `<div class="place-distance">📍 ${esc(p.distance)} — near ${esc(p.nearAttraction)}</div>`
                : ""
            }
            <p class="modal-notes">${esc(p.notes)}</p>
            <div class="modal-actions">
              ${
                p.website
                  ? `<a class="modal-btn" href="${esc(p.website)}" target="_blank" rel="noopener">🌐 Official website</a>`
                  : ""
              }
              ${
                mapsUrl
                  ? `<a class="modal-btn modal-btn-primary" href="${mapsUrl}" target="_blank" rel="noopener">📍 Open in Google Maps</a>`
                  : ""
              }
            </div>
          </div>
        </div>
      </div>
    `;
    placeModal.classList.add("open");
    placeModal.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target === el) closePlaceModal();
      });
    });
  }

  function closePlaceModal() {
    placeModal.classList.remove("open");
  }

  // ---------- Backup ----------
  // Everything lives in this device's localStorage, which an uninstall, a
  // "clear data", or a lost phone erases with no recovery. This writes the
  // whole trip out as one file that can be saved, sent to someone else, or
  // restored later.
  // A function, not a constant: PLAN_KEY is declared further down the file,
  // so reading it while this module is still evaluating would hit the
  // temporal dead zone and throw before the app ever renders.
  function backupKeys() {
    return [PICKS_KEY, FOLDERS_KEY, PLAN_KEY, TRIP_KEY, STORAGE_KEY];
  }

  function buildBackup() {
    const data = {};
    backupKeys().forEach((k) => {
      const v = localStorage.getItem(k);
      if (v !== null) data[k] = v;
    });
    return JSON.stringify(
      { format: "scotland-trip-backup", version: 1, exportedAt: new Date().toISOString(), data },
      null,
      2
    );
  }

  function backupFilename() {
    const date = new Date().toISOString().slice(0, 10);
    const slug = (loadTripSettings().title || "trip").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `${slug || "trip"}-backup-${date}.json`;
  }

  async function exportBackup() {
    const json = buildBackup();
    // A Blob download is the reliable route in a WebView; the share sheet is
    // offered too since sending it to yourself is the easiest way to get a
    // copy off the device.
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = backupFilename();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return { ok: true, message: `Saved ${backupFilename()} to your downloads.` };
    } catch (e) {
      return { ok: false, message: `Couldn't save the file: ${e.message || e}` };
    }
  }

  function countBackup(parsed) {
    try {
      const picks = JSON.parse(parsed.data[PICKS_KEY] || "[]");
      const folders = JSON.parse(parsed.data[FOLDERS_KEY] || "[]");
      const plan = JSON.parse(parsed.data[PLAN_KEY] || "{}");
      const planned = Object.values(plan.items || {}).reduce((n, list) => n + list.length, 0);
      return `${picks.length} places, ${folders.length} folders, ${planned} planned items`;
    } catch (e) {
      return "contents unreadable";
    }
  }

  function importBackup(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { ok: false, message: "That file isn't valid JSON." };
    }
    if (!parsed || parsed.format !== "scotland-trip-backup" || !parsed.data) {
      return { ok: false, message: "That doesn't look like a trip backup file." };
    }
    // Replaces rather than merges - merging two sets of picks silently
    // duplicates them, and a restore is almost always "put it back how it was".
    backupKeys().forEach((k) => {
      if (parsed.data[k] !== undefined) localStorage.setItem(k, parsed.data[k]);
    });
    return { ok: true, message: `Restored ${countBackup(parsed)}.` };
  }

  function openSettings() {
    const s = loadTripSettings();
    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="Settings">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">✕</button>
          <div class="modal-body">
            <h2 class="modal-title">Settings</h2>

            <label class="settings-label" for="setDestination">Search region</label>
            <input class="settings-input" type="text" id="setDestination" value="${esc(s.destination)}"
                   placeholder="e.g. Scotland — blank to search worldwide" />
            <p class="settings-hint">Added to searches so "museum" finds one near your trip. Leave blank to search anywhere.</p>

            <label class="settings-label" for="setGoogleKey">Google Places API key</label>
            <input class="settings-input" type="text" id="setGoogleKey" value="${esc(s.googleKey)}"
                   placeholder="Paste a key to search with Google" autocomplete="off" />
            <p class="settings-hint">
              Optional. Without it search uses OpenStreetMap, which misses many smaller
              businesses. With it, search uses Google and results carry ratings.
              Stored only on this device.
            </p>

            <label class="settings-label" for="setGeminiKey">Gemini API key</label>
            <input class="settings-input" type="text" id="setGeminiKey" value="${esc(s.geminiKey)}"
                   placeholder="Paste key for AI search & day planning" autocomplete="off" />
            <p class="settings-hint">
              Optional, free tier, no billing card needed. Enables "Plan my days" and
              lets you search by description ("quiet cafe near the castle") when
              OpenStreetMap finds nothing. Suggested opening hours always need
              checking — verify before relying on them.
            </p>

            <button class="modal-btn" id="testGeminiBtn" style="margin-top:10px;">Test key & find models</button>
            <pre class="settings-result" id="geminiTestResult" hidden></pre>

            <div id="geminiModelWrap" ${s.geminiModels.length ? "" : "hidden"}>
              <label class="settings-label" for="setGeminiModel">Model</label>
              <select class="settings-input" id="setGeminiModel">
                ${s.geminiModels
                  .map(
                    (m) =>
                      `<option value="${esc(m)}"${m === s.geminiModel ? " selected" : ""}>${esc(
                        m.replace(/^models\//, "")
                      )}</option>`
                  )
                  .join("")}
              </select>
              <p class="settings-hint">
                Lite and flash tiers cost a fraction of pro and are plenty for naming
                places and ordering a day. Tap the button above to refresh the list.
              </p>
            </div>

            <label class="settings-label" for="setTravellers">Who's travelling</label>
            <input class="settings-input" type="text" id="setTravellers" value="${esc(s.travellers)}"
                   placeholder="e.g. family of 3, 4-year-old who walks" />
            <p class="settings-hint">Used to tailor AI suggestions and day planning.</p>

            <div class="settings-divider"></div>
            <label class="settings-label">Backup</label>
            <p class="settings-hint">
              Everything is stored only on this phone. Export a copy you can keep or send
              to another device — a reinstall or a lost phone loses the lot otherwise.
            </p>
            <div class="settings-btn-row">
              <button class="modal-btn" id="exportBackupBtn">⬇ Export</button>
              <button class="modal-btn" id="importBackupBtn">⬆ Import</button>
            </div>
            <input type="file" id="importBackupFile" accept="application/json,.json" hidden />
            <pre class="settings-result" id="backupResult" hidden></pre>

            <button class="modal-btn modal-btn-primary" id="saveSettings">Save</button>
          </div>
        </div>
      </div>
    `;
    placeModal.classList.add("open");
    placeModal.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target === el) closePlaceModal();
      });
    });
    const backupOut = document.getElementById("backupResult");
    const showBackupResult = (result) => {
      backupOut.hidden = false;
      backupOut.className = "settings-result " + (result.ok ? "ok" : "bad");
      backupOut.textContent = result.message;
    };

    document.getElementById("exportBackupBtn").addEventListener("click", async () => {
      showBackupResult(await exportBackup());
    });

    const fileInput = document.getElementById("importBackupFile");
    document.getElementById("importBackupBtn").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = importBackup(String(reader.result));
        showBackupResult(result);
        if (result.ok) {
          // Re-render from the restored data rather than leaving the old
          // state on screen.
          topbarTitle.textContent = loadTripSettings().title;
          showView(view.dataset.activeTab || "overview");
        }
      };
      reader.onerror = () => showBackupResult({ ok: false, message: "Couldn't read that file." });
      reader.readAsText(file);
    });

    const testBtn = document.getElementById("testGeminiBtn");
    const testOut = document.getElementById("geminiTestResult");
    testBtn.addEventListener("click", async () => {
      const key = document.getElementById("setGeminiKey").value.trim();
      // Saved first so the test uses the key actually being tried, and a
      // rediscovered model is kept even if the user closes the sheet.
      saveTripSettings({ geminiKey: key, geminiModel: "" });
      testOut.hidden = false;
      testOut.className = "settings-result";
      testOut.textContent = "Testing…";
      testBtn.disabled = true;
      const result = await testGeminiKey(key);
      testBtn.disabled = false;
      testOut.className = "settings-result " + (result.ok ? "ok" : "bad");
      testOut.textContent = result.message;

      // Fill the picker with whatever this key can actually reach, so the
      // choice is always real rather than a guess at what exists.
      if (result.ok && result.models && result.models.length) {
        const wrap = document.getElementById("geminiModelWrap");
        const sel = document.getElementById("setGeminiModel");
        const current = loadTripSettings().geminiModel;
        sel.innerHTML = result.models
          .map(
            (m) =>
              `<option value="${esc(m)}"${m === current ? " selected" : ""}>${esc(
                m.replace(/^models\//, "")
              )}</option>`
          )
          .join("");
        wrap.hidden = false;
      }
    });

    // Changing the model takes effect immediately - waiting for Save would
    // mean the next search silently used the old one.
    const modelSel = document.getElementById("setGeminiModel");
    if (modelSel) {
      modelSel.addEventListener("change", () => {
        saveTripSettings({ geminiModel: modelSel.value });
        toast(`Using ${modelSel.value.replace(/^models\//, "")}`);
      });
    }

    document.getElementById("saveSettings").addEventListener("click", () => {
      saveTripSettings({
        destination: document.getElementById("setDestination").value,
        googleKey: document.getElementById("setGoogleKey").value.trim(),
        geminiKey: document.getElementById("setGeminiKey").value.trim(),
        geminiModel: (document.getElementById("setGeminiModel") || {}).value || loadTripSettings().geminiModel,
        travellers: document.getElementById("setTravellers").value,
      });
      closePlaceModal();
      showView(view.dataset.activeTab || "overview");
    });
  }

  // Asks which folder a new pick should go in - existing folders as chips,
  // or type a new one to create it on the spot. onConfirm(folder) fires once
  // the user picks or creates one; the sheet closes either way.
  // Saves straight away instead of asking which folder first.
  //
  // Every add path used to open a modal asking for a folder before the place
  // was even saved - on a question that is trivially changed afterwards with
  // the chips on the pick card. Asking up front turned the app's most common
  // action into a two-step interruption. Now it files itself and says so,
  // with the folder one tap away if the guess was wrong.
  function quickAdd(candidate, opts) {
    const options = opts || {};
    const suggested =
      options.folder ||
      (candidate.lat != null ? nearestCity(candidate.lat, candidate.lon) : null) ||
      loadFolders()[0] ||
      "Unsorted";
    confirmAddCandidate(candidate, suggested);
    toastWithAction(`Added “${candidate.name}” to ${suggested}`, "Change", () => {
      openFolderPicker(candidate.name, suggested, (folder) => {
        const id = pickId("custom", candidate.name);
        setPickCity(id, folder);
        renderPicks();
        toast(`Moved to ${folder}`);
      });
    });
  }

  // A toast with one tappable action, which is how a reversible choice should
  // be offered: act first, correct after, rather than prompt before.
  let toastActionTimer = null;
  function toastWithAction(message, actionLabel, onAction) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.innerHTML = `<span>${esc(message)}</span><button class="toast-action" type="button">${esc(actionLabel)}</button>`;
    el.classList.add("show", "with-action");
    clearTimeout(toastActionTimer);
    const hide = () => {
      el.classList.remove("show", "with-action");
      el.innerHTML = "";
    };
    el.querySelector(".toast-action").addEventListener("click", () => {
      clearTimeout(toastActionTimer);
      hide();
      onAction();
    });
    toastActionTimer = setTimeout(hide, 5000);
  }

  function openFolderPicker(candidateName, suggestedFolder, onConfirm, options) {
    const folders = loadFolders();
    const summary = (options && options.summary) || null;

    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="Choose a folder">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">✕</button>
          <div class="modal-body">
            <h2 class="modal-title">Add "${esc(candidateName)}" to…</h2>
            ${
              summary
                ? `<div class="share-summary">${summary.map((row) => `<div class="share-summary-row">${esc(row)}</div>`).join("")}</div>`
                : ""
            }
            <div class="filter-row" id="folderChips">
              ${folders
                .map(
                  (f) =>
                    `<button class="filter-chip${f === suggestedFolder ? " active" : ""}" data-pick-folder="${esc(f)}">${esc(f)}</button>`
                )
                .join("")}
            </div>
            <form class="search-bar" id="newFolderForm" style="margin-top:4px;">
              <input type="text" id="newFolderInput" placeholder="Or create a new folder…" autocomplete="off" />
              <button type="submit" aria-label="Create folder">+</button>
            </form>
          </div>
        </div>
      </div>
    `;
    placeModal.classList.add("open");

    const finalize = (folder) => {
      closePlaceModal();
      onConfirm(folder);
    };

    placeModal.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target === el) closePlaceModal();
      });
    });
    placeModal.querySelectorAll("[data-pick-folder]").forEach((btn) => {
      btn.addEventListener("click", () => finalize(btn.getAttribute("data-pick-folder")));
    });
    document.getElementById("newFolderForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = document.getElementById("newFolderInput").value.trim();
      if (!name) return;
      finalize(addFolder(name));
    });
  }

  // ---------- Sharing ----------

  function formatDayShareText(day) {
    const lines = [];
    lines.push(`🏴 Scotland with Ally — ${day.day}, ${day.date}`);
    lines.push(`${day.city} — ${day.title}`);
    lines.push("");
    lines.push(day.summary);
    lines.push("");
    day.items.forEach((it) => {
      lines.push(`${it.time} — ${it.name}`);
      lines.push(it.detail);
      const p = it.place ? findPlace(it.place) : null;
      if (p && p.website) lines.push(`🌐 ${p.website}`);
      if (p && p.mapsQuery) lines.push(`📍 ${mapsUrlFor(p.mapsQuery)}`);
      lines.push("");
    });
    return lines.join("\n").trim();
  }

  function formatFullItineraryShareText() {
    const lines = [`🏴 ${TRIP.title}`, TRIP.subtitle, TRIP.dates, ""];
    DAYS.forEach((d) => {
      lines.push(`— ${d.day}, ${d.date} (${d.city}) —`);
      lines.push(d.title);
      d.items.forEach((it) => lines.push(`  ${it.time} ${it.name}`));
      lines.push("");
    });
    return lines.join("\n").trim();
  }

  async function shareText(title, text) {
    const plugins = window.Capacitor && window.Capacitor.Plugins;
    if (plugins && plugins.Share) {
      try {
        await plugins.Share.share({ title, text, dialogTitle: title });
        return;
      } catch (e) {
        if (e && e.message === "Share canceled") return;
        // fall through to web fallbacks below
      }
    }
    if (navigator.share) {
      try {
        await navigator.share({ title, text });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        toast("Copied to clipboard — paste it into WhatsApp");
        return;
      } catch (e) {
        // fall through
      }
    }
    window.prompt("Copy this to share:", text);
  }

  let toastTimer = null;
  function toast(message) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  }

  // ---------- Views ----------

  function renderOverview() {
    const totalLow = BUDGET.reduce((a, b) => a + b.low, 0);
    const totalHigh = BUDGET.reduce((a, b) => a + b.high, 0);
    const cities = ["Edinburgh", "Stirling", "Glasgow"];

    let html = `
      <div class="hero">
        <h1>${esc(TRIP.title)}</h1>
        <p>${esc(TRIP.subtitle)}</p>
        <div class="hero-stats">
          <div class="hero-stat"><b>${TRIP.nights}</b><span>nights</span></div>
          <div class="hero-stat"><b>${DAYS.length}</b><span>days planned</span></div>
          <div class="hero-stat"><b>3</b><span>cities</span></div>
        </div>
        <button class="hero-share" id="shareTrip">↗ Share whole itinerary</button>
      </div>

      <div class="section-label">Trip at a glance</div>
      <div class="card">
        <p>${esc(TRIP.traveler)}. Peak Fringe/festival week in Edinburgh (7–31 Aug), so this plan
        mixes gentle festival mornings with day trips to Stirling and Glasgow — especially over
        the 22–23 Aug weekend, when Edinburgh's Old Town is at its most crowded.</p>
      </div>

      <div class="section-label">Cities</div>
    `;

    cities.forEach((c) => {
      const count = DAYS.filter((d) => d.city === c).length;
      html += `
        <div class="card" style="display:flex;align-items:center;justify-content:space-between;">
          <div>
            <span class="pill" style="background:${cityColor(c)}">${esc(c)}</span>
          </div>
          <div style="font-size:13px;color:var(--ink-soft);">${count} day${count === 1 ? "" : "s"}</div>
        </div>
      `;
    });

    html += `
      <div class="section-label">Estimated budget</div>
      <div class="card">
        <p style="margin-bottom:4px;">Activities, tickets &amp; transport for the week (excl. accommodation)</p>
        <div class="budget-total" style="border-top:none;padding-top:8px;">
          <b>Total estimate</b>
          <span class="budget-range">£${totalLow}–£${totalHigh}</span>
        </div>
      </div>
    `;

    view.innerHTML = html;

    const shareBtn = document.getElementById("shareTrip");
    if (shareBtn) {
      shareBtn.addEventListener("click", () => {
        shareText(TRIP.title, formatFullItineraryShareText());
      });
    }
  }

  // ---------- Personal itinerary planner ----------
  // The bundled DAYS are a suggested plan and stay read-only; this is the
  // user's own schedule, built from whatever they've saved in Picks. Days are
  // seeded from the bundled trip but are editable, so a different trip
  // entirely is a matter of renaming/adding days.
  const PLAN_KEY = "trip-plan-v1";

  let planMode = "suggested"; // "suggested" | "mine"

  function loadPlan() {
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(PLAN_KEY));
    } catch (e) {
      stored = null;
    }
    if (stored && Array.isArray(stored.days)) return stored;
    return {
      days: DAYS.map((d, i) => ({ id: `d${i}`, label: `${d.day} · ${d.date}` })),
      items: {},
    };
  }

  function savePlan(plan) {
    localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
  }

  // "Day 3 · Fri 21 Aug" -> "Fri 21". Full labels don't fit on a chip.
  function shortDayLabel(label) {
    const m = String(label || "").match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b\s*(\d{1,2})?/i);
    if (m) return m[2] ? `${m[1]} ${m[2]}` : m[1];
    return String(label || "").replace(/^Day\s*\d+\s*·\s*/i, "").slice(0, 10);
  }

  function planItems(plan, dayId) {
    return plan.items[dayId] || [];
  }

  function addToPlan(dayId, pickId) {
    const plan = loadPlan();
    const list = planItems(plan, dayId).slice();
    if (list.some((it) => it.pickId === pickId)) return;
    list.push({ pickId, time: "" });
    plan.items[dayId] = list;
    savePlan(plan);
  }

  function removeFromPlan(dayId, pickId) {
    const plan = loadPlan();
    plan.items[dayId] = planItems(plan, dayId).filter((it) => it.pickId !== pickId);
    savePlan(plan);
  }

  function movePlanItem(dayId, pickId, delta) {
    const plan = loadPlan();
    const list = planItems(plan, dayId).slice();
    const i = list.findIndex((it) => it.pickId === pickId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    plan.items[dayId] = list;
    savePlan(plan);
  }

  function setPlanItemTime(dayId, pickId, time) {
    const plan = loadPlan();
    const list = planItems(plan, dayId).slice();
    const item = list.find((it) => it.pickId === pickId);
    if (!item) return;
    item.time = time;
    plan.items[dayId] = list;
    savePlan(plan);
  }

  function addPlanDay(label) {
    const trimmed = (label || "").trim();
    if (!trimmed) return;
    const plan = loadPlan();
    plan.days.push({ id: `d${Date.now()}`, label: trimmed });
    savePlan(plan);
  }

  function removePlanDay(dayId) {
    const plan = loadPlan();
    plan.days = plan.days.filter((d) => d.id !== dayId);
    delete plan.items[dayId];
    savePlan(plan);
  }

  // Asks Gemini to spread the saved picks across the trip's days. Only ever
  // arranges places the user already chose - it doesn't invent new ones - so
  // the worst case is an ordering the user then edits, not a fabricated place.
  async function autoPlanDays() {
    const s = loadTripSettings();
    const key = s.geminiKey.trim();
    if (!key) {
      openSettings();
      return;
    }

    const plan = loadPlan();
    const picks = loadPicks();
    if (!picks.length || !plan.days.length) return;

    planBusy = true;
    renderItinerary();

    try {
      const placeList = picks
        .map((p) => `- ${p.name}${p.address ? ` (${p.address})` : ""}${p.category ? ` [${p.category}]` : ""}`)
        .join("\n");
      const dayList = plan.days.map((d, i) => `${i + 1}. ${d.label}`).join("\n");
      const who = s.travellers.trim() ? `\nTravellers: ${s.travellers.trim()}` : "";

      const prompt =
        `Arrange these saved places into a day-by-day itinerary.${who}\n\n` +
        `Days:\n${dayList}\n\nPlaces:\n${placeList}\n\n` +
        `Rules: use ONLY the places listed; group places that are close together on the ` +
        `same day to reduce travelling; put demanding activities earlier in the day; ` +
        `leave a day lighter rather than cramming it; not every place has to be used.\n\n` +
        `Reply with ONLY a JSON array, one entry per scheduled place: ` +
        `{"day": day number from the list, "name": exact place name, "time": short label like "10:00" or "AM"}. ` +
        `No other text.`;

      const { text } = await callGemini(key, prompt);
      const parsed = extractJson(text);
      if (!Array.isArray(parsed)) throw new Error("gemini returned no usable plan");

      // Match names back to real picks; anything unrecognised is dropped
      // rather than trusted, so a hallucinated name can't enter the plan.
      const byName = {};
      picks.forEach((p) => (byName[p.name.toLowerCase()] = p));

      const items = {};
      parsed.forEach((entry) => {
        if (!entry || !entry.name) return;
        const pick = byName[String(entry.name).toLowerCase().trim()];
        const dayIdx = Number(entry.day) - 1;
        const day = plan.days[dayIdx];
        if (!pick || !day) return;
        if (!items[day.id]) items[day.id] = [];
        if (items[day.id].some((it) => it.pickId === pick.id)) return;
        items[day.id].push({ pickId: pick.id, time: String(entry.time || "").slice(0, 8) });
      });

      plan.items = items;
      savePlan(plan);
      planNote = "Suggested plan — edit anything that doesn't suit.";
    } catch (e) {
      console.warn("auto-plan failed:", e);
      // Show what Google actually said - a generic "try again" gives the user
      // nothing to act on, and there is no console to read on a phone.
      planNote = `Couldn't build a plan.\n\n${e && e.message ? e.message : e}`;
    } finally {
      planBusy = false;
      renderItinerary();
    }
  }

  let planBusy = false;
  let planNote = "";

  // Reads the day-of-week out of a day label like "Day 3 · Fri 21 Aug".
  const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  function dayCodeFromLabel(label) {
    const m = String(label || "").match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i);
    if (!m) return null;
    const map = { sun: "Su", mon: "Mo", tue: "Tu", wed: "We", thu: "Th", fri: "Fr", sat: "Sa" };
    return map[m[1].slice(0, 3).toLowerCase()] || null;
  }

  // A deliberately conservative reading of OSM opening_hours: it only reports
  // a closure when the string clearly lists days and this day isn't among
  // them. Anything with holiday rules, seasonal ranges or syntax it doesn't
  // recognise is left alone, because a wrong "closed" warning is worse than
  // none - it would send you somewhere else for no reason.
  function closedOnDay(openingHours, dayCode) {
    if (!openingHours || !dayCode) return false;
    const hours = openingHours.trim();
    if (/24\/7/i.test(hours)) return false;
    // Unsupported syntax - don't guess.
    if (/PH|SH|easter|summer|winter|"/i.test(hours)) return false;

    if (new RegExp(`\\b${dayCode}\\b[^;]*\\boff\\b`, "i").test(hours)) return true;

    // Collect every day the string mentions, expanding ranges like "Mo-Fr".
    const mentioned = new Set();
    let sawDaySpec = false;
    hours.split(";").forEach((rule) => {
      if (/\boff\b/i.test(rule)) return;
      const dayPart = (rule.match(/^[\sA-Za-z,\-]+/) || [""])[0];
      const rangeRe = /(Mo|Tu|We|Th|Fr|Sa|Su)\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su)/gi;
      let m;
      while ((m = rangeRe.exec(dayPart))) {
        sawDaySpec = true;
        let i = DAY_NAMES.indexOf(m[1].slice(0, 2).replace(/^./, (c) => c.toUpperCase()));
        const end = DAY_NAMES.indexOf(m[2].slice(0, 2).replace(/^./, (c) => c.toUpperCase()));
        if (i < 0 || end < 0) continue;
        for (let guard = 0; guard < 8; guard++) {
          mentioned.add(DAY_NAMES[i]);
          if (i === end) break;
          i = (i + 1) % 7;
        }
      }
      const singleRe = /\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/gi;
      const withoutRanges = dayPart.replace(rangeRe, " ");
      while ((m = singleRe.exec(withoutRanges))) {
        sawDaySpec = true;
        mentioned.add(m[1].slice(0, 2).replace(/^./, (c) => c.toUpperCase()));
      }
    });

    if (!sawDaySpec) return false; // e.g. "09:00-17:00" - applies every day
    return !mentioned.has(dayCode);
  }

  // Rough walking time between two stops. Deliberately straight-line distance
  // with a detour factor rather than a routing API - it needs no key, works
  // offline, and the point is to flag "that's a long way with a small child",
  // not to give turn-by-turn timings.
  const WALK_KMH = 3.5; // slower than an adult's pace, this is with a 4-year-old
  const DETOUR_FACTOR = 1.3; // streets aren't straight lines

  function walkLeg(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    const km = haversineKm(a.lat, a.lon, b.lat, b.lon) * DETOUR_FACTOR;
    const mins = Math.round((km / WALK_KMH) * 60);
    return { km, mins };
  }

  function renderMyPlan() {
    const plan = loadPlan();
    const picks = loadPicks();
    const byId = {};
    picks.forEach((p) => (byId[p.id] = p));

    let html = "";

    if (!picks.length) {
      html += `<div class="card"><p class="pick-status">Nothing saved yet. Bookmark places in Places/Eats, search in Picks, or share a place into the app from Google Maps - then schedule them here.</p></div>`;
    } else {
      html += `
        <div class="card plan-ai-card">
          <button class="plan-ai-btn" id="autoPlanBtn" ${planBusy ? "disabled" : ""}>
            ${planBusy ? "Planning your days…" : "✨ Plan my days for me"}
          </button>
          ${planNote ? `<p class="pick-status">${esc(planNote)}</p>` : ""}
        </div>
      `;
    }

    plan.days.forEach((day) => {
      const items = planItems(plan, day.id);
      html += `
        <div class="card day-card">
          <div class="plan-day-head">
            <span class="day-title">${esc(day.label)}</span>
            <button class="plan-day-remove" data-remove-day="${esc(day.id)}" aria-label="Remove day">✕</button>
          </div>
          <div class="plan-items">
      `;
      if (!items.length) {
        html += `<p class="pick-status">Nothing planned for this day yet.</p>`;
      }
      const dayCode = dayCodeFromLabel(day.label);
      items.forEach((it, idx) => {
        const p = byId[it.pickId];
        if (!p) return; // pick was deleted - skip, tidied up on next save

        // Walking leg from the previous stop, so a day that looks tidy but
        // involves three miles of walking is visible before you're doing it.
        const prev = idx > 0 ? byId[items[idx - 1].pickId] : null;
        const leg = walkLeg(prev, p);
        if (leg && leg.mins >= 5) {
          html += `<div class="plan-leg${leg.mins >= 25 ? " far" : ""}">🚶 ${leg.mins} min · ${
            leg.km < 1 ? Math.round(leg.km * 1000) + " m" : leg.km.toFixed(1) + " km"
          } from previous stop</div>`;
        }

        const mayBeClosed = closedOnDay(p.openingHours, dayCode);
        html += `
          <div class="plan-item">
            <input class="plan-time" type="text" inputmode="text" placeholder="time"
                   value="${esc(it.time || "")}" data-plan-time="${esc(day.id)}|${esc(it.pickId)}" />
            <div class="plan-item-main">
              <div class="plan-item-name">${esc(p.name)}${
                p.booked ? ` <span class="booked-badge">booked</span>` : ""
              }</div>
              ${p.address ? `<div class="plan-item-sub">${esc(p.address)}</div>` : ""}
              ${
                mayBeClosed
                  ? `<div class="plan-warn">⚠ May be closed this day — hours say "${esc(p.openingHours)}". Check before going.</div>`
                  : ""
              }
              ${
                it.time
                  ? ""
                  : `<div class="quick-times">${["Morning", "Lunch", "Afternoon", "Evening"]
                      .map(
                        (t) =>
                          `<button class="quick-time" data-plan-quicktime="${esc(day.id)}|${esc(it.pickId)}|${esc(t)}">${t}</button>`
                      )
                      .join("")}</div>`
              }
            </div>
            <div class="plan-item-actions">
              <button data-plan-move="${esc(day.id)}|${esc(it.pickId)}|-1" ${idx === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
              <button data-plan-move="${esc(day.id)}|${esc(it.pickId)}|1" ${
                idx === items.length - 1 ? "disabled" : ""
              } aria-label="Move down">↓</button>
              <button data-plan-remove="${esc(day.id)}|${esc(it.pickId)}" aria-label="Remove">✕</button>
            </div>
          </div>
        `;
      });
      html += `</div>`;

      // Tappable chips rather than a <select>: on Android a select opens a
      // full-screen picker, so adding five places meant five trips through a
      // modal. A chip is one tap, and you can see everything available at once.
      const unplanned = picks.filter((p) => !items.some((it) => it.pickId === p.id));
      if (unplanned.length) {
        html += `
          <div class="plan-add-row">
            <div class="plan-add-label">Add:</div>
            <div class="plan-add-chips">
              ${unplanned
                .map(
                  (p) =>
                    `<button class="add-chip" data-plan-add="${esc(day.id)}|${esc(p.id)}">+ ${esc(p.name)}</button>`
                )
                .join("")}
            </div>
          </div>
        `;
      }
      html += `</div>`;
    });

    html += `
      <form class="search-bar" id="addDayForm" style="margin-top:4px;">
        <input type="text" id="addDayInput" placeholder="Add a day (e.g. Sat 22 Aug)…" autocomplete="off" />
        <button type="submit" aria-label="Add day">+</button>
      </form>
    `;
    return html;
  }

  function wireMyPlan() {
    const autoBtn = document.getElementById("autoPlanBtn");
    if (autoBtn) autoBtn.addEventListener("click", autoPlanDays);

    view.querySelectorAll("[data-plan-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [dayId, pickId] = btn.getAttribute("data-plan-add").split("|");
        addToPlan(dayId, pickId);
        renderItinerary();
      });
    });

    // Common times as one-tap chips, so the usual case needs no keyboard.
    view.querySelectorAll("[data-plan-quicktime]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [dayId, pickId, time] = btn.getAttribute("data-plan-quicktime").split("|");
        setPlanItemTime(dayId, pickId, time);
        renderItinerary();
      });
    });
    view.querySelectorAll("[data-plan-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [dayId, pickId] = btn.getAttribute("data-plan-remove").split("|");
        removeFromPlan(dayId, pickId);
        renderItinerary();
      });
    });
    view.querySelectorAll("[data-plan-move]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [dayId, pickId, delta] = btn.getAttribute("data-plan-move").split("|");
        movePlanItem(dayId, pickId, Number(delta));
        renderItinerary();
      });
    });
    view.querySelectorAll("[data-plan-time]").forEach((input) => {
      // Saved on blur rather than on every keystroke so a re-render can't
      // steal focus mid-typing.
      input.addEventListener("blur", () => {
        const [dayId, pickId] = input.getAttribute("data-plan-time").split("|");
        setPlanItemTime(dayId, pickId, input.value.trim());
      });
    });
    view.querySelectorAll("[data-remove-day]").forEach((btn) => {
      btn.addEventListener("click", () => {
        removePlanDay(btn.getAttribute("data-remove-day"));
        renderItinerary();
      });
    });
    const form = document.getElementById("addDayForm");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = document.getElementById("addDayInput");
        addPlanDay(input.value);
        input.value = "";
        renderItinerary();
      });
    }
  }

  function renderItinerary() {
    const toggle = `
      <div class="filter-row plan-toggle">
        <button class="filter-chip${planMode === "suggested" ? " active" : ""}" data-plan-mode="suggested">Suggested</button>
        <button class="filter-chip${planMode === "mine" ? " active" : ""}" data-plan-mode="mine">My plan</button>
      </div>
    `;

    if (planMode === "mine") {
      view.innerHTML = toggle + renderMyPlan();
      wirePlanToggle();
      wireMyPlan();
      return;
    }

    view.innerHTML = toggle + renderSuggestedItinerary();
    wirePlanToggle();
    wireSuggestedItinerary();
  }

  function wirePlanToggle() {
    view.querySelectorAll("[data-plan-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        planMode = btn.getAttribute("data-plan-mode");
        renderItinerary();
      });
    });
  }

  function renderSuggestedItinerary() {
    let html = "";
    DAYS.forEach((d, i) => {
      html += `
        <div class="card day-card" data-idx="${i}">
          <div class="day-head" data-toggle="${i}">
            <div class="day-head-left">
              <span class="pill" style="background:${cityColor(d.city)}">${esc(d.city)}</span>
              <span class="day-title">${esc(d.title)}</span>
              <span class="day-date">${esc(d.day)} · ${esc(d.date)}</span>
            </div>
            <span class="chevron">▶</span>
          </div>
          <div class="day-summary">${esc(d.summary)}</div>
          <div class="day-items">
            ${d.items
              .map(
                (it) => `
              <div class="item${it.place ? " item-linked" : ""}"${
                  it.place ? ` data-place="${esc(it.place)}"` : ""
                }>
                <div class="item-time">${esc(it.time)}</div>
                <div class="item-body">
                  <div class="item-name">${esc(it.name)}${it.place ? ' <span class="item-arrow">›</span>' : ""}</div>
                  <div class="item-detail">${esc(it.detail)}</div>
                  <span class="item-tag">${esc(it.tag)}</span>
                </div>
              </div>
            `
              )
              .join("")}
            <button class="day-share" data-share-day="${i}">↗ Share this day</button>
          </div>
        </div>
      `;
    });
    return html;
  }

  function wireSuggestedItinerary() {
    view.querySelectorAll("[data-toggle]").forEach((el) => {
      el.addEventListener("click", () => {
        el.closest(".day-card").classList.toggle("open");
      });
    });

    view.querySelectorAll("[data-place]").forEach((el) => {
      el.addEventListener("click", () => {
        openPlaceModal(el.getAttribute("data-place"));
      });
    });

    view.querySelectorAll("[data-share-day]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const d = DAYS[Number(el.getAttribute("data-share-day"))];
        shareText(`${d.day}: ${d.title}`, formatDayShareText(d));
      });
    });

    // open first day by default
    const first = view.querySelector(".day-card");
    if (first) first.classList.add("open");
  }

  let placeFilter = "All";

  function renderPlaces() {
    let html = `
      <form class="search-bar" id="placesSearchForm">
        <input type="search" id="placesSearchInput" placeholder="Search any other place or attraction…" autocomplete="off" />
        <button type="submit" aria-label="Search on Google Maps">🔍</button>
      </form>
      <p class="search-hint">Opens Google Maps — browse it there for nearby restaurants, reviews, and the official website.</p>
    `;

    const cities = ["All", "Edinburgh", "Stirling", "Glasgow"];
    html += `<div class="filter-row">`;
    cities.forEach((c) => {
      html += `<button class="filter-chip ${c === placeFilter ? "active" : ""}" data-city="${esc(c)}">${esc(c)}</button>`;
    });
    html += `</div>`;

    const list = PLACES.filter((p) => placeFilter === "All" || p.city === placeFilter);

    list.forEach((p) => {
      const mapsUrl = mapsUrlFor(p.mapsQuery);
      const picked = isPicked("places", p.name);
      html += `
        <div class="card place-card">
          <div style="flex:1;">
            <div class="place-name">${esc(p.name)}</div>
            <div class="place-meta">
              <span class="pill" style="background:${cityColor(p.city)}">${esc(p.city)}</span>${esc(p.category)}
            </div>
            <div class="place-notes">${esc(p.notes)}</div>
            <div class="place-links">
              ${p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noopener">🌐 Website</a>` : ""}
              ${mapsUrl ? `<a href="${mapsUrl}" target="_blank" rel="noopener">📍 Map</a>` : ""}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
            <button class="pick-toggle${picked ? " picked" : ""}" data-toggle-pick="places" data-name="${esc(p.name)}" aria-label="Bookmark">${picked ? "♥" : "♡"}</button>
            <div class="place-price">${esc(p.price)}</div>
          </div>
        </div>
      `;
    });

    view.innerHTML = html;

    view.querySelectorAll("[data-city]").forEach((btn) => {
      btn.addEventListener("click", () => {
        placeFilter = btn.getAttribute("data-city");
        renderPlaces();
      });
    });

    wirePickToggles(renderPlaces);
    wireSearchBar("placesSearchForm", "placesSearchInput");
  }

  let eatsFilter = "All";

  function renderEats() {
    let html = `
      <form class="search-bar" id="eatsSearchForm">
        <input type="search" id="eatsSearchInput" placeholder="Search restaurants near…" autocomplete="off" />
        <button type="submit" aria-label="Search restaurants on Google Maps">🔍</button>
      </form>
      <p class="search-hint">Opens Google Maps already searching "restaurants near" wherever you type.</p>
    `;

    const cities = ["All", "Edinburgh", "Stirling", "Glasgow"];
    html += `<div class="filter-row">`;
    cities.forEach((c) => {
      html += `<button class="filter-chip ${c === eatsFilter ? "active" : ""}" data-city="${esc(c)}">${esc(c)}</button>`;
    });
    html += `</div>`;

    html += `
      <div class="card">
        <p>Independent, well-reviewed picks near each stop — not fast-food chains, not fine-dining prices.
        £ = casual/cheap, ££ = mid-range, £££ = a step up but still no white tablecloths.</p>
      </div>
    `;

    const list = EATS.filter((e) => eatsFilter === "All" || e.city === eatsFilter);

    list.forEach((e) => {
      const mapsUrl = mapsUrlFor(e.mapsQuery);
      const picked = isPicked("eats", e.name);
      html += `
        <div class="card place-card">
          <div style="flex:1;">
            <div class="place-name">${esc(e.name)}</div>
            <div class="place-meta">
              <span class="pill" style="background:${cityColor(e.city)}">${esc(e.city)}</span>${esc(e.area)} · ${esc(e.meal)}
            </div>
            ${
              e.nearAttraction
                ? `<div class="place-distance">📍 ${esc(e.distance)} — near ${esc(e.nearAttraction)}</div>`
                : ""
            }
            <div class="place-notes">${esc(e.notes)}</div>
            <div class="place-links">
              ${e.website ? `<a href="${esc(e.website)}" target="_blank" rel="noopener">🌐 Website</a>` : ""}
              ${mapsUrl ? `<a href="${mapsUrl}" target="_blank" rel="noopener">📍 Map</a>` : ""}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
            <button class="pick-toggle${picked ? " picked" : ""}" data-toggle-pick="eats" data-name="${esc(e.name)}" aria-label="Bookmark">${picked ? "♥" : "♡"}</button>
            <div class="place-price">${esc(e.price)}</div>
          </div>
        </div>
      `;
    });

    view.innerHTML = html;

    view.querySelectorAll("[data-city]").forEach((btn) => {
      btn.addEventListener("click", () => {
        eatsFilter = btn.getAttribute("data-city");
        renderEats();
      });
    });

    wirePickToggles(renderEats);
    wireSearchBar("eatsSearchForm", "eatsSearchInput", (raw) => `restaurants near ${raw}`);
  }

  function renderBudget() {
    const totalLow = BUDGET.reduce((a, b) => a + b.low, 0);
    const totalHigh = BUDGET.reduce((a, b) => a + b.high, 0);

    let html = `<div class="card">`;
    BUDGET.forEach((b) => {
      const range = b.low === b.high ? (b.low === 0 ? "Free" : `£${b.low}`) : `£${b.low}–£${b.high}`;
      html += `
        <div class="budget-row">
          <div class="budget-item">${esc(b.item)}</div>
          <div class="budget-range">${range}</div>
        </div>
      `;
    });
    html += `
      <div class="budget-total">
        <b>Total (week)</b>
        <span class="budget-range">£${totalLow}–£${totalHigh}</span>
      </div>
    </div>`;

    html += `
      <div class="section-label">Notes</div>
      <div class="card">
        <p>Ranges reflect optional items (Wallace Monument climb, Glasgow Science Centre, Zoo) —
        skip any of them and the trip can cost well under £200. Museums, parks and beaches used in this plan
        (National Museum of Scotland, Botanic Garden, Kelvingrove, Portobello, Cramond) are free.</p>
      </div>
    `;

    view.innerHTML = html;
  }

  function loadChecked() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function saveChecked(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function renderTips() {
    let html = `<div class="section-label">Good to know</div>`;
    TIPS.forEach((t) => {
      html += `
        <div class="card tip-card">
          <h2>${esc(t.title)}</h2>
          <p>${esc(t.body)}</p>
        </div>
      `;
    });

    const checked = loadChecked();
    html += `<div class="section-label">Packing list</div>`;
    html += `<div class="card"><ul class="packing-list">`;
    PACKING.forEach((p, i) => {
      const isChecked = !!checked[i];
      html += `<li data-i="${i}" class="${isChecked ? "checked" : ""}">${esc(p)}</li>`;
    });
    html += `</ul></div>`;

    view.innerHTML = html;

    view.querySelectorAll(".packing-list li").forEach((li) => {
      li.addEventListener("click", () => {
        const i = li.getAttribute("data-i");
        const state = loadChecked();
        state[i] = !state[i];
        saveChecked(state);
        li.classList.toggle("checked");
      });
    });
  }

  // ---------- Explore nearby (Overpass / OpenStreetMap) ----------

  const NEARBY_CATEGORIES = [
    { key: "restaurant", label: "Restaurants", icon: "🍽️", tag: "amenity", value: "restaurant" },
    { key: "cafe", label: "Cafes", icon: "☕", tag: "amenity", value: "cafe" },
    { key: "parking", label: "Car parks", icon: "🅿️", tag: "amenity", value: "parking" },
    { key: "museum", label: "Museums", icon: "🏛️", tag: "tourism", value: "museum" },
    { key: "attraction", label: "Attractions", icon: "🎡", tag: "tourism", value: "attraction" },
    { key: "playground", label: "Playgrounds", icon: "🛝", tag: "leisure", value: "playground" },
    { key: "park", label: "Parks", icon: "🌳", tag: "leisure", value: "park" },
    { key: "toilets", label: "Toilets", icon: "🚻", tag: "amenity", value: "toilets" },
    { key: "pharmacy", label: "Pharmacies", icon: "💊", tag: "amenity", value: "pharmacy" },
    { key: "supermarket", label: "Supermarkets", icon: "🛒", tag: "shop", value: "supermarket" },
  ];

  // ---------- Explore: pick a centre, then browse by category ----------
  // The per-pick "explore nearby" only works from somewhere already saved.
  // This lets any point be the centre - a saved place, a typed location, or
  // where you actually are - which is what you want when deciding where to
  // base yourself for an afternoon.
  let explore = {
    open: false,
    centre: null, // { name, lat, lon }
    category: "",
    radius: 1500,
    status: "idle", // idle | locating | loading | done | error
    results: [],
    error: "",
    usedAi: false,
  };

  async function setExploreCentreFromSearch(query) {
    explore.status = "locating";
    explore.error = "";
    renderPicks();
    try {
      const geo = await geocodePlace(query, null);
      if (!geo) throw new Error(`Couldn't find "${query}".`);
      explore.centre = { name: query, lat: geo.lat, lon: geo.lon };
      explore.status = "idle";
      if (explore.category) return runExplore();
    } catch (e) {
      explore.status = "error";
      explore.error = e && e.message ? e.message : String(e);
    }
    renderPicks();
  }

  function setExploreCentreFromPick(pickId) {
    const p = loadPicks().find((x) => x.id === pickId);
    if (!p || p.lat == null) return;
    explore.centre = { name: p.name, lat: p.lat, lon: p.lon };
    explore.error = "";
    if (explore.category) return runExplore();
    renderPicks();
  }

  async function setExploreCentreFromGps() {
    if (!navigator.geolocation) {
      explore.status = "error";
      explore.error = "This device didn't offer location access.";
      renderPicks();
      return;
    }
    explore.status = "locating";
    explore.error = "";
    renderPicks();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        explore.centre = { name: "Where I am", lat: pos.coords.latitude, lon: pos.coords.longitude };
        explore.status = "idle";
        if (explore.category) runExplore();
        else renderPicks();
      },
      (err) => {
        explore.status = "error";
        explore.error = `Couldn't get your location: ${err.message}`;
        renderPicks();
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }

  // Category browsing via Gemini. OSM is thinnest exactly here - independent
  // cafés and restaurants are the least-mapped things in it - so the model
  // names candidates and OSM is then used only to place them.
  async function exploreWithGemini(centre, category, radiusMetres, key) {
    const cat = NEARBY_CATEGORIES.find((c) => c.key === category);
    const s = loadTripSettings();
    const who = s.travellers.trim() ? `\nTravellers: ${s.travellers.trim()}` : "";
    const distance = radiusMetres >= 1000 ? `${radiusMetres / 1000} km` : `${radiusMetres} m`;

    const prompt =
      `List up to 6 real, currently-open ${cat ? cat.label.toLowerCase() : category} within about ` +
      `${distance} of ${centre.name}.${who}\n\n` +
      `Use search to confirm each one exists and is still trading. Reply with ONLY a JSON array, ` +
      `each item {"name": exact official name, "area": street or neighbourhood, ` +
      `"why": one short sentence}. No other text.`;

    const { text, sources } = await callGemini(key, prompt, { grounded: true });
    const parsed = extractJson(text);
    if (!Array.isArray(parsed) || !parsed.length) throw new Error("Gemini returned no usable places");

    // Geocoded one at a time with a gap: Nominatim is a free community
    // service that asks for about one request a second, and firing a burst at
    // it is both rude and a good way to get blocked.
    const out = [];
    for (const item of parsed.slice(0, 6)) {
      if (!item || !item.name) continue;
      let geo = null;
      try {
        geo = await geocodePlace(item.name, item.area || centre.name);
      } catch (e) {
        geo = null;
      }
      if (geo) {
        // The model can name somewhere in the right country but the wrong
        // city. Anything absurdly outside the requested radius is dropped
        // rather than shown as "nearby".
        const km = haversineKm(centre.lat, centre.lon, geo.lat, geo.lon);
        if (km > (radiusMetres / 1000) * 3 + 2) continue;
      }
      out.push({
        name: item.name,
        lat: geo ? geo.lat : null,
        lon: geo ? geo.lon : null,
        website: geo ? geo.website : null,
        openingHours: geo ? geo.openingHours : null,
        address: geo ? geo.address : item.area || "",
        description: item.why || "",
        aiSuggested: true,
        sources,
      });
      await new Promise((r) => setTimeout(r, 1100));
    }
    if (!out.length) throw new Error("None of the suggestions could be placed on the map");
    return out.sort((a, b) => {
      if (a.lat == null) return 1;
      if (b.lat == null) return -1;
      return haversineKm(centre.lat, centre.lon, a.lat, a.lon) - haversineKm(centre.lat, centre.lon, b.lat, b.lon);
    });
  }

  async function runExplore() {
    if (!explore.centre || !explore.category) return;
    explore.status = "loading";
    explore.error = "";
    explore.usedAi = false;
    renderPicks();

    const key = loadTripSettings().geminiKey.trim();
    if (key) {
      try {
        explore.results = await exploreWithGemini(explore.centre, explore.category, explore.radius, key);
        explore.usedAi = true;
        explore.status = "done";
        renderPicks();
        return;
      } catch (e) {
        // Recorded rather than swallowed, so a quiet drop to thinner data is
        // visible instead of just looking like a sparse area.
        explore.error = e && e.message ? e.message : String(e);
      }
    }

    try {
      explore.results = await overpassNearby(
        explore.centre.lat,
        explore.centre.lon,
        NEARBY_CATEGORIES.find((c) => c.key === explore.category),
        explore.radius
      );
      explore.status = "done";
    } catch (e) {
      explore.status = "error";
      explore.error = e && e.message ? e.message : String(e);
    }
    renderPicks();
  }

  function renderExplore() {
    const cats = NEARBY_CATEGORIES.map(
      (c) =>
        `<button class="filter-chip${explore.category === c.key ? " active" : ""}" data-explore-cat="${c.key}">${
          c.icon
        } ${esc(c.label)}</button>`
    ).join("");

    const pickOptions = loadPicks()
      .filter((p) => p.lat != null)
      .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
      .join("");

    let body = `
      <form class="search-bar" id="exploreSearchForm" style="margin-bottom:8px;">
        <input type="text" id="exploreSearchInput" placeholder="Search a place or area…" autocomplete="off" />
        <button type="submit" aria-label="Set centre">🔍</button>
      </form>
      <div class="explore-centre-row">
        <button class="move-chip" id="exploreGpsBtn">📍 Where I am</button>
        ${pickOptions ? `<select id="exploreFromPick"><option value="">From a saved place…</option>${pickOptions}</select>` : ""}
      </div>
    `;

    if (explore.centre) {
      body += `<p class="explore-centre">Around <b>${esc(explore.centre.name)}</b></p>`;
      body += `<div class="filter-row">${cats}</div>`;
      body += `
        <div class="explore-radius">
          <label for="exploreRadius">Within</label>
          <select id="exploreRadius">
            ${[500, 1000, 1500, 3000, 5000]
              .map(
                (m) =>
                  `<option value="${m}"${explore.radius === m ? " selected" : ""}>${
                    m < 1000 ? m + " m" : m / 1000 + " km"
                  }</option>`
              )
              .join("")}
          </select>
        </div>
      `;
    } else {
      body += `<p class="pick-status">Choose a starting point above, then pick a category.</p>`;
    }

    if (explore.status === "locating") body += `<p class="pick-status">Finding that location…</p>`;
    if (explore.status === "loading") {
      const usingAi = !!loadTripSettings().geminiKey.trim();
      body += `<p class="pick-status">Looking for ${esc(catLabel(explore.category))}${
        usingAi ? " with AI search — this takes a few seconds" : ""
      }…</p>`;
    }
    if (explore.status === "error") body += `<pre class="settings-result bad">${esc(explore.error)}</pre>`;

    if (explore.status === "done") {
      if (!explore.results.length) {
        body += `<p class="pick-status">Nothing found in range — try a wider radius.</p>`;
      } else {
        if (explore.error) {
          body += `<p class="pick-status">Fell back to OpenStreetMap — the AI search didn't answer.</p><pre class="settings-result bad">${esc(
            explore.error
          )}</pre>`;
        }
        body += `<div class="explore-results">`;
        explore.results.forEach((r, i) => {
          // AI suggestions can lack coordinates when the follow-up geocode
          // finds nothing; they're still worth offering, just without a
          // distance.
          const km = r.lat != null ? haversineKm(explore.centre.lat, explore.centre.lon, r.lat, r.lon) : null;
          const distance = km == null ? "" : km < 1 ? Math.round(km * 1000) + " m away" : km.toFixed(1) + " km away";
          const meta = [distance, r.openingHours].filter(Boolean).join(" · ");
          body += `
            <div class="candidate-card explore-result">
              <div style="flex:1;">
                <div class="place-name">${esc(r.name)}${
                  r.aiSuggested ? ` <span class="ai-badge">AI</span>` : ""
                }</div>
                ${meta ? `<div class="place-notes">${esc(meta)}</div>` : ""}
                ${r.description ? `<div class="place-notes">${esc(r.description)}</div>` : ""}
                ${
                  r.aiSuggested && r.sources && r.sources.length
                    ? `<div class="place-links"><a href="${esc(r.sources[0].uri)}" target="_blank" rel="noopener">🔗 source</a></div>`
                    : ""
                }
              </div>
              <button class="candidate-add" data-explore-add="${i}">+</button>
            </div>
          `;
        });
        body += `</div>`;
      }
    }

    return `
      <div class="card">
        <div class="explore-head" id="exploreToggle">
          <b>🧭 Explore around a place</b>
          <span class="chevron">${explore.open ? "▼" : "▶"}</span>
        </div>
        ${explore.open ? body : ""}
      </div>
    `;
  }

  function wireExplore() {
    const toggle = document.getElementById("exploreToggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        explore.open = !explore.open;
        renderPicks();
      });
    }
    if (!explore.open) return;

    const form = document.getElementById("exploreSearchForm");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const q = document.getElementById("exploreSearchInput").value.trim();
        if (q) setExploreCentreFromSearch(q);
      });
    }
    const gps = document.getElementById("exploreGpsBtn");
    if (gps) gps.addEventListener("click", setExploreCentreFromGps);

    const fromPick = document.getElementById("exploreFromPick");
    if (fromPick) {
      fromPick.addEventListener("change", () => {
        if (fromPick.value) setExploreCentreFromPick(fromPick.value);
      });
    }
    const radius = document.getElementById("exploreRadius");
    if (radius) {
      radius.addEventListener("change", () => {
        explore.radius = Number(radius.value);
        if (explore.category) runExplore();
      });
    }
    view.querySelectorAll("[data-explore-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        explore.category = btn.getAttribute("data-explore-cat");
        runExplore();
      });
    });
    view.querySelectorAll("[data-explore-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const r = explore.results[Number(btn.getAttribute("data-explore-add"))];
        if (!r) return;
        const candidate = {
          name: r.name,
          lat: r.lat,
          lon: r.lon,
          website: r.website || "",
          openingHours: r.openingHours || "",
          address: r.address || "",
          description: r.description || "",
          category: catLabel(explore.category),
        };
        quickAdd(candidate);
      });
    });
  }

  function catLabel(key) {
    const c = NEARBY_CATEGORIES.find((x) => x.key === key);
    return c ? c.label : "Places";
  }

  function nearbyMapElId(pickId) {
    return "nearbymap-" + pickId.replace(/[^a-zA-Z0-9]/g, "_");
  }

  // Overpass (OpenStreetMap's "find everything of type X near here" API) -
  // free, no key, same OSM data Nominatim and the tile layer already use.
  // The free public Overpass instance (overpass-api.de) is shared community
  // infrastructure and can be slow, rate-limited, or briefly down. Fall
  // through a couple of mirror servers before giving up.
  const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
  ];

  async function overpassNearby(lat, lon, cat, radius) {
    radius = radius || 1200;
    const filter = `["${cat.tag}"="${cat.value}"]`;
    const q = `[out:json][timeout:20];(node${filter}(around:${radius},${lat},${lon});way${filter}(around:${radius},${lat},${lon}););out center 25;`;

    let lastError = null;
    let data = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          body: q,
          headers: { "Content-Type": "text/plain" },
        });
        if (!res.ok) {
          lastError = new Error(`overpass ${endpoint} returned ${res.status}`);
          continue;
        }
        data = await res.json();
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (lastError) {
      console.error("overpassNearby failed on all endpoints:", lastError);
      throw lastError;
    }

    return data.elements
      .map((el) => {
        const c = el.type === "node" ? { lat: el.lat, lon: el.lon } : el.center;
        if (!c || !el.tags || !el.tags.name) return null;
        return {
          name: el.tags.name,
          lat: c.lat,
          lon: c.lon,
          website: el.tags.website || el.tags["contact:website"] || null,
          openingHours: el.tags.opening_hours || null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => haversineKm(lat, lon, a.lat, a.lon) - haversineKm(lat, lon, b.lat, b.lon))
      .slice(0, 12);
  }

  let nearbyState = {};

  function getNearby(pickId) {
    if (!nearbyState[pickId]) nearbyState[pickId] = { open: false, category: null, status: "idle", results: [] };
    return nearbyState[pickId];
  }

  function initNearbyMap(pick, results) {
    const el = document.getElementById(nearbyMapElId(pick.id));
    if (!el) return;
    const map = L.map(el, { scrollWheelZoom: false });
    pickMiniMaps.push(map);
    addTileLayer(map);
    L.marker([pick.lat, pick.lon], {
      icon: L.divIcon({ className: "center-marker", html: "★", iconSize: [24, 24], iconAnchor: [12, 12] }),
    }).addTo(map);
    results.forEach((r, i) => {
      L.marker([r.lat, r.lon]).addTo(map).bindTooltip(`${i + 1}. ${r.name}`);
    });
    const bounds = L.latLngBounds([[pick.lat, pick.lon], ...results.map((r) => [r.lat, r.lon])]);
    map.fitBounds(bounds.pad(0.2));
  }

  function renderNearbyPanel(p) {
    if (p.lat == null) {
      return `<p class="pick-status" style="padding:0 16px 16px;">Getting location for "explore nearby"…</p>`;
    }
    const state = getNearby(p.id);
    let html = `<div class="nearby-panel">`;
    html += `<button class="nearby-toggle" data-nearby-toggle="${esc(p.id)}">🔎 ${state.open ? "Hide nearby search" : "Explore nearby"}</button>`;
    if (state.open) {
      html += `<div class="filter-row" style="padding:0 16px 10px;">`;
      NEARBY_CATEGORIES.forEach((c) => {
        html += `<button class="filter-chip${state.category === c.key ? " active" : ""}" data-nearby-cat="${esc(p.id)}|${c.key}">${c.icon} ${esc(c.label)}</button>`;
      });
      html += `</div>`;

      if (state.category) {
        if (state.status === "loading") {
          html += `<p class="pick-status" style="padding:0 16px 16px;">Searching OpenStreetMap for ${esc(catLabel(state.category)).toLowerCase()} nearby…</p>`;
        } else if (state.status === "error") {
          html += `
            <div style="padding:0 16px 16px;">
              <p class="pick-status">Search failed — the free OpenStreetMap server this uses can be slow or overloaded sometimes. Give it a moment and retry.</p>
              <button class="candidate-add" data-nearby-cat="${esc(p.id)}|${esc(state.category)}">↻ Retry</button>
            </div>
          `;
        } else if (state.status === "done") {
          if (!state.results.length) {
            html += `<p class="pick-status" style="padding:0 16px 16px;">No ${esc(catLabel(state.category)).toLowerCase()} found within ~1.2km.</p>`;
          } else {
            html += `<div class="nearby-map" id="${nearbyMapElId(p.id)}"></div>`;
            state.results.forEach((r, i) => {
              const distKm = haversineKm(p.lat, p.lon, r.lat, r.lon);
              const distLabel = distKm < 1 ? `${Math.round(distKm * 1000)} m` : `${distKm.toFixed(1)} km`;
              html += `
                <div class="candidate-card">
                  <div style="flex:1;">
                    <div class="place-name">${i + 1}. ${esc(r.name)}</div>
                    <div class="place-notes">${esc(distLabel)} away${r.openingHours ? " · " + esc(r.openingHours) : ""}</div>
                  </div>
                  <button class="candidate-add" data-add-nearby="${esc(p.id)}|${i}">+</button>
                </div>
              `;
            });
          }
        }
      }
    }
    html += `</div>`;
    return html;
  }

  // A pick in the list is a summary, not a dossier. The card used to render
  // every fact, a live map and eight controls for every saved place - so ten
  // places meant ten stacked detail pages and ten Leaflet instances, with
  // nothing to scan and no hierarchy. The row below carries only what you
  // need to recognise and triage it; everything else lives one tap away in
  // openPickDetail(), which also means only one map exists at a time.
  function renderPickRow(p) {
    const plan = loadPlan();
    const days = plan.days
      .filter((d) => (plan.items[d.id] || []).some((it) => it.pickId === p.id))
      .map((d) => shortDayLabel(d.label));

    const meta = [p.category, p.rating != null ? `⭐ ${p.rating}` : null].filter(Boolean).join(" · ");

    return `
      <button class="pick-row" data-open-pick="${esc(p.id)}">
        <div class="pick-row-main">
          <div class="pick-row-name">${esc(p.name)}</div>
          ${meta ? `<div class="pick-row-meta">${esc(meta)}</div>` : ""}
          <div class="pick-row-badges">
            ${days.map((d) => `<span class="row-badge day">${esc(d)}</span>`).join("")}
            ${p.booked ? `<span class="row-badge booked">booked</span>` : ""}
            ${p.note ? `<span class="row-badge note">note</span>` : ""}
            ${p.enrichStatus === "loading" ? `<span class="row-badge">loading…</span>` : ""}
          </div>
        </div>
        <span class="pick-row-chevron">›</span>
      </button>
    `;
  }

  // Everything about one place, opened from a row. This is where the map,
  // the full facts and all the editing controls live.
  function openPickDetail(id) {
    const p = loadPicks().find((x) => x.id === id);
    if (!p) return;
    const mapsUrl = pickGoogleUrl(p);
    const plan = loadPlan();
    const folders = loadFolders();
    const scheduled = {};
    plan.days.forEach((d) => {
      if ((plan.items[d.id] || []).some((it) => it.pickId === p.id)) scheduled[d.id] = true;
    });

    const description = p.description || p.notes || "";

    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="${esc(p.name)}">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">✕</button>
          <div class="modal-body">
            <h2 class="modal-title">${esc(p.name)}</h2>
            <div class="modal-subtitle">${esc(
              [p.category, p.city].filter(Boolean).join(" · ")
            )}${p.rating != null ? ` · ⭐ ${esc(String(p.rating))}` : ""}</div>

            ${description ? `<p class="place-notes" style="margin-top:10px;">${esc(description)}</p>` : ""}

            ${p.address ? `<div class="place-fact">📍 ${esc(p.address)}</div>` : ""}
            ${p.openingHours ? `<div class="place-fact">🕒 ${esc(p.openingHours)}</div>` : ""}
            ${p.phone ? `<div class="place-fact">📞 <a href="tel:${esc(p.phone)}">${esc(p.phone)}</a></div>` : ""}
            ${p.website ? `<div class="place-fact">🌐 <a href="${esc(p.website)}" target="_blank" rel="noopener">Website</a></div>` : ""}

            ${p.lat != null ? `<div class="detail-map" id="detailMap"></div>` : ""}
            ${mapsUrl ? `<button class="modal-btn modal-btn-primary" data-open-maps="${esc(mapsUrl)}">📍 ${
              p.googleUrl ? "Open on Google Maps" : "Find on Google Maps"
            }</button>` : ""}

            <div class="settings-divider"></div>

            <label class="settings-label">Which days</label>
            <div class="day-assign-row">
              ${
                plan.days.length
                  ? plan.days
                      .map(
                        (d) =>
                          `<button class="day-chip${scheduled[d.id] ? " on" : ""}" data-assign-day="${esc(
                            p.id
                          )}|${esc(d.id)}">${esc(shortDayLabel(d.label))}</button>`
                      )
                      .join("")
                  : `<span class="settings-hint">Add days in the Itinerary tab first.</span>`
              }
            </div>

            <label class="settings-label">Your note</label>
            <input class="settings-input" type="text" placeholder="e.g. book ahead, buggy round the back"
                   value="${esc(p.note || "")}" data-pick-note="${esc(p.id)}" />

            <div class="settings-btn-row" style="margin-top:12px;">
              <button class="modal-btn booked-toggle${p.booked ? " on" : ""}" data-toggle-booked="${esc(p.id)}">
                ${p.booked ? "✓ Booked" : "Mark booked"}
              </button>
              <button class="modal-btn" data-explore-from="${esc(p.id)}">🧭 What's nearby</button>
            </div>

            <label class="settings-label">Folder</label>
            <div class="move-row">
              ${folders
                .map(
                  (c) =>
                    `<button class="move-chip${p.city === c ? " active" : ""}" data-move-pick="${esc(
                      p.id
                    )}|${esc(c)}">${esc(c)}</button>`
                )
                .join("")}
              <button class="move-chip" data-new-folder-for="${esc(p.id)}">+ New</button>
            </div>

            <button class="modal-btn danger" data-remove-pick="${esc(p.id)}" style="margin-top:16px;width:100%;">
              Remove from picks
            </button>
          </div>
        </div>
      </div>
    `;
    placeModal.classList.add("open");
    wirePickDetail(p);
  }

  function wirePickDetail(p) {
    placeModal.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target === el) closePlaceModal();
      });
    });

    const mapEl = document.getElementById("detailMap");
    if (mapEl && p.lat != null) {
      const map = L.map(mapEl, { scrollWheelZoom: false, attributionControl: false });
      addTileLayer(map);
      map.setView([p.lat, p.lon], 15);
      L.marker([p.lat, p.lon]).addTo(map);
      // Leaflet needs a nudge when it initialises inside a sheet that was
      // display:none a moment ago, or it renders a grey box.
      setTimeout(() => map.invalidateSize(), 60);
    }

    placeModal.querySelectorAll("[data-open-maps]").forEach((btn) =>
      btn.addEventListener("click", () => openExternal(btn.getAttribute("data-open-maps")))
    );

    placeModal.querySelectorAll("[data-assign-day]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [pid, dayId] = btn.getAttribute("data-assign-day").split("|");
        const plan = loadPlan();
        const already = (plan.items[dayId] || []).some((it) => it.pickId === pid);
        if (already) removeFromPlan(dayId, pid);
        else addToPlan(dayId, pid);
        btn.classList.toggle("on", !already);
      });
    });

    placeModal.querySelectorAll("[data-pick-note]").forEach((input) =>
      input.addEventListener("blur", () =>
        updatePick(input.getAttribute("data-pick-note"), { note: input.value.trim() })
      )
    );

    placeModal.querySelectorAll("[data-toggle-booked]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-toggle-booked");
        const cur = loadPicks().find((x) => x.id === id);
        const next = !(cur && cur.booked);
        updatePick(id, { booked: next });
        btn.classList.toggle("on", next);
        btn.textContent = next ? "✓ Booked" : "Mark booked";
      });
    });

    placeModal.querySelectorAll("[data-move-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [id, folder] = btn.getAttribute("data-move-pick").split("|");
        setPickCity(id, folder);
        closePlaceModal();
        renderPicks();
        toast(`Moved to ${folder}`);
      });
    });

    placeModal.querySelectorAll("[data-new-folder-for]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-new-folder-for");
        const name = prompt("New folder name");
        const created = addFolder(name);
        if (!created) return;
        setPickCity(id, created);
        closePlaceModal();
        renderPicks();
        toast(`Moved to ${created}`);
      });
    });

    placeModal.querySelectorAll("[data-explore-from]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-explore-from");
        closePlaceModal();
        explore.open = true;
        setExploreCentreFromPick(id);
      });
    });

    placeModal.querySelectorAll("[data-remove-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-remove-pick");
        const removed = loadPicks().find((x) => x.id === id);
        removePick(id);
        closePlaceModal();
        renderPicks();
        toast(`Removed ${removed ? removed.name : "pick"}`);
      });
    });
  }

  // ---------- Picks: search-and-confirm with a real map ----------

  let pickSearch = { query: "", status: "idle", results: [] }; // idle | loading | done | error
  const pickMiniMaps = []; // Leaflet map instances from the last render, torn down before re-render

  // Searches Google Places when a key is configured, otherwise OpenStreetMap.
  // Google is used because OSM's community data simply doesn't have many
  // smaller businesses; OSM stays as the no-setup default and the fallback
  // for when a Google call fails, so search always works either way.
  let lastSearchError = "";

  async function searchPlaces(query) {
    lastSearchError = "";
    const s = loadTripSettings();
    const geminiKey = s.geminiKey.trim();
    const googleKey = s.googleKey.trim();

    // Gemini leads. It understands a description rather than only a name, and
    // its grounded search reaches the small businesses OSM has never had. OSM
    // still resolves the coordinates for whatever it names, so positions stay
    // real data rather than anything the model produced.
    if (geminiKey) {
      try {
        const results = await searchWithGemini(query, geminiKey);
        if (results.length) return results;
      } catch (e) {
        console.warn("Gemini search failed, falling back:", e);
        lastSearchError = e && e.message ? e.message : String(e);
      }
    }

    if (googleKey) {
      try {
        const results = await searchGooglePlaces(query, googleKey);
        if (results.length) return results;
      } catch (e) {
        console.warn("Google Places search failed, falling back:", e);
        lastSearchError = e && e.message ? e.message : String(e);
      }
    }

    // Final backup: works with no key at all, so search never simply stops.
    try {
      return await searchNominatim(query);
    } catch (e) {
      if (!lastSearchError) lastSearchError = e && e.message ? e.message : String(e);
      return [];
    }
  }

  // Places API (New) text search. Only the fields named below are requested -
  // billing is per field-mask tier, so asking for less keeps it in the
  // cheapest bracket rather than being charged for data we don't display.
  async function searchGooglePlaces(query, key) {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.location",
          "places.primaryTypeDisplayName",
          "places.websiteUri",
          "places.nationalPhoneNumber",
          "places.rating",
          "places.userRatingCount",
          "places.currentOpeningHours.weekdayDescriptions",
          "places.editorialSummary",
        ].join(","),
      },
      body: JSON.stringify({ textQuery: scopedQuery(query), maxResultCount: 5 }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`google places ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = await res.json();
    return (data.places || []).map((p) => ({
      name: (p.displayName && p.displayName.text) || query,
      displayName: p.formattedAddress || "",
      lat: p.location && p.location.latitude,
      lon: p.location && p.location.longitude,
      type: p.primaryTypeDisplayName && p.primaryTypeDisplayName.text,
      category: p.primaryTypeDisplayName && p.primaryTypeDisplayName.text,
      website: p.websiteUri || null,
      phone: p.nationalPhoneNumber || null,
      openingHours:
        p.currentOpeningHours && p.currentOpeningHours.weekdayDescriptions
          ? p.currentOpeningHours.weekdayDescriptions.join(" · ")
          : null,
      address: p.formattedAddress || null,
      description: (p.editorialSummary && p.editorialSummary.text) || "",
      rating: typeof p.rating === "number" ? p.rating : null,
      ratingCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
      // Google's own id gives an exact link to the place, same idea as the
      // CID recovered from a share.
      googleUrl: p.id ? `https://www.google.com/maps/place/?q=place_id:${p.id}` : "",
      source: "google",
    }));
  }

  async function searchNominatim(query) {
    // extratags/namedetails have to be requested explicitly - without them
    // the name and website below silently read undefined every time.
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&extratags=1&namedetails=1&q=${encodeURIComponent(
      scopedQuery(query)
    )}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("nominatim error");
    const data = await res.json();
    return data.map((r) => {
      const details = placeFromNominatim(r);
      return {
        name: (r.namedetails && r.namedetails.name) || r.display_name.split(",")[0],
        displayName: r.display_name,
        lat: details.lat,
        lon: details.lon,
        type: r.type,
        website: details.website,
        phone: details.phone,
        openingHours: details.openingHours,
        address: details.address,
      };
    });
  }

  function destroyMiniMaps() {
    pickMiniMaps.forEach((m) => m.remove());
    pickMiniMaps.length = 0;
  }

  function addTileLayer(map) {
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
  }

  function initSearchResultsMap(results) {
    const el = document.getElementById("pickSearchMap");
    if (!el) return;

    // AI-suggested results can arrive without coordinates when the follow-up
    // geocode finds nothing, so only mappable ones are plotted - passing a
    // null lat/lon to Leaflet throws and takes the whole render down. The
    // original index is kept so a pin still scrolls to the right card.
    const mappable = results
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.lat != null && r.lon != null);
    if (!mappable.length) return;

    const map = L.map(el, { scrollWheelZoom: false });
    pickMiniMaps.push(map);
    addTileLayer(map);
    const markers = mappable.map(({ r, i }) =>
      L.marker([r.lat, r.lon])
        .addTo(map)
        .bindTooltip(`${i + 1}. ${r.name}`, { permanent: false })
    );
    const bounds = L.latLngBounds(mappable.map(({ r }) => [r.lat, r.lon]));
    map.fitBounds(bounds.pad(0.3));
    markers.forEach((m, idx) => {
      const originalIndex = mappable[idx].i;
      m.on("click", () => {
        const card = view.querySelector(`[data-candidate="${originalIndex}"]`);
        if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });
  }

  function pickMapElId(id) {
    return "map-" + id.replace(/[^a-zA-Z0-9]/g, "_");
  }

  function initPickMiniMap(pick) {
    const el = document.getElementById(pickMapElId(pick.id));
    if (!el || pick.lat == null) return;
    const map = L.map(el, {
      scrollWheelZoom: false,
      dragging: false,
      zoomControl: false,
      attributionControl: false,
    });
    pickMiniMaps.push(map);
    addTileLayer(map);
    map.setView([pick.lat, pick.lon], 14);
    L.marker([pick.lat, pick.lon]).addTo(map);
  }

  async function confirmAddCandidate(candidate, folder) {
    const id = pickId("custom", candidate.name);
    const picks = loadPicks();
    if (picks.some((p) => p.id === id)) {
      pickSearch = { query: "", status: "idle", results: [] };
      renderPicks();
      return;
    }
    // Maps query is built from real geographic data (Nominatim's full
    // address, when we have it) - never from the folder, which is just the
    // user's own organisation and may have nothing to do with geography.
    const mapsQuery = candidate.displayName || scopedQuery(candidate.name);
    const pick = {
      id,
      source: "custom",
      name: candidate.name,
      city: folder || nearestCity(candidate.lat, candidate.lon),
      category: candidate.category || candidate.type || "Custom",
      notes: "",
      description: candidate.description || "",
      website: candidate.website || "",
      address: candidate.address || "",
      phone: candidate.phone || "",
      openingHours: candidate.openingHours || "",
      googleUrl: candidate.googleUrl || "",
      rating: candidate.rating != null ? candidate.rating : null,
      ratingCount: candidate.ratingCount != null ? candidate.ratingCount : null,
      mapsQuery,
      lat: candidate.lat,
      lon: candidate.lon,
      enrichStatus: "loading",
      addedAt: Date.now(),
    };
    picks.push(pick);
    savePicks(picks);
    pickSearch = { query: "", status: "idle", results: [] };
    renderPicks();

    // A candidate can arrive without coordinates - an AI suggestion whose
    // geocode came back empty, for instance - so retry the lookup here rather
    // than leaving the pick permanently without a position (and so without a
    // map or "explore nearby").
    const needsGeo = candidate.lat == null || candidate.lon == null;
    const [wiki, geo] = await Promise.all([
      wikiEnrich(candidate.name).catch(() => null),
      needsGeo ? geocodePlace(candidate.name, folder || null).catch(() => null) : Promise.resolve(null),
    ]);

    const fresh = loadPicks();
    const target = fresh.find((p) => p.id === id);
    if (!target) return; // removed while enriching
    if (wiki) {
      if (wiki.description) target.description = wiki.description;
      if (!target.website && wiki.website) target.website = wiki.website;
    }
    if (geo) {
      target.lat = geo.lat;
      target.lon = geo.lon;
      if (!target.website && geo.website) target.website = geo.website;
      if (!target.address && geo.address) target.address = geo.address;
      if (!target.phone && geo.phone) target.phone = geo.phone;
      if (!target.openingHours && geo.openingHours) target.openingHours = geo.openingHours;
    }
    target.enrichStatus = wiki || geo ? "done" : "empty";
    savePicks(fresh);
    if (view.dataset.activeTab === "picks") renderPicks();
  }

  function renderPicks() {
    const picks = loadPicks();

    let html = `
      <form class="search-bar" id="pickSearchForm">
        <input type="text" id="pickSearchInput" placeholder="Search for a place to add…" autocomplete="off" value="${esc(
          pickSearch.query
        )}" />
        <button type="submit" aria-label="Search">🔍</button>
      </form>
      ${renderExplore()}
    `;

    if (pickSearch.status === "loading") {
      html += `<div class="card"><p class="pick-status">Searching OpenStreetMap…</p></div>`;
    } else if (pickSearch.status === "error") {
      html += `<div class="card"><p class="pick-status">Search failed — check your connection and try again.</p>${
        lastSearchError ? `<pre class="settings-result bad">${esc(lastSearchError)}</pre>` : ""
      }</div>`;
    } else if (pickSearch.status === "done") {
      if (!pickSearch.results.length) {
        html += `<div class="card"><p class="pick-status">No matches for "${esc(pickSearch.query)}" — try a shorter or more general name.</p>${
          lastSearchError ? `<pre class="settings-result bad">${esc(lastSearchError)}</pre>` : ""
        }</div>`;
      } else {
        // Gemini failing but OSM answering means quietly worse results. Say
        // so, rather than letting the app degrade invisibly.
        if (lastSearchError) {
          html += `<div class="card"><p class="pick-status">Fell back to OpenStreetMap — the AI search didn't answer.</p><pre class="settings-result bad">${esc(
            lastSearchError
          )}</pre></div>`;
        }
        const anyMappable = pickSearch.results.some((r) => r.lat != null && r.lon != null);
        if (anyMappable) {
          html += `
            <div class="card" style="padding:0;overflow:hidden;">
              <div id="pickSearchMap" class="search-map"></div>
            </div>
            <p class="search-hint">Tap the right match below (or its pin above) to add it.</p>
          `;
        } else {
          html += `<p class="search-hint">Tap the right match below to add it.</p>`;
        }
        pickSearch.results.forEach((r, i) => {
          html += `
            <div class="card candidate-card" data-candidate="${i}">
              <div style="flex:1;">
                <div class="place-name">${i + 1}. ${esc(r.name)}${
                  r.aiSuggested ? ` <span class="ai-badge">AI</span>` : ""
                }${r.rating != null ? ` <span class="candidate-rating">⭐ ${esc(String(r.rating))}</span>` : ""}</div>
                <div class="place-notes">${esc(r.displayName)}</div>
                ${r.aiSuggested && r.description ? `<div class="place-notes">${esc(r.description)}</div>` : ""}
                ${
                  r.aiSuggested && r.sources && r.sources.length
                    ? `<div class="place-links"><a href="${esc(r.sources[0].uri)}" target="_blank" rel="noopener">🔗 source</a></div>`
                    : ""
                }
              </div>
              <button class="candidate-add" data-add-candidate="${i}">Add</button>
            </div>
          `;
        });
      }
    }

    if (picks.length === 0) {
      // Guidance belongs here, where it's actually needed, rather than
      // permanently occupying the top of the screen once you know the app.
      html += `
        <div class="card empty-state">
          <div class="empty-icon">♡</div>
          <h2>No places saved yet</h2>
          <ul class="empty-list">
            <li><b>Share from Google Maps</b> — tap Share on a place, pick this app</li>
            <li><b>Search above</b> — by name, or describe what you want</li>
            <li><b>Explore around a place</b> — cafés, museums, playgrounds nearby</li>
          </ul>
          <p class="settings-hint">Tapping ♡ in Places or Eats saves things here too.</p>
        </div>
      `;
    } else {
      html += `<button class="hero-share" id="sharePicks" style="color:var(--navy);border-color:var(--line);background:var(--card);margin:16px 0;">↗ Share my picks</button>`;

      // Section order follows the folders list (so a manually reordered/renamed
      // folder stays put), then any leftover city values from before the
      // folders feature existed, then Unsorted last.
      const sectionOrder = loadFolders().slice();
      picks.forEach((p) => {
        if (p.city && !sectionOrder.includes(p.city)) sectionOrder.push(p.city);
      });
      sectionOrder.push("Unsorted");

      const groups = {};
      sectionOrder.forEach((c) => (groups[c] = []));
      picks.forEach((p) => {
        (groups[p.city] || groups.Unsorted).push(p);
      });

      sectionOrder.forEach((city) => {
        if (!groups[city].length) return;
        html += `<div class="section-label">${esc(city)}</div>`;
        groups[city].forEach((p) => {
          html += renderPickRow(p);
        });
      });
    }

    destroyMiniMaps();
    view.innerHTML = html;
    wireExplore();

    const searchForm = document.getElementById("pickSearchForm");
    if (searchForm) {
      searchForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const q = document.getElementById("pickSearchInput").value.trim();
        if (!q) return;
        pickSearch = { query: q, status: "loading", results: [] };
        renderPicks();
        try {
          const results = await searchPlaces(q);
          pickSearch = { query: q, status: "done", results };
        } catch (err) {
          pickSearch = { query: q, status: "error", results: [] };
        }
        renderPicks();
      });
    }

    if (pickSearch.status === "done" && pickSearch.results.length) {
      initSearchResultsMap(pickSearch.results);
      view.querySelectorAll("[data-add-candidate]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const candidate = pickSearch.results[Number(btn.getAttribute("data-add-candidate"))];
          quickAdd(candidate);
        });
      });
    }

    // No per-pick maps in the list any more: the single map lives in the
    // detail sheet. Ten saved places used to mean ten live Leaflet instances
    // stacked on one screen.

    view.querySelectorAll("[data-open-pick]").forEach((row) => {
      row.addEventListener("click", () => openPickDetail(row.getAttribute("data-open-pick")));
    });

    view.querySelectorAll("[data-open-maps]").forEach((btn) => {
      btn.addEventListener("click", () => openExternal(btn.getAttribute("data-open-maps")));
    });

    view.querySelectorAll("[data-assign-day]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [pid, dayId] = btn.getAttribute("data-assign-day").split("|");
        const plan = loadPlan();
        const already = (plan.items[dayId] || []).some((it) => it.pickId === pid);
        if (already) {
          removeFromPlan(dayId, pid);
          toast("Removed from that day");
        } else {
          addToPlan(dayId, pid);
          const day = plan.days.find((d) => d.id === dayId);
          toast(`Added to ${day ? shortDayLabel(day.label) : "that day"}`);
        }
        renderPicks();
      });
    });

    view.querySelectorAll("[data-toggle-booked]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-toggle-booked");
        const p = loadPicks().find((x) => x.id === id);
        updatePick(id, { booked: !(p && p.booked) });
        renderPicks();
      });
    });

    view.querySelectorAll("[data-pick-note]").forEach((input) => {
      // Saved on blur so a re-render can't interrupt typing.
      input.addEventListener("blur", () => {
        updatePick(input.getAttribute("data-pick-note"), { note: input.value.trim() });
      });
    });

    view.querySelectorAll("[data-nearby-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        getNearby(btn.getAttribute("data-nearby-toggle")).open ^= true;
        renderPicks();
      });
    });

    view.querySelectorAll("[data-nearby-cat]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const [id, catKey] = btn.getAttribute("data-nearby-cat").split("|");
        const pick = loadPicks().find((p) => p.id === id);
        const cat = NEARBY_CATEGORIES.find((c) => c.key === catKey);
        if (!pick || !cat) return;
        const state = getNearby(id);
        state.category = catKey;
        state.status = "loading";
        renderPicks();
        try {
          state.results = await overpassNearby(pick.lat, pick.lon, cat);
          state.status = "done";
        } catch (e) {
          state.status = "error";
        }
        renderPicks();
      });
    });

    view.querySelectorAll("[data-add-nearby]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [id, idx] = btn.getAttribute("data-add-nearby").split("|");
        const state = getNearby(id);
        const r = state.results[Number(idx)];
        const parentPick = picks.find((p) => p.id === id);
        if (!r) return;
        const candidate = { name: r.name, lat: r.lat, lon: r.lon, type: catLabel(state.category), website: r.website };
        // Inherit the folder of the pick you were exploring around - that's
        // almost always where a nearby place belongs.
        quickAdd(candidate, { folder: (parentPick && parentPick.city) || null });
      });
    });

    const shareBtn = document.getElementById("sharePicks");
    if (shareBtn) {
      shareBtn.addEventListener("click", () => {
        const lines = ["🏴 My picks for Scotland with Ally", ""];
        picks.forEach((p) => {
          lines.push(`• ${p.name}${p.city ? ` (${p.city})` : ""}`);
          if (p.description) lines.push(`  ${p.description}`);
          if (p.website) lines.push(`  🌐 ${p.website}`);
        });
        shareText("My picks", lines.join("\n"));
      });
    }

    view.querySelectorAll("[data-remove-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        removePick(btn.getAttribute("data-remove-pick"));
        renderPicks();
      });
    });

    view.querySelectorAll("[data-move-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [id, city] = btn.getAttribute("data-move-pick").split("|");
        setPickCity(id, city);
        renderPicks();
      });
    });

    view.querySelectorAll("[data-new-folder-for]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-new-folder-for");
        const pick = picks.find((p) => p.id === id);
        openFolderPicker(pick ? pick.name : "this pick", pick && pick.city, (folder) => {
          setPickCity(id, folder);
          renderPicks();
        });
      });
    });
  }

  // ---------- Today ----------
  // The screen the app opens on, and the only one that matters while you're
  // actually out: what's next, how far, is it open. Everything else in the
  // app is preparation for this.

  // Matches a day label like "Day 3 · Fri 21 Aug" against a real date, so the
  // app can find today without the user having entered machine-readable dates.
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  function dayLabelToDate(label, referenceYear) {
    const m = String(label || "").match(/(\d{1,2})\s*([A-Za-z]{3,})/);
    if (!m) return null;
    const monthIdx = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (monthIdx < 0) return null;
    return new Date(referenceYear, monthIdx, Number(m[1]));
  }

  function sameDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
    );
  }

  // Today's day if the trip is running, otherwise the next one still ahead,
  // otherwise the first - so the screen is never empty for lack of a match.
  function currentPlanDay() {
    const plan = loadPlan();
    if (!plan.days.length) return null;
    const now = new Date();
    const dated = plan.days.map((d) => ({ day: d, date: dayLabelToDate(d.label, now.getFullYear()) }));

    const today = dated.find((x) => x.date && sameDay(x.date, now));
    if (today) return { ...today, isToday: true };

    const upcoming = dated.filter((x) => x.date && x.date > now).sort((a, b) => a.date - b.date)[0];
    if (upcoming) return { ...upcoming, isToday: false };

    return { day: plan.days[0], date: dated[0].date, isToday: false };
  }

  function renderToday() {
    const current = currentPlanDay();
    const picks = loadPicks();
    const byId = {};
    picks.forEach((p) => (byId[p.id] = p));

    if (!current) {
      view.innerHTML = `
        <div class="card empty-state">
          <div class="empty-icon">🗓️</div>
          <h2>No days planned yet</h2>
          <p>Add days in the Itinerary tab, then schedule your saved places into them.</p>
        </div>
      `;
      return;
    }

    const plan = loadPlan();
    const items = (plan.items[current.day.id] || []).filter((it) => byId[it.pickId]);
    const dayCode = dayCodeFromLabel(current.day.label);

    let html = `
      <div class="today-head">
        <div class="today-label">${current.isToday ? "Today" : "Next up"}</div>
        <div class="today-date">${esc(current.day.label)}</div>
      </div>
    `;

    if (!items.length) {
      html += `
        <div class="card empty-state">
          <div class="empty-icon">🚶</div>
          <h2>Nothing planned${current.isToday ? " for today" : " for that day"}</h2>
          <p>Open Picks and tap a day chip on anything you've saved.</p>
        </div>
      `;
    } else {
      items.forEach((it, idx) => {
        const p = byId[it.pickId];
        const prev = idx > 0 ? byId[items[idx - 1].pickId] : null;
        const leg = walkLeg(prev, p);
        const mayBeClosed = closedOnDay(p.openingHours, dayCode);
        const isNext = idx === 0;

        if (leg && leg.mins >= 5) {
          html += `<div class="today-leg">🚶 ${leg.mins} min · ${
            leg.km < 1 ? Math.round(leg.km * 1000) + " m" : leg.km.toFixed(1) + " km"
          }</div>`;
        }

        html += `
          <div class="card today-card${isNext ? " next" : ""}">
            ${isNext ? `<div class="today-next-flag">NEXT</div>` : ""}
            <div class="today-card-head">
              <div>
                <div class="today-time">${esc(it.time || "—")}</div>
                <div class="today-name">${esc(p.name)}${
                  p.booked ? ` <span class="booked-badge">booked</span>` : ""
                }</div>
                ${p.address ? `<div class="today-sub">${esc(p.address)}</div>` : ""}
              </div>
            </div>
            ${p.openingHours ? `<div class="place-fact">🕒 ${esc(p.openingHours)}</div>` : ""}
            ${
              mayBeClosed
                ? `<div class="plan-warn">⚠ May be closed today — check before setting off.</div>`
                : ""
            }
            ${p.note ? `<div class="today-note">📝 ${esc(p.note)}</div>` : ""}
            <div class="today-actions">
              <button class="modal-btn modal-btn-primary" data-open-maps="${esc(directionsUrl(p))}">↗ Directions</button>
              <button class="modal-btn" data-open-pick="${esc(p.id)}">Details</button>
            </div>
          </div>
        `;
      });
    }

    view.innerHTML = html;

    view.querySelectorAll("[data-open-maps]").forEach((btn) =>
      btn.addEventListener("click", () => openExternal(btn.getAttribute("data-open-maps")))
    );
    view.querySelectorAll("[data-open-pick]").forEach((btn) =>
      btn.addEventListener("click", () => openPickDetail(btn.getAttribute("data-open-pick")))
    );
  }

  // Walking directions to a place. Uses the exact Google place when the share
  // gave us its id, so navigation lands on the real venue rather than a
  // name-matched guess.
  function directionsUrl(p) {
    if (p.lat != null && p.lon != null) {
      return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=walking`;
    }
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
      pickMapsQuery(p)
    )}&travelmode=walking`;
  }

  const VIEWS = {
    today: { render: renderToday, sub: "What's on now" },
    overview: { render: renderOverview, sub: TRIP.dates },
    itinerary: { render: renderItinerary, sub: "Tap a day to expand" },
    places: { render: renderPlaces, sub: "Edinburgh · Stirling · Glasgow" },
    eats: { render: renderEats, sub: "Lunch & dinner picks, kid-friendly" },
    picks: { render: renderPicks, sub: "Your bookmarks & custom adds" },
    budget: { render: renderBudget, sub: "Estimated activity costs" },
    tips: { render: renderTips, sub: "Walking, weather, safety & packing" },
  };

  function showView(name) {
    const v = VIEWS[name];
    if (!v) return;
    view.dataset.activeTab = name;
    // A throw inside a render used to leave the screen blank with no way back
    // - a real risk mid-trip, where the app failing is worse than any single
    // feature failing. Catch it, say so, and keep the tab bar usable.
    try {
      v.render();
    } catch (e) {
      console.error(`render failed for "${name}":`, e);
      view.innerHTML = `
        <div class="card">
          <h2>Something went wrong on this screen</h2>
          <p>The rest of the app still works — switch tabs and come back. Your saved data is untouched.</p>
          <pre class="settings-result bad">${esc(String((e && e.stack) || e))}</pre>
        </div>
      `;
    }
    topbarSub.textContent = v.sub;
    tabbar.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.getAttribute("data-view") === name);
    });
    view.scrollTop = 0;
  }

  tabbar.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => showView(t.getAttribute("data-view")));
  });

  // ---------- Receiving a share from Google Maps ----------
  // Delivered by the native ShareReceiver plugin (MainActivity.java /
  // SharePlugin.java) when the app is opened via the share sheet from
  // Google Maps. The native side follows the link and reads the page's Open
  // Graph tags, so `name` is the real place title. Coordinates only come
  // through when the resolved URL carried them:
  //  - with lat/lon: skip straight to "which folder does this go in".
  //  - without: fall back to the normal search-and-confirm flow so the map
  //    still confirms the right match.
  async function handleSharedPlace(payload) {
    if (!payload || !payload.name) return;
    showView("picks");

    // Show the place as "arriving" straight away - the lookups below take a
    // second or two and a silent pause reads as nothing having happened.
    pickSearch = { query: payload.name, status: "loading", results: [] };
    renderPicks();

    const candidate = {
      name: payload.name,
      lat: payload.lat != null ? payload.lat : null,
      lon: payload.lon != null ? payload.lon : null,
      description: payload.description || "",
      // Google's own link to this exact place, when the share carried its id.
      googleUrl: payload.googleUrl || "",
      // Deliberately not passing the raw share text as displayName: it
      // becomes the Google Maps search query, and the raw text is a
      // sentence with a URL in it ("Check out X https://...") which
      // searches for nothing useful.
    };

    // Google gives a reliable name but, behind the consent wall, nothing
    // else - so the rest of the profile is built from OpenStreetMap and
    // Wikipedia, which are open and need no key.
    const [geo, wiki] = await Promise.all([
      geocodePlace(payload.name, null).catch(() => null),
      wikiEnrich(payload.name).catch(() => null),
    ]);

    if (geo) {
      if (candidate.lat == null) candidate.lat = geo.lat;
      if (candidate.lon == null) candidate.lon = geo.lon;
      candidate.website = geo.website || "";
      candidate.phone = geo.phone || "";
      candidate.openingHours = geo.openingHours || "";
      candidate.address = geo.address || "";
      candidate.category = geo.category || "";
    }
    if (wiki) {
      if (wiki.description) candidate.description = wiki.description;
      if (!candidate.website && wiki.website) candidate.website = wiki.website;
    }

    pickSearch = { query: "", status: "idle", results: [] };
    renderPicks();

    const suggested = candidate.lat != null ? nearestCity(candidate.lat, candidate.lon) : null;
    openFolderPicker(candidate.name, suggested, (folder) => confirmAddCandidate(candidate, folder), {
      summary: sharedPlaceSummary(candidate),
    });
  }

  // One-line-per-fact preview of what the lookups found, shown above the
  // folder chips so it's clear what is about to be saved.
  function sharedPlaceSummary(c) {
    const rows = [];
    if (c.category) rows.push(`🏷️ ${c.category}`);
    if (c.address) rows.push(`📍 ${c.address}`);
    if (c.openingHours) rows.push(`🕒 ${c.openingHours}`);
    if (c.phone) rows.push(`📞 ${c.phone}`);
    if (c.website) rows.push(`🌐 ${c.website}`);
    if (c.description) rows.push(c.description);
    if (!rows.length) rows.push("No extra details found - saved with just the name.");
    return rows;
  }

  // notifyListeners on the native side uses retainUntilConsumed, so this
  // still fires with the right payload even if the share arrived before the
  // page (and this addListener call) existed - no race with page load time.
  const shareReceiver = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ShareReceiver;
  if (shareReceiver) {
    shareReceiver.addListener("sharedPlace", handleSharedPlace);
  } else if (window.Capacitor) {
    // TEMPORARY DIAGNOSTIC (share-debug-3) - remove once the share flow is
    // confirmed working end to end. Only fires on native (Capacitor present).
    alert("share-debug-3: ShareReceiver plugin not found on window.Capacitor.Plugins");
  }

  const settingsBtn = document.getElementById("settingsBtn");
  if (settingsBtn) settingsBtn.addEventListener("click", openSettings);

  topbarTitle.textContent = loadTripSettings().title;
  showView("today");
})();
