// "Is it possible to get Google Maps points for the event?"
//
// Two separate things, and only one of them costs anything.
//
// The free one: an event had no map link at all. And the app's existing rule
// for building one is wrong for events - pickMapsQuery returns the pick's
// NAME, which for a place is exactly right and for an event is "Toddler
// Storytime", which is on no map anywhere. The thing you want to walk to is
// the library it is in.
//
// The paid one: events are placed during a search by the free OSM lookup,
// which is a gazetteer of mapped features and knows a castle far better than
// it knows a village hall - hence all the "approx. location" tags. Google
// Places does know the hall, but is billed per request, and nine angles of
// twenty events would be a hundred and eighty requests for one search. So it
// is asked once, for one venue, when you open or save that event.
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });
await page.addInitScript(() => { localStorage.setItem('onboarded-v1', '1'); });
await page.route(/wikidata|wikipedia|overpass|tile\.|photon|open-meteo|generativelanguage/, (r) => r.abort());
await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

let placesCalls = 0;
let placesQueries = [];
let placesFinds = true;
await page.route(/places\.googleapis\.com/, async (route) => {
  placesCalls++;
  placesQueries.push(JSON.parse(route.request().postData() || '{}').textQuery || '');
  if (!placesFinds) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ places: [] }) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ places: [{
    id: 'ChIJvillagehall', displayName: { text: 'Bakewell Village Hall' },
    formattedAddress: 'Church St, Bakewell DE45 1FE',
    location: { latitude: 53.2140, lonPlaceholder: 0, longitude: -1.6760 },
    primaryTypeDisplayName: { text: 'Community centre' },
    websiteUri: 'https://example.com/hall', nationalPhoneNumber: '01629 000000',
    rating: 4.6, userRatingCount: 40,
  }] }) });
});

const eventPick = (extra) => Object.assign({
  id: 'custom:Coffee Morning', name: 'Coffee Morning', kind: 'event',
  startsAt: new Date(Date.now() + 2 * 86400000).toISOString(), time: '10:00',
  venue: 'Village Hall', area: 'Bakewell', city: 'Bakewell',
  lat: 53.2129, lon: -1.6753, approximate: true, addedAt: 1, unverified: true,
}, extra || {});

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate((pick) => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-m', boards: [{ id: 'b-m', name: 'Trip', destination: 'Peak District', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Peak District', googleKey: 'GKEY' }));
  localStorage.setItem('board:b-m:picks', JSON.stringify([pick]));
  localStorage.setItem('board:b-m:plan', JSON.stringify({ days: [], items: {} }));
}, eventPick());
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

const openEvents = async () => {
  await page.evaluate(() => document.querySelector('[data-view="events"]').click());
  await page.waitForTimeout(400);
};
const saved = () => page.evaluate(() =>
  JSON.parse(localStorage.getItem('board:b-m:picks')).find((p) => p.kind === 'event'));

// ---------- The free half: a link that points at the venue ----------

await openEvents();
const mapsHref = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.ev-row [data-open-maps]'))
    .map((b) => b.getAttribute('data-open-maps'))
    .find((h) => /google\.com\/maps/.test(h)) || '');
check('an event row offers a map link at all', !!mapsHref, mapsHref);
// The bug this half exists for: a place's name is the right search, an
// event's is not.
check('and it looks for the venue, not the name of the event',
  /Village\+?%?2?0?Hall|Village%20Hall|Village\+Hall/.test(decodeURIComponent(mapsHref).replace(/ /g, '+')) ||
  /Village Hall/.test(decodeURIComponent(mapsHref)), decodeURIComponent(mapsHref));
check('and never for the event, which is on no map anywhere',
  !/Coffee%20Morning|Coffee\+Morning/.test(mapsHref) && !/Coffee Morning/.test(decodeURIComponent(mapsHref)),
  decodeURIComponent(mapsHref));
// With coordinates known, Google's centred form lands on the building.
check('centred on where it already thinks the event is',
  /@53\.2/.test(mapsHref), mapsHref);
check('and asking for a link costs no requests', placesCalls === 0, `${placesCalls} calls`);

// ---------- The paid half: one lookup, when you open it ----------

await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForSelector('#placeModal.open');
await page.waitForTimeout(900);
check('opening the event looks the venue up once', placesCalls === 1, `${placesCalls} calls`);
check('asking for the venue and the town', /Village Hall, Bakewell/.test(placesQueries[0] || ''), JSON.stringify(placesQueries));

const refined = await saved();
check('the pin becomes the exact one Google has',
  refined.lat === 53.214 && refined.lon === -1.676, JSON.stringify([refined.lat, refined.lon]));
// A row that says "approx. location" after being pinned exactly is lying.
check('and stops calling itself approximate', !refined.approximate, JSON.stringify(refined.approximate));
check("it keeps Google's own id for the place",
  /place_id:ChIJvillagehall/.test(refined.googleUrl || ''), refined.googleUrl);
check('and picks up what Places knows about the venue',
  refined.phone === '01629 000000' && /example\.com\/hall/.test(refined.website || '') && refined.rating === 4.6,
  JSON.stringify([refined.phone, refined.website, refined.rating]));

await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());
await page.waitForTimeout(300);
await openEvents();
const exactHref = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.ev-row [data-open-maps]'))
    .map((b) => b.getAttribute('data-open-maps'))
    .find((h) => /google\.com\/maps/.test(h)) || '');
// An id addresses the exact place; a name search can land on the wrong one.
check('the link becomes the exact place rather than a search',
  /place_id:ChIJvillagehall/.test(exactHref), exactHref);

// ---------- Once, not once per open ----------

await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForSelector('#placeModal.open');
await page.waitForTimeout(700);
check('opening it again costs nothing', placesCalls === 1, `${placesCalls} calls`);

// ---------- A venue Places has never heard of ----------

placesFinds = false;
placesCalls = 0;
await page.evaluate((pick) => {
  localStorage.setItem('board:b-m:picks', JSON.stringify([pick]));
}, eventPick({ id: 'custom:Nowhere Fair', name: 'Nowhere Fair', venue: 'The Old Barn' }));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);
await openEvents();
await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForSelector('#placeModal.open');
await page.waitForTimeout(900);
const missed = await saved();
check('a venue Places cannot find is asked about once', placesCalls === 1, `${placesCalls} calls`);
// Marked either way, or every open would be another request for an answer
// that is not coming.
check('and marked so it is not asked again', missed.venueChecked === true, JSON.stringify(missed.venueChecked));
check('while keeping the approximate pin it already had, honestly labelled',
  missed.approximate === true && missed.lat === 53.2129, JSON.stringify([missed.approximate, missed.lat]));

await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());
await page.waitForTimeout(200);
await openEvents();
await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForTimeout(700);
check('really not asked again', placesCalls === 1, `${placesCalls} calls`);

// ---------- With no Google key at all ----------

placesCalls = 0;
await page.evaluate((pick) => {
  localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Peak District', googleKey: '' }));
  localStorage.setItem('board:b-m:picks', JSON.stringify([pick]));
}, eventPick({ id: 'custom:No Key Fair', name: 'No Key Fair' }));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);
await openEvents();
const freeHref = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.ev-row [data-open-maps]'))
    .map((b) => b.getAttribute('data-open-maps'))
    .find((h) => /google\.com\/maps/.test(h)) || '');
// The free half has to work on its own: most people will not have a Places key.
check('the map link still works with no Places key', !!freeHref, freeHref);
await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForSelector('#placeModal.open');
await page.waitForTimeout(700);
check('and nothing is asked for', placesCalls === 0, `${placesCalls} calls`);

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
