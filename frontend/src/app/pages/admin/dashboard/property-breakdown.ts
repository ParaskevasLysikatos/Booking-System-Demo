import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PropertyStats } from '../../../core/admin/admin-stats.models';
import { formatPrice } from '../../../core/money';

/** Per-property table under the dashboard cards: nights, occupancy meter, revenue, expected. */
@Component({
  selector: 'app-property-breakdown',
  imports: [RouterLink],
  template: `
    <div class="wrap">
      <table>
        <caption>By property · sorted by revenue</caption>
        <thead>
          <tr>
            <th scope="col">Property</th>
            <th scope="col" class="num">Booked nights</th>
            <th scope="col" class="occ">Occupancy</th>
            <th scope="col" class="num">Revenue</th>
            <th scope="col" class="num">Expected</th>
          </tr>
        </thead>
        <tbody>
          @for (p of rows(); track p.id) {
            <tr>
              <th scope="row">
                <a [routerLink]="['/listings', p.id]">{{ p.title }}</a>
                @if (!p.is_active) {
                  <span class="retired">Retired</span>
                }
              </th>
              <td class="num">{{ p.booked_nights }}</td>
              <td class="occ">
                <span class="meter" role="img" [attr.aria-label]="pct(p.occupancy_rate) + ' occupied'">
                  <span class="fill" [style.width.%]="(p.occupancy_rate ?? 0) * 100"></span>
                </span>
                <span class="pct">{{ pct(p.occupancy_rate) }}</span>
              </td>
              <td class="num">{{ money(p.revenue) }}</td>
              <td class="num muted">{{ p.pending_revenue === '0.00' ? '–' : money(p.pending_revenue) }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .wrap { overflow-x: auto; border: 1px solid var(--mat-sys-outline-variant); border-radius: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    caption { text-align: left; padding: 14px 16px 6px; font-weight: 500; font-size: 16px; }
    th, td { padding: 10px 16px; text-align: left; border-top: 1px solid var(--mat-sys-outline-variant); white-space: nowrap; }
    thead th { border-top: 0; font-weight: 500; font-size: 12px; color: var(--mat-sys-on-surface-variant); }
    tbody th { font-weight: 400; }
    tbody th a { color: inherit; text-decoration: none; }
    tbody th a:hover { text-decoration: underline; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .muted { color: var(--mat-sys-on-surface-variant); }
    .occ { min-width: 160px; }
    td.occ { display: flex; align-items: center; gap: 8px; }
    /* Meter: fill + a lighter step of the same hue as the track. */
    .meter { flex: 1; height: 6px; border-radius: 999px; background: var(--mat-sys-primary-container); overflow: hidden; }
    .fill { display: block; height: 100%; border-radius: 999px; background: var(--mat-sys-primary); }
    .pct { width: 44px; text-align: right; font-variant-numeric: tabular-nums; }
    .retired { margin-left: 6px; padding: 1px 8px; border-radius: 999px; font-size: 11px;
      background: var(--mat-sys-surface-container-highest); color: var(--mat-sys-on-surface-variant); }
  `,
})
export class PropertyBreakdownComponent {
  readonly rows = input.required<PropertyStats[]>();

  money(v: string): string {
    return formatPrice(v);
  }

  pct(rate: number | null): string {
    return rate === null ? '–' : `${(rate * 100).toFixed(rate * 100 >= 10 || rate === 0 ? 0 : 1)}%`;
  }
}
