import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';

export const ADMIN_NAV = [
  { path: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { path: 'properties', label: 'Properties', icon: 'holiday_village' },
  { path: 'bookings', label: 'Bookings', icon: 'event_note' },
];

/**
 * Shell for everything under /admin (TICKET-022): a left side nav with the
 * page on the right; on phones the nav becomes a scrollable bar on top.
 * The whole group is protected once by adminGuard in app.routes.ts.
 */
@Component({
  selector: 'app-admin-layout',
  imports: [MatIconModule, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <div class="admin">
      <nav class="side" aria-label="Admin">
        <p class="heading">Admin</p>
        @for (item of nav; track item.path) {
          <a [routerLink]="item.path" routerLinkActive="active" ariaCurrentWhenActive="page">
            <mat-icon>{{ item.icon }}</mat-icon><span>{{ item.label }}</span>
          </a>
        }
        <a routerLink="/listings" class="back"><mat-icon>arrow_back</mat-icon><span>Back to site</span></a>
        @if (auth.currentUser(); as user) {
          <p class="who">{{ user.email }}</p>
        }
      </nav>
      <section class="content">
        <router-outlet />
      </section>
    </div>
  `,
  styles: `
    .admin { display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: calc(100vh - 64px - 45px); }
    .side {
      display: flex; flex-direction: column; gap: 2px; padding: 16px 8px;
      border-right: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-low);
    }
    .heading { margin: 0 12px 8px; font-size: 12px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--mat-sys-on-surface-variant); }
    a {
      display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 999px;
      color: inherit; text-decoration: none; font-size: 14px; white-space: nowrap;
    }
    a:hover { background: var(--mat-sys-surface-container-high); }
    a.active { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); font-weight: 500; }
    .back { margin-top: 16px; color: var(--mat-sys-on-surface-variant); }
    .who { margin: auto 12px 0; font-size: 12px; color: var(--mat-sys-on-surface-variant); overflow: hidden; text-overflow: ellipsis; }
    .content { padding: 24px; min-width: 0; }
    @media (max-width: 720px) {
      .admin { grid-template-columns: 1fr; }
      .side { flex-direction: row; overflow-x: auto; padding: 8px; border-right: 0; border-bottom: 1px solid var(--mat-sys-outline-variant); }
      .heading, .who { display: none; }
      .back { margin: 0 0 0 auto; }
      .content { padding: 16px; }
    }
  `,
})
export class AdminLayout {
  protected readonly auth = inject(AuthService);
  protected readonly nav = ADMIN_NAV;
}
