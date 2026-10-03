/**
 * The shell stream CLI (docs/01 §1.4).
 *
 *   npm run shell -- subscribers
 *   npm run shell -- subscribe --name inspire --url https://…/api/registry/v1/shell --confirm
 *   npm run shell -- subscribe --name inspire --url … --rotate --confirm
 *   npm run shell -- backfill --confirm
 *   npm run shell -- deliver [--name inspire]
 *   npm run shell -- rewind --name inspire [--to 0] --confirm
 *   npm run shell -- show --code ALQBC
 *
 * Writes need --confirm. `deliver` does not: it only pushes what the stream
 * already says, and consumers ignore anything not newer than what they hold,
 * so running it twice is the same as running it once.
 */
import { prisma } from '../src/db.ts';
import {
  backfill,
  buildShell,
  deliver,
  deliverAll,
  listSubscribers,
  provisioningFor,
  registerSubscriber,
  rewind,
  type DeliveryResult,
} from '../src/shell/publish.ts';

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

function report(r: DeliveryResult): void {
  const mark = r.ok ? '✓' : '✗';
  console.log(`  ${mark} ${r.subscriber.padEnd(12)} cursor ${r.cursor}/${r.head}  delivered ${r.delivered}`);
  if (r.error) console.log(`      ${r.error}`);
}

async function main(): Promise<void> {
  const { command, flags } = parse(process.argv.slice(2));
  const confirm = flags['confirm'] === true;

  switch (command) {
    case 'subscribers': {
      const { head, subs } = await listSubscribers();
      console.log(`\n  stream head: ${head}\n`);
      if (!subs.length) console.log('  no subscribers — register Inspire and InspiredREV with `subscribe`');
      for (const s of subs) {
        const lag = head - s.cursor;
        console.log(`  ${s.name.padEnd(12)} ${s.active ? 'active ' : 'paused '} cursor ${s.cursor} (${lag ? `${lag} behind` : 'current'})`);
        console.log(`      ${s.url}`);
        if (s.lastError) console.log(`      last error: ${s.lastError}`);
      }
      console.log();
      return;
    }

    case 'subscribe': {
      const name = str(flags, 'name') ?? fail('--name is required (inspire | inspiredrev)');
      const url = str(flags, 'url') ?? fail('--url is required — the consumer’s /api/registry/v1/shell');
      if (!confirm) {
        console.log(`\n  Would register ${name} → ${url}${flags['rotate'] ? ' and rotate its secret' : ''}. Rerun with --confirm.\n`);
        process.exitCode = 1;
        return;
      }
      const { secret, created } = await registerSubscriber(name, url, flags['rotate'] === true);
      console.log(`\n  ✓ ${created ? 'registered' : 'updated'} ${name} → ${url}`);
      if (created || flags['rotate']) {
        console.log('\n  Set this on the consumer as REGISTRY_SHELL_SECRET (shown once here):\n');
        console.log(`      ${secret}\n`);
        console.log('  Then: npm run shell -- deliver --name ' + name + '\n');
      } else {
        console.log('  Secret unchanged. Pass --rotate to issue a new one.\n');
      }
      return;
    }

    case 'backfill': {
      if (!confirm) {
        console.log('\n  Would announce every property once on the shell stream (reason: backfill).');
        console.log('  Safe to repeat — it only bumps versions. Rerun with --confirm.\n');
        process.exitCode = 1;
        return;
      }
      const n = await backfill();
      console.log(`\n  ✓ announced ${n} propert${n === 1 ? 'y' : 'ies'}. Now: npm run shell -- deliver\n`);
      return;
    }

    case 'deliver': {
      const name = str(flags, 'name');
      console.log();
      if (name) report(await deliver(name));
      else for (const r of await deliverAll()) report(r);
      console.log();
      return;
    }

    case 'rewind': {
      const name = str(flags, 'name') ?? fail('--name is required');
      const to = Number(str(flags, 'to') ?? '0');
      if (!Number.isInteger(to) || to < 0) fail('--to must be a non-negative integer');
      if (!confirm) {
        console.log(`\n  Would rewind ${name} to ${to}. The next delivery replays from there;`);
        console.log('  consumers skip anything not newer than what they hold. Rerun with --confirm.\n');
        process.exitCode = 1;
        return;
      }
      await rewind(name, to);
      console.log(`\n  ✓ ${name} rewound to ${to}. Now: npm run shell -- deliver --name ${name}\n`);
      return;
    }

    case 'show': {
      const code = (str(flags, 'code') ?? fail('--code is required')).toUpperCase();
      const p = await prisma.property.findUnique({ where: { code } });
      if (!p) fail(`${code} is not a current code`);
      console.log(`\n${JSON.stringify(await buildShell(p.id), null, 2)}\n`);
      for (const row of await provisioningFor(p.id)) {
        console.log(`  ${row.subscriber.padEnd(12)} ${row.state}${row.lastError ? `  — ${row.lastError}` : ''}`);
      }
      console.log();
      return;
    }

    default:
      console.log(`
  Shell stream CLI — identity flows down (docs/01 §1.4)

    subscribers                      Who mirrors the registry, and how far behind.
    subscribe --name … --url …       Register a consumer. Prints its secret once.
              [--rotate] --confirm
    backfill --confirm               Announce every property once. Run after the
                                     migration, so pre-stream rows reach consumers.
    deliver [--name …]               Push everything past each cursor. Idempotent.
    rewind --name … [--to 0]         Replay from a point. Safe: consumers keep
           --confirm                 whichever version is newer.
    show --code ALQBC                The shell as consumers receive it, and who has it.
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
