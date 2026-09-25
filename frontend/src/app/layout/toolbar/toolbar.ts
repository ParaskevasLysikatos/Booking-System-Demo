import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';

/**
 * Minimal top bar (TICKET-017): brand + Login/Register, or the user's
 * email + Logout. TICKET-022 turns this into the role-aware navbar
 * (adds the Admin link for admins).
 */
@Component({
  selector: 'app-toolbar',
  imports: [RouterLink, MatButtonModule, MatIconModule, MatToolbarModule],
  templateUrl: './toolbar.html',
  styleUrl: './toolbar.scss',
})
export class ToolbarComponent {
  protected readonly auth = inject(AuthService);
}
