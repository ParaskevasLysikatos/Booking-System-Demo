import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, OnDestroy, computed, forwardRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  ControlValueAccessor,
  FormControl,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
  ValidationErrors,
  Validator,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';

import { PropertyImageInput } from '../../../core/admin/admin-properties.service';
import { MAX_PHOTO_SIDE } from '../../../core/admin/image-resize';
import { PhotoUploadService } from '../../../core/admin/photo-upload.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { translate } from '../../../core/i18n/translation.service';

const URL_PATTERN = /^https?:\/\/\S+$/i;

/** At most this many photos are resized/uploaded at the same time; the rest wait. */
export const MAX_PARALLEL_UPLOADS = 2;

/** A photo being uploaded (not part of the form value until it's done). */
export interface UploadItem {
  id: number;
  file: File;
  name: string;
  /** Object URL of the original file, for the row's thumbnail ('' if unavailable). */
  preview: string;
  percent: number;
  state: 'queued' | 'uploading' | 'failed';
  error: string | null;
}

/**
 * Photos editor for the property form (TICKET-024) - a form control whose
 * value is the ordered image list. Drag to reorder, star to pick the cover
 * (exactly one), remove. Add photos by uploading them (TICKET-036: drag &
 * drop or Upload photos -> resized in the browser -> straight to S3) or by
 * pasting a URL. While uploads are running the control is invalid
 * (`uploading`), so the form can't be saved without them.
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
    MatProgressBarModule,
    MatTooltipModule,
    TranslatePipe,
  ],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => ImagesEditorComponent), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => ImagesEditorComponent), multi: true },
  ],
  templateUrl: './images-editor.html',
  styleUrl: './images-editor.scss',
})
export class ImagesEditorComponent implements ControlValueAccessor, Validator, OnDestroy {
  /** Server-side error for the images field, shown under the list. */
  readonly error = input<string | null>(null);

  readonly maxSide = MAX_PHOTO_SIDE;
  readonly images = signal<PropertyImageInput[]>([]);
  readonly failed = signal<ReadonlySet<string>>(new Set());
  readonly disabled = signal(false);
  readonly addError = signal<string | null>(null);
  readonly url = new FormControl('', { nonNullable: true, validators: [Validators.pattern(URL_PATTERN)] });

  private readonly uploader = inject(PhotoUploadService);
  /** Whether the server has S3 set up (GET /api/admin/uploads/config/); off -> URLs only. */
  readonly uploadsEnabled = signal(false);
  readonly uploads = signal<UploadItem[]>([]);
  /** True while any photo is waiting or uploading (failed ones don't block saving). */
  readonly uploading = computed(() => this.uploads().some((u) => u.state !== 'failed'));
  readonly dragOver = signal(false);

  private nextId = 1;
  private readonly running = new Map<number, Subscription>();
  private onChange: (value: PropertyImageInput[]) => void = () => {};
  private onTouched: () => void = () => {};
  private onValidatorChange: () => void = () => {};

  constructor() {
    this.uploader
      .config()
      .pipe(takeUntilDestroyed())
      .subscribe((c) => this.uploadsEnabled.set(c.enabled));
  }

  ngOnDestroy(): void {
    this.running.forEach((sub) => sub.unsubscribe()); // aborts the requests
    this.uploads().forEach((u) => revoke(u.preview));
  }

  // --- ControlValueAccessor + Validator -----------------------------------

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
  validate(_: AbstractControl): ValidationErrors | null {
    return this.uploading() ? { uploading: true } : null;
  }
  registerOnValidatorChange(fn: () => void): void {
    this.onValidatorChange = fn;
  }

  // --- actions ------------------------------------------------------------

  add(): void {
    const value = this.url.value.trim();
    if (!value) return;
    if (!URL_PATTERN.test(value)) {
      this.addError.set(translate('photos.err.badUrl'));
      return;
    }
    if (this.images().some((i) => i.image === value)) {
      this.addError.set(translate('photos.err.duplicate'));
      return;
    }
    this.addError.set(null);
    this.url.setValue('');
    this.append(value);
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

  // --- uploads (TICKET-036) -------------------------------------------------

  onFilesPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addFiles(input.files);
    input.value = ''; // picking the same file again still fires (change)
  }

  onDragOver(event: DragEvent): void {
    if (!this.canUpload() || !event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault(); // allows the drop
    event.dataTransfer.dropEffect = 'copy';
    this.dragOver.set(true);
  }

  onDrop(event: DragEvent): void {
    this.dragOver.set(false);
    if (!this.canUpload() || !event.dataTransfer?.files?.length) return;
    event.preventDefault(); // or the browser opens the photo in the tab
    this.addFiles(event.dataTransfer.files);
  }

  addFiles(files: FileList | File[] | null | undefined): void {
    if (!files || !this.canUpload()) return;
    const list = Array.from(files);
    const photos = list.filter((f) => f.type.startsWith('image/'));
    const skipped = list.filter((f) => !f.type.startsWith('image/'));
    this.addError.set(
      skipped.length ? translate('photos.err.skipped', { names: skipped.map((f) => f.name).join(', ') }) : null,
    );
    if (!photos.length) return;
    const items = photos.map(
      (file): UploadItem => ({
        id: this.nextId++,
        file,
        name: file.name,
        preview: preview(file),
        percent: 0,
        state: 'queued',
        error: null,
      }),
    );
    this.uploads.update((u) => [...u, ...items]);
    // Not marked touched here: the "wait for the uploads" message is only
    // for someone who presses Save mid-upload, not while they're watching.
    this.pump();
  }

  retry(id: number): void {
    this.patch(id, { state: 'queued', error: null, percent: 0 });
    this.pump();
  }

  /** Cancels a waiting/running upload, or dismisses a failed one. */
  cancel(id: number): void {
    this.running.get(id)?.unsubscribe();
    this.running.delete(id);
    const item = this.uploads().find((u) => u.id === id);
    if (item) revoke(item.preview);
    this.uploads.update((u) => u.filter((x) => x.id !== id));
    this.pump();
  }

  private canUpload(): boolean {
    return this.uploadsEnabled() && !this.disabled();
  }

  /** Starts queued uploads while fewer than MAX_PARALLEL_UPLOADS are running. */
  private pump(): void {
    // Re-reads the list every time: start() can finish/fail synchronously
    // and pump again itself.
    let next: UploadItem | undefined;
    while (this.running.size < MAX_PARALLEL_UPLOADS && (next = this.uploads().find((u) => u.state === 'queued'))) {
      this.start(next);
    }
    this.onValidatorChange();
  }

  private start(item: UploadItem): void {
    this.patch(item.id, { state: 'uploading', percent: 0 });
    const sub = this.uploader.upload(item.file).subscribe({
      next: (e) => {
        if (e.kind === 'progress') this.patch(item.id, { percent: e.percent });
        else this.finish(item.id, e.url);
      },
      error: (err: unknown) => {
        this.running.delete(item.id);
        const message = err instanceof Error ? err.message : translate('photos.err.failed');
        this.patch(item.id, { state: 'failed', error: message });
        this.pump();
      },
    });
    // A synchronous error/complete may already have cleaned up.
    if (!sub.closed) this.running.set(item.id, sub);
  }

  private finish(id: number, url: string): void {
    this.running.delete(id);
    const item = this.uploads().find((u) => u.id === id);
    if (item) revoke(item.preview);
    this.uploads.update((u) => u.filter((x) => x.id !== id));
    if (!this.images().some((i) => i.image === url)) this.append(url);
    this.pump();
  }

  private patch(id: number, changes: Partial<UploadItem>): void {
    this.uploads.update((u) => u.map((x) => (x.id === id ? { ...x, ...changes } : x)));
  }

  private append(url: string): void {
    this.commit([...this.images(), { image: url, is_cover: this.images().length === 0 }]);
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

/** A thumbnail is only a nicety: any failure just shows the placeholder icon. */
function preview(file: File): string {
  try {
    return URL.createObjectURL(file);
  } catch {
    return '';
  }
}

function revoke(url: string): void {
  try {
    if (url) URL.revokeObjectURL(url);
  } catch {
    // nothing to free
  }
}
