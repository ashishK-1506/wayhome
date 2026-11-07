import { chatGPTSignInPath } from '@/app/chatgpt-auth';
export const PRIVATE_HEADERS = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export function guard(request: Request, mutation=false): Response | null {
  const url=new URL(request.url);
  const local=process.env.NODE_ENV==='development'&&['localhost','127.0.0.1','0.0.0.0'].includes(url.hostname);
  if(!local&&!request.headers.get('oai-authenticated-user-id'))return Response.json({status:'reauthentication_required',message:'Sign in to open your private travel planner.',chatGPTSignInPath:chatGPTSignInPath('/')},{status:401,headers:PRIVATE_HEADERS});
  if(mutation&&request.headers.get('origin')!==url.origin)return Response.json({status:'invalid_request',message:'Open this search from the portal.'},{status:403,headers:PRIVATE_HEADERS});
  return null;
}
