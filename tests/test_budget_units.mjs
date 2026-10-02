// The budget's arithmetic and wording, tested in Node.
//
// The budget screen was 400 lines in app.js mixing three things: working out
// the numbers, drawing them, and talking to the model. The first and last are
// pure, and now live in screens/budget.js where they can be tested without a
// browser. The drawing is still covered by test_budget.mjs.
import { budgetPrompt, normaliseBudget, computeBudgetLines, splitLine } from '../www/js/screens/budget.js';

let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };
const money = (n) => `£${Number(n).toFixed(Number.isInteger(n) ? 0 : 2)}`;
const pickCost = (p) => { const n = Number(p.cost); return Number.isFinite(n) && n > 0 ? n : 0; };

// ---------- the question asked of the model ----------
const q = budgetPrompt({ names: ['Castle', 'Cafe'], days: 3, miles: 120, who: 'two adults and a child', destination: 'Bakewell' });
check('it names the group, place, length and driving', /two adults and a child/.test(q) && /Destination: Bakewell/.test(q) && /3 day\(s\)/.test(q) && /120 miles/.test(q));
check('it lists every place, exactly as named, and asks for JSON only', /- Castle\n- Cafe/.test(q) && /Reply as JSON only/.test(q));
check('with no destination or driving it does not mention them', !/Destination:/.test(budgetPrompt({ names: ['A'], days: 0, miles: 0, who: '' })) &&
  !/miles of driving/.test(budgetPrompt({ names: ['A'], days: 0, miles: 0, who: '' })) && /1 day\(s\)/.test(budgetPrompt({ names: ['A'], days: 0, miles: 0, who: '' })) &&
  /two adults/.test(budgetPrompt({ names: ['A'], days: 1, miles: 0, who: '' })));

// ---------- what comes back ----------
const est = normaliseBudget({
  places: [{ name: 'Castle', low: '10', high: 5, note: 'family ticket' }, { name: 'Nothing' }, { low: 1 }, null],
  foodPerDay: { low: 20, high: 40 }, fuelTotal: { low: -5, high: 'x' }, stayPerNight: undefined,
});
check('place names are matched in lower case, and unnamed ones dropped', Object.keys(est.places).sort().join() === 'castle,nothing');
check('a high below its low is raised to the low, and numbers are read from text', est.places.castle.low === 10 && est.places.castle.high === 10 && est.places.castle.note === 'family ticket');
check('negative, missing and non-numeric amounts become zero', est.fuelTotal.low === 0 && est.fuelTotal.high === 0 && est.stayPerNight.high === 0);
check('it is stamped with when it was made', Math.abs(est.at - Date.now()) < 2000);
check('garbage in gives an empty estimate, not an error', Object.keys(normaliseBudget(null).places).length === 0);

// ---------- the lines ----------
const plan = { days: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }] };
const picks = [
  { id: 'p1', name: 'Castle', cost: 12 },
  { id: 'p2', name: 'Cafe' },
  { id: 'p3', name: 'Mystery' },
];
const full = normaliseBudget({ places: [{ name: 'Cafe', low: 8, high: 15, note: 'lunch' }, { name: 'Castle', low: 1, high: 2 }],
  foodPerDay: { low: 20, high: 30 }, fuelTotal: { low: 10, high: 20 }, stayPerNight: { low: 80, high: 120 } });
full.miles = 90;
const a = computeBudgetLines({ est: full, picks, plan, extras: [], pickCost, money });
const by = (id) => a.places.find((l) => l.id === id);
check('your own price outranks the estimate', by('p1').low === 12 && by('p1').high === 12 && by('p1').source === 'yours' && by('p1').note === 'your price');
check('an estimated place says so, with its note', by('p2').source === 'estimate' && by('p2').low === 8 && by('p2').high === 15 && by('p2').note === 'lunch');
check('a place with neither is unknown, at zero', by('p3').source === 'unknown' && by('p3').low === 0);
const food = a.trip.find((l) => l.key === 'food'), fuel = a.trip.find((l) => l.key === 'fuel'), stay = a.trip.find((l) => l.key === 'stay');
check('food is per day, over the days planned', food.low === 60 && food.high === 90 && /3 days/.test(food.name));
check('beds are per night, and a three-day plan is two nights', stay.low === 160 && stay.high === 240 && /2 nights/.test(stay.name));
check('fuel is one total and quotes the driving in the plan', fuel.low === 10 && /90 miles/.test(fuel.note));
check('with no estimate there are no trip lines', computeBudgetLines({ est: null, picks, plan, extras: [], pickCost, money }).trip.length === 0);
check('a one-day plan has no nights to pay for', !computeBudgetLines({ est: full, picks, plan: { days: [{ id: 'd1' }] }, extras: [], pickCost, money }).trip.some((l) => l.key === 'stay'));
const b = computeBudgetLines({ est: full, picks, plan, extras: [{ item: 'Ferry', amount: 40 }, { item: 'Eating, 3 days', amount: 100, overrides: 'food' }], pickCost, money });
const bfood = b.trip.find((l) => l.key === 'food');
check('a price you put on a trip line replaces the estimate for it', bfood.low === 100 && bfood.high === 100 && bfood.source === 'yours' && bfood.note === 'your price');
check('overrides are not listed as costs of their own, but real extras are', b.own.length === 1 && b.own[0].item === 'Ferry');
check('the major places (towns) are for the caller to leave out, lines are per saved place', a.places.length === 3);

// ---------- the split ----------
const adult = { name: 'A', age: 38 }, kid = { name: 'K', age: 5 };
const isChild = (p) => p.age < 16;
const html = splitLine({ people: [adult, adult, kid], isChild, low: 400, high: 600, money });
check('adults pay a share each and a child half', /£200 an adult/.test(html) && /£100 a child/.test(html) && /across 3 of you/.test(html), html);
check('one person, or no money, gives no split line', splitLine({ people: [adult], isChild, low: 1, high: 2, money }) === '' &&
  splitLine({ people: [adult, kid], isChild, low: 0, high: 0, money }) === '');
check('with no adults at all there is nothing to divide by... except children, who count half', /an adult/.test(splitLine({ people: [kid, kid], isChild, low: 100, high: 100, money })) ||
  splitLine({ people: [kid, kid], isChild, low: 100, high: 100, money }) === '');

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
