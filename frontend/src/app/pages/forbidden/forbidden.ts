import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService, safeReturnUrl } from '../../core/auth/auth.service';

/** 403 - shown when a logged-in non-admin opens an /admin URL (adminGuard). */
@Component({
  selector: 'app-forbidden',
  imports: [MatButtonModule, MatIconModule, RouterLink],
  template: `
    <section class="forbidden">
      <mat-icon class="big">lock</mat-icon>
      <h1>Admins only</h1>
      @if (auth.currentUser(); as user) {
        <p>You're logged in as <strong>{{ user.email }}</strong> ({{ user.role }}), which can't open this page.</p>
      }
      <div class="actions">
        <a mat-flat-button routerLink="/listings">Back to stays</a>
        <button mat-stroked-button type="button" (click)="switchAccount()">Log in as someone else</button>
      </div>
    </section>
  `,
  styles: `
    .forbidden { max-width: 520px; margin: 64px auto; padding: 0 16px; text-align: center; }
    .big { font-size: 56px; width: 56px; height: 56px; color: var(--mat-sys-on-surface-variant); }
    h1 { margin: 8px 0; font-weight: 500; }
    p { color: var(--mat-sys-on-surface-variant); }
    .actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 24px; }
  `,
})
export class ForbiddenPage {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Log out, then log in again and come back to the admin page they wanted. */
  switchAccount(): void {
    const from = safeReturnUrl(this.route.snapshot.queryParamMap.get('from'));
    this.auth.logout();
    void this.router.navigate(['/login'], { queryParams: from === '/' ? {} : { returnUrl: from } });
  }
}
