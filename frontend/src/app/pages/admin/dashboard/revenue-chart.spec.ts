import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RevenueSeries } from '../../../core/admin/admin-stats.models';
import { DAILY } from '../../../core/admin/revenue-chart.testing';
import { RevenueChartComponent, tooltipLeft } from './revenue-chart';

describe('RevenueChartComponent', () => {
  let fixture: ComponentFixture<RevenueChartComponent>;
  let el: HTMLElement;

  function render(series: RevenueSeries, today = new Date(2030, 0, 3)): void {
    fixture = TestBed.createComponent(RevenueChartComponent);
    fixture.componentRef.setInput('series', series);
    fixture.componentRef.setInput('today', today);
    fixture.detectChanges();
    el = fixture.nativeElement;
  }
  const text = () => el.textContent!.replace(/\s+/g, ' ');
  const hits = () => [...el.querySelectorAll<SVGRectElement>('rect.hit')];

  it('draws one column per bucket, stacked segments, a legend with totals and the Today line', () => {
    render(DAILY);
    expect(text()).toContain('Revenue over time');
    expect(text()).toContain('By day · nights inside the period');
    expect(text()).toContain('Revenue (confirmed) €626.67');
    expect(text()).toContain('Expected (pending) €300');
    expect(hits().length).toBe(10);
    expect(el.querySelectorAll('path.bar.revenue').length).toBe(6); // days with confirmed revenue
    expect(el.querySelectorAll('path.bar.expected').length).toBe(3); // 5th-7th
    expect(el.querySelector('.today-label')!.textContent).toBe('Today');
    expect([...el.querySelectorAll('.y-axis text')].map((t) => t.textContent)).toEqual(['€0', '€50', '€100', '€150', '€200', '€250']);
    const svg = el.querySelector('svg.plot')!;
    expect(svg.getAttribute('aria-label')).toContain('Revenue by day, 10 bars: €626.67 confirmed and €300 expected.');
    expect(hits()[1].getAttribute('aria-label')).toBe('Wed, 2 Jan 2030: €213.33 revenue, 3 booked nights');
  });

  it('a scroll note only when the plot is wider than the card', () => {
    render(DAILY);
    expect(el.querySelector('.scroll-note')).toBeNull();
    fixture.componentInstance.plotWidth.set(60); // 10 days x 9 px minimum = 90 px > 60
    fixture.detectChanges();
    expect(el.querySelector('.scroll-note')!.textContent).toContain('Scroll sideways to see the whole period');
  });

  it('no Today line when today is outside the period', () => {
    render(DAILY, new Date(2031, 0, 1));
    expect(el.querySelector('.today')).toBeNull();
  });

  it('the tooltip goes beside the bar: right if it fits, else left, else clamped inside the card', () => {
    expect(tooltipLeft(100, 24, 600)).toBe(132); // right of the bar
    expect(tooltipLeft(450, 24, 600)).toBe(242); // no room right -> left: 450 - 8 - 200
    expect(tooltipLeft(150, 20, 330)).toBe(130); // phone: neither fits -> as far right as the card allows
    expect(tooltipLeft(40, 20, 180)).toBe(0);
  });

  it('hover shows the tooltip for that column with a highlight band; leaving hides it', () => {
    render(DAILY);
    hits()[4].dispatchEvent(new Event('pointerenter'));
    fixture.detectChanges();
    const tip = [...el.querySelectorAll('.tooltip p')].map((p) => p.textContent!.replace(/\s+/g, ' ').trim());
    expect(tip).toEqual(['Sat, 5 Jan 2030', '€0 revenue', '€100 expected', '0 booked nights · 1 pending']);
    expect(el.querySelector('rect.band')).not.toBeNull();
    expect(el.querySelectorAll('path.bar.dim').length).toBe(0); // no dimming: it would look like "expected"
    el.querySelector('svg.plot')!.dispatchEvent(new Event('pointerleave'));
    fixture.detectChanges();
    expect(el.querySelector('.tooltip')).toBeNull();
  });

  it('keyboard: one tab stop, arrows / Home / End move between columns, Esc hides', () => {
    render(DAILY);
    expect(hits().map((h) => h.getAttribute('tabindex'))).toEqual(['0', ...Array(9).fill('-1')]);
    hits()[0].dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(el.querySelector('.tooltip')!.textContent).toContain('Tue, 1 Jan 2030');

    const key = (target: Element, k: string) => {
      const e = new KeyboardEvent('keydown', { key: k, cancelable: true });
      target.dispatchEvent(e);
      fixture.detectChanges();
      return e;
    };
    expect(key(hits()[0], 'ArrowRight').defaultPrevented).toBe(true);
    expect(hits()[1].getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(hits()[1]);
    key(hits()[1], 'End');
    expect(document.activeElement).toBe(hits()[9]);
    expect(el.querySelector('.tooltip')!.textContent).toContain('Thu, 10 Jan 2030');
    key(hits()[9], 'ArrowRight'); // stays on the last one
    expect(document.activeElement).toBe(hits()[9]);
    key(hits()[9], 'Home');
    expect(document.activeElement).toBe(hits()[0]);
    key(hits()[0], 'Escape');
    expect(el.querySelector('.tooltip')).toBeNull();
  });

  it('Table view lists every bucket with a total row (the same numbers without colour)', () => {
    render(DAILY);
    fixture.componentInstance.setView('table');
    fixture.detectChanges();
    expect(el.querySelector('svg.plot')).toBeNull();
    const cells = (row: Element) => [...row.children].map((c) => c.textContent!.trim());
    const rows = [...el.querySelectorAll('tbody tr')].map(cells);
    expect(rows.length).toBe(10);
    expect(rows[1]).toEqual(['Wed, 2 Jan 2030', '€213.33', '–', '3', '–']);
    expect(rows[4]).toEqual(['Sat, 5 Jan 2030', '€0', '€100', '0', '1']);
    expect(cells(el.querySelector('tfoot tr')!)).toEqual(['Total', '€626.67', '€300', '10', '3']);
  });

  it('empty period: axis kept, a message instead of bars', () => {
    render({ granularity: 'week', buckets: [
      { from: '2035-06-02', to: '2035-06-08', nights: 7, revenue: '0.00', pending_revenue: '0.00', booked_nights: 0, pending_nights: 0 },
    ] });
    expect(text()).toContain('By week');
    expect(el.querySelector('.empty')!.textContent).toContain('No revenue in this period');
    expect(el.querySelectorAll('path.bar').length).toBe(0);
    expect(el.querySelectorAll('.y-axis text').length).toBe(3);
  });
});
