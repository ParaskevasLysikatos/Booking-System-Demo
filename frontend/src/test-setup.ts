// Runs before every spec file (angular.json -> test -> setupFiles).
import el from './app/core/i18n/el.json';
import { DICTIONARIES, Dictionary } from './app/core/i18n/translation.service';

// TICKET-038: in the app Greek is a lazy chunk; tests switch languages
// synchronously, so it's loaded up front here. (translation.service.spec
// covers the lazy loading itself.)
DICTIONARIES.el = el as Dictionary;

// The chosen language is remembered in localStorage (`bsd.lang`). A test that
// switches to Greek - or fails half-way through one - must never leave the
// next test (in any spec file) starting in Greek.
beforeEach(() => {
  try {
    localStorage.removeItem('bsd.lang');
  } catch {
    /* no storage in this environment - nothing to clean */
  }
});
