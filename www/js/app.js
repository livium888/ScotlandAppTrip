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

  async function callGemini(key, prompt, { grounded = false } = {}) {
    lastAiPrompt = prompt;
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
  async function searchWithGemini(query, key) {
    const s = loadTripSettings();
    const where = s.destination.trim() ? ` in ${s.destination.trim()}` : "";
    const who = aiContextBlock();

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

  function picksOfKind(kind) {
    return loadPicks().filter((p) => pickKind(p) === kind);
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
    Object.keys(parsed.data).forEach((k) => {
      if (k === BOARDS_KEY || k === TRIP_KEY || k === STORAGE_KEY || /^board:/.test(k) || /^scotland-trip-|^trip-plan-/.test(k)) {
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
        if (!confirm(`Delete "${b.name}" and everything saved in it? This can't be undone.`)) return;
        deleteBoard(b.id);
        closePlaceModal();
        refreshForBoard();
        toast(`Deleted “${b.name}”`);
      });
    }
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
          const f = forecastForDay(d.label, dayWeatherAnchor(d.id), () => {
            if (view.dataset.activeTab === "overview") renderOverview();
          });
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
      const who = aiContextBlock();

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
      // Quiet here: on a list of days, "forecast lands nearer the time"
      // repeated six times is noise, and a rain nudge per day is nagging.
      const forecast = forecastForDay(day.label, dayWeatherAnchor(day.id), () => {
        if (view.dataset.activeTab === "itinerary") renderItinerary();
      });
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

  // ---------- Places & Eats ----------
  // These two tabs used to be read-only lists of bundled Edinburgh content,
  // which made them useless on any other board and useless for anything the
  // user added themselves. They now show the board's own saved places, split
  // by what they are: somewhere to go, or somewhere to eat. The bundled
  // Edinburgh guide still appears underneath, but only on the board it came
  // with, and only as suggestions to save.
  let placeFilter = "All";
  let eatsFilter = "All";

  function renderPlaces() {
    renderPlaceTab({
      kind: "place",
      searchFormId: "placesSearchForm",
      searchInputId: "placesSearchInput",
      searchPlaceholder: "Search Google Maps for a place…",
      searchHint: "Opens Google Maps. To keep a place, add it in Picks — it'll appear here.",
      heading: "Places to go",
      empty: "No places saved on this board yet. Add one in Picks — anything that isn't a café or restaurant lands here.",
      filter: placeFilter,
      setFilter: (v) => (placeFilter = v),
      guide: () => renderGuidePlaces(),
      guideLabel: "Edinburgh guide",
    });
  }

  function renderEats() {
    renderPlaceTab({
      kind: "eat",
      searchFormId: "eatsSearchForm",
      searchInputId: "eatsSearchInput",
      searchPlaceholder: "Search restaurants near…",
      searchHint: 'Opens Google Maps already searching "restaurants near" whatever you type.',
      heading: "Places to eat",
      empty: "No food places saved on this board yet. Add a café or restaurant in Picks and it'll appear here.",
      filter: eatsFilter,
      setFilter: (v) => (eatsFilter = v),
      guide: () => renderGuideEats(),
      guideLabel: "Edinburgh eats guide",
      searchTransform: (raw) => `restaurants near ${raw}`,
    });
  }

  function renderPlaceTab(cfg) {
    const mine = picksOfKind(cfg.kind);
    const board = activeBoard();

    let html = `
      <form class="search-bar" id="${cfg.searchFormId}">
        <input type="search" id="${cfg.searchInputId}" placeholder="${esc(cfg.searchPlaceholder)}" autocomplete="off" />
        <button type="submit" aria-label="Search on Google Maps">🔍</button>
      </form>
      <p class="search-hint">${esc(cfg.searchHint)}</p>
    `;

    // Folders are the board's own, so the chips match how this user files
    // things rather than three hardcoded Scottish cities.
    const folders = ["All"];
    mine.forEach((p) => {
      const f = p.city || "Unsorted";
      if (!folders.includes(f)) folders.push(f);
    });
    const active = folders.includes(cfg.filter) ? cfg.filter : "All";

    if (folders.length > 2) {
      html += `<div class="filter-row">`;
      folders.forEach((f) => {
        html += `<button class="filter-chip ${f === active ? "active" : ""}" data-city="${esc(f)}">${esc(f)}</button>`;
      });
      html += `</div>`;
    }

    const list = mine.filter((p) => active === "All" || (p.city || "Unsorted") === active);

    html += `<div class="section-label">${esc(cfg.heading)}${
      mine.length ? ` · ${list.length}` : ""
    }</div>`;

    if (!list.length) {
      html += `<div class="card"><p class="pick-status">${esc(cfg.empty)}</p>
        <button class="modal-btn modal-btn-primary" data-goto-picks="1" style="margin-top:12px;">＋ Add a place</button></div>`;
    } else {
      list.forEach((p) => {
        html += renderPickRow(p);
      });
      html += `<button class="modal-btn" data-goto-picks="1" style="width:100%;margin-top:12px;">＋ Add another</button>`;
    }

    // The bundled guide is suggestions, not the user's list, so it sits below
    // their own places and only on the board that came with it.
    if (board.hasGuide) {
      html += `<div class="section-label">${esc(cfg.guideLabel)}</div>`;
      html += cfg.guide();
    }

    view.innerHTML = html;

    view.querySelectorAll("[data-city]").forEach((btn) => {
      btn.addEventListener("click", () => {
        cfg.setFilter(btn.getAttribute("data-city"));
        renderPlaceTab(cfg);
      });
    });

    view.querySelectorAll("[data-goto-picks]").forEach((btn) =>
      btn.addEventListener("click", () => showView("picks"))
    );

    view.querySelectorAll("[data-open-pick]").forEach((row) =>
      row.addEventListener("click", () => openPickDetail(row.getAttribute("data-open-pick")))
    );

    wirePickToggles(() => renderPlaceTab(cfg));
    wireSearchBar(cfg.searchFormId, cfg.searchInputId, cfg.searchTransform);
  }

  function renderGuidePlaces() {
    let html = "";
    PLACES.forEach((p) => {
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
    return html;
  }

  function renderGuideEats() {
    let html = `
      <div class="card">
        <p>Independent, well-reviewed picks near each stop — not fast-food chains, not fine-dining prices.
        £ = casual/cheap, ££ = mid-range, £££ = a step up but still no white tablecloths.</p>
      </div>
    `;
    EATS.forEach((e) => {
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
    return html;
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
  let explore = {
    open: false,
    centre: null, // { name, lat, lon }
    category: "",
    customQuery: "", // used when category === "custom"
    showPrompt: false,
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
      if (explore.category) runExplore();
      else renderPicks();
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
    const distance = radiusMetres >= 1000 ? `${radiusMetres / 1000} km` : `${radiusMetres} m`;
    // The category's own phrasing is the question. It's written as a
    // description rather than a label ("healthy places to eat - salads,
    // grain bowls…") because that's what makes the model return the right
    // sort of place rather than the nearest twelve restaurants. The user can
    // rewrite any of them.
    const looking = category === "custom" ? explore.customQuery : categoryPrompt(category);

    const prompt =
      `List up to 6 real, currently-open places matching: ${looking}. ` +
      `They must be within about ${distance} of ${centre.name}.${who}\n\n` +
      `Use search to confirm each one exists and is still trading. ` +
      // Only the default when the user hasn't said what they want. Their own
      // words replace this rather than fighting it - someone who asks for
      // predictable chains shouldn't be argued with by the scaffolding.
      (loadTripSettings().preferences.trim()
        ? ""
        : `Prefer independent, well-regarded places over chains. `) +
      `Reply with ONLY a JSON array, ` +
      `each item {"name": exact official name, "area": street or neighbourhood, ` +
      `"why": one short sentence saying why it fits}. No other text.`;

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
              <button class="modal-btn modal-btn-primary" id="catPromptSave">Save &amp; search</button>
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
      runExplore();
    });

    document.getElementById("catPromptReset").addEventListener("click", () => {
      const map = Object.assign({}, loadTripSettings().catPrompts);
      delete map[key];
      saveTripSettings({ catPrompts: map });
      closePlaceModal();
      runExplore();
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
              <button type="submit" aria-label="Search that">🔍</button>
            </form>
            <p class="settings-hint">Anything you can describe, the AI search will look for.</p>
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
        runExplore();
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
        runExplore();
      });
    }
  }

  function renderExplore() {

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
      body += renderExploreCategoryButton();
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
          const distance = km == null ? "" : km < 1 ? Math.round(km * 1000) + " m away" : km.toFixed(1) + " km away";
          const meta = [distance, r.openingHours].filter(Boolean).join(" · ");
          // Same bargain as the search results: tap to read it properly,
          // + to take it on trust.
          body += `
            <div class="candidate-card explore-result">
              <div class="explore-result-main">
                <button class="result-tap" data-preview-explore="${i}">
                  <div class="place-name">${esc(r.name)}${
                    r.aiSuggested ? ` <span class="ai-badge">AI</span>` : ""
                  }</div>
                  ${meta ? `<div class="place-notes">${esc(meta)}</div>` : ""}
                  ${r.description ? `<div class="place-notes">${esc(r.description)}</div>` : ""}
                  <div class="search-result-more">Details ›</div>
                </button>
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
            ${p.openingHours ? `<div class="place-fact">🕒 ${esc(p.openingHours)}</div>` : ""}
            ${p.phone ? `<div class="place-fact">📞 <a href="tel:${esc(p.phone)}">${esc(p.phone)}</a></div>` : ""}
            ${p.website ? `<div class="place-fact">🌐 <a href="${esc(p.website)}" target="_blank" rel="noopener">Website</a></div>` : ""}

            ${weatherForPick(p)}

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

            <label class="settings-label">Shows up in</label>
            <div class="move-row">
              <button class="move-chip${pickKind(p) === "place" ? " active" : ""}" data-pick-kind="${esc(p.id)}|place">🏛️ Places</button>
              <button class="move-chip${pickKind(p) === "eat" ? " active" : ""}" data-pick-kind="${esc(p.id)}|eat">🍽️ Eats</button>
            </div>

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
    const wasOpen = searchOverlay.classList.contains("open");
    if (prefill !== undefined) pickSearch = { query: prefill, status: "idle", results: [] };
    renderSearchOverlay();
    if (!wasOpen) {
      try {
        history.pushState({ searchOverlay: true }, "");
      } catch (e) {
        /* the ✕ still works */
      }
    }
    const input = document.getElementById("pickSearchInput");
    if (input && !prefill) input.focus();
  }

  function dismissSearchOverlay() {
    if (history.state && history.state.searchOverlay) history.back();
    else closeSearchOverlay();
  }

  function closeSearchOverlay() {
    searchOverlay.classList.remove("open");
    searchOverlay.innerHTML = "";
    // The Picks list behind it may have gained places while it was open.
    if (view.dataset.activeTab === "picks") renderPicks();
  }

  async function runSearch(query) {
    const q = (query || "").trim();
    if (!q) return;
    rememberSearch(q);
    pickSearch = { query: q, status: "loading", results: [] };
    renderSearchOverlay();
    try {
      pickSearch = { query: q, status: "done", results: await searchPlaces(q) };
    } catch (e) {
      pickSearch = { query: q, status: "error", results: [] };
    }
    renderSearchOverlay();
  }

  function renderSearchOverlay() {
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
          <div class="search-result" data-candidate="${i}">
            <div class="search-result-main">
              <button class="result-tap" data-preview-candidate="${i}">
                <div class="place-name">${esc(r.name)}${
                  r.aiSuggested ? ` <span class="ai-badge">AI</span>` : ""
                }${r.rating != null ? ` <span class="candidate-rating">⭐ ${esc(String(r.rating))}</span>` : ""}</div>
                <div class="place-notes">${esc(r.displayName || "")}</div>
                ${r.description ? `<div class="place-notes">${esc(r.description)}</div>` : ""}
                <div class="search-result-more">Details ›</div>
              </button>
              ${
                r.sources && r.sources.length
                  ? `<div class="place-links"><a href="${esc(r.sources[0].uri)}" target="_blank" rel="noopener">🔗 source</a></div>`
                  : ""
              }
            </div>
            <button class="search-add${already ? " added" : ""}" data-add-candidate="${i}" ${
              already ? "disabled" : ""
            } aria-label="${already ? "Already saved" : "Save " + esc(r.name)}">${already ? "✓" : "＋"}</button>
          </div>
        `;
      });
      body += `</div>`;
      body += `<p class="settings-hint search-foot">Tap a place to read about it first, or ＋ to save it straight away.</p>`;
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
      <div class="search-body">${body}</div>
    `;
    searchOverlay.classList.add("open");
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
  let previewEnriching = false;

  function openCandidatePreview(index, list) {
    previewList = list || pickSearch.results;
    const r = previewList[index];
    if (!r) return;
    previewIndex = index;
    renderCandidatePreview();

    // Search results arrive thin - an AI suggestion may be a name and a
    // sentence. Fill in the rest on opening rather than for every result in
    // the list, which would be dozens of requests for one you'll actually read.
    if (!r.enriched && !previewEnriching) {
      previewEnriching = true;
      Promise.all([
        r.description && r.website ? null : wikiEnrich(r.name).catch(() => null),
        r.lat == null ? geocodePlace(r.name, r.city || null).catch(() => null) : null,
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
          previewEnriching = false;
          if (previewIndex === index) renderCandidatePreview();
        });
    }
  }

  function renderCandidatePreview() {
    const r = previewList ? previewList[previewIndex] : null;
    if (!r) return;
    const already = loadPicks().some((p) => p.id === pickId("custom", r.name));
    const mapsUrl = r.googleUrl || mapsUrlFor(r.displayName || r.name);
    const facts = [
      r.address || r.displayName ? `📍 ${esc(r.address || r.displayName)}` : "",
      r.openingHours ? `🕒 ${esc(r.openingHours)}` : "",
      r.phone ? `📞 ${esc(r.phone)}` : "",
      r.rating != null ? `⭐ ${esc(String(r.rating))}${r.ratingCount ? ` (${esc(String(r.ratingCount))})` : ""}` : "",
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
              previewEnriching
                ? `<div class="place-fact preview-loading">Looking up details…</div>`
                : ""
            }

            ${r.lat != null ? `<div class="detail-map" id="previewMap"></div>` : ""}

            <div class="settings-btn-row" style="margin-top:12px;">
              ${
                r.website
                  ? `<button class="modal-btn" data-open-maps="${esc(r.website)}">🌐 Website</button>`
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
                        `<a href="${esc(s.uri)}" target="_blank" rel="noopener">🔗 ${esc(s.title || "source")}</a>`
                    )
                    .join(" ")}</div>`
                : ""
            }

            <button class="modal-btn modal-btn-primary" id="previewAdd" ${already ? "disabled" : ""}
                    style="width:100%;margin-top:16px;">
              ${already ? "✓ Already saved" : "＋ Save this place"}
            </button>
            <p class="settings-hint" style="text-align:center;">You can change the folder, add a note or a cost after saving.</p>
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
        quickAdd(r);
        previewIndex = null;
        closePlaceModal();
        // The list behind needs to show it as saved now.
        if (searchOverlay.classList.contains("open")) renderSearchOverlay();
        else if (view.dataset.activeTab === "picks") renderPicks();
        else if (view.dataset.activeTab) showView(view.dataset.activeTab);
      });
    }

    const mapEl = document.getElementById("previewMap");
    if (mapEl && r.lat != null) {
      const map = L.map(mapEl, { scrollWheelZoom: false, attributionControl: false });
      addTileLayer(map);
      map.setView([r.lat, r.lon], 15);
      L.marker([r.lat, r.lon]).addTo(map);
      setTimeout(() => map.invalidateSize(), 60);
    }
  }

  function wireSearchOverlay() {
    searchOverlay.querySelectorAll("[data-search-close]").forEach((b) =>
      b.addEventListener("click", dismissSearchOverlay)
    );

    const form = document.getElementById("pickSearchForm");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = document.getElementById("pickSearchInput");
        input.blur(); // drop the keyboard so results get the screen
        runSearch(input.value);
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
    searchOverlay.querySelectorAll("[data-add-candidate]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const candidate = pickSearch.results[Number(btn.getAttribute("data-add-candidate"))];
        if (!candidate) return;
        quickAdd(candidate);
        btn.classList.add("added");
        btn.textContent = "✓";
        btn.disabled = true;
      });
    });
  }

  window.addEventListener("popstate", () => {
    if (searchOverlay.classList.contains("open")) closeSearchOverlay();
  });

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
        .bindTooltip(`${i + 1}. ${r.name}`, { permanent: false })
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
    requestAnimationFrame(() => map.invalidateSize());
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
    return (
      `https://www.google.com/maps/dir/?api=1&origin=${at(capped[0])}` +
      `&destination=${at(capped[capped.length - 1])}&travelmode=walking` +
      (waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "")
    );
  }

  function openAllMap(filter) {
    const wasOpen = mapOverlay.classList.contains("open");
    allMapFilter = filter || "all";
    renderAllMap();
    // A full-screen overlay that Android's back button can't dismiss is a
    // trap - back would close the whole app. A history entry makes back mean
    // "close the map" instead, with no extra native code.
    if (!wasOpen) {
      try {
        history.pushState({ mapOverlay: true }, "");
      } catch (e) {
        /* file:// origins can refuse pushState; the ✕ still works */
      }
    }
  }

  // Closing on purpose unwinds that history entry so back doesn't reopen it.
  function dismissAllMap() {
    if (history.state && history.state.mapOverlay) history.back();
    else closeAllMap();
  }

  window.addEventListener("popstate", () => {
    if (mapOverlay.classList.contains("open")) closeAllMap();
  });

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
    requestAnimationFrame(() => allMap && allMap.invalidateSize());

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
        .bindTooltip("You are here");
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

  async function confirmAddCandidate(candidate, folder) {
    const id = pickId("custom", candidate.name);
    const picks = loadPicks();
    if (picks.some((p) => p.id === id)) {
      if (view.dataset.activeTab === "picks") renderPicks();
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
      <button class="search-trigger" id="pickSearchTrigger">
        <span class="search-trigger-icon">🔍</span>
        <span class="search-trigger-text">Search for a place to add…</span>
      </button>
      ${renderExplore()}
    `;

    if (picks.length === 0) {
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
          </ul>
          <button class="modal-btn modal-btn-primary" data-open-search="1" style="width:100%;margin-top:12px;">🔍 Search for a place</button>
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

    // Search has its own screen now - these are just the ways in.
    const searchTrigger = document.getElementById("pickSearchTrigger");
    if (searchTrigger) searchTrigger.addEventListener("click", () => openSearchOverlay(""));
    view.querySelectorAll("[data-open-search]").forEach((b) =>
      b.addEventListener("click", () => openSearchOverlay(""))
    );

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
  function dayWeatherAnchor(dayId) {
    const plan = loadPlan();
    const picks = loadPicks();
    const byId = {};
    picks.forEach((p) => (byId[p.id] = p));
    const scheduled = (plan.items[dayId] || []).map((it) => byId[it.pickId]).filter(Boolean);
    return scheduled.find((p) => p.lat != null) || picks.find((p) => p.lat != null) || null;
  }

  function forecastForDay(dayLabel, anchor, onUpdate) {
    if (!anchor || anchor.lat == null) return null;
    const date = dayLabelToDate(dayLabel, new Date().getFullYear());
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

    // Weather belongs at the top of Today: it's the one thing that changes a
    // plan before you've left the flat.
    const forecast = forecastForDay(
      current.day.label,
      dayWeatherAnchor(current.day.id),
      () => {
        if (view.dataset.activeTab === "today") renderToday();
      }
    );

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
        showView("picks");
        if (explore.centre) runExplore();
      });
    });
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
    places: { render: renderPlaces, sub: () => `${picksOfKind("place").length} places to go` },
    eats: { render: renderEats, sub: () => `${picksOfKind("eat").length} places to eat` },
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

  function showView(name) {
    const visible = applyBoardTabs();
    if (visible[name] === false) name = firstVisibleTab();
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
    topbarSub.textContent = typeof v.sub === "function" ? v.sub() : v.sub;
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

  const topbarText = document.querySelector(".topbar-text");
  if (topbarText) {
    topbarText.addEventListener("click", openBoardSwitcher);
    topbarText.setAttribute("role", "button");
    topbarText.setAttribute("aria-label", "Switch board");
  }

  refreshForBoard();
})();
