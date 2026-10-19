import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Package, Plus } from 'lucide-react';

import {
  StockStatus,
  deriveStockStatus,
  hasVariantFinancials,
  type ListProductsQuery,
  type ProductListItemDto,
  type StockStatus as StockStatusType,
} from '@inventory/shared';

import { FilterBar } from '@/components/filter-bar';
import {
  EmptyState,
  LoadingList,
  PageHeader,
  PaginationBar,
  ResultCount,
} from '@/components/screen-parts';
import {
  StockStatusBadge,
  stockStatusTextClassName,
} from '@/components/stock-status-badge';
import {
  MobileStockActions,
  StockActionDialog,
  type StockAction,
} from '@/components/stock-action-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCategoryOptions, useListState, useProducts } from '@/hooks/use-api';
import { useAuth } from '@/hooks/use-auth';
import { quantity as formatQuantity } from '@/lib/format';

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

  const [stockAction, setStockAction] = useState<{
    action: StockAction;
    variantId: string;
    productName: string;
    size: string;
    color: string;
    stock: number;
    status: StockStatusType;
    sellingPrice?: string;
  } | null>(null);
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

  const openAction = (
    action: StockAction,
    product: ProductListItemDto,
    variantId: string,
  ) => {
    const variant = product.variants.find((v) => v.id === variantId);
    if (!variant) return;
    setStockAction({
      action,
      variantId,
      productName: product.name,
      size: variant.size,
      color: variant.color,
      stock: variant.stockQuantity,
      status: variant.stockStatus,
      sellingPrice: variant.sellingPrice,
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products"
        description="Manage pricing and stock at a glance."
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
                      <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Package aria-hidden className="size-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        {product.categoryName}
                        <Link
                          to={`/products/${product.id}`}
                          className="block truncate font-medium hover:underline"
                        >
                          {product.name}
                        </Link>
                        <p className="tabular truncate text-xs text-muted-foreground">
                          {product.productCode} · {product.variants.length} variant
                        </p>
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
                      <div className="overflow-hidden rounded-lg border-0">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>VARIANT</TableHead>
                              <TableHead className="text-right">SELLING</TableHead>
                              {isAdmin ? (
                                <TableHead className="text-right">COST</TableHead>
                              ) : null}
                              <TableHead className="text-right">REMAINING</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {product.variants.map((variant) => (
                              <Fragment key={variant.id}>
                                <TableRow className="border-b-0">
                                  <TableCell>
                                    <div className="text-sm font-medium">
                                      {variant.size} / {variant.color}
                                    </div>
                                  </TableCell>
                                  <TableCell className="tabular text-right">
                                    ₹{variant.sellingPrice.replace(/\.00$/, '')}
                                  </TableCell>
                                  {isAdmin ? (
                                    <TableCell className="tabular text-right text-muted-foreground">
                                      {hasVariantFinancials(variant)
                                        ? `₹${variant.buyingPrice.replace(/\.00$/, '')}`
                                        : '—'}
                                    </TableCell>
                                  ) : null}
                                  <TableCell className="py-5 text-right">
                                    <div>
                                      <span
                                        className={`tabular text-xl font-bold ${stockStatusTextClassName(
                                          variant.stockStatus,
                                        )}`}
                                      >
                                        {formatQuantity(variant.stockQuantity)}
                                      </span>
                                    </div>
                                    <div
                                      className={`text-xs ${stockStatusTextClassName(
                                        variant.stockStatus,
                                      )}`}
                                    >
                                      {variant.stockStatus}
                                    </div>
                                  </TableCell>
                                </TableRow>
                                <TableRow>
                                  <TableCell
                                    colSpan={isAdmin ? 4 : 3}
                                    className="pt-0 pb-3"
                                  >
                                    <MobileStockActions
                                      disabled={
                                        variant.stockStatus === StockStatus.OUT_OF_STOCK
                                      }
                                      onSelect={(action) =>
                                        openAction(action, product, variant.id)
                                      }
                                    />
                                  </TableCell>
                                </TableRow>
                              </Fragment>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
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

      <StockActionDialog
        open={stockAction !== null}
        onOpenChange={(open) => {
          if (!open) setStockAction(null);
        }}
        action={stockAction?.action ?? 'sale'}
        variantId={stockAction?.variantId}
        productName={stockAction?.productName ?? ''}
        size={stockAction?.size ?? ''}
        color={stockAction?.color ?? ''}
        currentStock={stockAction?.stock ?? 0}
        currentStatus={stockAction?.status ?? StockStatus.OUT_OF_STOCK}
        sellingPrice={stockAction?.sellingPrice}
      />

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Package aria-hidden className="size-3" />
        Products are never deleted — deactivate them so their stock and history stay
        intact.
      </p>
    </div>
  );
}
