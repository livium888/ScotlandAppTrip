# Assurance review — Scotland with Ally

Reviewed against OWASP SAMM's five business functions. A caveat up front:
SAMM measures an *organisation's* maturity across many teams and products.
This is one person's phone app with no users but its author, no server, and
no data belonging to anyone else. Scoring it 1–3 per practice would be
theatre. What follows keeps SAMM's structure because it makes the blind spots
visible, and says plainly where a practice does not apply.

Everything below was checked by running it, not by reading the code and
forming an impression. Where a fix was made, the test that proves it is named.

---

## Threat model, stated first

Worth being explicit, because it decides what matters:

- **The app is a WebView** holding the user's API keys in `localStorage`.
- **It renders text from sources nobody controls**: OpenStreetMap (world
  editable), Nominatim, Photon, a language model, and whatever arrives
  through the Android share sheet.
- **There is no backend.** No accounts, no other users' data, no server to
  attack. The valuable asset is exactly one thing: the API keys, and the
  quota someone else could spend with them.
- **Physical access is a realistic threat** in a way it usually isn't — this
  is a phone carried on a trip.

So the questions that matter are: can hostile text become code, and can the
keys get off the device.

---

## Governance

*Strategy, policy, education.* Largely N/A for a solo project — there is no
team to align. The parts that do apply:

- **Dependency policy.** Four runtime dependencies, all first-party Capacitor
  plugins. `npm audit --omit=dev` → **0 vulnerabilities**. Leaflet is vendored
  rather than pulled at build time, so the shipped copy is the reviewed copy.
- **Secrets policy.** No credential is committed. Scanned the working tree and
  the entire git history for API-key patterns: clean.
- **One deliberate exception:** `android/keystore/debug.keystore` is committed
  on purpose, so that every debug build signs with the same key and updates
  install over the top instead of wiping the user's data. It is the standard
  Android debug key and grants nothing. **It must never be used to sign a
  release build** — a release needs a key that is not in a public repo.

## Design

- **Data minimisation is the app's strongest property.** Everything lives in
  `localStorage` on one device. No account, no sync, no analytics, no crash
  reporting, nothing leaves the phone except direct calls to Google, OSM and
  Open-Meteo.
- **Optional dependencies degrade rather than fail.** No API key still gives a
  working app via OpenStreetMap.
- **Trust boundary now written down** (it wasn't before): everything crossing
  the network is untrusted and must be escaped on the way in to the DOM, and
  URL-validated before becoming a link.

## Implementation

Three findings, all fixed.

### 1. Stored XSS via a place name — **fixed**

The real one. Leaflet's `bindTooltip`/`bindPopup` parse a string as **HTML**,
not text. The search-results map did:

```js
.bindTooltip(`${i + 1}. ${r.name}`)   // r.name comes from OSM or a model
```

A place named `<img src=x onerror=…>` executed script inside the WebView —
which is the same origin as the app, with read access to `localStorage`, i.e.
the API keys. A probe firing payloads through every ingestion path and walking
every screen confirmed execution twice before the fix, zero after.

Everywhere else was already escaping properly; this was the one sink where the
library, not the app, decided how the string was interpreted.

*Covered by `test_security.mjs` — hostile names on all eight tabs, the results
map, and the preview sheet.*

### 2. `javascript:` URLs in links — **fixed**

`esc()` escapes `< > & " '`. It does nothing to `javascript:alert(1)`, which
contains none of them. A website URL from OSM's `extratags.website` therefore
went straight into an `href`, and tapping it would run script in the page.

Added `safeUrl()`: only `http:`, `https:`, `mailto:` and `tel:` survive;
bare domains and protocol-relative URLs are promoted to `https:`; everything
else renders nothing at all. Verified against real inputs:

```
javascript:alert(1)                 -> (no link rendered)
JaVaScRiPt:alert(1)                 -> (no link rendered)
data:text/html,<script>…            -> (no link rendered)
file:///etc/passwd                  -> (no link rendered)
https://example.com/ok              -> https://example.com/ok
www.example.com                     -> https://www.example.com
```

### 3. API keys in the backup file — **fixed**

The export existed to be moved around — saved to Drive, sent to a partner's
phone. It included `trip-settings-v1` wholesale, which holds `geminiKey` and
`googleKey`. One forwarded file and someone else spends your quota.

Keys are now stripped from the export, the Settings text says so, and a
restore deliberately keeps whatever key is already on the receiving device
rather than blanking it.

## Verification

- **22 browser suites, ~300 assertions**, run in CI before every APK build.
- **`test_security.mjs`** is new: hostile input on every screen, URL scheme
  handling, and the backup redaction.
- **A gap in my own tooling, found during this review.** The Android XML
  checker added after a previous build failure declared the manifest
  "well-formed" while it contained a comment inside an opening tag — a
  guaranteed Gradle failure. It only knew three specific mistakes and assumed
  a clean bill otherwise. Rewritten to walk the document structurally; it now
  catches that fault, unclosed tags, and mismatched nesting. Verified by
  breaking the manifest deliberately and confirming it fails.

  The lesson generalises: a checker that reports "all fine" for faults it was
  never taught is worse than no checker, because it buys false confidence.

## Operations

- **`android:allowBackup` was `true`** — Android auto-backup would copy
  `localStorage`, including the API keys, to the user's Google Drive, and
  `adb backup` could pull the same off an unlocked handset. Now `false`, with
  matching `data_extraction_rules.xml` for Android 12+. Trips move via the
  app's own Export, which no longer carries keys.
- **Permissions are minimal and justified**: `INTERNET`, plus coarse/fine
  location for "Where I am". No storage, camera, contacts or background
  location.
- **Transport**: every outbound call is HTTPS. No cleartext permitted, no
  network-security-config overrides.
- **Exported components**: only `MainActivity` (it has to be, to appear in the
  launcher and the share sheet). The FileProvider is `exported="false"`.
- **Share-intent input is treated as untrusted** and goes through the same
  escaping as everything else.

---

## Performance — measured, not guessed

Worst realistic case: 120 saved places across 6 days.

| Tab | Render | localStorage reads |
|---|---|---|
| Today | 5 ms | 13 |
| Overview | 45 ms | 42 |
| Itinerary | 21 ms | 9 |
| Places | 42 ms | 210 |
| Eats | 9 ms | 88 |
| Picks | 25 ms | 248 |
| Budget | 30 ms | 7 |
| Tips | 13 ms | 8 |

Everything is inside one animation frame, so nothing here is worth changing.
Storage is **19 KB against a ~5 MB budget** — three orders of magnitude of
headroom.

The 248 reads on Picks are real inefficiency: `loadPicks()` re-parses the JSON
on every call rather than caching per render. At 25 ms it is invisible, and
caching state mid-render is a classic source of stale-data bugs. **Deliberately
not fixed** — it is a measurement worth recording, not a problem worth risking
a regression over nine days before a trip.

Network behaviour is already careful: weather cached an hour and keyed to ~1 km
so a town shares one request, destination geocodes cached permanently,
type-ahead debounced at 280 ms with in-flight aborts, and a deliberate 1.1 s
gap between Nominatim calls to stay within what a free community service asks.

## What I did not do

- **No penetration testing of the APK itself** (no rooted device here).
- **Photon's live response shape is still unverified** — the build sandbox
  cannot reach it. Mitigated by treating an unexpected shape as a failure and
  falling back, rather than as "no such place".
- **The `?key=` query parameter** is how Google's own API expects the key, so
  it stays. It means the key appears in request URLs; over HTTPS that is not
  visible on the network, but it would appear in any proxy log the user's own
  network keeps. Worth knowing rather than worth changing.
- **Key restriction is the user's to do, not the app's.** An Android-restricted
  Gemini key is useless to anyone who extracts it. That is one setting in
  Google Cloud Console and it is the single highest-value thing left.
