# Vendored libraries

No build step, so these are plain scripts loaded by `<script>` tags in
`index.html`, in this order. `suncalc` must come before `opening_hours`, which
uses it to answer `sunrise-sunset` opening times.

| File | Package | Version | Licence | Why |
|---|---|---|---|---|
| `suncalc.js` | suncalc | 2.0.1 | see upstream (no `license` field in its package.json) | Sunrise/sunset for a date and latitude, which decides whether a walk at half three is a good idea in November |
| `opening_hours.js` | opening_hours | 3.14.0 | **LGPL-3.0-only** | The reference OSM `opening_hours` parser: seasons, public holidays, `sunrise-sunset`, and "is it open right now" |
| `idb.js` | idb | 8.0.3 | ISC | Promises over IndexedDB, for the tile/photo/geocode caches |
| `fuse.js` | fuse.js | 7.5.0 | Apache-2.0 | Fuzzy search over the places you have already saved |
| `jsonrepair.js` | jsonrepair | 3.15.0 | ISC | Reads the JSON a model actually produces, rather than the JSON it was asked for |

**`jsonrepair` earns its 7 KB on the paste path.** The hand-rolled repair it
sits in front of only ever closed brackets on a truncated answer. Everything
else a model or a person pasting from one produces — single quotes, trailing
commas, unquoted keys, smart quotes from a phone keyboard, `None` instead of
`null`, `//` comments, a raw newline inside a string — it could not read at
all, and the screen said "that didn't contain a list this could read" about
text that plainly did. All three parsers are still tried in turn: plain
`JSON.parse`, then `jsonrepair`, then the original, which is better at
throwing away a half-written trailing object.

## Two things worth knowing

**`opening_hours` is LGPL-3.0-only** and 1.2 MB, roughly a fifth of the APK. It
is carried as a separate, unmodified file precisely so it can be replaced,
which is what that licence asks for. It was adopted with those costs known.

**`fuse.js` ships as an ES module and has been modified.** The final
`export{re as default};` is replaced with `window.Fuse = re;` and the whole
file wrapped in an IIFE. The wrapper is not cosmetic: without it, a classic
script publishes every one of Fuse's minified top-level names as a global —
about forty single letters — and one of them overwrote Leaflet's `L`, taking
every map in the app down. `tests/test_libs.mjs` checks that it stays wrapped.

## Updating one

Re-run `npm pack <name>`, copy the same file out of the tarball, and re-apply
the Fuse transform if that is the one changing. Then `npm test` — `test_libs.mjs`
covers what each library is actually here to do.
