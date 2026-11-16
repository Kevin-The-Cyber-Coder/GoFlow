import { useCallback, useEffect, useState } from 'react';

import {
  clearStoredSession,
  logout,
  profile,
  readStoredSession,
  storeSession,
  type Session,
} from './lib/api';
import { Link } from './lib/Link';
import { usePathname } from './lib/router';
import { AuthPage } from './pages/AuthPage';
import { Home } from './pages/Home';
import { Icon } from './components/Icon';

const HOME_TITLE = 'GoFlow — your freelance business in one workspace';

export function App() {
  const path = usePathname();
  const [session, setSession] = useState<Session | null>(() => readStoredSession());

  const handleAuthenticated = useCallback((next: Session) => {
    setSession(next);
  }, []);

  const handleSignOut = useCallback(() => {
    const stored = readStoredSession();
    clearStoredSession();
    setSession(null);

    if (stored !== null) {
      void logout(stored.tokens.refreshToken).catch(() => undefined);
    }
  }, []);

  // A stored session is shown immediately, then revalidated against the API.
  // If the token was revoked or expired, the stale session is cleared quietly.
  useEffect(() => {
    const stored = readStoredSession();
    if (stored === null) return;

    let cancelled = false;

    profile(stored.tokens.accessToken)
      .then((result) => {
        if (cancelled) return;
        const next: Session = { user: result.user, tokens: stored.tokens };
        storeSession(next);
        setSession(next);
      })
      .catch(() => {
        if (cancelled) return;
        clearStoredSession();
        setSession(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (path === '/login') {
      document.title = 'Sign in · GoFlow';
    } else if (path === '/get-started' || path === '/register') {
      document.title = 'Get started · GoFlow';
    } else if (path === '/') {
      document.title = HOME_TITLE;
    } else {
      document.title = 'Page not found · GoFlow';
    }
  }, [path]);

  if (path === '/login' || path === '/get-started' || path === '/register') {
    return (
      <AuthPage
        mode={path === '/login' ? 'signin' : 'signup'}
        session={session}
        onAuthenticated={handleAuthenticated}
        onSignOut={handleSignOut}
      />
    );
  }

  if (path === '/') {
    return <Home session={session} onSignOut={handleSignOut} />;
  }

  return <NotFound />;
}

function NotFound() {
  return (
    <main className="flex min-h-full flex-col items-center justify-center bg-white px-6 py-16 text-center">
      <p className="text-xs font-semibold tracking-[0.16em] text-brand-600 uppercase">404</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
        That page took a wrong turn.
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-600">
        The link may be old, or the page may not exist yet. The home page is still where it should
        be.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/25 transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
        Back to home
      </Link>
    </main>
  );
}
