import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Icon, LogoMark, type IconName } from '../components/Icon';
import {
  ApiError,
  getWorkspace,
  listInvoices,
  listWorkspaces,
  readStoredWorkspaceId,
  reportSummary,
  storeWorkspaceId,
  type InvoiceListItem,
  type InvoiceList,
  type ReportSummary,
  type Session,
  type WorkspaceDetail,
  type WorkspaceSummary,
} from '../lib/api';
import { formatDate, formatMoney, humanise } from '../lib/format';
import { Link } from '../lib/Link';

type Period = 'month' | '30d' | 'year';

type Loadable<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string; forbidden: boolean };

interface DashboardProps {
  session: Session;
  onSignOut: () => void;
  onRefreshSession: () => Promise<Session | null>;
}

const PERIODS: ReadonlyArray<{ id: Period; label: string }> = [
  { id: 'month', label: 'This month' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'year', label: 'This year' },
];

const NAV_ITEMS: ReadonlyArray<{ label: string; icon: IconName; current?: boolean }> = [
  { label: 'Overview', icon: 'pieChart', current: true },
  { label: 'Clients', icon: 'users' },
  { label: 'Projects', icon: 'layers' },
  { label: 'Time tracking', icon: 'clock' },
  { label: 'Invoices', icon: 'fileText' },
  { label: 'Expenses', icon: 'receipt' },
  { label: 'Reports', icon: 'trendingUp' },
  { label: 'Team', icon: 'shieldCheck' },
];

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function periodRange(period: Period): { from: string; to: string; label: string } {
  const today = new Date();
  const to = isoDate(today);

  if (period === 'month') {
    return {
      from: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
      to,
      label: 'this month',
    };
  }

  if (period === '30d') {
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    return { from: isoDate(start), to, label: 'the last 30 days' };
  }

  return { from: isoDate(new Date(today.getFullYear(), 0, 1)), to, label: 'this year' };
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'Your role does not have access to this data.';
    if (error.status === 0) return error.message;
    return error.message;
  }
  return 'Something went wrong while loading this section.';
}

function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

function toLoadable<T>(result: PromiseSettledResult<T>): Loadable<T> {
  if (result.status === 'fulfilled') {
    return { status: 'ready', data: result.value };
  }
  return {
    status: 'error',
    message: errorMessage(result.reason),
    forbidden: isForbidden(result.reason),
  };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function Dashboard({ session, onSignOut, onRefreshSession }: DashboardProps) {
  const [workspaces, setWorkspaces] = useState<Loadable<WorkspaceSummary[]>>({
    status: 'loading',
  });
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('month');
  const [reloadKey, setReloadKey] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [detail, setDetail] = useState<Loadable<WorkspaceDetail>>({ status: 'loading' });
  const [summary, setSummary] = useState<Loadable<ReportSummary>>({ status: 'loading' });
  const [invoices, setInvoices] = useState<Loadable<InvoiceList>>({ status: 'loading' });

  const accessToken = session.tokens.accessToken;

  // A 401 usually means the access token expired. The workspace effect and the
  // data effect can see the same expiry at the same time, so they share one
  // refresh: refresh tokens rotate, and a second rotation would fail (and used
  // to sign the user out while the first refresh was still in flight). The
  // resolved promise is kept per access token, so a late 401 from an
  // already-refreshed request reuses the outcome instead of refreshing again.
  const recovery = useRef<{ token: string; promise: Promise<Session | null> } | null>(null);

  const recover = useCallback(
    async (error: unknown): Promise<boolean> => {
      if (!isUnauthorized(error)) return false;

      if (recovery.current === null || recovery.current.token !== accessToken) {
        recovery.current = { token: accessToken, promise: onRefreshSession() };
      }

      const next = await recovery.current.promise;
      if (next === null) onSignOut();
      return true;
    },
    [accessToken, onRefreshSession, onSignOut],
  );

  useEffect(() => {
    let cancelled = false;

    listWorkspaces(accessToken)
      .then((result) => {
        if (cancelled) return;
        setWorkspaces({ status: 'ready', data: result.workspaces });
        setWorkspaceId((current) => {
          const preferred = current ?? readStoredWorkspaceId();
          const match = result.workspaces.find((workspace) => workspace.id === preferred);
          return match?.id ?? result.workspaces[0]?.id ?? null;
        });
      })
      .catch(async (error: unknown) => {
        if (cancelled) return;
        if (await recover(error)) return;
        setWorkspaces({ status: 'error', message: errorMessage(error), forbidden: false });
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, recover, reloadKey]);

  useEffect(() => {
    if (workspaceId !== null) storeWorkspaceId(workspaceId);
  }, [workspaceId]);

  const range = useMemo(() => periodRange(period), [period]);

  useEffect(() => {
    if (workspaceId === null) return;

    let cancelled = false;

    void Promise.allSettled([
      getWorkspace(accessToken, workspaceId),
      reportSummary(accessToken, workspaceId, range),
      listInvoices(accessToken, workspaceId, { pageSize: 5, sort: 'issueDate', order: 'desc' }),
    ]).then(async ([detailResult, summaryResult, invoicesResult]) => {
      if (cancelled) return;

      const results: Array<PromiseSettledResult<unknown>> = [
        detailResult,
        summaryResult,
        invoicesResult,
      ];
      const unauthorized = results.find(
        (result) => result.status === 'rejected' && isUnauthorized(result.reason),
      );
      if (unauthorized !== undefined && unauthorized.status === 'rejected') {
        if (await recover(unauthorized.reason)) return;
      }

      setDetail(toLoadable(detailResult));
      setSummary(toLoadable(summaryResult));
      setInvoices(toLoadable(invoicesResult));
    });

    return () => {
      cancelled = true;
    };
  }, [accessToken, range, recover, reloadKey, workspaceId]);

  const workspaceList = workspaces.status === 'ready' ? workspaces.data : [];
  const selected = workspaceList.find((workspace) => workspace.id === workspaceId) ?? null;
  const currency =
    detail.status === 'ready'
      ? detail.data.currency
      : (selected?.currency ?? session.user.currency ?? 'USD');
  const workspaceName =
    detail.status === 'ready' ? detail.data.name : (selected?.name ?? 'Workspace');

  function resetData() {
    setDetail({ status: 'loading' });
    setSummary({ status: 'loading' });
    setInvoices({ status: 'loading' });
  }

  function reload() {
    resetData();
    setReloadKey((value) => value + 1);
  }

  function changeWorkspace(id: string) {
    resetData();
    setWorkspaceId(id);
    setMobileNavOpen(false);
  }

  function changePeriod(next: Period) {
    if (next === period) return;
    setSummary({ status: 'loading' });
    setPeriod(next);
  }

  return (
    <div className="min-h-full bg-slate-50">
      <a
        href="#dashboard-main"
        className="sr-only rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to dashboard
      </a>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 flex-col border-r border-slate-200 bg-white lg:flex">
        <SidebarContent
          session={session}
          workspaces={workspaceList}
          workspaceId={workspaceId}
          onWorkspaceChange={changeWorkspace}
          onSignOut={onSignOut}
        />
      </aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close dashboard menu"
            onClick={() => setMobileNavOpen(false)}
            className="absolute inset-0 bg-slate-950/40"
          />
          <aside className="relative flex h-full w-72 max-w-[85%] flex-col bg-white shadow-2xl">
            <SidebarContent
              session={session}
              workspaces={workspaceList}
              workspaceId={workspaceId}
              onWorkspaceChange={changeWorkspace}
              onSignOut={onSignOut}
              onNavigate={() => setMobileNavOpen(false)}
            />
          </aside>
        </div>
      )}

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6 lg:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open dashboard menu"
              className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none lg:hidden"
            >
              <Icon name="menu" className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-xs text-slate-500">{workspaceName}</p>
              <h1 className="text-sm font-semibold text-slate-900">Overview</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none sm:inline-flex"
            >
              View site
            </Link>
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pr-3 pl-1 text-sm font-medium text-slate-700 shadow-sm">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                {initials(session.user.name)}
              </span>
              <span className="hidden max-w-40 truncate sm:inline">{session.user.name}</span>
            </span>
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Sign out"
              title="Sign out"
              className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
            >
              <Icon name="logOut" />
            </button>
          </div>
        </header>

        <main id="dashboard-main" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-brand-700">
                {greeting()}, {firstName(session.user.name)}
              </p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
                Here is where your business stands.
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                {workspaceName} · {currency} · {range.label}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div
                role="group"
                aria-label="Report period"
                className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
              >
                {PERIODS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => changePeriod(option.id)}
                    aria-pressed={period === option.id}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none sm:text-sm ${
                      period === option.id
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={reload}
                aria-label="Refresh dashboard data"
                title="Refresh"
                className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
              >
                <Icon name="refresh" className="h-4 w-4" />
              </button>
            </div>
          </div>

          {workspaces.status === 'error' && (
            <Banner message={workspaces.message} onRetry={reload} />
          )}

          {workspaces.status === 'ready' && workspaceList.length === 0 && (
            <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <Icon name="layers" className="h-6 w-6" />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">
                No workspace is attached to this account yet.
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
                Create a workspace to start adding clients, projects and invoices.
              </p>
              <Link
                href="/get-started"
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                Create a workspace
                <Icon name="arrowRight" className="h-4 w-4" />
              </Link>
            </section>
          )}

          {workspaceId !== null && (
            <>
              <section
                aria-label="Money summary"
                className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
              >
                <StatCard
                  label="Income"
                  icon="trendingUp"
                  tone="emerald"
                  state={summary}
                  value={(data) =>
                    formatMoney(data.incomeMinor, data.currency, session.user.locale)
                  }
                  hint={(data) =>
                    `${data.paymentCount} ${data.paymentCount === 1 ? 'payment' : 'payments'} recorded`
                  }
                />
                <StatCard
                  label="Expenses"
                  icon="receipt"
                  tone="amber"
                  state={summary}
                  value={(data) =>
                    formatMoney(data.expensesMinor, data.currency, session.user.locale)
                  }
                  hint={(data) =>
                    `${data.expenseCount} approved ${data.expenseCount === 1 ? 'expense' : 'expenses'}`
                  }
                />
                <StatCard
                  label="Net"
                  icon="wallet"
                  tone="brand"
                  state={summary}
                  value={(data) => formatMoney(data.netMinor, data.currency, session.user.locale)}
                  hint={() => 'Income minus approved expenses'}
                />
                <StatCard
                  label="Outstanding"
                  icon="clock"
                  tone="rose"
                  state={summary}
                  value={(data) =>
                    formatMoney(data.outstandingMinor, data.currency, session.user.locale)
                  }
                  hint={(data) =>
                    `${data.outstandingInvoiceCount} open ${
                      data.outstandingInvoiceCount === 1 ? 'invoice' : 'invoices'
                    }`
                  }
                />
              </section>

              <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
                <RecentInvoices state={invoices} locale={session.user.locale} onRetry={reload} />

                <div className="space-y-6">
                  <WorkspaceCard
                    state={detail}
                    role={selected?.role}
                    memberCount={selected?.memberCount}
                    onRetry={reload}
                  />

                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-sm font-semibold text-slate-900">What is next</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      This overview reads live data today. The rest of the workspace is on the way.
                    </p>
                    <ul className="mt-4 space-y-3">
                      {[
                        { icon: 'users' as IconName, label: 'Client management' },
                        { icon: 'fileText' as IconName, label: 'Invoice creation and sending' },
                        { icon: 'wallet' as IconName, label: 'Payment recording' },
                        { icon: 'pieChart' as IconName, label: 'Report exports' },
                      ].map((item) => (
                        <li key={item.label} className="flex items-center gap-2.5 text-sm">
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                            <Icon name={item.icon} className="h-4 w-4" />
                          </span>
                          <span className="flex-1 text-slate-700">{item.label}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                            Soon
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              </div>

              <p className="mt-6 text-xs leading-relaxed text-slate-500">
                The summary counts completed payments, approved expenses and unpaid amounts on open
                invoices issued {range.label}. Money is stored and displayed as integer minor units
                in {currency}.
              </p>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function SidebarContent({
  session,
  workspaces,
  workspaceId,
  onWorkspaceChange,
  onSignOut,
  onNavigate,
}: {
  session: Session;
  workspaces: WorkspaceSummary[];
  workspaceId: string | null;
  onWorkspaceChange: (id: string) => void;
  onSignOut: () => void;
  onNavigate?: () => void;
}) {
  const selected = workspaces.find((workspace) => workspace.id === workspaceId) ?? null;

  return (
    <>
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-100 px-5">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-lg focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
          aria-label="GoFlow home"
        >
          <LogoMark className="h-8 w-8" />
          <span className="text-lg font-bold tracking-tight text-slate-900">GoFlow</span>
        </Link>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700 uppercase">
          Live
        </span>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5">
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
            Workspace
          </p>

          {workspaces.length > 1 ? (
            <label className="mt-2 block">
              <span className="sr-only">Choose a workspace</span>
              <div className="relative">
                <select
                  value={workspaceId ?? ''}
                  onChange={(event) => onWorkspaceChange(event.target.value)}
                  className="w-full appearance-none rounded-lg border border-slate-300 bg-white py-2 pr-8 pl-3 text-sm font-semibold text-slate-900 shadow-sm transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
                <Icon
                  name="arrowDown"
                  className="pointer-events-none absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 text-slate-400"
                />
              </div>
            </label>
          ) : (
            <p className="mt-2 truncate text-sm font-semibold text-slate-900">
              {selected?.name ?? 'Loading workspace…'}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {selected !== null && (
              <span className="rounded-full bg-white px-2 py-0.5 font-medium text-slate-600 shadow-sm">
                {humanise(selected.role)}
              </span>
            )}
            <span>{selected?.currency ?? session.user.currency}</span>
          </div>
        </div>

        <nav aria-label="Workspace">
          <p className="px-3 text-[10px] font-semibold tracking-[0.14em] text-slate-400 uppercase">
            Workspace
          </p>
          <ul className="mt-2 space-y-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.label}>
                {item.current === true ? (
                  <span
                    aria-current="page"
                    className="flex items-center gap-2.5 rounded-lg bg-brand-50 px-3 py-2.5 text-sm font-semibold text-brand-800"
                  >
                    <Icon name={item.icon} className="h-4 w-4" />
                    {item.label}
                  </span>
                ) : (
                  <span
                    aria-disabled="true"
                    title="Coming next"
                    className="flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-500"
                  >
                    <Icon name={item.icon} className="h-4 w-4 text-slate-400" />
                    <span className="flex-1">{item.label}</span>
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-slate-400 uppercase">
                      Soon
                    </span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="shrink-0 border-t border-slate-200 p-4">
        <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 p-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
            {initials(session.user.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{session.user.name}</p>
            <p className="truncate text-xs text-slate-500">{session.user.email}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link
            href="/"
            onClick={onNavigate}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-2 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
          >
            <Icon name="arrowRight" className="h-3.5 w-3.5 rotate-180" />
            Website
          </Link>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-2 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
          >
            <Icon name="logOut" className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}

const statTones = {
  emerald: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  brand: 'bg-brand-50 text-brand-700',
  rose: 'bg-rose-50 text-rose-700',
} satisfies Record<string, string>;

function StatCard({
  label,
  icon,
  tone,
  state,
  value,
  hint,
}: {
  label: string;
  icon: IconName;
  tone: keyof typeof statTones;
  state: Loadable<ReportSummary>;
  value: (data: ReportSummary) => string;
  hint: (data: ReportSummary) => string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${statTones[tone]}`}>
          <Icon name={icon} className="h-4 w-4" />
        </span>
      </div>

      {state.status === 'ready' ? (
        <>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-950 tabular-nums">
            {value(state.data)}
          </p>
          <p className="mt-1 text-xs text-slate-500">{hint(state.data)}</p>
        </>
      ) : state.status === 'error' ? (
        <>
          <p className="mt-3 text-lg font-semibold text-slate-400">
            {state.forbidden ? 'No access' : 'Unavailable'}
          </p>
          <p className="mt-1 text-xs text-slate-500" title={state.message}>
            {state.forbidden ? 'Your role cannot read reports.' : 'Try refreshing in a moment.'}
          </p>
        </>
      ) : (
        <>
          <div className="mt-4 h-7 w-32 animate-pulse rounded-md bg-slate-100" />
          <div className="mt-2 h-3 w-24 animate-pulse rounded bg-slate-100" />
        </>
      )}
    </div>
  );
}

const statusStyles: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  SENT: 'bg-brand-100 text-brand-700',
  PARTIALLY_PAID: 'bg-amber-100 text-amber-700',
  PAID: 'bg-emerald-100 text-emerald-700',
  OVERDUE: 'bg-rose-100 text-rose-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
  VOID: 'bg-slate-100 text-slate-500',
};

function invoiceStatus(invoice: InvoiceListItem): { key: string; label: string } {
  if (invoice.isOverdue) return { key: 'OVERDUE', label: 'Overdue' };
  return { key: invoice.status, label: humanise(invoice.status) };
}

function StatusBadge({ invoice }: { invoice: InvoiceListItem }) {
  const status = invoiceStatus(invoice);
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        statusStyles[status.key] ?? 'bg-slate-100 text-slate-600'
      }`}
    >
      {status.label}
    </span>
  );
}

function RecentInvoices({
  state,
  locale,
  onRetry,
}: {
  state: Loadable<InvoiceList>;
  locale: string;
  onRetry: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Recent invoices</h3>
          <p className="mt-0.5 text-xs text-slate-500">Latest by issue date</p>
        </div>
        {state.status === 'ready' && (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            {state.data.meta.total} total
          </span>
        )}
      </div>

      {state.status === 'loading' && (
        <div className="space-y-3 p-5">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <div className="h-9 flex-1 animate-pulse rounded-lg bg-slate-100" />
              <div className="hidden h-9 w-24 animate-pulse rounded-lg bg-slate-100 sm:block" />
              <div className="h-9 w-16 animate-pulse rounded-lg bg-slate-100" />
            </div>
          ))}
        </div>
      )}

      {state.status === 'error' && (
        <div className="px-5 py-10 text-center">
          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <Icon name="fileText" className="h-5 w-5" />
          </span>
          <p className="mt-3 text-sm font-semibold text-slate-700">
            {state.forbidden
              ? 'Invoices are not available for your role.'
              : 'Invoices could not load.'}
          </p>
          <p className="mt-1 text-xs text-slate-500">{state.message}</p>
          {!state.forbidden && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {state.status === 'ready' && state.data.data.length === 0 && (
        <div className="px-5 py-12 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <Icon name="fileText" className="h-5 w-5" />
          </span>
          <p className="mt-3 text-sm font-semibold text-slate-800">No invoices yet.</p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
            When you issue your first invoice, its status and balance will show up here.
          </p>
        </div>
      )}

      {state.status === 'ready' && state.data.data.length > 0 && (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th scope="col" className="px-5 py-3 font-medium">
                    Invoice
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Client
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Issued
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Due
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.data.data.map((invoice) => (
                  <tr key={invoice.id} className="transition hover:bg-slate-50/80">
                    <td className="px-5 py-3 font-semibold whitespace-nowrap text-slate-900">
                      {invoice.number}
                    </td>
                    <td className="max-w-40 px-3 py-3">
                      <p className="truncate font-medium text-slate-800">{invoice.client.name}</p>
                      {invoice.client.company !== null && (
                        <p className="truncate text-xs text-slate-500">{invoice.client.company}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-slate-600">
                      {formatDate(invoice.issueDate)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-slate-600">
                      {formatDate(invoice.dueDate)}
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge invoice={invoice} />
                    </td>
                    <td className="px-5 py-3 text-right font-semibold whitespace-nowrap text-slate-900 tabular-nums">
                      {formatMoney(invoice.totalMinor, invoice.currency, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-slate-100 sm:hidden">
            {state.data.data.map((invoice) => (
              <li key={invoice.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{invoice.number}</p>
                    <p className="truncate text-sm text-slate-600">{invoice.client.name}</p>
                  </div>
                  <StatusBadge invoice={invoice} />
                </div>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <p className="text-xs text-slate-500">Due {formatDate(invoice.dueDate)}</p>
                  <p className="font-semibold text-slate-900 tabular-nums">
                    {formatMoney(invoice.totalMinor, invoice.currency, locale)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function WorkspaceCard({
  state,
  role,
  memberCount,
  onRetry,
}: {
  state: Loadable<WorkspaceDetail>;
  role: string | undefined;
  memberCount: number | undefined;
  onRetry: () => void;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">Workspace at a glance</h3>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <Icon name="layers" className="h-4 w-4" />
        </span>
      </div>

      {state.status === 'loading' && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-16 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      )}

      {state.status === 'error' && (
        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">
          <p className="font-medium text-slate-700">Workspace details are unavailable.</p>
          <p className="mt-1 text-xs text-slate-500">{state.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
          >
            Try again
          </button>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3">
            {[
              { label: 'Clients', value: state.data.counts.clients, icon: 'users' as IconName },
              { label: 'Projects', value: state.data.counts.projects, icon: 'layers' as IconName },
              {
                label: 'Invoices',
                value: state.data.counts.invoices,
                icon: 'fileText' as IconName,
              },
              {
                label: 'Members',
                value: state.data.counts.members,
                icon: 'shieldCheck' as IconName,
              },
            ].map((item) => (
              <div key={item.label} className="rounded-xl bg-slate-50 p-3">
                <dt className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                  <Icon name={item.icon} className="h-3.5 w-3.5" />
                  {item.label}
                </dt>
                <dd className="mt-1 text-xl font-bold text-slate-900 tabular-nums">{item.value}</dd>
              </div>
            ))}
          </dl>

          <dl className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-xs">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Currency</dt>
              <dd className="font-medium text-slate-800">{state.data.currency}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Timezone</dt>
              <dd className="max-w-44 truncate text-right font-medium text-slate-800">
                {state.data.timezone}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Your role</dt>
              <dd className="font-medium text-slate-800">
                {role === undefined ? '—' : humanise(role)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">People</dt>
              <dd className="font-medium text-slate-800 tabular-nums">
                {state.data.counts.members}
                {memberCount !== undefined && memberCount !== state.data.counts.members
                  ? ` (${memberCount})`
                  : ''}
              </dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}

function Banner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="mt-6 flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-2">
        <Icon name="x" className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{message}</span>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none sm:self-auto"
      >
        <Icon name="refresh" className="h-3.5 w-3.5" />
        Try again
      </button>
    </div>
  );
}
