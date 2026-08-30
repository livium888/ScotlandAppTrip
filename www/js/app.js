(function () {
  "use strict";

  const view = document.getElementById("view");
  const tabbar = document.getElementById("tabbar");
  const topbarTitle = document.getElementById("topbarTitle");
  const topbarSub = document.getElementById("topbarSub");

  // ---------- A note on the names below ----------
  // The app is called Wayfare. Several storage keys, the backup format string
  // and one board id still say "scotland", and they are staying that way.
  //
  // A storage key is not a label, it is an address. Every install out there
  // has its packing list, picks and folders filed under these exact strings,
  // and every backup file ever exported carries the old format name inside
  // it. Renaming them would orphan all of it to make a file read more
  // tidily - a cost paid entirely by the user for a benefit only a developer
  // would ever see. Same reasoning for the Android applicationId, which is
  // how the phone knows the new build is an upgrade rather than a second app.
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

  // There was a lookup table with Edinburgh, Stirling and Glasgow in it, and
  // one grey for everywhere else - so every town on every other trip was the
  // same colour. The name is hashed to a hue instead: any town gets its own,
  // and gets the same one every time.
  function cityColor(city) {
    const name = String(city || "").trim();
    if (!name) return "hsl(210 8% 45%)";
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    // Kept away from the extremes so it reads as ink on both themes.
    return `hsl(${h} 42% 42%)`;
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

  // A place's own name is the right thing to look for on a map. An event's is
  // not: "Toddler Storytime" is on no map anywhere, and the thing you actually
  // want to walk to is the library it is happening in. So the venue leads, and
  // the event's name is only a fallback for a listing that never named one.
  function eventMapsQuery(e) {
    const venue = String(e.venue || "").trim();
    if (!venue) return pickMapsQuery(e);
    // With coordinates the venue alone is best - the search is already centred
    // on the spot. Without them it needs a town to sit in, or "The Institute"
    // finds one four counties away.
    if (e.lat != null && e.lon != null) return venue;
    const where = e.area || townFromAddress(e.address) || "";
    return [venue, where].filter(Boolean).join(", ");
  }

  // Google's own id for the venue when we have been given one, and a centred
  // search when we have not. Same rule saved places already follow: an id
  // addresses the exact place, a name search can land on the wrong one.
  function eventMapsUrl(e) {
    return e.googleUrl || mapsUrlFor(eventMapsQuery(e), e);
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

  // Handing a link to whatever app owns it, rather than reading it here.
  //
  // openExternal below opens a Chrome Custom Tab, which is the right thing for
  // a ticket page or a source: it keeps you inside the app and reuses the
  // browser's sign-ins. But a Custom Tab IS Chrome, and Chrome never passes a
  // link on to another app - so "open ChatGPT" would always land in a web
  // page, even with the app installed.
  //
  // Navigating instead is what gets the app. Capacitor's web view hands any
  // address outside the app to Android as an ACTION_VIEW, and Android routes
  // that to whichever app has claimed the link - the real one if it is
  // installed and verified, a browser if not. There is no allowNavigation
  // entry for these hosts in capacitor.config.json, which is what makes the
  // hand-off reliable rather than a page loading inside the app.
  function openInOwningApp(url) {
    const safe = safeUrl(url);
    if (!safe) return;
    const native = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    if (native) {
      window.location.href = safe;
      return;
    }
    window.open(safe, "_blank", "noopener");
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
      aiRates: stored.aiRates && typeof stored.aiRates === "object" ? stored.aiRates : {},
      anglePrompts:
        stored.anglePrompts && typeof stored.anglePrompts === "object" ? stored.anglePrompts : {},
    };
  }

  // ---------- Who is actually coming ----------
  // This was one free-text box - "family of 3, 4-year-old who walks" - pasted
  // into the top of every prompt. It read well and could be used for nothing
  // else: the app could not tell you whether a four-year-old would last two
  // hours in a distillery, could not notice that the 13:30 stop lands in the
  // middle of a nap, and split a budget for a family of five the same way it
  // split one for a couple, because it had a sentence rather than a family.
  //
  // A list of people is the same information in a form the app can use. The
  // sentence still exists and is still what goes into a prompt - it is just
  // written from the list rather than typed - and anyone who never opens this
  // screen keeps exactly what they had.
  const PEOPLE_KEY = "people-v1";

  function loadPeople() {
    const list = readJson(PEOPLE_KEY, null);
    return Array.isArray(list) ? list.filter((p) => p && typeof p === "object") : [];
  }

  function savePeople(list) {
    store(PEOPLE_KEY, JSON.stringify(list));
  }

  function personLabel(p) {
    const name = (p.name || "").trim();
    if (name) return name;
    if (p.age != null) return p.age < 18 ? `Child, ${p.age}` : `Adult, ${p.age}`;
    return "Someone";
  }

  function isChild(p) {
    return p.age != null && p.age < 16;
  }

  function youngestAge() {
    const ages = loadPeople()
      .map((p) => p.age)
      .filter((a) => a != null);
    return ages.length ? Math.min.apply(null, ages) : null;
  }

  // The sentence a prompt gets. Written from the list when there is one, and
  // otherwise whatever was typed in the old box - so nothing that already
  // worked stops working.
  function whoDescription() {
    const people = loadPeople();
    const typed = loadTripSettings().travellers.trim();
    if (!people.length) return typed;

    const adults = people.filter((p) => !isChild(p));
    const children = people.filter(isChild);
    const bits = [];
    if (adults.length) bits.push(`${adults.length} adult${adults.length === 1 ? "" : "s"}`);
    if (children.length) {
      const ages = children
        .map((c) => c.age)
        .filter((a) => a != null)
        .sort((a, b) => a - b);
      bits.push(
        `${children.length} child${children.length === 1 ? "" : "ren"}` +
          (ages.length ? ` (aged ${ages.join(", ")})` : "")
      );
    }
    let line = bits.join(" and ");

    // Only the things that change an answer. "Likes museums" is a preference
    // and belongs in the preferences box; "cannot manage steps" is a fact
    // that rules places out.
    const notes = [];
    if (people.some((p) => p.buggy)) notes.push("a buggy to get around with");
    if (people.some((p) => p.naps)) {
      const nap = napWindow();
      // The times when they are known, because "naps in the early afternoon"
      // and "naps 12:30-14:00" lead to different suggestions.
      notes.push(
        `${personLabel(nap.who).toLowerCase()} naps ${
          nap.from === NAP_START && nap.to === NAP_END
            ? "in the early afternoon"
            : `from ${clockFromMinutes(nap.from)} to ${clockFromMinutes(nap.to)}`
        }`
      );
    }
    const bed = earliestBedtime();
    if (bed) notes.push(`${personLabel(bed.p).toLowerCase()} goes to bed around ${clockFromMinutes(bed.mins)}`);
    if (people.some((p) => p.mobility)) notes.push("limited walking - steps and rough ground are a problem");
    const diets = people.map((p) => (p.diet || "").trim()).filter(Boolean);
    if (diets.length) notes.push(`dietary: ${Array.from(new Set(diets)).join(", ")}`);

    if (notes.length) line += `. ${notes.join("; ")}`;
    // Anything typed in the old box that the list cannot express is kept
    // rather than quietly dropped.
    if (typed && !people.length) line += `. ${typed}`;
    return line;
  }

  // One row per person. Everything edits in place - a sheet to add somebody
  // to a list of four would be three taps for two words.
  function peopleRows() {
    const people = loadPeople();
    if (!people.length) return "";
    return people
      .map(
        (p, i) => `
        <div class="person-row" data-person="${i}">
          <div class="person-top">
            <input class="settings-input person-name" data-person-field="name" data-person="${i}"
                   type="text" value="${esc(p.name || "")}" placeholder="Name (optional)" />
            <input class="settings-input person-age" data-person-field="age" data-person="${i}"
                   type="number" min="0" max="120" inputmode="numeric"
                   value="${p.age == null ? "" : esc(String(p.age))}" placeholder="Age" />
            <button class="person-remove" data-remove-person="${i}" aria-label="Remove ${esc(personLabel(p))}">${icon(
          "close",
          { size: 15 }
        )}</button>
          </div>
          <div class="person-flags">
            <label><input type="checkbox" data-person-field="naps" data-person="${i}"${
          p.naps ? " checked" : ""
        } /> <span>Naps in the afternoon</span></label>${
          // The times only once the switch is on: three empty boxes against
          // an adult's name is clutter asking to be ignored.
          p.naps
            ? `
            <div class="person-times">
              <label class="person-time"><span>Nap from</span>
                <input type="time" data-person-field="napFrom" data-person="${i}"
                       value="${esc(p.napFrom || clockFromMinutes(NAP_START))}" /></label>
              <label class="person-time"><span>until</span>
                <input type="time" data-person-field="napTo" data-person="${i}"
                       value="${esc(p.napTo || clockFromMinutes(NAP_END))}" /></label>
            </div>`
            : ""
        }
            <label><input type="checkbox" data-person-field="buggy" data-person="${i}"${
          p.buggy ? " checked" : ""
        } /> <span>In a buggy</span></label>
            <label><input type="checkbox" data-person-field="mobility" data-person="${i}"${
          p.mobility ? " checked" : ""
        } /> <span>Steps and rough ground are hard</span></label>
          </div>
          ${
            // Only for a child: an adult's bedtime is not a fact that rules
            // anything out, and asking for it would imply it might.
            isChild(p)
              ? `<div class="person-times">
              <label class="person-time"><span>Bed at</span>
                <input type="time" data-person-field="bedtime" data-person="${i}"
                       value="${esc(p.bedtime || "")}" /></label>
            </div>`
              : ""
          }
          <input class="settings-input person-diet" data-person-field="diet" data-person="${i}"
                 type="text" value="${esc(p.diet || "")}" placeholder="Anything they can't eat (optional)" />
        </div>`
      )
      .join("");
  }

  // ---------- Will a four-year-old last here ----------
  // The app happily suggested a two-hour distillery tour to a family with a
  // toddler and then, on the same screen, a soft play. It had no way to tell
  // them apart, because it had no idea there was a toddler.
  //
  // Deliberately a small number of confident readings rather than a score for
  // everything: a wrong warning about a place that is in fact perfect for a
  // three-year-old teaches people to ignore the warnings.
  const HARD_WITH_SMALL_CHILD = [
    [/distillery|whisky tour|brewery tour|wine tasting/i, "a tour with nothing to touch and no way out of the middle of it"],
    [/munro|summit|scramble|ridge|peak/i, "a serious climb"],
    [/fine dining|tasting menu|michelin/i, "a long sit-down meal"],
    [/art gallery|fine art|sculpture gallery/i, "quiet rooms and nothing to touch"],
    [/cathedral|abbey|minster/i, "quiet, and the interest is all in the reading"],
  ];

  const GOOD_WITH_SMALL_CHILD =
    /soft play|playground|play park|zoo|farm|aquarium|beach|park|adventure|hands-on|interactive|science centre|discovery|maze|steam railway|castle/i;

  // Answers null when there is nothing confident to say, which is most of the
  // time and is the right answer.
  function childVerdict(pick) {
    const age = youngestAge();
    if (age == null || age > 7) return null;
    const hay = `${pick.category || ""} ${pick.name || ""} ${pick.description || ""}`;
    const hard = HARD_WITH_SMALL_CHILD.find(([re]) => re.test(hay));
    if (hard) return { ok: false, why: hard[1], age };
    if (GOOD_WITH_SMALL_CHILD.test(hay)) return { ok: true, why: null, age };
    return null;
  }

  // A warning is only worth printing when it would change what you do, so
  // both of these answer with an empty string most of the time.
  function childWarning(pick) {
    const verdict = childVerdict(pick);
    if (!verdict || verdict.ok) return "";
    return `<div class="plan-warn child-warn">${icon("alert", { size: 15, cls: "ico-inline" })} ${
      verdict.age
    } may not last — ${esc(verdict.why)}.</div>`;
  }

  function napWarning(time) {
    if (!clashesWithNap(time)) return "";
    // napWindow is the single answer to "who naps and when"; asking napper()
    // separately is two answers to one question sitting in the same file.
    const who = napWindow().who;
    return `<div class="plan-warn nap-warn">${icon("clock", { size: 15, cls: "ico-inline" })} Lands in ${esc(
      personLabel(who)
    )}'s nap.</div>`;
  }

  // ---------- Naps and bedtimes ----------
  // Whoever planned the day knew about the nap. The app did not, so it put
  // the two-hour castle at half past one and said nothing.
  //
  // These two were the whole of it, hard-coded: everybody's child napped from
  // one until three. They are the defaults now rather than the law, because a
  // guess that cannot be corrected is worse than no guess - it is wrong in a
  // way you cannot do anything about. Left blank they behave exactly as they
  // always did, so nobody who never opens Settings notices this changed.
  const NAP_START = 13 * 60;
  const NAP_END = 15 * 60;

  function napper() {
    return loadPeople().find((p) => p.naps) || null;
  }

  // The window for whoever actually naps, falling back to the old constants.
  function napWindow() {
    const who = napper();
    if (!who) return null;
    const from = timeToMinutes(who.napFrom);
    const to = timeToMinutes(who.napTo);
    return {
      who,
      from: from == null ? NAP_START : from,
      to: to == null ? NAP_END : to,
    };
  }

  // A stop that starts inside the nap window, for a day that has one.
  function clashesWithNap(time) {
    const nap = napWindow();
    if (!nap) return false;
    const mins = timeToMinutes(time);
    if (mins == null) return false;
    return mins >= nap.from && mins < nap.to;
  }

  // Bedtime, which the app had no concept of at all - so a 19:30 gig and a
  // 10:30 storytime were equally "on" for a family with a three-year-old.
  // Only the youngest child's matters: they are the one who runs out first.
  // Typed wins. But a field nobody has filled in is the state every family is
  // in until they open Settings, and a feature that only works after you have
  // configured it does not work. So there is an answer before anybody types
  // one, and the typed value overrides it.
  //
  // Being half an hour out costs nothing here: this only ever adds a line to a
  // row that was going to be shown either way. Not being there at all is what
  // costs, because then the screen never mentions bedtime to anyone.
  const BEDTIMES = [
    [2, 19 * 60],
    [5, 19 * 60 + 30],
    [9, 20 * 60],
    [12, 20 * 60 + 30],
  ];

  function bedtimeOf(person) {
    const typed = timeToMinutes(person && person.bedtime);
    if (typed != null) return typed;
    if (!person || person.age == null || person.age > 12) return null;
    const hit = BEDTIMES.find(([upTo]) => person.age <= upTo);
    return hit ? hit[1] : null;
  }

  function earliestBedtime() {
    const kids = loadPeople()
      .filter(isChild)
      .map((p) => ({ p, mins: bedtimeOf(p) }))
      .filter((x) => x.mins != null)
      .sort((a, b) => a.mins - b.mins);
    return kids.length ? kids[0] : null;
  }

  // Everything the user has told us about how they want results, in one
  // block that every prompt builder uses - so a preference set once applies
  // to searching, exploring and planning without being typed three times.
  function aiContextBlock() {
    const s = loadTripSettings();
    const lines = [];
    const who = whoDescription();
    if (who) lines.push(`Travellers: ${who}`);
    if (s.preferences.trim()) lines.push(`What matters to us: ${s.preferences.trim()}`);
    return lines.length ? `\n${lines.join("\n")}` : "";
  }

  // An angle's question, with the user's rewrite winning if there is one.
  // Same contract as categoryPrompt below: the app still adds how far, when,
  // who is travelling and the formatting rules, so an edit can change what
  // comes back but cannot break the search.
  function anglePrompt(key) {
    const custom = loadTripSettings().anglePrompts[key];
    if (custom && custom.trim()) return custom.trim();
    const angle = EVENT_ANGLES.find((a) => a.key === key);
    return angle ? angle.ask : String(key);
  }

  // A category's question, with the user's rewrite winning if there is one.
  function categoryPrompt(key) {
    const custom = loadTripSettings().catPrompts[key];
    if (custom && custom.trim()) return custom.trim();
    // The one category that must not ask the same thing twice: tapping it
    // again is the whole interaction, and a fixed prompt would hand back the
    // same three places for ever.
    if (key === "surprise") return `${aSurprise()} - and say why it is worth the time`;
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
    store(TRIP_KEY, JSON.stringify(next));
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

  // ---------- Asking the network ----------
  // Only the AI call had a timeout. Every other lookup - the geocoder, the
  // map data, Wikipedia, the forecast - was a bare fetch(), which on a phone
  // that has half a bar does not fail: it waits, indefinitely, and the
  // spinner above it waits with it. Half a bar is the normal condition in a
  // glen, so the normal condition of this app there was a screen that never
  // resolved and had nothing on it to press.
  //
  // A request that cannot be answered has to end, so the code around it can
  // say so and offer the next thing.
  const NET_TIMEOUT_MS = 8000; // a name to a coordinate, a page summary
  const NET_TIMEOUT_SLOW_MS = 15000; // Overpass, which is genuinely slow

  function fetchWithTimeout(url, opts, ms) {
    const options = opts || {};
    const limit = ms || NET_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limit);
    // Some callers already pass a signal of their own - the type-ahead
    // cancels the previous request on every keystroke. Both reasons to stop
    // have to keep working, so the caller's signal is relayed into ours
    // rather than replaced by it.
    const outer = options.signal;
    const relay = () => controller.abort();
    if (outer) {
      if (outer.aborted) controller.abort();
      else outer.addEventListener("abort", relay);
    }
    const settings = Object.assign({}, options, { signal: controller.signal });
    return fetch(url, settings).finally(() => {
      clearTimeout(timer);
      if (outer) outer.removeEventListener("abort", relay);
    });
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
    const res = await fetchWithTimeout(`${GEMINI_BASE}/models?key=${encodeURIComponent(key)}`, {}, AI_TIMEOUT_MS);
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
        // The abort is kept as the cause: the message above is for the person
        // reading it, the original is for whoever is reading a diagnostic.
        throw new Error(
          `The AI didn't answer within ${Math.round(AI_TIMEOUT_MS / 1000)} seconds. That is usually signal rather than anything you did - worth trying again.`,
          { cause: e }
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
    // Google counts the tokens itself and puts the answer in every reply. It
    // was being thrown away with the rest of the envelope - so the app could
    // spend nine grounded searches on your allowance and have nothing to say
    // about it. These are its numbers, not an estimate of ours.
    recordAiUsage(data.usageMetadata, { grounded, model: path });

    return { text, sources };
  }

  // ---------- What the AI is costing ----------
  // Per device, and it says so. There is no endpoint that answers "how much of
  // my allowance is left" from an API key - that lives in the Cloud Console -
  // so the honest thing is to count what this phone spent and be clear that
  // the same key used elsewhere is invisible here.
  const AI_USAGE_KEY = "ai-usage-v1";
  const USAGE_DAYS_KEPT = 60;

  function loadAiUsage() {
    const u = readJson(AI_USAGE_KEY, null);
    const base = { days: {}, total: { calls: 0, grounded: 0, inTokens: 0, outTokens: 0 }, last: null };
    if (!u || typeof u !== "object") return base;
    return {
      days: u.days && typeof u.days === "object" ? u.days : {},
      total: Object.assign({}, base.total, u.total),
      last: u.last || null,
    };
  }

  function blankDay() {
    return { calls: 0, grounded: 0, inTokens: 0, outTokens: 0 };
  }

  function recordAiUsage(meta, opts) {
    // No usageMetadata means an older API version or an error shape. Count the
    // call anyway - "we made a request and cannot say how big" is still worth
    // knowing, and silently recording nothing would understate the total.
    const m = meta || {};
    const inTok = Number(m.promptTokenCount) || 0;
    const outTok = Number(m.candidatesTokenCount) || 0;
    const usage = loadAiUsage();
    const key = isoDate(new Date());
    const day = usage.days[key] || blankDay();
    day.calls += 1;
    if (opts && opts.grounded) day.grounded += 1;
    day.inTokens += inTok;
    day.outTokens += outTok;
    usage.days[key] = day;

    usage.total.calls += 1;
    if (opts && opts.grounded) usage.total.grounded += 1;
    usage.total.inTokens += inTok;
    usage.total.outTokens += outTok;
    usage.last = {
      at: Date.now(),
      inTokens: inTok,
      outTokens: outTok,
      grounded: !!(opts && opts.grounded),
      model: (opts && opts.model) || "",
      counted: !!(m.promptTokenCount || m.candidatesTokenCount),
    };

    // Sixty days of daily rows is a few kilobytes; older ones are dropped, and
    // the all-time totals are kept separately so dropping a day never makes
    // the total go backwards.
    const cutoff = isoDate(new Date(Date.now() - USAGE_DAYS_KEPT * 86400000));
    Object.keys(usage.days).forEach((d) => {
      if (d < cutoff) delete usage.days[d];
    });
    store(AI_USAGE_KEY, JSON.stringify(usage));
  }

  // ---------- Turning tokens into money, carefully ----------
  // Tokens are a fact; a price is not. Google can change what it charges
  // without telling this app, and a figure that looks exact while being
  // quietly a year out of date is worse than no figure at all. So the rate is
  // shown next to the number, dated, and can be corrected - an estimate that
  // says what it assumed is an estimate; one that doesn't is a claim.
  //
  // And on the free tier the true answer is zero, which is why that is the
  // default rather than a rate nobody is paying.
  const AI_RATES_ASOF = "May 2026";

  // Dollars per million tokens, by model family, so the figure follows
  // whichever model the key actually resolved to rather than assuming the
  // cheapest one. Matched longest-name-first, because "flash-lite" contains
  // "flash" and would otherwise be priced as the dearer model.
  //
  // These are published rates as of the date above and this app has no way to
  // check them, which is why the one in use is printed next to the number and
  // can be corrected. A price that cannot be seen is a claim, not an estimate.
  const MODEL_RATES = [
    { match: "flash-lite", label: "Flash-Lite", in: 0.1, out: 0.4 },
    { match: "flash", label: "Flash", in: 0.3, out: 2.5 },
    { match: "pro", label: "Pro", in: 1.25, out: 10 },
  ];
  const FALLBACK_RATE = { label: "unknown model", in: 0.1, out: 0.4 };

  // The rate for the model this key is on. Falls back to the cheapest rather
  // than to nothing: an unrecognised model name is far more likely to be a
  // newer small model than a reason to stop counting.
  function rateForModel(modelName) {
    const name = String(modelName || "").toLowerCase();
    const hit = MODEL_RATES.find((r) => name.indexOf(r.match) >= 0);
    return hit || FALLBACK_RATE;
  }

  function currentModelRate() {
    return rateForModel(loadTripSettings().geminiModel);
  }

  function loadAiRates() {
    const s = loadTripSettings();
    const r = s.aiRates && typeof s.aiRates === "object" ? s.aiRates : {};
    const num = (v, fallback) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    // Whatever the model in use costs, unless the number has been corrected
    // by hand. Nothing to tick, nothing to type: change the model in Settings
    // and the price follows it.
    const auto = currentModelRate();
    return {
      // Free tier until somebody says otherwise. This is the honest default:
      // most people using this app are on it, and for them the answer is £0.
      paid: !!r.paid,
      model: auto.label,
      autoIn: auto.in,
      autoOut: auto.out,
      // A hand-typed rate wins, and only for as long as it differs from the
      // model's - so correcting Flash and then switching to Pro does not
      // silently keep costing Pro tokens at Flash prices.
      in: num(r.in, auto.in),
      out: num(r.out, auto.out),
      // Roughly, and said to be roughly. Nobody is making a decision on the
      // third decimal place of a currency conversion here.
      usdToGbp: num(r.usdToGbp, 0.79),
    };
  }

  function estimateCost(totals) {
    const rates = loadAiRates();
    if (!rates.paid) return null;
    const usd = (totals.inTokens / 1e6) * rates.in + (totals.outTokens / 1e6) * rates.out;
    return { usd, gbp: usd * rates.usdToGbp, rates };
  }

  function money4(n) {
    // Fractions of a penny are the normal case here, and rounding them to
    // "£0.00" would read as "this is free" when it is not.
    if (n === 0) return "£0";
    if (n < 0.01) return `less than 1p`;
    return `£${n.toFixed(2)}`;
  }

  function usageOverDays(n) {
    const usage = loadAiUsage();
    const out = blankDay();
    const from = isoDate(new Date(Date.now() - (n - 1) * 86400000));
    Object.keys(usage.days).forEach((d) => {
      if (d < from) return;
      const day = usage.days[d];
      out.calls += day.calls || 0;
      out.grounded += day.grounded || 0;
      out.inTokens += day.inTokens || 0;
      out.outTokens += day.outTokens || 0;
    });
    return out;
  }

  // Models wrap JSON in prose or code fences often enough that this is worth
  // doing properly rather than hoping for a clean parse.
  function extractJson(text) {
    if (!text) return null;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = fenced ? fenced[1] : text;
    const start = raw.search(/[[{]/);
    if (start < 0) return null;
    const end = Math.max(raw.lastIndexOf("]"), raw.lastIndexOf("}"));
    const body = end > start ? raw.slice(start, end + 1) : raw.slice(start);

    try {
      return JSON.parse(body);
    } catch (e) {
      // Not valid, which is the normal case rather than the exception.
    }
    // jsonrepair reads what a model actually produces rather than what it was
    // asked for: single quotes, trailing commas, unquoted keys, the smart
    // quotes a phone keyboard inserts, None instead of null, // comments, a
    // raw newline inside a string. All of those used to come back as "that
    // didn't contain a list this could read" about text that plainly did -
    // which matters far more now the answer can arrive by being pasted in.
    const repaired = viaJsonRepair(body);
    if (repaired !== undefined) return repaired;
    // And the hand-rolled one last, because it is better than jsonrepair at
    // exactly one thing: an answer cut off mid-object, where it discards the
    // half-written tail rather than completing it with nulls.
    return repairJson(raw.slice(start));
  }

  function viaJsonRepair(body) {
    const lib = window.JSONRepair && window.JSONRepair.jsonrepair;
    if (!lib) return undefined;
    try {
      return JSON.parse(lib(body));
    } catch (e) {
      return undefined;
    }
  }

  // Truncated JSON, closed off at the last point where a value had finished.
  function repairJson(raw) {
    let inString = false;
    let escaped = false;
    let safe = -1;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        if (inString) escaped = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        if (!inString) safe = i; // a string just finished
        continue;
      }
      if (inString) continue;
      if (c === "}" || c === "]") safe = i;
      else if (c >= "0" && c <= "9") safe = i; // a bare number can end here too
    }
    if (safe < 0) return null;

    let head = raw.slice(0, safe + 1);
    // A key with no value yet ("time": ) is not something to close around.
    head = head.replace(/,\s*"[^"]*"\s*:?\s*$/, "");
    const closers = [];
    inString = false;
    escaped = false;
    for (let i = 0; i < head.length; i++) {
      const c = head[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        if (inString) escaped = true;
        continue;
      }
      if (c === '"') inString = !inString;
      else if (inString) continue;
      else if (c === "{") closers.push("}");
      else if (c === "[") closers.push("]");
      else if (c === "}" || c === "]") closers.pop();
    }
    try {
      return JSON.parse(head + closers.reverse().join(""));
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

  // ---------- Writing to the phone ----------
  // Thirty-three calls to localStorage.setItem, not one of them guarded. When
  // storage fills, setItem throws, the throw lands in whatever handler was
  // running, and the app says "Something went wrong" - which is not what
  // happened and gives nobody anything to do. The edit is simply lost, and
  // the next one will be too.
  //
  // Nothing here can invent room, but it can say what is true, and it can
  // make room out of the things that are only worth keeping while there is
  // space for them.
  let quotaWarned = false;

  function isQuotaError(e) {
    if (!e) return false;
    // Different browsers name it differently, and Safari's is a number.
    return (
      e.name === "QuotaExceededError" ||
      e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      e.code === 22 ||
      e.code === 1014
    );
  }

  // Derived data with a shelf life: a forecast, a coordinate lookup, the last
  // few searches. All of it can be fetched again; none of it is anything
  // somebody typed.
  function dropExpendable() {
    let freed = false;
    // Named rather than referenced: these constants are declared further down
    // the file, and a quota failure during the very first load would hit them
    // before they exist. The names do not change; the ordering might.
    ["weather-cache-v1", "destination-coords-v1", "recent-searches-v1"].forEach((k) => {
      if (localStorage.getItem(k) !== null) {
        localStorage.removeItem(k);
        freed = true;
      }
    });
    return freed;
  }

  // Answers whether the write actually happened, so a caller that cares can
  // ask. Most do not, and for those the point is that the app keeps working
  // and says out loud that this one did not save.
  function store(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      // One attempt at making room, then one honest retry.
      if (dropExpendable()) {
        try {
          localStorage.setItem(key, value);
          return true;
        } catch (again) {
          if (!isQuotaError(again)) throw again;
        }
      }
      if (!quotaWarned) {
        quotaWarned = true;
        toast("This phone is out of storage — that change was not saved. Export a backup, then clear some space.");
      }
      return false;
    }
  }

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

  // Every part of a board, in one place. There were two hardcoded lists of
  // these - one in the backup, one in deleteBoard - and neither had been
  // updated since the day it was written. Four parts added later were in
  // neither: your search area, the costing, the trip idea and which sections
  // you had folded. So a backup silently left them behind and a deleted board
  // left them on the phone for ever, and both bugs had the same shape: a list
  // of parts kept somewhere other than next to the parts.
  const BOARD_PARTS = [
    "picks",
    "folders",
    "plan",
    "budget",
    "packing",
    "notes",
    "search-anchor",
    "budget-est",
    "idea",
    "collapsed",
  ];

  function loadBoards() {
    const state = readJson(BOARDS_KEY, null);
    if (state && Array.isArray(state.boards) && state.boards.length) return state;
    return migrateToBoards();
  }

  function saveBoards(state) {
    store(BOARDS_KEY, JSON.stringify(state));
  }

  // Turns the old single-trip storage into the first board. Runs once. The
  // existing picks, folders and plan are carried across as-is rather than
  // rebuilt, because losing a curated list would be far worse than any
  // tidiness gained.
  function migrateToBoards() {
    // The id is historic and deliberately unchanged: it is what every
    // existing install's picks, plan and budget are filed under, and
    // renaming it would orphan the lot for a tidiness nobody can see.
    const id = "b-scotland";
    const state = {
      activeId: id,
      boards: [
        {
          id,
          name: TRIP.title,
          destination: DEFAULT_DESTINATION,
          dated: true,
          // Kept on the record so boards and backups written before the
          // bundled guide was removed still load. Nothing reads it now.
          hasGuide: false,
          createdAt: Date.now(),
        },
      ],
    };

    const legacyPicks = readJson(LEGACY.picks, null);
    const legacyFolders = readJson(LEGACY.folders, null);
    const legacyPlan = readJson(LEGACY.plan, null);

    if (legacyPicks !== null) store(boardKey(id, "picks"), JSON.stringify(legacyPicks));
    if (legacyFolders !== null) store(boardKey(id, "folders"), JSON.stringify(legacyFolders));
    if (legacyPlan !== null) store(boardKey(id, "plan"), JSON.stringify(legacyPlan));

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
    BOARD_PARTS.forEach((part) => localStorage.removeItem(boardKey(id, part)));
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
    store(boardKey(activeBoard().id, "picks"), JSON.stringify(picks));
  }

  // Folders are user-owned organisation, separate from geography - a pick's
  // folder should never be baked into its Google Maps search query, since a
  // rough nearest-city guess (or a folder the user deliberately renamed)
  // being injected into the search text can make Maps return the wrong place.
  const FOLDERS_KEY = "scotland-trip-folders-v1";

  function loadFolders() {
    const f = readJson(boardKey(activeBoard().id, "folders"), null);
    if (Array.isArray(f) && f.length) return f;
    return ["Saved"];
  }

  function saveFolders(folders) {
    store(boardKey(activeBoard().id, "folders"), JSON.stringify(folders));
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
    store(boardKey(activeBoard().id, "budget"), JSON.stringify(rows));
  }

  // ---------- A budget that fills itself in ----------
  // It was a spreadsheet: one row per saved place, each with an empty number
  // box, plus a form for anything else. Nobody types a number into forty
  // boxes on a phone, so the screen showed £0 for ever and the tab was dead
  // weight.
  //
  // Everything on it is already knowable. The trip has days in it, the days
  // have places in them, the places have coordinates, and what a castle or a
  // pub lunch costs for a family is exactly the kind of ordinary fact the
  // model already has. So the app works it out, says out loud that it is an
  // estimate and where each number came from, and lets you correct any line -
  // at which point your number wins, permanently.
  function loadBudgetEstimate() {
    const e = readJson(boardKey(activeBoard().id, "budget-est"), null);
    return e && typeof e === "object" ? e : null;
  }

  function saveBudgetEstimate(est) {
    store(boardKey(activeBoard().id, "budget-est"), JSON.stringify(est));
  }

  // Miles you will actually drive, taken from the plan rather than guessed:
  // the legs between consecutive stops on each day, plus the same distance
  // back at the end of it, because you have to get home.
  function planDrivingMiles() {
    const plan = loadPlan();
    const byId = {};
    loadPicks().forEach((p) => (byId[p.id] = p));
    let km = 0;
    plan.days.forEach((d) => {
      const stops = itemsInDayOrder(planItems(plan, d.id))
        .map((it) => byId[it.pickId])
        .filter((p) => p && p.lat != null);
      for (let i = 1; i < stops.length; i++) {
        km += haversineKm(stops[i - 1].lat, stops[i - 1].lon, stops[i].lat, stops[i].lon) * ROAD_FACTOR;
      }
      if (stops.length > 1) {
        km += haversineKm(stops[0].lat, stops[0].lon, stops[stops.length - 1].lat, stops[stops.length - 1].lon) *
          ROAD_FACTOR;
      }
    });
    return Math.round(km * 0.621371);
  }

  function budgetPrompt(names, days, miles) {
    const s = loadTripSettings();
    const who = whoDescription() || "two adults";
    return (
      `Typical 2026 UK visitor costs, in pounds, for: ${who}.\n` +
      (s.destination ? `Destination: ${s.destination}. ` : "") +
      `Trip length: ${days || 1} day(s).` +
      (miles ? ` Roughly ${miles} miles of driving in total.` : "") +
      `\n\nFor each place listed below give the realistic total cost for this group to visit ` +
      `once - admission for everyone, or a typical spend if it is somewhere to eat or drink. ` +
      `Use 0 where entry is genuinely free. Give a low and a high, and keep the gap honest ` +
      `rather than wide for safety.\n\nPlaces:\n` +
      names.map((n) => `- ${n}`).join("\n") +
      `\n\nReply as JSON only:\n` +
      `{"places":[{"name":"exactly as listed","low":0,"high":0,"note":"a few words, e.g. free, or family ticket"}],` +
      `"foodPerDay":{"low":0,"high":0,"note":""},` +
      `"fuelTotal":{"low":0,"high":0,"note":""},` +
      `"stayPerNight":{"low":0,"high":0,"note":""}}\n` +
      `foodPerDay is for the whole group for one day, eating the way visitors normally do. ` +
      `fuelTotal covers the driving above for the whole trip. stayPerNight is a mid-range ` +
      `place for this group. No other text.`
    );
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function normaliseBudget(raw) {
    const range = (r) => ({ low: num(r && r.low), high: Math.max(num(r && r.low), num(r && r.high)), note: (r && r.note) || "" });
    const places = {};
    (Array.isArray(raw && raw.places) ? raw.places : []).forEach((p) => {
      if (!p || !p.name) return;
      places[String(p.name).toLowerCase()] = range(p);
    });
    return {
      places,
      foodPerDay: range(raw && raw.foodPerDay),
      fuelTotal: range(raw && raw.fuelTotal),
      stayPerNight: range(raw && raw.stayPerNight),
      at: Date.now(),
    };
  }

  let budgetWorking = false;
  // Which line is open for you to type your own number into, if any.
  let budgetEditing = null;

  async function estimateBudget() {
    const key = loadTripSettings().geminiKey.trim();
    if (!key) {
      toast("Add your AI key in Settings first");
      return;
    }
    const picks = loadPicks().filter((p) => !p.major);
    const days = loadPlan().days.length;
    const miles = planDrivingMiles();
    budgetWorking = true;
    renderBudget();
    try {
      const { text } = await callGemini(key, budgetPrompt(picks.map((p) => p.name), days, miles), {
        json: true,
        maxTokens: 4096,
      });
      const parsed = extractJson(text);
      if (!parsed || typeof parsed !== "object") throw new Error("no usable answer");
      const est = normaliseBudget(parsed);
      est.days = days;
      est.miles = miles;
      saveBudgetEstimate(est);
      toast("Costed the trip");
    } catch (e) {
      toast(`Couldn't work it out — ${e && e.message ? e.message : "try again"}`);
    } finally {
      budgetWorking = false;
      renderBudget();
    }
  }

  // Assembles what the screen shows: every line, where its number came from,
  // and whether you have overridden it. A price you typed always wins.
  // "£1,240" for a family of five and "£1,240" for a couple are the same
  // number and completely different facts. The app had one figure and no idea
  // how many people it was for, so it could not say the second thing. A
  // child's share is not an adult's - most of the difference is admission,
  // where a child is roughly half - so the split is weighted rather than a
  // straight division, and it says so.
  function budgetSplitLine(low, high) {
    const people = loadPeople();
    if (people.length < 2) return "";
    const adults = people.filter((p) => !isChild(p)).length;
    const children = people.length - adults;
    const mid = (low + high) / 2;
    if (!mid) return "";
    // One share per adult, half a share per child.
    const shares = adults + children * 0.5;
    if (!shares) return "";
    const perAdult = Math.round(mid / shares);
    const bits = [`${money(perAdult)} an adult`];
    if (children) bits.push(`${money(Math.round(perAdult / 2))} a child`);
    return `<div class="budget-hero-split">${esc(bits.join(" · "))} <span class="budget-split-note">across ${
      people.length
    } of you</span></div>`;
  }

  function budgetLines() {
    const est = loadBudgetEstimate();
    const picks = loadPicks().filter((p) => !p.major);
    const plan = loadPlan();
    const nights = Math.max(0, plan.days.length - 1);
    const extras = loadBudgetExtras();

    const places = picks.map((p) => {
      const mine = pickCost(p);
      const guess = est && est.places[p.name.toLowerCase()];
      return {
        id: p.id,
        name: p.name,
        low: mine || (guess ? guess.low : 0),
        high: mine || (guess ? guess.high : 0),
        note: mine ? "your price" : guess ? guess.note : "",
        source: mine ? "yours" : guess ? "estimate" : "unknown",
      };
    });

    const trip = [];
    if (est) {
      if (plan.days.length && est.foodPerDay.high) {
        trip.push({
          key: "food",
          name: `Eating, ${plan.days.length} day${plan.days.length === 1 ? "" : "s"}`,
          low: est.foodPerDay.low * plan.days.length,
          high: est.foodPerDay.high * plan.days.length,
          note: est.foodPerDay.note || `${money(est.foodPerDay.low)}–${money(est.foodPerDay.high)} a day`,
          source: "estimate",
        });
      }
      if (est.fuelTotal.high) {
        trip.push({
          key: "fuel",
          name: "Getting about",
          low: est.fuelTotal.low,
          high: est.fuelTotal.high,
          note: est.miles ? `about ${est.miles} miles of driving in the plan` : est.fuelTotal.note,
          source: "estimate",
        });
      }
      if (nights && est.stayPerNight.high) {
        trip.push({
          key: "stay",
          name: `Somewhere to stay, ${nights} night${nights === 1 ? "" : "s"}`,
          low: est.stayPerNight.low * nights,
          high: est.stayPerNight.high * nights,
          note: est.stayPerNight.note || `${money(est.stayPerNight.low)}–${money(est.stayPerNight.high)} a night`,
          source: "estimate",
        });
      }
    }

    // An override on a trip-level line is stored as an ordinary extra with a
    // reserved name, so there is one place where "what you told us" lives.
    const overrides = {};
    extras.forEach((r) => {
      if (r.overrides) overrides[r.overrides] = Number(r.amount) || 0;
    });
    trip.forEach((line) => {
      if (overrides[line.key] !== undefined) {
        line.low = line.high = overrides[line.key];
        line.note = "your price";
        line.source = "yours";
      }
    });

    const own = extras.filter((r) => !r.overrides);
    return { places, trip, own, est };
  }

  // The packing list used to be one global list of fixed Scottish items with
  // only its ticks stored. It's now per board and fully editable - a
  // three-day city break and a week in the Highlands need different lists.
  function loadPacking() {
    const board = activeBoard();
    const stored = readJson(boardKey(board.id, "packing"), null);
    if (Array.isArray(stored)) return stored;
    // A short generic list beats an empty screen: nobody types "chargers"
    // into nothing, they close it. Anything already ticked under the old
    // global key is carried over.
    const checked = readJson(STORAGE_KEY, {}) || {};
    const seeded = PACKING.map((text, i) => ({ text, done: !!checked[i] }));
    // And the few lines that depend on who is actually coming, from the
    // people list rather than from a guess about families in general.
    const people = loadPeople();
    if (people.some((x) => x.buggy)) seeded.push({ text: "Buggy, and the rain cover for it", done: false });
    if (people.some(isChild)) seeded.push({ text: "A comfort toy for the long legs", done: false });
    if (people.some((x) => x.naps)) seeded.push({ text: "Whatever makes a nap happen away from home", done: false });
    store(boardKey(board.id, "packing"), JSON.stringify(seeded));
    return seeded;
  }

  function savePacking(items) {
    store(boardKey(activeBoard().id, "packing"), JSON.stringify(items));
  }

  function loadBoardNotes() {
    return readJson(boardKey(activeBoard().id, "notes"), "") || "";
  }

  function saveBoardNotes(text) {
    store(boardKey(activeBoard().id, "notes"), JSON.stringify(text));
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

  // ---------- Major places: somewhere you go *to*, not *in* ----------
  //
  // A town, a village, an island. Saving one alongside a café was always the
  // wrong shape: Stirling isn't a thing to do in Stirling, it's the thing the
  // day is built around. A major place heads its own section instead of
  // sitting in one, and it collects what you save near it - so the list reads
  // as places-within-areas rather than one flat run of names.
  //
  // Every town the app knows about is one you saved: there used to be three
  // hardcoded Scottish anchors doing this job, which worked nowhere else.
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
    return nearestMajorPlace(lat, lon);
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
        confirmedWithinAnchor(loadAnchor(), c.lat, c.lon, ANCHOR_GRACE)
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
  // Set by geocodeCandidates on every attempt: true when the answer came from
  // the on-device cache rather than the network.
  let lastGeocodeFromCache = false;
  // How long the whole question gets, across all its attempts.
  const GEOCODE_BUDGET_MS = 12000;

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

    // A timeout per request is not the same as a timeout for the question.
    // Three attempts that each give up after eight seconds is twenty-four
    // seconds of somebody looking at a spinner, which is not meaningfully
    // better than hanging. The whole lookup gets a budget, and attempts stop
    // when it is spent.
    const deadline = Date.now() + GEOCODE_BUDGET_MS;

    for (const attempt of attempts) {
      const left = deadline - Date.now();
      // Under a second left is not enough for an answer, only for another wait.
      if (left < 1000) break;
      const url =
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=${GEOCODE_LIMIT}` +
        `&addressdetails=1&extratags=1&namedetails=1&q=${encodeURIComponent(attempt.q)}${attempt.box}`;
      let data;
      try {
        const answer = await cachedJson(
          url,
          { headers: { Accept: "application/json" } },
          Math.min(NET_TIMEOUT_MS, left)
        );
        data = answer.data;
        // Read by the Explore loop below, which pauses a second between
        // lookups out of politeness to Nominatim. There is nobody to be
        // polite to when the answer came off the device.
        lastGeocodeFromCache = answer.fromCache;
      } catch (e) {
        lastGeocodeFromCache = false;
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
          <button class="modal-close" data-close="1" aria-label="Close">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
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
    makeSheetDraggable(placeModal, closePlaceModal);

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
      // Nominatim tells us the country and it was being thrown away. Public
      // holidays are the reason it matters: "Mo-Su 10:00-18:00; PH off" cannot
      // be answered at all without knowing whose public holidays.
      countryCode: (addr.country_code || "").toLowerCase() || null,
      state: addr.state || null,
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
    const searchRes = await fetchWithTimeout(searchUrl);
    if (!searchRes.ok) throw new Error("wikidata search error");
    const searchData = await searchRes.json();
    const hit = searchData.search && searchData.search[0];
    if (!hit) return null;

    let website = null;
    try {
      const entUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${hit.id}&props=claims&format=json&origin=*`;
      const entRes = await fetchWithTimeout(entUrl);
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
    let photo = null;
    try {
      const title = (hit.label || name).replace(/ /g, "_");
      const sumRes = await fetchWithTimeout(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
      );
      if (sumRes.ok) {
        const sum = await sumRes.json();
        if (sum.extract) description = sum.extract;
        // The picture was in this response all along and was being thrown
        // away. Nothing in the app had an image in it - not one - which is
        // most of why a screen of places read as a database rather than
        // somewhere you might go.
        if (sum.thumbnail && sum.thumbnail.source) photo = upscaleWikiThumb(sum.thumbnail.source);
      }
    } catch (e) {
      // no Wikipedia page - Wikidata's short description is still fine
    }

    return { description, website, photo };
  }

  // ---------- Pictures ----------
  // Wikipedia hands back a 320px-wide thumbnail, which is soft on a phone at
  // three times that. The size is a path segment, so asking for a bigger one
  // is a substitution rather than another request.
  function upscaleWikiThumb(url, width) {
    return String(url).replace(/\/(\d+)px-/, `/${width || 640}px-`);
  }

  // A photo of the wrong castle is worse than no photo at all, so a title has
  // to earn it: either it shares a real word with the place, or the article's
  // own coordinates put it within a couple of hundred metres.
  function photoTitleFits(title, name) {
    const words = (s) =>
      String(s)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3 && !["the", "and", "inn", "cafe", "house"].includes(w));
    const a = words(title);
    const b = words(name);
    if (!a.length || !b.length) return false;
    return b.some((w) => a.includes(w));
  }

  const WIKI_API = "https://en.wikipedia.org/w/api.php";

  // Answers `{ url, asked }`. The second half is the whole point: `asked` is
  // true only when Wikipedia actually replied and had nothing, and false when
  // the question never got through. Both used to come back as a bare null,
  // and the caller wrote that down as "this place has no photograph" - so
  // opening the list once with no signal permanently blinded every place on
  // it, on every network, forever after. Which is precisely the moment the
  // app is most likely to be opened: in the car, in a glen, before you go.
  async function findPhoto(name, lat, lon) {
    if (isOffline()) return { url: null, asked: false };
    const params =
      `action=query&prop=pageimages|coordinates&piprop=thumbnail&pithumbsize=640&format=json&origin=*`;
    // Both lookups are allowed to fail; only a clean reply counts as an
    // answer, and one clean reply anywhere is enough to settle the question.
    let answered = false;
    // Somewhere with coordinates is best found by them: two places share a
    // name far more often than they share a spot on the map.
    if (lat != null && lon != null) {
      try {
        const url =
          `${WIKI_API}?${params}&generator=geosearch&ggscoord=${lat}|${lon}&ggsradius=1000&ggslimit=8`;
        const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
        if (res.ok) {
          const data = await res.json();
          answered = true;
          const pages = Object.values((data.query && data.query.pages) || {}).filter(
            (p) => p.thumbnail && p.thumbnail.source
          );
          const named = pages.find((p) => photoTitleFits(p.title, name));
          const close = pages.find((p) => {
            const c = p.coordinates && p.coordinates[0];
            return c && haversineKm(lat, lon, c.lat, c.lon) < 0.2;
          });
          const hit = named || close;
          if (hit) return { url: upscaleWikiThumb(hit.thumbnail.source), asked: true };
        }
      } catch (e) {
        /* offline, or Wikipedia having a day - not worth a message */
      }
    }
    try {
      const url = `${WIKI_API}?${params}&generator=search&gsrsearch=${encodeURIComponent(name)}&gsrlimit=3`;
      const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return { url: null, asked: answered };
      const data = await res.json();
      const pages = Object.values((data.query && data.query.pages) || {});
      const hit = pages.find((p) => p.thumbnail && p.thumbnail.source && photoTitleFits(p.title, name));
      return { url: hit ? upscaleWikiThumb(hit.thumbnail.source) : null, asked: true };
    } catch (e) {
      return { url: null, asked: answered };
    }
  }

  // Looking one up costs a request, so a place is only asked about once per
  // run of the app. A genuine "there is no photograph of this pub" is written
  // down and never asked again; a request that failed is not written down at
  // all, so the next time the app opens with signal it tries once more. The
  // in-memory guard is what stops that becoming a retry on every redraw.
  const photoLookups = {};

  // Cleared when the signal returns, so a list looked at in a tunnel fills in
  // once you are out of it rather than staying blank until the app restarts.
  function forgetFailedPhotoLookups() {
    Object.keys(photoLookups).forEach((id) => {
      if (photoLookups[id] === "failed") delete photoLookups[id];
    });
  }

  function wantPhoto(p, onFound) {
    if (!p || p.photo || p.photoChecked) return;
    if (photoLookups[p.id]) return;
    photoLookups[p.id] = true;
    findPhoto(p.name, p.lat, p.lon).then(({ url, asked }) => {
      // Nothing was learned, so nothing is recorded - not even a "no".
      if (!url && !asked) {
        photoLookups[p.id] = "failed";
        return;
      }
      const picks = loadPicks();
      const pick = picks.find((x) => x.id === p.id);
      if (!pick) return;
      pick.photoChecked = true;
      if (url) pick.photo = url;
      savePicks(picks);
      if (url && onFound) onFound(url);
    });
  }

  // Three at a time, and only for what is on the screen: a list of forty
  // places should not open forty connections the moment you scroll past it.
  function fetchMissingPhotos(list, redraw) {
    let started = 0;
    let found = false;
    const done = () => {
      if (!found) {
        found = true;
        // One redraw when the first picture lands, not one per picture.
        setTimeout(() => redraw && redraw(), 400);
      }
    };
    list.forEach((p) => {
      if (started >= 3) return;
      if (p.photo || p.photoChecked || photoLookups[p.id]) return;
      started++;
      wantPhoto(p, done);
    });
  }

  // What a row shows when there is no photograph: the category, drawn, on a
  // tinted square. An empty grey box says the app is broken; this says there
  // is no picture of this pub, which is true and unremarkable.
  const CATEGORY_ICONS = [
    [/castle|palace|fort|tower|ruin|abbey|cathedral|church|monument|historic/i, "castle"],
    [/museum|gallery|exhibit/i, "note"],
    [/playground|soft play|park|garden|zoo|farm|animal/i, "kids"],
    [/beach|coast|loch|lake|river|waterfall|hill|mountain|walk|trail|glen|forest|wood/i, "walk"],
    [/pub|bar|inn|distillery|brewery|whisky/i, "food"],
    [/cafe|café|coffee|bakery|tea/i, "coffee"],
    [/restaurant|bistro|grill|pizza|chippy|takeaway|eat|food|diner/i, "food"],
    [/hotel|b&b|guest|hostel|stay/i, "tips"],
    [/town|city|village|area|region/i, "globe"],
  ];

  function categoryIcon(p) {
    const hay = `${p.category || ""} ${p.name || ""} ${p.description || ""}`;
    const hit = CATEGORY_ICONS.find(([re]) => re.test(hay));
    return hit ? hit[1] : "pin";
  }

  // `size` is "thumb" for a row or "hero" for the top of a sheet.
  function photoBlock(p, size) {
    const cls = size === "hero" ? "photo-hero" : "photo-thumb";
    if (p.photo) {
      // data-photo keeps the original address after src has been swapped for
      // a blob, so the cache stays keyed on the picture rather than on a URL
      // that only exists in this tab.
      return `<div class="${cls}"><img src="${esc(p.photo)}" data-photo="${esc(p.photo)}" alt="" loading="lazy" decoding="async"
        onload="window.__photoSeen(this)"
        onerror="window.__photoGone(this)" /></div>`;
    }
    return `<div class="${cls} photo-none">${icon(categoryIcon(p), { size: size === "hero" ? 44 : 22 })}</div>`;
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
        .then((list) => list.filter((c) => confirmedWithinAnchor(loadAnchor(), c.lat, c.lon, ANCHOR_GRACE)))
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
      if (!fresh.countryCode && geo.countryCode) fresh.countryCode = geo.countryCode;
      if (!fresh.state && geo.state) fresh.state = geo.state;
      if ((!fresh.category || fresh.category === "Custom") && geo.category) fresh.category = geo.category;
    }
    if (wiki) {
      if (wiki.description) fresh.description = wiki.description;
      if (!fresh.website && wiki.website) fresh.website = wiki.website;
      if (wiki.photo) fresh.photo = wiki.photo;
    }
    fresh.enrichStatus = geo || wiki ? "done" : "empty";
    savePicks(picks);
    if (view.dataset.activeTab === "picks") renderPicks();
  }

  // ---------- Pinning an event's venue properly ----------
  // The search places events with the free OSM lookup, which is a gazetteer of
  // mapped features and knows a castle far better than it knows a village
  // hall. That is why so many event rows carry "approx. location": the town
  // centre was the best answer available.
  //
  // Google Places does know the hall, the library and the pub - but it is
  // billed per request, and nine angles of twenty events would be a hundred
  // and eighty of them for one search. So it is not asked during a search at
  // all. It is asked once, for one venue, at the moment you open or save that
  // event - which is the moment the pin stops being decoration and becomes
  // somewhere you might drive to.
  const venueLookups = {};

  function eventNeedsVenue(pick) {
    if (!pick || pick.kind !== "event") return false;
    if (pick.googleUrl || pick.venueChecked) return false;
    if (!String(pick.venue || "").trim()) return false;
    return !!loadTripSettings().googleKey.trim();
  }

  async function refineEventVenue(id, after) {
    const pick = loadPicks().find((p) => p.id === id);
    if (!eventNeedsVenue(pick)) return;
    const query = [pick.venue, pick.area || pick.city].filter(Boolean).join(", ");
    if (venueLookups[query]) return;
    venueLookups[query] = true;

    let hit = null;
    try {
      // Bounded to where the event already is, so a venue name that exists in
      // fifty towns cannot resolve to the wrong one. The same rule the rest of
      // the app follows: a coordinate outside the area is never assigned.
      const anchor =
        pick.lat != null
          ? { name: pick.area || pick.city || "", lat: pick.lat, lon: pick.lon, miles: 12 }
          : loadAnchor();
      const results = await searchGooglePlaces(query, loadTripSettings().googleKey.trim(), anchor);
      hit = results.find((r) => r.lat != null && (!anchor || confirmedWithinAnchor(anchor, r.lat, r.lon, ANCHOR_GRACE)));
    } catch (e) {
      // A failed lookup is not worth retrying on every open; it is marked
      // below either way, the same as a photo that could not be found.
    }

    const picks = loadPicks();
    const fresh = picks.find((p) => p.id === id);
    if (!fresh) return;
    // Marked whether or not it worked, so opening the same event ten times is
    // one request rather than ten.
    fresh.venueChecked = true;
    if (hit) {
      fresh.lat = hit.lat;
      fresh.lon = hit.lon;
      // An exact pin is no longer an approximate one, and the row must stop
      // saying that it is.
      delete fresh.approximate;
      if (hit.googleUrl) fresh.googleUrl = hit.googleUrl;
      if (hit.address) fresh.address = hit.address;
      if (!fresh.website && hit.website) fresh.website = hit.website;
      if (!fresh.phone && hit.phone) fresh.phone = hit.phone;
      if (!fresh.openingHours && hit.openingHours) fresh.openingHours = hit.openingHours;
      if (fresh.rating == null && hit.rating != null) {
        fresh.rating = hit.rating;
        fresh.ratingCount = hit.ratingCount;
      }
    }
    savePicks(picks);
    if (after) after();
  }

  // ---------- Place detail modal ----------

  const placeModal = document.getElementById("placeModal");

  function closePlaceModal() {
    placeModal.classList.remove("open");
  }

  // ---------- Things you do with a thumb ----------
  // A sheet that can only be dismissed by finding a small close button in its
  // corner is a dialog on a web page. A sheet you push back down is a sheet.
  // The drag only starts near the handle, which is both where a hand goes and
  // the one part of it guaranteed not to be scrolling underneath.
  function makeSheetDraggable(root, onClose) {
    const sheet = root.querySelector(".modal-sheet");
    if (!sheet || !sheet.querySelector(".modal-handle")) return;

    let startY = 0;
    let startedAt = 0;
    let dy = 0;
    let dragging = false;

    const start = (e) => {
      const t = e.touches ? e.touches[0] : e;
      if (!t) return;
      if (t.clientY - sheet.getBoundingClientRect().top > 64) return;
      dragging = true;
      startY = t.clientY;
      startedAt = Date.now();
      dy = 0;
      sheet.style.transition = "none";
    };

    const move = (e) => {
      if (!dragging) return;
      const t = e.touches ? e.touches[0] : e;
      if (!t) return;
      dy = Math.max(0, t.clientY - startY);
      if (dy > 4 && e.cancelable) e.preventDefault();
      // Resistance rather than a straight follow, so it feels attached to
      // something rather than sliding on ice.
      sheet.style.transform = `translateY(${dy * 0.85}px)`;
    };

    const end = () => {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = "";
      const flick = Date.now() - startedAt < 300 && dy > 40;
      sheet.style.transform = "";
      if (dy > 110 || flick) onClose();
    };

    sheet.addEventListener("touchstart", start, { passive: true });
    sheet.addEventListener("touchmove", move, { passive: false });
    sheet.addEventListener("touchend", end);
    sheet.addEventListener("touchcancel", end);
  }

  // Swipe a row aside to get at what you would otherwise open the place to do.
  // Delegated once, on the view, so it survives every redraw - and it locks to
  // one axis within the first few pixels, because a list that hijacks a
  // vertical scroll is worse than one with no gestures at all.
  const SWIPE_OPEN = 132;
  let swipeRow = null;
  let swipeStart = null;
  let swipeAxis = "";

  function closeSwipedRow() {
    if (!swipeRow) return;
    const body = swipeRow.querySelector(".pick-row, .kids-row");
    if (body) body.style.transform = "";
    swipeRow.classList.remove("swiped");
    swipeRow = null;
  }

  function onRowTouchStart(e) {
    if (!e.touches || !e.touches.length) return;
    const row = e.target.closest && e.target.closest(".swipeable");
    if (!row) {
      closeSwipedRow();
      return;
    }
    if (swipeRow && swipeRow !== row) closeSwipedRow();
    const body = row.querySelector(".pick-row, .kids-row");
    if (!body) return;
    const t = e.touches[0];
    swipeStart = {
      x: t.clientX,
      y: t.clientY,
      row,
      body,
      from: row.classList.contains("swiped") ? -SWIPE_OPEN : 0,
    };
    swipeAxis = "";
  }

  function onRowTouchMove(e) {
    if (!swipeStart || !e.touches || !e.touches.length) return;
    const t = e.touches[0];
    const dx = t.clientX - swipeStart.x;
    const dy = t.clientY - swipeStart.y;
    if (!swipeAxis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      swipeAxis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (swipeAxis === "x") swipeStart.row.classList.add("swiping");
    }
    if (swipeAxis !== "x") return;
    if (e.cancelable) e.preventDefault();
    swipeStart.shift = Math.max(-SWIPE_OPEN - 16, Math.min(0, swipeStart.from + dx));
    swipeStart.body.style.transform = `translateX(${swipeStart.shift}px)`;
  }

  function onRowTouchEnd() {
    if (!swipeStart) return;
    const row = swipeStart.row;
    row.classList.remove("swiping");
    if (swipeAxis === "x") {
      if ((swipeStart.shift || 0) < -60) {
        swipeStart.body.style.transform = `translateX(${-SWIPE_OPEN}px)`;
        row.classList.add("swiped");
        swipeRow = row;
        tapFeedback("light");
      } else {
        swipeStart.body.style.transform = "";
        row.classList.remove("swiped");
        if (swipeRow === row) swipeRow = null;
      }
    }
    swipeStart = null;
    swipeAxis = "";
  }

  // The actions revealed behind a row. Rendered with the row rather than built
  // when the gesture starts, because that is a frame you cannot spare.
  function rowActions(id) {
    return `
      <div class="row-actions" aria-hidden="true">
        <button class="row-action day" data-row-day="${esc(id)}" tabindex="-1"
                aria-label="Put on a day">${icon("calendarPlus", { size: 18 })}<span>Day</span></button>
        <button class="row-action remove" data-row-remove="${esc(id)}" tabindex="-1"
                aria-label="Remove">${icon("trash", { size: 18 })}<span>Remove</span></button>
      </div>
    `;
  }

  // Folding, delegated once so it works on whichever list drew the heading.
  view.addEventListener("click", (e) => {
    const fold = e.target.closest && e.target.closest("[data-fold]");
    const all = e.target.closest && e.target.closest("[data-fold-all]");
    if (!fold && !all) return;
    e.preventDefault();
    e.stopPropagation();
    const redraw = () => VIEWS[view.dataset.activeTab].render();
    if (all) {
      const labels = Array.from(view.querySelectorAll("[data-fold]")).map((b) =>
        b.getAttribute("data-fold")
      );
      setAllCollapsed(labels, all.getAttribute("data-fold-all") === "close");
    } else {
      toggleCollapsed(fold.getAttribute("data-fold"));
    }
    redraw();
  });

  // One set of listeners on the view, for every list it will ever draw.
  view.addEventListener("touchstart", onRowTouchStart, { passive: true });
  view.addEventListener("touchmove", onRowTouchMove, { passive: false });
  view.addEventListener("touchend", onRowTouchEnd);
  view.addEventListener("touchcancel", onRowTouchEnd);
  view.addEventListener("click", (e) => {
    const day = e.target.closest && e.target.closest("[data-row-day]");
    const remove = e.target.closest && e.target.closest("[data-row-remove]");
    if (!day && !remove) return;
    e.preventDefault();
    e.stopPropagation();
    const id = (day || remove).getAttribute(day ? "data-row-day" : "data-row-remove");
    closeSwipedRow();
    if (day) {
      openDaySheet(id, { onDone: () => VIEWS[view.dataset.activeTab].render() });
      return;
    }
    // The existing one, which puts a place back where it was rather than at
    // the end - a place reappearing somewhere else reads as a second mistake.
    removePickWithUndo(id, () => VIEWS[view.dataset.activeTab].render());
  });

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
        `<span>${icon('alert', { size: 15, cls: 'ico-inline' })} No connection — your places, plan and notes all still work. Search, weather and maps need signal.</span>`;
      appBanner.hidden = false;
      return;
    }
    if (backupIsOverdue() && !backupNudgeSnoozed()) {
      appBanner.className = "app-banner nudge";
      appBanner.innerHTML =
        `<span>${esc(backupAgeLine())} Everything is only on this phone.</span>` +
        `<button class="app-banner-action" id="bannerBackup">Back up</button>` +
        `<button class="app-banner-dismiss" id="bannerDismiss" aria-label="Not now">${icon('close', { size: 15 })}</button>`;
      appBanner.hidden = false;
      const btn = document.getElementById("bannerBackup");
      if (btn) {
        btn.addEventListener("click", async () => {
          const res = await exportBackup();
          toast(res.message);
          refreshBanner();
        });
      }
      const off = document.getElementById("bannerDismiss");
      if (off) {
        off.addEventListener("click", () => {
          snoozeBackupNudge();
          refreshBanner();
          // More carries the mark from now on, so a dismissed warning is
          // still findable rather than forgotten.
          if (view.dataset.activeTab === "more") renderMore();
        });
      }
      return;
    }
    appBanner.hidden = true;
    appBanner.innerHTML = "";
  }

  window.addEventListener("online", () => {
    refreshBanner();
    // Signal coming back is the one moment worth asking again about
    // everything that could not be asked while it was gone.
    forgetFailedPhotoLookups();
  });
  window.addEventListener("offline", refreshBanner);

  // ---------- Backup ----------
  // Everything lives in this device's localStorage, which an uninstall, a
  // "clear data", or a lost phone erases with no recovery. This writes the
  // whole trip out as one file that can be saved, sent to someone else, or
  // restored later.
  // A function, not a constant: PLAN_KEY is declared further down the file,
  // so reading it while this module is still evaluating would hit the
  // temporal dead zone and throw before the app ever renders.
  // Bumped only when the layout of a backup file changes in a way an older
  // build could not read correctly. Adding a key is not that - an older build
  // ignores what it does not recognise.
  const BACKUP_VERSION = 1;

  function backupKeys() {
    // Every board's data, not just the open one - a backup that quietly
    // dropped the boards you weren't looking at would be worse than none.
    // The legacy single-trip keys ride along so a backup taken now still
    // restores onto an older build.
    // The weather cache is deliberately not in here: it's derived data with a
    // shelf life of hours, and restoring last week's forecast onto a new
    // phone would be worse than fetching it again.
    // Who is travelling belongs in a backup for the same reason the picks do:
    // it is typed once and nobody would think to type it again after a
    // reinstall, and half the app's answers change without it.
    // The AI usage count is deliberately not in here either. It is a meter for
    // one device, and it says so on its own screen; restoring it onto a second
    // phone would add two devices' spending together and present the result as
    // one phone's, which is a wrong number rather than a missing one.
    const keys = [BOARDS_KEY, TRIP_KEY, STORAGE_KEY, RECENT_KEY, PEOPLE_KEY, NOTIFY_KEY, LEGACY.picks, LEGACY.folders, LEGACY.plan];
    loadBoards().boards.forEach((b) => {
      BOARD_PARTS.forEach((part) => keys.push(boardKey(b.id, part)));
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
      { format: "scotland-trip-backup", version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data },
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

  // A warning nobody can answer is furniture. The nudge sat at the top of
  // every screen, permanently, with no reply available except taking a
  // backup - and a message that cannot be acknowledged stops being read
  // within a day, which means the one moment it matters is the moment it
  // gets ignored. Dismissing quiets it for a week, not for ever: the data
  // really is only on this phone, and that does not stop being true because
  // somebody was busy.
  const BACKUP_SNOOZE_KEY = "backup-nudge-snoozed-v1";
  const BACKUP_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

  function backupNudgeSnoozed() {
    const at = readJson(BACKUP_SNOOZE_KEY, 0);
    return typeof at === "number" && at > 0 && Date.now() - at < BACKUP_SNOOZE_MS;
  }

  function snoozeBackupNudge() {
    store(BACKUP_SNOOZE_KEY, JSON.stringify(Date.now()));
  }

  // ---------- The backup nobody has to remember to take ----------
  // Everything lives in this phone's localStorage, which a reinstall, a
  // "clear app data" or a lost phone takes with it. The app's whole answer to
  // that was a banner asking you to press Export, once a week, for ever - and
  // the one person guaranteed not to press it is the one who most needs to
  // have.
  //
  // On the phone the app can simply write the file itself, into Documents,
  // where it survives the app being uninstalled and where a person can find
  // it without the app's help. A browser gets nothing here, because a browser
  // cannot silently write to disk and should not try - the Export button is
  // already there.
  const AUTO_BACKUP_KEY = "auto-backup-at-v1";
  const AUTO_BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;
  const AUTO_BACKUP_KEEP = 3;

  // Named apart from backupFilename() deliberately: these two used to share a
  // name, the later definition quietly won for every caller, and the manual
  // export ended up calling it with no argument - producing
  // "trip-backup-NaN-NaN-NaN.json" and losing the board name. Nothing tested
  // the filename, so nothing noticed.
  function autoBackupFilename(when) {
    const d = new Date(when);
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    return `trip-backup-${stamp}.json`;
  }

  async function autoBackup() {
    const fs = nativePlugin("Filesystem");
    if (!fs) return { ok: false, reason: "no filesystem" };
    // Nothing worth saving yet is not a failure, it is Tuesday.
    if (loadPicks().length < 3) return { ok: false, reason: "nothing to save" };
    const last = readJson(AUTO_BACKUP_KEY, null);
    if (typeof last === "number" && Date.now() - last < AUTO_BACKUP_EVERY_MS) {
      return { ok: false, reason: "done recently" };
    }

    const json = buildBackup();
    const name = autoBackupFilename(Date.now());
    try {
      await fs.writeFile({
        path: name,
        data: json,
        directory: "DOCUMENTS",
        encoding: "utf8",
        recursive: true,
      });
    } catch (e) {
      // A phone that will not let the app write is not a broken app, and it
      // is not worth a message either - the banner already asks for a manual
      // export, and that is still true.
      return { ok: false, reason: "write refused" };
    }

    store(AUTO_BACKUP_KEY, JSON.stringify(Date.now()));
    // A backup taken automatically is a backup, so the banner should stop
    // asking. Overwriting the manual timestamp is deliberate: the question it
    // answers is "when was this trip last saved anywhere", not "when did you
    // last press a button".
    store(LAST_BACKUP_KEY, JSON.stringify(Date.now()));
    await trimOldBackups(fs, name);
    return { ok: true, name };
  }

  // Three is enough to recover from "I deleted something yesterday and only
  // noticed now", and few enough that a year of them is not sitting on a
  // phone nobody looks at.
  async function trimOldBackups(fs, keepNewest) {
    try {
      const listing = await fs.readdir({ path: "", directory: "DOCUMENTS" });
      const mine = ((listing && listing.files) || [])
        .map((f) => (typeof f === "string" ? f : f.name))
        .filter((n) => /^trip-backup-\d{4}-\d{2}-\d{2}\.json$/.test(n))
        .sort();
      const doomed = mine.filter((n) => n !== keepNewest).slice(0, Math.max(0, mine.length - AUTO_BACKUP_KEEP));
      for (const name of doomed) {
        await fs.deleteFile({ path: name, directory: "DOCUMENTS" }).catch(() => {});
      }
    } catch (e) {
      /* an old plugin without readdir just leaves them all, which is fine */
    }
  }

  // ---------- Putting the trip in a real calendar ----------
  // The plan lives in this app and nowhere else, which is fine until somebody
  // else in the family wants to know what Tuesday looks like.
  //
  // There is an `ics` package on npm and it was the obvious thing to reach
  // for. It is twenty-one files of Node modules, which a no-build-step app
  // cannot vendor without pulling in a bundler - and the format itself is a
  // dozen lines of text with strict rules about escaping and line endings.
  // The rules are the actual work, and they are written out below rather than
  // hidden behind a dependency that would cost more to carry than to replace.
  const ICS_LINE_END = "\r\n"; // RFC 5545 is explicit about this, and Outlook cares

  function icsEscape(text) {
    return String(text || "")
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }

  // Long lines must be folded at 75 octets, continued with a leading space.
  // A calendar that refuses to open is the usual symptom of skipping this.
  function icsFold(line) {
    if (line.length <= 75) return line;
    const parts = [line.slice(0, 75)];
    let rest = line.slice(75);
    while (rest.length > 74) {
      parts.push(" " + rest.slice(0, 74));
      rest = rest.slice(74);
    }
    if (rest) parts.push(" " + rest);
    return parts.join(ICS_LINE_END);
  }

  function icsStamp(date) {
    const p = (n) => String(n).padStart(2, "0");
    return (
      `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
      `T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
    );
  }

  function icsDay(date) {
    const p = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
  }

  // Every stop on every dated day, as calendar events. A stop with a time gets
  // an hour; a stop without one becomes an all-day entry, because inventing a
  // time would put somebody in a car park at nine in the morning for no reason.
  function buildTripIcs() {
    const plan = loadPlan();
    const byId = {};
    loadPicks().forEach((p) => {
      byId[p.id] = p;
    });
    const board = activeBoard();
    const now = new Date();
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Wayfare//Trip//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${icsEscape(board.name)}`,
    ];

    let count = 0;
    datedDays(plan.days).forEach(({ d, when }) => {
      if (!when) return; // an undated day has no place in a calendar
      itemsInDayOrder(plan.items[d.id] || []).forEach((item, i) => {
        const pick = byId[item.pickId];
        if (!pick) return;
        count++;
        const uid = `${d.id}-${i}-${board.id}@wayfare`;
        const where = [pick.venue, pick.address || pick.city].filter(Boolean).join(", ");
        const body = [pick.description, pick.note, pick.website].filter(Boolean).join("\n\n");

        lines.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${icsStamp(now)}`);

        const mins = timeToMinutes(item.time);
        if (mins == null) {
          // All-day. DTEND is exclusive, hence the next morning.
          const next = new Date(when);
          next.setDate(next.getDate() + 1);
          lines.push(`DTSTART;VALUE=DATE:${icsDay(when)}`, `DTEND;VALUE=DATE:${icsDay(next)}`);
        } else {
          const start = new Date(when);
          start.setHours(0, mins, 0, 0);
          const end = new Date(start.getTime() + 60 * 60000);
          // Local time with no zone: an event at 10:00 should read 10:00
          // wherever the phone thinks it is, which is what floating time means.
          const local = (dt) => {
            const p = (n) => String(n).padStart(2, "0");
            return (
              `${dt.getFullYear()}${p(dt.getMonth() + 1)}${p(dt.getDate())}` +
              `T${p(dt.getHours())}${p(dt.getMinutes())}00`
            );
          };
          lines.push(`DTSTART:${local(start)}`, `DTEND:${local(end)}`);
        }

        lines.push(`SUMMARY:${icsEscape(pick.name)}`);
        if (where) lines.push(`LOCATION:${icsEscape(where)}`);
        if (body) lines.push(`DESCRIPTION:${icsEscape(body)}`);
        if (pick.lat != null && pick.lon != null) lines.push(`GEO:${pick.lat};${pick.lon}`);
        lines.push("END:VEVENT");
      });
    });

    lines.push("END:VCALENDAR");
    return { text: lines.map(icsFold).join(ICS_LINE_END) + ICS_LINE_END, count };
  }

  function exportTripIcs() {
    const { text, count } = buildTripIcs();
    if (!count) {
      return { ok: false, message: "Nothing to export yet — add some dated days with stops in them." };
    }
    try {
      const name = `${activeBoard().name.replace(/[^\w-]+/g, "-").toLowerCase()}.ics`;
      const blob = new Blob([text], { type: "text/calendar" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return { ok: true, message: `Saved ${name} — ${count} stop${count === 1 ? "" : "s"}. Open it to add them to your calendar.` };
    } catch (e) {
      return { ok: false, message: `Couldn't save the file: ${e.message || e}` };
    }
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
      store(LAST_BACKUP_KEY, JSON.stringify(Date.now()));
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
    // The version has been written into every backup since the first one and
    // read by nothing. A file from a future build could be laid out
    // differently, and quietly restoring half of it is how somebody loses a
    // trip - so a version this build does not know about is refused, in words
    // that say what to do about it.
    const version = Number(parsed.version) || 1;
    if (version > BACKUP_VERSION) {
      return {
        ok: false,
        message: `That backup was made by a newer version of the app (file ${version}, this build reads ${BACKUP_VERSION}). Update the app, then import it.`,
      };
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
      // RECENT_KEY was exported and then silently refused here, which is the
      // worst of both: it took up room in the file and was thrown away on
      // arrival. It is small, it is yours, and a restored phone that has
      // forgotten every search you ever ran is a restored phone that feels
      // like somebody else's.
      if (
        k === BOARDS_KEY ||
        k === TRIP_KEY ||
        k === STORAGE_KEY ||
        k === PEOPLE_KEY ||
        k === NOTIFY_KEY ||
        k === RECENT_KEY ||
        /^board:/.test(k) ||
        /^scotland-trip-|^trip-plan-/.test(k)
      ) {
        if (k === TRIP_KEY) {
          try {
            const restored = JSON.parse(parsed.data[k]) || {};
            if (localSettings.geminiKey) restored.geminiKey = localSettings.geminiKey;
            if (localSettings.googleKey) restored.googleKey = localSettings.googleKey;
            store(k, JSON.stringify(restored));
            return;
          } catch (e) {
            /* fall through to a plain restore */
          }
        }
        store(k, parsed.data[k]);
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
          <button class="modal-close" data-close="1" aria-label="Close">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
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
                      ${b.id === state.activeId ? `<span class="board-row-tick">${icon('check', { size: 16, cls: 'ico-inline' })}</span>` : ""}
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
    makeSheetDraggable(placeModal, closePlaceModal);

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
          <button class="modal-close" data-close="1" aria-label="Close">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
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
    makeSheetDraggable(placeModal, closePlaceModal);

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
          <button class="modal-close" data-close="1" aria-label="Close">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
          <div class="modal-body">
            <h2 class="modal-title">Settings</h2>

            <label class="settings-label" for="setDestination">Search region</label>
            <input class="settings-input" type="text" id="setDestination" value="${esc(s.destination)}"
                   placeholder="e.g. Cornwall — blank to search worldwide" />
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

            <label class="settings-label">Who's travelling</label>
            <p class="settings-hint">
              An age and a couple of facts are enough. It changes what gets suggested,
              warns when somewhere is a long sit-down for a three-year-old, notices when
              a stop lands in the middle of a nap, and splits the budget properly.
            </p>
            <div id="peopleList">${peopleRows()}</div>
            <button class="modal-btn" id="addPersonBtn" style="width:100%;margin-top:10px;">＋ Add someone</button>
            ${
              loadPeople().length
                ? `<p class="settings-hint" style="margin-top:10px;"><b>Prompts will say:</b> ${esc(whoDescription())}</p>`
                : `<label class="settings-label" for="setTravellers" style="margin-top:14px;">Or just describe it</label>
                   <input class="settings-input" type="text" id="setTravellers" value="${esc(s.travellers)}"
                          placeholder="e.g. family of 3, 4-year-old who walks" />
                   <p class="settings-hint">Fine for the AI, but a list above is what the rest of it can actually use.</p>`
            }

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
              <button class="modal-btn modal-btn-primary" id="downloadTilesBtn">${icon('download', { size: 17, cls: 'ico-inline' })} Download map area</button>
              <button class="modal-btn" id="clearTilesBtn">Clear</button>
            </div>
            <pre class="settings-result" id="tileResult" hidden></pre>

            <div class="settings-divider"></div>

            <label class="settings-label">Reminders</label>
            ${
              notificationsPossible()
                ? `<p class="settings-hint">
                     Worked out from your plan on this phone and nothing else — they fire
                     with no signal, and nothing is sent anywhere. Off unless you turn them on.
                   </p>
                   <label class="settings-toggle">
                     <input type="checkbox" id="notifyOn"${loadNotifySettings().enabled ? " checked" : ""} />
                     <span>Remind me about the day</span>
                   </label>
                   <div id="notifyDetail"${loadNotifySettings().enabled ? "" : " hidden"}>
                     <label class="settings-toggle">
                       <input type="checkbox" id="notifyLeave"${loadNotifySettings().leave ? " checked" : ""} />
                       <span>Time to leave for the next stop</span>
                     </label>
                     <label class="settings-toggle">
                       <input type="checkbox" id="notifyRain"${loadNotifySettings().rain ? " checked" : ""} />
                       <span>Rain on a day you'll be outdoors</span>
                     </label>
                     <label class="settings-toggle">
                       <input type="checkbox" id="notifyClosing"${loadNotifySettings().closing ? " checked" : ""} />
                       <span>Somewhere is closing soon</span>
                     </label>
                     <label class="settings-check">
                       <input type="checkbox" id="notifyBooking"${loadNotifySettings().booking ? " checked" : ""} />
                       <span>An event needs booking</span>
                     </label>
                     <label class="settings-label" for="notifyMorning" style="margin-top:10px;">Morning brief at</label>
                     <input type="time" id="notifyMorning" class="settings-input" value="${esc(loadNotifySettings().morning)}" />
                   </div>
                   <pre class="settings-result" id="notifyResult" hidden></pre>`
                : `<p class="settings-hint">
                     Reminders need the installed app — a browser tab cannot wake itself up
                     to tell you a castle shuts in forty-five minutes.
                   </p>`
            }

            <div class="settings-divider"></div>

            <label class="settings-label">Backup</label>
            <p class="settings-hint">
              Everything is stored only on this phone. ${
                notificationsPossible()
                  ? `The app saves a copy into your Documents folder once a day by itself, keeping
                     the last ${AUTO_BACKUP_KEEP} — that survives the app being uninstalled, but not a lost phone.`
                  : ""
              }
              Export a copy you can keep or send to another device — a reinstall or a lost
              phone loses the lot otherwise. API keys are deliberately left out of the file,
              so it's safe to send; you'll enter the key again on the other device.
            </p>
            <p class="settings-hint${backupIsOverdue() ? " backup-overdue" : ""}"><b>${esc(backupAgeLine())}</b></p>
            <div class="settings-btn-row">
              <button class="modal-btn${backupIsOverdue() ? " modal-btn-primary" : ""}" id="exportBackupBtn">⬇ Export</button>
              <button class="modal-btn" id="importBackupBtn">${icon('upload', { size: 17, cls: 'ico-inline' })} Import</button>
            </div>

            <div class="settings-divider"></div>

            <label class="settings-label">Calendar</label>
            <p class="settings-hint">
              Your dated days as calendar entries, so anyone who wants to know what
              Tuesday looks like can see it without this app. A stop with a time gets
              an hour; one without becomes an all-day entry.
            </p>
            <button class="modal-btn" id="exportIcsBtn" style="width:100%;">${icon('download', { size: 17, cls: 'ico-inline' })} Export to calendar</button>
            <pre class="settings-result" id="icsResult" hidden></pre>
${(() => {
  const pending = eventsNeedingBackfill().length;
  if (!pending) return "";
  return `
            <label class="settings-label">Events saved earlier</label>
            <p class="settings-hint">
              ${pending} saved event${pending === 1 ? "" : "s"} ${pending === 1 ? "was" : "were"} saved before the app
              started asking whether things are indoors, what ages they suit and whether they need
              booking. This asks about ${pending === 1 ? "it" : "them"} in one go. It only fills in
              blanks — anything already answered is left exactly as it is, and it never touches a
              name, a date or a location.
            </p>
            <button class="modal-btn" id="backfillEventsBtn" style="width:100%;">${icon("sparkle", {
              size: 17,
              cls: "ico-inline",
            })} Fill in what's missing</button>
            <pre class="settings-result" id="backfillResult" hidden></pre>`;
})()}
            <input type="file" id="importBackupFile" accept="application/json,.json" hidden />
            <pre class="settings-result" id="backupResult" hidden></pre>

            <button class="modal-btn modal-btn-primary" id="saveSettings">Save</button>
          </div>
        </div>
      </div>
    `;
    placeModal.classList.add("open");
    makeSheetDraggable(placeModal, closePlaceModal);
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
      const [n, bytes] = await Promise.all([countTiles(), tilesBytes()]);
      if (!tileCountEl) return;
      tileCountEl.textContent = n
        ? `${formatBytes(bytes)} of map stored on this phone — it works with no signal.`
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

    // ---- Who's travelling ----
    // The list redraws itself rather than the whole sheet, so a half-typed
    // name is not thrown away every time a checkbox is ticked.
    const peopleList = document.getElementById("peopleList");
    const redrawPeople = () => {
      if (!peopleList) return;
      peopleList.innerHTML = peopleRows();
      wirePeople();
    };

    function wirePeople() {
      if (!peopleList) return;
      peopleList.querySelectorAll("[data-person-field]").forEach((el) => {
        const commit = () => {
          const list = loadPeople();
          const person = list[Number(el.getAttribute("data-person"))];
          if (!person) return;
          const field = el.getAttribute("data-person-field");
          if (el.type === "checkbox") person[field] = el.checked;
          else if (field === "age") {
            const n = Number(el.value);
            person.age = el.value.trim() === "" || !Number.isFinite(n) ? null : Math.max(0, Math.min(120, n));
          } else person[field] = el.value;
          savePeople(list);
        };
        // Saved on every keystroke, not on blur. Saving costs nothing here -
        // commit writes to storage and does not redraw, so it cannot interrupt
        // typing - and blur is not reliably what happens next: typing an age
        // and then closing the sheet removes a focused element, which fires no
        // blur at all, and the age was simply gone.
        el.addEventListener(el.type === "checkbox" ? "change" : "input", commit);
        // Two fields decide whether other fields exist: ticking "naps" reveals
        // the nap times, and an age under 16 reveals a bedtime. Those need a
        // redraw, which commit deliberately does not do. The value is already
        // saved by the line above, so redrawing here cannot lose anything -
        // and for the age it is hung on "change", which fires when focus is
        // leaving anyway rather than on every keystroke.
        const field = el.getAttribute("data-person-field");
        if (field === "naps") el.addEventListener("change", redrawPeople);
        if (field === "age") el.addEventListener("change", () => { commit(); redrawPeople(); });
      });
      peopleList.querySelectorAll("[data-remove-person]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const list = loadPeople();
          list.splice(Number(btn.getAttribute("data-remove-person")), 1);
          savePeople(list);
          redrawPeople();
        });
      });
    }
    wirePeople();

    const addPerson = document.getElementById("addPersonBtn");
    if (addPerson) {
      addPerson.addEventListener("click", () => {
        const list = loadPeople();
        list.push({
          name: "", age: null,
          naps: false, napFrom: "", napTo: "", bedtime: "",
          buggy: false, mobility: false, diet: "",
        });
        savePeople(list);
        redrawPeople();
        const last = peopleList && peopleList.querySelector(".person-row:last-child .person-name");
        if (last) last.focus();
      });
    }

    // ---- Reminders ----
    const notifyOn = document.getElementById("notifyOn");
    const notifyDetail = document.getElementById("notifyDetail");
    const notifyResult = document.getElementById("notifyResult");
    const sayNotify = (text) => {
      if (!notifyResult) return;
      notifyResult.hidden = false;
      notifyResult.className = "settings-result ok";
      notifyResult.textContent = text;
    };
    const countScheduled = () => {
      const n = plannedNotifications().length;
      return n
        ? `${n} reminder${n === 1 ? "" : "s"} set from your plan.`
        : "Nothing to remind you about yet — reminders come from the days in your plan.";
    };

    if (notifyOn) {
      notifyOn.addEventListener("change", async () => {
        if (notifyOn.checked) {
          // Asked for at the moment it is wanted, rather than on first launch
          // when nobody knows what they are agreeing to.
          const granted = await askForNotificationPermission();
          if (!granted) {
            notifyOn.checked = false;
            sayNotify("Android turned that down. Reminders need notification permission, which you can grant in the phone's app settings.");
            return;
          }
          saveNotifySettings({ enabled: true });
          if (notifyDetail) notifyDetail.hidden = false;
          await rescheduleNotifications(true);
          sayNotify(countScheduled());
        } else {
          saveNotifySettings({ enabled: false });
          if (notifyDetail) notifyDetail.hidden = true;
          await cancelAllNotifications();
          sayNotify("Reminders off. Nothing is scheduled.");
        }
      });
    }

    [
      ["notifyLeave", "leave"],
      ["notifyRain", "rain"],
      ["notifyClosing", "closing"],
      ["notifyBooking", "booking"],
    ].forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", async () => {
        saveNotifySettings({ [key]: el.checked });
        await rescheduleNotifications(true);
        sayNotify(countScheduled());
      });
    });

    const notifyMorning = document.getElementById("notifyMorning");
    if (notifyMorning) {
      notifyMorning.addEventListener("change", async () => {
        saveNotifySettings({ morning: notifyMorning.value || "07:30" });
        await rescheduleNotifications(true);
        sayNotify(countScheduled());
      });
    }

    const icsBtn = document.getElementById("exportIcsBtn");
    if (icsBtn) {
      icsBtn.addEventListener("click", () => {
        const res = exportTripIcs();
        const out = document.getElementById("icsResult");
        if (!out) return;
        out.hidden = false;
        out.className = "settings-result " + (res.ok ? "ok" : "bad");
        out.textContent = res.message;
      });
    }

    const backfillBtn = document.getElementById("backfillEventsBtn");
    if (backfillBtn) {
      backfillBtn.addEventListener("click", async () => {
        const out = document.getElementById("backfillResult");
        backfillBtn.disabled = true;
        backfillBtn.textContent = "Asking…";
        if (out) {
          out.hidden = false;
          out.className = "settings-result";
          out.textContent = "Asking about the events you've saved…";
        }
        const res = await backfillEvents();
        backfillBtn.disabled = false;
        backfillBtn.textContent = "Fill in what's missing";
        if (out) {
          out.className = "settings-result " + (res.ok ? "ok" : "bad");
          out.textContent = res.message;
        }
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
          showView(view.dataset.activeTab || "picks");
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
        // The box is only rendered when there is no people list, so this is
        // its current value or whatever was there before - never blank
        // because the field happened not to be on screen.
        travellers: (document.getElementById("setTravellers") || { value: loadTripSettings().travellers }).value,
        preferences: document.getElementById("setPreferences").value.trim(),
      });
      closePlaceModal();
      showView(view.dataset.activeTab || "picks");
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
  // Answers true when it has put a question on screen and is waiting for it
  // to be answered. Callers that opened a sheet of their own need to know:
  // the folder question takes over the same modal, so closing it would shut
  // the question before it was read - but when nothing is asked, leaving the
  // sheet open strands the user on a screen they have finished with.
  //
  // This only surfaced when the default board went down to one folder. With
  // three, there was always a choice, so a question was always asked and the
  // sheet always got replaced.
  function quickAdd(candidate, opts) {
    const options = opts || {};

    // An area is its own section, so there has never been a folder question
    // to ask about one.
    if (options.major) {
      confirmAddCandidate(candidate, candidate.name, { major: true });
      afterSaveRefresh();
      toast(`Added “${candidate.name}” as an area`);
      return false;
    }

    const commit = (label) => {
      confirmAddCandidate(candidate, label.folder, { major: label.major });
      const id = pickId("custom", candidate.name);
      if (!label.major) updatePick(id, { kind: label.kind });
      afterSaveRefresh();
      return id;
    };

    const suggested = candidate.lat != null ? suggestedFolderFor(candidate.lat, candidate.lon) : null;
    // The candidate's own kind wins when it has one. Without this the guess
    // ran on category and description alone, decided an event was a place,
    // and wrote that over the kind confirmAddCandidate had just set - so
    // every event saved itself and immediately stopped being one.
    const guessedKind =
      candidate.kind === "event"
        ? "event"
        : pickKind({ category: candidate.category || candidate.type, description: candidate.description });

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
      return true;
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
    // Filed without asking anything, so nothing is waiting on screen.
    return false;
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
            <button class="modal-close" data-close="1" aria-label="Close">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
            <div class="modal-body">
              <h2 class="modal-title">${esc(opts.name)}</h2>
              ${opts.subtitle ? `<div class="modal-subtitle">${esc(opts.subtitle)}</div>` : ""}

              <label class="settings-label">What is it</label>
              <div class="move-row">
                <button class="move-chip${state.major ? "" : " active"}" data-label-major="0">${icon('pin', { size: 15, cls: 'ico-inline' })} Somewhere to go</button>
                <button class="move-chip${state.major ? " active" : ""}" data-label-major="1">${icon('globe', { size: 15, cls: 'ico-inline' })} A town or area</button>
              </div>

              ${
                // An area is its own section and appears in neither list, so
                // both of the questions below would be controls that do
                // nothing.
                state.major
                  ? `<p class="settings-hint">It will head its own section, and places you save nearby get filed under it.</p>`
                  : `
              ${
                // An event is what it is because of its date, not because of
                // a choice made here. Offering "To do or Eat" would be a
                // control whose only effect is to stop it being an event.
                state.kind === "event"
                  ? `<p class="settings-hint">Saved as something that's on, and it goes in the day it falls on.</p>`
                  : `
              <label class="settings-label">Shows up in</label>
              <div class="move-row">
                <button class="move-chip${state.kind === "place" ? " active" : ""}" data-label-kind="place">${icon('castle', { size: 17, cls: 'ico-inline' })} To do</button>
                <button class="move-chip${state.kind === "eat" ? " active" : ""}" data-label-kind="eat">${icon('food', { size: 17, cls: 'ico-inline' })} Eat</button>
              </div>`
              }

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
    makeSheetDraggable(placeModal, closePlaceModal);

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
          <button class="modal-close" data-close="1" aria-label="Close">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
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
    makeSheetDraggable(placeModal, closePlaceModal);

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
          <button class="modal-close" data-close="1" aria-label="Close">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
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
    makeSheetDraggable(placeModal, closePlaceModal);

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
    // Every confirmation in the app comes through here, which makes this the
    // one place worth wiring a haptic to: you feel the save rather than
    // having to look up and read that it happened.
    tapFeedback("light");
    clearToastTimer();
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  }

  // ---------- Views ----------

  // ---------- Trip ----------
  // The front page of whichever board is open. It used to describe the
  // bundled Scotland trip and nothing else, so it was wrong on every other
  // board; it now summarises the board's own places, days and costs, with
  // the Scotland briefing kept only on the board it belongs to.
  function formatBoardShareText() {
    const board = activeBoard();
    const plan = loadPlan();
    const picks = loadPicks();
    const byId = {};
    picks.forEach((p) => (byId[p.id] = p));

    const planned = Object.values(plan.items || {}).some((l) => (l || []).length);

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


  // ---------- For kids ----------
  // The Trip tab counted things - places saved, days planned, how many were
  // scheduled - which is information you already have on the screens where it
  // matters. It went where the tab that replaced it is now needed: with a
  // small child, the question is never "how many places have I saved", it is
  // "where can they run about" or "what do we do now it is raining", and the
  // answer was scattered through a list of forty places with the castles.
  //
  // A place is marked for kids and appears here. Some mark themselves - a
  // playground is not ambiguous - and the rest is a tap on the place's own
  // sheet, because a four-year-old's opinion of a cathedral is not something
  // the app can work out.
  const KID_CATEGORIES = [
    "playground", "park", "zoo", "aquarium", "farm", "soft play", "softplay",
    "swimming", "pool", "beach", "museum", "adventure", "theme park", "garden",
  ];

  // What the app can tell on its own. Anything else is a decision, and a
  // decision it would get wrong: a castle can be the best day of the week or
  // an hour of being carried, and only you know which.
  function looksLikeKidPlace(pick) {
    const hay = `${pick.category || ""} ${pick.type || ""} ${pick.description || ""}`.toLowerCase();
    return KID_CATEGORIES.some((word) => hay.includes(word));
  }

  function isForKids(pick) {
    if (pick.forKids === true) return true;
    if (pick.forKids === false) return false; // said no explicitly
    return looksLikeKidPlace(pick);
  }

  function setForKids(id, on) {
    updatePick(id, { forKids: !!on });
  }

  // Ways to find more, phrased as the thing you actually want rather than as a
  // category. Each one runs the ordinary search, so everything the search
  // screen does - the area it is anchored to, saving, putting on a day -
  // works from here without being built twice.
  const KID_SEARCHES = [
    { icon: "🛝", label: "Playground", query: "playground with something for a young child" },
    { icon: "🧸", label: "Soft play", query: "indoor soft play or play barn for young children" },
    { icon: "🌧️", label: "If it rains", query: "indoors and good with a young child on a wet day" },
    { icon: "🐑", label: "Animals", query: "farm, animal park or aquarium a young child would like" },
    { icon: "🏊", label: "Swimming", query: "swimming pool with a shallow or toddler pool" },
    { icon: "🍦", label: "Ice cream", query: "ice cream worth stopping for" },
    { icon: "🍽️", label: "Eat with kids", query: "somewhere to eat that genuinely welcomes young children" },
    { icon: "🚻", label: "Baby change", query: "toilets with baby changing facilities" },
  ];

  // "a young child" is what the app said when it did not know. It does know
  // now, if anybody has been added, and "a 3-year-old" gets a noticeably
  // different answer to "a 9-year-old" from the same question.
  function kidsTitle() {
    const kids = loadPeople().filter(isChild);
    const named = kids.map((k) => (k.name || "").trim()).filter(Boolean);
    if (named.length === 1) return `For ${named[0]}`;
    if (named.length === 2) return `For ${named[0]} and ${named[1]}`;
    return "For the kids";
  }

  function forOurKids(query) {
    const ages = loadPeople()
      .filter(isChild)
      .map((p) => p.age)
      .filter((a) => a != null)
      .sort((a, b) => a - b);
    if (!ages.length) return query;
    const said =
      ages.length === 1
        ? `a ${ages[0]}-year-old`
        : `children aged ${ages.join(" and ")}`;
    return query
      .replace(/a young child|young children/g, said)
      .replace(/young children/g, said);
  }

  function renderKids() {
    const picks = loadPicks().filter((p) => !p.major);
    const mine = picks.filter(isForKids);
    const plan = loadPlan();
    const onDays = {};
    Object.keys(plan.items || {}).forEach((dayId) =>
      (plan.items[dayId] || []).forEach((it) => {
        onDays[it.pickId] = onDays[it.pickId] || [];
        const day = plan.days.find((d) => d.id === dayId);
        if (day) onDays[it.pickId].push(shortDayLabel(day.label));
      })
    );

    let html = `
      <div class="kids-head">
        <h1 class="kids-title">${esc(kidsTitle())}</h1>
        <p class="kids-sub">${
          mine.length
            ? `${mine.length} place${mine.length === 1 ? "" : "s"} they'll actually enjoy`
            : "Nothing marked yet — anything you mark shows up here"
        }</p>
      </div>

      <div class="section-label">Find something</div>
      <div class="kids-finds">
        ${KID_SEARCHES.map(
          (k) =>
            `<button class="kids-find" data-kid-search="${esc(forOurKids(k.query))}">
               <span class="kids-find-icon">${k.icon}</span>
               <span class="kids-find-label">${esc(k.label)}</span>
             </button>`
        ).join("")}
      </div>
    `;

    if (!mine.length) {
      html += `
        <div class="card empty-state">
          <div class="empty-icon">🧸</div>
          <h2>Nothing marked for the kids yet</h2>
          <ul class="empty-list">
            <li><b>Tap a search above</b> — anything you save from it lands here</li>
            <li><b>Or open a saved place</b> and tap <b>One for the kids</b></li>
          </ul>
          <p class="settings-hint">Playgrounds, farms and pools mark themselves.</p>
        </div>
      `;
      view.innerHTML = html;
      wireKids();
      return;
    }

    // Ordered by the same control as Picks, for the same reason: this is the
    // same list of saved places, and having it arrange itself one way here and
    // another way there is most of what made the two screens hard to read
    // against each other. It was always nearest-first, from an origin nothing
    // on screen named.
    const sortKey = mine.length > 2 ? loadSort() : "area";
    if (mine.length > 2) html += renderSortRow(sortKey);

    fetchMissingPhotos(mine, () => {
      if (view.dataset.activeTab === "kids") renderKids();
    });

    const kidSections = groupPicks(mine, sortKey);
    const kidCollapsed = loadCollapsed();
    html += foldAllBar(kidSections.map((x) => x.label));
    kidSections.forEach((s) => {
      const folded = kidCollapsed.includes(s.label);
      html += sectionHead(s.label, s.count, folded);
      if (folded) return;
      s.rows.forEach((r) => {
        const p = r.pick;
        const days = sortKey === "day" && !s.loose ? [] : onDays[p.id] || [];
        const meta = [r.meta, r.away].filter(Boolean).join(" · ");
        html += `
          <div class="swipeable">
            ${rowActions(p.id)}
          <div class="kids-row">
            ${photoBlock(p, "thumb")}
            <button class="kids-row-main" data-open-pick="${esc(p.id)}">
              <span class="kids-row-name">${esc(p.name)}</span>
              ${meta ? `<span class="kids-row-meta">${esc(meta)}</span>` : ""}
              ${
                days.length
                  ? `<span class="kids-row-days">${days
                      .map((d) => `<span class="row-badge day">${esc(d)}</span>`)
                      .join("")}</span>`
                  : ""
              }
            </button>
            <div class="kids-row-actions">
              <button class="search-around" data-kid-day="${esc(p.id)}" aria-label="Put ${esc(
                p.name
              )} on a day">${icon("calendarPlus", { size: 17 })}</button>
              <button class="search-around" data-kid-off="${esc(
                p.id
              )}" aria-label="Not one for the kids">${icon("close", { size: 17 })}</button>
            </div>
          </div>
          </div>
        `;
      });
    });

    view.innerHTML = html;
    wireKids();
  }

  function wireKids() {
    // These are one tap, not a head start on typing: the whole point is that
    // you press "If it rains" and get somewhere to go, so the search runs.
    view.querySelectorAll("[data-kid-search]").forEach((btn) =>
      btn.addEventListener("click", () => {
        openSearchOverlay(btn.getAttribute("data-kid-search"));
        runSearch(btn.getAttribute("data-kid-search"));
      })
    );
    // The same control as Picks, and the same saved choice - so the two
    // screens agree about what order this list is in.
    wireSortRow(renderKids);
    view.querySelectorAll("[data-open-pick]").forEach((btn) =>
      btn.addEventListener("click", () => openPickDetail(btn.getAttribute("data-open-pick")))
    );
    view.querySelectorAll("[data-kid-day]").forEach((btn) =>
      btn.addEventListener("click", () => openDaySheet(btn.getAttribute("data-kid-day"), { onDone: renderKids }))
    );
    view.querySelectorAll("[data-kid-off]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-kid-off");
        const pick = loadPicks().find((p) => p.id === id);
        setForKids(id, false);
        renderKids();
        if (pick) {
          toastWithAction(`${pick.name} taken off the kids list`, "Undo", () => {
            setForKids(id, true);
            renderKids();
          });
        }
      })
    );
  }

  // ---------- Itinerary planner ----------
  // Your own schedule, built from whatever you have saved in Picks. Every
  // board starts with no days at all and you name your own.
  const PLAN_KEY = "trip-plan-v1";


  function loadPlan() {
    const board = activeBoard();
    const stored = readJson(boardKey(board.id, "plan"), null);
    if (stored && Array.isArray(stored.days)) return stored;
    return { days: [], items: {} };
  }

  function savePlan(plan) {
    store(boardKey(activeBoard().id, "plan"), JSON.stringify(plan));
    // Reminders are worked out from the plan, so the plan changing is the one
    // event that always invalidates them. Debounced because dragging a stop
    // around a day writes it a dozen times in a second, and the fingerprint
    // check means an unchanged schedule costs nothing anyway.
    scheduleReschedule();
  }

  let rescheduleTimer = null;

  function scheduleReschedule() {
    if (!notificationsPossible()) return;
    clearTimeout(rescheduleTimer);
    rescheduleTimer = setTimeout(() => rescheduleNotifications(), 1200);
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
            <button class="modal-close" data-close="1" aria-label="Close">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
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
    makeSheetDraggable(placeModal, closePlaceModal);

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
            <span class="planner-area-tick">${on === list.length ? icon("check", { size: 15 }) : on ? "–" : ""}</span>
            <span class="planner-area-name">${esc(area)}</span>
            <span class="planner-area-count">${esc(String(on))}/${esc(String(list.length))}</span>
          </button>
          <div class="planner-places">
            ${list
              .map(
                (p) => `
                  <button class="planner-place${planner.selected[p.id] ? " on" : ""}" data-plan-pick="${esc(p.id)}">
                    <span class="planner-place-tick">${planner.selected[p.id] ? icon("check", { size: 15 }) : ""}</span>
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
              ? `<p class="planner-warn">${icon('alert', { size: 16, cls: 'ico-inline' })} ${esc(check.problems.join(", and "))}. Worth moving something.</p>`
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
        <button class="search-back" data-plan-close="1" aria-label="Close">${icon('back', { size: 20, cls: 'ico-inline' })}</button>
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
    // The model is asked for exact names and mostly gives them, but it also
    // drops a "The", writes "Edinburgh Castle" for "Edinburgh Castle & Museum",
    // or adds the town. Matching on the exact string meant one paraphrase threw
    // away the entire plan and the screen said it could not be read - which is
    // both wrong and impossible to act on.
    const flatten = (s) =>
      String(s || "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9 ]+/g, " ")
        .replace(/^\s*the\s+/, "")
        .replace(/\s+/g, " ")
        .trim();
    const words = (s) => flatten(s).split(" ").filter((w) => w.length > 3);

    const byName = {};
    picks.forEach((p) => (byName[flatten(p.name)] = p));

    const unmatched = [];
    const find = (name) => {
      const key = flatten(name);
      if (!key) return null;
      if (byName[key]) return byName[key];

      // One name inside the other: "Blair Castle" for "Blair Castle and
      // Gardens", or the town appended.
      const contained = picks.find((p) => {
        const other = flatten(p.name);
        return other.includes(key) || key.includes(other);
      });
      if (contained) return contained;

      // Otherwise the substantial words have to agree - every one of the
      // shorter name's, and at least two of them. One word in common is not a
      // match: "Edinburgh Zoo" and "Edinburgh Castle" share "edinburgh" and
      // are not the same place, and scheduling one for the other would be
      // worse than admitting the name is unknown.
      const mine = words(name);
      if (mine.length > 1) {
        const overlap = picks.find((p) => {
          const theirs = words(p.name);
          if (theirs.length < 2) return false;
          const shorter = mine.length <= theirs.length ? mine : theirs;
          const longer = shorter === mine ? theirs : mine;
          return shorter.every((w) => longer.includes(w));
        });
        if (overlap) return overlap;
      }

      if (name) unmatched.push(String(name));
      return null;
    };

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

    if (!outDays.length && !trips.length) {
      // Nothing matched is a different failure from nothing sent, and the
      // difference is the only thing worth telling anyone.
      return unmatched.length ? { unmatched: unmatched.slice(0, 6) } : null;
    }
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
      const { text } = await callGemini(key, plannerPrompt(picks, days), { json: true, maxTokens: 8192 });
      if (!planner) return;
      planner.raw = text;
      const result = normalisePlannerResult(extractJson(text), picks, days);
      if (result && result.unmatched) {
        throw new Error(
          `It planned places that aren't in your list - ${result.unmatched.join(", ")} - so nothing could be scheduled. Try again, or plan fewer at once.`
        );
      }
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

  // ---------- Opening hours, properly ----------
  // This used to be ~100 lines of hand-rolled regex that deliberately refused
  // most of the OSM opening_hours syntax: anything with public holidays,
  // seasonal ranges, "sunrise-sunset" or a quoted comment was waved through as
  // "no idea", because a wrong "closed" sends you away from somewhere that was
  // open. That timidity was right, and it also meant the app said nothing
  // about a great many places whose hours were perfectly well specified.
  //
  // opening_hours.js is the reference implementation of that syntax. It knows
  // seasons, holidays per country, and that "sunrise-sunset" needs the sun's
  // actual position at this latitude on this date.
  //
  // Three things matter in using it:
  //   - It has a third state. getState() false plus getUnknown() true means
  //     "there is a comment here, nobody can say" - NOT closed. Reading only
  //     getState() would reintroduce exactly the wrong-closed bug, on a string
  //     the old code refused outright.
  //   - It throws on syntax it cannot parse, and on "PH" with no country. Both
  //     are caught, and both mean the same thing as before: say nothing.
  //   - Warnings mean it guessed. A guess is not good enough to send somebody
  //     somewhere else, so a warning is also silence.
  function openingHoursLib() {
    return typeof window !== "undefined" && window.opening_hours ? window.opening_hours : null;
  }

  // Holiday rules need to know whose holidays. Nominatim tells us, when the
  // place came from there; without it the PH rule is dropped rather than
  // failing the whole string.
  function hoursContextFor(pick) {
    const ctx = {};
    if (pick && pick.lat != null) {
      ctx.lat = pick.lat;
      ctx.lon = pick.lon;
    }
    const cc = pick && pick.countryCode;
    if (cc) {
      ctx.address = { country_code: cc };
      if (pick.state) ctx.address.state = pick.state;
    }
    return ctx;
  }

  const hoursCache = new Map();

  function parsedHours(pick) {
    const OH = openingHoursLib();
    const raw = pick && pick.openingHours ? String(pick.openingHours).trim() : "";
    if (!OH || !raw) return null;

    const key = `${raw}|${(pick && pick.countryCode) || ""}|${(pick && pick.state) || ""}`;
    if (hoursCache.has(key)) return hoursCache.get(key);

    const build = (text, ctx) => {
      const oh = new OH(text, ctx);
      // A warning means it understood something, but not confidently.
      const warnings = typeof oh.getWarnings === "function" ? oh.getWarnings() : [];
      if (warnings && warnings.length) return null;
      return oh;
    };

    let result = null;
    try {
      result = build(raw, hoursContextFor(pick));
    } catch (e) {
      // Overwhelmingly this is "PH used without a country". Dropping the
      // holiday clause keeps the ordinary week, which is most of the value.
      const withoutHolidays = raw
        .split(";")
        .filter((rule) => !/\b(PH|SH)\b/.test(rule))
        .join(";")
        .trim();
      if (withoutHolidays && withoutHolidays !== raw) {
        try {
          result = build(withoutHolidays, hoursContextFor(pick));
        } catch (e2) {
          result = null;
        }
      }
    }
    hoursCache.set(key, result);
    return result;
  }

  // The one function the screens ask. Everything it can answer is a fact about
  // a moment in time; `known: false` is a perfectly good answer and the most
  // common one.
  function hoursAt(pick, when) {
    const oh = parsedHours(pick);
    if (!oh) return { known: false };
    const at = when || new Date();
    try {
      if (typeof oh.getUnknown === "function" && oh.getUnknown(at)) {
        const comment = typeof oh.getComment === "function" ? oh.getComment(at) : "";
        return { known: false, comment: comment || "" };
      }
      const open = !!oh.getState(at);
      const change = typeof oh.getNextChange === "function" ? oh.getNextChange(at) : null;
      return {
        known: true,
        open,
        // When it shuts, if it is open; when it opens, if it is not.
        change: change instanceof Date && !Number.isNaN(change.getTime()) ? change : null,
      };
    } catch (e) {
      return { known: false };
    }
  }

  function clockOf(date) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  // "Is it shut all day on this day of the week." The library thinks in
  // moments, so this asks it about the whole day: shut at every hour it is
  // asked about means shut. Returns null when it cannot say, and the caller
  // falls back to the old reading.
  function closedOnDayViaLib(openingHours, dayCode, pick) {
    const at = { openingHours, lat: pick && pick.lat, lon: pick && pick.lon,
      countryCode: pick && pick.countryCode, state: pick && pick.state };
    if (!parsedHours(at)) return null;
    const index = DAY_NAMES.indexOf(dayCode);
    if (index < 0) return null;

    // The next occurrence of that weekday, so seasonal rules are asked about a
    // real date rather than an abstract "Tuesday".
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + ((index - day.getDay() + 7) % 7));

    for (let hour = 6; hour <= 22; hour++) {
      const probe = new Date(day);
      probe.setHours(hour, 0, 0, 0);
      const verdict = hoursAt(at, probe);
      if (!verdict.known) return null; // one unknown hour and the day is unknown
      if (verdict.open) return false;
    }
    return true;
  }

  // The last time it shuts on that day. Walks the evening backwards looking
  // for the moment it stops being open, which is what "closes at" means to
  // somebody standing outside it.
  function closingViaLib(openingHours, dayCode, pick) {
    const at = { openingHours, lat: pick && pick.lat, lon: pick && pick.lon,
      countryCode: pick && pick.countryCode, state: pick && pick.state };
    if (!parsedHours(at)) return null;
    const index = DAY_NAMES.indexOf(dayCode);
    if (index < 0) return null;

    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + ((index - day.getDay() + 7) % 7));

    // Somewhere open at midnight is a pub running past it, and "closes in 45
    // minutes" is not the useful thing to say about a pub.
    const endOfDay = new Date(day);
    endOfDay.setHours(23, 59, 0, 0);
    const midnight = hoursAt(at, endOfDay);
    if (!midnight.known) return null;
    if (midnight.open) return null;

    let last = null;
    for (let minutes = 6 * 60; minutes <= 23 * 60 + 59; minutes += 15) {
      const probe = new Date(day);
      probe.setHours(0, minutes, 0, 0);
      const verdict = hoursAt(at, probe);
      if (!verdict.known) return null;
      if (verdict.open) last = verdict.change;
    }
    if (!last) return null;
    // A change landing on the following day means it does not shut today.
    if (last.getDate() !== day.getDate()) return null;
    return last.getHours() * 60 + last.getMinutes();
  }

  // A deliberately conservative reading of OSM opening_hours: it only reports
  // a closure when the string clearly lists days and this day isn't among
  // them. Anything with holiday rules, seasonal ranges or syntax it doesn't
  // recognise is left alone, because a wrong "closed" warning is worse than
  // none - it would send you somewhere else for no reason.
  function closedOnDay(openingHours, dayCode, pick) {
    if (!openingHours || !dayCode) return false;
    // The library answers this properly when it is loaded, including the
    // seasonal and holiday rules the regex below refuses to look at.
    const lib = closedOnDayViaLib(openingHours, dayCode, pick);
    if (lib !== null) return lib;
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

  // The same conservatism, one step further: what time does it shut. Today
  // knew a castle was open on a Tuesday and said nothing at all about it
  // being seven in the evening and the castle shutting at five - which is the
  // version of that question you actually have while standing in a car park.
  //
  // Returns minutes past midnight, or null when the string is anything this
  // does not confidently understand. Null means "say nothing", which is the
  // right answer far more often than a guess would be.
  function closingMinutesOnDay(openingHours, dayCode, pick) {
    if (!openingHours || !dayCode) return null;
    const lib = closingViaLib(openingHours, dayCode, pick);
    if (lib !== null) return lib;
    const hours = openingHours.trim();
    if (/24\/7/i.test(hours)) return null;
    if (/PH|SH|easter|summer|winter|"/i.test(hours)) return null;
    if (closedOnDay(hours, dayCode)) return null;

    let best = null;
    hours.split(";").forEach((rule) => {
      if (/\boff\b/i.test(rule)) return;
      const dayPart = (rule.match(/^[\sA-Za-z,\-]+/) || [""])[0];
      const days = new Set();
      let sawDaySpec = false;
      const rangeRe = /(Mo|Tu|We|Th|Fr|Sa|Su)\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su)/gi;
      let m;
      while ((m = rangeRe.exec(dayPart))) {
        sawDaySpec = true;
        let i = DAY_NAMES.indexOf(m[1].slice(0, 2).replace(/^./, (c) => c.toUpperCase()));
        const end = DAY_NAMES.indexOf(m[2].slice(0, 2).replace(/^./, (c) => c.toUpperCase()));
        if (i < 0 || end < 0) continue;
        for (let guard = 0; guard < 8; guard++) {
          days.add(DAY_NAMES[i]);
          if (i === end) break;
          i = (i + 1) % 7;
        }
      }
      const singleRe = /\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/gi;
      while ((m = singleRe.exec(dayPart.replace(rangeRe, " ")))) {
        sawDaySpec = true;
        days.add(m[1].slice(0, 2).replace(/^./, (c) => c.toUpperCase()));
      }
      // A rule naming no days applies to every day; one naming days applies
      // only to those.
      if (sawDaySpec && !days.has(dayCode)) return;

      // The last closing time in the rule, so a place that shuts for lunch is
      // reported as closing in the evening rather than at noon.
      const timeRe = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g;
      let t;
      while ((t = timeRe.exec(rule))) {
        const close = Number(t[3]) * 60 + Number(t[4]);
        // A range crossing midnight is a pub, and "closes in 45 minutes" is
        // not the useful thing to say about a pub.
        const open = Number(t[1]) * 60 + Number(t[2]);
        if (close <= open) continue;
        if (best == null || close > best) best = close;
      }
    });
    return best;
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
    if (plan.days.length) {
      html += `<button class="hero-share" id="shareTrip" style="color:var(--navy);border-color:var(--line);background:var(--card);margin-bottom:14px;">${icon('share', { size: 17, cls: 'ico-inline' })} Share this plan</button>`;
    }

    // Where the two builders go depends on whether there is anything to look
    // at. With days on the board they are a tool you reach for occasionally,
    // and putting them first pushed the plan itself - the entire subject of
    // the screen - below the fold. With no days they are the only thing worth
    // showing, so they lead. Same card either way; only its position moves.
    const planBuilders = `
      <div class="card plan-ai-card">
        ${
          picks.length
            ? `<button class="plan-ai-btn" id="autoPlanBtn">${icon('sparkle', { size: 17, cls: 'ico-inline' })} Plan my days for me</button>
               <p class="settings-hint" style="text-align:center;">Choose which places - or a whole area - and see what fits before anything changes.</p>
`
            : `<p class="pick-status">Nothing saved yet — so there is nothing to arrange into days.</p>`
        }
        <button class="plan-ai-btn plan-idea-btn" id="tripIdeaBtn">${icon('directions', { size: 17, cls: 'ico-inline' })} Suggest a trip</button>
        <p class="settings-hint" style="text-align:center;">Say where you are and how far you'll go — you get whole routes back, with the stops already in order.</p>
      </div>
    `;
    if (!plan.days.length) html += planBuilders;

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
            <button class="plan-day-remove" data-remove-day="${esc(day.id)}" aria-label="Remove day">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
          </div>
          ${weatherLine(forecast, { quiet: true })}
          ${daylightLine(dateForDayLabel(day.label), dayWeatherAnchor(day.id))}
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

        const mayBeClosed = closedOnDay(p.openingHours, dayCode, p);
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
                  ? `<div class="plan-warn">${icon('alert', { size: 15, cls: 'ico-inline' })} May be closed this day — hours say "${esc(p.openingHours)}". Check before going.</div>`
                  : ""
              }
              ${napWarning(it.time)}
              ${childWarning(p)}
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
              <button data-plan-remove="${esc(day.id)}|${esc(it.pickId)}" aria-label="Remove">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
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

    // Below the plan, under a heading that says what they are for. Above it
    // they read as the first step even when the plan is finished.
    if (plan.days.length) {
      html += `<div class="section-label">Build it for me</div>` + planBuilders;
    }
    return html;
  }

  function wireMyPlan() {
    const share = document.getElementById("shareTrip");
    if (share) share.addEventListener("click", () => shareText(activeBoard().name, formatBoardShareText()));
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

  // There used to be two itineraries here behind a Suggested/My plan toggle,
  // because one board shipped with somebody's finished week in it. There is
  // one plan now, which is yours.
  function renderItinerary() {
    view.innerHTML = renderMyPlan();
    wireMyPlan();
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
  // Ordering used to be two systems fighting each other. Places were grouped
  // into sections by town, in whatever order the folders happened to be
  // created, and *then* sorted inside each section by a separate chip. So
  // "Nearest" meant nearest within a town, while the towns themselves sat in
  // an arbitrary order; "By day" scattered Monday's stops across five
  // sections; and the chip was a saved preference, so the list came back in a
  // different order from the one you left it in, for no visible reason.
  //
  // One control now, and the chosen order decides the sections as well as the
  // rows - so what you pick is what you see, top to bottom, with nothing else
  // quietly rearranging it underneath.
  const SORTS = [
    { key: "area", label: "By area", note: "Grouped by town, A–Z inside" },
    { key: "day", label: "By day", note: "In the order you'll do them" },
    { key: "near", label: "Nearest", note: "One list, closest first" },
    { key: "recent", label: "Just added", note: "One list, newest first" },
  ];

  let sortOpen = false;

  function loadSort() {
    const v = readJson(SORT_KEY, "area");
    // "name" was a mode of its own before ordering and grouping were the same
    // decision; it is how every grouped list is sorted inside a section now.
    if (v === "name") return "area";
    return SORTS.some((s) => s.key === v) ? v : "area";
  }

  function saveSort(key) {
    store(SORT_KEY, JSON.stringify(key));
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

  // ---------- One list, ordered one way ----------
  // Both Picks and Kids are a list of saved places, and both were arranging
  // them differently and badly. This is the single answer: given a list and a
  // chosen order, hand back the sections to draw, in the order to draw them.
  //
  // Two of the four modes have no sections at all, and that is the point - a
  // flat list is what "nearest" and "just added" mean. Cutting either into
  // towns would put a place 2 miles away below a heading three screens down.
  function groupPicks(list, mode, options) {
    const opts = options || {};
    const origin = mode === "near" ? opts.origin || sortOrigin() : null;
    const away = (p) =>
      origin && p.lat != null && p.id !== origin.id
        ? formatDistance(haversineKm(origin.lat, origin.lon, p.lat, p.lon))
        : null;
    const byName = (a, b) => a.name.localeCompare(b.name, "en-GB");

    if (mode === "near") {
      const sorted = list.slice().sort((a, b) => {
        // Somewhere with no coordinates is not nearby, it is unknown, so it
        // sinks rather than claiming a place in the order.
        if (a.lat == null) return b.lat == null ? byName(a, b) : 1;
        if (b.lat == null) return -1;
        return (
          haversineKm(origin.lat, origin.lon, a.lat, a.lon) -
          haversineKm(origin.lat, origin.lon, b.lat, b.lon)
        );
      });
      return [
        {
          label: origin ? `Closest to ${origin.name}` : "Closest first",
          count: sorted.length,
          rows: sorted.map((p) => ({ pick: p, away: away(p), meta: p.city })),
        },
      ];
    }

    if (mode === "recent") {
      const sorted = list.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      return [
        {
          label: "Newest first",
          count: sorted.length,
          rows: sorted.map((p) => ({ pick: p, meta: p.city })),
        },
      ];
    }

    if (mode === "day") {
      const plan = loadPlan();
      const placed = {};
      const sections = plan.days.map((d) => {
        const items = itemsInDayOrder(planItems(plan, d.id));
        const rows = [];
        items.forEach((it) => {
          const p = list.find((x) => x.id === it.pickId);
          if (!p) return;
          placed[p.id] = true;
          rows.push({ pick: p, meta: [it.time, p.city].filter(Boolean).join(" · ") });
        });
        return { label: shortDayLabel(d.label), full: d.label, count: rows.length, rows };
      });
      // Everything not on a day yet, last - which is where the work is, and
      // the reason to be on this screen at all.
      const loose = list.filter((p) => !placed[p.id]).sort(byName);
      if (loose.length) {
        sections.push({
          label: "Not on a day yet",
          count: loose.length,
          rows: loose.map((p) => ({ pick: p, meta: p.city })),
          loose: true,
        });
      }
      return sections.filter((s) => s.rows.length);
    }

    // By area. Sections follow the folders list so a renamed or reordered
    // folder stays put, then any town value predating folders, then Unsorted.
    const order = loadFolders().slice();
    list.forEach((p) => {
      if (p.city && !order.includes(p.city)) order.push(p.city);
    });
    order.push("Unsorted");
    const groups = {};
    order.forEach((c) => (groups[c] = []));
    list.forEach((p) => (groups[p.city] || groups.Unsorted).push(p));
    return order
      .filter((c) => groups[c] && groups[c].length)
      .map((c) => ({
        label: c,
        area: c,
        count: groups[c].length,
        rows: groups[c].sort(byName).map((p) => ({ pick: p, meta: p.category })),
      }));
  }

  // ---------- Folding a long list ----------
  // With five saved places the sections are a nicety. With fifty they are the
  // only thing between you and a scroll that never ends, so they fold - and
  // which ones you folded is remembered, because a list you have tidied
  // should stay tidy.
  function loadCollapsed() {
    const v = readJson(boardKey(activeBoard().id, "collapsed"), []);
    return Array.isArray(v) ? v : [];
  }

  function toggleCollapsed(label) {
    const list = loadCollapsed();
    const i = list.indexOf(label);
    if (i < 0) list.push(label);
    else list.splice(i, 1);
    store(boardKey(activeBoard().id, "collapsed"), JSON.stringify(list));
  }

  function setAllCollapsed(labels, collapsed) {
    store(boardKey(activeBoard().id, "collapsed"), JSON.stringify(collapsed ? labels : []));
  }

  // A heading you can fold, with the count still on it - the count is what
  // makes a folded section useful rather than just hidden.
  function sectionHead(label, count, folded) {
    return `
      <button class="section-label list-head section-fold${folded ? " folded" : ""}"
              data-fold="${esc(label)}" aria-expanded="${folded ? "false" : "true"}">
        <span class="fold-caret">${icon(folded ? "forward" : "down", { size: 15 })}</span>
        <span class="fold-label">${esc(label)}</span>
        <span class="list-head-count">${count}</span>
      </button>
    `;
  }

  // Only worth offering past the point where scrolling becomes the problem.
  function foldAllBar(labels) {
    if (labels.length < 3) return "";
    const collapsed = loadCollapsed();
    const allFolded = labels.every((l) => collapsed.includes(l));
    return `
      <div class="fold-all">
        <button class="link-btn" data-fold-all="${allFolded ? "open" : "close"}">
          ${allFolded ? "Open all" : "Fold all"}
        </button>
      </div>
    `;
  }

  // The control that chooses it. One row, always visible, always saying which
  // one is on - it was a saved preference with no label, so the list order
  // changed between visits with nothing on screen to explain why.
  // Folded to a single button that names the order it is in. The visibility
  // that rule was written for is kept - you can still read the current order
  // without tapping anything - it just no longer costs four chips and a
  // caption on a screen that already carries a search field, an explore row
  // and the kind filter above it.
  // Both Picks and Kids carry this control and share the saved choice, so
  // they share the wiring too. Picking an order folds the picker again: the
  // button then names what you just chose, which is the whole point of it.
  function wireSortRow(redraw) {
    const toggle = document.getElementById("sortToggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        sortOpen = true;
        redraw();
      });
    }
    view.querySelectorAll("[data-sort]").forEach((btn) =>
      btn.addEventListener("click", () => {
        saveSort(btn.getAttribute("data-sort"));
        sortOpen = false;
        redraw();
      })
    );
  }

  function renderSortRow(mode) {
    const current = SORTS.find((s) => s.key === mode) || SORTS[0];
    if (!sortOpen) {
      return `
        <div class="order-bar folded">
          <button class="order-toggle" id="sortToggle">
            ${icon("list", { size: 15, cls: "ico-inline" })} ${esc(current.label)}
          </button>
        </div>
      `;
    }
    return `
      <div class="order-bar">
        <div class="order-chips">
          ${SORTS.map(
            (s) =>
              `<button class="order-chip${s.key === mode ? " on" : ""}" data-sort="${s.key}">${esc(
                s.label
              )}</button>`
          ).join("")}
        </div>
        <p class="order-note">${esc(current.note)}</p>
      </div>
    `;
  }

  // renderPlaces / renderEats / renderPlaceTab lived here. They rendered the
  // same saved list the Picks tab does, filtered by kind, with their own
  // folder chips and sort row - a second and third implementation of one
  // screen. Picks absorbed the filter, the sorting and the guide, so they are
  // gone rather than left as an unreachable copy that drifts out of step.

  // ---------- Budget ----------
  // Was a fixed table of Scottish estimates that no board could edit and no
  // saved place appeared in. The real question is "what has this trip
  // committed me to", which only the places actually saved can answer - so
  // every place can carry a cost, and anything that isn't a place (trains,
  // the flat) goes in as its own line.
  function renderBudget() {
    const { places, trip, own, est } = budgetLines();
    const board = activeBoard();
    const priced = places.filter((l) => l.source !== "unknown");
    const unknown = places.filter((l) => l.source === "unknown");
    const ownTotal = own.reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const low = priced.reduce((a, l) => a + l.low, 0) + trip.reduce((a, l) => a + l.low, 0) + ownTotal;
    const high = priced.reduce((a, l) => a + l.high, 0) + trip.reduce((a, l) => a + l.high, 0) + ownTotal;
    const days = loadPlan().days.length;

    // The number, said as a range, because a single figure to the penny would
    // be a more confident claim than anything here can support.
    let html = `
      <div class="card budget-hero">
        <div class="budget-hero-total">${low === high ? money(low) : `${money(low)}–${money(high)}`}</div>
        <div class="budget-hero-sub">${
          !est && !priced.length && !own.length
            ? "Nothing costed yet"
            : `${[
                places.length
                  ? `${priced.length} of ${places.length} place${places.length === 1 ? "" : "s"} costed`
                  : "",
                trip.length ? "food, travel and beds" : "",
                own.length ? `${own.length} of your own` : "",
              ]
                .filter(Boolean)
                .join(" · ")}${
                // The middle of the range, not the top of it: quoting the
                // worst case as "a day" makes every trip look unaffordable.
                days ? ` · around ${money(Math.round((low + high) / 2 / days))} a day` : ""
              }`
        }</div>
        ${budgetSplitLine(low, high)}
      </div>
    `;

    if (!est) {
      html += `
        <div class="card">
          <h2>Let it work the trip out</h2>
          <p>It reads the places you've saved, the days you've planned and the driving between
             them, then estimates what the lot comes to for ${esc(
               whoDescription() || "your group"
             )}. Every line says where its number came from, and you can correct any of them.</p>
          <button class="modal-btn modal-btn-primary" id="budgetEstimate" style="width:100%;margin-top:12px;">${
            budgetWorking ? "Working it out…" : `${icon("sparkle", { size: 17, cls: "ico-inline" })} Cost my trip`
          }</button>
        </div>
      `;
    }

    // Tapping a line opens it for editing in place. No dialog: a browser
    // prompt() in a WebView is the app admitting it is a web page, which is
    // the whole thing we are trying to stop doing.
    const line = (l, kind, ref) => {
      const editing = budgetEditing === `${kind}:${ref}`;
      if (editing) {
        return `
          <div class="budget-line editing">
            <span class="budget-line-main">
              <span class="budget-line-name">${esc(l.name)}</span>
              <span class="budget-line-note">Your price, or empty for the estimate</span>
            </span>
            <span class="budget-line-right">
              <span class="budget-input-wrap">
                <span class="budget-currency">£</span>
                <input class="budget-input" type="number" inputmode="decimal" min="0" step="1"
                       value="${l.source === "yours" ? esc(String(l.low)) : ""}"
                       data-budget-edit="${esc(kind)}|${esc(String(ref))}"
                       aria-label="Your price for ${esc(l.name)}" />
              </span>
            </span>
          </div>
        `;
      }
      return `
        <button class="budget-line" data-budget-open="${esc(kind)}|${esc(String(ref))}">
          <span class="budget-line-main">
            <span class="budget-line-name">${esc(l.name)}</span>
            ${l.note ? `<span class="budget-line-note">${esc(l.note)}</span>` : ""}
          </span>
          <span class="budget-line-right">
            <span class="budget-line-amount">${
              l.source === "unknown" ? "—" : l.low === l.high ? money(l.low) : `${money(l.low)}–${money(l.high)}`
            }</span>
            <span class="budget-tag ${l.source}">${
              l.source === "yours" ? "yours" : l.source === "estimate" ? "est." : "tap to price"
            }</span>
          </span>
        </button>
      `;
    };

    if (trip.length) {
      html += `<div class="section-label list-head"><span>The trip itself</span></div><div class="card budget-card">`;
      trip.forEach((l) => (html += line(l, "trip", l.key)));
      html += `</div>`;
    }

    if (places.length) {
      html += `<div class="section-label list-head"><span>Places</span><span class="list-head-count">${places.length}</span></div>`;
      html += `<div class="card budget-card">`;
      priced.forEach((l) => (html += line(l, "pick", l.id)));
      if (unknown.length) {
        html += `<div class="budget-unknown-head">${unknown.length} not costed</div>`;
        unknown.forEach((l) => (html += line(l, "pick", l.id)));
      }
      html += `</div>`;
      if (est) {
        html += `<button class="modal-btn" id="budgetEstimate" style="width:100%;">${
          budgetWorking ? "Working it out…" : `${icon("refresh", { size: 16, cls: "ico-inline" })} Work it out again`
        }</button>`;
      }
    }

    html += `<div class="section-label list-head"><span>Anything else</span></div><div class="card budget-card">`;
    if (!own.length) {
      html += `<p class="pick-status">Ferries, a booking you've already paid for, whatever the app can't know about.</p>`;
    }
    own.forEach((r) => {
      const i = loadBudgetExtras().indexOf(r);
      html += `
        <div class="budget-row">
          <div class="budget-item">${esc(r.item)}</div>
          <div class="budget-input-wrap">
            <span class="budget-currency">£</span>
            <input class="budget-input" type="number" inputmode="decimal" min="0" step="1"
                   value="${esc(String(r.amount || ""))}" data-extra-amount="${i}" aria-label="Amount for ${esc(r.item)}" />
            <button class="budget-remove" data-extra-remove="${i}" aria-label="Remove ${esc(r.item)}">${icon("close", { size: 17 })}</button>
          </div>
        </div>
      `;
    });
    html += `
      <form class="budget-add" id="budgetAddForm">
        <input type="text" id="budgetAddItem" placeholder="e.g. ferry tickets" autocomplete="off" />
        <input type="number" id="budgetAddAmount" inputmode="decimal" min="0" step="1" placeholder="£" />
        <button type="submit" aria-label="Add cost">+</button>
      </form>
    </div>`;

    if (est) {
      html += `<p class="settings-hint">Estimated ${esc(
        daysAgoLabel(new Date(est.at))
      )} for ${esc(whoDescription() || "your group")}. Tap any line to put your own price on it.</p>`;
    }

    view.innerHTML = html;
    wireBudget();
  }

  function wireBudget() {
    const estimateBtn = document.getElementById("budgetEstimate");
    if (estimateBtn) estimateBtn.addEventListener("click", () => estimateBudget());

    // Tapping a line opens it; what you type there outranks anything
    // estimated, for that line only, and for good.
    view.querySelectorAll("[data-budget-open]").forEach((btn) =>
      btn.addEventListener("click", () => {
        budgetEditing = btn.getAttribute("data-budget-open").replace("|", ":");
        renderBudget();
        const input = view.querySelector("[data-budget-edit]");
        if (input) input.focus();
      })
    );

    view.querySelectorAll("[data-budget-edit]").forEach((input) => {
      const commit = () => {
        const [kind, ref] = input.getAttribute("data-budget-edit").split("|");
        const value = input.value.trim();
        if (kind === "pick") {
          updatePick(ref, { cost: value === "" ? null : Number(value) });
        } else {
          const rows = loadBudgetExtras().filter((r) => r.overrides !== ref);
          if (value !== "") {
            const label = (budgetLines().trip.find((l) => l.key === ref) || {}).name || ref;
            rows.push({ item: label, amount: Number(value) || 0, overrides: ref });
          }
          saveBudgetExtras(rows);
        }
        budgetEditing = null;
        renderBudget();
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        if (e.key === "Escape") { budgetEditing = null; renderBudget(); }
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
    store(STORAGE_KEY, JSON.stringify(state));
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
          <button class="packing-remove" data-packing-remove="${i}" aria-label="Remove ${esc(it.text)}">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
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

    // The asks that never occur to anyone. Every category above names a kind
    // of place, which is the only thing a map can be asked for - but it is not
    // how anyone actually decides where to go. These name what you want out of
    // somewhere instead, and they only work at all because the AI is doing the
    // finding. The OSM fallbacks are honest guesses, hence approx on all of
    // them.
    { key: "comfort", label: "Comfort food", icon: "🥧", group: "Worth asking", tag: "amenity", value: "restaurant", approx: true,
      prompt: "comfort food - pies, stew, chips, a proper roast, somewhere warm and filling rather than clever" },
    { key: "locals", label: "Where locals eat", icon: "🍲", group: "Worth asking", tag: "amenity", value: "restaurant", approx: true,
      prompt: "where local people actually eat rather than where visitors are sent - unshowy, busy with regulars, no tourist menu" },
    { key: "detour", label: "Worth the detour", icon: "↩️", group: "Worth asking", tag: "tourism", value: "attraction", approx: true,
      prompt: "somewhere worth going out of your way for, and say plainly what the one thing is that makes it worth it" },
    { key: "quiet", label: "Somewhere quiet", icon: "🤫", group: "Worth asking", tag: "leisure", value: "park", approx: true,
      prompt: "somewhere calm and uncrowded to sit or walk, away from coaches and crowds" },
    { key: "authentic", label: "The real thing", icon: "🪵", group: "Worth asking", tag: "tourism", value: "attraction", approx: true,
      prompt: "places that are genuinely of this area rather than made for visitors - working, ordinary, still doing what they always did" },
    { key: "oldest", label: "Older than the rest", icon: "🗿", group: "Worth asking", tag: "historic", value: "yes", approx: true,
      prompt: "the oldest surviving things around here - the ones that were already there when everything nearby was built" },
    { key: "late", label: "Open late", icon: "🌙", group: "Worth asking", tag: "amenity", value: "restaurant", approx: true,
      prompt: "places still open in the evening or late, and say what time they actually stop serving" },
    { key: "rain", label: "Only if it rains", icon: "☔", group: "Worth asking", tag: "tourism", value: "museum", approx: true,
      prompt: "things that are better in bad weather than good - indoors, atmospheric, worth a wet afternoon" },
    { key: "surprise", label: "Surprise me", icon: "🎲", group: "Worth asking", tag: "tourism", value: "attraction", approx: true,
      prompt: "something unexpected nearby that most visitors never hear about - pick one angle and commit to it, and say why it is worth the time" },

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

  const CATEGORY_GROUPS = ["Worth asking", "Food & drink", "With a child", "See & do", "Outdoors", "Practical"];

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
    const res = await fetchWithTimeout(
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
    const res = await fetchWithTimeout(
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
    return `<span class="candidate-rating">${icon('star', { size: 14, cls: 'ico-inline' })} ${esc(String(r.rating))}${esc(count)}</span>`;
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

    const useCentre = (lat, lon, accuracy) => {
      const note = fixAccuracyNote(accuracy);
      explore.centre = { name: "Where I am", lat, lon, accuracy };
      explore.status = "idle";
      markExploreStale();
      renderPicks();
      if (note) toast(`Found you ${note}`);
    };
    const fail = (msg) => {
      explore.status = "error";
      explore.error = msg;
      renderPicks();
    };

    // This had its own copy of the geolocation call, asking for a coarse fix
    // - so the one place whose whole job is "search around exactly here" was
    // the least accurate in the app. One implementation now, the careful one.
    try {
      const fix = await currentPosition();
      useCentre(fix.lat, fix.lon, fix.accuracy);
    } catch (e) {
      fail(`Couldn't get your location: ${(e && e.message) || e}`);
    }
  }

  // Category browsing via Gemini. OSM is thinnest exactly here - independent
  // cafés and restaurants are the least-mapped things in it - so the model
  // names candidates and OSM is then used only to place them.
  // How many suggestions the last search threw away, and why.
  let exploreDropped = { unplaced: 0, tooFar: 0 };

  async function exploreWithGemini(centre, category, radiusMetres, key) {
    exploreDropped = { unplaced: 0, tooFar: 0 };
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
    // Kept so the screen can say why the list is shorter than it looks -
    // silently returning three of six reads as the AI being useless.
    const unplaced = [];
    const tooFar = [];
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
      // The distance check only ever ran when the place had been found, so
      // anything the geocoder could not place fell straight past it and was
      // listed anyway - with no coordinates, under a heading promising
      // results within N miles. That is how a place in Chelsea appeared in a
      // ten-mile search around Stirling: the model named it, Nominatim could
      // not put it anywhere near, and the app showed it regardless.
      //
      // In a search that means "near here", somewhere you cannot place is not
      // a weaker answer, it is not an answer. Drop it and say so.
      if (!geo) {
        unplaced.push(item.name);
        continue;
      }
      // The model can also name somewhere in the right country but the wrong
      // city, so anything outside the requested radius goes too. A quarter
      // over the asked-for radius, plus a little slack for geocoding.
      const km = haversineKm(centre.lat, centre.lon, geo.lat, geo.lon);
      if (km > (radiusMetres / 1000) * 1.25 + 2) {
        tooFar.push(item.name);
        continue;
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
      // A second per place was six or seven seconds of a search spent doing
      // nothing at all. Only owed when a request was genuinely made.
      if (!lastGeocodeFromCache) await new Promise((r) => setTimeout(r, 1100));
    }
    if (!out.length) {
      throw new Error(
        unplaced.length || tooFar.length
          ? `Nothing suggested could be confirmed near here — ${[
              unplaced.length ? `${unplaced.length} couldn't be found on the map` : "",
              tooFar.length ? `${tooFar.length} turned out to be too far away` : "",
            ]
              .filter(Boolean)
              .join(", ")}. Try a wider radius.`
          : "None of the suggestions could be placed on the map"
      );
    }
    exploreDropped = { unplaced: unplaced.length, tooFar: tooFar.length };
    return out.sort((a, b) => {
      if (a.lat == null) return 1;
      if (b.lat == null) return -1;
      return haversineKm(centre.lat, centre.lon, a.lat, a.lon) - haversineKm(centre.lat, centre.lon, b.lat, b.lon);
    });
  }

  // ---------- What's on ----------
  // Every other search in this app asks about places, which are permanent: a
  // castle is there whether you go on Tuesday or in March. An event is the
  // opposite - it is somewhere for one afternoon and then it is nothing - and
  // the app had no way to express that, so the answer to "what's on while
  // we're here" was to put the phone down and open a browser.
  //
  // There is no open dataset for this. OpenStreetMap maps things that stay
  // still. Eventbrite withdrew public event search from third parties,
  // Songkick and Bandsintown are partner-only, Meetup went paid. So this is a
  // grounded AI search, with two consequences taken seriously: every event
  // carries the page it came from, and none of it is presented as certain.

  // Today and tomorrow first, because "what can we do this afternoon" is the
  // question actually asked on a trip, and it used to mean opening the date
  // pickers and choosing the same day twice.
  const EVENT_WINDOWS = [
    { key: "today", label: "Today" },
    { key: "tomorrow", label: "Tomorrow" },
    { key: "weekend", label: "This weekend" },
    { key: "week", label: "Next 7 days" },
    { key: "trip", label: "While we're there" },
  ];

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  // The window a search covers, as real dates. "While we're there" comes from
  // the plan rather than from anything typed twice.
  // Where a hand-picked range and start time live. Kept next to the window
  // helper because everything that reads a window has to cope with them.
  const customWindow = { from: "", to: "", fromTime: "" };

  function eventWindow(key) {
    const today = startOfDay(new Date());

    if (key === "custom") {
      const from = parseEventDate(customWindow.from) || today;
      const to = parseEventDate(customWindow.to) || from;
      // A range typed backwards is a slip, not a request for nothing.
      const [a, b] = from <= to ? [from, to] : [to, from];
      return {
        from: a,
        to: b,
        fromTime: customWindow.fromTime || "",
        label: customWindow.fromTime
          ? `from ${humanDate(a)}, ${customWindow.fromTime}`
          : `between ${humanDate(a)} and ${humanDate(b)}`,
      };
    }

    if (key === "today") {
      return { from: today, to: today, label: "today" };
    }
    if (key === "tomorrow") {
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      return { from: d, to: d, label: "tomorrow" };
    }
    if (key === "trip") {
      const dated = datedDays(loadPlan().days).filter((x) => x.when);
      if (dated.length) {
        const days = dated.map((x) => x.when).sort((a, b) => a - b);
        // A trip that has already started is asked about from today, not from
        // the day it began - nobody wants Monday's events on Wednesday.
        const from = days[0] > today ? days[0] : today;
        return { from, to: days[days.length - 1], label: "while you're there" };
      }
      // No dated plan to read: fall through to the week rather than refusing.
      key = "week";
    }
    if (key === "weekend") {
      const day = today.getDay(); // 0 Sun … 6 Sat
      // Sunday is the last day of the weekend, so this weekend is today and
      // nothing more. Saturday is today and tomorrow. Any other day, it is
      // the coming Friday through Sunday.
      if (day === 0) return { from: today, to: today, label: "today" };
      const from = new Date(today);
      if (day !== 6) from.setDate(from.getDate() + (5 - day));
      const to = new Date(from);
      to.setDate(to.getDate() + (day === 6 ? 1 : 2));
      return { from, to, label: "this weekend" };
    }
    const to = new Date(today);
    to.setDate(to.getDate() + 7);
    return { from: today, to, label: "over the next week" };
  }

  function humanDate(d) {
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }

  // Events are picks with a date on them, so everything already built - the
  // map, the folders, the budget, the plan - works on them unchanged.
  function normaliseEvent(item, window) {
    const name = String(item.name || "").trim();
    const band = ageRange(item);
    if (!name) return null;
    // An event with no date is not an event, it is a rumour. This is the one
    // field that cannot be missing.
    const when = parseEventDate(item.date);
    if (!when) return null;
    // A run of days - a festival, an exhibition, a week of a play - used to be
    // thrown away whenever its start fell before the window, which is exactly
    // when you most want to know about it: the thing that started on Tuesday
    // and is still on while you are here.
    const ends = parseEventDate(item.endDate) || when;
    const from = startOfDay(window.from);
    const to = endOfWindow(window.to);
    if (endOfWindow(ends) < from || when > to) return null;
    // Shown against the first day of it you could actually go.
    const showOn = when < from ? new Date(from) : when;
    const runsOn = endOfWindow(ends) > endOfWindow(showOn);
    return {
      name,
      kind: "event",
      startsAt: showOn.toISOString(),
      endsAt: runsOn ? ends.toISOString() : "",
      time: typeof item.time === "string" && /^\d{1,2}:\d{2}$/.test(item.time.trim()) ? item.time.trim() : "",
      // The whole point of asking: an event that ran 09:00-21:00 is still
      // worth telling you about at three in the afternoon, and one that
      // finished at 14:00 is not.
      endTime:
        typeof item.endTime === "string" && /^\d{1,2}:\d{2}$/.test(item.endTime.trim())
          ? item.endTime.trim()
          : "",
      venue: String(item.venue || "").trim(),
      area: String(item.area || item.venue || "").trim(),
      description: String(item.what || item.why || "").trim(),
      price: typeof item.price === "string" && /^(free|£{1,3})$/i.test(item.price.trim()) ? item.price.trim() : null,
      ticketUrl: /^https?:\/\//i.test(String(item.tickets || "")) ? String(item.tickets) : "",
      // Where it was listed. The app's own search gets this free from
      // grounding chunks; a pasted answer has none, so it has to be asked for
      // - otherwise an imported event is the one kind of row with nothing at
      // all to click through to and no way to check it.
      listedAt: /^https?:\/\//i.test(String(item.link || "")) ? String(item.link) : "",
      recurring: item.recurring === true,
      // The four a parent actually decides on. Same rule as every field above:
      // anything that is not exactly what was asked for becomes an honest
      // blank, never a coerced value. A wrong "indoor" is worse than no
      // answer, because the screen prints it as a finding.
      // The plural is the same answer. Forgiving "Indoors" is punctuation,
      // not interpretation - unlike "probably inside", which is refused.
      setting: settingWord(item.setting),
      minAge: band.min,
      maxAge: band.max,
      // "Aimed at children", "children are allowed" and "nobody said" are
      // three answers and a boolean holds two. The one it dropped is the one
      // this screen exists to be honest about: a false meaning "we didn't
      // ask" would have been printed on a row as "not for children".
      childFocus: /^(aimed|allowed|adults)$/i.test(String(item.childFocus || "").trim())
        ? String(item.childFocus).trim().toLowerCase()
        : "",
      bookingLevel: /^(required|advised|none)$/i.test(String(item.booking || "").trim())
        ? String(item.booking).trim().toLowerCase()
        : "",
      // Stored under the name a place already uses, so the morning brief's
      // "N still to book" (which counts pick.booking && !pick.booked) starts
      // counting events with no edit to it at all.
      booking: /^(required|advised)$/i.test(String(item.booking || "").trim()),
    };
  }

  function settingWord(value) {
    const m = /^(indoors?|outdoors?|both)$/i.exec(String(value || "").trim());
    if (!m) return "";
    const word = m[1].toLowerCase();
    return word === "both" ? "both" : word.replace(/s$/, "");
  }

  // Every field that makes an event an event, in one place. There were two
  // hand-kept lists of these and neither had all of them - which is exactly
  // how a festival lost its run length and a town-centre pin lost the word
  // "approx." the moment you saved it. Same failure as BOARD_PARTS, same fix.
  const EVENT_FIELDS = [
    "startsAt", "endsAt", "time", "endTime", "venue", "price", "ticketUrl",
    "recurring", "approximate", "setting", "minAge", "maxAge", "childFocus",
    "bookingLevel", "booking",
    // Google's own id for the venue, once one has been found. Without it here
    // the exact link would be dropped by the same list that already lost
    // endsAt and approximate once.
    "googleUrl", "venueChecked", "listedAt",
    // Kept on the saved copy too: an event that arrived by hand should still
    // say so once it is in your list, not only while it is a search result.
    "pastedIn",
  ];

  function copyEventFields(from, to) {
    EVENT_FIELDS.forEach((k) => {
      if (from[k] !== undefined) to[k] = from[k];
    });
  }

  // An age is a number of years or it is nothing. A model that answers "5+"
  // or "all ages" has not answered the question that was asked, and turning
  // that into a 5 is inventing precision.
  function cleanAge(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const n = Math.round(value);
    return n >= 0 && n <= 120 ? n : null;
  }

  // "For ages 12 to 4" is not a band, it is a mistake, and there is no way to
  // tell which half of it was meant. Both go.
  function ageRange(item) {
    const min = cleanAge(item.minAge);
    const max = cleanAge(item.maxAge);
    if (min != null && max != null && min > max) return { min: null, max: null };
    return { min, max };
  }

  // Something with a listed start but no listed end. Guessing is unavoidable
  // if "has it finished" is to mean anything at all, so the guess is a modest
  // one and the screen says out loud that it is being made.
  const ASSUMED_EVENT_HOURS = 2;

  // Answers whether an event is still worth telling somebody about at a given
  // moment. Only ever drops what has demonstrably finished - the point of the
  // filter is to remove things that are over, not to be clever about things
  // it cannot know.
  function stillOnAt(event, cutoff) {
    if (!cutoff) return true;
    const day = event.startsAt ? startOfDay(new Date(event.startsAt)) : null;
    // The cutoff is a moment, not a daily curfew: it only applies to the day
    // it falls on. An event next Tuesday is not filtered by "from 3pm today".
    if (!day || startOfDay(cutoff) > day) return true;
    if (startOfDay(cutoff) < day) return true;

    const mins = (t) => timeToMinutes(t);
    const cutoffMins = cutoff.getHours() * 60 + cutoff.getMinutes();
    const ends = mins(event.endTime);
    if (ends != null) return ends > cutoffMins;

    const starts = mins(event.time);
    // No times at all - an all-day thing, and nobody can say it is over.
    if (starts == null) return true;
    return starts + ASSUMED_EVENT_HOURS * 60 > cutoffMins;
  }

  function endOfWindow(d) {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  }

  // Strict about meaning, forgiving about punctuation. "next Saturday" or
  // "late August" is refused, because that is not a date you can put on a day
  // of a plan and guessing at it would be inventing the answer.
  //
  // But 2026-8-3, 2026/08/03 and 2026-08-03T19:30:00Z all say exactly one
  // day, unambiguously, and the first version threw all three away for not
  // being typed the way it asked. That is a real event lost to a formatting
  // preference, and there were more of them than there should have been.
  function parseEventDate(value) {
    const text = String(value || "").trim();
    // A time or timezone on the end names the same day; anything after the
    // date is dropped rather than the whole value being refused.
    const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/.exec(text);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    // Checked rather than left to Date, which rolls 2026-13-40 forward into
    // the next year without complaint.
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(year, month - 1, day);
    if (Number.isNaN(d.getTime())) return null;
    // The 31st of a 30-day month is not a date, it is a mistake.
    if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return d;
  }

  // Six questions instead of one. This is the whole reason the old version
  // came back with four results while Facebook showed forty: a single "what's
  // on near here" gets a single general answer, and a general answer about a
  // town is always short. Asked six narrower questions, the same model finds
  // the folk night, the farmers' market, the am-dram production and the car
  // boot sale - which live on different corners of the internet and never
  // appear in one list.
  //
  // They run in parallel and the results are merged, so six searches cost
  // about what one used to.
  const EVENT_ANGLES = [
    { key: "music", label: "Music & nightlife",
      ask: "live music, gigs, folk and trad sessions, open mic nights, club nights, ceilidhs, " +
           "choirs and singing groups, brass and silver bands, organ recitals, pub music, " +
           "battle of the bands, tribute acts, karaoke nights" },
    { key: "market", label: "Markets & food",
      ask: "farmers' markets, street food, food and drink festivals, craft and makers' markets, " +
           "car boot sales, table top sales, night markets, tastings and tap takeovers, " +
           "produce shows, cake sales, pop-up kitchens, supper clubs, foraging walks" },
    { key: "family", label: "For children",
      ask: "things on for children and families - storytime and rhyme time, stay and play, " +
           "toddler groups, holiday clubs, craft workshops, kids' theatre and puppet shows, " +
           "farm and animal events, forest school and nature tots, junior parkrun, " +
           "soft play sessions, messy play, teddy bears' picnics, pantomimes" },
    { key: "arts", label: "Arts & theatre",
      ask: "theatre and am-dram, comedy nights, cinema and film club screenings, exhibitions with " +
           "an end date, artist talks, author and book events, open studios and art trails, " +
           "poetry nights, craft classes, life drawing, museum lates" },
    { key: "outdoors", label: "Outdoors & sport",
      ask: "guided and heritage walks, races and fun runs, parkrun, local matches and fixtures, " +
           "agricultural and county shows, ploughing matches, sheepdog trials, regattas, " +
           "steam and vintage rallies, wildlife and birdwatching events, open gardens, " +
           "conservation work days, cycling sportives, orienteering" },
    // The three that replaced one catch-all called "Local & one-off". That
    // single angle was doing the work of four, and it was the one covering the
    // smallest events - which is to say the ones this whole screen is for.
    { key: "hall", label: "Village hall & church",
      ask: "village hall, community centre, church and chapel events - coffee mornings, " +
           "jumble sales, bring and buy, table top sales, beetle drives, whist drives, bingo, " +
           "quiz nights, harvest suppers, community lunches, messy church, parish notices, " +
           "flower festivals, bell ringing, hall AGMs and open days, warm spaces" },
    { key: "clubs", label: "Clubs & societies",
      ask: "what the local clubs and societies have on - WI, horticultural and gardening " +
           "societies, allotment associations, camera clubs, history and heritage societies, " +
           "u3a, model railway and modelling clubs, bell ringers, bowls and cricket club " +
           "socials, angling clubs, open rehearsals, talks to members that visitors may attend" },
    { key: "fetes", label: "Fetes & fundraisers",
      ask: "fetes, gala days, carnivals and processions, school fairs and PTA events, " +
           "summer and Christmas fairs, duck races, sponsored walks and runs, tombolas, " +
           "charity coffee mornings, macmillan mornings, scout and guide fundraisers, " +
           "raffles, village weekends" },
    // The ninth, and deliberately the vaguest: the things that fit nowhere
    // else are exactly the ones a tidy set of categories loses. The old
    // catch-all was doing this job badly while also covering halls, clubs and
    // fetes; with those three taken off it, it can do only this.
    { key: "oneoff", label: "Seasonal & one-off",
      ask: "the odd one-off things that fit no category - wassails, well dressings, " +
           "beating the bounds, lantern parades, bonfire and firework nights, light switch-ons, " +
           "remembrance and anniversary events, open days at places usually closed, " +
           "behind-the-scenes tours, pop-ups, repair cafes, community litter picks, " +
           "swap shops, seed swaps, apple days, and anything unusual happening once" },
  ];

  // Said once, to every angle, so nine prompts cannot drift apart. This is the
  // part that goes after the small stuff.
  //
  // The old prompt said "small and local counts as much as big and ticketed",
  // which is a hint rather than an instruction: it named no source and no
  // vocabulary, and a model that is not told where to look reaches for the
  // tourist board. The things worth finding are one layer under that, and they
  // are written down - just not on the sites a general search reaches for.
  const SMALL_EVENT_SOURCES =
    `Look where small things are actually written down, not just the obvious sites: ` +
    `parish magazines and community newsletters; village hall and community centre pages; ` +
    `church, chapel and cathedral noticeboards; library and council what's-on pages; ` +
    `town and parish council minutes and agendas; school and PTA pages; tourist board and ` +
    `visitor centre diaries; National Trust, RSPB, Wildlife Trust and country park listings; ` +
    `farm shops, garden centres, pubs and village shops; sports, social and working men's clubs; ` +
    `local newspapers and their listings columns; community radio; and the small ticketing ` +
    `sites that tiny organisers actually use - TicketSource, Ticket Tailor, Eventbrite. ` +
    `Public Facebook Pages for venues and community groups are worth reading where they are ` +
    `reachable.`;

  const SMALL_EVENT_APPETITE =
    `Be exhaustive, and prefer the small. A coffee morning in a village hall with six people ` +
    `at it is exactly what is wanted here; so is a talk to a gardening society, a school fair, ` +
    `a duck race, a jumble sale, a beetle drive. Something with no website at all, mentioned ` +
    `once in a parish newsletter, is worth listing. Do not restrict yourself to things that ` +
    `are ticketed, promoted or aimed at visitors - most of what is on in a place is aimed at ` +
    `the people who live there, and that is the good stuff. Thirty real listings is a better ` +
    `answer than five.`;

  // The shape of an answer, in one place. The search asks for it nine times
  // and the hand-off asks for it once; two copies would drift, and a drifted
  // contract means a pasted answer that normaliseEvent refuses field by field
  // for reasons nobody can see. Deliberately only the EVENT contract - the
  // place search has its own, with different fields, and merging them would
  // break both.
  // ---------- Asking somewhere else, and pasting the answer back ----------
  // The app's own search needs a Gemini key and spends nine grounded requests.
  // Not everybody has a key, some people have a subscription to an assistant
  // that is better than the free tier, and a key that has run out of quota
  // makes the whole screen useless.
  //
  // So: one prompt, covering all nine kinds at once rather than nine separate
  // questions - because the point of doing it by hand is not doing it nine
  // times - copied to the clipboard, and a box to paste the answer into. What
  // comes back goes through exactly the same machinery as a searched result:
  // extractJson repairs it, normaliseEvent refuses anything malformed, and it
  // is placed, deduped and dated the same way. Nothing is trusted more for
  // having been pasted.
  function handoffPrompt(centre, windowKey, radiusMetres, towns) {
    const miles = Math.max(1, Math.round(toMiles(radiusMetres / 1000)));
    const w = eventWindow(windowKey);
    const sameDay = isoDate(w.from) === isoDate(w.to);
    const when = sameDay
      ? `on ${humanDate(w.from)} ${w.from.getFullYear()}`
      : `between ${humanDate(w.from)} and ${humanDate(w.to)} ${w.from.getFullYear()}`;
    const where = towns && towns.length
      ? `within about ${miles} miles of ${centre.name}. That area covers ${towns.join(", ")} - ` +
        `go through them, not just the biggest one`
      : `within about ${miles} miles of ${centre.name}`;

    return (
      `List events happening ${when}, ${where}.` +
      (w.fromTime
        ? ` On ${humanDate(w.from)} only things still going at ${w.fromTime} or later.`
        : "") +
      `\n\n` +
      // All nine at once. The app asks these separately because it can afford
      // to; by hand, one question that names every kind is the whole point.
      `Cover all of these:\n` +
      EVENT_ANGLES.map((a) => `- ${a.label}: ${anglePrompt(a.key)}`).join("\n") +
      `${aiContextBlock()}\n\n` +
      `${SMALL_EVENT_APPETITE}\n\n` +
      `${SMALL_EVENT_SOURCES}\n\n` +
      `Include something only if you have seen it listed with a date. Do not invent ` +
      `plausible-sounding events, and do not pad the list with permanent attractions - ` +
      `a castle that opens every day is not an event.\n\n` +
      `For each one, say what the listing actually states, and leave the field empty ` +
      `rather than guessing: whether it is indoors or outdoors, what ages it is for, ` +
      `whether it is aimed at children, merely allows them or is adults-only, and whether ` +
      `it has to be booked in advance.\n\n` +
      EVENT_JSON_CONTRACT
    );
  }

  const EVENT_JSON_CONTRACT =
    `Reply with ONLY a JSON array, each item ` +
    `{"name": what it is called, ` +
    `"date": "YYYY-MM-DD" the day it is on, ` +
    `"endDate": "YYYY-MM-DD" if it runs over several days, otherwise "", ` +
    `"time": "HH:MM" 24-hour start time, or "" if there isn't one, ` +
    `"endTime": "HH:MM" when it finishes, or "" if it isn't listed - ` +
    `an all-day market that runs 09:00 to 16:00 should say so, ` +
    `"venue": the building or place it is at, ` +
    `"area": the town or village, ` +
    `"what": one short sentence on what it actually is, ` +
    `"price": "free", "£", "££" or "£££", ` +
    `"tickets": the booking or information URL, or "", ` +
    `"link": the page you saw it listed on - a parish newsletter, a hall's page, ` +
    `a listings site - or "" if there isn't one, ` +
    `"recurring": true if this happens every week rather than being a one-off, ` +
    `"setting": "indoor", "outdoor", "both" if there is a sheltered part, or "" if the listing doesn't say, ` +
    `"minAge": the youngest age it is meant for as a number, or null, ` +
    `"maxAge": the oldest age it is meant for as a number, or null, ` +
    `"childFocus": "aimed" if it is put on for children, "allowed" if children may come ` +
    `but it is not aimed at them, "adults" if it is adults-only, or "" if the listing doesn't say, ` +
    `"booking": "required" if you must book ahead, "advised" if it sells out, ` +
    `"none" if you can turn up, or "" if the listing doesn't say}. ` +
    `No other text.`;

  function eventPrompt(centre, window, radiusMetres, angle, towns) {
    const miles = Math.max(1, Math.round(toMiles(radiusMetres / 1000)));
    const who = aiContextBlock();
    // Named places rather than a radius, when we know them. The radius stays
    // as well - it is what bounds the answer - but the names are what make it
    // answerable.
    const where = towns && towns.length
      ? `within about ${miles} miles of ${centre.name}. That area covers ${towns.join(", ")}` +
        `${towns.length >= SETTLEMENT_LIMIT ? " and other villages nearby" : ""} - ` +
        `go through them, not just the biggest one`
      : `within about ${miles} miles of ${centre.name}`;
    const sameDay = isoDate(window.from) === isoDate(window.to);
    const when = sameDay
      ? `on ${humanDate(window.from)} ${window.from.getFullYear()}`
      : `between ${humanDate(window.from)} and ${humanDate(window.to)} ${window.from.getFullYear()}`;

    return (
      `List events happening ${when}, ${where}.` +
      (window.fromTime
        ? ` On ${humanDate(window.from)} only things still going at ${window.fromTime} or later - ` +
          `something that finishes before then is no use, but something that runs across it is.`
        : "") +
      `\n\n` +
      `Specifically: ${anglePrompt(angle.key)}.${who}\n\n` +
      // The old prompt said "leave out anything you cannot confirm; six real
      // ones are worth more than twelve guesses", and the model did as it was
      // told. Breadth is the job here - the app filters afterwards, and an
      // event nobody lists is one nobody can go to.
      `${SMALL_EVENT_APPETITE}\n\n` +
      `${SMALL_EVENT_SOURCES}\n\n` +
      `Include something only if you have seen it listed with a date. Do not invent ` +
      `plausible-sounding events, and do not pad the list with permanent attractions - ` +
      `a castle that opens every day is not an event.\n\n` +
      // Favour, never omit. Asked to skip what does not suit the family, the
      // model does the deciding - and the thing you would have got a sitter
      // for, or sent one parent to, never reaches you at all. The app can
      // say "past bedtime" on a row; it cannot un-hide what was never listed.
      `Where two listings are equally good, prefer the one that suits the people above. ` +
      `Do not leave anything out on those grounds though - something at an awkward ` +
      `hour is still worth listing, and we will decide.\n\n` +
      // Four facts that decide whether a parent can actually go. An honest
      // blank is wanted where the listing does not say - a guess here is
      // worse than a gap, because the app prints these as findings.
      `For each one, say what the listing actually states, and leave the field empty ` +
      `rather than guessing: whether it is indoors or outdoors, what ages it is for, ` +
      `whether it is aimed at children, merely allows them or is adults-only, and whether it has to be ` +
      `booked in advance.\n\n` +
      EVENT_JSON_CONTRACT
    );
  }

  // Kept so the screen can say why a list is shorter than it looks - and it
  // says so whether or not anything survived, which is the whole point. A
  // count that only appears when the search fails completely is no use to
  // somebody looking at six results wondering where the other thirty went.
  const NO_DROPS = { unplaced: 0, undated: 0, outside: 0, tooFar: 0, finished: 0, merged: 0 };
  let eventsDropped = Object.assign({}, NO_DROPS);
  // The ones that can be shown anyway, with the reason attached. Something we
  // could not place is still a real listing with a name, a date and a link.
  let eventsHeldBack = [];

  // Two listings of the same thing from two angles - a ceilidh is both music
  // and local - should be one row.
  function eventFingerprint(event) {
    const name = String(event.name || "")
      .toLowerCase()
      .replace(/^(the|a)\s+/, "")
      .replace(/[^a-z0-9]+/g, "");
    return `${name}|${String(event.startsAt || "").slice(0, 10)}`;
  }

  // ---------- Can we actually go? ----------
  // The screen could tell you an event existed and nothing else. For a parent
  // that is the easy half: the question is never "is this interesting", it is
  // "can we pull this off", and the answer turns on four things every single
  // time - the age it is pitched at, bedtime, the nap, and the weather if it
  // is outside.
  //
  // One line, not six badges. A row carrying every fact is a row nobody reads,
  // and only one of the facts is ever the reason you do not go. So: the worst
  // thing that applies, in the order that things actually stop you, and
  // everything else in the detail sheet.
  //
  // `null` most of the time is the right answer and the hardest one to keep.

  // How long after a listed start a child is still fine to be out. Turning up
  // at 18:45 for a 19:00 thing with a 19:00 bedtime is not a plan.
  const BEDTIME_GRACE_MINS = 0;

  // Read once per render rather than once per row. eventVerdict was parsing
  // the people list, the nap window and the bedtime out of localStorage for
  // every single event on screen - which cost nothing when the screen was
  // drawn twice a search, and costs forty times that now results stream in.
  let renderPass = null;

  function beginRenderPass() {
    renderPass = { kids: null, weather: {} };
  }

  function endRenderPass() {
    renderPass = null;
  }

  function kidAges() {
    if (renderPass && renderPass.kids) return renderPass.kids;
    const kids = loadPeople().filter(isChild).map((p) => p.age).filter((a) => a != null);
    if (renderPass) renderPass.kids = kids;
    return kids;
  }

  function eventVerdict(event, opts) {
    if (!event) return null;
    const options = opts || {};

    const kids = kidAges();

    // 0. A door that will not let you in. Nothing below this matters.
    if (kids.length && event.childFocus === "adults") {
      return { key: "adults-only", tone: "no", text: "Adults only" };
    }

    // 1. The age band, which is the next thing you cannot work around. A
    //    listing that says 8+ is not going to entertain a three-year-old
    //    whatever time it is on.
    if (kids.length && event.minAge != null) {
      const oldest = Math.max.apply(null, kids);
      if (oldest < event.minAge) {
        return { key: "too-young", tone: "no", text: `Aimed at ${event.minAge}+, and yours ${
          kids.length === 1 ? `is ${kids[0]}` : `are ${kids.slice().sort((a, b) => a - b).join(" and ")}`
        }` };
      }
    }
    if (kids.length && event.maxAge != null) {
      const youngest = Math.min.apply(null, kids);
      if (youngest > event.maxAge) {
        return { key: "too-old", tone: "no", text: `Aimed at under-${event.maxAge + 1}s, and yours ${
          kids.length === 1 ? `is ${kids[0]}` : `are ${kids.slice().sort((a, b) => a - b).join(" and ")}`
        }` };
      }
    }

    // 2. Bedtime. Only the youngest child's, because they are the one who
    //    runs out first, and only when a start time is actually listed.
    const bed = earliestBedtime();
    const starts = timeToMinutes(event.time);
    if (bed && starts != null && starts + BEDTIME_GRACE_MINS >= bed.mins) {
      return { key: "bedtime", tone: "no", text: `Starts after ${personLabel(bed.p)}'s bedtime` };
    }

    // 3. The nap - but only when you could not simply go earlier and leave.
    if (napIsUnavoidable(event)) {
      const nap = napWindow();
      return { key: "nap", tone: "no", text: `Runs through ${personLabel(nap.who)}'s nap` };
    }

    // 4. A job rather than a blocker - but it is the one with a deadline, and
    //    it is certain. Miss the booking and you definitely cannot go; a
    //    forecast four days out might simply be wrong. So it outranks rain.
    if (event.bookingLevel === "required") return { key: "book", tone: "warn", text: "Has to be booked ahead" };
    if (event.bookingLevel === "advised") return { key: "book", tone: "warn", text: "Worth booking — these sell out" };

    // 5. Outdoors with rain forecast. The only weather claim the data can
    //    support: Open-Meteo gives a day, not an hour.
    if (event.setting === "outdoor" && options.rainChance != null && options.rainChance >= WET_ENOUGH) {
      return { key: "rain", tone: "warn", text: `Outdoors, and it's ${options.rainChance}% rain that day` };
    }

    // 6. And the one good thing worth saying, when the band genuinely fits.
    if (event.childFocus === "aimed" && kids.length && (event.minAge != null || event.maxAge != null)) {
      return { key: "aimed", tone: "yes", text: `Aimed at ${ageBandLabel(event)}` };
    }
    return null;
  }

  function ageBandLabel(event) {
    if (event.minAge != null && event.maxAge != null) return `${event.minAge}-${event.maxAge}s`;
    if (event.minAge != null) return `${event.minAge}+`;
    return `under-${event.maxAge + 1}s`;
  }

  // clashesWithNap answers "does this start in the nap", which is the right
  // question about a stop on a plan and the wrong one about an event with a
  // run. A market open 10:00-16:00 spans the nap and is no problem at all:
  // you go in the morning and leave. Only something you could not attend
  // without being there through the nap is worth a word.
  function napIsUnavoidable(event) {
    const nap = napWindow();
    if (!nap) return false;
    const starts = timeToMinutes(event.time);
    if (starts == null) return false;
    const ends = timeToMinutes(event.endTime);
    // No finish time: it is a fixed-time thing, so starting in the nap is it.
    if (ends == null || ends <= starts) return starts >= nap.from && starts < nap.to;
    // A run that reaches past the start of the nap but began before it is
    // avoidable - turn up early. Only a run sitting wholly inside the window
    // gives you no way out of it.
    return starts >= nap.from && ends <= nap.to;
  }

  // ---------- Filling in the events saved before any of this existed ----------
  // Everything saved before this change knows none of the four things that
  // decide whether you can go, so without this the feature only ever applies
  // to what you save from here on.
  //
  // Two rules make it safe, and they matter more than the backfill does:
  //
  // It fills blanks only. A field that already holds an answer is never
  // overwritten, so asking again cannot replace something true with a worse
  // guess - which is the whole risk of re-asking a model about something it
  // already told you once.
  //
  // And it is not allowed to touch what the event IS. Name, date, venue,
  // coordinates and sources are read-only to it; it answers the four new
  // questions about an event and nothing else. A backfill that could move a
  // pin or change a date would be a rewrite, not a top-up.
  const BACKFILL_FIELDS = ["setting", "minAge", "maxAge", "childFocus", "bookingLevel"];

  function eventsNeedingBackfill() {
    return loadPicks().filter(
      (p) =>
        p.kind === "event" &&
        !eventIsPast(p) &&
        // Asked once is asked. Plenty of listings simply do not say whether a
        // thing is indoors, and without this an event nobody can answer for
        // would be offered up for asking again for ever - which is both a
        // waste of somebody's quota and a to-do that never clears.
        !p.askedAbout &&
        BACKFILL_FIELDS.some((f) => p[f] == null || p[f] === "")
    );
  }

  async function backfillEvents(onProgress) {
    const key = loadTripSettings().geminiKey.trim();
    if (!key) {
      return { ok: false, message: "This needs an AI key — Settings has a Gemini key field." };
    }
    const todo = eventsNeedingBackfill();
    if (!todo.length) return { ok: true, message: "Nothing to fill in — every saved event already has these." };

    const lines = todo
      .map((p, i) => `${i + 1}. ${p.name}${p.venue ? `, ${p.venue}` : ""}${p.city ? `, ${p.city}` : ""}${
        p.startsAt ? ` on ${isoDate(new Date(p.startsAt))}` : ""
      }`)
      .join("\n");

    const prompt =
      `For each of these events, say what its listing states. Answer only these ` +
      `questions - do not correct the name, the date or the place, and leave a field ` +
      `empty rather than guessing.\n\n${lines}\n\n` +
      `Reply with ONLY a JSON array of ${todo.length} items in the same order, each ` +
      `{"n": the number above, ` +
      `"setting": "indoor", "outdoor", "both" or "", ` +
      `"minAge": number or null, "maxAge": number or null, ` +
      `"childFocus": "aimed", "allowed", "adults" or "", ` +
      `"booking": "required", "advised", "none" or ""}. No other text.`;

    let answer = null;
    for (const attempt of [{ grounded: true, maxTokens: 8192 }, { json: true, maxTokens: 8192 }]) {
      try {
        const res = await callGemini(key, prompt, attempt);
        const list = extractJson(res.text);
        if (Array.isArray(list) && list.length) {
          answer = list;
          break;
        }
      } catch (e) {
        // The other attempt may still answer.
      }
    }
    if (!answer) return { ok: false, message: "The model didn't come back with anything usable. Worth trying again." };

    let filled = 0;
    let touched = 0;
    answer.forEach((row, i) => {
      const index = typeof row.n === "number" ? row.n - 1 : i;
      const target = todo[index];
      if (!target) return;
      // Run through the same whitelist the search results go through, so a
      // backfilled event cannot hold a value a searched one could not.
      const clean = normaliseEvent(
        Object.assign({ name: target.name, date: isoDate(new Date(target.startsAt)) }, row),
        { from: startOfDay(new Date(target.startsAt)), to: startOfDay(new Date(target.startsAt)) }
      );
      if (!clean) return;
      const patch = {};
      BACKFILL_FIELDS.forEach((f) => {
        const has = target[f] != null && target[f] !== "";
        const got = clean[f] != null && clean[f] !== "";
        // Blanks only. An answer already on the pick stays exactly as it is.
        if (!has && got) patch[f] = clean[f];
      });
      if (patch.bookingLevel) patch.booking = patch.bookingLevel !== "none";
      if (Object.keys(patch).length) {
        touched++;
        filled += Object.keys(patch).length;
      }
      // Marked whether or not anything came back, because "we asked and the
      // listing didn't say" is an answer too.
      patch.askedAbout = Date.now();
      updatePick(target.id, patch);
      if (onProgress) onProgress(index + 1, todo.length);
    });

    return {
      ok: true,
      message: touched
        ? `Filled in ${filled} thing${filled === 1 ? "" : "s"} across ${touched} event${touched === 1 ? "" : "s"}. Nothing already answered was changed.`
        : `Asked about ${todo.length} event${todo.length === 1 ? "" : "s"} and the listings didn't say. Nothing changed.`,
    };
  }

  // The forecast for the day an event is on, at the place it is at. Distinct
  // from forecastForDay, which answers for a planned day and needs a day
  // label; an event has its own date and its own coordinates and need not be
  // on the plan at all.
  //
  // Returns null when there is nothing honest to say - no position, no date,
  // or a date past the sixteen days Open-Meteo will forecast. A trip three
  // weeks out gets no weather claim rather than a reassuring one.
  function eventForecast(event, onUpdate) {
    if (!event || event.lat == null || event.lon == null || !event.startsAt) return null;
    const when = new Date(event.startsAt);
    if (Number.isNaN(when.getTime())) return null;
    const ahead = Math.round((startOfDay(when) - startOfDay(new Date())) / 86400000);
    if (ahead < 0 || ahead > WEATHER_HORIZON_DAYS) return null;
    // weatherFor reads and parses the whole weather cache out of
    // localStorage. Once per row was invisible when this screen was drawn
    // twice; it is not, now that it is drawn every time a result lands.
    const key = `${event.lat.toFixed(2)},${event.lon.toFixed(2)}`;
    let cached;
    if (renderPass && Object.prototype.hasOwnProperty.call(renderPass.weather, key)) {
      cached = renderPass.weather[key];
    } else {
      cached = weatherFor(event.lat, event.lon, onUpdate);
      if (renderPass) renderPass.weather[key] = cached;
    }
    if (!cached || !cached.days) return null;
    const iso = isoDate(when);
    return cached.days.find((d) => d.date === iso) || null;
  }

  // Said out loud on the screen after every search, not only after a failed
  // one. "Found 6" with nothing else on the page is what makes an app feel
  // like it is holding things back; "Found 6, left out 14" with the reasons
  // is the same search being honest about itself.
  function describeEventDrops() {
    const d = eventsDropped;
    return [
      d.undated ? `${d.undated} had no usable date` : "",
      d.outside ? `${d.outside} fell outside those dates` : "",
      d.finished ? `${d.finished} had already finished by then` : "",
      d.tooFar ? `${d.tooFar} looked like somewhere else` : "",
      d.unplaced ? `${d.unplaced} couldn't be placed on the map` : "",
      // Deliberately not counted here. A listing found by two angles and
      // merged into one row was not left out of anything - it is on the
      // screen. Saying "left out: 3 were the same thing found twice" reads
      // as three missing events, which is the opposite of what happened.
    ]
      .filter(Boolean)
      .join(", ");
  }

  // Whether two listings that share a name and a date are actually the same
  // thing. "Farmers' Market" on a Saturday is the same event twice if both
  // say Stirling, and two different markets if one says Stirling and the
  // other says Callander - and merging those lost a real event every time.
  function sameEventPlace(a, b) {
    const flat = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const townA = flat(a.area);
    const townB = flat(b.area);
    // One of them not saying where it is proves nothing either way, so the
    // name-and-date match stands.
    if (!townA || !townB) return true;
    return townA === townB || townA.includes(townB) || townB.includes(townA);
  }

  async function askOneAngle(key, centre, window, radiusMetres, angle, towns) {
    const prompt = eventPrompt(centre, window, radiusMetres, angle, towns);
    // Grounded first, because grounding is what makes an event real rather
    // than plausible; JSON mode as the fallback, because a grounded reply
    // comes back as prose often enough to fail outright.
    for (const attempt of [{ grounded: true, maxTokens: 8192 }, { json: true, maxTokens: 8192 }]) {
      try {
        const answer = await callGemini(key, prompt, attempt);
        const list = extractJson(answer.text);
        if (Array.isArray(list) && list.length) {
          return { list, sources: answer.sources || [], angle: angle.key };
        }
      } catch (e) {
        // One angle failing is not the search failing. Five others are running.
      }
    }
    return { list: [], sources: [], angle: angle.key };
  }

  // Placing an event is a different problem from placing a café, and treating
  // it the same way is what threw most of them away. A café that Nominatim
  // cannot find probably does not exist. An event at "the Tolbooth" or "the
  // Albert Halls" or "St Mary's church hall" is perfectly real; those names
  // are simply not in a gazetteer of businesses.
  //
  // So the venue is tried first, then the town, then the centre of the search
  // itself - and an event is only refused when it can't be placed even that
  // roughly, or when the place it names is genuinely somewhere else.
  async function placeEvent(event, centre, anchor) {
    const tries = [
      { q: event.venue, hint: event.area || centre.name, exact: true, decides: false },
      { q: event.area, hint: null, exact: false, decides: true },
    ];
    // A venue name is a weak claim about geography. "The Corn Exchange", "The
    // Barn", "St Mary's Hall" and "The Guildhall" exist in fifty towns, and a
    // gazetteer hit on the wrong one used to end the event there and then -
    // returned as "too far away" before the town it actually named was ever
    // looked at. That is one of the ways a search came back with four results
    // when the web had forty.
    //
    // So an out-of-area venue is remembered and stepped past. Only the town
    // is trusted to rule an event out, because the town is the field the
    // model is actually reliable about.
    let venueLandedElsewhere = false;
    for (const attempt of tries) {
      if (!attempt.q) continue;
      let geo = null;
      try {
        geo = await geocodePlace(attempt.q, attempt.hint, anchor);
      } catch (e) {
        geo = null;
      }
      if (!geo) continue;
      // Wherever it landed, it still has to be in the area asked about.
      if (!confirmedWithinAnchor(anchor, geo.lat, geo.lon, ANCHOR_GRACE)) {
        if (attempt.decides) return { tooFar: true };
        venueLandedElsewhere = true;
        continue;
      }
      return {
        lat: geo.lat,
        lon: geo.lon,
        address: geo.address || event.area,
        website: geo.website || null,
        // A town-level hit is not the door of the venue, and the row should
        // not imply that it is.
        approximate: !attempt.exact,
      };
    }
    // Last resort: nothing about this could be placed inside the search area.
    // Before falling back to the centre, find out whether that is because the
    // place is genuinely unmappable or because it is somewhere else entirely -
    // the two are indistinguishable from an anchored lookup, which returns
    // nothing either way.
    //
    // Without this check, a listing whose area reads "Chelsea, London" failed
    // every anchored attempt and then got planted in the middle of Stirling,
    // which is the exact bug the anchor work existed to kill.
    // Nothing left to check: with no town named, an out-of-area venue is the
    // only evidence there is, and it says elsewhere.
    if (!event.area || centre.lat == null) return venueLandedElsewhere ? { tooFar: true } : null;
    let anywhere = null;
    try {
      anywhere = await geocodePlace(event.area, null, null);
    } catch (e) {
      anywhere = null;
    }
    if (anywhere && !confirmedWithinAnchor(anchor, anywhere.lat, anywhere.lon, ANCHOR_GRACE)) {
      return { tooFar: true };
    }
    // Genuinely unmappable, and nothing says it is elsewhere. The search
    // centre is a fair position for a listing, clearly marked as one.
    return {
      lat: centre.lat,
      lon: centre.lon,
      address: event.area,
      website: null,
      approximate: true,
    };
  }

  // ---------- Placing events, politely, one queue for all six angles ----------
  // This used to be inBatches(candidates, 4): four at a time with a 900ms
  // pause between batches, and it could not start until every angle had
  // answered. Two problems with that, now the angles report independently.
  //
  // Six angles each running their own batches would hit Nominatim six times
  // harder than the old code did, which is the opposite of polite. So there is
  // one queue, shared, and it is the only thing that talks to the geocoder.
  //
  // And the pause was unconditional. geocodeCandidates has recorded
  // lastGeocodeFromCache since Phase 1 precisely so a caller can skip it, and
  // the old code never read it - so a re-search of forty events that answered
  // entirely from the cache still sat there sleeping for eight seconds on
  // nobody's behalf. The pause is owed for a request that actually went out.
  const GEOCODE_PAUSE_MS = 900;

  function makePlaceQueue(onPlaced) {
    const items = [];
    let running = false;
    let stopped = false;
    let idle = null;
    let markIdle = null;

    async function drain() {
      running = true;
      while (items.length && !stopped) {
        const next = items.shift();
        let wentToNetwork = false;
        try {
          lastGeocodeFromCache = true;
          await next();
          wentToNetwork = !lastGeocodeFromCache;
        } catch (e) {
          // One event failing to place is not the queue failing.
        }
        if (items.length && !stopped && wentToNetwork) {
          await new Promise((r) => setTimeout(r, GEOCODE_PAUSE_MS));
        }
        if (onPlaced) onPlaced();
      }
      running = false;
      if (markIdle) {
        markIdle();
        markIdle = null;
        idle = null;
      }
    }

    return {
      push(job) {
        if (stopped) return;
        items.push(job);
        if (!running) drain();
      },
      stop() {
        stopped = true;
        items.length = 0;
      },
      // Resolves when everything queued so far has been dealt with.
      whenIdle() {
        if (!running && !items.length) return Promise.resolve();
        if (!idle) idle = new Promise((r) => { markIdle = r; });
        return idle;
      },
    };
  }

  // Soonest first: an event list is a diary, not a ranking - and within a day,
  // by the clock rather than by whichever angle happened to answer first.
  // Applied on every arrival now rather than once at the end, which is what
  // lets a 09:00 market landing after a 21:00 gig appear above it.
  function sortEventsByWhen(list) {
    return list.sort((a, b) => {
      const day = new Date(a.startsAt) - new Date(b.startsAt);
      if (day) return day;
      const at = timeToMinutes(a.time);
      const bt = timeToMinutes(b.time);
      if (at == null && bt == null) return 0;
      if (at == null) return -1;
      if (bt == null) return 1;
      return at - bt;
    });
  }

  // Everything one angle's answer has to go through on its way to the screen.
  // Pulled out of the old all-at-once loop unchanged; the only difference is
  // that it now runs six times, as each angle reports, instead of once after
  // all six have.
  function absorbAngle(answer, ctx) {
    const fresh = [];
    // Uncapped. The cap was a guard against a model returning something
    // enormous, but everything downstream already filters hard - the date
    // window, the anchor, the dedupe - and the one thing this screen must not
    // do is throw away real answers to keep a list tidy. Fifty found is fifty
    // shown.
    (answer.list || []).forEach((item) => {
      const event = normaliseEvent(item, ctx.window);
      if (!event) {
        // Two different failures wearing one name. "The model gave no usable
        // date" and "it is real but not in the days you asked about" want
        // different answers from you, so they are counted and said apart.
        if (!parseEventDate(item && item.date)) eventsDropped.undated++;
        else eventsDropped.outside++;
        return;
      }
      if (!stillOnAt(event, ctx.cutoff)) {
        eventsDropped.finished++;
        return;
      }
      const id = eventFingerprint(event);
      const existing = ctx.seen.get(id);
      if (existing && sameEventPlace(existing.event, event)) {
        // Found from two angles is a small vote of confidence, and worth
        // keeping whichever version knows more. The row may already be on
        // screen by now, so this enriches it in place rather than adding one.
        eventsDropped.merged++;
        existing.angles.push(answer.angle);
        if (!existing.event.ticketUrl && event.ticketUrl) existing.event.ticketUrl = event.ticketUrl;
        if (!existing.event.venue && event.venue) existing.event.venue = event.venue;
        if (!existing.event.time && event.time) existing.event.time = event.time;
        if (!existing.event.endTime && event.endTime) existing.event.endTime = event.endTime;
        if (!existing.event.description && event.description) existing.event.description = event.description;
        return;
      }
      // Same name, same day, different town: two events, not one.
      const dedupeKey = existing ? `${id}|${String(event.area || "").toLowerCase()}` : id;
      if (ctx.seen.has(dedupeKey)) return;
      const entry = { event, sources: answer.sources || [], angles: [answer.angle] };
      ctx.seen.set(dedupeKey, entry);
      fresh.push(entry);
    });
    return fresh;
  }

  // Placing one event: unchanged in what it decides, only in when it runs.
  async function placeOne(entry, ctx) {
    const { event, sources, angles: found } = entry;
    const spot = await placeEvent(event, ctx.centre, ctx.anchor);
    // Neither of these is a reason to pretend the listing does not exist. It
    // has a name, a date, usually a venue and often a ticket link; the only
    // thing missing is a pin, and hiding the whole thing over a pin is how a
    // list of forty turns into a list of six. They are kept aside, counted,
    // and shown on request with the reason attached.
    if (!spot) {
      eventsDropped.unplaced++;
      eventsHeldBack.push(Object.assign({}, event, { kinds: found, sources, why: "couldn't be placed on the map" }));
      return null;
    }
    if (spot.tooFar) {
      eventsDropped.tooFar++;
      eventsHeldBack.push(Object.assign({}, event, { kinds: found, sources, why: "looks like it's somewhere else" }));
      return null;
    }
    return Object.assign(event, {
      lat: spot.lat,
      lon: spot.lon,
      address: spot.address,
      approximate: spot.approximate,
      website: event.ticketUrl || spot.website || null,
      kinds: found,
      // Said out loud on every row. A model inventing a festival is the
      // obvious way this goes wrong, and the honest answer is not to hide it
      // but to hand over the page it came from.
      aiSuggested: true,
      unverified: true,
      sources,
    });
  }

  // ---------- What's on ----------
  // Events were a category inside the place search, which was the wrong shape
  // for them in two ways. They were mixed into a list of permanent places
  // where the only thing that matters about them - when - had nowhere to sit;
  // and finding them meant knowing to open Explore, pick a centre, scroll a
  // category sheet and choose the odd one out. A thing you check every morning
  // of a trip should not be four taps deep inside something else.
  const eventSearch = {
    when: "trip",
    kinds: [], // empty means all six angles
    status: "idle", // idle | loading | done | error
    results: [],
    error: "",
    centre: null,
    // Whether the ones that couldn't be confirmed are on screen. Off by
    // default - they are worse answers - but never more than one tap away,
    // because the alternative is an app that quietly decides for you.
    showHeld: false,
    // Whether the form is open. It starts closed, closes itself once a search
    // has answered, and any tap on the summary opens it again. It used to
    // start open, which meant the screen you arrived on was a form: five when
    // chips, nine kind chips, nine pencils and a button, with the button
    // itself 880px down a 844px phone - under the fold, on the screen whose
    // whole job is telling you what is on.
    editing: false,
    // Whether the per-kind prompt editors are showing. Nine pencils inside an
    // already-busy form is the same mistake one level down, and editing what
    // the model is asked is a thing you do once, not every search.
    tuning: false,
    // When these results were originally found, if they came from the cache
    // rather than from nine fresh requests. Zero means they are new.
    fromCache: 0,
    // Which of the six have reported: waiting | running | done | failed |
    // stopped. The one piece of state this object never had, and the reason
    // a search could only ever say "this takes a few seconds".
    angles: {},
    stopped: false,
    // The search's own context, kept so a single failed angle can be re-run
    // against the same question rather than starting over.
    ctx: null,
    // The indoor filter. Off by default and only offered when rain is
    // actually forecast - a filter that is always there is a filter you
    // scroll past, and one that appears on a wet day is an answer.
    indoorOnly: false,
    // Results you have thrown out. A list of forty is only useful if the ones
    // you have looked at and rejected stop taking up room in it - and a pasted
    // answer can arrive with things you can see at a glance are wrong.
    dismissed: [],
  };

  function savedEvents() {
    return loadPicks().filter((p) => p.kind === "event");
  }

  // Grouped under the day they are on, because a list of events is a diary.
  function groupEventsByDay(list) {
    const days = new Map();
    list.forEach((e) => {
      const when = e.startsAt ? new Date(e.startsAt) : null;
      if (!when || Number.isNaN(when.getTime())) return;
      const key = isoDate(when);
      if (!days.has(key)) days.set(key, { when, items: [] });
      days.get(key).items.push(e);
    });
    return Array.from(days.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, day]) => ({
        key,
        when: day.when,
        // Within a day, by the clock. The date lives in startsAt and the time
        // in a separate string, so sorting on startsAt alone put the 21:00
        // folk session above the 09:00 market - which is not a diary, it is a
        // list in the order the answers happened to arrive.
        items: day.items.slice().sort((a, b) => {
          const at = timeToMinutes(a.time);
          const bt = timeToMinutes(b.time);
          // Something with no time is an all-day thing, and belongs at the top
          // of its day rather than sorted as though it were midnight.
          if (at == null && bt == null) return String(a.name).localeCompare(String(b.name));
          if (at == null) return -1;
          if (bt == null) return 1;
          return at - bt;
        }),
      }));
  }

  function eventDayHeading(when) {
    const today = startOfDay(new Date());
    const day = startOfDay(when);
    const diff = Math.round((day - today) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff > 1 && diff < 7) return when.toLocaleDateString("en-GB", { weekday: "long" });
    return humanDate(when);
  }

  // One event, as a row. The same shape whether it is a search result you
  // might save or something already saved.
  function eventRow(e, index, saved, opts) {
    const held = opts && typeof opts.heldIndex === "number" ? opts.heldIndex : null;
    const time = e.time
      ? `<span class="ev-time">${esc(e.time)}${
          e.endTime ? `<span class="ev-until">–${esc(e.endTime)}</span>` : ""
        }</span>`
      : `<span class="ev-time ev-time-none">all day</span>`;
    const where = [e.venue, e.area].filter(Boolean).join(", ");
    const runs = e.endsAt
      ? ` <span class="ev-runs">until ${esc(humanDate(new Date(e.endsAt)))}</span>`
      : "";
    const tags = [
      e.price ? `<span class="ev-tag">${esc(e.price)}</span>` : "",
      e.recurring ? `<span class="ev-tag">every week</span>` : "",
      // Said plainly rather than left to be inferred from silence, which is
      // what "we don't know" looks like when nobody writes it down.
      e.setting === "indoor" ? `<span class="ev-tag">indoors</span>` : "",
      e.setting === "outdoor" ? `<span class="ev-tag">outdoors</span>` : "",
      e.setting === "both" ? `<span class="ev-tag">some of it indoors</span>` : "",
      !e.setting ? `<span class="ev-tag soft">indoors or out, not sure</span>` : "",
      e.approximate ? `<span class="ev-tag soft">approx. location</span>` : "",
    ].join("");

    // The one thing that would stop you going. Six badges on a row is a row
    // nobody reads, and only one of the six is ever the reason.
    const forecast = eventForecast(e, redrawEventsOnWeather);
    const verdict = eventVerdict(e, { rainChance: forecast ? forecast.rainChance : null });

    return `
      <div class="ev-row${saved ? " ev-saved" : ""}">
        ${
          // Saved ones are deleted properly, with an undo; a search result is
          // only thrown off this list, because there is nothing of yours in it
          // to lose.
          saved
            ? `<button class="ev-drop" data-drop-saved="${esc(e.id)}" aria-label="Remove ${esc(
                e.name
              )}">${icon("close", { size: 15 })}</button>`
            : held != null
              ? ""
              : `<button class="ev-drop" data-drop-result="${esc(eventFingerprint(e))}" aria-label="Hide ${esc(
                  e.name
                )}">${icon("close", { size: 15 })}</button>`
        }
        ${time}
        <div class="ev-main">
          <div class="ev-name">${esc(e.name)}${runs}</div>
          ${where ? `<div class="ev-where">${esc(where)}</div>` : ""}
          ${e.description ? `<div class="ev-what">${esc(e.description)}</div>` : ""}
          ${
            verdict
              ? `<div class="ev-verdict ev-verdict-${esc(verdict.tone)}">${icon(
                  verdict.tone === "yes" ? "check" : verdict.tone === "warn" ? "clock" : "alert",
                  { size: 14, cls: "ico-inline" }
                )} ${esc(verdict.text)}</div>`
              : ""
          }
          <div class="ev-tags">${tags}</div>
          <div class="ev-actions">
            ${
              saved
                ? `<button class="ev-btn" data-open-pick="${esc(e.id)}">Details</button>`
                : held != null
                  ? `<button class="ev-btn" data-save-held="${held}">＋ Save anyway</button>`
                  : `<button class="ev-btn ev-btn-primary" data-save-event="${index}">＋ Save</button>`
            }
            ${
              // Free: a URL, not a request. Every event that has been placed
              // at all can be opened on a map, which is most of them.
              eventMapsUrl(e)
                ? `<button class="ev-btn" data-open-maps="${esc(eventMapsUrl(e))}">${icon("pin", {
                    size: 14,
                    cls: "ico-inline",
                  })} Maps</button>`
                : ""
            }
            ${e.ticketUrl ? `<button class="ev-btn" data-open-maps="${esc(e.ticketUrl)}">Tickets & info</button>` : ""}
            ${
              // Whatever there is to check it against: the pages the app's own
              // search was grounded on, or - for one that arrived by hand -
              // the page the answer said it was listed on.
              (() => {
                const url = (e.sources && e.sources.length && e.sources[0].uri) || e.listedAt || "";
                return url
                  ? `<button class="ev-btn" data-open-maps="${esc(url)}">Where this came from</button>`
                  : "";
              })()
            }
            ${
              // Not a button, because there is nowhere to go. An answer you
              // cannot click through to check should say so, which is the
              // same standard the "check it's on" badge already sets.
              e.pastedIn && !e.listedAt ? `<span class="ev-tag soft">pasted in, no link</span>` : ""
            }
            ${
              e.pastedIn && e.listedAt ? `<span class="ev-tag soft">pasted in</span>` : ""
            }
          </div>
        </div>
      </div>
    `;
  }

  function agoWords(at) {
    const mins = Math.round((Date.now() - at) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }

  // The searches of the last week, on the screen rather than only in the
  // cache. Kept above the results so it is the first thing you see when you
  // arrive with nothing loaded - which is the state that used to force a
  // fresh search just to read Tuesday's answers.
  function renderRecentSearches() {
    const recent = recentEventSearches();
    if (!recent.length) return "";
    // Not the one already on screen: offering to reload what you are looking
    // at is a row that does nothing.
    const showing = recent.filter((r) => !(eventSearch.fromCache && r.at === eventSearch.fromCache));
    if (!showing.length) return "";

    let html = `<div class="section-label list-head"><span>Earlier searches</span><span class="list-head-count">${showing.length}</span></div>`;
    html += `<div class="card more-list">`;
    html += showing
      .map((r) => {
        const m = r.meta || {};
        const kinds = Array.isArray(m.kinds) && m.kinds.length
          ? EVENT_ANGLES.filter((a) => m.kinds.includes(a.key)).map((a) => a.label).join(", ")
          : "everything";
        return `
          <button class="more-row" data-recent="${esc(r.key)}">
            <span class="more-row-ico">${icon("events", { size: 20 })}</span>
            <span class="more-row-main">
              <span class="more-row-title">${esc(m.centre || "Nearby")} · ${esc(m.label || "")}</span>
              <span class="more-row-meta">${r.count} still to come · ${esc(kinds)} · ${
                m.pasted ? "pasted in" : "found"
              } ${esc(agoWords(r.at))}</span>
            </span>
            ${icon("forward", { size: 16, cls: "more-row-go" })}
          </button>`;
      })
      .join("");
    html += `</div>`;
    html += `<p class="settings-hint">Kept for a week, then dropped. Opening one costs nothing —
      it shows what was found at the time, with anything that has since been and gone taken out.
      <button class="link-btn" id="evForget">Forget these</button></p>`;
    return html;
  }

  // Two buttons, and the clipboard for everything else. Plain https addresses
  // on purpose: these are the ones the apps themselves claim on Android, so
  // the same link opens the app when it is installed and the site when it is
  // not - no custom schemes, which are undocumented and break silently.
  const ASSISTANTS = [
    { key: "chatgpt", label: "Open ChatGPT", url: "https://chatgpt.com/" },
    { key: "gemini", label: "Open Gemini", url: "https://gemini.google.com/app" },
  ];

  async function openHandoffSheet() {
    const centre = eventSearch.centre || loadAnchor() || derivedAnchor();
    if (!centre || centre.lat == null) {
      toast("Say where to look first");
      return;
    }
    const radius = (centre.miles || DEFAULT_ANCHOR_MILES) * 1609;
    let towns = [];
    try {
      towns = await townsAround(centre, radius);
    } catch (e) {
      // The prompt is still worth having without the village names.
    }
    const prompt = handoffPrompt(centre, eventSearch.when, radius, towns);

    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="Ask somewhere else">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">${icon("close", { size: 17, cls: "ico-inline" })}</button>
          <div class="modal-body">
            <h2 class="modal-title">Ask somewhere else</h2>
            <div class="modal-subtitle">One question covering all ${EVENT_ANGLES.length} kinds, for ${esc(
              centre.name
            )}</div>

            <p class="settings-hint">
              Copy this, paste it into whichever assistant you use, then bring the answer back
              below. It uses no key and no requests of your own — and if you're paying for a
              better model than the free tier, this is how to point it at your trip.
            </p>
            <textarea class="settings-input notes-box" id="handoffPrompt" rows="6" readonly>${esc(prompt)}</textarea>
            <div class="settings-btn-row" style="margin-top:10px;">
              <button class="modal-btn modal-btn-primary" id="handoffCopy">Copy the question</button>
            </div>
            <div class="settings-btn-row" style="margin-top:8px;">
              ${ASSISTANTS.map(
                (a) =>
                  `<button class="modal-btn" data-assistant="${esc(a.key)}">${esc(a.label)}</button>`
              ).join("")}
            </div>
            <p class="settings-hint">
              These open the app if you have it installed, and the website if you don't.
            </p>

            <label class="settings-label" style="margin-top:18px;">Paste the answer here</label>
            <textarea class="settings-input notes-box" id="handoffAnswer" rows="5"
              placeholder="Paste the whole reply — it will find the list inside it."></textarea>
            <button class="modal-btn modal-btn-primary" id="handoffAdd" style="width:100%;margin-top:10px;">Add these events</button>
            <pre class="settings-result" id="handoffResult" hidden></pre>
            <p class="settings-hint">
              Anything pasted is checked exactly as a searched result is — the dates, the area,
              the duplicates. It just arrives with no page to click through to, so it says
              “pasted in” rather than offering you a source.
            </p>
          </div>
        </div>
      </div>
    `;
    placeModal.classList.add("open");
    makeSheetDraggable(placeModal, closePlaceModal);

    placeModal.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target === el) closePlaceModal();
      });
    });

    document.getElementById("handoffCopy").addEventListener("click", async () => {
      const box = document.getElementById("handoffPrompt");
      let copied = false;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(prompt);
          copied = true;
        } catch (e) {
          // Falls through to selecting it, which a long-press can copy.
        }
      }
      if (copied) {
        toast("Copied — paste it into the assistant");
      } else {
        box.focus();
        box.select();
        toast("Selected — long-press to copy");
      }
    });

    placeModal.querySelectorAll("[data-assistant]").forEach((b) =>
      b.addEventListener("click", () => {
        const a = ASSISTANTS.find((x) => x.key === b.getAttribute("data-assistant"));
        if (!a) return;
        // Deliberately not a deep link with the prompt in the URL. Those are
        // undocumented, change without notice, and silently truncate a prompt
        // this long - which would look like the app sending a worse question
        // than it wrote. The clipboard is the reliable route, and works for
        // every assistant rather than the two with buttons.
        openInOwningApp(a.url);
      })
    );

    document.getElementById("handoffAdd").addEventListener("click", async () => {
      const out = document.getElementById("handoffResult");
      const text = document.getElementById("handoffAnswer").value;
      out.hidden = false;
      out.className = "settings-result";
      out.textContent = "Reading it…";
      const res = await absorbPastedEvents(text);
      out.className = "settings-result " + (res.ok ? "ok" : "bad");
      out.textContent = res.message;
      if (res.ok) document.getElementById("handoffAnswer").value = "";
    });
  }

  // Offered in both states of the search bar. It lived only inside the open
  // form, so the moment a search returned anything the form folded and took
  // the way to it with it - which is precisely when somebody who has run out
  // of quota needs it.
  function handoffLink() {
    return `<button class="link-btn ev-handoff-link" id="evHandoff">Ask somewhere else and paste the answer</button>`;
  }

  function renderEventsSearchBar() {
    const w = eventWindow(eventSearch.when);
    const centre = eventSearch.centre || loadAnchor() || derivedAnchor();

    // The form has done its job the moment you press the button, not when the
    // search finishes. Left open it is three rows of chips, a date line, six
    // more chips and a button - the whole screen - so results streaming in
    // arrive below the fold and you are back to looking at nothing.
    if (!eventSearch.editing) {
      const kinds = eventSearch.kinds.length
        ? EVENT_ANGLES.filter((a) => eventSearch.kinds.includes(a.key)).map((a) => a.label).join(", ")
        : "everything";
      return `
        <button class="card ev-asked" id="evEdit">
          <span class="ev-asked-main">
            <b>${centre ? esc(centre.name) : "Nearby"}</b>
            <span class="ev-asked-meta">${esc(w.label)}${w.fromTime ? `, from ${esc(w.fromTime)}` : ""} · ${esc(kinds)}</span>
          </span>
          <span class="ev-asked-change">${eventSearch.status === "loading" ? "Looking…" : "Change"}</span>
        </button>
        ${
          // The button belongs with the summary while there is nothing to
          // read yet. Once results are on screen it would only push them
          // down, and "Change" on the bar above already leads back here.
          eventSearch.status !== "loading" && !eventSearch.results.length
            ? `<button class="modal-btn modal-btn-primary ev-go" id="evSearch">
                 ${icon("search", { size: 17, cls: "ico-inline" })} See what's on
               </button>`
            : ""
        }
        ${eventSearch.status === "loading" ? "" : handoffLink()}
      `;
    }

    return `
      <div class="card ev-ask">
        <div class="ev-ask-head">
          <b>${centre ? `What's on near ${esc(centre.name)}` : "What's on"}</b>
          <button class="link-btn" id="evAskDone">Done</button>
        </div>
        <button class="link-btn ev-ask-where" id="evCentre">${centre ? "Somewhere else" : "Choose where"}</button>
        <div class="ev-field-label">When</div>
        <div class="search-chips">
          ${EVENT_WINDOWS.map(
            (x) =>
              `<button class="search-chip${eventSearch.when === x.key ? " on" : ""}" data-ev-when="${esc(x.key)}">${esc(
                x.label
              )}</button>`
          ).join("")}
          <button class="search-chip${eventSearch.when === "custom" ? " on" : ""}" data-ev-when="custom">Pick dates</button>
        </div>
        ${
          eventSearch.when === "custom"
            ? `
          <div class="ev-dates">
            <label class="ev-field">
              <span>From</span>
              <input type="date" id="evFrom" value="${esc(customWindow.from)}" />
            </label>
            <label class="ev-field">
              <span>To</span>
              <input type="date" id="evTo" value="${esc(customWindow.to)}" />
            </label>
            <label class="ev-field">
              <span>From time</span>
              <input type="time" id="evFromTime" value="${esc(customWindow.fromTime)}" />
            </label>
          </div>
          <p class="settings-hint">
            The time is a starting point, not a start time — pick 15:00 and a market that
            ran 09:00–21:00 still counts, while one that finished at 14:00 does not. It only
            applies to the first day. Anything with no finish time listed is taken to run
            about ${ASSUMED_EVENT_HOURS} hours.
            ${customWindow.fromTime ? `<button class="link-btn" id="evClearTime">Any time</button>` : ""}
          </p>`
            : ""
        }
        <p class="explore-note">${
          // One day is a day, not a range from itself to itself.
          isoDate(w.from) === isoDate(w.to)
            ? esc(humanDate(w.from))
            : `${esc(humanDate(w.from))} – ${esc(humanDate(w.to))}`
        }${w.fromTime ? `, from ${esc(w.fromTime)}` : ""}</p>
        <div class="ev-field-label">What to find ${
          eventSearch.kinds.length
            ? `<button class="link-btn" id="evAllKinds">all ${EVENT_ANGLES.length}</button>`
            : `<span class="ev-field-note">all ${EVENT_ANGLES.length}</span>`
        }</div>
        <div class="search-chips ev-kinds">
          ${EVENT_ANGLES.map((a) => {
            const tuned = !!loadTripSettings().anglePrompts[a.key];
            return `<span class="ev-kind-wrap">
              <button class="search-chip${eventSearch.kinds.includes(a.key) ? " on" : ""}${
                tuned ? " tuned" : ""
              }" data-ev-kind="${esc(a.key)}">${esc(a.label)}</button>
              ${
                eventSearch.tuning
                  ? `<button class="ev-kind-tune" data-ev-tune="${esc(a.key)}" aria-label="Change what ${esc(
                      a.label
                    )} looks for">✎</button>`
                  : ""
              }
            </span>`;
          }).join("")}
        </div>
        <button class="link-btn ev-tune-toggle" id="evTuneToggle">${
          eventSearch.tuning ? "Done fine-tuning" : "Fine-tune what we ask"
        }</button>
        <p class="settings-hint">
          ${
            eventSearch.kinds.length
              ? `${eventSearch.kinds.length} of ${EVENT_ANGLES.length} picked — ${eventSearch.kinds.length} request${
                  eventSearch.kinds.length === 1 ? "" : "s"
                } rather than ${EVENT_ANGLES.length}.`
              : `All ${EVENT_ANGLES.length} at once, which is how it finds the coffee morning as well as the festival. Tap any to narrow it.`
          }
        </p>
        <button class="modal-btn modal-btn-primary ev-go" id="evSearch">
          ${eventSearch.status === "loading" ? "Looking…" : `${icon("search", { size: 17, cls: "ico-inline" })} See what's on`}
        </button>
        ${handoffLink()}
      </div>
    `;
  }

  // The answer to "there must be more than this". Everything the search threw
  // away, counted by reason - and the ones that are still perfectly good
  // listings, offered anyway rather than binned on your behalf.
  // Whether any day these results fall on is forecast wet. Nothing is offered
  // when nothing is known - a trip beyond the sixteen-day forecast gets no
  // chip and no claim about the weather.
  // The redraw a forecast arriving should cause. It has to be the same one
  // everywhere on this screen: weatherFor only keeps the callback from the
  // call that STARTS the fetch, so whichever asks first is the only one that
  // gets told. Asking once without a callback - as this function used to -
  // meant the rows asking afterwards silently registered nothing, and the
  // forecast landed with nobody listening. No chip, no rain warning, no clue.
  function redrawEventsOnWeather() {
    if (view.dataset.activeTab === "events") renderEvents();
  }

  function rainIsComing(list) {
    let worst = null;
    list.forEach((e) => {
      const f = eventForecast(e, redrawEventsOnWeather);
      if (f && f.rainChance != null && (worst == null || f.rainChance > worst)) worst = f.rainChance;
    });
    return worst != null && worst >= WET_ENOUGH ? worst : null;
  }

  // An event nobody described is not an event we get to throw away. It stays
  // in the list, marked "not sure", exactly as an approximate location and an
  // unconfirmed listing already do on these rows.
  function passesIndoorFilter(e) {
    if (!eventSearch.indoorOnly) return true;
    return e.setting !== "outdoor";
  }

  function isDismissed(e) {
    return eventSearch.dismissed.indexOf(eventFingerprint(e)) >= 0;
  }

  // Six searches, named, each saying where it has got to. The old version was
  // one motionless sentence for the length of the slowest of them - which,
  // when one angle hangs, is ninety seconds of an app that looks broken.
  const ANGLE_STATE_LABEL = { waiting: "…", running: "…", done: "✓", failed: "—", stopped: "—" };

  function renderAngleProgress() {
    const angles = anglesForSearch();
    const state = (k) => eventSearch.angles[k] || "waiting";
    const running = angles.some((a) => state(a.key) === "running" || state(a.key) === "waiting");
    const failed = angles.filter((a) => state(a.key) === "failed");

    let html = `<div class="card ev-progress">`;
    html += `<div class="ev-progress-chips">${angles
      .map(
        (a) =>
          `<span class="ev-angle ev-angle-${esc(state(a.key))}">${esc(a.label)} <span class="ev-angle-mark">${
            ANGLE_STATE_LABEL[state(a.key)]
          }</span></span>`
      )
      .join("")}</div>`;

    if (running) {
      html += `<p class="settings-hint">${
        eventSearch.results.length
          ? `${eventSearch.results.length} so far — the rest are still looking.`
          : "Looking. Results appear as each search answers rather than all at the end."
      }</p>`;
      html += `<button class="link-btn" id="evStop">Stop and keep what's found</button>`;
    } else if (eventSearch.stopped) {
      html += `<p class="settings-hint">Stopped — the ${eventSearch.results.length} already found ${
        eventSearch.results.length === 1 ? "is" : "are"
      } kept.</p>`;
    }

    if (failed.length && !running) {
      // A search that died and a town with nothing on look identical unless
      // this is said out loud - and the answer to one is to try again, while
      // the answer to the other is to look somewhere else.
      html += `<p class="settings-hint">${failed
        .map((a) => esc(a.label))
        .join(" and ")} came back with nothing. ${
        failed.length === 1 ? "That may be the search failing rather than a quiet week." : ""
      }</p>`;
      html += failed
        .map((a) => `<button class="link-btn" data-ev-retry="${esc(a.key)}">Try ${esc(a.label)} again</button>`)
        .join(" ");
    }
    html += `</div>`;
    return html;
  }

  // Directly under the count, not at the bottom of the list. The whole
  // complaint was "there must be more than this" - an explanation you only
  // reach by scrolling past everything answers it far too late.
  function renderEventsLeftOutNote() {
    const why = describeEventDrops();
    if (!why) return "";
    const held = eventsHeldBack;
    return `
      <div class="card ev-leftout">
        <p class="settings-hint">Left out: ${esc(why)}.</p>
        ${
          held.length
            ? `<button class="link-btn" id="evShowHeld">${
                eventSearch.showHeld ? "Hide the unconfirmed ones" : `Show the ${held.length} it couldn't confirm`
              }</button>`
            : ""
        }
      </div>`;
  }

  // The rows themselves stay at the bottom, under the confirmed ones. They
  // are worse answers and should read as worse answers.
  function renderEventsHeld() {
    const held = eventsHeldBack;
    if (!held.length || !eventSearch.showHeld) return "";
    let html = `<div class="section-label list-head"><span>Couldn't be confirmed</span><span class="list-head-count">${held.length}</span></div>`;
    html += `<div class="card ev-leftout"><p class="settings-hint">These have a name and a date but nowhere confirmed to put them on the map. Worth checking the link before you go.</p></div>`;
    held.forEach((e, i) => {
      html += `<div class="ev-held-why">${esc(e.why || "")}</div>`;
      html += eventRow(e, -1, false, { heldIndex: i });
    });
    return html;
  }

  // What screen this is, for the purposes of keeping your place. Deliberately
  // not the result count: results arriving is exactly when the position must
  // be kept, so counting them would defeat the whole thing.
  let eventsScreenId = "";

  function renderEvents() {
    // Results arrive one at a time now and each arrival redraws this screen.
    // Without keeping the scroll, the list jumps back to the top under your
    // thumb every couple of seconds - the same bug the search overlay and the
    // trip planner both already had, and fixed this way.
    beginRenderPass();
    const previousScroll = view.scrollTop;
    const screenId = `${eventSearch.when}|${eventSearch.editing}|${eventSearch.tuning}|${eventSearch.indoorOnly}|${eventSearch.showHeld}`;
    // A redraw destroys whatever is focused, so a date being typed into the
    // custom-window editor is lost mid-edit. The search overlay guards this
    // same way: while somebody is in a field, the screen waits.
    const active = document.activeElement;
    if (active && view.contains(active) && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
      // Refused, not forgotten: the listener goes on the field being typed in,
      // because wireEvents does not run on a render that did not happen - and
      // without it the results that arrived mid-edit would never appear.
      endRenderPass();
      if (!eventsRedrawPending) {
        eventsRedrawPending = true;
        active.addEventListener(
          "blur",
          () => {
            if (eventsRedrawPending) renderEvents();
          },
          { once: true }
        );
      }
      return;
    }
    eventsRedrawPending = false;

    const saved = savedEvents();
    const upcoming = saved.filter((e) => !eventIsPast(e));
    const past = saved.filter(eventIsPast);

    let html = `
      <div class="kids-head">
        <h1 class="kids-title">What's on</h1>
        <p class="kids-sub">${
          upcoming.length
            ? `${upcoming.length} coming up`
            : "Things with a date on them — gigs, markets, shows, one-offs"
        }</p>
      </div>
    `;

    html += renderEventsSearchBar();

    if (eventSearch.status === "error") {
      html += `<div class="card"><p class="pick-status">${esc(eventSearch.error)}</p></div>`;
    }

    // Above the results, because when there are none this is the whole point
    // of the screen: what you already know, without asking again.
    if (eventSearch.status !== "loading") html += renderRecentSearches();

    if (eventSearch.status === "loading" || Object.keys(eventSearch.angles).length) {
      html += renderAngleProgress();
    }

    if (eventSearch.results.length) {
      const savedIds = new Set(saved.map((p) => p.id));
      const unsaved = eventSearch.results.filter(
        (e) => !savedIds.has(pickId("custom", e.name)) && !isDismissed(e)
      );
      const fresh = unsaved.filter(passesIndoorFilter);
      const already = eventSearch.results.length - unsaved.length;
      const hiddenByFilter = unsaved.length - fresh.length;
      // The count used to be the number found while the list below it showed
      // the number found minus the ones already saved - so "Found 12" sat on
      // top of seven rows with nothing to explain the other five. The header
      // now counts what is actually underneath it and says where the rest
      // went.
      html += `<div class="section-label list-head"><span>Found</span><span class="list-head-count">${fresh.length}</span></div>`;
      if (already) {
        html += `<p class="settings-hint ev-note">${already} of the ${eventSearch.results.length} found ${
          already === 1 ? "is" : "are"
        } already in your list, below.</p>`;
      }
      // The chip only exists on a day the forecast has an opinion about, and
      // it changes nothing until it is tapped.
      const wet = rainIsComing(unsaved);
      if (wet != null || eventSearch.indoorOnly) {
        html += `
          <div class="search-chips ev-weather-chips">
            <button class="search-chip${eventSearch.indoorOnly ? " on" : ""}" id="evIndoorOnly">
              Under cover${wet != null ? ` · ${wet}% rain` : ""}
            </button>
          </div>`;
        html += `<p class="settings-hint ev-note">${
          eventSearch.indoorOnly
            ? `Hiding ${hiddenByFilter} that ${
                hiddenByFilter === 1 ? "is" : "are"
              } definitely outdoors. Anything nobody described is still here, marked as such.`
            : "Rain forecast. This keeps the indoor ones, and the ones nobody described either way."
        }</p>`;
      }
      if (eventSearch.fromCache) {
        const mins = Math.round((Date.now() - eventSearch.fromCache) / 60000);
        const when =
          mins < 60 ? `${mins || 1} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
        html += `<p class="settings-hint ev-note">Remembered from ${esc(when)} — no requests used.
          <button class="link-btn" id="evFresh">Look again</button></p>`;
      }
      html += renderEventsLeftOutNote();
      if (!fresh.length) {
        html += `<div class="card"><p class="pick-status">${
          unsaved.length ? "Nothing left once the outdoor ones are hidden." : "Everything found is already saved."
        }</p></div>`;
      }
      groupEventsByDay(fresh).forEach((day) => {
        html += `<div class="ev-day">${esc(eventDayHeading(day.when))} <span class="ev-day-date">${esc(
          humanDate(day.when)
        )}</span></div>`;
        day.items.forEach((e) => {
          html += eventRow(e, eventSearch.results.indexOf(e), false);
        });
      });
      html += renderEventsHeld();
      html += `<p class="settings-hint ev-caveat">${icon("alert", {
        size: 14,
        cls: "ico-inline",
      })} Found by searching the web. Worth a check before you set off — every one links where it came from.</p>`;
      // Said once, plainly. A closed Facebook group needs a login and is not
      // indexed by anything; neither is an Instagram feed. Without saying so,
      // a genuinely quiet week and a village that only posts to a group look
      // identical - and the difference decides whether you go looking
      // elsewhere or assume the app is broken.
      html += `<p class="settings-hint ev-caveat">${icon("info", {
        size: 14,
        cls: "ico-inline",
      })} Nine searches, through parish newsletters, hall and church pages, council and library
         listings, clubs and the small ticketing sites. Closed Facebook groups and Instagram
         can't be searched by anything — if you know about something from there,
         <button class="link-btn" id="evAddByHand">add it by hand</button> and it gets a pin,
         a day and reminders like the rest.</p>`;
    }

    if (upcoming.length) {
      html += `<div class="section-label list-head"><span>Saved</span><span class="list-head-count">${upcoming.length}</span></div>`;
      groupEventsByDay(upcoming).forEach((day) => {
        html += `<div class="ev-day">${esc(eventDayHeading(day.when))} <span class="ev-day-date">${esc(
          humanDate(day.when)
        )}</span></div>`;
        day.items.forEach((e) => {
          html += eventRow(e, -1, true);
        });
      });
    }

    if (past.length) {
      html += `<div class="section-label list-head"><span>Been and gone</span><span class="list-head-count">${past.length}</span></div>`;
      past.forEach((e) => {
        html += eventRow(e, -1, true);
      });
    }

    if (!upcoming.length && !past.length && eventSearch.status === "idle") {
      html += `
        <div class="card">
          <p class="pick-status">Nothing saved yet. Everything else in this app is a place, which is there whether you
             go on Tuesday or in March — this is the part that is only on while you're here.</p>
        </div>
      `;
    }

    view.innerHTML = html;
    view.scrollTop = screenId === eventsScreenId ? previousScroll : 0;
    eventsScreenId = screenId;
    endRenderPass();
    wireEvents();
  }

  // A redraw refused while a field was focused still has to happen once the
  // field is done with, or the results that arrived while you were typing
  // never appear at all.
  let eventsRedrawPending = false;

  function wireEvents() {
    view.querySelectorAll("[data-ev-when]").forEach((b) =>
      b.addEventListener("click", () => {
        eventSearch.when = b.getAttribute("data-ev-when");
        renderEvents();
      })
    );

    view.querySelectorAll("[data-ev-tune]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        openAngleTuner(b.getAttribute("data-ev-tune"));
      })
    );

    view.querySelectorAll("[data-ev-kind]").forEach((b) =>
      b.addEventListener("click", () => {
        const key = b.getAttribute("data-ev-kind");
        // Tapping one narrows to it; tapping the last one off goes back to
        // all six, because a search for nothing is not a thing anybody wants.
        const i = eventSearch.kinds.indexOf(key);
        if (i >= 0) eventSearch.kinds.splice(i, 1);
        else eventSearch.kinds.push(key);
        renderEvents();
      })
    );

    [
      ["evFrom", "from"],
      ["evTo", "to"],
      ["evFromTime", "fromTime"],
    ].forEach(([id, field]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => {
        customWindow[field] = el.value;
        // Picking a start date and no end means that one day, which is what
        // somebody choosing a single date on a calendar means by it.
        if (field === "from" && !customWindow.to) customWindow.to = el.value;
        renderEvents();
      });
    });

    const clearTime = document.getElementById("evClearTime");
    if (clearTime) {
      clearTime.addEventListener("click", () => {
        customWindow.fromTime = "";
        renderEvents();
      });
    }

    const centreBtn = document.getElementById("evCentre");
    if (centreBtn) {
      centreBtn.addEventListener("click", () => {
        openAnchorSheet(() => {
          eventSearch.centre = loadAnchor();
          renderEvents();
        });
      });
    }

    const go = document.getElementById("evSearch");
    if (go) go.addEventListener("click", () => runEventSearch());

    const edit = document.getElementById("evEdit");
    if (edit) {
      edit.addEventListener("click", () => {
        eventSearch.editing = true;
        renderEvents();
      });
    }

    const askDone = document.getElementById("evAskDone");
    if (askDone) {
      askDone.addEventListener("click", () => {
        eventSearch.editing = false;
        renderEvents();
      });
    }

    const tuneToggle = document.getElementById("evTuneToggle");
    if (tuneToggle) {
      tuneToggle.addEventListener("click", () => {
        eventSearch.tuning = !eventSearch.tuning;
        renderEvents();
      });
    }

    const byHand = document.getElementById("evAddByHand");
    if (byHand) byHand.addEventListener("click", () => openSearchOverlay(""));

    view.querySelectorAll("[data-drop-result]").forEach((b) =>
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-drop-result");
        if (eventSearch.dismissed.indexOf(id) < 0) eventSearch.dismissed.push(id);
        renderEvents();
        // Undoable, because a mis-tap on a small button beside a row you
        // wanted is otherwise unrecoverable without searching again.
        toastWithAction("Hidden", "Undo", () => {
          eventSearch.dismissed = eventSearch.dismissed.filter((x) => x !== id);
          renderEvents();
        });
      })
    );

    view.querySelectorAll("[data-drop-saved]").forEach((b) =>
      b.addEventListener("click", () => {
        removePickWithUndo(b.getAttribute("data-drop-saved"), () => renderEvents());
      })
    );

    const handoff = document.getElementById("evHandoff");
    if (handoff) handoff.addEventListener("click", () => openHandoffSheet());

    const stopBtn = document.getElementById("evStop");
    if (stopBtn) stopBtn.addEventListener("click", () => stopEventSearch());

    view.querySelectorAll("[data-ev-retry]").forEach((b) =>
      b.addEventListener("click", () => retryAngle(b.getAttribute("data-ev-retry")))
    );

    view.querySelectorAll("[data-recent]").forEach((b) =>
      b.addEventListener("click", () => openRecentSearch(b.getAttribute("data-recent")))
    );

    const forget = document.getElementById("evForget");
    if (forget) {
      forget.addEventListener("click", () => {
        forgetRecentSearches();
        eventSearch.fromCache = 0;
        renderEvents();
      });
    }

    const allKinds = document.getElementById("evAllKinds");
    if (allKinds) {
      allKinds.addEventListener("click", () => {
        eventSearch.kinds = [];
        renderEvents();
      });
    }

    const freshBtn = document.getElementById("evFresh");
    if (freshBtn) freshBtn.addEventListener("click", () => runEventSearch({ fresh: true }));

    const indoorOnly = document.getElementById("evIndoorOnly");
    if (indoorOnly) {
      indoorOnly.addEventListener("click", () => {
        eventSearch.indoorOnly = !eventSearch.indoorOnly;
        renderEvents();
      });
    }

    const showHeld = document.getElementById("evShowHeld");
    if (showHeld) {
      showHeld.addEventListener("click", () => {
        eventSearch.showHeld = !eventSearch.showHeld;
        renderEvents();
      });
    }

    view.querySelectorAll("[data-save-held]").forEach((b) =>
      b.addEventListener("click", () => {
        const e = eventsHeldBack[Number(b.getAttribute("data-save-held"))];
        if (!e) return;
        // No coordinates, so no folder can be worked out from them - the town
        // it named is the best answer there is, and an unsorted event is
        // still an event you can put on a day.
        confirmAddCandidate(e, e.area || "Unsorted");
        updatePick(pickId("custom", e.name), { kind: "event", unverified: true });
        renderEvents();
      })
    );

    view.querySelectorAll("[data-save-event]").forEach((b) =>
      b.addEventListener("click", () => {
        const e = eventSearch.results[Number(b.getAttribute("data-save-event"))];
        if (!e) return;
        // Straight into the list under the town it is in - there is no folder
        // question worth asking about a thing that is on for one afternoon.
        const folder = confidentFolderFor(e.lat, e.lon) || e.area || "Unsorted";
        confirmAddCandidate(e, folder);
        updatePick(pickId("custom", e.name), { kind: "event" });
        renderEvents();
      })
    );

    view.querySelectorAll("[data-open-pick]").forEach((b) =>
      b.addEventListener("click", () => openPickDetail(b.getAttribute("data-open-pick")))
    );

    view.querySelectorAll("[data-open-maps]").forEach((b) =>
      b.addEventListener("click", () => openExternal(b.getAttribute("data-open-maps")))
    );
  }

  // Whatever is in flight can no longer write once this moves on. The same
  // discipline as searchGeneration and ideaGeneration: bump on a new run,
  // re-check after every await, and pass it into anything that outlives the
  // call. Without it, searching twice quickly lets whichever finishes last
  // win regardless of which you asked for - which was true here before any of
  // the streaming work and is far more likely with it.
  let eventGeneration = 0;
  let eventQueue = null;
  const ANGLE_STAGGER_MS = 180;

  // ---------- Not paying twice for the same question ----------
  // Nine grounded calls is the most expensive thing this app does, and going
  // back to a screen you were on ten minutes ago was buying all nine again.
  //
  // Kept for a week, then dropped. Seven days is the useful life of the
  // answer rather than an arbitrary number: an event list is a diary, so
  // anything older is mostly about days that have already gone - and the
  // stored copy is filtered on the way out anyway, so a cached search never
  // shows you something that has since finished.
  const EVENT_CACHE_KEY = "event-cache-v1";
  const EVENT_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
  const EVENT_CACHE_MAX = 12;

  function eventCacheKey(centre, windowKey, radius, kinds) {
    const w = eventWindow(windowKey);
    return [
      centre.lat.toFixed(2),
      centre.lon.toFixed(2),
      Math.round(radius / 1609),
      // The dates rather than the window name: "today" means something
      // different tomorrow, and a cached answer keyed on the word would be
      // yesterday's news presented as today's.
      isoDate(w.from),
      isoDate(w.to),
      w.fromTime || "",
      kinds.slice().sort().join("+") || "all",
    ].join("|");
  }

  function loadEventCache() {
    const c = readJson(EVENT_CACHE_KEY, null);
    return c && typeof c === "object" ? c : {};
  }

  // Every search of the last week that still has something to show, newest
  // first. The cache was doing its job and doing it invisibly: it only ever
  // helped if you happened to ask the identical question again, so the only
  // way to see Tuesday's results was to run Tuesday's search. This is that
  // list, and opening one costs nothing.
  function recentEventSearches() {
    const cache = loadEventCache();
    return Object.keys(cache)
      .map((key) => {
        const hit = cache[key];
        if (!hit || Date.now() - hit.at > EVENT_CACHE_MS) return null;
        const upcoming = (hit.results || []).filter((e) => !eventIsPast(e));
        // A search whose events have all been and gone is not worth offering.
        // It stays in the cache until its week is up - so re-running it is
        // still free - it simply has nothing to put on this list.
        if (!upcoming.length) return null;
        return { key, at: hit.at, count: upcoming.length, meta: hit.meta || {} };
      })
      .filter(Boolean)
      .sort((a, b) => b.at - a.at);
  }

  // Opening one is not a search. Nothing is asked for, nothing is spent.
  function openRecentSearch(key) {
    const hit = readEventCache(key);
    if (!hit) return;
    const meta = hit.meta || {};
    eventGeneration++;
    if (eventQueue) eventQueue.stop();
    if (meta.lat != null) {
      eventSearch.centre = { name: meta.centre, lat: meta.lat, lon: meta.lon, miles: meta.miles };
    }
    if (meta.when) eventSearch.when = meta.when;
    if (Array.isArray(meta.kinds)) eventSearch.kinds = meta.kinds.slice();
    eventSearch.results = sortEventsByWhen((hit.results || []).filter((e) => !eventIsPast(e)));
    eventsDropped = Object.assign({}, NO_DROPS, hit.dropped || {});
    eventsHeldBack = hit.held || [];
    eventSearch.fromCache = hit.at;
    eventSearch.angles = {};
    eventSearch.stopped = false;
    eventSearch.editing = false;
    eventSearch.showHeld = false;
    eventSearch.indoorOnly = false;
    eventSearch.dismissed = [];
    eventSearch.status = "done";
    renderEvents();
  }

  function forgetRecentSearches() {
    store(EVENT_CACHE_KEY, JSON.stringify({}));
  }

  function readEventCache(key) {
    const hit = loadEventCache()[key];
    if (!hit || Date.now() - hit.at > EVENT_CACHE_MS) return null;
    return hit;
  }

  function writeEventCache(key, results, dropped, held, meta) {
    const cache = loadEventCache();
    cache[key] = { at: Date.now(), results, dropped, held, meta: meta || {} };
    // Oldest out first, and anything past its week goes regardless. Without
    // the cap this grows for ever on a device that searches a lot of places.
    Object.keys(cache).forEach((k) => {
      if (Date.now() - cache[k].at > EVENT_CACHE_MS) delete cache[k];
    });
    const keys = Object.keys(cache).sort((a, b) => cache[b].at - cache[a].at);
    keys.slice(EVENT_CACHE_MAX).forEach((k) => delete cache[k]);
    store(EVENT_CACHE_KEY, JSON.stringify(cache));
  }

  // One Overpass lookup per area, remembered. The villages around a place do
  // not change, so asking twice is asking a free community service for
  // something we already know.
  const townsCache = {};

  async function townsAround(centre, radiusMetres) {
    const key = `${centre.lat.toFixed(2)},${centre.lon.toFixed(2)},${Math.round(radiusMetres / 1609)}`;
    if (townsCache[key]) return townsCache[key];
    const towns = await settlementsNear(centre.lat, centre.lon, radiusMetres);
    // The centre itself is already named in the prompt; repeating it in the
    // list of what the area covers reads as a mistake.
    const flat = String(centre.name || "").toLowerCase().trim();
    const out = towns.filter((t) => t.toLowerCase().trim() !== flat);
    // An empty answer is never cached. Overpass is a free community service
    // that is sometimes briefly down, and remembering "there are no villages
    // near Bakewell" would mean one bad minute costs every future search of
    // that area its village names, for as long as the app is open. Exactly
    // the trap the geocode cache already documents: caching a miss means the
    // right answer can never be learned.
    if (out.length) townsCache[key] = out;
    return out;
  }

  // One redraw for a burst of arrivals rather than one each. The photo loader
  // has done this since Phase 1 for the same reason: results land in clumps.
  let eventRedrawTimer = null;
  function scheduleEventsRedraw() {
    if (eventRedrawTimer) return;
    eventRedrawTimer = setTimeout(() => {
      eventRedrawTimer = null;
      if (view.dataset.activeTab !== "events") return;
      // A throw inside a render reached from a callback is not wrapped by
      // showView, so it would blank the screen with no way back.
      try {
        renderEvents();
      } catch (e) {
        console.error("renderEvents failed:", e);
      }
    }, 120);
  }

  // Whether a search is still going. A real terminal condition, rather than
  // the absence of a particular sentence - which is what the suites used to
  // wait on, and which broke the moment the sentence changed.
  function eventsBusy() {
    if (eventSearch.status === "loading") return true;
    return Object.keys(eventSearch.angles).some(
      (k) => eventSearch.angles[k] === "waiting" || eventSearch.angles[k] === "running"
    );
  }

  function anglesForSearch() {
    return EVENT_ANGLES.filter(
      (a) => !eventSearch.kinds.length || eventSearch.kinds.includes(a.key)
    );
  }

  // Runs one angle and feeds whatever it finds straight into the queue. Called
  // six times at the start of a search, and again on its own when you retry a
  // single angle that failed.
  async function runOneAngle(angle, ctx, generation) {
    eventSearch.angles[angle.key] = "running";
    scheduleEventsRedraw();
    const answer = await askOneAngle(ctx.key, ctx.centre, ctx.window, ctx.radius, angle, ctx.towns);
    if (generation !== eventGeneration) return;

    // An angle that answered nothing at all is the one case worth calling a
    // failure. It used to be indistinguishable from a quiet town, and it cost
    // 90 seconds of silence to get there - callGemini waits AI_TIMEOUT_MS
    // twice - so it is worth saying which of the two happened.
    eventSearch.angles[angle.key] = answer.list && answer.list.length ? "done" : "failed";

    const fresh = absorbAngle(answer, ctx);
    scheduleEventsRedraw();
    fresh.forEach((entry) => {
      eventQueue.push(async () => {
        const placed = await placeOne(entry, ctx);
        if (generation !== eventGeneration || !placed) return;
        eventSearch.results.push(placed);
        sortEventsByWhen(eventSearch.results);
      });
    });
    await eventQueue.whenIdle();
  }

  // Everything a pasted answer has to survive before it counts as an event:
  // the same whitelist, the same window, the same placement, the same dedupe.
  // Pasting is a different way in, not a lower standard.
  async function absorbPastedEvents(text) {
    const centre = eventSearch.centre || loadAnchor() || derivedAnchor();
    if (!centre || centre.lat == null) return { ok: false, message: "Say where to look first." };
    const list = extractJson(text);
    if (!Array.isArray(list) || !list.length) {
      return {
        ok: false,
        message:
          "That didn't contain a list this could read. Paste the whole reply — " +
          "including the square brackets — and it will find the JSON inside it.",
      };
    }

    const radius = (centre.miles || DEFAULT_ANCHOR_MILES) * 1609;
    const window = eventWindow(eventSearch.when);
    let cutoff = null;
    if (window.fromTime) {
      const mins = timeToMinutes(window.fromTime);
      if (mins != null) {
        cutoff = new Date(window.from);
        cutoff.setHours(0, mins, 0, 0);
      }
    }
    const ctx = {
      centre,
      window,
      cutoff,
      // Anything already on screen counts, so pasting a second answer merges
      // with the first rather than duplicating half of it.
      seen: eventSearch.ctx && eventSearch.ctx.seen ? eventSearch.ctx.seen : new Map(),
      anchor: { name: centre.name, lat: centre.lat, lon: centre.lon, miles: toMiles(radius / 1000) },
    };
    eventSearch.ctx = ctx;

    const before = eventSearch.results.length;
    eventsDropped = Object.assign({}, NO_DROPS);
    const fresh = absorbAngle({ list, sources: [], angle: "pasted" }, ctx);

    // Placed one at a time through the same polite queue the search uses.
    const queue = makePlaceQueue(scheduleEventsRedraw);
    fresh.forEach((entry) => {
      queue.push(async () => {
        const placed = await placeOne(entry, ctx);
        if (!placed) return;
        // Said on the row. A pasted event has no grounding chunks behind it,
        // so there is no page to click through to - and the app's standard
        // everywhere else is that an answer you cannot check says so.
        placed.pastedIn = true;
        placed.sources = [];
        eventSearch.results.push(placed);
        sortEventsByWhen(eventSearch.results);
      });
    });
    await queue.whenIdle();

    const added = eventSearch.results.length - before;
    eventSearch.status = eventSearch.results.length ? "done" : "idle";
    eventSearch.fromCache = 0;

    // Kept exactly as a searched answer is. Without this, work done by hand -
    // which is the more effortful way of getting it - was the only kind that
    // did not survive closing the app, and never appeared under Earlier
    // searches. Same store, same week, same pruning.
    //
    // Written under the same key a search of this question would use, so
    // pasting into a list you already searched adds to that entry rather than
    // leaving two half-answers side by side.
    const cacheKey = eventCacheKey(centre, eventSearch.when, radius, eventSearch.kinds);
    writeEventCache(cacheKey, eventSearch.results, eventsDropped, eventsHeldBack, {
      centre: centre.name,
      lat: centre.lat,
      lon: centre.lon,
      miles: centre.miles || DEFAULT_ANCHOR_MILES,
      when: eventSearch.when,
      label: window.label,
      from: isoDate(window.from),
      to: isoDate(window.to),
      fromTime: window.fromTime || "",
      kinds: eventSearch.kinds.slice(),
      // So the row on Earlier searches can say where it came from - "pasted
      // in" rather than implying nine requests went out for it.
      pasted: true,
    });

    renderEvents();
    return {
      ok: true,
      message: added
        ? `Added ${added} event${added === 1 ? "" : "s"}${
            list.length - added > 0 ? `. ${list.length - added} didn't survive — ${describeEventDrops() || "already on the list"}.` : "."
          }`
        : `Nothing new — ${describeEventDrops() || "they were all already on the list"}.`,
    };
  }

  async function runEventSearch(opts) {
    const fresh = !!(opts && opts.fresh);
    const key = loadTripSettings().geminiKey.trim();
    if (!key) {
      eventSearch.status = "error";
      eventSearch.error =
        "Finding what's on needs an AI key — there is no free map database of events, the way there is for places. " +
        "Settings has a Gemini key field; the free tier is enough for this.";
      renderEvents();
      return;
    }
    const centre = eventSearch.centre || loadAnchor() || derivedAnchor();
    if (!centre || centre.lat == null) {
      eventSearch.status = "error";
      eventSearch.error = "Say where to look first — tap “Choose where” above.";
      renderEvents();
      return;
    }

    eventSearch.status = "loading";
    eventSearch.error = "";
    eventSearch.results = [];
    eventSearch.editing = false;
    eventSearch.showHeld = false;
    eventSearch.indoorOnly = false;
    eventSearch.dismissed = [];
    eventSearch.stopped = false;
    eventSearch.angles = {};
    eventsDropped = Object.assign({}, NO_DROPS);
    eventsHeldBack = [];
    renderEvents();

    const generation = ++eventGeneration;
    const radius = (centre.miles || DEFAULT_ANCHOR_MILES) * 1609;
    const window = eventWindow(eventSearch.when);

    // The same question asked twice inside a week is answered from what it
    // said the first time. Everything past its date is dropped on the way out,
    // so yesterday's cached answer never shows you yesterday's events.
    const cacheKey = eventCacheKey(centre, eventSearch.when, radius, eventSearch.kinds);
    if (!fresh) {
      const hit = readEventCache(cacheKey);
      if (hit) {
        eventSearch.results = sortEventsByWhen((hit.results || []).filter((e) => !eventIsPast(e)));
        eventsDropped = Object.assign({}, NO_DROPS, hit.dropped || {});
        eventsHeldBack = hit.held || [];
        eventSearch.fromCache = hit.at;
        eventSearch.status = eventSearch.results.length ? "done" : "error";
        if (!eventSearch.results.length) {
          eventSearch.error = `Nothing found on ${window.label} near ${centre.name}.`;
        }
        renderEvents();
        return;
      }
    }
    eventSearch.fromCache = 0;

    // The moment to search from, when one was given: on that day, anything
    // already finished is not an answer to "what can I still go to".
    let cutoff = null;
    if (window.fromTime) {
      const mins = timeToMinutes(window.fromTime);
      if (mins != null) {
        cutoff = new Date(window.from);
        cutoff.setHours(0, mins, 0, 0);
      }
    }

    const ctx = {
      key,
      centre,
      window,
      radius,
      cutoff,
      seen: new Map(),
      towns: [],
      anchor: { name: centre.name, lat: centre.lat, lon: centre.lon, miles: toMiles(radius / 1000) },
    };
    eventSearch.ctx = ctx;

    // The village names, before the questions go out. Cheap - one Overpass
    // call, no key, no AI quota - and it is what turns "within 15 miles of
    // Bakewell" into a question about places that actually have parish halls.
    // Cached per area, so a second search of the same place pays nothing.
    try {
      ctx.towns = await townsAround(centre, radius);
    } catch (e) {
      // The prompt falls back to the radius wording. Never fatal.
    }
    if (generation !== eventGeneration) return;

    if (eventQueue) eventQueue.stop();
    eventQueue = makePlaceQueue(scheduleEventsRedraw);

    const angles = anglesForSearch();
    angles.forEach((a) => { eventSearch.angles[a.key] = "waiting"; });

    // Independent chains rather than a Promise.all barrier. The fastest
    // angle's results are on screen while the slowest is still thinking,
    // which is the whole point: one dead angle used to hold the other five
    // for a minute and a half with nothing to look at.
    //
    // Started a beat apart rather than all together. Nine simultaneous
    // grounded calls is a plausible way to meet a free-tier rate limit, and
    // because results stream in the stagger costs almost nothing - the last
    // angle starts about a second and a half after the first, against calls
    // that take fifteen.
    await Promise.all(
      angles.map(async (angle, i) => {
        if (i) await new Promise((r) => setTimeout(r, i * ANGLE_STAGGER_MS));
        if (generation !== eventGeneration) return;
        await runOneAngle(angle, ctx, generation);
      })
    );
    if (generation !== eventGeneration) return;
    await eventQueue.whenIdle();
    if (generation !== eventGeneration) return;

    // Kept whether or not anything was found: a search that legitimately
    // returns nothing is exactly the one not worth paying for twice.
    // Enough to describe the search on a list without re-deriving any of it.
    writeEventCache(cacheKey, eventSearch.results, eventsDropped, eventsHeldBack, {
      centre: centre.name,
      lat: centre.lat,
      lon: centre.lon,
      miles: centre.miles || DEFAULT_ANCHOR_MILES,
      when: eventSearch.when,
      label: window.label,
      from: isoDate(window.from),
      to: isoDate(window.to),
      fromTime: window.fromTime || "",
      kinds: eventSearch.kinds.slice(),
    });

    // "Nothing found" can only be known once every angle has reported, so it
    // is a final state rather than something thrown from inside the search.
    if (!eventSearch.results.length) {
      const why = describeEventDrops();
      eventSearch.status = "error";
      eventSearch.error = why
        ? `Nothing could be confirmed as on ${window.label} — ${why}.`
        : `Nothing found on ${window.label} near ${centre.name}.`;
    } else {
      eventSearch.status = "done";
    }
    renderEvents();
  }

  // Re-runs a single angle that came back with nothing, merging whatever it
  // finds into the list already on screen. A dead angle is one bad request,
  // not a reason to pay for the other five again.
  async function retryAngle(key) {
    const angle = EVENT_ANGLES.find((a) => a.key === key);
    const ctx = eventSearch.ctx;
    if (!angle || !ctx) return;
    const generation = eventGeneration;
    if (!eventQueue) eventQueue = makePlaceQueue(scheduleEventsRedraw);
    eventSearch.status = "loading";
    renderEvents();
    await runOneAngle(angle, ctx, generation);
    if (generation !== eventGeneration) return;
    eventSearch.status = eventSearch.results.length ? "done" : "error";
    renderEvents();
  }

  // Keeps what has arrived and stops the rest, the way the trip planner's
  // "Stop waiting" does. The requests already sent are not aborted - nothing
  // in this app aborts one - but the generation bump means nothing they bring
  // back can be written.
  function stopEventSearch() {
    eventGeneration++;
    if (eventQueue) eventQueue.stop();
    eventSearch.stopped = true;
    Object.keys(eventSearch.angles).forEach((k) => {
      if (eventSearch.angles[k] === "waiting" || eventSearch.angles[k] === "running") {
        eventSearch.angles[k] = "stopped";
      }
    });
    eventSearch.status = eventSearch.results.length ? "done" : "idle";
    renderEvents();
  }

  // Drops a saved event onto the planned day it falls on, if there is one.
  // Silent when there is not: a trip with no dated days, or an event outside
  // it, is not a failure, it is just an event you have saved.
  function addEventToItsDay(pick) {
    const when = pick && pick.startsAt ? new Date(pick.startsAt) : null;
    if (!when || Number.isNaN(when.getTime())) return false;
    const match = datedDays(loadPlan().days).find(
      (x) => x.when && isoDate(x.when) === isoDate(when)
    );
    if (!match) return false;
    addToPlan(match.d.id, pick.id);
    if (pick.time) {
      const plan = loadPlan();
      const item = (plan.items[match.d.id] || []).find((it) => it.pickId === pick.id);
      if (item && !item.time) {
        item.time = pick.time;
        savePlan(plan);
      }
    }
    toast(`Added to ${shortDayLabel(match.d.label)}`);
    return true;
  }

  // An event that has been and gone is clutter. Places are permanent and
  // events are not, and a list that silently accumulates last month's markets
  // is worse than no list.
  function eventIsPast(pick) {
    if (!pick || !pick.startsAt) return false;
    const when = new Date(pick.startsAt);
    if (Number.isNaN(when.getTime())) return false;
    return endOfWindow(when) < new Date();
  }

  function eventDateLabel(pick) {
    if (!pick || !pick.startsAt) return "";
    const when = new Date(pick.startsAt);
    if (Number.isNaN(when.getTime())) return "";
    const day = humanDate(when);
    return pick.time ? `${day}, ${pick.time}` : day;
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
    const rows = (await cachedJson(url, { headers: { Accept: "application/json" } })).data;
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
              )} asks for">${icon('edit', { size: 15, cls: 'ico-inline' })}</button>`
            : ""
        }
      </div>
    `;
  }

  // Lets the question behind a category be rewritten. Only the description
  // is editable - the app still adds the "reply with JSON" scaffolding, so
  // an edit can change what comes back but can't break the search.
  // The same sheet as the category tuner, for the nine event searches. This is
  // where local knowledge the app cannot guess belongs - the name of a village
  // newsletter, a listings site you happen to know about.
  function openAngleTuner(key) {
    const angle = EVENT_ANGLES.find((a) => a.key === key);
    if (!angle) return;
    const current = anglePrompt(key);
    const edited = current !== angle.ask;

    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="Change what this looks for">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">${icon("close", { size: 17, cls: "ico-inline" })}</button>
          <div class="modal-body">
            <h2 class="modal-title">${esc(angle.label)}</h2>
            <div class="modal-subtitle">What this search asks for</div>

            <textarea class="settings-input notes-box" id="anglePromptBox" rows="6">${esc(current)}</textarea>
            <p class="settings-hint">
              Describe the kind of thing you want back. The app adds the rest — where, when,
              who's travelling, where to go looking, and the formatting rules. Naming somewhere
              specific helps: a village newsletter, a hall, a listings page you know about.
            </p>

            <div class="settings-btn-row" style="margin-top:12px;">
              <button class="modal-btn modal-btn-primary" id="anglePromptSave">Save</button>
              <button class="modal-btn" id="anglePromptReset" ${edited ? "" : "disabled"}>Reset to default</button>
            </div>
          </div>
        </div>
      </div>
    `;
    placeModal.classList.add("open");
    makeSheetDraggable(placeModal, closePlaceModal);

    placeModal.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target === el) closePlaceModal();
      });
    });

    document.getElementById("anglePromptSave").addEventListener("click", () => {
      const text = document.getElementById("anglePromptBox").value.trim();
      const map = Object.assign({}, loadTripSettings().anglePrompts);
      // Storing only real changes means later improvements to the built-in
      // wording still reach anyone who never edited that search.
      if (!text || text === angle.ask) delete map[key];
      else map[key] = text;
      saveTripSettings({ anglePrompts: map });
      closePlaceModal();
      renderEvents();
    });

    document.getElementById("anglePromptReset").addEventListener("click", () => {
      const map = Object.assign({}, loadTripSettings().anglePrompts);
      delete map[key];
      saveTripSettings({ anglePrompts: map });
      closePlaceModal();
      renderEvents();
    });
  }

  function openCategoryTuner(key) {
    const cat = findCategory(key);
    if (!cat) return;
    const current = categoryPrompt(key);
    const edited = current !== cat.prompt;

    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="Change what this looks for">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
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
    makeSheetDraggable(placeModal, closePlaceModal);

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
          <button class="modal-close" data-close="1" aria-label="Close">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
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
    makeSheetDraggable(placeModal, closePlaceModal);

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
        <b>${icon('directions', { size: 15, cls: 'ico-inline' })} Around here</b> on the result. Or start from:
      </p>
      <div class="explore-centre-row">
        <button class="move-chip" id="exploreGpsBtn">${icon('pin', { size: 16, cls: 'ico-inline' })} Where I am</button>
        <button class="move-chip" id="exploreMapBtn">${icon('map', { size: 16, cls: 'ico-inline' })} Point on a map</button>
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
        }>${searching ? "Searching…" : `${icon('search', { size: 18, cls: 'ico-inline' })} ${ranBefore && !explore.stale ? "Search again" : "Search"}`}</button>
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

    // A list shortened because suggestions could not be confirmed near here
    // should say so. Silently returning three of six looks like a thin AI
    // rather than a careful one.
    if (explore.status === "done" && explore.usedAi && (exploreDropped.unplaced || exploreDropped.tooFar)) {
      const bits = [];
      if (exploreDropped.unplaced) {
        bits.push(
          `${exploreDropped.unplaced} couldn't be found on the map`
        );
      }
      if (exploreDropped.tooFar) bits.push(`${exploreDropped.tooFar} turned out to be too far away`);
      body += `<p class="settings-hint">${esc(
        `Left out: ${bits.join(", ")}. Only places that could actually be located are shown.`
      )}</p>`;
    }

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
                  ${
                    r.kind === "event"
                      ? `<div class="place-when">${esc(eventDateLabel(r))}${
                          r.venue ? ` · ${esc(r.venue)}` : ""
                        }</div>`
                      : ""
                  }
                  ${meta ? `<div class="place-notes">${esc(meta)}</div>` : ""}
                  ${r.description ? `<div class="place-notes">${esc(r.description)}</div>` : ""}
                  <div class="search-result-more">Details ${icon('forward', { size: 13, cls: 'ico-inline' })}</div>
                </button>
                ${
                  r.aiSuggested && r.sources && r.sources.length
                    ? `<div class="place-links"><a href="${esc(safeUrl(r.sources[0].uri))}" target="_blank" rel="noopener">${icon('link', { size: 14, cls: 'ico-inline' })} source</a></div>`
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
          <b>${icon('directions', { size: 18, cls: 'ico-inline' })} Explore around a place</b>
          <span class="chevron">${explore.open ? icon("down", { size: 16 }) : icon("forward", { size: 16 })}</span>
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
        store(RADIUS_KEY, JSON.stringify(explore.radius));
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
        // Rebuilding the candidate field by field means anything this list
        // does not know about is dropped on the way in - which is exactly
        // what happened to every event: it arrived with a date and a venue
        // and was saved as an ordinary place with neither.
        // Unreachable today - nothing that fills explore.results sets
        // kind:"event" since the Explore events category was removed - and
        // left as it was it is a trap for whoever brings it back: it listed
        // the event fields by hand and the list was missing endTime and
        // endsAt. It shares the one list now, so reviving it cannot revive
        // the bug.
        if (r.kind === "event") {
          copyEventFields(r, candidate);
          Object.assign(candidate, {
            kind: "event",
            sources: r.sources || [],
            category: r.category || "Event",
          });
        }
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

  // Settlements get their own, larger cap. "Every village within 25 miles" is
  // a far lighter question than "every restaurant within 25 miles" - there are
  // tens of answers rather than thousands - so the reason for the tight cap
  // above does not apply to it.
  const OVERPASS_PLACES_RADIUS_M = Math.round((30 / MILES_PER_KM) * 1000);

  // The towns, villages and hamlets actually inside the search area, by name.
  //
  // This is the single biggest thing that was missing from the prompt. "Within
  // 15 miles of Bakewell" is close to meaningless to a model - it cannot draw
  // a circle and read what is inside it. "Anything on in Ashford-in-the-Water,
  // Baslow, Hassop, Great Longstone" is a question it can actually answer, and
  // it is the form the answers exist in: a parish hall event is written down
  // under the name of its village and nowhere else.
  //
  // Free, no key, no AI call - the same OpenStreetMap data the map tiles and
  // the geocoder already use.
  async function settlementsNear(lat, lon, radiusMetres) {
    const radius = Math.min(radiusMetres || OVERPASS_PLACES_RADIUS_M, OVERPASS_PLACES_RADIUS_M);
    const filter = `["place"~"^(city|town|village|hamlet)$"]["name"]`;
    const q = `[out:json][timeout:25];(node${filter}(around:${radius},${lat},${lon}););out ${SETTLEMENT_LIMIT * 3};`;

    let data = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetchWithTimeout(
          endpoint,
          { method: "POST", body: q, headers: { "Content-Type": "text/plain" } },
          NET_TIMEOUT_SLOW_MS
        );
        if (!res.ok) continue;
        data = await res.json();
        break;
      } catch (e) {
        // Try the next mirror.
      }
    }
    // Deliberately not a throw. A missing village list makes the prompt
    // slightly worse; it must never make the search fail.
    if (!data || !Array.isArray(data.elements)) return [];

    const rank = { city: 0, town: 1, village: 2, hamlet: 3 };
    return data.elements
      .filter((el) => el.tags && el.tags.name && el.lat != null)
      .map((el) => ({
        name: el.tags.name,
        place: el.tags.place,
        km: haversineKm(lat, lon, el.lat, el.lon),
      }))
      // Nearest first, but a town ahead of a hamlet at the same distance: the
      // bigger places carry the listings pages, the smaller ones carry the
      // village hall.
      .sort((a, b) => a.km - b.km || rank[a.place] - rank[b.place])
      .filter((x, i, all) => all.findIndex((y) => y.name === x.name) === i)
      .slice(0, SETTLEMENT_LIMIT)
      .map((x) => x.name);
  }

  // Enough to be concrete, few enough that the prompt does not become a list
  // of places instead of a question.
  const SETTLEMENT_LIMIT = 18;

  async function overpassNearby(lat, lon, cat, radius) {
    radius = Math.min(radius || 1200, OVERPASS_MAX_RADIUS_M);
    const filter = `["${cat.tag}"="${cat.value}"]`;
    const q = `[out:json][timeout:20];(node${filter}(around:${radius},${lat},${lon});way${filter}(around:${radius},${lat},${lon}););out center 25;`;

    let lastError = null;
    let data = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetchWithTimeout(
          endpoint,
          { method: "POST", body: q, headers: { "Content-Type": "text/plain" } },
          NET_TIMEOUT_SLOW_MS
        );
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
  // `extra` is whatever the current order makes worth knowing about this row:
  // the town when the list is flat, the time when it is grouped by day, the
  // category when the section is already the town. The row does not decide -
  // it is told, by whoever grouped the list.
  function renderPickRow(p, away, extra, hideDays) {
    const plan = loadPlan();
    // Grouped by day, the heading above already says which day this is, and
    // repeating it on every row is noise on the screen that was too busy to
    // read in the first place.
    const days = hideDays
      ? []
      : plan.days
          .filter((d) => (plan.items[d.id] || []).some((it) => it.pickId === p.id))
          .map((d) => shortDayLabel(d.label));

    // Escaped in parts, because the rating carries a drawn star: escaping the
    // joined string would have printed the SVG rather than shown it.
    // For an event the date outranks the category: "Sat 6 Sep, 19:30" is what
    // you need off a row, and "Music" is not.
    const isEvent = p.kind === "event";
    const meta = [isEvent ? eventDateLabel(p) || p.category : extra === undefined ? p.category : extra, away]
      .filter(Boolean)
      .map((x) => esc(String(x)))
      .concat(p.rating != null ? [`${icon("star", { size: 13, cls: "ico-inline" })} ${esc(String(p.rating))}`] : [])
      .join(" · ");

    return `
      <div class="swipeable">
        ${rowActions(p.id)}
      <button class="pick-row${isEvent && eventIsPast(p) ? " pick-row-past" : ""}" data-open-pick="${esc(p.id)}">
        ${photoBlock(p, "thumb")}
        <div class="pick-row-main">
          <div class="pick-row-name">${esc(p.name)}</div>
          ${meta ? `<div class="pick-row-meta">${meta}</div>` : ""}
          <div class="pick-row-badges">
            ${days.map((d) => `<span class="row-badge day">${esc(d)}</span>`).join("")}
            ${p.booked ? `<span class="row-badge booked">booked</span>` : ""}
            ${p.note ? `<span class="row-badge note">note</span>` : ""}
            ${p.geoAlternatives ? `<span class="row-badge doubt">location?</span>` : ""}
            ${isEvent && eventIsPast(p) ? `<span class="row-badge past">been and gone</span>` : ""}
            ${isEvent && p.unverified && !eventIsPast(p) ? `<span class="row-badge doubt">check it's on</span>` : ""}
            ${p.enrichStatus === "loading" ? `<span class="row-badge">loading…</span>` : ""}
          </div>
        </div>
        <span class="pick-row-chevron">${icon('forward', { size: 17, cls: 'ico-inline' })}</span>
      </button>
      </div>
    `;
  }

  // The heading a section of places sits under. It opens the same detail sheet
  // as any other saved place, but the thing you actually want from a town is
  // what's around it, so that gets its own control rather than three taps
  // through the sheet.
  function renderMajorHeader(p, count, folded) {
    const meta = count ? `${count} place${count === 1 ? "" : "s"} saved here` : "Nothing saved here yet";
    return `
      <div class="area-head">
        ${
          count
            ? `<button class="area-fold${folded ? " folded" : ""}" data-fold="${esc(p.name)}"
                       aria-label="${folded ? "Open" : "Fold"} ${esc(p.name)}"
                       aria-expanded="${folded ? "false" : "true"}">${icon(folded ? "forward" : "down", {
                size: 16,
              })}</button>`
            : ""
        }
        <button class="area-head-main" data-open-pick="${esc(p.id)}">
          <span class="area-head-icon">${icon('globe', { size: 15, cls: 'ico-inline' })}</span>
          <span class="area-head-text">
            <span class="area-head-name">${esc(p.name)}</span>
            <span class="area-head-meta">${esc(meta)}</span>
          </span>
          <span class="pick-row-chevron">${icon('forward', { size: 17, cls: 'ico-inline' })}</span>
        </button>
        <button class="area-head-explore" data-explore-from="${esc(p.id)}">${icon('directions', { size: 16, cls: 'ico-inline' })} What's nearby</button>
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
  // Leaflet's own marker is a blue teardrop with a drop shadow, drawn for a
  // different app in a different decade, and on a styled map it was the one
  // object that plainly came from somewhere else.
  function dropIcon(name) {
    return L.divIcon({
      className: "map-pin-wrap",
      html: `<span class="map-drop">${icon(name || "pin", { size: 15 })}</span>`,
      iconSize: [30, 30],
      iconAnchor: [15, 30],
    });
  }

  function openPickDetail(id) {
    const p = loadPicks().find((x) => x.id === id);
    if (!p) return;
    // Opening a place is the one moment its picture is worth a request of its
    // own: you are looking straight at where it would go.
    wantPhoto(p, () => {
      if (placeModal.classList.contains("open")) openPickDetail(id);
    });
    // And the one moment an event's venue is worth pinning exactly, for the
    // same reason: this is where you decide whether you are going.
    refineEventVenue(id, () => {
      if (placeModal.classList.contains("open")) openPickDetail(id);
    });
    const mapsUrl = p.kind === "event" ? eventMapsUrl(p) : pickGoogleUrl(p);
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
          <button class="modal-close" data-close="1" aria-label="Close">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
          <div class="modal-body">
            ${photoBlock(p, "hero")}
            <h2 class="modal-title">${esc(p.name)}</h2>
            <div class="modal-subtitle">${esc(
              [p.category, p.city].filter(Boolean).join(" · ")
            )}${p.rating != null ? ` · ${icon('star', { size: 13, cls: 'ico-inline' })} ${esc(String(p.rating))}` : ""}</div>

            ${description ? `<p class="place-notes" style="margin-top:10px;">${esc(description)}</p>` : ""}

            ${p.address ? `<div class="place-fact">${icon('pin', { size: 16, cls: 'ico-inline' })} ${esc(p.address)}</div>` : ""}
            ${
              // The geocoder had more than one answer and nobody was asked.
              // Saying so beats a map pin that looks as confident as any other.
              p.geoAlternatives
                ? `<div class="place-fact doubt-fact">${icon('alert', { size: 16, cls: 'ico-inline' })} ${esc(
                    String(p.geoAlternatives.length)
                  )} places share this name and they are far apart — this is the first one.
                   <button class="link-btn" data-fix-location="${esc(p.id)}">Pick the right one</button></div>`
                : ""
            }
            ${p.openingHours ? `<div class="place-fact">${icon('clock', { size: 16, cls: 'ico-inline' })} ${esc(p.openingHours)}</div>` : ""}
            ${p.phone ? `<div class="place-fact">${icon('phone', { size: 16, cls: 'ico-inline' })} <a href="tel:${esc(p.phone)}">${esc(p.phone)}</a></div>` : ""}
            ${safeUrl(p.website) ? `<div class="place-fact">${icon('link', { size: 16, cls: 'ico-inline' })} <a href="${esc(safeUrl(p.website))}" target="_blank" rel="noopener">Website</a></div>` : ""}

            ${weatherForPick(p)}

            ${p.lat != null ? `<div class="detail-map" id="detailMap"></div>` : ""}
            ${mapsUrl ? `<button class="modal-btn modal-btn-primary" data-open-maps="${esc(mapsUrl)}">${icon('pin', { size: 16, cls: 'ico-inline' })} ${
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
                plan.days.length ? "+ Day" : `${icon('calendarPlus', { size: 16, cls: 'ico-inline' })} Put it on a day`
              }</button>
            </div>

            ${
              // An area isn't in either list, so the choice would be a control
              // that does nothing.
              p.major
                ? ""
                : `<label class="settings-label">Shows up in</label>
            <div class="move-row">
              <button class="move-chip${pickKind(p) === "place" ? " active" : ""}" data-pick-kind="${esc(p.id)}|place">${icon('castle', { size: 16, cls: 'ico-inline' })} Places</button>
              <button class="move-chip${pickKind(p) === "eat" ? " active" : ""}" data-pick-kind="${esc(p.id)}|eat">${icon('food', { size: 17, cls: 'ico-inline' })} Eats</button>
            </div>`
            }

            <label class="settings-label">What this is</label>
            <div class="move-row">
              <button class="move-chip${p.major ? "" : " active"}" data-pick-major="${esc(p.id)}|0">${icon('pin', { size: 15, cls: 'ico-inline' })} Somewhere to go</button>
              <button class="move-chip${p.major ? " active" : ""}" data-pick-major="${esc(p.id)}|1">${icon('globe', { size: 15, cls: 'ico-inline' })} A town or area</button>
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
                ${p.booked ? `${icon('check', { size: 15, cls: 'ico-inline' })} Booked` : "Mark booked"}
              </button>
              <button class="modal-btn" data-explore-from="${esc(p.id)}">${icon('directions', { size: 16, cls: 'ico-inline' })} What's nearby</button>
            </div>
            <button class="modal-btn booked-toggle${isForKids(p) ? " on" : ""}" data-toggle-kids="${esc(p.id)}"
                    style="width:100%;margin-top:8px;">
              ${isForKids(p) ? "🧸 One for the kids" : "🧸 One for the kids?"}
            </button>

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
    makeSheetDraggable(placeModal, closePlaceModal);
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
      L.marker([p.lat, p.lon], { icon: dropIcon(categoryIcon(p)) }).addTo(map);
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

    placeModal.querySelectorAll("[data-toggle-kids]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-toggle-kids");
        const pick = loadPicks().find((x) => x.id === id);
        const now = !isForKids(pick);
        setForKids(id, now);
        openPickDetail(id);
        toast(now ? "Added to the kids list" : "Taken off the kids list");
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
    if (!brief.who) brief.who = whoDescription() || "";
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
    store(
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
    from: "e.g. the town you're staying in",
    towards: "e.g. towards the coast",
    who: "e.g. two adults and a 4-year-old",
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
    const label = isReview ? `${icon('sparkle', { size: 16, cls: 'ico-inline' })} Suggest trips` : ideaAnswered(step.key) || blocked ? "Next" : "Skip";
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
    // A measured distance and one the model simply asserted used to print
    // identically, so "12 mi out" might have been arithmetic or invention with
    // no way to tell. Measured is stated plainly; claimed is hedged.
    const measured = stop.crowMiles != null;
    const miles = measured ? stop.crowMiles : stop.claimedMiles;
    const over = radius && measured && stop.crowMiles > radius;
    const path = `${oi}|${di}|${si}`;
    const meta = [stop.area, miles != null ? `${measured ? "" : "~"}${miles} mi out` : ""]
      .filter(Boolean)
      .join(" · ");

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
        // The model's own arithmetic, never measured - hedged accordingly.
        option.miles ? `roughly ${option.miles} miles by its reckoning` : "",
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
        <button class="search-back" data-idea-close="1" aria-label="Close">${icon('back', { size: 20, cls: 'ico-inline' })}</button>
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
    // A measured distance and one the model simply asserted used to print
    // identically, so "12 mi out" might have been arithmetic or invention with
    // no way to tell. Measured is stated plainly; claimed is hedged.
    const measured = stop.crowMiles != null;
    const miles = measured ? stop.crowMiles : stop.claimedMiles;
    const meta = [stop.area, miles != null ? `${measured ? "" : "~"}${miles} mi out` : ""]
      .filter(Boolean)
      .join(" · ");

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
    const who = (b.who || whoDescription() || "").trim();
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
      option.photo = option.photo || wiki.photo || null;
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
          <button class="modal-close" data-close="1" aria-label="Close">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
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
                  ? `<button class="modal-btn" data-open-maps="${esc(safeUrl(option.website))}">${icon('link', { size: 16, cls: 'ico-inline' })} Website</button>`
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
    makeSheetDraggable(placeModal, closePlaceModal);
    wireStopChooser();

    if (option.lat != null && document.getElementById("chooserMap")) {
      const map = L.map("chooserMap", { scrollWheelZoom: false, attributionControl: false });
      addTileLayer(map);
      map.setView([option.lat, option.lon], 14);
      L.marker([option.lat, option.lon], { icon: dropIcon("pin") }).addTo(map);
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
  // The chips exist because a blank search box is a hard question. The obvious
  // asks - lunch, coffee, playground - are the ones people type anyway; these
  // are the ones that are worth asking and never occur to anyone, phrased the
  // way you would say them to a local rather than to a search engine.
  const SEARCH_SUGGESTIONS = [
    "Somewhere for lunch",
    "Comfort food",
    "Where locals actually eat",
    "Worth the detour",
    "Somewhere quiet",
    "Best view around here",
    "Rainy day with a 4-year-old",
    "Free things to do",
    "Open late",
    "Older than everything around it",
    "Good coffee",
    "Playground nearby",
  ];

  // Deliberately not one of the chips above: it is a different kind of ask,
  // and half the point is not knowing what you will get.
  const SURPRISES = [
    "Somewhere with a story nobody tells",
    "The thing locals take visitors to first",
    "Somewhere that smells of the place",
    "An ordinary place people are oddly loyal to",
    "Worth a detour for one specific thing",
    "Somewhere that has not changed in fifty years",
    "The view people stop the car for",
    "Somewhere you would never find on your own",
    "A small museum about one strange subject",
    "Where to be at sunset",
  ];

  function aSurprise() {
    return SURPRISES[Math.floor(Math.random() * SURPRISES.length)];
  }

  // The same block wherever searching happens. It used to exist only on the
  // blank screen, which meant it was gone the moment you searched - and the
  // moment you most want a different angle is when the results in front of you
  // are not it.
  function suggestionChips(label) {
    return (
      `<div class="section-label">${esc(label)}</div><div class="search-chips">` +
      `<button class="search-chip search-chip-surprise" data-surprise="1">${icon('dice', { size: 16, cls: 'ico-inline' })} Surprise me</button>` +
      SEARCH_SUGGESTIONS.map(
        (r) => `<button class="search-chip" data-recent="${esc(r)}">${esc(r)}</button>`
      ).join("") +
      `</div>`
    );
  }

  function loadRecentSearches() {
    const list = readJson(RECENT_KEY, []);
    return Array.isArray(list) ? list.slice(0, 6) : [];
  }

  function rememberSearch(query) {
    const q = (query || "").trim();
    if (!q) return;
    const list = loadRecentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase());
    list.unshift(q);
    store(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
  }

  function openSearchOverlay(prefill) {
    clearAnchorInForce();
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
  // The anchor a query derived for itself (a postcode, a coordinate pair) is
  // not saved over your standing area - a one-off look somewhere else should
  // not silently repoint every search after it - but it IS what this search
  // ran against, so everything that happens to these results must use it.
  // Held here so loadAnchor() can hand it to lookups that come later:
  // opening a result, saving one, enriching one in the background.
  let anchorInForce = null;

  function useAnchorForThisSearch(anchor) {
    searchAnchor = anchor;
    anchorInForce = anchor;
  }

  function clearAnchorInForce() {
    anchorInForce = null;
  }

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
      // Held in one place, not two. This used to set a module-level variable
      // that the header read while everything downstream kept reading storage
      // - so typing a postcode or a coordinate as the query showed you one
      // area and then saved, previewed and re-geocoded the results against a
      // different one. A search that says it is looking somewhere has to be
      // the same search that later places what it found.
      useAnchorForThisSearch(anchor);
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
        unplaced: lastSearchUnplaced,
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
      let placedElsewhere = false;

      if (geo && anchor && !confirmedWithinAnchor(anchor, geo.lat, geo.lon, ANCHOR_GRACE)) {
        // A place the model itself put somewhere else is a wrong answer and
        // goes. One it called local might be genuinely unmapped, so it keeps
        // its name - but not that coordinate.
        if (!claimsToBeNear(r.area, anchor)) {
          pickSearch.results = pickSearch.results.filter((x) => x !== r);
          pickSearch.outside = (pickSearch.outside || 0) + 1;
          continue;
        }
        // Kept for now because the model called it local, but the coordinate
        // is not usable. Remembered so that if nothing else places it, it is
        // reported as what it was - found, but not here - rather than as
        // never found at all.
        placedElsewhere = true;
        geo = null;
      }

      // And this is the case that kept London on a Stirling screen. Placement
      // has now had its turn: the geocoder either found nothing, or found
      // somewhere outside and had the coordinate taken off it above. Either
      // way the result is sitting in a list headed "within N miles of here"
      // with nothing behind it saying so, and it stayed there for good,
      // because every later check treats "no coordinates" as "no objection".
      //
      // In a search anchored to a place, that is not good enough. Unplaceable
      // is not nearby.
      if (!geo && anchor && r.lat == null) {
        pickSearch.results = pickSearch.results.filter((x) => x !== r);
        if (placedElsewhere) pickSearch.outside = (pickSearch.outside || 0) + 1;
        else pickSearch.unplaced = (pickSearch.unplaced || 0) + 1;
        renderSearchOverlay();
        continue;
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
      // The asks come before the history. Six recent searches is two rows of
      // chips, and on a phone with the keyboard up that is the whole screen -
      // so everything worth discovering sat below the fold, on the one screen
      // whose job is to suggest what to ask for. You already know what you
      // searched yesterday; that can be the thing you scroll to.
      body += suggestionChips("Try");
      if (recents.length) {
        body += `<div class="section-label">Recent</div><div class="search-chips">`;
        body += recents
          .map((r) => `<button class="search-chip" data-recent="${esc(r)}">🕘 ${esc(r)}</button>`)
          .join("");
        body += `</div>`;
      }

      // Searching finds one place at a time, which is the wrong tool when you
      // do not yet know what you are looking for. This is the other door, and
      // it belongs here because this is where that realisation happens.
      body += `
        <div class="section-label">Or don't search at all</div>
        <button class="search-chip search-chip-wide" data-open-idea-search="1">${icon('directions', { size: 16, cls: 'ico-inline' })} Suggest me a trip</button>
        <p class="settings-hint" style="text-align:center;">Say where you're starting and how far you'll go.</p>
      `;

      // Not everything has a name you'd type. Somewhere you drove past, a
      // stretch of coast, the far side of a loch - point at it instead.
      body += `
        <div class="section-label">No name for it?</div>
        <button class="search-chip search-chip-wide" id="searchMapPick">${icon('map', { size: 16, cls: 'ico-inline' })} Point at it on a map</button>
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
      body += suggestionChips("Or ask for something else");
    } else if (!results.length) {
      // When everything suggested was dropped, "no matches" on its own is a
      // lie by omission - there were matches, they just could not be shown to
      // be near you, and that is a different problem with a different fix.
      const dropped = (pickSearch.outside || 0) + (pickSearch.unplaced || 0);
      body += `<div class="card"><p class="pick-status">${
        dropped
          ? `Nothing could be confirmed within ${esc(
              String(anchorMiles(pickSearch.anchor))
            )} miles of ${esc(
              (pickSearch.anchor && pickSearch.anchor.name) || "here"
            )}. ${esc(String(dropped))} suggestion${dropped === 1 ? " was" : "s were"} left out — ${
              pickSearch.unplaced
                ? "couldn't be found on the map"
                : "too far away"
            }.`
          : `No matches for “${esc(pickSearch.query)}” — try a shorter or more general name.`
      }</p>${
        dropped ? `<button class="link-btn" data-anchor-wider="1">Look further out</button>` : ""
      }${lastSearchError ? `<pre class="settings-result bad">${esc(lastSearchError)}</pre>` : ""}</div>`;
      body += suggestionChips("Or ask for something else");
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
            ["place", `${icon('castle', { size: 15, cls: 'ico-inline' })} To go ${counts.place}`],
            ["eat", `${icon('food', { size: 15, cls: 'ico-inline' })} To eat ${counts.eat}`],
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
                  r.isArea ? ` <span class="area-badge">${icon('globe', { size: 13, cls: 'ico-inline' })} ${esc(prettyCategory(r.type) || "Area")}</span>` : ""
                }${r.aiSuggested ? ` <span class="ai-badge">AI</span>` : ""}${ratingBadge(r)}</div>
                ${
                  r.kind === "event"
                    ? `<div class="place-when">${esc(eventDateLabel(r))}${
                        r.venue ? ` · ${esc(r.venue)}` : ""
                      }${r.price ? ` · ${esc(r.price)}` : ""}</div>`
                    : ""
                }
                <div class="place-notes">${esc(r.displayName || r.description || "")}</div>
                ${r.description ? `<div class="place-notes">${esc(r.description)}</div>` : ""}
                <div class="search-result-more">${
                  r.isArea ? "Save it to group places under it, or tap for details ›" : "Details ›"
                }</div>
              </button>
              ${
                r.sources && r.sources.length
                  ? `<div class="place-links"><a href="${esc(safeUrl(r.sources[0].uri))}" target="_blank" rel="noopener">${icon('link', { size: 14, cls: 'ico-inline' })} source</a></div>`
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
                    )}">${icon('directions', { size: 16 })}</button>`
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
      // Said separately, because it is a different fact: these were not too
      // far away, they were never found at all - and something nobody can put
      // on a map cannot be offered as being near you.
      if (pickSearch.unplaced) {
        body += `
          <p class="settings-hint search-outside">
            ${esc(String(pickSearch.unplaced))} suggestion${pickSearch.unplaced === 1 ? "" : "s"}
            couldn't be found on the map, so ${pickSearch.unplaced === 1 ? "it is" : "they are"} not shown —
            there is no way to tell whether ${pickSearch.unplaced === 1 ? "it is" : "they are"} anywhere near you.
          </p>
        `;
      }
      body += `<p class="settings-hint search-foot">＋ saves it, the compass looks around it, or tap the place to read about it first.${
        results.some((r) => r.isArea) ? " A town-or-area result: saving it gives it its own section." : ""
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
      // At the bottom of the results, where you end up when they were not
      // what you wanted.
      body += suggestionChips("Ask a different way");
    }

    searchOverlay.innerHTML = `
      <div class="search-head">
        <button class="search-back" data-search-close="1" aria-label="Close search">${icon('back', { size: 20, cls: 'ico-inline' })}</button>
        <form class="search-field" id="pickSearchForm">
          <input type="text" id="pickSearchInput" placeholder="Search for a place to add…"
                 autocomplete="off" autocorrect="off" value="${esc(pickSearch.query)}" />
          ${
            pickSearch.query
              ? `<button type="button" class="search-clear" id="searchClear" aria-label="Clear">${icon('close', { size: 17, cls: 'ico-inline' })}</button>`
              : ""
          }
        </form>
      </div>
      <button class="search-anchor${searchAnchor && searchAnchor.derived ? " guessed" : ""}" data-anchor-open="1">
        <span class="search-anchor-pin">${icon("pin", { size: 15 })}</span>
        <span class="search-anchor-text">${
          searchAnchor
            ? `${
                // A guessed area used to be indistinguishable from one you
                // chose, so nobody could tell that the thing deciding what
                // "nearby" meant had been invented from the middle of their
                // saved places.
                searchAnchor.derived ? "Guessing you mean within" : "Searching within"
              } <b>${esc(String(anchorMiles(searchAnchor)))} miles</b> of <b>${esc(searchAnchor.name)}</b>`
            : `Searching <b>anywhere</b>`
        }</span>
        <span class="search-anchor-change">${searchAnchor && searchAnchor.derived ? "Set it" : "Change"}</span>
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
            if (!r.photo) r.photo = wiki.photo || null;
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
          <button class="modal-close" data-close="1" aria-label="Close">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
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
                  ? `<button class="modal-btn" data-open-maps="${esc(safeUrl(r.website))}">${icon('link', { size: 16, cls: 'ico-inline' })} Website</button>`
                  : ""
              }
              ${mapsUrl ? `<button class="modal-btn" data-open-maps="${esc(mapsUrl)}">${icon('pin', { size: 16, cls: 'ico-inline' })} Google Maps</button>` : ""}
            </div>

            ${
              r.sources && r.sources.length
                ? `<div class="place-links" style="margin-top:10px;">${r.sources
                    .slice(0, 2)
                    .map(
                      (s) =>
                        `<a href="${esc(safeUrl(s.uri))}" target="_blank" rel="noopener">${icon('link', { size: 14, cls: 'ico-inline' })} ${esc(s.title || "source")}</a>`
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
    makeSheetDraggable(placeModal, closePlaceModal);

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
        // quickAdd refreshes the list itself, once the folder question has
        // actually been answered - redrawing it here would mark a place as
        // saved while the question is still on screen. When it asks nothing,
        // though, this sheet is finished with and closing it is the whole of
        // what "saved" should feel like.
        if (!quickAdd(r)) {
          closePlaceModal();
          if (searchOverlay.classList.contains("open")) renderSearchOverlay();
          else if (view.dataset.activeTab) showView(view.dataset.activeTab);
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
      L.marker([r.lat, r.lon], { icon: dropIcon(categoryIcon(r)) }).addTo(map);
      setTimeout(() => {
        if (map._container && map._container.isConnected) map.invalidateSize();
      }, 60);
    }
  }

  // Changing where a search looks. Everything that can name a place is offered
  // in the order you are likely to have one: the areas you have saved, where
  // you are standing, and a box that takes a town or a postcode.
  // `onDone` lets a caller that is not the search overlay react to the area
  // changing - the What's on screen, which has its own list to redraw.
  function openAnchorSheet(onDone) {
    const current = searchAnchor;
    const miles = anchorMiles(current);
    const areas = loadPicks().filter((p) => p.major && p.lat != null);

    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="Where to search">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
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
    makeSheetDraggable(placeModal, closePlaceModal);

    const say = (text) => {
      const el = document.getElementById("anchorStatus");
      if (el) el.textContent = text;
    };
    const apply = (anchor) => {
      // Choosing one makes it yours rather than a guess.
      const chosen = anchor ? Object.assign({}, anchor) : null;
      if (chosen) {
        delete chosen.derived;
        delete chosen.spread;
      }
      useAnchorForThisSearch(chosen);
      saveAnchor(chosen);
      closePlaceModal();
      if (onDone) {
        onDone(chosen);
        return;
      }
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
    searchOverlay.querySelectorAll("[data-surprise]").forEach((b) =>
      b.addEventListener("click", () => {
        const ask = aSurprise();
        const input = document.getElementById("pickSearchInput");
        if (input) input.value = ask;
        runSearch(ask);
      })
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
        // Through the same door as every other anchor change, or the search
        // that re-runs a line later reads the old one back out of
        // loadAnchor() and undoes this. And widening on purpose makes it
        // yours: it stops being a guess the moment you act on it.
        const widened = Object.assign({}, base, { miles: next });
        delete widened.derived;
        delete widened.spread;
        useAnchorForThisSearch(widened);
        saveAnchor(widened);
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
  // Past this, the centre of your saved places is not a place - it is the
  // middle of the gap between them - so no area is guessed at all.
  const DERIVED_ANCHOR_MAX_SPREAD = 60;

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
    // A search that derived its own area owns every lookup that follows from
    // its results, or the two disagree - see useAnchorForThisSearch.
    if (anchorInForce) return anchorInForce;
    const stored = readJson(boardKey(activeBoard().id, ANCHOR_PART), null);
    if (stored === "anywhere") return null;
    if (stored && typeof stored === "object" && stored.lat != null) return stored;
    return derivedAnchor();
  }

  function saveAnchor(anchor) {
    store(boardKey(activeBoard().id, ANCHOR_PART), JSON.stringify(anchor || "anywhere"));
  }

  // A first guess from what is already saved, so the very first search is
  // bounded too. Shown on screen like any other anchor, and cleared in one
  // tap - a guess you can see and change is a different thing from a guess
  // made behind your back.
  // The folder most of these places are filed under, when there is a clear
  // winner. "Unsorted" is not a place, so it never wins.
  function commonestFolder(picks) {
    const counts = {};
    picks.forEach((p) => {
      const city = (p.city || "").trim();
      if (!city || city === "Unsorted" || city === "Saved") return;
      counts[city] = (counts[city] || 0) + 1;
    });
    const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    if (!names.length) return null;
    // A tie is not a winner: two towns equally represented is exactly the
    // case where naming one of them would be misleading.
    if (names.length > 1 && counts[names[0]] === counts[names[1]]) return null;
    return names[0];
  }

  function derivedAnchor() {
    const picks = loadPicks().filter((p) => p.lat != null);
    if (!picks.length) return null;

    const majors = picks.filter((p) => p.major);
    if (majors.length === 1) {
      return {
        name: majors[0].name,
        lat: majors[0].lat,
        lon: majors[0].lon,
        miles: DEFAULT_ANCHOR_MILES,
        derived: true,
      };
    }

    // The centre of everything saved, and a radius that used to stretch to
    // reach the furthest of them - up to 150 miles.
    //
    // That was the root of every wrong-place report. Places saved across
    // Scotland plus one in London put this centroid in the Midlands with a
    // circle wide enough to contain both, and since this is what loadAnchor()
    // returns whenever nothing has been set - the default state of every
    // board - every proximity check in the app was being asked the wrong
    // question. Chelsea really was inside the area being searched.
    //
    // A guessed area is now never wider than one you would have chosen, and
    // it is marked so the screen can say it is a guess and offer to fix it.
    // Places further out than that are reachable by setting an area on
    // purpose, which is a decision rather than an accident.
    const lat = picks.reduce((n, p) => n + p.lat, 0) / picks.length;
    const lon = picks.reduce((n, p) => n + p.lon, 0) / picks.length;
    // Naming the guess used to lean on three hardcoded Scottish anchors, so
    // anywhere else fell straight through to the destination and a guess
    // centred on Stirling announced itself as "Scotland" - a whole country,
    // which is exactly the shape of the bug this radius cap was fixing.
    // The places themselves already know where they are: the folder most of
    // the nearby ones sit in is a better name than the region they are in.
    const name =
      nearestMajorPlace(lat, lon) ||
      commonestFolder(picks) ||
      activeBoard().destination ||
      "your places";

    // Spread out far enough that the centroid is not near anything in
    // particular - the average of Edinburgh and Skye is a field - so anchoring
    // there would be worse than not anchoring at all. Say so instead.
    const spread = Math.max(...picks.map((p) => toMiles(haversineKm(lat, lon, p.lat, p.lon))));
    if (spread > DERIVED_ANCHOR_MAX_SPREAD) return null;

    return { name, lat, lon, miles: DEFAULT_ANCHOR_MILES, derived: true, spread: Math.round(spread) };
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

  // Permissive: unknown coordinates pass. Correct for DISPLAYING things that
  // are already yours - a saved place the geocoder never managed to place
  // should not vanish out of your own list - and wrong for deciding what a
  // search may offer. Named for what it does, because the previous name made
  // those two readings look identical at the call site.
  function withinAnchorOrUnknown(anchor, lat, lon, grace) {
    if (!anchor || lat == null || lon == null) return true;
    return toMiles(haversineKm(anchor.lat, anchor.lon, lat, lon)) <= anchorMiles(anchor) * (grace || 1);
  }

  // The strict one: what a search is allowed to offer as nearby. Unknown
  // coordinates are not "within" - if we cannot place it, we cannot claim it.
  //
  // This was written during an earlier attempt at the wrong-place bug,
  // documented at length as the fix, and then called from nowhere for days
  // while the permissive version stayed in the filter. Every call site that
  // decides what to SHOW now uses this one.
  function confirmedWithinAnchor(anchor, lat, lon, grace) {
    if (!anchor) return true;
    if (lat == null || lon == null) return false;
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
    if (bound && !confirmedWithinAnchor(bound, geo.lat, geo.lon, ANCHOR_GRACE)) return null;
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
  // Counted apart from "too far": one is a place we located and rejected,
  // the other is a place we never located at all.
  let lastSearchUnplaced = 0;

  async function searchPlaces(query, guidance, anchor) {
    lastSearchError = "";
    lastSearchOutside = 0;
    lastSearchUnplaced = 0;
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
    // Permissive here on purpose: an AI result arrives as a name and is
    // geocoded a moment later by placeSearchResults, so anything without
    // coordinates yet is unplaced rather than wrong. The strict check belongs
    // there, once the answer is actually in.
    const results = found.filter((r) => {
      // Permissive on purpose, and only here: an AI result arrives as a name
      // with no coordinates and is geocoded a moment later by
      // placeSearchResults, which applies the strict rule once the answer is
      // actually in. Anything still unplaced after that is dropped there.
      if (withinAnchorOrUnknown(anchor, r.lat, r.lon, ANCHOR_GRACE)) return true;
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
      try {
        data = (await cachedJson(url, { headers: { Accept: "application/json" } })).data;
      } catch (e) {
        return [];
      }
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
    const res = await fetchWithTimeout("https://places.googleapis.com/v1/places:searchText", {
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
    }, NET_TIMEOUT_SLOW_MS);

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
    const data = (await cachedJson(url, { headers: { Accept: "application/json" } })).data;
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
  // The same database now holds the other two things worth not paying for
  // twice: the photographs, as blobs, so a list of places looks like a list
  // of places with no signal; and the geocoder's answers, because a place
  // does not move and asking again is both slow and rate-limited.
  const PHOTO_STORE = "photos";
  const GEO_STORE = "geocode";
  const DB_VERSION = 2;
  let tileDbPromise = null;

  // Raw IndexedDB is all request objects and onsuccess/onerror pairs, and the
  // failure mode is quiet: a transaction that auto-closes because an await
  // slipped between two operations does not throw, it just does nothing.
  // `idb` is four kilobytes that turn the whole thing into promises.
  //
  // It stays optional. The hand-rolled path below still works, because a
  // vendored file failing to load should cost you the map cache, not the app.
  function tileDb() {
    if (tileDbPromise) return tileDbPromise;
    const upgrade = (db) => {
      [TILE_STORE, PHOTO_STORE, GEO_STORE].forEach((name) => {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      });
    };
    tileDbPromise = (window.idb && window.idb.openDB
      ? window.idb.openDB(TILE_DB, DB_VERSION, { upgrade })
      : new Promise((resolve, reject) => {
          if (!window.indexedDB) return reject(new Error("no indexeddb"));
          const req = indexedDB.open(TILE_DB, DB_VERSION);
          req.onupgradeneeded = () => upgrade(req.result);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
    ).catch((e) => {
      tileDbPromise = null;
      throw e;
    });
    return tileDbPromise;
  }

  // Both shapes answer `get`/`put`/`count`/`clear` the same way; only idb's
  // are already promises. This is the one place that has to know which it got.
  function dbIsWrapped() {
    return !!(window.idb && window.idb.openDB);
  }

  async function dbGet(store, key) {
    try {
      const db = await tileDb();
      if (dbIsWrapped()) {
        const value = await db.get(store, key);
        return value === undefined ? null : value;
      }
      return await new Promise((resolve) => {
        const req = db.transaction(store, "readonly").objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
        req.onerror = () => resolve(null);
      });
    } catch (e) {
      return null;
    }
  }

  async function dbPut(store, key, value) {
    try {
      const db = await tileDb();
      if (dbIsWrapped()) {
        await db.put(store, value, key);
        return true;
      }
      return await new Promise((resolve) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) {
      return false;
    }
  }

  // ---------- Photographs, kept ----------
  // `photoBlock` pointed an <img> straight at upload.wikimedia.org, so the
  // one thing that made a list of places feel like somewhere you might go
  // was also the one thing guaranteed to be missing when you were actually
  // there. A picture that has already been downloaded once is kept, and used
  // when the network cannot supply it again.
  const photoObjectUrls = {};

  async function keepPhoto(url) {
    if (!url || photoObjectUrls[url]) return;
    if (await dbGet(PHOTO_STORE, url)) return;
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) return;
      const blob = await res.blob();
      // A thumbnail is tens of kilobytes; anything far larger is not one, and
      // is not worth the room on a phone.
      if (blob.size > 900000) return;
      await dbPut(PHOTO_STORE, url, blob);
    } catch (e) {
      /* no signal, or the picture has gone - nothing to record */
    }
  }

  async function photoFromCache(url) {
    if (!url) return null;
    if (photoObjectUrls[url]) return photoObjectUrls[url];
    const blob = await dbGet(PHOTO_STORE, url);
    if (!blob) return null;
    photoObjectUrls[url] = URL.createObjectURL(blob);
    return photoObjectUrls[url];
  }

  // Called from the <img> itself, which is the only place that knows whether
  // the picture arrived. Both handlers are on window because the markup is
  // built as a string in a dozen places.
  window.__photoSeen = (img) => {
    keepPhoto(img.getAttribute("data-photo") || img.src);
  };

  window.__photoGone = (img) => {
    const url = img.getAttribute("data-photo") || img.src;
    // Whatever happens next, this handler must not run again on the same
    // element, or a cached blob that also fails would loop.
    img.onerror = null;
    img.removeAttribute("onerror");
    photoFromCache(url).then((objUrl) => {
      if (objUrl) {
        img.src = objUrl;
        return;
      }
      if (img.parentNode) img.parentNode.classList.add("photo-failed");
      img.remove();
    });
  };

  // ---------- The geocoder's answers, kept ----------
  // A place does not move. Asking Nominatim the same question twice is a
  // second wait, a second helping of its one-request-a-second rate limit, and
  // no chance at all of an answer when there is no signal.
  const GEO_CACHE_MS = 30 * 24 * 60 * 60 * 1000;

  // Answers `{ data, fromCache }` - the second half so the caller can skip the
  // deliberate pause between lookups when nothing was actually asked.
  async function cachedJson(url, opts, ms) {
    const hit = await dbGet(GEO_STORE, url);
    if (hit && Date.now() - hit.at < GEO_CACHE_MS) return { data: hit.data, fromCache: true };
    const res = await fetchWithTimeout(url, opts, ms);
    if (!res.ok) {
      // A stale answer beats an error: this is a place's coordinates, not a
      // train time.
      if (hit) return { data: hit.data, fromCache: true };
      const err = new Error(`lookup ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    // A miss is never written down. "Nothing found" is far more often the
    // geocoder having a moment, or a place nobody has mapped yet, than a
    // settled fact - and remembering it for a month means a place that gets
    // added to OpenStreetMap tomorrow stays unfindable until well after the
    // trip is over.
    const empty = Array.isArray(data) ? data.length === 0 : !data;
    if (!empty) dbPut(GEO_STORE, url, { at: Date.now(), data });
    return { data, fromCache: false };
  }

  function tileKey(z, x, y) {
    return `${z}/${x}/${y}`;
  }

  function readTile(z, x, y) {
    return dbGet(TILE_STORE, tileKey(z, x, y));
  }

  function writeTile(z, x, y, blob) {
    return dbPut(TILE_STORE, tileKey(z, x, y), blob);
  }

  async function countTiles() {
    try {
      const db = await tileDb();
      if (dbIsWrapped()) return (await db.count(TILE_STORE)) || 0;
      return await new Promise((resolve) => {
        const req = db.transaction(TILE_STORE, "readonly").objectStore(TILE_STORE).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
      });
    } catch (e) {
      return 0;
    }
  }

  // "2,500 map tiles" is a number about the app. Nobody has any idea whether
  // that is a lot. Room on the phone is the thing actually being spent, so
  // that is the thing reported.
  async function tilesBytes() {
    try {
      const db = await tileDb();
      if (dbIsWrapped()) {
        // getAll on blobs is one read rather than a cursor walk, and the only
        // thing wanted from each is its size.
        const blobs = await db.getAll(TILE_STORE);
        return blobs.reduce((n, b) => n + (b && typeof b.size === "number" ? b.size : 0), 0);
      }
      return await new Promise((resolve) => {
        let total = 0;
        const req = db.transaction(TILE_STORE, "readonly").objectStore(TILE_STORE).openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return resolve(total);
          if (cursor.value && typeof cursor.value.size === "number") total += cursor.value.size;
          cursor.continue();
        };
        req.onerror = () => resolve(total);
      });
    } catch (e) {
      return 0;
    }
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 MB";
    const mb = bytes / (1024 * 1024);
    if (mb < 0.1) return "under 0.1 MB";
    if (mb < 10) return `${mb.toFixed(1)} MB`;
    return `${Math.round(mb)} MB`;
  }

  async function clearTiles() {
    try {
      const db = await tileDb();
      if (dbIsWrapped()) {
        await db.clear(TILE_STORE);
        return;
      }
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
          return fetchWithTimeout(tileUrl(coords.z, coords.x, coords.y))
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

  // Everywhere the trip actually touches: the saved places, whatever the plan
  // schedules, and the area you are currently searching around. The last two
  // were missing, so a stop added to a day and never saved as a pick, and the
  // town you are standing in, both fell outside the download.
  function offlineStops() {
    const stops = loadPicks()
      .filter((p) => p.lat != null && p.lon != null)
      .map((p) => ({ lat: p.lat, lon: p.lon }));
    const plan = loadPlan();
    const byId = {};
    loadPicks().forEach((p) => {
      byId[p.id] = p;
    });
    Object.values((plan && plan.items) || {}).forEach((items) => {
      (items || []).forEach((item) => {
        const pick = byId[item.pickId];
        if (pick && pick.lat != null && pick.lon != null) stops.push({ lat: pick.lat, lon: pick.lon });
        else if (item.lat != null && item.lon != null) stops.push({ lat: item.lat, lon: item.lon });
      });
    });
    const anchor = loadAnchor();
    if (anchor && anchor.lat != null && anchor.lon != null) stops.push({ lat: anchor.lat, lon: anchor.lon });
    return stops;
  }

  // A margin around the trip, because you walk between its stops rather than
  // teleporting to each one.
  function savedPlacesBounds(padDegrees) {
    const located = offlineStops();
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

  function tileCentre(z, x, y) {
    const n = Math.pow(2, z);
    const lon = ((x + 0.5) / n) * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n)));
    return { lat: (latRad * 180) / Math.PI, lon };
  }

  function kmToNearestStop(tile, stops) {
    const c = tileCentre(tile.z, tile.x, tile.y);
    let best = Infinity;
    for (const s of stops) {
      const d = haversineKm(c.lat, c.lon, s.lat, s.lon);
      if (d < best) best = d;
    }
    return best;
  }

  // The old trim was `wanted.slice(0, 2500)`. Tiles are pushed z, then x, then
  // y - so that kept street detail for the westernmost strip of the map and
  // silently dropped the east, with nobody told which half they got. A trip
  // that runs west to east got half a trip and no warning.
  //
  // What matters is not where a tile sits in an array but how near it is to
  // somewhere you are going. Coarse zooms are kept whole - they are cheap and
  // they are what stops the map having holes in it - and the detailed zooms
  // are filled in from the stops outwards until the budget runs out.
  function chooseTiles(bounds, stops, cap) {
    const kept = [];
    let dropped = 0;
    let detailTrimmed = false;
    for (const z of OFFLINE_ZOOMS) {
      const atZoom = tilesForBounds(bounds, [z]);
      const room = cap - kept.length;
      if (atZoom.length <= room) {
        kept.push.apply(kept, atZoom);
        continue;
      }
      if (room > 0 && stops.length) {
        atZoom.sort((a, b) => kmToNearestStop(a, stops) - kmToNearestStop(b, stops));
        kept.push.apply(kept, atZoom.slice(0, room));
        dropped += atZoom.length - room;
      } else {
        dropped += atZoom.length;
      }
      detailTrimmed = true;
    }
    return { kept, dropped, detailTrimmed };
  }

  // Deliberately serial with a pause between requests. OpenStreetMap's tile
  // policy asks that bulk downloading be avoided; a few hundred tiles for one
  // family's week, fetched politely, is a different thing from scraping, and
  // the cap plus the delay keep it that way.
  async function downloadTiles(onProgress) {
    const bounds = savedPlacesBounds();
    if (!bounds) return { ok: false, message: "Save a few places first — the download follows where they are." };

    const stops = offlineStops();
    const total = tilesForBounds(bounds, OFFLINE_ZOOMS).length;
    const { kept: wanted, dropped, detailTrimmed } = chooseTiles(bounds, stops, OFFLINE_TILE_CAP);

    let done = 0;
    let saved = 0;
    let bytes = 0;
    for (const c of wanted) {
      if (tileDownload.cancelled) break;
      done++;
      try {
        const already = await readTile(c.z, c.x, c.y);
        if (!already) {
          const res = await fetchWithTimeout(tileUrl(c.z, c.x, c.y));
          if (res.ok) {
            const blob = await res.blob();
            await writeTile(c.z, c.x, c.y, blob);
            saved++;
            bytes += blob.size || 0;
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
      return {
        ok: true,
        message: `Stopped — ${formatBytes(bytes)} of map kept. What downloaded still works offline.`,
      };
    }
    return {
      ok: true,
      message:
        `Saved ${formatBytes(bytes)} of map around your places` +
        (saved < wanted.length ? ` (${wanted.length - saved} already stored).` : ".") +
        (detailTrimmed
          ? ` Street-level detail was filled in nearest your stops first and ran out ` +
            `${dropped} tiles short of covering everywhere — the far corners of the area ` +
            `will be less detailed offline. Saving fewer places, or clearing and ` +
            `downloading again after the plan settles, covers more of what you need.`
          : ""),
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
      L.marker([r.lat, r.lon], { icon: dropIcon(categoryIcon(r)) })
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
    L.marker([pick.lat, pick.lon], { icon: dropIcon(categoryIcon(pick)) }).addTo(map);
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
        <button class="map-close" data-map-close="1" aria-label="Close map">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
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
               <button class="map-open-btn" id="allMapGoogle">${icon("external", { size: 16, cls: "ico-inline" })} ${
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

    // Where you are, if the app already knows. Finding your location in
    // Explore and then opening this map showed everything except you - the
    // marker only ever existed as a side effect of pressing the locate
    // button, so the one place you had just established was the one place
    // missing from the map of everywhere.
    if (lastFix) drawMeOnAllMap(lastFix);

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
    // Include yourself in the frame, or the marker exists on a part of the
    // map nothing ever scrolls to - which looks exactly like not being there.
    if (lastFix) bounds.extend([lastFix.lat, lastFix.lon]);
    if (mappable.length === 1 && !lastFix) allMap.setView(bounds.getCenter(), 15);
    else allMap.fitBounds(bounds.pad(0.2));
    // The overlay is only laid out once it's visible, so Leaflet's idea of
    // the canvas size is stale until the next frame.
    requestAnimationFrame(() => {
      if (allMap && allMap._container && allMap._container.isConnected) allMap.invalidateSize();
    });

    const locate = document.getElementById("allMapLocate");
    if (locate) locate.addEventListener("click", () => showMeOnAllMap(locate));
  }

  // One marker, drawn once - and the circle around it is how far out the fix
  // might be, which is a fact worth seeing rather than a dot pretending to
  // know exactly.
  let meLayer = null;

  function drawMeOnAllMap(fix) {
    if (!allMap || !fix) return;
    if (meLayer) {
      allMap.removeLayer(meLayer);
      meLayer = null;
    }
    const group = L.layerGroup();
    if (fix.accuracy != null && fix.accuracy > FIX_GOOD_ENOUGH_M) {
      L.circle([fix.lat, fix.lon], {
        radius: fix.accuracy,
        color: "#1a73e8",
        weight: 1,
        fillColor: "#1a73e8",
        fillOpacity: 0.08,
      }).addTo(group);
    }
    L.circleMarker([fix.lat, fix.lon], {
      radius: 8,
      color: "#fff",
      weight: 3,
      fillColor: "#1a73e8",
      fillOpacity: 1,
    })
      .addTo(group)
      .bindTooltip(fix.accuracy != null ? `You are here, ${fixAccuracyNote(fix.accuracy)}` : "You are here");
    group.addTo(allMap);
    meLayer = group;
  }

  async function showMeOnAllMap(btn) {
    if (!allMap) return;
    btn.disabled = true;
    try {
      const pos = await currentPosition();
      if (!allMap) return;
      drawMeOnAllMap(pos);
      allMap.setView([pos.lat, pos.lon], Math.max(allMap.getZoom(), 14));
    } catch (e) {
      toast((e && e.message) || "Couldn't get your location");
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- Where you actually are ----------
  // Both callers asked for enableHighAccuracy: false, and the browser path
  // would accept a fix up to a minute old. On Android that means the network
  // fix - cell masts and wifi - which in a town is a few hundred metres out
  // and in open country can be kilometres. Everything downstream then
  // inherits that error: the search anchor, the distances, "what's near me".
  // Hence "it never works accurate".
  //
  // So: the real satellite fix, no cached answer, and - because a GPS fix
  // arrives rough and improves over the next few seconds - keep listening
  // briefly and take the best one rather than the first one.
  const FIX_GOOD_ENOUGH_M = 40;
  const FIX_WAIT_MS = 8000;

  // The last fix, kept so the map and the anchor can show where you are
  // without asking the hardware again.
  let lastFix = null;

  function rememberFix(fix) {
    lastFix = { ...fix, at: Date.now() };
    return lastFix;
  }

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
        const first = await geo.getCurrentPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
        let best = {
          lat: first.coords.latitude,
          lon: first.coords.longitude,
          accuracy: first.coords.accuracy,
        };
        if (best.accuracy != null && best.accuracy <= FIX_GOOD_ENOUGH_M) return rememberFix(best);

        // Watch for a few seconds: the first fix is the worst one you will
        // get, and standing still for five seconds usually halves it.
        await new Promise((resolve) => {
          let watchId = null;
          const stop = () => {
            if (watchId != null) geo.clearWatch({ id: watchId }).catch(() => {});
            resolve();
          };
          const timer = setTimeout(stop, FIX_WAIT_MS);
          geo.watchPosition({ enableHighAccuracy: true, timeout: FIX_WAIT_MS }, (pos, err) => {
            if (err || !pos) return;
            const a = pos.coords.accuracy;
            if (best.accuracy == null || (a != null && a < best.accuracy)) {
              best = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: a };
            }
            if (a != null && a <= FIX_GOOD_ENOUGH_M) {
              clearTimeout(timer);
              stop();
            }
          })
            .then((id) => {
              watchId = id;
            })
            .catch(() => {
              clearTimeout(timer);
              resolve();
            });
        });
        return rememberFix(best);
      })();
    }
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("This device didn't offer location access."));
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve(
            rememberFix({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy })
          ),
        (err) => reject(new Error(`Couldn't get your location: ${err.message}`)),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
      );
    });
  }

  // How far out the fix might be, said plainly. A location the app is not
  // sure about is worth knowing about before you search a mile around it.
  function fixAccuracyNote(accuracy) {
    if (accuracy == null) return "";
    const m = Math.round(accuracy);
    if (m <= FIX_GOOD_ENOUGH_M) return `to within ${m}m`;
    if (m < 1000) return `give or take ${m}m`;
    return `only to within ${(m / 1000).toFixed(1)}km — move outside for a better fix`;
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
        <button class="map-close" data-mappick-close="1" aria-label="Cancel">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
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
      const data = (
        await cachedJson(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${lon}`,
          { headers: { Accept: "application/json" } }
        )
      ).data;
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
    // An event is a place with a date on it. Everything above applies
    // unchanged; these are the fields a place has no use for.
    if (candidate.kind === "event") {
      pick.kind = "event";
      // Every event field at once. The hand-written version of this list was
      // missing endsAt and approximate, so a festival that said "until Sat 5
      // Sept" in the results became a one-day thing the moment you saved it,
      // and the "approx. location" caveat vanished - which is the worse half,
      // because the pin then looked exactly as trustworthy as a confirmed one.
      copyEventFields(candidate, pick);
      // booking is stored under the name a place already uses, so the morning
      // brief's "N still to book" counts events without a line of change.
      pick.booking = !!candidate.booking;
      // A model naming a festival that is not happening is the obvious way
      // this goes wrong, so the row says so and links what it read.
      pick.unverified = true;
      if (Array.isArray(candidate.sources) && candidate.sources.length) {
        pick.sources = candidate.sources.slice(0, 4);
      }
    }
    picks.push(pick);
    savePicks(picks);
    // The whole point of an event having a date: it goes in the day it is on,
    // at the time it starts, without being dragged there.
    if (pick.kind === "event") {
      addEventToItsDay(pick);
      // Saved is the other moment it matters: it now has a pin on your map and
      // a day in your plan, and a town-centre approximation for both is worse
      // than one request.
      refineEventVenue(pick.id, () => {
        if (view.dataset.activeTab === "events") renderEvents();
      });
    }
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
            .then((list) => list.filter((c) => confirmedWithinAnchor(loadAnchor(), c.lat, c.lon, ANCHOR_GRACE)))
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
      if (wiki.photo) target.photo = wiki.photo;
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
  // ---------- Finding something you have already saved ----------
  // The only search box on this screen looks for places on the internet to
  // add. There was never a way to search what you had already saved, so forty
  // picks across six folders meant folding sections and scrolling - the app
  // was better at finding somewhere new than finding somewhere you had already
  // decided you wanted.
  //
  // Fuse does the matching. Hand-rolling this always starts as
  // `name.toLowerCase().includes(q)` and then wants typo tolerance, matching
  // on the town or the note as well as the name, and some sense of which hit
  // is better than which - all of which is a solved problem nobody should be
  // solving again.
  let pickFilter = "";

  const FIND_KEYS = [
    { name: "name", weight: 0.6 },
    { name: "city", weight: 0.15 },
    { name: "category", weight: 0.1 },
    { name: "note", weight: 0.1 },
    { name: "address", weight: 0.05 },
  ];

  function findInPicks(list, query) {
    const q = (query || "").trim();
    if (!q) return list;
    const Fuse = typeof window !== "undefined" ? window.Fuse : null;
    if (!Fuse) {
      // Without the library, a plain substring match over the same fields.
      // Worse, but never nothing.
      const needle = q.toLowerCase();
      return list.filter((p) =>
        FIND_KEYS.some((k) => String(p[k.name] || "").toLowerCase().includes(needle))
      );
    }
    const fuse = new Fuse(list, {
      keys: FIND_KEYS,
      // Tight enough that "castle" doesn't match "Cafe", loose enough to
      // survive a thumb typing on a moving train.
      threshold: 0.38,
      ignoreLocation: true,
      minMatchCharLength: 2,
    });
    return fuse.search(q).map((hit) => hit.item);
  }

  function renderFindBar(total) {
    // Not worth the room until there is enough saved that scrolling is the
    // problem it solves.
    if (total < 8 && !pickFilter) return "";
    return `
      <div class="find-bar">
        <span class="find-icon" data-ico="search" data-ico-size="17"></span>
        <input class="find-input" id="pickFind" type="search" autocomplete="off"
               placeholder="Find something you've saved…" value="${esc(pickFilter)}"
               aria-label="Find something you have already saved" />
        ${pickFilter ? `<button class="find-clear" id="pickFindClear" aria-label="Clear">${icon("close", { size: 15 })}</button>` : ""}
      </div>
    `;
  }

  const KIND_FILTERS = [
    { key: "all", label: "All" },
    { key: "place", label: `${icon('castle', { size: 17, cls: 'ico-inline' })} To do` },
    { key: "eat", label: `${icon('food', { size: 17, cls: 'ico-inline' })} Eat` },
    { key: "event", label: `${icon('events', { size: 17, cls: 'ico-inline' })} On` },
  ];

  // Entry point for the old Places/Eats routes: same screen, filter preset.
  function renderPicksFiltered(kind) {
    pickKindFilter = kind;
    renderPicks();
  }

  function renderPicks() {
    const all = loadPicks();
    const byKind = pickKindFilter === "all" ? all : all.filter((p) => p.major || pickKind(p) === pickKindFilter);
    // Two different searches, deliberately kept apart: the box at the top
    // finds places on the internet to add, the one below finds places you
    // already have. Conflating them is how you end up unable to do either.
    const picks = findInPicks(byKind, pickFilter);

    let html = `
      <div class="search-trigger-wrap">
        <span class="search-trigger-icon" data-ico="search" data-ico-size="19"></span>
        <input class="search-trigger-input" id="pickSearchTrigger" type="text"
               placeholder="Search for a place, town or area…" readonly
               aria-label="Search for a place to add" />
      </div>
      ${renderExplore()}
      ${renderFindBar(all.length)}
    `;

    if (pickFilter) {
      html += `<p class="find-result">${
        picks.length
          ? `${picks.length} of ${byKind.length} match “${esc(pickFilter)}”`
          : `Nothing saved matches “${esc(pickFilter)}”`
      }</p>`;
    }

    // Only worth showing once there is a mix to separate. A filter over four
    // places that are all cafés is a control that can only ever hide things.
    // Also shown whenever a filter is already on, so an active filter can
    // never be the reason its own control is hidden.
    const kinds = new Set(all.filter((p) => !p.major).map((p) => pickKind(p)));
    if (kinds.size > 1 || pickKindFilter !== "all") {
      html += `<div class="filter-row kind-row">${KIND_FILTERS.filter(
        (k) => k.key === "all" || k.key === pickKindFilter || kinds.has(k.key)
      ).map(
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
          <button class="modal-btn modal-btn-primary" data-open-search="1" style="width:100%;margin-top:12px;">${icon('search', { size: 18, cls: 'ico-inline' })} Search for a place</button>
          <button class="modal-btn" data-open-idea="1" style="width:100%;margin-top:8px;">${icon('directions', { size: 17, cls: 'ico-inline' })} Suggest a trip</button>
          <p class="settings-hint">Tapping ♡ on a guide suggestion below saves it here too.</p>
        </div>
      `;
    } else if (!picks.length) {
      html += `<div class="card"><p class="pick-status">Nothing saved under that filter yet.</p></div>`;
    } else {
      // A major place heads the section named after it rather than appearing
      // as a row inside it - it *is* the section. (If one has been moved into
      // some other folder by hand, it goes back to being an ordinary row
      // there, which is the only sensible reading of that move.) This only
      // applies where sections are areas; in the other orders it is a place
      // like any other.
      const sortKey = picks.length > 2 ? loadSort() : "area";
      const majorByName = {};
      if (sortKey === "area") {
        picks.forEach((p) => {
          if (p.major && p.city === p.name) majorByName[p.name] = p;
        });
      }
      const listed = picks.filter((p) => majorByName[p.name] !== p);

      if (picks.length > 2) html += renderSortRow(sortKey);

      const sections = groupPicks(listed, sortKey);
      // A town you have saved heads its own section even before anything has
      // been filed under it: that header is how you get at what is around it,
      // so it cannot wait for the section to have contents.
      if (sortKey === "area") {
        Object.keys(majorByName).forEach((name) => {
          if (!sections.some((s) => s.area === name)) {
            sections.push({ label: name, area: name, count: 0, rows: [] });
          }
        });
        const order = loadFolders();
        const rank = (s) => {
          const i = order.indexOf(s.area);
          return i < 0 ? order.length + (s.area === "Unsorted" ? 1 : 0) : i;
        };
        sections.sort((a, b) => rank(a) - rank(b));
      }
      if (!sections.length) {
        html += `<div class="card"><p class="pick-status">Nothing to show in this order.</p></div>`;
      }
      const collapsed = loadCollapsed();
      html += foldAllBar(sections.map((x) => x.label));
      sections.forEach((s) => {
        const major = s.area ? majorByName[s.area] : null;
        const folded = collapsed.includes(s.label);
        html += major
          ? renderMajorHeader(major, s.count, folded)
          : sectionHead(s.label, s.count, folded);
        if (folded) return;
        s.rows.forEach((r) => {
          html += renderPickRow(r.pick, r.away, r.meta, sortKey === "day" && !s.loose);
        });
      });

      // Only what is on this screen, three at a time - see fetchMissingPhotos.
      fetchMissingPhotos(listed, () => {
        if (view.dataset.activeTab === "picks") renderPicks();
      });

      // Sharing is not navigation, and it was sitting between the filters and
      // the first place on the list. It belongs after the thing being shared.
      html += `<button class="hero-share" id="sharePicks" style="margin:18px 0 4px;">${icon('share', { size: 17, cls: 'ico-inline' })} Share my picks</button>`;
    }

    destroyMiniMaps();
    view.innerHTML = html;
    wireExplore();

    const findInput = document.getElementById("pickFind");
    if (findInput) {
      findInput.addEventListener("input", () => {
        pickFilter = findInput.value;
        const caret = findInput.selectionStart;
        renderPicks();
        // renderPicks replaces the field, so put the cursor back where the
        // thumb left it - otherwise every second character types itself at
        // the front of the box.
        const again = document.getElementById("pickFind");
        if (again) {
          again.focus();
          try {
            again.setSelectionRange(caret, caret);
          } catch (e) {
            /* a search input can refuse a range; the focus is the point */
          }
        }
      });
    }
    const findClear = document.getElementById("pickFindClear");
    if (findClear) {
      findClear.addEventListener("click", () => {
        pickFilter = "";
        renderPicks();
      });
    }

    view.querySelectorAll("[data-pick-kind-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        pickKindFilter = btn.getAttribute("data-pick-kind-filter");
        renderPicks();
      });
    });

    wireSortRow(renderPicks);

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
        const lines = [`📍 My picks — ${activeBoard().name}`, ""];
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
  const WEATHER_HORIZON_DAYS = 16;
  // What counts as a wet day. One number, used by the forecast line, by the
  // events verdict and by the indoor filter, so those three cannot drift into
  // disagreeing with each other on screen.
  const WET_ENOUGH = 50; // as far as Open-Meteo forecasts

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
          store(WEATHER_KEY, JSON.stringify(c));
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
    const res = await fetchWithTimeout(url);
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
          store(DEST_COORDS_KEY, JSON.stringify(c));
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
    const wet = d.rainChance != null && d.rainChance >= WET_ENOUGH;
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

  // ---------- How much daylight is left ----------
  // A trip planned in a northern summer and a trip planned in a northern
  // November are different trips, and the app could not tell you which one you
  // were on. "Sunset 16:02" is the single fact that decides whether a hill
  // walk at half three is a nice idea or a bad one, and it is not something
  // anybody can work out in their head for a given date and latitude.
  //
  // SunCalc is doing the astronomy. It also arrived as a dependency of
  // opening_hours, which needs it to answer "sunrise-sunset" opening times -
  // so this costs nothing extra beyond the wiring.
  function sunTimes(date, anchor) {
    const SC = typeof window !== "undefined" ? window.SunCalc : null;
    if (!SC || !anchor || anchor.lat == null || !date) return null;
    try {
      const t = SC.getTimes(date, anchor.lat, anchor.lon);
      const ok = (d) => d instanceof Date && !Number.isNaN(d.getTime());
      if (!ok(t.sunrise) || !ok(t.sunset)) {
        // Inside the Arctic circle in the right week there is no sunrise at
        // all, and that is a real answer rather than a failure.
        return { polar: true, up: !!(t.nadir && SC.getPosition(t.nadir, anchor.lat, anchor.lon).altitude > 0) };
      }
      return { sunrise: t.sunrise, sunset: t.sunset, dusk: ok(t.dusk) ? t.dusk : null };
    } catch (e) {
      return null;
    }
  }

  // One line for the top of a day. Says the thing you would want to know
  // before deciding what to do with the afternoon.
  function daylightLine(date, anchor) {
    const sun = sunTimes(date, anchor);
    if (!sun) return "";
    if (sun.polar) {
      return `<div class="daylight">${icon("clock", { size: 15, cls: "ico-inline" })} ${
        sun.up ? "The sun doesn't set here at this time of year." : "The sun doesn't rise here at this time of year."
      }</div>`;
    }
    const today = isoDate(new Date()) === isoDate(date);
    const now = new Date();
    // On the day itself, how long is left matters more than when it started.
    if (today && now < sun.sunset && now > sun.sunrise) {
      const minsLeft = Math.round((sun.sunset - now) / 60000);
      return `<div class="daylight">${icon("clock", { size: 15, cls: "ico-inline" })} ${esc(
        formatDuration(minsLeft)
      )} of daylight left — sunset ${esc(clockOf(sun.sunset))}</div>`;
    }
    return `<div class="daylight">${icon("clock", { size: 15, cls: "ico-inline" })} Light from ${esc(
      clockOf(sun.sunrise)
    )} to ${esc(clockOf(sun.sunset))}</div>`;
  }

  // ---------- Telling you the thing before you need it ----------
  // Today already worked out which stop is next, whether somewhere might be
  // shut, and what the sky is doing - and could do nothing whatever with any
  // of it unless you happened to be holding the phone with the app open. On
  // a day out that is the one thing you are not doing.
  //
  // Everything here is scheduled locally from the stored plan, so it fires in
  // a glen with no signal exactly as it does at home. Nothing is sent
  // anywhere and nothing is scheduled at all until you ask for it.
  const NOTIFY_KEY = "notify-v1";
  const NOTIFY_FINGERPRINT_KEY = "notify-fingerprint-v1";

  // Fixed id blocks, so a reschedule can cancel precisely what it replaces
  // rather than clearing the lot and hoping.
  const NOTIFY_IDS = { morning: 1000, leave: 2000, rain: 3000, closing: 4000, booking: 5000 };
  const NOTIFY_BLOCK = 900;
  // Far enough ahead that booking is still possible, close enough that you
  // have not forgotten what the thing is.
  const BOOKING_NUDGE_DAYS = 3;

  function loadNotifySettings() {
    const s = readJson(NOTIFY_KEY, null);
    return {
      enabled: !!(s && s.enabled),
      morning: (s && s.morning) || "07:30",
      leave: !s || s.leave !== false,
      rain: !s || s.rain !== false,
      closing: !s || s.closing !== false,
      booking: !s || s.booking !== false,
    };
  }

  function saveNotifySettings(patch) {
    store(NOTIFY_KEY, JSON.stringify(Object.assign(loadNotifySettings(), patch)));
  }

  function notifyPlugin() {
    return nativePlugin("LocalNotifications");
  }

  // A browser has no local notifications and never will; the settings row says
  // so rather than offering a switch that does nothing.
  function notificationsPossible() {
    return !!notifyPlugin();
  }

  async function askForNotificationPermission() {
    const plugin = notifyPlugin();
    if (!plugin) return false;
    try {
      const current = await plugin.checkPermissions();
      if (current && current.display === "granted") return true;
      const asked = await plugin.requestPermissions();
      return !!(asked && asked.display === "granted");
    } catch (e) {
      return false;
    }
  }

  // The stops of a planned day, in the order they will be walked, with the
  // place each one refers to attached.
  function dayStops(dayId) {
    const plan = loadPlan();
    const byId = {};
    loadPicks().forEach((p) => {
      byId[p.id] = p;
    });
    return itemsInDayOrder(plan.items[dayId] || [])
      .map((it) => ({ item: it, pick: byId[it.pickId] }))
      .filter((x) => x.pick);
  }

  function atTimeOn(date, minutes) {
    const when = new Date(date);
    when.setHours(0, 0, 0, 0);
    when.setMinutes(minutes);
    return when;
  }

  function minutesFromClock(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : 7 * 60 + 30;
  }

  // Somewhere that is mostly weather. Used only to decide whether a wet
  // forecast is worth interrupting somebody over - a rainy day matters if you
  // were going up a hill and does not if you were going to a museum.
  const OUTDOOR_RE =
    /walk|trail|hill|mountain|glen|beach|coast|loch|falls?|waterfall|garden|park|zoo|farm|forest|wood|viewpoint|island|harbour|pier|castle ruin|ruins?/i;

  // A guess from words in a name, which is all there was. An event now often
  // carries the answer outright, and a stated fact beats a regex reading
  // "Woodland Craft Fair" as a walk in a forest - so the field wins when
  // there is one, and the guess only fills the silence.
  function looksOutdoor(pick) {
    if (!pick) return false;
    if (pick.setting === "outdoor" || pick.setting === "both") return true;
    if (pick.setting === "indoor") return false;
    return OUTDOOR_RE.test(`${pick.category || ""} ${pick.name || ""} ${pick.description || ""}`);
  }

  // Everything that would be worth saying, as plain objects. Kept separate
  // from the scheduling so it can be checked without a phone in the room.
  function plannedNotifications(now) {
    const settings = loadNotifySettings();
    const out = [];
    if (!settings.enabled) return out;

    const at = now || new Date();
    const plan = loadPlan();
    const morningMins = minutesFromClock(settings.morning);

    plan.days.forEach((day, dayIndex) => {
      const date = dateForDayLabel(day.label);
      if (!date) return; // an undated day has no time to fire at
      const stops = dayStops(day.id);
      if (!stops.length) return;

      const dayCode = dayCodeFromLabel(day.label);
      // The same forecast Today reads, through the same function - reaching
      // into the cache by hand would be a second answer to a question the app
      // already answers, and the two would drift.
      const f = forecastForDay(day.label, dayWeatherAnchor(day.id));
      const forecast = f && !f.tooFar ? f.day : null;

      // ---- The morning brief ----
      const first = stops[0];
      // `booking` is set when a result said the place usually needs booking
      // ahead; `booked` is you ticking it off. Only the pair is worth saying.
      const unbooked = stops.filter((s) => s.pick.booking && !s.pick.booked).length;
      const bits = [
        first.item.time ? `${first.pick.name} at ${first.item.time}` : first.pick.name,
        stops.length > 1 ? `then ${stops.length - 1} more` : null,
      ].filter(Boolean);
      if (forecast) {
        const look = weatherLook(forecast.code == null ? 3 : forecast.code);
        bits.push(
          `${look.label}${forecast.max != null ? `, ${forecast.max}°/${forecast.min}°` : ""}` +
            (forecast.rainChance != null && forecast.rainChance >= 40 ? `, rain ${forecast.rainChance}%` : "")
        );
      }
      if (unbooked) bits.push(`${unbooked} still to book`);
      out.push({
        id: NOTIFY_IDS.morning + (dayIndex % NOTIFY_BLOCK),
        at: atTimeOn(date, morningMins),
        title: shortDayLabel(day.label),
        body: bits.join(" · "),
        tab: "today",
      });

      // ---- Rain on a day spent outdoors ----
      const outdoors = stops.filter((s) => looksOutdoor(s.pick));
      if (
        settings.rain &&
        forecast &&
        forecast.rainChance != null &&
        forecast.rainChance >= 60 &&
        outdoors.length
      ) {
        out.push({
          // Half an hour before the brief, so it is the first thing read
          // rather than a correction to something already read.
          id: NOTIFY_IDS.rain + (dayIndex % NOTIFY_BLOCK),
          at: atTimeOn(date, Math.max(0, morningMins - 30)),
          title: `Rain today — ${forecast.rainChance}%`,
          body:
            `${outdoors.length} of today's stops ${outdoors.length === 1 ? "is" : "are"} outdoors ` +
            `(${outdoors[0].pick.name}${outdoors.length > 1 ? " and others" : ""}). ` +
            `Worth having something indoors ready.`,
          tab: "today",
          rainy: true,
        });
      }

      // ---- Time to leave for the next one ----
      if (settings.leave) {
        stops.forEach((stop, i) => {
          if (!i) return; // nothing is known about where the day starts from
          const mins = timeToMinutes(stop.item.time);
          if (mins == null) return;
          const leg = walkLeg(stops[i - 1].pick, stop.pick);
          if (!leg) return;
          // Ten minutes to gather everybody up, which with a small child is
          // an underestimate.
          const leaveAt = mins - leg.mins - 10;
          if (leaveAt <= 0) return;
          out.push({
            id: NOTIFY_IDS.leave + ((dayIndex * 20 + i) % NOTIFY_BLOCK),
            at: atTimeOn(date, leaveAt),
            title: `Time to head for ${stop.pick.name}`,
            body:
              `${stop.item.time} · about ${formatDuration(leg.mins)} ${leg.driving ? "drive" : "walk"} ` +
              `from ${stops[i - 1].pick.name}.`,
            tab: "today",
          });
        });
      }

      // ---- It shuts sooner than you think ----
      if (settings.closing && dayCode) {
        stops.forEach((stop, i) => {
          const closes = closingMinutesOnDay(stop.pick.openingHours, dayCode, stop.pick);
          if (closes == null) return;
          const warnAt = closes - 45;
          if (warnAt <= 0) return;
          // Only worth saying if you were still going to be there: a warning
          // about a place you left at eleven is noise.
          const arriving = timeToMinutes(stop.item.time);
          if (arriving != null && arriving > closes) return;
          out.push({
            id: NOTIFY_IDS.closing + ((dayIndex * 20 + i) % NOTIFY_BLOCK),
            at: atTimeOn(date, warnAt),
            title: `${stop.pick.name} closes at ${clockFromMinutes(closes)}`,
            body: `About 45 minutes left. Hours are worth a check before you rely on them.`,
            tab: "today",
          });
        });
      }
    });

    // ---- Book it before it goes ----
    // The one reminder that is not about a day in the plan. An event you saved
    // and never scheduled still needs booking, and a nudge on the morning of
    // an event that sold out a fortnight ago is no use to anybody - so this
    // walks the saved events by their own date rather than walking the plan.
    if (settings.booking) {
      loadPicks()
        // kind === "event" is load-bearing: a place can carry booking too,
        // and a place has no date to count back from.
        .filter((p) => p.kind === "event" && p.booking && !p.booked && p.startsAt)
        // Sorted, so an event keeps the same notification id from one
        // reschedule to the next and the fingerprint does not churn every
        // time the app is opened.
        .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)) || String(a.id).localeCompare(String(b.id)))
        .forEach((pick, i) => {
          const when = new Date(pick.startsAt);
          if (Number.isNaN(when.getTime())) return;
          const nudge = new Date(when);
          nudge.setDate(nudge.getDate() - BOOKING_NUDGE_DAYS);
          out.push({
            id: NOTIFY_IDS.booking + (i % NOTIFY_BLOCK),
            at: atTimeOn(nudge, morningMins),
            title: `Book ${pick.name}?`,
            body:
              `It's on ${humanDate(when)}${pick.time ? ` at ${pick.time}` : ""}` +
              `${pick.bookingLevel === "required" ? " and has to be booked ahead" : " and these sell out"}.`,
            tab: "events",
          });
        });
    }

    // Nothing in the past, and nothing so far out that the plan will have
    // changed twice before it fires.
    const horizon = at.getTime() + 21 * 86400000;
    return out
      .filter((n) => n.at.getTime() > at.getTime() && n.at.getTime() < horizon)
      .sort((a, b) => a.at - b.at)
      // Android will not hold an unlimited number of pending alarms, and a
      // fortnight of a busy plan can run to hundreds.
      .slice(0, 60);
  }

  function clockFromMinutes(mins) {
    return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }

  // What is scheduled is compared against this before anything is torn down
  // and rebuilt, so opening the app twenty times a day does not rewrite the
  // whole alarm list twenty times.
  function notifyFingerprint(list) {
    return list.map((n) => `${n.id}@${n.at.getTime()}:${n.title}`).join("|");
  }

  let rescheduling = false;

  async function rescheduleNotifications(force) {
    const plugin = notifyPlugin();
    if (!plugin || rescheduling) return;
    rescheduling = true;
    try {
      // A backup restored onto a new phone brings the switch across but not
      // the OS permission, and a switch that reads "on" while nothing ever
      // fires is worse than one that reads "off".
      if (loadNotifySettings().enabled) {
        try {
          const state = await plugin.checkPermissions();
          if (state && state.display && state.display !== "granted") {
            saveNotifySettings({ enabled: false });
            return;
          }
        } catch (e) {
          /* a plugin that cannot be asked is assumed to be fine */
        }
      }
      const wanted = plannedNotifications();
      const print = notifyFingerprint(wanted);
      if (!force && print === (localStorage.getItem(NOTIFY_FINGERPRINT_KEY) || "")) return;

      // Clear what this app scheduled, and only that.
      try {
        const pending = await plugin.getPending();
        const mine = ((pending && pending.notifications) || []).filter((n) => Number(n.id) >= 1000);
        if (mine.length) await plugin.cancel({ notifications: mine.map((n) => ({ id: n.id })) });
      } catch (e) {
        /* nothing pending, or an older plugin - scheduling still works */
      }

      if (wanted.length) {
        await plugin.schedule({
          notifications: wanted.map((n) => ({
            id: n.id,
            title: n.title,
            body: n.body,
            schedule: { at: n.at, allowWhileIdle: true },
            extra: { tab: n.tab, rainy: !!n.rainy },
          })),
        });
      }
      store(NOTIFY_FINGERPRINT_KEY, print);
    } catch (e) {
      // A phone that refuses to schedule is not a reason for a broken app.
      // The screen still says everything these would have said.
    } finally {
      rescheduling = false;
    }
  }

  async function cancelAllNotifications() {
    const plugin = notifyPlugin();
    if (!plugin) return;
    try {
      const pending = await plugin.getPending();
      const mine = ((pending && pending.notifications) || []).filter((n) => Number(n.id) >= 1000);
      if (mine.length) await plugin.cancel({ notifications: mine.map((n) => ({ id: n.id })) });
    } catch (e) {
      /* nothing to cancel */
    }
    store(NOTIFY_FINGERPRINT_KEY, "");
  }

  // Tapping one has to land somewhere that answers it, or it is just a buzz.
  function wireNotificationTaps() {
    const plugin = notifyPlugin();
    if (!plugin || !plugin.addListener) return;
    try {
      plugin.addListener("localNotificationActionPerformed", (event) => {
        const extra = (event && event.notification && event.notification.extra) || {};
        if (extra.rainy) {
          const current = currentPlanDay();
          const anchor = current ? dayWeatherAnchor(current.day.id) : null;
          explore.open = true;
          explore.category = "rainy";
          explore.customQuery = "";
          if (anchor && anchor.lat != null) {
            explore.centre = { name: anchor.name, lat: anchor.lat, lon: anchor.lon };
          }
          markExploreStale();
          showView("picks");
          return;
        }
        showView(extra.tab || "today");
      });
    } catch (e) {
      /* an older plugin without listeners still fires the notifications */
    }
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
  // otherwise the last one that has been - so the screen is never empty for
  // lack of a match.
  //
  // "Otherwise the first" is what this used to do, and it was wrong in the one
  // case it existed for. Once every planned day is behind you, the first day is
  // the furthest in the past: a trip that ended on Tuesday opened on the
  // previous Thursday and called it "Next up", and it stayed there for good,
  // because nothing about it changes with the date. Days you plan while trying
  // the app out land in exactly that state within a couple of days.
  function currentPlanDay() {
    const plan = loadPlan();
    if (!plan.days.length) return null;
    const now = new Date();
    const dated = datedDays(plan.days).map((x) => ({ day: x.d, date: x.when }));

    const today = dated.find((x) => x.date && sameDay(x.date, now));
    if (today) return { ...today, isToday: true };

    const upcoming = dated.filter((x) => x.date && x.date > now).sort((a, b) => a.date - b.date)[0];
    if (upcoming) return { ...upcoming, isToday: false };

    // Everything is behind us: the nearest one is the most recent, not the
    // oldest, and it is not "next" anything.
    const past = dated.filter((x) => x.date && x.date < now).sort((a, b) => b.date - a.date)[0];
    if (past) return { ...past, isToday: false, isPast: true };

    // No day carries a readable date at all - a hand-typed label like
    // "Arrival". Nothing to work out, so show the first and say no more.
    return { day: plan.days[0], date: null, isToday: false, undated: true };
  }

  // Today was drawn once, when you opened the tab, and never again. Leave the
  // app open - or backgrounded, which on a phone is the same thing - and it is
  // still yesterday's day, with "NEXT" pointing at a stop you did at ten in the
  // morning. The screen is about now, so it has to notice when now moves.
  //
  // A signature rather than a timer that redraws: rebuilding a screen under
  // someone's thumb is its own bug, so it only redraws when the day, the
  // chosen day, or which stop is next has actually changed.
  let todayShown = "";

  function todaySignature() {
    const current = currentPlanDay();
    if (!current) return "none";
    const plan = loadPlan();
    const ordered = itemsInDayOrder(planItems(plan, current.day.id));
    const now = new Date();
    return [now.toDateString(), current.day.id, nextItemIndex(ordered, current.isToday, now)].join("|");
  }

  function checkTheClock() {
    const signature = todaySignature();
    if (signature === todayShown) return;
    todayShown = signature;
    // A day appearing for the first time makes Today worth showing at all.
    applyBoardTabs();
    if (view.dataset.activeTab === "today") renderToday();
  }

  setInterval(checkTheClock, 30000);
  // Coming back to the app after a night is the case that matters most, and
  // no timer fires while the WebView is asleep.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkTheClock();
  });
  window.addEventListener("focus", checkTheClock);

  function renderToday() {
    todayShown = todaySignature();
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
    // are out of the flat. And nothing on a day that has already been is
    // "next", however early in that day it was.
    const nextIdx = current.isPast ? -1 : nextItemIndex(items, current.isToday, new Date());

    // Weather belongs at the top of Today: it's the one thing that changes a
    // plan before you've left the flat.
    const redrawToday = () => {
      if (view.dataset.activeTab === "today") renderToday();
    };
    const forecast = forecastForDay(current.day.label, dayWeatherAnchor(current.day.id, redrawToday), redrawToday);

    // What this day is, said plainly. A day behind you is not "Next up", and
    // being told so is the difference between a screen that looks stuck and
    // one you can trust about the date.
    const heading = current.isToday
      ? "Today"
      : current.isPast
        ? "Last planned day"
        : current.undated
          ? "Your plan"
          : "Next up";

    let html = `
      <div class="today-head">
        <div class="today-label">${heading}</div>
        <div class="today-date">${esc(current.day.label)}</div>
      </div>
      ${weatherLine(forecast)}
      ${daylightLine(current.date, dayWeatherAnchor(current.day.id))}
    `;

    // Nothing ahead of you, so the screen says what it is looking at and
    // offers the only thing worth doing from here: a day for today.
    if (current.isPast) {
      html += `
        <div class="card today-over">
          <p class="pick-status">Nothing planned for today — this is the most recent day you had planned${
            current.date ? `, ${daysAgoLabel(current.date)}` : ""
          }.</p>
          <button class="modal-btn modal-btn-primary" id="todayAddDay">＋ Add today to the plan</button>
        </div>
      `;
    }

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
        const mayBeClosed = closedOnDay(p.openingHours, dayCode, p);
        // Today knew a castle was open on a Tuesday and said nothing at all
        // about it being seven in the evening and the castle shutting at five.
        // That is the version of the question you have in the car park.
        const closesAt = closingMinutesOnDay(p.openingHours, dayCode, p);
        const minsNow = new Date().getHours() * 60 + new Date().getMinutes();
        const shutNow = current.isToday && closesAt != null && minsNow >= closesAt;
        const shutSoon = current.isToday && !shutNow && closesAt != null && closesAt - minsNow <= 60;
        const isNext = idx === nextIdx;
        const done = (current.isToday || current.isPast) && (nextIdx < 0 || idx < nextIdx);

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
            ${p.openingHours ? `<div class="place-fact">${icon('clock', { size: 16, cls: 'ico-inline' })} ${esc(p.openingHours)}</div>` : ""}
            ${
              mayBeClosed
                ? `<div class="plan-warn">${icon('alert', { size: 15, cls: 'ico-inline' })} May be closed today — check before setting off.</div>`
                : shutNow
                ? `<div class="plan-warn">${icon('alert', { size: 15, cls: 'ico-inline' })} Shut for the day — closes at ${esc(clockFromMinutes(closesAt))}.</div>`
                : shutSoon
                ? `<div class="plan-warn">${icon('alert', { size: 15, cls: 'ico-inline' })} Closes at ${esc(clockFromMinutes(closesAt))} — about ${formatDuration(closesAt - minsNow)} left.</div>`
                : ""
            }
            ${napWarning(it.time)}
            ${childWarning(p)}
            ${p.note ? `<div class="today-note">${icon('note', { size: 15, cls: 'ico-inline' })} ${esc(p.note)}</div>` : ""}
            <div class="today-actions">
              <button class="modal-btn modal-btn-primary" data-open-maps="${esc(
                directionsUrl(p, prev)
              )}">${leg && leg.driving ? icon("car", { size: 17, cls: "ico-inline" }) : icon("directions", { size: 16, cls: "ico-inline" })} ${leg && leg.driving ? "Drive there" : "Directions"}</button>
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
    const addToday = document.getElementById("todayAddDay");
    if (addToday) {
      addToday.addEventListener("click", () => {
        ensureDayFor(new Date());
        todayShown = "";
        renderToday();
        toast("Today added to the plan");
      });
    }
    wireRainyDayButtons();
  }

  // "two days ago" rather than a date, because the point being made is how
  // long it has been, not which day it was - the label above already says that.
  function daysAgoLabel(date) {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const days = Math.round((midnight - date) / 864e5);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 14) return `${days} days ago`;
    if (days < 60) return `${Math.round(days / 7)} weeks ago`;
    return "a while ago";
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
  //
  // `parent` is what stops a screen reached from More from leaving the whole
  // tab bar unlit. Kids, Budget and Notes are no longer tabs of their own -
  // seven along the bottom of a phone is a menu, not a bar, and three of the
  // seven were places you visit once a day at most. They live behind More,
  // and while you are on one, More is the tab that is lit.
  const VIEWS = {
    today: { render: renderToday, sub: () => "What's on now" },
    kids: { render: renderKids, sub: () => "Things they'll actually enjoy", parent: "more", label: "For the kids" },
    itinerary: { render: renderItinerary, sub: () => "Your day-by-day plan" },
    // places/eats are no longer destinations of their own, but anything still
    // asking for them - the hardware-back history, a "＋ Add a place" button
    // saved in someone's muscle memory - lands on the same list with that
    // filter applied, rather than on an error.
    places: { render: () => renderPicksFiltered("place"), sub: () => `${picksOfKind("place").length} places to go` },
    eats: { render: () => renderPicksFiltered("eat"), sub: () => `${picksOfKind("eat").length} places to eat` },
    picks: { render: renderPicks, sub: () => "Everything you've saved" },
    events: { render: renderEvents, sub: () => "Things with a date on them" },
    budget: { render: renderBudget, sub: () => "What this is costing", parent: "more", label: "Budget" },
    tips: { render: renderTips, sub: () => "Notes & packing", parent: "more", label: "Notes & packing" },
    usage: { render: renderUsage, sub: () => "What the AI is costing", parent: "more", label: "AI usage" },
    more: { render: renderMore, sub: () => "Everything else" },
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
      events: true,
      more: true,
      // Reachable as views from the More hub, which is where their buttons
      // are now. Listed here so showView does not bounce them to a tab.
      kids: true,
      usage: true,
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
    return ["today", "picks", "itinerary", "kids"].find((n) => visible[n]) || "picks";
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
    // A screen opened from More lights More, not nothing. Landing on a screen
    // with no tab lit is the small disorientation that makes an app feel like
    // it has lost track of where you are.
    const lit = v.parent || name;
    tabbar.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.getAttribute("data-view") === lit);
    });
    if (v.parent) addParentBackBar(v.parent, name);
    view.scrollTop = 0;
    paintIcons(view);
    // Only when the screen has actually changed. Re-running the entrance on
    // every redraw - and some screens redraw as coordinates arrive - would
    // make the list flicker under your thumb.
    if (previous !== name) replayViewEntrance();
  }

  // The way back out of a screen that is no longer a tab. Added after the
  // render rather than inside each one, so the three screens behind More did
  // not each have to learn about it.
  function addParentBackBar(parentName, name) {
    const parent = VIEWS[parentName];
    if (!parent) return;
    const bar = document.createElement("button");
    bar.className = "sub-back";
    bar.type = "button";
    bar.innerHTML = `${icon("back", { size: 16, cls: "ico-inline" })}<span>${esc(
      parentName === "more" ? "More" : parentName
    )}</span>`;
    bar.addEventListener("click", () => showView(parentName));
    view.insertBefore(bar, view.firstChild);
    // Re-titled so the topbar says which screen this is, not just what More
    // is - the subtitle is the only thing naming it now that the tab is gone.
    const own = VIEWS[name];
    if (own && own.label) topbarSub.textContent = own.label;
  }

  function tokens(n) {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1000) return `${Math.round(n / 1000)}k`;
    return String(n);
  }

  function renderUsage() {
    const usage = loadAiUsage();
    const today = usage.days[isoDate(new Date())] || blankDay();
    const week = usageOverDays(7);
    const rates = loadAiRates();

    const block = (label, d, note) => {
      const cost = estimateCost(d);
      return `
        <div class="usage-block">
          <div class="usage-label">${esc(label)}</div>
          <div class="usage-figure">${esc(tokens(d.inTokens + d.outTokens))} <span>tokens</span></div>
          <div class="usage-detail">${esc(tokens(d.inTokens))} in · ${esc(tokens(d.outTokens))} out · ${
            d.calls
          } request${d.calls === 1 ? "" : "s"}${d.grounded ? `, ${d.grounded} with web search` : ""}</div>
          ${cost ? `<div class="usage-cost">about ${esc(money4(cost.gbp))}</div>` : ""}
          ${note ? `<div class="usage-detail">${note}</div>` : ""}
        </div>`;
    };

    let html = `
      <div class="kids-head">
        <h1 class="kids-title">AI usage</h1>
        <p class="kids-sub">What this phone has spent on the Gemini key</p>
      </div>
      <div class="section-label">Tokens</div>
      <div class="card usage-grid">
        ${block("Today", today)}
        ${block("Last 7 days", week)}
        ${block("All time", usage.total)}
      </div>
    `;

    if (usage.last) {
      const ago = Math.round((Date.now() - usage.last.at) / 60000);
      html += `<div class="section-label">The last request</div>
        <div class="card">
          <p class="settings-hint">
            ${esc(tokens(usage.last.inTokens))} in, ${esc(tokens(usage.last.outTokens))} out${
              usage.last.grounded ? ", with web search" : ""
            } — ${ago < 1 ? "just now" : ago < 60 ? `${ago} min ago` : `${Math.round(ago / 60)} h ago`}.
            ${
              usage.last.counted
                ? ""
                : "Google didn't report a token count for it, so it is counted as a request but not as tokens."
            }
          </p>
          <p class="settings-hint">
            A What's on search is nine requests, all of them with web search — by a distance the
            most expensive thing the app does. Explore and the trip planner are one each.
          </p>
        </div>`;
    }

    html += `
      <div class="section-label">What it costs</div>
      <div class="card">
        <label class="settings-check">
          <input type="checkbox" id="usagePaid"${rates.paid ? " checked" : ""} />
          <span>I'm on a paid plan, not the free tier</span>
        </label>
        <p class="settings-hint">
          ${
            rates.paid
              ? `Your key is on <b>${esc(rates.model)}</b>, priced at $${esc(String(rates.in))} per
                 million tokens in and $${esc(String(rates.out))} out, converted at ${esc(
                  String(rates.usdToGbp)
                )}. The rate follows whichever model Settings is using — change the model and this
                 changes with it. Published rates as of ${esc(AI_RATES_ASOF)}; correct them below if
                 they've moved, because this app has no way to check.`
              : `On the free tier the answer is £0, which is why nothing above shows a price.
                 The tokens are still real, and they're what the free allowance is measured in.
                 Your key is on <b>${esc(rates.model)}</b>.`
          }
        </p>
        ${
          rates.paid
            ? `<div class="usage-rates">
                 <label class="person-time"><span>$ per 1M in</span>
                   <input type="number" step="0.01" min="0" id="rateIn" value="${esc(String(rates.in))}" /></label>
                 <label class="person-time"><span>$ per 1M out</span>
                   <input type="number" step="0.01" min="0" id="rateOut" value="${esc(String(rates.out))}" /></label>
                 <label class="person-time"><span>$ to £</span>
                   <input type="number" step="0.01" min="0" id="rateFx" value="${esc(String(rates.usdToGbp))}" /></label>
               </div>
               <p class="settings-hint">Web search grounding is billed separately by Google, per request
                  rather than per token, so it is counted above but not priced here.</p>`
            : ""
        }
      </div>

      <div class="card">
        <p class="settings-hint">
          These are Google's own numbers, taken from each reply — not an estimate of what was sent.
          They only cover this phone, though: the same key used on another device, or by anything
          else, is invisible here. There is no way to ask Google how much of an allowance is left
          from inside an app; that only exists in the Cloud Console.
        </p>
        <button class="modal-btn" id="usageReset" style="width:100%;margin-top:8px;">Reset the count</button>
        <pre class="settings-result" id="usageResetResult" hidden></pre>
      </div>
    `;

    view.innerHTML = html;

    const paid = document.getElementById("usagePaid");
    if (paid) {
      paid.addEventListener("change", () => {
        const r = Object.assign({}, loadTripSettings().aiRates, { paid: paid.checked });
        saveTripSettings({ aiRates: r });
        renderUsage();
      });
    }
    [["rateIn", "in"], ["rateOut", "out"], ["rateFx", "usdToGbp"]].forEach(([id, field]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", () => {
        const r = Object.assign({}, loadTripSettings().aiRates);
        r[field] = Number(el.value);
        saveTripSettings({ aiRates: r });
      });
    });

    const reset = document.getElementById("usageReset");
    if (reset) {
      reset.addEventListener("click", () => {
        store(AI_USAGE_KEY, JSON.stringify({ days: {}, total: blankDay(), last: null }));
        renderUsage();
      });
    }
  }

  // One place that lists everything the app can do, so that nothing has to be
  // remembered and nothing needs its own tab. Each row carries the number that
  // makes it worth opening - "8 marked", "3 of 9 packed" - because a menu of
  // bare names tells you nothing about whether to tap it.
  function renderMore() {
    const picks = loadPicks().filter((p) => !p.major);
    const kidCount = picks.filter(isForKids).length;
    const packing = loadPacking();
    const packed = packing.filter((i) => i.done).length;
    const boards = loadBoards().boards || [];
    const pinned = picks.filter((p) => p.lat != null).length;

    let budgetLine = "Nothing costed yet";
    try {
      const { places, trip, own } = budgetLines();
      const priced = places.filter((l) => l.source !== "unknown");
      const ownTotal = own.reduce((a, r) => a + (Number(r.amount) || 0), 0);
      const low = priced.reduce((a, l) => a + l.low, 0) + trip.reduce((a, l) => a + l.low, 0) + ownTotal;
      const high = priced.reduce((a, l) => a + l.high, 0) + trip.reduce((a, l) => a + l.high, 0) + ownTotal;
      if (low || high) budgetLine = low === high ? money(low) : `${money(low)}–${money(high)}`;
    } catch (e) {
      // A budget that cannot be totalled is not a reason for this screen to
      // fail; the row still opens the screen that can explain itself.
    }

    // `dot` marks a row that wants attention. It is how a dismissed warning
    // stays findable: the banner goes quiet, the way to fix it does not.
    const row = (target, ico, title, meta, dot) => `
      <button class="more-row" data-more="${esc(target)}">
        <span class="more-row-ico">${icon(ico, { size: 20 })}</span>
        <span class="more-row-main">
          <span class="more-row-title">${esc(title)}</span>
          <span class="more-row-meta">${esc(meta)}</span>
        </span>
        ${dot ? `<span class="more-row-dot" aria-label="Needs attention"></span>` : ""}
        ${icon("forward", { size: 16, cls: "more-row-go" })}
      </button>`;

    view.innerHTML = `
      <div class="kids-head">
        <h1 class="kids-title">More</h1>
        <p class="kids-sub">The rest of it, in one place rather than spread along the bottom</p>
      </div>

      <div class="section-label">This trip</div>
      <div class="card more-list">
        ${row("kids", "kids", kidsTitle(), kidCount ? `${kidCount} marked` : "Nothing marked yet")}
        ${row("budget", "budget", "Budget", budgetLine)}
        ${row("tips", "tips", "Notes & packing", packing.length ? `${packed} of ${packing.length} packed` : "Nothing on the list yet")}
      </div>

      <div class="section-label">Everything</div>
      <div class="card more-list">
        ${row("map", "map", "Map of everything", pinned ? `${pinned} on the map` : "Nothing placed yet")}
        ${row("boards", "folder", "Your trips", `${boards.length} saved`)}
        ${row(
          "usage",
          "sparkle",
          "AI usage",
          (() => {
            const t = loadAiUsage().days[isoDate(new Date())] || blankDay();
            const all = t.inTokens + t.outTokens;
            return all ? `${tokens(all)} tokens today` : "Nothing used today";
          })()
        )}
        ${row(
          "settings",
          "settings",
          "Settings",
          backupIsOverdue() ? "Not backed up — everything is on this phone" : "Keys, units, backup",
          backupIsOverdue()
        )}
      </div>
    `;

    view.querySelectorAll("[data-more]").forEach((b) =>
      b.addEventListener("click", () => {
        const target = b.getAttribute("data-more");
        if (target === "map") return openAllMap(defaultMapFilter());
        if (target === "boards") return openBoardSwitcher();
        if (target === "settings") return openSettings();
        showView(target);
      })
    );
  }

  // Screens arrive rather than appear: the class is removed and re-added so
  // the animation restarts, which it will not do if the class is already
  // there. The reflow between the two is the part that makes it work.
  //
  // And then it is taken off again, which the first version did not do. The
  // class is what makes the children animate, so leaving it on meant every
  // later redraw of the same screen replayed a full-screen fade-and-rise -
  // and screens redraw constantly here, as photographs arrive, distances
  // finish measuring, the forecast lands. The result on a real phone was the
  // whole app strobing. The animation belongs to the change of screen, so it
  // lasts exactly as long as that.
  let entranceTimer = null;

  function replayViewEntrance() {
    view.classList.remove("switching");
    void view.offsetWidth;
    view.classList.add("switching");
    clearTimeout(entranceTimer);
    // Longest stagger (110ms) plus the duration (260ms), with room to spare.
    entranceTimer = setTimeout(() => view.classList.remove("switching"), 460);
  }

  // Fills every <span data-ico="name"> with its icon. Called after anything
  // that writes HTML, so markup can ask for an icon by name and never has to
  // know how one is drawn.
  function paintIcons(root) {
    (root || document).querySelectorAll("[data-ico]").forEach((el) => {
      const name = el.getAttribute("data-ico");
      if (el.firstElementChild && el.dataset.icoDrawn === name) return;
      el.innerHTML = icon(name, { size: Number(el.getAttribute("data-ico-size")) || 22 });
      el.dataset.icoDrawn = name;
    });
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
    makeSheetDraggable(placeModal, closePlaceModal);

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
      if (wiki.photo) candidate.photo = wiki.photo;
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


  // ---------- The first time you open it ----------
  // A new install landed on somebody else's trip: a board called "Scotland
  // with Ally", an Edinburgh guide, and an empty Picks tab whose advice was a
  // bulleted list of four things you could go and do. Every one of those four
  // needs to know where you are going, and nothing had asked.
  //
  // So it asks. Three questions, one screen each, all of them skippable - and
  // at the end the app knows the place, the dates and who is coming, which is
  // enough for the AI features to be worth pressing.
  const ONBOARDED_KEY = "onboarded-v1";
  const welcomeOverlay = document.getElementById("welcomeOverlay");

  const WHO_OPTIONS = [
    "Just me",
    "Two of us",
    "Family with young kids",
    "Family with teenagers",
    "A group of friends",
  ];

  let welcome = null;

  function needsWelcome() {
    if (localStorage.getItem(ONBOARDED_KEY)) return false;
    // Anyone with a trip already in progress has answered these questions by
    // doing, and being asked now would be an insult rather than a welcome.
    //
    // What counts is what has been *stored*, not what loadPlan() hands back:
    // the bundled board reports a full week of days it was shipped with, so
    // asking it whether the app is empty always came back "no" - on an
    // install that had never been opened.
    const state = readJson(BOARDS_KEY, null);
    if (!state || !Array.isArray(state.boards)) return true;
    if (state.boards.length > 1) return false;
    const id = state.activeId || (state.boards[0] && state.boards[0].id);
    if (!id) return true;
    const picks = readJson(boardKey(id, "picks"), null);
    const plan = readJson(boardKey(id, "plan"), null);
    return !(picks && picks.length) && !(plan && plan.days && plan.days.length);
  }

  function openWelcome() {
    welcome = { step: 0, where: "", start: "", nights: "", who: "" };
    renderWelcome();
  }

  function finishWelcome(seed) {
    store(ONBOARDED_KEY, String(Date.now()));
    const where = (welcome.where || "").trim();
    if (where) {
      const state = loadBoards();
      const board = state.boards.find((b) => b.id === state.activeId) || state.boards[0];
      board.name = where;
      board.destination = where;
      saveBoards(state);
      saveTripSettings({ destination: where });
    }
    if (welcome.who) saveTripSettings({ travellers: welcome.who });
    if (welcome.start) {
      const nights = Math.max(1, Math.min(21, Number(welcome.nights) || 1));
      const [y, m, d] = welcome.start.split("-").map(Number);
      for (let i = 0; i < nights; i++) ensureDayFor(new Date(y, m - 1, d + i));
    }
    welcome = null;
    welcomeOverlay.classList.remove("open");
    welcomeOverlay.innerHTML = "";
    refreshForBoard();
    if (seed === "idea") openTripIdea();
    else if (seed === "search") openSearchOverlay("");
  }

  function welcomeStep() {
    const w = welcome;
    if (w.step === 0) {
      return {
        kicker: "Welcome",
        title: "Where are you going?",
        sub: "Everything else follows from this — what it searches, what it suggests, what it costs.",
        body: `
          <input class="welcome-input" id="welcomeWhere" type="text" value="${esc(w.where)}"
                 placeholder="Cornwall, the Dolomites, Lisbon…" autocomplete="off" />
          <div class="search-chips welcome-chips">
            ${["Cornwall", "The Lake District", "Snowdonia", "The Highlands", "Amsterdam", "Lisbon"]
              .map((x) => `<button class="search-chip" data-welcome-where="${esc(x)}">${esc(x)}</button>`)
              .join("")}
          </div>
        `,
        can: !!w.where.trim(),
      };
    }
    if (w.step === 1) {
      return {
        kicker: "When",
        title: "When are you going?",
        sub: "This is what makes Today work, and what the budget counts. You can change it later.",
        body: `
          <label class="welcome-label" for="welcomeStart">First day</label>
          <input class="welcome-input" id="welcomeStart" type="date" value="${esc(w.start)}" />
          <label class="welcome-label" for="welcomeNights">How many days</label>
          <input class="welcome-input" id="welcomeNights" type="number" min="1" max="21"
                 inputmode="numeric" value="${esc(w.nights)}" placeholder="3" />
        `,
        can: true,
      };
    }
    return {
      kicker: "Who",
      title: "Who's coming?",
      sub: "It changes the answers: a four-year-old and a group of friends want different afternoons.",
      body: `
        <div class="search-chips welcome-chips">
          ${WHO_OPTIONS.map(
            (x) =>
              `<button class="search-chip${w.who === x ? " on" : ""}" data-welcome-who="${esc(x)}">${esc(
                x
              )}</button>`
          ).join("")}
        </div>
        <input class="welcome-input" id="welcomeWho" type="text" value="${esc(w.who)}"
               placeholder="Or say it in your own words" autocomplete="off" />
      `,
      can: true,
    };
  }

  function renderWelcome() {
    if (!welcome) return;
    const step = welcomeStep();
    const last = welcome.step === 2;
    welcomeOverlay.innerHTML = `
      <div class="welcome-body">
        <div class="welcome-dots">
          ${[0, 1, 2]
            .map((i) => `<span class="welcome-dot${i === welcome.step ? " on" : ""}"></span>`)
            .join("")}
        </div>
        <div class="welcome-kicker">${esc(step.kicker)}</div>
        <h1 class="welcome-title">${esc(step.title)}</h1>
        <p class="welcome-sub">${esc(step.sub)}</p>
        ${step.body}
      </div>
      <div class="welcome-foot">
        ${
          welcome.step > 0
            ? `<button class="modal-btn" data-welcome-back="1">Back</button>`
            : `<button class="modal-btn" data-welcome-skip="1">Skip</button>`
        }
        <button class="modal-btn modal-btn-primary" data-welcome-next="1" ${step.can ? "" : "disabled"}>
          ${last ? "Start" : "Next"}
        </button>
      </div>
    `;
    welcomeOverlay.classList.add("open");
    wireWelcome();
  }

  function readWelcomeInputs() {
    const where = document.getElementById("welcomeWhere");
    const start = document.getElementById("welcomeStart");
    const nights = document.getElementById("welcomeNights");
    const who = document.getElementById("welcomeWho");
    if (where) welcome.where = where.value;
    if (start) welcome.start = start.value;
    if (nights) welcome.nights = nights.value;
    if (who) welcome.who = who.value;
  }

  function wireWelcome() {
    welcomeOverlay.querySelectorAll("[data-welcome-where]").forEach((b) =>
      b.addEventListener("click", () => {
        welcome.where = b.getAttribute("data-welcome-where");
        renderWelcome();
      })
    );
    welcomeOverlay.querySelectorAll("[data-welcome-who]").forEach((b) =>
      b.addEventListener("click", () => {
        welcome.who = b.getAttribute("data-welcome-who");
        renderWelcome();
      })
    );
    const where = document.getElementById("welcomeWhere");
    if (where) {
      where.addEventListener("input", () => {
        welcome.where = where.value;
        const next = welcomeOverlay.querySelector("[data-welcome-next]");
        if (next) next.disabled = !where.value.trim();
      });
    }
    const skip = welcomeOverlay.querySelector("[data-welcome-skip]");
    if (skip) skip.addEventListener("click", () => finishWelcome());
    const back = welcomeOverlay.querySelector("[data-welcome-back]");
    if (back)
      back.addEventListener("click", () => {
        readWelcomeInputs();
        welcome.step -= 1;
        renderWelcome();
      });
    const next = welcomeOverlay.querySelector("[data-welcome-next]");
    if (next)
      next.addEventListener("click", () => {
        readWelcomeInputs();
        if (welcome.step === 2) {
          // Straight into the thing that fills an empty trip, rather than
          // back to the empty trip.
          finishWelcome("idea");
          return;
        }
        welcome.step += 1;
        renderWelcome();
      });
  }

  // The chrome carries its icons in markup as data-ico names; this draws them
  // once at startup. Screens draw their own as they render.
  paintIcons(document);

  // ---------- The bits that only exist on a phone ----------
  // A web page in a WebView gives itself away in three places before you have
  // touched anything: a status bar in somebody else's colour along the top, a
  // white flash while the page loads, and taps that produce no sensation at
  // all. None of that is visual design - it is the app admitting what it is.
  function nativePlugin(name) {
    const caps = window.Capacitor;
    return (caps && caps.Plugins && caps.Plugins[name]) || null;
  }

  function setUpNativeShell() {
    const bar = nativePlugin("StatusBar");
    if (bar) {
      // The status bar has to follow the theme, and follow it when it
      // changes: dark icons on the light paper, light icons on the dark.
      const dress = () => {
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        try {
          bar.setStyle({ style: dark ? "DARK" : "LIGHT" });
          bar.setBackgroundColor({ color: dark ? "#12161b" : "#f7f6f3" });
        } catch (e) {
          /* An older WebView without one of these is not worth a broken app. */
        }
      };
      dress();
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", dress);
    }
  }

  // A tap that does something you cannot undo, or that confirms something,
  // gets a short one. Everything else gets nothing: haptics on every button
  // is the phone equivalent of a beep on every keystroke.
  function tapFeedback(kind) {
    const haptics = nativePlugin("Haptics");
    if (!haptics) return;
    try {
      if (kind === "heavy") haptics.notification({ type: "SUCCESS" });
      else haptics.impact({ style: kind === "medium" ? "MEDIUM" : "LIGHT" });
    } catch (e) {
      /* Not every device has a motor, and none of this is load-bearing. */
    }
  }
  window.tapFeedback = tapFeedback;

  // A door for the browser suite. Most of it drives real controls, because
  // "the handler is attached" and "tapping it does something" have turned out
  // to be different questions in this app more than once. But a few of the
  // worst faults live in functions no button reaches directly: a lookup with
  // no timeout has no visible symptom except a spinner that stays forever,
  // and there is no way to wait for forever. These read; none of them changes
  // anything.
  window.__tripTest = {
    ASSISTANTS,
    extractJson,
    eventsBusy,
    renderEvents,
    stopEventSearch,
    eventVerdict,
    backfillEvents,
    eventsNeedingBackfill,
    napIsUnavoidable,
    napWindow,
    earliestBedtime,
    bedtimeOf,
    looksOutdoor,
    copyEventFields,
    EVENT_FIELDS,
    // Places and Eats are views with no tab of their own; a suite that wants
    // to render one has no button to press.
    showView,
    geocodeCandidates,
    findPhoto,
    isOffline,
    chooseTiles,
    offlineStops,
    formatBytes,
    plannedNotifications,
    closingMinutesOnDay,
    whoDescription,
    childVerdict,
    clashesWithNap,
    forOurKids,
    aiContextBlock,
    importBackup,
    buildBackup,
    store,
    autoBackup,
    deleteBoard,
    BOARD_PARTS,
    eventWindow,
    normaliseEvent,
    eventIsPast,
    eventDateLabel,
    addEventToItsDay,
    parseEventDate,
    cityColor,
    hoursAt,
    parsedHours,
    stillOnAt,
    customWindow,
    sunTimes,
    findInPicks,
    buildTripIcs,
  };

  setUpNativeShell();
  wireNotificationTaps();
  // Late and quiet: this is housekeeping, and nothing on the first screen
  // should wait for a file write.
  setTimeout(() => {
    autoBackup().catch(() => {});
  }, 4000);
  // The plan can be a fortnight long and the forecast changes daily, so what
  // was scheduled last week is not what should fire tomorrow.
  scheduleReschedule();
  window.addEventListener("focus", scheduleReschedule);

  refreshForBoard();

  if (needsWelcome()) openWelcome();
})();
