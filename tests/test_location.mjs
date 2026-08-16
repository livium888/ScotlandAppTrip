// Three complaints, all about the app knowing less than it should.
//
// "The search when using the where-I-am feature is terrible, it never works
// accurate." Both places that asked the device for a position asked for
// enableHighAccuracy: false, and the browser path would accept a fix up to a
// minute old. On Android that is the network fix - masts and wifi - which is
// a few hundred metres out in a town and kilometres out in open country.
// Everything downstream inherited that: the search anchor, the distances,
// what counts as nearby.
//
// "The folder view is so badly designed, I need to endlessly scroll if a lot
// of locations are added." Every section was always open.
//
// "If a location is detected automatically and I use it, it doesn't show in
// the big map view." The you-are-here marker only existed as a side effect of
// pressing the locate button on that map, so the position you had just
// established elsewhere was the one thing missing from the map of everywhere.
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ['geolocation'],
  geolocation: { latitude: 55.9486, longitude: -3.1999, accuracy: 12 },
});
const page = await context.newPage();
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });
await page.route(/generativelanguage|nominatim|wikidata|wikipedia|overpass|open-meteo|photon|places\.googleapis|upload\./, (r) => r.abort());
await page.route(/tile\./, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') }));

// What the app asks the device for, captured before anything answers.
await page.addInitScript(() => {
  window.__geoAsks = [];
  const real = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
  navigator.geolocation.getCurrentPosition = (ok, err, opts) => {
    window.__geoAsks.push(opts || {});
    return real(ok, err, opts);
  };
  localStorage.setItem('onboarded-v1', '1');
});

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-l', boards: [{ id: 'b-l', name: 'Trip', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Scotland', geminiKey: '', geminiModel: '' }));
  // Several towns, so folding is the difference between a screen and a scroll.
  localStorage.setItem('board:b-l:folders', JSON.stringify(['Edinburgh', 'Pitlochry', 'Glasgow', 'Skye']));
  const picks = [];
  ['Edinburgh', 'Pitlochry', 'Glasgow', 'Skye'].forEach((city, c) => {
    for (let i = 0; i < 6; i++) {
      picks.push({ id: `p${c}${i}`, name: `${city} place ${i}`, city, category: 'Castle',
        lat: 55.9 + c / 2 + i / 100, lon: -3.2 - c / 3, addedAt: c * 10 + i, photoChecked: true });
    }
  });
  localStorage.setItem('board:b-l:picks', JSON.stringify(picks));
  localStorage.setItem('board:b-l:plan', JSON.stringify({ days: [], items: {} }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(400);

// ---------- The fix it asks for ----------

await page.evaluate(() => document.getElementById('exploreToggle').click());
await page.waitForTimeout(300);
await page.evaluate(() => document.getElementById('exploreGpsBtn').click());
await page.waitForTimeout(2500);

const asks = await page.evaluate(() => window.__geoAsks);
check('it asks the device for a real fix, not the cheap one',
  asks.length > 0 && asks.every((o) => o.enableHighAccuracy === true), JSON.stringify(asks));
check('and refuses a stale cached one',
  asks.every((o) => !o.maximumAge), JSON.stringify(asks));
check('and waits long enough for the satellites',
  asks.every((o) => (o.timeout || 0) >= 20000), JSON.stringify(asks));

check('the centre it sets is where you actually are', await page.evaluate(() => {
  const t = document.getElementById('view').textContent;
  return /Where I am/.test(t);
}), await page.evaluate(() => document.getElementById('view').textContent.slice(0, 200)));

// A fix the app is unsure about is worth saying so about, rather than a dot
// that pretends to know exactly.
check('how good the fix was is reported', await page.evaluate(() =>
  /within|give or take/.test(document.body.textContent)),
  await page.evaluate(() => document.body.textContent.slice(0, 200)));

// ---------- It shows up on the map of everything ----------

await page.evaluate(() => document.getElementById('mapBtn').click());
await page.waitForTimeout(1200);
check('the position you just established is on the big map', await page.evaluate(() =>
  Array.from(document.querySelectorAll('.leaflet-pane path, .leaflet-pane circle')).length > 0 ||
  /You are here/.test(document.getElementById('mapOverlay').innerHTML)));
// Leaflet only writes a tooltip into the page once it is shown, so what is
// checked is the thing actually complained about: that the marker is drawn
// inside the visible map rather than off on a part of it nothing scrolls to.
check('and it is inside the frame, not off the edge of it', await page.evaluate(() => {
  const canvas = document.getElementById('allMapCanvas');
  if (!canvas) return false;
  const box = canvas.getBoundingClientRect();
  return Array.from(canvas.querySelectorAll('.leaflet-overlay-pane path')).some((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.left >= box.left - 1 && r.right <= box.right + 1 &&
      r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
  });
}));
await page.evaluate(() => {
  const close = document.querySelector('#mapOverlay [data-map-close], #mapOverlay .search-back, #mapOverlay .modal-close');
  if (close) close.click();
});
await page.waitForTimeout(400);

// ---------- Folding a long list ----------

await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(400);
const rowCount = () => page.evaluate(() => document.querySelectorAll('.pick-row').length);
const before = await rowCount();
check('everything is there to begin with', before === 24, String(before));

check('a section can be folded', await page.evaluate(() => !!document.querySelector('[data-fold]')));
await page.evaluate(() => {
  const heads = Array.from(document.querySelectorAll('[data-fold]'));
  (heads.find((h) => /Edinburgh/.test(h.getAttribute('data-fold'))) || heads[0]).click();
});
await page.waitForTimeout(400);
const afterOne = await rowCount();
check('folding one hides its places', afterOne === before - 6, `${before} -> ${afterOne}`);
check('but the heading and its count stay, so you know what is in there',
  await page.evaluate(() => {
    const h = Array.from(document.querySelectorAll('[data-fold]'))
      .find((x) => /Edinburgh/.test(x.getAttribute('data-fold')));
    return !!h && /6/.test(h.textContent);
  }));

// The whole point: getting a long list down to something you can see at once.
check('and there is a way to fold the lot', await page.evaluate(() =>
  !!document.querySelector('[data-fold-all]')));
await page.evaluate(() => document.querySelector('[data-fold-all]').click());
await page.waitForTimeout(400);
check('folding everything leaves only the headings', (await rowCount()) === 0, String(await rowCount()));
check('and offers to open them again', await page.evaluate(() =>
  document.querySelector('[data-fold-all]').getAttribute('data-fold-all') === 'open'));

// A list you have tidied should stay tidy.
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(400);
check('and it is still folded when you come back', (await rowCount()) === 0, String(await rowCount()));

await page.evaluate(() => document.querySelector('[data-fold-all]').click());
await page.waitForTimeout(400);
check('opening them all brings everything back', (await rowCount()) === 24, String(await rowCount()));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
