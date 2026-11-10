import type { Fare, LiveProblem, Offer, PlannedQuery, SearchPlan, Service } from '../model';
import type { Fetcher } from './irctc-dev.mjs';

export type LiveAccess = 'allowed' | 'not_configured' | 'passcode_required' | 'passcode_rejected';
export interface LiveTrainLimits { searches: number; feeders: number; trainsChecked: number; seatChecks: number; classes: readonly string[]; fallbackClasses: readonly string[]; concurrency: number; callTimeoutMs: number; deadlineMs: number; minChangeMinutes: number; }
export const LIVE_TRAIN_LIMITS: Readonly<LiveTrainLimits>;
export interface QueryOutcome { status: 'succeeded' | 'failed'; error?: LiveProblem; }
export interface LiveTrainRun { services: Service[]; outcomes: Map<string, QueryOutcome>; calls: { made: number; failed: number }; failures: Partial<Record<LiveProblem, number>>; trainsChecked: number; classes: string[]; problem: LiveProblem | null; }

export function liveAccess(config: { key?: string; passcode?: string }, provided: string | null): LiveAccess;
export function selectTrainQueries(plan: SearchPlan, limits?: LiveTrainLimits): PlannedQuery[];
export function runLiveTrains(plan: SearchPlan, options: { key: string; baseUrl?: string; fetcher?: Fetcher; now?: () => number; limits?: LiveTrainLimits }): Promise<LiveTrainRun>;
export const SEAT_CLASSES: readonly string[];
export interface SeatCheck { classCode?: string; offer?: Offer | null; fares?: Fare[]; problem?: LiveProblem; }
export function checkTrainSeats(options: { key: string; baseUrl?: string; fetcher?: Fetcher; now?: () => number; limits?: LiveTrainLimits }, request: { trainNo: string; from: string; to: string; date: string; classCode?: string; withFares?: boolean }): Promise<SeatCheck>;
