import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { SessionUserDto } from '@inventory/shared';

import { ApiError, apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-client';

/**
 * The signed-in user, in one place.
 *
 * There is no token in JavaScript. The session lives in an httpOnly cookie the
 * browser attaches to every request, so this context holds a *description* of who
 * is signed in — not a credential. That is what makes a cross-site request unable
 * to do anything with it, and it is also why signing out is a server call: there
 * is nothing here for the client to delete.
 *
 * The identity is read from a single /auth/me query rather than kept in component
 * state, so every screen agrees on who the user is and a role change takes effect
 * on the next navigation without any prop drilling.
 */

interface SessionResponse {
  user: SessionUserDto;
}

export interface AuthContextValue {
  user: SessionUserDto | null;
  /** True until the first /auth/me has settled, so guards can hold off redirecting. */
  isLoading: boolean;
  /** True when /auth/me answered 401: signed out, and not merely slow. */
  isSignedOut: boolean;
  isAdmin: boolean;
  /** Persists a signed-in user. Called by the login page, not by guards. */
  setSession: (user: SessionUserDto) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const session = useQuery({
    queryKey: queryKeys.session,
    queryFn: () => apiRequest<SessionResponse>('/auth/me'),
    // A 401 here is an answer, not a failure: it means signed out. Retrying would
    // hammer the API for a signed-out visitor, and the guard below handles the
    // result correctly without the query being in an error state.
    retry: false,
    staleTime: 60_000,
  });

  const signOutMutation = useMutation({
    mutationFn: () => apiRequest<{ loggedOut: boolean }>('/auth/logout', { method: 'POST' }),
    onSettled: async () => {
      // Cleared either way. If the network is down the cookie survives on the
      // server, but leaving a stale identity on screen would be a worse lie than
      // dropping the user back to the login form.
      queryClient.setQueryData(queryKeys.session, null);
      await queryClient.invalidateQueries();
    },
  });

  const setSession = useCallback(
    (user: SessionUserDto) => {
      queryClient.setQueryData<SessionResponse>(queryKeys.session, { user });
    },
    [queryClient],
  );

  const value = useMemo<AuthContextValue>(() => {
    const user = session.data?.user ?? null;
    const isSignedOut = session.error instanceof ApiError && session.error.isAuthError;

    return {
      user,
      isLoading: session.isPending,
      isSignedOut,
      isAdmin: user?.role === 'ADMIN',
      setSession,
      signOut: async () => {
        await signOutMutation.mutateAsync();
      },
    };
  }, [session.data, session.error, session.isPending, setSession, signOutMutation]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider.');
  }

  return context;
}

/**
 * Signs in, returning the user so the caller can navigate.
 *
 * Separate from the context because a component that merely renders does not need
 * the ability to sign in. Only the login form and the Google callback need this.
 */
export function useSignIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      apiRequest<SessionResponse>('/auth/login', { method: 'POST', body: input }),
    onSuccess: (data) => {
      // Seeded directly rather than refetched: the response already carries the
      // user, and a refetch would flash the signed-out UI in the moment between
      // the cookie being set and the next request going out.
      queryClient.setQueryData(queryKeys.session, data);
    },
  });
}
