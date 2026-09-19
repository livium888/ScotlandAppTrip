import { chromium } from 'playwright';

// Use the sandbox's prebuilt browser when present, otherwise let Playwright
// resolve its own download (which is what CI has).
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (label, cond, extra) => {
  if (cond) console.log(`PASS: ${label}`);
  else { console.log(`FAIL: ${label}${extra ? ' :: ' + extra : ''}`); failures++; }
};

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// Mock the external free APIs the enrichment relies on.
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{
      lat: '53.4794892', lon: '-2.2451148',
      display_name: 'Manchester, Greater Manchester, England, United Kingdom',
      type: 'city', category: 'place',
      namedetails: { name: 'Manchester' },
      address: { city: 'Manchester', postcode: 'M2 5DB', road: 'Albert Square', house_number: '1' },
      extratags: {
        website: 'https://www.manchester.gov.uk',
        phone: '+44 161 234 5000',
        opening_hours: 'Mo-Fr 09:00-17:00',
      },
    }]),
  });
});
await page.route(/wikidata\.org/, (route) => {
  const u = route.request().url();
  if (u.includes('wbsearchentities')) {
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ search: [{ id: 'Q18125', label: 'Manchester', description: 'city in England' }] }) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ entities: { Q18125: { claims: {} } } }) });
});
await page.route(/wikipedia\.org/, (route) => {
  route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ extract: 'Manchester is a city in Greater Manchester, England.' }) });
});

await page.addInitScript(() => {
  window.__mockListeners = {};
  window.Capacitor = { Plugins: { ShareReceiver: {
    addListener(n, cb) { window.__mockListeners[n] = cb; },
  } } };
});

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(200);

// Simulate exactly what the device reported: name only, no coordinates.
await page.evaluate(() => window.__mockListeners.sharedPlace({
  name: 'Manchester',
  rawText: 'https://maps.app.goo.gl/hWWszW9ttHeB7pcE6',
  googleUrl: 'https://www.google.com/maps?cid=15690000382639893418',
}));

await page.waitForSelector('#placeModal.open', { timeout: 5000 });
await page.waitForTimeout(400);

const modalText = await page.evaluate(() => document.getElementById('placeModal').textContent);
check('modal opens with the place name', modalText.includes('Manchester'));
check('summary shows address', modalText.includes('Albert Square') || modalText.includes('M2 5DB'), modalText.slice(0,300));
check('summary shows opening hours', modalText.includes('Mo-Fr 09:00-17:00'));
check('summary shows phone', modalText.includes('+44 161 234 5000'));
check('summary shows website', modalText.includes('manchester.gov.uk'));
check('summary shows wikipedia description', modalText.includes('city in Greater Manchester'));

// Confirm into a folder and verify the saved pick keeps everything.
await page.evaluate(() => {
  const btn = document.querySelector('#placeModal [data-pick-folder]');
  if (btn) btn.click();
});
await page.waitForTimeout(600);

const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('board:'+JSON.parse(localStorage.getItem('boards-v1')).activeId+':picks') || '[]'));
const m = saved.find((p) => p.name === 'Manchester');
check('pick was saved', !!m, JSON.stringify(saved).slice(0, 200));
if (m) {
  check('saved: coordinates', m.lat && Math.abs(m.lat - 53.4794892) < 0.001, String(m.lat));
  check('saved: website', m.website === 'https://www.manchester.gov.uk', m.website);
  check('saved: phone', m.phone === '+44 161 234 5000', m.phone);
  check('saved: openingHours', m.openingHours === 'Mo-Fr 09:00-17:00', m.openingHours);
  check('saved: address', !!m.address && m.address.includes('Manchester'), m.address);
  check('saved: description from wikipedia', !!m.description && m.description.includes('Greater Manchester'), m.description);
  check('saved: mapsQuery is clean (no raw URL)', !/https?:\/\//.test(m.mapsQuery || ''), m.mapsQuery);
}

check('saved: googleUrl (CID link) persisted', m && m.googleUrl === 'https://www.google.com/maps?cid=15690000382639893418', m && m.googleUrl);

// Facts and the Maps button now live in the detail sheet, not the list row.
await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForSelector('#placeModal.open', { timeout: 5000 });
await page.waitForTimeout(300);
const cardText = await page.evaluate(() => document.getElementById('placeModal').textContent);
const mapsBtn = await page.evaluate(() => {
  const b = document.querySelector('[data-open-maps]');
  return b ? { url: b.getAttribute('data-open-maps'), label: b.textContent.trim() } : null;
});
check('maps button uses the exact CID link', mapsBtn && mapsBtn.url === 'https://www.google.com/maps?cid=15690000382639893418', JSON.stringify(mapsBtn));
// "Open" means we have Google's exact place id; "Find" means a name search.
// The pin was an emoji in the label and is a drawn icon now, so this asks
// about the wording - which is the half that carries the meaning.
check('maps button label reflects exact place', mapsBtn && /^Open on Google Maps/.test(mapsBtn.label), mapsBtn && mapsBtn.label);
check('detail sheet renders address', cardText.includes('Albert Square') || cardText.includes('M2 5DB'));
check('detail sheet renders hours', cardText.includes('Mo-Fr 09:00-17:00'));
check('detail sheet renders phone', cardText.includes('+44 161 234 5000'));
await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
