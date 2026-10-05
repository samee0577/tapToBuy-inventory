import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Package, Search } from 'lucide-react';

import {
  StockStatus,
  hasInventoryCost,
  type ListInventoryQuery,
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
import { StockStatusBadge } from '@/components/stock-status-badge';
import {
  StockActionDialog,
  StockActionMenu,
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
import { useCategoryOptions, useInventory, useListState } from '@/hooks/use-api';
import { useAuth } from '@/hooks/use-auth';
import { money, quantity as formatQuantity } from '@/lib/format';

/**
 * The stock screen.
 *
 * One row per variant, not per product, because the question this screen answers is
 * "how many of each size is on the shelf" — and grouping by product hides the
 * answer for exactly the variants that differ. The product name and code are on
 * each row as context, so nothing is lost by the flat list.
 *
 * A table on a phone would be unreadable at this column count, so the same markup
 * renders as a stack below `sm` and a real table above it. Two layouts, one data
 * source — the alternative is a second component that can fall out of step.
 */

const SORT_OPTIONS = [
  { value: 'updatedAt', label: 'Recently updated' },
  { value: 'productName', label: 'Product name' },
  { value: 'productCode', label: 'Product code' },
  { value: 'size', label: 'Size' },
  { value: 'color', label: 'Colour' },
  { value: 'stockQuantity', label: 'Stock quantity' },
  { value: 'sellingPrice', label: 'Selling price' },
  { value: 'buyingPrice', label: 'Buying price' },
  { value: 'createdAt', label: 'Recently added' },
] as const;

const PAGE_SIZE = 20;

export function InventoryPage() {
  const { isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const list = useListState();
  const categories = useCategoryOptions();

  const [dialog, setDialog] = useState<{
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
    stockStatus: (searchParams.get('stockStatus') as StockStatusType | null) ?? undefined,
    status: (searchParams.get('status') as 'all' | 'active' | 'inactive' | null) ?? 'active',
    // Cast to the API's own union: the filter bar offers a fixed list, so an
    // unrecognised value in a hand-edited URL falls back rather than being sent
    // on and rejected with a 400.
    sortBy: (searchParams.get('sortBy') as ListInventoryQuery['sortBy'] | null) ?? 'updatedAt',
    sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc' | null) ?? 'desc',
    pageSize: PAGE_SIZE,
  };

  const inventory = useInventory(query, list);

  const setPage = (page: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(page));
    setSearchParams(next, { replace: true });
    list.setPage(page);
  };

  const openAction = (
    action: StockAction,
    row: {
      variantId: string;
      productName: string;
      size: string;
      color: string;
      stockQuantity: number;
      stockStatus: StockStatusType;
      sellingPrice: string;
    },
  ) => {
    setDialog({
      action,
      variantId: row.variantId,
      productName: row.productName,
      size: row.size,
      color: row.color,
      stock: row.stockQuantity,
      status: row.stockStatus,
      sellingPrice: row.sellingPrice,
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock"
        description="Every variant, with its current quantity"
        actions={
          <Button variant="outline" size="sm" render={<Link to="/history" />}>
            History
          </Button>
        }
      />

      <FilterBar
        searchPlaceholder="Search products, sizes, colours"
        categories={(categories.data ?? []).map((option) => ({
          value: option.id,
          label: option.name,
        }))}
        size={query.size}
        color={query.color}
        categoryId={query.categoryId}
        stockStatus={query.stockStatus}
        status={query.status}
        sortBy={query.sortBy}
        sortOptions={SORT_OPTIONS}
      />

      <ResultCount
        total={inventory.data?.total ?? 0}
        noun="variants"
        page={list.page}
        pageSize={PAGE_SIZE}
        isRefetching={inventory.isFetching && !inventory.isPending}
      />

      {inventory.isPending ? (
        <LoadingList rows={6} />
      ) : (inventory.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          filtered={Boolean(searchParams.toString())}
          title={
            searchParams.toString()
              ? 'Nothing matches those filters'
              : 'No stock recorded yet'
          }
          description={
            searchParams.toString()
              ? 'Try clearing a filter or searching for something else.'
              : 'Stock appears here once a product exists.'
          }
          action={
            searchParams.toString() ? (
              <Button variant="outline" onClick={() => setSearchParams(new URLSearchParams())}>
                Clear filters
              </Button>
            ) : (
              <Button render={<Link to="/products" />}>
                <Package aria-hidden data-icon="inline-start" />
                Go to products
              </Button>
            )
          }
        />
      ) : (
        <>
          {/* Phones: one card per variant, because a seven-column table at 375px
              forces horizontal scrolling on the screen people actually use. */}
          <ul className="space-y-2 sm:hidden">
            {inventory.data?.items.map((row) => (
              <li key={row.variantId}>
                <Card size="sm">
                  <CardContent className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          to={`/products/${row.productId}`}
                          className="block truncate text-sm font-medium hover:underline"
                        >
                          {row.productName}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.productCode} · {row.size} / {row.color}
                        </p>
                      </div>
                      <StockStatusBadge status={row.stockStatus} />
                    </div>

                    <dl className="tabular flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
                      <div>
                        <dt className="inline text-muted-foreground">On hand </dt>
                        <dd className="inline font-semibold">
                          {formatQuantity(row.stockQuantity)}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline text-muted-foreground">Sells at </dt>
                        <dd className="inline font-semibold">{money(row.sellingPrice)}</dd>
                      </div>
                      {hasInventoryCost(row) ? (
                        <div>
                          <dt className="inline text-muted-foreground">Costs </dt>
                          <dd className="inline font-semibold">{money(row.buyingPrice)}</dd>
                        </div>
                      ) : null}
                      {isAdmin ? (
                        <div>
                          <dt className="inline text-muted-foreground">Stock at cost </dt>
                          <dd className="inline font-semibold">
                            {hasInventoryCost(row) ? money(row.stockCostValue) : '—'}
                          </dd>
                        </div>
                      ) : null}
                    </dl>

                    <StockActionMenu
                      onSelect={(action) => {
                        if (
                          row.stockStatus === StockStatus.OUT_OF_STOCK &&
                          (action === 'sale' || action === 'return')
                        ) {
                          // Not a restriction — a mis-typed path. Falling through to
                          // the dialog would show "only 0 in stock" and teach the
                          // user that the screen is broken.
                          return;
                        }
                        openAction(action, row);
                      }}
                      disabled={row.stockStatus === StockStatus.OUT_OF_STOCK}
                    />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>

          {/* Wider screens: the real table, same rows. */}
          <Card className="hidden overflow-hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Sells at</TableHead>
                  {isAdmin ? <TableHead className="text-right">Costs</TableHead> : null}
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Record</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventory.data?.items.map((row) => (
                  <TableRow key={row.variantId}>
                    <TableCell className="max-w-48">
                      <Link
                        to={`/products/${row.productId}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {row.productName}
                      </Link>
                      <span className="tabular block truncate text-xs text-muted-foreground">
                        {row.productCode}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {row.size} / {row.color}
                    </TableCell>
                    <TableCell className="tabular text-right font-semibold">
                      {formatQuantity(row.stockQuantity)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {money(row.sellingPrice)}
                    </TableCell>
                    {isAdmin ? (
                      <TableCell className="tabular text-right text-muted-foreground">
                        {hasInventoryCost(row) ? money(row.buyingPrice) : '—'}
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <StockStatusBadge status={row.stockStatus} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <StockActionMenu
                          disabled={row.stockStatus === StockStatus.OUT_OF_STOCK}
                          onSelect={(action) => openAction(action, row)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <PaginationBar
            page={list.page}
            pageSize={PAGE_SIZE}
            total={inventory.data?.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}

      <StockActionDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        action={dialog?.action ?? 'sale'}
        variantId={dialog?.variantId}
        productName={dialog?.productName ?? ''}
        size={dialog?.size ?? ''}
        color={dialog?.color ?? ''}
        currentStock={dialog?.stock ?? 0}
        currentStatus={dialog?.status ?? StockStatus.OUT_OF_STOCK}
        sellingPrice={dialog?.sellingPrice}
      />

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Search aria-hidden className="size-3" />
        Every movement is recorded and cannot be edited afterwards.
      </p>
    </div>
  );
}
