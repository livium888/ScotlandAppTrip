// "Allow me to configure an automatic query once a week at a set time and
// weekdays, or multiple ones, so you can tell me what's happening on the
// weekend and I can pre-book tickets."
//
// A phone rings an alarm at an exact time but will not reliably run a web
// search while the app is closed. So: a repeating reminder on the days and
// time you choose, and tapping it looks up this weekend - the check's own
// place and kinds - with anything that must be booked ahead first.
import { chromium } from 'playwright';
import { goTo } from './lib/screens.mjs';
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

// The phone's notification system, recorded: what is scheduled, what is
// cancelled, and a way to tap a notification.
await page.addInitScript(() => {
  const scheduled = [];
  let tap = null;
  let state = 'prompt';
  let willGrant = 'granted';
  window.__notif = {
    scheduled,
    tap: (extra) => tap && tap({ notification: { extra } }),
    deny: () => { willGrant = 'denied'; state = 'prompt'; },
  };
  window.Capacitor = {
    Plugins: {
      LocalNotifications: {
        checkPermissions: async () => ({ display: state }),
        requestPermissions: async () => { state = willGrant; return { display: willGrant }; },
        schedule: async ({ notifications }) => { notifications.forEach((n) => scheduled.push(n)); },
        getPending: async () => ({ notifications: scheduled.map((n) => ({ id: n.id })) }),
        cancel: async ({ notifications }) => {
          notifications.forEach(({ id }) => {
            const i = scheduled.findIndex((n) => n.id === id);
            if (i >= 0) scheduled.splice(i, 1);
          });
        },
        addListener: (name, fn) => { if (name === 'localNotificationActionPerformed') tap = fn; return { remove: () => {} }; },
      },
    },
  };
});

const saturday = (() => {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
})();
let prompts = [];
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models(\?|$)/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  const p = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text;
  prompts.push(p);
  const list = angleFromPrompt(p) === 'theatre'
    ? [
        { name: 'The Gruffalo', date: saturday, time: '11:00', times: ['11:00', '14:00'], venue: 'Church Hill Theatre',
          area: 'Edinburgh', what: 'A show.', price: '££', childFocus: 'aimed', booking: 'required' },
        { name: 'Puppet Picnic', date: saturday, time: '12:00', times: ['12:00'], venue: 'Botanic Garden',
          area: 'Edinburgh', what: 'Puppets.', price: 'free', childFocus: 'aimed', booking: 'none' },
      ]
    : [];
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(list) }] },
      groundingMetadata: { groundingChunks: [{ web: { uri: 'https://theatres.example', title: 'On' } }] } }] }) });
});
await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify([{ lat: '55.9533', lon: '-3.1883', display_name: 'Edinburgh', type: 'city',
    namedetails: { name: 'Edinburgh' }, address: { city: 'Edinburgh' }, extratags: {} }]) }));
await page.route(/overpass/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ elements: [] }) }));
await page.route(/wikidata|wikipedia|googleapis\.com\/maps|tile\.|photon|open-meteo/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('onboarded-v1', '1');
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b', boards: [{ id: 'b', name: 'Edinburgh', destination: 'Edinburgh', dated: true, createdAt: 1 }] }));
  localStorage.setItem('board:b:picks', JSON.stringify([
    { id: 'a:1', name: 'Edinburgh', city: 'Edinburgh', category: 'City', lat: 55.9533, lon: -3.1883, major: true }]));
  localStorage.setItem('board:b:folders', JSON.stringify(['Edinburgh']));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ geminiKey: 'k', mode: 'kids' }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);

const weekly = () => page.evaluate(() => window.__notif.scheduled.filter((n) => n.id >= 6000 && n.id < 7000)
  .map((n) => ({ id: n.id, on: n.schedule.on, check: n.extra && n.extra.weeklyCheck, body: n.body })));
const sheetText = () => page.evaluate(() => document.getElementById('placeModal').textContent.replace(/\s+/g, ' '));

// ---------- Setting one up ----------
await goTo(page, 'events', 400);
check('Find has a weekly check', await page.evaluate(() => !!document.querySelector('[data-find="weekly"]')));
// What is on Find now is what the check will cover: theatre only.
await page.evaluate(() => window.__tripTest.setEventKinds(['theatre']));
await page.click('[data-find="weekly"]');
await page.waitForTimeout(300);
check('with nothing set up, it offers to add one', /Add a weekly check/.test(await sheetText()));
await page.click('#weeklyAdd');
await page.waitForTimeout(400);
let w = await weekly();
check('adding one sets a repeating reminder, Fridays at 18:00 to start',
  w.length === 1 && w[0].on.weekday === 6 && w[0].on.hour === 18 && w[0].on.minute === 0, JSON.stringify(w));
check('it covers what was on Find: the place and the kind', /Edinburgh/.test(w[0] && w[0].body) && /Theatre & shows/.test(w[0] && w[0].body),
  w[0] && w[0].body);

// Wednesdays too, at half seven.
await page.click('[data-weekly-day$="|3"]');
await page.waitForTimeout(300);
await page.evaluate(() => {
  const t = document.querySelector('[data-weekly-time]');
  t.value = '19:30';
  t.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(400);
w = await weekly();
check('another weekday and a new time give one reminder per day, at that time',
  w.length === 2 && w.every((n) => n.on.hour === 19 && n.on.minute === 30) &&
  w.map((n) => n.on.weekday).sort().join(',') === '4,6', JSON.stringify(w));

// A second check, for something else.
await page.evaluate(() => window.__tripTest.setEventKinds([]));
await page.click('#weeklyAdd');
await page.waitForTimeout(400);
w = await weekly();
check('more than one check can be kept', w.length === 3 && new Set(w.map((n) => n.check)).size === 2, JSON.stringify(w));
await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());
await page.waitForTimeout(300);
check('and the Find row says when they ring', /Wed, Fri 19:30/.test(await page.evaluate(() =>
  document.querySelector('[data-find="weekly"]').textContent)),
  await page.evaluate(() => document.querySelector('[data-find="weekly"]').textContent.replace(/\s+/g, ' ')));

// ---------- Trip reminders do not wipe them ----------
// Trip notifications clear everything the app scheduled before rebuilding;
// weekly checks are not theirs to clear.
await page.evaluate(() => {
  localStorage.setItem('notify-v1', JSON.stringify({ enabled: true }));
  localStorage.removeItem('notify-fingerprint-v1');
  window.dispatchEvent(new Event('focus'));
});
await page.waitForTimeout(1200);
check('rebuilding the trip reminders leaves the weekly ones alone', (await weekly()).length === 3,
  JSON.stringify(await weekly()));

// ---------- Tapping it ----------
const theatreCheck = w.find((n) => /Theatre/.test(n.body)).check;
prompts = [];
await page.evaluate(() => window.__tripTest.showView('itinerary'));
await page.evaluate((id) => window.__notif.tap({ weeklyCheck: id }), theatreCheck);
await page.waitForFunction(() => (window.__tripTest.eventResults || []).length > 0, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1200);
check('tapping the reminder opens Find', await page.evaluate(() => document.getElementById('view').dataset.activeTab === 'events'));
check('the dates are the coming weekend - on a Sunday, next Friday to Sunday, not just today',
  await page.evaluate(() => /Sat|Sun|Fri/.test(document.querySelector('[data-ev-ask="when"], .ev-summary, #view')?.textContent || '')) &&
  !/Edinburgh today/.test(await page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '))));
check('and looks up this weekend, for that check\'s kind only',
  prompts.length === 1 && angleFromPrompt(prompts[0]) === 'theatre', `${prompts.length} prompts`);
check('fresh, not from a search remembered earlier in the week', prompts.length === 1);
const order = await page.evaluate(() => [...document.querySelectorAll('.ev-row .ev-name')].map((e) => e.textContent.trim()));
check('what has to be booked comes first, under its own heading',
  /Book ahead/.test(await page.evaluate(() => document.getElementById('view').textContent)) &&
  /Gruffalo/.test(order[0] || ''), JSON.stringify(order));

// ---------- Removing one ----------
await page.click('[data-find="weekly"]');
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('[data-weekly-remove]').click());
await page.waitForTimeout(400);
check('removing a check cancels its reminders and keeps the other',
  (await weekly()).length === 1, JSON.stringify(await weekly()));

// ---------- Kept in a backup ----------
check('the checks travel in a backup', await page.evaluate(() =>
  Object.prototype.hasOwnProperty.call(window.__tripTest.buildBackup().data || window.__tripTest.buildBackup(), 'weekly-checks-v1') ||
  JSON.stringify(window.__tripTest.buildBackup()).includes('weekly-checks-v1')));

// ---------- Notifications refused ----------
await page.evaluate(() => localStorage.removeItem('weekly-checks-v1'));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
// After the reload: the fake phone starts afresh on every page load.
await page.evaluate(() => window.__notif.deny());
await goTo(page, 'events', 300);
await page.click('[data-find="weekly"]');
await page.waitForTimeout(300);
await page.click('#weeklyAdd');
await page.waitForTimeout(400);
check('with notifications turned off, it says the reminder cannot ring', /can't ring/.test(await sheetText()), await sheetText());

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
