import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { parseApiErrors } from '../../core/api-errors';
import { RegisterRequest } from '../../core/auth/auth.models';
import { AuthService, safeReturnUrl } from '../../core/auth/auth.service';

/** confirmPassword must equal its sibling `password`. */
export const matchesPassword: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const password = control.parent?.get('password')?.value;
  return control.value && password !== control.value ? { mismatch: true } : null;
};

/** API field name -> form control name. */
const FIELD_MAP: Record<string, string> = {
  email: 'email',
  password: 'password',
  first_name: 'firstName',
  last_name: 'lastName',
  phone: 'phone',
};

@Component({
  selector: 'app-register',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './register.html',
  styleUrl: '../auth-page.scss',
})
export class RegisterPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(150)]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', [Validators.required, matchesPassword]],
    firstName: ['', Validators.maxLength(150)],
    lastName: ['', Validators.maxLength(150)],
    phone: ['', Validators.maxLength(30)],
  });

  readonly submitting = signal(false);
  readonly hidePassword = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    // Re-check "passwords match" when the first password changes too.
    this.form.controls.password.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.form.controls.confirmPassword.updateValueAndValidity({ emitEvent: false }));
  }

  submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.error.set(null);

    const v = this.form.getRawValue();
    const body: RegisterRequest = { email: v.email.trim(), password: v.password };
    if (v.firstName.trim()) body.first_name = v.firstName.trim();
    if (v.lastName.trim()) body.last_name = v.lastName.trim();
    if (v.phone.trim()) body.phone = v.phone.trim();

    this.auth.register(body).subscribe({
      next: () => {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        void this.router.navigateByUrl(safeReturnUrl(returnUrl));
      },
      error: (err) => {
        this.submitting.set(false);
        const parsed = parseApiErrors(err);
        const unmatched: string[] = [];
        // Show each server message under its own field ("This password is too common.").
        for (const [apiField, messages] of Object.entries(parsed.fields)) {
          const control = this.form.get(FIELD_MAP[apiField] ?? '');
          if (control) {
            control.setErrors({ server: messages.join(' ') });
            control.markAsTouched();
          } else {
            unmatched.push(...messages);
          }
        }
        const general = [parsed.general, ...unmatched].filter(Boolean).join(' ');
        this.error.set(general || null);
      },
    });
  }
}
