/**
 * On-the-fly image transformation for Cloudinary delivery URLs.
 *
 * Storing the base delivery URL and deriving variants from it means one stored
 * value serves every screen. A product card asks for a 200px thumbnail and the
 * detail page for 800px, so a phone on shop wifi never downloads a 4-megapixel
 * original just to render a list. `f_auto` additionally has Cloudinary serve
 * WebP or AVIF to whichever browser asked.
 *
 * The transformation is inserted between `/upload/` and the version segment,
 * which is where Cloudinary's URL grammar expects it.
 */

export type ImageCrop = 'fill' | 'fit' | 'limit' | 'thumb' | 'scale';
export type ImageGravity = 'auto' | 'face' | 'center';

export interface ImageTransformOptions {
  width?: number;
  height?: number;
  crop?: ImageCrop;
  gravity?: ImageGravity;
  /** `auto` lets Cloudinary pick a sensible quality for the format. */
  quality?: 'auto' | number;
  /** `auto` delivers WebP/AVIF where supported, otherwise the stored format. */
  format?: 'auto' | 'webp' | 'avif' | 'jpg' | 'png';
}

const UPLOAD_SEGMENT = '/upload/';

/** Builds the Cloudinary transformation segment, e.g. `w_200,h_200,c_fill,f_auto`. */
export function buildImageTransform(options: ImageTransformOptions): string {
  const parts: string[] = [];

  if (options.width !== undefined) parts.push(`w_${Math.round(options.width)}`);
  if (options.height !== undefined) parts.push(`h_${Math.round(options.height)}`);
  if (options.crop !== undefined) parts.push(`c_${options.crop}`);
  if (options.gravity !== undefined) parts.push(`g_${options.gravity}`);
  if (options.quality !== undefined) parts.push(`q_${options.quality}`);
  if (options.format !== undefined) parts.push(`f_${options.format}`);

  return parts.join(',');
}

/**
 * Returns `imageUrl` with a transformation applied.
 *
 * Returns the input untouched if it is not a Cloudinary upload URL, so a
 * hand-entered or legacy image value degrades to "shows the original" instead of
 * producing a broken URL.
 */
export function withImageTransform(imageUrl: string, options: ImageTransformOptions): string {
  const transform = buildImageTransform(options);
  if (transform.length === 0) return imageUrl;

  const markerIndex = imageUrl.indexOf(UPLOAD_SEGMENT);
  if (markerIndex === -1) return imageUrl;

  const insertAt = markerIndex + UPLOAD_SEGMENT.length;
  const alreadyPresent = imageUrl.slice(insertAt).startsWith(`${transform}/`);

  if (alreadyPresent) return imageUrl;

  return `${imageUrl.slice(0, insertAt)}${transform}/${imageUrl.slice(insertAt)}`;
}

/** Named sizes used across the app, so screens agree on what "small" means. */
export const ImageSize = {
  /** Dashboard and history rows. */
  THUMBNAIL: { width: 96, height: 96, crop: 'fill', gravity: 'auto' } as const,
  /** Grouped product card in the inventory list. */
  CARD: { width: 200, height: 200, crop: 'fill', gravity: 'auto' } as const,
  /** Product detail header. */
  DETAIL: { width: 800, height: 800, crop: 'limit' } as const,
} as const;

export type ImageSizePreset = keyof typeof ImageSize;

/** Every preset pairs a geometry with automatic format and quality. */
export function imageUrlForSize(
  imageUrl: string,
  preset: ImageSizePreset,
): string {
  const geometry = ImageSize[preset];
  return withImageTransform(imageUrl, { ...geometry, format: 'auto', quality: 'auto' });
}
