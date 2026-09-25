import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';

export interface AdminPlaceholderData {
  heading: string;
  icon: string;
  ticket: string;
  description: string;
}

/**
 * Temporary admin page (TICKET-022) - each admin route gets one until its
 * own ticket replaces it: Dashboard (023), Properties (024), Bookings (025).
 */
@Component({
  selector: 'app-admin-placeholder',
  imports: [MatIconModule],
  template: `
    @let d = data();
    <h1><mat-icon>{{ d.icon }}</mat-icon>{{ d.heading }}</h1>
    <div class="soon">
      <p>{{ d.description }}</p>
      <p class="muted">Coming in {{ d.ticket }}.</p>
    </div>
  `,
  styles: `
    h1 { display: flex; align-items: center; gap: 10px; margin: 0 0 16px; font-size: 26px; font-weight: 500; }
    .soon { padding: 24px; border: 1px dashed var(--mat-sys-outline-variant); border-radius: 16px; }
    .soon p { margin: 0; }
    .muted { margin-top: 8px !important; color: var(--mat-sys-on-surface-variant); font-size: 14px; }
  `,
})
export class AdminPlaceholderPage {
  readonly data = toSignal(inject(ActivatedRoute).data.pipe(map((d) => d as AdminPlaceholderData)), {
    requireSync: true,
  });
}
