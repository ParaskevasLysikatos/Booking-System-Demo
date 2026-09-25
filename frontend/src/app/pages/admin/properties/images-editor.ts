import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, FormControl, NG_VALUE_ACCESSOR, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';

import { PropertyImageInput } from '../../../core/admin/admin-properties.service';

const URL_PATTERN = /^https?:\/\/\S+$/i;

/**
 * Photos editor for the property form (TICKET-024) - a form control whose
 * value is the ordered image list. Paste a URL to add, drag to reorder,
 * star to pick the cover (exactly one), remove. URLs only for now; real
 * uploads (S3) replace the "add" part in TICKET-036.
 */
@Component({
  selector: 'app-images-editor',
  imports: [
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
  ],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => ImagesEditorComponent), multi: true }],
  templateUrl: './images-editor.html',
  styleUrl: './images-editor.scss',
})
export class ImagesEditorComponent implements ControlValueAccessor {
  /** Server-side error for the images field, shown under the list. */
  readonly error = input<string | null>(null);

  readonly images = signal<PropertyImageInput[]>([]);
  readonly failed = signal<ReadonlySet<string>>(new Set());
  readonly disabled = signal(false);
  readonly addError = signal<string | null>(null);
  readonly url = new FormControl('', { nonNullable: true, validators: [Validators.pattern(URL_PATTERN)] });

  private onChange: (value: PropertyImageInput[]) => void = () => {};
  private onTouched: () => void = () => {};

  // --- ControlValueAccessor ----------------------------------------------

  writeValue(value: PropertyImageInput[] | null): void {
    this.images.set(this.normalise((value ?? []).map((i) => ({ image: i.image, is_cover: i.is_cover }))));
  }
  registerOnChange(fn: (value: PropertyImageInput[]) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }

  // --- actions ------------------------------------------------------------

  add(): void {
    const value = this.url.value.trim();
    if (!value) return;
    if (!URL_PATTERN.test(value)) {
      this.addError.set('Enter a full image URL starting with http:// or https://');
      return;
    }
    if (this.images().some((i) => i.image === value)) {
      this.addError.set('That photo is already in the list.');
      return;
    }
    this.addError.set(null);
    this.url.setValue('');
    this.commit([...this.images(), { image: value, is_cover: this.images().length === 0 }]);
  }

  remove(index: number): void {
    this.commit(this.images().filter((_, i) => i !== index));
  }

  setCover(index: number): void {
    this.commit(this.images().map((img, i) => ({ ...img, is_cover: i === index })));
  }

  drop(event: CdkDragDrop<PropertyImageInput[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const next = [...this.images()];
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.commit(next);
  }

  markFailed(url: string): void {
    this.failed.set(new Set([...this.failed(), url]));
  }

  /** Exactly one cover whenever there are photos (the first, if none is chosen). */
  private normalise(list: PropertyImageInput[]): PropertyImageInput[] {
    if (!list.length) return list;
    const coverIndex = Math.max(0, list.findIndex((i) => i.is_cover));
    return list.map((img, i) => ({ ...img, is_cover: i === coverIndex }));
  }

  private commit(list: PropertyImageInput[]): void {
    const next = this.normalise(list);
    this.images.set(next);
    this.onChange(next);
    this.onTouched();
  }
}
