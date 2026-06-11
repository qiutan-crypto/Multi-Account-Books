export default function Home() {
  return (
    <main className="min-h-screen bg-[#f7f7f4] px-6 py-10 text-[#151713]">
      <section className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold uppercase tracking-normal text-[#64705b]">
          Beancount ledger workspace
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-normal sm:text-5xl">
          Accounting app for entities, duplicated company files, pasted chart
          imports, Excel transaction imports, and date-range reports.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-[#52604d]">
          The deployed app runs as a browser-local ledger manager using
          Beancount-style account names and balanced postings.
        </p>
      </section>
    </main>
  );
}
