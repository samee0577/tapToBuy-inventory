import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, History } from 'lucide-react';

import {
  hasMovementFinancials,
  type InventoryMovementType,
  type ListMovementsQuery,
  type MovementDto,
} from '@inventory/shared';

import { FilterBar } from '@/components/filter-bar';
import {
  EmptyState,
  LoadingList,
  PageHeader,
  PaginationBar,
  ResultCount,
} from '@/components/screen-parts';
import { ProfitValue } from '@/components/stock-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCategoryOptions, useListState, useMovements } from '@/hooks/use-api';
import {
  dateOnly,
  dateTime,
  daysAgoInputValue,
  quantity as formatQuantity,
  relativeTime,
} from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The complete stock history.
 *
 * This screen exists because the ledger is append-only: once a movement is
 * recorded it cannot be edited, so the only way to answer "what happened to this
 * stock?" is to read the record. It is deliberately a flat reverse-chronological
 * feed rather than a per-product report, because the questions that bring someone
 * here ("who sold these two units yesterday?") are about events, not totals.
 *
 * Movements are grouped by calendar day. A wall of fifty undifferentiated rows is
 * hard to scan; day headers turn it into something a person can read at a glance,
 * and they cost nothing but a heading.
 */

const PAGE_SIZE = 50;

const MOVEMENT_PRESENTATION: Record<
  string,
  { label: string; className: string; sign: '+' | '−' | '±' }
> = {
  STOCK_IN: { label: 'Stock in', className: 'text-stock-in-stock', sign: '+' },
  SALE: { label: 'Sale', className: 'text-foreground', sign: '−' },
  RETURN: { label: 'Return', className: 'text-profit-negative', sign: '+' },
  ADJUSTMENT: { label: 'Adjustment', className: 'text-stock-low-stock', sign: '±' },
};

const SORT_OPTIONS = [
  { value: 'createdAt', label: 'Most recent' },
  { value: 'quantity', label: 'Quantity' },
  { value: 'type', label: 'Movement type' },
  { value: 'product', label: 'Product name' },
] as const;

export function HistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const list = useListState();
  const categories = useCategoryOptions();
  const [showDates, setShowDates] = useState(
    Boolean(searchParams.get('from')) || Boolean(searchParams.get('to')),
  );

  const query = {
    search: searchParams.get('search') ?? undefined,
    productId: searchParams.get('productId') ?? undefined,
    categoryId: searchParams.get('categoryId') ?? undefined,
    type: (searchParams.get('type') as InventoryMovementType | null) ?? undefined,
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
    sortBy: (searchParams.get('sortBy') as ListMovementsQuery['sortBy'] | null) ?? 'createdAt',
    sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc' | null) ?? 'desc',
    pageSize: PAGE_SIZE,
  };

  const movements = useMovements(query, list);

  const setPage = (page: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(page));
    setSearchParams(next, { replace: true });
    list.setPage(page);
  };

  function setParam(key: string, value: string | undefined) {
    const next = new URLSearchParams(searchParams);
    if (value === undefined || value === '' || value === 'all') next.delete(key);
    else next.set(key, value);
    next.delete('page');
    setSearchParams(next, { replace: true });
    list.setPage(1);
  }

  const rows = movements.data?.items ?? [];
  const grouped = groupByDay(rows);

  return (
    <div className="space-y-4">
      <PageHeader
        title="History"
        description="Every stock movement, in the order it happened"
      />

      <FilterBar
        searchPlaceholder="Search products, reasons, notes"
        categories={(categories.data ?? []).map((option) => ({
          value: option.id,
          label: option.name,
        }))}
        showSizes={false}
        showColors={false}
        showStockStatus={false}
        showStatusToggle={false}
        categoryId={query.categoryId}
        sortBy={query.sortBy}
        sortOptions={SORT_OPTIONS}
      />

      <div className="flex flex-wrap items-end gap-2">
        <Select
          value={query.type ?? 'all'}
          onValueChange={(value) => setParam('type', value ?? undefined)}
        >
          <SelectTrigger aria-label="Movement type" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="all">All movement types</SelectItem>
            <SelectItem value="STOCK_IN">Stock in</SelectItem>
            <SelectItem value="SALE">Sales</SelectItem>
            <SelectItem value="RETURN">Returns</SelectItem>
            <SelectItem value="ADJUSTMENT">Adjustments</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant={showDates ? 'default' : 'outline'}
          onClick={() => setShowDates((value) => !value)}
          aria-expanded={showDates}
        >
          <CalendarDays aria-hidden data-icon="inline-start" />
          Dates
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setParam('from', daysAgoInputValue(7));
            setParam('to', undefined);
          }}
        >
          Last 7 days
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setParam('from', daysAgoInputValue(30));
            setParam('to', undefined);
          }}
        >
          Last 30 days
        </Button>
      </div>

      {showDates ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="from">From</Label>
            <Input
              id="from"
              type="date"
              value={query.from ?? ''}
              onChange={(event) => setParam('from', event.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">To</Label>
            <Input
              id="to"
              type="date"
              value={query.to ?? ''}
              onChange={(event) => setParam('to', event.target.value)}
              className="w-40"
            />
          </div>
          {query.from || query.to ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setParam('from', undefined);
                setParam('to', undefined);
              }}
            >
              Clear dates
            </Button>
          ) : null}
        </div>
      ) : null}

      <ResultCount
        total={movements.data?.total ?? 0}
        noun="movements"
        page={list.page}
        pageSize={PAGE_SIZE}
        isRefetching={movements.isFetching && !movements.isPending}
      />

      {movements.isPending ? (
        <LoadingList rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          filtered={searchParams.toString().length > 0}
          title={
            searchParams.toString()
              ? 'No movements match those filters'
              : 'No stock movements yet'
          }
          description={
            searchParams.toString()
              ? 'Widen the date range, or clear a filter.'
              : 'Every sale, return and stock-in will appear here.'
          }
          action={
            searchParams.toString() ? (
              <Button variant="outline" onClick={() => setSearchParams(new URLSearchParams())}>
                Clear filters
              </Button>
            ) : (
              <Button render={<Link to="/inventory" />}>Go to stock</Button>
            )
          }
        />
      ) : (
        <>
          <div className="space-y-4 sm:hidden">
            {grouped.map(([day, dayRows]) => (
              <section key={day} className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {day}
                </h2>
                {dayRows.map((movement) => (
                  <MovementCard key={movement.id} movement={movement} />
                ))}
              </section>
            ))}
          </div>

          <div className="hidden space-y-4 sm:block">
            {grouped.map(([day, dayRows]) => (
              <section key={day} className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {day}
                </h2>
                <Card className="overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Variant</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Stock</TableHead>
                        <TableHead className="text-right">Profit</TableHead>
                        <TableHead>Who</TableHead>
                        <TableHead className="text-right">When</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dayRows.map((movement) => {
                        const presentation = MOVEMENT_PRESENTATION[movement.type] ?? {
                          label: movement.type,
                          className: 'text-foreground',
                          sign: '±' as const,
                        };

                        return (
                          <TableRow key={movement.id}>
                            <TableCell>
                              <Badge
                                variant="secondary"
                                className={presentation.className}
                              >
                                {presentation.label}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-48">
                              <Link
                                to={`/products/${movement.productId}`}
                                className="block truncate font-medium hover:underline"
                              >
                                {movement.productName}
                              </Link>
                              <span className="tabular block truncate text-xs text-muted-foreground">
                                {movement.productCode}
                              </span>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                              {movement.size} / {movement.color}
                            </TableCell>
                            <TableCell
                              className={cn(
                                'tabular text-right font-semibold',
                                presentation.className,
                              )}
                            >
                              {presentation.sign}
                              {formatQuantity(movement.quantity)}
                            </TableCell>
                            <TableCell className="tabular text-right text-sm text-muted-foreground">
                              {formatQuantity(movement.previousStock)} →{' '}
                              {formatQuantity(movement.newStock)}
                            </TableCell>
                            <TableCell className="tabular text-right text-sm">
                              {hasMovementFinancials(movement) ? (
                                <ProfitValue value={movement.profit} />
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="max-w-32 truncate text-sm text-muted-foreground">
                              {movement.performedBy.name}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                              {dateTime(movement.createdAt)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Card>
              </section>
            ))}
          </div>

          <PaginationBar
            page={list.page}
            pageSize={PAGE_SIZE}
            total={movements.data?.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <History aria-hidden className="size-3" />
        Movements cannot be edited or deleted. A mistake is corrected by recording a
        return or an adjustment.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function MovementCard({ movement }: { movement: MovementDto }) {
  const presentation = MOVEMENT_PRESENTATION[movement.type] ?? {
    label: movement.type,
    className: 'text-foreground',
    sign: '±' as const,
  };

  return (
    <Card size="sm">
      <CardContent className="space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              to={`/products/${movement.productId}`}
              className="block truncate text-sm font-medium hover:underline"
            >
              {movement.productName}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {movement.size} / {movement.color} · {movement.productCode}
            </p>
          </div>
          <Badge variant="secondary" className={presentation.className}>
            {presentation.sign}
            {formatQuantity(movement.quantity)}
          </Badge>
        </div>

        <p className="tabular text-xs text-muted-foreground">
          {formatQuantity(movement.previousStock)} → {formatQuantity(movement.newStock)} on hand
          {' · '}
          {movement.performedBy.name} · {relativeTime(movement.createdAt)}
        </p>

        {movement.reason || movement.note ? (
          <p className="text-xs text-muted-foreground">
            {movement.reason}
            {movement.reason && movement.note ? ' — ' : ''}
            {movement.note}
          </p>
        ) : null}

        {hasMovementFinancials(movement) && movement.profit !== null ? (
          <p className="tabular text-xs">
            Profit <ProfitValue value={movement.profit} className="inline" />
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Buckets movements by calendar day, preserving order within each day.
 *
 * Keyed on the date the movement happened, not the current date or a relative
 * label, so the headings are unambiguous ("4 Mar 2026") rather than requiring the
 * reader to work out what "Tuesday" meant.
 */
function groupByDay(movements: readonly MovementDto[]): Array<[string, MovementDto[]]> {
  const groups = new Map<string, MovementDto[]>();

  for (const movement of movements) {
    const day = dateOnly(movement.createdAt);
    const bucket = groups.get(day);
    if (bucket) bucket.push(movement);
    else groups.set(day, [movement]);
  }

  return [...groups.entries()];
}
