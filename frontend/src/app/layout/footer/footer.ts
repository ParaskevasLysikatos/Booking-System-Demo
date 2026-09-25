import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';

import { ApiHealthService } from '../../core/api-health.service';

type Health = 'checking' | 'ok' | 'down';

/**
 * Small footer with a connectivity dot (replaces the old home-page card):
 * green = API + database reachable, red = something's down. Handy to glance
 * at while demoing.
 */
@Component({
  selector: 'app-footer',
  template: `
    <footer class="footer">
      <span>Booking System Demo</span>
      <span class="status" [class]="health()" [attr.title]="label()">
        <span class="dot" aria-hidden="true"></span>{{ label() }}
      </span>
    </footer>
  `,
  styles: `
    .footer {
      display: flex; justify-content: space-between; align-items: center; gap: 12px;
      padding: 12px 16px; font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      border-top: 1px solid var(--mat-sys-outline-variant);
    }
    .status { display: inline-flex; align-items: center; gap: 6px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #9e9e9e; }
    .ok .dot { background: #2e7d32; }
    .down .dot { background: #c62828; }
  `,
})
export class FooterComponent {
  private readonly api = inject(ApiHealthService);

  readonly health = toSignal(
    this.api.check().pipe(
      map((res): Health => (res.database === 'connected' ? 'ok' : 'down')),
      catchError(() => of<Health>('down')),
      startWith<Health>('checking'),
    ),
    { initialValue: 'checking' as Health },
  );

  label(): string {
    return { checking: 'Checking API…', ok: 'API & database connected', down: 'API unreachable' }[this.health()];
  }
}
