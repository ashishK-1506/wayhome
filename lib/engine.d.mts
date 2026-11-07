import type { Service, SearchQuery, Transfer, EngineResult, Journey, Offer, Mode } from './model';
export function safeBookingUrl(value: string | undefined): string | null;
export function validateService(service: unknown): boolean;
export function offerFresh(offer: Offer, mode: Mode, now: number): boolean;
export function offerAmount(offer: Offer | null, passengers: number): number | null;
export function offerAvailable(offer: Offer | null, service: Service, passengers: number, now: number): boolean;
export function evaluateJourneys(services: Service[], query: SearchQuery, transfers?: Transfer[], now?: number, maxCandidates?: number): EngineResult;
export function sortJourneys(journeys: Journey[], sort?: string): Journey[];
