import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { toSignal } from '@angular/core/rxjs-interop';

import { parseApiErrors } from '../core/api-errors';
import { MAX_REVIEW_COMMENT, RATING_WORDS, Review } from '../core/reviews/review.models';
import { ReviewService } from '../core/reviews/review.service';

export interface ReviewDialogData {
  propertyId: number;
  propertyTitle: string;
}

/**
 * "Review your stay" (TICKET-032, step 3) - opened from the property page
 * and from a past stay in My bookings. A 1-5 star picker (real radio
 * buttons, so arrow keys and screen readers work as usual), an optional
 * comment, and a clear note that reviews are final.
 *
 * It posts the review itself, so a refusal (e.g. "already reviewed") is
 * shown right here; it closes with the created `Review`, or `undefined`
 * when the guest backs out.
 */
@Component({
  selector: 'app-review-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>Review your stay</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content>
        <p class="intro">How was your stay at <strong>{{ data.propertyTitle }}</strong>?</p>

        @if (error(); as message) {
          <p class="error" role="alert"><mat-icon>error</mat-icon>{{ message }}</p>
        }

        <fieldset class="stars" (mouseleave)="hover.set(0)">
          <legend>Your rating</legend>
          <div class="row">
            @for (n of [1, 2, 3, 4, 5]; track n) {
              <label [class.on]="n <= shown()" (mouseenter)="hover.set(n)">
                <input type="radio" formControlName="rating" [value]="n" [attr.aria-label]="n + (n === 1 ? ' star' : ' stars') + ' - ' + words[n]" />
                <mat-icon aria-hidden="true">{{ n <= shown() ? 'star' : 'star_border' }}</mat-icon>
              </label>
            }
            <span class="word" aria-hidden="true">{{ shown() ? words[shown()] : '' }}</span>
          </div>
          @if (showRatingError()) {
            <p class="field-error" role="alert">Choose a rating from 1 to 5 stars.</p>
          }
        </fieldset>

        <mat-form-field appearance="outline" class="comment">
          <mat-label>Tell other guests about it (optional)</mat-label>
          <textarea matInput formControlName="comment" rows="4" [maxlength]="maxComment"></textarea>
          <mat-hint align="end">{{ commentLength() }} / {{ maxComment }}</mat-hint>
        </mat-form-field>
        @if (commentError(); as e) {
          <p class="field-error" role="alert">{{ e }}</p>
        }

        <p class="final"><mat-icon>info</mat-icon><span>Reviews are final: once posted you can't edit or delete it. It shows your first name and last initial.</span></p>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button type="button" [mat-dialog-close]="undefined" [disabled]="posting()">Cancel</button>
        <button mat-flat-button type="submit" class="post" [disabled]="posting()">
          @if (posting()) { <mat-spinner diameter="18" aria-label="Posting your review" /> } @else { Post review }
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .intro { margin-top: 0; }
    .stars { margin: 0 0 16px; padding: 0; border: 0; }
    legend { margin-bottom: 4px; font-size: 14px; color: var(--mat-sys-on-surface-variant); }
    .row { display: flex; align-items: center; gap: 2px; }
    label { position: relative; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; cursor: pointer; color: var(--mat-sys-outline); }
    label.on { color: #f5a623; }
    label:hover { background: var(--mat-sys-surface-container-high); }
    label:has(input:focus-visible) { outline: 2px solid var(--mat-sys-primary); outline-offset: 1px; }
    input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
    mat-icon { font-size: 34px; width: 34px; height: 34px; }
    .word { margin-left: 10px; font-weight: 500; }
    .field-error { margin: 4px 0 0; font-size: 13px; color: var(--mat-sys-error); }
    .comment { width: 100%; }
    .final, .error { display: flex; gap: 8px; align-items: flex-start; font-size: 14px; }
    .final { margin: 8px 0 0; color: var(--mat-sys-on-surface-variant); }
    .error { margin: 0 0 12px; color: var(--mat-sys-error); }
    .final mat-icon, .error mat-icon { flex-shrink: 0; font-size: 18px; width: 18px; height: 18px; }
    .post { min-width: 128px; }
    .post mat-spinner { margin: 0 auto; }
  `,
})
export class ReviewDialog {
  readonly data = inject<ReviewDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<ReviewDialog, Review>>(MatDialogRef);
  private readonly reviews = inject(ReviewService);

  readonly words = RATING_WORDS;
  readonly maxComment = MAX_REVIEW_COMMENT;

  readonly form = inject(FormBuilder).nonNullable.group({
    rating: [0, [Validators.min(1), Validators.max(5)]],
    comment: ['', Validators.maxLength(MAX_REVIEW_COMMENT)],
  });
  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  readonly hover = signal(0);
  /** Stars lit: the hovered one while pointing, otherwise the chosen one. */
  readonly shown = computed(() => this.hover() || this.value().rating || 0);
  readonly commentLength = computed(() => (this.value().comment ?? '').length);

  readonly posting = signal(false);
  readonly error = signal<string | null>(null);
  readonly submitted = signal(false);
  readonly showRatingError = computed(() => this.submitted() && !this.value().rating);
  readonly commentError = signal<string | null>(null);

  submit(): void {
    this.submitted.set(true);
    const { rating, comment } = this.form.getRawValue();
    if (!rating || this.form.invalid || this.posting()) return;

    this.posting.set(true);
    this.error.set(null);
    this.commentError.set(null);
    this.dialogRef.disableClose = true; // no closing half-way through posting
    this.reviews.create({ property: this.data.propertyId, rating, comment: comment.trim() }).subscribe({
      next: (review) => this.dialogRef.close(review),
      error: (err) => {
        this.posting.set(false);
        this.dialogRef.disableClose = false;
        const parsed = parseApiErrors(err);
        this.commentError.set(parsed.fields['comment']?.join(' ') ?? null);
        const other = Object.entries(parsed.fields)
          .filter(([key]) => key !== 'comment')
          .flatMap(([, messages]) => messages);
        this.error.set(parsed.general ?? (other.length ? other.join(' ') : null));
      },
    });
  }
}
