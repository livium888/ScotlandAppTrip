// First round after the architecture review: the cheap, high-value fixes.
//
//  - Pinch-zoom was switched off (user-scalable=no), which locks out anyone
//    who needs larger text (WCAG 1.4.4).
//  - No Content-Security-Policy, in an app that renders text from
//    OpenStreetMap, Wikipedia and a language model. Escaping is the first
//    defence; this is the second, so one missed escape is not a script.
//    The two inline onload/onerror handlers on photos had to go for it.
//  - The Gemini key rode in the URL (?key=), where logs and referrers keep
//    URLs. It goes in a header now.
//  - The saved-places search box lost its focus ring.
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
const problems = [];
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });
page.on('console', (m) => { if (/Content Security Policy|violates the following/i.test(m.text())) problems.push(m.text().slice(0, 200)); });
await page.addInitScript(() => { localStorage.setItem('onboarded-v1', '1'); });

const geminiCalls = [];
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  geminiCalls.push({ url: route.request().url(), headers: route.request().headers() });
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    models: [{ name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
});
await page.route(/wikidata|wikipedia|tile\.|photon|open-meteo|places\.googleapis|nominatim|overpass/, (r) => r.abort());
// A picture that exists and one that does not.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
await page.route(/\/__pic\/ok\.png/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
await page.route(/\/__pic\/missing\.png/, (r) => r.fulfill({ status: 404, body: '' }));

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate((b) => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b', boards: [{ id: 'b', name: 'Trip', destination: 'Bakewell', dated: true, createdAt: 1 }] }));
  localStorage.setItem('board:b:picks', JSON.stringify([
    { id: 'p:1', name: 'Has a picture', city: 'Bakewell', category: 'Museum', lat: 53.21, lon: -1.67, photo: `${b}/__pic/ok.png` },
    { id: 'p:2', name: 'No such picture', city: 'Bakewell', category: 'Museum', lat: 53.22, lon: -1.68, photo: `${b}/__pic/missing.png` },
    // The find box only appears once there is enough saved to need it.
    ...Array.from({ length: 8 }, (_, i) => ({ id: `p:f${i}`, name: `Place ${i}`, city: 'Bakewell', category: 'Walk', lat: 53.2 + i / 100, lon: -1.7 }))]));
  localStorage.setItem('board:b:folders', JSON.stringify(['Bakewell']));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Bakewell', geminiKey: 'SECRET-KEY-123' }));
}, BASE);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

// ---------- Zoom ----------
const viewport = await page.evaluate(() => document.querySelector('meta[name="viewport"]').content);
check('pinch-zoom is allowed', !/user-scalable\s*=\s*(no|0)/i.test(viewport) && !/maximum-scale\s*=\s*1(\.0)?\b/i.test(viewport), viewport);

// ---------- Content-Security-Policy ----------
const csp = await page.evaluate(() => (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || '');
check('there is a Content-Security-Policy', csp.length > 0);
const scriptSrc = (csp.match(/script-src([^;]*)/) || [])[1] || '';
check('scripts may only come from the app itself - no inline, no eval', /'self'/.test(scriptSrc) &&
  !/unsafe-inline|unsafe-eval|https?:|\*/.test(scriptSrc), scriptSrc);
check('no plugins, no <base> hijack, no forms posted away', /object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp) && /form-action 'none'/.test(csp), csp);

// The app still works under it: screens render, and pictures behave.
await page.evaluate(() => document.querySelector('.tabbar [data-view="picks"]').click());
await page.waitForTimeout(1500);
check('a picture that loads is shown', await page.evaluate(() => !!document.querySelector('img[data-photo$="ok.png"]')));
check('a picture that fails is dropped for the plain icon square, as before', await page.evaluate(() =>
  !document.querySelector('img[data-photo$="missing.png"]') && !!document.querySelector('.photo-failed')));
check('no markup carries an inline event handler', await page.evaluate(() =>
  !document.querySelector('[onload],[onerror],[onclick],[onmouseover]')));
await page.evaluate(() => document.getElementById('settingsBtn').click());
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());
await page.evaluate(() => document.querySelector('.tabbar [data-view="events"]').click());
await page.waitForTimeout(400);
check('nothing was blocked by the policy while using the app', problems.length === 0, problems.join(' | '));

// ---------- The key stays out of the URL ----------
await page.evaluate(() => document.getElementById('settingsBtn').click());
await page.waitForTimeout(400);
await page.click('#testGeminiBtn');
await page.waitForTimeout(800);
check('the key check reached Gemini', geminiCalls.length > 0);
check('the key is not in the address', geminiCalls.length > 0 && geminiCalls.every((c) => !/key=|SECRET-KEY-123/.test(c.url)), JSON.stringify(geminiCalls.map((c) => c.url)));
check('it is sent as a header instead', geminiCalls.length > 0 && geminiCalls.every((c) => c.headers['x-goog-api-key'] === 'SECRET-KEY-123'));

// ---------- Focus ----------
await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());
await page.evaluate(() => document.querySelector('.tabbar [data-view="picks"]').click());
await page.waitForTimeout(500);
const ring = () => page.evaluate(() => {
  const i = document.getElementById('pickFind');
  const bar = i.closest('.find-bar');
  const cs = getComputedStyle(bar), is = getComputedStyle(i);
  return { focused: document.activeElement === i, bar: `${cs.borderColor}|${cs.boxShadow}|${cs.outlineStyle}`, input: `${is.outlineStyle}|${is.outlineWidth}` };
});
check('there is a saved-places search box', await page.evaluate(() => !!document.getElementById('pickFind')));
const before = await ring();
await page.evaluate(() => document.getElementById('pickFind').focus());
const after = await ring();
check('the saved-places search box shows where the keyboard is', after.focused &&
  (after.bar !== before.bar || (after.input.split('|')[0] !== 'none' && parseFloat(after.input.split('|')[1]) > 0)), JSON.stringify({ before, after }));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
