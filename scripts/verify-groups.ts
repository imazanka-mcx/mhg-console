/**
 * Read-only audit of group-backed access (docs/01 §2.2, §3.1).
 *
 *   npm run verify:groups
 *
 * Writes NOTHING. It is the Oversight section's exception list, in script form,
 * and it is also how the group work is verified against the live registry —
 * checking real rows rather than fixtures, without adding a throwaway grant to
 * an audit trail that is supposed to mean something.
 *
 * Four questions, each of which should answer "none":
 *
 *   1. Does any live grant carry a property-capped permission above property?
 *      This is the direct-bill firewall (docs/29 §3). `grantAccess` refuses it
 *      at write time, so a hit here means a row got in some other way.
 *   2. Does any grant point at a group or a property that does not exist?
 *      A grant pointing at nothing looks like access and confers none.
 *   3. Has any rule group drifted from its rule?
 *   4. Does any live group grant currently reach zero properties?
 */
import { prisma } from '../src/db.ts';
import { grantsOnGroup, listGroups } from '../src/groups/groups.ts';
import { matches, parseRule } from '../src/groups/rules.ts';
import { isLive } from '../src/auth/scope.ts';

let problems = 0;

function report(label: string, lines: string[]): void {
  if (lines.length === 0) {
    console.log(`  ✓ ${label}`);
    return;
  }
  problems += lines.length;
  console.log(`  ✗ ${label}`);
  for (const l of lines) console.log(`      ${l}`);
}

async function main(): Promise<void> {
  const now = new Date();

  const grants = (
    await prisma.grant.findMany({
      where: { effectiveTo: null },
      include: {
        person: { select: { name: true, email: true } },
        role: { include: { permissions: { include: { permission: true } } } },
      },
    })
  ).filter((g) => isLive(g, now));

  console.log(`\n  ${grants.length} live grant(s)\n`);

  // 1 — the firewall, checked against rows rather than against the code path.
  report(
    'no capped permission is held above property',
    grants
      .filter((g) => g.scope !== 'property')
      .flatMap((g) =>
        g.role.permissions
          .filter((rp) => rp.permission.scopeMax === 'property')
          .map(
            (rp) =>
              `${g.person.email} holds ${rp.permission.key} (max property) at ${g.scope} via ${g.role.key}`,
          ),
      ),
  );

  // 2 — every narrow grant points at something that exists.
  const groupIds = new Set((await listGroups(true)).map((g) => g.id));
  const codes = new Set((await prisma.property.findMany({ select: { code: true } })).map((p) => p.code));
  report(
    'every grant points at something that exists',
    grants
      .filter((g) => g.scope !== 'portfolio')
      .filter((g) => {
        if (!g.scopeRef) return true;
        return g.scope === 'group' ? !groupIds.has(g.scopeRef) : !codes.has(g.scopeRef);
      })
      .map((g) => `${g.person.email}: ${g.scope} grant on "${g.scopeRef}" — no such ${g.scope}`),
  );

  // 3 — rule groups agree with their rule.
  const drift: string[] = [];
  for (const group of await listGroups(true)) {
    if (group.membershipMode !== 'rule' || !group.ruleJson) continue;
    let wanted: Set<string>;
    try {
      const rule = parseRule(group.ruleJson);
      const properties = await prisma.property.findMany();
      wanted = new Set(properties.filter((p) => matches(rule, p)).map((p) => p.id));
    } catch (err) {
      drift.push(`${group.id}: unreadable rule — ${err instanceof Error ? err.message : err}`);
      continue;
    }
    const held = new Set(
      (
        await prisma.propertyGroupMember.findMany({ where: { groupId: group.id }, select: { propertyId: true } })
      ).map((m: { propertyId: string }) => m.propertyId),
    );
    const missing = [...wanted].filter((id) => !held.has(id)).length;
    const extra = [...held].filter((id) => !wanted.has(id)).length;
    if (missing || extra) {
      drift.push(`${group.id}: ${missing} missing, ${extra} stale — run \`npm run groups -- sync\``);
    }
  }
  report('every rule group matches its rule', drift);

  // 4 — a group grant that reaches nothing.
  const empty: string[] = [];
  for (const group of await listGroups(true)) {
    const count = await prisma.propertyGroupMember.count({ where: { groupId: group.id } });
    if (count > 0) continue;
    const held = await grantsOnGroup(group.id);
    for (const g of held) {
      empty.push(`${g.person.email} holds ${g.role.key} on ${group.id}, which has no properties`);
    }
  }
  report('no live grant reaches an empty group', empty);

  // What each group grant actually reaches right now.
  const groupGrants = grants.filter((g) => g.scope === 'group');
  if (groupGrants.length) {
    console.log('\n  reach of each live group grant\n');
    for (const g of groupGrants) {
      const members = await prisma.propertyGroupMember.findMany({
        where: { groupId: g.scopeRef ?? '' },
        include: { property: { select: { code: true } } },
      });
      const list = members.map((m: { property: { code: string } }) => m.property.code).join(' ');
      console.log(`    ${g.person.email} · ${g.role.key} on ${g.scopeRef} → ${members.length} property(ies) ${list}`);
    }
  }

  console.log(problems === 0 ? '\n  no exceptions\n' : `\n  ${problems} exception(s)\n`);
  if (problems > 0) process.exitCode = 1;
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
