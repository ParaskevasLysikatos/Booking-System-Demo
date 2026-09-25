import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';

/**
 * Role-aware top bar (TICKET-022, started in TICKET-017):
 * - logged out: Log in / Sign up
 * - logged in: "My bookings", "Admin" (admins only - driven by the
 *   AuthService.isAdmin signal, which follows /auth/me/), and an account
 *   button whose menu shows the email + role and "Log out".
 * On phones the links move into the account menu.
 */
@Component({
  selector: 'app-toolbar',
  imports: [RouterLink, RouterLinkActive, MatButtonModule, MatDividerModule, MatIconModule, MatMenuModule, MatToolbarModule],
  templateUrl: './toolbar.html',
  styleUrl: './toolbar.scss',
})
export class ToolbarComponent {
  protected readonly auth = inject(AuthService);
}
