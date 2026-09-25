import { inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { CanDeactivateFn } from '@angular/router';
import { map } from 'rxjs';

import { ConfirmDialog, ConfirmDialogData } from '../shared/confirm-dialog';

export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

/**
 * Leaving a form with unsaved edits asks first (TICKET-024). Closing or
 * reloading the tab is covered separately by the component's
 * `beforeunload` handler (browsers only allow their own generic prompt).
 */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (!component?.hasUnsavedChanges()) return true;
  return inject(MatDialog)
    .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
      data: {
        title: 'Discard unsaved changes?',
        message: "You have changes that haven't been saved. If you leave now, they'll be lost.",
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        danger: true,
      },
      width: '440px',
    })
    .afterClosed()
    .pipe(map((discard) => discard === true));
};
