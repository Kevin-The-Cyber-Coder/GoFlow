import { useState, type FormEvent } from 'react';

import { ApiError, login, profile, register, storeSession, type Session } from '../lib/api';
import { Link } from '../lib/Link';
import { Icon } from './Icon';

export type AuthMode = 'signin' | 'signup';

interface AuthFormProps {
  mode: AuthMode;
  onAuthenticated: (session: Session) => void;
}

const fieldClass =
  'w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none disabled:bg-slate-50';

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function AuthForm({ mode, onAuthenticated }: AuthFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignUp = mode === 'signup';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      if (isSignUp) {
        const result = await register({
          name: name.trim(),
          email: email.trim(),
          password,
          businessName: businessName.trim() || undefined,
        });
        const session: Session = { user: result.user, tokens: result.tokens };
        storeSession(session);
        onAuthenticated(session);
      } else {
        const tokens = await login({ email: email.trim(), password });
        const result = await profile(tokens.accessToken);
        const session: Session = { user: result.user, tokens };
        storeSession(session);
        onAuthenticated(session);
      }
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div
        className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1"
        aria-label="Account access"
      >
        <Link
          href="/login"
          aria-current={!isSignUp ? 'page' : undefined}
          className={`rounded-lg px-3 py-2.5 text-center text-sm font-semibold transition focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none ${
            isSignUp ? 'text-slate-500 hover:text-slate-700' : 'bg-white text-slate-900 shadow-sm'
          }`}
        >
          Sign in
        </Link>
        <Link
          href="/get-started"
          aria-current={isSignUp ? 'page' : undefined}
          className={`rounded-lg px-3 py-2.5 text-center text-sm font-semibold transition focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none ${
            isSignUp ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Create account
        </Link>
      </div>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        {isSignUp && (
          <div>
            <label htmlFor="auth-name" className="mb-1.5 block text-sm font-medium text-slate-700">
              Your name
            </label>
            <div className="relative">
              <Icon
                name="users"
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
              <input
                id="auth-name"
                name="name"
                type="text"
                autoComplete="name"
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ada Lovelace"
                className={fieldClass}
              />
            </div>
          </div>
        )}

        <div>
          <label htmlFor="auth-email" className="mb-1.5 block text-sm font-medium text-slate-700">
            E-mail address
          </label>
          <div className="relative">
            <Icon
              name="mail"
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
            />
            <input
              id="auth-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@studio.com"
              className={fieldClass}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="auth-password"
            className="mb-1.5 block text-sm font-medium text-slate-700"
          >
            Password
          </label>
          <div className="relative">
            <Icon
              name="lock"
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
            />
            <input
              id="auth-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              required
              minLength={isSignUp ? 10 : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={isSignUp ? 'At least 10 characters' : 'Your password'}
              className={`${fieldClass} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
            >
              <Icon name={showPassword ? 'eyeOff' : 'eye'} className="h-4 w-4" />
            </button>
          </div>
          {isSignUp && (
            <p className="mt-1.5 text-xs text-slate-500">
              Use at least 10 characters, including a letter and a number.
            </p>
          )}
        </div>

        {isSignUp && (
          <div>
            <label
              htmlFor="auth-business"
              className="mb-1.5 block text-sm font-medium text-slate-700"
            >
              Business name <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <div className="relative">
              <Icon
                name="layers"
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
              <input
                id="auth-business"
                name="organization"
                type="text"
                autoComplete="organization"
                maxLength={120}
                value={businessName}
                onChange={(event) => setBusinessName(event.target.value)}
                placeholder="Lovelace Studio"
                className={fieldClass}
              />
            </div>
          </div>
        )}

        {error !== null && (
          <div
            id="auth-error"
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
          >
            <Icon name="x" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Spinner />
              {isSignUp ? 'Creating workspace…' : 'Signing in…'}
            </>
          ) : (
            <>
              {isSignUp ? 'Create account' : 'Sign in'}
              <Icon name="arrowRight" className="h-4 w-4" />
            </>
          )}
        </button>
      </form>

      {!isSignUp && import.meta.env.DEV && (
        <button
          type="button"
          onClick={() => {
            setEmail('demo@goflow.test');
            setPassword('Password123!');
            setError(null);
          }}
          className="mt-3 w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-500 transition hover:border-brand-300 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
        >
          Fill in the seeded demo account
        </button>
      )}

      <p className="mt-5 text-center text-sm text-slate-600">
        {isSignUp ? 'Already have an account?' : 'New to GoFlow?'}{' '}
        <Link
          href={isSignUp ? '/login' : '/get-started'}
          className="font-semibold text-brand-600 underline-offset-2 hover:text-brand-700 hover:underline focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
        >
          {isSignUp ? 'Sign in instead' : 'Create one free'}
        </Link>
      </p>
    </div>
  );
}
