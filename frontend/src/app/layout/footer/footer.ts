import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';

import { ApiHealthService } from '../../core/api-health.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

type Health = 'checking' | 'ok' | 'down';

/**
 * Small footer with a connectivity dot (replaces the old home-page card):
 * green = API + database reachable, red = something's down. Handy to glance
 * at while demoing.
 */
@Component({
  selector: 'app-footer',
  imports: [TranslatePipe],
  template: `
    <footer class="footer">
      <span>{{ 'app.name' | t }}</span>
      <span class="status" [class]="health()" [attr.title]="'footer.' + health() | t">
        <span class="dot" aria-hidden="true"></span>{{ 'footer.' + health() | t }}
      </span>
    </footer>
  `,
  styles: `
    .footer {
      display: flex; justify-content: space-between; align-items: center; gap: 12px;
      padding: 12px 16px; font-size: 12px;
      /* Home indicator on iPhones when installed as an app (viewport-fit=cover). */
      padding-bottom: max(12px, env(safe-area-inset-bottom));
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

  // Texts: footer.checking / footer.ok / footer.down (TICKET-038).
}
