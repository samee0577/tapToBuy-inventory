import { UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { ApiErrorCode } from '@inventory/shared';

import { prisma } from '../../src/lib/prisma.js';
import { api, authCookie, createTestUser } from './helpers.js';

async function admin() {
  return createTestUser({ role: UserRole.ADMIN });
}

async function staff() {
  return createTestUser({ role: UserRole.STAFF });
}

function uniqueName(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

describe('POST /api/categories', () => {
  it('requires authentication', async () => {
    await api()
      .post('/api/categories')
      .send({ name: 'Anonymous' })
      .expect(401);
  });

  it('lets STAFF create a category, since both roles manage them (§9)', async () => {
    const user = await staff();
    const name = uniqueName('Staff Category');

    const response = await api()
      .post('/api/categories')
      .set(await authCookie(user))
      .send({ name })
      .expect(201);

    expect(response.body.data).toMatchObject({ name, isActive: true, productCount: 0 });
  });

  it('lets an ADMIN create a category', async () => {
    const user = await admin();

    const response = await api()
      .post('/api/categories')
      .set(await authCookie(user))
      .send({ name: uniqueName('Admin Category'), description: 'Formal shirts' })
      .expect(201);

    expect(response.body.data.description).toBe('Formal shirts');
  });

  it('rejects a duplicate name', async () => {
    const user = await admin();
    const name = uniqueName('Duplicated');

    await api()
      .post('/api/categories')
      .set(await authCookie(user))
      .send({ name })
      .expect(201);

    const response = await api()
      .post('/api/categories')
      .set(await authCookie(user))
      .send({ name })
      .expect(409);

    expect(response.body.error.code).toBe(ApiErrorCode.DUPLICATE_CATEGORY);
  });

  it('validates the payload server-side', async () => {
    const user = await admin();

    const response = await api()
      .post('/api/categories')
      .set(await authCookie(user))
      .send({ name: 'x' })
      .expect(400);

    expect(response.body.error.code).toBe(ApiErrorCode.VALIDATION_ERROR);
  });
});

describe('PATCH /api/categories/:id', () => {
  it('renames a category', async () => {
    const user = await admin();
    const created = await api()
      .post('/api/categories')
      .set(await authCookie(user))
      .send({ name: uniqueName('Before') })
      .expect(201);

    const response = await api()
      .patch(`/api/categories/${created.body.data.id}`)
      .set(await authCookie(user))
      .send({ name: uniqueName('After') })
      .expect(200);

    expect(response.body.data.name).toMatch(/^After-/);
  });

  it('deactivates rather than deletes, and reports the change', async () => {
    const user = await admin();
    const name = uniqueName('Retire Me');
    const created = await api()
      .post('/api/categories')
      .set(await authCookie(user))
      .send({ name })
      .expect(201);

    const response = await api()
      .patch(`/api/categories/${created.body.data.id}`)
      .set(await authCookie(user))
      .send({ isActive: false })
      .expect(200);

    expect(response.body.data.isActive).toBe(false);

    // Hidden from the default listing, still retrievable when asked for. Each suite
    // leaves categories behind, so the lookup is by search term rather than by
    // scanning a page that accumulates across the whole run.
    const active = await api()
      .get('/api/categories')
      .query({ search: name })
      .set(await authCookie(user))
      .expect(200);
    expect(active.body.data.items).toHaveLength(0);

    const all = await api()
      .get('/api/categories')
      .query({ search: name, status: 'all' })
      .set(await authCookie(user))
      .expect(200);
    expect(all.body.data.items.map((item: { id: string }) => item.id)).toContain(
      created.body.data.id,
    );
  });

  it('clears a description when explicitly set to null', async () => {
    const user = await admin();
    const created = await api()
      .post('/api/categories')
      .set(await authCookie(user))
      .send({ name: uniqueName('Described'), description: 'temporary' })
      .expect(201);

    const response = await api()
      .patch(`/api/categories/${created.body.data.id}`)
      .set(await authCookie(user))
      .send({ description: null })
      .expect(200);

    expect(response.body.data.description).toBeNull();
  });

  it('reports 404 for an unknown category', async () => {
    const user = await admin();

    const response = await api()
      .patch('/api/categories/00000000-0000-4000-8000-000000000000')
      .set(await authCookie(user))
      .send({ isActive: false })
      .expect(404);

    expect(response.body.error.code).toBe(ApiErrorCode.NOT_FOUND);
  });

  it('has no delete route, because categories holding products cannot be removed', async () => {
    const user = await admin();
    const created = await api()
      .post('/api/categories')
      .set(await authCookie(user))
      .send({ name: uniqueName('Undeletable') })
      .expect(201);

    await api()
      .delete(`/api/categories/${created.body.data.id}`)
      .set(await authCookie(user))
      .expect(404);

    expect(
      await prisma.category.count({ where: { id: created.body.data.id } }),
    ).toBe(1);
  });
});

describe('GET /api/categories/options', () => {
  it('returns only active categories, and only the fields a dropdown needs', async () => {
    const user = await admin();
    const activeName = uniqueName('Option Active');
    const retiredName = uniqueName('Option Retired');

    await api()
      .post('/api/categories')
      .set(await authCookie(user))
      .send({ name: activeName })
      .expect(201);

    const retired = await api()
      .post('/api/categories')
      .set(await authCookie(user))
      .send({ name: retiredName })
      .expect(201);

    await api()
      .patch(`/api/categories/${retired.body.data.id}`)
      .set(await authCookie(user))
      .send({ isActive: false })
      .expect(200);

    const response = await api()
      .get('/api/categories/options')
      .set(await authCookie(user))
      .expect(200);

    const names = (response.body.data as Array<{ name: string }>).map((entry) => entry.name);
    expect(names).toContain(activeName);
    expect(names).not.toContain(retiredName);

    // No counts, descriptions or timestamps: this feeds a filter drawer.
    for (const option of response.body.data) {
      expect(Object.keys(option).sort()).toEqual(['id', 'name']);
    }
  });
});

describe('GET /api/categories', () => {
  it('reports the number of products attached to each category', async () => {
    const user = await admin();
    const categoryName = uniqueName('Counted');
    const category = await prisma.category.create({
      data: { name: categoryName },
      select: { id: true },
    });

    const product = await api()
      .post('/api/products')
      .set(await authCookie(user))
      .send({
        name: uniqueName('Counted Product'),
        productCode: uniqueName('CNT'),
        categoryId: category.id,
        variants: [
          {
            size: 'M',
            color: 'Black',
            buyingPrice: '400.00',
            sellingPrice: '699.00',
            initialStock: 4,
          },
        ],
      })
      .expect(201);

    const response = await api()
      .get('/api/categories')
      // Searched rather than paged: every suite leaves categories behind, so a
      // 100-item page no longer reliably contains the one under test.
      .query({ search: categoryName, status: 'all' })
      .set(await authCookie(user))
      .expect(200);

    const found = (response.body.data.items as Array<{ id: string; productCount: number }>).find(
      (item) => item.id === category.id,
    );

    expect(found?.productCount).toBe(1);
    expect(product.body.data.id).toBeDefined();
  });

  it('searches by name', async () => {
    const user = await admin();
    const name = uniqueName('Searchable Hoodie');

    await api()
      .post('/api/categories')
      .set(await authCookie(user))
      .send({ name })
      .expect(201);

    const response = await api()
      .get('/api/categories')
      .query({ search: name.slice(0, 20), status: 'all' })
      .set(await authCookie(user))
      .expect(200);

    expect((response.body.data.items as Array<{ name: string }>).map((i) => i.name)).toContain(
      name,
    );
  });
});