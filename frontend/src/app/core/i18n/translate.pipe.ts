import { Pipe, PipeTransform, inject } from '@angular/core';

import { TParams, TranslationService } from './translation.service';

/**
 * `{{ 'toolbar.logIn' | t }}` / `{{ 'toolbar.accountMenu' | t: { email } }}`
 *
 * Impure on purpose: a pure pipe is only re-run when its arguments change, so
 * it would keep the old language after a switch. It reads the `lang` signal,
 * so the view refreshes on a switch (no reload), and it caches the last
 * result, so the extra calls cost a comparison, not a lookup.
 */
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(TranslationService);
  private last: { key: string; params?: TParams; lang: string; text: string } | null = null;

  transform(key: string, params?: TParams): string {
    const lang = this.i18n.lang();
    const last = this.last;
    if (last && last.key === key && last.lang === lang && sameParams(last.params, params)) {
      return last.text;
    }
    const text = this.i18n.t(key, params);
    this.last = { key, params: params ? { ...params } : undefined, lang, text };
    return text;
  }
}

function sameParams(a?: TParams, b?: TParams): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}
