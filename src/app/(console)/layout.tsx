import Link from 'next/link';
import { redirect } from 'next/navigation';

import { permissionsAt } from '../../auth/access.ts';
import { currentActor } from '../../auth/actor.ts';
import { signOutAction } from '../login/actions.ts';

/**
 * Everything inside this group requires a session (docs/01 §2.6).
 *
 * The guard is here rather than in middleware on purpose: middleware runs on
 * the edge without a database, so it could only check that a token parses — not
 * whether the person is still active or still holds anything. Resolving grants
 * per request is the difference between revoking access and waiting for a token
 * to expire.
 */

const SECTIONS = [
  { href: '/portfolio', label: 'Portfolio', needs: 'property.read' },
  { href: '/groups', label: 'Groups', needs: null },
  { href: '/people', label: 'People', needs: 'people.read' },
  { href: '/oversight', label: 'Oversight', needs: null },
  { href: '/standards', label: 'Standards', needs: null },
] as const;

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  if (!actor) redirect('/login');

  const held = await permissionsAt(actor.id);

  return (
    <div className="flex min-h-screen">
      <nav className="flex w-56 shrink-0 flex-col bg-nav text-nav-dim">
        <div className="border-b border-nav-rule px-5 py-4">
          <div className="text-sm font-semibold tracking-wide text-nav-ink">MHG</div>
          <div className="text-xs text-nav-dim">Corporate Console</div>
        </div>

        <ul className="flex-1 space-y-0.5 p-2">
          {SECTIONS.map((s) => {
            const built = s.needs !== null;
            const allowed = built && held.has(s.needs);
            if (!built) {
              return (
                <li key={s.href} className="px-3 py-2 text-sm text-nav-dim/40" title="Not built yet">
                  {s.label}
                </li>
              );
            }
            if (!allowed) {
              // Absent rather than disabled: a nav that lists what you cannot
              // reach is just a map of other people's authority.
              return null;
            }
            return (
              <li key={s.href}>
                <Link
                  href={s.href}
                  className="block rounded px-3 py-2 text-sm text-nav-ink hover:bg-nav-hover"
                >
                  {s.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="border-t border-nav-rule px-4 py-3">
          <Link href="/account" className="block truncate text-xs font-medium text-nav-ink hover:underline">
            {actor.name}
          </Link>
          <div className="truncate text-[11px] text-nav-dim">{actor.email}</div>
          <form action={signOutAction} className="mt-2">
            <button type="submit" className="text-[11px] text-nav-dim hover:text-nav-ink">
              Sign out
            </button>
          </form>
        </div>
      </nav>

      <main className="flex-1 overflow-x-auto p-8">{children}</main>
    </div>
  );
}
