import {
  HttpErrorResponse,
  HttpEventType,
  HttpInterceptorFn,
} from '@angular/common/http';
import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { finalize, tap } from 'rxjs';

import { environment } from '../../environments/environment';

/** After how many ms without an answer the notice appears; null turns it off (dev). */
export const WAKE_NOTICE_AFTER_MS = new InjectionToken<number | null>('WAKE_NOTICE_AFTER_MS', {
  providedIn: 'root',
  factory: () => environment.wakeNoticeAfterMs,
});

/**
 * TICKET-027: the free Render API sleeps after 15 idle minutes and the first
 * request then takes ~50 s. This tracks our API requests and raises `slow`
 * when one has been waiting longer than WAKE_NOTICE_AFTER_MS, so the app can
 * say "Waking up the demo server" instead of looking frozen.
 *
 * `slow` goes back to false as soon as the server answers anything (success
 * or an HTTP error - either proves it's awake), or when nothing is waiting
 * any more.
 */
@Injectable({ providedIn: 'root' })
export class ServerWakeService {
  private readonly delayMs = inject(WAKE_NOTICE_AFTER_MS);
  private pending = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly isSlow = signal(false);

  readonly slow = this.isSlow.asReadonly();

  requestStarted(): void {
    if (this.delayMs === null) return;
    this.pending++;
    if (this.timer === null && !this.isSlow()) {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.pending > 0) this.isSlow.set(true);
      }, this.delayMs);
    }
  }

  /** Any response from the server means it's awake. */
  serverAnswered(): void {
    this.clearTimer();
    this.isSlow.set(false);
  }

  /** Answered, failed or cancelled - no longer waiting on this one. */
  requestEnded(): void {
    if (this.delayMs === null) return;
    this.pending = Math.max(0, this.pending - 1);
    if (this.pending === 0) {
      this.clearTimer();
      this.isSlow.set(false);
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/** Feeds ServerWakeService from every request to our own API (nothing else). */
export const serverWakeInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(`${environment.apiUrl}/`)) return next(req);
  const wake = inject(ServerWakeService);
  wake.requestStarted();
  return next(req).pipe(
    tap({
      next: (event) => {
        if (event.type === HttpEventType.Response) wake.serverAnswered();
      },
      error: (err: unknown) => {
        // status 0 = no answer at all (network/CORS), so not proof it's awake
        if (err instanceof HttpErrorResponse && err.status !== 0) wake.serverAnswered();
      },
    }),
    finalize(() => wake.requestEnded()),
  );
};
