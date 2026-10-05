import { useState } from 'react';
import { Copy, KeyRound, Plus, ShieldCheck, UserCheck, UserX } from 'lucide-react';

import type { UserDto } from '@inventory/shared';

import {
  EmptyState,
  LoadingList,
  PageHeader,
  PaginationBar,
  ResultCount,
} from '@/components/screen-parts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import {
  errorMessage,
  useCreateUser,
  useListState,
  useResetPassword,
  useUpdateUser,
  useUsers,
} from '@/hooks/use-api';
import { useAuth } from '@/hooks/use-auth';
import { initials } from '@/lib/format';

/**
 * User management, administrators only.
 *
 * The route is behind `RequireAdmin` and the server refuses everything without a
 * role check, so this screen is convenience, not control. Two consequences run
 * through the design:
 *
 *  - The last active administrator is protected by the server. Rather than
 *    reproducing that rule here — where it would be a second, driftable copy — the
 *    UI lets the attempt through and shows the server's message. A duplicated guard
 *    is a guard that eventually disagrees.
 *  - The temporary password is shown exactly once, because the server returns it
 *    exactly once. The dialog says so, and offers to copy it, rather than letting
 *    someone close the dialog and lose the only copy.
 */

const PAGE_SIZE = 25;

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const list = useListState();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<string>('all');
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<UserDto | null>(null);

  const users = useUsers(
    {
      search: search || undefined,
      role: (role === 'all' ? undefined : (role as 'ADMIN' | 'STAFF')) ?? undefined,
      // Deactivated accounts are listed too: an administrator needs to find and
      // reactivate the person who left rather than assume they never existed.
      status: 'all',
      pageSize: PAGE_SIZE,
    },
    list,
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Users"
        description="Who can sign in, and what they can do"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden data-icon="inline-start" />
            Add user
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Input
          type="search"
          value={search}
          placeholder="Search name or email"
          aria-label="Search users"
          onChange={(event) => {
            setSearch(event.target.value);
            list.setPage(1);
          }}
          className="max-w-xs"
        />

        <Select
          value={role}
          onValueChange={(value) => {
            setRole(value ?? 'all');
            list.setPage(1);
          }}
        >
          <SelectTrigger aria-label="Filter by role" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="ADMIN">Administrators</SelectItem>
            <SelectItem value="STAFF">Staff</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ResultCount
        total={users.data?.total ?? 0}
        noun="users"
        page={list.page}
        pageSize={PAGE_SIZE}
        isRefetching={users.isFetching && !users.isPending}
      />

      {users.isPending ? (
        <LoadingList rows={5} />
      ) : (users.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          filtered={search.length > 0 || role !== 'all'}
          title="No users match"
          description="Try clearing the search or role filter."
        />
      ) : (
        <>
          {/* Phones: cards, because a six-column table at 375px means sideways
              scrolling on the screen people actually use. */}
          <ul className="space-y-2 sm:hidden">
            {users.data?.items.map((user) => (
              <li key={user.id}>
                <UserCard
                  user={user}
                  isSelf={user.id === currentUser?.id}
                  onReset={() => setResetFor(user)}
                />
              </li>
            ))}
          </ul>

          <Card className="hidden overflow-hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sign-in</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.data?.items.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    isSelf={user.id === currentUser?.id}
                    onReset={() => setResetFor(user)}
                  />
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      <PaginationBar
        page={list.page}
        pageSize={PAGE_SIZE}
        total={users.data?.total ?? 0}
        onPageChange={list.setPage}
      />

      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      <ResetPasswordDialog user={resetFor} onOpenChange={(open) => !open && setResetFor(null)} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function useUserRowActions(user: UserDto) {
  const update = useUpdateUser();

  return {
    update,
    setRole: (role: 'ADMIN' | 'STAFF') => update.mutate({ id: user.id, role }),
    setActive: (isActive: boolean) => update.mutate({ id: user.id, isActive }),
  };
}

function UserRow({
  user,
  isSelf,
  onReset,
}: {
  user: UserDto;
  isSelf: boolean;
  onReset: () => void;
}) {
  const { update, setRole, setActive } = useUserRowActions(user);

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <Avatar size="sm">
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <span className="block truncate font-medium">
              {user.name}
              {isSelf ? <span className="ml-1 text-xs text-muted-foreground">(you)</span> : null}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          </div>
        </div>
      </TableCell>

      <TableCell>
        <Select
          value={user.role}
          onValueChange={(value) => setRole((value ?? 'STAFF') as 'ADMIN' | 'STAFF')}
          disabled={update.isPending}
        >
          <SelectTrigger aria-label={`${user.name} role`} className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="STAFF">Staff</SelectItem>
            <SelectItem value="ADMIN">Administrator</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>

      <TableCell>
        <div className="flex items-center gap-2">
          <Switch
            checked={user.isActive}
            disabled={update.isPending}
            aria-label={`${user.name} active`}
            onCheckedChange={(checked) => setActive(checked)}
          />
          <span className="text-xs text-muted-foreground">
            {user.isActive ? 'Active' : 'Off'}
          </span>
        </div>
      </TableCell>

      <TableCell className="text-xs text-muted-foreground">
        {user.hasGoogleAccount && !user.hasPassword ? (
          <Badge variant="outline">Google</Badge>
        ) : user.mustChangePassword ? (
          <Badge variant="secondary">Temp password</Badge>
        ) : (
          <span className="inline-flex items-center gap-1">
            <UserCheck aria-hidden className="size-3" />
            Password
          </span>
        )}
      </TableCell>

      <TableCell className="text-right">
        <Button variant="outline" size="sm" onClick={onReset}>
          <KeyRound aria-hidden data-icon="inline-start" />
          Reset password
        </Button>
        {update.error ? (
          <p className="mt-1 max-w-48 text-xs text-destructive">
            {errorMessage(update.error)}
          </p>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function UserCard({
  user,
  isSelf,
  onReset,
}: {
  user: UserDto;
  isSelf: boolean;
  onReset: () => void;
}) {
  const { update, setRole, setActive } = useUserRowActions(user);

  return (
    <Card size="sm">
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Avatar>
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {user.name}
              {isSelf ? <span className="ml-1 text-xs text-muted-foreground">(you)</span> : null}
            </p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          {!user.isActive ? <Badge variant="secondary">Off</Badge> : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor={`role-${user.id}`}>Role</FieldLabel>
            <Select
              value={user.role}
              onValueChange={(value) => setRole((value ?? 'STAFF') as 'ADMIN' | 'STAFF')}
              disabled={update.isPending}
            >
              <SelectTrigger id={`role-${user.id}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="STAFF">Staff</SelectItem>
                <SelectItem value="ADMIN">Administrator</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor={`active-${user.id}`}>Active</FieldLabel>
            <div className="flex h-8 items-center gap-2">
              <Switch
                id={`active-${user.id}`}
                checked={user.isActive}
                disabled={update.isPending}
                onCheckedChange={(checked) => setActive(checked)}
              />
              <span className="text-xs text-muted-foreground">
                {user.isActive ? 'Can sign in' : 'Cannot sign in'}
              </span>
            </div>
          </Field>
        </div>

        {update.error ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(update.error)}</AlertDescription>
          </Alert>
        ) : null}

        <Button variant="outline" size="sm" className="w-full" onClick={onReset}>
          <KeyRound aria-hidden data-icon="inline-start" />
          Reset password
        </Button>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createUser = useCreateUser();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'STAFF'>('STAFF');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        setName('');
        setEmail('');
        setPassword('');
        setRole('STAFF');
        onOpenChange(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a user</DialogTitle>
          <DialogDescription>
            They can sign in immediately with the password you set. Record it somewhere
            safe — you can reset it later.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            createUser.mutate(
              { name: name.trim(), email: email.trim(), password, role },
              {
                onSuccess: () => {
                  setName('');
                  setEmail('');
                  setPassword('');
                  setRole('STAFF');
                  onOpenChange(false);
                },
              },
            );
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="user-name">Name</FieldLabel>
              <Input
                id="user-name"
                value={name}
                maxLength={80}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="user-email">Email</FieldLabel>
              <Input
                id="user-email"
                type="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="user-password">Password</FieldLabel>
              <Input
                id="user-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <FieldDescription>
                At least 10 characters, with an uppercase letter, a lowercase letter and
                a number.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="user-role">Role</FieldLabel>
              <Select
                value={role}
                onValueChange={(value) => setRole((value ?? 'STAFF') as 'ADMIN' | 'STAFF')}
              >
                <SelectTrigger id="user-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="STAFF">Staff</SelectItem>
                  <SelectItem value="ADMIN">Administrator</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>
                Staff can record stock but cannot see buying prices or manage users.
              </FieldDescription>
            </Field>
          </FieldGroup>

          {createUser.error ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(createUser.error)}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createUser.isPending || !name.trim() || !email.trim() || !password}
            >
              {createUser.isPending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
              Create user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: UserDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const reset = useResetPassword();
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(next) => {
        if (next) return;
        setIssued(null);
        setCopied(false);
        reset.reset();
        onOpenChange(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password for {user?.name}</DialogTitle>
          <DialogDescription>
            A strong password is generated for them. It is shown once and cannot be
            retrieved afterwards.
          </DialogDescription>
        </DialogHeader>

        {issued ? (
          <div className="space-y-3">
            <Alert>
              <ShieldCheck aria-hidden />
              <AlertTitle>Temporary password</AlertTitle>
              <AlertDescription>
                Give this to {user?.name} directly. They will be asked to change it after
                signing in.
              </AlertDescription>
            </Alert>

            <div className="flex items-center gap-2">
              <code className="tabular flex-1 rounded-lg border bg-muted/50 px-3 py-2 text-sm break-all">
                {issued}
              </code>
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy password"
                onClick={() => {
                  void navigator.clipboard?.writeText(issued);
                  setCopied(true);
                }}
              >
                {copied ? <UserCheck aria-hidden /> : <Copy aria-hidden />}
              </Button>
            </div>

            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            {reset.error ? (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage(reset.error)}</AlertDescription>
              </Alert>
            ) : null}

            {user && !user.hasPassword ? (
              <Alert>
                <UserX aria-hidden />
                <AlertDescription>
                  This account signs in with Google and has no password to reset.
                </AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={reset.isPending || (user !== null && !user.hasPassword)}
                onClick={() => {
                  if (!user) return;
                  reset.mutate(user.id, {
                    onSuccess: (data) => setIssued(data.temporaryPassword),
                  });
                }}
              >
                {reset.isPending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
                Generate password
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
