import { useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { KeyRound, LogIn, TriangleAlert } from 'lucide-react';

import { loginSchema, type LoginInput } from '@inventory/shared';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage } from '@/hooks/use-api';
import { useAuth, useSignIn } from '@/hooks/use-auth';

/**
 * Sign-in.
 *
 * The page is a hard contract with the API, not just a form: the Google callback
 * redirects the browser back to `/login?error=oauth_failed` (or `oauth_cancelled`),
 * because a JSON body served at that point would be shown to the user as raw text.
 * So the route must exist and must read `?error=` — otherwise a failed Google
 * sign-in looks like the app silently did nothing.
 *
 * That is also why a hard refresh here must not bounce: the user has to be able to
 * land on this URL while signed out and see the form.
 */

const OAUTH_ERRORS: Record<string, string> = {
  oauth_cancelled: 'Google sign-in was cancelled. Nothing has changed.',
  oauth_failed: 'Google sign-in failed. Try again, or sign in with a password.',
};

export function LoginPage() {
  const { user, isLoading } = useAuth();
  const signIn = useSignIn();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Where to land after signing in: the page the guard interrupted, so a user who
  // deep-linked into the stock screen is not thrown back to the dashboard.
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const oauthError = searchParams.get('error');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onSubmit',
  });

  /**
   * The OAuth error is cleared once shown.
   *
   * Left in the URL it survives a refresh and reappears after a later, unrelated
   * failure — claiming Google had failed when the actual problem is a mistyped
   * password. Clearing it keeps the message attached to the event that produced it.
   */
  useEffect(() => {
    if (oauthError) setSearchParams({}, { replace: true });
  }, [oauthError, setSearchParams]);

  // A signed-in user has no business here. Reached by a hard refresh or by a stale
  // back button rather than by the guard, which redirects before this renders.
  useEffect(() => {
    if (!isLoading && user) navigate(from, { replace: true });
  }, [from, isLoading, navigate, user]);

  const isBusy = isSubmitting || signIn.isPending;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        <p className="text-sm text-muted-foreground">Sign in to continue</p>
      </header>

      {oauthError ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertDescription>
            {OAUTH_ERRORS[oauthError] ?? 'Google sign-in did not complete. Please try again.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {signIn.error ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertDescription>{errorMessage(signIn.error)}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Email and password</CardTitle>
          <CardDescription>Use the account an administrator created for you.</CardDescription>
        </CardHeader>

        <CardContent>
          <form
            noValidate
            onSubmit={handleSubmit(async (values) => {
              await signIn.mutateAsync(values);
              navigate(from, { replace: true });
            })}
          >
            <FieldGroup>
              <Field data-invalid={Boolean(errors.email)}>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoFocus
                  disabled={isBusy}
                  aria-invalid={Boolean(errors.email)}
                  {...register('email')}
                />
                <FieldError errors={errors.email ? [{ message: errors.email.message }] : undefined} />
              </Field>

              <Field data-invalid={Boolean(errors.password)}>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  disabled={isBusy}
                  aria-invalid={Boolean(errors.password)}
                  {...register('password')}
                />
                <FieldError
                  errors={errors.password ? [{ message: errors.password.message }] : undefined}
                />
              </Field>

              <Button type="submit" className="w-full" disabled={isBusy}>
                {isBusy ? (
                  <Spinner aria-hidden data-icon="inline-start" />
                ) : (
                  <LogIn aria-hidden data-icon="inline-start" />
                )}
                {isBusy ? 'Signing in…' : 'Sign in'}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <KeyRound aria-hidden className="size-4" />
            Google sign-in
          </CardTitle>
          <CardDescription>
            For accounts an administrator linked to Google. The password is never typed
            into Google, and this app never sees it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* A plain link rather than a fetch. The API sets the session cookie on the
              redirect back, so driving this through JavaScript would only add a way
              for the cookie to be dropped. */}
          <Button
            variant="outline"
            className="w-full"
            render={<a href="/api/auth/google" />}
          >
            Continue with Google
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
