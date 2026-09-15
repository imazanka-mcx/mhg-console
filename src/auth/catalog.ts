import type { Scope } from './scope.ts';

/**
 * The role and permission catalog (docs/01 §2.3, §2.4).
 *
 * This is the seed, not the source of truth — the tables are. It lives in code
 * so a change is reviewable in a diff, and is applied by `npm run db:seed`.
 *
 * Roles are VERSIONED, never edited in place. Editing `registrar` would
 * silently rewrite what every registrar was granted, and the audit trail would
 * then be lying. Change the permission set, bump `version`, re-seed.
 */

export interface PermissionSeed {
  key: string;
  name: string;
  scopeMax: Scope;
  /** Which system enforces it. The console owns the catalog either way. */
  ownedBy: 'console' | 'inspire' | 'inspiredrev';
}

export interface RoleSeed {
  key: string;
  name: string;
  description: string;
  version: number;
  assignableAt: Scope[];
  permissions: string[];
}

export const PERMISSIONS: PermissionSeed[] = [
  // ── the registry ────────────────────────────────────────────────────────
  { key: 'property.read', name: 'View the portfolio', scopeMax: 'portfolio', ownedBy: 'console' },
  { key: 'property.issue', name: 'Issue an inn code', scopeMax: 'portfolio', ownedBy: 'console' },
  { key: 'property.rebrand', name: 'Rebrand a property', scopeMax: 'portfolio', ownedBy: 'console' },
  { key: 'property.status', name: 'Move a code through its lifecycle', scopeMax: 'portfolio', ownedBy: 'console' },

  // ── people ──────────────────────────────────────────────────────────────
  { key: 'people.read', name: 'View people and their access', scopeMax: 'portfolio', ownedBy: 'console' },
  { key: 'people.manage', name: 'Invite people and grant access', scopeMax: 'portfolio', ownedBy: 'console' },

  // ── standards ───────────────────────────────────────────────────────────
  { key: 'standards.manage', name: 'Edit the brand table and market claims', scopeMax: 'portfolio', ownedBy: 'console' },

  // ── property-capped, enforced downstream ────────────────────────────────
  // These are the firewall's reason for existing (docs/29 §3). The console owns
  // the catalog; Inspire enforces them once §4 step 5 moves its Role enum here.
  // Capped at `property` so no portfolio- or group-scoped role can ever carry
  // them — above-property has zero oversight of direct billables, and that is
  // now a constraint rather than a convention.
  { key: 'ar.view', name: 'View A/R and direct-bill exposure', scopeMax: 'property', ownedBy: 'inspire' },
  { key: 'ar.manage', name: 'Invoice, receipt and write off A/R', scopeMax: 'property', ownedBy: 'inspire' },
  { key: 'folio.post', name: 'Post to a folio', scopeMax: 'property', ownedBy: 'inspire' },
];

export const ROLES: RoleSeed[] = [
  {
    key: 'owner',
    name: 'Owner',
    description:
      'Full control of the registry, including who else has access. The sunrise account holds this. Portfolio only — there is no such thing as an owner of one hotel.',
    version: 1,
    assignableAt: ['portfolio'],
    permissions: [
      'property.read',
      'property.issue',
      'property.rebrand',
      'property.status',
      'people.read',
      'people.manage',
      'standards.manage',
    ],
  },
  {
    key: 'registrar',
    name: 'Registrar',
    description:
      'Issues codes and maintains the standard. Cannot change who has access — provisioning is a separate authority on purpose.',
    version: 1,
    assignableAt: ['portfolio'],
    permissions: [
      'property.read',
      'property.issue',
      'property.rebrand',
      'property.status',
      'standards.manage',
    ],
  },
  {
    key: 'viewer',
    name: 'Viewer',
    description:
      'Reads the portfolio. Grantable narrowly, which is what makes a regional or single-property seat possible without inventing a role per tier.',
    version: 1,
    assignableAt: ['portfolio', 'group', 'property'],
    permissions: ['property.read'],
  },
];

export const ROLE_KEYS = ROLES.map((r) => r.key);

export function roleByKey(key: string): RoleSeed | undefined {
  return ROLES.find((r) => r.key === key);
}

export function permissionsFor(roleKey: string): PermissionSeed[] {
  const role = roleByKey(roleKey);
  if (!role) return [];
  return PERMISSIONS.filter((p) => role.permissions.includes(p.key));
}

/** The role the sunrise account is created with. */
export const SUNRISE_ROLE = 'owner';
