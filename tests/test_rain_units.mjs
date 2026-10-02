// The rain plan's rules, tested in Node.
//
// The app already warns about an outdoor event on a wet day. What it did not
// do is help: on a rainy planned day, say which stops are outdoors, and offer
// the way to indoor alternatives near them. The rules for what counts as an
// outdoor stop and what counts as wet are pure, so they are checked here; the
// banner and the button are checked in the browser.
import { isOutdoorPick, rainPlan, rainBannerHtml, rainCategoryKey } from '../www/js/lib/rain.js';

let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

// ---------- what is outdoors ----------
check('an event that says it is outdoors is', isOutdoorPick({ kind: 'event', name: 'Fun day', setting: 'outdoor' }));
check('an event that is indoors, or some of each, is not - no nagging about half-covered things', !isOutdoorPick({ kind: 'event', name: 'Fun day', setting: 'indoor' }) && !isOutdoorPick({ kind: 'event', name: 'Fun day', setting: 'both' }));
check('parks, beaches, walks, gardens and playgrounds are', ['Park', 'Beach', 'Coastal walk', 'Garden', 'Playground', 'Forest trail', 'Viewpoint'].every((category) => isOutdoorPick({ name: 'X', category })));
check('the name and description count too', isOutdoorPick({ name: 'Southsea Beach' }) && isOutdoorPick({ name: 'X', description: 'a lovely woodland walk' }));
check('museums, cinemas, soft play and cafes are not', ['Museum', 'Cinema', 'Soft play', 'Cafe', 'Theatre', 'Aquarium', 'Gallery'].every((category) => !isOutdoorPick({ name: 'X', category })));
check('"indoor" wins over a word that sounds outdoors', !isOutdoorPick({ name: 'Indoor playground', category: 'Soft play' }) && !isOutdoorPick({ name: 'Park Road Museum' }));
check('a town heading is not a stop', !isOutdoorPick({ name: 'Bakewell Park', major: true, category: 'Park' }));
check('a place nothing is known about is left alone rather than guessed at', !isOutdoorPick({ name: 'Mystery' }) && !isOutdoorPick({}));

// ---------- a wet day ----------
const stops = [
  { id: 'a', name: 'Cafe', category: 'Cafe', lat: 1, lon: 1 },
  { id: 'b', name: 'Fareham Park', category: 'Park', lat: 2, lon: 2 },
  { id: 'c', name: 'Beach Walk', category: 'Beach', lat: 3, lon: 3 },
  { id: 'd', name: 'Museum', category: 'Museum' },
];
const wet = rainPlan({ stops, rainChance: 70 });
check('a likely-wet day with outdoor stops gives a plan, in the order of the day', wet && wet.chance === 70 && wet.outdoor.map((p) => p.name).join() === 'Fareham Park,Beach Walk');
check('the search is centred on the first outdoor stop', wet.first.id === 'b');
check('at the threshold it counts as wet; below it does not', rainPlan({ stops, rainChance: 50 }) !== null && rainPlan({ stops, rainChance: 49 }) === null);
check('no forecast, or an unknown chance, gives nothing', rainPlan({ stops, rainChance: null }) === null && rainPlan({ stops, rainChance: undefined }) === null);
check('a wet day with nothing outdoors gives nothing', rainPlan({ stops: [stops[0], stops[3]], rainChance: 90 }) === null);
check('an empty day gives nothing', rainPlan({ stops: [], rainChance: 90 }) === null);
check('the first outdoor stop that has a place on the map is preferred as the centre', rainPlan({ stops: [{ id: 'x', name: 'Park A', category: 'Park' }, { id: 'y', name: 'Park B', category: 'Park', lat: 5, lon: 5 }], rainChance: 80 }).first.id === 'y');
check('if none has a place on the map, the first is still named', rainPlan({ stops: [{ id: 'x', name: 'Park A', category: 'Park' }], rainChance: 80 }).first.id === 'x');
check('the threshold can be changed', rainPlan({ stops, rainChance: 30, threshold: 30 }) !== null);

// ---------- the banner ----------
const icon = (n) => `<i:${n}>`;
const html = rainBannerHtml(wet, icon);
check('it says it in words: the chance, and which stops are outdoors', /Rain likely \(70%\)/.test(html) && /Fareham Park/.test(html) && /Beach Walk/.test(html));
check('it offers one button, aimed at the first outdoor stop', (html.match(/data-rain-search=/g) || []).length === 1 && /data-rain-search="b"/.test(html) && /Find indoor options/.test(html));
check('it is announced to a screen reader and is not only a colour', /role="status"/.test(html) && /<i:umbrella>|<i:rain>|<i:/.test(html));
check('many outdoor stops are summarised rather than listed in full', /and 2 more/.test(rainBannerHtml(rainPlan({ stops: ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({ id: n, name: `Park ${n}`, category: 'Park', lat: i, lon: i })), rainChance: 80 }), icon)));
check('a hostile name cannot break the banner', !/<script/.test(rainBannerHtml(rainPlan({ stops: [{ id: 'z', name: '<script>alert(1)</script> Park', category: 'Park', lat: 1, lon: 1 }], rainChance: 80 }), icon)));
check('nothing is rendered when there is no plan', rainBannerHtml(null, icon) === '');

// ---------- which indoor search ----------
check('with children the indoor search is the child-friendly one, otherwise the general one', rainCategoryKey(true) === 'rainy' && rainCategoryKey(false) === 'rain');

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
