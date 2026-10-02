// The kids rules, tested in Node: which saved places count as for children,
// how the screen is titled, and how a search is worded for the ages actually
// coming.
import { KID_SEARCHES, looksLikeKidPlace, isForKids, kidsTitleFor, forOurKids } from '../www/js/lib/kids.js';

let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

// ---------- which places are for children ----------
check('a playground, zoo or soft play identifies itself', ['Playground', 'Zoo', 'Soft play centre', 'Aquarium', 'Beach', 'Theme park']
  .every((category) => looksLikeKidPlace({ category })));
check('it also reads the type and the description', looksLikeKidPlace({ type: 'swimming pool' }) && looksLikeKidPlace({ description: 'A lovely farm park' }));
check('a castle or a cathedral does not - only a person can say', !looksLikeKidPlace({ category: 'Castle' }) && !looksLikeKidPlace({ name: 'Cathedral' }) && !looksLikeKidPlace({}));
check('your yes wins over what the app thinks', isForKids({ category: 'Castle', forKids: true }) === true);
check('your no wins too', isForKids({ category: 'Playground', forKids: false }) === false);
check('with no opinion given, the app\'s reading is used', isForKids({ category: 'Playground' }) === true && isForKids({ category: 'Pub' }) === false);

// ---------- the title ----------
check('one named child is named', kidsTitleFor([{ name: 'Ella' }]) === 'For Ella');
check('two are joined', kidsTitleFor([{ name: 'Ella' }, { name: ' Sam ' }]) === 'For Ella and Sam');
check('three, or none, or no names, get the plain title', kidsTitleFor([{ name: 'A' }, { name: 'B' }, { name: 'C' }]) === 'For the kids' &&
  kidsTitleFor([]) === 'For the kids' && kidsTitleFor([{ name: '' }, {}]) === 'For the kids');

// ---------- wording a search for the ages ----------
const q = 'indoor soft play or play barn for young children';
check('with no ages known, the question is unchanged', forOurKids(q, []) === q && forOurKids(q, [{ name: 'Ella' }]) === q);
check('one child: their age', forOurKids('playground with something for a young child', [{ age: 3 }]) === 'playground with something for a 3-year-old');
check('several: all the ages, youngest first', forOurKids(q, [{ age: 9 }, { age: 3 }]) === 'indoor soft play or play barn for children aged 3 and 9');
check('a child with no age is skipped, not shown as undefined', !/undefined|null/.test(forOurKids(q, [{ age: 5 }, {}])));
check('every ready-made kids search is worded to be rewritten', KID_SEARCHES.length === 8 && KID_SEARCHES.every((s) => s.icon && s.label && s.query));

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
