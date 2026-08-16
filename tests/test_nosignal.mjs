// Phase 1: the app has to work where the trip actually goes.
//
// Four faults, all of them invisible in a browser on a desk and all of them
// certain on a phone in a glen.
//
// 1. One offline glance permanently blinded a place. `findPhoto` returned
//    null for "Wikipedia has no picture of this pub" and for "the request
//    never left the phone" alike, and `wantPhoto` wrote both down as
//    `photoChecked: true` and saved. Open Picks once with no signal and those
//    places never got a photograph again, on any network, ever.
//
// 2. Only the AI call had a timeout. Every other lookup was a bare fetch(),
//    which on half a bar does not fail - it waits, and the spinner waits with
//    it, and there is nothing on the screen to press.
//
// 3. A photograph already downloaded was thrown away: the <img> pointed at
//    upload.wikimedia.org, so a curated list went blank the moment the signal
//    did, which is the moment you are standing in front of the place.
//
// 4. The geocoder was asked the same question twice - a second wait, a second
//    helping of its rate limit, and no answer at all offline.
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

// A real 2x2 PNG, so an <img> genuinely loads it and fires onload.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
  'base64');

const browser = await chromium.launch(LAUNCH_OPTS);
const context = await browser.newContext();
const page = await context.newPage();
await page.setViewportSize({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });
await page.addInitScript(() => { localStorage.setItem('onboarded-v1', '1'); });

// --- What the network does, under our control ---
let wikiUp = false;         // is Wikipedia answering at all
let wikiCalls = 0;
let photoBytesServed = 0;
let nominatimCalls = 0;

await page.route(/en\.wikipedia\.org\/w\/api\.php/, (route) => {
  wikiCalls++;
  if (!wikiUp) return route.abort();
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    query: { pages: { 1: {
      title: 'Stirling Castle',
      thumbnail: { source: 'https://upload.wikimedia.org/stirling.png' },
      coordinates: [{ lat: 56.1237, lon: -3.9474 }],
    } } } }) });
});
await page.route(/upload\.wikimedia\.org/, (route) => {
  if (!wikiUp) return route.abort();
  photoBytesServed++;
  return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
});
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  nominatimCalls++;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
    lat: '56.1237', lon: '-3.9474', display_name: 'Stirling Castle, Stirling', type: 'castle',
    name: 'Stirling Castle', namedetails: { name: 'Stirling Castle' },
    address: { town: 'Stirling' }, extratags: {} }]) });
});
await page.route(/wikidata|overpass|open-meteo|photon|places\.googleapis|generativelanguage/, (r) => r.abort());
await page.route(/tile\./, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));

const seed = async () => {
  await page.evaluate(() => {
    localStorage.setItem('boards-v1', JSON.stringify({
      activeId: 'b-x', boards: [{ id: 'b-x', name: 'Trip', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }] }));
    localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Scotland', geminiKey: '', geminiModel: '' }));
    localStorage.setItem('board:b-x:folders', JSON.stringify(['Stirling']));
    localStorage.setItem('board:b-x:picks', JSON.stringify([
      { id: 'p1', name: 'Stirling Castle', city: 'Stirling', category: 'Castle', lat: 56.1237, lon: -3.9474, addedAt: 1 }]));
    localStorage.setItem('board:b-x:plan', JSON.stringify({ days: [], items: {} }));
  });
};

const openPicks = async () => {
  await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
  await page.waitForTimeout(600);
};

// ---------- 1. A lookup that failed is not an answer ----------

await page.goto(BASE, { waitUntil: 'load' });
await seed();
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);

// Wikipedia is unreachable. Look at the list, which is what triggers the
// photo lookup.
wikiUp = false;
await openPicks();
await page.waitForTimeout(2500);

const afterFailure = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('board:b-x:picks'))[0]);
check('a lookup that never got through is not written down as an answer',
  afterFailure.photoChecked !== true, JSON.stringify(afterFailure));
check('and no photo is invented from a failure',
  !afterFailure.photo, JSON.stringify(afterFailure));

// Signal comes back, the app is opened again, and it asks once more.
wikiUp = true;
const callsBefore = wikiCalls;
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);
await openPicks();
await page.waitForTimeout(3000);

check('so it asks again once there is signal', wikiCalls > callsBefore,
  `${callsBefore} -> ${wikiCalls}`);
const afterSuccess = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('board:b-x:picks'))[0]);
check('and the photograph finally arrives', !!afterSuccess.photo, JSON.stringify(afterSuccess));
check('now it is settled and will not be asked a third time',
  afterSuccess.photoChecked === true, JSON.stringify(afterSuccess));

// A genuine "there is no picture of this pub" is still remembered, or every
// list would re-ask for every place forever.
await page.evaluate(() => {
  const picks = JSON.parse(localStorage.getItem('board:b-x:picks'));
  picks.push({ id: 'p2', name: 'The Nameless Bar', city: 'Stirling', category: 'Pub',
    lat: 56.13, lon: -3.94, addedAt: 2 });
  localStorage.setItem('board:b-x:picks', JSON.stringify(picks));
});
await page.route(/en\.wikipedia\.org\/w\/api\.php/, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ query: { pages: {} } }) }));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);
await openPicks();
await page.waitForTimeout(3000);
check('a real "no picture exists" is still only asked once', await page.evaluate(() =>
  (JSON.parse(localStorage.getItem('board:b-x:picks')).find((p) => p.id === 'p2') || {}).photoChecked === true),
  await page.evaluate(() => localStorage.getItem('board:b-x:picks')));

// ---------- 2. A picture already paid for is kept ----------

await page.unroute(/en\.wikipedia\.org\/w\/api\.php/);
await page.route(/en\.wikipedia\.org\/w\/api\.php/, (route) => {
  wikiCalls++;
  if (!wikiUp) return route.abort();
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    query: { pages: { 1: { title: 'Stirling Castle',
      thumbnail: { source: 'https://upload.wikimedia.org/stirling.png' } } } } }) });
});

wikiUp = true;
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);
await openPicks();
await page.waitForTimeout(2000);
check('the picture is on screen while there is signal', await page.evaluate(() =>
  Array.from(document.querySelectorAll('.photo-thumb img, .photo-hero img'))
    .some((i) => i.complete && i.naturalWidth > 0)));

// Now the signal goes. The picture has already been downloaded once, so it is
// on the phone and there is no reason for the screen to go blank.
wikiUp = false;
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);
await openPicks();
await page.waitForTimeout(3000);
check('and it is still on screen once the signal has gone', await page.evaluate(() =>
  Array.from(document.querySelectorAll('.photo-thumb img, .photo-hero img'))
    .some((i) => i.complete && i.naturalWidth > 0)),
  await page.evaluate(() => document.querySelectorAll('.photo-thumb img').length + ' imgs, ' +
    document.querySelectorAll('.photo-failed').length + ' failed'));

// ---------- 3. A lookup that cannot be answered ends ----------

// A request nothing ever answers. Without a timeout this hangs forever and
// the promise below never settles.
await page.unroute(/nominatim\.openstreetmap\.org/);
await page.route(/nominatim\.openstreetmap\.org/, () => { /* never answered */ });

// Raced against a clock inside the page, because without the race a lookup
// that never ends means a test that never ends - which is the bug describing
// itself, but is no use as a result.
const hung = await page.evaluate(async () => {
  const started = Date.now();
  const gaveUp = window.__tripTest
    .geocodeCandidates('Somewhere Nobody Answers', 'Stirling', null)
    .then(() => 'answered', () => 'gave up');
  const stillGoing = new Promise((r) => setTimeout(() => r('hanging'), 20000));
  const outcome = await Promise.race([gaveUp, stillGoing]);
  return { outcome, ms: Date.now() - started };
});
check('a lookup nothing answers gives up instead of hanging',
  hung.outcome !== 'hanging', `${hung.outcome} after ${hung.ms}ms`);

// ---------- 4. The same question is not asked twice ----------

await page.unroute(/nominatim\.openstreetmap\.org/);
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  nominatimCalls++;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
    lat: '56.1237', lon: '-3.9474', display_name: 'Stirling Castle, Stirling', type: 'castle',
    namedetails: { name: 'Stirling Castle' }, address: { town: 'Stirling' }, extratags: {} }]) });
});

// The counter lives here in Node, in the route handler, so it counts requests
// that actually left the page rather than what the page says about itself.
const before = nominatimCalls;
await page.evaluate(() => window.__tripTest.geocodeCandidates('Stirling Castle', 'Stirling', null));
const afterFirst = nominatimCalls;
await page.evaluate(() => window.__tripTest.geocodeCandidates('Stirling Castle', 'Stirling', null));
const afterSecond = nominatimCalls;
check('the first ask goes to the network', afterFirst > before, `${before} -> ${afterFirst}`);
check('the second is answered from the phone', afterSecond === afterFirst, `${afterFirst} -> ${afterSecond}`);

// Which is the only reason the same question can be answered with no signal
// at all. The geocoder is taken away entirely rather than using setOffline,
// because a routed request is fulfilled by Playwright whether the context
// calls itself offline or not - so setOffline here would have proved nothing.
await page.unroute(/nominatim\.openstreetmap\.org/);
await page.route(/nominatim\.openstreetmap\.org/, (r) => r.abort());
const offlineAnswer = await page.evaluate(async () => {
  const list = await window.__tripTest.geocodeCandidates('Stirling Castle', 'Stirling', null)
    .catch(() => []);
  return list.length;
});
check('and it is still answered with the geocoder unreachable', offlineAnswer > 0, String(offlineAnswer));

// A question it has never been asked before still has no answer - the cache
// is a memory, not an invention.
const unknown = await page.evaluate(async () => {
  const list = await window.__tripTest.geocodeCandidates('A Place Never Looked Up', 'Stirling', null)
    .catch(() => []);
  return list.length;
});
check('but a question it has never been asked has no answer to give',
  unknown === 0, String(unknown));

// ---------- 5. The offline map covers the trip, not the first half of it ----------
//
// The trim was `wanted.slice(0, 2500)`, and tiles are generated z, then x,
// then y. So when a trip needed more tiles than the cap, what survived was
// street detail for the westernmost strip and nothing at all for the east -
// and the message said only that some detail had been left out, never which
// half. A trip that runs west to east got half a trip and no warning.

const trim = await page.evaluate(() => {
  // Two stops, far enough apart that a whole-country box blows the cap: one
  // on Skye in the west, one in Aberdeen in the east.
  const west = { lat: 57.27, lon: -6.22 };
  const east = { lat: 57.15, lon: -2.09 };
  const bounds = { north: 57.5, south: 56.9, east: -1.8, west: -6.5 };
  const kept = window.__tripTest.chooseTiles(bounds, [west, east], 600).kept;
  const near = (stop) => kept.filter((t) => {
    const n = Math.pow(2, t.z);
    const lon = ((t.x + 0.5) / n) * 360 - 180;
    return Math.abs(lon - stop.lon) < 0.5;
  }).length;
  return { total: kept.length, west: near(west), east: near(east) };
});
check('a capped download still covers the eastern stop', trim.east > 0, JSON.stringify(trim));
check('and the western one', trim.west > 0, JSON.stringify(trim));
// Neither end should be starved to feed the other. Within a factor of three
// is "both were served"; the old behaviour gave the east exactly nothing.
check('neither end is starved to feed the other',
  Math.min(trim.west, trim.east) * 3 >= Math.max(trim.west, trim.east), JSON.stringify(trim));

// And what it stored is reported as room on the phone, which is the thing
// being spent, rather than as a count of tiles, which means nothing to anyone.
check('the size of a download is reported in megabytes', await page.evaluate(() =>
  /MB/.test(window.__tripTest.formatBytes(3 * 1024 * 1024))));

// The stops it downloads around include the plan and the search area, not
// just saved places - a stop added to a day and never saved as a pick used to
// fall outside the map entirely.
const stopsSeen = await page.evaluate(() => {
  localStorage.setItem('board:b-x:plan', JSON.stringify({
    days: [{ id: 'd1', label: 'Day 1' }],
    items: { d1: [{ pickId: 'p1', time: '10:00' }] } }));
  localStorage.setItem('board:b-x:search-anchor', JSON.stringify({
    name: 'Oban', lat: 56.415, lon: -5.471, miles: 10 }));
  return window.__tripTest.offlineStops();
});
check('the area downloaded includes where you are searching',
  stopsSeen.some((s) => Math.abs(s.lat - 56.415) < 0.01), JSON.stringify(stopsSeen));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
