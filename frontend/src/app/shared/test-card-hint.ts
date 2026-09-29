import { Clipboard } from '@angular/cdk/clipboard';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { TranslatePipe } from '../core/i18n/translate.pipe';
import { PaymentService } from '../core/payments/payment.service';

/** Stripe's always-successful test card. */
export const TEST_CARD_NUMBER = '4242424242424242';

/**
 * "Demo payment - use card 4242 4242 4242 4242, any future expiry date, any
 * CVC." with a copy button (TICKET-044).
 *
 * Renders only when `GET /api/payments/config/` says `test_mode` - the server
 * works that out from its Stripe key's prefix, so with a live key (or with
 * payments off) this shows nothing and can never reach a real guest. The page
 * decides *where* it goes; this component decides *whether* it shows.
 */
@Component({
  selector: 'app-test-card-hint',
  imports: [MatButtonModule, MatIconModule, TranslatePipe],
  template: `
    @if (testMode()) {
      <div class="test-hint">
        <mat-icon aria-hidden="true">science</mat-icon>
        <span class="text" [innerHTML]="'testCard.hint' | t"></span>
        <button
          mat-icon-button
          type="button"
          class="copy"
          [attr.aria-label]="'testCard.copy' | t"
          [title]="'testCard.copy' | t"
          (click)="copy()"
        >
          <mat-icon aria-hidden="true">{{ copied() ? 'check' : 'content_copy' }}</mat-icon>
        </button>
        <span class="visually-hidden" aria-live="polite">{{ copied() ? ('testCard.copied' | t) : '' }}</span>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .test-hint {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 16px 0 0;
      padding: 4px 4px 4px 12px;
      border-radius: 8px;
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
      font-size: 13px;
      line-height: 1.4;
    }

    .test-hint > mat-icon {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      font-size: 18px;
    }

    .text {
      flex: 1;
      padding: 8px 0;
    }

    .copy {
      flex-shrink: 0;
      color: inherit;
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `,
})
export class TestCardHintComponent {
  private readonly clipboard = inject(Clipboard);
  private readonly config = toSignal(inject(PaymentService).config(), { initialValue: null });

  readonly testMode = computed(() => this.config()?.test_mode === true);
  readonly copied = signal(false);

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  copy(): void {
    if (!this.clipboard.copy(TEST_CARD_NUMBER)) return;
    this.copied.set(true);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.copied.set(false), 2000);
  }
}
