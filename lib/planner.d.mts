import type { SearchQuery, SearchPlan } from './model';
export class ValidationError extends Error {}
export const LIMITS: Record<string,SearchPlan['limits']>;
export function istDate(time: number): string;
export function addDays(date: string, days: number): string;
export function validateSearch(input: unknown, now?: number): SearchQuery;
export function buildSearchPlan(input: SearchQuery, now?: number, runId?: string): SearchPlan;
