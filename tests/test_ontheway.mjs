// Finding things along a drive, not around a dot.
//
// Every search in the app was "within N miles of one point", which is the
// wrong shape for the question people actually ask on a long drive: we are
// going from here to there, what is worth stopping for on the way? Answering
// that with a circle means either a circle so small it misses most of the
// route or one so large it is mostly places in the wrong direction.
//
// Deliberately no routing service. The app already decided this once - the
// walking-time comment says straight-line-plus-a-detour-factor because it
// needs no key and works offline - and a corridor between two points finds
// the towns on the way perfectly well, since towns are where the roads are.
// What it cannot do is follow a road around a firth, and the app says so
// rather than pretending.
import { chromium } from 'playwright';
import { goTo, openEventForm } from './lib/screens.mjs';
import { angleFromPrompt } from './lib/angles.mjs';
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

const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);

// Edinburgh to Perth, roughly north. Four places: three strung along the way
// and one out west in Glasgow that has no business in the answer.
const PLACES = {
  'Edinburgh': { lat: 55.9533, lon: -3.1883 },
  'South Queensferry': { lat: 55.9903, lon: -3.3985 },
  'Kinross': { lat: 56.2000, lon: -3.4167 },
  'Perth': { lat: 56.3950, lon: -3.4308 },
  'Glasgow': { lat: 55.8642, lon: -4.2518 },
};

let prompts = [];
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  const p = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text;
  prompts.push(p);
  const angle = angleFromPrompt(p);
  // One angle answers, with four events: three on the way and one well off it.
  const list = angle === 'market'
    ? [
        { name: 'Perth Farmers Market', date: day, time: '09:00', venue: 'King Edward Street', area: 'Perth', what: 'Stalls.', price: 'free' },
        { name: 'Queensferry Producers', date: day, time: '10:00', venue: 'High Street', area: 'South Queensferry', what: 'Stalls.', price: 'free' },
        { name: 'Kinross Country Market', date: day, time: '10:00', venue: 'Town Hall', area: 'Kinross', what: 'Stalls.', price: 'free' },
        { name: 'Glasgow Green Market', date: day, time: '10:00', venue: 'Glasgow Green', area: 'Glasgow', what: 'Stalls.', price: 'free' },
      ]
    : [];
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(list) }] } }] }) });
});

// Geocoding: every place resolves to its real coordinates.
await page.route(/nominatim/, (route) => {
  const url = decodeURIComponent(route.request().url());
  // Only the q= parameter, and the longest name in it. scopedQuery appends
  // the trip's region, so a lookup for "Glasgow Green" carries "Edinburgh"
  // in the URL too - matching anywhere in the string put Glasgow's market in
  // Edinburgh and made the corridor test look broken when the mock was.
  const q = (url.match(/[?&]q=([^&]*)/) || [])[1] || '';
  const hit = Object.keys(PLACES)
    .filter((n) => q.includes(n))
    // Earliest in the query, not longest: "Glasgow Green, Edinburgh" is a
    // question about Glasgow, and "Edinburgh" is merely the region the app
    // appends. Longest-wins put Glasgow's market in Edinburgh.
    .sort((a, b) => q.indexOf(a) - q.indexOf(b))[0];
  const p = hit ? PLACES[hit] : null;
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(p ? [{
    lat: String(p.lat), lon: String(p.lon), display_name: hit, type: 'town',
    namedetails: { name: hit }, address: { town: hit }, extratags: {},
  }] : []) });
});
// Photon, for the two route fields.
await page.route(/photon\.komoot\.io/, (route) => {
  const url = decodeURIComponent(route.request().url());
  const hit = Object.keys(PLACES).find((n) => url.toLowerCase().includes(n.toLowerCase().slice(0, 5)));
  const p = hit ? PLACES[hit] : null;
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ features: p ? [{
    geometry: { coordinates: [p.lon, p.lat] },
    properties: { name: hit, state: 'Scotland', country: 'Scotland', osm_value: 'town' },
  }] : [] }) });
});
// The villages Overpass would name along the corridor.
// settlementsNear drops anything without coordinates, so a mock without them
// silently returns nothing - which looks exactly like Overpass being down.
await page.route(/overpass/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ elements: [
    { lat: 56.2000, lon: -3.4167, tags: { name: 'Kinross', place: 'town' } },
    { lat: 56.2100, lon: -3.4000, tags: { name: 'Milnathort', place: 'town' } },
    { lat: 55.9903, lon: -3.3985, tags: { name: 'South Queensferry', place: 'town' } },
  ] }) }));
await page.route(/wikidata|wikipedia|googleapis\.com\/maps|tile\./, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b', boards: [{ id: 'b', name: 'Scotland', destination: 'Edinburgh', dated: true, createdAt: 1 }],
  }));
  localStorage.setItem('board:b:picks', JSON.stringify([
    { id: 'a:1', name: 'Edinburgh', city: 'Edinburgh', category: 'Town', lat: 55.9533, lon: -3.1883, major: true },
  ]));
  localStorage.setItem('board:b:folders', JSON.stringify(['Edinburgh']));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ geminiKey: 'test-key' }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(700);
await goTo(page, 'events', 400);
await openEventForm(page);

const countOf = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
const txt = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
const tap = async (sel) => {
  const hit = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
  await page.waitForTimeout(350);
  return hit;
};

// ---------- Getting into route mode ----------
check('there is a way to search along a route rather than around a point',
  await countOf('[data-ev-mode="route"]') === 1);
await tap('[data-ev-mode="route"]');
check('choosing it offers a start and an end', await countOf('#evRouteFrom') === 1 && await countOf('#evRouteTo') === 1,
  `from:${await countOf('#evRouteFrom')} to:${await countOf('#evRouteTo')}`);
check('and how far off the route you will go', await countOf('[data-ev-corridor]') >= 3);

// ---------- Setting the two ends ----------
await page.evaluate(() => {
  window.__tripTest.setEventRoute(
    { name: 'Edinburgh', lat: 55.9533, lon: -3.1883 },
    { name: 'Perth', lat: 56.3950, lon: -3.4308 }
  );
});
await page.waitForTimeout(400);
check('the panel says where you are going', /edinburgh/i.test(await txt()) && /perth/i.test(await txt()),
  (await txt()).slice(0, 220));

// ---------- Searching along it ----------
prompts = [];
await tap('#evSearch');
await page.waitForFunction(() => !/Looking|Searching/i.test(document.getElementById('view').textContent),
  { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1200);

const marketPrompt = prompts.find((p) => angleFromPrompt(p) === 'market') || prompts[0] || '';
check('the model is told this is a journey, not a circle',
  /on the way|along the|route|between/i.test(marketPrompt), marketPrompt.slice(0, 240));
check('and both ends are named', /edinburgh/i.test(marketPrompt) && /perth/i.test(marketPrompt),
  marketPrompt.slice(0, 240));
check('and the towns it passes through are listed',
  /kinross|milnathort|queensferry/i.test(marketPrompt), marketPrompt.slice(0, 400));

// ---------- The answers, in the order you will meet them ----------
const order = await page.evaluate(() => {
  const t = document.getElementById('view').textContent;
  return {
    q: t.indexOf('Queensferry Producers'),
    k: t.indexOf('Kinross Country Market'),
    p: t.indexOf('Perth Farmers Market'),
    g: t.indexOf('Glasgow Green Market'),
  };
});
check('something on the route is shown at all', order.k >= 0, JSON.stringify(order));
check('they come in the order you would drive past them',
  order.q >= 0 && order.k >= 0 && order.p >= 0 && order.q < order.k && order.k < order.p,
  JSON.stringify(order));
check('and somewhere in the wrong direction is left out', order.g === -1, JSON.stringify(order));
check('the one left out is accounted for, not silently binned',
  /off the route|not on the way|left out|1 /i.test(await txt()), (await txt()).slice(0, 400));
check('each stop says how far off the road it is',
  /off the route|detour|mile/i.test(await txt()), (await txt()).slice(0, 300));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
