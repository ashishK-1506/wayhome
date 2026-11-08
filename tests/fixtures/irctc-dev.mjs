// Made-up irctc.dev answers in the shape of its real responses (fields checked against the live
// API on 8 November 2026). Train numbers, times, seats and fares are invented. Nothing here came
// from the live API, and it is not real availability; irctc.dev's terms forbid republishing its data.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = n => String(n).padStart(2, '0');
const shiftDate = (date, days) => new Date(Date.parse(date + 'T12:00:00+05:30') + days * 86400000).toISOString().slice(0, 10);
const weekday = date => DAYS[new Date(date + 'T12:00:00+05:30').getUTCDay()];

export function trainRecord(trainNo, from, to, fromName, toName, departure, durationMin, extra = {}) {
  const [h, m] = departure.split(':').map(Number), end = h * 60 + m + durationMin, fromOffset = extra.fromStationDayOffset ?? 0;
  return {
    trainNo, trainName: `TEST ${trainNo} EXP`, trainType: 'EXPRESS', fromStation: from, toStation: to, fromStationName: fromName, toStationName: toName,
    trainSrc: from, trainDstn: to, departure, arrival: `${pad(Math.floor(end % 1440 / 60))}:${pad(end % 60)}`, durationMin,
    durationStr: `${Math.floor(durationMin / 60)}:${pad(durationMin % 60)}`, runningDays: DAYS.slice(1).concat('Sun'), classes: [],
    distance: '1000', estimatedFare: 600, halts: 12, fromStationDayOffset: fromOffset, toStationDayOffset: fromOffset + Math.floor(end / 1440), ...extra,
  };
}

// Trains between two stations. Some Patna trains depend on the date asked for, to exercise running
// days that count from the train's first station.
export function trainsFor(from, to, date) {
  const fixed = {
    // Two direct trains: one overnight with seats, one only waitlist or RAC.
    'NDLS-JMP': [trainRecord('90001', 'NDLS', 'JMP', 'NEW DELHI', 'JAMALPUR JN', '13:30', 1005)],
    'ANVT-JMP': [trainRecord('90002', 'ANVT', 'JMP', 'ANAND VIHAR TERMINAL', 'JAMALPUR JN', '15:00', 1120)],
    // A change at Patna: arrive 20:00.
    'GUR-PNBE': [trainRecord('90003', 'GUR', 'PNBE', 'GURGAON', 'PATNA JN', '05:00', 900)],
  }[`${from}-${to}`] ?? [];
  if (from !== 'PNBE' || to !== 'JMP') return fixed;
  const dayBefore = weekday(shiftDate(date, -1));
  return [
    // Leaves Patna 22:30, with 3A and SL.
    trainRecord('90004', 'PNBE', 'JMP', 'PATNA JN', 'JAMALPUR JN', '22:30', 180),
    // Starts the day before at its first station and reaches Patna on the date asked: it runs.
    trainRecord('90005', 'PNBE', 'JMP', 'PATNA JN', 'JAMALPUR JN', '23:10', 210, { runningDays: [dayBefore], fromStationDayOffset: 1, trainSrc: 'DLI' }),
    // Same running day but starting at Patna: it does not run on the date asked.
    trainRecord('90007', 'PNBE', 'JMP', 'PATNA JN', 'JAMALPUR JN', '19:00', 200, { runningDays: [dayBefore] }),
    // A chair-car intercity with no 3A or SL, leaving 80 minutes after the feeder arrives.
    trainRecord('90006', 'PNBE', 'JMP', 'PATNA JN', 'JAMALPUR JN', '21:20', 159, { trainName: 'TEST INTERCITY' }),
  ];
}

// Status for the requested date, by train and class; anything not listed is waitlisted.
export const SEATS = { '90001:3A': 'AVAILABLE-0012', '90001:SL': 'AVAILABLE-0140', '90002:3A': 'GNWL20/WL8', '90002:SL': 'RAC12/RAC3', '90003:3A': 'AVAILABLE-0004', '90003:SL': 'AVAILABLE-0050', '90004:3A': 'AVAILABLE-0020', '90004:SL': 'AVAILABLE-0100', '90006:CC': 'AVAILABLE-0030' };
// Classes and fares by train; the fare answer is also how a train's classes are known.
export const FARES = { default: { '2A': 2490, '3A': 1650, SL: 620 }, '90006': { CC: 300, '2S': 120 } };
const typeOf = status => /^AVAILABLE/.test(status) ? 'AVAILABLE' : /^RAC/.test(status) ? 'RAC' : 'WAITLIST';
const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/**
 * A `fetch` stand-in for irctc.dev. With `status`, every call fails with that HTTP status and
 * `statusBody`. With `seatLimit`, seat checks after that many are refused with 429, like the real
 * limit of 10 a minute.
 */
export function fakeIrctcDev({ status, statusBody = '{"success":false,"message":"test failure"}', seats = SEATS, seatLimit = Infinity, syncedAt = () => new Date(Date.now() - 30000).toISOString(), log = [] } = {}) {
  let seatChecks = 0;
  return async (href, init = {}) => {
    const url = new URL(href), params = Object.fromEntries(url.searchParams);
    log.push({ path: url.pathname, params, url: url.href, key: init.headers?.['x-api-key'] });
    if (status) return new Response(statusBody, { status });
    if (url.pathname === '/api/v1/trains/search') return json({ success: true, data: trainsFor(params.from, params.to, params.date), source: 'irctc-api', isLive: false, _time: 4.4 });
    const match = url.pathname.match(/^\/api\/v1\/trains\/(\d{5})\/(availability|fare)$/);
    if (match?.[2] === 'availability') {
      if (++seatChecks > seatLimit) return new Response('{"success":false,"message":"Too many requests, please try again later."}', { status: 429 });
      const date = params.date.split('-').reverse().join('-'), state = seats[`${match[1]}:${params.class}`] ?? 'GNWL40/WL30';
      // The real endpoint returns a 14-day calendar. The next day is always open here, so a parser
      // that picks the wrong day shows up as wrong seats.
      return json({ success: true, trainNumber: match[1], trainName: `TEST ${match[1]} EXP`, from: params.from, to: params.to, date: params.date, class: params.class, quota: params.quota,
        availability: [{ date, status: state, type: typeOf(state), currentBooking: 'N', reason: null }, { date: shiftDate(date, 1), status: 'AVAILABLE-0099', type: 'AVAILABLE', currentBooking: 'N', reason: null }],
        bookingConfig: { maxPassengers: 6, applicableBerthTypes: ['LB', 'MB', 'UB', 'SL', 'SU'] }, source: 'irctc-api', syncedAt: syncedAt(), _time: 0.7 });
    }
    if (match?.[2] === 'fare') {
      const fares = FARES[match[1]] ?? FARES.default;
      return json({ success: true, trainNumber: match[1], trainName: `TEST ${match[1]} EXP`, from: params.from, to: params.to, quota: params.quota, category: 'Adult', distanceKm: 1000, totalClasses: Object.keys(fares).length,
        fares: Object.entries(fares).map(([cls, totalFare]) => ({ class: cls, className: cls, totalFare, distanceKm: 1000, applicableBerthTypes: ['LB', 'UB'], breakup: { baseFare: totalFare - 100, reservationCharge: 40, superfastCharge: 30, gst: 30, cateringCharge: 0, dynamicFare: 0 } })),
        source: 'irctc-api', _cached: false, _time: 0.4 });
    }
    return new Response('not found', { status: 404 });
  };
}
