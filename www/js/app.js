(function () {
  "use strict";

  const view = document.getElementById("view");
  const tabbar = document.getElementById("tabbar");
  const topbarTitle = document.getElementById("topbarTitle");
  const topbarSub = document.getElementById("topbarSub");

  const STORAGE_KEY = "scotland-trip-packing-v1";

  // Escapes for BOTH text content and attribute values, because it is used for
  // both - about sixty double-quoted attributes are built from place names,
  // and those names come from search results, the AI and shared links.
  //
  // This used to set .textContent and read .innerHTML back, which escapes
  // & < > and nothing else. In text that is fine. Inside "..." it is not: a
  // place called `Bar" onmouseover="…` closed the attribute and installed a
  // live event handler, on a page whose localStorage holds the API key. The
  // quote characters are the whole point, so they are escaped explicitly
  // rather than left to an element's serialiser.
  const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };

  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"'`]/g, (c) => ESCAPES[c]);
  }

  function cityColor(city) {
    return CITY_COLORS[city] || CITY_COLORS.Travel;
  }

  // Opening the exact place, not the road outside it.
  //
  // This was handing Google the full postal address OpenStreetMap gives back -
  // "B8079, Blair Atholl, Perth and Kinross, PH18 5TL" - because that is what
  // was stored when the place was saved. Google resolves an address to an
  // address: you get a point on a street, with no name, no hours and no
  // reviews, a few hundred metres from the castle you asked for.
  //
  // A name search resolves to the listing instead. Where the coordinates are
  // known, the search is centred on them - Google's own /@lat,lon,zoom form -
  // so it finds that Tesco rather than a Tesco, and lands on the building
  // rather than near it.
  function mapsUrlFor(query, point) {
    const q = String(query || "").trim();
    const at = point && point.lat != null && point.lon != null ? point : null;
    if (!q) return at ? `https://www.google.com/maps/search/?api=1&query=${at.lat},${at.lon}` : null;
    if (at) return `https://www.google.com/maps/search/${encodeURIComponent(q)}/@${at.lat},${at.lon},17z`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }

  // A place shared from Google Maps carries Google's own id for it, which we
  // turn into a "?cid=" link. That addresses the exact place, so prefer it
  // over a name search - the search can and does land on the wrong "Manchester".
  function pickGoogleUrl(p) {
    return p.googleUrl || mapsUrlFor(pickMapsQuery(p), p);
  }

  // Opens a link in an in-app Chrome Custom Tab when running natively. A
  // Custom Tab is real Chrome, so it reuses the browser's cookies - the
  // Google consent/sign-in already accepted there carries over, which a
  // plain embedded WebView (its own cookie jar) would not do.
  // Escaping does nothing to "javascript:alert(1)" - it contains no character
  // that esc() touches - so a website URL from OpenStreetMap (openly
  // editable) or from a language model could become script running inside the
  // app, next to the user's saved API keys. Only ordinary web links, phone
  // numbers and email addresses get through.
  function safeUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    // Protocol-relative and bare domains are treated as https rather than
    // dropped, since OSM data is full of "www.example.com".
    if (/^\/\//.test(raw)) return `https:${raw}`;
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(raw)) return `https://${raw}`;
    try {
      const u = new URL(raw);
      return ["http:", "https:", "mailto:", "tel:"].includes(u.protocol) ? u.href : "";
    } catch (e) {
      return "";
    }
  }

  async function openExternal(url) {
    const safe = safeUrl(url);
    if (!safe) return; // refuse anything that isn't an ordinary link
    url = safe;
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
    // With coordinates, the name on its own is the best query there is: the
    // search is centred on the exact spot, so there is nothing left to
    // disambiguate, and any locality added here could only pull it away.
    if (p.lat != null && p.lon != null) return p.name;
    // Without them, the name needs a place to sit in - the town, never the
    // street address, which is what made Maps show the street. Deliberately
    // never p.city either: that is the folder, pure organisation rather than
    // geography, and baking it into the search text can send Maps looking in
    // the wrong place entirely.
    const where = p.area || townFromAddress(p.address) || null;
    const named = [p.name, where].filter(Boolean).join(", ");
    return named || p.mapsQuery || scopedQuery(p.name);
  }

  // The town out of an address line, for places saved before the town was
  // stored alongside them. The line is built as "house road, area, town,
  // postcode", so the last part that is not a postcode is the town.
  function townFromAddress(address) {
    // The postcode is stripped out of each part rather than the part being
    // dropped: Google writes "12 Rose St, Manchester M1 1AA", so throwing away
    // everything containing a postcode throws away the town with it.
    const parts = String(address || "")
      .split(",")
      .map((s) => s.replace(POSTCODE_FULL, "").replace(/\s+/g, " ").trim())
      .filter((s) => s && !postcodeIn(s) && !/^united kingdom$/i.test(s));
    return parts.length > 1 ? parts[parts.length - 1] : null;
  }

  function findPlace(name) {
    return PLACES.find((p) => p.name === name) || EATS.find((e) => e.name === name);
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
      // True once the model was chosen from the picker. A deliberate choice
      // must survive testing, a 404, and anything else the app decides it
      // knows better about - overwriting it is what made the picker useless.
      geminiModelPinned: !!stored.geminiModelPinned,
      // Models discovered from the key, cached so the picker has something to
      // show without re-probing every time Settings opens.
      geminiModels: Array.isArray(stored.geminiModels) ? stored.geminiModels : [],
      // Free text about who is travelling, so AI suggestions are tailored
      // rather than generic ("family of 3, 4-year-old who walks, no stroller").
      travellers: stored.travellers !== undefined ? stored.travellers : TRIP.traveler || "",
      // Standing instructions added to every AI search, in the user's own
      // words ("avoid chains", "nothing needing a car", "vegetarian
      // options"). Applies to search, Explore and the day planner alike.
      preferences: stored.preferences !== undefined ? stored.preferences : "",
      // Per-category rewrites, keyed by category. Only what the user has
      // actually changed is stored; everything else uses the built-in
      // phrasing, so improvements to the defaults still reach them.
      catPrompts: stored.catPrompts && typeof stored.catPrompts === "object" ? stored.catPrompts : {},
    };
  }

  // Everything the user has told us about how they want results, in one
  // block that every prompt builder uses - so a preference set once applies
  // to searching, exploring and planning without being typed three times.
  function aiContextBlock() {
    const s = loadTripSettings();
    const lines = [];
    if (s.travellers.trim()) lines.push(`Travellers: ${s.travellers.trim()}`);
    if (s.preferences.trim()) lines.push(`What matters to us: ${s.preferences.trim()}`);
    return lines.length ? `\n${lines.join("\n")}` : "";
  }

  // A category's question, with the user's rewrite winning if there is one.
  function categoryPrompt(key) {
    const custom = loadTripSettings().catPrompts[key];
    if (custom && custom.trim()) return custom.trim();
    const cat = findCategory(key);
    return cat ? cat.prompt : String(key);
  }

  // Ready-made phrasings, so the box isn't a blank page. Tapping one adds or
  // removes that line rather than replacing what's already written.
  const PREFERENCE_PRESETS = [
    "Independent places, not chains",
    "Budget-friendly",
    "Somewhere a young child is welcome",
    "Good vegetarian options",
    "Short walks only, nothing steep",
    "Quiet over busy",
    "Say if booking ahead is needed",
    "Reachable without a car",
  ];

  function saveTripSettings(patch) {
    const next = Object.assign(loadTripSettings(), patch);
    localStorage.setItem(TRIP_KEY, JSON.stringify(next));
    return next;
  }

  // Appends the trip's region to a lookup so "Museum" finds the one you mean,
  // while staying empty-safe so a trip with no region set searches globally.
  function scopedQuery(text) {
    // The board's own destination wins - a board for Manchester shouldn't
    // inherit the Scotland trip's region.
    const board = activeBoard();
    const dest = (board.destination || loadTripSettings().destination || "").trim();
    if (!dest) return text;
    // A suggestion arrives already qualified - "Pitlochry, Perth and Kinross,
    // Scotland" - and appending the destination again produced "..., Scotland,
    // Scotland", which the geocoder answers with nothing at all. The town then
    // vanished from its own search results and only the AI's cafés remained.
    if (new RegExp(`(^|,\\s*)${dest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i").test(text.trim())) {
      return text;
    }
    return `${text}, ${dest}`;
  }

  // ---------- Gemini (optional, free tier) ----------
  // Long enough for a grounded answer on a slow connection, short enough that
  // a request which is never coming back says so rather than hanging.
  const AI_TIMEOUT_MS = 45000;
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
    if (status === 403 && /referer|referrer|API_KEY_HTTP_REFERRER|android|ios|blocked/i.test(msg + reason)) {
      // Deliberately does not suggest an Android app restriction. That kind
      // is enforced by the caller sending X-Android-Package and
      // X-Android-Cert headers, which Google's own SDKs add and a plain
      // fetch() from a WebView does not - so it refuses this app's requests
      // rather than protecting them.
      return `The key has application restrictions, and requests from this app can't satisfy them (403). This app calls Google directly from a web view, which sends no referrer and no Android signing headers, so any "Application restriction" will block it. Set Application restrictions to "None" and use "API restrictions" instead — limit the key to the Generative Language API.\n\n${msg}`;
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
    const settings = loadTripSettings();

    // Only choose automatically when the user hasn't. Testing used to
    // overwrite a picked model with the app's own guess, so selecting one and
    // then testing it silently reverted the selection.
    const pinned = settings.geminiModelPinned && names.indexOf(settings.geminiModel) >= 0;
    const chosen = pinned ? settings.geminiModel : chooseGeminiModel(models);
    saveTripSettings({ geminiModel: chosen, geminiModels: names });

    const shortName = chosen.replace(/^models\//, "");
    try {
      await callGemini(key, "Reply with the single word: ok");
    } catch (e) {
      return {
        ok: false,
        models: names,
        message:
          `Key is valid and ${models.length} models are visible, but ${shortName} failed.\n\n` +
          `${e.message || e}\n\nPick a different model below and test again.`,
      };
    }
    return {
      ok: true,
      models: names,
      message: `Working. Using ${shortName}${pinned ? " (your choice)" : " (auto-selected)"}. ${
        models.length
      } models available — pick a different one below if you prefer.`,
    };
  }

  // Scores a model so the newest sensible one wins. The previous version took
  // the first name containing "flash-lite" out of a 40-odd model list, which
  // matched the long-deprecated gemini-2.0-flash-lite-001 before ever reaching
  // 3.5 - so the automatic choice was a model Google had already retired.
  function scoreGeminiModel(name) {
    const n = name.replace(/^models\//, "");
    const version = parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || "0");
    let score = version * 100; // newer generation beats everything else

    if (/flash-lite/.test(n)) score += 40; // cheapest capable tier
    else if (/flash/.test(n)) score += 30;
    else if (/pro/.test(n)) score += 10;

    // Pinned dated builds ("-001") get retired while the rolling alias keeps
    // working, and experimental/preview names come and go.
    if (/-\d{3}$/.test(n)) score -= 25;
    if (/(exp|preview)/.test(n)) score -= 30;
    return score;
  }

  function chooseGeminiModel(models) {
    const names = models.map((m) => m.name);
    if (!names.length) return "";
    return names.slice().sort((a, b) => scoreGeminiModel(b) - scoreGeminiModel(a))[0];
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

  // The exact text last sent to the model, so the app can show its working.
  // A search you can't see the question behind is one you can't correct.
  let lastAiPrompt = "";

  async function callGemini(key, prompt, { grounded = false, json = false, maxTokens = 0 } = {}) {
    lastAiPrompt = prompt;
    const model = await resolveGeminiModel(key);
    // Discovered names already include the "models/" prefix.
    const path = model.indexOf("models/") === 0 ? model : `models/${model}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    };
    // A whole trip is a lot of JSON, and the default output cap cuts it off
    // mid-object - which arrives as a reply that cannot be parsed and reads,
    // from the outside, exactly like "it didn't work".
    if (maxTokens) body.generationConfig.maxOutputTokens = maxTokens;
    // Asking the API for JSON rather than asking the model nicely in the
    // prompt. Not combined with grounding: search results come back as prose
    // with citations, and the two settings fight.
    if (json) body.generationConfig.responseMimeType = "application/json";
    else if (grounded) body.tools = [{ google_search: {} }];

    // Nothing in this app had a timeout, and a request that never answers is
    // the worst failure it can have: the screen sits on "Working out some
    // routes…", which has nothing on it to press, and stays that way. A phone
    // that has wandered off signal mid-request does exactly this.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${GEMINI_BASE}/${path}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if (e && e.name === "AbortError") {
        throw new Error(
          `The AI didn't answer within ${Math.round(AI_TIMEOUT_MS / 1000)} seconds. That is usually signal rather than anything you did - worth trying again.`
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
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
      // Clear the cached model so the next call rediscovers - but never a
      // pinned one, or the user's choice silently reverts to the guess that
      // just failed, and they can never get out of it.
      if (res.status === 404 && !loadTripSettings().geminiModelPinned) {
        saveTripSettings({ geminiModel: "" });
      }
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
  async function searchWithGemini(query, key, guidance, anchor) {
    const s = loadTripSettings();
    const where = anchor
      ? ` within ${anchorMiles(anchor)} miles of ${anchor.name}${
          s.destination.trim() ? `, ${s.destination.trim()}` : ""
        }`
      : s.destination.trim()
      ? ` in ${s.destination.trim()}`
      : "";
    const who = aiContextBlock();
    // Whatever you added in your own words, passed through as written. The
    // categories and the query cover the usual asks; this is for the ones they
    // do not - "somewhere we can sit outside with a buggy", "not a chain".
    const extra = (guidance || "").trim() ? `\n\nAlso, specifically: ${guidance.trim()}` : "";

    // The postcode is the whole reason this got accurate. A name and a town
    // ("The Bakehouse, Newport") is ambiguous in a way the geocoder cannot
    // resolve; a name and a postcode is not ambiguous at all. Asked for here,
    // and used as the first lookup key below.
    const prompt =
      `Find up to 5 real, currently-open places matching this request${where}.` +
      `${who}\n\nRequest: ${query}${extra}\n\n` +
      (anchor
        ? `Every place must genuinely be within ${anchorMiles(anchor)} miles of ${anchor.name}. ` +
          `Do not include somewhere further away because it is well known - leave it out instead.\n\n`
        : "") +
      `Use search to check they exist and are still trading. Reply with ONLY a JSON array, ` +
      `each item: {"name": exact official name, "area": town or village it is in, ` +
      `"postcode": its postcode if you know it, otherwise "", ` +
      `"why": one short sentence on why it fits}. No other text.`;

    const { text, sources } = await callGemini(key, prompt, { grounded: true });
    const parsed = extractJson(text);
    if (!Array.isArray(parsed) || !parsed.length) throw new Error("gemini returned no usable places");

    // Names come back in one response; positions take a lookup each, against a
    // service that asks for about a request a second. Waiting for all of them
    // before showing anything meant a blank screen for two seconds while the
    // answer sat in memory, which is most of why this felt slow and broken.
    //
    // So the list is returned as soon as the model has spoken, and the
    // positions are filled in behind it - see placeSearchResults.
    return parsed
      .slice(0, 5)
      .filter((item) => item && item.name)
      .map((item) => ({
        name: String(item.name),
        area: item.area || "",
        postcode: postcodeIn(item.postcode) || "",
        displayName: "",
        lat: null,
        lon: null,
        description: item.why || "",
        aiSuggested: true,
        needsPlacing: true,
        sources,
      }));
  }

  // ---------- Boards ----------
  // A board is a collection of places. Give it dates and it behaves like a
  // trip - Today screen, day planner. Leave the dates off and it's simply a
  // list worth keeping: restaurants to try, days out near home. One concept
  // rather than two, so nothing has to be learned twice, and the app decides
  // what to show from whether the board has days.
  const BOARDS_KEY = "boards-v1";

  // Where the single-board version kept everything. Read once, during
  // migration, and then left alone - deleting it would make a downgrade lose
  // the lot, and it costs nothing to leave in place.
  const LEGACY = {
    picks: "scotland-trip-picks-v1",
    folders: "scotland-trip-folders-v1",
    plan: "trip-plan-v1",
  };

  function readJson(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function boardKey(id, part) {
    return `board:${id}:${part}`;
  }

  function loadBoards() {
    const state = readJson(BOARDS_KEY, null);
    if (state && Array.isArray(state.boards) && state.boards.length) return state;
    return migrateToBoards();
  }

  function saveBoards(state) {
    localStorage.setItem(BOARDS_KEY, JSON.stringify(state));
  }

  // Turns the old single-trip storage into the first board. Runs once. The
  // existing picks, folders and plan are carried across as-is rather than
  // rebuilt, because losing a curated list would be far worse than any
  // tidiness gained.
  function migrateToBoards() {
    const id = "b-scotland";
    const state = {
      activeId: id,
      boards: [
        {
          id,
          name: TRIP.title,
          destination: DEFAULT_DESTINATION,
          dated: true,
          // Only this board shows the bundled Edinburgh guide; new boards
          // start clean rather than pretending to be about Scotland.
          hasGuide: true,
          createdAt: Date.now(),
        },
      ],
    };

    const legacyPicks = readJson(LEGACY.picks, null);
    const legacyFolders = readJson(LEGACY.folders, null);
    const legacyPlan = readJson(LEGACY.plan, null);

    if (legacyPicks !== null) localStorage.setItem(boardKey(id, "picks"), JSON.stringify(legacyPicks));
    if (legacyFolders !== null) localStorage.setItem(boardKey(id, "folders"), JSON.stringify(legacyFolders));
    if (legacyPlan !== null) localStorage.setItem(boardKey(id, "plan"), JSON.stringify(legacyPlan));

    saveBoards(state);
    return state;
  }

  function activeBoard() {
    const state = loadBoards();
    return state.boards.find((b) => b.id === state.activeId) || state.boards[0];
  }

  function setActiveBoard(id) {
    const state = loadBoards();
    if (!state.boards.some((b) => b.id === id)) return;
    state.activeId = id;
    saveBoards(state);
  }

  function createBoard({ name, destination, dated }) {
    const state = loadBoards();
    const id = `b-${Date.now()}`;
    state.boards.push({
      id,
      name: (name || "Untitled").trim(),
      destination: (destination || "").trim(),
      dated: !!dated,
      hasGuide: false,
      createdAt: Date.now(),
    });
    state.activeId = id;
    saveBoards(state);
    return id;
  }

  function updateBoard(id, patch) {
    const state = loadBoards();
    const b = state.boards.find((x) => x.id === id);
    if (!b) return;
    Object.assign(b, patch);
    saveBoards(state);
  }

  function deleteBoard(id) {
    const state = loadBoards();
    if (state.boards.length <= 1) return false; // never leave the app with none
    state.boards = state.boards.filter((b) => b.id !== id);
    if (state.activeId === id) state.activeId = state.boards[0].id;
    saveBoards(state);
    ["picks", "folders", "plan", "budget", "packing", "notes"].forEach((part) =>
      localStorage.removeItem(boardKey(id, part))
    );
    return true;
  }

  // ---------- Picks (bookmarks + custom places) ----------

  const PICKS_KEY = "scotland-trip-picks-v1";

  // Picks, folders and the plan all belong to the board that's open, so
  // switching boards swaps the whole working set without anything leaking
  // between them.
  function loadPicks() {
    return readJson(boardKey(activeBoard().id, "picks"), []);
  }

  function savePicks(picks) {
    localStorage.setItem(boardKey(activeBoard().id, "picks"), JSON.stringify(picks));
  }

  // Folders are user-owned organisation, separate from geography - a pick's
  // folder should never be baked into its Google Maps search query, since a
  // rough nearest-city guess (or a folder the user deliberately renamed)
  // being injected into the search text can make Maps return the wrong place.
  const FOLDERS_KEY = "scotland-trip-folders-v1";

  function loadFolders() {
    const f = readJson(boardKey(activeBoard().id, "folders"), null);
    if (Array.isArray(f) && f.length) return f;
    // A brand-new board has no business defaulting to Scottish cities.
    return activeBoard().hasGuide ? ["Edinburgh", "Stirling", "Glasgow"] : ["Saved"];
  }

  function saveFolders(folders) {
    localStorage.setItem(boardKey(activeBoard().id, "folders"), JSON.stringify(folders));
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

  // Places you eat at want a different screen from places you visit: opening
  // hours matter more, "which meal" matters at all, and mixing forty cafés
  // into a list of castles makes both harder to read. Nothing asks the user
  // to file things by hand - the category that came with the place is enough
  // to guess, and the guess is overridable from the place's own sheet.
  const FOOD_HINTS =
    /restaurant|caf[eé]|coffee|bakery|patisserie|\bbar\b|\bpub\b|bistro|brasserie|deli\b|diner|eatery|food|pizz|takeaway|tea ?room|ice ?cream|gelat|chippy|fish and chips|fast[ _]food|breakfast|brunch|lunch|dinner|creperie|noodle|sushi|tapas|steak|grill|canteen|bagel|sandwich/i;

  function pickKind(p) {
    if (p.kind === "eat" || p.kind === "place") return p.kind; // user's own call wins
    if (p.source === "eats") return "eat";
    if (p.source === "places") return "place";
    const hay = [p.category, p.type, p.meal, p.description].filter(Boolean).join(" ");
    return FOOD_HINTS.test(hay) ? "eat" : "place";
  }

  // Major places are deliberately absent: Stirling is not one of the things to
  // do in Stirling, and listing it among the castles and the soft play is what
  // made a saved town feel like a mistake rather than a heading.
  function picksOfKind(kind) {
    return loadPicks().filter((p) => !p.major && pickKind(p) === kind);
  }

  // Costs are per place and entirely optional. A trip's real budget question
  // is "what have I already committed to", which only the saved places can
  // answer - a fixed table of estimates never could.
  function pickCost(p) {
    const n = Number(p.cost);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function money(n) {
    return `£${Number(n).toFixed(Number.isInteger(n) ? 0 : 2)}`;
  }

  // Costs that aren't a place: trains, the flat, the car. Per board, because
  // a weekend in Portsmouth shouldn't inherit Scotland's ferry.
  function loadBudgetExtras() {
    const rows = readJson(boardKey(activeBoard().id, "budget"), []);
    return Array.isArray(rows) ? rows : [];
  }

  function saveBudgetExtras(rows) {
    localStorage.setItem(boardKey(activeBoard().id, "budget"), JSON.stringify(rows));
  }

  // The packing list used to be one global list of fixed Scottish items with
  // only its ticks stored. It's now per board and fully editable - a
  // three-day city break and a week in the Highlands need different lists.
  function loadPacking() {
    const board = activeBoard();
    const stored = readJson(boardKey(board.id, "packing"), null);
    if (Array.isArray(stored)) return stored;
    if (!board.hasGuide) return [];
    // Seed the Scotland board from the bundled list, carrying over whatever
    // was already ticked under the old global key.
    const checked = readJson(STORAGE_KEY, {}) || {};
    const seeded = PACKING.map((text, i) => ({ text, done: !!checked[i] }));
    localStorage.setItem(boardKey(board.id, "packing"), JSON.stringify(seeded));
    return seeded;
  }

  function savePacking(items) {
    localStorage.setItem(boardKey(activeBoard().id, "packing"), JSON.stringify(items));
  }

  function loadBoardNotes() {
    return readJson(boardKey(activeBoard().id, "notes"), "") || "";
  }

  function saveBoardNotes(text) {
    localStorage.setItem(boardKey(activeBoard().id, "notes"), JSON.stringify(text));
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

  // ---------- Major places: somewhere you go *to*, not *in* ----------
  //
  // A town, a village, an island. Saving one alongside a café was always the
  // wrong shape: Stirling isn't a thing to do in Stirling, it's the thing the
  // day is built around. A major place heads its own section instead of
  // sitting in one, and it collects what you save near it - so the list reads
  // as places-within-areas rather than one flat run of names.
  //
  // The bundled CITY_COORDS anchors still work exactly as before; these are
  // the ones you add yourself, for the towns the app was never told about.
  const MAJOR_PLACE_KINDS =
    /^(city|town|village|hamlet|suburb|borough|municipality|locality|island|isle|administrative|county|region|province|state)$/i;

  // Nominatim reports these in `type`, Google in `category`, the suggestion
  // list in `kind` - all of them naming the same idea, so all three are read.
  function looksLikeMajorPlace(candidate) {
    if (!candidate) return false;
    return [candidate.type, candidate.category, candidate.kind]
      .filter(Boolean)
      .some((k) => MAJOR_PLACE_KINDS.test(String(k).trim()));
  }

  // Tighter than CITY_MATCH_KM. These anchors are chosen by hand and can sit
  // close together, so the radius has to be small enough that the nearest one
  // wins for an obvious reason rather than by a few hundred metres.
  const MAJOR_MATCH_KM = 25;

  function nearestMajorPlace(lat, lon) {
    if (lat == null || lon == null) return null;
    let best = null;
    let bestDist = Infinity;
    loadPicks().forEach((p) => {
      if (!p.major || p.lat == null) return;
      const d = haversineKm(lat, lon, p.lat, p.lon);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    });
    return best && bestDist <= MAJOR_MATCH_KM ? best.name : null;
  }

  // Where a newly saved place belongs: a major place you added yourself first,
  // then the bundled city anchors. Yours wins because you chose it - the
  // built-in list only knows Edinburgh, Glasgow and Stirling.
  function suggestedFolderFor(lat, lon) {
    return nearestMajorPlace(lat, lon) || nearestCity(lat, lon);
  }

  // ---------- Is the answer obvious enough not to ask? ----------
  // Filing used to happen silently and was often wrong, so it was made a
  // question - asked on every save, including the great majority where the
  // answer was never in doubt. That traded one bad habit for another.
  //
  // The guess itself is what has changed since. It was nearestCity() over
  // three hardcoded anchors with a 40km reach, which swept most of the central
  // belt into Edinburgh. Now there are areas you added by hand, matched within
  // a few miles. So: act when there is one obvious answer, ask when there
  // genuinely is a choice - the same rule the geocoder follows.
  const AUTO_FILE_KM = 8;
  // A second area this much further away is not a rival for the first.
  const AUTO_FILE_MARGIN = 2.5;

  function confidentFolderFor(lat, lon) {
    const folders = loadFolders().filter((f) => f !== "Unsorted");

    // Nothing to choose between: one folder, or none at all.
    if (!folders.length) return "Unsorted";

    if (lat != null && lon != null) {
      const areas = loadPicks()
        .filter((p) => p.major && p.lat != null)
        .map((p) => ({ name: p.name, km: haversineKm(lat, lon, p.lat, p.lon) }))
        .sort((a, b) => a.km - b.km);

      if (areas.length) {
        const [nearest, next] = areas;
        const clearlyInside = nearest.km <= AUTO_FILE_KM;
        const noRival = !next || next.km > nearest.km * AUTO_FILE_MARGIN;
        if (clearlyInside && noRival) return nearest.name;
        // Inside one area but another is nearly as close: that is a real
        // choice, and it is yours.
        return null;
      }
    }

    // No areas yet. One folder and nowhere else to put it is not a question.
    if (folders.length === 1) return folders[0];
    return null;
  }

  // What an area *could* collect: saved, unfiled, and close by. Anything you
  // have already put in a folder is never a candidate - that was your call.
  //
  // This only ever reports. Moving places is a separate, explicit step, so
  // marking somewhere as an area can never quietly rearrange the list behind
  // it.
  function nearbyUnfiled(majorPick) {
    if (!majorPick || majorPick.lat == null) return [];
    return loadPicks().filter(
      (other) =>
        other.id !== majorPick.id &&
        !other.major &&
        !isFiled(other) &&
        other.lat != null &&
        haversineKm(other.lat, other.lon, majorPick.lat, majorPick.lon) <= MAJOR_MATCH_KM
    );
  }

  // Unsorted is where undecided places live, so it counts as unfiled.
  function isFiled(p) {
    return !!p.city && p.city !== "Unsorted";
  }

  function fileUnder(ids, folder) {
    const picks = loadPicks();
    picks.forEach((p) => {
      if (ids.includes(p.id)) p.city = folder;
    });
    savePicks(picks);
  }

  // Promotion moves exactly one place: the one you promoted. Whether anything
  // else joins it is asked separately, by the caller.
  function setPickMajor(id, on) {
    const picks = loadPicks();
    const p = picks.find((x) => x.id === id);
    if (!p) return;
    p.major = !!on;
    if (on) {
      // Its own section has to exist before anything can be filed into it,
      // and the place itself belongs at the head of that section.
      addFolder(p.name);
      p.city = p.name;
    }
    // Demoting leaves the folder and its contents alone - the places under it
    // are still together, which is what the folder was for.
    savePicks(picks);
  }

  // The offer that used to happen by itself. Nothing moves unless this is
  // tapped, and it says exactly how many places it would move.
  function offerToCollectNearby(majorPick) {
    const nearby = nearbyUnfiled(majorPick);
    if (!nearby.length) {
      toast(`${majorPick.name} is now an area`);
      return;
    }
    toastWithAction(
      `${majorPick.name} is now an area — ${nearby.length} unsorted place${nearby.length === 1 ? "" : "s"} nearby`,
      `File ${nearby.length === 1 ? "it" : "them"} here`,
      () => {
        fileUnder(nearby.map((p) => p.id), majorPick.name);
        renderPicks();
        toast(`Moved ${nearby.length} to ${majorPick.name}`);
      }
    );
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
      const candidates = (await geocodeCandidates(pick.name, pick.city, loadAnchor())).filter((c) =>
        withinAnchor(loadAnchor(), c.lat, c.lon, ANCHOR_GRACE)
      );
      const geo = candidates.length ? candidates[0] : null;
      picks = loadPicks();
      const fresh = picks.find((p) => p.id === id);
      if (!fresh || fresh.lat != null || !geo) return;
      fresh.lat = geo.lat;
      fresh.lon = geo.lon;
      noteLocationDoubt(fresh, candidates);
      // Deliberately does not file it now that coordinates have arrived. A
      // place quietly moving into a folder some seconds after it was saved is
      // the worst version of a wrong guess: nobody sees it happen.
      savePicks(picks);
      if (view.dataset.activeTab === "picks") renderPicks();
    } catch (e) {
      // best-effort - the pick just won't get a mini-map/nearby search
    }
  }

  function removePick(id) {
    savePicks(loadPicks().filter((p) => p.id !== id));
  }

  // Deleting a place used to be the one action with no way back: no warning,
  // no confirmation, and a toast that only said it had happened. Deleting a
  // whole board asks first, so the small destructive action was the
  // unrecoverable one and the large one was safe - exactly backwards.
  //
  // A confirm dialog would be the obvious fix and the wrong one: it interrupts
  // every deletion, including the ninety-nine correct ones, to guard against
  // the hundredth. Restoring the place is the better answer, since everything
  // about it is already in hand.
  function removePickWithUndo(id, after) {
    const picks = loadPicks();
    const index = picks.findIndex((p) => p.id === id);
    if (index < 0) return;
    const removed = picks[index];
    removePick(id);
    if (after) after();
    toastWithAction(`Removed ${removed.name}`, "Undo", () => {
      const now = loadPicks();
      if (now.some((p) => p.id === removed.id)) return; // saved again in the meantime
      // Back where it was, not appended to the end - a place reappearing
      // somewhere else in the list reads as a second mistake.
      now.splice(Math.min(index, now.length), 0, removed);
      savePicks(now);
      if (after) after();
      toast(`${removed.name} is back`);
    });
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
  // Two places can share a name, and the app used to ask for exactly one
  // answer (limit=1) and take it. That is not a lookup, it is a guess with the
  // evidence thrown away: there was no way to know whether the geocoder had
  // been certain or had picked one of four. Wrong coordinates then spread -
  // the map pin, the distance, the weather for the day, and which area the
  // place gets filed under all read from them.
  //
  // It now asks for several and keeps them. Callers that a person is waiting
  // on can offer the choice; background ones record that the choice was never
  // made rather than pretending it was.
  const AMBIGUOUS_MIN_KM = 25;
  const GEOCODE_LIMIT = 5;

  async function geocodeCandidates(name, cityHint, anchor) {
    const queries = [];
    if (cityHint) queries.push(`${name}, ${cityHint}`);
    queries.push(scopedQuery(name));
    queries.push(name);

    // Every attempt is a request to a service that asks for about one a
    // second, so the number of them is the speed of the whole feature. This
    // was six per name - three queries, each tried bounded and then unbounded
    // - which for five results is thirty requests before anything appears.
    //
    // The unbounded half was pure waste when anchored: every caller refuses a
    // coordinate outside the area anyway, so the answers it went to fetch were
    // thrown away on arrival. Bounded only, with the box widened by the same
    // grace the refusal uses, and the redundant region-scoped query dropped
    // when there is already a hint to go on.
    const box = anchor ? `&bounded=1&viewbox=${encodeURIComponent(anchorViewbox(anchor, ANCHOR_GRACE))}` : "";
    const attempts = (anchor ? (cityHint ? [queries[0], queries[2]] : [queries[2]]) : queries).map((q) => ({ q, box }));

    for (const attempt of attempts) {
      const url =
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=${GEOCODE_LIMIT}` +
        `&addressdetails=1&extratags=1&namedetails=1&q=${encodeURIComponent(attempt.q)}${attempt.box}`;
      let data;
      try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) continue;
        data = await res.json();
      } catch (e) {
        continue;
      }
      if (data && data.length) {
        const places = data.map((r) => {
          const place = placeFromNominatim(r);
          place.displayName = r.display_name || "";
          place.label = (r.namedetails && r.namedetails.name) || String(r.display_name || "").split(",")[0];
          return place;
        });
        // The first answer was taken as the right one, which is how a search
        // near Pitlochry ended up pinned to a same-named place in Cornwall.
        // Nearest to where you are looking wins instead.
        if (anchor) {
          places.sort(
            (a, b) =>
              haversineKm(anchor.lat, anchor.lon, a.lat, a.lon) - haversineKm(anchor.lat, anchor.lon, b.lat, b.lon)
          );
        }
        return places;
      }
    }
    return [];
  }

  // Only counts as ambiguous when the alternatives are somewhere else, not
  // when the same place appears twice. A pub and its beer garden fifty metres
  // apart are not a question worth asking.
  function realAlternatives(candidates) {
    if (!candidates || candidates.length < 2) return [];
    const first = candidates[0];
    const far = candidates
      .slice(1)
      .filter((c) => haversineKm(first.lat, first.lon, c.lat, c.lon) > AMBIGUOUS_MIN_KM);
    // Deduplicated by where they are, so five results in three towns offer
    // three answers.
    const seen = [];
    return far.filter((c) => {
      if (seen.some((s) => haversineKm(s.lat, s.lon, c.lat, c.lon) <= AMBIGUOUS_MIN_KM)) return false;
      seen.push(c);
      return true;
    });
  }

  // The question, asked plainly, when someone is waiting for the answer.
  // Each option is named by its full address, because "Manchester" twice is
  // not a choice - "Manchester, Greater Manchester" against "Manchester,
  // Jamaica" is.
  function openLocationChooser(opts) {
    const list = opts.candidates
      .map(
        (c, i) => `
        <button class="search-result location-option" data-pick-location="${i}">
          <div class="search-result-main">
            <div class="place-name">${esc(c.label || opts.query)}</div>
            <div class="place-notes">${esc(c.displayName || "")}</div>
          </div>
        </button>`
      )
      .join("");

    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="Which one did you mean?">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">✕</button>
          <div class="modal-body">
            <h2 class="modal-title">Which "${esc(opts.query)}"?</h2>
            <div class="modal-subtitle">${esc(
              opts.subtitle || "More than one place goes by that name, and they are nowhere near each other."
            )}</div>
            <div class="search-results" style="margin-top:12px;">${list}</div>
          </div>
        </div>
      </div>
    `;
    placeModal.classList.add("open");

    let chosen = false;
    placeModal.querySelectorAll("[data-close]").forEach((el) =>
      el.addEventListener("click", (e) => {
        if (e.target !== el) return;
        closePlaceModal();
        if (!chosen && opts.onDismiss) opts.onDismiss();
      })
    );
    placeModal.querySelectorAll("[data-pick-location]").forEach((btn) =>
      btn.addEventListener("click", () => {
        chosen = true;
        closePlaceModal();
        opts.onPick(opts.candidates[Number(btn.getAttribute("data-pick-location"))]);
      })
    );
  }

  // What a background lookup records instead of interrupting. The place is
  // saved with the geocoder's best answer, and the fact that there was a
  // choice is kept with it so the list can say so and the sheet can settle it
  // later.
  function noteLocationDoubt(pick, candidates) {
    const alts = realAlternatives(candidates);
    if (!alts.length) {
      delete pick.geoAlternatives;
      return;
    }
    pick.geoAlternatives = [candidates[0]].concat(alts).map((c) => ({
      lat: c.lat,
      lon: c.lon,
      label: c.label || pick.name,
      displayName: c.displayName || "",
      address: c.address || "",
    }));
  }

  async function geocodePlace(name, cityHint, anchor) {
    const candidates = await geocodeCandidates(name, cityHint, anchor);
    return candidates.length ? candidates[0] : null;
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
      // Kept on its own as well as inside the address line: it is what a Maps
      // search needs next to the name, and picking it back out of the joined
      // string afterwards is guesswork.
      town: addr.city || addr.town || addr.village || addr.hamlet || addr.suburb || null,
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

    const [candidates, wiki] = await Promise.all([
      geocodeCandidates(pick.name, pick.city, loadAnchor())
        .then((list) => list.filter((c) => withinAnchor(loadAnchor(), c.lat, c.lon, ANCHOR_GRACE)))
        .catch(() => []),
      wikiEnrich(pick.name).catch(() => null),
    ]);
    const geo = candidates.length ? candidates[0] : null;

    picks = loadPicks();
    const fresh = picks.find((p) => p.id === id);
    if (!fresh) return; // removed while enriching
    if (geo) {
      fresh.lat = geo.lat;
      fresh.lon = geo.lon;
      if (!fresh.area && geo.town) fresh.area = geo.town;
      // Nobody is watching this happen, so the doubt is recorded rather than
      // raised - and never resolved by filing the place somewhere on the
      // strength of coordinates that might belong to a different town.
      noteLocationDoubt(fresh, candidates);
      if (!fresh.website && geo.website) fresh.website = geo.website;
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
    const mapsUrl = pickGoogleUrl(p);
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
                  ? `<a class="modal-btn" href="${esc(safeUrl(p.website))}" target="_blank" rel="noopener">🌐 Official website</a>`
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

  // ---------- Connection ----------
  // Every feature that needs the network failed in its own words - search said
  // "check your connection", Explore reported an AI error, weather just showed
  // yesterday's numbers with no sign they were old. In a glen with no signal
  // that is three different puzzles instead of one fact. This says the fact
  // once, at the top, and gets out of the way when it stops being true.
  const appBanner = document.getElementById("appBanner");

  function isOffline() {
    return typeof navigator.onLine === "boolean" && !navigator.onLine;
  }

  function refreshBanner() {
    if (!appBanner) return;
    if (isOffline()) {
      appBanner.className = "app-banner offline";
      appBanner.innerHTML =
        `<span>📵 No connection — your places, plan and notes all still work. Search, weather and maps need signal.</span>`;
      appBanner.hidden = false;
      return;
    }
    if (backupIsOverdue()) {
      appBanner.className = "app-banner nudge";
      appBanner.innerHTML =
        `<span>${esc(backupAgeLine())} Everything is only on this phone.</span>` +
        `<button class="app-banner-action" id="bannerBackup">Back up</button>`;
      appBanner.hidden = false;
      const btn = document.getElementById("bannerBackup");
      if (btn) {
        btn.addEventListener("click", async () => {
          const res = await exportBackup();
          toast(res.message);
          refreshBanner();
        });
      }
      return;
    }
    appBanner.hidden = true;
    appBanner.innerHTML = "";
  }

  window.addEventListener("online", refreshBanner);
  window.addEventListener("offline", refreshBanner);

  // ---------- Backup ----------
  // Everything lives in this device's localStorage, which an uninstall, a
  // "clear data", or a lost phone erases with no recovery. This writes the
  // whole trip out as one file that can be saved, sent to someone else, or
  // restored later.
  // A function, not a constant: PLAN_KEY is declared further down the file,
  // so reading it while this module is still evaluating would hit the
  // temporal dead zone and throw before the app ever renders.
  function backupKeys() {
    // Every board's data, not just the open one - a backup that quietly
    // dropped the boards you weren't looking at would be worse than none.
    // The legacy single-trip keys ride along so a backup taken now still
    // restores onto an older build.
    // The weather cache is deliberately not in here: it's derived data with a
    // shelf life of hours, and restoring last week's forecast onto a new
    // phone would be worse than fetching it again.
    const keys = [BOARDS_KEY, TRIP_KEY, STORAGE_KEY, RECENT_KEY, LEGACY.picks, LEGACY.folders, LEGACY.plan];
    loadBoards().boards.forEach((b) => {
      keys.push(
        boardKey(b.id, "picks"),
        boardKey(b.id, "folders"),
        boardKey(b.id, "plan"),
        boardKey(b.id, "budget"),
        boardKey(b.id, "packing"),
        boardKey(b.id, "notes")
      );
    });
    return keys;
  }

  // The export exists to be moved around - saved to Drive, emailed to a
  // partner's phone. That makes it the wrong place for API keys, which were
  // going in with everything else: one forwarded file and someone else is
  // spending your Gemini quota. Settings travel, credentials don't.
  function redactSecrets(rawSettings) {
    try {
      const s = JSON.parse(rawSettings);
      delete s.geminiKey;
      delete s.googleKey;
      return JSON.stringify(s);
    } catch (e) {
      return rawSettings;
    }
  }

  function buildBackup() {
    const data = {};
    backupKeys().forEach((k) => {
      const v = localStorage.getItem(k);
      if (v === null) return;
      data[k] = k === TRIP_KEY ? redactSecrets(v) : v;
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

  // Everything lives in this phone's localStorage, which Android will clear
  // under storage pressure and a reinstall wipes outright. The export has
  // always existed; what was missing was any reason to remember it exists.
  const LAST_BACKUP_KEY = "last-backup-at-v1";
  const BACKUP_STALE_MS = 7 * 24 * 60 * 60 * 1000;

  function lastBackupAt() {
    const v = readJson(LAST_BACKUP_KEY, null);
    return typeof v === "number" ? v : null;
  }

  function backupAgeLine() {
    const at = lastBackupAt();
    if (!at) return "Never backed up.";
    const days = Math.floor((Date.now() - at) / (24 * 60 * 60 * 1000));
    if (days <= 0) return "Backed up today.";
    if (days === 1) return "Backed up yesterday.";
    return `Backed up ${days} days ago.`;
  }

  // Nags only when there is something to lose and it has been a while - a
  // prompt on an empty board would be teaching you to dismiss it.
  function backupIsOverdue() {
    if (loadPicks().length < 3) return false;
    const at = lastBackupAt();
    return !at || Date.now() - at > BACKUP_STALE_MS;
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
      localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify(Date.now()));
      return { ok: true, message: `Saved ${backupFilename()} to your downloads.` };
    } catch (e) {
      return { ok: false, message: `Couldn't save the file: ${e.message || e}` };
    }
  }

  function countBackup(parsed) {
    try {
      let boards = 0;
      let picks = 0;
      let planned = 0;
      Object.keys(parsed.data).forEach((k) => {
        if (/^board:.*:picks$/.test(k)) picks += JSON.parse(parsed.data[k] || "[]").length;
        if (/^board:.*:plan$/.test(k)) {
          const plan = JSON.parse(parsed.data[k] || "{}");
          planned += Object.values(plan.items || {}).reduce((n, list) => n + list.length, 0);
        }
      });
      const state = parsed.data[BOARDS_KEY] ? JSON.parse(parsed.data[BOARDS_KEY]) : null;
      boards = state && Array.isArray(state.boards) ? state.boards.length : 0;

      // A backup from before boards existed still restores; describe it in
      // the terms it was written in.
      if (!boards && parsed.data[LEGACY.picks]) {
        picks = JSON.parse(parsed.data[LEGACY.picks] || "[]").length;
        return `${picks} places (from an earlier version)`;
      }
      return `${boards} board${boards === 1 ? "" : "s"}, ${picks} places, ${planned} planned items`;
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
    // Restore every key in the file rather than only the ones this device
    // currently has - otherwise boards present in the backup but not here
    // would be silently dropped, which is exactly what a restore must not do.
    // Backups carry no keys, so a restore must not blank the one already
    // entered here - otherwise restoring quietly turns the AI search off.
    const localSettings = (() => {
      try {
        return JSON.parse(localStorage.getItem(TRIP_KEY)) || {};
      } catch (e) {
        return {};
      }
    })();

    Object.keys(parsed.data).forEach((k) => {
      if (k === BOARDS_KEY || k === TRIP_KEY || k === STORAGE_KEY || /^board:/.test(k) || /^scotland-trip-|^trip-plan-/.test(k)) {
        if (k === TRIP_KEY) {
          try {
            const restored = JSON.parse(parsed.data[k]) || {};
            if (localSettings.geminiKey) restored.geminiKey = localSettings.geminiKey;
            if (localSettings.googleKey) restored.googleKey = localSettings.googleKey;
            localStorage.setItem(k, JSON.stringify(restored));
            return;
          } catch (e) {
            /* fall through to a plain restore */
          }
        }
        localStorage.setItem(k, parsed.data[k]);
      }
    });
    return { ok: true, message: `Restored ${countBackup(parsed)}.` };
  }

  function selectedGeminiModel() {
    const sel = document.getElementById("setGeminiModel");
    if (!sel || sel.disabled) return "";
    const v = sel.value || "";
    return v.indexOf("models/") === 0 ? v : "";
  }

  // Tapping the title switches board. Putting it on the title rather than
  // behind another tab keeps the current board always visible and its
  // siblings always one tap away.
  function openBoardSwitcher() {
    const state = loadBoards();
    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="Switch board">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">✕</button>
          <div class="modal-body">
            <h2 class="modal-title">Your boards</h2>
            <p class="settings-hint">A board with dates works like a trip. Without them it's just a list of places worth keeping.</p>

            <div class="board-list">
              ${state.boards
                .map((b) => {
                  const picks = readJson(boardKey(b.id, "picks"), []).length;
                  return `
                    <button class="board-row${b.id === state.activeId ? " active" : ""}" data-open-board="${esc(b.id)}">
                      <div class="board-row-main">
                        <div class="board-row-name">${esc(b.name)}</div>
                        <div class="board-row-meta">${b.dated ? "Trip" : "List"}${
                          b.destination ? ` · ${esc(b.destination)}` : ""
                        } · ${picks} place${picks === 1 ? "" : "s"}</div>
                      </div>
                      ${b.id === state.activeId ? `<span class="board-row-tick">✓</span>` : ""}
                    </button>
                  `;
                })
                .join("")}
            </div>

            <div class="settings-divider"></div>
            <label class="settings-label" for="newBoardName">New board</label>
            <input class="settings-input" type="text" id="newBoardName" placeholder="e.g. Lake District, or Places to try" />
            <input class="settings-input" type="text" id="newBoardDest" placeholder="Area to search in (optional)" style="margin-top:8px;" />
            <label class="board-dated-row">
              <input type="checkbox" id="newBoardDated" checked />
              <span>Plan it by day (a trip rather than a list)</span>
            </label>
            <button class="modal-btn modal-btn-primary" id="createBoardBtn" style="width:100%;margin-top:12px;">Create board</button>

            ${
              state.boards.length > 1
                ? `<button class="modal-btn danger" id="deleteBoardBtn" style="width:100%;margin-top:16px;">Delete "${esc(
                    activeBoard().name
                  )}" and its places</button>`
                : ""
            }
          </div>
        </div>
      </div>
    `;
    placeModal.classList.add("open");

    placeModal.querySelectorAll("[data-close]").forEach((el) =>
      el.addEventListener("click", (e) => {
        if (e.target === el) closePlaceModal();
      })
    );

    placeModal.querySelectorAll("[data-open-board]").forEach((btn) =>
      btn.addEventListener("click", () => {
        setActiveBoard(btn.getAttribute("data-open-board"));
        closePlaceModal();
        refreshForBoard();
      })
    );

    document.getElementById("createBoardBtn").addEventListener("click", () => {
      const name = document.getElementById("newBoardName").value.trim();
      if (!name) return;
      createBoard({
        name,
        destination: document.getElementById("newBoardDest").value,
        dated: document.getElementById("newBoardDated").checked,
      });
      closePlaceModal();
      refreshForBoard();
      toast(`Created “${name}”`);
    });

    const del = document.getElementById("deleteBoardBtn");
    if (del) {
      del.addEventListener("click", () => {
        const b = activeBoard();
        // The one action that really cannot be undone - a board takes its
        // places, plan, budget and packing list with it - so this is the one
        // place a confirmation earns its interruption. It is the app's own
        // sheet rather than a system confirm(), and it names what is at stake
        // rather than asking "are you sure".
        confirmDestructive({
          title: `Delete "${b.name}"?`,
          detail: boardDeletionSummary(b),
          confirmLabel: "Delete it",
          onConfirm: () => {
            deleteBoard(b.id);
            closePlaceModal();
            refreshForBoard();
            toast(`Deleted “${b.name}”`);
          },
        });
      });
    }
  }

  // Counts what would go, so the warning is about this board rather than
  // boards in general. "Everything saved in it" is easy to agree to; "9 places
  // and a 7-day plan" is not.
  function boardDeletionSummary(board) {
    const key = (part) => readJson(boardKey(board.id, part), null);
    const picks = key("picks") || [];
    const plan = key("plan") || {};
    const days = (plan.days || []).length;
    const bits = [];
    if (picks.length) bits.push(`${picks.length} saved place${picks.length === 1 ? "" : "s"}`);
    if (days) bits.push(`a ${days}-day plan`);
    const packing = (key("packing") || []).length;
    if (packing) bits.push(`a packing list of ${packing}`);
    if (!bits.length) return "Nothing is saved in it yet.";
    return `This also deletes ${bits.join(", ")}. It can't be undone.`;
  }

  // One sheet for "this cannot be undone", so destructive confirmation looks
  // the same everywhere and never falls back to a system dialog.
  function confirmDestructive(opts) {
    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="${esc(opts.title)}">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">✕</button>
          <div class="modal-body">
            <h2 class="modal-title">${esc(opts.title)}</h2>
            <p class="place-notes" style="margin-top:10px;">${esc(opts.detail)}</p>
            <div class="settings-btn-row" style="margin-top:16px;">
              <button class="modal-btn" id="confirmCancel">Keep it</button>
              <button class="modal-btn danger" id="confirmGo">${esc(opts.confirmLabel)}</button>
            </div>
          </div>
        </div>
      </div>
    `;
    placeModal.classList.add("open");

    placeModal.querySelectorAll("[data-close]").forEach((el) =>
      el.addEventListener("click", (e) => {
        if (e.target === el) closePlaceModal();
      })
    );
    // Cancel is listed first and styled plainly; the destructive one is not
    // the default and not the easiest thing to hit.
    document.getElementById("confirmCancel").addEventListener("click", closePlaceModal);
    document.getElementById("confirmGo").addEventListener("click", () => {
      closePlaceModal();
      opts.onConfirm();
    });
  }

  function refreshForBoard() {
    const board = activeBoard();
    topbarTitle.textContent = board.name;
    showView(firstVisibleTab());
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
            <p class="settings-hint">
              Keeping it safe: leave <b>Application restrictions</b> set to None — this
              app calls Google directly, so any referrer or Android restriction blocks
              it rather than protecting it. Set <b>API restrictions</b> to the
              Generative Language API only, so a copied key can't reach anything else.
              Without a billing card the worst case is a used-up free quota, not a bill.
            </p>

            <button class="modal-btn" id="testGeminiBtn" style="margin-top:10px;">Test key & find models</button>
            <pre class="settings-result" id="geminiTestResult" hidden></pre>

            <div id="geminiModelWrap">
              <label class="settings-label" for="setGeminiModel">Model</label>
              <select class="settings-input" id="setGeminiModel" ${s.geminiModels.length ? "" : "disabled"}>
                ${
                  s.geminiModels.length
                    ? s.geminiModels
                        .map(
                          (m) =>
                            `<option value="${esc(m)}"${m === s.geminiModel ? " selected" : ""}>${esc(
                              m.replace(/^models\//, "")
                            )}</option>`
                        )
                        .join("")
                    : `<option>Tap "Test key & find models" to load the list</option>`
                }
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

            <label class="settings-label" for="setPreferences">What matters to you</label>
            <textarea class="settings-input notes-box" id="setPreferences" rows="3"
              placeholder="In your own words — e.g. independent places, nothing needing a car, somewhere we can be in and out in half an hour">${esc(
                s.preferences
              )}</textarea>
            <div class="pref-chips">
              ${PREFERENCE_PRESETS.map(
                (t) =>
                  `<button type="button" class="pref-chip${
                    s.preferences.includes(t) ? " on" : ""
                  }" data-pref-preset="${esc(t)}">${esc(t)}</button>`
              ).join("")}
            </div>
            <p class="settings-hint">
              Added to every AI search, in Explore and when planning days. Tap a suggestion
              to add or remove it, or just write your own. The app still handles the
              formatting rules itself, so nothing here can break a search.
            </p>

            <div class="settings-divider"></div>
            <label class="settings-label">Offline maps</label>
            <p class="settings-hint">
              Maps are the one part of the app that needs signal. This fetches the area
              around your saved places so they still draw in a glen with no bars.
              Everything else — your places, the plan, notes, the forecast already
              fetched — works offline regardless.
            </p>
            <p class="settings-hint" id="tileCount">Checking what's stored…</p>
            <div class="settings-btn-row">
              <button class="modal-btn modal-btn-primary" id="downloadTilesBtn">⬇ Download map area</button>
              <button class="modal-btn" id="clearTilesBtn">Clear</button>
            </div>
            <pre class="settings-result" id="tileResult" hidden></pre>

            <div class="settings-divider"></div>

            <label class="settings-label">Backup</label>
            <p class="settings-hint">
              Everything is stored only on this phone. Export a copy you can keep or send
              to another device — a reinstall or a lost phone loses the lot otherwise.
              API keys are deliberately left out of the file, so it's safe to send;
              you'll enter the key again on the other device.
            </p>
            <p class="settings-hint${backupIsOverdue() ? " backup-overdue" : ""}"><b>${esc(backupAgeLine())}</b></p>
            <div class="settings-btn-row">
              <button class="modal-btn${backupIsOverdue() ? " modal-btn-primary" : ""}" id="exportBackupBtn">⬇ Export</button>
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

    const tileCountEl = document.getElementById("tileCount");
    const tileResult = document.getElementById("tileResult");
    const showTileCount = async () => {
      const n = await countTiles();
      if (!tileCountEl) return;
      tileCountEl.textContent = n
        ? `${n.toLocaleString("en-GB")} map tiles stored on this phone.`
        : "No map area stored yet — maps will need signal.";
    };
    showTileCount();

    const dlBtn = document.getElementById("downloadTilesBtn");
    if (dlBtn) {
      dlBtn.addEventListener("click", async () => {
        if (tileDownload.running) {
          // The same button stops it: a download you cannot stop on a hotel
          // connection is its own problem.
          tileDownload.cancelled = true;
          dlBtn.textContent = "Stopping…";
          return;
        }
        tileDownload.running = true;
        tileDownload.cancelled = false;
        dlBtn.textContent = "Stop";
        if (tileResult) {
          tileResult.hidden = false;
          tileResult.textContent = "Starting…";
        }
        const res = await downloadTiles((done, total) => {
          if (tileResult) tileResult.textContent = `${done} of ${total}…`;
        });
        tileDownload.running = false;
        dlBtn.textContent = "⬇ Download map area";
        if (tileResult) tileResult.textContent = res.message;
        showTileCount();
      });
    }

    const clearBtn = document.getElementById("clearTilesBtn");
    if (clearBtn) {
      clearBtn.addEventListener("click", async () => {
        await clearTiles();
        if (tileResult) {
          tileResult.hidden = false;
          tileResult.textContent = "Stored map area cleared.";
        }
        showTileCount();
      });
    }

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
      // Don't blank the model here: if the user picked one, testing it is
      // exactly the point. A changed key is handled by the pinned name simply
      // not being in the new list, which falls back to auto-selection.
      saveTripSettings({ geminiKey: key });
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
        sel.disabled = false;
        wrap.hidden = false;
      }
    });

    // Presets edit the box rather than replacing it, so tapping one never
    // discards something already typed.
    placeModal.querySelectorAll("[data-pref-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const phrase = btn.getAttribute("data-pref-preset");
        const box = document.getElementById("setPreferences");
        const lines = box.value
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        const at = lines.indexOf(phrase);
        if (at >= 0) lines.splice(at, 1);
        else lines.push(phrase);
        box.value = lines.join("\n");
        btn.classList.toggle("on", at < 0);
      });
    });

    // Changing the model takes effect immediately - waiting for Save would
    // mean the next search silently used the old one.
    const modelSel = document.getElementById("setGeminiModel");
    if (modelSel) {
      modelSel.addEventListener("change", () => {
        saveTripSettings({ geminiModel: modelSel.value, geminiModelPinned: true });
        toast(`Using ${modelSel.value.replace(/^models\//, "")}`);
      });
    }

    document.getElementById("saveSettings").addEventListener("click", () => {
      saveTripSettings({
        destination: document.getElementById("setDestination").value,
        googleKey: document.getElementById("setGoogleKey").value.trim(),
        geminiKey: document.getElementById("setGeminiKey").value.trim(),
        // Only a real model name, never the "tap the button" placeholder the
        // disabled picker shows before it's been populated.
        geminiModel: selectedGeminiModel() || loadTripSettings().geminiModel,
        travellers: document.getElementById("setTravellers").value,
        preferences: document.getElementById("setPreferences").value.trim(),
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

    // An area is its own section, so there has never been a folder question
    // to ask about one.
    if (options.major) {
      confirmAddCandidate(candidate, candidate.name, { major: true });
      afterSaveRefresh();
      toast(`Added “${candidate.name}” as an area`);
      return;
    }

    const commit = (label) => {
      confirmAddCandidate(candidate, label.folder, { major: label.major });
      const id = pickId("custom", candidate.name);
      if (!label.major) updatePick(id, { kind: label.kind });
      afterSaveRefresh();
      return id;
    };

    const suggested = candidate.lat != null ? suggestedFolderFor(candidate.lat, candidate.lon) : null;
    const guessedKind = pickKind({ category: candidate.category || candidate.type, description: candidate.description });

    const ask = (folder) => {
      openLabelSheet({
        name: candidate.name,
        subtitle: candidate.displayName || candidate.address || "",
        folder: folder || suggested || "Unsorted",
        suggested,
        major: false,
        kind: guessedKind,
        confirmLabel: "Save it",
        onConfirm: (label) => {
          commit(label);
          toast(label.major ? `Saved ${candidate.name} as an area` : `Saved to ${label.folder}`);
        },
        // Backing out still saves - only the labelling was in question, and
        // losing a place you asked to save would be the worse outcome.
        onDismiss: () => {
          commit({ folder: folder || suggested || "Unsorted", major: false, kind: guessedKind });
          toast("Saved, unsorted");
        },
      });
    };

    // The question is only worth asking when there is a choice to make. One
    // area obviously containing it, or one folder and nowhere else to put it,
    // is not a choice - so it files itself and says where, with the way to
    // change it right there.
    const confident = options.folder || confidentFolderFor(candidate.lat, candidate.lon);
    if (!confident) {
      ask(null);
      return;
    }

    const id = commit({ folder: confident, major: false, kind: guessedKind });
    toastWithAction(`Saved to ${confident}`, "Change", () => {
      const saved = loadPicks().find((p) => p.id === id);
      openLabelSheet({
        name: candidate.name,
        subtitle: candidate.displayName || candidate.address || "",
        folder: confident,
        suggested,
        major: !!(saved && saved.major),
        kind: (saved && pickKind(saved)) || guessedKind,
        confirmLabel: "Done",
        onConfirm: (label) => {
          if (label.major) {
            setPickMajor(id, true);
            renderPicks();
            offerToCollectNearby(loadPicks().find((p) => p.id === id));
            return;
          }
          setPickMajor(id, false);
          updatePick(id, { city: label.folder, kind: label.kind });
          renderPicks();
          toast(`Moved to ${label.folder}`);
        },
      });
    });
  }

  // Whatever is behind the save needs to show it: the search list, or the tab.
  function afterSaveRefresh() {
    if (ideaOverlay.classList.contains("open")) renderIdea();
    else if (searchOverlay.classList.contains("open")) renderSearchOverlay();
    else if (view.dataset.activeTab) showView(view.dataset.activeTab);
  }

  // A toast with one tappable action, which is how a reversible choice should
  // be offered: act first, correct after, rather than prompt before.
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
    clearToastTimer();
    const hide = () => {
      el.classList.remove("show", "with-action");
      el.innerHTML = "";
    };
    el.querySelector(".toast-action").addEventListener("click", () => {
      clearToastTimer();
      hide();
      onAction();
    });
    toastTimer = setTimeout(hide, 5000);
  }

  // Where a place goes is now always your call. The app still works out which
  // folder it would have guessed and marks it "suggested", so the common case
  // is one tap - but it is a tap, not a decision made on your behalf. Guessing
  // silently was fine when it was right and invisible when it was wrong, which
  // is the worst combination: things ended up somewhere nobody chose and only
  // turned up later, in the wrong section.
  //
  // Closing the sheet without choosing still saves - to Unsorted. Losing a
  // place you asked to save would be worse than filing it nowhere in
  // particular, and Unsorted is honest about being undecided.
  // ---------- One sheet for everything a place is ----------
  // There were three questions about the same place, in three places, at three
  // moments: which folder (a modal, at save), town or place (a toast, after
  // save), and To do or Eat (the detail sheet, whenever you found it). Nothing
  // said they were the same question - what is this thing - so each arrived as
  // a fresh interruption. They are one sheet now, with the likely answers
  // already filled in, so agreeing is one tap and disagreeing is one more.
  function openLabelSheet(opts) {
    const state = {
      folder: opts.folder || "Unsorted",
      major: !!opts.major,
      kind: opts.kind || "place",
    };

    const draw = () => {
      const folders = loadFolders().filter((f) => f !== "Unsorted").concat(["Unsorted"]);
      placeModal.innerHTML = `
        <div class="modal-backdrop" data-close="1">
          <div class="modal-sheet" role="dialog" aria-label="About this place">
            <div class="modal-handle"></div>
            <button class="modal-close" data-close="1" aria-label="Close">✕</button>
            <div class="modal-body">
              <h2 class="modal-title">${esc(opts.name)}</h2>
              ${opts.subtitle ? `<div class="modal-subtitle">${esc(opts.subtitle)}</div>` : ""}

              <label class="settings-label">What is it</label>
              <div class="move-row">
                <button class="move-chip${state.major ? "" : " active"}" data-label-major="0">📍 Somewhere to go</button>
                <button class="move-chip${state.major ? " active" : ""}" data-label-major="1">🏘️ A town or area</button>
              </div>

              ${
                // An area is its own section and appears in neither list, so
                // both of the questions below would be controls that do
                // nothing.
                state.major
                  ? `<p class="settings-hint">It will head its own section, and places you save nearby get filed under it.</p>`
                  : `
              <label class="settings-label">Shows up in</label>
              <div class="move-row">
                <button class="move-chip${state.kind === "place" ? " active" : ""}" data-label-kind="place">🏛️ To do</button>
                <button class="move-chip${state.kind === "eat" ? " active" : ""}" data-label-kind="eat">🍽️ Eat</button>
              </div>

              <label class="settings-label">Where it goes</label>
              <div class="filter-row" id="labelFolders">
                ${folders
                  .map(
                    (f) =>
                      `<button class="filter-chip${f === state.folder ? " active" : ""}" data-label-folder="${esc(f)}">${esc(f)}${
                        f === opts.suggested && f === state.folder ? ` <span class="chip-suggested">suggested</span>` : ""
                      }</button>`
                  )
                  .join("")}
              </div>
              <form class="search-bar" id="labelNewFolder" style="margin-top:4px;">
                <input type="text" id="labelNewFolderInput" placeholder="Or a new folder…" autocomplete="off" />
                <button type="submit" aria-label="Create folder">+</button>
              </form>`
              }

              <button class="modal-btn modal-btn-primary" id="labelDone" style="width:100%;margin-top:16px;">
                ${esc(opts.confirmLabel || "Save")}
              </button>
            </div>
          </div>
        </div>
      `;
      placeModal.classList.add("open");

      let settled = false;
      placeModal.querySelectorAll("[data-close]").forEach((el) =>
        el.addEventListener("click", (e) => {
          if (e.target !== el) return;
          closePlaceModal();
          if (!settled && opts.onDismiss) opts.onDismiss(state);
        })
      );

      // Each control redraws the sheet, because choosing "a town" removes two
      // questions that no longer apply.
      placeModal.querySelectorAll("[data-label-major]").forEach((b) =>
        b.addEventListener("click", () => {
          const wasMajor = state.major;
          state.major = b.getAttribute("data-label-major") === "1";
          // An area is filed under its own name. Changing your mind has to put
          // the folder back too, or the place lands in a folder named after
          // itself that was never created and appears nowhere else.
          if (state.major) state.folder = opts.name;
          else if (wasMajor) state.folder = opts.folder || "Unsorted";
          draw();
        })
      );
      placeModal.querySelectorAll("[data-label-kind]").forEach((b) =>
        b.addEventListener("click", () => {
          state.kind = b.getAttribute("data-label-kind");
          draw();
        })
      );
      placeModal.querySelectorAll("[data-label-folder]").forEach((b) =>
        b.addEventListener("click", () => {
          state.folder = b.getAttribute("data-label-folder");
          draw();
        })
      );
      const newFolder = document.getElementById("labelNewFolder");
      if (newFolder) {
        newFolder.addEventListener("submit", (e) => {
          e.preventDefault();
          const name = document.getElementById("labelNewFolderInput").value.trim();
          if (!name) return;
          state.folder = addFolder(name);
          draw();
        });
      }
      document.getElementById("labelDone").addEventListener("click", () => {
        settled = true;
        closePlaceModal();
        opts.onConfirm(state);
      });
    };

    draw();
  }

  function openFolderPicker(candidateName, suggestedFolder, onConfirm, options) {
    const opts = options || {};
    const summary = opts.summary && opts.summary.length ? opts.summary : null;
    // "Unsorted" is always offered, and never duplicated if it is also a real
    // folder someone made by hand.
    const folders = loadFolders().filter((f) => f !== "Unsorted").concat(["Unsorted"]);

    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="Choose a folder">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">✕</button>
          <div class="modal-body">
            <h2 class="modal-title">Where should "${esc(candidateName)}" go?</h2>
            ${
              summary
                ? `<div class="share-summary">${summary.map((row) => `<div class="share-summary-row">${esc(row)}</div>`).join("")}</div>`
                : ""
            }
            <div class="filter-row" id="folderChips">
              ${folders
                .map(
                  (f) =>
                    `<button class="filter-chip${f === suggestedFolder ? " active" : ""}" data-pick-folder="${esc(f)}">${esc(f)}${
                      f === suggestedFolder ? ` <span class="chip-suggested">suggested</span>` : ""
                    }</button>`
                )
                .join("")}
            </div>
            <form class="search-bar" id="newFolderForm" style="margin-top:4px;">
              <input type="text" id="newFolderInput" placeholder="Or create a new folder…" autocomplete="off" />
              <button type="submit" aria-label="Create folder">+</button>
            </form>
            <p class="settings-hint">${
              suggestedFolder
                ? `Nearest is <b>${esc(suggestedFolder)}</b> — tap it to agree, or pick anywhere else.`
                : "Nothing nearby to suggest, so pick a folder or start a new one."
            }</p>
          </div>
        </div>
      </div>
    `;
    placeModal.classList.add("open");

    let decided = false;
    const finalize = (folder) => {
      decided = true;
      closePlaceModal();
      onConfirm(folder);
    };

    placeModal.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target !== el) return;
        closePlaceModal();
        if (!decided && opts.onDismiss) opts.onDismiss();
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
      if (p) lines.push(`📍 ${pickGoogleUrl(p)}`);
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
    // Last resort, when neither the share sheet nor the clipboard is available.
    // Was a window.prompt, which on Android is a system dialog titled with the
    // page's origin, in a font the app never uses, with the text crammed into
    // one unscrollable line. This is the app's own sheet, and the text can be
    // read and selected properly.
    openCopyFallback(title, text);
  }

  function openCopyFallback(title, text) {
    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="Copy this to share">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">✕</button>
          <div class="modal-body">
            <h2 class="modal-title">${esc(title)}</h2>
            <div class="modal-subtitle">Sharing isn't available here — copy this instead</div>
            <textarea class="settings-input notes-box" id="copyFallbackText" rows="8" readonly>${esc(text)}</textarea>
            <button class="modal-btn modal-btn-primary" id="copyFallbackBtn" style="width:100%;margin-top:12px;">Select all</button>
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

    const box = document.getElementById("copyFallbackText");
    const btn = document.getElementById("copyFallbackBtn");
    if (btn && box) {
      btn.addEventListener("click", () => {
        box.focus();
        box.select();
        // execCommand is deprecated but is the only copy route left once
        // navigator.clipboard has already failed - and this is the fallback
        // path, so failing quietly here is fine.
        try {
          if (document.execCommand("copy")) toast("Copied");
        } catch (e) {
          /* the text is selected either way - a long-press copy still works */
        }
      });
    }
  }

  // Both kinds of toast share one element, so they must share one timer. They
  // did not: a plain toast fired moments before an actionable one left its own
  // 2.4s timer running, which then hid the element - taking "Undo", "Change"
  // and "Just a place" off screen less than halfway through the 5s they were
  // supposed to be offered for.
  let toastTimer = null;
  function clearToastTimer() {
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  function toast(message) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.remove("with-action");
    el.classList.add("show");
    clearToastTimer();
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  }

  // ---------- Views ----------

  // ---------- Trip ----------
  // The front page of whichever board is open. It used to describe the
  // bundled Scotland trip and nothing else, so it was wrong on every other
  // board; it now summarises the board's own places, days and costs, with
  // the Scotland briefing kept only on the board it belongs to.
  function renderOverview() {
    const board = activeBoard();
    const picks = loadPicks();
    const plan = loadPlan();
    const scheduledIds = new Set();
    Object.values(plan.items || {}).forEach((list) =>
      (list || []).forEach((it) => scheduledIds.add(it.pickId))
    );
    const scheduled = picks.filter((p) => scheduledIds.has(p.id)).length;
    const booked = picks.filter((p) => p.booked).length;
    const eats = picksOfKind("eat").length;
    const costTotal =
      picks.reduce((a, p) => a + pickCost(p), 0) +
      loadBudgetExtras().reduce((a, r) => a + (Number(r.amount) || 0), 0);

    const subtitle = board.hasGuide
      ? TRIP.subtitle
      : [board.destination, board.dated ? "trip" : "saved places"].filter(Boolean).join(" · ");

    let html = `
      <div class="hero">
        <h1>${esc(board.name)}</h1>
        <p>${esc(subtitle)}</p>
        <div class="hero-stats">
          <div class="hero-stat"><b>${picks.length}</b><span>saved</span></div>
          <div class="hero-stat"><b>${plan.days.length}</b><span>day${plan.days.length === 1 ? "" : "s"}</span></div>
          <div class="hero-stat"><b>${scheduled}</b><span>scheduled</span></div>
        </div>
        <button class="hero-share" id="shareTrip">↗ Share this plan</button>
      </div>
    `;

    // Where things stand, and the one action that moves it forward. An empty
    // board gets told what to do rather than shown three zeroes.
    if (!picks.length) {
      html += `
        <div class="card empty-state">
          <div class="empty-icon">📍</div>
          <h2>Nothing saved yet</h2>
          <ul class="empty-list">
            <li><b>Share from Google Maps</b> — tap Share on a place, pick this app</li>
            <li><b>Search in Picks</b> — by name, or describe what you want</li>
          </ul>
          <button class="modal-btn modal-btn-primary" data-goto="picks" style="margin-top:12px;width:100%;">Add a place</button>
        </div>
      `;
    } else {
      html += `<div class="section-label">Where it stands</div>`;
      html += `<div class="card overview-grid">
        <button class="overview-stat" data-goto="places"><b>${picks.length - eats}</b><span>places to go</span></button>
        <button class="overview-stat" data-goto="eats"><b>${eats}</b><span>places to eat</span></button>
        <button class="overview-stat" data-goto="itinerary"><b>${picks.length - scheduled}</b><span>unscheduled</span></button>
        <button class="overview-stat" data-goto="picks"><b>${booked}</b><span>booked</span></button>
      </div>`;

      if (plan.days.length) {
        html += `<div class="section-label">Days</div><div class="card">`;
        plan.days.forEach((d) => {
          const count = (plan.items[d.id] || []).length;
          const redrawOverview = () => {
            if (view.dataset.activeTab === "overview") renderOverview();
          };
          const f = forecastForDay(d.label, dayWeatherAnchor(d.id, redrawOverview), redrawOverview);
          const look = f && f.day ? weatherLook(f.day.code == null ? 3 : f.day.code) : null;
          html += `
            <button class="overview-day" data-goto="itinerary">
              <span class="overview-day-label">${esc(d.label)}</span>
              <span class="overview-day-right">
                ${
                  look
                    ? `<span class="overview-day-weather">${look.icon} ${f.day.max != null ? f.day.max + "°" : ""}${
                        f.day.rainChance != null && f.day.rainChance >= 50 ? ` 💧${f.day.rainChance}%` : ""
                      }</span>`
                    : ""
                }
                <span class="overview-day-count">${count ? `${count} stop${count === 1 ? "" : "s"}` : "empty"}</span>
              </span>
            </button>
          `;
        });
        html += `</div>`;
      } else {
        html += `
          <div class="card">
            <p class="pick-status">No days yet. Add them in the Itinerary tab, then drop your saved places onto them.</p>
            <button class="modal-btn modal-btn-primary" data-goto="itinerary" style="margin-top:12px;width:100%;">Build the itinerary</button>
          </div>
        `;
      }

      html += `
        <div class="section-label">Budget</div>
        <button class="card overview-budget" data-goto="budget">
          <span>${costTotal > 0 ? "Costed so far" : "Nothing costed yet"}</span>
          <span class="budget-range">${money(costTotal)}</span>
        </button>
      `;
    }

    if (board.hasGuide) {
      html += `
        <div class="section-label">About this trip</div>
        <div class="card">
          <p>${esc(TRIP.traveler)}. Peak Fringe/festival week in Edinburgh (7–31 Aug), so this plan
          mixes gentle festival mornings with day trips to Stirling and Glasgow — especially over
          the 22–23 Aug weekend, when Edinburgh's Old Town is at its most crowded.</p>
        </div>
      `;
    }

    view.innerHTML = html;

    view.querySelectorAll("[data-goto]").forEach((el) =>
      el.addEventListener("click", () => showView(el.getAttribute("data-goto")))
    );

    const shareBtn = document.getElementById("shareTrip");
    if (shareBtn) {
      shareBtn.addEventListener("click", () => {
        shareText(board.name, formatBoardShareText());
      });
    }
  }

  // Shares what the user actually planned. Falls back to the bundled
  // itinerary on the Scotland board when they haven't planned anything of
  // their own yet, since that's the thing worth sending at that point.
  function formatBoardShareText() {
    const board = activeBoard();
    const plan = loadPlan();
    const picks = loadPicks();
    const byId = {};
    picks.forEach((p) => (byId[p.id] = p));

    const planned = Object.values(plan.items || {}).some((l) => (l || []).length);
    if (!planned && board.hasGuide) return formatFullItineraryShareText();

    const lines = [board.name];
    if (board.destination) lines.push(board.destination);
    lines.push("");

    plan.days.forEach((day) => {
      const items = plan.items[day.id] || [];
      if (!items.length) return;
      lines.push(`— ${day.label} —`);
      items.forEach((it) => {
        const p = byId[it.pickId];
        if (!p) return;
        lines.push(`  ${it.time ? it.time + " " : ""}${p.name}${p.booked ? " (booked)" : ""}`);
      });
      lines.push("");
    });

    const unscheduled = picks.filter(
      (p) => !Object.values(plan.items || {}).some((l) => (l || []).some((it) => it.pickId === p.id))
    );
    if (unscheduled.length) {
      lines.push("— Not scheduled —");
      unscheduled.forEach((p) => lines.push(`  ${p.name}`));
    }
    return lines.join("\n").trim();
  }


  // ---------- Personal itinerary planner ----------
  // The bundled DAYS are a suggested plan and stay read-only; this is the
  // user's own schedule, built from whatever they've saved in Picks. Days are
  // seeded from the bundled trip but are editable, so a different trip
  // entirely is a matter of renaming/adding days.
  const PLAN_KEY = "trip-plan-v1";

  let planMode = "suggested"; // "suggested" | "mine"

  function loadPlan() {
    const board = activeBoard();
    const stored = readJson(boardKey(board.id, "plan"), null);
    if (stored && Array.isArray(stored.days)) return stored;
    // Only the bundled Scotland board starts with its days filled in; any
    // other board begins empty so the user names their own.
    return {
      days: board.hasGuide ? DAYS.map((d, i) => ({ id: `d${i}`, label: `${d.day} · ${d.date}` })) : [],
      items: {},
    };
  }

  function savePlan(plan) {
    localStorage.setItem(boardKey(activeBoard().id, "plan"), JSON.stringify(plan));
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

  // ---------- Times ----------
  // Times are typed by hand into a small box on a phone, so "9", "9.30" and
  // "0930" all have to mean what they obviously mean. Returns minutes since
  // midnight, or null for anything that isn't a time.
  function timeToMinutes(value) {
    const s = String(value || "").trim();
    if (!s) return null;
    const m = /^(\d{1,2})\s*[:.h]?\s*(\d{2})?\s*(am|pm)?$/i.exec(s);
    if (!m) return null;
    let hours = Number(m[1]);
    const mins = m[2] ? Number(m[2]) : 0;
    const suffix = (m[3] || "").toLowerCase();
    if (mins > 59) return null;
    if (suffix === "pm" && hours < 12) hours += 12;
    if (suffix === "am" && hours === 12) hours = 0;
    if (hours > 23) return null;
    return hours * 60 + mins;
  }

  function formatTime(value) {
    const mins = timeToMinutes(value);
    if (mins == null) return String(value || "").trim();
    return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }

  // A day reads in the order you will walk it, not the order things happened
  // to be added. Anything without a time keeps its position at the end: an
  // unscheduled stop is a loose end, and sorting it into the middle of the day
  // would imply a decision nobody made.
  function itemsInDayOrder(items) {
    return items
      .map((it, i) => ({ it, i, mins: timeToMinutes(it.time) }))
      .sort((a, b) => {
        if (a.mins == null && b.mins == null) return a.i - b.i;
        if (a.mins == null) return 1;
        if (b.mins == null) return -1;
        return a.mins - b.mins || a.i - b.i;
      })
      .map((x) => x.it);
  }

  // Which stop "NEXT" should point at. Only meaningful on the day itself -
  // on any other day the first stop is the next one you will do.
  function nextItemIndex(ordered, isToday, now) {
    if (!isToday) return ordered.length ? 0 : -1;
    const minsNow = now.getHours() * 60 + now.getMinutes();
    // A stop counts as still ahead for a while after its time: standing
    // outside somewhere at 10:05 for a 10:00 booking, the next thing is
    // still that booking.
    const GRACE_MINS = 60;
    const idx = ordered.findIndex((it) => {
      const m = timeToMinutes(it.time);
      return m == null || m + GRACE_MINS >= minsNow;
    });
    return idx;
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

  // Moves the item past its neighbour AS DISPLAYED. The screen shows the day in
  // time order; the array is in the order things were added. Swapping array
  // neighbours therefore moved a pair that were not next to each other on
  // screen - or appeared to do nothing at all - as soon as any item had a
  // time. The reorder is done in display order and the result written back.
  function movePlanItem(dayId, pickId, delta) {
    const plan = loadPlan();
    const shown = itemsInDayOrder(planItems(plan, dayId));
    const i = shown.findIndex((it) => it.pickId === pickId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= shown.length) return;

    // Two timed stops keep their times; swapping them without swapping the
    // times would put the list straight back where it was on the next render.
    const a = shown[i];
    const b = shown[j];
    const aTime = a.time;
    const bTime = b.time;
    if (timeToMinutes(aTime) != null || timeToMinutes(bTime) != null) {
      a.time = bTime;
      b.time = aTime;
    }
    shown[i] = b;
    shown[j] = a;
    plan.items[dayId] = shown;
    savePlan(plan);
  }

  function setPlanItemTime(dayId, pickId, time) {
    const plan = loadPlan();
    const list = planItems(plan, dayId).slice();
    const item = list.find((it) => it.pickId === pickId);
    if (!item) return;
    // "9", "9.30", "930" and "7pm" are all what someone means on a phone
    // keyboard, and all have to sort against each other afterwards. Anything
    // that isn't a time is kept as typed rather than thrown away.
    item.time = formatTime(time);
    plan.items[dayId] = list;
    savePlan(plan);
  }

  // A day's id was the millisecond it was made, which was unique for exactly
  // as long as days were only ever made one tap at a time. Building a whole
  // trip at once makes several inside the same millisecond: they came out
  // sharing an id, so every stop landed on the first of them and the others
  // were days you could see and could not fill.
  function newDayId(plan) {
    let id;
    do {
      id = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    } while (plan.days.some((d) => d.id === id));
    return id;
  }

  function addPlanDay(label) {
    const trimmed = (label || "").trim();
    if (!trimmed) return;
    const plan = loadPlan();
    plan.days.push({ id: newDayId(plan), label: trimmed });
    savePlan(plan);
  }

  // ---------- Days made when you need them ----------
  // Scheduling used to require a plan to exist first: the day chips only
  // appeared once days had been added in the Itinerary tab, and a saved place
  // met "Add days in the Itinerary tab first" - a trip you have to set up
  // before you can use it. But a day is only a label with a date in it, and
  // the date is already known the moment you say "today" or tap one on a
  // calendar. So it is made on the spot.
  // Written the way the bundled days are, so dayLabelToDate() can read back
  // anything this creates.
  const WEEKDAY_TITLES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTH_TITLES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function labelForDate(date) {
    return `${WEEKDAY_TITLES[date.getDay()]} ${date.getDate()} ${MONTH_TITLES[date.getMonth()]}`;
  }

  // Labels carry a day and a month but no year, so a trip running 29 Dec to
  // 2 Jan parsed every day into the same year: January sorted before December,
  // the numbering came out backwards, and the forecast lookup asked about
  // dates ten months in the past. The year is carried along the sequence
  // instead - when a day lands before the one before it, the trip has crossed
  // into the next year.
  function datedDays(days) {
    let year = new Date().getFullYear();
    let previous = null;
    return days.map((d, i) => {
      let when = dayLabelToDate(d.label, year);
      if (when && previous && when < previous) {
        year += 1;
        when = dayLabelToDate(d.label, year);
      }
      if (when) previous = when;
      return { d, i, when };
    });
  }

  // Strips whatever "Day N · " prefix a label carries. Deliberately not
  // \d+ - a label mid-creation reads "Day ? · Wed 12 Aug", and requiring
  // digits left the old prefix in place so renumbering produced
  // "Day 1 · Day ? · Wed 12 Aug", saved and shown exactly like that.
  function bareDayLabel(label) {
    return String(label || "").replace(/^Day\s*[^·]*·\s*/i, "");
  }

  // Days are kept in date order, and the "Day N" numbering follows from that
  // rather than from the order they happened to be created - a day added
  // after the fact belongs where it falls, not at the end.
  function renumberDays(plan) {
    const dated = datedDays(plan.days);
    dated.sort((a, b) => {
      if (a.when && b.when) return a.when - b.when || a.i - b.i;
      if (a.when) return -1;
      if (b.when) return 1;
      return a.i - b.i;
    });
    plan.days = dated.map((x, idx) => ({
      id: x.d.id,
      label: x.when ? `Day ${idx + 1} · ${bareDayLabel(x.d.label)}` : x.d.label,
    }));
    return plan;
  }

  // Returns the day for that date, making it if it does not exist yet.
  function ensureDayFor(date) {
    const plan = loadPlan();
    const existing = datedDays(plan.days).find((x) => x.when && sameDay(x.when, date));
    if (existing) return existing.d.id;

    const id = newDayId(plan);
    // No placeholder prefix: renumberDays writes the number, and anything it
    // has to strip first is a chance to get the label wrong.
    plan.days.push({ id, label: labelForDate(date) });
    renumberDays(plan);
    savePlan(plan);
    return id;
  }

  // The sheet that puts a place on a day. Today and tomorrow are named rather
  // than dated because that is how you think about them; the trip's own days
  // come next; and any other date is a tap on the calendar. Nothing here needs
  // an itinerary to exist first - a day that does not exist yet is made.
  function openDaySheet(pickId, opts) {
    const options = opts || {};
    const pick = loadPicks().find((p) => p.id === pickId);
    if (!pick) return;

    const draw = () => {
      const plan = loadPlan();
      const today = new Date();
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

      const onDay = (dayId) => (plan.items[dayId] || []).some((it) => it.pickId === pickId);
      const dated = datedDays(plan.days);
      const dayFor = (date) => {
        const hit = dated.find((x) => x.when && sameDay(x.when, date));
        return hit && hit.d;
      };

      const quick = [
        { label: "Today", date: today },
        { label: "Tomorrow", date: tomorrow },
      ]
        .map((q) => {
          const day = dayFor(q.date);
          const on = day && onDay(day.id);
          return `<button class="move-chip${on ? " active" : ""}" data-day-quick="${q.date.toISOString()}">${
            on ? "✓ " : ""
          }${q.label}</button>`;
        })
        .join("");

      const existing = plan.days
        .map(
          (d) =>
            `<button class="day-chip${onDay(d.id) ? " on" : ""}" data-day-toggle="${esc(d.id)}">${esc(
              shortDayLabel(d.label)
            )}</button>`
        )
        .join("");

      placeModal.innerHTML = `
        <div class="modal-backdrop" data-close="1">
          <div class="modal-sheet" role="dialog" aria-label="Put it on a day">
            <div class="modal-handle"></div>
            <button class="modal-close" data-close="1" aria-label="Close">✕</button>
            <div class="modal-body">
              <h2 class="modal-title">When are you going?</h2>
              <div class="modal-subtitle">${esc(pick.name)}</div>

              <label class="settings-label">Soon</label>
              <div class="move-row">${quick}</div>

              ${
                plan.days.length
                  ? `<label class="settings-label">Days you have</label>
                     <div class="day-assign-row">${existing}</div>`
                  : `<p class="settings-hint">You have no days planned yet — picking one above makes it.</p>`
              }

              <label class="settings-label">Another date</label>
              <div class="cost-field">
                <input class="settings-input" type="date" id="dayDatePick" />
              </div>
              <p class="settings-hint">The day is made if it doesn't exist, and slots into the trip in date order.</p>

              <button class="modal-btn modal-btn-primary" id="daySheetDone" style="width:100%;margin-top:16px;">Done</button>
            </div>
          </div>
        </div>
      `;
      placeModal.classList.add("open");

      placeModal.querySelectorAll("[data-close]").forEach((el) =>
        el.addEventListener("click", (e) => {
          if (e.target === el) finish();
        })
      );

      const put = (date) => {
        const dayId = ensureDayFor(date);
        const already = (loadPlan().items[dayId] || []).some((it) => it.pickId === pickId);
        if (already) removeFromPlan(dayId, pickId);
        else addToPlan(dayId, pickId);
        draw();
      };

      placeModal.querySelectorAll("[data-day-quick]").forEach((b) =>
        b.addEventListener("click", () => put(new Date(b.getAttribute("data-day-quick"))))
      );
      placeModal.querySelectorAll("[data-day-toggle]").forEach((b) =>
        b.addEventListener("click", () => {
          const dayId = b.getAttribute("data-day-toggle");
          if (onDay(dayId)) removeFromPlan(dayId, pickId);
          else addToPlan(dayId, pickId);
          draw();
        })
      );
      const datePick = document.getElementById("dayDatePick");
      if (datePick) {
        datePick.addEventListener("change", () => {
          if (!datePick.value) return;
          // Parsed as local rather than UTC: "2026-08-19" is that day where
          // you are, not the small hours of the day before.
          const [y, m, d] = datePick.value.split("-").map(Number);
          put(new Date(y, m - 1, d));
        });
      }
      document.getElementById("daySheetDone").addEventListener("click", finish);
    };

    const finish = () => {
      closePlaceModal();
      const plan = loadPlan();
      const days = plan.days.filter((d) => (plan.items[d.id] || []).some((it) => it.pickId === pickId));
      if (days.length) toast(`${pick.name} — ${days.map((d) => shortDayLabel(d.label)).join(", ")}`);
      // Today only appears once the trip has a day in it, and tab visibility is
      // recomputed by showView. The onDone branch redraws the search list
      // instead, so without this the first day you ever create leaves Today
      // hidden until you happen to switch tabs.
      applyBoardTabs();
      if (options.onDone) options.onDone();
      else showView(view.dataset.activeTab || "picks");
    };

    draw();
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

  // ---------- Plan my days: choose what to plan, then say what will not work ----------
  // The old version took every saved place, sent the lot, and wrote whatever
  // came back straight into the itinerary. Three things wrong with that:
  //
  //   - There was no way to say "just the Perthshire ones this time". Planning
  //     is usually done a region at a time; the app made it all or nothing.
  //   - It never said what it could not do. A place four hours away simply did
  //     not appear, which looks identical to the model forgetting it.
  //   - It overwrote the plan on arrival, so an afternoon of arranging days by
  //     hand was gone before you had read the result.
  //
  // Now: choose the places, or a whole area at once; the answer is reviewed
  // before it is applied; what was left out is listed with the reason; and when
  // more has been chosen than the days can hold, the surplus comes back as
  // separate trips rather than being crammed in or silently dropped.
  const planOverlay = document.getElementById("planOverlay");

  // What counts as a day nobody would actually enjoy. The road factor and the
  // driving speed are the app's own, shared with the leg times shown on each
  // day, so the warning and the numbers beside it cannot disagree.
  const LONG_DAY_MINUTES = 180;
  const BUSY_DAY_STOPS = 5;

  let planner = null;

  function blankPlanner() {
    return { selected: {}, status: "idle", view: "select", result: null, error: "", raw: "" };
  }

  function plannerPicks() {
    return loadPicks().filter((p) => !p.major);
  }

  function plannerAreas() {
    const groups = {};
    plannerPicks().forEach((p) => {
      const area = p.city || "Unsorted";
      if (!groups[area]) groups[area] = [];
      groups[area].push(p);
    });
    return groups;
  }

  function selectedPicks() {
    return plannerPicks().filter((p) => planner.selected[p.id]);
  }

  function openPlanner() {
    if (!loadTripSettings().geminiKey.trim()) {
      openSettings();
      toast("Add a Gemini key and this can plan your days");
      return;
    }
    planner = blankPlanner();
    // Everything already on a day is what you were working on, so it starts
    // selected; a first run with nothing scheduled starts with everything.
    const plan = loadPlan();
    const scheduled = new Set();
    Object.keys(plan.items || {}).forEach((dayId) =>
      (plan.items[dayId] || []).forEach((it) => scheduled.add(it.pickId))
    );
    plannerPicks().forEach((p) => {
      planner.selected[p.id] = scheduled.size ? scheduled.has(p.id) : true;
    });
    renderPlanner();
  }

  function closePlanner() {
    planOverlay.classList.remove("open");
    planOverlay.innerHTML = "";
    planner = null;
    if (view.dataset.activeTab) showView(view.dataset.activeTab);
  }

  function plannerSelectHtml() {
    const groups = plannerAreas();
    const areas = Object.keys(groups);
    const chosen = selectedPicks().length;
    const days = loadPlan().days.length;

    let html = `
      <p class="settings-hint planner-lead">
        Choose what to plan. A whole area at once, or place by place - anything you leave out
        stays exactly where it is.
      </p>
      <div class="planner-count">
        <b>${esc(String(chosen))}</b> place${chosen === 1 ? "" : "s"} ·
        <b>${esc(String(days))}</b> day${days === 1 ? "" : "s"}
        ${
          days && chosen > days * BUSY_DAY_STOPS
            ? `<span class="planner-count-warn">— more than these days can hold. I'll say what to leave for another trip.</span>`
            : ""
        }
      </div>
      <div class="planner-bulk">
        <button class="search-chip" data-plan-all="1">Select all</button>
        <button class="search-chip" data-plan-none="1">Clear</button>
      </div>
    `;

    areas.forEach((area) => {
      const list = groups[area];
      const on = list.filter((p) => planner.selected[p.id]).length;
      html += `
        <section class="planner-area">
          <button class="planner-area-head${on === list.length ? " on" : on ? " part" : ""}" data-plan-area="${esc(area)}">
            <span class="planner-area-tick">${on === list.length ? "✓" : on ? "–" : ""}</span>
            <span class="planner-area-name">${esc(area)}</span>
            <span class="planner-area-count">${esc(String(on))}/${esc(String(list.length))}</span>
          </button>
          <div class="planner-places">
            ${list
              .map(
                (p) => `
                  <button class="planner-place${planner.selected[p.id] ? " on" : ""}" data-plan-pick="${esc(p.id)}">
                    <span class="planner-place-tick">${planner.selected[p.id] ? "✓" : ""}</span>
                    <span class="planner-place-main">
                      <span class="planner-place-name">${esc(p.name)}</span>
                      ${p.category ? `<span class="planner-place-meta">${esc(p.category)}</span>` : ""}
                    </span>
                  </button>
                `
              )
              .join("")}
          </div>
        </section>
      `;
    });

    return html;
  }

  // Our own arithmetic, not the model's opinion. Distances between the stops
  // it put on each day, so "this day is too much" is a measurement.
  function dayFeasibility(stops) {
    const points = stops.map((s) => s.pick).filter((p) => p && p.lat != null);
    let km = 0;
    for (let i = 1; i < points.length; i++) {
      km += haversineKm(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
    }
    const road = km * ROAD_FACTOR;
    const miles = Math.round(toMiles(road));
    const minutes = Math.round((road / DRIVE_KMH) * 60);
    const problems = [];
    if (minutes > LONG_DAY_MINUTES) {
      problems.push(`about ${formatDuration(minutes)} of driving between stops`);
    }
    if (stops.length > BUSY_DAY_STOPS) {
      problems.push(`${stops.length} stops is a lot for one day`);
    }
    return { miles, minutes, problems };
  }

  function plannerReviewHtml() {
    const result = planner.result;
    if (!result) return "";
    const plan = loadPlan();

    let html = "";
    if (result.notes) html += `<div class="card planner-notes"><p class="pick-status">${esc(result.notes)}</p></div>`;

    result.days.forEach((day, i) => {
      const label = (plan.days[day.index] && plan.days[day.index].label) || `Day ${day.index + 1}`;
      const check = dayFeasibility(day.stops);
      html += `
        <div class="card planner-day">
          <div class="planner-day-head">
            <span class="planner-day-name">${esc(label)}</span>
            <span class="planner-day-meta">${esc(String(day.stops.length))} stop${
              day.stops.length === 1 ? "" : "s"
            }${check.miles ? ` · about ${esc(String(check.miles))} mile${check.miles === 1 ? "" : "s"}` : ""}</span>
          </div>
          ${day.stops
            .map(
              (s) => `
                <div class="planner-stop">
                  <span class="planner-stop-time">${esc(s.time || "")}</span>
                  <span class="planner-stop-main">
                    <span class="planner-stop-name">${esc(s.pick ? s.pick.name : s.name)}</span>
                    ${s.why ? `<span class="planner-stop-why">${esc(s.why)}</span>` : ""}
                  </span>
                </div>
              `
            )
            .join("")}
          ${
            check.problems.length
              ? `<p class="planner-warn">⚠ ${esc(check.problems.join(", and "))}. Worth moving something.</p>`
              : ""
          }
        </div>
      `;
    });

    if (result.leftOut.length) {
      html += `
        <div class="card planner-left">
          <div class="section-label">Left out, and why</div>
          ${result.leftOut
            .map(
              (x) => `
                <div class="planner-left-row">
                  <span class="planner-left-name">${esc(x.name)}</span>
                  <span class="planner-left-why">${esc(x.reason)}</span>
                </div>
              `
            )
            .join("")}
        </div>
      `;
    }

    // More than the days could hold, offered as trips of their own rather than
    // squeezed in or quietly dropped.
    result.trips.forEach((trip, i) => {
      html += `
        <div class="card planner-trip">
          <div class="section-label">A trip of its own</div>
          <h3 class="planner-trip-title">${esc(trip.title)}</h3>
          ${trip.why ? `<p class="pick-status">${esc(trip.why)}</p>` : ""}
          <p class="planner-trip-places">${esc(trip.places.map((p) => p.name).join(" · "))}</p>
          <button class="modal-btn" data-plan-trip="${i}">
            Add ${esc(String(trip.days))} more day${trip.days === 1 ? "" : "s"} and plan it
          </button>
        </div>
      `;
    });

    return html;
  }

  function renderPlanner() {
    if (!planner) return;
    const reviewing = planner.view === "review" && planner.result;
    let body = "";
    if (planner.status === "loading") {
      body = `
        <div class="card idea-loading">
          <p class="pick-status">Working out what fits…</p>
          <button class="modal-btn" data-plan-cancel="1" style="margin-top:14px;">Stop waiting</button>
        </div>
      `;
    } else if (planner.status === "error") {
      body = `
        <div class="card">
          <h2 class="modal-title">That didn't work</h2>
          <p class="pick-status">${esc(planner.error)}</p>
          <div class="settings-btn-row">
            <button class="modal-btn modal-btn-primary" data-plan-run="1">Try again</button>
            <button class="modal-btn" data-plan-back="1">Change what's included</button>
          </div>
        </div>
      `;
    } else {
      body = reviewing ? plannerReviewHtml() : plannerSelectHtml();
    }

    planOverlay.innerHTML = `
      <div class="search-head">
        <button class="search-back" data-plan-close="1" aria-label="Close">←</button>
        <div class="idea-head-text">
          <div class="idea-head-title">${reviewing ? "How this looks" : "Plan my days"}</div>
          <div class="idea-head-sub">${
            reviewing ? "Nothing has changed yet" : `${esc(String(selectedPicks().length))} selected`
          }</div>
        </div>
      </div>
      <div class="search-body">${body}</div>
      ${
        planner.status === "loading" || planner.status === "error"
          ? ""
          : reviewing
          ? `<div class="idea-nav">
               <button class="modal-btn idea-back" data-plan-back="1">Change</button>
               <button class="modal-btn modal-btn-primary idea-forward" data-plan-apply="1">Use this plan</button>
             </div>`
          : `<div class="idea-nav">
               <button class="modal-btn modal-btn-primary idea-forward" data-plan-run="1"
                       ${selectedPicks().length ? "" : "disabled"}>Plan these</button>
             </div>`
      }
    `;
    planOverlay.classList.add("open");
    guarded("Plan my days", wirePlanner);
  }

  function wirePlanner() {
    planOverlay.querySelectorAll("[data-plan-close]").forEach((b) => b.addEventListener("click", closePlanner));
    planOverlay.querySelectorAll("[data-plan-cancel]").forEach((b) =>
      b.addEventListener("click", () => {
        planner.status = "idle";
        planner.view = "select";
        renderPlanner();
      })
    );
    planOverlay.querySelectorAll("[data-plan-back]").forEach((b) =>
      b.addEventListener("click", () => {
        planner.view = "select";
        planner.status = "idle";
        renderPlanner();
      })
    );
    planOverlay.querySelectorAll("[data-plan-pick]").forEach((b) =>
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-plan-pick");
        planner.selected[id] = !planner.selected[id];
        renderPlanner();
      })
    );
    planOverlay.querySelectorAll("[data-plan-area]").forEach((b) =>
      b.addEventListener("click", () => {
        const area = b.getAttribute("data-plan-area");
        const list = plannerAreas()[area] || [];
        // Half-selected means "select the rest", which is what a tap on a
        // partly-ticked group is asking for.
        const turnOn = list.some((p) => !planner.selected[p.id]);
        list.forEach((p) => (planner.selected[p.id] = turnOn));
        renderPlanner();
      })
    );
    planOverlay.querySelectorAll("[data-plan-all]").forEach((b) =>
      b.addEventListener("click", () => {
        plannerPicks().forEach((p) => (planner.selected[p.id] = true));
        renderPlanner();
      })
    );
    planOverlay.querySelectorAll("[data-plan-none]").forEach((b) =>
      b.addEventListener("click", () => {
        planner.selected = {};
        renderPlanner();
      })
    );
    planOverlay.querySelectorAll("[data-plan-run]").forEach((b) =>
      b.addEventListener("click", () => runPlanner())
    );
    planOverlay.querySelectorAll("[data-plan-apply]").forEach((b) =>
      b.addEventListener("click", () => applyPlannerResult())
    );
    planOverlay.querySelectorAll("[data-plan-trip]").forEach((b) =>
      b.addEventListener("click", () => addPlannerTrip(Number(b.getAttribute("data-plan-trip"))))
    );
  }

  function plannerPrompt(picks, days) {
    const settings = loadTripSettings();
    const who = aiContextBlock();
    const dayList = days.map((d, i) => `${i + 1}. ${d.label}`).join("\n");
    const placeList = picks
      .map(
        (p) =>
          `- ${p.name}${p.city ? ` (${p.city})` : ""}${p.category ? ` [${p.category}]` : ""}` +
          `${p.lat != null ? ` at ${p.lat.toFixed(4)},${p.lon.toFixed(4)}` : " (position unknown)"}` +
          `${p.openingHours ? ` hours: ${p.openingHours}` : ""}`
      )
      .join("\n");

    return (
      `Arrange these saved places into the days below.${who}\n\n` +
      `Days:\n${dayList}\n\nPlaces:\n${placeList}\n\n` +
      `Rules:\n` +
      `- Use ONLY the places listed, by their exact names.\n` +
      `- Group places that are close together on the same day; the coordinates are given.\n` +
      `- Put demanding things earlier; leave a day lighter rather than cramming it.\n` +
      `- Not every place has to be used. Say plainly what you left out and why -\n` +
      `  too far from the rest, too long a drive, needs a day of its own, closed that day.\n` +
      `- Be honest about how realistic the result is, including anything you did fit\n` +
      `  that will be tight.\n` +
      `- If there is more here than these days can hold, do not squeeze it in. Put the\n` +
      `  surplus into one or more separate trips, each one somewhere that works as its\n` +
      `  own outing, and say how many days each would need.\n\n` +
      `Reply with ONLY JSON:\n` +
      `{"days":[{"day":1,"stops":[{"name":"exact name","time":"10:00" or "","why":"one short reason it sits here"}]}],` +
      `"leftOut":[{"name":"exact name","reason":"why it does not fit"}],` +
      `"notes":"one or two sentences on how realistic this is",` +
      `"separateTrips":[{"title":"short name","why":"one sentence","days":2,"places":["exact name"]}]}`
    );
  }

  // Same lesson as the trip planner: read what models actually send, not only
  // the shape that was asked for.
  // Models wrap the whole answer in an array often enough - [ { "days": ... } ]
  // - that failing on it is a bug in the reader, not the reply. The wrapper is
  // only unwrapped when what is inside actually looks like a plan, so a flat
  // list of assignments is still read as one.
  const PLAN_KEYS = ["days", "itinerary", "leftOut", "left_out", "separateTrips", "separate_trips", "notes"];

  function unwrapPlannerPayload(raw) {
    let value = raw;
    for (let depth = 0; depth < 3; depth++) {
      if (!Array.isArray(value) || value.length !== 1) break;
      const inner = value[0];
      if (!inner || typeof inner !== "object" || Array.isArray(inner)) break;
      if (!PLAN_KEYS.some((k) => inner[k] !== undefined)) break;
      value = inner;
    }
    return Array.isArray(value) ? { days: value } : value;
  }

  function normalisePlannerResult(raw, picks, days) {
    raw = unwrapPlannerPayload(raw);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const byName = {};
    picks.forEach((p) => (byName[String(p.name).toLowerCase().trim()] = p));
    const find = (name) => byName[String(name || "").toLowerCase().trim()] || null;

    // A flat list of assignments - [{day: 1, name: "...", time: "..."}] - is
    // the other shape models reach for, and it is a perfectly clear one.
    let rawDays = Array.isArray(raw.days) ? raw.days : Array.isArray(raw.itinerary) ? raw.itinerary : [];
    if (!rawDays.length && Array.isArray(raw.assignments)) rawDays = raw.assignments;
    if (rawDays.length && rawDays.every((d) => d && d.name && !d.stops && !d.places)) {
      const grouped = {};
      rawDays.forEach((entry) => {
        const at = Number(entry.day) || 1;
        if (!grouped[at]) grouped[at] = { day: at, stops: [] };
        grouped[at].stops.push(entry);
      });
      rawDays = Object.keys(grouped)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => grouped[k]);
    }
    const used = new Set();
    const outDays = [];
    rawDays.forEach((d, i) => {
      const index = Number(d && (d.day || d.index)) - 1;
      const at = Number.isFinite(index) && index >= 0 && index < days.length ? index : i;
      if (at >= days.length) return;
      const stopsRaw = Array.isArray(d && d.stops) ? d.stops : Array.isArray(d && d.places) ? d.places : [];
      const stops = stopsRaw
        .map((s) => (typeof s === "string" ? { name: s } : s))
        .map((s) => {
          const pick = find(s && s.name);
          // A name that is not one of ours is a hallucination, and it is
          // dropped rather than shown as a stop that cannot be opened.
          if (!pick || used.has(pick.id)) return null;
          used.add(pick.id);
          return { pick, name: pick.name, time: String((s && s.time) || "").slice(0, 8), why: String((s && s.why) || "").slice(0, 160) };
        })
        .filter(Boolean);
      if (stops.length) outDays.push({ index: at, stops });
    });

    const leftOutRaw = Array.isArray(raw.leftOut) ? raw.leftOut : Array.isArray(raw.left_out) ? raw.left_out : [];
    const leftOut = leftOutRaw
      .map((x) => (typeof x === "string" ? { name: x } : x))
      .map((x) => {
        const pick = find(x && x.name);
        return pick ? { name: pick.name, reason: String((x && (x.reason || x.why)) || "Doesn't fit these days.").slice(0, 200) } : null;
      })
      .filter(Boolean);

    const tripsRaw = Array.isArray(raw.separateTrips)
      ? raw.separateTrips
      : Array.isArray(raw.separate_trips)
      ? raw.separate_trips
      : Array.isArray(raw.trips)
      ? raw.trips
      : [];
    const trips = tripsRaw
      .map((t) => {
        if (!t || typeof t !== "object") return null;
        const places = (Array.isArray(t.places) ? t.places : [])
          .map((n) => find(typeof n === "string" ? n : n && n.name))
          .filter(Boolean);
        if (!places.length) return null;
        const wanted = Number(t.days);
        return {
          title: String(t.title || t.name || "Another trip").slice(0, 80),
          why: String(t.why || t.summary || "").slice(0, 240),
          days: Number.isFinite(wanted) && wanted > 0 ? Math.min(7, Math.round(wanted)) : Math.ceil(places.length / 3),
          places,
        };
      })
      .filter(Boolean);

    // Anything neither placed, nor explained, nor moved to another trip would
    // otherwise vanish without a word.
    const accounted = new Set(used);
    leftOut.forEach((x) => accounted.add((find(x.name) || {}).id));
    trips.forEach((t) => t.places.forEach((p) => accounted.add(p.id)));
    picks.forEach((p) => {
      if (!accounted.has(p.id)) leftOut.push({ name: p.name, reason: "Not placed, and no reason given." });
    });

    if (!outDays.length && !trips.length) return null;
    return { days: outDays, leftOut, trips, notes: String(raw.notes || raw.summary || "").slice(0, 400) };
  }

  async function runPlanner() {
    const key = loadTripSettings().geminiKey.trim();
    if (!key) return openSettings();
    const picks = selectedPicks();
    const days = loadPlan().days;
    if (!picks.length) return;
    if (!days.length) {
      toast("Add a day first — the Itinerary tab, or from any place");
      return;
    }

    planner.status = "loading";
    planner.view = "review";
    renderPlanner();
    try {
      // No grounding: this is arranging places we already know about, so
      // search would only slow it down and risk a prose answer.
      const { text } = await callGemini(key, plannerPrompt(picks, days), { json: true, maxTokens: 4096 });
      if (!planner) return;
      planner.raw = text;
      const result = normalisePlannerResult(extractJson(text), picks, days);
      if (!result) {
        throw new Error(
          `The model answered, but not with a plan that could be read.${
            text ? ` It said: "${text.trim().slice(0, 140)}…"` : ""
          }`
        );
      }
      planner.result = result;
      planner.status = "done";
    } catch (e) {
      if (!planner) return;
      planner.status = "error";
      planner.error = (e && e.message) || String(e);
    }
    renderPlanner();
  }

  // Only now does anything change, and only the days that were planned: a day
  // full of places you did not include this time is left exactly as it was.
  function applyPlannerResult() {
    const result = planner && planner.result;
    if (!result) return;
    const plan = loadPlan();
    const chosen = new Set(selectedPicks().map((p) => p.id));

    result.days.forEach((day) => {
      const dayId = plan.days[day.index] && plan.days[day.index].id;
      if (!dayId) return;
      const untouched = (plan.items[dayId] || []).filter((it) => !chosen.has(it.pickId));
      plan.items[dayId] = untouched.concat(day.stops.map((s) => ({ pickId: s.pick.id, time: s.time || "" })));
    });
    // A place that was selected and did not make the plan comes off the days
    // it was on, or the itinerary would show it twice over.
    const placed = new Set();
    result.days.forEach((d) => d.stops.forEach((s) => placed.add(s.pick.id)));
    plan.days.forEach((d) => {
      plan.items[d.id] = (plan.items[d.id] || []).filter((it) => !chosen.has(it.pickId) || placed.has(it.pickId));
    });

    savePlan(plan);
    const count = result.days.reduce((n, d) => n + d.stops.length, 0);
    closePlanner();
    showView("itinerary");
    toast(`${count} place${count === 1 ? "" : "s"} across ${result.days.length} day${result.days.length === 1 ? "" : "s"}`);
  }

  // A proposed separate trip, made real: the days it needs are added after the
  // ones you have, and its places go on them in the order given.
  function addPlannerTrip(index) {
    const trip = planner && planner.result && planner.result.trips[index];
    if (!trip) return;
    const plan = loadPlan();
    const dated = datedDays(plan.days).filter((x) => x.when).sort((a, b) => a.when - b.when);
    const last = dated.length ? dated[dated.length - 1].when : new Date();
    const dayIds = [];
    for (let i = 1; i <= trip.days; i++) {
      dayIds.push(ensureDayFor(new Date(last.getFullYear(), last.getMonth(), last.getDate() + i)));
    }
    const fresh = loadPlan();
    trip.places.forEach((p, i) => {
      const dayId = dayIds[Math.floor((i * dayIds.length) / trip.places.length)] || dayIds[0];
      if (!fresh.items[dayId]) fresh.items[dayId] = [];
      if (!fresh.items[dayId].some((it) => it.pickId === p.id)) fresh.items[dayId].push({ pickId: p.id, time: "" });
    });
    savePlan(fresh);
    closePlanner();
    showView("itinerary");
    toast(`${trip.title} — ${trip.days} day${trip.days === 1 ? "" : "s"} added`);
  }


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

  // ---------- Distance ----------
  // This is a UK trip planned by someone who thinks in miles, and the app was
  // quoting kilometres at them. Every distance goes through here so there is
  // one place that decides, rather than six sites each formatting their own.
  const MILES_PER_KM = 0.621371;

  function toMiles(km) {
    return km * MILES_PER_KM;
  }

  // Under about a quarter of a mile, a fraction is harder to picture than
  // yards - "0.2 miles" versus "350 yards".
  function formatDistance(km) {
    const mi = toMiles(km);
    if (mi < 0.25) return `${Math.round(mi * 1760 / 10) * 10} yd`;
    if (mi < 10) return `${mi.toFixed(1)} mi`;
    return `${Math.round(mi)} mi`;
  }

  function formatDuration(mins) {
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  // Beyond this, a leg is a drive. Two miles is about the furthest that
  // reads as "we'll walk it" with a four-year-old who has already done a
  // castle that morning.
  const WALK_MAX_KM = 3.2;
  // Deliberately conservative: a UK average across single carriageways,
  // towns and the odd motorway stretch. Better to over-estimate a drive than
  // to promise Stirling in forty minutes.
  const DRIVE_KMH = 60;
  const ROAD_FACTOR = 1.35; // roads wander more than streets do

  // A leg between two stops, walked or driven depending on how far it is.
  // The old version assumed walking at any distance, so two places forty
  // miles apart came out as "🚶 690 min".
  function walkLeg(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    const straight = haversineKm(a.lat, a.lon, b.lat, b.lon);
    const driving = straight * DETOUR_FACTOR > WALK_MAX_KM;
    const km = straight * (driving ? ROAD_FACTOR : DETOUR_FACTOR);
    const mins = Math.round((km / (driving ? DRIVE_KMH : WALK_KMH)) * 60);
    return { km, mins, driving, icon: driving ? "🚗" : "🚶" };
  }

  function legLabel(leg) {
    return `${leg.icon} ${formatDuration(leg.mins)} · ${formatDistance(leg.km)}`;
  }

  function renderMyPlan() {
    const plan = loadPlan();
    const picks = loadPicks();
    const byId = {};
    picks.forEach((p) => (byId[p.id] = p));

    let html = "";

    // Two different jobs, and which one you need depends on what you have.
    // With places saved, the question is how to arrange them. With nothing
    // saved - which is where every trip starts - there is nothing to arrange,
    // and the honest answer is to go and find some, together.
    html += `
      <div class="card plan-ai-card">
        ${
          picks.length
            ? `<button class="plan-ai-btn" id="autoPlanBtn">✨ Plan my days for me</button>
               <p class="settings-hint" style="text-align:center;">Choose which places - or a whole area - and see what fits before anything changes.</p>
`
            : `<p class="pick-status">Nothing saved yet — so there is nothing to arrange into days.</p>`
        }
        <button class="plan-ai-btn plan-idea-btn" id="tripIdeaBtn">🧭 Suggest a trip</button>
        <p class="settings-hint" style="text-align:center;">Say where you are and how far you'll go — you get whole routes back, with the stops already in order.</p>
      </div>
    `;

    plan.days.forEach((day) => {
      const items = itemsInDayOrder(planItems(plan, day.id));
      // Quiet here: on a list of days, "forecast lands nearer the time"
      // repeated six times is noise, and a rain nudge per day is nagging.
      const redrawItinerary = () => {
        if (view.dataset.activeTab === "itinerary") renderItinerary();
      };
      const forecast = forecastForDay(day.label, dayWeatherAnchor(day.id, redrawItinerary), redrawItinerary);
      html += `
        <div class="card day-card">
          <div class="plan-day-head">
            <span class="day-title">${esc(day.label)}</span>
            <button class="plan-day-remove" data-remove-day="${esc(day.id)}" aria-label="Remove day">✕</button>
          </div>
          ${weatherLine(forecast, { quiet: true })}
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
          html += `<div class="plan-leg${leg.mins >= 25 ? " far" : ""}">${legLabel(
            leg
          )} from previous stop</div>`;
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

    // A board with no days is the normal starting state now that every board
    // can be planned, so it gets an explanation and a one-tap way in rather
    // than a bare text field.
    if (!plan.days.length) {
      html += `
        <div class="card">
          <h2 style="margin:0 0 6px;font-size:16px;">No days yet</h2>
          <p class="pick-status">Add a day, then drop your saved places onto it. Name them however you like — "Sat 22 Aug", "Day 1", or "Sunday".</p>
          <div class="plan-add-chips" style="margin-top:10px;">
            <button class="add-chip" data-quick-day="Day 1">+ Day 1</button>
            <button class="add-chip" data-quick-day="Day 2">+ Day 2</button>
            <button class="add-chip" data-quick-day="Weekend">+ Weekend</button>
          </div>
        </div>
      `;
    }

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
    if (autoBtn) autoBtn.addEventListener("click", openPlanner);
    const ideaBtn = document.getElementById("tripIdeaBtn");
    if (ideaBtn) ideaBtn.addEventListener("click", openTripIdea);

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
        const before = input.value.trim();
        setPlanItemTime(dayId, pickId, before);
        // Re-render only when the day's order actually changed - otherwise
        // tabbing between two times would redraw the list under your finger.
        if (formatTime(before) !== before || before) renderItinerary();
      });
    });
    view.querySelectorAll("[data-remove-day]").forEach((btn) => {
      btn.addEventListener("click", () => {
        removePlanDay(btn.getAttribute("data-remove-day"));
        renderItinerary();
      });
    });
    view.querySelectorAll("[data-quick-day]").forEach((btn) => {
      btn.addEventListener("click", () => {
        addPlanDay(btn.getAttribute("data-quick-day"));
        applyBoardTabs(); // the first day makes Today worth showing
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
        applyBoardTabs();
        renderItinerary();
      });
    }
  }

  function renderItinerary() {
    // The bundled Scotland itinerary is only worth offering on the board it
    // came with; anywhere else the toggle would show someone else's week.
    const hasSuggested = activeBoard().hasGuide;
    const toggle = hasSuggested
      ? `
      <div class="filter-row plan-toggle">
        <button class="filter-chip${planMode === "suggested" ? " active" : ""}" data-plan-mode="suggested">Suggested</button>
        <button class="filter-chip${planMode === "mine" ? " active" : ""}" data-plan-mode="mine">My plan</button>
      </div>
    `
      : "";

    if (!hasSuggested || planMode === "mine") {
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
    const redraw = () => {
      if (view.dataset.activeTab === "itinerary") renderItinerary();
    };
    DAYS.forEach((d, i) => {
      // The bundled days name their own city, which is a better anchor than
      // anything saved - Day 4 is in Glasgow whatever is bookmarked.
      const city = CITY_COORDS[d.city];
      const anchor = city
        ? { name: d.city, lat: city.lat, lon: city.lon }
        : dayWeatherAnchor(`d${i}`, redraw);
      const forecast = forecastForDay(`${d.day} · ${d.date}`, anchor, redraw);
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
          ${weatherLine(forecast, { quiet: true })}
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

  // ---------- Places & Eats ----------
  // These two tabs used to be read-only lists of bundled Edinburgh content,
  // which made them useless on any other board and useless for anything the
  // user added themselves. They now show the board's own saved places, split
  // by what they are: somewhere to go, or somewhere to eat. The bundled
  // Edinburgh guide still appears underneath, but only on the board it came
  // with, and only as suggestions to save.
  // The list was in whatever order things happened to be saved, which is the
  // one order that means nothing by the time there are twenty of them.
  const SORT_KEY = "places-sort-v1";
  const SORTS = [
    { key: "recent", label: "Newest" },
    { key: "name", label: "A–Z" },
    { key: "near", label: "Nearest" },
    { key: "day", label: "By day" },
  ];

  function loadSort() {
    const v = readJson(SORT_KEY, "recent");
    return SORTS.some((s) => s.key === v) ? v : "recent";
  }

  function saveSort(key) {
    localStorage.setItem(SORT_KEY, JSON.stringify(key));
  }

  // "Nearest" needs somewhere to be near. The first scheduled stop is the
  // best answer - that's where the day starts - then anything saved with
  // coordinates, then the board's own destination.
  function sortOrigin() {
    const plan = loadPlan();
    const picks = loadPicks();
    const byId = {};
    picks.forEach((p) => (byId[p.id] = p));
    for (const day of plan.days) {
      for (const it of plan.items[day.id] || []) {
        const p = byId[it.pickId];
        if (p && p.lat != null) return p;
      }
    }
    return picks.find((p) => p.lat != null) || destinationAnchor(null);
  }

  function sortPicks(list, sortKey, origin) {
    const copy = list.slice();
    if (sortKey === "name") {
      return copy.sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
    }
    if (sortKey === "near" && origin) {
      return copy.sort((a, b) => {
        // Anything without coordinates sinks rather than pretending to be
        // nearby - it genuinely isn't known.
        if (a.lat == null) return 1;
        if (b.lat == null) return -1;
        return (
          haversineKm(origin.lat, origin.lon, a.lat, a.lon) -
          haversineKm(origin.lat, origin.lon, b.lat, b.lon)
        );
      });
    }
    if (sortKey === "day") {
      const plan = loadPlan();
      const dayIndex = {};
      plan.days.forEach((d, i) => {
        (plan.items[d.id] || []).forEach((it) => {
          if (dayIndex[it.pickId] === undefined) dayIndex[it.pickId] = i;
        });
      });
      // Scheduled things first, in the order you'll do them; everything not
      // yet placed collects at the bottom, which is where the work is.
      return copy.sort((a, b) => {
        const ai = dayIndex[a.id] === undefined ? 999 : dayIndex[a.id];
        const bi = dayIndex[b.id] === undefined ? 999 : dayIndex[b.id];
        return ai - bi || a.name.localeCompare(b.name, "en-GB");
      });
    }
    return copy.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  }

  // renderPlaces / renderEats / renderPlaceTab lived here. They rendered the
  // same saved list the Picks tab does, filtered by kind, with their own
  // folder chips and sort row - a second and third implementation of one
  // screen. Picks absorbed the filter, the sorting and the guide, so they are
  // gone rather than left as an unreachable copy that drifts out of step.

  // A guide entry rendered the same way a saved place is: tappable body that
  // opens the full details, one control on the right. Previously these were
  // large cards where only the ♥ responded to a tap, sitting directly below
  // rows that opened a sheet - two behaviours, no way to tell them apart.
  function renderGuideRow(item, source, index) {
    const picked = isPicked(source, item.name);
    const meta = [item.category || item.meal, item.area, item.price].filter(Boolean).join(" · ");
    return `
      <div class="guide-row">
        <button class="guide-row-main" data-preview-guide="${source}|${index}">
          <div class="pick-row-name">${esc(item.name)}</div>
          ${meta ? `<div class="pick-row-meta">${esc(meta)}</div>` : ""}
          <div class="pick-row-badges">
            <span class="row-badge">${esc(item.city)}</span>
            ${picked ? `<span class="row-badge day">saved</span>` : ""}
          </div>
          <div class="search-result-more">Details ›</div>
        </button>
        <button class="pick-toggle${picked ? " picked" : ""}" data-toggle-pick="${source}" data-name="${esc(
      item.name
    )}" aria-label="${picked ? "Remove from your places" : "Save " + esc(item.name)}">${picked ? "♥" : "♡"}</button>
      </div>
    `;
  }

  // Opens a bundled guide entry in the same sheet a search result uses, so
  // the whole screen behaves one way. Saving goes through togglePick with the
  // guide's own source, not quickAdd - otherwise the sheet would save it as
  // "custom:Name" while the ♥ looks for "places:Name", and you would end up
  // holding the same place twice with neither control aware of the other.
  function openGuidePreview(source, index) {
    const item = (source === "places" ? PLACES : EATS)[index];
    if (!item) return;
    const candidate = {
      name: item.name,
      displayName: [item.area, item.city].filter(Boolean).join(", "),
      city: item.city,
      category: item.category || item.meal || "",
      description: item.notes || "",
      website: item.website || "",
      price: item.price || null,
      mapsQuery: item.mapsQuery || item.name,
      guideSource: source,
    };
    // Slots into the same list-and-index machinery the search results use.
    openCandidatePreview(0, [candidate]);
  }

  function renderGuidePlaces() {
    return PLACES.map((p, i) => renderGuideRow(p, "places", i)).join("");
  }

  function renderGuideEats() {
    return (
      `<p class="search-hint">Independent, well-reviewed picks near each stop. £ casual · ££ mid-range · £££ a step up.</p>` +
      EATS.map((e, i) => renderGuideRow(e, "eats", i)).join("")
    );
  }

  // ---------- Budget ----------
  // Was a fixed table of Scottish estimates that no board could edit and no
  // saved place appeared in. The real question is "what has this trip
  // committed me to", which only the places actually saved can answer - so
  // every place can carry a cost, and anything that isn't a place (trains,
  // the flat) goes in as its own line.
  function renderBudget() {
    const picks = loadPicks();
    const extras = loadBudgetExtras();
    const board = activeBoard();

    const placesTotal = picks.reduce((a, p) => a + pickCost(p), 0);
    const extrasTotal = extras.reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const total = placesTotal + extrasTotal;
    const priced = picks.filter((p) => pickCost(p) > 0);

    let html = `
      <div class="card budget-hero">
        <div class="budget-hero-total">${money(total)}</div>
        <div class="budget-hero-sub">${
          priced.length || extras.length
            ? `${priced.length} place${priced.length === 1 ? "" : "s"} priced${
                extras.length ? ` · ${extras.length} other cost${extras.length === 1 ? "" : "s"}` : ""
              }`
            : "Nothing costed yet"
        }</div>
      </div>
    `;

    html += `<div class="section-label">Places</div>`;
    if (!picks.length) {
      html += `<div class="card"><p class="pick-status">No places saved on this board yet. Anything you add in Picks can carry a price here.</p></div>`;
    } else {
      html += `<div class="card">`;
      picks.forEach((p) => {
        html += `
          <div class="budget-row">
            <div class="budget-item">${esc(p.name)}${
              p.booked ? ` <span class="booked-badge">booked</span>` : ""
            }</div>
            <div class="budget-input-wrap">
              <span class="budget-currency">£</span>
              <input class="budget-input" type="number" inputmode="decimal" min="0" step="0.5"
                     placeholder="0" value="${pickCost(p) ? esc(String(pickCost(p))) : ""}"
                     data-pick-cost="${esc(p.id)}" aria-label="Cost for ${esc(p.name)}" />
            </div>
          </div>
        `;
      });
      html += `
        <div class="budget-total"><b>Places</b><span class="budget-range">${money(placesTotal)}</span></div>
      </div>`;
    }

    html += `<div class="section-label">Other costs</div><div class="card">`;
    if (!extras.length) {
      html += `<p class="pick-status">Travel, accommodation, anything that isn't a place.</p>`;
    }
    extras.forEach((r, i) => {
      html += `
        <div class="budget-row">
          <div class="budget-item">${esc(r.item)}</div>
          <div class="budget-input-wrap">
            <span class="budget-currency">£</span>
            <input class="budget-input" type="number" inputmode="decimal" min="0" step="1"
                   value="${esc(String(r.amount || ""))}" data-extra-amount="${i}" aria-label="Amount for ${esc(r.item)}" />
            <button class="budget-remove" data-extra-remove="${i}" aria-label="Remove ${esc(r.item)}">✕</button>
          </div>
        </div>
      `;
    });
    html += `
      <form class="budget-add" id="budgetAddForm">
        <input type="text" id="budgetAddItem" placeholder="e.g. train tickets" autocomplete="off" />
        <input type="number" id="budgetAddAmount" inputmode="decimal" min="0" step="1" placeholder="£" />
        <button type="submit" aria-label="Add cost">+</button>
      </form>
      ${
        extras.length
          ? `<div class="budget-total"><b>Other</b><span class="budget-range">${money(extrasTotal)}</span></div>`
          : ""
      }
    </div>`;

    if (board.hasGuide) {
      const bLow = BUDGET.reduce((a, b) => a + b.low, 0);
      const bHigh = BUDGET.reduce((a, b) => a + b.high, 0);
      html += `<div class="section-label">Original Scotland estimate</div><div class="card">`;
      BUDGET.forEach((b) => {
        const range = b.low === b.high ? (b.low === 0 ? "Free" : `£${b.low}`) : `£${b.low}–£${b.high}`;
        html += `<div class="budget-row"><div class="budget-item">${esc(b.item)}</div><div class="budget-range">${range}</div></div>`;
      });
      html += `<div class="budget-total"><b>Estimate for the week</b><span class="budget-range">£${bLow}–£${bHigh}</span></div>`;
      html += `<p class="settings-hint" style="margin-top:10px;">Activities and transport, excluding accommodation. Museums, parks and beaches in this plan are free.</p>`;
      html += `</div>`;
    }

    view.innerHTML = html;

    // Saved on blur, not per keystroke, so a re-render can't interrupt typing.
    view.querySelectorAll("[data-pick-cost]").forEach((input) => {
      input.addEventListener("blur", () => {
        const value = input.value.trim();
        updatePick(input.getAttribute("data-pick-cost"), { cost: value === "" ? null : Number(value) });
        renderBudget();
      });
    });

    view.querySelectorAll("[data-extra-amount]").forEach((input) => {
      input.addEventListener("blur", () => {
        const rows = loadBudgetExtras();
        const i = Number(input.getAttribute("data-extra-amount"));
        if (!rows[i]) return;
        rows[i].amount = Number(input.value) || 0;
        saveBudgetExtras(rows);
        renderBudget();
      });
    });

    view.querySelectorAll("[data-extra-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rows = loadBudgetExtras();
        rows.splice(Number(btn.getAttribute("data-extra-remove")), 1);
        saveBudgetExtras(rows);
        renderBudget();
      });
    });

    const addForm = document.getElementById("budgetAddForm");
    if (addForm) {
      addForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const item = document.getElementById("budgetAddItem").value.trim();
        const amount = Number(document.getElementById("budgetAddAmount").value) || 0;
        if (!item) return;
        const rows = loadBudgetExtras();
        rows.push({ item, amount });
        saveBudgetExtras(rows);
        renderBudget();
      });
    }
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

  // ---------- Notes & packing ----------
  // Both belong to the board. The bundled Scotland advice stays on the board
  // it came with; every board gets its own notes and its own list.
  function renderTips() {
    const board = activeBoard();
    const items = loadPacking();
    const notes = loadBoardNotes();

    let html = `
      <div class="section-label">Notes</div>
      <div class="card">
        <textarea class="settings-input notes-box" id="boardNotes" rows="4"
          placeholder="Anything worth remembering — booking references, the code for the flat, who's driving.">${esc(notes)}</textarea>
      </div>
    `;

    html += `<div class="section-label">Packing list${
      items.length ? ` · ${items.filter((i) => i.done).length}/${items.length}` : ""
    }</div>`;
    html += `<div class="card">`;
    if (items.length) {
      html += `<ul class="packing-list">`;
      items.forEach((it, i) => {
        html += `<li data-i="${i}" class="${it.done ? "checked" : ""}">
          <span class="packing-text">${esc(it.text)}</span>
          <button class="packing-remove" data-packing-remove="${i}" aria-label="Remove ${esc(it.text)}">✕</button>
        </li>`;
      });
      html += `</ul>`;
    } else {
      html += `<p class="pick-status">Nothing on the list yet.</p>`;
    }
    html += `
      <form class="search-bar packing-add" id="packingAddForm">
        <input type="text" id="packingAddInput" placeholder="Add something to pack…" autocomplete="off" />
        <button type="submit" aria-label="Add">+</button>
      </form>
    </div>`;

    if (board.hasGuide) {
      html += `<div class="section-label">Good to know in Scotland</div>`;
      TIPS.forEach((t) => {
        html += `
          <div class="card tip-card">
            <h2>${esc(t.title)}</h2>
            <p>${esc(t.body)}</p>
          </div>
        `;
      });
    }

    view.innerHTML = html;

    const notesBox = document.getElementById("boardNotes");
    if (notesBox) notesBox.addEventListener("blur", () => saveBoardNotes(notesBox.value));

    view.querySelectorAll(".packing-list li").forEach((li) => {
      li.addEventListener("click", (e) => {
        if (e.target.closest("[data-packing-remove]")) return;
        const i = Number(li.getAttribute("data-i"));
        const list = loadPacking();
        if (!list[i]) return;
        list[i].done = !list[i].done;
        savePacking(list);
        li.classList.toggle("checked", list[i].done);
      });
    });

    view.querySelectorAll("[data-packing-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const list = loadPacking();
        list.splice(Number(btn.getAttribute("data-packing-remove")), 1);
        savePacking(list);
        renderTips();
      });
    });

    const addForm = document.getElementById("packingAddForm");
    if (addForm) {
      addForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = document.getElementById("packingAddInput");
        const text = input.value.trim();
        if (!text) return;
        const list = loadPacking();
        list.push({ text, done: false });
        savePacking(list);
        renderTips();
      });
    }
  }

  // ---------- Explore nearby (Overpass / OpenStreetMap) ----------

  // What you can go looking for. Since the AI does the finding, a category is
  // really just a well-phrased question - which means the list can cover
  // things OpenStreetMap has no tag for at all ("soft play", "somewhere
  // healthy", "indoors when it's raining"). `tag`/`value` is only the
  // fallback used when the AI is unavailable, so some categories fall back to
  // something broader and say so rather than pretending.
  const NEARBY_CATEGORIES = [
    // Eating
    { key: "healthy", label: "Healthy food", icon: "🥗", group: "Food & drink", tag: "amenity", value: "restaurant", approx: true,
      prompt: "healthy places to eat - salads, grain bowls, fresh and vegetable-forward cooking, good vegetarian options" },
    { key: "kidfriendly", label: "Good with kids", icon: "👶", group: "Food & drink", tag: "amenity", value: "restaurant", approx: true,
      prompt: "restaurants that genuinely welcome young children - children's menu, high chairs, relaxed about noise, quick service" },
    { key: "cafe", label: "Cafés", icon: "☕", group: "Food & drink", tag: "amenity", value: "cafe",
      prompt: "cafés good for a coffee and a sit down" },
    { key: "brunch", label: "Breakfast & brunch", icon: "🥞", group: "Food & drink", tag: "amenity", value: "cafe", approx: true,
      prompt: "places serving breakfast or brunch" },
    { key: "bakery", label: "Bakeries", icon: "🥐", group: "Food & drink", tag: "shop", value: "bakery",
      prompt: "bakeries worth a detour - bread, pastries, cakes" },
    { key: "icecream", label: "Ice cream", icon: "🍦", group: "Food & drink", tag: "amenity", value: "ice_cream",
      prompt: "ice cream shops and gelaterias" },
    { key: "restaurant", label: "Restaurants", icon: "🍽️", group: "Food & drink", tag: "amenity", value: "restaurant",
      prompt: "well-regarded independent restaurants" },
    { key: "pub", label: "Pubs", icon: "🍺", group: "Food & drink", tag: "amenity", value: "pub",
      prompt: "pubs that serve food and allow children" },

    // With a small child in tow
    { key: "softplay", label: "Soft play", icon: "🧸", group: "With a child", tag: "leisure", value: "playground", approx: true,
      prompt: "indoor soft play centres and indoor play barns for young children" },
    { key: "playground", label: "Playgrounds", icon: "🛝", group: "With a child", tag: "leisure", value: "playground",
      prompt: "outdoor playgrounds" },
    { key: "rainy", label: "Indoors if it rains", icon: "🌧️", group: "With a child", tag: "tourism", value: "museum", approx: true,
      prompt: "indoor things to do with a young child on a wet day - hands-on museums, aquariums, indoor attractions" },
    { key: "animals", label: "Animals & farms", icon: "🐑", group: "With a child", tag: "tourism", value: "attraction", approx: true,
      prompt: "farms, animal parks, aquariums or zoos where a young child can see animals" },
    { key: "swim", label: "Swimming", icon: "🏊", group: "With a child", tag: "leisure", value: "swimming_pool",
      prompt: "public swimming pools, ideally with a shallow or toddler pool" },
    { key: "library", label: "Libraries", icon: "📚", group: "With a child", tag: "amenity", value: "library",
      prompt: "public libraries, especially ones with a children's section" },

    // Seeing things
    { key: "museum", label: "Museums", icon: "🏛️", group: "See & do", tag: "tourism", value: "museum",
      prompt: "museums" },
    { key: "attraction", label: "Attractions", icon: "🎡", group: "See & do", tag: "tourism", value: "attraction",
      prompt: "visitor attractions worth the trip" },
    { key: "gallery", label: "Galleries", icon: "🖼️", group: "See & do", tag: "tourism", value: "gallery",
      prompt: "art galleries" },
    { key: "historic", label: "Historic sites", icon: "🏰", group: "See & do", tag: "historic", value: "castle", approx: true,
      prompt: "castles, ruins and historic buildings open to visitors" },
    { key: "viewpoint", label: "Views", icon: "🌄", group: "See & do", tag: "tourism", value: "viewpoint",
      prompt: "viewpoints and lookouts worth walking to" },
    { key: "market", label: "Markets", icon: "🧺", group: "See & do", tag: "amenity", value: "marketplace",
      prompt: "markets - food, farmers' or street markets" },

    // Outside
    { key: "park", label: "Parks", icon: "🌳", group: "Outdoors", tag: "leisure", value: "park",
      prompt: "parks and green spaces" },
    { key: "walk", label: "Easy walks", icon: "🚶", group: "Outdoors", tag: "leisure", value: "park", approx: true,
      prompt: "short, easy, mostly flat walks a four-year-old could manage" },
    { key: "garden", label: "Gardens", icon: "🌷", group: "Outdoors", tag: "leisure", value: "garden",
      prompt: "botanic gardens and gardens open to the public" },
    { key: "beach", label: "Beaches", icon: "🏖️", group: "Outdoors", tag: "natural", value: "beach",
      prompt: "beaches and swimmable or walkable shoreline" },

    // The unglamorous but necessary
    { key: "parking", label: "Car parks", icon: "🅿️", group: "Practical", tag: "amenity", value: "parking",
      prompt: "car parks" },
    { key: "toilets", label: "Toilets", icon: "🚻", group: "Practical", tag: "amenity", value: "toilets",
      prompt: "public toilets, noting any with baby-changing facilities" },
    { key: "pharmacy", label: "Pharmacies", icon: "💊", group: "Practical", tag: "amenity", value: "pharmacy",
      prompt: "pharmacies" },
    { key: "supermarket", label: "Supermarkets", icon: "🛒", group: "Practical", tag: "shop", value: "supermarket",
      prompt: "supermarkets and food shops" },
  ];

  const CATEGORY_GROUPS = ["Food & drink", "With a child", "See & do", "Outdoors", "Practical"];

  function findCategory(key) {
    return NEARBY_CATEGORIES.find((c) => c.key === key) || null;
  }

  // ---------- Explore: pick a centre, then browse by category ----------
  // The per-pick "explore nearby" only works from somewhere already saved.
  // This lets any point be the centre - a saved place, a typed location, or
  // where you actually are - which is what you want when deciding where to
  // base yourself for an afternoon.
  // Half a mile up to fifty: walking distance at one end, a day's drive out
  // and back at the other.
  const RADIUS_OPTIONS_MI = [0.5, 1, 2, 5, 10, 25, 50];
  const RADIUS_KEY = "explore-radius-v1";
  const DEFAULT_RADIUS_M = Math.round((2 / MILES_PER_KM) * 1000);

  // Remembered across sessions rather than reset to a default: someone
  // roaming by car sets fifty miles once and means it.
  function storedRadius() {
    const v = Number(readJson(RADIUS_KEY, null));
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_RADIUS_M;
  }

  let explore = {
    open: false,
    centre: null, // { name, lat, lon }
    category: "",
    customQuery: "", // used when category === "custom"
    showPrompt: false,
    radius: storedRadius(),
    status: "idle", // idle | locating | loading | done | error
    results: [],
    error: "",
    usedAi: false,
    stale: false, // criteria changed since the results below were fetched
  };

  // Setting up the question no longer asks it. Choosing a category, moving the
  // centre or widening the radius used to fire a search immediately, which
  // meant a half-built query was sent - and paid for, in AI calls and in the
  // seconds you spend watching a spinner - every time you touched a control on
  // the way to what you actually wanted. Now those only mark the results as out
  // of date; the Search button is the only thing that runs a search.
  function markExploreStale() {
    if (explore.status === "loading") return;
    explore.stale = true;
  }

  // ---------- Place suggestions as you type ----------
  // Typing "Bibu" and getting "Bibury, Gloucestershire" beats typing the
  // whole thing and hoping the geocoder guesses which one you meant - it also
  // settles the ambiguity up front, which is how the app used to file
  // Manchester under Glasgow.
  //
  // Photon rather than Nominatim: Photon exists for exactly this, indexes the
  // same OpenStreetMap data, and is happy being hit per keystroke. Nominatim
  // asks people not to use it for autocomplete, so it stays the fallback for
  // whole-name lookups.
  const PHOTON_URL = "https://photon.komoot.io/api/";
  const SUGGEST_MIN_CHARS = 3;
  const SUGGEST_DEBOUNCE_MS = 280;

  let suggestTimer = null;
  let suggestAbort = null;
  let suggestItems = [];

  async function fetchSuggestions(query, signal) {
    const res = await fetch(
      `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=6&lang=en`,
      { signal }
    );
    if (!res.ok) throw new Error(`photon ${res.status}`);
    const data = await res.json();
    // A missing "features" array means the response isn't what we expect -
    // a changed API, or something in the middle answering instead. Treated as
    // a failure so it falls back, rather than being read as "no such place",
    // which would look identical to the user and be wrong every time.
    if (!data || !Array.isArray(data.features)) throw new Error("unexpected suggestion response");
    return data.features
      .map((f) => {
        const p = f.properties || {};
        const coords = (f.geometry && f.geometry.coordinates) || [];
        if (coords.length < 2) return null;
        // "Bibury" then "Gloucestershire, England" - the name you typed,
        // then just enough to tell two of them apart.
        const context = [p.city && p.city !== p.name ? p.city : null, p.state, p.country]
          .filter(Boolean)
          .filter((v, i, a) => a.indexOf(v) === i)
          .slice(0, 2)
          .join(", ");
        return {
          name: p.name || p.street || p.city || "",
          context,
          kind: p.osm_value || p.osm_key || "",
          lat: coords[1],
          lon: coords[0],
        };
      })
      .filter((s) => s && s.name);
  }

  // Fallback when Photon can't answer. Nominatim asks not to be used for
  // autocomplete, so it is only reached when the purpose-built service has
  // already failed - and still behind the same debounce.
  async function fetchSuggestionsFallback(query, signal) {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=1&namedetails=1&q=${encodeURIComponent(
        query
      )}`,
      { signal, headers: { Accept: "application/json" } }
    );
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("unexpected suggestion response");
    return rows
      .map((r) => {
        const a = r.address || {};
        const name = (r.namedetails && r.namedetails.name) || String(r.display_name || "").split(",")[0];
        const context = [a.county || a.state, a.country]
          .filter(Boolean)
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .slice(0, 2)
          .join(", ");
        return {
          name,
          context,
          kind: r.type || r.category || "",
          lat: parseFloat(r.lat),
          lon: parseFloat(r.lon),
        };
      })
      .filter((s) => s.name && Number.isFinite(s.lat));
  }

  // Two different kinds of fact wearing the same star. A rating from the
  // Places API is a measurement; one from a language model is a recollection.
  // The "~" and the title text are the whole difference, and they matter when
  // you are choosing where to take a tired four-year-old for lunch.
  function ratingBadge(r) {
    if (r.rating == null) return "";
    const count = r.ratingCount ? ` (${r.ratingCount.toLocaleString("en-GB")})` : "";
    if (r.ratingFromAi) {
      return `<span class="candidate-rating ai-rating" title="Reported by AI search - worth checking, not a verified score">⭐ ~${esc(
        String(r.rating)
      )}${esc(count)}</span>`;
    }
    return `<span class="candidate-rating">⭐ ${esc(String(r.rating))}${esc(count)}</span>`;
  }

  function suggestionIcon(kind) {
    if (/city|town|village|hamlet|suburb|municipality/.test(kind)) return "🏘️";
    if (/county|state|region|province|country/.test(kind)) return "🗺️";
    if (/restaurant|cafe|pub|bar|fast_food/.test(kind)) return "🍽️";
    if (/museum|attraction|castle|monument|ruins/.test(kind)) return "🏛️";
    if (/park|garden|forest|nature/.test(kind)) return "🌳";
    if (/beach|bay|water|river|lake/.test(kind)) return "🏖️";
    return "📍";
  }

  function renderSuggestions(state, items, message) {
    const list = document.getElementById("pickSuggestList");
    const input = document.getElementById("pickSearchInput");
    if (!list) return;

    if (state === "hidden") {
      // Also cancels whatever is in flight. Hiding the list while a lookup
      // was still running meant the suggestions reappeared a moment later,
      // on top of the results you had just asked for.
      clearTimeout(suggestTimer);
      if (suggestAbort) suggestAbort.abort();
      suggestItems = [];
      list.hidden = true;
      list.innerHTML = "";
      if (input) input.setAttribute("aria-expanded", "false");
      return;
    }

    if (state === "message") {
      list.hidden = false;
      list.innerHTML = `<div class="suggest-msg">${esc(message)}</div>`;
      if (input) input.setAttribute("aria-expanded", "false");
      return;
    }

    suggestItems = items;
    list.hidden = false;
    list.innerHTML = items
      .map(
        (s, i) => `
      <button class="suggest-item" role="option" data-suggest="${i}">
        <span class="suggest-icon">${suggestionIcon(s.kind)}</span>
        <span class="suggest-text">
          <span class="suggest-name">${esc(s.name)}</span>
          ${s.context ? `<span class="suggest-context">${esc(s.context)}</span>` : ""}
        </span>
      </button>
    `
      )
      .join("");
    if (input) input.setAttribute("aria-expanded", "true");

    // Wired here rather than in wireExplore: this list is rebuilt on every
    // keystroke, deliberately without re-rendering the view - a full render
    // would take the keyboard down and lose the caret mid-word.
    list.querySelectorAll("[data-suggest]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const s = suggestItems[Number(btn.getAttribute("data-suggest"))];
        if (!s) return;
        chooseSuggestion(s);
      });
    });
  }

  function chooseSuggestion(s) {
    clearTimeout(suggestTimer);
    if (suggestAbort) suggestAbort.abort();
    const label = s.context ? `${s.name}, ${s.context}` : s.name;
    renderSuggestions("hidden");
    const input = document.getElementById("pickSearchInput");
    if (input) {
      input.value = label;
      input.blur(); // drop the keyboard so the results get the screen
    }

    // The suggestion already knows what it is and where it is - Photon told
    // us "town", with coordinates. Tapping one used to throw all of that away
    // and search by the name as a string, so whether the town appeared in its
    // own results depended on a second lookup agreeing. When that lookup came
    // back empty the town was simply missing and the screen filled with the
    // AI's bars and cafés instead - which is the thing you did not ask for,
    // in place of the one you did.
    //
    // It is carried through now. The town is the first result because you
    // chose it, whatever the backends go on to say.
    const seed = looksLikeMajorPlace({ kind: s.kind })
      ? {
          name: s.name,
          displayName: label,
          lat: s.lat,
          lon: s.lon,
          type: s.kind,
          category: prettyCategory(s.kind),
          description: "",
          isArea: true,
        }
      : null;

    runSearch(label, undefined, seed);
  }

  function onSuggestInput(value) {
    const q = value.trim();
    clearTimeout(suggestTimer);
    if (suggestAbort) suggestAbort.abort();

    if (q.length < SUGGEST_MIN_CHARS) {
      renderSuggestions("hidden");
      return;
    }

    suggestTimer = setTimeout(async () => {
      suggestAbort = new AbortController();
      const signal = suggestAbort.signal;
      let items = null;
      try {
        items = await fetchSuggestions(q, signal);
      } catch (e) {
        // An aborted request is the expected case while typing, not a fault.
        if (e && e.name === "AbortError") return;
        try {
          items = await fetchSuggestionsFallback(q, signal);
        } catch (e2) {
          if (e2 && e2.name === "AbortError") return;
          renderSuggestions("message", null, "Suggestions unavailable — press search to look it up anyway.");
          return;
        }
      }
      if (signal.aborted) return;
      if (!items.length) {
        renderSuggestions("message", null, `No places matching "${q}" — try fewer letters.`);
        return;
      }
      renderSuggestions("list", items);
    }, SUGGEST_DEBOUNCE_MS);
  }

  // setExploreCentreFromSearch lived here. The panel had its own search field
  // and this resolved what was typed into it; both are gone now that there is
  // one search at the top of the screen and its results carry "around here".
  // Which of three Newports you meant is answered by them being three results
  // rather than by a question after the fact.

  function setExploreCentreFromPick(pickId) {
    const p = loadPicks().find((x) => x.id === pickId);
    if (!p || p.lat == null) return;
    explore.centre = { name: p.name, lat: p.lat, lon: p.lon };
    explore.error = "";
    markExploreStale();
    renderPicks();
  }

  // Uses the Capacitor plugin on device, which asks for the runtime
  // permission properly. Plain navigator.geolocation in a WebView needs the
  // app to hold the Android permission already - it didn't, so this button
  // did nothing at all with no error to explain why.
  async function setExploreCentreFromGps() {
    explore.status = "locating";
    explore.error = "";
    renderPicks();

    const useCentre = (lat, lon) => {
      explore.centre = { name: "Where I am", lat, lon };
      explore.status = "idle";
      markExploreStale();
      renderPicks();
    };
    const fail = (msg) => {
      explore.status = "error";
      explore.error = msg;
      renderPicks();
    };

    const geo = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation;
    if (geo) {
      try {
        let perm = await geo.checkPermissions();
        if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
          perm = await geo.requestPermissions({ permissions: ["location", "coarseLocation"] });
        }
        if (perm.location === "denied" && perm.coarseLocation === "denied") {
          fail("Location permission was declined. Enable it for this app in Android settings, or set the area by searching instead.");
          return;
        }
        const pos = await geo.getCurrentPosition({ enableHighAccuracy: false, timeout: 15000 });
        useCentre(pos.coords.latitude, pos.coords.longitude);
      } catch (e) {
        fail(`Couldn't get your location: ${(e && e.message) || e}`);
      }
      return;
    }

    if (!navigator.geolocation) {
      fail("This device didn't offer location access. Search for the area instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => useCentre(pos.coords.latitude, pos.coords.longitude),
      (err) => fail(`Couldn't get your location: ${err.message}`),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
    );
  }

  // Category browsing via Gemini. OSM is thinnest exactly here - independent
  // cafés and restaurants are the least-mapped things in it - so the model
  // names candidates and OSM is then used only to place them.
  async function exploreWithGemini(centre, category, radiusMetres, key) {
    const who = aiContextBlock();
    const miles = toMiles(radiusMetres / 1000);
    const distance = miles < 1 ? `${Math.round(miles * 1760)} yards` : `${Math.round(miles)} miles`;
    // Past walking range the trip itself is the cost, so the model is told
    // that plainly. Without it a fifty-mile search returns the nearest café
    // that happens to be forty miles away, rather than somewhere worth the
    // drive - which is the entire point of searching that far out.
    const byCar =
      radiusMetres / 1000 > WALK_MAX_KM
        ? `\n\nThis is a drive, not a walk. Suggest places worth the journey - somewhere ` +
          `we would be glad we drove to - rather than the nearest thing that fits.`
        : "";
    // The category's own phrasing is the question. It's written as a
    // description rather than a label ("healthy places to eat - salads,
    // grain bowls…") because that's what makes the model return the right
    // sort of place rather than the nearest twelve restaurants. The user can
    // rewrite any of them.
    const looking = category === "custom" ? explore.customQuery : categoryPrompt(category);

    const prompt =
      `List up to 6 real, currently-open places matching: ${looking}. ` +
      `They must be within about ${distance} of ${centre.name}.${who}${byCar}\n\n` +
      `Use search to confirm each one exists and is still trading. ` +
      // Only the default when the user hasn't said what they want. Their own
      // words replace this rather than fighting it - someone who asks for
      // predictable chains shouldn't be argued with by the scaffolding.
      (loadTripSettings().preferences.trim()
        ? ""
        : `Prefer independent, well-regarded places over chains. `) +
      `Reply with ONLY a JSON array, each item ` +
      `{"name": exact official name, "area": street or neighbourhood, ` +
      `"why": one short sentence saying why it fits, ` +
      // Asked for, but never trusted: ratings move, and a model reporting one
      // from memory is a guess wearing a number. Null is an acceptable answer
      // and a better one than an invention, so it's asked for explicitly.
      `"rating": the review score out of 5 if you can confirm one from search, otherwise null, ` +
      `"ratingCount": roughly how many reviews that score is based on, otherwise null, ` +
      `"price": one of "£", "££", "£££" if it costs money, otherwise null, ` +
      `"booking": true only if booking ahead is normally needed, otherwise false}. ` +
      `Do not invent a rating. No other text.`;

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
        geo = await geocodePlace(item.name, item.area || centre.name, {
          name: centre.name,
          lat: centre.lat,
          lon: centre.lon,
          miles: toMiles(radiusMetres / 1000),
        });
      } catch (e) {
        geo = null;
      }
      if (geo) {
        // The model can name somewhere in the right country but the wrong
        // city. Anything absurdly outside the requested radius is dropped
        // rather than shown as "nearby".
        const km = haversineKm(centre.lat, centre.lon, geo.lat, geo.lon);
        // A quarter over the asked-for radius, plus a little slack for
        // geocoding. The old 3x + 2km was a 150-mile net at a 50-mile
        // radius, which caught nothing at all.
        if (km > (radiusMetres / 1000) * 1.25 + 2) continue;
      }
      // A rating is only carried through if it looks like a rating. It is
      // also flagged as coming from the model rather than from a ratings API,
      // because the two are not the same kind of fact and the app should not
      // present them as though they were.
      const rating = Number(item.rating);
      out.push({
        name: item.name,
        lat: geo ? geo.lat : null,
        lon: geo ? geo.lon : null,
        website: geo ? geo.website : null,
        openingHours: geo ? geo.openingHours : null,
        address: geo ? geo.address : item.area || "",
        description: item.why || "",
        rating: Number.isFinite(rating) && rating > 0 && rating <= 5 ? Math.round(rating * 10) / 10 : null,
        ratingCount: Number.isFinite(Number(item.ratingCount)) ? Number(item.ratingCount) : null,
        ratingFromAi: true,
        price: typeof item.price === "string" && /^£{1,3}$/.test(item.price) ? item.price : null,
        booking: item.booking === true,
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
    explore.stale = false;
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

    // Without the AI there's no category for "somewhere healthy" - OSM has no
    // such tag. A described search falls back to a plain name search bounded
    // to the area; a listed category falls back to its nearest real tag.
    try {
      if (explore.category === "custom") {
        explore.results = await nominatimNear(explore.customQuery, explore.centre, explore.radius);
        if (!explore.results.length && !explore.error) {
          explore.error = "Described searches work best with an AI key set in Settings.";
        }
      } else {
        explore.results = await overpassNearby(
          explore.centre.lat,
          explore.centre.lon,
          findCategory(explore.category),
          explore.radius
        );
        if (explore.radius > OVERPASS_MAX_RADIUS_M && !explore.error) {
          explore.error =
            "Without the AI search this looks within 10 miles — OpenStreetMap can't answer a wider one.";
        }
      }
      explore.status = "done";
    } catch (e) {
      explore.status = "error";
      explore.error = e && e.message ? e.message : String(e);
    }
    renderPicks();
  }

  // A free-text search confined to a box around the centre. Cruder than the
  // AI - it matches names, not meaning - but it keeps a described search from
  // returning nothing at all when no key is set or the model is down.
  async function nominatimNear(query, centre, radiusMetres) {
    const dLat = radiusMetres / 111000;
    const dLon = radiusMetres / (111000 * Math.max(0.2, Math.cos((centre.lat * Math.PI) / 180)));
    const viewbox = [centre.lon - dLon, centre.lat + dLat, centre.lon + dLon, centre.lat - dLat].join(",");
    const url =
      `https://nominatim.openstreetmap.org/search?format=json&limit=10&bounded=1` +
      `&viewbox=${encodeURIComponent(viewbox)}&extratags=1&namedetails=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Nominatim returned ${res.status}`);
    const rows = await res.json();
    return (Array.isArray(rows) ? rows : [])
      .map((r) => ({
        name: (r.namedetails && r.namedetails.name) || String(r.display_name || "").split(",")[0],
        lat: Number(r.lat),
        lon: Number(r.lon),
        website: (r.extratags && (r.extratags.website || r.extratags["contact:website"])) || null,
        openingHours: (r.extratags && r.extratags.opening_hours) || null,
        description: r.display_name || "",
      }))
      .filter((r) => r.name && Number.isFinite(r.lat));
  }

  // One button that opens the full list, rather than a row of chips scrolled
  // sideways past the edge of the screen. A native <select> would have been
  // the obvious "dropdown", but on Android it opens its own full-screen
  // picker with no icons and no grouping - the same thing we took out of the
  // planner. This shows everything at once, grouped, and closes on choosing.
  function renderExploreCategoryButton() {
    const cat = findCategory(explore.category);
    const label = explore.category === "custom" ? `🔎 ${explore.customQuery}` : cat ? `${cat.icon} ${cat.label}` : "";
    const tunable = cat && explore.category !== "custom";
    return `
      <div class="cat-select-row">
        <button class="cat-select" id="exploreCatBtn">
          <span class="cat-select-text">${label ? esc(label) : "What are you looking for?"}</span>
          <span class="cat-select-caret">⌄</span>
        </button>
        ${
          tunable
            ? `<button class="cat-tune" id="exploreCatTune" aria-label="Change what ${esc(
                cat.label
              )} asks for">✎</button>`
            : ""
        }
      </div>
    `;
  }

  // Lets the question behind a category be rewritten. Only the description
  // is editable - the app still adds the "reply with JSON" scaffolding, so
  // an edit can change what comes back but can't break the search.
  function openCategoryTuner(key) {
    const cat = findCategory(key);
    if (!cat) return;
    const current = categoryPrompt(key);
    const edited = current !== cat.prompt;

    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="Change what this looks for">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">✕</button>
          <div class="modal-body">
            <h2 class="modal-title">${cat.icon} ${esc(cat.label)}</h2>
            <div class="modal-subtitle">What this asks the AI to find</div>

            <textarea class="settings-input notes-box" id="catPromptBox" rows="4">${esc(current)}</textarea>
            <p class="settings-hint">
              Describe the kind of place you want back. The app adds the rest — how far,
              who's travelling, what matters to you, and the formatting rules.
            </p>

            <div class="settings-btn-row" style="margin-top:12px;">
              <button class="modal-btn modal-btn-primary" id="catPromptSave">Save</button>
              <button class="modal-btn" id="catPromptReset" ${edited ? "" : "disabled"}>Reset to default</button>
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

    document.getElementById("catPromptSave").addEventListener("click", () => {
      const text = document.getElementById("catPromptBox").value.trim();
      const map = Object.assign({}, loadTripSettings().catPrompts);
      // Storing only real changes means later improvements to the built-in
      // wording still reach anyone who never edited that category.
      if (!text || text === cat.prompt) delete map[key];
      else map[key] = text;
      saveTripSettings({ catPrompts: map });
      closePlaceModal();
      markExploreStale();
      renderPicks();
    });

    document.getElementById("catPromptReset").addEventListener("click", () => {
      const map = Object.assign({}, loadTripSettings().catPrompts);
      delete map[key];
      saveTripSettings({ catPrompts: map });
      closePlaceModal();
      markExploreStale();
      renderPicks();
    });
  }

  function openCategoryPicker() {
    const groups = CATEGORY_GROUPS.map((g) => {
      const items = NEARBY_CATEGORIES.filter((c) => c.group === g);
      if (!items.length) return "";
      return `
        <div class="cat-group-label">${esc(g)}</div>
        <div class="cat-grid">
          ${items
            .map((c) => {
              // A category you've reworded is marked, so your own changes
              // aren't invisible next to the ones still on defaults.
              const tuned = !!loadTripSettings().catPrompts[c.key];
              return `
            <button class="cat-tile${explore.category === c.key ? " on" : ""}" data-choose-cat="${esc(c.key)}">
              <span class="cat-tile-icon">${c.icon}</span>
              <span class="cat-tile-label">${esc(c.label)}${tuned ? ` <span class="cat-tuned" title="You changed what this asks for">✎</span>` : ""}</span>
            </button>
          `;
            })
            .join("")}
        </div>
      `;
    }).join("");

    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="What are you looking for?">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">✕</button>
          <div class="modal-body">
            <h2 class="modal-title">What are you looking for?</h2>
            <form class="search-bar" id="catCustomForm" style="margin:12px 0 4px;">
              <input type="text" id="catCustomInput" placeholder="Describe it — e.g. vegan lunch with a garden"
                     autocomplete="off" value="${explore.category === "custom" ? esc(explore.customQuery) : ""}" />
              <button type="submit" aria-label="Use this description">Use</button>
            </form>
            <p class="settings-hint">Anything you can describe, the AI search will look for. Choosing here sets the question — press Search to ask it.</p>
            ${groups}
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

    placeModal.querySelectorAll("[data-choose-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        explore.category = btn.getAttribute("data-choose-cat");
        explore.customQuery = "";
        closePlaceModal();
        markExploreStale();
        renderPicks();
      });
    });

    const form = document.getElementById("catCustomForm");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const q = document.getElementById("catCustomInput").value.trim();
        if (!q) return;
        explore.category = "custom";
        explore.customQuery = q;
        closePlaceModal();
        markExploreStale();
        renderPicks();
      });
    }
  }

  function renderExplore() {

    const pickOptions = loadPicks()
      .filter((p) => p.lat != null)
      .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
      .join("");

    // This panel used to carry a second search box, directly below the one at
    // the top of the screen, for typing the same kind of thing into. Two
    // fields, two behaviours, no way to tell from looking which one you
    // wanted. There is one search now - the one at the top - and any result it
    // finds can become the centre here.
    let body = `
      <p class="settings-hint explore-lead">
        Search at the top of the screen for a town or place, then use
        <b>🧭 Around here</b> on the result. Or start from:
      </p>
      <div class="explore-centre-row">
        <button class="move-chip" id="exploreGpsBtn">📍 Where I am</button>
        <button class="move-chip" id="exploreMapBtn">🗺 Point on a map</button>
        ${pickOptions ? `<select id="exploreFromPick"><option value="">From a saved place…</option>${pickOptions}</select>` : ""}
      </div>
    `;

    if (explore.centre) {
      body += `<p class="explore-centre">Around <b>${esc(explore.centre.name)}</b></p>`;
      body += renderExploreCategoryButton();
      // The categories are a shortcut, not the whole vocabulary. Describing
      // what you want was previously reachable only by opening the category
      // sheet and finding the field at the top of it, which made the list look
      // like the only thing the app could look for.
      body += `
        <form class="search-bar explore-describe" id="exploreDescribeForm">
          <input type="text" id="exploreDescribeInput"
                 placeholder="…or describe it — e.g. soft play with parking"
                 autocomplete="off" value="${explore.category === "custom" ? esc(explore.customQuery) : ""}" />
          <button type="submit" aria-label="Use this description">Use</button>
        </form>
      `;
      body += `
        <div class="explore-radius">
          <label for="exploreRadius">Within</label>
          <select id="exploreRadius">
            ${RADIUS_OPTIONS_MI.map((mi) => {
              const m = Math.round((mi / MILES_PER_KM) * 1000);
              return `<option value="${m}"${explore.radius === m ? " selected" : ""}>${
                mi < 1 ? "½ mile" : `${mi} miles`
              }</option>`;
            }).join("")}
          </select>
        </div>
      `;

      // The one control that actually runs a search. Everything above it only
      // describes what to look for, so the whole question can be built - area,
      // category, how far - before a single request goes out.
      const ready = !!explore.category;
      const searching = explore.status === "loading";
      const ranBefore = explore.status === "done" || explore.status === "error";
      body += `
        <button class="modal-btn modal-btn-primary explore-run" id="exploreRunBtn"${
          ready && !searching ? "" : " disabled"
        }>${searching ? "Searching…" : `🔍 ${ranBefore && !explore.stale ? "Search again" : "Search"}`}</button>
      `;
      if (!ready) {
        body += `<p class="settings-hint explore-run-hint">Pick what you're looking for, then press Search.</p>`;
      } else if (explore.stale && ranBefore) {
        body += `<p class="settings-hint explore-run-hint">Criteria changed — press Search to update the results below.</p>`;
      }
    } else {
      body += `<p class="pick-status">Pick a starting point, then choose what you're looking for and press Search.</p>`;
    }

    if (explore.status === "locating") body += `<p class="pick-status">Finding that location…</p>`;
    if (explore.status === "loading") {
      const usingAi = !!loadTripSettings().geminiKey.trim();
      body += `<p class="pick-status">Looking for ${esc(catLabel(explore.category))}${
        usingAi ? " with AI search — this takes a few seconds" : ""
      }…</p>`;
    }
    if (explore.status === "error") body += `<pre class="settings-result bad">${esc(explore.error)}</pre>`;

    // Showing the question makes a disappointing answer fixable: you can see
    // whether the model was asked the wrong thing before blaming the model.
    if (explore.usedAi && lastAiPrompt && (explore.status === "done" || explore.status === "error")) {
      body += `<button class="link-btn" id="exploreShowPrompt">${
        explore.showPrompt ? "Hide" : "See"
      } what was asked</button>`;
      if (explore.showPrompt) {
        body += `<pre class="settings-result prompt-shown">${esc(lastAiPrompt)}</pre>`;
      }
    }

    if (explore.status === "done") {
      if (!explore.results.length) {
        body += `<p class="pick-status">Nothing found in range — try a wider radius${
          explore.category && explore.category !== "custom" ? ", or ✎ to change what this asks for" : ""
        }.</p>`;
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
          // Past a few miles the useful number is how long the drive is, not
          // how far it is in a straight line.
          const distance =
            km == null
              ? ""
              : km * ROAD_FACTOR > WALK_MAX_KM
              ? `🚗 ${formatDuration(Math.round((km * ROAD_FACTOR) / DRIVE_KMH * 60))} · ${formatDistance(km)}`
              : `${formatDistance(km)} away`;
          const meta = [distance, r.price, r.openingHours, r.booking ? "book ahead" : null]
            .filter(Boolean)
            .join(" · ");
          // Same bargain as the search results: tap to read it properly,
          // + to take it on trust.
          body += `
            <div class="candidate-card explore-result">
              <div class="explore-result-main">
                <button class="result-tap" data-preview-explore="${i}">
                  <div class="place-name">${esc(r.name)}${
                    r.aiSuggested ? ` <span class="ai-badge">AI</span>` : ""
                  }${ratingBadge(r)}</div>
                  ${meta ? `<div class="place-notes">${esc(meta)}</div>` : ""}
                  ${r.description ? `<div class="place-notes">${esc(r.description)}</div>` : ""}
                  <div class="search-result-more">Details ›</div>
                </button>
                ${
                  r.aiSuggested && r.sources && r.sources.length
                    ? `<div class="place-links"><a href="${esc(safeUrl(r.sources[0].uri))}" target="_blank" rel="noopener">🔗 source</a></div>`
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

    const gps = document.getElementById("exploreGpsBtn");
    if (gps) gps.addEventListener("click", setExploreCentreFromGps);

    const mapPick = document.getElementById("exploreMapBtn");
    if (mapPick) {
      mapPick.addEventListener("click", () =>
        openMapPicker(
          (spot) => {
            explore.centre = { name: spot.name, lat: spot.lat, lon: spot.lon };
            explore.error = "";
            explore.open = true;
            markExploreStale();
            renderPicks();
          },
          { title: "Search around here", centre: explore.centre }
        )
      );
    }

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
        localStorage.setItem(RADIUS_KEY, JSON.stringify(explore.radius));
        markExploreStale();
        renderPicks();
      });
    }
    const describe = document.getElementById("exploreDescribeForm");
    if (describe) {
      describe.addEventListener("submit", (e) => {
        e.preventDefault();
        const q = document.getElementById("exploreDescribeInput").value.trim();
        if (!q) return;
        explore.category = "custom";
        explore.customQuery = q;
        markExploreStale();
        renderPicks();
      });
    }

    const runBtn = document.getElementById("exploreRunBtn");
    if (runBtn) runBtn.addEventListener("click", () => runExplore());

    const catBtn = document.getElementById("exploreCatBtn");
    if (catBtn) catBtn.addEventListener("click", openCategoryPicker);

    const tuneBtn = document.getElementById("exploreCatTune");
    if (tuneBtn) tuneBtn.addEventListener("click", () => openCategoryTuner(explore.category));

    const promptToggle = document.getElementById("exploreShowPrompt");
    if (promptToggle) {
      promptToggle.addEventListener("click", () => {
        explore.showPrompt = !explore.showPrompt;
        renderPicks();
      });
    }

    view.querySelectorAll("[data-preview-explore]").forEach((btn) => {
      btn.addEventListener("click", () =>
        openCandidatePreview(Number(btn.getAttribute("data-preview-explore")), explore.results)
      );
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
    if (key === "custom") return explore.customQuery || "Places";
    const c = findCategory(key);
    return c ? c.label : "Places";
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

  // Overpass is a free community service running unbounded geo queries. A
  // 50-mile "all restaurants" is the kind of request that either times out or
  // gets you blocked, so the fallback is capped and the cap is announced
  // rather than silently returning a smaller area than was asked for.
  const OVERPASS_MAX_RADIUS_M = Math.round((10 / MILES_PER_KM) * 1000); // 10 miles

  async function overpassNearby(lat, lon, cat, radius) {
    radius = Math.min(radius || 1200, OVERPASS_MAX_RADIUS_M);
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

  // A pick in the list is a summary, not a dossier. The card used to render
  // every fact, a live map and eight controls for every saved place - so ten
  // places meant ten stacked detail pages and ten Leaflet instances, with
  // nothing to scan and no hierarchy. The row below carries only what you
  // need to recognise and triage it; everything else lives one tap away in
  // openPickDetail(), which also means only one map exists at a time.
  function renderPickRow(p, away) {
    const plan = loadPlan();
    const days = plan.days
      .filter((d) => (plan.items[d.id] || []).some((it) => it.pickId === p.id))
      .map((d) => shortDayLabel(d.label));

    const meta = [p.category, away, p.rating != null ? `⭐ ${p.rating}` : null]
      .filter(Boolean)
      .join(" · ");

    return `
      <button class="pick-row" data-open-pick="${esc(p.id)}">
        <div class="pick-row-main">
          <div class="pick-row-name">${esc(p.name)}</div>
          ${meta ? `<div class="pick-row-meta">${esc(meta)}</div>` : ""}
          <div class="pick-row-badges">
            ${days.map((d) => `<span class="row-badge day">${esc(d)}</span>`).join("")}
            ${p.booked ? `<span class="row-badge booked">booked</span>` : ""}
            ${p.note ? `<span class="row-badge note">note</span>` : ""}
            ${p.geoAlternatives ? `<span class="row-badge doubt">location?</span>` : ""}
            ${p.enrichStatus === "loading" ? `<span class="row-badge">loading…</span>` : ""}
          </div>
        </div>
        <span class="pick-row-chevron">›</span>
      </button>
    `;
  }

  // The heading a section of places sits under. It opens the same detail sheet
  // as any other saved place, but the thing you actually want from a town is
  // what's around it, so that gets its own control rather than three taps
  // through the sheet.
  function renderMajorHeader(p, count) {
    const meta = count ? `${count} place${count === 1 ? "" : "s"} saved here` : "Nothing saved here yet";
    return `
      <div class="area-head">
        <button class="area-head-main" data-open-pick="${esc(p.id)}">
          <span class="area-head-icon">🏘️</span>
          <span class="area-head-text">
            <span class="area-head-name">${esc(p.name)}</span>
            <span class="area-head-meta">${esc(meta)}</span>
          </span>
          <span class="pick-row-chevron">›</span>
        </button>
        <button class="area-head-explore" data-explore-from="${esc(p.id)}">🧭 What's nearby</button>
      </div>
    `;
  }

  // A place's own forecast is only meaningful for the day it's scheduled on -
  // that's the day you'd be standing there in it.
  function weatherForPick(p) {
    if (p.lat == null) return "";
    const plan = loadPlan();
    const day = plan.days.find((d) => (plan.items[d.id] || []).some((it) => it.pickId === p.id));
    if (!day) return "";
    const f = forecastForDay(day.label, p, () => {
      if (placeModal.classList.contains("open")) openPickDetail(p.id);
    });
    if (!f) return "";
    return `<div class="detail-weather"><span class="detail-weather-day">${esc(
      shortDayLabel(day.label)
    )}</span>${weatherLine(f, { quiet: true })}</div>`;
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
            ${
              // The geocoder had more than one answer and nobody was asked.
              // Saying so beats a map pin that looks as confident as any other.
              p.geoAlternatives
                ? `<div class="place-fact doubt-fact">⚠️ ${esc(
                    String(p.geoAlternatives.length)
                  )} places share this name and they are far apart — this is the first one.
                   <button class="link-btn" data-fix-location="${esc(p.id)}">Pick the right one</button></div>`
                : ""
            }
            ${p.openingHours ? `<div class="place-fact">🕒 ${esc(p.openingHours)}</div>` : ""}
            ${p.phone ? `<div class="place-fact">📞 <a href="tel:${esc(p.phone)}">${esc(p.phone)}</a></div>` : ""}
            ${safeUrl(p.website) ? `<div class="place-fact">🌐 <a href="${esc(safeUrl(p.website))}" target="_blank" rel="noopener">Website</a></div>` : ""}

            ${weatherForPick(p)}

            ${p.lat != null ? `<div class="detail-map" id="detailMap"></div>` : ""}
            ${mapsUrl ? `<button class="modal-btn modal-btn-primary" data-open-maps="${esc(mapsUrl)}">📍 ${
              p.googleUrl ? "Open on Google Maps" : "Find on Google Maps"
            }</button>` : ""}

            <div class="settings-divider"></div>

            <label class="settings-label">Which days</label>
            <div class="day-assign-row">
              ${plan.days
                .map(
                  (d) =>
                    `<button class="day-chip${scheduled[d.id] ? " on" : ""}" data-assign-day="${esc(
                      p.id
                    )}|${esc(d.id)}">${esc(shortDayLabel(d.label))}</button>`
                )
                .join("")}
              <button class="day-chip add" data-day-sheet="${esc(p.id)}">${
                plan.days.length ? "+ Day" : "📅 Put it on a day"
              }</button>
            </div>

            ${
              // An area isn't in either list, so the choice would be a control
              // that does nothing.
              p.major
                ? ""
                : `<label class="settings-label">Shows up in</label>
            <div class="move-row">
              <button class="move-chip${pickKind(p) === "place" ? " active" : ""}" data-pick-kind="${esc(p.id)}|place">🏛️ Places</button>
              <button class="move-chip${pickKind(p) === "eat" ? " active" : ""}" data-pick-kind="${esc(p.id)}|eat">🍽️ Eats</button>
            </div>`
            }

            <label class="settings-label">What this is</label>
            <div class="move-row">
              <button class="move-chip${p.major ? "" : " active"}" data-pick-major="${esc(p.id)}|0">📍 Somewhere to go</button>
              <button class="move-chip${p.major ? " active" : ""}" data-pick-major="${esc(p.id)}|1">🏘️ A town or area</button>
            </div>
            <p class="settings-hint">A town or area heads its own section in Picks, and places you save near it are filed under it.</p>

            <label class="settings-label">Cost (optional)</label>
            <div class="cost-field">
              <span class="budget-currency">£</span>
              <input class="settings-input" type="number" inputmode="decimal" min="0" step="0.5"
                     placeholder="0" value="${pickCost(p) ? esc(String(pickCost(p))) : ""}"
                     data-pick-cost-detail="${esc(p.id)}" />
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
      setTimeout(() => {
        if (map._container && map._container.isConnected) map.invalidateSize();
      }, 60);
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

    // The app guesses from the place's category; this is how you overrule it
    // when the guess is wrong (a "museum café", a distillery you'd call food).
    placeModal.querySelectorAll("[data-pick-kind]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [id, kind] = btn.getAttribute("data-pick-kind").split("|");
        updatePick(id, { kind });
        placeModal.querySelectorAll("[data-pick-kind]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });

    // Promotion changes where the place lives in the list, so unlike the
    // toggles above it closes the sheet and re-renders rather than just
    // flipping a chip - the answer is the list behind it, not this button.
    placeModal.querySelectorAll("[data-pick-major]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [id, flag] = btn.getAttribute("data-pick-major").split("|");
        const on = flag === "1";
        const current = loadPicks().find((x) => x.id === id);
        if (!current || !!current.major === on) return;
        setPickMajor(id, on);
        closePlaceModal();
        renderPicks();
        if (on) offerToCollectNearby(loadPicks().find((x) => x.id === id));
        else toast(`${current.name} is an ordinary place again`);
      });
    });

    placeModal.querySelectorAll("[data-pick-cost-detail]").forEach((input) =>
      input.addEventListener("blur", () => {
        const v = input.value.trim();
        updatePick(input.getAttribute("data-pick-cost-detail"), { cost: v === "" ? null : Number(v) });
      })
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

    // Was a window.prompt - a system dialog in the wrong font, labelled with
    // the page origin, for a task the app already has a proper field for.
    // This reuses the folder sheet, so naming a new folder looks the same
    // wherever you do it.
    placeModal.querySelectorAll("[data-new-folder-for]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-new-folder-for");
        const p = loadPicks().find((x) => x.id === id);
        openFolderPicker(p ? p.name : "this place", p ? p.city : null, (folder) => {
          setPickCity(id, folder);
          renderPicks();
          toast(`Moved to ${folder}`);
        });
      });
    });

    placeModal.querySelectorAll("[data-day-sheet]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-day-sheet");
        closePlaceModal();
        openDaySheet(id);
      });
    });

    placeModal.querySelectorAll("[data-fix-location]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-fix-location");
        const target = loadPicks().find((x) => x.id === id);
        if (!target || !target.geoAlternatives) return;
        openLocationChooser({
          query: target.name,
          candidates: target.geoAlternatives,
          subtitle: "Which one is it? Everything else - the map, distances, the forecast - follows from this.",
          onPick: (c) => {
            // Settling it clears the doubt: the answer came from you, so
            // there is nothing left to flag.
            updatePick(id, {
              lat: c.lat,
              lon: c.lon,
              address: c.address || target.address || "",
              geoAlternatives: null,
            });
            renderPicks();
            toast(`${target.name} moved to ${c.label || "the place you chose"}`);
          },
        });
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
        closePlaceModal();
        removePickWithUndo(btn.getAttribute("data-remove-pick"), () =>
          showView(view.dataset.activeTab || "picks")
        );
      });
    });
  }

  // ---------- Suggest a trip: build the question, then the route ----------
  // Search answers a question you already know how to ask. "I'm in Edinburgh
  // and I want to head towards the Highlands, no more than 100 miles" is not
  // that: it is a shape of trip, and the hard part is knowing what to ask for
  // in the first place. Most people do not, which is why a blank box marked
  // "describe your trip" gets a one-word answer and a disappointing result.
  //
  // So the question is built rather than typed. Each part is a row of chips
  // drawn from what the app already knows - your saved areas, the days in your
  // plan, who is travelling - and every answer changes the advice on the parts
  // still to come: choose 250 miles for a day out and it says so. The sentence
  // at the top is the actual question, readable before it is asked.
  //
  // What comes back is several whole routes, not a list of places: each with
  // its days, its stops in driving order, and an alternative for every stop.
  // From there a trip is one tap - the stops are saved and laid out across
  // real days, which is the thing you wanted and could not otherwise get
  // without adding thirty places by hand.
  const ideaOverlay = document.getElementById("ideaOverlay");

  const IDEA_OPTION_COUNT = 3;
  const IDEA_MEASURE_MAX = 12; // geocode lookups per option, at 1/sec

  const IDEA_MILES = [25, 50, 100, 150, 250];
  const IDEA_SPANS = [
    { key: "1", label: "A day out", days: 1 },
    { key: "2", label: "2 days", days: 2 },
    { key: "3", label: "3 days", days: 3 },
    { key: "7", label: "A week", days: 7 },
  ];
  const IDEA_DIRECTIONS = ["north", "south", "east", "west", "the coast", "inland"];
  const IDEA_PACE = [
    { key: "easy", label: "Take it easy", line: "two or three stops a day, with time at each" },
    { key: "steady", label: "A steady pace", line: "three or four stops a day" },
    { key: "full", label: "See as much as we can", line: "as much as genuinely fits" },
  ];
  // Interests are category keys, so the user's own rewording of a category in
  // Settings reaches the trip planner too rather than only Explore.
  const IDEA_INTEREST_KEYS = [
    "historic", "viewpoint", "walk", "museum", "beach", "garden",
    "animals", "playground", "restaurant", "cafe", "pub", "market",
  ];

  const IDEA_KINDS = {
    see: { icon: "📷", label: "See", category: "Attraction" },
    eat: { icon: "🍽️", label: "Eat", category: "Restaurant" },
    stop: { icon: "🚗", label: "Stop", category: "Stop" },
    stay: { icon: "🛏️", label: "Stay", category: "Accommodation" },
  };

  function ideaKind(kind) {
    return IDEA_KINDS[String(kind || "").toLowerCase()] || IDEA_KINDS.stop;
  }

  function blankBrief() {
    return { from: "", towards: "", miles: null, spanKey: "", who: "", interests: [], pace: "", extra: "" };
  }

  let tripIdea = null;
  let ideaGeneration = 0;
  let ideaStartGeo = null; // {query, lat, lon} for the "how far is that really" check

  function loadIdea() {
    const stored = readJson(boardKey(activeBoard().id, "idea"), null) || {};
    const brief = Object.assign(blankBrief(), stored.brief || {});
    if (!Array.isArray(brief.interests)) brief.interests = [];
    if (!brief.who) brief.who = loadTripSettings().travellers || "";
    const options = normaliseIdeaOptions(stored.options);
    return {
      brief,
      options,
      // "loading" is never restored: a request that was in flight when the app
      // closed is not in flight now.
      status: options.length ? "done" : "idle",
      view: options.length ? "results" : "brief",
      step: 0,
      expanded: Math.min(Number(stored.expanded) || 0, Math.max(0, options.length - 1)),
      askedAs: String(stored.askedAs || ""),
      error: "",
    };
  }

  function saveIdea() {
    if (!tripIdea) return;
    localStorage.setItem(
      boardKey(activeBoard().id, "idea"),
      JSON.stringify({
        brief: tripIdea.brief,
        options: tripIdea.options,
        expanded: tripIdea.expanded,
        askedAs: tripIdea.askedAs,
      })
    );
  }

  // Everything the model sends back is treated as untrusted shape as well as
  // untrusted text: counts are clamped, types coerced, and anything without a
  // name is dropped rather than rendered as an empty row.
  function normaliseIdeaOptions(raw) {
    // Models are asked for {"options":[...]} and answer with that most of the
    // time. The rest of the time they answer with {"trips":[...]}, or an array
    // on its own, or the same thing under whatever key seemed natural - and
    // every one of those used to come out as "no trip", which is
    // indistinguishable from the request having failed.
    const named = ["options", "trips", "itineraries", "routes", "suggestions", "plans"];
    const listFrom = (v) => {
      // The same wrapper: [ { "options": [...] } ]. Unwrapped only when the
      // single element is a container rather than an option in its own right.
      if (Array.isArray(v) && v.length === 1 && v[0] && typeof v[0] === "object" && !Array.isArray(v[0])) {
        if (named.some((k) => Array.isArray(v[0][k]))) v = v[0];
      }
      if (Array.isArray(v)) return v;
      if (!v || typeof v !== "object") return [];
      for (const key of named) if (Array.isArray(v[key])) return v[key];
      // Nothing recognised by name: the only array of objects in there is
      // overwhelmingly likely to be it.
      const arrays = Object.keys(v)
        .map((k) => v[k])
        .filter((x) => Array.isArray(x) && x.length && typeof x[0] === "object");
      return arrays.length === 1 ? arrays[0] : [];
    };
    const stopsFrom = (d) => {
      if (Array.isArray(d)) return d;
      if (!d || typeof d !== "object") return [];
      for (const key of ["stops", "places", "items", "activities"]) if (Array.isArray(d[key])) return d[key];
      return [];
    };
    const list = listFrom(raw);
    return list
      .slice(0, 4)
      .map((o, oi) => {
        if (!o || typeof o !== "object") return null;
        const rawDays = Array.isArray(o.days) ? o.days : Array.isArray(o.itinerary) ? o.itinerary : [];
        const days = rawDays.slice(0, 10).map((d, di) => ({
          label: String((d && (d.label || d.day || d.title)) || `Day ${di + 1}`).slice(0, 40),
          stops: stopsFrom(d)
            .slice(0, 10)
            // A stop given as a bare name is still a stop.
            .map((s) => (typeof s === "string" ? { name: s } : s))
            .map((s) => {
              if (!s) return null;
              if (!s.name && s.place) s = Object.assign({}, s, { name: s.place });
              if (!s.name) return null;
              return {
                name: String(s.name).slice(0, 120),
                kind: String(s.kind || "stop").toLowerCase(),
                area: String(s.area || "").slice(0, 80),
                why: String(s.why || "").slice(0, 300),
                time: String(s.time || "").slice(0, 8),
                claimedMiles: Number(s.milesFromStart) >= 0 ? Math.round(Number(s.milesFromStart)) : null,
                alternatives: (Array.isArray(s.alternatives) ? s.alternatives : [])
                  .slice(0, 3)
                  .filter((a) => a && a.name)
                  .map((a) => ({
                    name: String(a.name).slice(0, 120),
                    area: String(a.area || "").slice(0, 80),
                    why: String(a.why || "").slice(0, 300),
                  })),
                lat: typeof s.lat === "number" ? s.lat : null,
                lon: typeof s.lon === "number" ? s.lon : null,
                address: String(s.address || "").slice(0, 200),
                crowMiles: typeof s.crowMiles === "number" ? s.crowMiles : null,
              };
            })
            .filter(Boolean),
        }));
        if (!days.some((d) => d.stops.length)) return null;
        return {
          title: String(o.title || o.name || `Option ${oi + 1}`).slice(0, 80),
          summary: String(o.summary || o.description || "").slice(0, 400),
          miles: Number(o.miles) > 0 ? Math.round(Number(o.miles)) : null,
          measured: !!o.measured,
          days: days.filter((d) => d.stops.length),
        };
      })
      .filter(Boolean);
  }

  function ideaSpanDays() {
    const b = tripIdea.brief;
    if (b.spanKey === "plan") return Math.max(1, loadPlan().days.length);
    const found = IDEA_SPANS.find((s) => s.key === b.spanKey);
    return found ? found.days : 0;
  }

  function ideaInterestLabels() {
    return tripIdea.brief.interests
      .map((k) => {
        const cat = findCategory(k);
        return cat ? cat.label.toLowerCase() : k;
      })
      .filter(Boolean);
  }

  // The question in plain English. It is the thing being asked, so it is shown
  // rather than described - "what will happen when I press the button" should
  // never be a matter of trust.
  function ideaSentence() {
    const b = tripIdea.brief;
    const blank = (text) => `<span class="idea-blank">${esc(text)}</span>`;
    const said = (text) => `<b>${esc(text)}</b>`;
    const days = ideaSpanDays();
    const pace = IDEA_PACE.find((p) => p.key === b.pace);
    const interests = ideaInterestLabels();

    const parts = [
      `I'm in ${b.from.trim() ? said(b.from.trim()) : blank("somewhere")}`,
      b.towards.trim() ? `heading ${said(b.towards.trim())}` : blank("heading anywhere"),
      b.miles ? `up to ${said(`${b.miles} miles`)} away` : blank("any distance"),
      days ? `over ${said(days === 1 ? "one day" : `${days} days`)}` : blank("for a day or two"),
    ];
    let text = parts.join(", ") + ".";
    if (b.who.trim()) text += ` We're ${said(b.who.trim())}.`;
    if (interests.length) text += ` We like ${said(interests.join(", "))}.`;
    if (pace) text += ` ${said(pace.label)}.`;
    if (b.extra.trim()) text += ` Also: ${said(b.extra.trim())}.`;
    return text;
  }

  function ideaSummaryLine() {
    const b = tripIdea.brief;
    const bits = [b.from.trim() || "anywhere"];
    if (b.towards.trim()) bits.push(b.towards.trim());
    if (b.miles) bits.push(`${b.miles} mi`);
    const days = ideaSpanDays();
    if (days) bits.push(days === 1 ? "1 day" : `${days} days`);
    return bits.join(" · ");
  }

  // The advice that changes as the question is built. Every one of these reads
  // the answers already given: this is the part that makes a question builder
  // worth more than the same fields on a form.
  function ideaHint(key) {
    const b = tripIdea.brief;
    const days = ideaSpanDays();
    const areas = loadPicks().filter((p) => p.major).length;

    switch (key) {
      case "from":
        if (!b.from.trim()) {
          return areas
            ? "Where the trip starts. Your saved areas are here, or type anywhere."
            : "Where the trip starts — a town or city, or where you are right now.";
        }
        return `Everything else is measured from ${b.from.trim()}.`;
      case "towards":
        if (!b.towards.trim()) {
          return b.from.trim()
            ? `Optional. A direction from ${b.from.trim()}, or a region you have in mind — leave it open and you'll get a spread.`
            : "Optional — a direction or a region, if you have one in mind.";
        }
        return `The suggestions will follow ${b.towards.trim()} rather than spreading in every direction.`;
      case "miles":
        if (!b.miles) return "How far from the start you're willing to go. Straight-line, roughly — roads are longer.";
        if (b.miles <= 50) return `${b.miles} miles is an easy out-and-back with time at each stop.`;
        if (b.miles <= 100) {
          if (days > 1) return `${b.miles} miles across ${days} days is comfortable — you can stop properly rather than driving past things.`;
          if (days === 1) return `${b.miles} miles there and back is most of a day's driving. Expect two or three stops, not five.`;
          return `${b.miles} miles is a day's drive there and back, or an easy two days.`;
        }
        if (days > 1) return `${b.miles} miles is a real distance — worth an overnight rather than doubling back.`;
        if (days === 1) return `${b.miles} miles in one day is mostly driving. Two days would suit it better.`;
        return `${b.miles} miles is a long way for a day out — say how long you have and I'll say whether it fits.`;
      case "span": {
        const planned = loadPlan().days.length;
        if (!days) {
          return planned
            ? `How long you've got. You already have ${planned} day${planned === 1 ? "" : "s"} planned — I can fit the trip to those.`
            : "How long you've got. Days get made for you at the end — nothing to set up first.";
        }
        if (days === 1) return "One day. The suggestions will stay close enough to get home.";
        return `${days} days. Each one gets its own stops, in the order you'd drive them.`;
      }
      case "interests": {
        const chosen = ideaInterestLabels();
        if (!chosen.length) return "Pick a few. Anything you skip, the suggestions decide for you.";
        if (chosen.length > 5) return `${chosen.length} is a lot to fit — the first few carry the most weight.`;
        return `Looking for ${chosen.join(", ")}.`;
      }
      case "pace": {
        const pace = IDEA_PACE.find((p) => p.key === b.pace);
        if (!pace) return "How full you want the days to be.";
        // Two answers that fight each other, said once rather than silently
        // producing a plan nobody can actually do.
        if (pace.key === "full" && /child|toddler|kid|year-old|baby|pram|buggy/i.test(b.who)) {
          return `${pace.line} — though with a young child that is usually one stop more than the day has in it.`;
        }
        if (pace.key === "full" && days === 1 && b.miles > 100) {
          return `${pace.line} — with ${b.miles} miles to cover in a day, most of it will be the drive.`;
        }
        return pace.line;
      }
      case "who":
        return b.who.trim()
          ? "Used here and everywhere else the app asks the AI for something."
          : "Who's going. It changes the answers more than anything else here.";
      case "extra":
        return "Anything the rows above don't cover — “no motorways”, “we have the dog”, “back by six”.";
      default:
        return "";
    }
  }

  // One question a screen, with Next under your thumb. The first version put
  // all eight rows on one page, which meant scrolling down to answer and back
  // up to see the sentence you were building - the answers and the thing they
  // were adding up to could never be on screen together.
  //
  // A step is small enough that both fit: the question, its advice, the chips,
  // and the sentence so far. Nothing here is required except where you are
  // starting from, so Next is always the way forward and Skip is not a
  // separate idea. The dots are tappable and Back always works, so nothing is
  // one-way: it is a carousel, not a funnel.
  const IDEA_STEPS = [
    { key: "from", title: "Where are you starting from?", short: "From" },
    { key: "towards", title: "Which way do you want to head?", short: "Towards" },
    // Time before distance, deliberately: how long you have is what makes a
    // distance sensible or silly, and the advice on the next screen can only
    // say which if it already knows.
    { key: "span", title: "How long have you got?", short: "Time" },
    { key: "miles", title: "How far will you go?", short: "Distance" },
    { key: "interests", title: "What are you after?", short: "Interests" },
    { key: "pace", title: "How full should the days be?", short: "Pace" },
    { key: "who", title: "Who's going?", short: "Who" },
    { key: "extra", title: "Anything else?", short: "Extra" },
    { key: "review", title: "Ready to ask?", short: "Review" },
  ];

  function ideaStepIndex() {
    return Math.max(0, Math.min(IDEA_STEPS.length - 1, Number(tripIdea.step) || 0));
  }

  function ideaAnswered(key) {
    const b = tripIdea.brief;
    switch (key) {
      case "from": return !!b.from.trim();
      case "towards": return !!b.towards.trim();
      case "miles": return !!b.miles;
      case "span": return !!b.spanKey;
      case "interests": return !!b.interests.length;
      case "pace": return !!b.pace;
      case "who": return !!b.who.trim();
      case "extra": return !!b.extra.trim();
      default: return false;
    }
  }

  // Where to drop someone in: the first thing they have not answered, so
  // coming back to an unfinished question carries on rather than restarting.
  function ideaFirstUnanswered() {
    const at = IDEA_STEPS.findIndex((s) => s.key !== "review" && !ideaAnswered(s.key));
    return at < 0 ? IDEA_STEPS.length - 1 : at;
  }

  const ideaChip = (label, attrs, on) =>
    `<button class="search-chip idea-chip${on ? " on" : ""}" ${attrs}>${esc(label)}</button>`;

  const ideaSetChip = (key, value, label, on) =>
    ideaChip(label, `data-idea-key="${esc(key)}" data-idea-value="${esc(String(value))}"`, on);

  function ideaChipsFor(key) {
    const b = tripIdea.brief;
    const picks = loadPicks();

    if (key === "from") {
      // Starting points worth offering: the areas you have saved, the folders
      // you file under, and the trip's own region. Deduplicated, because those
      // three overlap almost by definition.
      const dest = (activeBoard().destination || loadTripSettings().destination || "").trim();
      const names = [];
      picks.filter((p) => p.major).forEach((p) => names.push(p.name));
      loadFolders().forEach((f) => {
        if (f !== "Unsorted") names.push(f);
      });
      if (dest) names.push(dest);
      return (
        ideaChip("📍 Where I am now", 'id="ideaGps" data-idea-gps="1"', false) +
        names
          .filter((n, i) => n && names.indexOf(n) === i)
          .slice(0, 8)
          .map((n) => ideaSetChip("from", n, n, b.from.trim() === n))
          .join("")
      );
    }

    if (key === "towards") {
      return (
        ideaSetChip("towards", "", "Anywhere", !b.towards.trim()) +
        IDEA_DIRECTIONS.map((d) => ideaSetChip("towards", d, d, b.towards.trim() === d)).join("") +
        picks
          .filter((p) => p.major && p.name !== b.from.trim())
          .slice(0, 4)
          .map((p) =>
            ideaSetChip("towards", `towards ${p.name}`, `towards ${p.name}`, b.towards.trim() === `towards ${p.name}`)
          )
          .join("")
      );
    }

    if (key === "miles") {
      return (
        IDEA_MILES.map((m) => ideaSetChip("miles", m, `${m} miles`, b.miles === m)).join("") +
        ideaSetChip("miles", "", "No limit", !b.miles)
      );
    }

    if (key === "span") {
      const planned = loadPlan().days.length;
      return (
        IDEA_SPANS.map((s) => ideaSetChip("spanKey", s.key, s.label, b.spanKey === s.key)).join("") +
        (planned
          ? ideaSetChip("spanKey", "plan", `The ${planned} day${planned === 1 ? "" : "s"} I have`, b.spanKey === "plan")
          : "")
      );
    }

    if (key === "interests") {
      return IDEA_INTEREST_KEYS.map((k) => {
        const cat = findCategory(k);
        return cat ? ideaChip(`${cat.icon} ${cat.label}`, `data-idea-interest="${esc(k)}"`, b.interests.includes(k)) : "";
      }).join("");
    }

    if (key === "pace") {
      return IDEA_PACE.map((p) => ideaSetChip("pace", p.key, p.label, b.pace === p.key)).join("");
    }

    return "";
  }

  const IDEA_FIELDS = {
    from: "e.g. Edinburgh",
    towards: "e.g. towards the Highlands",
    who: "e.g. family of 3, 4-year-old who walks",
    extra: "e.g. no motorways, back by six",
  };

  function ideaFieldFor(key) {
    if (!IDEA_FIELDS[key]) return "";
    return `<input class="settings-input idea-input" type="text" data-idea-text="${esc(key)}"
                   placeholder="${esc(IDEA_FIELDS[key])}" value="${esc(tripIdea.brief[key] || "")}" />`;
  }

  function ideaProgressHtml() {
    const at = ideaStepIndex();
    const dots = IDEA_STEPS.map((s, i) => {
      const state = i === at ? " now" : ideaAnswered(s.key) ? " on" : "";
      return `<button class="idea-dot${state}" data-idea-step="${i}" aria-label="${esc(s.short)}"
                      aria-current="${i === at ? "step" : "false"}"></button>`;
    }).join("");
    return `
      <div class="idea-progress">
        <div class="idea-dots">${dots}</div>
        <span class="idea-count">${at + 1} of ${IDEA_STEPS.length}</span>
      </div>
    `;
  }

  // The last screen: the whole question in one piece, with every part a way
  // back to the step that set it. A wizard that cannot show you what you built
  // is just a form with the answers hidden behind Back.
  function ideaReviewHtml() {
    const rows = IDEA_STEPS.filter((s) => s.key !== "review")
      .map((s, i) => {
        const answered = ideaAnswered(s.key);
        return `
          <button class="idea-review-row" data-idea-step="${i}">
            <span class="idea-review-label">${esc(s.short)}</span>
            <span class="idea-review-value${answered ? "" : " empty"}">${esc(ideaAnswerText(s.key))}</span>
            <span class="idea-review-edit">Change</span>
          </button>
        `;
      })
      .join("");

    return `
      <p class="idea-sentence" id="ideaSentence">${ideaSentence()}</p>
      <div class="idea-review">${rows}</div>
    `;
  }

  function ideaAnswerText(key) {
    const b = tripIdea.brief;
    switch (key) {
      case "from": return b.from.trim() || "not said";
      case "towards": return b.towards.trim() || "anywhere";
      case "miles": return b.miles ? `${b.miles} miles` : "no limit";
      case "span": {
        const days = ideaSpanDays();
        return days ? (days === 1 ? "one day" : `${days} days`) : "not said";
      }
      case "interests": return ideaInterestLabels().join(", ") || "anything";
      case "pace": {
        const pace = IDEA_PACE.find((p) => p.key === b.pace);
        return pace ? pace.label : "not said";
      }
      case "who": return b.who.trim() || "not said";
      case "extra": return b.extra.trim() || "nothing";
      default: return "";
    }
  }

  function ideaBriefHtml() {
    const at = ideaStepIndex();
    const step = IDEA_STEPS[at];
    const isReview = step.key === "review";

    return `
      ${ideaProgressHtml()}
      <section class="idea-step" data-idea-slot="${esc(step.key)}" data-idea-step-key="${esc(step.key)}">
        <h2 class="idea-step-title">${esc(step.title)}</h2>
        <p class="idea-slot-hint">${esc(
          isReview
            ? "Change anything that isn't right, then ask. It keeps, so you can come back and change one thing."
            : ideaHint(step.key)
        )}</p>
        ${
          isReview
            ? ideaReviewHtml()
            : `${(() => {
                const chips = ideaChipsFor(step.key);
                return chips ? `<div class="search-chips idea-chips">${chips}</div>` : "";
              })()}
               ${ideaFieldFor(step.key)}
               <div class="idea-so-far">
                 <span class="idea-so-far-label">So far</span>
                 <p class="idea-sentence idea-sentence-soft" id="ideaSentence">${ideaSentence()}</p>
               </div>`
        }
      </section>
    `;
  }

  function ideaNavHtml() {
    const at = ideaStepIndex();
    const step = IDEA_STEPS[at];
    const isReview = step.key === "review";
    // Nothing is compulsory except where you are starting from, so the button
    // says what pressing it does: Next when you have answered, Skip when you
    // have not, and neither is a dead end. The one required answer is the
    // exception - "Skip" on a button that cannot be pressed is a contradiction.
    const blocked = step.key === "from" && !tripIdea.brief.from.trim();
    const label = isReview ? "✨ Suggest trips" : ideaAnswered(step.key) || blocked ? "Next" : "Skip";
    return `
      <div class="idea-nav">
        <button class="modal-btn idea-back" data-idea-move="-1" ${at === 0 ? "disabled" : ""}>Back</button>
        <button class="modal-btn modal-btn-primary idea-forward" id="${isReview ? "ideaRun" : "ideaNext"}"
                ${blocked ? "disabled" : ""}>${label}</button>
      </div>
      ${
        blocked
          ? `<p class="settings-hint idea-nav-hint">Needed — everything else is measured from here.</p>`
          : ""
      }
    `;
  }

  function ideaGo(delta) {
    const at = ideaStepIndex();
    const next = Math.max(0, Math.min(IDEA_STEPS.length - 1, at + delta));
    if (next === at) return;
    // Blocked only forwards: going back from an unanswered first step is not
    // possible anyway, and trapping someone on a screen is never the answer.
    if (delta > 0 && IDEA_STEPS[at].key === "from" && !tripIdea.brief.from.trim()) return;
    ideaSlide = delta > 0 ? "next" : "back";
    tripIdea.step = next;
    saveIdea();
    renderIdea();
  }

  function ideaJump(index) {
    const at = ideaStepIndex();
    if (index === at) return;
    if (index > at && !tripIdea.brief.from.trim()) return;
    ideaSlide = index > at ? "next" : "back";
    tripIdea.step = index;
    saveIdea();
    renderIdea();
  }

  let ideaSlide = "";

  // Typing has to change the screen without replacing it: a redraw mid-word
  // takes the caret with it. So the three things that actually depend on the
  // field are updated in place - the sentence, the advice, and whether the
  // button says Skip or Next.
  function refreshIdeaLive() {
    const step = IDEA_STEPS[ideaStepIndex()];
    const sentence = document.getElementById("ideaSentence");
    if (sentence) sentence.innerHTML = ideaSentence();
    const hint = ideaOverlay.querySelector(".idea-step .idea-slot-hint");
    if (hint && step.key !== "review") hint.textContent = ideaHint(step.key);
    const forward = ideaOverlay.querySelector(".idea-forward");
    if (forward && step.key !== "review") {
      const blocked = step.key === "from" && !tripIdea.brief.from.trim();
      forward.textContent = ideaAnswered(step.key) || blocked ? "Next" : "Skip";
      forward.disabled = blocked;
    }
    const dot = ideaOverlay.querySelector(".idea-dot.now");
    if (dot) dot.classList.toggle("on", ideaAnswered(step.key));
  }

  function ideaStopHtml(oi, di, si, stop, radius) {
    const kind = ideaKind(stop.kind);
    const saved = loadPicks().some((p) => p.id === pickId("custom", stop.name));
    const miles = stop.crowMiles != null ? stop.crowMiles : stop.claimedMiles;
    const over = radius && stop.crowMiles != null && stop.crowMiles > radius;
    const path = `${oi}|${di}|${si}`;
    const meta = [stop.area, miles != null ? `${miles} mi out` : ""].filter(Boolean).join(" · ");

    // The actions sit under the text rather than beside it. Stacked in a
    // column they were three rows deep, which made every stop 145px tall - a
    // twelve-stop route was most of two thousand pixels of scrolling.
    return `
      <div class="idea-stop${over ? " over" : ""}">
        <button class="result-tap idea-stop-main" data-idea-preview="${esc(path)}">
          <span class="idea-stop-name">
            <span class="idea-stop-kind" title="${esc(kind.label)}">${kind.icon}</span>
            ${esc(stop.name)}${stop.time ? ` <span class="idea-stop-time">${esc(stop.time)}</span>` : ""}
          </span>
          ${meta ? `<span class="idea-stop-meta">${esc(meta)}</span>` : ""}
          ${stop.why ? `<span class="idea-stop-why">${esc(stop.why)}</span>` : ""}
          ${
            over
              ? `<span class="idea-stop-warn">⚠ ${esc(String(stop.crowMiles))} miles from ${esc(
                  tripIdea.brief.from.trim()
                )} in a straight line — past your ${esc(String(radius))}</span>`
              : ""
          }
        </button>
        <div class="idea-stop-actions">
          ${
            // Named, not an icon. "🔄" gave no clue what it would swap to, and
            // the answer - the name of the other place - is the only thing
            // that would make the button worth pressing.
            stop.alternatives.length
              ? `<button class="idea-swap" data-idea-swap="${esc(path)}">⇄ ${
                  stop.alternatives.length > 1
                    ? `${esc(String(stop.alternatives.length))} alternatives`
                    : `or ${esc(stop.alternatives[0].name)}`
                }</button>`
              : `<span class="idea-swap-spacer"></span>`
          }
          <button class="search-around" data-idea-day="${esc(path)}"
                  aria-label="Put ${esc(stop.name)} on a day">📅</button>
          <button class="candidate-add${saved ? " saved" : ""}" data-idea-add="${esc(path)}"
                  aria-label="${saved ? "Saved" : `Save ${esc(stop.name)}`}">${saved ? "✓ Saved" : "＋ Save"}</button>
        </div>
      </div>
    `;
  }

  // What a route actually is, in one line: the places it goes through. Two
  // collapsed cards you can compare beat one expanded card and two you have to
  // remember, and this is the line that makes comparing them possible.
  function ideaRouteLine(option) {
    const seen = [];
    option.days.forEach((d) =>
      d.stops.forEach((s) => {
        const where = (s.area || s.name || "").trim();
        if (where && !seen.some((x) => x.toLowerCase() === where.toLowerCase())) seen.push(where);
      })
    );
    if (!seen.length) return "";
    return seen.length > 5 ? `${seen.slice(0, 5).join(" → ")} → +${seen.length - 5} more` : seen.join(" → ");
  }

  function ideaResultsHtml() {
    const b = tripIdea.brief;

    if (tripIdea.status === "loading") {
      return `
        <div class="card idea-loading">
          <p class="pick-status">Working out some routes…</p>
          <p class="settings-hint">${esc(ideaSummaryLine())}</p>
          <button class="modal-btn" data-idea-cancel="1" style="margin-top:14px;">Stop waiting</button>
        </div>
      `;
    }

    if (tripIdea.status === "error") {
      return `
        <div class="card">
          <h2 class="modal-title">That didn't work</h2>
          <p class="pick-status">${esc(tripIdea.error)}</p>
          <div class="settings-btn-row">
            <button class="modal-btn modal-btn-primary" id="ideaRetry">Try again</button>
            <button class="modal-btn" data-idea-edit="1">Change the question</button>
          </div>
        </div>
      `;
    }

    // Kept to two lines. What was asked explains what came back and has to be
    // here, but a full screen of preamble before the first result is a page of
    // scrolling to reach the thing you came for.
    let html = `
      <div class="idea-asked">
        <p class="idea-asked-line">${ideaSentence()}</p>
        <button class="link-btn" data-idea-edit="1">Change the question</button>
      </div>
    `;

    tripIdea.options.forEach((option, oi) => {
      const open = tripIdea.expanded === oi;
      const stopCount = option.days.reduce((n, d) => n + d.stops.length, 0);
      const meta = [
        `${option.days.length} day${option.days.length === 1 ? "" : "s"}`,
        `${stopCount} stop${stopCount === 1 ? "" : "s"}`,
        option.miles ? `about ${option.miles} miles` : "",
      ]
        .filter(Boolean)
        .join(" · ");

      const route = ideaRouteLine(option);
      html += `
        <div class="card idea-option${open ? " open" : ""}">
          <button class="idea-option-head" data-idea-option="${oi}" aria-expanded="${open ? "true" : "false"}">
            <span class="idea-option-title">${esc(option.title)}</span>
            <span class="idea-option-meta">${esc(meta)}</span>
            ${option.summary ? `<span class="idea-option-summary">${esc(option.summary)}</span>` : ""}
            ${route ? `<span class="idea-option-route">${esc(route)}</span>` : ""}
            <span class="idea-option-chevron">${open ? "Hide the stops ⌃" : "See the stops ⌄"}</span>
          </button>
      `;

      if (open) {
        option.days.forEach((day, di) => {
          html += `<div class="idea-day"><div class="idea-day-label">${esc(day.label)}</div>`;
          day.stops.forEach((stop, si) => {
            html += ideaStopHtml(oi, di, si, stop, b.miles);
          });
          html += `</div>`;
        });
        html += `
          <div class="settings-btn-row idea-option-actions">
            <button class="modal-btn modal-btn-primary" data-idea-use="${oi}">Build this trip</button>
            <button class="modal-btn" data-idea-saveall="${oi}">Save the places</button>
          </div>
          <p class="settings-hint">Building it saves every stop and lays them out across days — you can move anything afterwards.</p>
        `;
      }
      html += `</div>`;
    });

    html += `
      <form class="search-bar refine-bar" id="ideaRefineForm">
        <input type="text" id="ideaRefineInput" placeholder="Not quite? Tell the AI what to change"
               autocomplete="off" value="${esc(b.extra || "")}" />
        <button type="submit" aria-label="Ask again with this">Again</button>
      </form>
    `;
    return html;
  }

  let ideaScreenId = "";

  // A throw while drawing or wiring an overlay leaves the screen exactly as it
  // was with none of its buttons connected - which from the outside is "nothing
  // is clickable", with nothing on screen to say why. Views already had this
  // guard; the overlays did not.
  function guarded(name, fn) {
    try {
      fn();
    } catch (e) {
      console.error(`${name} failed:`, e);
      toast(`${name} hit a problem: ${(e && e.message) || e}`);
      throw e;
    }
  }

  function renderIdea() {
    if (!tripIdea) return;
    const showResults = tripIdea.view === "results";
    const slide = ideaSlide ? ` idea-slide-${ideaSlide}` : "";
    ideaSlide = "";
    // Redrawing throws the scroll position away, and the distance check redraws
    // once per lookup - so reading the third route meant being thrown back to
    // the top a dozen times while the mileages came in. Keep the position when
    // it is the same screen; start at the top when it is a different one.
    const previous = ideaOverlay.querySelector(".search-body");
    const previousScroll = previous ? previous.scrollTop : 0;
    const screenId = `${tripIdea.view}|${ideaStepIndex()}|${tripIdea.expanded}|${tripIdea.status}`;
    ideaOverlay.innerHTML = `
      <div class="search-head">
        <button class="search-back" data-idea-close="1" aria-label="Close">←</button>
        <div class="idea-head-text">
          <div class="idea-head-title">${showResults ? "Trip suggestions" : "Plan a trip"}</div>
          <div class="idea-head-sub">${
            showResults ? esc(ideaSummaryLine()) : "Answer as much or as little as you like"
          }</div>
        </div>
      </div>
      <div class="search-body${showResults ? "" : ` idea-body${slide}`}">${
        showResults ? ideaResultsHtml() : ideaBriefHtml()
      }</div>
      ${showResults ? "" : ideaNavHtml()}
    `;
    ideaOverlay.classList.add("open");
    const body = ideaOverlay.querySelector(".search-body");
    if (body) body.scrollTop = screenId === ideaScreenId ? previousScroll : 0;
    ideaScreenId = screenId;
  }

  function openTripIdea() {
    // It can be reached from the search screen, and two full-screen overlays
    // stacked on each other is one back press too many.
    if (searchOverlay.classList.contains("open")) closeSearchOverlay();
    tripIdea = loadIdea();
    // Carry on where the question was left rather than starting it again.
    tripIdea.step = ideaFirstUnanswered();
    renderIdea();
  }

  function closeIdea() {
    ideaOverlay.classList.remove("open");
    ideaOverlay.innerHTML = "";
    if (tripIdea) saveIdea();
    if (view.dataset.activeTab) showView(view.dataset.activeTab);
  }

  function ideaStopAt(path) {
    const [oi, di, si] = String(path).split("|").map(Number);
    const option = tripIdea.options[oi];
    const day = option && option.days[di];
    const stop = day && day.stops[si];
    return stop ? { option, day, stop, oi, di, si } : null;
  }

  // A suggestion, in the shape the rest of the app already understands - so a
  // stop can be previewed, saved and enriched by exactly the same code that
  // handles a search result. Deliberately no displayName unless a real address
  // has been resolved: the geocoder hint wants the town, not "Name, Town".
  function ideaCandidate(stop) {
    return {
      name: stop.name,
      area: stop.area || "",
      city: stop.area || "",
      address: stop.address || "",
      displayName: stop.address || "",
      description: stop.why || "",
      category: ideaKind(stop.kind).category,
      lat: stop.lat != null ? stop.lat : null,
      lon: stop.lon != null ? stop.lon : null,
      aiSuggested: true,
    };
  }

  // A road trip is organised by the towns it passes through, which is what the
  // Picks list already does with areas. So a stop is filed under its own town,
  // creating that folder if it is new - the alternative is thirty places in
  // Unsorted, which is no filing at all.
  function ideaFolderFor(stop) {
    const area = (stop.area || "").trim();
    const folders = loadFolders();
    const existing = folders.find((f) => f.toLowerCase() === area.toLowerCase());
    if (existing) return existing;
    const confident = stop.lat != null ? confidentFolderFor(stop.lat, stop.lon) : null;
    if (confident && confident !== "Unsorted") return confident;
    if (area) return addFolder(area) || "Unsorted";
    return "Unsorted";
  }

  function ideaSaveStop(stop) {
    const candidate = ideaCandidate(stop);
    const id = pickId("custom", candidate.name);
    // confirmAddCandidate saves synchronously and only then goes off to
    // geocode, so several in a row do not race each other.
    if (!loadPicks().some((p) => p.id === id)) confirmAddCandidate(candidate, ideaFolderFor(stop));
    return id;
  }

  // Days for a route: the ones already in the plan, in date order, and any
  // still needed made as consecutive dates after them. A plan that starts on
  // the 18th gets the 18th, 19th, 20th - not three days bolted onto today.
  function ideaDaysFor(option) {
    const plan = loadPlan();
    const dated = datedDays(plan.days).filter((x) => x.when).sort((a, b) => a.when - b.when);
    const start = dated.length ? dated[0].when : new Date();
    const ids = [];
    for (let i = 0; i < option.days.length; i++) {
      ids.push(ensureDayFor(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
    }
    return ids;
  }

  function useIdeaOption(index) {
    const option = tripIdea.options[index];
    if (!option) return;
    const dayIds = ideaDaysFor(option);
    let placed = 0;
    option.days.forEach((day, di) => {
      const dayId = dayIds[di];
      if (!dayId) return;
      day.stops.forEach((stop) => {
        const id = ideaSaveStop(stop);
        addToPlan(dayId, id);
        // A time only if the model gave one. Inventing "10:00" for everything
        // reads as a schedule somebody decided, and it wasn't.
        if (stop.time) setPlanItemTime(dayId, id, stop.time);
        placed++;
      });
    });
    saveIdea();
    closeIdea();
    showView("itinerary");
    toast(`${option.title} — ${placed} stops across ${dayIds.length} day${dayIds.length === 1 ? "" : "s"}`);
  }

  function saveIdeaOptionPlaces(index) {
    const option = tripIdea.options[index];
    if (!option) return;
    let added = 0;
    option.days.forEach((day) =>
      day.stops.forEach((stop) => {
        if (!loadPicks().some((p) => p.id === pickId("custom", stop.name))) added++;
        ideaSaveStop(stop);
      })
    );
    renderIdea();
    toast(added ? `Saved ${added} place${added === 1 ? "" : "s"} to Picks` : "Already saved");
  }

  // Where the trip starts, as coordinates, so "no more than 100 miles" can be
  // checked rather than taken on trust. Cached per query - it does not change
  // while the question stays the same.
  async function ideaStartPoint() {
    const from = tripIdea.brief.from.trim();
    if (!from) return null;
    if (ideaStartGeo && ideaStartGeo.query === from) return ideaStartGeo;
    let geo = null;
    try {
      geo = await geocodePlace(from, null);
    } catch (e) {
      geo = null;
    }
    ideaStartGeo = geo ? { query: from, lat: geo.lat, lon: geo.lon } : null;
    return ideaStartGeo;
  }

  // The model's mileage is a claim; this is a measurement. Stops are looked up
  // one at a time (Nominatim asks for a request a second) and the screen
  // updates as each lands, so a route with a stop 200 miles away says so
  // rather than looking like every other route.
  async function measureIdeaOption(index) {
    const generation = ideaGeneration;
    const option = tripIdea.options[index];
    if (!option || option.measured) return;
    option.measured = true;
    const start = await ideaStartPoint();
    const radius = tripIdea.brief.miles;
    const stops = [];
    option.days.forEach((day, di) =>
      day.stops.forEach((stop, si) => {
        stop.path = `${index}|${di}|${si}`;
        stops.push(stop);
      })
    );
    stops.length = Math.min(stops.length, IDEA_MEASURE_MAX);

    for (const stop of stops) {
      if (generation !== ideaGeneration || !ideaOverlay.classList.contains("open")) return;
      if (stop.lat != null && stop.crowMiles != null) continue;
      if (stop.lat == null) {
        let geo = null;
        try {
          geo = await geocodePlace(
            stop.name,
            stop.area || null,
            start ? { name: tripIdea.brief.from, lat: start.lat, lon: start.lon, miles: tripIdea.brief.miles || 150 } : null
          );
        } catch (e) {
          geo = null;
        }
        if (geo) {
          stop.lat = geo.lat;
          stop.lon = geo.lon;
          stop.address = geo.address || "";
        }
      }
      if (start && stop.lat != null && stop.crowMiles == null) {
        stop.crowMiles = Math.round(toMiles(haversineKm(start.lat, start.lon, stop.lat, stop.lon)));
      }
      // Deliberately NOT a redraw. Rebuilding the screen after every lookup
      // destroys every button on it, and a tap that begins on a button which
      // is replaced before the click lands is simply lost. With a lookup a
      // second and a dozen stops, that is ten seconds in which the screen
      // looks finished and answers nothing - which is exactly what "nothing
      // is clickable" was.
      refreshStopMeasurement(stop, radius);
    }
    saveIdea();
  }

  // Updates what the measurement changes - the distance line, and the flag if
  // it turned out to be too far - by writing text into the row that is already
  // there. Nothing is replaced, so nothing being pressed can vanish.
  function refreshStopMeasurement(stop, radius) {
    if (!stop.path) return;
    const main = ideaOverlay.querySelector(`[data-idea-preview="${stop.path}"]`);
    if (!main) return;
    const row = main.closest(".idea-stop");
    const miles = stop.crowMiles != null ? stop.crowMiles : stop.claimedMiles;
    const meta = [stop.area, miles != null ? `${miles} mi out` : ""].filter(Boolean).join(" · ");

    let metaEl = main.querySelector(".idea-stop-meta");
    if (!metaEl && meta) {
      metaEl = document.createElement("span");
      metaEl.className = "idea-stop-meta";
      main.insertBefore(metaEl, main.querySelector(".idea-stop-why"));
    }
    if (metaEl) metaEl.textContent = meta;

    const over = !!(radius && stop.crowMiles != null && stop.crowMiles > radius);
    if (row) row.classList.toggle("over", over);
    let warn = main.querySelector(".idea-stop-warn");
    if (over && !warn) {
      warn = document.createElement("span");
      warn.className = "idea-stop-warn";
      main.appendChild(warn);
    }
    if (warn) {
      if (over) {
        warn.textContent = `⚠ ${stop.crowMiles} miles from ${tripIdea.brief.from.trim()} in a straight line — past your ${radius}`;
      } else {
        warn.remove();
      }
    }
  }

  async function runTripIdea() {
    const key = loadTripSettings().geminiKey.trim();
    if (!key) {
      closeIdea();
      openSettings();
      toast("Add a Gemini key and this can plan trips");
      return;
    }
    const b = tripIdea.brief;
    if (!b.from.trim()) {
      tripIdea.view = "brief";
      tripIdea.step = 0;
      renderIdea();
      const field = ideaOverlay.querySelector('[data-idea-text="from"]');
      if (field) field.focus();
      toast("Where are you starting from?");
      return;
    }
    // Said once here, it applies to search and Explore too - the same fact
    // should not need typing in three places.
    if (b.who.trim() && b.who.trim() !== loadTripSettings().travellers.trim()) {
      saveTripSettings({ travellers: b.who.trim() });
    }

    const generation = ++ideaGeneration;
    tripIdea.status = "loading";
    tripIdea.view = "results";
    tripIdea.error = "";
    renderIdea();

    try {
      // Grounded first: checking the places exist is worth a lot. But grounded
      // replies come back as prose with citations often enough that asking for
      // a whole trip's JSON that way fails outright - which is what "it just
      // doesn't return anything" was. So a second attempt goes without search
      // and with the API's own JSON mode, which cannot answer in prose.
      let options = [];
      let raw = "";
      for (const attempt of [{ grounded: true, maxTokens: 8192 }, { json: true, maxTokens: 8192 }]) {
        const { text } = await callGemini(key, ideaPrompt(), attempt);
        if (generation !== ideaGeneration) return;
        raw = text;
        options = normaliseIdeaOptions(extractJson(text));
        if (options.length) break;
      }
      if (!options.length) {
        throw new Error(
          `The model answered, but not with a trip that could be read.${
            raw ? ` It said: "${raw.trim().slice(0, 160)}…"` : " It sent nothing at all."
          }`
        );
      }
      tripIdea.options = options;
      // All closed: the first question is which route, and one opened by
      // default puts the other two below a screen and a half of stops, where
      // they cannot be compared with it or with each other.
      tripIdea.expanded = -1;
      tripIdea.status = "done";
      tripIdea.askedAs = ideaSummaryLine();
    } catch (e) {
      if (generation !== ideaGeneration) return;
      tripIdea.status = "error";
      tripIdea.error = (e && e.message) || String(e);
    }
    saveIdea();
    renderIdea();
    // Measured while you are still reading the summaries, so the first route
    // you open already knows its real distances.
    if (tripIdea.status === "done") measureIdeaOption(0);
  }

  function ideaPrompt() {
    const b = tripIdea.brief;
    const days = ideaSpanDays();
    const settings = loadTripSettings();
    const dest = (activeBoard().destination || settings.destination || "").trim();
    const from = b.from.trim();
    const scopedFrom =
      dest && !new RegExp(`\\b${dest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(from)
        ? `${from}, ${dest}`
        : from;

    const facts = [`Starting point: ${scopedFrom}`];
    if (b.towards.trim()) facts.push(`Heading: ${b.towards.trim()}`);
    facts.push(
      b.miles
        ? `Maximum distance from the start: ${b.miles} miles`
        : "No distance limit given - keep it to what the time allows"
    );
    facts.push(days ? `Time available: ${days === 1 ? "one day" : `${days} days`}` : "Time available: a day out");
    const who = (b.who || settings.travellers || "").trim();
    if (who) facts.push(`Travellers: ${who}`);
    if (settings.preferences.trim()) facts.push(`What matters to us: ${settings.preferences.trim()}`);
    if (b.interests.length) {
      // The category's own long phrasing is right for a single-category search
      // and wrong here: twelve of them turned the request into pages of
      // instruction, and what came back was truncated or nothing at all.
      const wanted = b.interests
        .slice(0, 6)
        .map((k) => {
          const cat = findCategory(k);
          return cat ? cat.label.toLowerCase() : k;
        })
        .filter(Boolean);
      if (wanted.length) facts.push(`Interested in: ${wanted.join(", ")}`);
    }
    const pace = IDEA_PACE.find((p) => p.key === b.pace);
    if (pace) facts.push(`Pace: ${pace.label} - ${pace.line}`);
    if (b.extra.trim()) facts.push(`Also, specifically: ${b.extra.trim()}`);

    return (
      `Plan a trip and give ${IDEA_OPTION_COUNT} genuinely different options for it - ` +
      `different routes or areas, not the same one reordered.\n\n` +
      `${facts.join("\n")}\n\n` +
      `Use search to check every place exists and is currently open.\n\n` +
      `Rules:\n` +
      (b.miles ? `- Nothing further than ${b.miles} miles from ${from} by road.\n` : "") +
      `- Order the stops the way you would actually drive them.\n` +
      `- Every day needs somewhere to eat, marked as such.\n` +
      `- Give each stop one nearby alternative, so there is a choice.\n` +
      `- Real, specific, named places. Never "a local cafe" or "a nearby walk".\n\n` +
      `Reply with ONLY JSON, no other text:\n` +
      `{"options":[{"title":"short name for the route","summary":"one sentence",` +
      `"miles":total driving miles as a number,"days":[{"label":"Day 1","stops":[` +
      `{"name":"exact place name","kind":"see"|"eat"|"stop"|"stay","area":"town or area",` +
      `"why":"one short sentence","milesFromStart":number,"time":"" or "12:30",` +
      `"alternatives":[{"name":"","area":"","why":""}]}]}]}]}`
    );
  }

  // ---------- Looking at the alternatives before picking one ----------
  // The swap used to be a straight exchange: tap, and the stop became the other
  // place. It named the alternative, which was better than an icon, but a name
  // is not enough to choose on - you would swap, read, and swap back.
  //
  // So the alternatives are a carousel instead. One at a time, in full: what it
  // is, why it was suggested, where it is, how far out, its hours and its map.
  // Swipe between them, and nothing changes until you say which one.
  let stopChoice = null;

  function stopChoiceAnchor() {
    if (!tripIdea || !ideaStartGeo) return null;
    return {
      name: tripIdea.brief.from,
      lat: ideaStartGeo.lat,
      lon: ideaStartGeo.lon,
      miles: tripIdea.brief.miles || 150,
    };
  }

  function optionFromStop(stop) {
    return {
      name: stop.name,
      area: stop.area || "",
      why: stop.why || "",
      lat: stop.lat,
      lon: stop.lon,
      address: stop.address || "",
      crowMiles: stop.crowMiles,
      description: "",
      website: "",
      openingHours: "",
      enriched: false,
      enriching: false,
      current: true,
    };
  }

  function optionFromAlternative(alt, stop) {
    return {
      name: alt.name,
      area: alt.area || stop.area || "",
      why: alt.why || "",
      lat: null,
      lon: null,
      address: "",
      crowMiles: null,
      description: "",
      website: "",
      openingHours: "",
      enriched: false,
      enriching: false,
      current: false,
    };
  }

  function openStopChooser(path) {
    const at = ideaStopAt(path);
    if (!at || !at.stop.alternatives.length) return;
    stopChoice = {
      path,
      index: 0,
      options: [optionFromStop(at.stop)].concat(
        at.stop.alternatives.map((a) => optionFromAlternative(a, at.stop))
      ),
    };
    renderStopChooser();
    enrichStopOption(0);
  }

  // Filled in on the one you are looking at, not all of them at once: the point
  // of a carousel is that you only ever need the card in front of you.
  async function enrichStopOption(index) {
    const option = stopChoice && stopChoice.options[index];
    if (!option || option.enriched || option.enriching) return;
    option.enriching = true;
    renderStopChooser();

    const anchor = stopChoiceAnchor();
    const [wiki, geo] = await Promise.all([
      wikiEnrich(option.name).catch(() => null),
      option.lat == null ? geocodePlace(option.name, option.area || null, anchor).catch(() => null) : null,
    ]);
    if (!stopChoice || stopChoice.options[index] !== option) return;

    if (wiki) {
      option.description = option.description || wiki.description || "";
      option.website = option.website || wiki.website || "";
    }
    if (geo) {
      option.lat = geo.lat;
      option.lon = geo.lon;
      option.address = option.address || geo.address || "";
      option.openingHours = option.openingHours || geo.openingHours || "";
      option.website = option.website || geo.website || "";
    }
    if (anchor && option.lat != null && option.crowMiles == null) {
      option.crowMiles = Math.round(toMiles(haversineKm(anchor.lat, anchor.lon, option.lat, option.lon)));
    }
    option.enriched = true;
    option.enriching = false;
    if (stopChoice.index === index) renderStopChooser();
  }

  function renderStopChooser() {
    if (!stopChoice) return;
    const option = stopChoice.options[stopChoice.index];
    if (!option) return;
    const total = stopChoice.options.length;
    const radius = tripIdea ? tripIdea.brief.miles : null;
    const over = radius && option.crowMiles != null && option.crowMiles > radius;

    const facts = [
      option.address ? `📍 ${esc(option.address)}` : option.area ? `📍 ${esc(option.area)}` : "",
      option.crowMiles != null ? `📏 ${esc(String(option.crowMiles))} miles from ${esc(tripIdea.brief.from)}` : "",
      option.openingHours ? `🕒 ${esc(option.openingHours)}` : "",
    ].filter(Boolean);

    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet chooser-sheet" role="dialog" aria-label="Choose a stop">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">✕</button>
          <div class="modal-body">
            <div class="chooser-head">
              <button class="chooser-arrow" data-choice-move="-1" ${stopChoice.index === 0 ? "disabled" : ""}
                      aria-label="Previous">‹</button>
              <div class="chooser-dots">
                ${stopChoice.options
                  .map(
                    (o, i) =>
                      `<button class="chooser-dot${i === stopChoice.index ? " now" : ""}" data-choice-at="${i}"
                               aria-label="${esc(o.name)}"></button>`
                  )
                  .join("")}
              </div>
              <button class="chooser-arrow" data-choice-move="1" ${
                stopChoice.index === total - 1 ? "disabled" : ""
              } aria-label="Next">›</button>
            </div>
            <p class="chooser-position">${esc(String(stopChoice.index + 1))} of ${esc(String(total))}${
              option.current ? " · in the trip now" : ""
            }</p>

            <h2 class="modal-title">${esc(option.name)}</h2>
            ${option.area ? `<div class="modal-subtitle">${esc(option.area)}</div>` : ""}
            ${option.why ? `<p class="place-notes" style="margin-top:10px;">${esc(option.why)}</p>` : ""}
            ${option.description ? `<p class="place-notes">${esc(option.description)}</p>` : ""}
            ${facts.map((f) => `<div class="place-fact">${f}</div>`).join("")}
            ${
              over
                ? `<div class="place-fact idea-stop-warn">⚠ past the ${esc(String(radius))} miles you asked for</div>`
                : ""
            }
            ${option.enriching ? `<div class="place-fact preview-loading">Looking up details…</div>` : ""}
            ${option.lat != null ? `<div class="detail-map" id="chooserMap"></div>` : ""}

            <div class="settings-btn-row" style="margin-top:14px;">
              ${
                safeUrl(option.website)
                  ? `<button class="modal-btn" data-open-maps="${esc(safeUrl(option.website))}">🌐 Website</button>`
                  : ""
              }
              <button class="modal-btn" data-open-maps="${esc(
                mapsUrlFor(pickMapsQuery(option), option) || ""
              )}">📍 Google Maps</button>
            </div>

            <button class="modal-btn modal-btn-primary" data-choice-use="1" style="width:100%;margin-top:10px;"
                    ${option.current ? "disabled" : ""}>
              ${option.current ? "Already the one in the trip" : "Use this one instead"}
            </button>
            <p class="settings-hint" style="text-align:center;">Swipe to compare. Nothing changes until you choose.</p>
          </div>
        </div>
      </div>
    `;
    placeModal.classList.add("open");
    wireStopChooser();

    if (option.lat != null && document.getElementById("chooserMap")) {
      const map = L.map("chooserMap", { scrollWheelZoom: false, attributionControl: false });
      addTileLayer(map);
      map.setView([option.lat, option.lon], 14);
      L.marker([option.lat, option.lon]).addTo(map);
      setTimeout(() => {
        if (map._container && map._container.isConnected) map.invalidateSize();
      }, 60);
    }
  }

  function moveStopChoice(delta) {
    if (!stopChoice) return;
    const next = Math.max(0, Math.min(stopChoice.options.length - 1, stopChoice.index + delta));
    if (next === stopChoice.index) return;
    stopChoice.index = next;
    renderStopChooser();
    enrichStopOption(next);
  }

  function useStopChoice() {
    const at = stopChoice && ideaStopAt(stopChoice.path);
    if (!at) return;
    const chosen = stopChoice.options[stopChoice.index];
    if (!chosen || chosen.current) return;
    const stop = at.stop;

    // The one being replaced keeps its place among the alternatives, so this
    // is reversible in exactly the way swapping was.
    const previous = { name: stop.name, area: stop.area, why: stop.why };
    stop.alternatives = stop.alternatives.filter(
      (a) => normalisedName(a.name) !== normalisedName(chosen.name)
    );
    stop.alternatives.push(previous);
    stop.name = chosen.name;
    stop.area = chosen.area || stop.area;
    stop.why = chosen.why || "";
    // Everything positional belonged to the place being replaced; what the
    // chooser looked up for this one is kept, so it does not have to be found
    // twice.
    stop.lat = chosen.lat;
    stop.lon = chosen.lon;
    stop.address = chosen.address || "";
    stop.crowMiles = chosen.crowMiles != null ? chosen.crowMiles : null;
    stop.claimedMiles = null;

    stopChoice = null;
    closePlaceModal();
    saveIdea();
    renderIdea();
    toast(`Swapped in ${stop.name}`);
  }

  function wireStopChooser() {
    placeModal.querySelectorAll("[data-close]").forEach((el) =>
      el.addEventListener("click", (e) => {
        if (e.target === el) {
          stopChoice = null;
          closePlaceModal();
        }
      })
    );
    placeModal.querySelectorAll("[data-open-maps]").forEach((btn) =>
      btn.addEventListener("click", () => openExternal(btn.getAttribute("data-open-maps")))
    );
    placeModal.querySelectorAll("[data-choice-move]").forEach((btn) =>
      btn.addEventListener("click", () => moveStopChoice(Number(btn.getAttribute("data-choice-move"))))
    );
    placeModal.querySelectorAll("[data-choice-at]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const at = Number(btn.getAttribute("data-choice-at"));
        if (at === stopChoice.index) return;
        stopChoice.index = at;
        renderStopChooser();
        enrichStopOption(at);
      })
    );
    placeModal.querySelectorAll("[data-choice-use]").forEach((btn) =>
      btn.addEventListener("click", () => useStopChoice())
    );

    const sheet = placeModal.querySelector(".chooser-sheet");
    if (!sheet) return;
    let startX = null;
    let startY = null;
    sheet.addEventListener(
      "touchstart",
      (e) => {
        const t = e.changedTouches[0];
        startX = t.clientX;
        startY = t.clientY;
      },
      { passive: true }
    );
    sheet.addEventListener(
      "touchend",
      (e) => {
        if (startX == null) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        startX = null;
        // Comfortably sideways, or it is a scroll down the card.
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        moveStopChoice(dx < 0 ? 1 : -1);
      },
      { passive: true }
    );
  }

  // Every control on this screen is reached by one listener on the overlay
  // rather than by attaching one to each button after every render.
  //
  // The old way had a failure that is invisible and total: wireIdea ran after
  // each render and attached fifteen sets of listeners in order, so anything
  // that threw part-way through left the screen drawn, looking finished, with
  // every control after that point connected to nothing. No error, no clue, and
  // "absolutely nothing is clickable" from the outside.
  //
  // Delegation removes the possibility rather than the symptom. There is
  // nothing to re-attach, so a redraw cannot leave a stale listener behind, a
  // button added later works without being wired, and a handler that throws
  // takes only its own tap with it.
  function ideaTarget(e, name) {
    const el = e.target.closest ? e.target.closest(`[data-idea-${name}]`) : null;
    return el && ideaOverlay.contains(el) ? el : null;
  }

  function onIdeaClick(e) {
    if (!tripIdea) return;
    const hit = (name) => ideaTarget(e, name);
    let el;

    if (hit("close")) return closeIdea();

    if ((el = hit("key"))) {
      const key = el.getAttribute("data-idea-key");
      const raw = el.getAttribute("data-idea-value");
      const value = key === "miles" ? (raw ? Number(raw) : null) : raw;
      // Tapping the chip that is already on clears it: the same control both
      // ways, as everywhere else in the app.
      tripIdea.brief[key] = tripIdea.brief[key] === value ? (key === "miles" ? null : "") : value;
      saveIdea();
      return renderIdea();
    }

    if ((el = hit("interest"))) {
      const key = el.getAttribute("data-idea-interest");
      const list = tripIdea.brief.interests;
      const at = list.indexOf(key);
      if (at < 0) list.push(key);
      else list.splice(at, 1);
      saveIdea();
      return renderIdea();
    }

    if ((el = hit("move"))) return ideaGo(Number(el.getAttribute("data-idea-move")));
    if ((el = hit("step"))) return ideaJump(Number(el.getAttribute("data-idea-step")));
    if (e.target.closest("#ideaNext")) return ideaGo(1);
    if (e.target.closest("#ideaRun") || e.target.closest("#ideaRetry")) return runTripIdea();

    if (hit("gps")) return useMyLocationAsStart(e.target.closest("[data-idea-gps]"));

    if (hit("cancel")) {
      ideaGeneration++; // whatever is in flight can no longer write
      tripIdea.status = tripIdea.options.length ? "done" : "idle";
      tripIdea.view = tripIdea.options.length ? "results" : "brief";
      tripIdea.step = IDEA_STEPS.length - 1;
      return renderIdea();
    }

    // Back to the question lands on the review screen, not step one: you came
    // to change one thing, and everything is reachable from there.
    if (hit("edit")) {
      tripIdea.view = "brief";
      tripIdea.step = IDEA_STEPS.length - 1;
      return renderIdea();
    }

    if ((el = hit("option"))) {
      const i = Number(el.getAttribute("data-idea-option"));
      tripIdea.expanded = tripIdea.expanded === i ? -1 : i;
      saveIdea();
      renderIdea();
      if (tripIdea.expanded !== i) return;
      // Opening the third card left it where it was - below the fold, under
      // two cards you had finished with. What you just opened goes to the top,
      // which is where you are looking.
      const card = ideaOverlay.querySelector(`[data-idea-option="${i}"]`);
      const body = ideaOverlay.querySelector(".search-body");
      if (card && body) body.scrollTop = card.offsetTop - body.offsetTop - 8;
      return measureIdeaOption(i);
    }

    if ((el = hit("add"))) {
      const at = ideaStopAt(el.getAttribute("data-idea-add"));
      if (!at) return;
      ideaSaveStop(at.stop);
      renderIdea();
      return toast(`Saved ${at.stop.name}`);
    }

    if ((el = hit("day"))) {
      const at = ideaStopAt(el.getAttribute("data-idea-day"));
      if (!at) return;
      return openDaySheet(ideaSaveStop(at.stop), { onDone: () => renderIdea() });
    }

    // Opens the alternatives to look at rather than swapping on the spot: a
    // name is not enough to choose on, and swapping to read and swapping back
    // is a poor way to compare two places.
    if ((el = hit("swap"))) return openStopChooser(el.getAttribute("data-idea-swap"));

    if ((el = hit("preview"))) {
      const at = ideaStopAt(el.getAttribute("data-idea-preview"));
      if (!at) return;
      // The whole day is handed over, so the preview's own next/previous moves
      // along the route rather than dead-ending on one stop.
      return openCandidatePreview(at.si, at.day.stops.map(ideaCandidate));
    }

    if ((el = hit("use"))) return useIdeaOption(Number(el.getAttribute("data-idea-use")));
    if ((el = hit("saveall"))) return saveIdeaOptionPlaces(Number(el.getAttribute("data-idea-saveall")));
  }

  async function useMyLocationAsStart(button) {
    if (button) button.textContent = "Finding you…";
    try {
      const pos = await currentPosition();
      const place = await reverseGeocode(pos.lat, pos.lon);
      tripIdea.brief.from = place || `${pos.lat.toFixed(3)}, ${pos.lon.toFixed(3)}`;
      ideaStartGeo = { query: tripIdea.brief.from, lat: pos.lat, lon: pos.lon };
      saveIdea();
    } catch (e) {
      toast("Couldn't get your location");
    }
    renderIdea();
  }

  // Typed input, the same way: input and focusout both bubble, so one listener
  // each covers every field the screen will ever have.
  function onIdeaInput(e) {
    if (!tripIdea) return;
    const field = ideaTarget(e, "text");
    if (!field) return;
    tripIdea.brief[field.getAttribute("data-idea-text")] = field.value;
    refreshIdeaLive();
  }

  function onIdeaFocusOut(e) {
    if (!tripIdea) return;
    const field = ideaTarget(e, "text");
    if (!field) return;
    tripIdea.brief[field.getAttribute("data-idea-text")] = field.value;
    saveIdea();
  }

  function onIdeaKeyDown(e) {
    if (!tripIdea || e.key !== "Enter") return;
    const field = ideaTarget(e, "text");
    if (!field) return;
    // On a phone the keyboard's own "go" is right there and the Next button is
    // behind it, so it has to mean the same thing.
    e.preventDefault();
    field.blur();
    ideaGo(1);
  }

  function onIdeaSubmit(e) {
    if (!tripIdea || !e.target || e.target.id !== "ideaRefineForm") return;
    e.preventDefault();
    const field = document.getElementById("ideaRefineInput");
    tripIdea.brief.extra = field ? field.value.trim() : "";
    if (field) field.blur();
    runTripIdea();
  }

  // A carousel you cannot swipe is a slideshow. The buttons stay because a
  // swipe is undiscoverable on its own, and because one hand on a pushchair is
  // the normal case here.
  let ideaTouchX = null;
  let ideaTouchY = null;

  function onIdeaTouchStart(e) {
    const t = e.changedTouches[0];
    ideaTouchX = t.clientX;
    ideaTouchY = t.clientY;
  }

  function onIdeaTouchEnd(e) {
    if (ideaTouchX == null || !tripIdea || tripIdea.view !== "brief") return;
    const t = e.changedTouches[0];
    const dx = t.clientX - ideaTouchX;
    const dy = t.clientY - ideaTouchY;
    ideaTouchX = null;
    // Comfortably horizontal, or it is a scroll that drifted.
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    ideaGo(dx < 0 ? 1 : -1);
  }

  ideaOverlay.addEventListener("click", onIdeaClick);
  ideaOverlay.addEventListener("input", onIdeaInput);
  ideaOverlay.addEventListener("focusout", onIdeaFocusOut);
  ideaOverlay.addEventListener("keydown", onIdeaKeyDown);
  ideaOverlay.addEventListener("submit", onIdeaSubmit);
  ideaOverlay.addEventListener("touchstart", onIdeaTouchStart, { passive: true });
  ideaOverlay.addEventListener("touchend", onIdeaTouchEnd, { passive: true });

  // ---------- Picks: search-and-confirm with a real map ----------

  let pickSearch = { query: "", status: "idle", results: [] }; // idle | loading | done | error
  const pickMiniMaps = []; // Leaflet map instances from the last render, torn down before re-render

  // ---------- Search, on its own screen ----------
  // Searching used to happen in a strip at the top of Picks, with results
  // pushing the saved list down the page. It's the app's most-used action and
  // it deserves the whole screen: the keyboard opens on arrival, past
  // searches and starting points are offered before you've typed anything,
  // and adding several places in a row doesn't mean going back and forth.
  //
  // Deliberately one question, not a sequence of them. A step-by-step form -
  // name, then venue type, then area - asks for things you usually can't
  // answer ("what type is Camera Obscura?") and puts three taps in front of
  // the case that needs none. Everything optional is offered *after* results
  // exist, as a filter you can ignore, which is how every search app that
  // feels quick actually works.
  const searchOverlay = document.getElementById("searchOverlay");
  let searchKindFilter = "all"; // all | place | eat
  const RECENT_KEY = "recent-searches-v1";
  const SEARCH_SUGGESTIONS = [
    "Somewhere for lunch",
    "Rainy day with a 4-year-old",
    "Good coffee",
    "Playground nearby",
    "Free things to do",
  ];

  function loadRecentSearches() {
    const list = readJson(RECENT_KEY, []);
    return Array.isArray(list) ? list.slice(0, 6) : [];
  }

  function rememberSearch(query) {
    const q = (query || "").trim();
    if (!q) return;
    const list = loadRecentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase());
    list.unshift(q);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
  }

  function openSearchOverlay(prefill) {
    searchAnchor = loadAnchor();
    if (prefill !== undefined) pickSearch = { query: prefill, status: "idle", results: [] };
    renderSearchOverlay();
    const input = document.getElementById("pickSearchInput");
    if (input && !prefill) input.focus();
  }

  function dismissSearchOverlay() {
    closeSearchOverlay();
  }

  function closeSearchOverlay() {
    searchOverlay.classList.remove("open");
    searchOverlay.innerHTML = "";
    // The Picks list behind it may have gained places while it was open.
    if (view.dataset.activeTab === "picks") renderPicks();
  }

  let searchGeneration = 0;
  // The anchor in force on the search screen. Read from storage when the
  // screen opens so it can be shown before anything is typed.
  let searchAnchor = null;

  async function runSearch(query, guidance, seed) {
    const q = (query || "").trim();
    if (!q) return;
    // Two searches in flight and the slower one wins, whichever was asked
    // first: type "Pitlochry", change your mind, search "Blair Atholl", and
    // the Pitlochry results arrive afterwards under the Blair Atholl query.
    // Only the newest search is allowed to write.
    const generation = ++searchGeneration;
    rememberSearch(q);
    // Kept across a refine, so "cheap, with a garden" still applies when you
    // narrow the same search again.
    const extra = guidance === undefined ? pickSearch.guidance || "" : guidance;
    // A place you picked outright is shown while the rest is still loading:
    // it is already the answer, and nothing that comes back can improve on it.
    pickSearch = { query: q, status: "loading", results: seed ? [seed] : [], guidance: extra, anchor: searchAnchor };
    renderSearchOverlay();
    try {
      // Resolved per search rather than per keystroke: a postcode typed into
      // the query is an anchor in its own right and beats the standing one.
      const anchor = await anchorForQuery(q);
      if (generation !== searchGeneration) return;
      searchAnchor = anchor;
      const found = await searchPlaces(q, extra, anchor);
      if (generation !== searchGeneration) return;
      const results = seed
        ? [seed].concat(found.filter((r) => normalisedName(r.name) !== normalisedName(seed.name)))
        : found;
      pickSearch = {
        query: q,
        status: "done",
        results,
        guidance: extra,
        anchor,
        outside: lastSearchOutside,
        placing: results.some((r) => r.needsPlacing),
      };
      renderSearchOverlay();
      placeSearchResults(generation, anchor);
      return;
    } catch (e) {
      if (generation !== searchGeneration) return;
      pickSearch = { query: q, status: seed ? "done" : "error", results: seed ? [seed] : [], guidance: extra, anchor: searchAnchor };
    }
    renderSearchOverlay();
  }

  // Fills in where each result actually is, one at a time, updating the screen
  // as each lands. Sequential on purpose: five parallel lookups is a burst at
  // a free service that asks for one a second, and being rate-limited is
  // slower than going in order.
  async function placeSearchResults(generation, anchor) {
    const list = pickSearch.results || [];
    for (const r of list) {
      if (generation !== searchGeneration) return;
      if (!r.needsPlacing) continue;
      let geo = null;
      try {
        geo = await geocodePlace(r.name, r.postcode || r.area || null, anchor);
      } catch (e) {
        geo = null;
      }
      if (generation !== searchGeneration) return;
      r.needsPlacing = false;

      if (geo && anchor && !withinAnchor(anchor, geo.lat, geo.lon, ANCHOR_GRACE)) {
        // Same rule as everywhere else: a place the model itself put somewhere
        // else is a wrong answer and goes; one it called local is probably
        // unmapped, and keeps its name but not that coordinate.
        if (!claimsToBeNear(r.area, anchor)) {
          pickSearch.results = pickSearch.results.filter((x) => x !== r);
          pickSearch.outside = (pickSearch.outside || 0) + 1;
        }
        geo = null;
      }
      if (geo) {
        r.lat = geo.lat;
        r.lon = geo.lon;
        r.area = r.area || geo.town || "";
        r.displayName = geo.address || r.area || "";
        r.address = geo.address || "";
        r.type = r.type || geo.category;
        r.category = r.category || geo.category;
        r.website = r.website || geo.website;
        r.phone = r.phone || geo.phone;
        r.openingHours = r.openingHours || geo.openingHours;
      }
      const active = document.activeElement;
      if (!(active && searchOverlay.contains(active) && active.tagName === "INPUT")) renderSearchOverlay();
    }
    if (generation === searchGeneration) {
      pickSearch.placing = false;
      renderSearchOverlay();
    }
  }

  let searchScroll = 0;
  let searchScrollId = "";

  function renderSearchOverlay() {
    const previous = searchOverlay.querySelector(".search-body");
    if (previous) searchScroll = previous.scrollTop;
    const recents = loadRecentSearches();
    const results = pickSearch.results || [];
    const filtered =
      searchKindFilter === "all" ? results : results.filter((r) => resultKind(r) === searchKindFilter);

    let body = "";

    if (pickSearch.status === "idle") {
      // Nothing typed yet, so offer the two things that save typing: what you
      // searched before, and the kind of thing people search for.
      if (recents.length) {
        body += `<div class="section-label">Recent</div><div class="search-chips">`;
        body += recents
          .map((r) => `<button class="search-chip" data-recent="${esc(r)}">🕘 ${esc(r)}</button>`)
          .join("");
        body += `</div>`;
      }
      body += `<div class="section-label">Try</div><div class="search-chips">`;
      body += SEARCH_SUGGESTIONS.map(
        (r) => `<button class="search-chip" data-recent="${esc(r)}">${esc(r)}</button>`
      ).join("");
      body += `</div>`;

      // Searching finds one place at a time, which is the wrong tool when you
      // do not yet know what you are looking for. This is the other door, and
      // it belongs here because this is where that realisation happens.
      body += `
        <div class="section-label">Or don't search at all</div>
        <button class="search-chip search-chip-wide" data-open-idea-search="1">🧭 Suggest me a trip</button>
        <p class="settings-hint" style="text-align:center;">Say where you're starting and how far you'll go.</p>
      `;

      // Not everything has a name you'd type. Somewhere you drove past, a
      // stretch of coast, the far side of a loch - point at it instead.
      body += `
        <div class="section-label">No name for it?</div>
        <button class="search-chip search-chip-wide" id="searchMapPick">🗺 Point at it on a map</button>
      `;
      body += `
        <div class="card search-tip">
          <p class="settings-hint">Describe what you want in your own words — "somewhere quiet for lunch
          near the castle" works as well as a name. Or browse by category from Explore.</p>
        </div>
      `;
    } else if (pickSearch.status === "loading") {
      body += `<div class="search-loading"><div class="spinner"></div><p class="pick-status">Searching for “${esc(
        pickSearch.query
      )}”…</p></div>`;
    } else if (pickSearch.status === "error") {
      body += `<div class="card"><p class="pick-status">Search failed — check your connection and try again.</p>${
        lastSearchError ? `<pre class="settings-result bad">${esc(lastSearchError)}</pre>` : ""
      }</div>`;
    } else if (!results.length) {
      body += `<div class="card"><p class="pick-status">No matches for “${esc(
        pickSearch.query
      )}” — try a shorter or more general name.</p>${
        lastSearchError ? `<pre class="settings-result bad">${esc(lastSearchError)}</pre>` : ""
      }</div>`;
    } else {
      if (lastSearchError) {
        body += `<div class="card"><p class="pick-status">Fell back to OpenStreetMap — the AI search didn't answer.</p><pre class="settings-result bad">${esc(
          lastSearchError
        )}</pre></div>`;
      }

      // Refinement lives here, after there's something to refine - and only
      // when it would actually divide the results.
      const kinds = new Set(results.map(resultKind));
      if (kinds.size > 1) {
        const counts = { place: 0, eat: 0 };
        results.forEach((r) => counts[resultKind(r)]++);
        body += `<div class="search-filters">
          ${[
            ["all", `All ${results.length}`],
            ["place", `🏛️ To go ${counts.place}`],
            ["eat", `🍽️ To eat ${counts.eat}`],
          ]
            .map(
              ([k, label]) =>
                `<button class="map-chip${searchKindFilter === k ? " on" : ""}" data-search-kind="${k}">${esc(
                  label
                )}</button>`
            )
            .join("")}
        </div>`;
      }

      // Seeing them together answers "which of these is actually near us",
      // which no amount of address text does.
      if (filtered.some((r) => r.lat != null && r.lon != null)) {
        body += `<div class="search-map-wrap"><div id="pickSearchMap" class="search-map"></div></div>`;
      }

      const saved = new Set(loadPicks().map((p) => p.id));
      body += `<div class="search-results">`;
      filtered.forEach((r) => {
        const i = results.indexOf(r);
        const already = saved.has(pickId("custom", r.name));
        // The row opens the full details; the ＋ is the shortcut for when you
        // already know. Tapping straight to "add" was the only option before,
        // which made every add a guess.
        body += `
          <div class="search-result${r.isArea ? " search-result-area" : ""}" data-candidate="${i}">
            <div class="search-result-main">
              <button class="result-tap" data-preview-candidate="${i}">
                <div class="place-name">${esc(r.name)}${
                  r.isArea ? ` <span class="area-badge">🏘️ ${esc(prettyCategory(r.type) || "Area")}</span>` : ""
                }${r.aiSuggested ? ` <span class="ai-badge">AI</span>` : ""}${ratingBadge(r)}</div>
                <div class="place-notes">${esc(r.displayName || "")}</div>
                ${r.description ? `<div class="place-notes">${esc(r.description)}</div>` : ""}
                <div class="search-result-more">${
                  r.isArea ? "Save it to group places under it, or tap for details ›" : "Details ›"
                }</div>
              </button>
              ${
                r.sources && r.sources.length
                  ? `<div class="place-links"><a href="${esc(safeUrl(r.sources[0].uri))}" target="_blank" rel="noopener">🔗 source</a></div>`
                  : ""
              }
            </div>
            <div class="search-result-actions">
              <button class="search-add${already ? " added" : ""}" data-add-candidate="${i}" ${
                already ? "disabled" : ""
              } aria-label="${
                already ? "Already saved" : (r.isArea ? "Save " + esc(r.name) + " as an area" : "Save " + esc(r.name))
              }">${already ? "✓" : "＋"}</button>
              ${
                // Anything with a position can be the middle of a search, not
                // just a town: "what's near the hotel" is the same question as
                // "what's near Pitlochry".
                r.lat != null
                  ? `<button class="search-around" data-around-candidate="${i}" aria-label="Look around ${esc(
                      r.name
                    )}">🧭</button>`
                  : ""
              }
              ${
                // Straight from a result onto a day. It saves it on the way if
                // it isn't saved yet - the two were always going to happen
                // together, and making them two errands was the friction.
                r.isArea
                  ? ""
                  : `<button class="search-around" data-day-candidate="${i}" aria-label="Put ${esc(
                      r.name
                    )} on a day">📅</button>`
              }
            </div>
          </div>
        `;
      });
      body += `</div>`;
      if (pickSearch.placing) {
        body += `<p class="settings-hint search-placing">Finding them on the map…</p>`;
      }
      if (pickSearch.outside) {
        body += `
          <p class="settings-hint search-outside">
            ${esc(String(pickSearch.outside))} result${pickSearch.outside === 1 ? " was" : "s were"} too far from
            ${esc((pickSearch.anchor && pickSearch.anchor.name) || "here")} to be what you meant, so
            ${pickSearch.outside === 1 ? "it is" : "they are"} not shown.
            <button class="link-btn" data-anchor-wider="1">Look further out</button>
          </p>
        `;
      }
      body += `<p class="settings-hint search-foot">＋ saves it, 🧭 looks around it, or tap the place to read about it first.${
        results.some((r) => r.isArea) ? " A 🏘️ result is a town or area: saving it gives it its own section." : ""
      }</p>`;
      // When none of it is what you meant. The query says what you are looking
      // for; this says what would make it right, in your own words, and the
      // model gets it verbatim.
      body += `
        <form class="search-bar refine-bar" id="refineForm">
          <input type="text" id="refineInput" placeholder="Not quite? Tell the AI more — e.g. with a garden, no chains"
                 autocomplete="off" value="${esc(pickSearch.guidance || "")}" />
          <button type="submit" aria-label="Search again with this">Refine</button>
        </form>
        ${
          pickSearch.guidance
            ? `<p class="settings-hint">Also asking for: <b>${esc(pickSearch.guidance)}</b> · <button class="link-btn" id="refineClear">drop it</button></p>`
            : ""
        }
      `;
    }

    searchOverlay.innerHTML = `
      <div class="search-head">
        <button class="search-back" data-search-close="1" aria-label="Close search">←</button>
        <form class="search-field" id="pickSearchForm">
          <input type="text" id="pickSearchInput" placeholder="Search for a place to add…"
                 autocomplete="off" autocorrect="off" value="${esc(pickSearch.query)}" />
          ${
            pickSearch.query
              ? `<button type="button" class="search-clear" id="searchClear" aria-label="Clear">✕</button>`
              : ""
          }
        </form>
      </div>
      <button class="search-anchor" data-anchor-open="1">
        <span class="search-anchor-pin">📍</span>
        <span class="search-anchor-text">${
          searchAnchor
            ? `Searching within <b>${esc(String(anchorMiles(searchAnchor)))} miles</b> of <b>${esc(searchAnchor.name)}</b>`
            : `Searching <b>anywhere</b>`
        }</span>
        <span class="search-anchor-change">Change</span>
      </button>
      <div class="suggest-list" id="pickSuggestList" role="listbox" hidden></div>
      <div class="search-body">${body}</div>
    `;
    searchOverlay.classList.add("open");
    // Positions arrive one at a time and each one redraws this screen, so
    // without keeping the scroll the list would jump back to the top under
    // your thumb five times in a row.
    const scroller = searchOverlay.querySelector(".search-body");
    if (scroller && searchScrollId === `${pickSearch.query}|${pickSearch.status}`) scroller.scrollTop = searchScroll;
    searchScrollId = `${pickSearch.query}|${pickSearch.status}`;
    wireSearchOverlay();
    if (document.getElementById("pickSearchMap")) {
      destroyMiniMaps();
      initSearchResultsMap(filtered, searchOverlay, (r) => results.indexOf(r));
    }
  }

  // Which tab a result would land in, used only to offer a filter. Falls back
  // to the same guess the saved place would get.
  function resultKind(r) {
    return pickKind({ category: r.category || r.type, description: r.description });
  }

  // ---------- Reading a result before deciding on it ----------
  // The ＋ was the only thing you could do with a search result, which made
  // every add a guess: a name and one line of address is not enough to know
  // whether somewhere is right for a wet Tuesday with a four-year-old. This
  // is the same information the place would have *after* saving, shown
  // before - map, description, hours, website - so the decision happens
  // before the list fills up with things you then have to weed out.
  let previewIndex = null;
  let previewList = null; // whichever list of results is being previewed
  // Deliberately per-candidate (r.enriching) rather than one global flag: the
  // flag meant "some preview is loading", so a second one opened meanwhile was
  // never fetched and sat on "Looking up details…" for good.

  function openCandidatePreview(index, list) {
    previewList = list || pickSearch.results;
    const r = previewList[index];
    if (!r) return;
    previewIndex = index;

    // Search results arrive thin - an AI suggestion may be a name and a
    // sentence. Fill in the rest on opening rather than for every result in
    // the list, which would be dozens of requests for one you'll actually read.
    const needsEnrich = !r.enriched && !r.enriching;
    // Flagged before the first render, not after it: the sheet draws
    // "Looking up details…" from this, so setting it afterwards meant the one
    // open that really was waiting never said so.
    if (needsEnrich) r.enriching = true;
    renderCandidatePreview();

    if (needsEnrich) {
      Promise.all([
        r.description && r.website ? null : wikiEnrich(r.name).catch(() => null),
        r.lat == null ? geocodeWithinAnchor(r.name, r.postcode || r.city || null) : null,
      ])
        .then(([wiki, geo]) => {
          if (wiki) {
            if (!r.description) r.description = wiki.description || "";
            if (!r.website) r.website = wiki.website || "";
          }
          if (geo) {
            r.lat = geo.lat;
            r.lon = geo.lon;
            if (!r.website) r.website = geo.website || "";
            if (!r.address) r.address = geo.address || "";
            if (!r.openingHours) r.openingHours = geo.openingHours || "";
          }
          r.enriched = true;
        })
        .finally(() => {
          r.enriching = false;
          if (previewIndex === index) renderCandidatePreview();
        });
    }
  }

  function renderCandidatePreview() {
    const r = previewList ? previewList[previewIndex] : null;
    if (!r) return;
    const already = loadPicks().some(
      (p) => p.id === pickId(r.guideSource || "custom", r.name)
    );
    const mapsUrl = r.googleUrl || mapsUrlFor(pickMapsQuery(r), r);
    const facts = [
      r.address || r.displayName ? `📍 ${esc(r.address || r.displayName)}` : "",
      r.openingHours ? `🕒 ${esc(r.openingHours)}` : "",
      r.phone ? `📞 ${esc(r.phone)}` : "",
      r.rating != null
        ? `⭐ ${r.ratingFromAi ? "~" : ""}${esc(String(r.rating))}${
            r.ratingCount ? ` from ${esc(r.ratingCount.toLocaleString("en-GB"))} reviews` : ""
          }${r.ratingFromAi ? ' <span class="rating-caveat">— reported by AI search, worth a check</span>' : ""}`
        : "",
      r.price ? `💷 ${esc(r.price)}` : "",
      r.booking ? "📅 Usually needs booking ahead" : "",
    ].filter(Boolean);

    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="${esc(r.name)}">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">✕</button>
          <div class="modal-body">
            <h2 class="modal-title">${esc(r.name)}${
              r.aiSuggested ? ` <span class="ai-badge">AI</span>` : ""
            }</h2>
            <div class="modal-subtitle">${esc(
              [r.category || r.type, r.city].filter(Boolean).join(" · ")
            )}</div>

            ${r.description ? `<p class="place-notes" style="margin-top:10px;">${esc(r.description)}</p>` : ""}
            ${facts.map((f) => `<div class="place-fact">${f}</div>`).join("")}
            ${
              r.enriching
                ? `<div class="place-fact preview-loading">Looking up details…</div>`
                : ""
            }

            ${r.lat != null ? `<div class="detail-map" id="previewMap"></div>` : ""}

            <div class="settings-btn-row" style="margin-top:12px;">
              ${
                safeUrl(r.website)
                  ? `<button class="modal-btn" data-open-maps="${esc(safeUrl(r.website))}">🌐 Website</button>`
                  : ""
              }
              ${mapsUrl ? `<button class="modal-btn" data-open-maps="${esc(mapsUrl)}">📍 Google Maps</button>` : ""}
            </div>

            ${
              r.sources && r.sources.length
                ? `<div class="place-links" style="margin-top:10px;">${r.sources
                    .slice(0, 2)
                    .map(
                      (s) =>
                        `<a href="${esc(safeUrl(s.uri))}" target="_blank" rel="noopener">🔗 ${esc(s.title || "source")}</a>`
                    )
                    .join(" ")}</div>`
                : ""
            }

            <button class="modal-btn modal-btn-primary" id="previewAdd" ${already ? "disabled" : ""}
                    style="width:100%;margin-top:16px;">
              ${already ? "✓ Already saved" : "＋ Save this place"}
            </button>
            ${
              // A town is offered as an area, never filed as one behind your
              // back: a village you only want to remember the name of is a
              // perfectly ordinary saved place.
              !already && !r.guideSource && looksLikeMajorPlace(r)
                ? `<button class="modal-btn" id="previewAddMajor" style="width:100%;margin-top:8px;">🏘️ Save as a town or area</button>
                   <p class="settings-hint" style="text-align:center;">An area heads its own section in Picks, and places you save nearby are filed under it.</p>`
                : `<p class="settings-hint" style="text-align:center;">You can change the folder, add a note or a cost after saving.</p>`
            }
          </div>
        </div>
      </div>
    `;
    placeModal.classList.add("open");

    placeModal.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target === el) {
          previewIndex = null;
          closePlaceModal();
        }
      });
    });

    placeModal.querySelectorAll("[data-open-maps]").forEach((btn) =>
      btn.addEventListener("click", () => openExternal(btn.getAttribute("data-open-maps")))
    );

    const addBtn = document.getElementById("previewAdd");
    if (addBtn && !already) {
      addBtn.addEventListener("click", () => {
        previewIndex = null;
        // A catalog item already knows where it belongs, so it saves outright.
        // Anything else asks which folder - and that sheet takes over this same
        // modal, so closing here would shut the question before it was read.
        if (r.guideSource) {
          togglePick(r.guideSource, r);
          closePlaceModal();
          // The list behind needs to show it as saved now.
          if (searchOverlay.classList.contains("open")) renderSearchOverlay();
          else if (view.dataset.activeTab) showView(view.dataset.activeTab);
        } else {
          // quickAdd refreshes the list itself, once the folder question has
          // actually been answered - redrawing it here would mark a place as
          // saved while the question is still on screen.
          quickAdd(r);
        }
      });
    }

    const addMajorBtn = document.getElementById("previewAddMajor");
    if (addMajorBtn) {
      addMajorBtn.addEventListener("click", () => {
        quickAdd(r, { major: true });
        previewIndex = null;
        closePlaceModal();
        if (searchOverlay.classList.contains("open")) renderSearchOverlay();
        else if (view.dataset.activeTab) showView(view.dataset.activeTab);
      });
    }

    const mapEl = document.getElementById("previewMap");
    if (mapEl && r.lat != null) {
      const map = L.map(mapEl, { scrollWheelZoom: false, attributionControl: false });
      addTileLayer(map);
      map.setView([r.lat, r.lon], 15);
      L.marker([r.lat, r.lon]).addTo(map);
      setTimeout(() => {
        if (map._container && map._container.isConnected) map.invalidateSize();
      }, 60);
    }
  }

  // Changing where a search looks. Everything that can name a place is offered
  // in the order you are likely to have one: the areas you have saved, where
  // you are standing, and a box that takes a town or a postcode.
  function openAnchorSheet() {
    const current = searchAnchor;
    const miles = anchorMiles(current);
    const areas = loadPicks().filter((p) => p.major && p.lat != null);

    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="Where to search">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">✕</button>
          <div class="modal-body">
            <h2 class="modal-title">Where should I look?</h2>
            <p class="settings-hint">Results outside this are almost always the wrong place with the right name.</p>

            <label class="settings-label">How far out</label>
            <div class="move-row">
              ${ANCHOR_MILES.map(
                (m) =>
                  `<button class="move-chip${m === miles && current ? " active" : ""}" data-anchor-miles="${m}">${m} mi</button>`
              ).join("")}
            </div>

            ${
              areas.length
                ? `<label class="settings-label">Somewhere you've saved</label>
                   <div class="move-row">
                     ${areas
                       .map(
                         (p) =>
                           `<button class="move-chip${
                             current && current.name === p.name ? " active" : ""
                           }" data-anchor-pick="${esc(p.id)}">${esc(p.name)}</button>`
                       )
                       .join("")}
                   </div>`
                : ""
            }

            <label class="settings-label">Or a town, postcode or coordinates</label>
            <form class="search-bar" id="anchorForm">
              <input type="text" id="anchorInput" placeholder="Pitlochry · PH16 · 56.7028, -3.7317"
                     autocomplete="off" value="${esc(current && !current.fromPick ? current.name : "")}" />
              <button type="submit" aria-label="Use this">Set</button>
            </form>
            <p class="settings-hint" id="anchorStatus"></p>

            <div class="settings-btn-row" style="margin-top:12px;">
              <button class="modal-btn" id="anchorHere">📍 Where I am now</button>
              <button class="modal-btn" id="anchorMap">🗺 Point at it</button>
            </div>
            <button class="modal-btn" id="anchorAnywhere" style="width:100%;margin-top:8px;">🌍 Anywhere</button>
          </div>
        </div>
      </div>
    `;
    placeModal.classList.add("open");

    const say = (text) => {
      const el = document.getElementById("anchorStatus");
      if (el) el.textContent = text;
    };
    const apply = (anchor) => {
      searchAnchor = anchor;
      saveAnchor(anchor);
      closePlaceModal();
      renderSearchOverlay();
      // Changing where to look is only ever done because the last answer was
      // wrong, so the search runs again rather than leaving it on screen.
      if (pickSearch.query && pickSearch.status !== "idle") runSearch(pickSearch.query);
    };

    placeModal.querySelectorAll("[data-close]").forEach((el) =>
      el.addEventListener("click", (e) => {
        if (e.target === el) closePlaceModal();
      })
    );
    placeModal.querySelectorAll("[data-anchor-miles]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const next = Number(btn.getAttribute("data-anchor-miles"));
        // Widening with nothing to widen around: fall back to whatever the
        // board can offer rather than doing nothing visible.
        const base = current || derivedAnchor();
        if (!base) return say("Pick somewhere to search around first.");
        apply(Object.assign({}, base, { miles: next }));
      })
    );
    placeModal.querySelectorAll("[data-anchor-pick]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const p = loadPicks().find((x) => x.id === btn.getAttribute("data-anchor-pick"));
        if (p) apply({ name: p.name, lat: p.lat, lon: p.lon, miles, fromPick: true });
      })
    );

    const form = document.getElementById("anchorForm");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = document.getElementById("anchorInput").value.trim();
        if (!text) return;
        say("Looking that up…");
        const found = await anchorFromText(text, miles);
        if (!found) return say(`Couldn't find "${text}". Try a town, or a postcode like PH16.`);
        apply(found);
      });
    }

    const here = document.getElementById("anchorHere");
    if (here) {
      here.addEventListener("click", async () => {
        say("Finding you…");
        try {
          const pos = await currentPosition();
          const place = await reverseGeocode(pos.lat, pos.lon).catch(() => null);
          apply({
            name: place || "where you are",
            lat: pos.lat,
            lon: pos.lon,
            miles,
          });
        } catch (err) {
          say("Couldn't get your location.");
        }
      });
    }
    // Pointing at a spot is the honest way to give a coordinate, and it is the
    // reason the box now parses them at all: someone reaching for coordinates
    // has a place in mind that has no name worth typing.
    const onMap = document.getElementById("anchorMap");
    if (onMap) {
      onMap.addEventListener("click", () => {
        closePlaceModal();
        openMapPicker(
          // The picker has already named the point it is centred on.
          (point) => apply({
            name: point.name || formatLatLon(point.lat, point.lon),
            lat: point.lat,
            lon: point.lon,
            miles,
            fromPoint: true,
          }),
          { centre: current ? { lat: current.lat, lon: current.lon } : null, title: "Where should I look?" }
        );
      });
    }

    const anywhere = document.getElementById("anchorAnywhere");
    if (anywhere) anywhere.addEventListener("click", () => apply(null));
  }

  function wireSearchOverlay() {
    searchOverlay.querySelectorAll("[data-search-close]").forEach((b) =>
      b.addEventListener("click", dismissSearchOverlay)
    );
    searchOverlay.querySelectorAll("[data-open-idea-search]").forEach((b) =>
      b.addEventListener("click", () => openTripIdea())
    );
    searchOverlay.querySelectorAll("[data-anchor-open]").forEach((b) =>
      b.addEventListener("click", () => openAnchorSheet())
    );
    searchOverlay.querySelectorAll("[data-anchor-wider]").forEach((b) =>
      b.addEventListener("click", () => {
        // One tap to the next size up, rather than a trip through the sheet to
        // do the only thing the message was about.
        const base = searchAnchor || derivedAnchor();
        if (!base) return;
        const next = ANCHOR_MILES.find((m) => m > anchorMiles(base)) || anchorMiles(base) * 2;
        searchAnchor = Object.assign({}, base, { miles: next });
        saveAnchor(searchAnchor);
        runSearch(pickSearch.query);
      })
    );

    const form = document.getElementById("pickSearchForm");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = document.getElementById("pickSearchInput");
        input.blur(); // drop the keyboard so results get the screen
        renderSuggestions("hidden");
        runSearch(input.value);
      });
    }

    // Type-ahead came across from the panel below when that lost its own
    // field: "Bibu" finding Bibury is worth more here, where it settles which
    // Manchester you meant before anything is searched for.
    const searchInput = document.getElementById("pickSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", () => onSuggestInput(searchInput.value));
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && suggestItems.length) {
          const list = document.getElementById("pickSuggestList");
          if (list && !list.hidden) {
            e.preventDefault();
            chooseSuggestion(suggestItems[0]);
          }
        }
      });
    }

    const clear = document.getElementById("searchClear");
    if (clear) {
      clear.addEventListener("click", () => {
        pickSearch = { query: "", status: "idle", results: [] };
        renderSearchOverlay();
        const input = document.getElementById("pickSearchInput");
        if (input) input.focus();
      });
    }

    searchOverlay.querySelectorAll("[data-recent]").forEach((btn) => {
      btn.addEventListener("click", () => runSearch(btn.getAttribute("data-recent")));
    });

    // Pointing at a spot searches for what's there, by name of the area -
    // which is what you'd have typed if you'd known what it was called.
    const mapPick = document.getElementById("searchMapPick");
    if (mapPick) {
      mapPick.addEventListener("click", () => {
        closeSearchOverlay();
        openMapPicker(
          (spot) => {
            explore.open = true;
            explore.centre = { name: spot.name, lat: spot.lat, lon: spot.lon };
            explore.error = "";
            showView("picks");
            // Straight into the category picker: having pointed at a place,
            // the only question left is what you're after there.
            openCategoryPicker();
          },
          { title: "Where do you want to look?" }
        );
      });
    }

    searchOverlay.querySelectorAll("[data-search-kind]").forEach((btn) => {
      btn.addEventListener("click", () => {
        searchKindFilter = btn.getAttribute("data-search-kind");
        renderSearchOverlay();
      });
    });

    searchOverlay.querySelectorAll("[data-preview-candidate]").forEach((btn) => {
      btn.addEventListener("click", () =>
        openCandidatePreview(Number(btn.getAttribute("data-preview-candidate")))
      );
    });

    // Adding doesn't close the screen: on a trip you rarely want exactly one
    // café. The button becomes a tick so it's obvious what's already in.
    searchOverlay.querySelectorAll("[data-day-candidate]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const c = pickSearch.results[Number(btn.getAttribute("data-day-candidate"))];
        if (!c) return;
        const id = pickId("custom", c.name);
        if (!loadPicks().some((p) => p.id === id)) {
          // Saved where it obviously belongs, or Unsorted - the question on
          // screen is which day, and stacking a second one behind it is how
          // this got tiring in the first place.
          const folder = confidentFolderFor(c.lat, c.lon) || suggestedFolderFor(c.lat, c.lon) || "Unsorted";
          confirmAddCandidate(c, folder);
          renderSearchOverlay();
        }
        openDaySheet(id, { onDone: () => renderSearchOverlay() });
      });
    });

    const refine = document.getElementById("refineForm");
    if (refine) {
      refine.addEventListener("submit", (e) => {
        e.preventDefault();
        const extra = document.getElementById("refineInput").value.trim();
        const input = document.getElementById("pickSearchInput");
        if (input) input.blur();
        runSearch(pickSearch.query, extra);
      });
    }
    const refineClear = document.getElementById("refineClear");
    if (refineClear) {
      refineClear.addEventListener("click", () => runSearch(pickSearch.query, ""));
    }

    searchOverlay.querySelectorAll("[data-around-candidate]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const c = pickSearch.results[Number(btn.getAttribute("data-around-candidate"))];
        if (!c || c.lat == null) return;
        // The search found where; the panel below asks what. Still nothing
        // runs until Search is pressed.
        explore.centre = { name: c.name, lat: c.lat, lon: c.lon };
        explore.error = "";
        explore.open = true;
        markExploreStale();
        dismissSearchOverlay();
        showView("picks");
        const panel = document.getElementById("exploreToggle");
        if (panel) panel.scrollIntoView({ block: "start" });
        toast(`Looking around ${c.name} — choose what you want and press Search`);
      });
    });

    searchOverlay.querySelectorAll("[data-add-candidate]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const candidate = pickSearch.results[Number(btn.getAttribute("data-add-candidate"))];
        if (!candidate) return;
        // A town saves as an area straight away: it has no folder question to
        // answer, being its own section, and "which folder does Pitlochry go
        // in" is not a question anyone wants asked about Pitlochry. The toast
        // carries the other reading for the case where you only wanted to
        // remember the name.
        if (candidate.isArea) {
          quickAdd(candidate, { major: true });
          toastWithAction(`Saved ${candidate.name} as an area`, "Just a place", () => {
            const id = pickId("custom", candidate.name);
            setPickMajor(id, false);
            setPickCity(id, "Unsorted");
            renderPicks();
            toast(`${candidate.name} is an ordinary place, unsorted`);
          });
        } else {
          quickAdd(candidate);
        }
        btn.classList.add("added");
        btn.textContent = "✓";
        btn.disabled = true;
      });
    });
  }

  // Searches Google Places when a key is configured, otherwise OpenStreetMap.
  // Google is used because OSM's community data simply doesn't have many
  // smaller businesses; OSM stays as the no-setup default and the fallback
  // for when a Google call fails, so search always works either way.
  // ---------- Where a search is anchored ----------
  // Search results were arriving from anywhere on earth, and the reason was
  // that no part of the chain ever carried a coordinate. Every backend was
  // handed a string - "cafe, Scotland" - and asked to do its best:
  //
  //   Nominatim   free text, no viewbox, no bounds. "Newport" is a town in
  //               Wales, one in Fife, one on the Isle of Wight and about
  //               thirty more.
  //   Google      textQuery only, no location bias, so a global best match
  //               beats a local one every time.
  //   Gemini      told "in Scotland", a country of 30,000 square miles, and
  //               then each name it returned was geocoded by name alone.
  //
  // Nothing checked afterwards that a result was anywhere near where you
  // meant. So: every search is anchored to a real place with real
  // coordinates and a radius, that anchor goes to each backend in the form
  // that backend can actually enforce, and anything that still comes back
  // from the wrong end of the country is dropped and counted rather than
  // listed. The anchor is shown on screen and is one tap to change, because
  // an invisible constraint that is wrong is worse than no constraint.
  const ANCHOR_PART = "search-anchor";
  const ANCHOR_MILES = [5, 15, 25, 50, 100];
  const DEFAULT_ANCHOR_MILES = 25;
  // How far past the radius a result may sit before it is treated as a wrong
  // answer rather than a near miss: the radius is crow-flies, roads are not,
  // and an anchor typed as a town is a point standing in for a place with
  // width.
  const ANCHOR_GRACE = 1.5;

  // A full UK postcode, or just the outward half - "PH16" is what people
  // remember and is already enough to pin a search to a few square miles.
  const POSTCODE_FULL = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
  const POSTCODE_OUT = /\b([A-Z]{1,2}\d[A-Z\d]?)\b/i;

  function postcodeIn(text) {
    const s = String(text || "").trim();
    if (!s) return null;
    const full = s.match(POSTCODE_FULL);
    if (full) return `${full[1].toUpperCase()} ${full[2].toUpperCase()}`;
    // Guarded hard, or every "A9", "M8" and "B1" in a sentence becomes a
    // postcode: the outward code has to be the whole of what was typed.
    const out = s.match(POSTCODE_OUT);
    if (out && out[0].length === s.length && /\d/.test(s)) return out[1].toUpperCase();
    return null;
  }

  function toKm(miles) {
    return miles / MILES_PER_KM;
  }

  function loadAnchor() {
    const stored = readJson(boardKey(activeBoard().id, ANCHOR_PART), null);
    if (stored === "anywhere") return null;
    if (stored && typeof stored === "object" && stored.lat != null) return stored;
    return derivedAnchor();
  }

  function saveAnchor(anchor) {
    localStorage.setItem(boardKey(activeBoard().id, ANCHOR_PART), JSON.stringify(anchor || "anywhere"));
  }

  // A first guess from what is already saved, so the very first search is
  // bounded too. Shown on screen like any other anchor, and cleared in one
  // tap - a guess you can see and change is a different thing from a guess
  // made behind your back.
  function derivedAnchor() {
    const picks = loadPicks().filter((p) => p.lat != null);
    if (!picks.length) return null;

    const majors = picks.filter((p) => p.major);
    if (majors.length === 1) {
      return { name: majors[0].name, lat: majors[0].lat, lon: majors[0].lon, miles: DEFAULT_ANCHOR_MILES };
    }

    const lat = picks.reduce((n, p) => n + p.lat, 0) / picks.length;
    const lon = picks.reduce((n, p) => n + p.lon, 0) / picks.length;
    // Wide enough to hold everything already saved, plus room to find
    // something new next to the furthest of them.
    const furthest = Math.max(...picks.map((p) => toMiles(haversineKm(lat, lon, p.lat, p.lon))));
    const miles = Math.min(150, Math.max(DEFAULT_ANCHOR_MILES, Math.ceil(furthest) + 15));
    const name = nearestMajorPlace(lat, lon) || suggestedFolderFor(lat, lon) || activeBoard().destination || "your places";
    return { name, lat, lon, miles };
  }

  function anchorMiles(anchor) {
    const m = anchor && Number(anchor.miles);
    return Number.isFinite(m) && m > 0 ? m : DEFAULT_ANCHOR_MILES;
  }

  // The box each backend gets, in the units each one wants.
  function anchorBox(anchor) {
    const km = toKm(anchorMiles(anchor));
    const dLat = km / 111;
    const dLon = km / (111 * Math.max(0.2, Math.cos((anchor.lat * Math.PI) / 180)));
    return {
      west: anchor.lon - dLon,
      east: anchor.lon + dLon,
      south: anchor.lat - dLat,
      north: anchor.lat + dLat,
    };
  }

  function anchorViewbox(anchor, grace) {
    const b = anchorBox(grace && grace !== 1 ? Object.assign({}, anchor, { miles: anchorMiles(anchor) * grace }) : anchor);
    return `${b.west},${b.north},${b.east},${b.south}`;
  }

  function withinAnchor(anchor, lat, lon, grace) {
    if (!anchor || lat == null || lon == null) return true;
    return toMiles(haversineKm(anchor.lat, anchor.lon, lat, lon)) <= anchorMiles(anchor) * (grace || 1);
  }

  // The rule that closes the whole class of these bugs: a coordinate outside
  // the area being searched is never assigned to anything.
  //
  // Bounding the search was only half of it. Every lookup that ran *after* the
  // search - the preview map, the save, the background enrich - called the
  // geocoder with no anchor at all, so a result that arrived without
  // coordinates (an AI suggestion OSM has never heard of) got placed by an
  // unbounded name lookup. That is how a correct-looking result turned into a
  // pin in Oxford the moment you opened or saved it.
  //
  // Refusing is deliberate: no coordinates is a place you can still save, read
  // and put on a day. Wrong coordinates are a map that lies, a distance that
  // lies, and a folder chosen from both.
  async function geocodeWithinAnchor(name, hint, anchor) {
    const bound = anchor === undefined ? loadAnchor() : anchor;
    const geo = await geocodePlace(name, hint, bound).catch(() => null);
    if (!geo) return null;
    if (bound && !withinAnchor(bound, geo.lat, geo.lon, ANCHOR_GRACE)) return null;
    return geo;
  }

  // Whether a result's own stated area agrees with where we are looking. Not
  // a geocode - just the two names - because this only has to separate "the
  // model thinks this is local" from "the model has named somewhere else".
  function claimsToBeNear(area, anchor) {
    if (!anchor || !area) return false;
    const flat = (s) => String(s).toLowerCase().replace(/[^a-z ]+/g, "").trim();
    const a = flat(area);
    const b = flat(anchor.name);
    if (!a || !b) return false;
    return a.includes(b) || b.includes(a);
  }

  function describeAnchor(anchor) {
    if (!anchor) return "Anywhere";
    return `${anchor.name} · ${anchorMiles(anchor)} miles`;
  }

  // A pair of decimal degrees, however it was pasted: "56.7028, -3.7317",
  // "56.7028 -3.7317", or with N/S/E/W after each number.
  //
  // This exists because a coordinate typed into the box was being handed to a
  // *text search*, which is not what a coordinate is for. Nominatim answers
  // "56.7028, -3.7317" with whatever text it can match - and it matched
  // something in Oxford. So the anchor itself, the thing meant to keep results
  // local, was being set to the wrong end of the country before a single
  // search ran.
  const LATLON_RE =
    /^\s*(-?\d{1,3}(?:\.\d+)?)\s*([NnSs])?\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*([EeWw])?\s*$/;

  function parseLatLon(text) {
    const m = String(text || "").match(LATLON_RE);
    if (!m) return null;
    let lat = Number(m[1]);
    let lon = Number(m[3]);
    if (/[Ss]/.test(m[2] || "")) lat = -lat;
    if (/[Ww]/.test(m[4] || "")) lon = -lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  }

  function formatLatLon(lat, lon) {
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }

  // Turning what someone typed into an anchor: coordinates used as
  // coordinates, a postcode if it is one - the sharpest thing anyone can give
  // us - otherwise a place name.
  async function anchorFromText(text, miles) {
    const raw = String(text || "").trim();
    if (!raw) return null;

    const point = parseLatLon(raw);
    if (point) {
      // Named from the map rather than looked up by name, so the label is
      // right even when nothing is nearby to name it after.
      const place = await reverseGeocode(point.lat, point.lon).catch(() => null);
      return {
        name: place || formatLatLon(point.lat, point.lon),
        lat: point.lat,
        lon: point.lon,
        miles: miles || DEFAULT_ANCHOR_MILES,
        fromPoint: true,
      };
    }

    const postcode = postcodeIn(raw);
    const geo = await geocodePlace(postcode || raw, null).catch(() => null);
    if (!geo) return null;
    return {
      name: postcode || raw,
      lat: geo.lat,
      lon: geo.lon,
      miles: miles || DEFAULT_ANCHOR_MILES,
      postcode: postcode || null,
    };
  }

  // The anchor a particular search runs against. A postcode in the query wins
  // outright: typing one is the clearest possible statement of where you mean,
  // and it would be perverse to search somewhere else.
  async function anchorForQuery(query) {
    const point = parseLatLon(query);
    if (point) {
      const stored = loadAnchor();
      const found = await anchorFromText(query, stored ? anchorMiles(stored) : DEFAULT_ANCHOR_MILES);
      if (found) return found;
    }
    const postcode = postcodeIn(query);
    if (postcode) {
      const stored = loadAnchor();
      const found = await anchorFromText(postcode, stored ? anchorMiles(stored) : DEFAULT_ANCHOR_MILES);
      if (found) return found;
    }
    return loadAnchor();
  }

  let lastSearchError = "";

  // Searching for a town never found the town. Every backend answers with
  // businesses: the AI is asked for places that are "real, currently-open and
  // still trading", which a town is not, and Google Places answers with
  // establishments. So "Pitlochry" came back as five cafes in Pitlochry, and
  // the one thing you had actually typed was the one thing you could not save.
  //
  // The place itself is now looked up alongside whatever else answers, and if
  // OpenStreetMap says the name is a town, city, village or island it goes to
  // the top of the results as an area you can save in one tap.
  let lastSearchOutside = 0;

  async function searchPlaces(query, guidance, anchor) {
    lastSearchError = "";
    lastSearchOutside = 0;
    // Started first and awaited last, so it costs nothing in wall-clock time
    // against a search that takes seconds.
    const areaPromise = lookupPlacesThemselves(query, anchor).catch(() => []);
    const found = await searchPlaceBackends(query, guidance, anchor);
    const areas = await areaPromise;

    // The last line of defence. Each backend has now been told where to look
    // in the form it can actually enforce, but a grounded model can still name
    // somewhere it likes the sound of, and OSM can still hand back the wrong
    // branch of a chain. A cafe two hundred miles outside the area asked for is
    // not a near miss, it is a wrong answer - so it is dropped, and counted, so
    // the screen can say what happened rather than quietly showing less.
    //
    // Towns are deliberately exempt. The anchor exists to find *things* near
    // you; a place you have typed the name of is not that. Searching "Newport"
    // while anchored to Pitlochry should still offer the Newports, or the
    // screen would be empty with a footnote - and the bounded-first lookup has
    // already put the local one on top when there is one.
    const results = found.filter((r) => {
      if (!r.outsideAnchor && withinAnchor(anchor, r.lat, r.lon, ANCHOR_GRACE)) return true;
      lastSearchOutside++;
      return false;
    });

    if (!areas.length) return results;
    // The backends may have named the town too - keep ours, since ours is the
    // one that knows it is an area.
    const named = areas.map((a) => normalisedName(a.name));
    return areas.concat(results.filter((r) => !named.includes(normalisedName(r.name))));
  }

  function normalisedName(name) {
    return String(name || "").trim().toLowerCase();
  }

  // Asks the geocoder what the query itself is. Deliberately not the AI: this
  // is a question of fact about a name, which is exactly what a gazetteer is
  // for and exactly what a language model should not be asked to invent.
  // Every distinct town of that name, not just the first. Three Newports
  // hundreds of miles apart are three results with their counties written on
  // them - which answers "which one did you mean" by showing you, rather than
  // by picking one and hoping.
  async function lookupPlacesThemselves(query, anchor) {
    const q = (query || "").trim();
    if (!q) return [];
    const base =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1` +
      `&extratags=1&namedetails=1&q=${encodeURIComponent(anchor ? q : scopedQuery(q))}`;
    // Bounded first, unbounded second: searching for a town by name has to
    // keep working for a town you are nowhere near, but the one down the road
    // must win when both exist.
    let data = [];
    for (const url of anchor ? [`${base}&bounded=1&viewbox=${encodeURIComponent(anchorViewbox(anchor))}`, base] : [base]) {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return [];
      data = await res.json();
      if (Array.isArray(data) && data.some((r) => looksLikeMajorPlace({ type: r.type }))) break;
    }
    const hits = (Array.isArray(data) ? data : []).filter((r) => looksLikeMajorPlace({ type: r.type }));

    const out = [];
    hits.forEach((hit) => {
      const details = placeFromNominatim(hit);
      // Same town returned twice is one answer; a different town of the same
      // name is another.
      if (out.some((o) => haversineKm(o.lat, o.lon, details.lat, details.lon) <= AMBIGUOUS_MIN_KM)) return;
      out.push({
        name: (hit.namedetails && hit.namedetails.name) || String(hit.display_name || "").split(",")[0],
        displayName: hit.display_name,
        lat: details.lat,
        lon: details.lon,
        type: hit.type,
        category: details.category,
        description: "",
        address: details.address,
        // What the results list keys off to offer "save as an area".
        isArea: true,
      });
    });
    return out.slice(0, 3);
  }

  async function searchPlaceBackends(query, guidance, anchor) {
    const s = loadTripSettings();
    const geminiKey = s.geminiKey.trim();
    const googleKey = s.googleKey.trim();

    // Gemini leads. It understands a description rather than only a name, and
    // its grounded search reaches the small businesses OSM has never had. OSM
    // still resolves the coordinates for whatever it names, so positions stay
    // real data rather than anything the model produced.
    if (geminiKey) {
      try {
        const results = await searchWithGemini(query, geminiKey, guidance, anchor);
        if (results.length) return results;
      } catch (e) {
        console.warn("Gemini search failed, falling back:", e);
        lastSearchError = e && e.message ? e.message : String(e);
      }
    }

    if (googleKey) {
      try {
        const results = await searchGooglePlaces(query, googleKey, anchor);
        if (results.length) return results;
      } catch (e) {
        console.warn("Google Places search failed, falling back:", e);
        lastSearchError = e && e.message ? e.message : String(e);
      }
    }

    // Final backup: works with no key at all, so search never simply stops.
    try {
      return await searchNominatim(query, anchor);
    } catch (e) {
      if (!lastSearchError) lastSearchError = e && e.message ? e.message : String(e);
      return [];
    }
  }

  // Places API (New) text search. Only the fields named below are requested -
  // billing is per field-mask tier, so asking for less keeps it in the
  // cheapest bracket rather than being charged for data we don't display.
  async function searchGooglePlaces(query, key, anchor) {
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
      // locationRestriction, not locationBias: a bias is a hint Google is free
      // to ignore when it likes a distant match better, which is exactly the
      // failure being fixed. Text search takes a rectangle for the hard form.
      body: JSON.stringify(
        anchor
          ? {
              textQuery: query,
              maxResultCount: 5,
              locationRestriction: {
                rectangle: {
                  low: { latitude: anchorBox(anchor).south, longitude: anchorBox(anchor).west },
                  high: { latitude: anchorBox(anchor).north, longitude: anchorBox(anchor).east },
                },
              },
            }
          : { textQuery: scopedQuery(query), maxResultCount: 5 }
      ),
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

  async function searchNominatim(query, anchor) {
    // extratags/namedetails have to be requested explicitly - without them
    // the name and website below silently read undefined every time.
    //
    // bounded=1 with a viewbox is a hard restriction rather than a preference,
    // which is the point: without it "Newport" returns the one in Wales as
    // readily as the one twenty miles up the road. Appending the region's name
    // instead, as this used to, is just more words in a text search - it
    // restricts nothing.
    const base =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1` +
      `&extratags=1&namedetails=1&q=${encodeURIComponent(anchor ? query : scopedQuery(query))}`;
    const url = anchor ? `${base}&bounded=1&viewbox=${encodeURIComponent(anchorViewbox(anchor))}` : base;
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

  // ---------- Map tiles, kept for when there is no signal ----------
  // Everything else in the app already works offline: the shell is bundled,
  // the places are on the device, the forecast is cached. The maps were the
  // exception - every one of them went grey the moment the signal did, which
  // is exactly where a map earns its place. Tiles are now cached as blobs in
  // IndexedDB, and the trip's area can be fetched ahead of leaving.
  const TILE_DB = "trip-tiles-v1";
  const TILE_STORE = "tiles";
  let tileDbPromise = null;

  function tileDb() {
    if (tileDbPromise) return tileDbPromise;
    tileDbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error("no indexeddb"));
      const req = indexedDB.open(TILE_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(TILE_STORE)) req.result.createObjectStore(TILE_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e) => {
      tileDbPromise = null;
      throw e;
    });
    return tileDbPromise;
  }

  function tileKey(z, x, y) {
    return `${z}/${x}/${y}`;
  }

  async function readTile(z, x, y) {
    const db = await tileDb();
    return new Promise((resolve) => {
      const req = db.transaction(TILE_STORE, "readonly").objectStore(TILE_STORE).get(tileKey(z, x, y));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  async function writeTile(z, x, y, blob) {
    const db = await tileDb();
    return new Promise((resolve) => {
      const tx = db.transaction(TILE_STORE, "readwrite");
      tx.objectStore(TILE_STORE).put(blob, tileKey(z, x, y));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }

  async function countTiles() {
    try {
      const db = await tileDb();
      return await new Promise((resolve) => {
        const req = db.transaction(TILE_STORE, "readonly").objectStore(TILE_STORE).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
      });
    } catch (e) {
      return 0;
    }
  }

  async function clearTiles() {
    try {
      const db = await tileDb();
      await new Promise((resolve) => {
        const tx = db.transaction(TILE_STORE, "readwrite");
        tx.objectStore(TILE_STORE).clear();
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    } catch (e) {
      /* nothing cached to clear */
    }
  }

  function tileUrl(z, x, y) {
    const sub = ["a", "b", "c"][(x + y) % 3];
    return `https://${sub}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
  }

  // Cache first, network second, and whatever the network returns is kept. So
  // anywhere you have looked at with signal is still there without it.
  const CachedTileLayer = L.TileLayer.extend({
    createTile: function (coords, done) {
      const img = document.createElement("img");
      img.alt = "";
      const layer = this;
      let settled = false;
      // A tile fetched from IndexedDB or the network can land after its map
      // has been torn down - closing a sheet mid-load, or a re-render. Leaflet
      // then tries to position a tile belonging to a map that no longer
      // exists, and throws reading _leaflet_pos.
      const finish = (err) => {
        if (settled) return;
        settled = true;
        if (!layer._map) return;
        done(err || null, img);
      };

      readTile(coords.z, coords.x, coords.y)
        .then((blob) => {
          if (blob) {
            img.src = URL.createObjectURL(blob);
            img.onload = () => {
              URL.revokeObjectURL(img.src);
              finish();
            };
            img.onerror = () => finish();
            return null;
          }
          return fetch(tileUrl(coords.z, coords.x, coords.y))
            .then((res) => (res.ok ? res.blob() : null))
            .then((fetched) => {
              if (!fetched) {
                finish(new Error("tile unavailable"));
                return;
              }
              writeTile(coords.z, coords.x, coords.y, fetched).catch(() => {});
              img.src = URL.createObjectURL(fetched);
              img.onload = () => {
                URL.revokeObjectURL(img.src);
                finish();
              };
              img.onerror = () => finish();
            });
        })
        .catch(() => finish(new Error("tile unavailable")));

      return img;
    },
  });

  function addTileLayer(map) {
    new CachedTileLayer("", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
  }

  // ---------- Fetching the trip's area before leaving ----------
  function lonToTileX(lon, z) {
    return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
  }

  function latToTileY(lat, z) {
    const rad = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z));
  }

  // Zoom 11 is "which glen", 15 is "which street". Past 15 the tile count
  // quadruples for detail you can fetch when you are standing there.
  const OFFLINE_ZOOMS = [11, 12, 13, 14, 15];
  // A ceiling so a board covering the whole country cannot quietly pull down
  // a hundred thousand tiles from a service run on donations.
  const OFFLINE_TILE_CAP = 2500;

  function tilesForBounds(bounds, zooms) {
    const list = [];
    zooms.forEach((z) => {
      const x1 = lonToTileX(bounds.west, z);
      const x2 = lonToTileX(bounds.east, z);
      const y1 = latToTileY(bounds.north, z);
      const y2 = latToTileY(bounds.south, z);
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
        for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
          list.push({ z, x, y });
        }
      }
    });
    return list;
  }

  // A margin around the saved places, because you walk between them rather
  // than teleporting to each one.
  function savedPlacesBounds(padDegrees) {
    const located = loadPicks().filter((p) => p.lat != null);
    if (!located.length) return null;
    const pad = padDegrees == null ? 0.08 : padDegrees;
    const lats = located.map((p) => p.lat);
    const lons = located.map((p) => p.lon);
    return {
      north: Math.max.apply(null, lats) + pad,
      south: Math.min.apply(null, lats) - pad,
      east: Math.max.apply(null, lons) + pad,
      west: Math.min.apply(null, lons) - pad,
    };
  }

  // Deliberately serial with a pause between requests. OpenStreetMap's tile
  // policy asks that bulk downloading be avoided; a few hundred tiles for one
  // family's week, fetched politely, is a different thing from scraping, and
  // the cap plus the delay keep it that way.
  async function downloadTiles(onProgress) {
    const bounds = savedPlacesBounds();
    if (!bounds) return { ok: false, message: "Save a few places first — the download follows where they are." };

    let wanted = tilesForBounds(bounds, OFFLINE_ZOOMS);
    const total = wanted.length;
    let trimmed = false;
    if (wanted.length > OFFLINE_TILE_CAP) {
      // Drop the most detailed zoom first: it is the biggest and the least
      // needed, since street detail is what you have signal for in a town.
      wanted = tilesForBounds(bounds, OFFLINE_ZOOMS.slice(0, -1));
      trimmed = true;
    }
    if (wanted.length > OFFLINE_TILE_CAP) wanted = wanted.slice(0, OFFLINE_TILE_CAP);

    let done = 0;
    let saved = 0;
    for (const c of wanted) {
      if (tileDownload.cancelled) break;
      done++;
      try {
        const already = await readTile(c.z, c.x, c.y);
        if (!already) {
          const res = await fetch(tileUrl(c.z, c.x, c.y));
          if (res.ok) {
            await writeTile(c.z, c.x, c.y, await res.blob());
            saved++;
          }
          await new Promise((r) => setTimeout(r, 60));
        }
      } catch (e) {
        // A missing tile is a grey square later, not a failed download.
      }
      if (onProgress && done % 5 === 0) onProgress(done, wanted.length);
    }
    if (onProgress) onProgress(done, wanted.length);

    if (tileDownload.cancelled) {
      return { ok: true, message: `Stopped — ${saved} new tiles kept. What downloaded still works offline.` };
    }
    return {
      ok: true,
      message:
        `Saved ${wanted.length} tiles around your places.` +
        (trimmed ? ` Street-level detail was left out to stay under ${OFFLINE_TILE_CAP} tiles (${total} would have been needed).` : ""),
    };
  }

  const tileDownload = { running: false, cancelled: false };

  // `items` may be a filtered subset of what's on screen, so `cardIndex` maps
  // an item back to the data-candidate it belongs to - without it a pin on a
  // filtered list scrolls to the wrong card.
  function initSearchResultsMap(items, scope, cardIndex) {
    const el = document.getElementById("pickSearchMap");
    if (!el) return;
    const root = scope || view;
    const indexOf = cardIndex || ((r, i) => i);

    // AI-suggested results can arrive without coordinates when the follow-up
    // geocode finds nothing, so only mappable ones are plotted - passing a
    // null lat/lon to Leaflet throws and takes the whole render down.
    const mappable = items
      .map((r, i) => ({ r, i: indexOf(r, i) }))
      .filter(({ r }) => r.lat != null && r.lon != null);
    if (!mappable.length) return;

    const map = L.map(el, { scrollWheelZoom: false });
    pickMiniMaps.push(map);
    addTileLayer(map);
    const markers = mappable.map(({ r, i }) =>
      L.marker([r.lat, r.lon])
        .addTo(map)
        // Escaped, not interpolated: Leaflet treats a string here as HTML,
        // and this name arrived from a geocoder or a model.
        .bindTooltip(`${i + 1}. ${esc(r.name)}`, { permanent: false })
    );
    const bounds = L.latLngBounds(mappable.map(({ r }) => [r.lat, r.lon]));
    map.fitBounds(bounds.pad(0.3));
    markers.forEach((m, idx) => {
      const originalIndex = mappable[idx].i;
      m.on("click", () => {
        const card = root.querySelector(`[data-candidate="${originalIndex}"]`);
        if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });
    // The overlay is laid out only once visible, so Leaflet's idea of the
    // canvas size is stale until the next frame.
    requestAnimationFrame(() => {
      if (map._container && map._container.isConnected) map.invalidateSize();
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

  // ---------- Every saved place on one map ----------
  // The list groups places by folder, which answers "what have I saved" but
  // never "where are these in relation to each other". That second question
  // is the one that decides a day: three places on the same street belong
  // together, and one an hour out of town has to be its own morning. Seeing
  // them all at once is the only way that's obvious before you're standing
  // there with a tired four-year-old.
  const mapOverlay = document.getElementById("mapOverlay");
  let allMap = null;
  let allMapFilter = "all";

  function allMapFilters() {
    const opts = [{ key: "all", label: "All" }];
    const picks = loadPicks();
    if (activeBoard().dated) {
      const plan = loadPlan();
      plan.days.forEach((d) => {
        if ((plan.items[d.id] || []).length) {
          opts.push({ key: `day:${d.id}`, label: shortDayLabel(d.label) });
        }
      });
    }
    const folders = loadFolders().slice();
    picks.forEach((p) => {
      const f = p.city || "Unsorted";
      if (!folders.includes(f)) folders.push(f);
    });
    folders.forEach((f) => {
      if (picks.some((p) => (p.city || "Unsorted") === f)) opts.push({ key: `folder:${f}`, label: f });
    });
    return opts;
  }

  // Returns { p, order } - order is only set for a day, where the sequence is
  // the plan's own order and worth numbering on the pins.
  function picksForMapFilter(filter) {
    const picks = loadPicks();
    if (filter && filter.startsWith("day:")) {
      const dayId = filter.slice(4);
      const plan = loadPlan();
      return (plan.items[dayId] || [])
        .map((it, i) => ({ p: picks.find((x) => x.id === it.pickId), order: i + 1, time: it.time }))
        .filter((e) => e.p);
    }
    if (filter && filter.startsWith("folder:")) {
      const folder = filter.slice(7);
      return picks.filter((p) => (p.city || "Unsorted") === folder).map((p) => ({ p }));
    }
    return picks.map((p) => ({ p }));
  }

  // Google Maps' URL API takes one origin, one destination and up to nine
  // waypoints, so a long list is truncated rather than silently mangled. A
  // single place goes to its listing instead of a pointless one-stop route.
  const MAPS_MAX_STOPS = 10;
  function googleMapsRouteUrl(entries) {
    const pts = entries.map((e) => e.p).filter((p) => p.lat != null && p.lon != null);
    if (!pts.length) return null;
    if (pts.length === 1) return pickGoogleUrl(pts[0]);
    const capped = pts.slice(0, MAPS_MAX_STOPS);
    const at = (p) => `${p.lat},${p.lon}`;
    const waypoints = capped.slice(1, -1).map(at).join("|");
    // One long hop makes the whole day a drive - handing Google a walking
    // route between towns is no use to anyone.
    let mode = "walking";
    for (let i = 1; i < capped.length; i++) {
      const km = haversineKm(capped[i - 1].lat, capped[i - 1].lon, capped[i].lat, capped[i].lon);
      if (km * ROAD_FACTOR > WALK_MAX_KM) {
        mode = "driving";
        break;
      }
    }
    return (
      `https://www.google.com/maps/dir/?api=1&origin=${at(capped[0])}` +
      `&destination=${at(capped[capped.length - 1])}&travelmode=${mode}` +
      (waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "")
    );
  }

  function openAllMap(filter) {
    allMapFilter = filter || "all";
    renderAllMap();
  }

  function dismissAllMap() {
    closeAllMap();
  }

  function closeAllMap() {
    if (allMap) {
      allMap.remove();
      allMap = null;
    }
    mapOverlay.classList.remove("open");
    mapOverlay.innerHTML = "";
  }

  function renderAllMap() {
    const filters = allMapFilters();
    if (!filters.some((f) => f.key === allMapFilter)) allMapFilter = "all";
    const entries = picksForMapFilter(allMapFilter);
    const mappable = entries.filter((e) => e.p.lat != null && e.p.lon != null);
    const missing = entries.length - mappable.length;
    const routeUrl = googleMapsRouteUrl(entries);
    const truncated = mappable.length > MAPS_MAX_STOPS;

    mapOverlay.innerHTML = `
      <div class="map-head">
        <button class="map-close" data-map-close="1" aria-label="Close map">✕</button>
        <div class="map-head-text">
          <div class="map-title">${mappable.length} on the map</div>
          ${missing ? `<div class="map-sub">${missing} still without a location</div>` : ""}
        </div>
        <button class="map-locate" id="allMapLocate" aria-label="Find me">◎</button>
      </div>
      <div class="map-filters">
        ${filters
          .map(
            (f) =>
              `<button class="map-chip${f.key === allMapFilter ? " on" : ""}" data-map-filter="${esc(
                f.key
              )}">${esc(f.label)}</button>`
          )
          .join("")}
      </div>
      <div class="map-canvas" id="allMapCanvas"></div>
      ${
        mappable.length
          ? `<div class="map-foot">
               <button class="map-open-btn" id="allMapGoogle">↗ ${
                 mappable.length === 1 ? "Open in Google Maps" : "Route in Google Maps"
               }</button>
               ${truncated ? `<div class="map-note">Google Maps takes 10 stops — the first 10 are sent.</div>` : ""}
             </div>`
          : `<div class="map-foot"><div class="map-note">${
              entries.length
                ? "None of these have coordinates yet — open one and it'll look them up."
                : "Nothing saved here yet. Add places from Picks and they'll appear on this map."
            }</div></div>`
      }
    `;
    mapOverlay.classList.add("open");

    mapOverlay.querySelectorAll("[data-map-close]").forEach((b) =>
      b.addEventListener("click", dismissAllMap)
    );
    mapOverlay.querySelectorAll("[data-map-filter]").forEach((b) =>
      b.addEventListener("click", () => openAllMap(b.getAttribute("data-map-filter")))
    );
    const googleBtn = document.getElementById("allMapGoogle");
    if (googleBtn && routeUrl) googleBtn.addEventListener("click", () => openExternal(routeUrl));

    if (allMap) {
      allMap.remove();
      allMap = null;
    }
    if (!mappable.length) return;

    const canvas = document.getElementById("allMapCanvas");
    allMap = L.map(canvas, { scrollWheelZoom: true, attributionControl: false });
    addTileLayer(allMap);

    mappable.forEach((e) => {
      const label = e.order != null ? String(e.order) : "";
      const cls = ["map-pin", e.p.booked ? "booked" : "", e.order != null ? "ordered" : ""]
        .filter(Boolean)
        .join(" ");
      L.marker([e.p.lat, e.p.lon], {
        icon: L.divIcon({
          className: "map-pin-wrap",
          html: `<span class="${cls}">${esc(label)}</span>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
      })
        .addTo(allMap)
        .bindPopup(
          `<div class="map-pop">
             <div class="map-pop-name">${esc(e.p.name)}</div>
             ${
               e.p.category || e.time
                 ? `<div class="map-pop-meta">${esc([e.time, e.p.category].filter(Boolean).join(" · "))}</div>`
                 : ""
             }
             <div class="map-pop-actions">
               <button class="map-pop-btn" data-map-detail="${esc(e.p.id)}">Details</button>
               <button class="map-pop-btn" data-map-dir="${esc(directionsUrl(e.p))}">Directions</button>
             </div>
           </div>`
        );
    });

    // Popup buttons only exist once a popup is open, so they're wired then.
    allMap.on("popupopen", (ev) => {
      const root = ev.popup.getElement();
      if (!root) return;
      const detail = root.querySelector("[data-map-detail]");
      if (detail) {
        detail.addEventListener("click", () => {
          const id = detail.getAttribute("data-map-detail");
          dismissAllMap();
          showView("picks");
          openPickDetail(id);
        });
      }
      const dir = root.querySelector("[data-map-dir]");
      if (dir) dir.addEventListener("click", () => openExternal(dir.getAttribute("data-map-dir")));
    });

    const bounds = L.latLngBounds(mappable.map((e) => [e.p.lat, e.p.lon]));
    if (mappable.length === 1) allMap.setView(bounds.getCenter(), 15);
    else allMap.fitBounds(bounds.pad(0.2));
    // The overlay is only laid out once it's visible, so Leaflet's idea of
    // the canvas size is stale until the next frame.
    requestAnimationFrame(() => {
      if (allMap && allMap._container && allMap._container.isConnected) allMap.invalidateSize();
    });

    const locate = document.getElementById("allMapLocate");
    if (locate) locate.addEventListener("click", () => showMeOnAllMap(locate));
  }

  async function showMeOnAllMap(btn) {
    if (!allMap) return;
    btn.disabled = true;
    try {
      const pos = await currentPosition();
      if (!allMap) return;
      L.circleMarker([pos.lat, pos.lon], {
        radius: 8,
        color: "#fff",
        weight: 3,
        fillColor: "#1a73e8",
        fillOpacity: 1,
      })
        .addTo(allMap)
        .bindTooltip("You are here"); // fixed string, nothing to escape
      allMap.setView([pos.lat, pos.lon], Math.max(allMap.getZoom(), 14));
    } catch (e) {
      toast((e && e.message) || "Couldn't get your location");
    } finally {
      btn.disabled = false;
    }
  }

  // Native geolocation when running in the app, the browser's otherwise.
  function currentPosition() {
    const geo = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation;
    if (geo) {
      return (async () => {
        let perm = await geo.checkPermissions();
        if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
          perm = await geo.requestPermissions({ permissions: ["location", "coarseLocation"] });
        }
        if (perm.location === "denied" && perm.coarseLocation === "denied") {
          throw new Error("Location permission was declined — enable it in Android settings.");
        }
        const pos = await geo.getCurrentPosition({ enableHighAccuracy: false, timeout: 15000 });
        return { lat: pos.coords.latitude, lon: pos.coords.longitude };
      })();
    }
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("This device didn't offer location access."));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (err) => reject(new Error(`Couldn't get your location: ${err.message}`)),
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
      );
    });
  }

  // ---------- Choosing a place by pointing at it ----------
  // Every other way in needs a name: type one, use a saved one, or be
  // standing in it. But "the bit of coast north of the bridge" and "that
  // village we drove through" have no name you'd type - and on a trip
  // that's most of the map. Drag, drop the pin, done. The name is looked up
  // afterwards so the result still reads like a place rather than a
  // coordinate.
  let mapPickTarget = null; // callback for the chosen point

  function openMapPicker(onPick, opts) {
    const options = opts || {};
    mapPickTarget = onPick;

    const picks = loadPicks().filter((p) => p.lat != null);
    const start =
      options.centre ||
      (picks.length ? { lat: picks[0].lat, lon: picks[0].lon } : null) ||
      destinationAnchor(null) ||
      { lat: 55.9533, lon: -3.1883 };

    mapOverlay.innerHTML = `
      <div class="map-head">
        <button class="map-close" data-mappick-close="1" aria-label="Cancel">✕</button>
        <div class="map-head-text">
          <div class="map-title">${esc(options.title || "Point at a place")}</div>
          <div class="map-sub">Drag the map — the pin stays in the middle</div>
        </div>
        <button class="map-locate" id="mapPickLocate" aria-label="Find me">◎</button>
      </div>
      <div class="map-canvas map-pick-canvas" id="mapPickCanvas">
        <div class="map-crosshair" aria-hidden="true">📍</div>
      </div>
      <div class="map-foot">
        <div class="map-pick-label" id="mapPickLabel">Move the map to choose a spot</div>
        <button class="map-open-btn" id="mapPickConfirm">Use this spot</button>
      </div>
    `;
    mapOverlay.classList.add("open");

    mapOverlay.querySelectorAll("[data-mappick-close]").forEach((b) =>
      b.addEventListener("click", () => {
        mapPickTarget = null;
        closeAllMap();
      })
    );

    if (allMap) {
      allMap.remove();
      allMap = null;
    }
    const map = L.map(document.getElementById("mapPickCanvas"), {
      scrollWheelZoom: true,
      attributionControl: false,
    });
    allMap = map; // so closeAllMap tears it down
    addTileLayer(map);
    map.setView([start.lat, start.lon], options.zoom || 13);
    requestAnimationFrame(() => {
      if (map._container && map._container.isConnected) map.invalidateSize();
    });

    // The name lags behind the map on purpose: reverse geocoding on every
    // frame of a drag would hammer a free service for answers nobody reads.
    let nameTimer = null;
    const labelEl = () => document.getElementById("mapPickLabel");
    let currentName = "";

    const refreshName = () => {
      const c = map.getCenter();
      const el = labelEl();
      if (el) el.textContent = "Looking up where that is…";
      clearTimeout(nameTimer);
      nameTimer = setTimeout(async () => {
        const name = await reverseGeocode(c.lat, c.lng);
        currentName = name || "";
        const e2 = labelEl();
        if (e2) {
          e2.textContent = name || `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`;
        }
      }, 550);
    };

    map.on("moveend", refreshName);
    refreshName();

    const locate = document.getElementById("mapPickLocate");
    if (locate) {
      locate.addEventListener("click", async () => {
        locate.disabled = true;
        try {
          const pos = await currentPosition();
          map.setView([pos.lat, pos.lon], 15);
        } catch (e) {
          toast((e && e.message) || "Couldn't get your location");
        } finally {
          locate.disabled = false;
        }
      });
    }

    document.getElementById("mapPickConfirm").addEventListener("click", () => {
      const c = map.getCenter();
      const cb = mapPickTarget;
      mapPickTarget = null;
      closeAllMap();
      if (cb) {
        cb({
          lat: c.lat,
          lon: c.lng,
          name: currentName || `${c.lat.toFixed(3)}, ${c.lng.toFixed(3)}`,
        });
      }
    });
  }

  // Turns a point back into a name. Zoom 14 asks for the neighbourhood or
  // village rather than a house number, which is the right grain for "search
  // around here".
  async function reverseGeocode(lat, lon) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${lon}`,
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const a = data.address || {};
      const parts = [
        a.neighbourhood || a.suburb || a.village || a.town || a.hamlet,
        a.city || a.county,
      ].filter(Boolean);
      const unique = parts.filter((p, i) => parts.indexOf(p) === i);
      return unique.length ? unique.join(", ") : data.name || null;
    } catch (e) {
      return null;
    }
  }

  // Opening the map from Today or the Itinerary almost always means "these
  // ones", not "all 40 things I've ever saved" - so it starts on the day in
  // view. The All chip is right there when that guess is wrong.
  function defaultMapFilter() {
    const tab = view.dataset.activeTab;
    if (tab !== "today" && tab !== "itinerary") return "all";
    if (!activeBoard().dated) return "all";
    const current = currentPlanDay();
    if (!current) return "all";
    const plan = loadPlan();
    return (plan.items[current.day.id] || []).length ? `day:${current.day.id}` : "all";
  }

  document.getElementById("mapBtn").addEventListener("click", () => openAllMap(defaultMapFilter()));

  // What the geocoder may be told about where a place is. Deliberately NOT the
  // folder: a folder is the user's own filing - "Unsorted", "Day trips",
  // anything they typed - and feeding it to a geocoder both wastes the lookup
  // (", Unsorted" matches nothing) and, when the folder happens to name a real
  // place, can pull the wrong branch of a chain into view. Only what the
  // result itself said about its location counts.
  function geographicHint(candidate) {
    const from = candidate.displayName || candidate.address || candidate.area || "";
    return String(from).trim() || null;
  }

  async function confirmAddCandidate(candidate, folder, opts) {
    const id = pickId("custom", candidate.name);
    const major = !!(opts && opts.major);
    const picks = loadPicks();
    if (picks.some((p) => p.id === id)) {
      if (view.dataset.activeTab === "picks") renderPicks();
      return;
    }
    // The section has to exist before the place can head it.
    if (major) addFolder(candidate.name);
    // Maps query is built from real geographic data (Nominatim's full
    // address, when we have it) - never from the folder, which is just the
    // user's own organisation and may have nothing to do with geography.
    // Not the address. Storing the address here is what sent every "open in
    // Maps" to a street rather than the place standing on it.
    const area = candidate.area || candidate.town || townFromAddress(candidate.address) || "";
    const mapsQuery = [candidate.name, area].filter(Boolean).join(", ");
    const pick = {
      id,
      source: "custom",
      name: candidate.name,
      // Every caller passes a folder the user chose. The fallback is the
      // honest one - undecided - never a guess.
      city: folder || "Unsorted",
      major,
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
      area,
      lat: candidate.lat,
      lon: candidate.lon,
      enrichStatus: "loading",
      addedAt: Date.now(),
    };
    picks.push(pick);
    savePicks(picks);
    // Deliberately does NOT clear the search: results now live on their own
    // screen that stays open so several places can be added in a row, and
    // wiping the list out from under the second tap is exactly the bug that
    // caused. Re-render only the tab actually on screen.
    if (view.dataset.activeTab === "picks") renderPicks();

    // A candidate can arrive without coordinates - an AI suggestion whose
    // geocode came back empty, for instance - so retry the lookup here rather
    // than leaving the pick permanently without a position (and so without a
    // map or "explore nearby").
    const needsGeo = candidate.lat == null || candidate.lon == null;
    const [wiki, geoCandidates] = await Promise.all([
      wikiEnrich(candidate.name).catch(() => null),
      needsGeo
        ? geocodeCandidates(candidate.name, geographicHint(candidate), loadAnchor())
            .then((list) => list.filter((c) => withinAnchor(loadAnchor(), c.lat, c.lon, ANCHOR_GRACE)))
            .catch(() => [])
        : Promise.resolve([]),
    ]);
    const geo = geoCandidates.length ? geoCandidates[0] : null;

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
      if (!target.area && geo.town) target.area = geo.town;
      if (!target.website && geo.website) target.website = geo.website;
      if (!target.address && geo.address) target.address = geo.address;
      if (!target.phone && geo.phone) target.phone = geo.phone;
      if (!target.openingHours && geo.openingHours) target.openingHours = geo.openingHours;
      noteLocationDoubt(target, geoCandidates);
    }
    target.enrichStatus = wiki || geo ? "done" : "empty";
    savePicks(fresh);
    if (view.dataset.activeTab === "picks") renderPicks();
  }

  // Places and Eats used to be tabs of their own. They were never separate
  // collections - both read the same saved list and split it with a regex over
  // the category text - so the app offered three destinations for one thing and
  // spent three of its eight tab slots saying so. Eight tabs on a 390px screen
  // is a 48px target with the label shrunk to fit; the guidance is five.
  //
  // They are a filter here instead. Same lists, same rows, one destination.
  let pickKindFilter = "all";
  let guideOpen = false;
  const KIND_FILTERS = [
    { key: "all", label: "All" },
    { key: "place", label: "🏛️ To do" },
    { key: "eat", label: "🍽️ Eat" },
  ];

  // Entry point for the old Places/Eats routes: same screen, filter preset.
  function renderPicksFiltered(kind) {
    pickKindFilter = kind;
    renderPicks();
  }

  function renderPicks() {
    const all = loadPicks();
    const picks = pickKindFilter === "all" ? all : all.filter((p) => p.major || pickKind(p) === pickKindFilter);

    let html = `
      <div class="search-trigger-wrap">
        <span class="search-trigger-icon">🔍</span>
        <input class="search-trigger-input" id="pickSearchTrigger" type="text"
               placeholder="Search for a place, town or area…" readonly
               aria-label="Search for a place to add" />
      </div>
      ${renderExplore()}
    `;

    // Only worth showing once there is a mix to separate. A filter over four
    // places that are all cafés is a control that can only ever hide things.
    // Also shown whenever a filter is already on, so an active filter can
    // never be the reason its own control is hidden.
    const kinds = new Set(all.filter((p) => !p.major).map((p) => pickKind(p)));
    if (kinds.size > 1 || pickKindFilter !== "all") {
      html += `<div class="filter-row kind-row">${KIND_FILTERS.map(
        (k) =>
          `<button class="filter-chip${k.key === pickKindFilter ? " active" : ""}" data-pick-kind-filter="${k.key}">${
            k.label
          }</button>`
      ).join("")}</div>`;
    }

    if (all.length === 0) {
      // Guidance belongs here, where it's actually needed, rather than
      // permanently occupying the top of the screen once you know the app.
      html += `
        <div class="card empty-state">
          <div class="empty-icon">♡</div>
          <h2>No places saved yet</h2>
          <ul class="empty-list">
            <li><b>Share from Google Maps</b> — tap Share on a place, pick this app</li>
            <li><b>Search</b> — by name, or describe what you want</li>
            <li><b>Explore around a place</b> — cafés, museums, playgrounds nearby</li>
            <li><b>Have a trip suggested</b> — say roughly where and how far, get whole routes back</li>
          </ul>
          <button class="modal-btn modal-btn-primary" data-open-search="1" style="width:100%;margin-top:12px;">🔍 Search for a place</button>
          <button class="modal-btn" data-open-idea="1" style="width:100%;margin-top:8px;">🧭 Suggest a trip</button>
          <p class="settings-hint">Tapping ♡ on a guide suggestion below saves it here too.</p>
        </div>
      `;
    } else if (!picks.length) {
      html += `<div class="card"><p class="pick-status">Nothing saved under that filter yet.</p></div>`;
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

      // A major place heads the section named after it rather than appearing
      // as a row inside it - it *is* the section. (If one has been moved into
      // some other folder by hand, it goes back to being an ordinary row
      // there, which is the only sensible reading of that move.)
      const majorByName = {};
      picks.forEach((p) => {
        if (p.major && p.city === p.name) majorByName[p.name] = p;
      });

      const groups = {};
      sectionOrder.forEach((c) => (groups[c] = []));
      picks.forEach((p) => {
        if (majorByName[p.name] === p) return;
        (groups[p.city] || groups.Unsorted).push(p);
      });

      // Sorting came across from the Places tab. It applies within each
      // section rather than flattening the list, so the areas keep their
      // shape and "Nearest" still means something inside a town.
      const sortKey = loadSort();
      const origin = sortKey === "near" ? sortOrigin() : null;
      if (picks.length > 2) {
        html += `<div class="sort-row">${SORTS.map(
          (s) => `<button class="sort-chip${s.key === sortKey ? " on" : ""}" data-sort="${s.key}">${esc(s.label)}</button>`
        ).join("")}</div>`;
      }

      sectionOrder.forEach((city) => {
        const major = majorByName[city];
        if (!groups[city].length && !major) return;
        html += major
          ? renderMajorHeader(major, groups[city].length)
          : `<div class="section-label">${esc(city)}</div>`;
        sortPicks(groups[city], sortKey, origin).forEach((p) => {
          const away =
            origin && p.lat != null && p.id !== origin.id
              ? formatDistance(haversineKm(origin.lat, origin.lon, p.lat, p.lon))
              : null;
          html += renderPickRow(p, away);
        });
      });
    }

    // The bundled guide came across too, collapsed. It is suggestions rather
    // than your list, so it sits at the bottom and stays out of the way until
    // asked for - the same bargain Explore makes at the top.
    const board = activeBoard();
    if (board.hasGuide) {
      html += `
        <div class="card" style="margin-top:16px;">
          <div class="explore-head" id="guideToggle">
            <b>📖 Edinburgh guide</b>
            <span class="chevron">${guideOpen ? "▼" : "▶"}</span>
          </div>
          ${
            guideOpen
              ? `<p class="search-hint">Suggestions that came with this trip. Tap ♡ to save one into your list.</p>` +
                (pickKindFilter !== "eat" ? renderGuidePlaces() : "") +
                (pickKindFilter !== "place" ? renderGuideEats() : "")
              : ""
          }
        </div>
      `;
    }

    destroyMiniMaps();
    view.innerHTML = html;
    wireExplore();

    view.querySelectorAll("[data-pick-kind-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        pickKindFilter = btn.getAttribute("data-pick-kind-filter");
        renderPicks();
      });
    });

    view.querySelectorAll("[data-sort]").forEach((btn) =>
      btn.addEventListener("click", () => {
        saveSort(btn.getAttribute("data-sort"));
        renderPicks();
      })
    );

    const guideToggle = document.getElementById("guideToggle");
    if (guideToggle) {
      guideToggle.addEventListener("click", () => {
        guideOpen = !guideOpen;
        renderPicks();
      });
    }

    // Guide entries open the same sheet a search result does, and the ♡ saves
    // one straight into the list - both exactly as they behaved on the tabs
    // these came from.
    view.querySelectorAll("[data-preview-guide]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const [source, index] = btn.getAttribute("data-preview-guide").split("|");
        openGuidePreview(source, Number(index));
      })
    );
    wirePickToggles(renderPicks);

    // Search has its own screen now - these are just the ways in.
    const searchTrigger = document.getElementById("pickSearchTrigger");
    if (searchTrigger) {
      // It reads as a search field and now behaves as one: one tap and you are
      // typing, rather than one tap to reach a screen that has the field on it.
      const open = () => openSearchOverlay("");
      searchTrigger.addEventListener("click", open);
      searchTrigger.addEventListener("focus", open);
    }
    view.querySelectorAll("[data-open-search]").forEach((b) =>
      b.addEventListener("click", () => openSearchOverlay(""))
    );
    view.querySelectorAll("[data-open-idea]").forEach((b) =>
      b.addEventListener("click", () => openTripIdea())
    );

    // No per-pick maps in the list any more: the single map lives in the
    // detail sheet. Ten saved places used to mean ten live Leaflet instances
    // stacked on one screen.

    view.querySelectorAll("[data-open-pick]").forEach((row) => {
      row.addEventListener("click", () => openPickDetail(row.getAttribute("data-open-pick")));
    });

    // Straight from an area's heading to Explore centred on it - still without
    // searching, so you choose what you're looking for before anything runs.
    view.querySelectorAll("[data-explore-from]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        explore.open = true;
        setExploreCentreFromPick(btn.getAttribute("data-explore-from"));
        const panel = document.getElementById("exploreToggle");
        if (panel) panel.scrollIntoView({ block: "start" });
      });
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
        removePickWithUndo(btn.getAttribute("data-remove-pick"), renderPicks);
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

  // ---------- Weather ----------
  // Open-Meteo: free, no API key, no account, 16 days of daily forecast. That
  // matters as much as accuracy here - the app works with no setup, and a
  // weather feature that first demanded a signup would be the only part that
  // didn't.
  //
  // Forecasts are cached because the Today screen, a day card and a place
  // sheet all want the same answer, and because a cached number is still
  // worth showing on a road with no signal - labelled with its age rather
  // than passed off as current.
  const WEATHER_KEY = "weather-cache-v1";
  const WEATHER_TTL_MS = 60 * 60 * 1000; // an hour; daily forecasts don't move faster
  const WEATHER_HORIZON_DAYS = 16; // as far as Open-Meteo forecasts

  // WMO weather codes, grouped to the differences you'd actually change plans
  // over rather than all 28 of them.
  const WMO = [
    { max: 0, icon: "☀️", label: "Clear" },
    { max: 2, icon: "🌤️", label: "Mostly sunny" },
    { max: 3, icon: "☁️", label: "Cloudy" },
    { max: 48, icon: "🌫️", label: "Fog" },
    { max: 55, icon: "🌦️", label: "Drizzle" },
    { max: 57, icon: "🌧️", label: "Freezing drizzle" },
    { max: 65, icon: "🌧️", label: "Rain" },
    { max: 67, icon: "🌧️", label: "Freezing rain" },
    { max: 77, icon: "🌨️", label: "Snow" },
    { max: 82, icon: "🌦️", label: "Showers" },
    { max: 86, icon: "🌨️", label: "Snow showers" },
    { max: 99, icon: "⛈️", label: "Thunderstorms" },
  ];

  function weatherLook(code) {
    return WMO.find((w) => code <= w.max) || { icon: "🌡️", label: "" };
  }

  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function daysFromNow(date) {
    const a = new Date();
    a.setHours(0, 0, 0, 0);
    const b = new Date(date);
    b.setHours(0, 0, 0, 0);
    return Math.round((b - a) / 86400000);
  }

  // Rounded so places in the same town share one forecast and one request -
  // about 1km, far finer than a daily forecast actually varies.
  function weatherCacheKey(lat, lon) {
    return `${lat.toFixed(2)},${lon.toFixed(2)}`;
  }

  function loadWeatherCache() {
    const c = readJson(WEATHER_KEY, {});
    return c && typeof c === "object" ? c : {};
  }

  const weatherInFlight = {};

  // Returns what's cached straight away, even if stale, and refreshes in the
  // background - a screen should never block on the network for something
  // this peripheral.
  function weatherFor(lat, lon, onUpdate) {
    if (lat == null || lon == null) return null;
    const key = weatherCacheKey(lat, lon);
    const entry = loadWeatherCache()[key];
    const fresh = entry && Date.now() - entry.fetchedAt < WEATHER_TTL_MS;

    if (!fresh && !weatherInFlight[key]) {
      weatherInFlight[key] = fetchWeather(lat, lon)
        .then((days) => {
          const c = loadWeatherCache();
          c[key] = { fetchedAt: Date.now(), days };
          localStorage.setItem(WEATHER_KEY, JSON.stringify(c));
          if (onUpdate) onUpdate();
        })
        .catch(() => {
          /* keep whatever is cached; its age is shown alongside it */
        })
        .finally(() => {
          delete weatherInFlight[key];
        });
    }

    return entry ? { days: entry.days, fetchedAt: entry.fetchedAt, stale: !fresh } : null;
  }

  async function fetchWeather(lat, lon) {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,` +
      `precipitation_sum,wind_speed_10m_max&timezone=auto&forecast_days=${WEATHER_HORIZON_DAYS}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const data = await res.json();
    const d = data.daily || {};
    return (d.time || []).map((date, i) => ({
      date,
      code: d.weather_code ? d.weather_code[i] : null,
      max: d.temperature_2m_max ? Math.round(d.temperature_2m_max[i]) : null,
      min: d.temperature_2m_min ? Math.round(d.temperature_2m_min[i]) : null,
      rainChance: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null,
      rainMm: d.precipitation_sum ? d.precipitation_sum[i] : null,
      wind: d.wind_speed_10m_max ? Math.round(d.wind_speed_10m_max[i]) : null,
    }));
  }

  // The point on the map a day's weather is about: the first scheduled place
  // with coordinates, falling back to anything else saved on the board.
  // Where the board is, for when nothing saved has coordinates yet. Geocoded
  // once and remembered - "Edinburgh" does not move.
  const DEST_COORDS_KEY = "destination-coords-v1";
  const destLookups = {};

  function destinationAnchor(onUpdate) {
    const board = activeBoard();
    const dest = (board.destination || loadTripSettings().destination || "").trim();
    if (!dest) return null;

    const cache = readJson(DEST_COORDS_KEY, {}) || {};
    const hit = cache[dest.toLowerCase()];
    if (hit) return { name: dest, lat: hit.lat, lon: hit.lon };

    if (!destLookups[dest]) {
      destLookups[dest] = geocodePlace(dest, null)
        .then((geo) => {
          if (!geo) return;
          const c = readJson(DEST_COORDS_KEY, {}) || {};
          c[dest.toLowerCase()] = { lat: geo.lat, lon: geo.lon };
          localStorage.setItem(DEST_COORDS_KEY, JSON.stringify(c));
          if (onUpdate) onUpdate();
        })
        .catch(() => {})
        .finally(() => {
          delete destLookups[dest];
        });
    }
    return null;
  }

  // The point a day's weather is about. This used to stop at the saved
  // places, so a board with nothing saved - or nothing saved *with
  // coordinates* - showed no weather at all and gave no clue why. "What's the
  // weather where I'm going" shouldn't depend on having already bookmarked a
  // café there, so it falls back to the board's own destination.
  function dayWeatherAnchor(dayId, onUpdate) {
    const plan = loadPlan();
    const picks = loadPicks();
    const byId = {};
    picks.forEach((p) => (byId[p.id] = p));
    const scheduled = (plan.items[dayId] || []).map((it) => byId[it.pickId]).filter(Boolean);
    return (
      scheduled.find((p) => p.lat != null) ||
      picks.find((p) => p.lat != null) ||
      destinationAnchor(onUpdate)
    );
  }

  // Resolved through the plan rather than parsed alone, so a day in January on
  // a trip that started in December gets next year rather than this one.
  function dateForDayLabel(label) {
    const hit = datedDays(loadPlan().days).find((x) => x.d.label === label);
    if (hit && hit.when) return hit.when;
    return dayLabelToDate(label, new Date().getFullYear());
  }

  function forecastForDay(dayLabel, anchor, onUpdate) {
    if (!anchor || anchor.lat == null) return null;
    const date = dateForDayLabel(dayLabel);
    if (!date) return null; // an undated day like "Day 1" has no weather to give
    const ahead = daysFromNow(date);
    if (ahead < 0) return null;
    if (ahead >= WEATHER_HORIZON_DAYS) {
      // Beyond the horizon, saying so is honest. Dressing up a seasonal
      // average as a forecast is not, and this is a trip people will pack for.
      return { tooFar: true, ahead };
    }
    const w = weatherFor(anchor.lat, anchor.lon, onUpdate);
    if (!w) return null;
    const day = w.days.find((d) => d.date === isoDate(date));
    return day ? { day, stale: w.stale, place: anchor.name } : null;
  }

  function weatherLine(f, opts) {
    if (!f) return "";
    const options = opts || {};
    if (f.tooFar) {
      return options.quiet
        ? ""
        : `<div class="weather-line muted">🗓️ Forecast lands nearer the time — ${f.ahead} days away</div>`;
    }
    const d = f.day;
    const look = weatherLook(d.code == null ? 3 : d.code);
    const wet = d.rainChance != null && d.rainChance >= 50;
    const bits = [
      `${look.icon} ${esc(look.label)}`,
      d.max != null ? `${d.max}°/${d.min}°` : null,
      d.rainChance != null ? `💧 ${d.rainChance}%` : null,
      d.wind != null && d.wind >= 40 ? `💨 ${d.wind} km/h` : null,
    ].filter(Boolean);
    return `
      <div class="weather-line${wet ? " wet" : ""}">
        <span class="weather-bits">${bits.join(" · ")}</span>
        ${f.stale ? `<span class="weather-stale">saved earlier</span>` : ""}
      </div>
      ${
        wet && !options.quiet
          ? `<button class="weather-suggest" data-rainy-day="1">🌧️ Wet day — find something indoors</button>`
          : ""
      }
    `;
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
    const dated = datedDays(plan.days).map((x) => ({ day: x.d, date: x.when }));

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
    const items = itemsInDayOrder((plan.items[current.day.id] || []).filter((it) => byId[it.pickId]));
    const dayCode = dayCodeFromLabel(current.day.label);
    // Was always the first stop of the day, which by mid-afternoon pointed at
    // something finished hours ago - on the one screen meant for use while you
    // are out of the flat.
    const nextIdx = nextItemIndex(items, current.isToday, new Date());

    // Weather belongs at the top of Today: it's the one thing that changes a
    // plan before you've left the flat.
    const redrawToday = () => {
      if (view.dataset.activeTab === "today") renderToday();
    };
    const forecast = forecastForDay(current.day.label, dayWeatherAnchor(current.day.id, redrawToday), redrawToday);

    let html = `
      <div class="today-head">
        <div class="today-label">${current.isToday ? "Today" : "Next up"}</div>
        <div class="today-date">${esc(current.day.label)}</div>
      </div>
      ${weatherLine(forecast)}
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
        const isNext = idx === nextIdx;
        const done = current.isToday && (nextIdx < 0 || idx < nextIdx);

        if (leg && leg.mins >= 5) {
          html += `<div class="today-leg">${legLabel(leg)}</div>`;
        }

        html += `
          <div class="card today-card${isNext ? " next" : ""}${done ? " done" : ""}">
            ${isNext ? `<div class="today-next-flag">NEXT</div>` : ""}
            ${done ? `<div class="today-done-flag">EARLIER</div>` : ""}
            <div class="today-card-head">
              <div>
                <div class="today-time">${esc(formatTime(it.time) || "—")}</div>
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
              <button class="modal-btn modal-btn-primary" data-open-maps="${esc(
                directionsUrl(p, prev)
              )}">↗ ${leg && leg.driving ? "Drive there" : "Directions"}</button>
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
    wireRainyDayButtons();
  }

  // A wet forecast is only useful if it leads somewhere. This drops you into
  // Explore already asking for indoor things, centred on the day's first stop.
  function wireRainyDayButtons() {
    document.querySelectorAll("[data-rainy-day]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const current = currentPlanDay();
        const anchor = current ? dayWeatherAnchor(current.day.id) : null;
        explore.open = true;
        explore.category = "rainy";
        explore.customQuery = "";
        if (anchor && anchor.lat != null) {
          explore.centre = { name: anchor.name, lat: anchor.lat, lon: anchor.lon };
        }
        // Sets the question up and leaves it on the Search button, like every
        // other route into Explore - a tap on a weather card is a reason to
        // look, not confirmation that you want to look right now.
        markExploreStale();
        showView("picks");
      });
    });
  }

  // Walking directions to a place. Uses the exact Google place when the share
  // gave us its id, so navigation lands on the real venue rather than a
  // name-matched guess.
  // Walking was hardcoded, which is right across Edinburgh and absurd to
  // Stirling. When we know where the day starts, the mode follows the
  // distance; with nothing to measure from, walking stays the safer guess
  // for a city break.
  function travelModeTo(p, from) {
    if (!from || from.lat == null || p.lat == null) return "walking";
    return haversineKm(from.lat, from.lon, p.lat, p.lon) * ROAD_FACTOR > WALK_MAX_KM
      ? "driving"
      : "walking";
  }

  function directionsUrl(p, from) {
    const mode = travelModeTo(p, from);
    if (p.lat != null && p.lon != null) {
      return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=${mode}`;
    }
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
      pickMapsQuery(p)
    )}&travelmode=${mode}`;
  }

  // Subtitles are computed, not fixed strings: "Edinburgh · Stirling ·
  // Glasgow" over a board about Cumbria was the kind of small wrongness that
  // makes an app feel like it isn't listening.
  const VIEWS = {
    today: { render: renderToday, sub: () => "What's on now" },
    overview: {
      render: renderOverview,
      sub: () => {
        const b = activeBoard();
        if (b.hasGuide) return TRIP.dates;
        return b.destination || (b.dated ? "Your trip" : "Your saved places");
      },
    },
    itinerary: { render: renderItinerary, sub: () => "Your day-by-day plan" },
    // places/eats are no longer destinations of their own, but anything still
    // asking for them - the hardware-back history, a "＋ Add a place" button
    // saved in someone's muscle memory - lands on the same list with that
    // filter applied, rather than on an error.
    places: { render: () => renderPicksFiltered("place"), sub: () => `${picksOfKind("place").length} places to go` },
    eats: { render: () => renderPicksFiltered("eat"), sub: () => `${picksOfKind("eat").length} places to eat` },
    picks: { render: renderPicks, sub: () => "Everything you've saved" },
    budget: { render: renderBudget, sub: () => "What this is costing" },
    tips: { render: renderTips, sub: () => "Notes & packing" },
  };

  // Every tool works on every board: the places you save yourself are what
  // fill Trip, Places, Eats, the Itinerary, the Budget and the packing list.
  // Only Today is conditional, and only because a day-by-day view of a plan
  // with no days in it is an empty screen rather than a feature.
  function applyBoardTabs() {
    const visible = {
      today: loadPlan().days.length > 0,
      itinerary: true,
      picks: true,
      overview: true,
      // Reachable as views, but no longer tabs - there are no buttons for
      // these to hide or show.
      places: true,
      eats: true,
      budget: true,
      tips: true,
    };
    tabbar.querySelectorAll(".tab").forEach((t) => {
      t.hidden = visible[t.getAttribute("data-view")] === false;
    });
    return visible;
  }

  function firstVisibleTab() {
    const visible = applyBoardTabs();
    return ["today", "picks", "itinerary", "overview"].find((n) => visible[n]) || "picks";
  }

  // Where back should return to. Capped because this is a breadcrumb, not an
  // undo log - twenty presses to leave would be its own kind of trap.
  const tabHistory = [];
  const TAB_HISTORY_MAX = 10;

  function showView(name, opts) {
    const options = opts || {};
    const visible = applyBoardTabs();
    if (visible[name] === false) name = firstVisibleTab();
    const v = VIEWS[name];
    if (!v) return;
    const previous = view.dataset.activeTab;
    if (!options.fromBack && previous && previous !== name) {
      tabHistory.push(previous);
      if (tabHistory.length > TAB_HISTORY_MAX) tabHistory.shift();
    }
    view.dataset.activeTab = name;
    refreshBanner();
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
    topbarSub.textContent = typeof v.sub === "function" ? v.sub() : v.sub;
    tabbar.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.getAttribute("data-view") === name);
    });
    view.scrollTop = 0;
  }

  tabbar.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => showView(t.getAttribute("data-view")));
  });

  // ---------- The back button ----------
  // Back was leaving the app from anywhere - press it meaning "out of this
  // section" and the whole thing closes. A confirmation would stop the
  // accident, but the better answer is that back should have somewhere to go
  // first: close what's open, then walk back through the tabs you came
  // through, and only ask about leaving when there is genuinely nothing left.
  function handleBackIntent() {
    if (planOverlay.classList.contains("open")) {
      closePlanner();
      return true;
    }
    // Ahead of the search overlay because the trip planner can be opened from
    // it: back undoes the last thing that opened, not the first.
    if (ideaOverlay.classList.contains("open")) {
      closeIdea();
      return true;
    }
    if (searchOverlay.classList.contains("open")) {
      closeSearchOverlay();
      return true;
    }
    if (mapOverlay.classList.contains("open")) {
      mapPickTarget = null;
      closeAllMap();
      return true;
    }
    if (placeModal.classList.contains("open")) {
      previewIndex = null;
      closePlaceModal();
      return true;
    }
    if (tabHistory.length) {
      const previous = tabHistory.pop();
      showView(previous, { fromBack: true });
      return true;
    }
    const home = firstVisibleTab();
    if (view.dataset.activeTab !== home) {
      showView(home, { fromBack: true });
      return true;
    }
    return false;
  }

  let exitConfirmOpen = false;

  function confirmExit() {
    if (exitConfirmOpen) return;
    exitConfirmOpen = true;
    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="Leave the app?">
          <div class="modal-handle"></div>
          <div class="modal-body">
            <h2 class="modal-title">Leave the app?</h2>
            <p class="place-notes">Everything you've saved stays on this phone — you'll come back to it exactly as it is.</p>
            <div class="settings-btn-row" style="margin-top:16px;">
              <button class="modal-btn modal-btn-primary" id="stayInApp" style="flex:1;">Stay</button>
              <button class="modal-btn" id="leaveApp" style="flex:1;">Leave</button>
            </div>
          </div>
        </div>
      </div>
    `;
    placeModal.classList.add("open");

    const dismiss = () => {
      exitConfirmOpen = false;
      closePlaceModal();
    };
    placeModal.querySelectorAll("[data-close]").forEach((el) =>
      el.addEventListener("click", (e) => {
        if (e.target === el) dismiss();
      })
    );
    document.getElementById("stayInApp").addEventListener("click", dismiss);
    document.getElementById("leaveApp").addEventListener("click", () => {
      exitConfirmOpen = false;
      closePlaceModal();
      const app = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (app && app.exitApp) app.exitApp();
      else window.history.back();
    });
  }

  // Native first: with a backButton listener registered, Capacitor stops
  // closing the activity by itself and hands the press over - which is the
  // only way to put a question in front of it.
  const capApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (capApp && capApp.addListener) {
    capApp.addListener("backButton", () => {
      if (exitConfirmOpen) return; // the sheet is already asking
      if (!handleBackIntent()) confirmExit();
    });
  }

  // In a browser (and in the tests) the same intent arrives as a popstate.
  function armBackButton() {
    try {
      history.pushState({ appNav: true }, "");
    } catch (e) {
      /* a file:// origin can refuse pushState; the on-screen ✕ still works */
    }
  }

  window.addEventListener("popstate", () => {
    if (exitConfirmOpen) return;
    if (!handleBackIntent()) confirmExit();
    // Put the spare back, so the next press lands here too rather than
    // walking out of the app.
    armBackButton();
  });

  armBackButton();

  // Anything that escapes everything else. Without this, a failure inside an
  // event handler is invisible: the button was pressed, nothing happened, and
  // there is no console on a phone to find out why.
  window.addEventListener("error", (e) => {
    if (!e || !e.message) return;
    toast(`Something went wrong: ${String(e.message).slice(0, 120)}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e && e.reason;
    const message = (reason && reason.message) || String(reason || "");
    if (!message || /AbortError/.test(message)) return;
    toast(`Something went wrong: ${message.slice(0, 120)}`);
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

    const suggested = candidate.lat != null ? suggestedFolderFor(candidate.lat, candidate.lon) : null;
    openFolderPicker(candidate.name, suggested, (folder) => confirmAddCandidate(candidate, folder), {
      summary: sharedPlaceSummary(candidate),
      // Backing out of the sheet used to drop a place shared in from another
      // app entirely. It is saved either way now; only the folder was in
      // question.
      onDismiss: () => confirmAddCandidate(candidate, "Unsorted"),
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
    // Was a native alert() carrying the string "share-debug-3" - a diagnostic
    // that shipped. There is nothing a user can do about a missing plugin, and
    // sharing is not why they opened the app, so this belongs in the log.
    console.warn("ShareReceiver plugin not found on window.Capacitor.Plugins — sharing into the app will not work.");
  }

  const settingsBtn = document.getElementById("settingsBtn");
  if (settingsBtn) settingsBtn.addEventListener("click", openSettings);

  const topbarText = document.querySelector(".topbar-text");
  if (topbarText) {
    topbarText.addEventListener("click", openBoardSwitcher);
    topbarText.setAttribute("role", "button");
    topbarText.setAttribute("aria-label", "Switch board");
  }

  refreshForBoard();
})();
