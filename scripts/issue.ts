/**
 * Inn code CLI — issue and inspect codes before there is any UI (docs/01 §4).
 *
 *   npm run issue -- propose --name "BYX Collection Evansville East" \
 *                            --city Evansville --state IN --brand BC --submarket East
 *   npm run issue -- issue   --name "…" --city … --state … --brand … --confirm
 *   npm run issue -- list
 *   npm run issue -- rebrand --code EVVBC --brand LX --confirm
 *
 * `propose` writes nothing. `issue` and `rebrand` REQUIRE --confirm, because a
 * code is permanent the moment it is claimed: retired codes are never reissued
 * (G3) and a market code is never reassigned (M7). There is no undo, so the
 * default had better not be "write".
 */
import { prisma } from '../src/db.ts';
import { issueProperty, proposeCode, rebrandProperty, registryFor } from '../src/issuance.ts';
import type { IssueRequest, PropertyRecord, TraceStep } from '@mcx/inn-code';

type Flags = Record<string, string | boolean>;

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
    } else {
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

function requestFrom(flags: Flags): IssueRequest {
  const city = str(flags, 'city');
  const state = str(flags, 'state');
  const brandCode = str(flags, 'brand');
  const missing = [
    ['--city', city],
    ['--state', state],
    ['--brand', brandCode],
  ].filter(([, v]) => !v);
  if (missing.length) {
    fail(`missing required flag(s): ${missing.map(([f]) => f).join(', ')}`);
  }
  const req: IssueRequest = {
    name: str(flags, 'name') ?? '',
    city: city!,
    state: state!,
    brandCode: brandCode!,
  };
  const submarket = str(flags, 'submarket');
  if (submarket) req.submarket = submarket;
  const franchisor = str(flags, 'franchisor');
  if (franchisor) req.franchisorCode = franchisor;
  const marketOverride = str(flags, 'market-override');
  if (marketOverride) req.marketOverride = marketOverride;
  return req;
}

function fail(message: string): never {
  console.error(`\n  ✗ ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

function showTrace(trace: TraceStep[]): void {
  for (const step of trace) console.log(`      ${step.rule.padEnd(5)} ${step.detail}`);
}

function showRecord(r: PropertyRecord): void {
  console.log(`      code          ${r.code}`);
  console.log(`      propertyId    ${r.propertyId}   ← the foreign key, not the code (G1)`);
  console.log(`      name          ${r.name}`);
  console.log(`      brand         ${r.brandCode}  ${r.brandName}  (${r.chainCode})`);
  console.log(`      market        ${r.marketCode}${r.submarket ? `  submarket: ${r.submarket}` : ''}`);
  console.log(`      place         ${r.city}, ${r.state}`);
  if (r.franchisorCode) console.log(`      franchisor    ${r.franchisorCode}  (cross-reference only, G5)`);
  if (r.predecessorCode) console.log(`      replaces      ${r.predecessorCode}  (G2)`);
  console.log(`      status        ${r.status}`);
  console.log(`      effective     ${r.effectiveDate}`);
}

async function main(): Promise<void> {
  const { command, flags } = parse(process.argv.slice(2));

  switch (command) {
    case 'propose': {
      const result = await proposeCode(requestFrom(flags));
      if (!result.ok) {
        console.log(`\n  ✗ ${result.failure.rule}  ${result.failure.message}\n`);
        console.log('    how it got there:');
        showTrace(result.trace);
        console.log();
        process.exitCode = 1;
        return;
      }
      console.log(`\n  proposed  ${result.candidate.code}   (nothing was written)\n`);
      console.log('    how it got there:');
      showTrace(result.candidate.trace);
      console.log(`\n    to claim it, rerun with: issue … --confirm\n`);
      return;
    }

    case 'issue': {
      const req = requestFrom(flags);
      if (!flags['confirm']) {
        console.log('\n  Refusing to issue without --confirm.');
        console.log('  A code is permanent once claimed — retired codes are never reissued (G3).');
        console.log('  Run `propose` first to see what it would be.\n');
        process.exitCode = 1;
        return;
      }
      const result = await issueProperty(req);
      if (!result.ok) {
        console.log(`\n  ✗ ${result.failure.rule}  ${result.failure.message}\n`);
        showTrace(result.trace);
        console.log();
        process.exitCode = 1;
        return;
      }
      console.log(`\n  ✓ issued  ${result.record.code}\n`);
      showRecord(result.record);
      console.log('\n    rule path:');
      showTrace(result.trace);
      console.log();
      return;
    }

    case 'rebrand': {
      const code = str(flags, 'code');
      const brand = str(flags, 'brand');
      if (!code || !brand) fail('rebrand needs --code and --brand');
      if (!flags['confirm']) {
        console.log('\n  Refusing to rebrand without --confirm.');
        console.log(`  This issues a new code and retires ${code} permanently (G2, G3).\n`);
        process.exitCode = 1;
        return;
      }
      const result = await rebrandProperty(code, brand);
      if (!result.ok) {
        console.log(`\n  ✗ ${result.failure.rule}  ${result.failure.message}\n`);
        process.exitCode = 1;
        return;
      }
      console.log(`\n  ✓ ${code} → ${result.record.code}\n`);
      showRecord(result.record);
      console.log();
      return;
    }

    case 'list': {
      const rows = await registryFor().list();
      if (!rows.length) {
        console.log('\n  The registry is empty.\n');
        return;
      }
      console.log(`\n  ${rows.length} code${rows.length === 1 ? '' : 's'} in the registry:\n`);
      console.log('    CODE   STATUS     PROPERTY ID                            NAME');
      for (const r of rows) {
        console.log(
          `    ${r.code.padEnd(6)} ${r.status.padEnd(10)} ${r.propertyId.padEnd(38)} ${r.name}`,
        );
      }
      console.log('\n  Retired codes stay listed — they are still claimed (G3).\n');
      return;
    }

    default:
      console.log(`
  Inn code CLI

    propose  --name … --city … --state … --brand … [--submarket …] [--franchisor …]
             Shows the code and the rules that produced it. Writes nothing.

    issue    (same flags) --confirm
             Claims the code. Permanent.

    rebrand  --code EVVBC --brand LX --confirm
             Issues a new code, retires the old one, keeps the property id.

    list     Every code ever issued, retired included.
`);
      return;
  }
}

main()
  .catch((err: unknown) => {
    if (err instanceof Error && process.exitCode === 1) return; // already reported
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // `help` never opens a connection, and disconnecting one that was never
    // established makes Prisma resolve its query engine — which fails, loudly,
    // for a command that touched no database at all.
    try {
      await prisma.$disconnect();
    } catch {
      /* nothing to disconnect */
    }
  });
