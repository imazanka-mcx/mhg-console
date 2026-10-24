import { consoleRoleFor, type Consumer } from '../auth/consumer-roles.ts';
import type { Scope } from '../auth/scope.ts';
import type { PersonGrant } from '../shell/contract.ts';

/**
 * The one-time import's mapping (docs/01 §2.9), kept pure so it is testable
 * without a database.
 */

/** a local account's roles → console grants, and what could not be mapped. */
export function mapImported(
  consumer: Consumer,
  roles: readonly PersonGrant[],
  codeFor: (propertyId: string) => string | undefined,
): { grants: { roleKey: string; scope: Scope; scopeRef: string | null }[]; skipped: string[] } {
  const grants: { roleKey: string; scope: Scope; scopeRef: string | null }[] = [];
  const skipped: string[] = [];
  for (const r of roles) {
    const scope = r.scope as Scope;
    const roleKey = consoleRoleFor(consumer, r.role, scope);
    if (!roleKey) {
      skipped.push(`${r.role} at ${r.scope}`);
      continue;
    }
    if (scope === 'portfolio') {
      grants.push({ roleKey, scope, scopeRef: null });
      continue;
    }
    if (scope !== 'property') {
      skipped.push(`${r.role} at ${r.scope}`);
      continue;
    }
    const code = codeFor(r.ref);
    if (!code) {
      skipped.push(`${r.role} at a hotel not in the registry`);
      continue;
    }
    grants.push({ roleKey, scope, scopeRef: code });
  }
  return { grants, skipped };
}

