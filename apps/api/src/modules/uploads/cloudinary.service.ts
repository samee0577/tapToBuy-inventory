import { createHash } from 'node:crypto';

import { ApiErrorCode } from '@inventory/shared';

import { cloudinaryEnv, type CloudinaryEnv } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

const UPLOAD_ENDPOINT = (cloudName: string) =>
  `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;

const ADMIN_RESOURCES_ENDPOINT = (cloudName: string) =>
  `https://api.cloudinary.com/v1_1/${cloudName}/resources/image`;

const ADMIN_UPLOAD_ENDPOINT = (cloudName: string) =>
  `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload`;

/**
 * Parameters Cloudinary excludes from the signature. `file` is the payload
 * itself; the others identify the endpoint rather than describe the upload.
 */
const UNSIGNED_PARAMS = new Set(['file', 'api_key', 'resource_type', 'cloud_name', 'signature']);

export interface UploadSignatureParams {
  timestamp: number;
  folder: string;
  public_id: string;
  allowed_formats: string;
}

/**
 * Builds the upload signature.
 *
 * Cloudinary's algorithm: take the parameter set, drop the excluded keys, sort
 * what remains alphabetically, join as `key=value` pairs with `&`, append the API
 * secret, then SHA1 the result. Implemented here rather than pulled from the
 * official SDK because the whole surface is this one function, and it keeps a
 * large dependency out of the serverless bundle. `tests/unit/cloudinary.test.ts`
 * pins it against a hand-computed vector.
 */
export function signUploadParams(
  params: Record<string, string | number>,
  apiSecret: string,
): string {
  const signable = Object.entries(params)
    .filter(([key]) => !UNSIGNED_PARAMS.has(key))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&');

  return createHash('sha1').update(`${signable}${apiSecret}`).digest('hex');
}

export function uploadEndpoint(cloudName: string): string {
  return UPLOAD_ENDPOINT(cloudName);
}

/**
 * Metadata as Cloudinary actually stored it. Nothing here comes from the browser.
 */
export interface CloudinaryAssetMetadata {
  publicId: string;
  secureUrl: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
}

function adminAuthHeader(env: CloudinaryEnv): string {
  const encoded = Buffer.from(`${env.CLOUDINARY_API_KEY}:${env.CLOUDINARY_API_SECRET}`).toString(
    'base64',
  );
  return `Basic ${encoded}`;
}

/**
 * Re-reads the uploaded asset from Cloudinary's admin API.
 *
 * This is the step that makes the upload trustworthy. Everything the browser said
 * about the file — type, size, dimensions — is a claim. These are the values
 * Cloudinary recorded after actually decoding the image.
 */
export async function fetchAssetMetadata(publicId: string): Promise<CloudinaryAssetMetadata> {
  const env = cloudinaryEnv();

  let response: Response;
  try {
    // The public_id is passed as a query parameter rather than a path segment.
    // The path form of this endpoint is /resources/{type}/{type}/{public_id}, so a
    // public_id containing a slash (which ours always does) is parsed as an extra
    // type segment and rejected with "Invalid value <folder> for parameter type".
    // The query form has no such ambiguity. Verified against the live API by
    // scripts/verify-cloudinary.ts.
    const url = `${ADMIN_RESOURCES_ENDPOINT(env.CLOUDINARY_CLOUD_NAME)}?public_id=${encodeURIComponent(publicId)}`;

    response = await fetch(url, {
      headers: { Authorization: adminAuthHeader(env) },
    });
  } catch {
    throw new AppError(
      ApiErrorCode.UPLOAD_REJECTED,
      'Could not reach the image service. Please try the upload again.',
      502,
    );
  }

  if (response.status === 404) {
    throw new AppError(
      ApiErrorCode.UPLOAD_REJECTED,
      'That upload could not be found. Please try again.',
      400,
    );
  }

  if (!response.ok) {
    throw new AppError(
      ApiErrorCode.UPLOAD_REJECTED,
      'Could not verify the uploaded image. Please try again.',
      502,
    );
  }

  const payload = (await response.json()) as {
    resources?: Array<{
      public_id?: string;
      secure_url?: string;
      format?: string;
      bytes?: number;
      width?: number;
      height?: number;
      resource_type?: string;
    }>;
  };

  // The public_id filter behaves like a prefix match, so an exact comparison is
  // required: without it, asking about products/abc could return products/abcdef
  // and validate the wrong asset.
  const asset = payload.resources?.find((entry) => entry.public_id === publicId);

  if (
    !asset ||
    typeof asset.secure_url !== 'string' ||
    typeof asset.format !== 'string' ||
    typeof asset.bytes !== 'number' ||
    typeof asset.width !== 'number' ||
    typeof asset.height !== 'number'
  ) {
    throw new AppError(
      ApiErrorCode.UPLOAD_REJECTED,
      'That upload could not be found. Please try again.',
      400,
    );
  }

  if (asset.resource_type !== undefined && asset.resource_type !== 'image') {
    throw new AppError(ApiErrorCode.UPLOAD_REJECTED, 'That file is not an image.', 400);
  }

  return {
    // The exact-match lookup above guarantees this is the requested id, so the
    // caller's value is used rather than re-reading the optional field.
    publicId,
    secureUrl: asset.secure_url,
    format: asset.format.toLowerCase(),
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
  };
}

/**
 * Removes an asset from Cloudinary.
 *
 * Only ever called from the product service when an image is replaced or
 * removed, never from a public endpoint: an exposed delete-by-id route would let
 * any signed-in user destroy arbitrary assets in the account.
 *
 * Failures are logged rather than thrown. A leftover image is untidy; failing the
 * user's save because a cleanup call errored is worse. The warning matters — an
 * earlier version swallowed the failure completely, which hid a delete URL that
 * silently did nothing.
 */
export async function destroyAsset(publicId: string): Promise<void> {
  const env = cloudinaryEnv();

  // Same reason as fetchAssetMetadata: the query form avoids the ambiguous path
  // segments that a slashed public_id triggers. Cloudinary expects the bracketed
  // `public_ids[]` parameter name here, and answers 200 even when nothing matched,
  // so the response body is what actually confirms the delete.
  const url = `${ADMIN_UPLOAD_ENDPOINT(env.CLOUDINARY_CLOUD_NAME)}?public_ids[]=${encodeURIComponent(publicId)}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: adminAuthHeader(env) },
  }).catch((error: unknown) => {
    logger.warn({ publicId, err: error }, 'could not reach Cloudinary to delete an image');
    return undefined;
  });

  if (!response) return;

  const payload = (await response.json().catch(() => null)) as {
    deleted?: Record<string, string>;
  } | null;

  const outcome = payload?.deleted?.[publicId];

  if (!response.ok || (outcome !== 'deleted' && outcome !== 'not_found')) {
    logger.warn({ publicId, status: response.status, outcome }, 'Cloudinary did not delete an image');
  }
}
