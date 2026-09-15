/**
 * Sunrise — create the first account (docs/01 §2).
 *
 *   npm run sunrise -- --email maz@mazcoenterprises.com --name "Maz" --confirm
 *
 * Every other account in this system is provisioned by someone who already has
 * access. This one cannot be, so it is made here: one person, one portfolio-
 * scoped Owner grant, and from then on the console provisions itself.
 *
 * It runs ONCE. Not "should" — it refuses outright if any person exists, so
 * there is no command that can quietly mint a second unaccountable owner. If
 * you are locked out, the answer is a grant from someone who has access, or a
 * deliberate database intervention that leaves a trace. Not this.
 *
 * `--password` is accepted for automation but omitting it is better: you will
 * be prompted, and the password will not be in your shell history.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { grantAccess, registryHasNoPeople } from '../src/auth/access.ts';
import { SUNRISE_ROLE } from '../src/auth/catalog.ts';
import { checkPassword, hashPassword } from '../src/auth/password.ts';
import { prisma } from '../src/db.ts';

function flag(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

function has(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

async function prompt(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  if (!hidden) {
    const answer = await rl.question(question);
    rl.close();
    return answer.trim();
  }
  // Mute the echo so the password does not end up on screen or in a scrollback.
  const output = stdout as unknown as { write(chunk: string): boolean };
  const original = output.write.bind(output);
  let muted = false;
  (output as { write: (chunk: string) => boolean }).write = (chunk: string) =>
    muted ? true : original(chunk);
  const pending = rl.question(question);
  muted = true;
  const answer = await pending;
  muted = false;
  (output as { write: (chunk: string) => boolean }).write = original;
  stdout.write('\n');
  rl.close();
  return answer.trim();
}

async function main(): Promise<void> {
  if (!(await registryHasNoPeople())) {
    console.log('\n  ✗ This registry already has people in it.');
    console.log('    Sunrise runs once, by design — a second one would be an owner');
    console.log('    nobody granted and nobody can point at. Ask someone with the');
    console.log('    Owner role to grant you access instead.\n');
    process.exitCode = 1;
    return;
  }

  const roles = await prisma.role.count();
  if (roles === 0) {
    console.log('\n  ✗ The role catalog is empty. Run `npm run db:seed` first.\n');
    process.exitCode = 1;
    return;
  }

  const email = (flag('email') ?? (await prompt('  Email: '))).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.log('\n  ✗ That does not look like an email address.\n');
    process.exitCode = 1;
    return;
  }

  const name = flag('name') ?? (await prompt('  Name: '));
  if (!name) {
    console.log('\n  ✗ A name is required — grants are attributed to a person.\n');
    process.exitCode = 1;
    return;
  }

  const password = flag('password') ?? (await prompt('  Password (hidden): ', true));
  const check = checkPassword(password);
  if (!check.ok) {
    console.log(`\n  ✗ ${check.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (!has('confirm')) {
    console.log('\n  Would create the sunrise account:');
    console.log(`      ${name} <${email}>`);
    console.log(`      ${SUNRISE_ROLE} at portfolio scope`);
    console.log('\n  Rerun with --confirm.\n');
    process.exitCode = 1;
    return;
  }

  const person = await prisma.person.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(password),
      status: 'active',
    },
  });

  // grantedById is null and only ever null here: no one issued this grant.
  // Every later grant names the person who made it.
  await grantAccess({
    personId: person.id,
    roleKey: SUNRISE_ROLE,
    scope: 'portfolio',
    grantedById: null,
    reason: 'Sunrise — the first account, created before anyone could grant it.',
  });

  await prisma.auditEvent.create({
    data: {
      actorId: person.id,
      action: 'person.sunrise',
      subject: person.id,
      detail: { email, name },
    },
  });

  console.log(`\n  ✓ Sunrise account created\n`);
  console.log(`      ${name} <${email}>`);
  console.log(`      ${SUNRISE_ROLE} at portfolio scope`);
  console.log(`      person id  ${person.id}`);
  console.log('\n  Sign in at /login. Everyone else gets access from People.\n');
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
