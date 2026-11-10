import { guard, isLocalDev, PRIVATE_HEADERS } from '@/lib/api-guard';
import { PLACES } from '@/lib/catalog.mjs';
import { addDays, istDate } from '@/lib/planner.mjs';
import { checkTrainSeats, liveAccess, SEAT_CLASSES } from '@/lib/live/trains.mjs';
import type { LiveProblem } from '@/lib/model';
export const dynamic='force-dynamic';
// One check makes at most two calls to irctc.dev.
export const maxDuration=20;
const STATIONS=new Set<string>(PLACES.flatMap(place=>place.rail));
const BLOCKED:Record<string,string>={
  not_configured:'Live seat checks are not set up on this site.',
  passcode_required:'Add your live-search passcode under Search preferences to check seats.',
  passcode_rejected:'The live-search passcode was not accepted.',
};
const FAILED:Record<LiveProblem,string>={
  auth:'irctc.dev did not accept the API key.',
  quota:'irctc.dev’s usage allowance is used up.',
  rate_limited:'irctc.dev allows 10 seat checks a minute. Try again in a minute.',
  timeout:'irctc.dev did not answer in time. Try again.',
  unreachable:'irctc.dev could not be reached. Try again.',
  upstream:'irctc.dev returned an error. Try again.',
  bad_response:'irctc.dev sent an answer that could not be read.',
};
const invalid=(message:string,status=400)=>Response.json({status:'invalid_request',message},{status,headers:PRIVATE_HEADERS});

/** Checks seats for one train and class, when asked from a result card. Same access rules as a search. */
export async function POST(request: Request) {
  const denied=guard(request,true);if(denied)return denied;
  const text=await request.text();
  if(text.length>2000)return invalid('This request is too large.',413);
  let input:unknown;try{input=JSON.parse(text);}catch{return invalid('The seat check could not be read.');}
  const {trainNo,from,to,date,classCode,withFares}=(input&&typeof input==='object'?input:{}) as Record<string,unknown>;
  // Only trains between pilot stations, from today to 60 days ahead: the owner's quota is not a general service.
  if(typeof trainNo!=='string'||!/^\d{5}$/.test(trainNo)||typeof from!=='string'||!STATIONS.has(from)||typeof to!=='string'||!STATIONS.has(to)||from===to)return invalid('Choose a train between two stations in the pilot area.');
  const today=istDate(Date.now());
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<today||date>addDays(today,60))return invalid('Seats can be checked from today to 60 days ahead.');
  if(classCode!==undefined&&classCode!==null&&(typeof classCode!=='string'||!SEAT_CLASSES.includes(classCode)))return invalid('That class cannot be checked.');
  const key=process.env.IRCTC_DEV_API_KEY?.trim()||undefined;
  const passcode=isLocalDev(request)?undefined:process.env.WAYHOME_LIVE_PASSCODE?.trim()||undefined;
  const access=liveAccess({key,passcode},request.headers.get('x-wayhome-passcode'));
  if(access!=='allowed'||!key)return Response.json({status:'blocked',state:access,message:BLOCKED[access]},{headers:PRIVATE_HEADERS});
  const result=await checkTrainSeats({key,baseUrl:process.env.IRCTC_DEV_BASE_URL?.trim()||undefined},{trainNo,from,to,date,classCode:typeof classCode==='string'?classCode:undefined,withFares:withFares!==false});
  if(result.problem){
    console.warn('irctc.dev seat check failed',{problem:result.problem});
    return Response.json({status:'failed',problem:result.problem,message:FAILED[result.problem],classCode:result.classCode??null,fares:result.fares??null},{headers:PRIVATE_HEADERS});
  }
  return Response.json({status:'ok',classCode:result.classCode,offer:result.offer??null,fares:result.fares??null,message:result.offer?null:'irctc.dev had no seat status for that date.'},{headers:PRIVATE_HEADERS});
}
