import { prisma } from '../db.ts';
import { readSession } from './session.ts';
import { can, PORTFOLIO, type Actor, type Target } from './access.ts';

/**
 * The half of access that needs a request (docs/01 §2.6).
 *
 * Split from access.ts because `next/headers` exists only inside the Next
 * bundler: a CLI importing anything that transitively reaches it fails to load
 * at all. Keeping the database-facing rules free of the request context is what
 * lets `npm run sunrise` and the app share one implementation of a grant.
 */

/** The signed-in person, or null. Suspended and offboarded people are not signed in. */
export async function currentActor(): Promise<Actor | null> {
  const session = await readSession();
  if (!session) return null;
  const person = await prisma.person.findUnique({ where: { id: session.personId } });
  if (!person || person.status !== 'active') return null;
  return { id: person.id, email: person.email, name: person.name, status: person.status };
}

/** Throws unless the signed-in person holds `permission`. Use at the top of any action. */
export async function requirePermission(
  permission: string,
  target: Target = PORTFOLIO,
): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new Error('Not signed in.');
  if (!(await can(actor.id, permission, target))) {
    throw new Error(`Not permitted: ${permission}`);
  }
  return actor;
}
