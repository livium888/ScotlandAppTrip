// Building calendar (.ics) text. Pure string work, so it can be tested in Node
// directly.

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
export const ICS_LINE_END = "\r\n"; // RFC 5545 is explicit about this, and Outlook cares

export function icsEscape(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Long lines must be folded at 75 octets, continued with a leading space.
// A calendar that refuses to open is the usual symptom of skipping this.
export function icsFold(line) {
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

export function icsStamp(date) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  );
}

export function icsDay(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
}
