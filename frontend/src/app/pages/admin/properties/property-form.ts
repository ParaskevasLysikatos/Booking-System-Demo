import { HttpErrorResponse } from '@angular/common/http';
import { Component, HostListener, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AdminPropertiesService, PropertyImageInput, PropertyWrite } from '../../../core/admin/admin-properties.service';
import { HasUnsavedChanges } from '../../../core/unsaved-changes.guard';
import { AmenitiesPickerComponent } from './amenities-picker';
import { ImagesEditorComponent } from './images-editor';

type LoadStatus = 'loading' | 'ready' | 'notFound' | 'error';

/** API field -> form control. */
const FIELD_MAP: Record<string, string> = {
  title: 'title',
  location: 'location',
  description: 'description',
  price_per_night: 'price',
  capacity: 'capacity',
  amenities: 'amenities',
  images: 'images',
  is_active: 'isActive',
};

/** All the strings inside a DRF error value, however nested (e.g. images: [{image: ["Enter a valid URL."]}, {}]). */
export function flattenMessages(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(flattenMessages);
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap(flattenMessages);
  return [String(value)];
}

/**
 * /admin/properties/new and /admin/properties/:id/edit (TICKET-024).
 * One form for both; save = POST (new) or PATCH (edit, sending the full
 * image list, which replaces the set on the backend).
 */
@Component({
  selector: 'app-property-form',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    AmenitiesPickerComponent,
    ImagesEditorComponent,
  ],
  templateUrl: './property-form.html',
  styleUrl: './property-form.scss',
})
export class PropertyFormPage implements HasUnsavedChanges {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(AdminPropertiesService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly titleService = inject(Title);

  /** null = creating a new property. */
  readonly id: number | null = (() => {
    const raw = this.route.snapshot.paramMap.get('id');
    return raw === null ? null : Number(raw);
  })();

  readonly status = signal<LoadStatus>(this.id === null ? 'ready' : 'loading');
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly originalTitle = signal('');

  private readonly fb = inject(FormBuilder);
  readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(200)]],
    location: ['', [Validators.required, Validators.maxLength(255)]],
    description: [''],
    price: this.fb.control<number | null>(null, [Validators.required, Validators.min(0.01), Validators.max(999999.99)]),
    capacity: this.fb.control<number | null>(null, [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)]),
    isActive: [true],
    amenities: this.fb.nonNullable.control<string[]>([]),
    images: this.fb.nonNullable.control<PropertyImageInput[]>([]),
  });

  constructor() {
    this.titleService.setTitle(`${this.id === null ? 'New property' : 'Edit property'} · Admin · Booking System Demo`);
    if (this.id !== null) this.load(this.id);
  }

  load(id: number): void {
    if (!Number.isInteger(id) || id <= 0) {
      this.status.set('notFound');
      return;
    }
    this.status.set('loading');
    this.api.get(id).subscribe({
      next: (p) => {
        this.form.reset({
          title: p.title,
          location: p.location,
          description: p.description,
          price: Number(p.price_per_night),
          capacity: p.capacity,
          isActive: p.is_active,
          amenities: p.amenities,
          images: p.images.map((i) => ({ image: i.image, is_cover: i.is_cover })),
        });
        this.originalTitle.set(p.title);
        this.titleService.setTitle(`Edit ${p.title} · Admin · Booking System Demo`);
        this.status.set('ready');
      },
      error: (err) => this.status.set(err instanceof HttpErrorResponse && err.status === 404 ? 'notFound' : 'error'),
    });
  }

  retry(): void {
    if (this.id !== null) this.load(this.id);
  }

  hasUnsavedChanges(): boolean {
    return this.form.dirty && !this.saving();
  }

  /** Closing/reloading the tab with unsaved edits -> the browser's own "Leave site?" prompt. */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  body(): PropertyWrite {
    const v = this.form.getRawValue();
    return {
      title: v.title.trim(),
      location: v.location.trim(),
      description: v.description.trim(),
      price_per_night: Number(v.price).toFixed(2),
      capacity: Number(v.capacity),
      amenities: v.amenities,
      is_active: v.isActive,
      images: v.images,
    };
  }

  save(): void {
    if (this.saving()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.error.set('Please fix the highlighted fields.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    const body = this.body();
    const request = this.id === null ? this.api.create(body) : this.api.update(this.id, body);
    request.subscribe({
      next: (p) => {
        this.saving.set(false);
        this.form.markAsPristine(); // nothing unsaved any more -> the guard lets us leave
        this.snackBar.open(`Saved "${p.title}".`, 'OK', { duration: 4000 });
        void this.router.navigate(['/admin/properties']);
      },
      error: (err) => {
        this.saving.set(false);
        this.applyServerErrors(err);
      },
    });
  }

  controlError(name: keyof typeof this.form.controls): string | null {
    const c = this.form.controls[name];
    if (!c.touched || !c.errors) return null;
    if (c.errors['server']) return c.errors['server'];
    if (c.errors['required']) return 'Required.';
    if (c.errors['min']) return name === 'price' ? 'Must be more than €0.' : 'Must be at least 1.';
    if (c.errors['max']) return 'Too large.';
    if (c.errors['maxlength']) return `At most ${c.errors['maxlength'].requiredLength} characters.`;
    if (c.errors['pattern']) return 'Whole number only.';
    return 'Invalid value.';
  }

  private applyServerErrors(err: unknown): void {
    if (!(err instanceof HttpErrorResponse) || err.status !== 400 || typeof err.error !== 'object' || !err.error) {
      this.error.set(
        err instanceof HttpErrorResponse && err.status === 0
          ? "Can't reach the server. Your changes are still here - try again."
          : 'Saving failed. Please try again.',
      );
      return;
    }
    const general: string[] = [];
    for (const [field, value] of Object.entries(err.error as Record<string, unknown>)) {
      const messages = flattenMessages(value).join(' ');
      const control = this.form.get(FIELD_MAP[field] ?? '');
      if (control) {
        control.setErrors({ server: messages });
        control.markAsTouched();
      } else {
        general.push(messages);
      }
    }
    this.error.set(general.length ? general.join(' ') : 'Please fix the highlighted fields.');
  }
}
