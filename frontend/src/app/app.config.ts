import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';
import { languageInterceptor } from './core/i18n/language.interceptor';
import { provideI18n } from './core/i18n/provide-i18n';
import { serverWakeInterceptor } from './core/server-wake';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    // serverWake first, so it sees the whole wait (including a token refresh + replay);
    // language before auth, so a replayed request keeps its Accept-Language.
    provideHttpClient(withInterceptors([serverWakeInterceptor, languageInterceptor, authInterceptor])),
    provideAnimationsAsync(),
    // English / Greek (TICKET-038): Material's texts, translated tab titles, <html lang>.
    ...provideI18n(),
    // Restore a saved session (and re-read the role from /auth/me/) before first render.
    provideAppInitializer(() => inject(AuthService).init()),
  ]
};
