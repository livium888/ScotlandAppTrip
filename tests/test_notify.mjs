// Phase 2: the app knows things about your day and could only ever say them
// to somebody already holding the phone with it open.
//
// Today worked out which stop was next, whether somewhere might be shut, and
// what the sky was doing - and on a day out, holding the phone with the app
// open is precisely what you are not doing. There were no notifications in
// the codebase at all.
//
// Everything checked here is worked out locally from the stored plan, which
// is the point: it has to fire in a glen with no signal.
//
// The plugin only exists in the installed app, so these drive the builder
// that decides what would be said, plus a stub standing in for Android to
// prove the settings actually schedule and cancel.
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
await page.route(/generativelanguage|nominatim|wikidata|wikipedia|overpass|open-meteo|photon|places\.googleapis|upload\.|tile\./, (r) => r.abort());

// Stand in for the Android plugin, recording what it is asked to do.
await page.addInitScript(() => {
  localStorage.setItem('onboarded-v1', '1');
  const scheduled = [];
  let cancelled = [];
  // What the phone would answer if asked, and what it has actually been
  // granted. Android reports the granted state from checkPermissions ever
  // after, so a stub that always said "prompt" would be modelling a phone
  // that forgets it said yes.
  let willGrant = 'granted';
  let state = 'prompt';
  window.__notif = {
    scheduled,
    get cancelled() { return cancelled; },
    // Revoking is what a phone does when somebody turns notifications off in
    // Android's own settings: the granted state goes with it, otherwise this
    // would model a phone that grants permission once and can never take it
    // back - which is not a phone.
    setPermission: (p) => { willGrant = p; state = p === 'granted' ? 'granted' : 'denied'; },
  };
  window.Capacitor = {
    Plugins: {
      LocalNotifications: {
        checkPermissions: async () => ({ display: state }),
        requestPermissions: async () => { state = willGrant; return { display: willGrant }; },
        schedule: async ({ notifications }) => { notifications.forEach((n) => scheduled.push(n)); },
        getPending: async () => ({ notifications: scheduled.map((n) => ({ id: n.id })) }),
        cancel: async ({ notifications }) => {
          cancelled = cancelled.concat(notifications.map((n) => n.id));
          notifications.forEach(({ id }) => {
            const i = scheduled.findIndex((n) => n.id === id);
            if (i >= 0) scheduled.splice(i, 1);
          });
        },
        addListener: () => ({ remove: () => {} }),
      },
    },
  };
});

// Tomorrow, so everything is genuinely in the future however long the suite
// takes to run.
const tomorrow = new Date(Date.now() + 86400000);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = `Day 1 · ${DAYS[tomorrow.getDay()]} ${tomorrow.getDate()} ${MONTHS[tomorrow.getMonth()]}`;
const isoTomorrow = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(({ dayLabel, isoTomorrow }) => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-n', boards: [{ id: 'b-n', name: 'Trip', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Scotland', geminiKey: '', geminiModel: '' }));
  localStorage.setItem('board:b-n:folders', JSON.stringify(['Stirling']));
  localStorage.setItem('board:b-n:picks', JSON.stringify([
    // Shuts at 17:00, and far enough from the next stop to need a drive.
    { id: 'p1', name: 'Stirling Castle', city: 'Stirling', category: 'Castle',
      lat: 56.1237, lon: -3.9474, addedAt: 1, photoChecked: true,
      openingHours: 'Mo-Su 09:30-17:00' },
    // Outdoors, and needs booking ahead.
    { id: 'p2', name: 'Ben Ledi Hill Walk', city: 'Callander', category: 'Hill walk',
      lat: 56.2600, lon: -4.3100, addedAt: 2, photoChecked: true, booking: true },
    { id: 'p3', name: 'The Coffee Bothy', city: 'Callander', category: 'Cafe',
      lat: 56.2450, lon: -4.2150, addedAt: 3, photoChecked: true },
  ]));
  localStorage.setItem('board:b-n:plan', JSON.stringify({
    days: [{ id: 'd1', label: dayLabel }],
    items: { d1: [
      { pickId: 'p1', time: '10:00' },
      { pickId: 'p2', time: '13:30' },
      { pickId: 'p3', time: '16:00' },
    ] } }));
  // A wet forecast for that day, in the shape the weather cache stores.
  localStorage.setItem('weather-cache-v1', JSON.stringify({
    '56.12,-3.95': { fetchedAt: Date.now(), days: [
      { date: isoTomorrow, code: 63, max: 14, min: 8, rainChance: 85, rainMm: 9, wind: 22 }] } }));
}, { dayLabel, isoTomorrow });
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);

const built = () => page.evaluate(() => window.__tripTest.plannedNotifications().map((n) => ({
  id: n.id, title: n.title, body: n.body,
  clock: `${String(new Date(n.at).getHours()).padStart(2, '0')}:${String(new Date(n.at).getMinutes()).padStart(2, '0')}`,
  rainy: !!n.rainy,
})));

// ---------- Nothing at all until you ask for it ----------

check('nothing is scheduled until you turn it on', (await built()).length === 0,
  JSON.stringify(await built()).slice(0, 200));

await page.evaluate(() => localStorage.setItem('notify-v1', JSON.stringify({ enabled: true })));
const list = await built();
check('turning it on produces reminders from the plan', list.length > 0, String(list.length));

// ---------- The morning brief ----------

const brief = list.find((n) => /^\w{3} \d/.test(n.title));
check('there is a brief for the day', !!brief, JSON.stringify(list.map((n) => n.title)));
check('and it leads with the first stop and its time',
  !!brief && /Stirling Castle at 10:00/.test(brief.body), brief && brief.body);
check('and says how much else there is', !!brief && /then 2 more/.test(brief.body), brief && brief.body);
check('and what the sky is doing', !!brief && /rain 85%/.test(brief.body), brief && brief.body);
// `booking` is what a result said about the place; `booked` is you ticking it
// off. Only the pair is worth mentioning.
check('and what is still unbooked', !!brief && /1 still to book/.test(brief.body), brief && brief.body);
check('at the hour it was set for', !!brief && brief.clock === '07:30', brief && brief.clock);

// ---------- Rain on a day spent outdoors ----------

const rain = list.find((n) => n.rainy);
check('a wet day with outdoor stops is flagged', !!rain, JSON.stringify(list.map((n) => n.title)));
check('and names what is outdoors rather than just saying it will rain',
  !!rain && /Ben Ledi/.test(rain.body), rain && rain.body);
check('before the brief, not after it', !!rain && rain.clock === '07:00', rain && rain.clock);

// A dry day says nothing, or the warning means nothing.
const dry = await page.evaluate((iso) => {
  const w = JSON.parse(localStorage.getItem('weather-cache-v1'));
  w['56.12,-3.95'].days[0].rainChance = 10;
  localStorage.setItem('weather-cache-v1', JSON.stringify(w));
  const out = window.__tripTest.plannedNotifications().filter((n) => n.rainy).length;
  w['56.12,-3.95'].days[0].rainChance = 85;
  localStorage.setItem('weather-cache-v1', JSON.stringify(w));
  return out;
}, isoTomorrow);
check('a dry day is not warned about', dry === 0, String(dry));

// ---------- Time to leave ----------

const leave = list.filter((n) => /Time to head for/.test(n.title));
check('you are told when to set off for the next stop', leave.length >= 1,
  JSON.stringify(list.map((n) => n.title)));
check('but not for the first one, since nothing is known about where the day starts',
  !leave.some((n) => /Stirling Castle/.test(n.title)), JSON.stringify(leave.map((n) => n.title)));
const toBen = leave.find((n) => /Ben Ledi/.test(n.title));
check('and it says how long the journey is and where from',
  !!toBen && /from Stirling Castle/.test(toBen.body) && /drive|walk/.test(toBen.body), toBen && toBen.body);
// Stirling to Ben Ledi is roughly 25 miles by road, so leaving for a 13:30
// arrival means well before noon - not "at 13:20".
check('and it fires before the journey, not at the arrival time',
  !!toBen && toBen.clock < '13:00', toBen && toBen.clock);

// ---------- Closing soon ----------

const closing = list.find((n) => /closes at/.test(n.title));
check('somewhere shutting is worth saying before it shuts', !!closing,
  JSON.stringify(list.map((n) => n.title)));
check('naming the place and the hour', !!closing && /Stirling Castle closes at 17:00/.test(closing.title),
  closing && closing.title);
check('three quarters of an hour ahead', !!closing && closing.clock === '16:15', closing && closing.clock);

// The parser has to stay conservative: a wrong "closes at" would send you
// away from somewhere that was open.
const hours = await page.evaluate(() => ({
  plain: window.__tripTest.closingMinutesOnDay('Mo-Su 09:30-17:00', 'Tu'),
  lunch: window.__tripTest.closingMinutesOnDay('Mo-Fr 09:00-12:00,13:00-17:30', 'Fr'),
  shut: window.__tripTest.closingMinutesOnDay('Mo-Fr 09:00-17:00', 'Su'),
  always: window.__tripTest.closingMinutesOnDay('24/7', 'Mo'),
  holidays: window.__tripTest.closingMinutesOnDay('Mo-Su 10:00-18:00; PH off', 'Mo'),
  overnight: window.__tripTest.closingMinutesOnDay('Mo-Su 12:00-01:00', 'Mo'),
  nonsense: window.__tripTest.closingMinutesOnDay('by appointment', 'Mo'),
}));
check('a plain day reads correctly', hours.plain === 17 * 60, JSON.stringify(hours));
check('a place that shuts for lunch closes in the evening, not at noon',
  hours.lunch === 17 * 60 + 30, JSON.stringify(hours));
check('a day it is closed says nothing', hours.shut === null, JSON.stringify(hours));
check('nor does somewhere always open', hours.always === null, JSON.stringify(hours));
check('nor anything with holiday rules in it', hours.holidays === null, JSON.stringify(hours));
check('nor a pub open past midnight', hours.overnight === null, JSON.stringify(hours));
check('nor a string it does not understand', hours.nonsense === null, JSON.stringify(hours));

// ---------- Each kind can be turned off on its own ----------

const only = await page.evaluate(() => {
  localStorage.setItem('notify-v1', JSON.stringify({
    enabled: true, leave: false, rain: false, closing: false }));
  return window.__tripTest.plannedNotifications().map((n) => n.title);
});
check('switching the extras off leaves only the brief', only.length === 1, JSON.stringify(only));

// ---------- Nothing in the past ----------

const past = await page.evaluate((label) => {
  localStorage.setItem('notify-v1', JSON.stringify({ enabled: true }));
  const plan = JSON.parse(localStorage.getItem('board:b-n:plan'));
  const yesterday = new Date(Date.now() - 86400000);
  const D = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  plan.days = [{ id: 'd1', label: `Day 1 · ${D[yesterday.getDay()]} ${yesterday.getDate()} ${M[yesterday.getMonth()]}` }];
  localStorage.setItem('board:b-n:plan', JSON.stringify(plan));
  const out = window.__tripTest.plannedNotifications().length;
  const restored = JSON.parse(localStorage.getItem('board:b-n:plan'));
  restored.days = [{ id: 'd1', label }];
  localStorage.setItem('board:b-n:plan', JSON.stringify(restored));
  return out;
}, dayLabel);
check('a day that has already happened is not reminded about', past === 0, String(past));

// ---------- The switch in Settings actually schedules ----------

await page.evaluate(() => {
  localStorage.removeItem('notify-v1');
  localStorage.removeItem('notify-fingerprint-v1');
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
await page.evaluate(() => document.getElementById('settingsBtn').click());
await page.waitForSelector('#notifyOn', { timeout: 4000 });
check('the switch starts off', await page.evaluate(() => !document.getElementById('notifyOn').checked));
check('and the sub-options are out of the way until it is on',
  await page.evaluate(() => document.getElementById('notifyDetail').hidden));

await page.evaluate(() => document.getElementById('notifyOn').click());
await page.waitForTimeout(1200);
check('turning it on schedules the reminders with the phone',
  await page.evaluate(() => window.__notif.scheduled.length) > 0,
  await page.evaluate(() => JSON.stringify(window.__notif.scheduled.map((n) => n.title))));
check('and says how many were set', await page.evaluate(() =>
  /reminder/.test(document.getElementById('notifyResult').textContent)),
  await page.evaluate(() => document.getElementById('notifyResult').textContent));

// Each one has to land somewhere that answers it, or it is only a buzz.
check('every reminder knows where tapping it should go', await page.evaluate(() =>
  window.__notif.scheduled.every((n) => n.extra && n.extra.tab)));

// ---------- And turning it off cancels them ----------

await page.evaluate(() => document.getElementById('notifyOn').click());
await page.waitForTimeout(1200);
check('turning it off cancels everything it scheduled',
  await page.evaluate(() => window.__notif.scheduled.length) === 0,
  await page.evaluate(() => JSON.stringify(window.__notif.scheduled.length)));
check('and says so plainly', await page.evaluate(() =>
  /off/i.test(document.getElementById('notifyResult').textContent)),
  await page.evaluate(() => document.getElementById('notifyResult').textContent));

// ---------- A refusal is not a broken switch ----------

await page.evaluate(() => window.__notif.setPermission('denied'));
await page.evaluate(() => document.getElementById('notifyOn').click());
await page.waitForTimeout(1000);
check('a phone that refuses permission puts the switch back',
  await page.evaluate(() => !document.getElementById('notifyOn').checked));
check('and explains where to grant it rather than failing silently',
  await page.evaluate(() => /permission/i.test(document.getElementById('notifyResult').textContent)),
  await page.evaluate(() => document.getElementById('notifyResult').textContent));
check('and nothing is scheduled behind your back',
  await page.evaluate(() => window.__notif.scheduled.length) === 0);

// ---------- And the screen says it too ----------
//
// This part is not about notifications at all. Today knew a castle was open
// on a Tuesday and said nothing whatever about it being seven in the evening
// and the castle shutting at five - it printed the opening hours and left you
// to do the arithmetic in a car park. Unlike everything above, this is a
// change to behaviour that already existed, so it is worth being sure the
// check fails without it.

const nowLabel = (() => {
  const n = new Date();
  return `Day 1 · ${DAYS[n.getDay()]} ${n.getDate()} ${MONTHS[n.getMonth()]}`;
})();

// A place that shut hours ago, planned for today.
await page.evaluate((label) => {
  localStorage.setItem('board:b-n:picks', JSON.stringify([
    { id: 'p1', name: 'Stirling Castle', city: 'Stirling', category: 'Castle',
      lat: 56.1237, lon: -3.9474, addedAt: 1, photoChecked: true,
      openingHours: 'Mo-Su 09:30-17:00' }]));
  localStorage.setItem('board:b-n:plan', JSON.stringify({
    days: [{ id: 'd1', label }], items: { d1: [{ pickId: 'p1', time: '10:00' }] } }));
}, nowLabel);

// The clock is moved rather than the hours, so the same place reads
// differently at different times of day - which is the actual complaint.
const todayAt = async (hour) => {
  await page.addInitScript(`(() => {
    const Real = Date;
    const fixed = new Real();
    fixed.setHours(${hour}, 0, 0, 0);
    const offset = fixed.getTime() - Real.now();
    class Shifted extends Real {
      constructor(...args) { super(...(args.length ? args : [Real.now() + offset])); }
      static now() { return Real.now() + offset; }
    }
    window.Date = Shifted;
  })()`);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelector('[data-view="today"]').click());
  await page.waitForTimeout(500);
  return page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
};

const evening = await todayAt(19);
check('at seven in the evening it says the castle is shut',
  /Shut for the day/.test(evening) && /17:00/.test(evening), evening.slice(0, 400));

const lateAfternoon = await todayAt(16);
check('and at four it says how long is left',
  /Closes at 17:00/.test(lateAfternoon) && /left/.test(lateAfternoon), lateAfternoon.slice(0, 400));

const morning = await todayAt(10);
check('but says nothing at ten in the morning, when there is nothing to say',
  !/Shut for the day|Closes at 17:00/.test(morning), morning.slice(0, 400));

// ---------- A restored backup does not lie about being on ----------
//
// The switch travels in a backup; the phone's permission does not. A switch
// reading "on" while nothing ever fires is worse than one reading "off".
await page.evaluate(() => {
  localStorage.setItem('notify-v1', JSON.stringify({ enabled: true }));
  localStorage.removeItem('notify-fingerprint-v1');
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2500);
check('a switch restored onto a phone that never granted permission turns itself off',
  await page.evaluate(() => !JSON.parse(localStorage.getItem('notify-v1')).enabled),
  await page.evaluate(() => localStorage.getItem('notify-v1')));
check('and nothing was scheduled in the meantime',
  await page.evaluate(() => window.__notif.scheduled.length) === 0);

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
