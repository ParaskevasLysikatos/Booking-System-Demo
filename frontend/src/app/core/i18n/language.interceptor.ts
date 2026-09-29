import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { TranslationService } from './translation.service';

/**
 * TICKET-038: tells our API which language the visitor chose
 * (`Accept-Language: en` / `el`), so Django answers its messages in that
 * language and Stripe's payment page opens in it. Only our API - a
 * third-party URL (photos, map tiles, geocoding) keeps the browser's own header.
 * (`Accept-Language` is a CORS-safelisted header: no extra preflight.)
 */
export const languageInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(`${environment.apiUrl}/`)) return next(req);
  const lang = inject(TranslationService).lang();
  return next(req.clone({ setHeaders: { 'Accept-Language': lang } }));
};
