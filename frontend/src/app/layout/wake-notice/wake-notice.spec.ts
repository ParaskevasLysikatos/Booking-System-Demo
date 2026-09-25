import { TestBed } from '@angular/core/testing';

import { ServerWakeService, WAKE_NOTICE_AFTER_MS } from '../../core/server-wake';
import { WakeNoticeComponent } from './wake-notice';

describe('WakeNoticeComponent', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the banner only while the server is slow to answer', async () => {
    TestBed.configureTestingModule({ providers: [{ provide: WAKE_NOTICE_AFTER_MS, useValue: 4000 }] });
    const fixture = TestBed.createComponent(WakeNoticeComponent);
    const el = fixture.nativeElement as HTMLElement;
    const wake = TestBed.inject(ServerWakeService);
    fixture.detectChanges();
    expect(el.querySelector('[role=status]')).not.toBeNull(); // live region always there
    expect(el.textContent).not.toContain('Waking up');

    wake.requestStarted();
    vi.advanceTimersByTime(4000);
    fixture.detectChanges();
    expect(el.textContent).toContain('Waking up the demo server - this can take up to a minute on the free plan.');

    wake.serverAnswered();
    wake.requestEnded();
    fixture.detectChanges();
    expect(el.textContent).not.toContain('Waking up');
  });
});
