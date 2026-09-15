import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { MHG_CONFIG, issueCode, rebrand, ConflictError } from '@mcx/inn-code';
import type {
  EngineDeps,
  IssueRequest,
  IssueResult,
  MarketClaim,
  PropertyRecord,
} from '@mcx/inn-code';

import { PrismaRegistry } from '../src/registry/prisma.ts';
import { fakeClient } from './fake-client.ts';

/**
 * `assert.ok(result.ok)` does not narrow a discriminated union — an assertion
 * signature can narrow the value it is given, not the object it came from. So
 * unwrap once, here, and let every case read the record directly.
 */
function issued(result: IssueResult): PropertyRecord {
  if (!result.ok) {
    throw new Error(`expected an issued code, got ${result.failure.code}: ${result.failure.message}`);
  }
  return result.record;
}

/**
 * The Firestore adapter's suite, ported to Postgres semantics (docs/01 §4 step 1).
 *
 * The cases that assert on collection layout are gone — they were testing a
 * four-collection workaround for Firestore's inability to enforce uniqueness on
 * a field, and Postgres does not need it. What replaces them is the constraint
 * proof in prisma/verify/constraints.sh, which runs against a real server.
 */

let fake: ReturnType<typeof fakeClient>;
let deps: EngineDeps;
let counter = 0;

beforeEach(() => {
  fake = fakeClient();
  counter = 0;
  deps = {
    config: MHG_CONFIG,
    registry: new PrismaRegistry(fake.db),
    now: () => new Date('2026-09-15T12:00:00Z'),
    newId: () => `prop-${++counter}`,
  };
});

const req = (over: Partial<IssueRequest> = {}): IssueRequest => ({
  name: 'BYX Collection Evansville East',
  city: 'Evansville',
  state: 'IN',
  brandCode: 'BC',
  submarket: 'East',
  franchisorCode: 'EVVIN',
  ...over,
});

describe('issuing against Postgres', () => {
  test('writes the hotel, the ledger row and the market claim', async () => {
    assert.equal(issued(await issueCode(deps, req())).code, 'EVVBC');

    const property = fake.property.rows.get('prop-1');
    assert.equal(property?.code, 'EVVBC');
    assert.equal(property?.franchisorCode, 'EVVIN');

    assert.equal(fake.innCode.rows.get('EVVBC')?.propertyId, 'prop-1');
    assert.equal(fake.marketClaim.rows.get('EVV')?.submarket, '');
  });

  test('a base market code binds no submarket, so its key is null (M6)', async () => {
    await issueCode(deps, req());
    assert.equal(fake.marketClaim.rows.get('EVV')?.submarketKey, null);
  });

  test('a split claims its submarket, and the key is set (M5, M6)', async () => {
    await issueCode(deps, req());
    assert.equal(issued(await issueCode(deps, req({ submarket: 'West' }))).code, 'EVWBC');
    assert.equal(fake.marketClaim.rows.get('EVW')?.submarketKey, 'evansville|IN|west');
  });

  test('the PROP code is the inn code — every property here is MHG-branded', async () => {
    assert.equal(issued(await issueCode(deps, req({ brandCode: 'BC' }))).propCode, 'EVVBC');
    assert.equal(issued(await issueCode(deps, req({ brandCode: 'LX' }))).propCode, 'EVVLX');
  });
});

describe('rebrand (G2)', () => {
  test('updates the hotel in place, retires the old code, keeps the id (G1)', async () => {
    await issueCode(deps, req());
    assert.equal(issued(await rebrand(deps, 'EVVBC', 'LX')).code, 'EVVLX');

    const property = fake.property.rows.get('prop-1');
    assert.equal(property?.code, 'EVVLX');
    assert.equal(property?.predecessorCode, 'EVVBC');
    assert.equal(property?.propCode, 'EVVLX');

    assert.equal(fake.innCode.rows.get('EVVBC')?.status, 'retired');
    assert.ok(fake.innCode.rows.has('EVVLX'));
  });

  test('does not create a second hotel for the same building', async () => {
    await issueCode(deps, req());
    await rebrand(deps, 'EVVBC', 'LX');
    assert.deepEqual([...fake.property.rows.keys()], ['prop-1']);
  });

  test('retiring the old code does not rewrite the hotel the new code owns', async () => {
    await issueCode(deps, req());
    await rebrand(deps, 'EVVBC', 'LX');
    assert.equal(fake.property.rows.get('prop-1')?.status, 'active');
  });

  test('the retired code stays in the ledger, so G3 fires against history', async () => {
    await issueCode(deps, req());
    await rebrand(deps, 'EVVBC', 'LX');
    const registry = new PrismaRegistry(fake.db);
    assert.equal(await registry.hasCode('EVVBC'), true);
    const codes = (await registry.list()).map((r: PropertyRecord) => r.code);
    assert.deepEqual(codes, ['EVVBC', 'EVVLX']);
  });
});

describe('the claim is what guarantees uniqueness (G8)', () => {
  const record = (over: Partial<PropertyRecord> = {}): PropertyRecord => ({
    propertyId: 'prop-x',
    code: 'EVVBC',
    name: 'BYX Collection Evansville',
    brandCode: 'BC',
    brandName: 'BYX Collection',
    chainCode: 'MAZ',
    marketCode: 'EVV',
    city: 'Evansville',
    state: 'IN',
    submarket: '',
    franchisorCode: '',
    status: 'active',
    predecessorCode: '',
    effectiveDate: '2026-09-15',
    propCode: 'EVVBC',
    ...over,
  });

  const claim = (over: Partial<MarketClaim> = {}): MarketClaim => ({
    marketCode: 'EVV',
    city: 'Evansville',
    state: 'IN',
    submarket: '',
    source: 'airport',
    claimedAt: '2026-09-15',
    ...over,
  });

  test('a taken code is refused as a code conflict', async () => {
    const registry = new PrismaRegistry(fake.db);
    await registry.claim(record(), claim());
    await assert.rejects(
      () => registry.claim(record({ propertyId: 'prop-y' }), claim()),
      (err: unknown) => err instanceof ConflictError && err.kind === 'code',
    );
  });

  test('a market code bound elsewhere is refused as a market conflict (M7)', async () => {
    const registry = new PrismaRegistry(fake.db);
    await registry.claim(
      record({ code: 'SNTBC', marketCode: 'SNT', city: 'Santa Claus' }),
      claim({ marketCode: 'SNT', city: 'Santa Claus', source: 'letters' }),
    );
    await assert.rejects(
      () =>
        registry.claim(
          record({ propertyId: 'prop-y', code: 'SNTLX', marketCode: 'SNT', city: 'Santaquin' }),
          claim({ marketCode: 'SNT', city: 'Santaquin', state: 'UT', source: 'letters' }),
        ),
      (err: unknown) => err instanceof ConflictError && err.kind === 'market',
    );
  });

  test('a failed claim leaves nothing behind', async () => {
    const registry = new PrismaRegistry(fake.db);
    await registry.claim(record(), claim());
    await assert.rejects(() => registry.claim(record({ propertyId: 'prop-y' }), claim()));
    assert.deepEqual([...fake.property.rows.keys()], ['prop-x']);
    assert.equal(fake.innCode.rows.size, 1);
  });

  test("a unique violation the pre-check missed still becomes a ConflictError", async () => {
    // The read-then-write check cannot see a writer that commits in between.
    // Simulate that: the code is absent when we look and present when we insert.
    const registry = new PrismaRegistry(fake.db);
    const realCreate = fake.innCode.create.bind(fake.innCode);
    let fired = false;
    fake.innCode.create = async (args) => {
      if (!fired) {
        fired = true;
        const err = Object.assign(new Error('unique'), {
          code: 'P2002',
          meta: { target: ['code'] },
        });
        throw err;
      }
      return realCreate(args);
    };

    await assert.rejects(
      () => registry.claim(record(), claim()),
      (err: unknown) => err instanceof ConflictError && err.kind === 'code',
    );
  });

  test('a submarket collision is reported as a market conflict', async () => {
    const registry = new PrismaRegistry(fake.db);
    const err = Object.assign(new Error('unique'), {
      code: 'P2002',
      meta: { target: ['submarket_key'] },
    });
    fake.marketClaim.create = async () => {
      throw err;
    };
    await assert.rejects(
      () => registry.claim(record(), claim()),
      (e: unknown) => e instanceof ConflictError && e.kind === 'market',
    );
  });
});

describe('setStatus', () => {
  test('is a no-op for a code that was never issued', async () => {
    const registry = new PrismaRegistry(fake.db);
    await registry.setStatus('ZZZZZ', 'retired');
    assert.equal(fake.innCode.rows.size, 0);
  });

  test('moves the hotel too while the code is still the one it flies', async () => {
    await issueCode(deps, req());
    const registry = new PrismaRegistry(fake.db);
    await registry.setStatus('EVVBC', 'retired');
    assert.equal(fake.property.rows.get('prop-1')?.status, 'retired');
  });
});
