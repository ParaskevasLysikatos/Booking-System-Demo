import { inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { CanDeactivateFn } from '@angular/router';
import { map } from 'rxjs';

import { ConfirmDialog, ConfirmDialogData } from '../shared/confirm-dialog';
import { translate } from './i18n/translation.service';

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
        title: translate('admin.unsaved.title'),
        message: translate('admin.unsaved.message'),
        confirmLabel: translate('admin.unsaved.discard'),
        cancelLabel: translate('admin.unsaved.keep'),
        danger: true,
      },
      width: '440px',
    })
    .afterClosed()
    .pipe(map((discard) => discard === true));
};
