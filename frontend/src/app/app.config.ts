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
import { serverWakeInterceptor } from './core/server-wake';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    // serverWake first, so it sees the whole wait (including a token refresh + replay).
    provideHttpClient(withInterceptors([serverWakeInterceptor, authInterceptor])),
    provideAnimationsAsync(),
    // Restore a saved session (and re-read the role from /auth/me/) before first render.
    provideAppInitializer(() => inject(AuthService).init()),
  ]
};
