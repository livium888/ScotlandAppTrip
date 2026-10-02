// Reading what a model wrote: JSON out of prose, listings out of labelled
// lines, and the prompt wording that asks for those lines. Pure functions, so
// they can be tested in Node directly. The jsonrepair library, when the page
// has loaded it, is picked up from the global it publishes.

// Models wrap JSON in prose or code fences often enough that this is worth
// doing properly rather than hoping for a clean parse.
export function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[[{]/);
  if (start < 0) return null;
  const end = Math.max(raw.lastIndexOf("]"), raw.lastIndexOf("}"));
  const body = end > start ? raw.slice(start, end + 1) : raw.slice(start);

  try {
    return JSON.parse(body);
  } catch {
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
  const lib = globalThis.JSONRepair && globalThis.JSONRepair.jsonrepair;
  if (!lib) return undefined;
  try {
    return JSON.parse(lib(body));
  } catch {
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
  } catch {
    return null;
  }
}

// One listing per line, "label: value; label: value", read into the same
// shape the JSON answers had, so everything after this is unchanged.
// Only whole lines are read: a line still being written is left for later.
const LINE_LABELS = {
  name: "name", title: "name", film: "name", show: "name",
  venue: "venue", cinema: "venue", place: "venue",
  town: "area", area: "area", village: "area",
  date: "date", "first date": "date", "start date": "date",
  "end date": "endDate", "last date": "endDate", until: "endDate",
  time: "time", "start time": "time", "end time": "endTime", times: "times", "showing times": "times",
  setting: "setting", ages: "ages", age: "ages", rating: "rating", "bbfc rating": "rating",
  "for children": "childFocus", children: "childFocus",
  price: "price", booking: "booking", tickets: "tickets", link: "link", source: "link",
  weekly: "weekly", what: "what", description: "what",
};

// The reader behind every labelled-lines answer. Which labels mean what, which
// field comes last (and may hold a semicolon), which unlabelled leading parts
// are read in what order, and which field a line must have to count at all
// are all parameters, so each search shares the tolerance learned from real
// answers; `finish` turns the strings into the shape the search wants, and
// may return null to drop a line.
export function readLabelledLines(text, labels, options) {
  const { wholeOnly = false, lastKey = "", looseKeys = ["name"], required = "name", finish = (x) => x } = options || {};
  const startsWithRequired = new RegExp(`^\\s*${required}\\s*[:;(]`, "i");
  const lines = String(text || "").split(/\r?\n/);
  if (wholeOnly && !/\n$/.test(String(text || ""))) lines.pop();
  const labelOf = (w) => labels[String(w || "").toLowerCase().replace(/[*_]/g, "").trim()];
  const out = [];
  lines.forEach((raw) => {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "");
    if (line === raw && !startsWithRequired.test(raw)) return;
    const item = {};
    const set = (key, value) => {
      const v = String(value || "").replace(/^[*_\s]+|[*_\s]+$/g, "");
      if (!key || !v || item[key] || /^(n\/?a|none given|unknown|not stated|-)$/i.test(v)) return;
      item[key] = v;
    };
    // Models do not all write "label: value". Seen from a lite model on a
    // phone: "name; PAW Patrol; venue; Vue Portsmouth" (label and value as
    // alternate parts), "date (2026-10-02)" (value in brackets), and a bare
    // name, venue and town with no labels at all. All three are read.
    const parts = line.split(/\s*;\s*/).filter((x) => x !== "");
    const loose = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      let m = /^([A-Za-z][A-Za-z ]{0,20}?)\s*:\s*(.+)$/.exec(part);
      if (m && labelOf(m[1])) {
        set(labelOf(m[1]), m[2]);
        continue;
      }
      m = /^([A-Za-z][A-Za-z ]{0,20}?)\s*\((.+)\)$/.exec(part);
      if (m && labelOf(m[1])) {
        set(labelOf(m[1]), m[2]);
        continue;
      }
      if (labelOf(part) && i + 1 < parts.length && !labelOf(parts[i + 1])) {
        set(labelOf(part), parts[i + 1]);
        i++;
        continue;
      }
      // The last field comes last and may itself hold a semicolon.
      if (lastKey && item[lastKey] && !labelOf(part)) {
        item[lastKey] += `; ${part}`;
        continue;
      }
      loose.push(part);
    }
    // Unlabelled leading parts, in the order the search lists its fields.
    looseKeys.forEach((key) => {
      if (!item[key] && loose.length) set(key, loose.shift());
    });
    if (!item[required]) return;
    const done = finish(item);
    if (done) out.push(done);
  });
  return out;
}

export function parseListingLines(text, wholeOnly) {
  return readLabelledLines(text, LINE_LABELS, {
    wholeOnly,
    lastKey: "what",
    looseKeys: ["name", "venue", "area"],
    finish: finishEventLine,
  });
}

// "2-4", "8+", "under 5", "6 months to 3": the ages a listing states, as the
// numbers the app filters on. Anything it does not state is left out.
export function readAges(text) {
  const out = {};
  const s = String(text || "");
  const range = /(\d+)\s*(?:months?)?\s*(?:-|–|to)\s*(\d+)/.exec(s);
  const months = /^\s*\d+\s*months?/i.test(s);
  const plus = /(\d+)\s*\+/.exec(s);
  const under = /under\s*(\d+)/i.exec(s);
  if (range) {
    out.minAge = months ? 0 : Number(range[1]);
    out.maxAge = Number(range[2]);
  } else if (plus) out.minAge = Number(plus[1]);
  else if (under) out.maxAge = Number(under[1]) - 1;
  return out;
}

const oneOf = (text, words) => (new RegExp(words, "i").exec(text) || [""])[0].toLowerCase();

// Events: the strings a model wrote, turned into the fields the app uses.
function finishEventLine(item) {
  // "name: No qualifying screenings found" is the model saying nothing
  // was found, not a listing called that.
  if (!item.date && /^(no\b|none\b|nothing\b|n\/a\b)/i.test(item.name)) return null;
  if (item.times) item.times = item.times.split(/[,/]|\band\b/).map((t) => t.trim()).filter(Boolean);
  if (item.ages) {
    Object.assign(item, readAges(item.ages));
    delete item.ages;
  }
  if (item.childFocus) item.childFocus = oneOf(item.childFocus, "aimed|allowed|adults");
  if (item.booking) item.booking = oneOf(item.booking, "required|advised|none");
  if (item.weekly) item.recurring = /^y/i.test(item.weekly);
  return item;
}

// ---------- The other searches that ask for lines ----------
// The fields each asks for, said once, so the question and the reader cannot
// drift apart. None of them may mention JSON: see lineFormat.
export const PLACE_LINE_FIELDS =
  `name (exact official name); area (the town or village it is in); ` +
  `postcode (if you know it, otherwise leave out); why (one short sentence on why it fits, last)`;

export const NEARBY_LINE_FIELDS =
  `name (exact official name); area (street or neighbourhood); ` +
  `rating (the review score out of 5, only if you can confirm one from search, otherwise leave out); ` +
  `reviews (roughly how many reviews that score is based on, otherwise leave out); ` +
  `price (£, ££ or £££ if it costs money); booking (yes only if booking ahead is normally needed); ` +
  `why (one short sentence saying why it fits, last)`;

export const BACKFILL_LINE_FIELDS =
  `n (the number above); setting (indoor, outdoor or both); ages (e.g. 2-4, 8+); ` +
  `for children (aimed if put on for children or families, allowed, or adults if adults-only); ` +
  `booking (required, advised or none). Leave out anything the listing does not state`;

const PLACE_LABELS = {
  name: "name", title: "name", place: "name",
  area: "area", town: "area", village: "area", location: "area", neighbourhood: "area", neighborhood: "area", street: "area",
  postcode: "postcode", "post code": "postcode", postal: "postcode",
  why: "why", reason: "why", what: "why", description: "why",
};

const NEARBY_LABELS = {
  ...PLACE_LABELS,
  rating: "rating", score: "rating",
  reviews: "ratingCount", "review count": "ratingCount", ratings: "ratingCount",
  price: "price", cost: "price",
  booking: "booking", "book ahead": "booking",
};

const BACKFILL_LABELS = {
  n: "n", no: "n", number: "n",
  setting: "setting", ages: "ages", age: "ages",
  "for children": "childFocus", children: "childFocus",
  booking: "booking",
};

// Lines first. A model asked for lines may still send JSON, and a model that
// was given no choice (no search) may be asked for JSON on purpose, so a
// JSON array is accepted whenever no line could be read.
function linesOrJson(text, readLines, fromJson) {
  const lines = readLines(text);
  if (lines.length) return lines;
  const parsed = extractJson(text);
  return Array.isArray(parsed) ? parsed.filter((x) => x && typeof x === "object").map(fromJson).filter(Boolean) : [];
}

const clean = (v) => (v == null ? "" : String(v).trim());

export function readPlaceAnswer(text) {
  return linesOrJson(
    text,
    (t) => readLabelledLines(t, PLACE_LABELS, { lastKey: "why", looseKeys: ["name", "area"] }),
    (x) => {
      if (!clean(x.name)) return null;
      const out = { name: clean(x.name) };
      if (clean(x.area)) out.area = clean(x.area);
      if (clean(x.postcode)) out.postcode = clean(x.postcode);
      if (clean(x.why)) out.why = clean(x.why);
      return out;
    }
  );
}

const count = (v) => {
  const n = Number(String(v == null ? "" : v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const score = (v) => {
  const m = /(\d+(?:\.\d+)?)/.exec(String(v == null ? "" : v));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 5 ? n : null;
};
const pounds = (v) => (/^£{1,3}$/.test(clean(v)) ? clean(v) : null);
const yes = (v) => v === true || /^(y|yes|true|required|advised)\b/i.test(clean(v));

function finishNearby(item) {
  return {
    ...item,
    rating: score(item.rating),
    ratingCount: count(item.ratingCount),
    price: pounds(item.price),
    booking: yes(item.booking),
  };
}

export function readNearbyAnswer(text) {
  return linesOrJson(
    text,
    (t) => readLabelledLines(t, NEARBY_LABELS, { lastKey: "why", looseKeys: ["name", "area"], finish: finishNearby }),
    (x) => (clean(x.name) ? finishNearby({ name: clean(x.name), area: clean(x.area), why: clean(x.why), rating: x.rating, ratingCount: x.ratingCount, price: x.price, booking: x.booking }) : null)
  );
}

export function readBackfillAnswer(text) {
  const finish = (item) => {
    const out = { n: Number(item.n) };
    if (!Number.isFinite(out.n)) return null;
    if (item.setting) out.setting = oneOf(item.setting, "indoor|outdoor|both");
    if (item.ages) Object.assign(out, readAges(item.ages));
    if (item.childFocus) out.childFocus = oneOf(item.childFocus, "aimed|allowed|adults");
    if (item.booking) out.booking = oneOf(item.booking, "required|advised|none");
    return out;
  };
  return linesOrJson(
    text,
    (t) => readLabelledLines(t, BACKFILL_LABELS, { looseKeys: [], required: "n", finish }),
    (x) => ({ n: Number(x.n), setting: x.setting || "", minAge: x.minAge, maxAge: x.maxAge, childFocus: x.childFocus || "", booking: x.booking || "" })
  );
}

// The listings finished so far in an answer still being written: every
// complete {...} at the top level of the array, read the moment its brace
// closes. Half an object is left until the rest of it arrives.
export function partialListings(text) {
  const start = String(text || "").indexOf("[");
  if (start < 0) return [];
  const out = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let from = -1;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) from = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && from >= 0) {
        try {
          out.push(JSON.parse(text.slice(from, i + 1)));
        } catch {
          /* not valid on its own; the whole answer is still read at the end */
        }
        from = -1;
      }
    } else if (ch === "]" && depth === 0) break;
  }
  return out;
}

// The fields a session kind answers with, said once.
// Why the answer is asked for as lines of text rather than JSON. On the
// Gemini 3 flash models, asking for JSON - even only in the wording of the
// question - silently switches Google Search off: the request succeeds,
// there is no error, and the model answers from memory
// (google-gemini/cookbook#1274: JSON grounded 0 of 5 times, prose 5 of 5).
// A trace from a real phone showed exactly that: gemini-3.8-flash, twenty
// seconds, "searched the web: NO". So the search is asked for in plain
// text, one listing per line with labelled fields, and the phone reads the
// lines itself - no second request to turn them into data.
export function lineFormat(fields) {
  return (
    `Answer as a plain list, one listing per line, each line starting with "- " and ` +
    `giving these as "label: value" separated by "; " - ${fields}. Leave out a label ` +
    `the listing does not state rather than guessing. No other text before or after the list.`
  );
}
