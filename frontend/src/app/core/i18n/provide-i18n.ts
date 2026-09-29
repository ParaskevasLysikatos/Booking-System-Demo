import { EnvironmentProviders, Provider, inject, provideAppInitializer } from '@angular/core';
import { TitleStrategy } from '@angular/router';

import { PageTitle } from './page-title';
import { TranslationService } from './translation.service';

/**
 * The app-wide part of two languages, for `app.config.ts`: translated tab
 * titles, and the service created at start-up (it sets `<html lang>` and
 * loads the saved language's dictionary before the first render).
 * Material's own texts are provided by the pages that use those components:
 * `provideLocalizedDatepicker()`, `providePaginatorI18n()`, `provideStepperI18n()`.
 */
export function provideI18n(): (Provider | EnvironmentProviders)[] {
  return [
    { provide: TitleStrategy, useExisting: PageTitle },
    // Waits for a saved Greek choice to load, so the first render is already in Greek.
    provideAppInitializer(() => inject(TranslationService).ready()),
  ];
}
