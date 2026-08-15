// Icons.
//
// The app was drawn in emoji: 📍 for Today, 🧸 for Kids, ♡ for Picks, 💷 for
// Budget. Emoji are somebody else's artwork - each one comes from a different
// designer, at a different weight, in colours that answer to nothing in this
// app, and half of them render as flat glyphs while the other half arrive in
// full colour. A row of six of them along the bottom of the screen is the
// single clearest sign that nobody drew this on purpose.
//
// So: one set, drawn to one grid. 24px box, 1.75px stroke, round caps and
// joins, no fills except where a shape needs one. They inherit colour from
// their surroundings, which means a single icon works on the tab bar, inside a
// filled button and on a dark background without being redrawn.
(function () {
  "use strict";

  const P = {
    // --- Navigation ---
    today: '<circle cx="12" cy="12" r="8.5"/><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z"/>',
    // A teddy's head. Two attempts at a balloon read as a lightbulb and then
    // as a map pin - and a map pin one tab along from Today, which is a map
    // pin, is worse than no icon at all. Two ears and a face cannot be
    // mistaken for anything else.
    kids:
      '<circle cx="7.4" cy="7.6" r="2.7"/><circle cx="16.6" cy="7.6" r="2.7"/>' +
      '<circle cx="12" cy="13.6" r="6.2"/>' +
      '<circle cx="10" cy="12.4" r="0.85" fill="currentColor" stroke="none"/>' +
      '<circle cx="14" cy="12.4" r="0.85" fill="currentColor" stroke="none"/>' +
      '<path d="M10.4 15.9a2.4 2.4 0 0 0 3.2 0"/>',
    itinerary:
      '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v4M16 3v4M3.5 10.5h17"/>',
    picks: '<path d="M20.4 8.9a4.7 4.7 0 0 0-8.4-2.6A4.7 4.7 0 0 0 3.6 8.9c0 4.3 8.4 9.8 8.4 9.8s8.4-5.5 8.4-9.8z"/>',
    budget:
      '<rect x="3" y="6.5" width="18" height="13" rx="3"/><path d="M3 11h18"/>' +
      '<circle cx="16.5" cy="15.2" r="1.2" fill="currentColor" stroke="none"/>',
    // A rucksack: grab handle small, body wide, a lid seam and a pocket. The
    // first version had a tall thin loop over a squat box and read as a
    // padlock.
    tips:
      '<path d="M10 6.6V5.9a2 2 0 0 1 4 0v.7"/>' +
      '<path d="M4.5 12a5.5 5.5 0 0 1 5.5-5.5h4A5.5 5.5 0 0 1 19.5 12v6.2a2.3 2.3 0 0 1-2.3 2.3H6.8a2.3 2.3 0 0 1-2.3-2.3z"/>' +
      '<path d="M8.4 13.6h7.2v3.4H8.4z"/>',

    // --- Chrome ---
    search: '<circle cx="11" cy="11" r="6.8"/><path d="M16 16l4.2 4.2"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    back: '<path d="M15 4.8L7.8 12 15 19.2"/>',
    forward: '<path d="M9 4.8L16.2 12 9 19.2"/>',
    down: '<path d="M4.8 8.5L12 15.7l7.2-7.2"/>',
    up: '<path d="M4.8 15.5L12 8.3l7.2 7.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    check: '<path d="M4.5 12.5l5 5L19.5 7"/>',
    settings:
      '<path d="M4 7h4.5M13.5 7H20M4 17h4.5M13.5 17H20M4 12h9M18 12h2"/>' +
      '<circle cx="11" cy="7" r="2.3"/><circle cx="15.5" cy="12" r="2.3"/><circle cx="11" cy="17" r="2.3"/>',
    more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    filter: '<path d="M4 6.5h16M7 12h10M10 17.5h4"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5V10h-5.5"/>',

    // --- Place & map ---
    map: '<path d="M9 4.2L3.5 7v12.8L9 17l6 2.8 5.5-2.8V4.2L15 7z"/><path d="M9 4.2V17M15 7v12.8"/>',
    pin: '<path d="M12 20.5s6.5-5.9 6.5-10.3a6.5 6.5 0 0 0-13 0C5.5 14.6 12 20.5 12 20.5z"/><circle cx="12" cy="10" r="2.4"/>',
    directions: '<path d="M20.5 3.5L3.8 10.6l7.2 2.4 2.4 7.2z"/>',
    external: '<path d="M13.5 4H20v6.5M20 4l-8.5 8.5"/><path d="M17.5 14.5V19a1.8 1.8 0 0 1-1.8 1.8H5a1.8 1.8 0 0 1-1.8-1.8V8.3A1.8 1.8 0 0 1 5 6.5h4.5"/>',
    share: '<circle cx="17.5" cy="5.8" r="2.6"/><circle cx="6.5" cy="12" r="2.6"/><circle cx="17.5" cy="18.2" r="2.6"/><path d="M8.8 10.8l6.4-3.6M8.8 13.2l6.4 3.6"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.2 2.3 3.4 5.3 3.4 8.5S14.2 18.2 12 20.5c-2.2-2.3-3.4-5.3-3.4-8.5S9.8 5.8 12 3.5z"/>',
    walk: '<circle cx="13" cy="4.6" r="1.9"/><path d="M11 21l1.6-5.6-2.4-2.2.9-4.3 3.2 1.7 2.3 2.4"/><path d="M10.1 8.9L7.4 11l-.9 3.2M12.6 15.4L15 21"/>',
    car: '<path d="M4 15.5h16M6.5 15.5v2.2M17.5 15.5v2.2"/><path d="M4.6 15.5l1.6-5.2A2.4 2.4 0 0 1 8.5 8.6h7a2.4 2.4 0 0 1 2.3 1.7l1.6 5.2z"/><circle cx="8" cy="13" r="0.9" fill="currentColor" stroke="none"/><circle cx="16" cy="13" r="0.9" fill="currentColor" stroke="none"/>',

    // --- Time ---
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.2 1.9"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v4M16 3v4M3.5 10.5h17"/>',
    calendarPlus:
      '<path d="M20.5 11.5V8a3 3 0 0 0-3-3h-11a3 3 0 0 0-3 3v9.5a3 3 0 0 0 3 3h5.5"/>' +
      '<path d="M8 3v4M16 3v4M3.5 10.5h17"/><path d="M18 14.5v6M15 17.5h6"/>',

    // --- Things ---
    coffee: '<path d="M4.5 8.5h12v5.8a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z"/><path d="M16.5 9.8h1.6a2.6 2.6 0 0 1 0 5.2h-1.6"/><path d="M8 3v2.2M12.5 3v2.2"/>',
    food: '<path d="M6.5 3v7.5a2.2 2.2 0 0 0 2.2 2.2h.3V21"/><path d="M6.5 3v5M10.5 3v5"/><path d="M17.5 21v-7.5c-1.6 0-2.6-1.1-2.6-3.2 0-3.6 1.2-6.3 2.6-7.3z"/>',
    // Three merlons, a body and a door - drawn big, because a castle with
    // detail in it turns to mush at 17px, which is the size it is mostly used.
    castle:
      '<path d="M4 20.5V6.5l3 2 2.5-2.5 2.5 2 2.5-2 2.5 2.5 3-2v14z"/>' +
      '<path d="M9.7 20.5v-4.3a2.3 2.3 0 0 1 4.6 0v4.3"/>',
    sparkle:
      '<path d="M11 3.5l1.7 4.6 4.6 1.7-4.6 1.7L11 16.1 9.3 11.5 4.7 9.8l4.6-1.7z"/>' +
      '<path d="M17.8 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
    dice: '<rect x="3.8" y="3.8" width="16.4" height="16.4" rx="4.2"/><circle cx="8.6" cy="8.6" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.4" cy="15.4" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.4" cy="8.6" r="1.3" fill="currentColor" stroke="none"/><circle cx="8.6" cy="15.4" r="1.3" fill="currentColor" stroke="none"/>',
    star: '<path d="M12 3.8l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z"/>',
    folder: '<path d="M3.5 7.5a2.5 2.5 0 0 1 2.5-2.5h3.3l2.2 2.6h6a2.5 2.5 0 0 1 2.5 2.5v7.4a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5z"/>',
    note: '<path d="M5 4.5h14v15H5z" /><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/>',
    trash: '<path d="M4.5 7h15M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.5 7l.9 12a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9l.9-12"/>',
    edit: '<path d="M4 20h4.2L20 8.2 15.8 4 4 15.8z"/><path d="M14.4 5.4l4.2 4.2"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.9" r="1.1" fill="currentColor" stroke="none"/>',
    alert: '<path d="M12 3.8l9 15.4H3z"/><path d="M12 9.5v4.2"/><circle cx="12" cy="16.6" r="1.1" fill="currentColor" stroke="none"/>',
    key: '<circle cx="7.5" cy="12" r="3.8"/><path d="M11.3 12H21M18 12v3.2M15 12v2.4"/>',
    download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>',
    upload: '<path d="M12 20V9M7.5 13.5L12 9l4.5 4.5"/><path d="M4.5 4.5h15"/>',
    list: '<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11"/><circle cx="4.6" cy="6.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.6" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.6" cy="17.5" r="1.2" fill="currentColor" stroke="none"/>',

    phone: '<path d="M8.4 4.5l2 3.4-1.8 2c.9 2 2.5 3.6 4.5 4.5l2-1.8 3.4 2v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 3.4 6.7a2 2 0 0 1 2-2.2z"/>',
    link: '<path d="M10.2 13.8a3.8 3.8 0 0 0 5.4 0l3-3a3.8 3.8 0 0 0-5.4-5.4l-1.5 1.5"/><path d="M13.8 10.2a3.8 3.8 0 0 0-5.4 0l-3 3a3.8 3.8 0 0 0 5.4 5.4l1.5-1.5"/>',

    // --- Weather ---
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/>',
    cloud: '<path d="M7 18.5a4 4 0 0 1-.4-8A5.6 5.6 0 0 1 17.4 11a3.8 3.8 0 0 1-.4 7.5z"/>',
    rain: '<path d="M7 15.5a3.8 3.8 0 0 1-.4-7.6A5.4 5.4 0 0 1 17.2 8.4a3.6 3.6 0 0 1-.4 7.1z"/><path d="M8.5 18l-.8 2.4M12 18l-.8 2.4M15.5 18l-.8 2.4"/>',
  };

  // Anything asked for that does not exist renders as a neutral dot rather
  // than an empty box - a missing icon should look like a gap, not a crash.
  const FALLBACK = '<circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/>';

  // `size` is a number of pixels; `cls` is appended to the element class so a
  // caller can size or colour it from CSS instead.
  function icon(name, opts) {
    const o = opts || {};
    const size = o.size || 22;
    const body = P[name] || FALLBACK;
    return (
      `<svg class="ico${o.cls ? " " + o.cls : ""}" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
      `fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" ` +
      `stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
    );
  }

  window.icon = icon;
  window.ICON_NAMES = Object.keys(P);
})();
