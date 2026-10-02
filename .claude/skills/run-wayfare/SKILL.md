---
name: run-wayfare
description: Run, start, drive, screenshot or test the Wayfare trip app (Capacitor Android app whose UI is plain JS in www/). Use when asked to run the app, see a screen, take a screenshot, click something, reproduce a UI bug, or run its Playwright suites.
---

# Run Wayfare

Wayfare is a Capacitor Android app, but all of its behaviour is plain JS in `www/js/app.js`, served as static files. In this container it is driven as a web page in headless Chromium by `driver.mjs`. No emulator, no Android build, no display needed.

Paths below are relative to the repo root (the directory with `package.json`).

## Prerequisites
```bash
npm install          # playwright + eslint; Chromium is already at /opt/pw-browsers/chromium
```
Do not run `playwright install`; the driver and the tests point at the existing Chromium.

## Run (agent path)
The driver serves `www/` on a free port, seeds one trip ("Peak District", one saved place), opens a screen, prints the page text and saves a screenshot.
```bash
node .claude/skills/run-wayfare/driver.mjs events /tmp/events.png
node .claude/skills/run-wayfare/driver.mjs today  /tmp/today.png
node .claude/skills/run-wayfare/driver.mjs settings /tmp/settings.png
```
Screens: `today`, `plan`, `events` (What's on), `picks` (Saved), `more`, `settings` (a sheet).

Poke at it, then screenshot, with `--click` (CSS selector) and `--eval` (JS expression, result printed):
```bash
node .claude/skills/run-wayfare/driver.mjs events /tmp/handoff.png --click '#evHandoff' --eval "!!document.getElementById('handoffPrompt')"
```
Open the PNG with the Read tool and look at it; the printed text alone will not show a layout bug.

All requests to anything but the local server are aborted, so Gemini, the map servers and Wikipedia answer nothing. A search shows its failure state, not results. To test a search, write a Playwright suite that routes those hosts to fake responses; `tests/test_handoff_opens.mjs` and `tests/test_stream.mjs` are working examples.

## Test
```bash
fuser -k 8946/tcp 2>/dev/null; npm test     # lint, manifest + identity checks, then every suite (~7 min)
```
The suites expect the static server on port 8946:
```bash
(node tests/.shots/serve.mjs >/dev/null 2>&1 &); sleep 1
node tests/test_handoff_opens.mjs           # one suite, in seconds
```
New suites are added to `SUITES` in `tests/run-all.mjs`. Shared helpers (`goTo`, `openEventForm`) are in `tests/lib/screens.mjs`.

## Run (human path)
`npx cap sync android` then `cd android && ./gradlew assembleDebug` builds the APK (see README). Not done in this container: it needs the Android SDK, and nothing here needs it.

## Gotchas
- `window.__tripTest` is a test hook exposed by the app (`showView`, `eventResults`, `setEventKinds`, ...). Suites and the driver use it to reach screens and read state; look at its definition near the end of `www/js/app.js` before inventing a selector.
- Seed state through `localStorage` before the app reads it, then `page.reload()`. The keys that matter: `onboarded-v1` (skips the intro), `boards-v1`, `board:<id>:picks`, `trip-settings-v1`. Without `onboarded-v1` every screenshot is the intro.
- A port left over from an earlier run makes suites fail oddly or hit stale files: `fuser -k 8946/tcp` first.
- Never rename the identity strings (`com.livium888.scotlandtrip`, the `scotland-trip-*` storage keys, the `b-scotland` board id); `tests/check-identity.mjs` fails the build if they change.
- API keys never go in backups or the APK; `redactSecrets` in `app.js` is the list to extend when a new key setting is added.

## Troubleshooting
- `no way to reach "<name>"`: that is not a screen the driver knows. Use one of the names above, or `--click` a More row.
- Screenshot shows the intro: `onboarded-v1` was not set before the reload.
- `Executable doesn't exist ... chromium`: the driver found no `/opt/pw-browsers/chromium`; set `PLAYWRIGHT_BROWSERS_PATH` or pass `executablePath` as the suites do.
