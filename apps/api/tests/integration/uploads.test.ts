import { UserRole } from '@prisma/client';
import { afterAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { ApiErrorCode, IMAGE_PUBLIC_ID_PATTERN } from '@inventory/shared';

import { prisma } from '../../src/lib/prisma.js';
import {
  api,
  authCookie,
  createTestUser,
  deleteTestUsers,
  type TestUser,
} from './helpers.js';

const created: TestUser[] = [];
const emails: string[] = [];

async function makeUser(options?: Parameters<typeof createTestUser>[0]): Promise<TestUser> {
  const user = await createTestUser(options);
  created.push(user);
  emails.push(user.email);
  onTestFinished(async () => {
    await prisma.user.deleteMany({ where: { id: user.id } });
  });
  return user;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created.map((user) => user.id) } } });
  await deleteTestUsers(emails);
});

const PNG = {
  fileName: 'shirt.png',
  contentType: 'image/png',
  sizeBytes: 250_000,
};

async function presign(
  user: TestUser,
  body: Record<string, unknown> = PNG,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await api()
    .post('/api/uploads/presign')
    .set(await authCookie(user))
    .send(body);

  return { status: response.status, body: response.body };
}

describe('POST /api/uploads/presign', () => {
  it('requires authentication', async () => {
    const response = await api().post('/api/uploads/presign').send(PNG).expect(401);

    expect(response.body.error.code).toBe(ApiErrorCode.UNAUTHORIZED);
  });

  it('lets STAFF request an upload, since both roles manage products', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });
    const result = await presign(staff);

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
  });

  it('returns a complete signed parameter set pointed at Cloudinary', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });
    const result = await presign(staff);

    const ticket = result.body.data as {
      uploadUrl: string;
      publicId: string;
      fields: Record<string, string>;
      uploadToken: string;
      maxBytes: number;
    };

    expect(ticket.uploadUrl).toContain('https://api.cloudinary.com/v1_1/');
    expect(ticket.uploadUrl).toContain('/image/upload');

    // The public_id must be unguessable and match what the product schema accepts.
    expect(ticket.publicId).toMatch(IMAGE_PUBLIC_ID_PATTERN);

    // Everything Cloudinary needs to verify the upload, and the signature itself.
    expect(ticket.fields).toHaveProperty('timestamp');
    expect(ticket.fields).toHaveProperty('signature');
    expect(ticket.fields).toHaveProperty('api_key');
    expect(ticket.fields).toHaveProperty('folder');
    expect(ticket.fields).toHaveProperty('public_id');
    expect(ticket.fields).toHaveProperty('allowed_formats');

    // The secret must never be present in anything sent to the browser.
    expect(JSON.stringify(result.body)).not.toMatch(/CLOUDINARY_API_SECRET|api_secret/i);

    expect(typeof ticket.uploadToken).toBe('string');
    expect(ticket.maxBytes).toBeGreaterThan(0);
  });

  it('bakes the allowed formats into the signature so they cannot be widened', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });
    const result = await presign(staff);

    const ticket = result.body.data as { fields: Record<string, string> };
    expect(ticket.fields.allowed_formats).toBe('jpg,jpeg,png,webp');
  });

  it('issues a different public_id every time', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });

    const first = await presign(staff);
    const second = await presign(staff);

    expect((first.body.data as { publicId: string }).publicId).not.toBe(
      (second.body.data as { publicId: string }).publicId,
    );
  });

  it('rejects a HEIC photo with a message the user can act on', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });
    const result = await presign(staff, {
      fileName: 'IMG_1234.HEIC',
      contentType: 'image/heic',
      sizeBytes: 2_000_000,
    });

    expect(result.status).toBe(400);
    expect((result.body.error as { code: string }).code).toBe(ApiErrorCode.UPLOAD_REJECTED);
    expect((result.body.error as { message: string }).message).toMatch(/HEIC|JPEG/);
  });

  it('rejects an unsupported content type', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });

    const result = await presign(staff, {
      fileName: 'notes.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100_000,
    });

    expect(result.status).toBe(400);
    expect((result.body.error as { code: string }).code).toBe(ApiErrorCode.UPLOAD_REJECTED);
  });

  it('rejects a file over the size limit', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });

    const result = await presign(staff, { ...PNG, sizeBytes: 500_000_000 });

    expect(result.status).toBe(400);
    expect((result.body.error as { message: string }).message).toMatch(/MB/);
  });

  it('rejects a malformed request', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });

    const result = await presign(staff, { fileName: '', contentType: '', sizeBytes: -5 });

    expect(result.status).toBe(400);
    expect((result.body.error as { code: string }).code).toBe(ApiErrorCode.VALIDATION_ERROR);
  });
});

describe('POST /api/uploads/complete', () => {
  /** Stubs the Cloudinary admin API so no network call is made. */
  function stubCloudinary(
    metadata: Record<string, unknown> | null,
    status = 200,
  ): { calls: string[]; restore: () => void } {
    const calls: string[] = [];
    const original = globalThis.fetch;

    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);

      return new Response(JSON.stringify(metadata ?? {}), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    return {
      calls,
      restore: () => {
        globalThis.fetch = original;
      },
    };
  }

  async function ticketFor(user: TestUser): Promise<{
    publicId: string;
    uploadToken: string;
  }> {
    const result = await presign(user);
    const data = result.body.data as { publicId: string; uploadToken: string };
    return { publicId: data.publicId, uploadToken: data.uploadToken };
  }

  it('requires authentication', async () => {
    const response = await api()
      .post('/api/uploads/complete')
      .send({ publicId: 'products/x', uploadToken: 'y' })
      .expect(401);

    expect(response.body.error.code).toBe(ApiErrorCode.UNAUTHORIZED);
  });

  it('returns metadata read back from Cloudinary, not the browser claim', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });
    const ticket = await ticketFor(staff);

    const publicId = ticket.publicId;
    const stub = stubCloudinary({
      resources: [
        {
          public_id: publicId,
          secure_url: `https://res.cloudinary.com/demo/image/upload/v1/${publicId}`,
          format: 'png',
          bytes: 250_000,
          width: 1200,
          height: 1600,
          resource_type: 'image',
        },
      ],
    });

    try {
      const response = await api()
        .post('/api/uploads/complete')
        .set(await authCookie(staff))
        .send({ publicId, uploadToken: ticket.uploadToken })
        .expect(200);

      expect(response.body.data).toMatchObject({
        imageKey: publicId,
        width: 1200,
        height: 1600,
        format: 'png',
      });
      expect(response.body.data.imageUrl).toContain('res.cloudinary.com');
    } finally {
      stub.restore();
    }
  });

  it('rejects an upload grant that belongs to a different public_id', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });
    const ticket = await ticketFor(staff);
    const stub = stubCloudinary({});

    try {
      const response = await api()
        .post('/api/uploads/complete')
        .set(await authCookie(staff))
        .send({
          publicId: 'products/00000000-0000-4000-8000-000000000000',
          uploadToken: ticket.uploadToken,
        })
        .expect(400);

      expect(response.body.error.code).toBe(ApiErrorCode.UPLOAD_REJECTED);
      // The metadata endpoint was never reached, because the grant check came first.
      expect(stub.calls).toHaveLength(0);
    } finally {
      stub.restore();
    }
  });

  it('rejects a forged upload grant', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });
    const ticket = await ticketFor(staff);
    const stub = stubCloudinary({});

    try {
      await api()
        .post('/api/uploads/complete')
        .set(await authCookie(staff))
        .send({ publicId: ticket.publicId, uploadToken: 'not.a.real.token' })
        .expect(400);

      expect(stub.calls).toHaveLength(0);
    } finally {
      stub.restore();
    }
  });

  it('rejects an upload grant issued to a different user', async () => {
    const first = await makeUser({ role: UserRole.STAFF });
    const second = await makeUser({ role: UserRole.STAFF });
    const ticket = await ticketFor(first);
    const stub = stubCloudinary({});

    try {
      await api()
        .post('/api/uploads/complete')
        .set(await authCookie(second))
        .send({ publicId: ticket.publicId, uploadToken: ticket.uploadToken })
        .expect(400);

      expect(stub.calls).toHaveLength(0);
    } finally {
      stub.restore();
    }
  });

  it('rejects an image whose stored dimensions are too small', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });
    const ticket = await ticketFor(staff);
    const stub = stubCloudinary({
      resources: [
        {
          public_id: ticket.publicId,
          secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/x',
          format: 'png',
          bytes: 5_000,
          width: 50,
          height: 40,
        },
      ],
    });

    try {
      const response = await api()
        .post('/api/uploads/complete')
        .set(await authCookie(staff))
        .send({ publicId: ticket.publicId, uploadToken: ticket.uploadToken })
        .expect(400);

      expect(response.body.error.message).toMatch(/too small/i);
      // A rejected asset is destroyed, not left behind consuming storage.
      expect(stub.calls.some((url) => url.includes('/resources/image/'))).toBe(true);
    } finally {
      stub.restore();
    }
  });

  it('rejects an image whose stored format is not allowed', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });
    const ticket = await ticketFor(staff);
    const stub = stubCloudinary({
      resources: [
        {
          public_id: ticket.publicId,
          secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/x',
          // A GIF uploaded by bypassing the client-side extension check.
          format: 'gif',
          bytes: 50_000,
          width: 800,
          height: 800,
        },
      ],
    });

    try {
      const response = await api()
        .post('/api/uploads/complete')
        .set(await authCookie(staff))
        .send({ publicId: ticket.publicId, uploadToken: ticket.uploadToken })
        .expect(400);

      expect(response.body.error.message).toMatch(/format/i);
    } finally {
      stub.restore();
    }
  });

  it('rejects an image whose stored size exceeds the limit', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });
    const ticket = await ticketFor(staff);
    const stub = stubCloudinary({
      resources: [
        {
          public_id: ticket.publicId,
          secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/x',
          format: 'png',
          bytes: 40_000_000,
          width: 800,
          height: 800,
        },
      ],
    });

    try {
      const response = await api()
        .post('/api/uploads/complete')
        .set(await authCookie(staff))
        .send({ publicId: ticket.publicId, uploadToken: ticket.uploadToken })
        .expect(400);

      expect(response.body.error.message).toMatch(/larger/i);
    } finally {
      stub.restore();
    }
  });

  it('rejects a prefix match rather than validating the wrong asset', async () => {
    // Cloudinary's public_id filter behaves like a prefix match. Asking about
    // products/<uuid> must not be satisfied by a longer id that starts with it,
    // or the wrong image's dimensions would be trusted.
    const staff = await makeUser({ role: UserRole.STAFF });
    const ticket = await ticketFor(staff);
    const stub = stubCloudinary({
      resources: [
        {
          public_id: `${ticket.publicId}-decoy`,
          secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/decoy',
          format: 'png',
          bytes: 250_000,
          width: 1200,
          height: 1600,
        },
      ],
    });

    try {
      const response = await api()
        .post('/api/uploads/complete')
        .set(await authCookie(staff))
        .send({ publicId: ticket.publicId, uploadToken: ticket.uploadToken })
        .expect(400);

      expect(response.body.error.code).toBe(ApiErrorCode.UPLOAD_REJECTED);
    } finally {
      stub.restore();
    }
  });

  it('reports a clear error when the asset does not exist', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });
    const ticket = await ticketFor(staff);
    const stub = stubCloudinary({ error: { message: 'not found' } }, 404);

    try {
      const response = await api()
        .post('/api/uploads/complete')
        .set(await authCookie(staff))
        .send({ publicId: ticket.publicId, uploadToken: ticket.uploadToken })
        .expect(400);

      expect(response.body.error.code).toBe(ApiErrorCode.UPLOAD_REJECTED);
    } finally {
      stub.restore();
    }
  });

  it('has no delete route, so an asset cannot be removed by id', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });

    await api()
      .delete('/api/uploads/products/anything')
      .set(await authCookie(staff))
      .expect(404);
  });
});
