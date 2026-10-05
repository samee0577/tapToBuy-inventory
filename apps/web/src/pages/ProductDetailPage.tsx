import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, History, Pencil, Plus, Trash2 } from 'lucide-react';

import { StockStatus, hasVariantFinancials } from '@inventory/shared';

import { EmptyState, LoadingList, PageHeader } from '@/components/screen-parts';
import { StockStatusBadge } from '@/components/stock-status-badge';
import { StockActionDialog, StockActionMenu, type StockAction } from '@/components/stock-action-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  errorMessage,
  useAddVariant,
  usePriceHistory,
  useProduct,
  useUpdateProduct,
  useUpdateVariant,
} from '@/hooks/use-api';
import { useAuth } from '@/hooks/use-auth';
import { dateTime, money, quantity as formatQuantity } from '@/lib/format';

/**
 * One product: its variants, their prices, and their stock timelines.
 *
 * The tab split is by *audience*. Overview and stock are what anyone working the
 * counter needs; price history is administrator-only, so the tab is not merely
 * disabled for Staff — it is absent. A tab that says "administrators only" tells a
 * staff member they are missing something, which is worse than a screen that is
 * simply not there for them.
 */

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin } = useAuth();
  const product = useProduct(id);
  const updateProduct = useUpdateProduct();
  const updateVariant = useUpdateVariant();
  const addVariant = useAddVariant();

  const [stockAction, setStockAction] = useState<{ action: StockAction; variantId: string } | null>(null);
  const [priceFor, setPriceFor] = useState<string | undefined>(undefined);
  const [addOpen, setAddOpen] = useState(false);
  const [deactivateFor, setDeactivateFor] = useState<string | null>(null);

  if (product.isPending) {
    return (
      <div className="space-y-4">
        <PageHeader title="Loading…" />
        <LoadingList rows={3} />
      </div>
    );
  }

  if (product.error) {
    return (
      <div className="space-y-4">
        <PageHeader title="Product" />
        <EmptyState
          title="Could not load this product"
          description={errorMessage(product.error)}
          action={
            <Button variant="outline" onClick={() => void product.refetch()}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const data = product.data;
  if (!data) return null;

  // The variant the stock dialog is acting on, resolved once so every prop below
  // reads off the same row rather than re-finding it four times.
  const target = data.variants.find((variant) => variant.id === stockAction?.variantId);

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2" render={<Link to="/products" />}>
        <ArrowLeft aria-hidden data-icon="inline-start" />
        Products
      </Button>

      <PageHeader
        title={data.name}
        description={`${data.productCode} · ${data.categoryName}`}
        actions={
          <>
            {isAdmin ? (
              <Button
                variant="outline"
                size="sm"
                render={<Link to={`/products/${data.id}/edit`} />}
              >
                <Pencil aria-hidden data-icon="inline-start" />
                Edit
              </Button>
            ) : null}
            {isAdmin ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddOpen(true)}
              >
                <Plus aria-hidden data-icon="inline-start" />
                Add variant
              </Button>
            ) : null}
          </>
        }
      />

      {data.description ? <p className="text-sm text-muted-foreground">{data.description}</p> : null}

      {!data.isActive ? (
        <Alert>
          <AlertTitle>Deactivated</AlertTitle>
          <AlertDescription>
            This product is hidden from lists. Its stock and history are untouched and
            existing stock can still be sold.
          </AlertDescription>
        </Alert>
      ) : null}

      {isAdmin ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <label htmlFor="product-active" className="text-sm font-medium">
            Active
          </label>
          <Switch
            id="product-active"
            checked={data.isActive}
            disabled={updateProduct.isPending}
            onCheckedChange={(checked) =>
              updateProduct.mutate({ id: data.id, isActive: checked })
            }
          />
        </div>
      ) : null}

      {updateProduct.error ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(updateProduct.error)}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          {isAdmin ? <TabsTrigger value="prices">Prices</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="stock">
          {data.variants.length === 0 ? (
            <EmptyState
              title="No active variants"
              description={
                isAdmin
                  ? 'Add a variant with a size, colour and prices to start recording stock.'
                  : 'An administrator has not added any variants yet.'
              }
              action={
                isAdmin ? (
                  <Button onClick={() => setAddOpen(true)}>Add a variant</Button>
                ) : null
              }
            />
          ) : (
            <ul className="space-y-2">
              {data.variants.map((variant) => (
                <li key={variant.id}>
                  <Card size="sm">
                    <CardContent className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {variant.size} / {variant.color}
                          </p>
                          <p className="tabular text-xs text-muted-foreground">
                            Sells at {money(variant.sellingPrice)}
                            {hasVariantFinancials(variant)
                              ? ` · costs ${money(variant.buyingPrice)}`
                              : ''}
                          </p>
                          {hasVariantFinancials(variant) ? (
                            <p className="tabular text-xs text-muted-foreground">
                              Margin {money(variant.unitProfit)} ({variant.marginPercent}%)
                            </p>
                          ) : null}
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="tabular text-lg font-semibold">
                            {formatQuantity(variant.stockQuantity)}
                          </span>
                          <StockStatusBadge status={variant.stockStatus} />
                        </div>
                      </div>

                      <StockActionMenu
                        onSelect={(action) => setStockAction({ action, variantId: variant.id })}
                      />

                      <div className="flex flex-wrap gap-1.5 border-t pt-3">
                        {isAdmin ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => setPriceFor(variant.id)}
                          >
                            Edit prices
                          </Button>
                        ) : null}
                        <Button
                          size="xs"
                          variant="ghost"
                          render={
                            <Link to={`/history?variantId=${variant.id}`} />
                          }
                        >
                          <History aria-hidden data-icon="inline-start" />
                          History
                        </Button>
                        {isAdmin ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => setDeactivateFor(variant.id)}
                          >
                            <Trash2 aria-hidden data-icon="inline-start" />
                            {variant.isActive ? 'Deactivate' : 'Reactivate'}
                          </Button>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {isAdmin ? (
          <TabsContent value="prices">
            <PricePanel
              productId={data.id}
              variantId={priceFor ?? data.variants[0]?.id}
              mutation={updateVariant}
            />
          </TabsContent>
        ) : null}
      </Tabs>

      <StockActionDialog
        open={stockAction !== null}
        onOpenChange={(open) => {
          if (!open) setStockAction(null);
        }}
        action={stockAction?.action ?? 'sale'}
        variantId={stockAction?.variantId}
        productName={data.name}
        size={target?.size ?? ''}
        color={target?.color ?? ''}
        currentStock={target?.stockQuantity ?? 0}
        currentStatus={target?.stockStatus ?? StockStatus.OUT_OF_STOCK}
        sellingPrice={target?.sellingPrice}
        unitProfit={
          target && hasVariantFinancials(target) ? target.unitProfit : undefined
        }
      />

      <AddVariantDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        productId={data.id}
        mutation={addVariant}
      />

      <ConfirmDeactivateDialog
        variantId={deactivateFor}
        isActive={
          data.variants.find((variant) => variant.id === deactivateFor)?.isActive ?? true
        }
        mutation={updateVariant}
        onOpenChange={(open) => {
          if (!open) setDeactivateFor(null);
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function PricePanel({
  productId,
  variantId,
  mutation,
}: {
  productId: string;
  variantId: string | undefined;
  mutation: ReturnType<typeof useUpdateVariant>;
}) {
  const history = usePriceHistory(productId, variantId, variantId !== undefined);
  const [sellingPrice, setSellingPrice] = useState('');
  const [buyingPrice, setBuyingPrice] = useState('');

  if (!variantId) {
    return <p className="text-sm text-muted-foreground">Add a variant first.</p>;
  }

  return (
    <div className="space-y-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Change prices</CardTitle>
          <CardDescription>
            A change is recorded in the price history, with your name against it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate({
                id: variantId,
                ...(sellingPrice.trim() ? { sellingPrice: sellingPrice.trim() } : {}),
                ...(buyingPrice.trim() ? { buyingPrice: buyingPrice.trim() } : {}),
              });
              setSellingPrice('');
              setBuyingPrice('');
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="selling-price">Selling price</Label>
                <Input
                  id="selling-price"
                  inputMode="decimal"
                  placeholder={history.data?.currentSellingPrice ?? '0.00'}
                  value={sellingPrice}
                  onChange={(event) => setSellingPrice(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="buying-price">Buying price</Label>
                <Input
                  id="buying-price"
                  inputMode="decimal"
                  placeholder={history.data?.currentBuyingPrice ?? '0.00'}
                  value={buyingPrice}
                  onChange={(event) => setBuyingPrice(event.target.value)}
                />
              </div>
            </div>

            {mutation.error ? (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage(mutation.error)}</AlertDescription>
              </Alert>
            ) : null}

            <Button
              type="submit"
              size="sm"
              disabled={mutation.isPending || (!sellingPrice.trim() && !buyingPrice.trim())}
            >
              {mutation.isPending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
              Save prices
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Price history</CardTitle>
        </CardHeader>
        <CardContent>
          {history.isPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (history.data?.entries.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No price changes recorded.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Selling</TableHead>
                  <TableHead>Buying</TableHead>
                  <TableHead>Changed by</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.data?.entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="tabular text-sm">
                      {entry.oldSellingPrice === null ? (
                        <span className="text-muted-foreground">
                          set to {money(entry.newSellingPrice)}
                        </span>
                      ) : (
                        <>
                          <span className="text-muted-foreground line-through">
                            {money(entry.oldSellingPrice)}
                          </span>{' '}
                          {money(entry.newSellingPrice)}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-sm">
                      {entry.oldBuyingPrice === null ? (
                        <span className="text-muted-foreground">
                          set to {money(entry.newBuyingPrice)}
                        </span>
                      ) : (
                        <>
                          <span className="text-muted-foreground line-through">
                            {money(entry.oldBuyingPrice)}
                          </span>{' '}
                          {money(entry.newBuyingPrice)}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.changedBy.name}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {dateTime(entry.changedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function AddVariantDialog({
  open,
  onOpenChange,
  productId,
  mutation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  mutation: ReturnType<typeof useAddVariant>;
}) {
  const [size, setSize] = useState('');
  const [color, setColor] = useState('');
  const [buyingPrice, setBuyingPrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [initialStock, setInitialStock] = useState('0');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        setSize('');
        setColor('');
        setBuyingPrice('');
        setSellingPrice('');
        setInitialStock('0');
        onOpenChange(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a variant</DialogTitle>
          <DialogDescription>
            Opening stock is recorded as a stock-in movement, not set silently.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate(
              {
                productId,
                size: size.trim(),
                color: color.trim(),
                buyingPrice: buyingPrice.trim(),
                sellingPrice: sellingPrice.trim(),
                initialStock: Number(initialStock) || 0,
              },
              {
                onSuccess: () => {
                  setSize('');
                  setColor('');
                  setBuyingPrice('');
                  setSellingPrice('');
                  setInitialStock('0');
                  onOpenChange(false);
                },
              },
            );
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="variant-size">Size</Label>
              <Input
                id="variant-size"
                value={size}
                maxLength={20}
                placeholder="M"
                onChange={(event) => setSize(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="variant-color">Colour</Label>
              <Input
                id="variant-color"
                value={color}
                maxLength={40}
                placeholder="Black"
                onChange={(event) => setColor(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="variant-buying">Buying price</Label>
              <Input
                id="variant-buying"
                inputMode="decimal"
                value={buyingPrice}
                placeholder="400.00"
                onChange={(event) => setBuyingPrice(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="variant-selling">Selling price</Label>
              <Input
                id="variant-selling"
                inputMode="decimal"
                value={sellingPrice}
                placeholder="699.00"
                onChange={(event) => setSellingPrice(event.target.value)}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="variant-stock">Opening stock</Label>
              <Input
                id="variant-stock"
                type="number"
                inputMode="numeric"
                min={0}
                value={initialStock}
                onChange={(event) => setInitialStock(event.target.value)}
              />
            </div>
          </div>

          {mutation.error ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(mutation.error)}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                mutation.isPending || !size.trim() || !color.trim() || !sellingPrice.trim()
              }
            >
              {mutation.isPending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
              Add variant
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function ConfirmDeactivateDialog({
  variantId,
  isActive,
  mutation,
  onOpenChange,
}: {
  variantId: string | null;
  isActive: boolean;
  mutation: ReturnType<typeof useUpdateVariant>;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={variantId !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isActive ? 'Deactivate this variant?' : 'Reactivate this variant?'}</DialogTitle>
          <DialogDescription>
            {isActive
              ? 'It stops appearing in lists. Its stock, sales and history are kept, and existing stock can still be sold. It cannot be deleted.'
              : 'It will appear in lists again.'}
          </DialogDescription>
        </DialogHeader>

        <Separator />

        {mutation.error ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(mutation.error)}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={isActive ? 'destructive' : 'default'}
            disabled={mutation.isPending}
            onClick={() => {
              if (!variantId) return;
              mutation.mutate(
                { id: variantId, isActive: !isActive },
                { onSuccess: () => onOpenChange(false) },
              );
            }}
          >
            {mutation.isPending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
            {isActive ? 'Deactivate' : 'Reactivate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
