import { guard, PRIVATE_HEADERS } from '@/lib/api-guard';
import { buildSearchPlan, ValidationError } from '@/lib/planner.mjs';
import { evaluateJourneys } from '@/lib/engine.mjs';
import { liveAccess, runLiveTrains } from '@/lib/live/trains.mjs';
import { providerStatus } from '@/lib/provider-status';
import type { LiveInfo, LiveProblem, SearchQuery, SearchRun } from '@/lib/model';
export const dynamic='force-dynamic';
// A live train check makes up to 25 calls (at most 8 of them seat checks), four at a time; give it time to finish on Vercel.
export const maxDuration=30;
const MAX_BODY_BYTES=16000,MAX_DISCARD_BYTES=1_000_000;
const PLAN_ONLY:Record<Exclude<LiveInfo['state'],'ran'>,string>={
  not_configured:'Your search plan is prepared. Live travel-app searches are not connected yet, so no services, prices or seats were checked.',
  passcode_required:'Your search plan is prepared. Live train checks need your passcode: add it under Search preferences and search again.',
  passcode_rejected:'Your search plan is prepared. The live-search passcode was not accepted, so no live checks ran.',
  not_applicable:'Your search plan is prepared. Live checks cover trains only so far, so include Trains to check live seats.',
};
const LIVE_FAILED:Record<LiveProblem,string>={
  auth:'irctc.dev did not accept the API key, so no live trains could be checked.',
  quota:'irctc.dev’s usage allowance is used up, so no live trains could be checked.',
  rate_limited:'irctc.dev’s per-minute limit was reached, so no live trains could be checked. Wait a minute and search again.',
  timeout:'irctc.dev did not answer in time, so no live trains could be checked.',
  unreachable:'irctc.dev could not be reached, so no live trains could be checked.',
  upstream:'irctc.dev returned an error, so no live trains could be checked.',
  bad_response:'irctc.dev sent an answer that could not be read, so no live trains could be checked.',
};
const tooLarge=()=>Response.json({status:'invalid_request',message:'This search request is too large.'},{status:413,headers:PRIVATE_HEADERS});
export async function POST(request: Request) {
  const denied=guard(request,true);if(denied)return denied;
  // An oversized body is read to the end and thrown away (up to 1 MB) before the 413 is sent:
  // the local Workers runtime fails the next request if a response goes out while part of the
  // request body is still unread, and hangs the upload if none of it is read. Past 1 MB the
  // read is cancelled.
  const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let bytes=0;
  if(reader){while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>MAX_BODY_BYTES){while(bytes<=MAX_DISCARD_BYTES){const rest=await reader.read();if(rest.done)break;bytes+=rest.value.byteLength;}if(bytes>MAX_DISCARD_BYTES)await reader.cancel();return tooLarge();}chunks.push(chunk.value);}}
  const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
  const text=new TextDecoder().decode(body);
  let input: SearchQuery;try{input=JSON.parse(text);}catch{return Response.json({status:'invalid_request',message:'The search details could not be read.'},{status:400,headers:PRIVATE_HEADERS});}
  try{
    const plan=buildSearchPlan(input),providers=providerStatus();
    // Live trains run only with the owner's irctc.dev key, and, when a passcode is set, only for
    // requests that send it, so visitors to a public deployment cannot spend the quota.
    const key=process.env.IRCTC_DEV_API_KEY?.trim()||undefined;
    const access=liveAccess({key,passcode:process.env.WAYHOME_LIVE_PASSCODE?.trim()||undefined},request.headers.get('x-wayhome-passcode'));
    if(access==='allowed'&&key&&plan.query.modes.includes('train')){
      const live=await runLiveTrains(plan,{key,baseUrl:process.env.IRCTC_DEV_BASE_URL?.trim()||undefined});
      // Failed calls by reason, for the server log only (no key, no user details).
      if(live.calls.failed)console.warn('irctc.dev calls failed',{made:live.calls.made,failed:live.calls.failed,reasons:live.failures});
      const queries=plan.queries.map(q=>{const outcome=live.outcomes.get(q.id);return outcome?{...q,...outcome,source:'irctc.dev'}:q;});
      const attempted=live.outcomes.size,succeeded=[...live.outcomes.values()].filter(o=>o.status==='succeeded').length;
      const result=evaluateJourneys(live.services,plan.query,[],Date.now(),plan.limits.maxCandidates);
      const info:LiveInfo={state:'ran',source:'irctc.dev',calls:live.calls,failures:live.failures,trainsChecked:live.trainsChecked,classes:live.classes,problem:live.problem};
      const run:SearchRun={status:'live',plan:{...plan,queries},providers,result,sourceQueries:{planned:plan.queries.length,attempted,succeeded,failed:attempted-succeeded,notAttempted:plan.queries.length-attempted},completedAt:new Date().toISOString(),coverage:attempted===plan.queries.length&&succeeded===attempted?'complete':'partial',message:live.problem?LIVE_FAILED[live.problem]:`Live trains checked with irctc.dev, an unofficial source: ${attempted} of ${plan.queries.length} planned searches ran. Flights, buses and carpools are not live yet.`,live:info};
      return Response.json(run,{headers:PRIVATE_HEADERS});
    }
    // No live read ran. Empty input is a blocked search, never a successful "no tickets" result.
    const state=access==='allowed'?'not_applicable':access;
    const result=evaluateJourneys([],plan.query,[],Date.now(),plan.limits.maxCandidates);
    // Preparing the plan succeeded, so this is a 200. `status: 'blocked'` and
    // `coverage: 'not_started'` tell clients that no live search ran; `live.state` says why.
    const run:SearchRun={status:'blocked',plan,providers,result,sourceQueries:{planned:plan.queries.length,attempted:0,succeeded:0,failed:0,notAttempted:plan.queries.length},completedAt:new Date().toISOString(),coverage:'not_started',message:PLAN_ONLY[state],live:{state}};
    return Response.json(run,{headers:PRIVATE_HEADERS});
  }catch(error){
    // Only validation messages are written for users; anything else stays in the server log.
    if(error instanceof ValidationError)return Response.json({status:'invalid_request',message:error.message},{status:400,headers:PRIVATE_HEADERS});
    console.error('Search planning failed',error);
    return Response.json({status:'error',message:'Something went wrong while preparing your search. Please try again.'},{status:500,headers:PRIVATE_HEADERS});
  }
}
