import { guard, PRIVATE_HEADERS } from '@/lib/api-guard';
import { providerStatus } from '@/lib/provider-status';
import { connectorsForRequest } from '@/lib/connectors';
import type { SiteConnections } from '@/lib/model';
export const dynamic='force-dynamic';
export async function GET(request: Request) {
  const denied=guard(request);if(denied)return denied;
  // Ask the hosting platform which connected apps this site can see: site policy and action
  // names only, not sign-in state or provider health. Nothing is invoked and no inventory is read.
  const context=await connectorsForRequest().getContext();
  const site:SiteConnections=context.status==='success'?{status:'success',connectors:context.connectors.map(c=>({connectorId:c.connectorId,policy:c.policy,actions:c.tools?.map(t=>t.actionName)??null}))}:{status:context.status};
  return Response.json({status:'setup_required',checkedAt:new Date().toISOString(),providers:providerStatus(),site,message:'Travel-app connections are not set up yet. This check reads the site configuration only and does not query ticket inventory.'},{headers:PRIVATE_HEADERS});
}
