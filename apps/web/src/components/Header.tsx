import { useState } from 'react';

import type { Session } from '../lib/api';
import { Link } from '../lib/Link';
import { Icon, LogoMark } from './Icon';

interface HeaderProps {
  session: Session | null;
  onSignOut: () => void;
}

const navLinks = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#why', label: 'Why GoFlow' },
];

const REPO_URL = 'https://github.com/Kevin-The-Cyber-Coder/GoFlow';

function initials(name: string): string {
  const trimmed = name.trim();
  return trimmed.length === 0 ? '?' : trimmed.charAt(0).toUpperCase();
}

export function Header({ session, onSignOut }: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  function closeMenu() {
    setMobileOpen(false);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-lg focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          aria-label="GoFlow home"
        >
          <LogoMark className="h-9 w-9" />
          <span className="text-lg font-bold tracking-tight text-slate-900">GoFlow</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
            >
              {link.label}
            </a>
          ))}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
          >
            <Icon name="github" className="h-4 w-4" />
            GitHub
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </nav>

        <div className="hidden items-center gap-2 sm:flex">
          {session === null ? (
            <>
              <Link
                href="/login"
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
              >
                Sign in
              </Link>
              <Link
                href="/get-started"
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                Get started
                <Icon name="arrowRight" className="h-4 w-4" />
              </Link>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/app"
                title="Open dashboard"
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pr-3 pl-1 text-sm font-medium text-slate-700 shadow-sm transition hover:border-brand-300 hover:text-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                  {initials(session.user.name)}
                </span>
                <span className="max-w-40 truncate">{session.user.name}</span>
              </Link>
              <button
                type="button"
                onClick={onSignOut}
                aria-label={`Sign out of ${session.user.name}'s account`}
                title="Sign out"
                className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
              >
                <Icon name="logOut" />
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none md:hidden"
        >
          <Icon name={mobileOpen ? 'x' : 'menu'} className="h-6 w-6" />
        </button>
      </div>

      {mobileOpen && (
        <div
          id="mobile-menu"
          className="border-t border-slate-200 bg-white px-4 pt-3 pb-5 md:hidden"
        >
          <nav className="grid gap-1" aria-label="Mobile">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={closeMenu}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
              >
                {link.label}
              </a>
            ))}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              onClick={closeMenu}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <Icon name="github" className="h-4 w-4" />
              GitHub
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </nav>

          <div className="mt-4 border-t border-slate-200 pt-4">
            {session === null ? (
              <div className="grid gap-2">
                <Link
                  href="/login"
                  onClick={closeMenu}
                  className="w-full rounded-lg border border-slate-300 px-4 py-3 text-center text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Sign in
                </Link>
                <Link
                  href="/get-started"
                  onClick={closeMenu}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
                >
                  Get started
                  <Icon name="arrowRight" className="h-4 w-4" />
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                <Link
                  href="/app"
                  onClick={closeMenu}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
                >
                  Open dashboard
                  <Icon name="arrowRight" className="h-4 w-4" />
                </Link>
                <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-2">
                  <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-slate-700">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                      {initials(session.user.name)}
                    </span>
                    <span className="truncate">{session.user.name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      closeMenu();
                      onSignOut();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <Icon name="logOut" className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
