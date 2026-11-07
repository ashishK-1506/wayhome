// Randomized property tests: rules that must hold for every input, checked on many generated
// searches and service networks. Seeds are fixed, so any failure can be reproduced exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchPlan, validateSearch, ValidationError, LIMITS, addDays, istDate } from '../lib/planner.mjs';
import { evaluateJourneys, offerAvailable, offerAmount, safeBookingUrl } from '../lib/engine.mjs';
import { PLACES, findPlace } from '../lib/catalog.mjs';

const NOW = Date.parse('2026-11-04T10:13:00+05:30'), TODAY = istDate(NOW), LAST = addDays(TODAY, 60), MIN = 60000, H = 60 * MIN;
const HUB_COUNT = { quick: 4, thorough: 8, extended: 16 }, MODE_SETS = [['train', 'flight', 'bus', 'carpool'], ['train'], ['flight'], ['bus'], ['carpool'], ['bus', 'carpool'], ['train', 'flight'], ['train', 'bus']];
// mulberry32: a small, well-mixed pseudo-random generator.
const random = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const R = Math.PI / 180, km = (a, b) => 12742 * Math.asin(Math.sqrt(Math.sin((b.lat - a.lat) * R / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin((b.lon - a.lon) * R / 2) ** 2));
const iso = t => new Date(t).toISOString();

// Longest linked chain of planned queries for one departure date (see planner.test.mjs).
function chainForDate(plan, date) {
  const usable = plan.queries.filter(q => q.purpose === 'direct' || q.purpose === 'feeder' ? q.date === date : q.date >= date);
  const next = new Map(); for (const q of usable) { if (!next.has(q.from)) next.set(q.from, []); next.get(q.from).push(q); }
  const ends = new Set([...plan.destination.rail, plan.destination.name]); let best = 0;
  const walk = (node, legs, after, seen) => { if (ends.has(node)) { best = Math.max(best, legs); return; } for (const q of next.get(node) || []) if (q.date >= after && !seen.has(q.to)) walk(q.to, legs + 1, q.date, new Set([...seen, q.to])); };
  for (const start of [...plan.origin.rail, ...plan.origin.airports, plan.origin.name]) walk(start, 0, date, new Set([start]));
  return best;
}

function checkPlan(input) {
  const p = buildSearchPlan(input, NOW, 'fixed'), q = p.query, label = `${q.originId} to ${q.destinationId}, ${q.depth} ±${q.flexibility} ${q.date} [${q.modes}]`;
  const origin = findPlace(q.originId), destination = findPlace(q.destinationId), roadModes = q.modes.filter(m => m === 'bus' || m === 'carpool');
  assert.equal(p.queries.length, Math.min(LIMITS[q.depth].maxRequests, p.proposedQueryCount), label);
  assert.equal(p.omittedQueryCount, p.proposedQueryCount - p.queries.length, label);
  assert.equal(new Set(p.queries.map(x => x.id)).size, p.queries.length, `${label}: unique ids`);
  const hubTerms = new Set(p.hubs.flatMap(name => { const h = PLACES.find(x => x.name === name); return [h.rail[0], h.name]; }));
  const fromOrigin = new Set([...origin.rail, ...origin.airports, origin.name]), toDestination = new Set([...destination.rail, ...destination.airports, destination.name]);
  for (const x of p.queries) {
    assert.equal(x.id, [x.provider, x.from, x.to, x.date, x.passengers].join('|'), label);
    assert(x.from !== x.to && x.date >= TODAY && x.date <= LAST && x.status === 'not_attempted' && x.passengers === q.passengers, label);
    assert(x.modes.every(m => q.modes.includes(m)), `${label}: only selected modes`);
    if (x.provider === 'confirmtkt') assert.deepEqual(x.modes, ['train'], label);
    if (x.provider === 'skyscanner') assert.deepEqual(x.modes, ['flight'], label);
    if (x.provider === 'blablacar') assert.deepEqual([...x.modes].sort(), [...roadModes].sort(), label);
    const ok = { direct: fromOrigin.has(x.from) && toDestination.has(x.to), feeder: fromOrigin.has(x.from) && hubTerms.has(x.to), onward: hubTerms.has(x.from) && toDestination.has(x.to), interhub: hubTerms.has(x.from) && hubTerms.has(x.to) }[x.purpose];
    assert(ok, `${label}: ${x.purpose} ${x.from} to ${x.to}`);
    if (q.depth === 'quick') assert.notEqual(x.purpose, 'interhub', label);
  }
  // Every date with something to search gets queries (a flights-only search between two cities
  // that share their only airport has nothing); the chosen date gets a direct query from every source.
  assert.deepEqual(p.dateCoverage.map(d => d.date), p.dates, label);
  for (const d of p.dateCoverage) assert(d.planned <= d.proposed && (d.proposed === 0 || d.planned > 0), `${label}: ${d.date} covered`);
  const sources = { confirmtkt: q.modes.includes('train'), skyscanner: q.modes.includes('flight') && origin.airports.some(a => destination.airports.some(b => a !== b)), blablacar: roadModes.length > 0 };
  for (const [source, expected] of Object.entries(sources)) if (expected) assert(p.queries.some(x => x.provider === source && x.purpose === 'direct' && x.date === q.date), `${label}: ${source} direct on the chosen date`);
  // Hubs lie between the two ends, within a 30% detour, and share no station with either end.
  assert(p.hubs.length <= HUB_COUNT[q.depth], label);
  const direct = km(origin, destination), shared = new Set([...origin.rail, ...destination.rail]);
  for (const name of p.hubs) {
    const h = PLACES.find(x => x.name === name);
    assert(h.hub && h.id !== origin.id && h.id !== destination.id && !h.rail.some(c => shared.has(c)), `${label}: ${name}`);
    assert(km(origin, h) < direct && km(h, destination) < direct && km(origin, h) + km(h, destination) <= direct * 1.3, `${label}: ${name} on the way`);
  }
  // Trains with hubs: every date can chain the depth's full length (or every hub, if fewer).
  if (q.modes.includes('train') && p.hubs.length) for (const date of p.dates) if (addDays(date, Math.ceil(q.maxHours / 24) + 1) <= LAST) assert(chainForDate(p, date) >= Math.min(LIMITS[q.depth].maxLegs, p.hubs.length + 1), `${label}: chain on ${date}`);
  assert.deepEqual(buildSearchPlan(input, NOW, 'fixed').queries.map(x => x.id), p.queries.map(x => x.id), `${label}: deterministic`);
}

test('planner rules hold for every city pair and depth, and for random searches', () => {
  for (const a of PLACES) for (const b of PLACES) if (a !== b) for (const depth of ['quick', 'thorough', 'extended'])
    checkPlan({ originId: a.id, destinationId: b.id, date: addDays(TODAY, 30), passengers: 1, modes: MODE_SETS[0], depth, flexibility: 1, budget: null, maxHours: 72, latestArrival: null, availabilityOnly: true });
  const r = random(42), pick = list => list[Math.floor(r() * list.length)];
  for (let i = 0; i < 1500; i++) {
    const a = pick(PLACES); let b = pick(PLACES); while (b === a) b = pick(PLACES);
    checkPlan({ originId: a.id, destinationId: b.id, date: addDays(TODAY, pick([0, 1, 2, 30, 59, 60])), passengers: 1 + Math.floor(r() * 6), modes: pick(MODE_SETS), depth: pick(['quick', 'thorough', 'extended']), flexibility: pick([0, 1, 2]), budget: pick([null, 500, 99999]), maxHours: pick([6, 24, 48, 72, 96]), latestArrival: null, availabilityOnly: r() < 0.5 });
  }
});

test('validateSearch returns a sane query or a validation error for junk input', () => {
  const r = random(7), pick = list => list[Math.floor(r() * list.length)];
  const junk = () => pick([null, true, false, 0, -1, 1.5, NaN, 7, 'x', '', 'gurugram', 'train', '2026-11-05', [], ['train'], [null], {}, { a: 1 }, 'é'.repeat(5000), 2 ** 53]);
  const base = { originId: 'gurugram', destinationId: 'jamalpur', date: addDays(TODAY, 1), passengers: 1, modes: ['train'], depth: 'quick', flexibility: 0, budget: null, maxHours: 72, latestArrival: null, availabilityOnly: true };
  for (let i = 0; i < 5000; i++) {
    const input = r() < 0.1 ? junk() : JSON.parse(JSON.stringify({ ...base, [pick(Object.keys(base))]: junk(), [pick(Object.keys(base))]: junk() }));
    let v; try { v = validateSearch(input, NOW); } catch (e) { assert(e instanceof ValidationError && e.message, `validation error for ${JSON.stringify(input).slice(0, 120)}`); continue; }
    assert(findPlace(v.originId) && findPlace(v.destinationId) && v.originId !== v.destinationId && Number.isInteger(v.passengers) && v.modes.length && LIMITS[v.depth] && [0, 1, 2].includes(v.flexibility) && typeof v.availabilityOnly === 'boolean');
  }
});

// Random service networks over real catalogue terminals; each terminal belongs to one city.
const TERMINALS = (() => { const seen = new Set(), out = []; for (const p of PLACES) for (const [kind, codes] of [['rail', p.rail], ['air', p.airports]]) for (const c of codes) if (!seen.has(kind + c)) { seen.add(kind + c); out.push({ id: `${kind}:${c}`, name: c, cityId: p.id, kind }); } return out; })();
function network(r, cityCount, serviceCount) {
  const pick = list => list[Math.floor(r() * list.length)], int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const cities = [...new Set(Array.from({ length: cityCount * 3 }, () => pick(PLACES).id))].slice(0, cityCount), terms = TERMINALS.filter(t => cities.includes(t.cityId));
  const offer = () => { const o = { id: 'o' + int(1, 3), status: pick(['available', 'available', 'available', 'rac', 'waitlist', 'request', 'unknown']), classCode: pick(['3A', '2A', 'SL']), amount: r() < 0.15 ? null : int(100, 5000), currency: r() < 0.95 ? 'INR' : 'USD', priceBasis: r() < 0.85 ? 'person' : 'party', checkedAt: iso(NOW - int(-20, 200) * 1000), source: pick(['s1', 's2']) }; if (r() < 0.8) o.seats = int(0, 10); if (r() < 0.4) o.partySize = int(1, 4); if (r() < 0.2) o.expiresAt = iso(NOW + int(-60, 600) * 1000); if (r() < 0.15) { o.quota = 'TQ'; o.openingVerified = r() < 0.5; } return o; };
  const services = [];
  for (let i = 0; i < serviceCount; i++) {
    const from = pick(terms), others = terms.filter(t => t.cityId !== from.cityId && t.kind === from.kind); if (!others.length) continue;
    const dep = NOW + int(-6 * 60, 4 * 24 * 60) * MIN, s = { id: 's' + i, mode: from.kind === 'air' ? 'flight' : pick(['train', 'train', 'bus', 'carpool']), number: String(int(1, 60)), name: 'n', from, to: pick(others), departAt: iso(dep), arriveAt: iso(dep + int(30, 30 * 60) * MIN), offers: Array.from({ length: int(0, 3) }, offer) };
    services.push(s);
    if (r() < 0.05) services.push({ ...s, id: 'dup' + i, offers: Array.from({ length: int(1, 2) }, offer) });
    if (r() < 0.01) services.push({ ...s, id: 'conflict' + i, arriveAt: iso(dep + int(31, 30 * 60) * MIN + 10 * MIN) });
  }
  const transfers = [];
  for (const c of cities) { const ts = terms.filter(t => t.cityId === c); for (const a of ts) for (const b of ts) if (a !== b && r() < 0.5) transfers.push({ fromId: a.id, toId: b.id, minutes: int(5, 120), bufferMinutes: int(0, 60), cost: r() < 0.5 ? null : int(0, 500), evidence: 'test' }); }
  return { cities, services, transfers };
}

test('engine rules hold on random networks, in any input order', () => {
  const r = random(2026), pick = list => list[Math.floor(r() * list.length)], int = (a, b) => a + Math.floor(r() * (b - a + 1));
  for (let i = 0; i < 250; i++) {
    const { cities, services, transfers } = network(r, int(3, 8), int(20, 300));
    const originId = pick(cities), destinationId = pick(cities); if (originId === destinationId) continue;
    const date = istDate(NOW + int(0, 3) * 24 * H), query = { originId, destinationId, date, passengers: int(1, 4), modes: [...new Set(Array.from({ length: int(1, 4) }, () => pick(['train', 'flight', 'bus', 'carpool'])))], depth: pick(['quick', 'thorough', 'extended']), flexibility: pick([0, 1, 2]), budget: r() < 0.3 ? int(500, 8000) : null, maxHours: pick([6, 24, 48, 72, 96]), latestArrival: r() < 0.2 ? iso(NOW + int(12, 96) * H) : null, availabilityOnly: false };
    const cap = r() < 0.2 ? int(1, 200) : 25000, result = evaluateJourneys(services, query, transfers, NOW, cap), label = `network ${i}: ${originId} to ${destinationId}, ${query.depth}`;
    const maxLegs = LIMITS[query.depth].maxLegs, origin = findPlace(originId), nearby = new Set([...origin.rail.map(c => 'rail:' + c), ...origin.airports.map(c => 'air:' + c)]);
    const dates = new Set([-2, -1, 0, 1, 2].filter(d => Math.abs(d) <= query.flexibility).map(d => addDays(date, d))), tmap = new Map(transfers.map(t => [t.fromId + '|' + t.toId, t]));
    for (const j of result.journeys) {
      const s = j.services, first = s[0], last = s.at(-1);
      assert(s.length <= maxLegs && Date.parse(first.departAt) > NOW && dates.has(istDate(Date.parse(first.departAt))), label);
      assert(first.from.cityId === originId || nearby.has(first.from.id), `${label}: starts at the origin`);
      assert.equal(last.to.cityId, destinationId, label);
      assert(s.every(x => query.modes.includes(x.mode)), label);
      const cities = [originId, ...s.map(x => x.to.cityId)]; assert.equal(new Set(cities).size, cities.length, `${label}: no repeated city`);
      for (let k = 1; k < s.length; k++) {
        const a = s[k - 1], b = s[k], gap = (Date.parse(b.departAt) - Date.parse(a.arriveAt)) / MIN, t = j.transfers[k - 1];
        assert(b.from.cityId === a.to.cityId && !(a.number === b.number && a.mode === b.mode) && gap >= 0 && t.gap === gap, label);
        if (a.to.id === b.from.id) assert(t.known && gap >= (a.mode === 'flight' || b.mode === 'flight' ? 180 : 45), `${label}: same-terminal minimum`);
        else { const tr = tmap.get(a.to.id + '|' + b.from.id); assert.equal(t.known, !!tr, label); if (tr) assert(gap >= tr.minutes + tr.bufferMinutes, `${label}: transfer minimum`); }
      }
      const duration = (Date.parse(last.arriveAt) - Date.parse(first.departAt)) / MIN;
      assert(duration === j.durationMinutes && duration <= query.maxHours * 60, label);
      if (query.latestArrival) assert(Date.parse(last.arriveAt) <= Date.parse(query.latestArrival), label);
      if (query.budget !== null) assert(j.knownCost <= query.budget, `${label}: fare cap`);
      if (j.offersOnAllLegs) assert(j.feasibility === 'feasible' && j.selectedOffers.every(Boolean), label);
      j.selectedOffers.forEach((o, k) => { if (o) assert(offerAvailable(o, s[k], query.passengers, NOW), label); });
      assert.equal(j.costComplete, j.selectedOffers.every(o => offerAmount(o, query.passengers) !== null) && j.transfers.every(t => t.cost !== null), label);
    }
    const c = result.counters;
    assert.equal(c.offersOnAllLegs, result.journeys.filter(j => j.offersOnAllLegs).length, `${label}: offered counter`);
    assert.equal(c.connectionFeasible, result.journeys.filter(j => j.feasibility === 'feasible').length, `${label}: feasible counter`);
    assert.equal(c.itinerariesEvaluated, result.journeys.length + c.rejected.budget, `${label}: evaluated counter`);
    assert(c.statesExpanded <= cap && (!c.truncated || c.statesExpanded === cap), `${label}: work cap`);
    if (!c.truncated) {
      const shuffled = services.map(x => [r(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1]), again = evaluateJourneys(shuffled, query, transfers, NOW, cap);
      assert.deepEqual(again.journeys.map(j => j.id).sort(), result.journeys.map(j => j.id).sort(), `${label}: same journeys in any order`);
      assert.deepEqual(again.counters, c, `${label}: same counters in any order`);
    }
  }
});

test('engine never crashes on malformed service records', () => {
  const r = random(5), pick = list => list[Math.floor(r() * list.length)];
  const base = Array.from({ length: 5 }, (_, i) => ({ id: 'm' + i, mode: 'train', number: String(i), name: 'n', from: { id: 'rail:ANVT', name: 'ANVT', cityId: 'delhi' }, to: { id: 'rail:JMP', name: 'JMP', cityId: 'jamalpur' }, departAt: '2026-11-05T05:15:00+05:30', arriveAt: '2026-11-06T05:15:00+05:30', offers: [{ id: 'o', status: 'available', classCode: '3A', seats: 3, amount: 900, currency: 'INR', priceBasis: 'person', checkedAt: '2026-11-04T10:12:00+05:30', source: 's' }] }));
  const values = [null, undefined, 0, -1, NaN, Infinity, '', 'x'.repeat(400), '2026-11-05T05:15:00', '2026-13-45T99:99:99+05:30', [], {}, true];
  const query = { originId: 'gurugram', destinationId: 'jamalpur', date: '2026-11-05', passengers: 1, modes: ['train'], depth: 'extended', flexibility: 0, budget: null, maxHours: 72, latestArrival: null, availabilityOnly: false };
  for (let i = 0; i < 2000; i++) {
    const input = base.map(s => { if (r() > 0.4) return s; const c = structuredClone(s), path = pick([['mode'], ['number'], ['from'], ['to', 'cityId'], ['departAt'], ['arriveAt'], ['offers'], ['offers', 0], ['offers', 0, 'status'], ['offers', 0, 'checkedAt'], ['offers', 0, 'seats'], ['offers', 0, 'amount']]); let o = c; for (const k of path.slice(0, -1)) o = o?.[k]; if (o && typeof o === 'object') o[path.at(-1)] = pick(values); return c; });
    if (r() < 0.1) input.push(pick(values));
    assert.doesNotThrow(() => evaluateJourneys(input, query, [], NOW));
  }
});

test('hitting the work limit never hides direct services', () => {
  const r = random(99), pick = list => list[Math.floor(r() * list.length)], rail = TERMINALS.filter(t => t.kind === 'rail'), services = [];
  while (services.length < 10000) { const from = pick(rail), to = pick(rail); if (from.cityId === to.cityId) continue; const dep = NOW + (60 + Math.floor(r() * 3 * 24 * 60)) * MIN; services.push({ id: 'b' + services.length, mode: 'train', number: String(services.length), name: 'n', from, to, departAt: iso(dep), arriveAt: iso(dep + (60 + Math.floor(r() * 19 * 60)) * MIN), offers: [] }); }
  const query = { originId: 'gurugram', destinationId: 'jamalpur', date: addDays(TODAY, 1), passengers: 1, modes: ['train'], depth: 'thorough', flexibility: 2, budget: null, maxHours: 96, latestArrival: null, availabilityOnly: false };
  const direct = evaluateJourneys(services, { ...query, depth: 'quick' }, [], NOW, 1e9).journeys.filter(j => j.services.length === 1).length;
  for (const cap of [1000, 5000, 15000]) {
    const result = evaluateJourneys(services, query, [], NOW, cap);
    assert.equal(result.journeys.filter(j => j.services.length === 1).length, direct, `cap ${cap}: every direct service found`);
  }
  assert(direct > 0);
});

test('booking links only allow HTTPS provider pages', () => {
  const cases = [['https://www.confirmtkt.com/rbooking/x', true], ['https://CONFIRMTKT.COM/x', true], ['https://m.blablacar.in/ride', true], ['https://www.skyscanner.co.in/transport/flights/del/pat/', true], ['http://www.confirmtkt.com/', false], ['javascript:alert(1)', false], ['data:text/html,hi', false], ['//confirmtkt.com/x', false], ['https://confirmtkt.com.evil.test/', false], ['https://evilconfirmtkt.com/', false], ['https://confirmtkt.com@evil.test/', false], ['https://user:pw@confirmtkt.com/', false], ['https://evil.test\\@confirmtkt.com/', false], ['https://evil.test#.confirmtkt.com', false], ['https://confirmtkt.com%2eevil.test/', false], ['https://confirmtkt.com./', false], [undefined, false], ['', false]];
  for (const [url, allowed] of cases) assert.equal(!!safeBookingUrl(url), allowed, String(url));
});
