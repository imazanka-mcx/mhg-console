import Link from 'next/link';

import { registryFor } from '../../issuance.ts';

export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<string, string> = {
  pipeline: 'bg-warning-50 text-warning-700 ring-warning-200',
  active: 'bg-success-50 text-success-700 ring-success-200',
  retired: 'bg-slate-100 text-slate-500 ring-slate-200',
};

export default async function PortfolioPage() {
  const codes = await registryFor().list();
  const live = codes.filter((c) => c.status !== 'retired');

  return (
    <div className="max-w-5xl">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Portfolio</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every inn code ever issued. Retired codes stay listed — they are still claimed, and
            uniqueness is checked against history, not just the live portfolio (G3).
          </p>
        </div>
        <Link
          href="/portfolio/new"
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          New property
        </Link>
      </div>

      {codes.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-sm font-medium text-slate-700">The registry is empty.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            A code is issued at LOI or contract signature, not at opening (G6), so the first one
            usually arrives as <span className="font-mono text-slate-700">pipeline</span> well
            before there is a hotel to check into.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-6 text-xs uppercase tracking-wide text-slate-400">
            {live.length} live · {codes.length - live.length} retired
          </p>
          <table className="mt-2 w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="border-b border-slate-200 py-2 pr-4 font-medium">Code</th>
                <th className="border-b border-slate-200 py-2 pr-4 font-medium">Status</th>
                <th className="border-b border-slate-200 py-2 pr-4 font-medium">Brand</th>
                <th className="border-b border-slate-200 py-2 pr-4 font-medium">Market</th>
                <th className="border-b border-slate-200 py-2 pr-4 font-medium">Name</th>
                <th className="border-b border-slate-200 py-2 font-medium">Property ID</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.code} className="align-top">
                  <td className="border-b border-slate-100 py-2.5 pr-4">
                    <span className="font-mono font-semibold text-slate-900">{c.code}</span>
                    {c.predecessorCode ? (
                      <div className="text-xs text-slate-400">
                        replaces <span className="font-mono">{c.predecessorCode}</span>
                      </div>
                    ) : null}
                  </td>
                  <td className="border-b border-slate-100 py-2.5 pr-4">
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                        STATUS_STYLE[c.status] ?? ''
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="border-b border-slate-100 py-2.5 pr-4 text-slate-600">
                    <span className="font-mono">{c.brandCode}</span>{' '}
                    <span className="text-slate-400">{c.brandName}</span>
                  </td>
                  <td className="border-b border-slate-100 py-2.5 pr-4 text-slate-600">
                    <span className="font-mono">{c.marketCode}</span>
                    <div className="text-xs text-slate-400">
                      {c.city}, {c.state}
                      {c.submarket ? ` · ${c.submarket}` : ''}
                    </div>
                  </td>
                  <td className="border-b border-slate-100 py-2.5 pr-4 text-slate-700">{c.name}</td>
                  <td className="border-b border-slate-100 py-2.5 font-mono text-xs text-slate-400">
                    {c.propertyId}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-xs text-slate-400">
            The property ID is the foreign key downstream systems hold, never the code — which is
            what lets a rebrand change the code without repointing anything (G1, G2).
          </p>
        </>
      )}
    </div>
  );
}
