import { HttpClient, HttpErrorResponse, HttpEvent, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, defer, filter, from, map, of, shareReplay, switchMap, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { parseApiErrors } from '../api-errors';
import { ImageResizer, UnreadablePhotoError } from './image-resize';
import { translate } from '../i18n/translation.service';

export const UPLOADS_CONFIG_URL = `${environment.apiUrl}/admin/uploads/config/`;
export const UPLOADS_PRESIGN_URL = `${environment.apiUrl}/admin/uploads/presign/`;

/** Photos bigger than this aren't even opened (decoding a huge image can
 * freeze a phone). The resized result is what the server's limit applies to. */
export const MAX_ORIGINAL_BYTES = 40 * 1024 * 1024;

/** GET /api/admin/uploads/config/ (TICKET-036). */
export interface UploadConfig {
  enabled: boolean;
  max_bytes: number;
  content_types: string[];
}

/** POST /api/admin/uploads/presign/ -> a presigned S3 POST for one photo. */
export interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
  key: string;
  public_url: string;
  expires_in: number;
  max_bytes: number;
}

export type UploadProgress =
  | { kind: 'progress'; percent: number }
  | { kind: 'done'; url: string };

const OFF: UploadConfig = { enabled: false, max_bytes: 0, content_types: [] };

/**
 * Uploads a property photo straight to the owner's S3 bucket (TICKET-036):
 * resize in the browser -> ask our API for a presigned POST -> POST the
 * file to S3 with upload progress -> the photo's public URL. The file never
 * goes through our server. The auth interceptor only adds the JWT to our
 * own API, so it's never sent to S3.
 */
@Injectable({ providedIn: 'root' })
export class PhotoUploadService {
  private readonly http = inject(HttpClient);
  private readonly resizer = inject(ImageResizer);

  /** Asked once per page load; any error just means "no uploads" (paste URLs). */
  private readonly config$ = this.http.get<UploadConfig>(UPLOADS_CONFIG_URL).pipe(
    catchError(() => of(OFF)),
    shareReplay(1),
  );

  config(): Observable<UploadConfig> {
    return this.config$;
  }

  upload(file: File): Observable<UploadProgress> {
    if (file.size > MAX_ORIGINAL_BYTES) {
      return throwError(() => new Error(translate('photos.err.tooLargeToProcess')));
    }
    return defer(() => from(this.resizer.resize(file))).pipe(
      switchMap((photo) =>
        this.http
          .post<PresignedUpload>(UPLOADS_PRESIGN_URL, { content_type: photo.type, size: photo.blob.size })
          .pipe(switchMap((signed) => this.sendToS3(signed, photo.blob, file.name))),
      ),
      catchError((err: unknown) => throwError(() => new Error(uploadErrorMessage(err)))),
    );
  }

  private sendToS3(signed: PresignedUpload, blob: Blob, name: string): Observable<UploadProgress> {
    const form = new FormData();
    for (const [k, v] of Object.entries(signed.fields)) form.append(k, v);
    form.append('file', blob, name); // S3 ignores every field after the file, so it goes last
    return this.http
      .post(signed.url, form, { observe: 'events', reportProgress: true, responseType: 'text' })
      .pipe(
        map((event: HttpEvent<string>): UploadProgress | null => {
          if (event.type === HttpEventType.UploadProgress) {
            const total = event.total || blob.size;
            return { kind: 'progress', percent: Math.min(99, Math.round((100 * event.loaded) / total)) };
          }
          if (event.type === HttpEventType.Response) return { kind: 'done', url: signed.public_url };
          return null;
        }),
        filter((e): e is UploadProgress => e !== null),
        catchError((err: unknown) => throwError(() => new S3UploadError(err))),
      );
  }
}

/** A failure answered by S3 itself (not our API). */
export class S3UploadError extends Error {
  constructor(readonly reason: unknown) {
    super('S3 upload failed');
  }
}

/** S3 answers errors as XML: <Error><Code>EntityTooLarge</Code><Message>…</Message></Error>. */
export function s3ErrorCode(body: unknown): string | null {
  if (typeof body !== 'string') return null;
  return /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? null;
}

export function uploadErrorMessage(err: unknown): string {
  if (err instanceof UnreadablePhotoError) return err.message;
  if (err instanceof S3UploadError) {
    const cause = err.reason;
    if (cause instanceof HttpErrorResponse) {
      if (cause.status === 0) {
        return translate('photos.err.storageUnreachable');
      }
      const code = s3ErrorCode(cause.error);
      if (code === 'EntityTooLarge') return translate('photos.err.tooLarge');
      if (code === 'AccessDenied' && /expired/i.test(String(cause.error))) return translate('photos.err.tooSlow');
      if (code === 'AccessDenied') return translate('photos.err.denied');
    }
    return translate('photos.err.refused');
  }
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return translate('photos.err.serverUnreachable');
    if (err.status === 429) return translate('photos.err.tooMany');
    const parsed = parseApiErrors(err);
    // e.g. {"size": ["Photos can be at most 10 MB."]} or {"detail": "Photo uploads are switched off. …"}
    const first = parsed.general ?? Object.values(parsed.fields)[0]?.[0];
    return first ?? translate('photos.err.failedOrPaste');
  }
  return err instanceof Error && err.message ? err.message : translate('photos.err.failed');
}
