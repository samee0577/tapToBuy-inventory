import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, PackagePlus, RotateCcw, SlidersHorizontal } from 'lucide-react';

import type { StockStatus as StockStatusType } from '@inventory/shared';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { StockStatusBadge } from '@/components/stock-status-badge';
import { errorMessage, useStockOperations } from '@/hooks/use-api';
import { useAuth } from '@/hooks/use-auth';
import { money, quantity as formatQuantity } from '@/lib/format';

/**
 * The one screen a shop actually uses: record something that happened to stock.
 *
 * All four operations share this dialog because they are four answers to the same
 * question — "what changed?" — and the form shape (a quantity, optionally a reason
 * and a note) is identical. Separate screens would mean four places to fix when the
 * reason requirement changes, and four chances to forget that an adjustment is
 * administrator-only.
 *
 * The quantity field shows the resulting stock level live. Someone recording a sale
 * needs to know whether they are selling the last one, and making them remember the
 * previous figure and subtract is how an off-by-one gets written into the ledger.
 *
 * Adjustments are hidden for Staff rather than shown disabled. The server refuses
 * them, and a permanently disabled control is a question nobody asked the answer to.
 */

export type StockAction = 'stockIn' | 'sale' | 'return' | 'adjust';

const ACTIONS = {
  stockIn: {
    title: 'Record stock in',
    description: 'Goods received from a supplier.',
    Icon: ArrowDownToLine,
    quantityLabel: 'Quantity received',
    reasonLabel: 'Supplier or reference',
    reasonRequired: false,
    // A receipt is evidence, not a guess: knowing which delivery a movement belongs
    // to is the difference between reconciling a stock count and not.
    reasonPlaceholder: 'e.g. Meena Traders invoice 4471',
    cta: 'Record stock in',
  },
  sale: {
    title: 'Record a sale',
    description: 'Units leaving the shop.',
    Icon: ArrowUpFromLine,
    quantityLabel: 'Quantity sold',
    reasonLabel: undefined,
    reasonRequired: false,
    reasonPlaceholder: undefined,
    cta: 'Record sale',
  },
  return: {
    title: 'Record a return',
    description: 'Units coming back, from a customer or a supplier.',
    Icon: RotateCcw,
    quantityLabel: 'Quantity returned',
    reasonLabel: 'Reason',
    reasonRequired: false,
    reasonPlaceholder: 'e.g. Wrong size sent',
    cta: 'Record return',
  },
  adjust: {
    title: 'Adjust stock',
    description: 'Set stock to a counted figure. Every adjustment is recorded in history.',
    Icon: SlidersHorizontal,
    quantityLabel: undefined,
    reasonLabel: 'Reason for the adjustment',
    reasonRequired: true,
    reasonPlaceholder: 'e.g. Physical count, damaged in store',
    cta: 'Record adjustment',
  },
} as const satisfies Record<StockAction, unknown>;

export interface StockActionDialogProps {
  variantId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: StockAction;
  currentStock: number;
  currentStatus: StockStatusType;
  productName: string;
  size: string;
  color: string;
  /** Admin-only figures, present only when the server sent them. */
  sellingPrice?: string;
  unitProfit?: string;
  onRecorded?: (newStock: number) => void;
}

export function StockActionDialog({
  variantId,
  open,
  onOpenChange,
  action,
  currentStock,
  currentStatus,
  productName,
  size,
  color,
  sellingPrice,
  unitProfit,
  onRecorded,
}: StockActionDialogProps) {
  const operations = useStockOperations();

  const config = ACTIONS[action];
  const isAdjustment = action === 'adjust';

  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'newStock' | 'delta'>('newStock');
  const [localError, setLocalError] = useState<string | null>(null);

  // Reset on open. A dialog that remembers the last quantity is how a sale of 3
  // becomes a sale of 30.
  useEffect(() => {
    if (!open) return;
    setQuantity('');
    setReason('');
    setNote('');
    setMode('newStock');
    setLocalError(null);
    operations.stockIn.reset();
    operations.sale.reset();
    operations.returned.reset();
    operations.adjust.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutations are stable per render
  }, [open, action]);

  const parsed = Number(quantity);
  const hasQuantity = quantity.trim() !== '' && Number.isFinite(parsed) && Number.isInteger(parsed);

  /**
   * The level this operation would leave behind, shown before the user commits.
   *
   * Computed here rather than after the fact so an impossible sale — more units
   * than exist — is visible while it can still be corrected, instead of arriving as
   * a 409 from the server.
   */
  const projected = (() => {
    if (!hasQuantity) return null;
    const magnitude = Math.abs(parsed);

    if (action === 'sale') return currentStock - magnitude;
    if (action === 'return' || action === 'stockIn') return currentStock + magnitude;
    if (mode === 'delta') return currentStock + parsed;
    return parsed;
  })();

  const wouldGoNegative = projected !== null && projected < 0;

  const mutation =
    action === 'stockIn'
      ? operations.stockIn
      : action === 'sale'
        ? operations.sale
        : action === 'return'
          ? operations.returned
          : operations.adjust;

  const isBusy = mutation.isPending;

  function submit() {
    if (!variantId || !hasQuantity || projected === null) {
      setLocalError('Enter a whole number of units.');
      return;
    }

    if (wouldGoNegative) {
      setLocalError(
        `Only ${formatQuantity(currentStock)} in stock. A sale cannot take stock below zero.`,
      );
      return;
    }

    setLocalError(null);

    if (isAdjustment) {
      operations.adjust.mutate(
        {
          variantId,
          ...(mode === 'newStock'
            ? { newStock: projected, reason }
            : { delta: parsed, reason }),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        {
          onSuccess: (result) => {
            onRecorded?.(result.variant.stockQuantity);
            onOpenChange(false);
          },
        },
      );
      return;
    }

    const body =
      action === 'sale'
        ? { quantity: Math.abs(parsed), ...(note.trim() ? { note: note.trim() } : {}) }
        : {
            quantity: Math.abs(parsed),
            ...(reason.trim() ? { reason: reason.trim() } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          };

    const send =
      action === 'stockIn'
        ? operations.stockIn.mutate
        : action === 'sale'
          ? operations.sale.mutate
          : operations.returned.mutate;

    send({ variantId, ...body }, {
      onSuccess: (result) => {
        onRecorded?.(result.variant.stockQuantity);
        onOpenChange(false);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <config.Icon aria-hidden className="size-4" />
            {config.title}
          </DialogTitle>
          <DialogDescription>
            {productName} · {size} / {color}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
          <StockStatusBadge status={currentStatus} quantity={currentStock} />
          {sellingPrice ? (
            <span className="tabular text-xs text-muted-foreground">
              {money(sellingPrice)} each
              {unitProfit ? ` · ${money(unitProfit)} margin` : ''}
            </span>
          ) : null}
        </div>

        <FieldGroup>
          {isAdjustment ? (
            <Field>
              <FieldLabel>How is it counted?</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={mode === 'newStock' ? 'default' : 'outline'}
                  aria-pressed={mode === 'newStock'}
                  onClick={() => setMode('newStock')}
                >
                  Counted total
                </Button>
                <Button
                  type="button"
                  variant={mode === 'delta' ? 'default' : 'outline'}
                  aria-pressed={mode === 'delta'}
                  onClick={() => setMode('delta')}
                >
                  Correction
                </Button>
              </div>
              <FieldDescription>
                {mode === 'newStock'
                  ? 'Enter how many units are physically on the shelf.'
                  : 'Enter the change: negative to write stock off, positive to add it back.'}
              </FieldDescription>
            </Field>
          ) : null}

          <Field data-invalid={Boolean(localError) || wouldGoNegative}>
            <FieldLabel htmlFor="stock-quantity">
              {isAdjustment
                ? mode === 'newStock'
                  ? 'Counted quantity'
                  : 'Adjustment (+ or −)'
                : config.quantityLabel}
            </FieldLabel>
            <Input
              id="stock-quantity"
              type="number"
              inputMode="numeric"
              step={1}
              min={mode === 'delta' ? undefined : 0}
              autoFocus
              value={quantity}
              onChange={(event) => {
                setQuantity(event.target.value);
                setLocalError(null);
              }}
              aria-invalid={Boolean(localError) || wouldGoNegative}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            {projected !== null ? (
              <FieldDescription
                className={wouldGoNegative ? 'text-destructive' : undefined}
              >
                {wouldGoNegative
                  ? `Not enough stock — only ${formatQuantity(currentStock)} available.`
                  : `Stock after this: ${formatQuantity(projected)}`}
              </FieldDescription>
            ) : null}
            <FieldError
              errors={localError ? [{ message: localError }] : undefined}
            />
          </Field>

          {config.reasonLabel ? (
            <Field
              data-invalid={Boolean(mutation.error)}
            >
              <FieldLabel htmlFor="stock-reason">
                {config.reasonLabel}
                {config.reasonRequired ? <span className="text-destructive"> *</span> : null}
              </FieldLabel>
              <Input
                id="stock-reason"
                value={reason}
                maxLength={200}
                placeholder={config.reasonPlaceholder}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          ) : null}

          <Field>
            <FieldLabel htmlFor="stock-note">Note (optional)</FieldLabel>
            <Textarea
              id="stock-note"
              value={note}
              maxLength={280}
              rows={2}
              placeholder="Anything else worth recording"
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </FieldGroup>

        {mutation.error ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(mutation.error)}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isBusy}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={isBusy || wouldGoNegative || !hasQuantity}
          >
            {isBusy ? (
              <Spinner aria-hidden data-icon="inline-start" />
            ) : (
              <PackagePlus aria-hidden data-icon="inline-start" />
            )}
            {isBusy ? 'Recording…' : config.cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The row-level action menu.
 *
 * Which options appear is decided here rather than by each caller, so the rule
 * "adjustments are administrator-only" has exactly one home. A Staff member is
 * never offered the option at all — a greyed-out item invites a support question
 * about a control the server will refuse regardless.
 */
export function StockActionMenu({
  disabled,
  onSelect,
}: {
  disabled?: boolean;
  onSelect: (action: StockAction) => void;
}) {
  const { isAdmin } = useAuth();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="xs" onClick={() => onSelect('sale')} disabled={disabled}>
        <ArrowUpFromLine aria-hidden data-icon="inline-start" />
        Sale
      </Button>
      <Button size="xs" variant="outline" onClick={() => onSelect('return')} disabled={disabled}>
        <RotateCcw aria-hidden data-icon="inline-start" />
        Return
      </Button>
      <Button size="xs" variant="outline" onClick={() => onSelect('stockIn')} disabled={disabled}>
        <ArrowDownToLine aria-hidden data-icon="inline-start" />
        Stock in
      </Button>
      {isAdmin ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => onSelect('adjust')}
          disabled={disabled}
        >
          <SlidersHorizontal aria-hidden data-icon="inline-start" />
          Adjust
        </Button>
      ) : null}
    </div>
  );
}
