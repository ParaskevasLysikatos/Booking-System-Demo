import { Injectable, Provider, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatStepperIntl } from '@angular/material/stepper';

import { TranslationService } from './translation.service';

/** The stepper's texts (Optional / Completed / Editable) in the chosen language (TICKET-038). *
 * Provided per page (component `providers`), not at the root: importing
 * Material's intl classes in app.config would pull ~320 kB of Material code
 * into the initial bundle. The pages that use these components are
 * lazy-loaded and already load that code.
 */
@Injectable()
export class I18nStepperIntl extends MatStepperIntl {
  private readonly i18n = inject(TranslationService);

  constructor() {
    super();
    this.apply();
    this.i18n.changes.pipe(takeUntilDestroyed()).subscribe(() => {
      this.apply();
      this.changes.next();
    });
  }

  private apply(): void {
    this.optionalLabel = this.i18n.t('mat.stepper.optional');
    this.completedLabel = this.i18n.t('mat.stepper.completed');
    this.editableLabel = this.i18n.t('mat.stepper.editable');
  }
}

/** For the `providers` of a page with a `<mat-stepper>`. */
export function provideStepperI18n(): Provider[] {
  return [{ provide: MatStepperIntl, useClass: I18nStepperIntl }];
}
