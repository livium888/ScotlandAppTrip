// Text helpers with no business with the page: escaping, link safety, a colour
// for a town. Pure functions, so they can be tested in Node directly.

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

export function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"'`]/g, (c) => ESCAPES[c]);
}

// There was a lookup table with Edinburgh, Stirling and Glasgow in it, and
// one grey for everywhere else - so every town on every other trip was the
// same colour. The name is hashed to a hue instead: any town gets its own,
// and gets the same one every time.
export function cityColor(city) {
  const name = String(city || "").trim();
  if (!name) return "hsl(210 8% 45%)";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  // Kept away from the extremes so it reads as ink on both themes.
  return `hsl(${h} 42% 42%)`;
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
export function safeUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  // Protocol-relative and bare domains are treated as https rather than
  // dropped, since OSM data is full of "www.example.com".
  if (/^\/\//.test(raw)) return `https:${raw}`;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(raw)) return `https://${raw}`;
  try {
    const u = new URL(raw);
    return ["http:", "https:", "mailto:", "tel:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}
