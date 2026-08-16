// Four things that only matter once you have actually left the flat.
//
// Today flagged the first stop of the day as NEXT no matter what time it was,
// and listed stops in the order they were added rather than the order you walk
// them. Nothing said when the phone had no signal, so each feature failed in
// its own words. Nothing said when the plan had last been backed up, though it
// lives only in this phone's localStorage. And every map went grey without a
// connection, which is where a map is worth most.
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

// A 1x1 PNG, which is all a tile has to be for these purposes.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const browser = await chromium.launch(LAUNCH_OPTS);
const context = await browser.newContext();
const page = await context.newPage();
await page.setViewportSize({ width: 390, height: 820 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

let tileRequests = 0;
await page.route(/tile\.openstreetmap\.org/, (route) => {
  tileRequests++;
  route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
});
await page.route(/nominatim|wikidata|wikipedia|overpass|googleapis|open-meteo|photon/, (r) => r.abort());

// Today's date, in the label format the app parses ("Day 1 · Tue 11 Aug").
const now = new Date();
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const todayLabel = `Day 1 · ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(({ todayLabel }) => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-o', boards: [{ id: 'b-o', name: 'Offline', destination: 'Edinburgh', dated: true, hasGuide: false, createdAt: 1 }],
  }));
  localStorage.setItem('board:b-o:folders', JSON.stringify(['Edinburgh']));
  localStorage.setItem('board:b-o:picks', JSON.stringify([
    { id: 'custom:Castle', name: 'Edinburgh Castle', city: 'Edinburgh', category: 'Castle', lat: 55.9486, lon: -3.1999, addedAt: 1 },
    { id: 'custom:Zoo', name: 'Edinburgh Zoo', city: 'Edinburgh', category: 'Zoo', lat: 55.9426, lon: -3.2686, addedAt: 2 },
    { id: 'custom:Museum', name: 'National Museum', city: 'Edinburgh', category: 'Museum', lat: 55.9469, lon: -3.1903, addedAt: 3 },
  ]));
  // Added in one order, to be walked in another - and one typed the way a
  // thumb types it rather than the way a parser likes it.
  localStorage.setItem('board:b-o:plan', JSON.stringify({
    days: [{ id: 'd1', label: todayLabel }],
    items: { d1: [
      { pickId: 'custom:Zoo', time: '17:00' },
      { pickId: 'custom:Castle', time: '9.30' },
      { pickId: 'custom:Museum', time: '13:00' },
    ] },
  }));
}, { todayLabel });
await page.reload({ waitUntil: 'load' });
await page.evaluate(() => document.querySelector('[data-view="today"]').click());
await page.waitForTimeout(600);

// ---------- The day reads in the order you walk it ----------

const order = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.today-name')).map((e) => e.textContent.trim()));
check('the day is in time order, not the order things were added',
  JSON.stringify(order) === JSON.stringify(['Edinburgh Castle', 'National Museum', 'Edinburgh Zoo']),
  JSON.stringify(order));

const times = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.today-time')).map((e) => e.textContent.trim()));
check('"9.30" is understood and shown as 09:30', times[0] === '09:30', JSON.stringify(times));

// ---------- NEXT is the stop that is actually next ----------

// Worked out independently, by the same rule, so this holds whatever time the
// suite happens to run at.
const minsNow = now.getHours() * 60 + now.getMinutes();
const planned = [{ n: 'Edinburgh Castle', m: 9 * 60 + 30 }, { n: 'National Museum', m: 13 * 60 }, { n: 'Edinburgh Zoo', m: 17 * 60 }];
const expected = planned.find((x) => x.m + 60 >= minsNow);

const flagged = await page.evaluate(() => {
  const card = document.querySelector('.today-card.next');
  return card ? card.querySelector('.today-name').textContent.trim() : null;
});
check('NEXT points at the stop the clock says is next',
  expected ? flagged === expected.n : flagged === null,
  `now ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')} — expected ${expected ? expected.n : 'none'}, got ${flagged}`);

const doneCount = await page.evaluate(() => document.querySelectorAll('.today-card.done').length);
const expectedDone = expected ? planned.indexOf(expected) : planned.length;
check('and stops already behind you are dimmed, not competing', doneCount === expectedDone,
  `${doneCount} dimmed, expected ${expectedDone}`);

// A day that is not today has no "now" to compare against, so the first stop
// is the next one by definition.
await page.evaluate(() => {
  const plan = JSON.parse(localStorage.getItem('board:b-o:plan'));
  plan.days = [{ id: 'd1', label: 'Day 1 · Fri 25 Dec' }];
  localStorage.setItem('board:b-o:plan', JSON.stringify(plan));
});
await page.reload({ waitUntil: 'load' });
await page.evaluate(() => document.querySelector('[data-view="today"]').click());
await page.waitForTimeout(500);
check('on another day, the first stop is the next one', await page.evaluate(() => {
  const card = document.querySelector('.today-card.next');
  return !!card && /Edinburgh Castle/.test(card.textContent);
}));
check('and nothing is dimmed on a day that has not started', await page.evaluate(() =>
  document.querySelectorAll('.today-card.done').length === 0));

// ---------- Tiles are kept, so a map still draws without signal ----------

await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(400);
tileRequests = 0;
await page.evaluate(() => document.getElementById('mapBtn').click());
await page.waitForTimeout(2500);
check('a map fetches tiles when it can', tileRequests > 0, String(tileRequests));
const cached = await page.evaluate(() => new Promise((resolve) => {
  // No version pinned: the store this asks about is the tiles one, and
  // pinning a number here meant the test broke the day photos and geocoder
  // answers moved into the same database - which is a fact about the app's
  // storage, not about whether a map works offline.
  const req = indexedDB.open('trip-tiles-v1');
  req.onsuccess = () => {
    const c = req.result.transaction('tiles', 'readonly').objectStore('tiles').count();
    c.onsuccess = () => resolve(c.result);
    c.onerror = () => resolve(-1);
  };
  req.onerror = () => resolve(-1);
}));
check('and keeps them on the device', cached > 0, String(cached));

// Now take the network away entirely - not just the tile server - and open the
// same map again.
await page.evaluate(() => document.querySelector('.map-close, [data-map-close]') && document.querySelector('.map-close, [data-map-close]').click());
await page.waitForTimeout(400);
await context.setOffline(true);
await page.evaluate(() => window.dispatchEvent(new Event('offline')));
await page.waitForTimeout(400);

check('the app says so, once, rather than failing four different ways', await page.evaluate(() =>
  !document.getElementById('appBanner').hidden && /No connection/.test(document.getElementById('appBanner').textContent)),
  await page.evaluate(() => document.getElementById('appBanner').textContent));
check('and says what still works', await page.evaluate(() =>
  /places, plan and notes all still work/.test(document.getElementById('appBanner').textContent)));

await page.evaluate(() => document.getElementById('mapBtn').click());
await page.waitForTimeout(2000);
const drawn = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.leaflet-tile')).filter((t) => t.complete && t.naturalWidth > 0).length);
check('the map still draws from what was kept', drawn > 0, `${drawn} tiles drawn offline`);

await context.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('.map-close, [data-map-close]') && document.querySelector('.map-close, [data-map-close]').click());
await page.waitForTimeout(400);

// ---------- The backup nudge ----------

check('an un-backed-up plan says so', await page.evaluate(() =>
  !document.getElementById('appBanner').hidden && /Never backed up/.test(document.getElementById('appBanner').textContent)),
  await page.evaluate(() => document.getElementById('appBanner').textContent));
check('and offers to do it there and then', await page.evaluate(() => !!document.getElementById('bannerBackup')));

const download = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
await page.evaluate(() => document.getElementById('bannerBackup').click());
const file = await download;
check('backing up produces a file', !!file, file ? file.suggestedFilename() : 'no download');
await page.waitForTimeout(600);
check('and the nudge goes away once it is done', await page.evaluate(() =>
  document.getElementById('appBanner').hidden || !/Never backed up/.test(document.getElementById('appBanner').textContent)),
  await page.evaluate(() => document.getElementById('appBanner').textContent));
check('the date is remembered', await page.evaluate(() =>
  !!JSON.parse(localStorage.getItem('last-backup-at-v1') || 'null')));

// ---------- Downloading the trip's area ----------

await page.evaluate(() => document.getElementById('settingsBtn').click());
await page.waitForSelector('#downloadTilesBtn', { timeout: 4000 });
check('Settings offers the map area for the trip', await page.evaluate(() =>
  !!document.getElementById('downloadTilesBtn')));
// Megabytes, not a tile count: room on the phone is the thing being spent,
// and "2,500 map tiles" tells nobody whether that is a lot.
check('and says what is already stored', /(MB of map stored on this phone|No map area stored yet)/.test(
  await page.evaluate(() => document.getElementById('tileCount').textContent)),
  await page.evaluate(() => document.getElementById('tileCount').textContent));

const before = tileRequests;
await page.evaluate(() => document.getElementById('downloadTilesBtn').click());
await page.waitForTimeout(2500);
check('downloading actually fetches tiles', tileRequests > before, `${tileRequests - before} fetched`);
check('and can be stopped', await page.evaluate(() =>
  /Stop/.test(document.getElementById('downloadTilesBtn').textContent)));
await page.evaluate(() => document.getElementById('downloadTilesBtn').click());
await page.waitForTimeout(2500);
check('stopping keeps what came down', /Stopped|Saved/.test(
  await page.evaluate(() => document.getElementById('tileResult').textContent)),
  await page.evaluate(() => document.getElementById('tileResult').textContent));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
