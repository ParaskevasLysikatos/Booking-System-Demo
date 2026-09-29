import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { TranslatePipe } from '../core/i18n/translate.pipe';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
}

/** Generic "Are you sure?" dialog - closes with `true` only when confirmed. */
@Component({
  selector: 'app-confirm-dialog',
  imports: [MatButtonModule, MatDialogModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content><p>{{ data.message }}</p></mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="false" cdkFocusInitial>{{ data.cancelLabel ?? ('common.cancel' | t) }}</button>
      <button mat-flat-button [class.danger]="data.danger" [mat-dialog-close]="true">{{ data.confirmLabel }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .danger { background: var(--mat-sys-error); color: var(--mat-sys-on-error); }
    p { margin: 0; }
  `,
})
export class ConfirmDialog {
  readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
}
