import { Component, inject } from '@angular/core';

import { ApiStatusComponent } from '../../api-status/api-status';
import { AuthService } from '../../core/auth/auth.service';

/** Temporary landing page - TICKET-018 makes /listings the real home. */
@Component({
  selector: 'app-home',
  imports: [ApiStatusComponent],
  template: `
    <section class="home">
      <h1>Booking System Demo</h1>
      @if (auth.currentUser(); as user) {
        <p class="welcome">Logged in as <strong>{{ user.email }}</strong> ({{ user.role }}).</p>
      }
      <app-api-status />
    </section>
  `,
  styles: `
    .home { max-width: 960px; margin: 0 auto; padding: 24px 16px; text-align: center; }
    .welcome { color: var(--mat-sys-on-surface-variant); }
  `,
})
export class HomePage {
  protected readonly auth = inject(AuthService);
}
