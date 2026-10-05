import { Link, useSearchParams } from 'react-router-dom';
import { Package, Plus } from 'lucide-react';

import {
  deriveStockStatus,
  hasVariantFinancials,
  type ListProductsQuery,
  type ProductListItemDto,
} from '@inventory/shared';

import { FilterBar } from '@/components/filter-bar';
import {
  EmptyState,
  LoadingList,
  PageHeader,
  PaginationBar,
  ResultCount,
} from '@/components/screen-parts';
import { ProfitValue, StockStatusBadge } from '@/components/stock-status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useCategoryOptions, useListState, useProducts } from '@/hooks/use-api';
import { useAuth } from '@/hooks/use-auth';
import { money, quantity as formatQuantity } from '@/lib/format';

/**
 * The catalogue.
 *
 * Grouped by product with variants nested, because that is how a shop thinks: "the
 * Oxford shirt" is one thing with three sizes, not three inventory lines. The
 * product's own stock badge is the sum across its active variants — a product is only
 * "low" when the whole product is low, so one nearly-empty size does not make a
 * well-stocked line look urgent.
 *
 * The list deliberately cannot be sorted by stock or price. Those columns live on
 * the variant, and the server refuses the sort rather than pretending: sorting
 * grouped cards by a variant-level value would give a meaningless order. The stock
 * screen is where those sorts live.
 */

const SORT_OPTIONS = [
  { value: 'updatedAt', label: 'Recently updated' },
  { value: 'createdAt', label: 'Recently added' },
  { value: 'name', label: 'Name' },
  { value: 'productCode', label: 'Product code' },
] as const;

const PAGE_SIZE = 20;

export function ProductsPage() {
  const { isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const list = useListState();
  const categories = useCategoryOptions();

  const query = {
    search: searchParams.get('search') ?? undefined,
    categoryId: searchParams.get('categoryId') ?? undefined,
    size: searchParams.get('size') ?? undefined,
    color: searchParams.get('color') ?? undefined,
    stockStatus:
      (searchParams.get('stockStatus') as ProductListItemDto['stockStatus'] | null) ??
      undefined,
    status: (searchParams.get('status') as 'all' | 'active' | 'inactive' | null) ?? 'active',
    sortBy: (searchParams.get('sortBy') as ListProductsQuery['sortBy'] | null) ?? 'updatedAt',
    sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc' | null) ?? 'desc',
    pageSize: PAGE_SIZE,
  };

  const products = useProducts(query, list);

  const setPage = (page: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(page));
    setSearchParams(next, { replace: true });
    list.setPage(page);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products"
        description="The catalogue, with each product's variants"
        actions={
          isAdmin ? (
            <Button render={<Link to="/products/new" />}>
              <Plus aria-hidden data-icon="inline-start" />
              New product
            </Button>
          ) : null
        }
      />

      <FilterBar
        searchPlaceholder="Search name, code, size, colour"
        categories={(categories.data ?? []).map((option) => ({
          value: option.id,
          label: option.name,
        }))}
        size={query.size}
        color={query.color}
        stockStatus={query.stockStatus}
        status={query.status}
        categoryId={query.categoryId}
        sortBy={query.sortBy}
        sortOptions={SORT_OPTIONS}
      />

      <ResultCount
        total={products.data?.total ?? 0}
        noun="products"
        page={list.page}
        pageSize={PAGE_SIZE}
        isRefetching={products.isFetching && !products.isPending}
      />

      {products.isPending ? (
        <LoadingList rows={4} />
      ) : (products.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          filtered={searchParams.toString().length > 0}
          title={
            searchParams.toString() ? 'Nothing matches those filters' : 'No products yet'
          }
          description={
            searchParams.toString()
              ? 'Try a different search, or clear a filter.'
              : 'Add the first product to start tracking stock.'
          }
          action={
            isAdmin ? (
              <Button render={<Link to="/products/new" />}>
                <Plus aria-hidden data-icon="inline-start" />
                Add a product
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <ul className="space-y-3">
            {products.data?.items.map((product) => (
              <li key={product.id}>
                <Card>
                  <CardContent className="space-y-3">
                    <div className="flex items-start gap-3">
                      <ProductImage src={product.imageUrl} />

                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/products/${product.id}`}
                          className="block truncate font-medium hover:underline"
                        >
                          {product.name}
                        </Link>
                        <p className="tabular truncate text-xs text-muted-foreground">
                          {product.productCode} · {product.categoryName}
                        </p>
                        {product.description ? (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {product.description}
                          </p>
                        ) : null}
                      </div>

                      <StockStatusBadge
                        status={deriveStockStatus(product.totalStock)}
                        quantity={product.totalStock}
                      />
                    </div>

                    {product.variants.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No active variants. Deactivate or add one to record stock.
                      </p>
                    ) : (
                      <ul className="divide-y border-t">
                        {product.variants.map((variant) => (
                          <li
                            key={variant.id}
                            className="flex items-center gap-3 py-2 text-sm first:pt-3"
                          >
                            <span className="tabular w-28 shrink-0 text-xs text-muted-foreground">
                              {variant.size} / {variant.color}
                            </span>

                            <span className="tabular shrink-0 text-muted-foreground">
                              {money(variant.sellingPrice)}
                            </span>

                            {isAdmin && hasVariantFinancials(variant) ? (
                              <span className="tabular hidden shrink-0 text-xs text-muted-foreground sm:inline">
                                cost {money(variant.buyingPrice)}
                              </span>
                            ) : null}

                            {isAdmin && hasVariantFinancials(variant) ? (
                              <ProfitValue
                                value={variant.unitProfit}
                                className="hidden shrink-0 text-xs sm:inline"
                              />
                            ) : null}

                            <span className="tabular ml-auto shrink-0 font-semibold">
                              {formatQuantity(variant.stockQuantity)}
                            </span>

                            <StockStatusBadge
                              status={variant.stockStatus}
                              className="shrink-0"
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>

          <PaginationBar
            page={list.page}
            pageSize={PAGE_SIZE}
            total={products.data?.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Package aria-hidden className="size-3" />
        Products are never deleted — deactivate them so their stock and history stay
        intact.
      </p>
    </div>
  );
}

function ProductImage({ src }: { src: string | null }) {
  if (!src) {
    return (
      <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Package aria-hidden className="size-5" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      // A product photo is decoration here: the name is on the card as text, so a
      // screen reader announcing "Oxford shirt, image" adds nothing.
      loading="lazy"
      decoding="async"
      className="size-14 shrink-0 rounded-lg border object-cover"
    />
  );
}
