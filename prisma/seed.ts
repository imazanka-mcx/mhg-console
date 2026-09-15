/**
 * Seeds the role and permission catalog (docs/01 §2.4).
 *
 * Idempotent and safe to re-run: roles and permissions are upserted by key, and
 * a role whose permission set has changed gets its version bumped rather than
 * edited in place, so grants keep pointing at the version they were issued
 * against. Nothing here touches people or grants.
 *
 *   npm run db:seed
 */
import { PERMISSIONS, ROLES } from '../src/auth/catalog.ts';
import { prisma } from '../src/db.ts';

async function main(): Promise<void> {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      create: { key: p.key, name: p.name, scopeMax: p.scopeMax, ownedBy: p.ownedBy },
      update: { name: p.name, scopeMax: p.scopeMax, ownedBy: p.ownedBy },
    });
  }
  console.log(`  permissions  ${PERMISSIONS.length} upserted`);

  for (const r of ROLES) {
    const existing = await prisma.role.findUnique({
      where: { key: r.key },
      include: { permissions: true },
    });

    const wanted = [...r.permissions].sort();
    const held = (existing?.permissions ?? []).map((p) => p.permissionKey).sort();
    const changed =
      existing !== null &&
      (held.length !== wanted.length || held.some((k, i) => k !== wanted[i]));

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
  }
  console.log(`  roles        ${ROLES.length} upserted`);
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
