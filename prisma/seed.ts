/**
 * Seeds the role and permission catalog (docs/01 §2.4).
 *
 * Idempotent and safe to re-run: roles and permissions are upserted by key, and
 * a role whose permission set has changed gets its version bumped rather than
 * edited in place, so grants keep pointing at the version they were issued
 * against. The role crosswalk (§2.7) is part of a role's meaning, so a changed
 * link bumps the version the same way. Nothing here touches people or grants.
 *
 * The crosswalk is validated before anything is written: a link that would
 * carry A/R or posting authority wider than its console role allows stops the
 * seed, and every declared exception is printed.
 *
 *   npm run db:seed
 */
import { PERMISSIONS, ROLES } from '../src/auth/catalog.ts';
import { CONSUMERS, CONSUMER_ROLES, allowedRoles, validateLinks } from '../src/auth/consumer-roles.ts';
import { prisma } from '../src/db.ts';

interface LinkRow {
  consumer: string;
  consumerRole: string;
  isDefault: boolean;
  exception: string;
}

/** A role's links as comparable strings: `consumer:role:default:exception`. */
function linkKeys(links: LinkRow[]): string[] {
  return links.map((l) => `${l.consumer}:${l.consumerRole}:${l.isDefault}:${l.exception}`).sort();
}

async function main(): Promise<void> {
  const findings = validateLinks(ROLES);
  for (const f of findings) {
    console.log(`  ${f.level === 'error' ? '✗' : '!'} ${f.role} → ${f.message}`);
  }
  if (findings.some((f) => f.level === 'error')) {
    throw new Error('The role crosswalk breaks its own rules — nothing was written.');
  }

  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      create: { key: p.key, name: p.name, scopeMax: p.scopeMax, ownedBy: p.ownedBy },
      update: { name: p.name, scopeMax: p.scopeMax, ownedBy: p.ownedBy },
    });
  }
  console.log(`  permissions  ${PERMISSIONS.length} upserted`);

  for (const c of CONSUMER_ROLES) {
    await prisma.consumerRole.upsert({
      where: { consumer_key: { consumer: c.consumer, key: c.key } },
      create: { consumer: c.consumer, key: c.key, name: c.name, tier: c.tier, rank: c.rank, carries: c.carries },
      update: { name: c.name, tier: c.tier, rank: c.rank, carries: c.carries },
    });
  }
  console.log(`  consumer roles ${CONSUMER_ROLES.length} upserted`);

  for (const r of ROLES) {
    const existing = await prisma.role.findUnique({
      where: { key: r.key },
      include: { permissions: true, links: true },
    });

    const wanted = [...r.permissions].sort();
    const held = (existing?.permissions ?? []).map((p) => p.permissionKey).sort();
    const wantedLinks: LinkRow[] = CONSUMERS.flatMap((consumer) => {
      const l = r.links[consumer];
      if (!l) return [];
      const exception = l.exception?.trim() ?? '';
      return allowedRoles(l).map((consumerRole) => ({
        consumer,
        consumerRole,
        isDefault: consumerRole === l.role,
        exception,
      }));
    });
    const heldLinkKeys = linkKeys(existing?.links ?? []);
    const wantedLinkKeys = linkKeys(wantedLinks);
    const sameList = (a: string[], b: string[]): boolean =>
      a.length === b.length && a.every((k, i) => k === b[i]);
    // A role that predates the crosswalk has no links yet. Gaining its first
    // ones records what it already meant downstream rather than changing it,
    // so that alone is not a new version.
    const firstLinks = existing !== null && existing.links.length === 0;
    const changed =
      existing !== null &&
      (!sameList(held, wanted) || (!firstLinks && !sameList(heldLinkKeys, wantedLinkKeys)));

    // A changed permission set is a NEW version of the role, never an edit to
    // the old one. Editing in place would silently rewrite what every holder
    // was granted, and the audit trail would then be describing something that
    // never happened.
    const version = changed ? existing.version + 1 : (existing?.version ?? r.version);
    if (changed) {
      console.log(`  role ${r.key}: permission set changed → version ${version}`);
    }

    await prisma.role.upsert({
      where: { key: r.key },
      create: {
        key: r.key,
        name: r.name,
        description: r.description,
        version,
        assignableAt: r.assignableAt,
      },
      update: {
        name: r.name,
        description: r.description,
        version,
        assignableAt: r.assignableAt,
      },
    });

    await prisma.rolePermission.deleteMany({
      where: { roleKey: r.key, permissionKey: { notIn: wanted } },
    });
    for (const key of wanted) {
      await prisma.rolePermission.upsert({
        where: { roleKey_permissionKey: { roleKey: r.key, permissionKey: key } },
        create: { roleKey: r.key, permissionKey: key },
        update: {},
      });
    }

    const wantedIds = new Set(wantedLinks.map((l) => `${l.consumer}:${l.consumerRole}`));
    for (const held of existing?.links ?? []) {
      if (!wantedIds.has(`${held.consumer}:${held.consumerRole}`)) {
        await prisma.roleLink.delete({
          where: {
            roleKey_consumer_consumerRole: {
              roleKey: r.key,
              consumer: held.consumer,
              consumerRole: held.consumerRole,
            },
          },
        });
      }
    }
    for (const l of wantedLinks) {
      await prisma.roleLink.upsert({
        where: {
          roleKey_consumer_consumerRole: { roleKey: r.key, consumer: l.consumer, consumerRole: l.consumerRole },
        },
        create: { roleKey: r.key, ...l },
        update: { isDefault: l.isDefault, exception: l.exception },
      });
    }
  }
  console.log(`  roles        ${ROLES.length} upserted, with their links`);

  // A consumer role dropped from the mirror goes only once nothing links to it
  // — the foreign key refuses otherwise, and that refusal is the right answer.
  const kept = CONSUMER_ROLES.map((c) => `${c.consumer}:${c.key}`);
  const stale = (await prisma.consumerRole.findMany()).filter((c) => !kept.includes(`${c.consumer}:${c.key}`));
  for (const c of stale) {
    await prisma.consumerRole.delete({ where: { consumer_key: { consumer: c.consumer, key: c.key } } });
  }
  if (stale.length) console.log(`  consumer roles ${stale.length} removed`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {
      /* never connected */
    }
  });
