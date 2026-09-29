import { Injectable, Provider, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatPaginatorIntl } from '@angular/material/paginator';

import { TranslationService } from './translation.service';

/**
 * The paginator's texts in the chosen language (TICKET-038): labels from
 * `mat.paginator.*`, refilled on every switch, then `changes` so an open
 * paginator redraws at once.
 *
 * Provided per page (component `providers`), not at the root: importing
 * Material's intl classes in app.config would pull ~320 kB of Material code
 * into the initial bundle. The pages that use these components are
 * lazy-loaded and already load that code.
 */
@Injectable()
export class I18nPaginatorIntl extends MatPaginatorIntl {
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
    const t = (key: string) => this.i18n.t(`mat.paginator.${key}`);
    this.itemsPerPageLabel = t('itemsPerPage');
    this.nextPageLabel = t('nextPage');
    this.previousPageLabel = t('previousPage');
    this.firstPageLabel = t('firstPage');
    this.lastPageLabel = t('lastPage');
  }

  // Same maths as Material's default, with translated words.
  override getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length == 0 || pageSize == 0) return this.i18n.t('mat.paginator.rangeEmpty', { length });
    length = Math.max(length, 0);
    const start = page * pageSize;
    const end = start < length ? Math.min(start + pageSize, length) : start + pageSize;
    return this.i18n.t('mat.paginator.range', { start: start + 1, end, length });
  };
}

/** For the `providers` of a page with a `<mat-paginator>`. */
export function providePaginatorI18n(): Provider[] {
  return [{ provide: MatPaginatorIntl, useClass: I18nPaginatorIntl }];
}
