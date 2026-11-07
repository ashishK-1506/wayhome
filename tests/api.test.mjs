import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Exercise the actual route exports in-process. Only Next's server-only auth module and the
// hosting platform's connector binding are stubbed; no server response or guard logic is mocked.
async function loadTs(path,replacements={}){
  let source=await readFile(new URL('../'+path,import.meta.url),'utf8');
  for(const [before,after] of Object.entries(replacements))source=source.replaceAll(before,after);
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  return 'data:text/javascript;base64,'+Buffer.from(compiled).toString('base64');
}
const dataModule=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const authModule=dataModule("export const chatGPTSignInPath=()=>'/signin-with-chatgpt?return_to=%2F';");
// What the platform's getContext() returns for this site.
const connectorsWith=context=>dataModule(`export const connectorsForRequest=()=>({getContext:async()=>(${JSON.stringify(context)})});`);
const guard=await loadTs('lib/api-guard.ts',{'@/app/chatgpt-auth':authModule});
const providers=await loadTs('lib/provider-status.ts');
const rewrites={'@/lib/api-guard':guard,'@/lib/provider-status':providers,'@/lib/connectors':connectorsWith({status:'binding_unavailable'}),'@/lib/planner.mjs':new URL('../lib/planner.mjs',import.meta.url).href,'@/lib/engine.mjs':new URL('../lib/engine.mjs',import.meta.url).href};
const {POST}=await import(await loadTs('app/api/search/route.ts',rewrites));
const {GET}=await import(await loadTs('app/api/capabilities/route.ts',rewrites));
const base='https://wayhome.test';
const date=new Date(Date.now()+86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
const query={originId:'gurugram',destinationId:'jamalpur',date,passengers:1,modes:['train','flight','bus','carpool'],depth:'extended',flexibility:0,budget:null,maxHours:72,availabilityOnly:true};
const request=(body,extra={})=>new Request(base+'/api/search',{method:'POST',headers:{'oai-authenticated-user-id':'test-visitor',Origin:base,'Content-Type':'application/json',...extra},body:typeof body==='string'?body:JSON.stringify(body)});
process.env.NODE_ENV='production';
delete process.env.VERCEL; // these tests describe Sites; the Vercel test sets VERCEL itself

test('production API rejects absent identity before reading request input',async()=>{for(const r of [await GET(new Request(base+'/api/capabilities')),await POST(new Request(base+'/api/search',{method:'POST',headers:{Origin:base},body:'{}'}))]){assert.equal(r.status,401);const data=await r.json();assert.equal(data.status,'reauthentication_required');assert.match(data.chatGPTSignInPath,/^\/signin-with-chatgpt/);}});
test('search rejects wrong or missing Origin',async()=>{for(const origin of ['https://other.test',''])assert.equal((await POST(request(query,{Origin:origin}))).status,403);});
test('search rejects malformed JSON, invalid party and oversized stream',async()=>{assert.equal((await POST(request('{'))).status,400);assert.equal((await POST(request({...query,passengers:0}))).status,400);assert.equal((await POST(request('x'.repeat(16001)))).status,413);});
test('valid search is explicitly blocked with zero inventory work',async()=>{const response=await POST(request(query));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private.*no-store/);const data=await response.json();assert.equal(data.status,'blocked');assert.equal(data.sourceQueries.planned,120);assert.equal(data.sourceQueries.attempted,0);assert.equal(data.sourceQueries.notAttempted,120);assert.equal(data.coverage,'not_started');assert.equal(data.result.journeys.length,0);assert.equal(data.result.counters.itinerariesEvaluated,0);assert(data.plan.queries.every(q=>q.status==='not_attempted'));});
test('capability recheck returns configuration only and remains private',async()=>{const response=await GET(new Request(base+'/api/capabilities',{headers:{'oai-authenticated-user-id':'test-visitor'}}));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private.*no-store/);const data=await response.json();assert.equal(data.providers.length,3);assert(data.providers.every(p=>p.status==='setup_required'));});
test('capability recheck reports what the platform says about connected apps',async()=>{
  const visitor=new Request(base+'/api/capabilities',{headers:{'oai-authenticated-user-id':'test-visitor'}});
  assert.deepEqual((await (await GET(visitor)).json()).site,{status:'binding_unavailable'});
  const {GET:withApps}=await import(await loadTs('app/api/capabilities/route.ts',{...rewrites,'@/lib/connectors':connectorsWith({status:'success',connectors:[{connectorId:'trains-app',policy:'enabled',tools:[{actionName:'search_trains',inputSchema:{type:'object'}}]},{connectorId:'rides-app',policy:'disabled',tools:null}]})}));
  assert.deepEqual((await (await withApps(visitor)).json()).site,{status:'success',connectors:[{connectorId:'trains-app',policy:'enabled',actions:['search_trains']},{connectorId:'rides-app',policy:'disabled',actions:null}]});
});
test('internal errors return a generic 500 without leaking details',async()=>{
  const broken=dataModule("export class ValidationError extends Error{};export function buildSearchPlan(){throw new TypeError('secret internal detail');}");
  const {POST:brokenPost}=await import(await loadTs('app/api/search/route.ts',{...rewrites,'@/lib/planner.mjs':broken}));
  const logged=console.error;console.error=()=>{};
  try{const response=await brokenPost(request(query));assert.equal(response.status,500);const data=await response.json();assert.equal(data.status,'error');assert(!JSON.stringify(data).includes('secret'));}
  finally{console.error=logged;}
});
test('on Vercel, which has no ChatGPT sign-in, the API is public but searches still need the same origin',async()=>{
  process.env.VERCEL='1';
  try{
    const anonymous=(origin=base)=>new Request(base+'/api/search',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(query)});
    const search=await POST(anonymous());assert.equal(search.status,200);assert.equal((await search.json()).status,'blocked');
    assert.equal((await GET(new Request(base+'/api/capabilities'))).status,200);
    assert.equal((await POST(anonymous('https://other.test'))).status,403);
  }finally{delete process.env.VERCEL;}
});
