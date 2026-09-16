import { MHG_CONFIG, deriveCode, issueCode, rebrand } from '@mcx/inn-code';
import type { DeriveResult, EngineDeps, IssueRequest, IssueResult } from '@mcx/inn-code';

import { prisma } from './db.ts';
import { materializeAll } from './groups/groups.ts';
import { PrismaRegistry, type PrismaLike } from './registry/prisma.ts';

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

/** Issue a code for real. The atomic claim inside is the uniqueness guarantee (G8). */
export async function issueProperty(
  req: IssueRequest,
  client: typeof prisma = prisma,
): Promise<IssueResult> {
  const result = await issueCode(engineFor(client), req);
  await syncGroupsQuietly();
  return result;
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
  // The brand changed, so brand-group membership did too — and the property
  // keeps its id, so its manual groups are untouched without doing anything.
  await syncGroupsQuietly();
  return result;
}
