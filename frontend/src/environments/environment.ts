// Development (ng serve / Docker). Production builds swap this file for
// environment.production.ts (angular.json -> fileReplacements).
export const environment = {
  production: false,
  apiUrl: 'http://localhost:8000/api',
  /** Show the "Waking up the demo server" notice after this many ms without an answer; null = never. */
  wakeNoticeAfterMs: null as number | null,
};
