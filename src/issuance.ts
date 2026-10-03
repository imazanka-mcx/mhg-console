import { MHG_CONFIG, deriveCode, issueCode, rebrand } from '@mcx/inn-code';
import type { DeriveResult, EngineDeps, IssueRequest, IssueResult, PropertyStatus } from '@mcx/inn-code';

import { prisma } from './db.ts';
import { materializeAll } from './groups/groups.ts';
import { checkTransition, type Transition } from './lifecycle.ts';
import { PrismaRegistry, type PrismaLike } from './registry/prisma.ts';
import { checkSetup, type ShellSetup } from './setup.ts';
import { publish } from './shell/publish.ts';

/**
 * The console's issuance service: the Inn Code engine bound to the Postgres
 * registry (docs/01 §1.2).
 *
 * Everything that issues a code goes through here — the New Property flow, the
 * CLI, any backfill. There is deliberately no second path, because the registry
 * is only the source of truth if it is the only writer (G8).
 *
 * The generated PrismaClient is passed through `asRegistryClient`: the adapter
 * is typed against a structural port rather than Prisma's generated types, the
 * same way FirestoreRegistry is typed against firebase-admin, so it stays
 * testable without a client and a client change cannot silently reshape it.
 */

/** The generated client's delegates are narrower than the port; this is the one place that bridges. */
export function asRegistryClient(client: typeof prisma): PrismaLike {
  return client as unknown as PrismaLike;
}

export function registryFor(client: typeof prisma = prisma): PrismaRegistry {
  return new PrismaRegistry(asRegistryClient(client));
}

export function engineFor(client: typeof prisma = prisma): EngineDeps {
  return { config: MHG_CONFIG, registry: registryFor(client) };
}

/**
 * Propose a code without touching the registry. Reads it (so the proposal
 * accounts for what is already claimed) but writes nothing — safe to call on
 * every keystroke, and the basis of the CLI's dry run.
 */
export function proposeCode(
  req: IssueRequest,
  client: typeof prisma = prisma,
): Promise<DeriveResult> {
  return deriveCode(engineFor(client), req);
}

/**
 * Re-materialize the rule groups after the portfolio changes.
 *
 * A new Hampton has to land in the Hampton group without anybody remembering to
 * press a button — that is what "brand grants behave exactly as they do now"
 * means (§2.2). Never allowed to fail an issuance: the code is claimed and the
 * registry is correct whether or not the groups caught up, and a group that did
 * not catch up shows as a stale `syncedAt` in Oversight.
 */
async function syncGroupsQuietly(): Promise<void> {
  try {
    await materializeAll(null);
  } catch {
    /* the registry write already succeeded; staleness is the visible signal */
  }
}

/**
 * Issue a code for real. The atomic claim inside is the uniqueness guarantee (G8).
 *
 * `setup` carries the shell fields the engine does not know (timezone, currency,
 * planned opening). It is validated BEFORE the claim — a claim is permanent, so
 * a bad timezone must not be discovered after the code is burned.
 *
 * Then the new property goes onto the shell stream, which is how a hotel signed
 * at LOI appears in Inspire and InspiredREV before it has a PMS (G6, §6.2).
 */
export async function issueProperty(
  req: IssueRequest,
  setup: Partial<ShellSetup> = {},
  client: typeof prisma = prisma,
): Promise<IssueResult> {
  const checked = checkSetup(setup);
  if (!checked.ok) throw new Error(Object.values(checked.errors).join(' '));

  const result = await issueCode(engineFor(client), req);
  if (!result.ok) return result;

  if (Object.keys(checked.value).length) {
    await client.property.update({ where: { id: result.record.propertyId }, data: checked.value });
  }
  await syncGroupsQuietly();
  await publish([result.record.propertyId], 'issued');
  return result;
}

/**
 * Edit the shell fields the engine does not own. Not identity in the inn-code
 * sense — no code changes — but consumers stand a hotel up on these, so every
 * edit is audited and published.
 */
export async function updateSetup(
  propertyId: string,
  setup: Partial<ShellSetup>,
  actorId: string | null,
  client: typeof prisma = prisma,
): Promise<void> {
  const checked = checkSetup(setup);
  if (!checked.ok) throw new Error(Object.values(checked.errors).join(' '));
  const before = await client.property.findUnique({ where: { id: propertyId } });
  if (!before) throw new Error('No such property.');

  const changed = (Object.keys(checked.value) as (keyof ShellSetup)[]).filter(
    (k) => checked.value[k] !== before[k],
  );
  if (!changed.length) return;

  await client.property.update({ where: { id: propertyId }, data: checked.value });
  await client.auditEvent.create({
    data: {
      actorId,
      action: 'property.setup',
      subject: before.code,
      detail: Object.fromEntries(changed.map((k) => [k, { from: before[k], to: checked.value[k] }])),
    },
  });
  await publish([propertyId], 'setup');
}

/**
 * Move a property through its lifecycle (pipeline → active → retired).
 * Forward only, retired terminal — the rule lives in lifecycle.ts. This is the
 * one path the UI and the CLI both use, so neither can skip the check.
 */
export async function changeStatus(
  code: string,
  to: PropertyStatus,
  actorId: string | null,
  reason: string,
  client: typeof prisma = prisma,
): Promise<{ from: PropertyStatus; to: PropertyStatus; transition: Transition }> {
  const property = await client.property.findUnique({ where: { code } });
  if (!property) {
    const ledger = await client.innCode.findUnique({ where: { code } });
    throw new Error(
      ledger
        ? `${code} is no longer the code its property flies — it was replaced on a rebrand. Change the current code instead.`
        : `${code} is not in the registry.`,
    );
  }
  const from = property.status as PropertyStatus;
  const check = checkTransition(from, to);
  if (!check.ok) throw new Error(check.reason);

  await registryFor(client).setStatus(code, to);
  await client.auditEvent.create({
    data: {
      actorId,
      action: `property.${check.transition}`,
      subject: code,
      detail: { from, to, reason: reason.trim() },
    },
  });
  // Status is a rule-group field (a rule that does not mention status excludes
  // retired codes, §2.2), so the groups may move too before the shell goes out.
  await syncGroupsQuietly();
  await publish([property.id], 'status');
  return { from, to, transition: check.transition };
}

/**
 * G2 — a rebrand. Issues the new code, points it back at the old one, then
 * retires the old one. The property keeps its internal id, so nothing
 * downstream is repointed (G1).
 */
export async function rebrandProperty(
  oldCode: string,
  newBrandCode: string,
  overrides: Partial<IssueRequest> = {},
  client: typeof prisma = prisma,
): Promise<IssueResult> {
  const result = await rebrand(engineFor(client), oldCode, newBrandCode, overrides);
  if (!result.ok) return result;
  // The brand changed, so brand-group membership did too — and the property
  // keeps its id, so its manual groups are untouched without doing anything.
  await syncGroupsQuietly();
  // Same propertyId, new code: consumers keyed on the id relabel in place (G1, G2).
  await publish([result.record.propertyId], 'rebrand');
  return result;
}
