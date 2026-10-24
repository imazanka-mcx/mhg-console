import { roleByKey } from '../auth/catalog.ts';
import { CONSUMERS, resolveDownstream, type Consumer } from '../auth/consumer-roles.ts';
import type { GrantScope, PersonGrant } from '../shell/contract.ts';

/**
 * Live console grants → what each consumer should enforce (docs/01 §2.8).
 *
 * Pure, like scope.ts: no Prisma, so the rule is testable on its own. The
 * caller has already resolved a property grant's inn code to the registry
 * propertyId — consumers key on the id, and a rebrand changes the code.
 *
 * What a grant becomes downstream was fixed when it was issued
 * (grant_downstream). A grant older than that table has no rows, and gets the
 * crosswalk's default — the same answer resolveDownstream would have given at
 * the time, since every role then had exactly one link per consumer.
 */

export interface LiveGrant {
  scope: GrantScope;
  /** null for portfolio; a group id; or the registry propertyId. */
  ref: string | null;
  roleKey: string;
  /** grant_downstream rows for this grant, if any. */
  downstream: { consumer: string; consumerRole: string }[];
}

export type Translated = Record<Consumer, PersonGrant[]>;

export function translateGrants(grants: readonly LiveGrant[]): Translated {
  const out: Translated = { inspire: [], inspiredrev: [] };
  const seen = new Set<string>();

  for (const g of grants) {
    // A property grant whose code resolved to nothing points at no hotel —
    // it confers nothing here either (grantAccess refuses to open one).
    if (g.scope !== 'portfolio' && !g.ref) continue;

    let roles: Partial<Record<Consumer, string>>;
    if (g.downstream.length) {
      roles = {};
      for (const d of g.downstream) {
        if ((CONSUMERS as readonly string[]).includes(d.consumer)) roles[d.consumer as Consumer] = d.consumerRole;
      }
    } else {
      const seed = roleByKey(g.roleKey);
      roles = seed ? resolveDownstream({ key: seed.key, links: seed.links }) : {};
    }

    for (const consumer of CONSUMERS) {
      const role = roles[consumer];
      if (!role) continue;
      const grant: PersonGrant = { scope: g.scope, ref: g.scope === 'portfolio' ? '' : (g.ref ?? ''), role };
      const key = `${consumer}|${grant.scope}|${grant.ref}|${grant.role}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out[consumer].push(grant);
    }
  }

  for (const consumer of CONSUMERS) {
    out[consumer].sort((a, b) =>
      a.scope === b.scope ? (a.ref === b.ref ? a.role.localeCompare(b.role) : a.ref.localeCompare(b.ref)) : a.scope.localeCompare(b.scope),
    );
  }
  return out;
}

/**
 * Does this person belong in the console at all? Only corporate staff do: a
 * person whose every grant is a property-operations role — a GM, an owner, a
 * front desk agent — signs in to Inspire and InspiredREV, never here. The test
 * is whether any live grant's role carries a console-owned permission.
 */
export function holdsConsoleRole(
  grants: readonly { permissions: readonly { ownedBy: string }[] }[],
): boolean {
  return grants.some((g) => g.permissions.some((p) => p.ownedBy === 'console'));
}
