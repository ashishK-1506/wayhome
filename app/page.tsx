import TravelPortal from './travel-portal';
import { istDate } from '@/lib/planner.mjs';
export const dynamic='force-dynamic';
export default function Page(){
  // This page renders fresh for every request, so reading the clock here is intended.
  // eslint-disable-next-line react-hooks/purity
  return <TravelPortal today={istDate(Date.now())} />;
}
