import type { Capability } from './model';

// Intentionally no guessed connector IDs or unverified native action mappings.
// Enable a provider only after Sites eligibility discovery and hosted read checks.
export const ELIGIBILITY_VERIFIED = false;
export function providerStatus(): Capability[] {
  return [
    {id:'confirmtkt',name:'ConfirmTkt',modes:['train'],status:'setup_required',message:'Hosted train-app access has not been verified.'},
    {id:'skyscanner',name:'Skyscanner',modes:['flight'],status:'setup_required',message:'Hosted flight-app access and supported search scope are pending.'},
    {id:'blablacar',name:'BlaBlaCar',modes:['bus','carpool'],status:'setup_required',message:'Hosted ride and bus access has not been verified.'},
  ];
}
