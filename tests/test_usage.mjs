// "Is it possible to add an API usage statistics screen, just so I know how
// much my queries are using? Is there a realistic, maybe the exact number?"
//
// Yes, and exact — but only for half the question, and the screen has to be
// honest about which half.
//
// Every Gemini reply carries usageMetadata: promptTokenCount and
// candidatesTokenCount, counted by Google rather than estimated by us. The app
// was throwing it away with the rest of the envelope, so it could spend nine
// grounded searches of somebody's allowance and have nothing to say about it.
//
// What is NOT knowable: how much of a free allowance is left. No endpoint
// answers that from an API key. And what this phone spent is all this phone
// can see — the same key used elsewhere is invisible. Both are said on screen,
// because a number that quietly means less than it appears to is worse than no
// number at all. So is a price: tokens are a fact, a rate is a guess with a
// date on it, and the screen shows the rate next to the figure so a stale one
// is visible rather than misleading.
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
await page.route(/wikidata|wikipedia|overpass|tile\.|photon|places\.googleapis|open-meteo|nominatim/, (r) => r.abort());

// Google's own counts, which is the whole point: not something we work out.
let reportUsage = true;
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  const body = {
    candidates: [{ content: { parts: [{ text: '[]' }] } }],
  };
  if (reportUsage) {
    body.usageMetadata = { promptTokenCount: 1200, candidatesTokenCount: 300, totalTokenCount: 1500 };
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-u', boards: [{ id: 'b-u', name: 'Trip', destination: 'Peak District', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Peak District', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite' }));
  localStorage.setItem('board:b-u:picks', JSON.stringify([]));
  localStorage.setItem('board:b-u:plan', JSON.stringify({ days: [], items: {} }));
  localStorage.setItem('board:b-u:search-anchor', JSON.stringify({ name: 'Bakewell', lat: 53.2129, lon: -1.6753, miles: 15 }));
  localStorage.removeItem('ai-usage-v1');
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('ai-usage-v1') || 'null'));
const screen = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
// Tolerant of the screen not existing: clicking null throws inside the page
// and kills the run, which prints no FAIL lines - so a suite that is genuinely
// failing looks like one that never ran.
const goUsage = async () => {
  await page.evaluate(() => {
    document.querySelector('[data-view="more"]')?.click();
    document.querySelector('[data-more="usage"]')?.click();
  });
  await page.waitForTimeout(300);
};

check('nothing is counted before anything has been asked', (await stored()) === null);

// ---------- Counting a real search ----------

await page.evaluate(() => document.querySelector('[data-view="events"]').click());
await page.waitForTimeout(300);
await page.evaluate(() => document.getElementById('evSearch').click());
await page.waitForFunction(() => !window.__tripTest.eventsBusy(), null, { timeout: 40000 });

const after = await stored();
check('a search is counted', !!after && after.total.calls > 0, JSON.stringify(after && after.total));
// Nine angles, and the mock returns nothing so each falls through to the
// second attempt: what matters is that every request is counted, not the
// exact number of them.
check('every request is counted, not just the first',
  !!after && after.total.calls >= 9, JSON.stringify(after && after.total));
// The numbers must be Google's, multiplied out - not invented by us.
check("the token counts are Google's own numbers",
  !!after && after.total.inTokens === after.total.calls * 1200 &&
  after.total.outTokens === after.total.calls * 300,
  JSON.stringify(after && after.total));
check('grounded requests are counted apart, being the expensive ones',
  !!after && after.total.grounded > 0 && after.total.grounded <= after.total.calls,
  JSON.stringify(after && after.total));
check('and the last request is remembered on its own',
  !!after && after.last && after.last.inTokens === 1200, JSON.stringify(after && after.last));
check('today has its own row', !!after && Object.keys(after.days).length === 1, JSON.stringify(after && after.days));

// ---------- The screen ----------

await goUsage();
const text = await screen();
check('there is a screen for it', await page.evaluate(() =>
  document.getElementById('view').dataset.activeTab === 'usage'));
check('it shows today, the week and all time',
  /Today/.test(text) && /Last 7 days/.test(text) && /All time/.test(text), text.slice(0, 300));
check('with the tokens split in and out', /in ·/.test(text) && /out ·/.test(text), text.slice(0, 400));
check('and says how many of them used web search', /with web search/.test(text), text.slice(0, 500));
// The half of the question that cannot be answered, said rather than implied.
check('it says the count is only this phone',
  /only cover this phone/.test(text), text.slice(-600));
check('and that no app can ask Google what allowance is left',
  /no way to ask Google how much of an allowance is left/.test(text), text.slice(-600));
check('and that the numbers came from Google rather than being estimated',
  /Google's own numbers/.test(text), text.slice(-600));
// Nine grounded calls is the heaviest thing the app does; worth saying.
check('it says which feature is the expensive one',
  /What's on search is nine requests/.test(text), text.slice(0, 900));

// ---------- Money, and refusing to make it up ----------

check('no price is shown on the free tier, because there is not one',
  !/about £/.test(text) && /the answer is £0/.test(text), text.slice(0, 900));

await page.evaluate(() => document.getElementById('usagePaid')?.click());
await page.waitForTimeout(300);
const paidText = await screen();
check('saying you are on a paid plan produces an estimate', /about /.test(paidText), paidText.slice(0, 500));
// A rate that cannot be seen is a claim; one that can be seen is an estimate.
check('the rate it used is shown next to the figure',
  /per million tokens in/.test(paidText), paidText.slice(0, 900));
check('and dated, so a stale one is obvious', /as of May 2026/.test(paidText), paidText.slice(0, 900));
check('and it can be corrected, since the app cannot check it',
  await page.evaluate(() => !!document.getElementById('rateIn') && !!document.getElementById('rateOut')));
check('grounding is said to be billed separately rather than folded in',
  /billed separately by Google/.test(paidText), paidText.slice(0, 900));

await page.evaluate(() => {
  const el = document.getElementById('rateIn');
  if (!el) return;
  el.value = '99';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(250);
check('a corrected rate is kept', await page.evaluate(() =>
  (JSON.parse(localStorage.getItem('trip-settings-v1')).aiRates || {}).in === 99));

// ---------- A reply with no usage data ----------

reportUsage = false;
await page.evaluate(() => document.querySelector('[data-view="events"]').click());
await page.waitForTimeout(300);
await page.evaluate(() => document.getElementById('evSearch').click());
await page.waitForFunction(() => !window.__tripTest.eventsBusy(), null, { timeout: 40000 });
const later = await stored();
// Recording nothing would understate the total and look like the app was
// asking for less than it was.
check('a request Google reports no tokens for is still counted as a request',
  !!later && !!after && later.total.calls > after.total.calls, `${after && after.total.calls} -> ${later && later.total.calls}`);
check('but adds no tokens it was not told about',
  !!later && !!after && later.total.inTokens === after.total.inTokens, `${after && after.total.inTokens} -> ${later && later.total.inTokens}`);
await goUsage();
check('and the screen says so rather than showing a silent zero',
  /didn't report a token count/.test(await screen()), (await screen()).slice(0, 900));

// ---------- Resetting ----------

await page.evaluate(() => document.getElementById('usageReset')?.click());
await page.waitForTimeout(300);
const cleared = await stored();
check('the count can be reset', !!cleared && cleared.total.calls === 0, JSON.stringify(cleared && cleared.total));

// ---------- Not in the backup, deliberately ----------

const backup = await page.evaluate(() => JSON.stringify(window.__tripTest.buildBackup()));
// Restoring one phone's meter onto another would add two devices' spending
// together and present it as one phone's - a wrong number, not a missing one.
check('a per-device meter is not carried into a backup', !/ai-usage-v1/.test(backup));

// ---------- Reachable from More ----------

await page.evaluate(() => document.querySelector('[data-view="more"]').click());
await page.waitForTimeout(300);
check('More has a row for it', await page.evaluate(() => !!document.querySelector('[data-more="usage"]')));
const usageRow = await page.evaluate(() =>
  (document.querySelector('[data-more="usage"]') || {}).textContent || '');
check('and the row carries the number, like the others do', /today/i.test(usageRow), usageRow.replace(/\s+/g, ' '));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
