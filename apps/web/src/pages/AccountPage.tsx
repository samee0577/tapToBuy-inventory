import { useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';

import { PageHeader } from '@/components/screen-parts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage, useChangePassword } from '@/hooks/use-api';
import { useAuth } from '@/hooks/use-auth';
import { initials } from '@/lib/format';

/**
 * The account screen: who you are, and changing your own password.
 *
 * Password change lives on every user's own screen rather than only in
 * administration, because an administrator resetting their own password is a
 * circular thing to have to ask a colleague for. The server allows it precisely
 * because a locked-out administrator has no other way back in.
 *
 * The temporary-password reminder is not a form field but a banner, because the
 * server does not block on it — a forgotten password must never lock someone out
 * of recording stock. The prompt is the only enforcement, so it lives in the shell
 * and stays visible on every screen until it is dealt with.
 */
export function AccountPage() {
  const { user, isAdmin, signOut } = useAuth();
  const changePassword = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  if (!user) return null;

  const mismatch = confirmation.length > 0 && confirmation !== newPassword;
  const canSubmit =
    currentPassword.length > 0 && newPassword.length >= 10 && !mismatch && !changePassword.isPending;

  return (
    <div className="space-y-4">
      <PageHeader title="Account" description="Your details and sign-in" />

      <Card size="sm">
        <CardContent className="flex items-center gap-3">
          <Avatar className="size-12">
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{user.name}</p>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          </div>
          <Badge variant={isAdmin ? 'default' : 'secondary'}>
            {isAdmin ? 'Administrator' : 'Staff'}
          </Badge>
        </CardContent>
      </Card>

      {user.mustChangePassword ? (
        <Alert>
          <ShieldCheck aria-hidden />
          <AlertTitle>You are using a temporary password</AlertTitle>
          <AlertDescription>
            Set your own password below. Until you do, you can still use the app, but
            this reminder will be on every screen.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card size="sm">
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>
            You will stay signed in. Any other session you have open is not affected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (mismatch) return;

              changePassword.mutate(
                { currentPassword, newPassword },
                {
                  onSuccess: () => {
                    setCurrentPassword('');
                    setNewPassword('');
                    setConfirmation('');
                  },
                },
              );
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="current-password">Current password</FieldLabel>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </Field>

              <Field data-invalid={mismatch}>
                <FieldLabel htmlFor="new-password">New password</FieldLabel>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <FieldDescription>
                  At least 10 characters, with an uppercase letter, a lowercase letter
                  and a number.
                </FieldDescription>
              </Field>

              <Field data-invalid={mismatch}>
                <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
                {mismatch ? (
                  <FieldDescription className="text-destructive">
                    The two passwords do not match.
                  </FieldDescription>
                ) : null}
              </Field>
            </FieldGroup>

            {changePassword.error ? (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage(changePassword.error)}</AlertDescription>
              </Alert>
            ) : null}

            {changePassword.isSuccess ? (
              <Alert>
                <KeyRound aria-hidden />
                <AlertDescription>Password changed.</AlertDescription>
              </Alert>
            ) : null}

            <Button type="submit" disabled={!canSubmit}>
              {changePassword.isPending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
              Change password
            </Button>
          </form>
        </CardContent>
      </Card>

      <Separator />

      <Card size="sm">
        <CardContent className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Sign out</p>
            <p className="text-xs text-muted-foreground">
              Ends this session on this device.
            </p>
          </div>
          <Button variant="outline" onClick={() => void signOut()}>
            <LogOut aria-hidden data-icon="inline-start" />
            Sign out
          </Button>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Sessions expire automatically. To change someone else's password, an
        administrator can issue a temporary one from{' '}
        {isAdmin ? <Link to="/users" className="underline">user management</Link> : 'user management'}.
      </p>
    </div>
  );
}
