import { useState } from 'react';
import { Package, Plus, Tags } from 'lucide-react';

import type { CategoryDto } from '@inventory/shared';

import {
  EmptyState,
  LoadingList,
  PageHeader,
  PaginationBar,
  ResultCount,
} from '@/components/screen-parts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage, useCategories, useCreateCategory, useListState, useUpdateCategory } from '@/hooks/use-api';
import { dateTime } from '@/lib/format';

/**
 * Categories.
 *
 * Open to both roles, matching the server: the taxonomy carries no financial data
 * and a shop where only an administrator can rename "Shirts" is a shop with a
 * worse catalogue. Creating a variant does introduce a buying price, so *that* is
 * administrator-only — the distinction the server draws, drawn here too.
 *
 * There is no delete. A category holding products must be deactivated instead, and
 * the foreign key on the server would refuse a hard delete regardless. The UI
 * offers the operation that actually works rather than one that 409s.
 */

const PAGE_SIZE = 25;

export function CategoriesPage() {
  const list = useListState();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CategoryDto | null>(null);
  const [creating, setCreating] = useState(false);

  const categories = useCategories({
    search: search || undefined,
    status: 'all',
    page: list.page,
    pageSize: PAGE_SIZE,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Categories"
        description="How the catalogue is grouped"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden data-icon="inline-start" />
            New category
          </Button>
        }
      />

      <Input
        type="search"
        value={search}
        placeholder="Search categories"
        aria-label="Search categories"
        onChange={(event) => {
          setSearch(event.target.value);
          list.setPage(1);
        }}
        className="max-w-xs"
      />

      <ResultCount
        total={categories.data?.total ?? 0}
        noun="categories"
        page={list.page}
        pageSize={PAGE_SIZE}
        isRefetching={categories.isFetching && !categories.isPending}
      />

      {categories.isPending ? (
        <LoadingList rows={5} />
      ) : (categories.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          filtered={search.length > 0}
          title={search ? 'No categories match' : 'No categories yet'}
          description={
            search
              ? 'Try a different search term.'
              : 'Categories group products. Add the first one.'
          }
          action={
            search ? null : (
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden data-icon="inline-start" />
                Add a category
              </Button>
            )
          }
        />
      ) : (
        <ul className="space-y-2">
          {categories.data?.items.map((category) => (
            <li key={category.id}>
              <CategoryRow category={category} onEdit={() => setEditing(category)} />
            </li>
          ))}
        </ul>
      )}

      <PaginationBar
        page={list.page}
        pageSize={PAGE_SIZE}
        total={categories.data?.total ?? 0}
        onPageChange={list.setPage}
      />

      <CategoryDialog
        open={creating}
        onOpenChange={setCreating}
        mode="create"
        mutation={createCategory}
        title="New category"
        description="Group products that belong together."
      />

      <CategoryDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        mode="edit"
        mutation={updateCategory}
        category={editing}
        title="Edit category"
        description="Renaming a category does not change any product."
      />
    </div>
  );
}

/**
 * The two category mutations share a dialog, so the dialog takes the shape both
 * satisfy rather than one of them: same `mutate`/`isPending`/`error` surface,
 * different variables. The cast at the call site is where the difference is
 * expressed, once, instead of branching inside the form.
 */
type CategoryMutation =
  | ReturnType<typeof useCreateCategory>
  | ReturnType<typeof useUpdateCategory>;

function CategoryRow({
  category,
  onEdit,
}: {
  category: CategoryDto;
  onEdit: () => void;
}) {
  const update = useUpdateCategory();

  return (
    <Card size="sm">
      <CardContent className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Tags aria-hidden className="size-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{category.name}</span>
            {!category.isActive ? (
              <Badge variant="secondary">Deactivated</Badge>
            ) : null}
            {category.productCount > 0 ? (
              <Badge variant="outline" className="gap-1">
                <Package aria-hidden />
                {category.productCount}
              </Badge>
            ) : null}
          </div>

          {category.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {category.description}
            </p>
          ) : null}

          <p className="mt-1 text-xs text-muted-foreground">
            Updated {dateTime(category.updatedAt)}
          </p>

          {update.error ? (
            <p className="mt-1 text-xs text-destructive">{errorMessage(update.error)}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Active
            <Switch
              checked={category.isActive}
              disabled={update.isPending}
              aria-label={`${category.name} active`}
              onCheckedChange={(checked) =>
                update.mutate({ id: category.id, isActive: checked })
              }
            />
          </label>
        </div>
      </CardContent>
    </Card>
  );
}

function CategoryDialog({
  open,
  onOpenChange,
  mode,
  mutation,
  category,
  title,
  description,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  mutation: CategoryMutation;
  category?: CategoryDto | null;
  title: string;
  description: string;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [body, setBody] = useState(category?.description ?? '');

  // Re-seeded on open so cancelling out leaves the previous values untouched,
  // rather than stranding half-typed text for the next time the dialog opens.
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setName(category?.name ?? '');
      setBody(category?.description ?? '');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const payload = { name: name.trim(), description: body.trim() || undefined };

            if (mode === 'edit' && category) {
              mutation.mutate(
                { id: category.id, ...payload } as never,
                { onSuccess: () => onOpenChange(false) },
              );
            } else {
              mutation.mutate(payload as never, {
                onSuccess: () => onOpenChange(false),
              });
            }
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="category-name">Name</FieldLabel>
              <Input
                id="category-name"
                value={name}
                maxLength={60}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="category-description">Description (optional)</FieldLabel>
              <Textarea
                id="category-description"
                rows={2}
                maxLength={280}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </Field>
          </FieldGroup>

          {mutation.error ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(mutation.error)}</AlertDescription>
            </Alert>
          ) : null}

          {category && category.productCount > 0 ? (
            <FieldDescription>
              Deactivating hides this category from the product form. Products already in
              it keep their stock and history.
            </FieldDescription>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || !name.trim()}>
              {mutation.isPending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
              {mode === 'create' ? 'Create' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
