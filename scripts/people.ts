/**
 * The people stream CLI (docs/01 §2.8). Rides the shell stream's
 * subscriptions — subscribe a consumer with `npm run shell -- subscribe` and it
 * receives both streams.
 *
 *   npm run people -- subscribers
 *   npm run people -- backfill --confirm
 *   npm run people -- deliver [--name inspire]
 *   npm run people -- rewind --name inspire [--to 0] --confirm
 *   npm run people -- show --email someone@example.com
 *
 * `show` prints exactly what each consumer receives, password hash redacted.
 */
import { prisma } from '../src/db.ts';
import {
  backfillPeople,
  buildPerson,
  deliverAllPeople,
  deliverPeople,
  listPeopleSubscribers,
  peopleProvisioningFor,
  rewindPeople,
  type PeopleDeliveryResult,
} from '../src/people/publish.ts';
import { PEOPLE_CONSUMERS } from '../src/shell/contract.ts';

type Flags = Record<string, string | boolean>;

function parse(argv: string[]): { command: string; flags: Flags } {
  const [command = 'help', ...rest] = argv;
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  }
  return { command, flags };
}

function str(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === 'string' ? v : undefined;
}

function fail(message: string): never {
  console.error(`\n  ✗ ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

function report(r: PeopleDeliveryResult): void {
  const mark = r.ok ? '✓' : '✗';
  console.log(`  ${mark} ${r.subscriber.padEnd(12)} delivered ${r.delivered}, cursor ${r.cursor}/${r.head}${r.error ? `  — ${r.error}` : ''}`);
}

async function main(): Promise<void> {
  const { command, flags } = parse(process.argv.slice(2));
  const confirm = flags['confirm'] === true;

  switch (command) {
    case 'subscribers': {
      const { head, subs } = await listPeopleSubscribers();
      console.log(`\n  people stream head: ${head}\n`);
      if (!subs.length) console.log('  no subscribers — register them with `npm run shell -- subscribe`\n');
      for (const s of subs) {
        const behind = head - s.cursor;
        console.log(`  ${s.name.padEnd(12)} ${behind === 0 ? 'current' : `${behind} behind`}  → ${s.url}${s.lastError ? `\n               ✗ ${s.lastError}` : ''}`);
      }
      console.log();
      return;
    }

    case 'backfill': {
      if (!confirm) {
        console.log('\n  Would announce every person once, so people who existed before the stream');
        console.log('  reach Inspire and InspiredREV. Rerun with --confirm.\n');
        process.exitCode = 1;
        return;
      }
      const n = await backfillPeople();
      console.log(`\n  ✓ ${n} people announced. Now: npm run people -- deliver\n`);
      return;
    }

    case 'deliver': {
      const name = str(flags, 'name');
      console.log();
      if (name) report(await deliverPeople(name));
      else for (const r of await deliverAllPeople()) report(r);
      console.log();
      return;
    }

    case 'rewind': {
      const name = str(flags, 'name') ?? fail('--name is required');
      const to = Number(str(flags, 'to') ?? '0');
      if (!Number.isInteger(to) || to < 0) fail('--to must be a non-negative integer');
      if (!confirm) {
        console.log(`\n  Would rewind ${name}'s people cursor to ${to}. Rerun with --confirm.\n`);
        process.exitCode = 1;
        return;
      }
      await rewindPeople(name, to);
      console.log(`\n  ✓ ${name} rewound to ${to}. Now: npm run people -- deliver --name ${name}\n`);
      return;
    }

    case 'show': {
      const email = (str(flags, 'email') ?? fail('--email is required')).trim().toLowerCase();
      const p = await prisma.person.findUnique({ where: { email } });
      if (!p) fail(`No person with email ${email}`);
      for (const consumer of PEOPLE_CONSUMERS) {
        const person = await buildPerson(p.id, consumer);
        if (!person) continue;
        const shown = { ...person, passwordHash: person.passwordHash ? '<bcrypt>' : '' };
        console.log(`\n  ── ${consumer}\n${JSON.stringify(shown, null, 2)}`);
      }
      console.log();
      for (const row of await peopleProvisioningFor(p.id)) {
        console.log(`  ${row.subscriber.padEnd(12)} ${row.state}${row.lastError ? `  — ${row.lastError}` : ''}`);
      }
      console.log();
      return;
    }

    default:
      console.log(`
  People stream CLI — who may sign in where (docs/01 §2.8)

    subscribers                      Each consumer's people cursor and last error.
    backfill --confirm               Announce every person once. Run after the
                                     migration, so existing people reach consumers.
    deliver [--name …]               Push everything past each cursor. Idempotent.
    rewind --name … [--to 0]         Replay from a point. Safe: consumers keep
           --confirm                 whichever version is newer.
    show --email …                   What each consumer receives for one person.
`);
      return;
  }
}

main()
  .catch((err: unknown) => {
    if (err instanceof Error && process.exitCode === 1) return;
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {
      /* nothing to disconnect */
    }
  });
