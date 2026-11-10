import type { CalendarDay, Fare, Journey, Offer, Service } from '@/lib/model';

// How result cards read offers: plain functions, kept apart from the card markup so they can be tested.
/** Seat checks asked for from the result cards, by service id. They add to what the search returned. */
export type ServiceCheck = { fares?: Fare[]; offers: Offer[]; busy?: string; error?: string };
export type Checks = Record<string, ServiceCheck>;

export type Tone = 'available' | 'rac' | 'waitlist' | 'closed' | 'unknown';
export const TONE_LABEL: Record<Tone, string> = { available: 'Available', rac: 'RAC', waitlist: 'Waitlist', closed: 'Booking closed', unknown: 'Status unclear' };
type Status = Pick<Offer, 'status' | 'seats' | 'statusText'> | CalendarDay;

// How a status reads at a glance. "REGRET" means the waitlist is full and nothing can be booked;
// a cancelled train or "NOT AVAILABLE" cannot be booked either.
export function toneOf(o: Status): Tone {
  if (/^REGRET|CANCEL|NOT AVAILABLE/.test(o.statusText ?? '')) return 'closed';
  if (o.status === 'available') return (o.seats ?? 1) > 0 ? 'available' : 'closed';
  return o.status === 'rac' ? 'rac' : o.status === 'waitlist' ? 'waitlist' : 'unknown';
}
// "AVAILABLE-0015" reads "AVL 15". Waitlist and RAC codes show the current position, as booking sites
// do: "RLWL18/WL16" reads "WL 16" and "RAC12/RAC3" reads "RAC 3". The full code stays in the tooltip.
export function shortStatus(o: Status): string {
  const code = o.statusText ?? '';
  if (o.status === 'available' && Number.isInteger(o.seats)) return `AVL ${o.seats}`;
  if (code.startsWith('REGRET')) return 'REGRET';
  const position = code.match(o.status === 'rac' ? /RAC\s*(\d+)\s*$/ : /WL\s*(\d+)\s*$/);
  if ((o.status === 'waitlist' || o.status === 'rac') && position) return `${o.status === 'rac' ? 'RAC' : 'WL'} ${Number(position[1])}`;
  return code.replace(/^CURR_AVBL-0*/, 'Current AVL ') || TONE_LABEL[toneOf(o)];
}
export const stationCode = (terminal: Service['from']) => terminal.id.replace(/^[a-z]+:/, '');
const seatsFor = (o: Offer, passengers: number) => o.status === 'available' && Number.isInteger(o.seats) && o.seats! >= passengers;

/** A service's classes as a card shows them: the fares it knows and the newest offer in each class. */
export function legView(service: Service, check?: ServiceCheck) {
  const offers = new Map<string, Offer>();
  for (const offer of [...service.offers, ...(check?.offers ?? [])]) {
    const previous = offers.get(offer.classCode);
    if (!previous || offer.checkedAt >= previous.checkedAt) offers.set(offer.classCode, offer);
  }
  const fareList = check?.fares ?? service.fares ?? [];
  const fares = new Map(fareList.map(f => [f.classCode, f.amount]));
  return { offers, fares, classes: [...new Set([...fareList.map(f => f.classCode), ...offers.keys()])] };
}
/** Whether any class on a leg has a confirmed seat count for the whole party. */
export const legHasSeats = (service: Service, check: ServiceCheck | undefined, passengers: number) => [...legView(service, check).offers.values()].some(o => seatsFor(o, passengers));

/** What a journey offers at a glance: seats on every leg, its price with seats, or its lowest fares. */
export function summarize(journey: Journey, checks: Checks, passengers: number) {
  const views = journey.services.map(s => legView(s, checks[s.id]));
  const allSeats = views.every(v => [...v.offers.values()].some(o => seatsFor(o, passengers)));
  // The cheapest class with seats on each leg, and the cheapest fare on each leg whatever its seats.
  const cheapest = (amounts: (number | null | undefined)[]) => { const known = amounts.filter((a): a is number => typeof a === 'number'); return known.length ? Math.min(...known) : null; };
  const total = (list: (number | null)[]) => list.every(a => a !== null) ? list.reduce<number>((sum, a) => sum + a! * passengers, 0) : null;
  const price = allSeats ? total(views.map(v => cheapest([...v.offers.values()].filter(o => seatsFor(o, passengers)).map(o => o.amount ?? v.fares.get(o.classCode))))) : null;
  const from = total(views.map(v => cheapest([...v.fares.values()])));
  return { views, allSeats, price, from, tones: views.flatMap(v => [...v.offers.values()].map(toneOf)) };
}

/**
 * The journeys worth showing first: each one that no other journey beats outright. Another journey
 * beats it if it leaves no earlier, arrives no later, changes no more, has seats on every leg if
 * this one does, costs no more where both prices are known, and is better in at least one of these.
 */
export function bestJourneys(journeys: Journey[], checks: Checks, passengers: number) {
  const facts = journeys.map(j => { const s = summarize(j, checks, passengers); return { j, leave: Date.parse(j.services[0].departAt), arrive: Date.parse(j.services[j.services.length - 1].arriveAt), legs: j.services.length, seats: s.allSeats ? 1 : 0, cost: s.price ?? s.from }; });
  const beats = (a: typeof facts[number], b: typeof facts[number]) => {
    const costOk = a.cost === null || b.cost === null || a.cost <= b.cost;
    if (!(a.leave >= b.leave && a.arrive <= b.arrive && a.legs <= b.legs && a.seats >= b.seats && costOk)) return false;
    return a.leave > b.leave || a.arrive < b.arrive || a.legs < b.legs || a.seats > b.seats || (a.cost !== null && b.cost !== null && a.cost < b.cost);
  };
  return facts.filter(b => !facts.some(a => a !== b && beats(a, b))).map(f => f.j);
}

