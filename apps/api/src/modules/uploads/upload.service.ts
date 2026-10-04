import { randomUUID } from 'node:crypto';

import {
  ACCEPTED_IMAGE_MIME_TYPES,
  ApiErrorCode,
  IMAGE_PUBLIC_ID_PATTERN,
  fileExtensionOf,
  isAcceptedImageExtension,
  isAcceptedImageMimeType,
  isRejectedMobileImageExtension,
  type CloudinaryUploadTicketDto,
  type PresignUploadInput,
  type VerifiedImageDto,
} from '@inventory/shared';

import { cloudinaryEnv } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { issueUploadGrant, UPLOAD_GRANT_TTL_SECONDS, verifyUploadGrant } from '../../lib/upload-grant.js';
import {
  destroyAsset,
  fetchAssetMetadata,
  signUploadParams,
  uploadEndpoint,
} from './cloudinary.service.js';

/**
 * Rejects the file before a signature is ever minted.
 *
 * These checks are about giving the user a clear message immediately rather than
 * about security — the authoritative validation happens against the stored asset
 * in `completeUpload`. An attacker can send any content type they like here.
 */
function assertUploadable(input: PresignUploadInput): void {
  const extension = fileExtensionOf(input.fileName);

  if (isRejectedMobileImageExtension(extension)) {
    throw new AppError(
      ApiErrorCode.UPLOAD_REJECTED,
      'HEIC photos are not supported. Please choose a JPEG or PNG version of this photo.',
      400,
    );
  }

  if (!isAcceptedImageMimeType(input.contentType)) {
    throw new AppError(
      ApiErrorCode.UPLOAD_REJECTED,
      'Product photos must be a JPEG, PNG or WebP image.',
      400,
    );
  }

  if (!isAcceptedImageExtension(extension)) {
    throw new AppError(
      ApiErrorCode.UPLOAD_REJECTED,
      'That file type is not supported. Please choose a JPEG, PNG or WebP image.',
      400,
    );
  }

  const { CLOUDINARY_MAX_UPLOAD_BYTES } = cloudinaryEnv();
  if (input.sizeBytes > CLOUDINARY_MAX_UPLOAD_BYTES) {
    const limitMb = Math.round(CLOUDINARY_MAX_UPLOAD_BYTES / (1024 * 1024));
    throw new AppError(
      ApiErrorCode.UPLOAD_REJECTED,
      `That photo is larger than ${limitMb} MB. Please use a smaller image.`,
      400,
    );
  }
}

/**
 * Mints a signed upload ticket. The browser then POSTs the file straight to
 * Cloudinary; the image bytes never pass through this server.
 */
export async function presignUpload(
  input: PresignUploadInput,
  userId: string,
): Promise<CloudinaryUploadTicketDto> {
  const env = cloudinaryEnv();
  assertUploadable(input);

  // A UUID name is what makes the identifier unguessable, and one upload never
  // shares an asset with another.
  //
  // `folder` is sent separately and the public_id is left unprefixed, because
  // Cloudinary prepends the folder itself. Supplying both a `folder` and an
  // already-prefixed public_id yields "products/products/<uuid>", and the asset
  // then cannot be found at the id this ticket advertised.
  const assetName = randomUUID();
  const publicId = `${env.CLOUDINARY_UPLOAD_FOLDER}/${assetName}`;

  if (!IMAGE_PUBLIC_ID_PATTERN.test(publicId)) {
    // Guards against a folder override that would break the pattern the product
    // schema validates on write.
    throw new AppError(
      ApiErrorCode.INTERNAL_ERROR,
      'Upload folder is misconfigured. Please contact an administrator.',
      500,
    );
  }

  const timestamp = Math.floor(Date.now() / 1000);

  const signableParams = {
    timestamp,
    folder: env.CLOUDINARY_UPLOAD_FOLDER,
    public_id: assetName,
    allowed_formats: env.CLOUDINARY_ALLOWED_FORMATS.join(','),
  };

  const signature = signUploadParams(signableParams, env.CLOUDINARY_API_SECRET);

  const fields: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(signableParams).map(([key, value]) => [key, String(value)]),
    ),
    signature,
    api_key: env.CLOUDINARY_API_KEY,
  };

  const uploadToken = await issueUploadGrant({ publicId, userId });

  logger.info({ userId, publicId, bytes: input.sizeBytes }, 'issued an upload ticket');

  return {
    uploadUrl: uploadEndpoint(env.CLOUDINARY_CLOUD_NAME),
    publicId,
    fields,
    uploadToken,
    maxBytes: env.CLOUDINARY_MAX_UPLOAD_BYTES,
    allowedFormats: env.CLOUDINARY_ALLOWED_FORMATS,
    acceptedContentTypes: ACCEPTED_IMAGE_MIME_TYPES,
    expiresInSeconds: UPLOAD_GRANT_TTL_SECONDS,
  };
}

/**
 * Verifies an upload against what Cloudinary actually stored.
 *
 * Three things are checked, in this order:
 *   1. the upload grant proves this API authorised *this* public_id for *this* user
 *   2. the asset's real format, byte size and dimensions, read back from Cloudinary
 *   3. on failure the asset is destroyed, so a rejected upload is not left behind
 *      consuming storage and appearing in the Cloudinary console
 */
export async function completeUpload(
  publicId: string,
  uploadToken: string,
  userId: string,
): Promise<VerifiedImageDto> {
  const grant = await verifyUploadGrant(uploadToken);

  if (!grant || grant.publicId !== publicId || grant.userId !== userId) {
    throw new AppError(
      ApiErrorCode.UPLOAD_REJECTED,
      'This upload could not be verified. Please upload the photo again.',
      400,
    );
  }

  const metadata = await fetchAssetMetadata(publicId);
  const env = cloudinaryEnv();

  const rejection = validateStoredAsset(metadata, env);
  if (rejection !== null) {
    await destroyAsset(publicId);
    logger.warn({ userId, publicId, reason: rejection }, 'rejected an uploaded image');
    throw new AppError(ApiErrorCode.UPLOAD_REJECTED, rejection, 400);
  }

  return {
    imageKey: metadata.publicId,
    imageUrl: metadata.secureUrl,
    width: metadata.width,
    height: metadata.height,
    bytes: metadata.bytes,
    format: metadata.format,
  };
}

/** Returns a rejection message, or null when the asset is acceptable. */
function validateStoredAsset(
  metadata: { publicId: string; format: string; bytes: number; width: number; height: number },
  env: ReturnType<typeof cloudinaryEnv>,
): string | null {
  if (!env.CLOUDINARY_ALLOWED_FORMATS.includes(metadata.format)) {
    return 'That file is not a supported image format.';
  }

  if (metadata.bytes > env.CLOUDINARY_MAX_UPLOAD_BYTES) {
    const limitMb = Math.round(env.CLOUDINARY_MAX_UPLOAD_BYTES / (1024 * 1024));
    return `That photo is larger than ${limitMb} MB. Please use a smaller image.`;
  }

  const shortestSide = Math.min(metadata.width, metadata.height);

  if (shortestSide < env.CLOUDINARY_MIN_DIMENSION) {
    return `That photo is too small. Please use one at least ${env.CLOUDINARY_MIN_DIMENSION}px on its shortest side.`;
  }

  if (
    metadata.width > env.CLOUDINARY_MAX_DIMENSION ||
    metadata.height > env.CLOUDINARY_MAX_DIMENSION
  ) {
    return `That photo is too large. Please use one no bigger than ${env.CLOUDINARY_MAX_DIMENSION}px on its longest side.`;
  }

  return null;
}
