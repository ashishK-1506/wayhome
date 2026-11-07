import { PLACES, findPlace } from './catalog.mjs';

export const LIMITS = {
  quick:{maxLegs:2,maxRequests:16,maxCandidates:5000,concurrency:3,deadlineSeconds:60},
  thorough:{maxLegs:3,maxRequests:48,maxCandidates:15000,concurrency:3,deadlineSeconds:90},
  extended:{maxLegs:5,maxRequests:120,maxCandidates:25000,concurrency:3,deadlineSeconds:90},
};
// Hubs make changes possible at every depth; thorough and extended also link hubs to each other.
const HUB_COUNT={quick:4,thorough:8,extended:16};
// A hub must lie roughly on the way: going through it is at most 30% longer than the straight line.
const MAX_DETOUR=1.3;
// Rough timing used only to guess which day a chain reaches each hub: a 06:00 start,
// 55 km/h over 1.3 times the straight-line distance, and an hour for each change.
const CHAIN_START_HOUR=6,CHAIN_KMH=55,CHAIN_CIRCUITY=1.3,CHAIN_CHANGE_HOURS=1;
// Hand-picked corridor segments from the original Gurugram–Jamalpur research.
const PILOT_PAIRS=[['moradabad','bareilly'],['bareilly','lucknow'],['lucknow','prayagraj'],['lucknow','kanpur'],['kanpur','prayagraj'],['prayagraj','varanasi'],['varanasi','gaya'],['gaya','kiul'],['patna','mokama'],['mokama','kiul']];
export const istDate = time => new Date(time).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
export const addDays = (date,days) => new Date(Date.parse(date+'T12:00:00+05:30')+days*86400000).toISOString().slice(0,10);
const RADIANS=Math.PI/180;
const distanceKm=(a,b)=>{const h=Math.sin((b.lat-a.lat)*RADIANS/2)**2+Math.cos(a.lat*RADIANS)*Math.cos(b.lat*RADIANS)*Math.sin((b.lon-a.lon)*RADIANS/2)**2;return 12742*Math.asin(Math.sqrt(h));};
// Round-robin merge: the first item of every list, then the second of every list, and so on.
const interleave=lists=>{const out=[];for(let i=0;lists.some(list=>i<list.length);i++)for(const list of lists)if(i<list.length)out.push(list[i]);return out;};
const groupBy=(items,key)=>{const groups=new Map();for(const item of items){const k=key(item);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(item);}return [...groups.values()];};

// Bad search input. The API returns its message to the user; any other error is internal.
export class ValidationError extends Error {}

export function validateSearch(input, now=Date.now()) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ValidationError('Enter your journey details.');
  if(!findPlace(input.originId)||!findPlace(input.destinationId))throw new ValidationError('Choose a supported city from each dropdown.');
  if(input.originId===input.destinationId)throw new ValidationError('Choose different departure and destination cities.');
  if(typeof input.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!Number.isFinite(Date.parse(input.date+'T12:00:00Z'))||new Date(input.date+'T12:00:00Z').toISOString().slice(0,10)!==input.date)throw new ValidationError('Choose a valid departure date.');
  const today=istDate(now);if(input.date<today||input.date>addDays(today,60))throw new ValidationError('Choose a date from today through the next 60 days.');
  if(!Number.isInteger(input.passengers)||input.passengers<1||input.passengers>6)throw new ValidationError('Choose between 1 and 6 adult passengers.');
  if(!Array.isArray(input.modes))throw new ValidationError('Select at least one travel mode.');const modes=[...new Set(input.modes)];if(!modes.length||modes.some(m=>!['train','flight','bus','carpool'].includes(m)))throw new ValidationError('Select at least one travel mode.');
  if(!Object.hasOwn(LIMITS,input.depth))throw new ValidationError('Choose a search depth.');
  if(![0,1,2].includes(input.flexibility))throw new ValidationError('Choose an exact date or flexibility of 1–2 days.');
  if(input.budget!==null&&(!Number.isFinite(input.budget)||input.budget<=0||input.budget>1000000))throw new ValidationError('Enter a positive fare cap up to ₹10,00,000, or leave it empty.');
  if(!Number.isInteger(input.maxHours)||input.maxHours<6||input.maxHours>96)throw new ValidationError('Journey duration must be between 6 and 96 hours.');
  const latestArrival=input.latestArrival??null;
  if(latestArrival!==null&&(typeof latestArrival!=='string'||!/(?:Z|[+-]\d\d:\d\d)$/.test(latestArrival)||!Number.isFinite(Date.parse(latestArrival))||Date.parse(latestArrival)<Date.parse(input.date+'T00:00:00+05:30')))throw new ValidationError('Latest arrival must be a valid time on or after the departure date.');
  return {originId:input.originId,destinationId:input.destinationId,date:input.date,passengers:input.passengers,modes,depth:input.depth,flexibility:input.flexibility,budget:input.budget,maxHours:input.maxHours,latestArrival,availabilityOnly:input.availabilityOnly===true};
}

// Interchange cities between the two places: nearer to each end than the ends are to each
// other, and only a short detour. The closest-to-the-line hubs are chosen, then kept in the
// catalogue's published (priority) order. A city sharing a station with either end is skipped.
function selectHubs(origin,destination,depth){
  const direct=distanceKm(origin,destination),shared=new Set([...origin.rail,...destination.rail]);
  const detour=p=>(distanceKm(origin,p)+distanceKm(p,destination))/direct;
  const onTheWay=PLACES.filter(p=>p.hub&&p.id!==origin.id&&p.id!==destination.id&&!p.rail.some(code=>shared.has(code))&&distanceKm(origin,p)<direct&&distanceKm(p,destination)<direct&&detour(p)<=MAX_DETOUR);
  const closest=new Set([...onTheWay].sort((a,b)=>detour(a)-detour(b)).slice(0,HUB_COUNT[depth]));
  return onTheWay.filter(p=>closest.has(p));
}

// Hubs for one linked chain with `count` changes. A single change uses the top-priority hub.
// Longer chains pick the hubs that split the route most evenly (the shortest possible longest
// leg), visited in order of distance to the destination so every leg makes progress.
function chainHubs(origin,destination,hubs,count){
  if(!hubs.length)return [];
  if(count===1)return [hubs[0]];
  const ordered=[...hubs].sort((a,b)=>distanceKm(b,destination)-distanceKm(a,destination));
  if(ordered.length<=count)return ordered;
  let best=[],bestLongest=Infinity;
  const choose=(start,path)=>{
    if(path.length===count){const stops=[origin,...path,destination],longest=Math.max(...stops.slice(1).map((stop,i)=>distanceKm(stops[i],stop)));if(longest<bestLongest){best=path;bestLongest=longest;}return;}
    for(let i=start;i<=ordered.length-(count-path.length);i++)choose(i+1,[...path,ordered[i]]);
  };
  choose(0,[]);
  return best;
}

export function buildSearchPlan(input, now=Date.now(), runId=crypto.randomUUID()) {
  const query=validateSearch(input,now),origin=findPlace(query.originId),destination=findPlace(query.destinationId),limits=LIMITS[query.depth];
  const today=istDate(now),last=addDays(today,60),omittedDates=[];
  const dates=[];for(let d=-query.flexibility;d<=query.flexibility;d++){const date=addDays(query.date,d);if(date<today||date>last)omittedDates.push(date);else dates.push(date);}
  // The chosen date first, then the nearest alternatives (earlier before later).
  const daysAway=date=>Math.abs(Date.parse(date)-Date.parse(query.date));
  const byPriority=[...dates].sort((a,b)=>daysAway(a)-daysAway(b)||a.localeCompare(b));
  const hubs=selectHubs(origin,destination,query.depth),trains=query.modes.includes('train'),roadModes=query.modes.filter(m=>['bus','carpool'].includes(m));
  // Hub-to-hub hops: the pilot segments first (turned to face the destination), then any hop that gets closer.
  const hops=[];
  if(query.depth!=='quick'){
    const closer=(a,b)=>distanceKm(b,destination)<distanceKm(a,destination);
    for(const [a,b] of PILOT_PAIRS){const x=hubs.find(h=>h.id===a),y=hubs.find(h=>h.id===b);if(x&&y)hops.push(closer(x,y)?[x,y]:[y,x]);}
    for(const x of hubs)for(const y of hubs)if(x!==y&&closer(x,y))hops.push([x,y]);
  }
  // Road searches have no hub-to-hub queries, so a road-only chain has a single change.
  const chainStops=trains?chainHubs(origin,destination,hubs,limits.maxLegs-1):roadModes.length&&hubs.length?[hubs[0]]:[];
  const seen=new Map();
  const propose=(provider,modes,from,to,date,purpose)=>{if(from===to||date<today||date>last)return null;const key=[provider,from,to,date,query.passengers].join('|');const prev=seen.get(key);if(prev){prev.modes=[...new Set([...prev.modes,...modes])];return prev;}const q={id:key,provider,modes,from,to,date,passengers:query.passengers,purpose,status:'not_attempted'};seen.set(key,q);return q;};
  const byDate=byPriority.map(date=>{
    // Every query this date would use, including ones it shares with other dates.
    const lists={direct:[],feeder:[],onward:[],interhub:[]},member=new Set(),chain=[];
    const add=(purpose,q)=>{if(q&&!member.has(q)){member.add(q);lists[purpose].push(q);}return q;};
    if(trains){
      for(const from of origin.rail)for(const to of destination.rail)add('direct',propose('confirmtkt',['train'],from,to,date,'direct'));
      for(const hub of hubs)for(const from of origin.rail)add('feeder',propose('confirmtkt',['train'],from,hub.rail[0],date,'feeder'));
      for(let offset=0;offset<=Math.ceil(query.maxHours/24);offset++)for(const hub of hubs)for(const to of destination.rail)add('onward',propose('confirmtkt',['train'],hub.rail[0],to,addDays(date,offset),'onward'));
      for(const [a,b] of hops)for(let offset=0;offset<=1;offset++)add('interhub',propose('confirmtkt',['train'],a.rail[0],b.rail[0],addDays(date,offset),'interhub'));
    }
    if(query.modes.includes('flight'))for(const from of origin.airports)for(const to of destination.airports)add('direct',propose('skyscanner',['flight'],from,to,date,'direct'));
    if(roadModes.length){
      add('direct',propose('blablacar',roadModes,origin.name,destination.name,date,'direct'));
      for(const hub of hubs.slice(0,6)){add('feeder',propose('blablacar',roadModes,origin.name,hub.name,date,'feeder'));for(let offset=0;offset<=1;offset++)add('onward',propose('blablacar',roadModes,hub.name,destination.name,addDays(date,offset),'onward'));}
    }
    // One linked chain through the chain hubs, each leg dated for when the traveller would roughly get there.
    if(chainStops.length){
      const points=[origin,...chainStops,destination],code=p=>trains?p.rail[0]:p.name;let hours=CHAIN_START_HOUR;
      for(let i=1;i<points.length;i++){
        const purpose=i===1?'feeder':i===points.length-1?'onward':'interhub';
        chain.push(add(purpose,propose(trains?'confirmtkt':'blablacar',trains?['train']:roadModes,code(points[i-1]),code(points[i]),addDays(date,Math.floor(hours/24)),purpose)));
        hours+=distanceKm(points[i-1],points[i])*CHAIN_CIRCUITY/CHAIN_KMH+CHAIN_CHANGE_HOURS;
      }
    }
    return {date,lists,member,chain};
  });
  // Spend the request cap in this order, stopping when it runs out:
  // 1. one direct query per selected source on the chosen date;
  // 2. one linked chain of the depth's full length on every date, chosen date first;
  // 3. one direct query on every other date;
  // 4. the rest round-robin across dates, rotating purposes and sources within each date.
  const queries=[],chosen=new Set(),cap=limits.maxRequests;
  const take=q=>{if(q&&!chosen.has(q)&&queries.length<cap){chosen.add(q);queries.push(q);}};
  const directs=d=>interleave(groupBy(d.lists.direct,q=>q.provider));
  for(const group of groupBy(byDate[0].lists.direct,q=>q.provider))take(group[0]);
  for(const d of byDate)d.chain.forEach(take);
  for(const d of byDate.slice(1))take(directs(d)[0]);
  const rest=byDate.map(d=>interleave([directs(d),...['feeder','onward'].map(p=>interleave(groupBy(d.lists[p],q=>q.provider))),d.lists.interhub]));
  const next=rest.map(()=>0);
  for(let progress=true;progress&&queries.length<cap;){progress=false;rest.forEach((list,i)=>{while(next[i]<list.length&&chosen.has(list[next[i]]))next[i]++;if(next[i]<list.length&&queries.length<cap){take(list[next[i]++]);progress=true;}});}
  // A query can serve several dates (a later onward leg, for example), so it counts toward each one.
  const dateCoverage=dates.map(date=>{const {member}=byDate.find(d=>d.date===date);return {date,planned:[...member].filter(q=>chosen.has(q)).length,proposed:member.size};});
  return {runId,createdAt:new Date(now).toISOString(),query,origin,destination,dates,hubs:hubs.map(h=>h.name),queries,limits:{...limits},proposedQueryCount:seen.size,omittedQueryCount:Math.max(0,seen.size-queries.length),omittedDates,dateCoverage};
}
