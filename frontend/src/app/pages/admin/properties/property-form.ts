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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AdminPropertiesService, PropertyImageInput, PropertyWrite } from '../../../core/admin/admin-properties.service';
import { HasUnsavedChanges } from '../../../core/unsaved-changes.guard';
import { AmenitiesPickerComponent } from './amenities-picker';
import { ImagesEditorComponent } from './images-editor';
import { LocationPickerComponent, MapPosition } from './location-picker';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { translate } from '../../../core/i18n/translation.service';
import { PageTitle } from '../../../core/i18n/page-title';

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
  latitude: 'position', // TICKET-034 step 7
  longitude: 'position',
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
    LocationPickerComponent,
    TranslatePipe,
  ],
  templateUrl: './property-form.html',
  styleUrl: './property-form.scss',
})
export class PropertyFormPage implements HasUnsavedChanges {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(AdminPropertiesService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly pageTitle = inject(PageTitle);

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
    /** Required map position (TICKET-034 step 7) - set with the map / Find on map. */
    position: this.fb.control<MapPosition>(null, Validators.required),
  });

  constructor() {
    this.pageTitle.setKey(this.id === null ? 'adminForm.pageNew' : 'adminForm.pageEdit');
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
          // Admins get the exact point. An older place may have none yet -
          // then the form asks for one before saving.
          position:
            typeof p.latitude === 'number' && typeof p.longitude === 'number'
              ? { lat: p.latitude, lng: p.longitude }
              : null,
        });
        this.originalTitle.set(p.title);
        this.pageTitle.setKey('adminForm.pageEditTitle', { title: p.title });
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
      // save() only gets here with a valid form, so the position is set.
      latitude: v.position!.lat,
      longitude: v.position!.lng,
    };
  }

  save(): void {
    if (this.saving()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.error.set(translate('adminForm.fixFields'));
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
        this.snackBar.open(translate('adminForm.saved', { title: p.title }), translate('common.ok'), { duration: 4000 });
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
    if (c.errors['uploading']) return translate('adminForm.err.uploading');
    if (c.errors['required']) return translate(name === 'position' ? 'adminForm.err.positionRequired' : 'adminForm.err.required');
    if (c.errors['min']) return translate(name === 'price' ? 'adminForm.err.priceMin' : 'adminForm.err.min');
    if (c.errors['max']) return translate('adminForm.err.max');
    if (c.errors['maxlength']) return translate('adminForm.err.maxlength', { count: c.errors['maxlength'].requiredLength });
    if (c.errors['pattern']) return translate('adminForm.err.pattern');
    return translate('adminForm.err.invalid');
  }

  private applyServerErrors(err: unknown): void {
    if (!(err instanceof HttpErrorResponse) || err.status !== 400 || typeof err.error !== 'object' || !err.error) {
      this.error.set(
        err instanceof HttpErrorResponse && err.status === 0
          ? translate('adminForm.err.offline')
          : translate('adminForm.err.saveFailed'),
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
    this.error.set(general.length ? general.join(' ') : translate('adminForm.fixFields'));
  }
}
