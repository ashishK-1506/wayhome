'use client';

import { ArrowUpRight, Bus, Car, Clock, Plane, RefreshCw, Train } from 'lucide-react';
import { safeBookingUrl } from '@/lib/engine.mjs';
import { trainSearchUrl } from '@/lib/live/irctc-dev.mjs';
import type { Journey, Service } from '@/lib/model';
import { MONEY, clock, date, duration, istDay, weekday } from './format';
import { TONE_LABEL, legView, shortStatus, stationCode, summarize, toneOf, type Checks, type ServiceCheck } from './journey-view';

export { bestJourneys, legHasSeats, type Checks, type ServiceCheck } from './journey-view';

const MODE_ICON = { train: Train, flight: Plane, bus: Bus, carpool: Car };


type CardProps = { journey: Journey; checks: Checks; passengers: number; canCheck: boolean; asOfDay: string; onCheck: (service: Service, classCode?: string) => void };

/** One way to make the trip: each service with its times, its classes and how full they are. */
export function JourneyCard({ journey, checks, passengers, canCheck, asOfDay, onCheck }: CardProps) {
  const legs = journey.services, first = legs[0], last = legs[legs.length - 1], Icon = MODE_ICON[first.mode];
  const { allSeats, price, from, tones } = summarize(journey, checks, passengers);
  const status = allSeats ? { tone: 'available', text: legs.length === 1 ? 'Seats available' : 'Seats on every leg' }
    : tones.some(t => t === 'waitlist' || t === 'rac') ? { tone: 'waitlist', text: 'Waitlist or RAC' }
    : tones.includes('closed') ? { tone: 'closed', text: 'Booking closed' }
    : { tone: 'unknown', text: 'Seats not checked' };
  const warnings = journey.warnings.filter(w => !(allSeats && w.startsWith('Available accommodation')) && !(price !== null && w.startsWith('Some ticket or transfer prices')));
  const kind = legs.length === 1 ? `Direct ${first.mode}` : `${legs.length} ${legs.every(s => s.mode === 'train') ? 'trains' : 'services'} · change at ${legs.slice(1).map(s => s.from.name).join(', ')}`;
  return <article className="journey-card trip-card">
    <header className="trip-head">
      <div>
        <span className="trip-kind"><Icon size={14} aria-hidden="true" /> {kind}</span>
        <h3>{first.from.name} → {last.to.name}</h3>
        <p>{clock(first.departAt)} {date(first.departAt)} → {clock(last.arriveAt)} {date(last.arriveAt)} · {duration(journey.durationMinutes)}</p>
      </div>
      <div className="trip-price">
        <span className={'trip-status ' + status.tone}>{status.text}</span>
        {price !== null ? <><strong>{MONEY(price)}</strong><small>{passengers === 1 ? '1 adult' : `${passengers} adults`}, cheapest seats</small></>
          : from !== null ? <><strong>from {MONEY(from)}</strong><small>fare only, seats not confirmed</small></>
          : <><strong>—</strong><small>Fare not known yet</small></>}
      </div>
    </header>
    {legs.map((service, i) => <Leg key={service.id} service={service} transfer={i > 0 ? journey.transfers[i - 1] : null} check={checks[service.id]} canCheck={canCheck} asOfDay={asOfDay} onCheck={onCheck} />)}
    {warnings.length > 0 && <details className="trip-notes"><summary>Notes</summary><ul>{warnings.map(w => <li key={w}>{w}</li>)}</ul></details>}
  </article>;
}

type LegProps = { service: Service; transfer: Journey['transfers'][number] | null; check?: ServiceCheck; canCheck: boolean; asOfDay: string; onCheck: CardProps['onCheck'] };

function Leg({ service, transfer, check, canCheck, asOfDay, onCheck }: LegProps) {
  const view = legView(service, check), offers = [...view.offers.values()];
  const latest = offers.reduce<string | null>((newest, o) => !newest || o.checkedAt > newest ? o.checkedAt : newest, null);
  const link = safeBookingUrl(offers[0]?.bookingUrl ?? (service.mode === 'train' ? trainSearchUrl(stationCode(service.from), stationCode(service.to), istDay(service.departAt)) : undefined));
  const days = Math.round((Date.parse(istDay(service.arriveAt)) - Date.parse(istDay(service.departAt))) / 86400000);
  const minutes = (Date.parse(service.arriveAt) - Date.parse(service.departAt)) / 60000;
  const nextDays = offers.find(o => o.calendar?.length);
  const source = service.id.startsWith('irctc.dev:') ? 'irctc.dev' : offers[0]?.source;
  return <>
    {transfer && <div className="trip-change"><Clock size={13} aria-hidden="true" /> {duration(transfer.gap)} to change at {service.from.name}{transfer.known ? ' · separate tickets' : ' · transfer time not verified'}{transfer.tight ? ' · tight' : ''}</div>}
    <section className="leg" aria-label={`${service.number} ${service.name}`}>
      <div className="leg-title"><strong>{service.number}</strong> {service.name}</div>
      <div className="leg-times">
        <div><strong>{clock(service.departAt)}</strong><span>{stationCode(service.from)} · {service.from.name}</span><small>{weekday(istDay(service.departAt))}</small></div>
        <div className="leg-line"><span>{duration(minutes)}</span><i /></div>
        <div><strong>{clock(service.arriveAt)}{days > 0 && <sup>+{days}</sup>}</strong><span>{stationCode(service.to)} · {service.to.name}</span><small>{weekday(istDay(service.arriveAt))}</small></div>
      </div>
      {view.classes.length > 0
        ? <ul className="class-tiles" aria-label={`Classes on ${service.number}`}>{view.classes.map(cls => {
            const offer = view.offers.get(cls), fare = offer?.amount ?? view.fares.get(cls), tone = offer ? toneOf(offer) : 'unchecked';
            return <li key={cls} className={'class-tile ' + tone} title={offer?.statusText}>
              <div className="tile-head"><b>{cls}</b>{typeof fare === 'number' && <span>{MONEY(fare)}</span>}</div>
              {offer ? <><strong>{shortStatus(offer)}</strong><small>{TONE_LABEL[toneOf(offer)]}</small></>
                : canCheck ? <button type="button" onClick={() => onCheck(service, cls)} disabled={!!check?.busy} aria-label={`Check seats in ${cls} on ${service.number}`}>{check?.busy === cls ? <><RefreshCw size={12} className="spinning" aria-hidden="true" /> Checking…</> : 'Check seats'}</button>
                : <small>Not checked</small>}
            </li>;
          })}</ul>
        : <div className="leg-unchecked">{canCheck
            ? <button type="button" className="outline-button" onClick={() => onCheck(service)} disabled={!!check?.busy}>{check?.busy ? <><RefreshCw size={13} className="spinning" aria-hidden="true" /> Checking…</> : 'Check fares and seats'}</button>
            : <span>Fares and seats not checked</span>}</div>}
      {nextDays && <div className="leg-calendar"><span>Next days · {nextDays.classCode}</span><ul>{nextDays.calendar!.map(day => <li key={day.date} className={toneOf(day)} title={day.statusText}><b>{weekday(day.date)}</b> {shortStatus(day)}</li>)}</ul></div>}
      {check?.error && <p className="leg-error" role="status">{check.error}</p>}
      <div className="leg-foot">
        <span>{latest ? `${source ?? 'Provider'}, as of ${istDay(latest) === asOfDay ? '' : date(latest) + ' '}${clock(latest)}` : `Times from ${source ?? 'the provider'} · seats not checked`}</span>
        {link && <a href={link} target="_blank" rel="noreferrer">{service.mode === 'train' ? 'Book on ConfirmTkt' : 'Open provider'} <ArrowUpRight size={13} aria-hidden="true" /></a>}
      </div>
    </section>
  </>;
}
