import { AuthForm, type AuthMode } from '../components/AuthForm';
import { Icon, LogoMark } from '../components/Icon';
import type { Session } from '../lib/api';
import { Link } from '../lib/Link';
import { navigate } from '../lib/router';

interface AuthPageProps {
  mode: AuthMode;
  session: Session | null;
  onAuthenticated: (session: Session) => void;
  onSignOut: () => void;
}

const REPO_URL = 'https://github.com/Kevin-The-Cyber-Coder/GoFlow';

export function AuthPage({ mode, session, onAuthenticated, onSignOut }: AuthPageProps) {
  const isSignUp = mode === 'signup';

  function handleAuthenticated(next: Session) {
    onAuthenticated(next);
    navigate('/app');
  }

  return (
    <div className="flex min-h-full flex-col bg-white">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-lg focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            aria-label="GoFlow home"
          >
            <LogoMark className="h-9 w-9" />
            <span className="text-lg font-bold tracking-tight text-slate-900">GoFlow</span>
          </Link>

          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 transition hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
          >
            <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
            Back to home
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-center">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-10 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16 lg:px-8 lg:py-16">
          <section aria-label="Why GoFlow" className="hidden lg:block">
            <div className="relative overflow-hidden rounded-3xl bg-slate-950 p-10 text-white">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-24 -right-20 h-64 w-64 rounded-full bg-brand-500/25 blur-3xl"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-violet-500/20 blur-3xl"
              />

              <p className="relative text-xs font-semibold tracking-[0.16em] text-brand-300 uppercase">
                One calm workspace
              </p>
              <h2 className="relative mt-3 text-3xl font-bold tracking-tight">
                Less admin. More work you get paid for.
              </h2>
              <p className="relative mt-4 text-sm leading-relaxed text-slate-300">
                Clients, invoices, payments, expenses and reports in one place — with money handled
                as integer minor units and every change audited.
              </p>

              <ul className="relative mt-6 space-y-3">
                {[
                  'See which invoices are paid, sent or overdue.',
                  'Record partial payments without breaking a balance.',
                  'Keep every workspace isolated by design.',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-slate-200">
                    <Icon name="checkCircle" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    {item}
                  </li>
                ))}
              </ul>

              <div className="relative mt-8 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-400">INV-1042 · Northwind Studio</p>
                  <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                    Paid
                  </span>
                </div>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <p className="text-2xl font-semibold tracking-tight tabular-nums">$2,400.00</p>
                  <p className="text-xs text-slate-400">Balance $0.00</p>
                </div>
              </div>
              <p className="relative mt-5 text-[11px] text-slate-500">
                Illustrative data — no customer information.
              </p>
            </div>
          </section>

          <section aria-labelledby="auth-title" className="mx-auto w-full max-w-md">
            {session === null ? (
              <>
                <p className="text-xs font-semibold tracking-[0.16em] text-brand-600 uppercase">
                  {isSignUp ? 'Get started' : 'Sign in'}
                </p>
                <h1
                  id="auth-title"
                  className="mt-2 text-3xl font-bold tracking-tight text-slate-950"
                >
                  {isSignUp ? 'Create your workspace' : 'Welcome back'}
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  {isSignUp
                    ? 'Name your business, pick a password, and send your first invoice today.'
                    : 'Sign in to pick up where you left off.'}
                </p>

                <div className="mt-6">
                  <AuthForm key={mode} mode={mode} onAuthenticated={handleAuthenticated} />
                </div>
              </>
            ) : (
              <SignedIn session={session} isSignUp={isSignUp} onSignOut={onSignOut} />
            )}
          </section>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} GoFlow. MIT licensed.</p>
          <div className="flex flex-wrap gap-4">
            <a
              href={`${REPO_URL}/blob/main/SECURITY.md`}
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
            >
              Security model
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
            >
              Source on GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SignedIn({
  session,
  isSignUp,
  onSignOut,
}: {
  session: Session;
  isSignUp: boolean;
  onSignOut: () => void;
}) {
  const initial = session.user.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-lg font-bold text-brand-700">
        {initial}
      </span>
      <h1 id="auth-title" className="mt-4 text-2xl font-bold tracking-tight text-slate-950">
        You are already signed in.
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Signed in as <span className="font-medium text-slate-900">{session.user.email}</span>.
      </p>

      <div className="mt-6 grid gap-2">
        <Link
          href="/app"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Open dashboard
          <Icon name="arrowRight" className="h-4 w-4" />
        </Link>
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Back to home
        </Link>
        <button
          type="button"
          onClick={onSignOut}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-transparent px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
        >
          <Icon name="logOut" className="h-4 w-4" />
          Sign out
        </button>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Sign out to{' '}
        {isSignUp ? 'create a workspace for a different account' : 'use a different account'}. The
        dashboard shows the live API data for your selected workspace.
      </p>
    </div>
  );
}
