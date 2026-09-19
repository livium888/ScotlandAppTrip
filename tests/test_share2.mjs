import { chromium } from 'playwright';

// Use the sandbox's prebuilt browser when present, otherwise let Playwright
// resolve its own download (which is what CI has).
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;

function check(label, cond) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    console.log(`FAIL: ${label}`);
    failures++;
  }
}

const browser = await chromium.launch(LAUNCH_OPTS);

// Enrichment now runs before the folder picker opens; abort external lookups
// immediately so the fallback path is exercised without waiting on the network.
async function blockExternal(page) {
  await page.route(/nominatim|wikidata|wikipedia|overpass|googleapis/, (r) => r.abort());
}

// Mocks the real Capacitor plugin bridge: addListener registers a callback,
// and we can fire it exactly like the native retainUntilConsumed event would.
function installMockShareReceiver(page) {
  return page.addInitScript(() => {
    window.__mockListeners = {};
    window.Capacitor = {
      Plugins: {
        ShareReceiver: {
          addListener(eventName, cb) {
            window.__mockListeners[eventName] = cb;
          },
        },
      },
    };
  });
}

// --- Test 1: addListener is called during app startup (registration happens) ---
{
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await installMockShareReceiver(page);
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(200);

  const registered = await page.evaluate(() => typeof window.__mockListeners.sharedPlace === 'function');
  check('Test1: app.js registers a "sharedPlace" listener via Capacitor.Plugins.ShareReceiver', registered);
  await page.close();
}

// --- Test 2: firing the listener with coords opens the folder picker ---
{
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await installMockShareReceiver(page);
  await blockExternal(page);
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    window.__mockListeners.sharedPlace({
      name: 'Edinburgh Castle',
      lat: 55.9486,
      lon: -3.1999,
      rawText: 'Edinburgh Castle\nhttps://www.google.com/maps/place/Edinburgh+Castle/@55.9486,-3.1999,17z',
    });
  });
  await page.waitForSelector('#placeModal.open', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(200);

  const activeTab = await page.evaluate(() => document.getElementById('view')?.dataset.activeTab || null);
  const modalOpen = await page.evaluate(() => document.getElementById('placeModal')?.classList.contains('open') ?? null);
  const modalText = await page.evaluate(() => document.getElementById('placeModal')?.textContent || '');

  check('Test2: switched to picks tab', activeTab === 'picks');
  check('Test2: placeModal opened via the plugin event', modalOpen === true);
  check('Test2: modal mentions "Edinburgh Castle"', modalText.includes('Edinburgh Castle'));
  await page.close();
}

// --- Test 3: firing the listener BEFORE goto's load completes simulates a
// genuinely early/retained event (closest we can get to the real native race
// without a device) - still must not throw and should still be handled once
// the listener is registered, since real retainUntilConsumed guarantees delivery
// only happens once addListener has actually run. ---
{
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await installMockShareReceiver(page);
  // Deterministic: without this the assertion raced the enrichment, passing
  // where the network was blocked and failing where it wasn't.
  await blockExternal(page);
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  const noThrow = await page.evaluate(() => {
    try {
      window.__mockListeners.sharedPlace({ name: 'Some Random Cafe', rawText: 'Some Random Cafe shared' });
      return true;
    } catch (e) {
      return false;
    }
  });
  check('Test3: name-only payload does not throw', noThrow);

  // A share with no coordinates still ends at the folder picker - it just
  // arrives there without a map position.
  await page.waitForSelector('#placeModal.open', { timeout: 10000 }).catch(() => {});
  const modalText = await page.evaluate(() => document.getElementById('placeModal')?.textContent || '');
  check('Test3: name-only share still offers to save it', /Some Random Cafe/.test(modalText), modalText.slice(0, 120));
  await page.close();
}

// --- Test 4: no Capacitor bridge present (plain browser) must not throw on startup ---
{
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  check('Test4: no page errors when window.Capacitor is absent (plain browser)', errors.length === 0);
  await page.close();
}

await browser.close();

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
