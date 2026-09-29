// Runs before every spec file (angular.json -> test -> setupFiles).
//
// TICKET-038: the chosen language is remembered in localStorage (`bsd.lang`).
// A test that switches to Greek - or fails half-way through one - must never
// leave the next test (in any spec file) starting in Greek.
beforeEach(() => {
  try {
    localStorage.removeItem('bsd.lang');
  } catch {
    /* no storage in this environment - nothing to clean */
  }
});
