import type { CalendarDay, Fare, Offer, OfferStatus, Service, Terminal } from '../model';

export const IRCTC_DEV: 'irctc.dev';
export const DEFAULT_BASE_URL: string;
export type SourceErrorKind = 'auth' | 'quota' | 'rate_limited' | 'timeout' | 'unreachable' | 'upstream' | 'bad_response';
export class SourceError extends Error { kind: SourceErrorKind; constructor(kind: SourceErrorKind, message: string); }
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export interface SourceConfig { key: string; baseUrl?: string; fetcher?: Fetcher; timeoutMs?: number; }
export interface TrainSummary { trainNo: string; trainName: string; fromName: string; toName: string; departure: string; durationMin: number; runningDays: string[]; boardingDayOffset: number; }
export interface ParsedAvailability { status: OfferStatus; seats?: number; raw: string; }

export function dmy(date: string): string;
export function istIso(ms: number): string;
export function getJson(config: SourceConfig, path: string, params: Record<string, string>): Promise<Record<string, unknown>>;
export function parseTrains(data: unknown, from: string, to: string): TrainSummary[];
export function runsOn(train: TrainSummary, date: string): boolean;
export function syncedTime(data: unknown, now: number): number;
export function parseAvailability(data: unknown, date: string): ParsedAvailability | null;
export function parseCalendar(data: unknown, date: string, days?: number): CalendarDay[];
export function parseFares(data: unknown): Map<string, number>;
export function fareList(fares: Map<string, number>): Fare[];
export function trainSearchUrl(from: string, to: string, date: string): string;
export function trainService(train: TrainSummary, input: { date: string; from: Terminal; to: Terminal; offers?: Offer[] }): Service;
export function trainOffer(input: { trainNo: string; fromCode: string; toCode: string; date: string; classCode: string; availability: ParsedAvailability; fare?: number; checkedAt: string; calendar?: CalendarDay[] }): Offer;
