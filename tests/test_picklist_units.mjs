// The saved-places list machinery, tested in Node: how a day is ordered, how
// places are cut into sections for each of the four orders, and the little
// controls drawn above the list.
//
// These were spread through app.js and shared by Saved and Kids. They are
// pure given their inputs, so they can be checked without a page - and moved
// out so both screens can be.
import { planItems, itemsInDayOrder, nextItemIndex } from '../www/js/lib/plan.js';
import { SORTS, normaliseSort, groupPicks, sectionHeadHtml, foldAllHtml, sortRowHtml } from '../www/js/screens/picklist.js';

let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };
const names = (s) => s.map((x) => x.label);
const rows = (s) => s.map((x) => x.rows.map((r) => r.pick.name));

// ---------- a day, in the order you will walk it ----------
check('items with no day are an empty list', planItems({ items: {} }, 'd1').length === 0 && planItems({ items: { d1: [1] } }, 'd1').length === 1);
const day = [{ pickId: 'a', time: '14:00' }, { pickId: 'b' }, { pickId: 'c', time: '09:30' }, { pickId: 'd' }, { pickId: 'e', time: '2pm' }];
check('timed stops come first by time, untimed keep their order at the end',
  itemsInDayOrder(day).map((i) => i.pickId).join('') === 'caebd', itemsInDayOrder(day).map((i) => i.pickId).join(''));
check('ordering never changes the list it was given', day[0].pickId === 'a' && day.length === 5);
const ordered = [{ time: '09:00' }, { time: '12:00' }, { time: '16:00' }];
check('on another day the first stop is next', nextItemIndex(ordered, false, new Date()) === 0 && nextItemIndex([], false, new Date()) === -1);
check('today, the next stop is the first not long past', nextItemIndex(ordered, true, new Date(2026, 9, 3, 11, 0)) === 1 &&
  nextItemIndex(ordered, true, new Date(2026, 9, 3, 12, 30)) === 1);
check('a stop stays "next" for an hour after its time, and nothing is next after the last', nextItemIndex(ordered, true, new Date(2026, 9, 3, 13, 5)) === 2 &&
  nextItemIndex(ordered, true, new Date(2026, 9, 3, 18, 0)) === -1);

// ---------- the orders ----------
check('there are four, in the order offered', SORTS.map((s) => s.key).join() === 'area,day,near,recent');
check('a saved choice is checked, and the retired "name" means by area', normaliseSort('near') === 'near' && normaliseSort('name') === 'area' &&
  normaliseSort('nonsense') === 'area' && normaliseSort(undefined) === 'area');

// ---------- sections ----------
const list = [
  { id: 'p1', name: 'Castle', city: 'Edinburgh', category: 'Castle', lat: 55.9486, lon: -3.1999, addedAt: 1 },
  { id: 'p2', name: 'Abbey', city: 'Stirling', category: 'Abbey', lat: 56.1165, lon: -3.9369, addedAt: 3 },
  { id: 'p3', name: 'Zoo', city: 'Edinburgh', category: 'Zoo', lat: 55.9420, lon: -3.2700, addedAt: 2 },
  { id: 'p4', name: 'Mystery', category: 'Pub', addedAt: 4 },
];
const plan = { days: [{ id: 'd1', label: 'Day 1 · Sat 15 Aug' }, { id: 'd2', label: 'Day 2 · Sun 16 Aug' }],
  items: { d1: [{ pickId: 'p3', time: '14:00' }, { pickId: 'p1', time: '10:00' }], d2: [] } };
const inputs = { origin: list[0], plan: () => plan, folders: () => ['Edinburgh', 'Stirling'] };

let g = groupPicks(list, 'area', inputs);
check('by area: sections follow the folders list, then Unsorted, A-Z inside', JSON.stringify(names(g)) === '["Edinburgh","Stirling","Unsorted"]' &&
  JSON.stringify(rows(g)) === '[["Castle","Zoo"],["Abbey"],["Mystery"]]', JSON.stringify(rows(g)));
check('by area: a town with no folder yet still gets a section', names(groupPicks([{ id: 'x', name: 'X', city: 'Leith' }], 'area', inputs)).join() === 'Leith');
check('by area: each row carries its category and each section its count', g[0].rows[0].meta === 'Castle' && g[0].count === 2 && g[0].area === 'Edinburgh');

g = groupPicks(list, 'recent', inputs);
check('just added: one list, newest first', g.length === 1 && g[0].label === 'Newest first' && rows(g)[0].join() === 'Mystery,Abbey,Zoo,Castle');

g = groupPicks(list, 'near', inputs);
check('nearest: one list from the origin outward, unknown places last', g.length === 1 && rows(g)[0].join() === 'Castle,Zoo,Abbey,Mystery', rows(g)[0].join());
check('nearest: titled with where it is near, and each row says how far', g[0].label === 'Closest to Castle' && g[0].rows[1].away && /mi|yd/.test(g[0].rows[1].away) && g[0].rows[0].away === null);
check('nearest with nowhere to be near is still a list', groupPicks(list, 'near', { ...inputs, origin: null })[0].label === 'Closest first');

g = groupPicks(list, 'day', inputs);
check('by day: a section per day, named for the day, stops in time order', JSON.stringify(names(g.filter((s) => !s.loose))) === '["Sat 15"]' &&
  rows(g)[0].join() === 'Castle,Zoo', JSON.stringify(g.map((s) => [s.label, s.rows.map((r) => r.pick.name + '|' + r.meta)])));
check('by day: each row carries its time and town', g[0].rows[0].meta === '10:00 · Edinburgh');
check('by day: whatever is not on a day yet collects last, flagged', g[g.length - 1].loose === true && g[g.length - 1].label === 'Not on a day yet' &&
  rows([g[g.length - 1]])[0].join() === 'Abbey,Mystery');
check('by day: an empty day is left out', !names(g).includes('Sun 16'));

// ---------- the controls ----------
const icon = (name) => `<i>${name}</i>`;
check('a section heading is a button that says whether it is folded, and its count', /aria-expanded="true"/.test(sectionHeadHtml('Edinburgh', 4, false, icon)) &&
  /aria-expanded="false"/.test(sectionHeadHtml('Edinburgh', 4, true, icon)) && />4</.test(sectionHeadHtml('Edinburgh', 4, false, icon)));
check('a heading escapes the name of the place', !/<script/.test(sectionHeadHtml('<script>', 1, false, icon)));
check('"fold all" is only offered once there are three sections', foldAllHtml(['a', 'b'], []) === '' && /Fold all/.test(foldAllHtml(['a', 'b', 'c'], [])));
check('and it becomes "open all" when everything is folded', /Open all/.test(foldAllHtml(['a', 'b', 'c'], ['a', 'b', 'c'])) && /data-fold-all="open"/.test(foldAllHtml(['a', 'b', 'c'], ['a', 'b', 'c'])));
check('the order control is one button naming the current order', /id="sortToggle"/.test(sortRowHtml('near', false, icon)) && /Nearest/.test(sortRowHtml('near', false, icon)) && !/data-sort=/.test(sortRowHtml('near', false, icon)));
check('opened, it offers all four, marks the current one and explains it', (sortRowHtml('day', true, icon).match(/data-sort=/g) || []).length === 4 &&
  /order-chip on" data-sort="day"/.test(sortRowHtml('day', true, icon)) && /In the order you(&#39;|')ll do them/.test(sortRowHtml('day', true, icon)));

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
