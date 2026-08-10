import { chromium } from 'playwright';

// Use the sandbox's prebuilt browser when present, otherwise let Playwright
// resolve its own download (which is what CI has).
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);

// ---------- 1. Key test surfaces a real Google error ----------
{
  const page = await browser.newPage();
  page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });
  await page.route(/generativelanguage\.googleapis\.com/, (route) =>
    route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({
      error: { code: 403, status: 'PERMISSION_DENIED',
        message: 'Generative Language API has not been used in project 12345 before or it is disabled.',
        details: [{ reason: 'SERVICE_DISABLED' }] },
    }) }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.click('#settingsBtn');
  await page.waitForSelector('#setGeminiKey');
  await page.fill('#setGeminiKey', 'BAD-KEY');
  await page.click('#testGeminiBtn');
  await page.waitForTimeout(700);
  const out = await page.evaluate(() => {
    const el = document.getElementById('geminiTestResult');
    return { text: el.textContent, cls: el.className, hidden: el.hidden };
  });
  check('test button shows result', !out.hidden && out.text.length > 10, JSON.stringify(out).slice(0,150));
  check('SERVICE_DISABLED explained in plain terms', /isn't enabled/i.test(out.text), out.text.slice(0, 160));
  check('raw Google message included', /has not been used in project/.test(out.text));
  check('styled as an error', /bad/.test(out.cls), out.cls);
  await page.close();
}

// ---------- 2. Invalid key message ----------
{
  const page = await browser.newPage();
  await page.route(/generativelanguage\.googleapis\.com/, (route) =>
    route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({
      error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' },
    }) }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.click('#settingsBtn');
  await page.waitForSelector('#setGeminiKey');
  await page.fill('#setGeminiKey', 'NOPE');
  await page.click('#testGeminiBtn');
  await page.waitForTimeout(700);
  const text = await page.evaluate(() => document.getElementById('geminiTestResult').textContent);
  check('invalid key explained, incl. Maps-key confusion', /API_KEY_INVALID/.test(text) && /Maps\/Places key/.test(text), text.slice(0, 160));
  await page.close();
}

// ---------- 3. Model discovery + success ----------
{
  const page = await browser.newPage();
  page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });
  let listCalls = 0; let genPath = '';
  await page.route(/generativelanguage\.googleapis\.com/, (route) => {
    const u = route.request().url();
    if (/\/models\?/.test(u)) {
      listCalls++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [
        { name: 'models/gemini-pro-legacy', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embed-only', supportedGenerationMethods: ['embedContent'] },
      ] }) });
    }
    genPath = u;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) });
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.click('#settingsBtn');
  await page.waitForSelector('#setGeminiKey');
  await page.fill('#setGeminiKey', 'GOOD-KEY');
  await page.click('#testGeminiBtn');
  await page.waitForTimeout(900);
  const out = await page.evaluate(() => {
    const el = document.getElementById('geminiTestResult');
    return { text: el.textContent, cls: el.className };
  });
  check('success reported', /Working/.test(out.text) && /ok/.test(out.cls), JSON.stringify(out).slice(0,160));
  check('preferred flash model chosen', /2\.5-flash/.test(out.text), out.text);
  check('generateContent used the discovered model', /gemini-2\.5-flash:generateContent/.test(genPath), genPath.slice(0, 120));
  check('embed-only model excluded', !/embed-only/.test(genPath));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('trip-settings-v1')).geminiModel);
  check('model cached in settings', /2\.5-flash/.test(saved || ''), saved);
  await page.close();
}

// ---------- 4. Explore by location + category ----------
{
  const page = await browser.newPage();
  page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });
  await page.route(/nominatim\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
      lat: '55.9486', lon: '-3.1999', display_name: 'Edinburgh Castle, Edinburgh', type: 'castle',
      namedetails: { name: 'Edinburgh Castle' }, address: { city: 'Edinburgh' }, extratags: {},
    }]) }));
  await page.route(/overpass/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements: [
      { type: 'node', lat: 55.9490, lon: -3.1990, tags: { name: 'Castle Cafe', opening_hours: '9-5' } },
      { type: 'node', lat: 55.9600, lon: -3.2100, tags: { name: 'Far Cafe' } },
    ] }) }));
  await page.route(/wikidata|wikipedia/, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ search: [] }) }));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
  await page.waitForSelector('#exploreToggle');
  check('Explore section present in Picks', true);

  await page.click('#exploreToggle');
  await page.waitForSelector('#exploreSearchForm');
  await page.fill('#exploreSearchInput', 'Edinburgh Castle');
  await page.evaluate(() => document.getElementById('exploreSearchForm').requestSubmit());
  await page.waitForTimeout(700);

  const centreText = await page.evaluate(() => document.getElementById('view').textContent);
  check('centre set from search', /Around\s*Edinburgh Castle/.test(centreText.replace(/\s+/g,' ')), centreText.slice(0, 200));

  // Categories live behind one button now rather than a sideways-scrolling
  // row, so everything is visible at once when you go looking.
  await page.click('#exploreCatBtn');
  await page.waitForSelector('[data-choose-cat]', { timeout: 3000 });
  const cats = await page.evaluate(() => Array.from(document.querySelectorAll('[data-choose-cat]')).map(b => b.getAttribute('data-choose-cat')));
  check('categories include restaurant/cafe/playground/museum/attraction', ['restaurant','cafe','playground','museum','attraction'].every(k => cats.includes(k)), JSON.stringify(cats));

  await page.evaluate(() => document.querySelector('[data-choose-cat="cafe"]').click());
  await page.waitForSelector('#exploreRunBtn:not([disabled])', { timeout: 3000 });
  await page.click('#exploreRunBtn');
  await page.waitForTimeout(700);
  const resText = await page.evaluate(() => document.getElementById('view').textContent);
  check('results listed', /Castle Cafe/.test(resText), resText.slice(0, 250));
  check('distance shown in miles, not kilometres', /yd away|mi away|🚗/.test(resText), resText.slice(0, 250));

  // add one
  await page.evaluate(() => document.querySelector('[data-explore-add]').click());
  // Adding now saves immediately - no folder question to answer.
  await page.waitForTimeout(900);
  const picks = await page.evaluate(() => JSON.parse(localStorage.getItem('board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':picks') || '[]'));
  check('explore result can be saved', picks.some(p => p.name === 'Castle Cafe'), JSON.stringify(picks.map(p=>p.name)));
  await page.close();
}

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
