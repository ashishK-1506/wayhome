import { findPlace } from './catalog.mjs';
import { LIMITS, addDays } from './planner.mjs';
const MINUTE=60000;
const MAX_AGE={train:120000,flight:90000,bus:120000,carpool:120000};
const VALID_STATUSES=new Set(['available','rac','waitlist','request','unknown']);
const instant=value=>typeof value==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(value)?Date.parse(value):NaN;
// Calendar date in India (UTC+05:30 all year, no daylight saving) for a timestamp.
const istDay=time=>new Date(time+330*MINUTE).toISOString().slice(0,10);
export function safeBookingUrl(value){try{const u=new URL(value);const hosts=['confirmtkt.com','blablacar.in','blablacar.com','skyscanner.net','skyscanner.co.in','skyscanner.com'];return u.protocol==='https:'&&!u.username&&!u.password&&hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))?u.href:null;}catch{return null;}}
export function validateService(service){
  if(!service||typeof service!=='object'||!['train','flight','bus','carpool'].includes(service.mode))return false;
  if(![service.id,service.number,service.name,service.from?.id,service.from?.name,service.to?.id,service.to?.name,service.from?.cityId,service.to?.cityId].every(v=>typeof v==='string'&&v.length>0&&v.length<=300))return false;
  const start=instant(service.departAt),end=instant(service.arriveAt);
  return Number.isFinite(start)&&Number.isFinite(end)&&end>start&&Array.isArray(service.offers)&&service.offers.length<=100&&service.offers.every(o=>o&&[o.id,o.classCode,o.source].every(v=>typeof v==='string'&&v.length>0&&v.length<=300)&&VALID_STATUSES.has(o.status)&&['person','party'].includes(o.priceBasis)&&typeof o.currency==='string'&&Number.isFinite(instant(o.checkedAt))&&(o.seats===undefined||Number.isInteger(o.seats)&&o.seats>=0)&&(o.amount===null||Number.isFinite(o.amount)&&o.amount>=0));
}
export function offerFresh(offer,mode,now){const checked=instant(offer.checkedAt);if(!Number.isFinite(checked)||checked>now||now-checked>MAX_AGE[mode])return false;if(offer.expiresAt){const expiry=instant(offer.expiresAt);if(!Number.isFinite(expiry)||expiry<=now)return false;}return true;}
export function offerAmount(offer,passengers){if(!offer||offer.amount===null||offer.currency!=='INR')return null;if(offer.priceBasis==='party'&&offer.partySize!==passengers)return null;return offer.priceBasis==='person'?offer.amount*passengers:offer.amount;}
export function offerAvailable(offer,service,passengers,now){
  if(!offer||offer.status!=='available'||!offerFresh(offer,service.mode,now))return false;
  if(offer.quota==='TQ'&&offer.openingVerified!==true)return false;
  if(Number.isInteger(offer.seats)&&offer.seats<passengers)return false;
  if(offer.priceBasis==='party'&&offer.partySize!==passengers)return false;
  // A count or an explicit matching-party offer is required; no invented capacity.
  return (Number.isInteger(offer.seats)&&offer.seats>=passengers)||offer.partySize===passengers;
}
const serviceKey=s=>[s.mode,s.number,s.from.id,s.to.id,instant(s.departAt)].join('|');
const offerKey=o=>[o.source,o.id,o.classCode,o.quota||''].join('|');
const observationKey=o=>JSON.stringify([o.status,o.seats??null,o.partySize??null,o.priceBasis,o.amount,o.currency,o.expiresAt?instant(o.expiresAt):null,o.openingVerified??null,o.bookingUrl??null,o.linkType??null]);
function latestOffers(offers){
  const latest=new Map();
  for(const offer of offers){
    const key=offerKey(offer),previous=latest.get(key);
    if(!previous||instant(offer.checkedAt)>instant(previous.checkedAt))latest.set(key,offer);
    else if(instant(offer.checkedAt)===instant(previous.checkedAt)&&observationKey(offer)!==observationKey(previous))latest.set(key,{...previous,status:'unknown',seats:0,amount:null});
  }
  return [...latest.values()];
}

export function evaluateJourneys(input,query,transfers=[],now=Date.now(),maxCandidates=25000){
  const counters={servicesReceived:input.length,servicesDeduplicated:0,statesExpanded:0,candidatesGenerated:0,itinerariesEvaluated:0,connectionsEvaluated:0,connectionFeasible:0,availabilityChecked:0,offersOnAllLegs:0,rejected:{invalidService:0,scheduleConflict:0,departed:0,cycle:0,timing:0,duration:0,deadEnd:0,budget:0,arrivalDeadline:0},truncated:false};
  const dedup=new Map(),conflicts=new Set();
  for(const s of input.slice(0,10000)){if(!validateService(s)){counters.rejected.invalidService++;continue;}const key=serviceKey(s);if(conflicts.has(key))continue;const prev=dedup.get(key);if(prev&&instant(prev.arriveAt)!==instant(s.arriveAt)){dedup.delete(key);conflicts.add(key);counters.rejected.scheduleConflict++;continue;}dedup.set(key,{...(prev||s),offers:latestOffers([...(prev?.offers||[]),...s.offers])});}
  const inputTruncated=input.length>10000;
  const kept=[...dedup.values()].filter(s=>query.modes.includes(s.mode));
  // Parse each service's times once.
  const departs=new Map(kept.map(s=>[s,instant(s.departAt)])),arrives=new Map(kept.map(s=>[s,instant(s.arriveAt)]));
  const services=kept.sort((a,b)=>departs.get(a)-departs.get(b)||serviceKey(a).localeCompare(serviceKey(b)));
  counters.servicesDeduplicated=services.length;
  const transferMap=new Map(transfers.filter(t=>Number.isFinite(t.minutes)&&t.minutes>=0&&Number.isFinite(t.bufferMinutes)&&t.bufferMinutes>=0&&t.evidence).map(t=>[t.fromId+'|'+t.toId,t]));
  const maxLegs=LIMITS[query.depth]?.maxLegs??2;
  const journeys=[],visitedCandidates=new Set();
  const dates=[];for(let d=-query.flexibility;d<=query.flexibility;d++)dates.push(addDays(query.date,d));
  function selectOffer(service){const offers=service.offers.filter(o=>offerAvailable(o,service,query.passengers,now));offers.sort((a,b)=>(offerAmount(a,query.passengers)??Infinity)-(offerAmount(b,query.passengers)??Infinity)||offerKey(a).localeCompare(offerKey(b)));return offers[0]||null;}
  // Departures from each city, and from each city straight into the destination, in departure order.
  const departures=new Map(),intoDestination=new Map();
  for(const s of services){for(const [map,use] of [[departures,true],[intoDestination,s.to.cityId===query.destinationId]])if(use){if(!map.has(s.from.cityId))map.set(s.from.cityId,[]);map.get(s.from.cityId).push(s);}}
  // Position of the first service in a departure-ordered list that leaves at or after `time`.
  const firstLeaving=(list,time)=>{let lo=0,hi=list.length;while(lo<hi){const mid=(lo+hi)>>1;if(departs.get(list[mid])<time)lo=mid+1;else hi=mid;}return lo;};
  // Count one route against the work cap and record it if it reached the destination.
  // Returns true when the route can still be extended.
  function visit(path,connections){
    if(counters.statesExpanded>=maxCandidates){counters.truncated=true;return false;}counters.statesExpanded++;
    const last=path.at(-1),first=path[0];
    if(last.to.cityId===query.destinationId){
      const key=path.map(serviceKey).join('>');if(visitedCandidates.has(key))return false;visitedCandidates.add(key);counters.candidatesGenerated++;
      if(query.latestArrival&&arrives.get(last)>instant(query.latestArrival)){counters.rejected.arrivalDeadline++;return false;}
      const durationMinutes=(arrives.get(last)-departs.get(first))/MINUTE;if(durationMinutes>query.maxHours*60){counters.rejected.duration++;return false;}
      counters.itinerariesEvaluated++;
      const selectedOffers=path.map(selectOffer),amounts=selectedOffers.map(o=>offerAmount(o,query.passengers)),transferCosts=connections.map(c=>c.cost);
      const costComplete=amounts.every(a=>a!==null)&&transferCosts.every(c=>c!==null);const knownCost=[...amounts,...transferCosts].reduce((sum,n)=>sum+(n??0),0);
      // Apply the fare cap before counting: journeys it rejects are never shown.
      if(query.budget!==null&&knownCost>query.budget){counters.rejected.budget++;return false;}
      const feasibility=connections.every(c=>c.known)?'feasible':'unverified';if(feasibility==='feasible')counters.connectionFeasible++;
      const checkedAll=path.every(s=>s.offers.some(o=>offerFresh(o,s.mode,now)&&(o.partySize===query.passengers||o.priceBasis==='person'&&Number.isInteger(o.seats))));if(checkedAll)counters.availabilityChecked++;
      const offersOnAllLegs=feasibility==='feasible'&&selectedOffers.every(Boolean);if(offersOnAllLegs)counters.offersOnAllLegs++;
      const warnings=[];if(feasibility==='unverified')warnings.push('A station or terminal transfer has no verified duration.');if(connections.some(c=>c.tight))warnings.push('This journey includes a tight, separate-ticket connection.');if(!costComplete)warnings.push('Some ticket or transfer prices are missing.');if(connections.some(c=>c.gap>=600))warnings.push('An overnight wait may require accommodation.');
      if(!offersOnAllLegs)warnings.push('Available accommodation has not been established on every leg.');warnings.push('Time and cost exclude unquoted travel to the first terminal and from the last terminal.');
      journeys.push({id:key,services:path,selectedOffers,durationMinutes,knownCost,costComplete,offersOnAllLegs,transfers:connections,feasibility,warnings});return false;
    }
    return path.length<maxLegs;
  }
  // Every valid next service after a route, with the connection it would need. Only services leaving
  // after the arrival are scanned, and on the last allowed leg only services into the destination,
  // because no other last leg can finish a journey. The scan stops past the journey-time horizon.
  function* extensions({path,connections,seen}){
    const last=path.at(-1),first=path[0],arrived=arrives.get(last),horizon=departs.get(first)+query.maxHours*60*MINUTE;
    const list=(path.length===maxLegs-1?intoDestination:departures).get(last.to.cityId)||[];
    for(let i=firstLeaving(list,arrived);i<list.length;i++){
      const next=list[i];
      if(departs.get(next)>horizon)break;
      if(next.number===last.number&&next.mode===last.mode)continue;
      counters.connectionsEvaluated++;
      if(seen.has(next.to.cityId)){counters.rejected.cycle++;continue;}
      const gap=(departs.get(next)-arrived)/MINUTE;
      if(arrives.get(next)>horizon){counters.rejected.duration++;continue;}
      // A route that will need exactly one more leg is useless if nothing leaves its city for the destination in time.
      if(path.length===maxLegs-2&&next.to.cityId!==query.destinationId){const onward=intoDestination.get(next.to.cityId)||[],at=firstLeaving(onward,arrives.get(next));if(at>=onward.length||departs.get(onward[at])>horizon){counters.rejected.deadEnd++;continue;}}
      let required,known,cost;
      if(last.to.id===next.from.id){known=true;required=last.mode==='flight'||next.mode==='flight'?180:45;cost=0;}
      else{const t=transferMap.get(last.to.id+'|'+next.from.id);known=!!t;required=t?t.minutes+t.bufferMinutes:null;cost=t?.cost??null;}
      if(known&&gap<required){counters.rejected.timing++;continue;}
      yield {path:[...path,next],connections:[...connections,{from:last.to.name,to:next.from.name,gap,required,known,tight:known&&gap<required+45,cost}],seen:new Set([...seen,next.to.cityId])};
    }
  }
  // Search level by level: every one-service journey, then every two-service journey, and so on,
  // so hitting the work cap only drops the longest journeys. Within a level, routes that start
  // with different first services take turns one extension at a time, so no early departure
  // uses up the budget before later ones get their earliest connections tried.
  const origin=findPlace(query.originId);const nearbyOrigin=new Set([...(origin?.rail||[]).map(x=>'rail:'+x),...(origin?.airports||[]).map(x=>'air:'+x)]);
  let level=[];
  for(const first of services){if(first.from.cityId!==query.originId&&!nearbyOrigin.has(first.from.id)||!dates.includes(istDay(departs.get(first))))continue;if(departs.get(first)<=now){counters.rejected.departed++;continue;}
    // Boarding at a nearby terminal in another city only makes sense when the train leaves the origin behind.
    if(first.to.cityId===query.originId){counters.rejected.cycle++;continue;}const route={path:[first],connections:[],seen:new Set([query.originId,first.from.cityId,first.to.cityId])};if(visit(route.path,route.connections))level.push([route]);if(counters.truncated)break;}
  while(level.length&&!counters.truncated){
    const nextLevel=level.map(()=>[]),streams=level.map(function*(group){for(const route of group)yield* extensions(route);});
    for(let open=streams.length;open&&!counters.truncated;){
      open=0;
      for(let i=0;i<streams.length&&!counters.truncated;i++){
        if(!streams[i])continue;
        const {value:child,done}=streams[i].next();
        if(done){streams[i]=null;continue;}
        open++;if(visit(child.path,child.connections))nextLevel[i].push(child);
      }
    }
    level=nextLevel.filter(group=>group.length);
  }
  counters.truncated=counters.truncated||inputTruncated;return {journeys,counters};
}
export function sortJourneys(journeys,sort='fastest'){
  return [...journeys].sort((a,b)=>{
    if(sort==='price')return Number(b.costComplete)-Number(a.costComplete)||a.knownCost-b.knownCost||a.durationMinutes-b.durationMinutes||a.id.localeCompare(b.id);
    if(sort==='changes')return a.services.length-b.services.length||a.durationMinutes-b.durationMinutes||a.id.localeCompare(b.id);
    if(sort==='available')return Number(b.offersOnAllLegs)-Number(a.offersOnAllLegs)||a.durationMinutes-b.durationMinutes||a.id.localeCompare(b.id);
    return a.durationMinutes-b.durationMinutes||a.services.length-b.services.length||a.id.localeCompare(b.id);
  });
}
