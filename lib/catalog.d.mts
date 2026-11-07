import type { Place } from './model';
export const PLACES: Place[];
export function findPlace(id: string): Place | undefined;
export function searchPlaces(term: string): Place[];
export const SOURCE_NAMES: Record<string,string>;
