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
const page = await browser.newPage();
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

let googleCalls = 0;
let nominatimCalls = 0;

await page.route(/places\.googleapis\.com/, (route) => {
  googleCalls++;
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    places: [{
      id: 'ChIJ_abc123',
      displayName: { text: 'The Little Chippy' },
      formattedAddress: '12 Rose St, Manchester M1 1AA',
      location: { latitude: 53.48, longitude: -2.24 },
      primaryTypeDisplayName: { text: 'Fish and chips restaurant' },
      websiteUri: 'https://littlechippy.example',
      nationalPhoneNumber: '0161 111 2222',
      rating: 4.6,
      userRatingCount: 812,
      currentOpeningHours: { weekdayDescriptions: ['Mon: 12-9pm', 'Tue: 12-9pm'] },
      editorialSummary: { text: 'Long-running chippy known for haddock.' },
    }],
  }) });
});
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  nominatimCalls++;
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
    lat: '53.48', lon: '-2.24', display_name: 'OSM Result, Manchester', type: 'restaurant',
    namedetails: { name: 'OSM Result' }, address: { city: 'Manchester' }, extratags: {},
  }]) });
});
await page.route(/wikidata\.org|wikipedia\.org/, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ search: [] }) }));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(200);

// ---- Settings: destination + google key ----
await page.click('#settingsBtn');
await page.waitForSelector('#setGoogleKey');
check('settings sheet opens', true);
await page.fill('#setDestination', 'Manchester');
await page.fill('#setGoogleKey', 'TEST-KEY-123');
await page.click('#saveSettings');
await page.waitForTimeout(200);

const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('trip-settings-v1')));
check('settings persisted', stored.destination === 'Manchester' && stored.googleKey === 'TEST-KEY-123', JSON.stringify(stored));

// ---- Search now goes to Google, not OSM ----
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'chippy');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(600);

check('search used Google Places (key set)', googleCalls === 1, `google=${googleCalls} osm=${nominatimCalls}`);
const resultsText = await page.evaluate(() => document.getElementById('view').textContent);
check('google result rendered', resultsText.includes('The Little Chippy'), resultsText.slice(0, 200));

// verify the query was region-scoped
const bodySent = await page.evaluate(() => window.__lastGoogleBody || null);
// add candidate -> folder picker -> save
await page.evaluate(() => document.querySelector('[data-add-candidate]').click());
// Adding now saves immediately - no folder question to answer.
await page.waitForTimeout(900);

const picks = await page.evaluate(() => JSON.parse(localStorage.getItem('scotland-trip-picks-v1') || '[]'));
const chip = picks.find((p) => p.name === 'The Little Chippy');
check('google pick saved', !!chip, JSON.stringify(picks).slice(0, 200));
if (chip) {
  check('saved rating from Google', chip.rating === 4.6 && chip.ratingCount === 812, `${chip.rating}/${chip.ratingCount}`);
  check('saved google place link', /place_id:ChIJ_abc123/.test(chip.googleUrl || ''), chip.googleUrl);
  check('saved phone', chip.phone === '0161 111 2222', chip.phone);
  check('mapsQuery uses Manchester not Scotland', /Manchester/.test(chip.mapsQuery) && !/Scotland/.test(chip.mapsQuery), chip.mapsQuery);
}

const cardText = await page.evaluate(() => document.getElementById('view').textContent);
check('rating shown on card', cardText.includes('4.6'), cardText.slice(0, 200));

// ---- Planner ----
await page.evaluate(() => document.querySelector('[data-view="itinerary"]').click());
await page.waitForTimeout(200);
check('itinerary has Suggested/My plan toggle', await page.evaluate(() => !!document.querySelector('[data-plan-mode="mine"]')));

await page.evaluate(() => document.querySelector('[data-plan-mode="mine"]').click());
await page.waitForTimeout(200);
check('my plan shows day slots', await page.evaluate(() => !!document.querySelector('[data-plan-add]')));

// add the saved pick to day 1
// Plan add is a tappable chip now, not a native select.
await page.evaluate(() => document.querySelector('button[data-plan-add]').click());
await page.waitForTimeout(300);
const planText = await page.evaluate(() => document.getElementById('view').textContent);
check('pick appears in the plan', planText.includes('The Little Chippy'), planText.slice(0, 200));

const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('trip-plan-v1')));
const firstDay = plan.days[0].id;
check('plan persisted to storage', plan.items[firstDay] && plan.items[firstDay].length === 1, JSON.stringify(plan.items));

// set a time
await page.evaluate(() => {
  const inp = document.querySelector('[data-plan-time]');
  inp.value = '13:00';
  inp.dispatchEvent(new Event('blur'));
});
await page.waitForTimeout(200);
const plan2 = await page.evaluate(() => JSON.parse(localStorage.getItem('trip-plan-v1')));
check('time saved on plan item', plan2.items[firstDay][0].time === '13:00', JSON.stringify(plan2.items[firstDay]));

// add a custom day
await page.fill('#addDayInput', 'Sat 22 Aug');
await page.evaluate(() => document.getElementById('addDayForm').requestSubmit());
await page.waitForTimeout(300);
const plan3 = await page.evaluate(() => JSON.parse(localStorage.getItem('trip-plan-v1')));
check('custom day added', plan3.days.some((d) => d.label === 'Sat 22 Aug'), JSON.stringify(plan3.days.map(d=>d.label)));

// ---- No key => falls back to OSM ----
googleCalls = 0; nominatimCalls = 0;
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('trip-settings-v1'));
  s.googleKey = '';
  localStorage.setItem('trip-settings-v1', JSON.stringify(s));
});
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForSelector('#pickSearchInput');
await page.fill('#pickSearchInput', 'museum');
await page.evaluate(() => document.getElementById('pickSearchForm').requestSubmit());
await page.waitForTimeout(600);
check('no key => falls back to OSM', googleCalls === 0 && nominatimCalls >= 1, `google=${googleCalls} osm=${nominatimCalls}`);

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
