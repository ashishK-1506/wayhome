import { PLACES } from '../catalog.mjs';
import { addDays } from '../planner.mjs';
import { SourceError, dmy, fareList, getJson, istIso, parseAvailability, parseCalendar, parseFares, parseTrains, runsOn, syncedTime, trainOffer, trainService } from './irctc-dev.mjs';

// What one live search may spend. Searches and fares are cheap (irctc.dev allows 600 calls in ten
// minutes), but seat checks are limited to 10 a minute, so a search makes at most 8.
// That is at most 11 searches + 6 fares + 8 seat checks = 25 calls.
export const LIVE_TRAIN_LIMITS = Object.freeze({
  searches: 11, feeders: 3, trainsChecked: 6, seatChecks: 8,
  // Seats are checked in these classes when the train has them; otherwise in its first class from
  // the fallback list (an intercity train may only have chair car or second sitting).
  classes: ['3A', 'SL'], fallbackClasses: ['3E', 'CC', '2S', '2A', 'EC', '1A'],
  concurrency: 4, callTimeoutMs: 8000, deadlineMs: 20000, minChangeMinutes: 60,
});

/** Whether this request may spend the owner's quota. A passcode, when set, must match exactly. */
export function liveAccess({ key, passcode }, provided) {
  if (!key) return 'not_configured';
  if (!passcode) return 'allowed';
  if (!provided) return 'passcode_required';
  return sameText(provided, passcode) ? 'allowed' : 'passcode_rejected';
}
// Compares every byte so the time taken does not reveal how much of the passcode matched.
function sameText(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let difference = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) difference |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return difference === 0;
}

const hubPlaces = plan => plan.hubs.map(name => PLACES.find(place => place.name === name)).filter(Boolean);

// The planner took each station code from one place. Give the terminal that place's city, so the
// engine recognises where the journey starts and ends and where a change happens.
function cityFor(code, end, query, { origin, destination, hubs }) {
  const atHub = () => (hubs.find(hub => hub.rail[0] === code) ?? hubs.find(hub => hub.rail.includes(code)))?.id ?? null;
  if (end === 'from') return query.purpose === 'direct' || query.purpose === 'feeder' ? (origin.rail.includes(code) ? origin.id : null) : atHub();
  return query.purpose === 'direct' || query.purpose === 'onward' ? (destination.rail.includes(code) ? destination.id : null) : atHub();
}

/**
 * The planned train searches worth running: every direct search on the chosen date, plus one change
 * at the first hub the plan links both ways, from up to three origin stations to the hub that day,
 * then from the hub to the destination that day or the next.
 */
export function selectTrainQueries(plan, limits = LIVE_TRAIN_LIMITS) {
  const trains = plan.queries.filter(q => q.provider === 'confirmtkt' && q.modes.includes('train'));
  const day = plan.query.date, nextDay = addDays(day, 1);
  let connection = [];
  for (const hub of hubPlaces(plan)) {
    const feeders = trains.filter(q => q.purpose === 'feeder' && q.date === day && q.to === hub.rail[0]).slice(0, limits.feeders);
    const onward = trains.filter(q => q.purpose === 'onward' && q.from === hub.rail[0] && (q.date === day || q.date === nextDay)).slice(0, 2);
    if (feeders.length && onward.length) { connection = [...feeders, ...onward]; break; }
  }
  const direct = trains.filter(q => q.purpose === 'direct' && q.date === day);
  return [...direct.slice(0, Math.max(1, limits.searches - connection.length)), ...connection].slice(0, limits.searches);
}

// Which found trains get a fare and seat check: the fastest direct trains, then the feeder and
// onward pair with the earliest arrival that leaves enough time to change.
function chooseTrainsToCheck(found, limits) {
  const direct = [], seen = new Set();
  for (const item of found.filter(f => f.query.purpose === 'direct').sort((a, b) => a.train.durationMin - b.train.durationMin)) {
    if (seen.has(item.train.trainNo)) continue;
    seen.add(item.train.trainNo);
    direct.push(item);
  }
  let best = null;
  for (const first of found.filter(f => f.query.purpose === 'feeder')) {
    for (const second of found.filter(f => f.query.purpose === 'onward')) {
      if (first.to.id !== second.from.id) continue;
      const change = (Date.parse(second.service.departAt) - Date.parse(first.service.arriveAt)) / 60000;
      if (change < limits.minChangeMinutes) continue;
      if (!best || Date.parse(second.service.arriveAt) < Date.parse(best[1].service.arriveAt)) best = [first, second];
    }
  }
  const connection = best ?? [];
  return [...direct.slice(0, Math.max(0, limits.trainsChecked - connection.length)), ...connection].slice(0, limits.trainsChecked);
}

async function pool(items, size, task) {
  let next = 0;
  const worker = async () => { while (next < items.length) { const item = items[next++]; await task(item); } };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

/**
 * Runs the selected train searches against irctc.dev, checks fares and seats for the most useful
 * trains, and returns engine-ready services plus what happened to each planned query.
 */
export async function runLiveTrains(plan, { key, baseUrl, fetcher, now = () => Date.now(), limits = LIVE_TRAIN_LIMITS }) {
  const config = { key, baseUrl, fetcher, timeoutMs: limits.callTimeoutMs };
  const places = { origin: plan.origin, destination: plan.destination, hubs: hubPlaces(plan) };
  const deadline = now() + limits.deadlineMs, calls = { made: 0, failed: 0 }, problems = [];
  const call = async (path, params) => {
    if (now() > deadline) throw new SourceError('timeout', 'The live search ran out of time.');
    calls.made++;
    try { return await getJson(config, path, params); }
    catch (error) { calls.failed++; problems.push(error instanceof SourceError ? error.kind : 'upstream'); throw error; }
  };

  const selected = selectTrainQueries(plan, limits), outcomes = new Map(), found = [];
  await pool(selected, limits.concurrency, async query => {
    try {
      const data = await call('/api/v1/trains/search', { from: query.from, to: query.to, date: query.date });
      outcomes.set(query.id, { status: 'succeeded' });
      const fromCity = cityFor(query.from, 'from', query, places), toCity = cityFor(query.to, 'to', query, places);
      if (!fromCity || !toCity) return;
      for (const train of parseTrains(data, query.from, query.to).filter(t => runsOn(t, query.date))) {
        const from = { id: 'rail:' + query.from, name: train.fromName, cityId: fromCity }, to = { id: 'rail:' + query.to, name: train.toName, cityId: toCity };
        found.push({ query, train, from, to, service: trainService(train, { date: query.date, from, to }) });
      }
    } catch (error) {
      outcomes.set(query.id, { status: 'failed', error: error instanceof SourceError ? error.kind : 'upstream' });
    }
  });
  // Calls finish in any order; sort so the same answers always give the same result.
  found.sort((a, b) => selected.indexOf(a.query) - selected.indexOf(b.query) || a.service.departAt.localeCompare(b.service.departAt) || a.train.trainNo.localeCompare(b.train.trainNo));

  // Fares first: they also show which classes a train has, so no seat check goes on a missing class.
  const toCheck = chooseTrainsToCheck(found, limits), fares = new Map(), seats = new Map();
  await pool(toCheck, limits.concurrency, async item => {
    try { fares.set(item.service.id, parseFares(await call(`/api/v1/trains/${item.train.trainNo}/fare`, { from: item.query.from, to: item.query.to, class: 'all', quota: 'GN' }))); }
    catch { /* counted as a failed call; seats are still checked in the preferred classes */ }
  });
  const classesFor = item => {
    const known = fares.get(item.service.id);
    if (!known?.size) return [...limits.classes];
    const preferred = limits.classes.filter(c => known.has(c));
    return preferred.length ? preferred : limits.fallbackClasses.filter(c => known.has(c)).slice(0, 1);
  };
  // Every train gets its first class checked before any train gets a second.
  const perTrain = toCheck.map(item => ({ item, classes: classesFor(item) })), wanted = [];
  for (let rank = 0; perTrain.some(t => rank < t.classes.length); rank++) for (const t of perTrain) if (rank < t.classes.length) wanted.push({ item: t.item, classCode: t.classes[rank] });
  const checks = wanted.slice(0, limits.seatChecks);
  await pool(checks, limits.concurrency, async ({ item, classCode }) => {
    try {
      const data = await call(`/api/v1/trains/${item.train.trainNo}/availability`, { from: item.query.from, to: item.query.to, date: dmy(item.query.date), class: classCode, quota: 'GN' });
      seats.set(item.service.id + '|' + classCode, { availability: parseAvailability(data, item.query.date), calendar: parseCalendar(data, item.query.date), checkedAt: istIso(syncedTime(data, now())) });
    } catch {
      // Counted as a failed call; the train simply has no offer for this class.
    }
  });

  const services = found.map(item => ({
    ...item.service,
    // Every class the train has, with its fare, so the page can show and check the others.
    ...(fares.get(item.service.id)?.size && { fares: fareList(fares.get(item.service.id)) }),
    offers: checks.filter(check => check.item === item).flatMap(({ classCode }) => {
      const checked = seats.get(item.service.id + '|' + classCode);
      if (!checked?.availability) return [];
      return [trainOffer({ trainNo: item.train.trainNo, fromCode: item.query.from, toCode: item.query.to, date: item.query.date, classCode, availability: checked.availability, fare: fares.get(item.service.id)?.get(classCode), checkedAt: checked.checkedAt, calendar: checked.calendar })];
    }),
  }));
  // Failures by reason; when every call failed, the most common reason describes the whole search.
  const failures = Object.fromEntries(problems.reduce((map, kind) => map.set(kind, (map.get(kind) ?? 0) + 1), new Map()));
  const problem = calls.made > 0 && calls.failed === calls.made ? Object.entries(failures).sort((a, b) => b[1] - a[1])[0][0] : null;
  return { services, outcomes, calls, failures, trainsChecked: toCheck.length, classes: [...new Set(checks.map(c => c.classCode))], problem };
}

// Classes a seat check may ask for.
export const SEAT_CLASSES = Object.freeze(['1A', '2A', '3A', '3E', 'SL', 'CC', 'EC', '2S']);

/**
 * One seat check asked for from a result card: the train's fares (unless the card already has
 * them, `withFares: false`), then seats in `classCode`, or in the first preferred class the train
 * has. At most two calls.
 */
export async function checkTrainSeats({ key, baseUrl, fetcher, now = () => Date.now(), limits = LIVE_TRAIN_LIMITS }, { trainNo, from, to, date, classCode, withFares = true }) {
  const config = { key, baseUrl, fetcher, timeoutMs: limits.callTimeoutMs };
  const kind = error => error instanceof SourceError ? error.kind : 'upstream';
  let fares = null;
  if (withFares || !classCode) {
    try { fares = parseFares(await getJson(config, `/api/v1/trains/${trainNo}/fare`, { from, to, class: 'all', quota: 'GN' })); }
    catch (error) { if (!classCode) return { problem: kind(error) }; }
  }
  const chosen = classCode ?? limits.classes.find(c => fares?.has(c)) ?? limits.fallbackClasses.find(c => fares?.has(c)) ?? limits.classes[0];
  const listed = fares?.size ? { fares: fareList(fares) } : {};
  try {
    const data = await getJson(config, `/api/v1/trains/${trainNo}/availability`, { from, to, date: dmy(date), class: chosen, quota: 'GN' });
    const availability = parseAvailability(data, date);
    const offer = availability && trainOffer({ trainNo, fromCode: from, toCode: to, date, classCode: chosen, availability, fare: fares?.get(chosen), checkedAt: istIso(syncedTime(data, now())), calendar: parseCalendar(data, date) });
    return { classCode: chosen, offer: offer ?? null, ...listed };
  } catch (error) {
    return { classCode: chosen, problem: kind(error), ...listed };
  }
}
