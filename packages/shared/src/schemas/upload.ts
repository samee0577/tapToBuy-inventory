import { z } from 'zod';

/**
 * Formats a product photo may be uploaded in.
 *
 * HEIC is deliberately absent. An iPhone uploads HEIC from the camera roll by
 * default, and Cloudinary's HEIC handling varies by plan, so accepting it here
 * risks an upload that works in development and fails in production. The frontend
 * detects the extension and asks for a JPEG instead of failing at upload time.
 */
export const ACCEPTED_IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp'] as const;

export type AcceptedImageFormat = (typeof ACCEPTED_IMAGE_FORMATS)[number];

export const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** Extensions that mean "this is a photo an iPhone produced". */
export const REJECTED_MOBILE_EXTENSIONS = ['heic', 'heif'] as const;

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const;

export const presignUploadSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1, 'File name is required')
    .max(180, 'File name is too long'),
  contentType: z.string().trim().min(1, 'File type is required').max(120),
  sizeBytes: z
    .number()
    .int('File size must be a whole number of bytes')
    .positive('File size must be greater than zero'),
});

export type PresignUploadInput = z.infer<typeof presignUploadSchema>;

export const completeUploadSchema = z.object({
  publicId: z.string().trim().min(1, 'publicId is required').max(200),
  /**
   * Issued alongside the upload ticket. Proves the caller completed an upload
   * this API authorised, rather than pointing at any asset in the account.
   */
  uploadToken: z.string().trim().min(1, 'uploadToken is required').max(2000),
});

export type CompleteUploadInput = z.infer<typeof completeUploadSchema>;

export function fileExtensionOf(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match?.[1]?.toLowerCase() ?? '';
}

export function isAcceptedImageExtension(extension: string): boolean {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(extension.toLowerCase());
}

export function isRejectedMobileImageExtension(extension: string): boolean {
  return (REJECTED_MOBILE_EXTENSIONS as readonly string[]).includes(extension.toLowerCase());
}

export function isAcceptedImageMimeType(contentType: string): boolean {
  return (ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(
    contentType.trim().toLowerCase(),
  );
}
