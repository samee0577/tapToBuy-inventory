import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  buildImageTransform,
  imageUrlForSize,
  withImageTransform,
} from '@inventory/shared';

import { signUploadParams } from '../../src/modules/uploads/cloudinary.service.js';

describe('Cloudinary upload signature', () => {
  /**
   * Independent reimplementation of the documented algorithm, used to cross-check
   * the production function. If both agree on a deliberately awkward parameter
   * set, the implementation is very unlikely to be wrong in a way that would only
   * show up against the live API.
   */
  function referenceSignature(params: Record<string, string | number>, secret: string): string {
    const excluded = new Set(['file', 'api_key', 'resource_type', 'cloud_name', 'signature']);
    const serialised = Object.keys(params)
      .filter((key) => !excluded.has(key))
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');
    return createHash('sha1').update(serialised + secret).digest('hex');
  }

  it('matches an independent implementation of the documented algorithm', () => {
    const params = {
      timestamp: 1_700_000_000,
      folder: 'products',
      public_id: 'products/2f1c9a44-0b6e-4a1f-9d33-1c2b3a4d5e6f',
      allowed_formats: 'jpg,jpeg,png,webp',
    };

    expect(signUploadParams(params, 'test-secret')).toBe(
      referenceSignature(params, 'test-secret'),
    );
  });

  it('is stable regardless of the order the parameters are supplied in', () => {
    const ordered = {
      timestamp: 1_700_000_000,
      folder: 'products',
      public_id: 'products/abc',
      allowed_formats: 'jpg,png',
    };
    const shuffled = {
      allowed_formats: 'jpg,png',
      public_id: 'products/abc',
      folder: 'products',
      timestamp: 1_700_000_000,
    };

    expect(signUploadParams(ordered, 'secret')).toBe(signUploadParams(shuffled, 'secret'));
  });

  it('excludes parameters Cloudinary does not include in the signature', () => {
    const withoutExtras = { timestamp: 1, folder: 'products', public_id: 'products/abc' };
    const withExtras = {
      ...withoutExtras,
      // A browser cannot smuggle these past the signature check.
      api_key: 'attacker-key',
      resource_type: 'raw',
      cloud_name: 'attacker-cloud',
      signature: 'attacker-signature',
    };

    expect(signUploadParams(withExtras, 'secret')).toBe(
      signUploadParams(withoutExtras, 'secret'),
    );
  });

  it('changes completely when any signed parameter changes', () => {
    const base = { timestamp: 1_700_000_000, folder: 'products', public_id: 'products/abc' };
    const original = signUploadParams(base, 'secret');

    expect(signUploadParams({ ...base, public_id: 'products/xyz' }, 'secret')).not.toBe(original);
    expect(signUploadParams({ ...base, folder: 'hacked' }, 'secret')).not.toBe(original);
    expect(signUploadParams({ ...base, timestamp: 1_700_000_001 }, 'secret')).not.toBe(original);
  });

  it('changes when the secret changes', () => {
    const params = { timestamp: 1, folder: 'products', public_id: 'products/abc' };

    expect(signUploadParams(params, 'secret-a')).not.toBe(signUploadParams(params, 'secret-b'));
  });

  it('produces a 40-character lowercase hex digest', () => {
    const signature = signUploadParams({ timestamp: 1 }, 'secret');

    expect(signature).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('image transformation URLs', () => {
  const baseUrl =
    'https://res.cloudinary.com/demo/image/upload/v1699999999/products/2f1c9a44-0b6e-4a1f-9d33-1c2b3a4d5e6f';

  it('inserts the transformation between /upload/ and the version', () => {
    const result = withImageTransform(baseUrl, { width: 200, height: 200, crop: 'fill' });

    expect(result).toBe(
      'https://res.cloudinary.com/demo/image/upload/w_200,h_200,c_fill/v1699999999/products/2f1c9a44-0b6e-4a1f-9d33-1c2b3a4d5e6f',
    );
  });

  it('builds the segment in the order Cloudinary documents', () => {
    expect(
      buildImageTransform({
        width: 96,
        height: 96,
        crop: 'fill',
        gravity: 'auto',
        quality: 'auto',
        format: 'auto',
      }),
    ).toBe('w_96,h_96,c_fill,g_auto,q_auto,f_auto');
  });

  it('rounds fractional dimensions to whole pixels', () => {
    expect(buildImageTransform({ width: 200.6 })).toBe('w_201');
  });

  it('is a no-op when there is nothing to transform', () => {
    expect(withImageTransform(baseUrl, {})).toBe(baseUrl);
  });

  it('does not apply the same transformation twice', () => {
    const once = withImageTransform(baseUrl, { width: 200, crop: 'fill' });

    expect(withImageTransform(once, { width: 200, crop: 'fill' })).toBe(once);
  });

  it('returns a non-Cloudinary URL untouched rather than corrupting it', () => {
    const legacy = 'https://example.com/products/photo.jpg';

    expect(withImageTransform(legacy, { width: 200 })).toBe(legacy);
  });

  it('serves each screen a differently sized variant from one stored URL', () => {
    const thumbnail = imageUrlForSize(baseUrl, 'THUMBNAIL');
    const card = imageUrlForSize(baseUrl, 'CARD');
    const detail = imageUrlForSize(baseUrl, 'DETAIL');

    expect(thumbnail).toContain('w_96,h_96');
    expect(card).toContain('w_200,h_200');
    expect(detail).toContain('w_800,h_800');

    // All three request automatic format, so a modern phone gets WebP or AVIF.
    expect(thumbnail).toContain('f_auto');
    expect(card).toContain('q_auto');

    // The original is never a candidate, so no screen pulls the full-size file.
    for (const variant of [thumbnail, card, detail]) {
      expect(variant).not.toBe(baseUrl);
    }
  });
});
