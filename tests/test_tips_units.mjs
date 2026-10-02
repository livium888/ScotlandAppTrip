// The packing list's rules, tested in Node: what a new trip's list starts as,
// and how the count in the heading is worked out.
import { seedPacking, packingCount } from '../www/js/screens/tips.js';

let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };
const isChild = (p) => p.age != null && p.age < 16;
const defaults = ['Passport', 'Charger', 'Raincoat'];
const texts = (l) => l.map((i) => i.text);

const plain = seedPacking({ defaults, checked: {}, people: [{ age: 40 }, { age: 41 }], isChild });
check('adults only: just the defaults, none ticked', JSON.stringify(plain) === JSON.stringify(defaults.map((text) => ({ text, done: false }))));
check('ticks from the old global list are carried over by position', JSON.stringify(seedPacking({ defaults, checked: { 0: true, 2: true }, people: [], isChild }).map((i) => i.done)) === '[true,false,true]');
const fam = seedPacking({ defaults, checked: {}, people: [{ age: 40 }, { age: 3, buggy: true, naps: true }], isChild });
check('a buggy, a child and a napper each add a line, after the defaults', texts(fam).slice(3).join('|') ===
  'Buggy, and the rain cover for it|A comfort toy for the long legs|Whatever makes a nap happen away from home');
check('a child alone adds only the comfort toy', texts(seedPacking({ defaults, checked: {}, people: [{ age: 7 }], isChild })).slice(3).join('|') === 'A comfort toy for the long legs');
check('the added lines start unticked', fam.slice(3).every((i) => i.done === false));
check('nobody listed gives just the defaults', seedPacking({ defaults, checked: {}, people: [], isChild }).length === 3);
check('a stray non-object in the old ticks is tolerated', seedPacking({ defaults, checked: null, people: [], isChild }).length === 3);

check('the count is packed over total', JSON.stringify(packingCount([{ done: true }, { done: false }, { done: true }])) === '{"done":2,"total":3}');
check('an empty list counts as nothing', JSON.stringify(packingCount([])) === '{"done":0,"total":0}');

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
