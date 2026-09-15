import type {
  MarketClaim,
  PropertyRecord,
  PropertyStatus,
  Registry,
} from '@mcx/inn-code';
import { ConflictError, conflicts, ownsSubmarket, submarketKey } from '@mcx/inn-code';

/**
 * Postgres adapter for the Registry port (docs/01 §1.2).
 *
 * The Firestore adapter had to make the code and the market code into document
 * IDs, because Firestore cannot enforce uniqueness on a field. Postgres can, so
 * the guarantee moves where it belongs: `inn_code.code` is a primary key and
 * `market_claim.submarket_key` is a unique index. The read-then-write checks
 * below are there to produce a GOOD ERROR, not to provide the guarantee — under
 * concurrency they lose, and the constraint catches what they miss. That is why
 * every write path also translates a unique violation into ConflictError.
 *
 * ConflictError means "re-derive and try again", and `issueCode` already loops
 * on it. So a lost race costs a retry, never a duplicate.
 *
 * Typed structurally against the client, the same way FirestoreRegistry is typed
 * against firebase-admin: this file compiles and type-checks without a generated
 * Prisma client present, and any client with these delegates satisfies it.
 */

// ── the slice of the Prisma client this adapter uses ───────────────────────

interface FindUnique<T> {
  findUnique(args: { where: Record<string, unknown> }): Promise<T | null>;
}
interface Delegate<T> extends FindUnique<T> {
  findMany(args?: {
    orderBy?: Record<string, 'asc' | 'desc'>;
  }): Promise<T[]>;
  create(args: { data: Record<string, unknown> }): Promise<T>;
  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<T>;
  upsert(args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<T>;
}

export interface RegistryTx {
  property: Delegate<PropertyRow>;
  innCode: Delegate<InnCodeRow>;
  marketClaim: Delegate<MarketClaimRow>;
}

export interface PrismaLike extends RegistryTx {
  $transaction<T>(fn: (tx: RegistryTx) => Promise<T>): Promise<T>;
}

export interface PropertyRow extends Omit<PropertyRecord, 'propertyId'> {
  id: string;
}
export type InnCodeRow = Omit<PropertyRecord, 'propertyId'> & { propertyId: string };
export interface MarketClaimRow {
  marketCode: string;
  city: string;
  state: string;
  submarket: string;
  source: MarketClaim['source'];
  claimedAt: string;
  submarketKey: string | null;
}

// ── mapping ────────────────────────────────────────────────────────────────

/** The fields of a PropertyRecord minus its key, shared by both tables. */
function recordFields(r: PropertyRecord): Omit<PropertyRecord, 'propertyId'> {
  return {
    code: r.code,
    name: r.name,
    brandCode: r.brandCode,
    brandName: r.brandName,
    chainCode: r.chainCode,
    marketCode: r.marketCode,
    city: r.city,
    state: r.state,
    submarket: r.submarket,
    franchisorCode: r.franchisorCode,
    status: r.status,
    predecessorCode: r.predecessorCode,
    effectiveDate: r.effectiveDate,
    propCode: r.propCode,
  };
}

function toRecord(row: InnCodeRow): PropertyRecord {
  return {
    propertyId: row.propertyId,
    code: row.code,
    name: row.name,
    brandCode: row.brandCode,
    brandName: row.brandName,
    chainCode: row.chainCode,
    marketCode: row.marketCode,
    city: row.city,
    state: row.state,
    submarket: row.submarket,
    franchisorCode: row.franchisorCode,
    status: row.status,
    predecessorCode: row.predecessorCode,
    effectiveDate: row.effectiveDate,
    propCode: row.propCode,
  };
}

function toClaim(row: MarketClaimRow): MarketClaim {
  return {
    marketCode: row.marketCode,
    city: row.city,
    state: row.state,
    submarket: row.submarket,
    source: row.source,
    claimedAt: row.claimedAt,
  };
}

// ── unique-violation translation ───────────────────────────────────────────

/** Prisma's unique-constraint error, matched structurally so this file imports nothing from it. */
function uniqueViolation(err: unknown): { target: string } | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { code?: unknown; meta?: { target?: unknown } };
  if (e.code !== 'P2002') return null;
  const t = e.meta?.target;
  const target = Array.isArray(t) ? t.join(',') : typeof t === 'string' ? t : '';
  return { target };
}

/**
 * Which claim lost the race. The market_claim table can trip on either its
 * primary key or the submarket index; both mean the same thing to the engine,
 * so both map to 'market'.
 */
function conflictFrom(err: unknown, code: string, marketCode: string): ConflictError | null {
  const v = uniqueViolation(err);
  if (!v) return null;
  const market = v.target.includes('market_code') || v.target.includes('submarket_key');
  return market
    ? new ConflictError(`${marketCode} was claimed by another writer.`, 'market')
    : new ConflictError(`${code} was claimed by another writer.`, 'code');
}

// ── the adapter ────────────────────────────────────────────────────────────

export class PrismaRegistry implements Registry {
  // Declared rather than a constructor parameter property, so this file runs
  // under Node's type stripping (`node --test`) without a build step.
  private readonly db: PrismaLike;

  constructor(db: PrismaLike) {
    this.db = db;
  }

  async hasCode(code: string): Promise<boolean> {
    return (await this.db.innCode.findUnique({ where: { code } })) !== null;
  }

  async getMarketClaim(marketCode: string): Promise<MarketClaim | null> {
    const row = await this.db.marketClaim.findUnique({ where: { marketCode } });
    return row ? toClaim(row) : null;
  }

  async findSubmarketCode(city: string, state: string, submarket: string): Promise<string | null> {
    if (!submarket.trim()) return null;
    const row = await this.db.marketClaim.findUnique({
      where: { submarketKey: submarketKey(city, state, submarket) },
    });
    return row ? row.marketCode : null;
  }

  async claim(record: PropertyRecord, market: MarketClaim): Promise<void> {
    const fields = recordFields(record);
    try {
      await this.db.$transaction(async (tx) => {
        const taken = await tx.innCode.findUnique({ where: { code: record.code } });
        if (taken) {
          throw new ConflictError(`${record.code} was claimed by another writer.`, 'code');
        }

        const existing = await tx.marketClaim.findUnique({
          where: { marketCode: market.marketCode },
        });
        if (existing && conflicts(toClaim(existing), market)) {
          throw new ConflictError(
            `${market.marketCode} belongs to ${existing.city}, ${existing.state}.`,
            'market',
          );
        }

        // The property is upserted, not inserted: a rebrand (G2) updates the
        // hotel in place and keeps its internal id, so nothing downstream has
        // to be repointed (G1). It goes first — inn_code references it.
        await tx.property.upsert({
          where: { id: record.propertyId },
          create: { id: record.propertyId, ...fields },
          update: { ...fields },
        });

        // The ledger row. A rebrand ADDS one; it replaces none (G3).
        // `fields` carries the code; the row's key and the snapshot agree by
        // construction rather than by two values that could drift.
        await tx.innCode.create({
          data: { propertyId: record.propertyId, ...fields },
        });

        if (!existing) {
          await tx.marketClaim.create({
            data: {
              marketCode: market.marketCode,
              city: market.city,
              state: market.state,
              submarket: market.submarket,
              source: market.source,
              claimedAt: market.claimedAt,
              // Only a split or an assigned code owns its submarket (M6). A base
              // market code stores null, and nulls do not collide in a unique
              // index — which is how every airport-derived claim coexists.
              submarketKey: ownsSubmarket(market)
                ? submarketKey(market.city, market.state, market.submarket)
                : null,
            },
          });
        }
      });
    } catch (err) {
      const conflict = conflictFrom(err, record.code, market.marketCode);
      if (conflict) throw conflict;
      throw err;
    }
  }

  async setStatus(code: string, status: PropertyStatus): Promise<void> {
    const row = await this.db.innCode.findUnique({ where: { code } });
    if (!row) return;
    await this.db.innCode.update({ where: { code }, data: { status } });

    // Only touch the hotel if this code is still the one it flies. A rebranded
    // property has moved on, and retiring its old code must not drag the
    // property back to that status.
    const property = await this.db.property.findUnique({ where: { id: row.propertyId } });
    if (property?.code === code) {
      await this.db.property.update({ where: { id: row.propertyId }, data: { status } });
    }
  }

  async get(code: string): Promise<PropertyRecord | null> {
    const row = await this.db.innCode.findUnique({ where: { code } });
    return row ? toRecord(row) : null;
  }

  async list(): Promise<PropertyRecord[]> {
    const rows = await this.db.innCode.findMany({ orderBy: { code: 'asc' } });
    return rows.map(toRecord);
  }
}
