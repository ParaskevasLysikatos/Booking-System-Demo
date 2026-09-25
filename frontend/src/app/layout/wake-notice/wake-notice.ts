import { Component, inject } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { ServerWakeService } from '../../core/server-wake';

/**
 * TICKET-027: a slim banner under the toolbar while the (free, sleeping)
 * Render API is waking up. The live region is always in the DOM so screen
 * readers announce the text when it appears.
 */
@Component({
  selector: 'app-wake-notice',
  imports: [MatProgressSpinnerModule],
  template: `
    <div role="status" aria-live="polite">
      @if (wake.slow()) {
        <div class="wake">
          <mat-spinner diameter="18" strokeWidth="2" aria-hidden="true" />
          <span>Waking up the demo server - this can take up to a minute on the free plan.</span>
        </div>
      }
    </div>
  `,
  styles: `
    .wake {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      padding: 8px 16px; font-size: 13px;
      background: #fff8e1; color: #5d4037;
      border-bottom: 1px solid #ffe082;
    }
  `,
})
export class WakeNoticeComponent {
  protected readonly wake = inject(ServerWakeService);
}
