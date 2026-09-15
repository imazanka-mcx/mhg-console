import type { Metadata } from 'next';
import Link from 'next/link';

import './globals.css';

export const metadata: Metadata = {
  title: 'MHG Corporate Console',
  description: 'The registry plane — properties, groups, people and the Inn Code Standard.',
};

/**
 * Five sections (docs/01 §3). Only Portfolio is built; the rest are listed
 * because the shape of this app is the argument it makes — a registry and an
 * oversight surface, not a multi-property PMS.
 */
const SECTIONS = [
  { href: '/portfolio', label: 'Portfolio', ready: true },
  { href: '/groups', label: 'Groups', ready: false },
  { href: '/people', label: 'People', ready: false },
  { href: '/oversight', label: 'Oversight', ready: false },
  { href: '/standards', label: 'Standards', ready: false },
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <nav className="flex w-56 shrink-0 flex-col bg-nav text-nav-dim">
            <div className="border-b border-nav-rule px-5 py-4">
              <div className="text-sm font-semibold tracking-wide text-nav-ink">MHG</div>
              <div className="text-xs text-nav-dim">Corporate Console</div>
            </div>
            <ul className="flex-1 space-y-0.5 p-2">
              {SECTIONS.map((s) =>
                s.ready ? (
                  <li key={s.href}>
                    <Link
                      href={s.href}
                      className="block rounded px-3 py-2 text-sm text-nav-ink hover:bg-nav-hover"
                    >
                      {s.label}
                    </Link>
                  </li>
                ) : (
                  <li
                    key={s.href}
                    className="cursor-default px-3 py-2 text-sm text-nav-dim/50"
                    title="Not built yet"
                  >
                    {s.label}
                  </li>
                ),
              )}
            </ul>
            <div className="border-t border-nav-rule px-5 py-3 text-[11px] leading-snug text-nav-dim/70">
              Identity flows down from here. Operational truth flows up to the PMS.
            </div>
          </nav>
          <main className="flex-1 overflow-x-auto p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
