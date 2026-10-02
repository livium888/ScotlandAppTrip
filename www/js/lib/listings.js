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

export function parseListingLines(text, wholeOnly) {
  const lines = String(text || "").split(/\r?\n/);
  if (wholeOnly && !/\n$/.test(String(text || ""))) lines.pop();
  const labelOf = (w) => LINE_LABELS[String(w || "").toLowerCase().replace(/[*_]/g, "").trim()];
  const out = [];
  lines.forEach((raw) => {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "");
    if (line === raw && !/^\s*name\s*[:;(]/i.test(raw)) return;
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
      // "what" comes last and may itself hold a semicolon.
      if (item.what && !labelOf(part)) {
        item.what += `; ${part}`;
        continue;
      }
      loose.push(part);
    }
    // Unlabelled leading parts: name, then venue, then town.
    ["name", "venue", "area"].forEach((key) => {
      if (!item[key] && loose.length) set(key, loose.shift());
    });
    if (!item.name) return;
    // "name: No qualifying screenings found" is the model saying nothing
    // was found, not a listing called that.
    if (!item.date && /^(no\b|none\b|nothing\b|n\/a\b)/i.test(item.name)) return;
    if (item.times) item.times = item.times.split(/[,/]|\band\b/).map((t) => t.trim()).filter(Boolean);
    if (item.ages) {
      const a = /(\d+)\s*(?:months?)?\s*(?:-|–|to)\s*(\d+)/.exec(item.ages);
      const months = /^\s*\d+\s*months?/i.test(item.ages);
      const plus = /(\d+)\s*\+/.exec(item.ages);
      const under = /under\s*(\d+)/i.exec(item.ages);
      if (a) { item.minAge = months ? 0 : Number(a[1]); item.maxAge = Number(a[2]); }
      else if (plus) item.minAge = Number(plus[1]);
      else if (under) item.maxAge = Number(under[1]) - 1;
      delete item.ages;
    }
    if (item.childFocus) item.childFocus = (/aimed|allowed|adults/i.exec(item.childFocus) || [""])[0].toLowerCase();
    if (item.booking) item.booking = (/required|advised|none/i.exec(item.booking) || [""])[0].toLowerCase();
    if (item.weekly) item.recurring = /^y/i.test(item.weekly);
    out.push(item);
  });
  return out;
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
