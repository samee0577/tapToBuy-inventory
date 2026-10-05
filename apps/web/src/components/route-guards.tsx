import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/ui/spinner';

import { useAuth } from '@/hooks/use-auth';

/**
 * The signed-in gate.
 *
 * Two things this deliberately does *not* do:
 *
 *  1. It does not decide authorisation. Hiding a route from a Staff user is a
 *     convenience so they do not tap into an error; the real check is the
 *     `requireRole` guard on the server, which is the only thing that can be
 *     trusted. A user who edits the bundle to reveal /users still gets a 403.
 *  2. It does not redirect on the first render. Until `/auth/me` has answered,
 *     "no user" is indistinguishable from "not loaded yet", and bouncing to the
 *     login form in that window would flash the sign-in screen at a signed-in
 *     user on every cold start.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
        <span className="sr-only">Checking your session…</span>
      </div>
    );
  }

  if (!user) {
    // The attempted path is carried across so the user lands where they meant to go
    // after signing in, rather than always at the dashboard.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}

/**
 * The administrator gate, on top of authentication.
 *
 * As above: this is presentation. It exists so a Staff user is not offered a
 * screen that will refuse them, not as the control that keeps them out.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    // Replaced, not pushed: a back button that returns to a forbidden page would
    // trap the user in a loop of being bounced.
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

/**
 * A permanent prompt shown to anyone still on an administrator-issued password.
 *
 * The server does not block on this — a forgotten password must never lock someone
 * out of recording stock — so the reminder is the enforcement. It is dismissible
 * for the session but reappears on the next sign-in, because the flag lives on the
 * account rather than in the browser.
 */
export function MustChangePasswordPrompt() {
  const { user, isAdmin } = useAuth();

  if (!user?.mustChangePassword) return null;

  return (
    <div
      role="status"
      className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">You are still using a temporary password.</span>
        <span className="text-warning/80">
          Change it from your account screen. {!isAdmin ? 'Ask an administrator for access.' : ''}
        </span>
      </div>
    </div>
  );
}

/**
 * Scrolls to the top on navigation.
 *
 * A single-page app keeps the previous scroll position by default, so moving from
 * the bottom of a long product list to a new screen lands the user halfway down an
 * empty page with no obvious way back up.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);

  return null;
}
