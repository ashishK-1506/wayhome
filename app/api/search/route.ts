import { guard, PRIVATE_HEADERS } from '@/lib/api-guard';
import { buildSearchPlan, ValidationError } from '@/lib/planner.mjs';
import { evaluateJourneys } from '@/lib/engine.mjs';
import { providerStatus } from '@/lib/provider-status';
import type { SearchQuery } from '@/lib/model';
export const dynamic='force-dynamic';
const MAX_BODY_BYTES=16000,MAX_DISCARD_BYTES=1_000_000;
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
    // No live read is issued without supported, verified hosted integration.
    // Empty input is a blocked search, never a successful "no tickets" result.
    const result=evaluateJourneys([],plan.query,[],Date.now(),plan.limits.maxCandidates);
    // Preparing the plan succeeded, so this is a 200. `status: 'blocked'` and
    // `coverage: 'not_started'` tell clients that no live search ran.
    return Response.json({status:'blocked',plan,providers,result,sourceQueries:{planned:plan.queries.length,attempted:0,succeeded:0,failed:0,notAttempted:plan.queries.length},completedAt:new Date().toISOString(),coverage:'not_started',message:'Your search plan is prepared. Live travel-app searches are not connected yet, so no services, prices or seats were checked.'},{headers:PRIVATE_HEADERS});
  }catch(error){
    // Only validation messages are written for users; anything else stays in the server log.
    if(error instanceof ValidationError)return Response.json({status:'invalid_request',message:error.message},{status:400,headers:PRIVATE_HEADERS});
    console.error('Search planning failed',error);
    return Response.json({status:'error',message:'Something went wrong while preparing your search. Please try again.'},{status:500,headers:PRIVATE_HEADERS});
  }
}
