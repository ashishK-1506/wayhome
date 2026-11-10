import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// app/journey-view.ts has only type imports, so it runs once TypeScript strips the types.
const source = await readFile(new URL('../app/journey-view.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { bestJourneys, legHasSeats, legView, shortStatus, summarize, toneOf } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

const offer = (classCode, status, extra = {}) => ({ id: classCode, source: 'irctc.dev', classCode, status, amount: null, currency: 'INR', priceBasis: 'person', checkedAt: '2026-11-10T09:00:00+05:30', ...extra });
const service = (id, departAt, arriveAt, offers = [], fares) => ({ id, mode: 'train', number: id, name: 'Test', from: { id: 'rail:PNBE', name: 'Patna Jn', cityId: 'patna' }, to: { id: 'rail:JMP', name: 'Jamalpur Jn', cityId: 'jamalpur' }, departAt, arriveAt, offers, ...(fares && { fares }) });
const journey = (...services) => ({ id: services.map(s => s.id).join('+'), services, selectedOffers: [], durationMinutes: 0, knownCost: 0, costComplete: false, offersOnAllLegs: false, transfers: [], feasibility: 'feasible', warnings: [] });

test('statuses read like a booking site, with closed and cancelled trains marked as such', () => {
  const read = (status, statusText, seats) => [shortStatus({ status, statusText, seats }), toneOf({ status, statusText, seats })];
  assert.deepEqual(read('available', 'AVAILABLE-0015', 15), ['AVL 15', 'available']);
  assert.deepEqual(read('available', 'AVAILABLE - 112', 112), ['AVL 112', 'available']);
  assert.deepEqual(read('available', 'AVAILABLE-0000', 0), ['AVL 0', 'closed']);
  assert.deepEqual(read('waitlist', 'RLWL18/WL16'), ['WL 16', 'waitlist']);
  assert.deepEqual(read('waitlist', 'GNWL135/WL62'), ['WL 62', 'waitlist']);
  assert.deepEqual(read('rac', 'RAC12/RAC3'), ['RAC 3', 'rac']);
  assert.deepEqual(read('waitlist', 'REGRET/RLWL27'), ['REGRET', 'closed']);
  assert.deepEqual(read('unknown', 'TRAIN CANCELLED'), ['TRAIN CANCELLED', 'closed']);
  assert.deepEqual(read('unknown', 'NOT AVAILABLE'), ['NOT AVAILABLE', 'closed']);
  assert.deepEqual(read('unknown', undefined), ['Status unclear', 'unknown']);
});

test('a leg shows the newest check in each class and the fares it knows', () => {
  const s = service('13334', '2026-11-26T06:35:00+05:30', '2026-11-26T09:29:00+05:30', [offer('SL', 'waitlist', { statusText: 'GNWL5/WL3' })], [{ classCode: 'SL', amount: 150 }, { classCode: '3A', amount: 520 }]);
  const later = offer('SL', 'available', { seats: 4, checkedAt: '2026-11-10T09:05:00+05:30' }), older = offer('3A', 'waitlist', { checkedAt: '2026-11-10T08:00:00+05:30' });
  const view = legView(s, { offers: [later, older] });
  assert.deepEqual(view.classes, ['SL', '3A']);
  assert.equal(view.offers.get('SL').status, 'available');
  assert.equal(view.fares.get('3A'), 520);
  assert.equal(legHasSeats(s, undefined, 1), false);
  assert.equal(legHasSeats(s, { offers: [later] }, 1), true);
  assert.equal(legHasSeats(s, { offers: [later] }, 5), false);   // four seats do not carry five people
  // Fares from a later check replace the search's.
  assert.equal(legView(s, { offers: [], fares: [{ classCode: '2A', amount: 725 }] }).fares.get('2A'), 725);
});

test('a journey’s price uses the cheapest class with seats, or its lowest fares when seats are unconfirmed', () => {
  const fares = [{ classCode: 'SL', amount: 150 }, { classCode: '3A', amount: 520 }];
  const seated = journey(service('A', '2026-11-26T06:35:00+05:30', '2026-11-26T09:29:00+05:30', [offer('3A', 'available', { seats: 9 }), offer('SL', 'waitlist')], fares));
  assert.deepEqual(['allSeats', 'price', 'from'].map(k => summarize(seated, {}, 2)[k]), [true, 1040, 300]);
  const unconfirmed = journey(service('B', '2026-11-26T06:35:00+05:30', '2026-11-26T09:29:00+05:30', [], fares));
  assert.deepEqual(['allSeats', 'price', 'from'].map(k => summarize(unconfirmed, {}, 1)[k]), [false, null, 150]);
  const twoLegs = journey(service('C', '2026-11-26T05:00:00+05:30', '2026-11-26T07:00:00+05:30', [], fares), service('D', '2026-11-26T08:00:00+05:30', '2026-11-26T10:00:00+05:30'));
  assert.equal(summarize(twoLegs, {}, 1).from, null);   // one leg has no fares, so no total
});

test('journeys another one beats outright are left out of the first list', () => {
  const at = time => `2026-11-26T${time}:00+05:30`, seats = [offer('SL', 'available', { seats: 9, amount: 150 })];
  const direct = journey(service('direct', at('06:35'), at('09:29'), seats));
  const earlier = journey(service('earlier', at('06:10'), at('09:10'), seats));
  // Leaves earlier and arrives later than "direct", with a change and no seats: beaten.
  const slow = journey(service('slow-1', at('05:00'), at('07:00')), service('slow-2', at('08:00'), at('12:00')));
  // The same times as "direct" without seats, but cheaper: kept, because it costs less.
  const cheaper = journey(service('cheaper', at('06:35'), at('09:29'), [], [{ classCode: 'SL', amount: 100 }]));
  // Identical to "direct" in every way but without seats and dearer: beaten.
  const worse = journey(service('worse', at('06:35'), at('09:29'), [], [{ classCode: 'SL', amount: 200 }]));
  const kept = bestJourneys([direct, earlier, slow, cheaper, worse], {}, 1).map(j => j.id);
  assert.deepEqual(kept, ['direct', 'earlier', 'cheaper']);
  // A seat check that confirms seats can bring a journey back.
  const checks = { cheaper: { offers: [offer('SL', 'available', { seats: 3, amount: 100 })] } };
  assert(bestJourneys([direct, cheaper], checks, 1).some(j => j.id === 'cheaper'));
});
