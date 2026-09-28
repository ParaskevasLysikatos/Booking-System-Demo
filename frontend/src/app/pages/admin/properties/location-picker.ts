import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, forwardRef, inject, input, signal, untracked } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { GeocodeService, PRECISION_LABELS } from '../../../core/admin/geocode.service';
import { MapComponent } from '../../../shared/map/map';
import { LatLng, MapMarker } from '../../../shared/map/map-markers';

/** The form control's value: the exact map position, or null while unset. */
export type MapPosition = LatLng | null;

/** 6 decimals (~11 cm) - what the API stores. */
export function roundCoord(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

type SearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'found'; label: string; precision: string }
  | { status: 'none'; query: string }
  | { status: 'error'; message: string };

/**
 * The property form's "Map position" (TICKET-034 step 7). Agreed with the owner:
 *
 * - **Find on map**: an address box, pre-filled from the Location field
 *   until the admin types in it (so "Tsimiski 45, Thessaloniki" can be
 *   searched without changing the public Location). The **best match** is
 *   used straight away - the pin moves there and the page says which
 *   place it picked, so the admin can fine-tune by dragging.
 * - **Click** the map to place the pin, **drag** it to adjust.
 * - The position is **required** (the form's Validators.required + the API).
 *
 * Form control value: `{ lat, lng }` (rounded to 6 decimals) or null.
 */
@Component({
  selector: 'app-location-picker',
  imports: [MapComponent, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => LocationPickerComponent), multi: true }],
  template: `
    <div class="find">
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>Find address</mat-label>
        <!-- A plain value binding, not ngModel: this sits inside the page's reactive form. -->
        <input
          matInput
          [value]="address()"
          (input)="typeAddress($any($event.target).value)"
          placeholder="e.g. Tsimiski 45, Thessaloniki"
          maxlength="200"
          (keydown.enter)="$event.preventDefault(); find()"
          [disabled]="disabled()"
        />
      </mat-form-field>
      <button mat-stroked-button type="button" (click)="find()" [disabled]="disabled() || search().status === 'searching' || address().trim().length < 2">
        @if (search().status === 'searching') { <mat-spinner diameter="18" /> } @else { <mat-icon>travel_explore</mat-icon> }
        Find on map
      </button>
    </div>

    <p class="status" role="status">
      @switch (search().status) {
        @case ('found') {
          <mat-icon class="ok">check_circle</mat-icon>
          <span>Placed at <strong>{{ $any(search()).label }}</strong> ({{ $any(search()).precision }}). Drag the pin to fine-tune.</span>
        }
        @case ('none') {
          <mat-icon class="warn">help</mat-icon>
          <span>No place in Greece matched "{{ $any(search()).query }}". Try a street and town, or click the map.</span>
        }
        @case ('error') {
          <mat-icon class="warn">cloud_off</mat-icon><span>{{ $any(search()).message }}</span>
        }
        @default {
          @if (!value()) {
            <mat-icon>ads_click</mat-icon><span>Find the address, or click the map to place the pin.</span>
          }
        }
      }
    </p>

    <app-map
      class="map"
      ariaLabel="Map position of this property - click to place the pin, drag it to adjust"
      [markers]="markers()"
      [cluster]="false"
      [fitToMarkers]="autoFit()"
      [maxFitZoom]="16"
      [scrollWheelZoom]="false"
      (mapClick)="place($event, false)"
      (markerDragEnd)="place($event, false)"
    />

    <p class="coords">
      @if (value(); as v) {
        <mat-icon>place</mat-icon>{{ v.lat.toFixed(6) }}, {{ v.lng.toFixed(6) }}
      } @else {
        No position yet.
      }
    </p>
  `,
  styles: `
    :host { display: block; }
    .find { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .find mat-form-field { flex: 1 1 260px; }
    .find button { height: 56px; }
    .find mat-spinner { display: inline-block; margin-right: 6px; }
    .status { display: flex; align-items: flex-start; gap: 6px; min-height: 24px; margin: 8px 0; font-size: 14px; }
    .status mat-icon { flex: none; font-size: 20px; width: 20px; height: 20px; color: var(--mat-sys-on-surface-variant); }
    .status .ok { color: #2e7d32; }
    .status .warn { color: var(--mat-sys-error); }
    .map { height: 340px; }
    .coords { display: flex; align-items: center; gap: 4px; margin: 8px 0 0; font-size: 13px;
      color: var(--mat-sys-on-surface-variant); font-variant-numeric: tabular-nums; }
    .coords mat-icon { font-size: 16px; width: 16px; height: 16px; }
  `,
})
export class LocationPickerComponent implements ControlValueAccessor {
  /** The form's Location text - pre-fills the address box until the admin types there. */
  readonly locationText = input('');

  private readonly geocode = inject(GeocodeService);

  readonly value = signal<MapPosition>(null);
  readonly disabled = signal(false);
  readonly search = signal<SearchState>({ status: 'idle' });
  /** Refit the map only when the position comes from outside (load / search), not on click/drag. */
  readonly autoFit = signal(true);

  private readonly typedAddress = signal<string | null>(null);
  readonly address = computed(() => this.typedAddress() ?? this.locationText());

  readonly markers = computed<MapMarker[]>(() => {
    const v = this.value();
    return v ? [{ id: 'position', lat: v.lat, lng: v.lng, title: 'Map position (drag to move)', draggable: !this.disabled() }] : [];
  });

  private onChange: (v: MapPosition) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    // Editing the address clears an old "nothing found" message. Only the
    // address is tracked - reading the search state untracked, or setting
    // 'none' would immediately clear itself.
    effect(() => {
      this.address();
      untracked(() => {
        if (this.search().status === 'none') this.search.set({ status: 'idle' });
      });
    });
  }

  writeValue(value: MapPosition): void {
    this.autoFit.set(true);
    this.value.set(value && Number.isFinite(value.lat) && Number.isFinite(value.lng) ? value : null);
  }

  registerOnChange(fn: (v: MapPosition) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }

  typeAddress(text: string): void {
    this.typedAddress.set(text);
  }

  /** Click / drag (fit = false: the map stays where the admin is looking) or a search result (fit = true). */
  place(at: LatLng, fit: boolean): void {
    if (this.disabled()) return;
    this.autoFit.set(fit);
    const next = { lat: roundCoord(at.lat), lng: roundCoord(at.lng) };
    this.value.set(next);
    if (!fit && this.search().status !== 'searching') this.search.set({ status: 'idle' });
    this.onChange(next);
    this.onTouched();
  }

  find(): void {
    const query = this.address().trim();
    if (query.length < 2 || this.disabled() || this.search().status === 'searching') return;
    this.search.set({ status: 'searching' });
    this.geocode.search(query).subscribe({
      next: ({ results }) => {
        const best = results[0]; // agreed: use the best match straight away
        if (!best) {
          this.search.set({ status: 'none', query });
          return;
        }
        this.place({ lat: best.latitude, lng: best.longitude }, true);
        this.search.set({ status: 'found', label: best.label, precision: PRECISION_LABELS[best.precision] ?? best.precision });
      },
      error: (err: unknown) => this.search.set({ status: 'error', message: searchErrorMessage(err) }),
    });
  }
}

function searchErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 429) return 'Too many searches in a row - wait a minute, or click the map instead.';
    if (err.status === 503 && typeof err.error?.detail === 'string') return err.error.detail;
    if (err.status === 0) return "Can't reach the server - click the map to place the pin instead.";
  }
  return "Map search isn't available right now. Try again in a moment, or place the pin on the map.";
}
