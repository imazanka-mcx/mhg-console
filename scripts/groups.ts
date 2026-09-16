/**
 * Group CLI (docs/01 §2.2).
 *
 *   npm run groups -- list
 *   npm run groups -- show    --id grp_midwest
 *   npm run groups -- new     --kind region --name "Midwest" --confirm
 *   npm run groups -- new     --kind brand  --name "Hampton" --rule brandCode=HX --confirm
 *   npm run groups -- add     --id grp_midwest --property EVVBC --confirm
 *   npm run groups -- remove  --id grp_midwest --property EVVBC --confirm
 *   npm run groups -- sync    [--id grp_hampton]
 *
 * Writes require --confirm. Membership is access: adding a property to a group
 * widens the reach of everyone holding a grant on it, without a grant being
 * touched, so `show` prints exactly who that is before anything changes.
 *
 * `--rule` is repeatable, `field=a,b` — e.g. `--rule brandCode=HX,HP --rule state=IN`.
 */
import { prisma } from '../src/db.ts';
import {
  GROUP_KINDS,
  addMember,
  createGroup,
  grantsOnGroup,
  groupDetail,
  listGroups,
  materializeAll,
  materializeGroup,
  removeMember,
  resolveProperty,
  type GroupKind,
} from '../src/groups/groups.ts';
import { describeRule, parseRule, type GroupRule } from '../src/groups/rules.ts';

type Flags = Record<string, string | string[] | boolean>;

function parse(argv: string[]): { command: string; flags: Flags } {
  const [command = 'help', ...rest] = argv;
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }
    const existing = flags[key];
    if (typeof existing === 'string') flags[key] = [existing, next];
    else if (Array.isArray(existing)) existing.push(next);
    else flags[key] = next;
    i++;
  }
  return { command, flags };
}

function str(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

function many(flags: Flags, key: string): string[] {
  const v = flags[key];
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v;
  return [];
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** `--rule brandCode=HX,HP --rule state=IN` → { brandCode: ['HX','HP'], state: ['IN'] } */
function ruleFrom(flags: Flags): GroupRule | undefined {
  const specs = many(flags, 'rule');
  if (specs.length === 0) return undefined;
  const raw: Record<string, string[]> = {};
  for (const spec of specs) {
    const eq = spec.indexOf('=');
    if (eq < 1) fail(`--rule wants field=value, got "${spec}"`);
    const field = spec.slice(0, eq).trim();
    const values = spec.slice(eq + 1).split(',').map((v) => v.trim()).filter(Boolean);
    raw[field] = [...(raw[field] ?? []), ...values];
  }
  return parseRule(raw);
}

async function printGroup(id: string): Promise<void> {
  const group = await groupDetail(id);
  if (!group) fail(`no such group: ${id}`);
  const rule = group.ruleJson ? parseRule(group.ruleJson) : null;

  console.log(`\n  ${group.name}  ${group.id}`);
  console.log(`  ${group.kind} · ${group.membershipMode}${group.archivedAt ? ' · ARCHIVED' : ''}`);
  if (group.description) console.log(`  ${group.description}`);
  if (rule) {
    console.log(`  rule: ${describeRule(rule)}`);
    console.log(`  synced: ${group.syncedAt ? group.syncedAt.toISOString() : 'never'}`);
  }

  console.log(`\n  members (${group.members.length})`);
  for (const m of group.members) {
    console.log(`    ${m.property.code.padEnd(6)} ${m.property.status.padEnd(9)} ${m.property.name}`);
  }
  if (group.members.length === 0) console.log('    (none)');

  const grants = await grantsOnGroup(group.id);
  console.log(`\n  live grants on this group (${grants.length}) — who a membership change affects`);
  for (const g of grants) {
    console.log(`    ${g.person.name} <${g.person.email}> · ${g.role.name} v${g.roleVersion}`);
  }
  if (grants.length === 0) console.log('    (none)');
  console.log('');
}

async function main(): Promise<void> {
  const { command, flags } = parse(process.argv.slice(2));
  const confirm = flags['confirm'] === true;

  switch (command) {
    case 'list': {
      const groups = await listGroups(flags['all'] === true);
      if (groups.length === 0) {
        console.log('  no groups yet');
        break;
      }
      for (const g of groups) {
        const stale = g.membershipMode === 'rule' && !g.syncedAt ? ' · NEVER SYNCED' : '';
        console.log(
          `  ${g.id.padEnd(24)} ${g.kind.padEnd(8)} ${String(g._count.members).padStart(3)} members  ${g.name}${stale}${g.archivedAt ? ' · archived' : ''}`,
        );
      }
      break;
    }

    case 'show': {
      const id = str(flags, 'id') ?? fail('--id is required');
      await printGroup(id);
      break;
    }

    case 'new': {
      const name = str(flags, 'name') ?? fail('--name is required');
      const kind = (str(flags, 'kind') ?? 'ad_hoc') as GroupKind;
      if (!GROUP_KINDS.includes(kind)) fail(`--kind must be one of: ${GROUP_KINDS.join(', ')}`);
      const rule = ruleFrom(flags);
      if (!confirm) {
        console.log(`  would create ${kind} group "${name}"${rule ? ` with rule: ${describeRule(rule)}` : ' (manual)'}`);
        console.log('  re-run with --confirm');
        break;
      }
      const group = await createGroup({
        kind,
        name,
        description: str(flags, 'description') ?? '',
        rule,
        actorId: null,
      });
      console.log(`  ✓ ${group.id}`);
      await printGroup(group.id);
      break;
    }

    case 'add':
    case 'remove': {
      const id = str(flags, 'id') ?? fail('--id is required');
      const ref = str(flags, 'property') ?? fail('--property is required');
      const property = await resolveProperty(ref);
      if (!property) fail(`no property with code or id "${ref}"`);
      if (!confirm) {
        console.log(`  would ${command} ${property.code} (${property.name}) ${command === 'add' ? 'to' : 'from'} ${id}`);
        const grants = await grantsOnGroup(id);
        console.log(`  ${grants.length} live grant(s) on that group would change reach`);
        console.log('  re-run with --confirm');
        break;
      }
      if (command === 'add') await addMember(id, property.id, null);
      else await removeMember(id, property.id, null);
      await printGroup(id);
      break;
    }

    case 'sync': {
      const id = str(flags, 'id');
      const results = id ? [await materializeGroup(id, null)] : await materializeAll(null);
      if (results.length === 0) console.log('  no rule-backed groups');
      for (const r of results) {
        console.log(`  ${r.groupId}: +${r.added.length} −${r.removed.length} → ${r.total} members`);
      }
      break;
    }

    default:
      console.log(`
  npm run groups -- list [--all]
  npm run groups -- show   --id grp_midwest
  npm run groups -- new    --kind region --name "Midwest" --confirm
  npm run groups -- new    --kind brand --name Hampton --rule brandCode=HX --confirm
  npm run groups -- add    --id grp_midwest --property EVVBC --confirm
  npm run groups -- remove --id grp_midwest --property EVVBC --confirm
  npm run groups -- sync   [--id grp_hampton]

  kinds: ${GROUP_KINDS.join(', ')}
`);
  }
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? `✗ ${err.message}` : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {
      /* never connected */
    }
  });
