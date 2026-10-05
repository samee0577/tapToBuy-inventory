import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, X } from 'lucide-react';

import { StockStatus, type StockStatus as StockStatusType } from '@inventory/shared';

import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { useInventoryFacets } from '@/hooks/use-api';
import { cn } from '@/lib/utils';

/**
 * The filter bar: a search box, a "Filters" drawer, and a live count of what is
 * applied.
 *
 * Filters live in the URL rather than component state, deliberately. A shop owner
 * who filters to "low stock, size M", screenshots it for a colleague and comes back
 * tomorrow expects the same list; component state would reset on every navigation
 * and on refresh, and the back button would walk through stale filter combinations
 * instead of filter states.
 *
 * The search input is debounced and written to the URL only once the user stops
 * typing. The alternative — writing every keystroke — would put a history entry per
 * character and fire a request per character.
 */

export interface FilterDrawerOption {
  value: string;
  label: string;
}

export interface FilterBarProps {
  searchPlaceholder?: string;
  categories?: FilterDrawerOption[];
  showCategory?: boolean;
  showSizes?: boolean;
  showColors?: boolean;
  showStockStatus?: boolean;
  showStatusToggle?: boolean;
  status?: 'all' | 'active' | 'inactive';
  size?: string;
  color?: string;
  categoryId?: string;
  stockStatus?: StockStatusType;
  sortBy: string;
  sortOptions: ReadonlyArray<{ value: string; label: string }>;
}

const ALL = 'all';

export function FilterBar(props: FilterBarProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');

  const apply = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams);

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === '' || value === ALL) next.delete(key);
      else next.set(key, value);
    }

    // Any filter change invalidates the current page: staying on page 4 of a list
    // that just shrank to two pages shows an empty screen with no explanation.
    next.delete('page');
    setSearchParams(next, { replace: true });
  };

  // Push the debounced search into the URL. 300ms is long enough that a fast typist
  // produces one request rather than one per character, and short enough that the
  // list does not feel stale after they stop.
  useEffect(() => {
    const current = searchParams.get('search') ?? '';
    if (search === current) return;

    const timer = setTimeout(() => apply({ search: search || undefined }), 300);
    return () => clearTimeout(timer);
    // `searchParams` is intentionally absent: including it would restart the timer
    // on every write and the debounce would never fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const activeChips = useActiveChips(props, searchParams, apply);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <InputGroup className="flex-1">
          <InputGroupAddon>
            <Search aria-hidden className="size-4" />
          </InputGroupAddon>
          <InputGroupInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={props.searchPlaceholder ?? 'Search'}
            aria-label={props.searchPlaceholder ?? 'Search'}
            type="search"
            enterKeyHint="search"
          />
          {search ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                variant="ghost"
                size="icon-xs"
                aria-label="Clear search"
                onClick={() => setSearch('')}
              >
                <X aria-hidden />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>

        <FilterDrawer {...props} onApply={apply} />
      </div>

      {activeChips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeChips}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setSearch('');
              setSearchParams(new URLSearchParams(), { replace: true });
            }}
          >
            Clear all
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function FilterDrawer({
  categories = [],
  showCategory = true,
  showSizes = true,
  showColors = true,
  showStockStatus = true,
  showStatusToggle = true,
  status,
  size,
  color,
  categoryId,
  stockStatus,
  sortBy,
  sortOptions,
  onApply,
}: FilterBarProps & { onApply: (updates: Record<string, string | undefined>) => void }) {
  const [open, setOpen] = useState(false);
  const facets = useInventoryFacets();

  const [draft, setDraft] = useState({
    categoryId: categoryId ?? ALL,
    size: size ?? ALL,
    color: color ?? ALL,
    stockStatus: stockStatus ?? ALL,
    status: status ?? 'active',
    sortBy,
  });

  // Re-seeded each time the drawer opens, so cancelling out of it leaves the applied
  // filters exactly as they were rather than half-applied.
  useEffect(() => {
    if (open) {
      setDraft({
        categoryId: categoryId ?? ALL,
        size: size ?? ALL,
        color: color ?? ALL,
        stockStatus: stockStatus ?? ALL,
        status: status ?? 'active',
        sortBy,
      });
    }
  }, [open, categoryId, size, color, stockStatus, status, sortBy]);

  const activeCount = useMemo(
    () =>
      [
        draft.categoryId !== ALL,
        draft.size !== ALL,
        draft.color !== ALL,
        draft.stockStatus !== ALL,
        status !== 'active' && status !== undefined,
      ].filter(Boolean).length,
    [draft, status],
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" className="relative shrink-0" aria-label="Filters" />
        }
      >
        <SlidersHorizontal aria-hidden data-icon="inline-start" />
        Filters
        {activeCount > 0 ? (
          <span className="tabular ml-1 rounded-4xl bg-primary px-1.5 text-xs text-primary-foreground">
            {activeCount}
          </span>
        ) : null}
      </SheetTrigger>

      <SheetContent side="bottom" className="max-h-[85dvh]">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          <div className="space-y-2">
            <Label htmlFor="filter-sort">Sort by</Label>
            <Select
              value={draft.sortBy}
              onValueChange={(value) =>
                setDraft((current) => ({ ...current, sortBy: value ?? 'updatedAt' }))
              }
            >
              <SelectTrigger id="filter-sort" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {sortOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {showCategory && categories.length > 0 ? (
            <div className="space-y-2">
              <Label htmlFor="filter-category">Category</Label>
              <Select
                value={draft.categoryId}
                onValueChange={(value) =>
                  setDraft((current) => ({ ...current, categoryId: value ?? ALL }))
                }
              >
                <SelectTrigger id="filter-category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value={ALL}>All categories</SelectItem>
                  {categories.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {showSizes ? (
            <div className="space-y-2">
              <Label htmlFor="filter-size">Size</Label>
              <Select
                value={draft.size}
                onValueChange={(value) =>
                  setDraft((current) => ({ ...current, size: value ?? ALL }))
                }
              >
                <SelectTrigger id="filter-size" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value={ALL}>All sizes</SelectItem>
                  {(facets.data?.sizes ?? []).map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {showColors ? (
            <div className="space-y-2">
              <Label htmlFor="filter-color">Colour</Label>
              <Select
                value={draft.color}
                onValueChange={(value) =>
                  setDraft((current) => ({ ...current, color: value ?? ALL }))
                }
              >
                <SelectTrigger id="filter-color" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value={ALL}>All colours</SelectItem>
                  {(facets.data?.colors ?? []).map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {showStockStatus ? (
            <div className="space-y-2">
              <Label htmlFor="filter-stock">Stock status</Label>
              <Select
                value={draft.stockStatus}
                onValueChange={(value) =>
                  setDraft((current) => ({ ...current, stockStatus: value ?? ALL }))
                }
              >
                <SelectTrigger id="filter-stock" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value={ALL}>Any stock level</SelectItem>
                  <SelectItem value={StockStatus.IN_STOCK}>In stock</SelectItem>
                  <SelectItem value={StockStatus.LOW_STOCK}>Low stock</SelectItem>
                  <SelectItem value={StockStatus.OUT_OF_STOCK}>Out of stock</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {showStatusToggle ? (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="filter-status" className="font-normal">
                Show deactivated
              </Label>
              <Switch
                id="filter-status"
                checked={draft.status !== 'active'}
                onCheckedChange={(checked) =>
                  setDraft((current) => ({ ...current, status: checked ? 'all' : 'active' }))
                }
              />
            </div>
          ) : null}
        </div>

        <div className="flex gap-2 border-t p-4">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              setDraft({
                categoryId: ALL,
                size: ALL,
                color: ALL,
                stockStatus: ALL,
                status: 'active',
                sortBy,
              });
              onApply({
                categoryId: undefined,
                size: undefined,
                color: undefined,
                stockStatus: undefined,
                status: undefined,
                search: undefined,
              });
              setOpen(false);
            }}
          >
            Reset
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              onApply({
                categoryId: draft.categoryId,
                size: draft.size,
                color: draft.color,
                stockStatus: draft.stockStatus,
                status: draft.status === 'active' ? undefined : draft.status,
                sortBy: draft.sortBy,
              });
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */

type ApplyFn = (updates: Record<string, string | undefined>) => void;

function useActiveChips(
  props: FilterBarProps,
  searchParams: URLSearchParams,
  apply: ApplyFn,
): ReactNode[] {
  const categoryName = props.categories?.find(
    (option) => option.value === searchParams.get('categoryId'),
  )?.label;

  const chips: Array<{ key: string; label: string; clear: Record<string, string | undefined> }> = [];

  if (searchParams.get('categoryId')) {
    chips.push({
      key: 'categoryId',
      label: categoryName ?? 'Category',
      clear: { categoryId: undefined },
    });
  }
  if (searchParams.get('size')) {
    chips.push({ key: 'size', label: `Size ${searchParams.get('size')}`, clear: { size: undefined } });
  }
  if (searchParams.get('color')) {
    chips.push({
      key: 'color',
      label: searchParams.get('color') as string,
      clear: { color: undefined },
    });
  }
  if (searchParams.get('stockStatus')) {
    const raw = searchParams.get('stockStatus') as StockStatusType;
    const label =
      raw === StockStatus.IN_STOCK
        ? 'In stock'
        : raw === StockStatus.LOW_STOCK
          ? 'Low stock'
          : 'Out of stock';
    chips.push({ key: 'stockStatus', label, clear: { stockStatus: undefined } });
  }
  if (searchParams.get('status') && searchParams.get('status') !== 'active') {
    chips.push({
      key: 'status',
      label: 'Including deactivated',
      clear: { status: undefined },
    });
  }

  return chips.map((chip) => (
    <Button
      key={chip.key}
      variant="secondary"
      size="xs"
      className={cn('gap-1')}
      onClick={() => apply(chip.clear)}
    >
      {chip.label}
      <X aria-hidden data-icon="inline-end" />
      <span className="sr-only">Clear this filter</span>
    </Button>
  ));
}
