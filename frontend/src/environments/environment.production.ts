// Production build (`ng build`, used by the Render static site - TICKET-027).
export const environment = {
  production: true,
  apiUrl: 'https://booking-demo-api.onrender.com/api',
  /**
   * The free Render API sleeps after 15 idle minutes and takes ~50 s to wake,
   * so after 4 s without an answer the app says so (layout/wake-notice).
   */
  wakeNoticeAfterMs: 4000 as number | null,
};
