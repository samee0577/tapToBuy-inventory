import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ImagePlus, Loader2, Trash2, UploadCloud } from 'lucide-react';

import {
  createProductSchema,
  isMoneyString,
  type CreateProductInput,
  type ProductImageInput,
} from '@inventory/shared';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/screen-parts';
import {
  errorMessage,
  useCategoryOptions,
  useCompleteUpload,
  useCreateProduct,
  usePresignUpload,
  useProduct,
  useUpdateProduct,
} from '@/hooks/use-api';
import { useAuth } from '@/hooks/use-auth';

/**
 * Creating and editing a product.
 *
 * One screen for both, because the field set is the same and the alternative is two
 * forms to keep in step. The difference is what is writable: creating asks for
 * variants with opening stock, while editing the product leaves variants alone —
 * a variant's price and stock are inventory records, and they are changed through
 * the stock and price screens where each change is recorded against a person.
 *
 * Image upload goes direct to Cloudinary using a signature minted by the API. The
 * file never passes through Express: it is not in a request body, not in a log, and
 * not in the app's memory. What the API stores is the public id it verified.
 */

interface VariantDraft {
  key: string;
  size: string;
  color: string;
  buyingPrice: string;
  sellingPrice: string;
  initialStock: string;
}

const emptyVariant = (): VariantDraft => ({
  key: crypto.randomUUID(),
  size: '',
  color: '',
  buyingPrice: '',
  sellingPrice: '',
  initialStock: '0',
});

export function ProductFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = id !== undefined && id !== 'new';
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const categories = useCategoryOptions();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const existing = useProduct(isEditing ? id : undefined);

  const [name, setName] = useState('');
  const [productCode, setProductCode] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [variants, setVariants] = useState<VariantDraft[]>([emptyVariant()]);
  const [image, setImage] = useState<ProductImageInput | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // The edit form is seeded from the loaded product exactly once.
  //
  // Guarded by a ref rather than keyed on the query data on purpose: a background
  // refetch returns a fresh object, and an effect that re-seeded on it would wipe
  // whatever the user had typed since.
  const seeded = useRef(false);
  const loaded = existing.data;

  useEffect(() => {
    if (seeded.current || !loaded) return;
    seeded.current = true;

    setName(loaded.name);
    setProductCode(loaded.productCode);
    setCategoryId(loaded.categoryId);
    setDescription(loaded.description ?? '');

    if (loaded.imageKey && loaded.imageUrl) {
      setImage({ imageKey: loaded.imageKey, imageUrl: loaded.imageUrl });
    }
  }, [loaded]);

  const isSaving = createProduct.isPending || updateProduct.isPending;

  async function submit() {
    setFormError(null);

    if (!isEditing) {
      const payload: CreateProductInput = {
        name: name.trim(),
        productCode: productCode.trim(),
        categoryId,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(image ?? {}),
        isActive: true,
        variants: variants.map((variant) => ({
          size: variant.size.trim(),
          color: variant.color.trim(),
          buyingPrice: variant.buyingPrice.trim() || '0.00',
          sellingPrice: variant.sellingPrice.trim(),
          initialStock: Number(variant.initialStock) || 0,
        })),
      };

      // Parsed with the same schema the server uses, so the form cannot submit
      // something the API will reject with a less specific message.
      const parsed = createProductSchema.safeParse(payload);
      if (!parsed.success) {
        setFormError(parsed.error.issues[0]?.message ?? 'Check the details and try again.');
        return;
      }

      try {
        const product = await createProduct.mutateAsync(parsed.data);
        navigate(`/products/${product.id}`, { replace: true });
      } catch (error) {
        setFormError(errorMessage(error));
      }
      return;
    }

    if (!id) return;

    try {
      const product = await updateProduct.mutateAsync({
        id,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(productCode.trim() ? { productCode: productCode.trim() } : {}),
        ...(categoryId ? { categoryId } : {}),
        description: description.trim() || null,
        ...(image ? { imageKey: image.imageKey, imageUrl: image.imageUrl } : {}),
      });
      navigate(`/products/${product.id}`, { replace: true });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  if (isEditing && existing.isPending) {
    return (
      <div className="space-y-4">
        <PageHeader title="Loading product…" />
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  if (isEditing && existing.error) {
    return (
      <div className="space-y-4">
        <PageHeader title="Product" />
        <Alert variant="destructive">
          <AlertTitle>Could not load this product</AlertTitle>
          <AlertDescription>{errorMessage(existing.error)}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title={isEditing ? 'Edit product' : 'New product'}
        description={
          isEditing
            ? 'Name, code, category and photo. Variants are managed on the product screen.'
            : 'Variants, prices and opening stock, all recorded in the ledger.'
        }
      />

      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Card size="sm">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input
                  id="name"
                  value={name}
                  maxLength={120}
                  placeholder="Classic T-Shirt"
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="code">Product code</FieldLabel>
                <Input
                  id="code"
                  value={productCode}
                  maxLength={40}
                  placeholder="TS-001"
                  onChange={(event) => setProductCode(event.target.value.toUpperCase())}
                />
                <FieldDescription>
                  Stored uppercase, so codes stay unique regardless of how they are typed.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="category">Category</FieldLabel>
                <Select
                  value={categoryId || null}
                  onValueChange={(value) => setCategoryId(value ?? '')}
                >
                  <SelectTrigger id="category" className="w-full">
                    <SelectValue placeholder="Choose a category" />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {(categories.data ?? []).map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {categories.data && categories.data.length === 0 ? (
                  <FieldDescription>
                    No active categories yet. Create one first.
                  </FieldDescription>
                ) : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="description">Description (optional)</FieldLabel>
                <Textarea
                  id="description"
                  rows={3}
                  maxLength={500}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel>Photo</FieldLabel>
                <ImageField
                  image={image}
                  onChange={setImage}
                  onError={setFormError}
                />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        {!isEditing ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle>Variants</CardTitle>
              <CardDescription>
                Each size and colour is a separate stock line. Opening stock is recorded
                as a stock-in movement.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {variants.map((variant, index) => (
                <div key={variant.key} className="rounded-lg border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Variant {index + 1}
                    </span>
                    {variants.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove variant ${index + 1}`}
                        onClick={() =>
                          setVariants((current) =>
                            current.filter((item) => item.key !== variant.key),
                          )
                        }
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`size-${variant.key}`}>Size</Label>
                      <Input
                        id={`size-${variant.key}`}
                        value={variant.size}
                        maxLength={20}
                        placeholder="M"
                        onChange={(event) =>
                          setVariants((current) =>
                            current.map((item) =>
                              item.key === variant.key
                                ? { ...item, size: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`color-${variant.key}`}>Colour</Label>
                      <Input
                        id={`color-${variant.key}`}
                        value={variant.color}
                        maxLength={40}
                        placeholder="Black"
                        onChange={(event) =>
                          setVariants((current) =>
                            current.map((item) =>
                              item.key === variant.key
                                ? { ...item, color: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </div>
                    {isAdmin ? (
                      <div className="space-y-1.5">
                        <Label htmlFor={`buying-${variant.key}`}>Buying price</Label>
                        <Input
                          id={`buying-${variant.key}`}
                          inputMode="decimal"
                          value={variant.buyingPrice}
                          placeholder="400.00"
                          onChange={(event) =>
                            setVariants((current) =>
                              current.map((item) =>
                                item.key === variant.key
                                  ? { ...item, buyingPrice: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </div>
                    ) : null}
                    <div className="space-y-1.5">
                      <Label htmlFor={`selling-${variant.key}`}>Selling price</Label>
                      <Input
                        id={`selling-${variant.key}`}
                        inputMode="decimal"
                        value={variant.sellingPrice}
                        placeholder="699.00"
                        onChange={(event) =>
                          setVariants((current) =>
                            current.map((item) =>
                              item.key === variant.key
                                ? { ...item, sellingPrice: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="col-span-2 space-y-1.5">
                      <Label htmlFor={`stock-${variant.key}`}>Opening stock</Label>
                      <Input
                        id={`stock-${variant.key}`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={variant.initialStock}
                        onChange={(event) =>
                          setVariants((current) =>
                            current.map((item) =>
                              item.key === variant.key
                                ? { ...item, initialStock: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </div>
                  </div>

                  {variant.sellingPrice && !isMoneyString(variant.sellingPrice) ? (
                    <p className="mt-2 text-xs text-destructive">
                      Enter a price like 699.00
                    </p>
                  ) : null}
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setVariants((current) => [...current, emptyVariant()])}
                disabled={variants.length >= 60}
              >
                Add another variant
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => navigate(-1)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={isSaving}>
            {isSaving ? (
              <Spinner aria-hidden data-icon="inline-start" />
            ) : (
              <ImagePlus aria-hidden data-icon="inline-start" />
            )}
            {isSaving ? 'Saving…' : isEditing ? 'Save changes' : 'Create product'}
          </Button>
        </div>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ImageField({
  image,
  onChange,
  onError,
}: {
  image: ProductImageInput | null;
  onChange: (image: ProductImageInput | null) => void;
  onError: (message: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const presign = usePresignUpload();
  const complete = useCompleteUpload();
  const isBusy = presign.isPending || complete.isPending;

  async function onFileChosen(file: File) {
    onError(null);

    try {
      // Ask the API for a signature first. The size, type and destination are all
      // fixed by the ticket it returns, so the browser cannot widen any of them.
      const ticket = await presign.mutateAsync({
        contentType: file.type,
        bytes: file.size,
      });

      const body = new FormData();
      for (const [key, value] of Object.entries(ticket.fields)) {
        body.append(key, value);
      }
      body.append('file', file);

      const upload = await fetch(ticket.uploadUrl, { method: 'POST', body });
      if (!upload.ok) {
        throw new Error(`Upload failed (${upload.status}). Please try again.`);
      }

      // Verified server-side by re-reading the asset from Cloudinary. The values used
      // from here on are the stored ones, not what the browser believes it uploaded.
      const verified = await complete.mutateAsync({
        publicId: ticket.publicId,
        uploadToken: ticket.uploadToken,
      });

      onChange({ imageKey: verified.imageKey, imageUrl: verified.imageUrl });
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  return (
    <div className="space-y-2">
      {image ? (
        <div className="flex items-center gap-3">
          <img
            src={image.imageUrl}
            alt=""
            className="size-20 rounded-lg border object-cover"
          />
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={isBusy}
            >
              {isBusy ? (
                <Loader2 aria-hidden data-icon="inline-start" className="animate-spin" />
              ) : (
                <UploadCloud aria-hidden data-icon="inline-start" />
              )}
              Replace
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(null)}
              disabled={isBusy}
            >
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={isBusy}
        >
          {isBusy ? (
            <Loader2 aria-hidden data-icon="inline-start" className="animate-spin" />
          ) : (
            <UploadCloud aria-hidden data-icon="inline-start" />
          )}
          {isBusy ? 'Uploading…' : 'Add a photo'}
        </Button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so picking the same file twice fires a change event again.
          event.target.value = '';
          if (file) void onFileChosen(file);
        }}
      />

      <FieldDescription>
        JPG, PNG or WebP, at least 400px on the short side. The photo is uploaded
        directly to storage and never passes through this app's server.
      </FieldDescription>
    </div>
  );
}
