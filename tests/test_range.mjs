// Miles, and searching far enough out that you'd drive there. Widening the
// radius isn't just a bigger number: the free OpenStreetMap fallback can't
// answer a 50-mile query, the "is this suggestion plausible" guard stops
// guarding, walking legs turn into nonsense, and Google gets sent a walking
// route between towns. All of that is checked here.
import { chromium } from 'playwright';
import { openExplore } from './lib/screens.mjs';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

// The panel's own search field is gone: there is one search, at the top of the
// screen, and its results carry "🧭 around here". This is that route.
const centreOn = async (query) => {
  await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
  await page.waitForTimeout(250);
  await page.evaluate(() => document.getElementById('pickSearchTrigger').click());
  await page.waitForSelector('#pickSearchInput');
  await page.fill('#pickSearchInput', query);
  await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
  await page.waitForSelector('[data-around-candidate]', { timeout: 10000 });
  await page.evaluate(() => document.querySelector('[data-around-candidate]').click());
  await page.waitForSelector('#exploreRunBtn', { timeout: 8000 });
  await page.waitForTimeout(300);
};

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 820 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

let prompt = '';
let overpassQueries = [];

await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  const url = route.request().url();
  if (/\/models\?/.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  prompt = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify([
      // Worth the drive, with a rating the model claims to have found.
      { name: 'Loch Lomond Shores', area: 'Balloch', why: 'Lochside, easy parking, plenty for a small child.',
        rating: 4.3, ratingCount: 5200, price: '££', booking: false },
      // A rating that isn't a rating, and must not be shown as one.
      { name: 'Doune Castle', area: 'Doune', why: 'Compact castle, quick to walk round.', rating: 'lovely' },
      // Far outside even a 50-mile radius: must be dropped, not shown.
      { name: 'Land\'s End', area: 'Cornwall', why: 'Should be filtered out.', rating: 4.0 },
    ]) }] } }],
  }) });
});

await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const url = decodeURIComponent(route.request().url());
  let body;
  if (/Loch Lomond/.test(url)) {
    body = [{ lat: '56.0022', lon: '-4.5830', display_name: 'Loch Lomond Shores, Balloch', type: 'attraction',
      namedetails: { name: 'Loch Lomond Shores' }, address: { city: 'Balloch' }, extratags: {} }];
  } else if (/Doune/.test(url)) {
    body = [{ lat: '56.1856', lon: '-4.0510', display_name: 'Doune Castle, Doune', type: 'castle',
      namedetails: { name: 'Doune Castle' }, address: { village: 'Doune' }, extratags: {} }];
  } else if (/Land/.test(url)) {
    body = [{ lat: '50.0657', lon: '-5.7132', display_name: "Land's End, Cornwall", type: 'attraction',
      namedetails: { name: "Land's End" }, address: { county: 'Cornwall' }, extratags: {} }];
  } else {
    body = [{ lat: '55.9533', lon: '-3.1883', display_name: 'Edinburgh, Scotland', type: 'city',
      namedetails: { name: 'Edinburgh' }, address: { city: 'Edinburgh' }, extratags: {} }];
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await page.route(/overpass/, (route) => {
  overpassQueries.push(route.request().postData() || '');
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements: [
    { type: 'node', lat: 55.9540, lon: -3.1890, tags: { name: 'Nearby Cafe' } },
  ] }) });
});
await page.route(/wikidata|wikipedia|open-meteo|photon|tile\./, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite',
    travellers: 'family of 3, 4-year-old who walks',
  }));
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-r', boards: [{ id: 'b-r', name: 'Roaming', destination: 'Edinburgh', dated: true, hasGuide: false, createdAt: 1 }],
  }));
  // Two stops an hour apart by car - the case that used to read "690 min walk".
  localStorage.setItem('board:b-r:picks', JSON.stringify([
    { id: 'custom:Edinburgh Castle', name: 'Edinburgh Castle', city: 'Edinburgh', lat: 55.9486, lon: -3.1999 },
    { id: 'custom:Stirling Castle', name: 'Stirling Castle', city: 'Stirling', lat: 56.1239, lon: -3.9478 },
    { id: 'custom:Camera Obscura', name: 'Camera Obscura', city: 'Edinburgh', lat: 55.9489, lon: -3.1953 },
  ]));
  localStorage.setItem('board:b-r:plan', JSON.stringify({
    days: [{ id: 'd1', label: 'Day 1' }],
    items: { d1: [
      { pickId: 'custom:Edinburgh Castle', time: '10:00' },
      { pickId: 'custom:Camera Obscura', time: '12:00' },
      { pickId: 'custom:Stirling Castle', time: '15:00' },
    ] },
  }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);

// --- Everything is in miles ---
await page.evaluate(() => document.querySelector('[data-view="itinerary"]').click());
await page.waitForTimeout(500);
const itin = await page.evaluate(() => document.getElementById('view').textContent);
check('no kilometres anywhere in the plan', !/\bkm\b/.test(itin), itin.slice(0, 300));
check('short hops stay walking, in yards or miles', /🚶/.test(itin) && /(yd|mi)\b/.test(itin), itin.slice(0, 300));

// --- A long leg is a drive, not an eleven-hour walk ---
check('the long leg is shown as a drive', /🚗/.test(itin), itin.slice(0, 400));
check('and in hours, not hundreds of minutes', /🚗\s*\d+ h/.test(itin.replace(/\s+/g, ' ')), itin.slice(0, 400));
check('no absurd walking time survives', !/🚶\s*\d{3,} min/.test(itin.replace(/\s+/g, ' ')), itin.slice(0, 400));

// Today's "Directions" for a driven leg asks Google for driving.
await page.evaluate(() => document.querySelector('[data-view="today"]').click());
await page.waitForTimeout(500);
const driveBtn = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('[data-open-maps]'))
    .find((x) => /travelmode=driving/.test(x.getAttribute('data-open-maps')));
  return b ? { label: b.textContent.trim(), url: b.getAttribute('data-open-maps') } : null;
});
check('a driven stop offers driving directions', !!driveBtn, JSON.stringify(driveBtn));
check('and says so on the button', driveBtn && /Drive there/.test(driveBtn.label), driveBtn && driveBtn.label);

// The whole-day route on the map follows the same rule.
await page.click('#mapBtn');
await page.waitForSelector('#allMapGoogle', { timeout: 3000 });
await page.evaluate(() => { window.open = (url) => { window.__opened = url; }; });
await page.evaluate(() => document.getElementById('allMapGoogle').click());
await page.waitForTimeout(200);
check('a day spanning towns routes by car', /travelmode=driving/.test(await page.evaluate(() => window.__opened) || ''),
  await page.evaluate(() => window.__opened));
await page.evaluate(() => document.querySelector('[data-mappick-close], [data-map-close]').click());
await page.waitForTimeout(300);

// --- The radius goes to 50 miles, and stays where you put it ---
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await openExplore(page);
await centreOn('Edinburgh');
await page.waitForSelector('#exploreRadius', { timeout: 5000 });

const options = await page.evaluate(() => Array.from(document.querySelectorAll('#exploreRadius option')).map((o) => o.textContent.trim()));
check('the radius is offered in miles', options.every((o) => /mile/.test(o)), JSON.stringify(options));
check('and goes up to 50', options.some((o) => /^50 miles$/.test(o)), JSON.stringify(options));
check('with walking distances still available', options.some((o) => /½ mile/.test(o)), JSON.stringify(options));

await page.selectOption('#exploreRadius', { label: '50 miles' });
await page.waitForTimeout(400);
check('the choice is remembered, not reset', await page.evaluate(() =>
  Number(JSON.parse(localStorage.getItem('explore-radius-v1'))) > 70000));

await page.reload({ waitUntil: 'load' });
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await openExplore(page);
await centreOn('Edinburgh');
await page.waitForSelector('#exploreRadius', { timeout: 5000 });
check('still 50 miles after restarting the app', await page.evaluate(() =>
  document.querySelector('#exploreRadius').selectedOptions[0].textContent.trim() === '50 miles'));

// --- At range, the AI is told it's a drive ---
await page.click('#exploreCatBtn');
await page.waitForSelector('[data-choose-cat="attraction"]');
await page.evaluate(() => document.querySelector('[data-choose-cat="attraction"]').click());
await page.waitForSelector('#exploreRunBtn:not([disabled])', { timeout: 3000 });
await page.click('#exploreRunBtn');
await page.waitForFunction(() => !/Looking for/.test(document.getElementById('view').textContent), { timeout: 25000 });
await page.waitForTimeout(400);

check('the radius reaches the model in miles', /50 miles/.test(prompt), prompt.slice(0, 200));
check('and it knows this is a drive', /drive, not a walk/.test(prompt), prompt.slice(0, 400));
check('so it is asked for places worth the journey', /worth the journey/.test(prompt), prompt.slice(0, 400));
check('a rating is asked for but never invented', /Do not invent a rating/.test(prompt), prompt.slice(-200));

const results = await page.evaluate(() => document.getElementById('view').textContent);
check('somewhere an hour away is offered', /Loch Lomond Shores/.test(results), results.slice(0, 400));
check('and shown as a drive with a time', /🚗/.test(results), results.slice(0, 400));
check('Cornwall is still filtered out at 50 miles', !/Land's End/.test(results), results.slice(0, 400));

// --- Ratings: shown, but never dressed up as verified ---
check('the AI rating is shown', /4\.3/.test(results), results.slice(0, 400));
check('marked as approximate, not a measured score', await page.evaluate(() =>
  !!document.querySelector('.ai-rating')));
check('with the review count for context', /5,200/.test(results), results.slice(0, 400));
check('a rating that is not a number is dropped', !/lovely/.test(results), results.slice(0, 400));

// --- The free fallback is capped, and says so ---
overpassQueries = [];
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('trip-settings-v1'));
  s.geminiKey = '';
  localStorage.setItem('trip-settings-v1', JSON.stringify(s));
});
await page.click('#exploreCatBtn');
await page.waitForSelector('[data-choose-cat="cafe"]');
await page.evaluate(() => document.querySelector('[data-choose-cat="cafe"]').click());
await page.waitForSelector('#exploreRunBtn:not([disabled])', { timeout: 3000 });
await page.click('#exploreRunBtn');
await page.waitForFunction(() => !/Looking for/.test(document.getElementById('view').textContent), { timeout: 25000 });
await page.waitForTimeout(400);

const around = (overpassQueries[0] || '').match(/around:(\d+)/);
check('OpenStreetMap is not asked for 50 miles', around && Number(around[1]) <= 17000, JSON.stringify(around && around[1]));
check('and the narrower search is admitted, not hidden', /can't answer a wider one/.test(
  await page.evaluate(() => document.getElementById('view').textContent)));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
