// "It used to search live and add things as it found them; now it waits and
// waits and at the end you might have results, you might have zero."
//
// It still streamed - one search at a time - but most searches now are one
// kind (films, theatre, a children's session), and a single search showed
// nothing until Gemini had written its whole answer, which with searching
// enforced can be a minute or more. Now the answer is streamed: each listing
// appears by name the moment Gemini finishes writing it, marked as being
// checked, and every search says what stage it is at and for how long.
// Nothing becomes a result until the search is confirmed as a real one.
import { chromium } from 'playwright';
import { goTo, openEventForm } from './lib/screens.mjs';
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

// Gemini, writing slowly. A real stream: the page's fetch gets a body that
// arrives a piece at a time, in the server-sent-events format Gemini uses.
// window.__stream.searched decides whether the last piece says it searched.
await page.addInitScript((d) => {
  const real = window.fetch.bind(window);
  window.__stream = { searched: true, urls: [] };
  const item = (name) => ({ name, date: d, time: '11:00', venue: 'Town Hall', area: 'Bakewell',
    what: 'A {braced} "quoted" thing.', price: '£', childFocus: 'aimed' });
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (!u.includes(':streamGenerateContent')) return real(url, opts);
    window.__stream.urls.push(u);
    const searched = window.__stream.searched;
    const a = JSON.stringify(item('Puppet Show'));
    const b = JSON.stringify(item('Storytime at the Library'));
    const text = `[${a}, ${b}]`;
    const cut1 = text.indexOf(a) + a.length + 1; // after the first object and its comma
    const cut2 = cut1 + 12; // part-way into the second
    const chunk = (t, extra) => `data: ${JSON.stringify(Object.assign({ candidates: [Object.assign({ content: { parts: [{ text: t }] } }, extra || {})] }))}\n\n`;
    const pieces = [
      chunk(text.slice(0, cut1)),
      chunk(text.slice(cut1, cut2)),
      chunk(text.slice(cut2), searched ? { groundingMetadata: { webSearchQueries: ['on in bakewell'],
        groundingChunks: [{ web: { uri: 'https://bakewell.example/on', title: 'On' } }] } } : {}),
    ];
    const enc = new TextEncoder();
    let i = 0;
    const body = new ReadableStream({
      async pull(controller) {
        if (i >= pieces.length) return controller.close();
        await new Promise((r) => setTimeout(r, i === 0 ? 400 : 2500));
        controller.enqueue(enc.encode(pieces[i++]));
      },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
}, day);

await page.route(/generativelanguage\.googleapis\.com/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ models: [
    { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }] }) }));
await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify([{ lat: '53.2129', lon: '-1.6753', display_name: 'Bakewell', type: 'town',
    namedetails: { name: 'Bakewell' }, address: { town: 'Bakewell' }, extratags: {} }]) }));
await page.route(/overpass/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ elements: [] }) }));
await page.route(/wikidata|wikipedia|googleapis\.com\/maps|tile\.|photon|open-meteo/, (r) => r.abort());

const seed = async () => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('onboarded-v1', '1');
    localStorage.setItem('boards-v1', JSON.stringify({
      activeId: 'b', boards: [{ id: 'b', name: 'Peak', destination: 'Bakewell', dated: true, createdAt: 1 }] }));
    localStorage.setItem('board:b:picks', JSON.stringify([
      { id: 'a:1', name: 'Bakewell', city: 'Bakewell', category: 'Town', lat: 53.2129, lon: -1.6753, major: true }]));
    localStorage.setItem('board:b:folders', JSON.stringify(['Bakewell']));
    localStorage.setItem('trip-settings-v1', JSON.stringify({ geminiKey: 'k', mode: 'kids', geminiModel: 'models/gemini-3.5-flash-lite' }));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(500);
};
const live = () => page.evaluate(() => (document.querySelector('.ev-live-list') || {}).textContent?.replace(/\s+/g, ' ') || '');
const results = () => page.evaluate(() => (window.__tripTest.eventResults || []).map((e) => e.name).sort());
const start = async () => {
  await goTo(page, 'events', 400);
  await page.evaluate(() => window.__tripTest.setEventKinds(['workshops']));
  await openEventForm(page);
  await page.evaluate(() => document.getElementById('evSearch').click());
};

// ---------- Reading an answer that is only half written ----------
await seed();
check('a half-written answer yields the listings finished so far, braces in strings and all',
  JSON.stringify(await page.evaluate(() => window.__tripTest.partialListings(
    '[{"name":"A {x}","what":"say \\"}\\""},{"name":"B"},{"name":"C, still wri'
  ).map((x) => x.name))) === JSON.stringify(['A {x}', 'B']));

// ---------- Watching one search ----------
await start();
await page.waitForTimeout(250);
check('straight away it says it is searching the web', /Searching the web/.test(await live()), await live());
await page.waitForFunction(() => /found so far/.test(document.querySelector('.ev-live-list')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
check('the first listing appears by name as soon as it is written', /1 found so far/.test(await live()) && /Puppet Show/.test(await live()),
  await live());
check('marked as still being checked', /being checked/.test(await live()));
check('and not yet a result - nothing is one until the search is confirmed', (await results()).length === 0, JSON.stringify(await results()));
check('it was streamed, not fetched in one piece', await page.evaluate(() => window.__stream.urls.some((u) => /streamGenerateContent\?alt=sse/.test(u))));
const s1 = await page.evaluate(() => document.querySelector('[data-live-started]')?.textContent);
await page.waitForTimeout(2200);
const s2 = await page.evaluate(() => document.querySelector('[data-live-started]')?.textContent);
check('and the seconds keep counting, so a slow search visibly is a search', s1 && s2 && parseInt(s2, 10) > parseInt(s1, 10), `${s1} -> ${s2}`);
await page.waitForFunction(() => (window.__tripTest.eventResults || []).length >= 2, null, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(800);
check('when it finishes and has searched, both become results',
  JSON.stringify(await results()) === JSON.stringify(['Puppet Show', 'Storytime at the Library']), JSON.stringify(await results()));
check('and the live lines are gone', (await live()) === '', await live());

// ---------- Watching one that turns out not to have searched ----------
await seed();
await page.evaluate(() => { window.__stream.searched = false; });
await start();
await page.waitForFunction(() => /answered from memory/.test(document.getElementById('view').textContent), null, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(500);
check('when the answer turns out not to have been searched, the names it wrote are cleared',
  (await results()).length === 0 && !/being checked/.test(await live()), JSON.stringify(await results()));
check('and the screen says why, with a way to try again', /answered from memory/.test(await page.evaluate(() =>
  document.getElementById('view').textContent)) && await page.evaluate(() => !!document.querySelector('[data-ev-retry]')));
check('without a second request behind your back', await page.evaluate(() => window.__stream.urls.length === 1),
  String(await page.evaluate(() => window.__stream.urls.length)));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
