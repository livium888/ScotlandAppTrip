// The markup of a saved place's row, the heading of a town, the photo block,
// and finding among what is saved - tested in Node.
//
// These were string-building functions inside app.js that every list shared.
// Given their inputs they are pure, so what they print can be checked without
// a page: the badges, the escaping, what goes in the meta line.
import { CATEGORY_ICONS, categoryIcon, FIND_KEYS, findInPicks, createPickRows } from '../www/js/screens/pickrows.js';

let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const icon = (name) => `<i:${name}>`;
const plan = { days: [{ id: 'd1', label: 'Day 1 · Sat 15 Aug' }, { id: 'd2', label: 'Day 2 · Sun 16 Aug' }], items: { d1: [{ pickId: 'p1' }], d2: [{ pickId: 'p1' }, { pickId: 'p9' }] } };
const rows = createPickRows({ icon, loadPlan: () => plan, eventDateLabel: (p) => `DATE ${p.name}`, eventIsPast: (p) => !!p.past });

// ---------- icons by category ----------
check('a place gets an icon from its category, name or description', categoryIcon({ category: 'Castle' }) === 'castle' && categoryIcon({ name: 'The Old Pub' }) === 'food' &&
  categoryIcon({ description: 'a soft play barn' }) === 'kids' && categoryIcon({ category: 'Beach' }) === 'walk');
check('and a plain pin when nothing fits', categoryIcon({ category: 'Zzz' }) === 'pin' && categoryIcon({}) === 'pin');
check('the first rule that fits wins', categoryIcon({ category: 'Castle pub' }) === 'castle' && CATEGORY_ICONS.length === 9);

// ---------- the photo ----------
check('a place with a picture gets an image keyed on its address, lazy loaded', /<img src="https:\/\/x.example\/a.jpg" data-photo="https:\/\/x.example\/a.jpg" alt="" loading="lazy"/.test(rows.photoBlock({ photo: 'https://x.example/a.jpg' }, 'thumb')));
check('the picture address is escaped', !/"onerror/.test(rows.photoBlock({ photo: 'a" onerror="x' }, 'thumb')) && /&quot;/.test(rows.photoBlock({ photo: 'a" onerror="x' }, 'thumb')));
check('with no picture it is an icon square, small in a row and large in a sheet', /photo-thumb photo-none"><i:castle>/.test(rows.photoBlock({ category: 'Castle' }, 'thumb')) &&
  /photo-hero photo-none"><i:castle>/.test(rows.photoBlock({ category: 'Castle' }, 'hero')));

// ---------- the actions behind a row ----------
const act = rows.rowActions('p"1');
check('swipe actions are for day and remove, with the id escaped, and hidden from the keyboard and screen readers', /data-row-day="p&quot;1"/.test(act) && /data-row-remove="p&quot;1"/.test(act) &&
  /aria-hidden="true"/.test(act) && (act.match(/tabindex="-1"/g) || []).length === 2);

// ---------- a row ----------
const base = { id: 'p1', name: 'Edinburgh Castle', category: 'Castle' };
let h = rows.renderPickRow(base, null, undefined, false);
check('a row shows the name and, by default, the category', />Edinburgh Castle</.test(h) && /pick-row-meta">Castle</.test(h) && /data-open-pick="p1"/.test(h));
check('a place on days shows each day, short', /row-badge day">Sat 15</.test(h) && /row-badge day">Sun 16</.test(h));
check('grouped by day the days are left off, since the heading says it', !/row-badge day/.test(rows.renderPickRow(base, null, undefined, true)));
check('what the list is told to show replaces the category, and distance follows', /pick-row-meta">Edinburgh · 2\.0 mi</.test(rows.renderPickRow(base, '2.0 mi', 'Edinburgh', false)));
check('an empty "extra" means no meta rather than the category', !/pick-row-meta/.test(rows.renderPickRow({ ...base, category: '' }, null, '', false)));
check('a rating is drawn as a star and is not escaped away', /pick-row-meta">Castle · <i:star> 4\.5</.test(rows.renderPickRow({ ...base, rating: 4.5 }, null, undefined, false)));
check('booked, note, doubt and loading are badges', ['booked', 'note', 'location?', 'loading…'].every((b) =>
  rows.renderPickRow({ ...base, booked: true, note: 'x', geoAlternatives: [1], enrichStatus: 'loading' }, null, undefined, true).includes(b)));
const ev = { id: 'e1', name: 'Folk Night', kind: 'event', category: 'Music' };
check('an event shows its date instead of its category', /pick-row-meta">DATE Folk Night</.test(rows.renderPickRow(ev, null, 'ignored', false)));
check('an event that has been is faded and says so', /pick-row-past/.test(rows.renderPickRow({ ...ev, past: true }, null, undefined, false)) && /been and gone/.test(rows.renderPickRow({ ...ev, past: true }, null, undefined, false)));
check('an unverified upcoming event says to check it is on, a past one does not', /check it's on/.test(rows.renderPickRow({ ...ev, unverified: true }, null, undefined, false)) &&
  !/check it's on/.test(rows.renderPickRow({ ...ev, unverified: true, past: true }, null, undefined, false)));
check('a hostile name cannot break out of the row', !/<script/.test(rows.renderPickRow({ ...base, name: '<script>alert(1)</script>' }, null, undefined, false)));

// ---------- a town's heading ----------
const mh = rows.renderMajorHeader({ id: 'm1', name: 'Stirling' }, 3, false);
check('a town heading counts its places and can be folded', /3 places saved here/.test(mh) && /data-fold="Stirling"/.test(mh) && /aria-expanded="true"/.test(mh) && /data-explore-from="m1"/.test(mh));
check('one place is singular, none says so and offers no fold', /1 place saved here/.test(rows.renderMajorHeader({ id: 'm', name: 'S' }, 1, false)) &&
  /Nothing saved here yet/.test(rows.renderMajorHeader({ id: 'm', name: 'S' }, 0, false)) && !/area-fold/.test(rows.renderMajorHeader({ id: 'm', name: 'S' }, 0, false)));
check('folded, it says it will open', /aria-expanded="false"/.test(rows.renderMajorHeader({ id: 'm', name: 'S' }, 2, true)) && /aria-label="Open S"/.test(rows.renderMajorHeader({ id: 'm', name: 'S' }, 2, true)));

// ---------- the find box ----------
check('with few places saved there is no find box, unless a search is under way', rows.findBarHtml(7, '') === '' && /id="pickFind"/.test(rows.findBarHtml(8, '')) && /id="pickFind"/.test(rows.findBarHtml(2, 'cas')));
check('what has been typed is kept, escaped, with a clear button', /value="a&quot;b"/.test(rows.findBarHtml(20, 'a"b')) && /id="pickFindClear"/.test(rows.findBarHtml(20, 'a"b')) && !/pickFindClear/.test(rows.findBarHtml(20, '')));

// ---------- finding among what is saved ----------
const saved = [
  { name: 'Edinburgh Castle', city: 'Edinburgh', category: 'Castle', note: '' },
  { name: 'The Sheep Heid Inn', city: 'Duddingston', category: 'Pub', note: 'best Sunday roast' },
  { name: 'Zoo', city: 'Edinburgh', category: 'Zoo' },
];
check('the fields searched, and how much each counts', FIND_KEYS.map((k) => k.name).join() === 'name,city,category,note,address' && Math.abs(FIND_KEYS.reduce((a, k) => a + k.weight, 0) - 1) < 1e-9);
check('nothing typed gives the whole list back', findInPicks(saved, '') === saved && findInPicks(saved, '   ') === saved);
check('without the matching library a plain match runs over the same fields', findInPicks(saved, 'roast').map((p) => p.name).join() === 'The Sheep Heid Inn' &&
  findInPicks(saved, 'edinburgh').length === 2 && findInPicks(saved, 'nope').length === 0);
class FakeFuse { constructor(list, opts) { FakeFuse.last = opts; this.list = list; } search(q) { return this.list.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).map((item) => ({ item })); } }
check('with it, matching is typo tolerant by its settings and returns the items', findInPicks(saved, 'zoo', FakeFuse).map((p) => p.name).join() === 'Zoo' &&
  FakeFuse.last.threshold === 0.38 && FakeFuse.last.ignoreLocation === true && FakeFuse.last.minMatchCharLength === 2);

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
