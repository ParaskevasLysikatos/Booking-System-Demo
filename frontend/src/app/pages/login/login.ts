import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { parseApiErrors } from '../../core/api-errors';
import { DemoLogin } from '../../core/auth/auth.models';
import { AuthService, safeReturnUrl } from '../../core/auth/auth.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TranslationService } from '../../core/i18n/translation.service';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    TranslatePipe,
  ],
  templateUrl: './login.html',
  styleUrl: '../auth-page.scss',
})
export class LoginPage {
  private readonly i18n = inject(TranslationService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  readonly submitting = signal(false);
  readonly hidePassword = signal(true);
  readonly error = signal<string | null>(null);
  readonly sessionExpired = this.route.snapshot.queryParamMap.get('reason') === 'expired';
  /** Sent here by a heart tap while logged out (TICKET-033). */
  readonly savingFavorite = this.route.snapshot.queryParamMap.get('reason') === 'favorite';

  /**
   * The "Demo logins" box (TICKET-041): whatever the API lists - nothing on
   * a deployment without demo data, or while the request is still out.
   */
  readonly demoLogins = toSignal(this.auth.demoLogins(), { initialValue: [] as DemoLogin[] });

  /** Fill the form with a demo login; the visitor still presses Log in. */
  useDemoLogin(login: DemoLogin): void {
    this.form.setValue({ email: login.email, password: login.password });
    this.error.set(null);
  }

  submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    const { email, password } = this.form.getRawValue();
    this.auth.login({ email: email.trim(), password }).subscribe({
      next: () => {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        void this.router.navigateByUrl(safeReturnUrl(returnUrl));
      },
      error: (err) => {
        this.submitting.set(false);
        const parsed = parseApiErrors(err);
        this.error.set(
          parsed.general ?? Object.values(parsed.fields).flat().join(' ') ?? this.i18n.t('auth.login.failed'),
        );
      },
    });
  }
}
