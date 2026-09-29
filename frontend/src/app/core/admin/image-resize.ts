import { Injectable } from '@angular/core';

/** Longest side of an uploaded photo (TICKET-036). 1600 px is sharp on the
 * detail page's gallery and lightbox, and ~200-400 KB as WebP. */
export const MAX_PHOTO_SIDE = 1600;
/** Encoder quality for WebP/JPEG (0-1). */
export const PHOTO_QUALITY = 0.82;

export interface ResizedPhoto {
  blob: Blob;
  /** What the blob actually is: WebP, or JPEG where the browser can't encode WebP. */
  type: 'image/webp' | 'image/jpeg';
  width: number;
  height: number;
}

/** Scales (width, height) down to fit within `max` x `max`, keeping the
 * aspect ratio; never scales up. Always at least 1 x 1. */
export function fitWithin(width: number, height: number, max = MAX_PHOTO_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export class UnreadablePhotoError extends Error {
  constructor() {
    super("Couldn't read this photo. Use a JPEG, PNG or WebP image.");
  }
}

/**
 * Shrinks a photo in the browser before it's uploaded (TICKET-036). Always
 * re-encodes, even small photos: that also drops the camera's EXIF data -
 * including GPS position - which shouldn't end up on a public URL.
 * A separate service so tests (jsdom has no canvas) can swap it out.
 */
@Injectable({ providedIn: 'root' })
export class ImageResizer {
  async resize(file: Blob): Promise<ResizedPhoto> {
    let bitmap: ImageBitmap;
    try {
      // 'from-image' applies the EXIF rotation, so phone photos aren't sideways.
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      throw new UnreadablePhotoError();
    }
    try {
      const { width, height } = fitWithin(bitmap.width, bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new UnreadablePhotoError();
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, width, height);

      const webp = await toBlob(canvas, 'image/webp');
      // Browsers that can't encode WebP silently return PNG instead.
      if (webp?.type === 'image/webp') return { blob: webp, type: 'image/webp', width, height };

      // JPEG has no transparency: put a white background under a PNG's clear parts.
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      const jpeg = await toBlob(canvas, 'image/jpeg');
      if (!jpeg) throw new UnreadablePhotoError();
      return { blob: jpeg, type: 'image/jpeg', width, height };
    } finally {
      bitmap.close();
    }
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, PHOTO_QUALITY));
}
