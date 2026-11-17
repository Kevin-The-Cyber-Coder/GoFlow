import type { Session } from '../lib/api';
import { Link } from '../lib/Link';
import { Header } from '../components/Header';
import { Icon, LogoMark, type IconName } from '../components/Icon';

interface HomeProps {
  session: Session | null;
  onSignOut: () => void;
}

const REPO_URL = 'https://github.com/Kevin-The-Cyber-Coder/GoFlow';

const guarantees: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: 'shieldCheck',
    title: 'Correct to the cent',
    body: 'Amounts are stored as integer minor units, never floating point.',
  },
  {
    icon: 'layers',
    title: 'Isolated workspaces',
    body: 'Every record is scoped to the workspace that owns it.',
  },
  {
    icon: 'github',
    title: 'Open by default',
    body: 'MIT licensed and built in public, one reviewed change at a time.',
  },
];

const features: Array<{ icon: IconName; title: string; description: string }> = [
  {
    icon: 'users',
    title: 'Client CRM',
    description:
      'Keep contacts, billing details and notes together, so every invoice starts with the right information.',
  },
  {
    icon: 'fileText',
    title: 'Invoices',
    description:
      'Draft line items, tax and due dates, then send an invoice and watch its status without a spreadsheet.',
  },
  {
    icon: 'wallet',
    title: 'Payments',
    description:
      'Record full or partial payments in any order. Balances and overdue states update themselves.',
  },
  {
    icon: 'receipt',
    title: 'Expenses',
    description:
      'Capture business spending, attach categories and route larger costs through an approval step.',
  },
  {
    icon: 'pieChart',
    title: 'Reports',
    description:
      'See income, outstanding money and spending by category for any period, in your workspace currency.',
  },
  {
    icon: 'shieldCheck',
    title: 'Roles & access',
    description:
      'Invite collaborators with scoped permissions. Every workspace stays separate, by design.',
  },
];

const steps: Array<{ title: string; description: string; detail: string }> = [
  {
    title: 'Create your workspace',
    description:
      'Sign up, name your business and choose the currency and timezone you actually work in.',
    detail: 'About two minutes',
  },
  {
    title: 'Add a client and an invoice',
    description:
      'Save a contact once, then build an invoice with line items, tax and a due date you control.',
    detail: 'No import required',
  },
  {
    title: 'Get paid, see the picture',
    description:
      'Record payments as they land. Income, balances and spending reports stay in sync automatically.',
    detail: 'Always up to date',
  },
];

type InvoiceStatus = 'Paid' | 'Sent' | 'Overdue';

const statusStyles: Record<InvoiceStatus, string> = {
  Paid: 'bg-emerald-100 text-emerald-700',
  Sent: 'bg-brand-100 text-brand-700',
  Overdue: 'bg-rose-100 text-rose-700',
};

const invoices: Array<{ number: string; client: string; amount: string; status: InvoiceStatus }> = [
  { number: 'INV-1042', client: 'Northwind Studio', amount: '$2,400.00', status: 'Paid' },
  { number: 'INV-1043', client: 'Kite & Co.', amount: '$1,150.00', status: 'Sent' },
  { number: 'INV-1039', client: 'Marlow Foods', amount: '$860.00', status: 'Overdue' },
];

const barHeights = [34, 48, 42, 58, 51, 70, 63, 88];

const codeSample = `const invoice = {
  totalMinor: 240000n,
  currency: 'USD',
  dueDate: '2026-11-30',
  workspaceId: 'ws_8f21',
};

// 240000n -> $2,400.00
formatMoney(invoice.totalMinor, invoice.currency);`;

export function Home({ session, onSignOut }: HomeProps) {
  return (
    <div id="top" className="flex min-h-full flex-col bg-white">
      <a
        href="#main"
        className="sr-only rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>

      <Header session={session} onSignOut={onSignOut} />

      <main id="main" className="flex-1">
        <Hero session={session} />
        <TrustStrip />
        <FeatureGrid />
        <HowItWorks />
        <WhyGoFlow />
        <GetStarted session={session} />
      </main>

      <Footer />
    </div>
  );
}

function Hero({ session }: { session: Session | null }) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-brand-50 via-white to-white"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[28rem] w-[52rem] -translate-x-1/2 rounded-full bg-brand-200/35 blur-3xl"
      />

      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-14 pb-16 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:pt-24 lg:pb-24">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm">
            <Icon name="sparkles" className="h-3.5 w-3.5" />
            Open source · MIT licensed
          </span>

          <h1 className="mt-5 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl lg:text-[3.4rem] lg:leading-[1.08]">
            Your freelance business,{' '}
            <span className="bg-gradient-to-r from-brand-600 via-indigo-600 to-violet-600 bg-clip-text text-transparent">
              finally in one calm place.
            </span>
          </h1>

          <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
            GoFlow keeps clients, invoices, payments, expenses and reports in one focused workspace.
            Correct to the cent, auditable by default, and yours to self-host.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href={session === null ? '/get-started' : '/app'}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/25 transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              {session === null ? 'Create your workspace' : 'Open your dashboard'}
              <Icon name="arrowRight" className="h-4 w-4" />
            </Link>
            {session === null && (
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <Icon name="logIn" className="h-4 w-4" />
                Sign in
              </Link>
            )}
          </div>

          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
            {['No credit card', 'Self-hostable', 'Built in public'].map((item) => (
              <li key={item} className="inline-flex items-center gap-1.5">
                <Icon name="checkCircle" className="h-4 w-4 text-emerald-600" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <HeroPreview />
      </div>
    </section>
  );
}

function HeroPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none">
      <div
        aria-hidden="true"
        className="absolute -inset-3 rounded-[2rem] bg-gradient-to-tr from-brand-100 via-white to-violet-100 blur-2xl"
      />

      <div className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-900/10">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-slate-400 uppercase">
              November
            </p>
            <p className="mt-1 text-base font-semibold text-slate-900">Cash flow</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
            <Icon name="trendingUp" className="h-3.5 w-3.5" />
            +18%
          </span>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          {[
            { label: 'Billed', value: '$12.4k' },
            { label: 'Outstanding', value: '$3.2k' },
            { label: 'Expenses', value: '$1.9k' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl bg-slate-50 p-3">
              <p className="text-[11px] font-medium text-slate-500">{stat.label}</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-900 tabular-nums">
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-500">Income</span>
            <span className="text-slate-400">Last 8 weeks</span>
          </div>
          <div className="mt-2 flex h-24 items-end gap-1.5" aria-hidden="true">
            {barHeights.map((height, index) => (
              <div
                key={`${height}-${index}`}
                className={`flex-1 rounded-t ${
                  index >= barHeights.length - 2 ? 'bg-brand-500' : 'bg-brand-100'
                }`}
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>

        <div className="mt-5 space-y-2">
          {invoices.map((invoice) => (
            <div
              key={invoice.number}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-800">{invoice.client}</p>
                <p className="text-[11px] text-slate-400">{invoice.number}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs font-semibold text-slate-700 tabular-nums">
                  {invoice.amount}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusStyles[invoice.status]}`}
                >
                  {invoice.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 text-[11px] text-slate-400">Illustrative demo workspace data.</p>
      </div>

      <div className="absolute -bottom-6 -left-4 hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg sm:flex lg:-left-8">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <Icon name="checkCircle" className="h-4 w-4" />
        </span>
        <div>
          <p className="text-xs font-semibold text-slate-800">Payment received</p>
          <p className="text-[11px] text-slate-500">$1,200.00 · INV-1042</p>
        </div>
      </div>

      <div className="absolute -top-5 -right-3 hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg md:flex">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-brand-600">
          <Icon name="users" className="h-4 w-4" />
        </span>
        <div>
          <p className="text-xs font-semibold text-slate-800">New client</p>
          <p className="text-[11px] text-slate-500">Northwind Studio</p>
        </div>
      </div>
    </div>
  );
}

function TrustStrip() {
  return (
    <section aria-label="Product principles" className="border-y border-slate-200 bg-slate-50/70">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:grid-cols-3 sm:px-6 lg:px-8">
        {guarantees.map((item) => (
          <div key={item.title} className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-brand-600 ring-1 ring-slate-200">
              <Icon name={item.icon} className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">{item.title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{item.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-semibold tracking-[0.16em] text-brand-600 uppercase">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">{title}</h2>
      <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">{description}</p>
    </div>
  );
}

function FeatureGrid() {
  return (
    <section id="features" className="scroll-mt-24 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Features"
          title="Everything a solo business needs. Nothing it doesn't."
          description="Six focused areas instead of twenty half-finished modules. Each one does the everyday job and stays out of the way."
        />

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 transition group-hover:bg-brand-600 group-hover:text-white group-hover:ring-brand-600">
                <Icon name={feature.icon} className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-slate-900">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{feature.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="scroll-mt-24 border-y border-slate-200 bg-slate-50 py-20 sm:py-24"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="How it works"
          title="From blank page to paid invoice."
          description="Three steps, no configuration maze. GoFlow is shaped like the way freelance work actually happens."
        />

        <ol className="mt-12 grid gap-6 lg:grid-cols-3">
          {steps.map((step, index) => (
            <li
              key={step.title}
              className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-sm font-bold text-white shadow-lg shadow-brand-600/25">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                  <Icon name="clock" className="h-3 w-3" />
                  {step.detail}
                </span>
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.description}</p>
            </li>
          ))}
        </ol>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 text-center sm:flex-row">
          <p className="text-sm text-slate-600">Ready to try it with your own data?</p>
          <Link
            href="/get-started"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 transition hover:text-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Create a workspace
            <Icon name="arrowRight" className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function WhyGoFlow() {
  return (
    <section id="why" className="scroll-mt-24 py-20 sm:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-brand-600 uppercase">
            Why GoFlow
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            Built like a finance tool, not a demo.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
            Invoicing looks simple until a partial payment, a refund or a timezone edge case shows
            up. GoFlow treats money and dates as data that has to stay correct.
          </p>

          <ul className="mt-6 space-y-3">
            {[
              'Every query is filtered by workspace before it touches a row.',
              'Audit records are written in the same transaction as the change.',
              'Security headers, CORS and rate limits are on from the start.',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                <Icon name="checkCircle" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                {item}
              </li>
            ))}
          </ul>

          <a
            href={`${REPO_URL}/blob/main/SECURITY.md`}
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 transition hover:text-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Read the security model
            <Icon name="arrowRight" className="h-4 w-4" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl shadow-slate-900/20">
          <div className="flex items-center gap-1.5 border-b border-slate-800 px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
            <span className="ml-2 text-xs text-slate-500">invoice.dto.ts</span>
          </div>
          <pre className="overflow-x-auto p-5 text-xs leading-relaxed text-slate-300">
            <code>{codeSample}</code>
          </pre>
          <div className="flex flex-wrap gap-2 border-t border-slate-800 px-4 py-3">
            {['BigInt minor units', 'UTC dates', 'Workspace-scoped'].map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-400 ring-1 ring-slate-800"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function GetStarted({ session }: { session: Session | null }) {
  return (
    <section id="get-started" className="scroll-mt-24 px-4 pb-20 sm:px-6 sm:pb-24 lg:px-8">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-slate-950 px-6 py-14 text-center sm:px-12 sm:py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-brand-500/25 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -bottom-24 h-64 w-64 rounded-full bg-violet-500/20 blur-3xl"
        />

        <p className="relative text-xs font-semibold tracking-[0.16em] text-brand-300 uppercase">
          Get started
        </p>
        <h2 className="relative mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Your next invoice is five minutes away.
        </h2>
        <p className="relative mx-auto mt-4 max-w-xl text-base text-slate-300 sm:text-lg">
          Create a workspace, add one client, and send something real. You can invite the rest of
          the business later.
        </p>

        <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href={session === null ? '/get-started' : '/app'}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-900/40 transition hover:bg-brand-400 focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none"
          >
            {session === null ? 'Create your workspace' : 'Open your dashboard'}
            <Icon name="arrowRight" className="h-4 w-4" />
          </Link>
          {session === null && (
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none"
            >
              I already have an account
            </Link>
          )}
        </div>

        <p className="relative mt-5 text-sm text-slate-400">
          No credit card · Self-host it if you like · MIT licensed
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <a
              href="#top"
              className="inline-flex items-center gap-2.5 rounded-lg focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <LogoMark className="h-9 w-9" />
              <span className="text-lg font-bold tracking-tight text-slate-900">GoFlow</span>
            </a>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-600">
              One workspace for clients, invoices, payments, expenses and reports. Built in public
              with a bias for correct money and clear permissions.
            </p>
            <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Actively developed
            </p>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-slate-900">Product</h2>
            <ul className="mt-4 space-y-2.5 text-sm text-slate-600">
              {[
                { href: '#features', label: 'Features' },
                { href: '#how-it-works', label: 'How it works' },
                { href: '#why', label: 'Why GoFlow' },
                { href: '#get-started', label: 'Get started' },
              ].map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="rounded transition hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-slate-900">Resources</h2>
            <ul className="mt-4 space-y-2.5 text-sm text-slate-600">
              <li>
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded transition hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                >
                  <Icon name="github" className="h-4 w-4" />
                  Source on GitHub
                </a>
              </li>
              <li>
                <a
                  href={`${REPO_URL}/blob/main/SECURITY.md`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded transition hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                >
                  Security model
                </a>
              </li>
              <li>
                <a
                  href={`${REPO_URL}/blob/main/LICENSE`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded transition hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                >
                  MIT license
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-slate-200 pt-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} GoFlow. MIT licensed.</p>
          <p>
            Built in public by{' '}
            <a
              href="https://github.com/Kevin-The-Cyber-Coder"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-slate-700 transition hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
            >
              Kevin-The-Cyber-Coder
            </a>
            .
          </p>
        </div>
      </div>
    </footer>
  );
}
