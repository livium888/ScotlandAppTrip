// "Give me an OpenRouter integration" - signing in instead of pasting a key.
//
// Using a ChatGPT, Claude or Gemini subscription from a third-party app is
// against all three providers' terms (2026), with accounts suspended for it.
// OpenRouter's own sign-in is the legitimate way to skip the key: OAuth with
// PKCE hands the app a key that belongs to the user's OpenRouter account,
// spending their own credit. And its web plugin searches for any model, so
// What's on works through it.
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { goTo, openEventForm } from './lib/screens.mjs';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.setViewportSize({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
let authUrl = '';
let exchange = null;
let chats = [];
// OpenRouter, faked: the sign-in page approves at once and sends the browser
// back to the callback with a code; the code is swapped for a key.
await ctx.route(/openrouter\.ai\/auth\?/, (route) => {
  authUrl = route.request().url();
  const cb = new URL(authUrl).searchParams.get('callback_url');
  if (!cb) return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Your code: CODE-FROM-PAGE</p>' });
  return route.fulfill({ status: 302, headers: { location: `${cb}&code=CODE-123` } });
});
await ctx.route(/openrouter\.ai\/api\/v1\/auth\/keys/, (route) => {
  exchange = JSON.parse(route.request().postData() || '{}');
  const good = exchange.code === 'CODE-123' || exchange.code === 'CODE-FROM-PAGE';
  route.fulfill({ status: good ? 200 : 400, contentType: 'application/json',
    body: JSON.stringify(good ? { key: 'sk-or-v1-userkey9876' } : { error: { message: 'Invalid code' } }) });
});
await ctx.route(/openrouter\.ai\/api\/v1\/key$/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ data: { label: 'Wayfare', usage: 0.42, limit_remaining: 9.58 } }) }));
await ctx.route(/openrouter\.ai\/api\/v1\/models/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ data: [{ id: 'google/gemini-2.5-flash' }, { id: 'openai/gpt-4o-mini' }] }) }));
await ctx.route(/openrouter\.ai\/api\/v1\/chat\/completions/, (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  chats.push({ body, headers: route.request().headers() });
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    choices: [{ message: { role: 'assistant',
      content: `- name: Folk Evening; venue: Town Hall; town: Bakewell; date: ${day}; time: 19:30; price: ££`,
      annotations: [{ type: 'url_citation', url_citation: { url: 'https://bakewell.example/on', title: 'On' } }] } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 } }) });
});
await ctx.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify([{ lat: '53.2129', lon: '-1.6753', display_name: 'Bakewell', type: 'town',
    namedetails: { name: 'Bakewell' }, address: { town: 'Bakewell' }, extratags: {} }]) }));
await ctx.route(/overpass/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"elements":[]}' }));
await ctx.route(/generativelanguage|wikidata|wikipedia|googleapis\.com\/maps|tile\.|photon|open-meteo/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('onboarded-v1', '1');
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b', boards: [{ id: 'b', name: 'Peak', destination: 'Bakewell', dated: true, createdAt: 1 }] }));
  localStorage.setItem('board:b:picks', JSON.stringify([
    { id: 'a:1', name: 'Bakewell', city: 'Bakewell', category: 'Town', lat: 53.2129, lon: -1.6753, major: true }]));
  localStorage.setItem('board:b:folders', JSON.stringify(['Bakewell']));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ aiProvider: 'openrouter' }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);
const settings = () => page.evaluate(() => JSON.parse(localStorage.getItem('trip-settings-v1') || '{}'));
const openSettings = async () => { await page.click('#settingsBtn'); await page.waitForTimeout(400); };

// ---------- Choosing it ----------
await openSettings();
check('OpenRouter is a choice of its own', await page.evaluate(() =>
  [...document.querySelectorAll('#setAiProvider option')].some((o) => o.value === 'openrouter' && /sign in/i.test(o.textContent))));
check('with a sign-in button, not a key box', await page.evaluate(() =>
  !!document.getElementById('orSignIn') && !document.getElementById('setAiKey')));

// ---------- Signing in ----------
await page.click('#orSignIn');
await page.waitForFunction(() => /openrouter/i.test(document.body.textContent) && !!document.getElementById('settingsBtn'), null, { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(1500);
const auth = new URL(authUrl || 'http://x/');
check('it goes to OpenRouter\'s sign-in page', /openrouter\.ai\/auth/.test(authUrl), authUrl);
check('with a SHA-256 code challenge', auth.searchParams.get('code_challenge_method') === 'S256' &&
  (auth.searchParams.get('code_challenge') || '').length >= 43);
check('and a way back to the app', /openrouter=1/.test(auth.searchParams.get('callback_url') || ''), auth.searchParams.get('callback_url'));
check('coming back, the code is swapped for a key', exchange && exchange.code === 'CODE-123' && exchange.code_challenge_method === 'S256',
  JSON.stringify(exchange));
const expected = exchange ? createHash('sha256').update(exchange.code_verifier).digest('base64url') : '';
check('with the secret whose hash was sent up front - only the phone ever had it', expected === auth.searchParams.get('code_challenge'),
  `${expected} vs ${auth.searchParams.get('code_challenge')}`);
let st = await settings();
check('the key is kept, and OpenRouter is the provider', st.openrouterKey === 'sk-or-v1-userkey9876' && st.aiProvider === 'openrouter',
  JSON.stringify(st));
check('the address bar no longer carries the code', await page.evaluate(() => !/code=/.test(location.search)));
check('the one-time secret is forgotten once used', await page.evaluate(() => !localStorage.getItem('openrouter-pending-v1')));

await openSettings();
check('Settings says signed in, with only the end of the key', await page.evaluate(() =>
  /Signed in to OpenRouter/.test(document.body.textContent) && /…9876/.test(document.body.textContent) &&
  !document.body.textContent.includes('sk-or-v1-userkey9876')));
await page.waitForTimeout(600);
check('and how much of the credit has been used', /\$0\.42 used, \$9\.58 left/.test(await page.evaluate(() =>
  document.getElementById('orCredit')?.textContent || '')));
check('with the model to use, and OpenRouter\'s list to pick from', await page.evaluate(() =>
  document.getElementById('setOrModel')?.value === 'google/gemini-2.5-flash' &&
  document.querySelectorAll('#orModels option').length === 2));

// ---------- Kept out of backups ----------
check('the key is not in a backup', await page.evaluate(() =>
  !JSON.stringify(window.__tripTest.buildBackup()).includes('sk-or-v1-userkey9876')));

// ---------- Using it ----------
await page.evaluate(() => {
  const m = document.getElementById('setOrModel');
  m.value = 'openai/gpt-4o-mini';
  m.dispatchEvent(new Event('change'));
});
await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());
await goTo(page, 'events', 300);
await page.evaluate(() => window.__tripTest.setEventKinds(['hall']));
await openEventForm(page);
await page.evaluate(() => document.getElementById('evSearch').click());
await page.waitForFunction(() => (window.__tripTest.eventResults || []).length > 0, null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(800);
const c = chats[0] || { body: {}, headers: {} };
check('a search goes to OpenRouter with the user\'s own key', /Bearer sk-or-v1-userkey9876/.test(c.headers.authorization || ''),
  c.headers.authorization);
check('with the model chosen', c.body.model === 'openai/gpt-4o-mini', c.body.model);
check('with OpenRouter\'s web search switched on', JSON.stringify(c.body.plugins) === JSON.stringify([{ id: 'web' }]),
  JSON.stringify(c.body.plugins));
check('and says which app is asking', c.headers['x-title'] === 'Wayfare');
check('what it finds is a result, looked up, with its source', await page.evaluate(() => {
  const r = (window.__tripTest.eventResults || [])[0];
  return r && r.name === 'Folk Evening' && !r.unsourced && r.sources[0].uri === 'https://bakewell.example/on';
}), JSON.stringify(await page.evaluate(() => (window.__tripTest.eventResults || []).map((e) => [e.name, e.unsourced]))));

// ---------- Signing out ----------
await openSettings();
await page.click('#orSignOut');
await page.waitForTimeout(400);
st = await settings();
check('signing out forgets the key', st.openrouterKey === '' && await page.evaluate(() => !!document.getElementById('orSignIn')));

// ---------- When coming back does not work: the code instead ----------
exchange = null;
await page.click('#orShowCode');
await page.waitForTimeout(600);
check('the fallback asks OpenRouter to show a code rather than come back', !/callback_url/.test(authUrl) || !new URL(authUrl).searchParams.get('callback_url'),
  authUrl);
await page.fill('#orCode', 'CODE-FROM-PAGE');
await page.click('#orUseCode');
await page.waitForTimeout(800);
st = await settings();
check('and pasting that code signs in just the same', st.openrouterKey === 'sk-or-v1-userkey9876' && exchange && exchange.code === 'CODE-FROM-PAGE',
  JSON.stringify(exchange));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
