import { StockStatus, type StockStatus as StockStatusType } from '@inventory/shared';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * The one place a stock level is rendered as a colour.
 *
 * A stock status is a domain concept with defined thresholds (§17), and the
 * thresholds and the colours live in the same place — a `LOW_STOCK` badge and the
 * `?stockStatus=LOW_STOCK` filter must never be able to disagree about what "low"
 * means. The server sends the derived status rather than a count, so this component
 * never re-derives it and cannot disagree either.
 *
 * Colour is never the only signal: the label spells the state out, and the icon
 * shape differs, so the badge is still readable in monochrome or by someone who
 * cannot distinguish the hues.
 */

const PRESENTATION = {
  [StockStatus.IN_STOCK]: {
    label: 'In stock',
    className: 'bg-stock-in-stock/10 text-stock-in-stock',
    Icon: CheckCircle2,
  },
  [StockStatus.LOW_STOCK]: {
    label: 'Low stock',
    className: 'bg-stock-low-stock/15 text-stock-low-stock',
    Icon: AlertTriangle,
  },
  [StockStatus.OUT_OF_STOCK]: {
    label: 'Out of stock',
    className: 'bg-stock-out-of-stock/10 text-stock-out-of-stock',
    Icon: XCircle,
  },
} as const satisfies Record<StockStatusType, { label: string; className: string; Icon: typeof CheckCircle2 }>;

export interface StockStatusBadgeProps {
  status: StockStatusType;
  /** Appends the count, e.g. "Low stock · 3". */
  quantity?: number;
  className?: string;
}

export function StockStatusBadge({ status, quantity, className }: StockStatusBadgeProps) {
  const { label, className: tone, Icon } = PRESENTATION[status];

  return (
    <Badge variant="secondary" className={cn('gap-1 font-medium', tone, className)}>
      <Icon aria-hidden className="size-3" />
      <span>{label}</span>
      {quantity !== undefined ? (
        <span className="tabular font-semibold">{quantity}</span>
      ) : null}
    </Badge>
  );
}

/**
 * A signed profit figure, coloured by direction.
 *
 * The sign is always rendered, never colour alone: green and red are the most
 * common form of colour blindness, and a profit column that relies on hue to say
 * whether money came in or went out will eventually be read backwards.
 */
export function ProfitValue({
  value,
  className,
}: {
  value: string | null | undefined;
  className?: string;
}) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }

  const negative = value.startsWith('-');

  return (
    <span
      className={cn(
        'tabular font-medium',
        negative ? 'text-profit-negative' : 'text-profit-positive',
        className,
      )}
    >
      {value}
    </span>
  );
}
