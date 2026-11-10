import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchPlan } from '../lib/planner.mjs';
import { evaluateJourneys, validateService, safeBookingUrl } from '../lib/engine.mjs';
import { dmy, fareList, istIso, parseAvailability, parseCalendar, parseFares, parseTrains, runsOn, syncedTime, trainOffer, trainService } from '../lib/live/irctc-dev.mjs';
import { LIVE_TRAIN_LIMITS, liveAccess, runLiveTrains, selectTrainQueries } from '../lib/live/trains.mjs';
import { fakeIrctcDev, trainRecord, trainsFor } from './fixtures/irctc-dev.mjs';

const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const query = { originId: 'gurugram', destinationId: 'jamalpur', date: tomorrow, passengers: 1, modes: ['train'], depth: 'extended', flexibility: 0, budget: null, maxHours: 72, availabilityOnly: true };
const maxCalls = LIVE_TRAIN_LIMITS.searches + LIVE_TRAIN_LIMITS.trainsChecked + LIVE_TRAIN_LIMITS.seatChecks;

test('irctc.dev trains are kept only when stations and times agree', () => {
  const [train] = parseTrains({ success: true, data: trainsFor('NDLS', 'JMP', tomorrow) }, 'NDLS', 'JMP');
  assert.deepEqual({ no: train.trainNo, from: train.fromName, to: train.toName, departure: train.departure, minutes: train.durationMin, offset: train.boardingDayOffset }, { no: '90001', from: 'New Delhi', to: 'Jamalpur Jn', departure: '13:30', minutes: 1005, offset: 0 });
  const bad = [
    trainRecord('90010', 'NZM', 'JMP', 'X', 'Y', '10:00', 600),          // another station
    { ...trainRecord('90011', 'NDLS', 'JMP', 'X', 'Y', '10:00', 600), arrival: '20:30' }, // clock disagrees with duration
    trainRecord('9001', 'NDLS', 'JMP', 'X', 'Y', '10:00', 600),          // not a five-digit number
    { ...trainRecord('90012', 'NDLS', 'JMP', 'X', 'Y', '10:00', 600), departure: '25:00' },
    { ...trainRecord('90013', 'NDLS', 'JMP', 'X', 'Y', '10:00', 600), durationMin: 60.5 },
    null, 'junk',
  ];
  assert.deepEqual(parseTrains({ data: bad }, 'NDLS', 'JMP'), []);
  assert.deepEqual(parseTrains({ data: 'nope' }, 'NDLS', 'JMP'), []);
  assert.equal(parseTrains({ data: [trainRecord('90014', 'NDLS', 'JMP', 'X', 'Y', '10:00', 600, { fromStationDayOffset: 'x' })] }, 'NDLS', 'JMP')[0].boardingDayOffset, 0);
});

test('running days count from the train’s first station', () => {
  const sundayStart = { runningDays: ['Sun'], boardingDayOffset: 0 };
  assert.equal(runsOn(sundayStart, '2026-11-15'), true);   // a Sunday
  assert.equal(runsOn(sundayStart, '2026-11-16'), false);  // a Monday
  // Leaves its first station on Sunday and reaches the boarding station a day later.
  const nextDay = { runningDays: ['Sun'], boardingDayOffset: 1 };
  assert.equal(runsOn(nextDay, '2026-11-16'), true);
  assert.equal(runsOn(nextDay, '2026-11-15'), false);
  assert.equal(runsOn({ runningDays: ['Sat'], boardingDayOffset: 2 }, '2026-11-16'), true);
  assert.equal(runsOn({ runningDays: [], boardingDayOffset: 0 }, '2026-11-15'), true);
});

test('seat availability maps to offer states without inventing capacity', () => {
  const day = '2026-11-20', at = (status, type) => parseAvailability({ availability: [{ date: '2026-11-19', status: 'AVAILABLE-0999', type: 'AVAILABLE' }, { date: day, status, type, reason: null }] }, day);
  assert.deepEqual(at('AVAILABLE-0042', 'AVAILABLE'), { status: 'available', seats: 42, raw: 'AVAILABLE-0042' });
  assert.deepEqual(at('CURR_AVBL-0007'), { status: 'available', seats: 7, raw: 'CURR_AVBL-0007' });
  assert.equal(at('AVAILABLE', 'AVAILABLE').seats, undefined);
  assert.equal(at('RAC12/RAC3', 'RAC').status, 'rac');
  assert.equal(at('GNWL271/WL140', 'WAITLIST').status, 'waitlist');
  assert.equal(at('REGRET/WL').status, 'waitlist');
  assert.equal(at('NOT AVAILABLE').status, 'unknown');
  assert.equal(parseAvailability({ availability: [{ date: '2026-11-21', status: 'AVAILABLE-0001' }] }, day), null);
  assert.equal(parseAvailability({}, day), null);
  assert.deepEqual([...parseFares({ fares: [{ class: '3A', totalFare: 1650.4 }, { class: 'SL', totalFare: -1 }, { class: 2, totalFare: 5 }, null] })], [['3A', 1650]]);
  assert.deepEqual(fareList(new Map([['3A', 1650], ['SL', 620], ['2A', 2490]])).map(f => f.classCode), ['SL', '3A', '2A']);
  // The days after the travel date, in order, at most six by default.
  const calendar = { availability: ['22', '20', '21', '23', '24', '25', '26', '27', '28'].map(d => ({ date: `2026-11-${d}`, status: d === '21' ? 'GNWL5/WL2' : 'AVAILABLE-0010', type: d === '21' ? 'WAITLIST' : 'AVAILABLE' })).concat([{ date: 'bad' }, null]) };
  assert.deepEqual(parseCalendar(calendar, day).map(d => d.date.slice(8)), ['21', '22', '23', '24', '25', '26']);
  assert.deepEqual(parseCalendar(calendar, day)[0], { date: '2026-11-21', status: 'waitlist', statusText: 'GNWL5/WL2' });
  assert.deepEqual(parseCalendar(calendar, day, 2)[1], { date: '2026-11-22', status: 'available', seats: 10, statusText: 'AVAILABLE-0010' });
});

test('converted trains and offers are valid engine input with correct dates and check times', () => {
  const [train] = parseTrains({ data: trainsFor('NDLS', 'JMP', tomorrow) }, 'NDLS', 'JMP');
  const from = { id: 'rail:NDLS', name: 'New Delhi', cityId: 'gurugram' }, to = { id: 'rail:JMP', name: 'Jamalpur Jn', cityId: 'jamalpur' };
  const now = Date.parse('2026-11-19T09:00:00Z'), checkedAt = istIso(syncedTime({ syncedAt: '2026-11-19T08:59:20.123Z' }, now));
  assert.equal(checkedAt, '2026-11-19T14:29:20+05:30');
  assert.equal(syncedTime({ syncedAt: '2026-11-19T09:10:00Z' }, now), now);   // in the future: use now
  assert.equal(syncedTime({}, now), now);
  const offer = trainOffer({ trainNo: '90001', fromCode: 'NDLS', toCode: 'JMP', date: '2026-11-20', classCode: '3A', availability: { status: 'available', seats: 12, raw: 'AVAILABLE-0012' }, fare: 1650, checkedAt });
  const service = trainService(train, { date: '2026-11-20', from, to, offers: [offer] });
  assert.equal(service.departAt, '2026-11-20T13:30:00+05:30');
  assert.equal(service.arriveAt, '2026-11-21T06:15:00+05:30');
  assert.equal(validateService(service), true);
  assert.deepEqual({ source: offer.source, seats: offer.seats, amount: offer.amount, quota: offer.quota, basis: offer.priceBasis }, { source: 'irctc.dev', seats: 12, amount: 1650, quota: 'GN', basis: 'person' });
  assert.equal(dmy('2026-11-20'), '20-11-2026');
  assert.equal(safeBookingUrl(offer.bookingUrl), 'https://www.confirmtkt.com/rbooking/trains/from/NDLS/to/JMP/20-11-2026');
});

test('live access needs the key and, when one is set, the exact passcode', () => {
  assert.equal(liveAccess({}, null), 'not_configured');
  assert.equal(liveAccess({ passcode: 'x' }, 'x'), 'not_configured');
  assert.equal(liveAccess({ key: 'k' }, null), 'allowed');
  assert.equal(liveAccess({ key: 'k', passcode: 'open sesame' }, null), 'passcode_required');
  assert.equal(liveAccess({ key: 'k', passcode: 'open sesame' }, 'open sesam'), 'passcode_rejected');
  assert.equal(liveAccess({ key: 'k', passcode: 'open sesame' }, 'open sesame!'), 'passcode_rejected');
  assert.equal(liveAccess({ key: 'k', passcode: 'open sesame' }, 'open sesame'), 'allowed');
});

test('a live search runs every direct search, then one change from up to three stations', () => {
  const plan = buildSearchPlan(query), selected = selectTrainQueries(plan);
  assert(selected.length > 0 && selected.length <= LIVE_TRAIN_LIMITS.searches);
  assert(selected.every(q => q.provider === 'confirmtkt' && plan.queries.includes(q)));
  const direct = selected.filter(q => q.purpose === 'direct');
  assert.deepEqual(direct, plan.queries.filter(q => q.provider === 'confirmtkt' && q.purpose === 'direct' && q.date === tomorrow));
  const feeders = selected.filter(q => q.purpose === 'feeder'), onward = selected.filter(q => q.purpose === 'onward');
  assert(feeders.length >= 1 && feeders.length <= LIVE_TRAIN_LIMITS.feeders && new Set(feeders.map(q => q.to)).size === 1 && new Set(feeders.map(q => q.from)).size === feeders.length);
  assert(onward.length >= 1 && onward.every(q => q.from === feeders[0].to));
  assert.deepEqual(selected, [...direct, ...feeders, ...onward]);
  // Flight-only searches have nothing for the train source to do.
  assert.deepEqual(selectTrainQueries(buildSearchPlan({ ...query, modes: ['flight'] })), []);
});

test('live trains become journeys with seats, and each planned query records what happened', async () => {
  const plan = buildSearchPlan(query), log = [], now = Date.now(), synced = new Date(now - 45000).toISOString();
  const live = await runLiveTrains(plan, { key: 'test-key', fetcher: fakeIrctcDev({ log, syncedAt: () => synced }), now: () => now });
  assert(live.calls.made <= maxCalls);
  assert.equal(live.calls.failed, 0);
  assert.equal(live.problem, null);
  assert.deepEqual(live.failures, {});
  assert(live.services.every(validateService));
  // The key travels only in the header.
  assert(log.every(entry => entry.key === 'test-key' && !entry.url.includes('test-key')));
  const selected = selectTrainQueries(plan);
  assert.deepEqual([...live.outcomes.keys()].sort(), selected.map(q => q.id).sort());
  assert([...live.outcomes.values()].every(o => o.status === 'succeeded'));
  // Running days are read from the first station: 90005 runs on the date asked, 90007 does not.
  const numbers = live.services.map(s => s.number);
  assert(numbers.includes('90005') && !numbers.includes('90007'));
  // Fares first, then one seat check per train before any second class, never on a missing class.
  const seatChecks = log.filter(e => e.path.endsWith('/availability')).map(e => `${e.path.split('/')[4]}:${e.params.class}`);
  assert.deepEqual(seatChecks.slice(0, 4).sort(), ['90001:3A', '90002:3A', '90003:3A', '90006:CC']);
  assert.deepEqual(seatChecks.slice(4).sort(), ['90001:SL', '90002:SL', '90003:SL']);
  assert.equal(log.filter(e => e.path.endsWith('/fare')).length, live.trainsChecked);
  assert.deepEqual(live.classes, ['3A', 'CC', 'SL']);
  const direct = live.services.find(s => s.number === '90001');
  assert.deepEqual(direct.offers.map(o => [o.classCode, o.status, o.seats, o.amount]), [['3A', 'available', 12, 1650], ['SL', 'available', 140, 620]]);
  assert(direct.offers.every(o => o.checkedAt === istIso(Date.parse(synced))));
  // Every class the train has comes with its fare, and each check carries the following days.
  assert.deepEqual(direct.fares, [{ classCode: 'SL', amount: 620 }, { classCode: '3A', amount: 1650 }, { classCode: '2A', amount: 2490 }]);
  assert(direct.offers.every(o => o.calendar?.length === 1 && o.calendar[0].status === 'available' && o.calendar[0].seats === 99));
  assert.equal(live.services.find(s => s.number === '90005').fares, undefined);
  assert.deepEqual(live.services.find(s => s.number === '90002').offers.map(o => [o.status, o.statusText]), [['waitlist', 'GNWL20/WL8'], ['rac', 'RAC12/RAC3']]);
  // The onward search runs for the travel day and the next, so the intercity appears twice; only the
  // one that connects with the feeder is checked.
  const intercity = live.services.filter(s => s.number === '90006');
  assert.deepEqual(intercity.map(s => s.departAt.slice(0, 10)).sort(), [tomorrow, intercity.find(s => !s.departAt.startsWith(tomorrow)).departAt.slice(0, 10)].sort());
  assert.deepEqual(intercity.find(s => s.departAt.startsWith(tomorrow)).offers.map(o => [o.classCode, o.status, o.seats, o.amount]), [['CC', 'available', 30, 300]]);
  assert.deepEqual(intercity.find(s => !s.departAt.startsWith(tomorrow)).offers, []);
  const result = evaluateJourneys(live.services, plan.query, [], now, plan.limits.maxCandidates);
  const trainsOf = journey => journey.services.map(s => s.number).join('+');
  assert(result.journeys.some(j => trainsOf(j) === '90001' && j.offersOnAllLegs));
  assert(result.journeys.some(j => trainsOf(j) === '90003+90006' && j.offersOnAllLegs));
  assert(result.journeys.some(j => trainsOf(j) === '90002' && !j.offersOnAllLegs));
});

test('seat checks stay under the per-minute limit, and refused checks are reported', async () => {
  const plan = buildSearchPlan(query), log = [];
  const live = await runLiveTrains(plan, { key: 'k', fetcher: fakeIrctcDev({ log, seatLimit: 3 }) });
  assert(log.filter(e => e.path.endsWith('/availability')).length <= LIVE_TRAIN_LIMITS.seatChecks);
  assert.equal(live.failures.rate_limited, 4);
  assert.equal(live.problem, null);
  assert([...live.outcomes.values()].every(o => o.status === 'succeeded'));
  assert.equal(live.services.reduce((n, s) => n + s.offers.length, 0), 3);
});

test('a rejected key or a used-up allowance is reported, and failed queries say why', async () => {
  const plan = buildSearchPlan(query);
  const cases = [[401, undefined, 'auth'], [402, undefined, 'quota'], [429, undefined, 'rate_limited'], [429, '{"message":"Monthly credits exhausted"}', 'quota'], [503, undefined, 'upstream']];
  for (const [status, statusBody, problem] of cases) {
    const live = await runLiveTrains(plan, { key: 'k', fetcher: fakeIrctcDev({ status, statusBody }) });
    assert.equal(live.problem, problem);
    assert.equal(live.services.length, 0);
    assert([...live.outcomes.values()].every(o => o.status === 'failed' && o.error === problem));
    assert.equal(live.calls.made, live.calls.failed);
  }
});

test('a source that never answers is cut off by the time limits', async () => {
  const plan = buildSearchPlan(query);
  // Like a real stalled request, the pending call keeps the process alive until it is aborted.
  const hang = (_url, init) => new Promise((_resolve, reject) => { const open = setTimeout(() => {}, 60000); init.signal.addEventListener('abort', () => { clearTimeout(open); reject(init.signal.reason); }); });
  const live = await runLiveTrains(plan, { key: 'k', fetcher: hang, limits: { ...LIVE_TRAIN_LIMITS, callTimeoutMs: 30 } });
  assert.equal(live.problem, 'timeout');
  assert([...live.outcomes.values()].every(o => o.error === 'timeout'));
  // Past the overall deadline, no further calls start.
  let clock = 0;
  const late = await runLiveTrains(plan, { key: 'k', fetcher: fakeIrctcDev(), now: () => (clock += 30000) });
  assert.equal(late.calls.made, 0);
  assert([...late.outcomes.values()].every(o => o.status === 'failed' && o.error === 'timeout'));
});
