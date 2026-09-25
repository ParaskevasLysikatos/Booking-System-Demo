import { Component, computed, forwardRef, signal } from '@angular/core';
import { ControlValueAccessor, FormControl, NG_VALUE_ACCESSOR, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import { KNOWN_AMENITIES, amenityIcon, amenityLabel, toAmenityKey } from '../../../core/amenities';

/**
 * Amenities for the property form (TICKET-024): a checklist of the known
 * amenities (with icons) plus custom ones typed in ("Hot tub" -> hot_tub).
 * Form control value: the list of amenity keys, in a stable order.
 */
@Component({
  selector: 'app-amenities-picker',
  imports: [ReactiveFormsModule, MatButtonModule, MatCheckboxModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatInputModule],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => AmenitiesPickerComponent), multi: true }],
  template: `
    <div class="grid" role="group" aria-label="Amenities">
      @for (key of known; track key) {
        <mat-checkbox [checked]="selected().includes(key)" (change)="toggle(key, $event.checked)" [disabled]="disabled()">
          <span class="opt"><mat-icon>{{ icon(key) }}</mat-icon>{{ label(key) }}</span>
        </mat-checkbox>
      }
    </div>

    <div class="custom">
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>Other amenity</mat-label>
        <input matInput [formControl]="custom" placeholder="e.g. Hot tub" maxlength="50" (keydown.enter)="$event.preventDefault(); addCustom()" />
      </mat-form-field>
      <button mat-stroked-button type="button" (click)="addCustom()" [disabled]="disabled() || !custom.value.trim()">Add</button>
    </div>
    @if (customKeys().length) {
      <mat-chip-set aria-label="Other amenities">
        @for (key of customKeys(); track key) {
          <mat-chip (removed)="toggle(key, false)" [disabled]="disabled()">
            {{ label(key) }}
            <button matChipRemove [attr.aria-label]="'Remove ' + label(key)"><mat-icon>cancel</mat-icon></button>
          </mat-chip>
        }
      </mat-chip-set>
    }
  `,
  styles: `
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 2px 8px; }
    .opt { display: inline-flex; align-items: center; gap: 8px; }
    .opt mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--mat-sys-on-surface-variant); }
    .custom { display: flex; gap: 8px; align-items: center; margin: 12px 0 8px; flex-wrap: wrap; }
    .custom mat-form-field { flex: 1 1 220px; max-width: 320px; }
  `,
})
export class AmenitiesPickerComponent implements ControlValueAccessor {
  readonly known = KNOWN_AMENITIES;
  readonly label = amenityLabel;
  readonly icon = amenityIcon;

  readonly selected = signal<string[]>([]);
  readonly customKeys = computed(() => this.selected().filter((k) => !KNOWN_AMENITIES.includes(k)));
  readonly disabled = signal(false);
  readonly custom = new FormControl('', { nonNullable: true });

  private onChange: (v: string[]) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(value: string[] | null): void {
    this.selected.set(this.ordered(value ?? []));
  }
  registerOnChange(fn: (v: string[]) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }

  toggle(key: string, on: boolean): void {
    const current = this.selected();
    this.commit(on ? [...current, key] : current.filter((k) => k !== key));
  }

  addCustom(): void {
    const key = toAmenityKey(this.custom.value);
    this.custom.setValue('');
    if (key && !this.selected().includes(key)) this.commit([...this.selected(), key]);
  }

  /** Known amenities in checklist order, then custom ones in the order added (no duplicates). */
  private ordered(keys: string[]): string[] {
    const unique = [...new Set(keys)];
    return [...KNOWN_AMENITIES.filter((k) => unique.includes(k)), ...unique.filter((k) => !KNOWN_AMENITIES.includes(k))];
  }

  private commit(keys: string[]): void {
    const next = this.ordered(keys);
    this.selected.set(next);
    this.onChange(next);
    this.onTouched();
  }
}
