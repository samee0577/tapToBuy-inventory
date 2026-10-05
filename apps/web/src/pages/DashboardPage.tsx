import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpFromLine,
  Boxes,
  CircleDollarSign,
  Package,
  RotateCcw,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react';

import {
  hasDashboardFinancials,
  type DashboardRange,
  type RecentActivityDto,
} from '@inventory/shared';

import { EmptyState, LoadingList, PageHeader } from '@/components/screen-parts';
import { StockStatusBadge } from '@/components/stock-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAutoRefresh, useDashboard, errorMessage } from '@/hooks/use-api';
import { useAuth } from '@/hooks/use-auth';
import { money, quantity as formatQuantity, relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The landing screen.
 *
 * Ordered by what an owner needs on opening the app: is anything about to run out,
 * what did we sell, and what is the shop worth. Counts come last because they are
 * the least actionable — useful, but nothing to do about them.
 *
 * The range selector covers the profit figures only. The low-stock list and the
 * activity feed are "now", not "over the last 30 days": a variant that hit zero
 * three weeks ago is still out of stock, and hiding it behind a date filter would
 * make a live problem look historical.
 */

const RANGES: ReadonlyArray<{ value: DashboardRange; label: string }> = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

export function DashboardPage() {
  const { isAdmin } = useAuth();
  const [range, setRange] = useState<DashboardRange>('30d');
  const dashboard = useDashboard(range);

  // Re-checks every two minutes while the tab is visible. Stock on the shop floor
  // changes while this screen is open, and a dashboard that only updates on
  // navigation is worse than no dashboard for noticing an empty shelf.
  useAutoRefresh(dashboard.refetch, 120_000, true);

  if (dashboard.isPending) {
    return (
      <div className="space-y-4">
        <PageHeader title="Dashboard" description="Loading the shop's current state…" />
        <LoadingList rows={4} />
      </div>
    );
  }

  if (dashboard.error) {
    return (
      <div className="space-y-4">
        <PageHeader title="Dashboard" />
        <EmptyState
          title="Could not load the dashboard"
          description={errorMessage(dashboard.error)}
          action={
            <Button variant="outline" onClick={() => void dashboard.refetch()}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const data = dashboard.data;
  if (!data) return null;

  const { counts } = data;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        description={`${formatQuantity(counts.totalStockUnits)} units on hand`}
        actions={
          <Select
            value={range}
            onValueChange={(value) => setRange((value ?? '30d') as DashboardRange)}
          >
            <SelectTrigger aria-label="Reporting range" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {RANGES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {/* The restock warning. First because it is the only card on the screen that
          is asking the owner to do something. */}
      {counts.outOfStockVariants + counts.lowStockVariants > 0 ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-warning">
              <TriangleAlert aria-hidden className="size-4" />
              Needs restocking
            </CardTitle>
            <CardDescription>
              {counts.outOfStockVariants} out of stock · {counts.lowStockVariants} low
              {counts.severeLowStockVariants > 0
                ? ` · ${counts.severeLowStockVariants} at 2 or fewer`
                : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.lowStockItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing to restock right now.
              </p>
            ) : (
              <ul className="divide-y">
                {data.lowStockItems.slice(0, 5).map((item) => (
                  <li key={item.variantId} className="flex items-center gap-3 py-2 first:pt-0">
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/products/${item.productId}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {item.productName}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.productCode} · {item.size} / {item.color}
                      </p>
                    </div>
                    <StockStatusBadge
                      status={item.stockStatus}
                      quantity={item.stockQuantity}
                    />
                  </li>
                ))}
              </ul>
            )}
            <Button variant="link" size="sm" className="mt-2 px-0" render={<Link to="/inventory" />}>
              Open stock list
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Realized profit, administrators only. The whole card is absent for Staff
          rather than showing zeros, because "₹0 profit" is a different statement
          from "you do not have permission to see profit". */}
      {hasDashboardFinancials(data) ? (
        <section aria-label="Financials" className="grid gap-3 sm:grid-cols-3">
          <Card size="sm">
            <CardHeader>
              <CardDescription>Realized profit</CardDescription>
              <CardTitle className="tabular text-2xl">
                {money(data.financials.realizedProfit)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <ArrowUpFromLine aria-hidden className="size-3" />
                  {formatQuantity(data.financials.unitsSold)} sold
                </span>
                <span className="inline-flex items-center gap-1">
                  <RotateCcw aria-hidden className="size-3" />
                  {formatQuantity(data.financials.unitsReturned)} returned
                </span>
              </p>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardDescription>Stock at cost</CardDescription>
              <CardTitle className="tabular text-2xl">
                {money(data.financials.costValue)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                What the {formatQuantity(counts.totalStockUnits)} units on hand cost
              </p>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardDescription>Retail value</CardDescription>
              <CardTitle className="tabular flex items-center gap-2 text-2xl">
                {money(data.financials.retailValue)}
                <Badge variant="secondary" className="text-profit-positive">
                  <TrendingUp aria-hidden />
                  {money(data.financials.potentialProfit)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Potential margin if it all sells</p>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {/* The activity feed. Staff see this too: knowing who recorded the last sale
          is part of running the counter. */}
      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Every stock movement, newest first</CardDescription>
        </CardHeader>
        <CardContent>
          {data.recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y">
              {data.recentActivity.map((entry) => (
                <ActivityRow key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
          <Button variant="link" size="sm" className="mt-2 px-0" render={<Link to="/history" />}>
            See full history
          </Button>
        </CardContent>
      </Card>

      {/* Catalogue totals. Last: informative, not actionable. */}
      <section aria-label="Catalogue" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={Package} label="Products" value={formatQuantity(counts.activeProducts)} />
        <StatTile
          icon={Boxes}
          label="Variants"
          value={formatQuantity(counts.totalVariants)}
        />
        <StatTile
          icon={CircleDollarSign}
          label="On hand"
          value={formatQuantity(counts.totalStockUnits)}
        />
        <StatTile
          icon={TrendingUp}
          label="Updated"
          value={relativeTime(data.generatedAt)}
        />
      </section>

      {!isAdmin ? (
        <p className="text-xs text-muted-foreground">
          Prices and profit are visible to administrators only.
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const MOVEMENT_PRESENTATION: Record<
  string,
  { label: string; className: string; sign: '+' | '−' | '±' }
> = {
  STOCK_IN: { label: 'Stock in', className: 'text-stock-in-stock', sign: '+' },
  SALE: { label: 'Sold', className: 'text-foreground', sign: '−' },
  RETURN: { label: 'Returned', className: 'text-profit-negative', sign: '+' },
  ADJUSTMENT: { label: 'Adjusted', className: 'text-stock-low-stock', sign: '±' },
};

function ActivityRow({ entry }: { entry: RecentActivityDto }) {
  const presentation = MOVEMENT_PRESENTATION[entry.type] ?? {
    label: entry.type,
    className: 'text-foreground',
    sign: '±' as const,
  };

  return (
    <li className="flex items-center gap-3 py-2 first:pt-0">
      <Badge variant="secondary" className={cn('w-20 shrink-0 justify-center', presentation.className)}>
        {presentation.label}
      </Badge>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{entry.productName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {entry.size} / {entry.color} · {entry.performedBy.name} ·{' '}
          {relativeTime(entry.createdAt)}
        </p>
      </div>

      <p className="tabular shrink-0 text-right text-sm">
        <span className={presentation.className}>
          {presentation.sign}
          {formatQuantity(entry.quantity)}
        </span>
        <span className="block text-xs text-muted-foreground">
          {formatQuantity(entry.newStock)} left
        </span>
      </p>
    </li>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Package;
  label: string;
  value: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          <Icon aria-hidden className="size-3.5" />
          {label}
        </CardDescription>
        <CardTitle className="tabular text-lg">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
