// A model on the phone itself.
//
// The goal behind this is the one that has driven the last three rounds:
// something people can use without going and getting an API key. A quantised
// Qwen sitting in the app's own storage needs no key, costs nothing, works
// with no signal, and sends nothing anywhere.
//
// What it cannot do is search the web, which means it cannot find events -
// the same wall as every other model without grounding, and already handled:
// aiCanGround() says no, What's on refuses, and anything it does produce is
// marked unsourced because it cites nothing.
//
// The native half - llama.cpp over JNI - cannot be exercised from a browser
// at all, so everything here talks to a stubbed bridge. The first real
// inference happens on a phone. That is worth saying plainly rather than
// letting a green suite imply more than it checked.
import { chromium } from 'playwright';
import { goTo, openEventForm } from './lib/screens.mjs';
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

// Nothing should reach the network on this provider. Anything that does is
// the bug this suite exists to catch.
let netHits = 0;
await page.route(/generativelanguage|openrouter|api\.groq|perplexity|llm\.example/, (r) => {
  netHits++;
  r.abort();
});
await page.route(/nominatim|overpass|wikidata|wikipedia|googleapis\.com\/maps|tile\.|photon/, (r) => r.abort());

// The bridge, as the native plugin will present it.
const stub = (opts) => `
  window.Capacitor = window.Capacitor || {};
  window.Capacitor.isNativePlatform = () => true;
  window.Capacitor.Plugins = window.Capacitor.Plugins || {};
  window.__local = { generated: [], downloaded: 0, removed: 0 };
  window.Capacitor.Plugins.LocalModel = {
    status: async () => (${JSON.stringify(opts.present)}
      ? { present: true, name: 'qwen2.5-1.5b-instruct-q4_k_m.gguf', bytes: 1024 * 1024 * 986 }
      : { present: false }),
    download: async (o) => { window.__local.downloaded++; return { ok: true, name: o && o.name }; },
    remove: async () => { window.__local.removed++; return { ok: true }; },
    generate: async (o) => {
      window.__local.generated.push(o);
      return { text: ${JSON.stringify(opts.reply)}, inTokens: 40, outTokens: 20 };
    },
    addListener: () => ({ remove() {} }),
  };
`;

const seed = async ({ present = true, reply = '[]', settings = {} } = {}) => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(
    ([s, boot]) => {
      localStorage.clear();
      localStorage.setItem('boards-v1', JSON.stringify({
        activeId: 'b', boards: [{ id: 'b', name: 'Peak', destination: 'Bakewell', dated: true, createdAt: 1 }],
      }));
      localStorage.setItem('board:b:picks', JSON.stringify([
        { id: 'a:1', name: 'Bakewell', city: 'Bakewell', category: 'Town', lat: 53.2129, lon: -1.6753, major: true },
      ]));
      localStorage.setItem('board:b:folders', JSON.stringify(['Bakewell']));
      localStorage.setItem('trip-settings-v1', JSON.stringify(s));
      localStorage.setItem('__boot', boot);
    },
    [Object.assign({ aiProvider: 'ondevice' }, settings), stub({ present, reply })]
  );
  // The stub has to exist before app.js runs, the same way a real plugin does.
  await page.addInitScript(stub({ present, reply }));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
};

// ---------- It exists, and is honest ----------
await seed();
const cap = await page.evaluate(() => {
  const p = window.__tripTest.AI_PROVIDERS.ondevice;
  return p ? { ground: !!p.canGround, key: !!p.needsKey, url: !!p.needsBaseUrl, label: p.label } : null;
});
check('there is a provider that runs on the phone', !!cap, JSON.stringify(cap));
check('it needs no key', cap && !cap.key, JSON.stringify(cap));
check('and no address, because it is not somewhere else', cap && !cap.url, JSON.stringify(cap));
check('and it says it cannot search, which is the whole limitation',
  cap && !cap.ground, JSON.stringify(cap));

// ---------- Reasoning runs on it, and offline ----------
netHits = 0;
const answered = await page.evaluate(async () => {
  const r = await window.__tripTest.callModel('add two and two', { json: true });
  return { text: r.text, sources: r.sources.length, asked: window.__local.generated.length };
});
check('a reasoning call reaches the model on the phone', answered.asked === 1, JSON.stringify(answered));
check('and nothing at all goes over the network', netHits === 0, `${netHits} requests`);
check('and it cites nothing, because nothing was looked up', answered.sources === 0, JSON.stringify(answered));

// ---------- Tokens still counted, so the usage screen stays true ----------
const usage = await page.evaluate(() => JSON.parse(localStorage.getItem('ai-usage-v1') || 'null'));
check('what it did is still counted', usage && usage.total && usage.total.inTokens >= 40,
  JSON.stringify(usage && usage.total));

// ---------- What's on refuses, as it must ----------
await goTo(page, 'events', 400);
await openEventForm(page);
await page.evaluate(() => { const b = document.getElementById('evSearch'); if (b) b.click(); });
await page.waitForTimeout(900);
const shown = await page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
check('What\'s on refuses on a model that cannot search',
  /can't search|cannot search|needs a model that can search|searches the web/i.test(shown), shown.slice(0, 300));
check('and it did not ask the model anyway',
  await page.evaluate(() => window.__local.generated.length) === 1,
  await page.evaluate(() => String(window.__local.generated.length)));

// ---------- With no model downloaded ----------
await seed({ present: false });
check('with nothing downloaded it does not claim to be ready',
  await page.evaluate(async () => {
    if (window.__tripTest.refreshLocalModel) await window.__tripTest.refreshLocalModel();
    return !window.__tripTest.aiReady();
  }));

// ---------- Getting one, and getting rid of it ----------
await page.evaluate(() => window.__tripTest.openSettings());
await page.waitForTimeout(500);
check('Settings offers a model to download', await page.evaluate(() =>
  document.querySelectorAll('[data-get-model]').length >= 1),
  await page.evaluate(() => String(document.querySelectorAll('[data-get-model]').length)));
check('and says how big it is before you commit to it', await page.evaluate(() =>
  /\d+\s?(MB|GB)/i.test(document.getElementById('placeModal').textContent)),
  await page.evaluate(() => document.getElementById('placeModal').textContent.slice(0, 300)));
check('and warns about doing it on mobile data', await page.evaluate(() =>
  /wi-?fi/i.test(document.getElementById('placeModal').textContent)));

await page.evaluate(() => { const b = document.querySelector('[data-get-model]'); if (b) b.click(); });
await page.waitForTimeout(500);
check('asking for one asks the phone for it',
  await page.evaluate(() => window.__local.downloaded) === 1,
  await page.evaluate(() => String(window.__local.downloaded)));

await seed({ present: true });
await page.evaluate(() => window.__tripTest.openSettings());
await page.waitForTimeout(500);
check('once it is there, it can be deleted again',
  await page.evaluate(() => !!document.getElementById('removeModelBtn')));
await page.evaluate(() => { const b = document.getElementById('removeModelBtn'); if (b) b.click(); });
await page.waitForTimeout(400);
check('and deleting asks the phone to delete it',
  await page.evaluate(() => window.__local.removed) >= 1,
  await page.evaluate(() => String(window.__local.removed)));

// ---------- And in a plain browser, it is simply not on offer ----------
// A fresh page, because addInitScript cannot be taken back: reusing the one
// above would leave the stubbed bridge installed and quietly test nothing.
const plain = await browser.newPage();
await plain.setViewportSize({ width: 390, height: 844 });
await plain.route(/nominatim|overpass|wikidata|wikipedia|googleapis|tile\.|photon|generativelanguage/, (r) => r.abort());
await plain.goto(BASE, { waitUntil: 'load' });
await plain.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('trip-settings-v1', JSON.stringify({ aiProvider: 'ondevice' }));
});
await plain.reload({ waitUntil: 'load' });
await plain.waitForTimeout(700);
check('with no phone underneath it, it does not pretend to work',
  await plain.evaluate(() => !window.__tripTest.aiReady()));
check('and the app still runs rather than falling over',
  await plain.evaluate(() => !!document.getElementById('view').textContent.trim()));
await plain.close();

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
