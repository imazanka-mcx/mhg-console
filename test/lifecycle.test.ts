import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { checkTransition, nextStatuses } from '../src/lifecycle.ts';
import { checkSetup } from '../src/setup.ts';

describe('lifecycle', () => {
  test('the three forward edges are allowed, and named', () => {
    assert.deepEqual(checkTransition('pipeline', 'active'), { ok: true, transition: 'open' });
    assert.deepEqual(checkTransition('pipeline', 'retired'), { ok: true, transition: 'abandon' });
    assert.deepEqual(checkTransition('active', 'retired'), { ok: true, transition: 'exit' });
  });

  test('backwards is refused', () => {
    assert.equal(checkTransition('active', 'pipeline').ok, false);
  });

  test('retired is terminal — a retired code is never reissued (G3)', () => {
    for (const to of ['pipeline', 'active'] as const) {
      const r = checkTransition('retired', to);
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.reason, /G3/);
    }
    assert.deepEqual(nextStatuses('retired'), []);
  });

  test('a no-op is refused rather than logged as a move', () => {
    assert.equal(checkTransition('active', 'active').ok, false);
  });

  test('nextStatuses lists exactly the allowed moves', () => {
    assert.deepEqual(nextStatuses('pipeline').map((m) => m.to).sort(), ['active', 'retired']);
    assert.deepEqual(nextStatuses('active').map((m) => m.to), ['retired']);
  });
});

describe('setup', () => {
  test('normalizes what it accepts', () => {
    assert.deepEqual(checkSetup({ timezone: ' America/Chicago ', currency: 'usd', expectedOpenDate: '2027-04-01' }), {
      ok: true,
      value: { timezone: 'America/Chicago', currency: 'USD', expectedOpenDate: '2027-04-01' },
    });
  });

  test('blank opening means not yet known', () => {
    assert.deepEqual(checkSetup({ expectedOpenDate: '' }), { ok: true, value: { expectedOpenDate: '' } });
  });

  test('refuses a fake zone, a bad currency and an impossible date', () => {
    const r = checkSetup({ timezone: 'America/Evansville_East', currency: 'US', expectedOpenDate: '2027-02-31' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(Object.keys(r.errors).sort(), ['currency', 'expectedOpenDate', 'timezone']);
  });

  test('absent fields stay absent, so a partial edit cannot blank the others', () => {
    assert.deepEqual(checkSetup({ currency: 'CAD' }), { ok: true, value: { currency: 'CAD' } });
  });
});
