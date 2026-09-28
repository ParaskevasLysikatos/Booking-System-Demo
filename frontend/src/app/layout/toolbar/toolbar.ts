import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { InstallIosDialog } from '../../core/pwa/install-ios-dialog';
import { InstallService } from '../../core/pwa/install.service';

/**
 * Role-aware top bar (TICKET-022, started in TICKET-017):
 * - logged out: Log in / Sign up
 * - logged in: "My bookings", "Admin" (admins only - driven by the
 *   AuthService.isAdmin signal, which follows /auth/me/), and an account
 *   button whose menu shows the email + role and "Log out".
 * On phones the links move into the account menu.
 * "Install app" (TICKET-031): in the account menu, or an icon next to
 * Log in when logged out - only when the browser can install the app.
 */
@Component({
  selector: 'app-toolbar',
  imports: [RouterLink, RouterLinkActive, MatButtonModule, MatDividerModule, MatIconModule, MatMenuModule, MatToolbarModule, MatTooltipModule],
  templateUrl: './toolbar.html',
  styleUrl: './toolbar.scss',
})
export class ToolbarComponent {
  protected readonly auth = inject(AuthService);
  protected readonly install = inject(InstallService);
  private readonly dialog = inject(MatDialog);

  async installApp(): Promise<void> {
    if ((await this.install.install()) === 'ios-instructions') {
      this.dialog.open(InstallIosDialog, { maxWidth: 'min(420px, calc(100vw - 32px))' });
    }
  }
}
