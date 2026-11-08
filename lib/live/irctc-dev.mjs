// Unofficial Indian Railways data from irctc.dev (https://irctc.dev/docs), called only from the
// server with the owner's key. Its terms say it is not an official source, so every offer names
// it and links to a ConfirmTkt search for rechecking before booking.
export const IRCTC_DEV = 'irctc.dev';
export const DEFAULT_BASE_URL = 'https://api.irctc.dev';
const MINUTE = 60000;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TRAIN_NO = /^\d{5}$/;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A failed call. `kind` is safe to show; details stay in the message for the server log. */
export class SourceError extends Error {
  constructor(kind, message) { super(message); this.name = 'SourceError'; this.kind = kind; }
}

// "2026-11-10" → "10-11-2026", the date format the availability endpoint expects.
export const dmy = date => date.split('-').reverse().join('-');
// An instant as India wall-clock time with an explicit offset, e.g. "2026-11-10T07:00:00+05:30".
export const istIso = ms => new Date(ms + 330 * MINUTE).toISOString().slice(0, 19) + '+05:30';
const weekday = date => DAYS[new Date(date + 'T12:00:00+05:30').getUTCDay()];
// "NEW DELHI" → "New Delhi"; station names arrive in capitals.
const titleCase = text => text.toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase());
const cleanText = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : fallback;

export async function getJson({ baseUrl = DEFAULT_BASE_URL, key, fetcher = (...args) => fetch(...args), timeoutMs = 8000 }, path, params) {
  const url = new URL(path, baseUrl);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  let response;
  try {
    response = await fetcher(url.href, { headers: { 'x-api-key': key, accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new SourceError(error?.name === 'TimeoutError' ? 'timeout' : 'unreachable', `irctc.dev could not be reached: ${error?.message ?? error}`);
  }
  if (response.status === 401 || response.status === 403) throw new SourceError('auth', `irctc.dev did not accept the API key (HTTP ${response.status}).`);
  if (response.status === 402) throw new SourceError('quota', 'irctc.dev usage allowance used up (HTTP 402).');
  if (response.status === 429) {
    // 429 is mostly the per-minute limit (10 seat checks a minute); a used-up allowance says so.
    const text = await response.text().catch(() => '');
    throw new SourceError(/credit|quota|allowance|plan/i.test(text) ? 'quota' : 'rate_limited', `irctc.dev limit reached (HTTP 429): ${text.slice(0, 200)}`);
  }
  if (!response.ok) throw new SourceError('upstream', `irctc.dev returned HTTP ${response.status}.`);
  let data;
  try { data = await response.json(); } catch { throw new SourceError('bad_response', 'irctc.dev returned unreadable data.'); }
  if (!data || typeof data !== 'object' || data.success !== true) throw new SourceError('bad_response', 'irctc.dev reported an unsuccessful response.');
  return data;
}

/**
 * Trains in a `/api/v1/trains/search` response that really run between `from` and `to`.
 * Entries for other stations, or whose arrival clock time disagrees with departure plus
 * duration, are dropped: the dates would otherwise be guessed.
 */
export function parseTrains(data, from, to) {
  const trains = [];
  for (const item of Array.isArray(data?.data) ? data.data : []) {
    if (!item || typeof item !== 'object') continue;
    const trainNo = String(item.trainNo ?? ''), departure = String(item.departure ?? ''), arrival = String(item.arrival ?? ''), durationMin = Number(item.durationMin);
    if (!TRAIN_NO.test(trainNo) || !TIME.test(departure) || !TIME.test(arrival) || !Number.isInteger(durationMin) || durationMin <= 0 || durationMin > 4 * 1440) continue;
    if (item.fromStation !== from || item.toStation !== to) continue;
    const minutes = clock => { const [h, m] = clock.split(':').map(Number); return h * 60 + m; };
    if ((minutes(departure) + durationMin) % 1440 !== minutes(arrival)) continue;
    trains.push({
      trainNo,
      trainName: cleanText(item.trainName, `Train ${trainNo}`),
      fromName: titleCase(cleanText(item.fromStationName, from)),
      toName: titleCase(cleanText(item.toStationName, to)),
      departure,
      durationMin,
      runningDays: Array.isArray(item.runningDays) ? item.runningDays.filter(day => DAYS.includes(day)) : [],
      // Days after leaving its first station that the train reaches the boarding station.
      boardingDayOffset: Number.isInteger(item.fromStationDayOffset) && item.fromStationDayOffset >= 0 && item.fromStationDayOffset <= 7 ? item.fromStationDayOffset : 0,
    });
  }
  return trains;
}

/**
 * Whether a train leaves the boarding station on `date`. Running days count from the train's first
 * station, so they are shifted by the boarding-day offset. Without running days, the search's own
 * date filter is trusted.
 */
export function runsOn(train, date) {
  if (!train.runningDays.length) return true;
  const startDay = DAYS[(DAYS.indexOf(weekday(date)) - (train.boardingDayOffset ?? 0) + 56) % 7];
  return train.runningDays.includes(startDay);
}

/**
 * When irctc.dev last refreshed an availability answer (`syncedAt`; it caches for up to two
 * minutes), or the fetch time if it does not say. Never later than now.
 */
export function syncedTime(data, now) {
  const synced = Date.parse(data?.syncedAt);
  return Number.isFinite(synced) && synced <= now + 5000 ? Math.min(synced, now) : now;
}

/**
 * The availability entry for `date` from `/api/v1/trains/:no/availability`, as an offer status.
 * Only "AVAILABLE-0042"-style entries give a seat count; the engine never invents capacity.
 */
export function parseAvailability(data, date) {
  const entry = (Array.isArray(data?.availability) ? data.availability : []).find(item => item && item.date === date);
  if (!entry) return null;
  const raw = String(entry.status ?? '').toUpperCase().trim(), type = String(entry.type ?? '').toUpperCase();
  if (type === 'AVAILABLE' || /^(AVAILABLE|AVL|CURR_AVBL)/.test(raw)) {
    const count = raw.match(/(\d+)\s*$/)?.[1];
    return { status: 'available', ...(count !== undefined && { seats: Number(count) }), raw };
  }
  if (type === 'RAC' || raw.startsWith('RAC')) return { status: 'rac', raw };
  if (type === 'WAITLIST' || /WL/.test(raw)) return { status: 'waitlist', raw };
  return { status: 'unknown', raw };
}

/** Per-class total fares in rupees from `/api/v1/trains/:no/fare`. */
export function parseFares(data) {
  const fares = new Map();
  for (const fare of Array.isArray(data?.fares) ? data.fares : []) {
    if (fare && typeof fare.class === 'string' && Number.isFinite(fare.totalFare) && fare.totalFare > 0) fares.set(fare.class, Math.round(fare.totalFare));
  }
  return fares;
}

/** ConfirmTkt's results page for trains between two stations on a date. */
export const trainSearchUrl = (from, to, date) => `https://www.confirmtkt.com/rbooking/trains/from/${from}/to/${to}/${dmy(date)}`;

export function trainService(train, { date, from, to, offers = [] }) {
  const departAt = `${date}T${train.departure}:00+05:30`;
  return {
    id: `${IRCTC_DEV}:${train.trainNo}:${from.id}:${to.id}:${date}`,
    mode: 'train',
    number: train.trainNo,
    name: train.trainName,
    from,
    to,
    departAt,
    arriveAt: istIso(Date.parse(departAt) + train.durationMin * MINUTE),
    offers,
  };
}

export function trainOffer({ trainNo, fromCode, toCode, date, classCode, availability, fare, checkedAt }) {
  return {
    id: `${trainNo}:${fromCode}:${toCode}:${date}:${classCode}:GN`,
    source: IRCTC_DEV,
    status: availability.status,
    // The provider's own wording, e.g. "GNWL135/WL62", shown next to the status.
    ...(availability.raw && { statusText: availability.raw.slice(0, 40) }),
    classCode,
    quota: 'GN',
    ...(availability.seats !== undefined && { seats: availability.seats }),
    amount: fare ?? null,
    currency: 'INR',
    priceBasis: 'person',
    checkedAt,
    bookingUrl: trainSearchUrl(fromCode, toCode, date),
    linkType: 'search',
  };
}
