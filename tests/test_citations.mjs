// Trust the citations, not the configuration.
//
// A grounded search is the only thing standing between "what's on this
// weekend" and a fluent invention with a plausible village hall and a
// real-looking date. The app asks for grounding - and then trusts that it
// got it, which is a different thing.
//
// Two ways that trust was misplaced, both found by looking rather than
// guessing:
//
// 1. askOneAngle tries grounded first and falls back to a plain JSON call to
//    the same model. That fallback exists because a grounded reply is prose
//    with citations and sometimes will not parse - a real problem. But the
//    retry is ungrounded, so whenever the first attempt fails to parse, the
//    app quietly accepts an answer nothing looked up, and shows it exactly
//    like one that was.
//
// 2. A provider declaring itself able to search might be misconfigured, might
//    be a model that ignored its search tool, or might be an endpoint whose
//    behaviour was recalled rather than tested. A config flag cannot know.
//
// Citations are the evidence. No citations, no claim that it was checked.
// The app already has this idea for pasted events; this applies it to
// everything.
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
// Whether the mock cites anything. Flipping this is the whole experiment.
let cite = true;

await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  const p = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text;
  const angle = angleFromPrompt(p);
  const list = angle === 'market'
    ? [{ name: 'Bakewell Farmers Market', date: day, time: '09:00', venue: 'Market Place',
        area: 'Bakewell', what: 'Stalls.', price: 'free' }]
    : [];
  const cand = { content: { parts: [{ text: JSON.stringify(list) }] } };
  if (cite) cand.groundingMetadata = { groundingChunks: [{ web: { uri: 'https://bakewell.example/whats-on', title: 'Bakewell what’s on' } }] };
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [cand] }) });
});
await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify([{ lat: '53.2129', lon: '-1.6753', display_name: 'Bakewell', type: 'town',
    namedetails: { name: 'Bakewell' }, address: { town: 'Bakewell' }, extratags: {} }]) }));
await page.route(/overpass/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ elements: [] }) }));
await page.route(/wikidata|wikipedia|googleapis\.com\/maps|tile\.|photon/, (r) => r.abort());

const run = async () => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('boards-v1', JSON.stringify({
      activeId: 'b', boards: [{ id: 'b', name: 'Peak', destination: 'Bakewell', dated: true, createdAt: 1 }],
    }));
    localStorage.setItem('board:b:picks', JSON.stringify([
      { id: 'a:1', name: 'Bakewell', city: 'Bakewell', category: 'Town', lat: 53.2129, lon: -1.6753, major: true },
    ]));
    localStorage.setItem('board:b:folders', JSON.stringify(['Bakewell']));
    localStorage.setItem('trip-settings-v1', JSON.stringify({ geminiKey: 'k' }));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
  await goTo(page, 'events', 400);
  await openEventForm(page);
  await page.evaluate(() => document.getElementById('evSearch').click());
  // Waiting for "Looking" to disappear raced the render that puts it there:
  // the check ran before the search had started and passed instantly, then
  // read a screen with no results on it. Wait for the results themselves.
  await page.waitForFunction(
    () => (window.__tripTest.eventResults || []).length > 0,
    { timeout: 30000 }
  ).catch(() => {});
  // And then for the search to actually finish. Asserting while nine angles
  // are still reporting means reading a screen that is being rebuilt under
  // the assertion.
  await page.waitForFunction(
    () => !window.__tripTest.eventsBusy || !window.__tripTest.eventsBusy(),
    { timeout: 30000 }
  ).catch(() => {});
  await page.waitForTimeout(600);
};

const txt = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
const results = () => page.evaluate(() =>
  (window.__tripTest.eventResults || []).map((e) => ({ n: e.name, unsourced: !!e.unsourced, src: (e.sources || []).length })));

// ---------- With citations: business as usual ----------
cite = true;
await run();
let r = await results();
check('a cited answer produces events', r.length >= 1, JSON.stringify(r));
// "unverified" already exists and means something weaker - an AI suggested
// this, check it is on - and it is set on every AI event regardless. This is
// the stronger claim: nothing was looked up, so there is no page to point at.
check('and they are not marked unsourced', r.every((x) => !x.unsourced), JSON.stringify(r));
check('and nothing warns about checking', !/couldn.t be checked|nothing was looked up/i.test(await txt()),
  (await txt()).slice(0, 200));

// ---------- Without citations: the same answer, a different claim ----------
cite = false;
await run();
r = await results();
check('an uncited answer still shows what it found', r.length >= 1, JSON.stringify(r));
check('but every one of them is marked unsourced', r.length >= 1 && r.every((x) => x.unsourced),
  JSON.stringify(r));
check('the screen says so, rather than leaving it to be noticed',
  /was looked up|no source|not checked/i.test(await txt()),
  (await txt()).slice(0, 400));
check('and the rows themselves carry the mark, not just a note at the top',
  await page.evaluate(() => [...document.querySelectorAll('.ev-row')].some((r) =>
    /unchecked|not checked|no source/i.test(r.textContent || ''))),
  await page.evaluate(() => [...document.querySelectorAll('.ev-row')].map((r) => (r.textContent || '').replace(/\s+/g, ' ').slice(0, 90)).join(' || ') || 'no ev-row at all'));

// ---------- The mark survives being saved ----------
await page.evaluate(() => {
  const b = document.querySelector('[data-save-event]');
  if (b) b.click();
});
await page.waitForTimeout(600);
const saved = await page.evaluate(() => {
  const id = JSON.parse(localStorage.getItem('boards-v1')).activeId;
  return JSON.parse(localStorage.getItem('board:' + id + ':picks') || '[]')
    .filter((p) => /Farmers Market/.test(p.name || ''))
    .map((p) => ({ n: p.name, unsourced: !!p.unsourced }));
});
check('saving one keeps the fact that it was never checked',
  saved.length === 1 && saved[0].unsourced, JSON.stringify(saved));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
