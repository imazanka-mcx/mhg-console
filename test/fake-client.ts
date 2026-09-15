import type { PrismaLike, RegistryTx } from '../src/registry/prisma.ts';

/**
 * An in-memory stand-in for the Prisma client, faithful on the three behaviours
 * the adapter depends on: findUnique resolves by ANY unique field (not just the
 * primary key, because findSubmarketCode looks up submarketKey), a unique
 * collision throws Prisma's P2002 shape, and a transaction that throws leaves
 * the store untouched.
 *
 * It is deliberately NOT a database. The claim that Postgres enforces these
 * constraints under real concurrency is proved in prisma/verify/constraints.sh
 * against a real server; this fake exists to test the adapter's LOGIC — which
 * error it raises, what it writes, and what a rebrand leaves behind.
 */

class P2002 extends Error {
  readonly code = 'P2002';
  readonly meta: { target: string[] };
  constructor(meta: { target: string[] }) {
    super(`Unique constraint failed on the fields: (${meta.target.join(',')})`);
    this.name = 'PrismaClientKnownRequestError';
    this.meta = meta;
  }
}

type Row = Record<string, unknown>;

interface TableSpec {
  /** Primary key field. */
  pk: string;
  /** Other unique fields, in the order Postgres would report them. */
  unique?: string[];
}

class Table<T extends Row> {
  rows = new Map<string, T>();
  private readonly spec: TableSpec;

  constructor(spec: TableSpec) {
    this.spec = spec;
  }

  private keyOf(row: Row): string {
    return String(row[this.spec.pk]);
  }

  private assertUnique(row: Row, ignoreKey?: string): void {
    for (const [k, existing] of this.rows) {
      if (k === ignoreKey) continue;
      if (existing[this.spec.pk] === row[this.spec.pk]) {
        throw new P2002({ target: [this.spec.pk] });
      }
      for (const field of this.spec.unique ?? []) {
        const incoming = row[field];
        // Nulls do not collide — the whole point of market_claim.submarket_key.
        if (incoming === null || incoming === undefined) continue;
        if (existing[field] === incoming) throw new P2002({ target: [field] });
      }
    }
  }

  async findUnique(args: { where: Record<string, unknown> }): Promise<T | null> {
    const entries = Object.entries(args.where);
    for (const row of this.rows.values()) {
      if (entries.every(([k, v]) => row[k] === v)) return row;
    }
    return null;
  }

  async findMany(args?: { orderBy?: Record<string, 'asc' | 'desc'> }): Promise<T[]> {
    const rows = [...this.rows.values()];
    const orderBy = args?.orderBy;
    if (orderBy) {
      const [field, dir] = Object.entries(orderBy)[0] ?? [];
      if (field) {
        rows.sort((a, b) => {
          const cmp = String(a[field]).localeCompare(String(b[field]));
          return dir === 'desc' ? -cmp : cmp;
        });
      }
    }
    return rows;
  }

  async create(args: { data: Row }): Promise<T> {
    this.assertUnique(args.data);
    const row = { ...args.data } as T;
    this.rows.set(this.keyOf(row), row);
    return row;
  }

  async update(args: { where: Record<string, unknown>; data: Row }): Promise<T> {
    const existing = await this.findUnique({ where: args.where });
    if (!existing) throw new Error(`update on missing row: ${JSON.stringify(args.where)}`);
    const merged = { ...existing, ...args.data } as T;
    this.rows.set(this.keyOf(merged), merged);
    return merged;
  }

  async upsert(args: { where: Record<string, unknown>; create: Row; update: Row }): Promise<T> {
    const existing = await this.findUnique({ where: args.where });
    if (existing) {
      const merged = { ...existing, ...args.update } as T;
      this.assertUnique(merged, this.keyOf(existing));
      this.rows.set(this.keyOf(merged), merged);
      return merged;
    }
    return this.create({ data: args.create });
  }

  snapshot(): Map<string, T> {
    return new Map([...this.rows].map(([k, v]) => [k, { ...v } as T]));
  }

  restore(snap: Map<string, T>): void {
    this.rows = snap;
  }
}

export function fakeClient() {
  const property = new Table<Row>({ pk: 'id', unique: ['code'] });
  const innCode = new Table<Row>({ pk: 'code' });
  const marketClaim = new Table<Row>({ pk: 'marketCode', unique: ['submarketKey'] });

  const tx = { property, innCode, marketClaim } as unknown as RegistryTx;

  const db = {
    ...tx,
    async $transaction<T>(fn: (t: RegistryTx) => Promise<T>): Promise<T> {
      const snaps = [property.snapshot(), innCode.snapshot(), marketClaim.snapshot()] as const;
      try {
        return await fn(tx);
      } catch (err) {
        // Roll back — a failed claim must leave nothing behind.
        property.restore(snaps[0]);
        innCode.restore(snaps[1]);
        marketClaim.restore(snaps[2]);
        throw err;
      }
    },
  } as unknown as PrismaLike;

  return { db, property, innCode, marketClaim };
}
