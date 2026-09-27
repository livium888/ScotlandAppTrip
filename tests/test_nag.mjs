// The backup warning, without laying it across every screen.
//
// It was a strip across the top of every screen, then a strip you could
// dismiss for a week. Both were answers to the wrong question. On a phone the
// app saves a copy of the trip every day by itself, so the warning only ever
// means that has not happened - which is worth a mark on the settings gear,
// on the way to the fix, and nothing more. The offline notice stays a banner:
// it is a fact about right now, and it explains why search has stopped.
import { chromium } from 'playwright';
import { goTo } from './lib/screens.mjs';
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
await page.route(/nominatim|wikidata|wikipedia|overpass|googleapis|tile\.|generativelanguage/, (r) => r.abort());

// Enough saved to be worth losing, and never backed up - which is exactly
// when the nudge is supposed to appear.
await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b', boards: [{ id: 'b', name: 'Lake District', destination: 'Keswick', dated: true, createdAt: 1 }],
  }));
  localStorage.setItem('board:b:picks', JSON.stringify([
    { id: 'c:1', name: 'Castlerigg Stone Circle', city: 'Keswick', category: 'Attraction', lat: 54.6027, lon: -3.0983 },
    { id: 'c:2', name: 'The Dog and Gun', city: 'Keswick', category: 'Pub', lat: 54.6013, lon: -3.1367 },
    { id: 'c:3', name: 'Whinlatter Forest', city: 'Braithwaite', category: 'Attraction', lat: 54.6055, lon: -3.2258 },
    { id: 'c:4', name: 'Booths', city: 'Keswick', category: 'Supermarket', lat: 54.6005, lon: -3.1345 },
  ]));
  localStorage.setItem('board:b:folders', JSON.stringify(['Keswick']));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);

const bannerShown = () => page.evaluate(() => {
  const b = document.getElementById('appBanner');
  return !!b && !b.hidden && /backed up|only on this phone/i.test(b.textContent);
});
const gearMarked = () => page.evaluate(() => document.getElementById('settingsBtn').classList.contains('has-dot'));

// The nudge was a strip across the top of every screen, dismissable for a
// week. On a phone the app backs itself up daily, so the warning only ever
// means that has not happened - which earns a mark on the way to the fix,
// not a strip of every screen. Nothing to dismiss, because nothing is in
// the way.
check('with something to lose and no backup, the settings gear is marked', await gearMarked());
check('and says why, to a screen reader', /not backed up/i.test(await page.evaluate(() =>
  document.getElementById('settingsBtn').getAttribute('aria-label'))));
check('but nothing is laid across the screen', !(await bannerShown()));
await goTo(page, 'picks', 300);
check('on any screen', !(await bannerShown()) && await gearMarked());

// A backup clears it.
await page.evaluate(() => localStorage.setItem('last-backup-at-v1', JSON.stringify(Date.now())));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
check('once backed up the mark goes', !(await gearMarked()));

// And an empty trip has nothing to lose, so nothing to say.
await page.evaluate(() => {
  localStorage.removeItem('last-backup-at-v1');
  localStorage.setItem('board:b:picks', JSON.stringify([]));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
check('with nothing saved there is no mark', !(await gearMarked()));

// ---------- Offline is a different kind of message ----------
await page.context().setOffline(true);
await page.evaluate(() => window.dispatchEvent(new Event('offline')));
await page.waitForTimeout(300);
const offlineText = await page.evaluate(() => {
  const b = document.getElementById('appBanner');
  return b && !b.hidden ? b.textContent : '';
});
check('being offline still says so', /no connection/i.test(offlineText), offlineText.slice(0, 80));
check('and that one cannot be dismissed, because it clears itself',
  await page.evaluate(() => !document.getElementById('bannerDismiss')));

await page.context().setOffline(false);
await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
