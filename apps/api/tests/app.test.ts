import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

const app = createApp();

beforeAll(() => {
  // The suites import the real app, so the logger must not spam the output.
  process.env.LOG_LEVEL ??= 'silent';
});

describe('GET /api/health', () => {
  it('returns the success envelope', async () => {
    const response = await request(app).get('/api/health').expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: { status: 'ok', service: 'inventory-api' },
    });
    expect(typeof response.body.data.uptimeSeconds).toBe('number');
  });

  it('exposes a correlation id for log tracing', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('error envelope', () => {
  it('answers an unknown route with the documented 404 shape', async () => {
    const response = await request(app).get('/api/does-not-exist').expect(404);

    expect(response.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'No route matches GET /api/does-not-exist' },
    });
  });

  it('rejects a malformed JSON body without leaking internals', async () => {
    const response = await request(app)
      .post('/api/health')
      .set('content-type', 'application/json')
      .send('{"broken":')
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(response.body)).not.toMatch(/at .*\.ts:\d+/);
  });

  it('never emits a stack trace or driver message', async () => {
    const response = await request(app).get('/api/nope').expect(404);
    const serialised = JSON.stringify(response.body);

    expect(serialised).not.toMatch(/stack/i);
    expect(serialised).not.toMatch(/Prisma|node_modules|postgres/i);
  });
});

describe('CORS', () => {
  it('allows the configured development origin with credentials', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5173')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('refuses an unlisted origin', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'https://attacker.example')
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('allows a request with no Origin, which is the same-origin production case', async () => {
    await request(app).get('/api/health').expect(200);
  });

  it('allows a randomised *.vercel.app origin on a preview deployment', async () => {
    process.env.VERCEL_ENV = 'preview';
    try {
      const response = await request(app)
        .get('/api/health')
        .set('Origin', 'https://taptobuy-inventory-a1b2c3d4.vercel.app')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBe(
        'https://taptobuy-inventory-a1b2c3d4.vercel.app',
      );
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    } finally {
      delete process.env.VERCEL_ENV;
    }
  });

  it('still refuses a *.vercel.app origin on production, where hosts are exact-matched', async () => {
    process.env.VERCEL_ENV = 'production';
    try {
      const response = await request(app)
        .get('/api/health')
        .set('Origin', 'https://taptobuy-inventory-a1b2c3d4.vercel.app')
        .expect(403);

      expect(response.body.error.code).toBe('FORBIDDEN');
    } finally {
      delete process.env.VERCEL_ENV;
    }
  });

  it('does not let a host that merely mentions vercel.app pass the suffix check', async () => {
    process.env.VERCEL_ENV = 'preview';
    try {
      await request(app)
        .get('/api/health')
        .set('Origin', 'https://vercel.app.attacker.example')
        .expect(403);
    } finally {
      delete process.env.VERCEL_ENV;
    }
  });
});

describe('security headers', () => {
  it('sets the headers that stop clickjacking and MIME sniffing', async () => {
    const response = await request(app).get('/api/health').expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['strict-transport-security']).toContain('max-age=');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
