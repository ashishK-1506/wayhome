import { chatGPTSignInPath } from '@/app/chatgpt-auth';
export const PRIVATE_HEADERS = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
// Sites signs visitors in with ChatGPT and adds `oai-authenticated-user-id`. Vercel has no such
// sign-in, so a Vercel deployment is a public demo and skips the identity check.
export const publicHosting=()=>process.env.VERCEL==='1';
// The local dev server on this machine: it has no hosted sign-in, and nobody else can reach it.
export const isLocalDev=(request:Request)=>process.env.NODE_ENV==='development'&&['localhost','127.0.0.1','0.0.0.0'].includes(new URL(request.url).hostname);
export function guard(request: Request, mutation=false): Response | null {
  const url=new URL(request.url);
  const local=isLocalDev(request);
  if(!local&&!publicHosting()&&!request.headers.get('oai-authenticated-user-id'))return Response.json({status:'reauthentication_required',message:'Sign in to open your private travel planner.',chatGPTSignInPath:chatGPTSignInPath('/')},{status:401,headers:PRIVATE_HEADERS});
  if(mutation&&request.headers.get('origin')!==url.origin)return Response.json({status:'invalid_request',message:'Open this search from the portal.'},{status:403,headers:PRIVATE_HEADERS});
  return null;
}
