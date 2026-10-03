import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SHELL_CONTRACT,
  batchProblem,
  coalesce,
  isNewer,
  shellProblem,
  signBody,
  verifyBody,
  type Shell,
} from '../src/shell/contract.ts';

/**
 * The shell contract (docs/01 §1.3–1.4). This file is the canonical copy of a
 * module both consumers carry verbatim, so these tests are the contract's
 * tests for all three repos — the consumers run a smaller smoke test against
 * their copy to prove it still matches.
 */

const shell = (over: Partial<Shell> = {}): Shell => ({
  contract: SHELL_CONTRACT,
  propertyId: '1966142b-2cef-45c6-af3b-c843aead0981',
  innCode: 'ALQBC',
  propCode: 'ALQBC',
  predecessorCode: '',
  name: 'BYX Collection Alquitranes Riverfront',
  brandCode: 'BC',
  brandName: 'BYX Collection',
  chainCode: 'MAZ',
  marketCode: 'ALQ',
  marketSource: 'letters',
  city: 'Alquitranes',
  state: 'NC',
  submarket: 'Downtown',
  franchisorCode: '',
  timezone: 'America/New_York',
  currency: 'USD',
  groups: [],
  status: 'pipeline',
  effectiveDate: '2026-09-16',
  expectedOpenDate: '',
  shellVersion: 1,
  ...over,
});

describe('signing', () => {
  const secret = 'test-secret-not-real';
  const body = JSON.stringify({ hello: 'world' });
  const now = new Date('2026-10-03T12:00:00Z');

  test('a signature verifies against the same body and secret', () => {
    assert.deepEqual(verifyBody(secret, body, signBody(secret, body, now), now), { ok: true });
  });

  test('a changed body is refused', () => {
    const sig = signBody(secret, body, now);
    assert.equal(verifyBody(secret, body + ' ', sig, now).ok, false);
  });

  test('the wrong secret is refused', () => {
    assert.equal(verifyBody('other', body, signBody(secret, body, now), now).ok, false);
  });

  test('an old signature is refused as a replay, even though the MAC is right', () => {
    const sig = signBody(secret, body, now);
    const later = new Date(now.getTime() + 301_000);
    const r = verifyBody(secret, body, sig, later);
    assert.equal(r.ok, false);
  });

  test('a forged timestamp breaks the MAC — the time is inside what is signed', () => {
    const sig = signBody(secret, body, now);
    const forged = sig.replace(/^t=\d+/, `t=${Math.floor(now.getTime() / 1000) + 10}`);
    assert.equal(verifyBody(secret, body, forged, now).ok, false);
  });

  test('missing, malformed and unconfigured all refuse', () => {
    assert.equal(verifyBody(secret, body, null, now).ok, false);
    assert.equal(verifyBody(secret, body, 't=abc,v1=zz', now).ok, false);
    assert.equal(verifyBody('', body, signBody('', body, now), now).ok, false);
  });
});

describe('shape', () => {
  test('a complete shell passes', () => {
    assert.equal(shellProblem(shell()), null);
  });

  test('an unknown contract number is refused, so a half-rolled change fails loudly', () => {
    assert.match(shellProblem(shell({ contract: 2 })) ?? '', /contract/);
  });

  test('missing identity, bad status and a zero version are refused', () => {
    assert.ok(shellProblem(shell({ propertyId: '' })));
    assert.ok(shellProblem({ ...shell(), status: 'open' }));
    assert.ok(shellProblem(shell({ shellVersion: 0 })));
    assert.ok(shellProblem({ ...shell(), groups: [1] }));
  });

  test('a batch must be ascending and inside its own window', () => {
    const ok = { contract: SHELL_CONTRACT, after: 4, through: 9, events: [{ seq: 5, shell: shell() }, { seq: 9, shell: shell({ propertyId: 'x', innCode: 'ALQLX' }) }] };
    assert.equal(batchProblem(ok), null);
    assert.match(batchProblem({ ...ok, events: [...ok.events].reverse() }) ?? '', /ascending/);
    assert.match(batchProblem({ ...ok, after: 5 }) ?? '', /ascending/);
    assert.match(batchProblem({ ...ok, through: 8 }) ?? '', /past/);
    assert.match(batchProblem({ ...ok, events: [{ seq: 6, shell: { ...shell(), status: 'x' } }] }) ?? '', /event 6/);
  });
});

describe('idempotency', () => {
  test('newer wins; equal and older are no-ops; nothing held means apply', () => {
    assert.equal(isNewer(3, 2), true);
    assert.equal(isNewer(2, 2), false);
    assert.equal(isNewer(1, 2), false);
    assert.equal(isNewer(1, null), true);
    assert.equal(isNewer(1, undefined), true);
  });
});

describe('coalesce', () => {
  test('one entry per property at its last seq, ascending, with the window top as through', () => {
    const r = coalesce([
      { seq: 10, propertyId: 'a' },
      { seq: 11, propertyId: 'b' },
      { seq: 12, propertyId: 'a' },
      { seq: 13, propertyId: 'a' },
    ]);
    assert.equal(r.through, 13);
    assert.deepEqual(r.latest, [
      { seq: 11, propertyId: 'b' },
      { seq: 13, propertyId: 'a' },
    ]);
  });

  test('an empty window covers nothing', () => {
    assert.deepEqual(coalesce([]), { through: 0, latest: [] });
  });
});
