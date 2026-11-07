import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchPlan,validateSearch,addDays,istDate,LIMITS } from '../lib/planner.mjs';
import { evaluateJourneys,sortJourneys,offerAvailable,safeBookingUrl } from '../lib/engine.mjs';
import { PLACES,searchPlaces } from '../lib/catalog.mjs';
import { NOW, QUERY, SERVICES, TRANSFERS } from './fixtures/connecting-services.mjs';
const clone=x=>structuredClone(x);

test('five different services connect, with midnight dates and a tight MB change',()=>{
  const r=evaluateJourneys(SERVICES,QUERY,TRANSFERS,NOW);
  assert.equal(r.journeys.length,1);const j=r.journeys[0];
  assert.deepEqual(j.services.map(s=>s.number),['05576','13152','14236','22549','04066']);
  assert.equal(j.services[4].departAt.slice(0,10),'2026-11-06');
  assert.equal(j.services[4].arriveAt.slice(0,10),'2026-11-07');
  assert.equal(j.transfers[0].gap,55);assert.equal(j.transfers[0].tight,true);
  assert.equal(j.durationMinutes,2855);assert.equal(j.knownCost,4060);
  assert.equal(j.costComplete,false);assert.equal(j.offersOnAllLegs,true);
  assert.equal(r.counters.candidatesGenerated,1);assert.equal(r.counters.offersOnAllLegs,1);
});
test('unknown PRYJ to SFG duration is unverified, not a successful connection',()=>{const r=evaluateJourneys(SERVICES,QUERY,[],NOW);assert.equal(r.journeys[0].feasibility,'unverified');assert.equal(r.journeys[0].offersOnAllLegs,false);assert.equal(r.counters.connectionFeasible,0);});
test('a negative or insufficient connection is pruned',()=>{const s=clone(SERVICES);s[1].departAt='2026-11-05T09:25:00+05:30';assert.equal(evaluateJourneys(s,QUERY,TRANSFERS,NOW).journeys.length,0);s[1].departAt='2026-11-05T08:25:00+05:30';assert.equal(evaluateJourneys(s,QUERY,TRANSFERS,NOW).journeys.length,0);});
test('two travellers cannot use the one-place Bareilly offer',()=>{assert.equal(evaluateJourneys(SERVICES,{...QUERY,passengers:2},TRANSFERS,NOW).journeys[0].offersOnAllLegs,false);});
test('RAC, request-to-book and unopened Tatkal are not available accommodation',()=>{const s=clone(SERVICES[0]);for(const status of ['rac','request','waitlist'])assert.equal(offerAvailable({...s.offers[0],status},s,1,NOW),false);assert.equal(offerAvailable({...s.offers[0],quota:'TQ'},s,1,NOW),false);assert.equal(offerAvailable({...s.offers[0],quota:'TQ',openingVerified:true},s,1,NOW),true);});
test('old, expired, future-dated and wrong-party offers do not pass',()=>{const s=SERVICES[0],o=s.offers[0];assert.equal(offerAvailable(o,s,1,NOW+180000),false);assert.equal(offerAvailable({...o,expiresAt:'2026-11-04T10:12:30+05:30'},s,1,NOW),false);assert.equal(offerAvailable({...o,checkedAt:'2026-11-04T10:14:00+05:30'},s,1,NOW),false);assert.equal(offerAvailable({...o,priceBasis:'party',partySize:2},s,1,NOW),false);});
test('seller and class variants do not inflate itinerary or service counts',()=>{const extra=clone(SERVICES[0]);extra.id='another-seller';extra.offers[0]={...extra.offers[0],id:'2A',classCode:'2A',amount:1470,source:'second-seller'};const r=evaluateJourneys([...SERVICES,extra],QUERY,TRANSFERS,NOW);assert.equal(r.counters.servicesReceived,6);assert.equal(r.counters.servicesDeduplicated,5);assert.equal(r.counters.candidatesGenerated,1);});
test('conflicting schedules are excluded instead of silently merged',()=>{const extra=clone(SERVICES[0]);extra.arriveAt='2026-11-05T09:50:00+05:30';const r=evaluateJourneys([...SERVICES,extra],QUERY,TRANSFERS,NOW);assert.equal(r.counters.rejected.scheduleConflict,1);assert.equal(r.journeys.length,0);});
test('equivalent time zone representations deduplicate physical services',()=>{for(const departureChanged of [true,false]){const extra=clone(SERVICES[0]);if(departureChanged)extra.departAt=new Date(extra.departAt).toISOString();extra.arriveAt=new Date(extra.arriveAt).toISOString();const r=evaluateJourneys([...SERVICES,extra],QUERY,TRANSFERS,NOW);assert.equal(r.counters.servicesDeduplicated,5);assert.equal(r.counters.rejected.scheduleConflict,0);assert.equal(r.journeys.length,1);}});
test('newer unavailable evidence supersedes older available observations',()=>{for(const status of ['waitlist','available']){const extra=clone(SERVICES[0]);extra.offers[0]={...extra.offers[0],status,seats:0,checkedAt:'2026-11-04T10:12:30+05:30'};for(const rows of [[...SERVICES,extra],[extra,...SERVICES]])assert.equal(evaluateJourneys(rows,QUERY,TRANSFERS,NOW).journeys[0].offersOnAllLegs,false);}});
test('equal-time contradictory offer evidence fails closed',()=>{const extra=clone(SERVICES[0]);extra.offers[0].status='waitlist';for(const rows of [[...SERVICES,extra],[extra,...SERVICES]])assert.equal(evaluateJourneys(rows,QUERY,TRANSFERS,NOW).journeys[0].offersOnAllLegs,false);});
test('today and date-flexible searches exclude already-departed first services',()=>{const s=clone(SERVICES[0]);s.departAt='2026-11-04T05:15:00+05:30';s.arriveAt='2026-11-04T09:05:00+05:30';const q={...QUERY,date:'2026-11-04',destinationId:'moradabad'};for(const query of [q,{...q,date:'2026-11-05',flexibility:1}]){const r=evaluateJourneys([s],query,[],NOW);assert.equal(r.journeys.length,0);assert.equal(r.counters.rejected.departed,1);}});
test('a nearby Kiul arrival is not relabelled as Jamalpur',()=>{const s=clone(SERVICES);s[4].to={id:'rail:KIUL',name:'Kiul',cityId:'kiul'};assert.equal(evaluateJourneys(s,QUERY,TRANSFERS,NOW).journeys.length,0);});
test('depth, elapsed time and partial-path work caps are enforced',()=>{assert.equal(evaluateJourneys(SERVICES,{...QUERY,depth:'thorough'},TRANSFERS,NOW).journeys.length,0);assert.equal(evaluateJourneys(SERVICES,{...QUERY,maxHours:24},TRANSFERS,NOW).journeys.length,0);const r=evaluateJourneys(SERVICES,QUERY,TRANSFERS,NOW,2);assert.equal(r.counters.truncated,true);assert.equal(r.counters.statesExpanded,2);});
test('latest arrival uses the actual final arrival date and requires a time zone',()=>{const r=evaluateJourneys(SERVICES,{...QUERY,latestArrival:'2026-11-06T23:59:00+05:30'},TRANSFERS,NOW);assert.equal(r.journeys.length,0);assert.equal(r.counters.rejected.arrivalDeadline,1);assert.equal(evaluateJourneys(SERVICES,{...QUERY,latestArrival:'2026-11-07T05:00:00+05:30'},TRANSFERS,NOW).journeys.length,1);assert.throws(()=>validateSearch({...QUERY,latestArrival:'2026-11-07T05:00'},NOW));});
test('a missing-cost subtotal cannot win complete-price sorting',()=>{const j=evaluateJourneys(SERVICES,QUERY,TRANSFERS,NOW).journeys[0];const low={...j,id:'low',knownCost:100,costComplete:false},full={...j,id:'full',knownCost:700,costComplete:true};assert.equal(sortJourneys([low,full],'price')[0].id,'full');});
test('query plan is bounded and deduplicates bus/carpool provider searches',()=>{const p=buildSearchPlan(QUERY,NOW,'fixed');assert.equal(p.queries.length,120);assert(p.omittedQueryCount>0);assert.equal(new Set(p.queries.map(q=>q.id)).size,p.queries.length);assert(p.queries.filter(q=>q.provider==='blablacar').every(q=>q.modes.includes('bus')&&q.modes.includes('carpool')));assert(p.queries.every(q=>q.status==='not_attempted'));});
test('extended plan includes the reference path query pairs and next-day boarding',()=>{const p=buildSearchPlan(QUERY,NOW,'fixed');for(const [from,to,date] of [['ANVT','MB','2026-11-05'],['MB','BE','2026-11-05'],['BE','LKO','2026-11-05'],['LKO','PRYJ','2026-11-06'],['PRYJ','JMP','2026-11-06']])assert(p.queries.some(q=>q.from===from&&q.to===to&&q.date===date),`${from} to ${to} ${date}`);});
test('flexibility drops dates outside the supported window explicitly',()=>{const p=buildSearchPlan({...QUERY,date:'2026-11-04',flexibility:2},NOW,'fixed');assert.deepEqual(p.omittedDates,['2026-11-02','2026-11-03']);assert(p.queries.every(q=>q.date>='2026-11-04'));});
test('input validation rejects invalid dates, same city and malformed modes',()=>{for(const input of [{...QUERY,date:'2026-11-03'},{...QUERY,date:'2026-11-31'},{...QUERY,originId:'jamalpur'},{...QUERY,modes:{}},{...QUERY,modes:[]},{...QUERY,passengers:7}])assert.throws(()=>validateSearch(input,NOW));assert.equal(istDate(Date.parse('2026-11-04T20:00:00Z')),'2026-11-05');assert.equal(addDays('2026-11-05',1),'2026-11-06');});
test('booking links reject credentials, unsafe schemes and lookalike hosts',()=>{assert(safeBookingUrl('https://www.confirmtkt.com/rbooking/'));for(const url of ['javascript:alert(1)','https://confirmtkt.com.evil.test','https://secret@confirmtkt.com/','http://blablacar.in/'])assert.equal(safeBookingUrl(url),null);});
// Longest linked chain of planned queries for one departure date: the first leg boards that day
// and each later leg boards on or after the previous one.
function chainForDate(plan,date){
  const usable=plan.queries.filter(q=>q.purpose==='direct'||q.purpose==='feeder'?q.date===date:q.date>=date);
  const next=new Map();for(const q of usable){if(!next.has(q.from))next.set(q.from,[]);next.get(q.from).push(q);}
  const ends=new Set([...plan.destination.rail,plan.destination.name]);let best=0;
  const walk=(node,legs,after,seen)=>{if(ends.has(node)){best=Math.max(best,legs);return;}for(const q of next.get(node)||[])if(q.date>=after&&!seen.has(q.to))walk(q.to,legs+1,q.date,new Set([...seen,q.to]));};
  for(const start of [...plan.origin.rail,...plan.origin.airports,plan.origin.name])walk(start,0,date,new Set([start]));
  return best;
}
test('flexible dates: every date gets queries and the chosen date gets every source',()=>{
  for(const depth of ['quick','thorough','extended'])for(const flexibility of [0,1,2]){
    const p=buildSearchPlan({...QUERY,date:'2026-11-10',flexibility,depth},NOW,'fixed'),label=`${depth} ±${flexibility}`;
    assert.equal(p.queries.length,LIMITS[depth].maxRequests,label);
    assert.equal(p.dateCoverage.length,2*flexibility+1,label);
    for(const d of p.dateCoverage)assert(d.planned>0&&d.planned<=d.proposed,`${label} ${d.date}`);
    assert.deepEqual([...new Set(p.queries.filter(q=>q.purpose==='direct'&&q.date==='2026-11-10').map(q=>q.provider))].sort(),['blablacar','confirmtkt','skyscanner'],label);
  }
});
test('each depth can chain its full number of services on every date',()=>{
  for(const [originId,destinationId] of [['gurugram','jamalpur'],['jamalpur','gurugram'],['chennai','delhi']])for(const depth of ['quick','thorough','extended'])for(const flexibility of [0,2]){
    const p=buildSearchPlan({...QUERY,originId,destinationId,date:'2026-11-10',depth,flexibility},NOW,'fixed');
    for(const date of p.dates)assert(chainForDate(p,date)>=LIMITS[depth].maxLegs,`${originId} to ${destinationId}, ${depth} ±${flexibility}, ${date}`);
  }
});
test('road connections are planned and pilot segments face the direction of travel',()=>{
  assert(buildSearchPlan(QUERY,NOW,'fixed').queries.some(q=>q.provider==='blablacar'&&q.purpose!=='direct'));
  const back=buildSearchPlan({...QUERY,originId:'jamalpur',destinationId:'gurugram'},NOW,'fixed');
  for(const [from,to] of [['MB','BE'],['BE','LKO'],['LKO','PRYJ']])assert(!back.queries.some(q=>q.from===from&&q.to===to),`${from} to ${to} heads away from Gurugram`);
  assert(back.queries.some(q=>q.from==='BE'&&q.to==='MB'),'the Moradabad–Bareilly segment is reversed for the return trip');
});
test('connection hubs lie between the two cities',()=>{
  const hubs=(originId,destinationId,depth='extended')=>buildSearchPlan({...QUERY,originId,destinationId,depth},NOW,'fixed').hubs;
  assert.deepEqual(hubs('mumbai','chennai'),['Pune','Hyderabad','Bengaluru']);
  assert.deepEqual(hubs('chennai','delhi','quick'),['Agra','Jhansi','Bhopal','Hyderabad']);
  const pilot=hubs('gurugram','jamalpur');for(const name of ['Patna','Moradabad','Bareilly','Lucknow','Prayagraj'])assert(pilot.includes(name),name);
  for(const name of ['Jaipur','Bhopal','Kolkata','New Delhi','Mumbai'])assert(!pilot.includes(name),name);
  assert.deepEqual(hubs('bengaluru','chennai'),[]);
});
test('city search finds station and airport codes, best match first',()=>{
  for(const [term,id] of [['NDLS','delhi'],['HWH','kolkata'],['BLR','bengaluru'],['CSMT','mumbai'],['PAT','patna'],['JMP','jamalpur'],['gurgaon','gurugram'],['Delhi','delhi'],['DGH','deoghar'],['DBR','darbhanga'],['BE','bareilly'],['Ben','bengaluru'],['GWL','jhansi'],['UJN','ujjain'],['ujj','ujjain']])assert.equal(searchPlaces(term)[0]?.id,id,term);
  assert(searchPlaces('bihar').some(p=>p.id==='patna'));assert.equal(searchPlaces(' ').length,PLACES.length);assert.deepEqual(searchPlaces('zzz'),[]);
});
test('journeys over the fare cap do not count as offered or feasible',()=>{
  const r=evaluateJourneys(SERVICES,{...QUERY,budget:3000},TRANSFERS,NOW);
  assert.equal(r.journeys.length,0);assert.equal(r.counters.rejected.budget,1);assert.equal(r.counters.itinerariesEvaluated,1);
  assert.equal(r.counters.offersOnAllLegs,0);assert.equal(r.counters.connectionFeasible,0);assert.equal(r.counters.availabilityChecked,0);
  const kept=evaluateJourneys(SERVICES,{...QUERY,budget:5000},TRANSFERS,NOW);assert.equal(kept.journeys.length,1);assert.equal(kept.counters.offersOnAllLegs,1);
});
test('a first service from a nearby terminal back into the origin city is never used',()=>{
  const offer={id:'o',status:'available',classCode:'3A',seats:5,amount:500,currency:'INR',priceBasis:'person',checkedAt:'2026-11-04T10:12:00+05:30',source:'s'};
  const svc=(number,from,to,departAt,arriveAt)=>({id:number,number,name:'n',mode:'train',from,to,departAt,arriveAt,offers:[offer]});
  const jmp={id:'rail:JMP',name:'JMP',cityId:'jamalpur'},mgr={id:'rail:MGR',name:'MGR',cityId:'munger'},pnbe={id:'rail:PNBE',name:'PNBE',cityId:'patna'};
  const services=[svc('1',jmp,mgr,'2026-11-05T06:00:00+05:30','2026-11-05T06:30:00+05:30'),svc('2',mgr,pnbe,'2026-11-05T08:00:00+05:30','2026-11-05T12:00:00+05:30')];
  assert.deepEqual(evaluateJourneys(services,{...QUERY,originId:'munger',destinationId:'patna'},[],NOW).journeys.map(j=>j.services.map(s=>s.number)),[['2']]);
});
