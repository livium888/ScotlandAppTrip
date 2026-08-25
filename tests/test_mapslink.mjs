// "Show in Google Maps" was opening a street near the place rather than the
// place. Blair Castle would come up as a point on the B8079.
//
// The cause was what got stored when a place was saved: OpenStreetMap answers
// with a full postal address, that address was kept as the thing to search
// Maps for, and Google resolves an address to an address. You get a spot on a
// road - no name, no hours, no reviews, a few hundred metres from the castle.
//
// A name search resolves to the listing instead. Where the coordinates are
// known the search is centred on them, using Google's own /@lat,lon,zoom form,
// so it finds that Tesco rather than a Tesco and lands on the building rather
// than near it.
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 820 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

// An attraction whose OSM address is a road with no number - the case that
// made this so obvious, since the address alone names nothing at all.
const CASTLE = {
  id: 'custom:Blair Castle', name: 'Blair Castle', city: 'Saved', category: 'Castle',
  lat: 56.7658, lon: -3.8489, addedAt: 1,
  address: 'B8079, Blair Atholl, Perth and Kinross, PH18 5TL',
  mapsQuery: 'B8079, Blair Atholl, Perth and Kinross, PH18 5TL',
};
// One shared from Google Maps, which carries Google's own id for the place.
const SHARED = {
  id: 'custom:Moulin Inn', name: 'Moulin Inn', city: 'Saved', category: 'Pub',
  lat: 56.7120, lon: -3.7290, addedAt: 2,
  address: '11-13 Kirkmichael Road, Moulin, Pitlochry, PH16 5EH',
  googleUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJmoulin',
};

await page.route(/nominatim|wikidata|wikipedia|overpass|tile\.|open-meteo|photon|generativelanguage|places\.googleapis/,
  (r) => r.abort());

const opened = [];
await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(([castle, shared]) => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-m', boards: [{ id: 'b-m', name: 'Maps', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }],
  }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Scotland' }));
  localStorage.setItem('board:b-m:folders', JSON.stringify(['Saved']));
  localStorage.setItem('board:b-m:picks', JSON.stringify([castle, shared]));
  localStorage.setItem('board:b-m:plan', JSON.stringify({
    days: [{ id: 'd1', label: 'Day 1 · Wed 19 Aug' }],
    items: { d1: [{ pickId: castle.id, time: '10:00' }] },
  }));
}, [CASTLE, SHARED]);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);

// Every outward link the app offers, wherever it offers it.
const linksOn = async (tab) => {
  await page.evaluate((t) => document.querySelector(`[data-view="${t}"]`).click(), tab);
  await page.waitForTimeout(500);
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-open-maps]')).map((e) => e.getAttribute('data-open-maps')));
};

const isAddressSearch = (url) =>
  /maps\/search/.test(url) && /PH18|B8079|Perth\s*(and|%20and%20)\s*Kinross/i.test(decodeURIComponent(url));

// ---------- The place sheet ----------

await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(400);
await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[data-open-pick]'));
  (rows.find((r) => /Blair Castle/.test(r.textContent)) || rows[0]).click();
});
await page.waitForSelector('#placeModal.open');
await page.waitForTimeout(400);

const sheetLinks = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#placeModal [data-open-maps]')).map((e) => e.getAttribute('data-open-maps')));
const sheetMaps = sheetLinks.find((u) => /google\.com\/maps/.test(u)) || '';
check('the sheet offers a Maps link', !!sheetMaps, JSON.stringify(sheetLinks));
check('it searches for the place by name, not for its address',
  /Blair%20Castle|Blair\+Castle/.test(sheetMaps) && !isAddressSearch(sheetMaps), sheetMaps);
check('and centres the search on its coordinates so it finds that one',
  /@56\.7658,-3\.8489/.test(sheetMaps), sheetMaps);
// Nothing but the name: the coordinates have already said which one, so a
// locality added here could only pull the search somewhere else.
check('and nothing from the address rides along with it',
  !/B8079|PH18|Perth/i.test(decodeURIComponent(sheetMaps)), decodeURIComponent(sheetMaps));
await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());
await page.waitForTimeout(300);

// ---------- The itinerary and Today, which is where this was noticed ----------

for (const tab of ['itinerary', 'today']) {
  const links = await linksOn(tab);
  const maps = links.filter((u) => /google\.com\/maps/.test(u));
  check(`${tab} links to the place, not the street`,
    maps.length > 0 && !maps.some(isAddressSearch), JSON.stringify(maps.map(decodeURIComponent)));
  check(`${tab} navigates to the exact coordinates`,
    maps.some((u) => /maps\/dir/.test(u) ? /destination=56\.7658,-3\.8489/.test(u) : /@56\.7658,-3\.8489/.test(u)),
    JSON.stringify(maps));
}

// ---------- A place shared from Google Maps keeps Google's own id ----------

await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(400);
await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[data-open-pick]'));
  (rows.find((r) => /Moulin/.test(r.textContent)) || rows[0]).click();
});
await page.waitForSelector('#placeModal.open');
await page.waitForTimeout(400);
const sharedLinks = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#placeModal [data-open-maps]')).map((e) => e.getAttribute('data-open-maps')));
check('an exact id from Google beats any search we could build',
  sharedLinks.some((u) => /place_id:ChIJmoulin/.test(u)), JSON.stringify(sharedLinks));
await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());

// ---------- Sharing the trip with someone else ----------
// The shared text carries a link per stop, and it was carrying the address
// search too.

const shared = await page.evaluate(async () => {
  let captured = '';
  const origClipboard = navigator.clipboard;
  const origShare = navigator.share;
  navigator.share = undefined;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (t) => { captured = t; return Promise.resolve(); } },
  });
  document.querySelector('[data-view="itinerary"]').click();
  await new Promise((r) => setTimeout(r, 500));
  const btn = document.getElementById('shareTrip');
  if (btn) btn.click();
  await new Promise((r) => setTimeout(r, 600));
  navigator.share = origShare;
  if (origClipboard) Object.defineProperty(navigator, 'clipboard', { configurable: true, value: origClipboard });
  return captured;
});
// The else branch used to pass unconditionally, so a share that stopped
// firing altogether would have read as a pass. Not capturing the share is
// itself a failure - there is nothing to check the links in.
check('a shared plan links to the places, not their streets',
  !!shared && !/B8079|PH18/.test(decodeURIComponent(shared)),
  shared ? decodeURIComponent(shared).slice(0, 240) : 'no share was captured');

// ---------- A place saved before any of this, with only an address ----------
// No area was stored then, so the town has to come back out of the address -
// and the street must not.

await page.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('board:b-m:picks'));
  list.push({ id: 'custom:Old One', name: 'The Old One', city: 'Saved', category: 'Cafe',
    lat: null, lon: null, addedAt: 3,
    address: '4, Atholl Road, Pitlochry, PH16 5BX',
    mapsQuery: '4, Atholl Road, Pitlochry, PH16 5BX' });
  localStorage.setItem('board:b-m:picks', JSON.stringify(list));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(400);
await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[data-open-pick]'));
  (rows.find((r) => /Old One/.test(r.textContent)) || rows[0]).click();
});
await page.waitForSelector('#placeModal.open');
await page.waitForTimeout(400);
const oldLink = decodeURIComponent(await page.evaluate(() => {
  const links = Array.from(document.querySelectorAll('#placeModal [data-open-maps]'))
    .map((e) => e.getAttribute('data-open-maps'));
  return links.find((u) => /google\.com\/maps/.test(u)) || '';
}));
check('a place saved before the town was stored is still searched by name',
  /The Old One/.test(oldLink), oldLink);
check('with the town recovered from its address',
  /Pitlochry/.test(oldLink), oldLink);
check('and the street left out of it',
  !/Atholl Road/.test(oldLink) && !/PH16/.test(oldLink), oldLink);

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
