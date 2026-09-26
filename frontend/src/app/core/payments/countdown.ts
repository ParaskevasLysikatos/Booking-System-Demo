import { Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { interval, map } from 'rxjs';

/**
 * The current time as a signal, updated every second - one per page, shared
 * by every countdown on it. Call in an injection context (a component field);
 * it stops when the component is destroyed.
 */
export function clockSignal(): Signal<number> {
  return toSignal(interval(1000).pipe(map(() => Date.now())), { initialValue: Date.now() });
}

/** Milliseconds left until `iso`, never negative. */
export function remainingMs(iso: string | null | undefined, now: number): number {
  if (!iso) return 0;
  const end = Date.parse(iso);
  return Number.isFinite(end) ? Math.max(0, end - now) : 0;
}

/** 1453000 -> "24:13"; an hour or more -> "1:02:03". Rounds *down*, so it never shows time that's gone. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "14:32" in local time. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
