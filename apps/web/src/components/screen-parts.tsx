import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Inbox, SearchX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Small presentational pieces every list screen needs: a page heading, an empty
 * state, a loading placeholder, a result counter and a pager.
 *
 * They live together because they share a job — telling the user what the screen
 * is currently showing — and because keeping them in one file makes it obvious when
 * a fourth screen starts growing its own subtly different version of each.
 */

/* -------------------------------------------------------------------------- */

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Buttons or a filter trigger, right-aligned on wider screens. */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/* -------------------------------------------------------------------------- */

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  /**
   * Distinguishes "there is nothing here" from "there is nothing here *matching
   * your filters*". The second needs different words, because an owner who has
   * typed a filter needs to know the filter is the reason, not that the shop has
   * no stock at all.
   */
  filtered?: boolean;
}

export function EmptyState({ title, description, action, filtered = false }: EmptyStateProps) {
  return (
    <Empty className="py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {filtered ? <SearchX aria-hidden /> : <Inbox aria-hidden />}
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <div className="pt-2">{action}</div> : null}
    </Empty>
  );
}

/* -------------------------------------------------------------------------- */

export interface LoadingListProps {
  /** Number of skeleton rows to draw. Enough to suggest a list, not a wall. */
  rows?: number;
  className?: string;
}

export function LoadingList({ rows = 5, className }: LoadingListProps) {
  return (
    <div className={cn('space-y-2', className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-xl border p-3">
          <Skeleton className="size-12 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-6 w-16 rounded-4xl" />
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export interface ResultCountProps {
  total: number;
  /** What is being counted, e.g. "products". */
  noun: string;
  page?: number;
  pageSize?: number;
  /** True while a refetch is in flight over already-rendered data. */
  isRefetching?: boolean;
}

export function ResultCount({ total, noun, page, pageSize, isRefetching }: ResultCountProps) {
  const plural = total === 1 ? noun.replace(/s$/, '') : noun;
  const range =
    page !== undefined && pageSize !== undefined && total > 0
      ? ` · showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)}`
      : '';

  return (
    <p
      className="tabular text-xs text-muted-foreground"
      // Announced so a screen reader hears the count change after a filter, rather
      // than silently swapping the list underneath someone mid-tap.
      aria-live="polite"
      aria-busy={isRefetching === true}
    >
      {total} {plural}
      {range}
      {isRefetching ? ' · updating' : ''}
    </p>
  );
}

/* -------------------------------------------------------------------------- */

export interface PaginationBarProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}

/**
 * Previous/next only, with the range spelled out.
 *
 * No numbered pages. The result sets here are filtered views of a shop's own
 * catalogue, and a grid of page numbers invites deep-paging into an inventory list
 * where position is meaningless. Previous/next plus "showing 1–25 of 312" tells
 * the owner where they are without pretending otherwise.
 */
export function PaginationBar({ page, pageSize, total, onPageChange, className }: PaginationBarProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (totalPages <= 1) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      className={cn('flex items-center justify-between gap-3 pt-1', className)}
      aria-label="Pagination"
    >
      <p className="tabular text-xs text-muted-foreground">
        {first}–{last} of {total}
      </p>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft aria-hidden data-icon="inline-start" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRight aria-hidden data-icon="inline-end" />
        </Button>
      </div>
    </nav>
  );
}
