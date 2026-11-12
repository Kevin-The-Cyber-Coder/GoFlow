export function App() {
  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">GoFlow</p>
      <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
        Your freelance business. One workspace.
      </h1>
      <p className="max-w-xl text-lg text-slate-600">
        Clients, invoices, payments and income reports in a single place. The application is being
        built in the open, one reviewed change at a time.
      </p>
      <dl className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Clients', value: 'CRM' },
          { label: 'Invoices', value: 'Billing' },
          { label: 'Reports', value: 'Insights' },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <dt className="text-sm text-slate-500">{item.label}</dt>
            <dd className="text-lg font-semibold text-slate-900">{item.value}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
