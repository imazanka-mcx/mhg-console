import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { PERMISSIONS, ROLES } from '../src/auth/catalog.ts';
import {
  CONSUMERS,
  CONSUMER_ROLES,
  DownstreamChoiceError,
  allowedRoles,
  consumerRole,
  resolveDownstream,
  validateLinks,
  type LinkableRole,
} from '../src/auth/consumer-roles.ts';

describe('the role crosswalk rules (docs/01 §2.7)', () => {
  const base: LinkableRole = { key: 'r', assignableAt: ['property'], permissions: [], links: {} };

  test('a link to a role the consumer does not have is an error', () => {
    const f = validateLinks([{ ...base, links: { inspire: { role: 'night_manager' } } }]);
    assert.equal(f.length, 1);
    assert.equal(f[0]!.level, 'error');
    assert.match(f[0]!.message, /no role "night_manager"/);
  });

  test('a property grant can never become corporate authority', () => {
    const f = validateLinks([
      { ...base, assignableAt: ['portfolio', 'property'], links: { inspire: { role: 'corporate_viewer' } } },
    ]);
    assert.equal(f.length, 1);
    assert.match(f[0]!.message, /held org-wide/);
  });

  test('…while a portfolio-only role may link to an org-tier role', () => {
    const f = validateLinks([
      { ...base, assignableAt: ['portfolio'], links: { inspire: { role: 'corporate_viewer' } } },
    ]);
    assert.deepEqual(f, []);
  });

  test('a console role must hold what its consumer role carries', () => {
    // Inspire's gm manages A/R. A console role without ar.manage linking to
    // it would hand out A/R authority the console's firewall never saw.
    const f = validateLinks([
      { ...base, permissions: ['ar.view', 'folio.post'], links: { inspire: { role: 'gm' } } },
    ]);
    assert.equal(f.length, 1);
    assert.equal(f[0]!.level, 'error');
    assert.match(f[0]!.message, /carries ar\.manage/);
  });

  test('a declared exception turns that error into a listed exception', () => {
    const f = validateLinks([
      { ...base, links: { inspire: { role: 'front_desk', exception: 'because' } } },
    ]);
    assert.equal(f.length, 1);
    assert.equal(f[0]!.level, 'exception');
    assert.match(f[0]!.message, /because/);
  });

  test('an exception that is no longer needed is an error, so none outlive their reason', () => {
    const f = validateLinks([
      { ...base, links: { inspire: { role: 'housekeeping', exception: 'stale' } } },
    ]);
    assert.equal(f.length, 1);
    assert.equal(f[0]!.level, 'error');
    assert.match(f[0]!.message, /no longer needed/);
  });

  test('no link means nothing to check — no access in that app', () => {
    assert.deepEqual(validateLinks([base]), []);
  });

  test('every allowed role is checked, not just the default', () => {
    // A choice must not be a way around the firewall: offering Inspire gm as
    // an alternative to readonly needs the same permissions as defaulting to it.
    const f = validateLinks([{ ...base, links: { inspire: { role: 'readonly', also: ['gm'] } } }]);
    assert.equal(f.length, 1);
    assert.match(f[0]!.message, /inspire gm carries/);
  });

  test('a link that lists a role twice is an error', () => {
    const f = validateLinks([{ ...base, links: { inspiredrev: { role: 'readonly', also: ['readonly'] } } }]);
    assert.ok(f.some((x) => /lists a role twice/.test(x.message)));
  });
});

describe('what a grant becomes downstream', () => {
  const gm = ROLES.find((r) => r.key === 'gm')!;
  const frontDesk = ROLES.find((r) => r.key === 'front_desk')!;

  test('no choice means the defaults', () => {
    assert.deepEqual(resolveDownstream(gm), { inspire: 'gm', inspiredrev: 'revenue_manager' });
  });

  test('an allowed choice is taken', () => {
    assert.deepEqual(resolveDownstream(gm, { inspiredrev: 'readonly' }), {
      inspire: 'gm',
      inspiredrev: 'readonly',
    });
  });

  test('a choice the link does not allow is refused', () => {
    assert.throws(() => resolveDownstream(gm, { inspiredrev: 'admin' }), DownstreamChoiceError);
    assert.throws(() => resolveDownstream(gm, { inspire: 'corporate_admin' }), DownstreamChoiceError);
  });

  test('a choice for an app the role does not reach is refused', () => {
    assert.throws(() => resolveDownstream(frontDesk, { inspiredrev: 'readonly' }), /no access in inspiredrev/);
  });

  test('an app the role does not reach is absent, not empty', () => {
    assert.deepEqual(resolveDownstream(frontDesk), { inspire: 'front_desk' });
  });
});

describe('the shipped crosswalk', () => {
  test('has no errors', () => {
    const errors = validateLinks(ROLES).filter((f) => f.level === 'error');
    assert.deepEqual(errors, []);
  });

  test('has exactly one exception: owner → Inspire corporate_admin (§2.6)', () => {
    const exceptions = validateLinks(ROLES).filter((f) => f.level === 'exception');
    assert.deepEqual(
      exceptions.map((f) => `${f.role}:${f.consumer}`),
      ['owner:inspire'],
    );
  });

  test('every console role reaches InspiredREV or Inspire — no role is console-only by accident', () => {
    for (const role of ROLES) {
      assert.ok(
        CONSUMERS.some((c) => role.links[c]),
        `${role.key} links to neither consumer`,
      );
    }
  });

  test('every role that can post or touch A/R in Inspire is property-only', () => {
    for (const role of ROLES) {
      const link = role.links.inspire;
      if (!link) continue;
      for (const key of allowedRoles(link)) {
        const target = consumerRole('inspire', key);
        if (!target || target.tier === 'org' || target.carries.length === 0) continue;
        assert.deepEqual(role.assignableAt, ['property'], `${role.key} → inspire ${target.key}`);
      }
    }
  });

  test('a GM is gm in Inspire, and revenue manager (or readonly) in InspiredREV', () => {
    const gm = ROLES.find((r) => r.key === 'gm')!;
    assert.deepEqual(allowedRoles(gm.links.inspire!), ['gm']);
    assert.deepEqual(allowedRoles(gm.links.inspiredrev!), ['revenue_manager', 'readonly']);
  });

  test('a property owner gets GM access in Inspire and never corporate authority', () => {
    const owner = ROLES.find((r) => r.key === 'property_owner')!;
    assert.deepEqual(allowedRoles(owner.links.inspire!), ['gm']);
    assert.deepEqual(allowedRoles(owner.links.inspiredrev!), ['readonly', 'revenue_manager']);
    assert.deepEqual(owner.assignableAt, ['property']);
    for (const key of allowedRoles(owner.links.inspire!)) {
      assert.notEqual(consumerRole('inspire', key)?.tier, 'org');
    }
  });

  test('only portfolio-only roles reach Inspire’s corporate roles', () => {
    for (const role of ROLES) {
      const link = role.links.inspire;
      if (!link) continue;
      if (allowedRoles(link).some((k) => consumerRole('inspire', k)?.tier === 'org')) {
        assert.deepEqual(role.assignableAt, ['portfolio'], role.key);
      }
    }
  });
});

describe('the consumer mirror', () => {
  test('keys are unique per consumer', () => {
    const seen = new Set<string>();
    for (const c of CONSUMER_ROLES) {
      const k = `${c.consumer}:${c.key}`;
      assert.ok(!seen.has(k), `duplicate ${k}`);
      seen.add(k);
    }
  });

  test('carries names only permissions in the catalog', () => {
    const known = new Set(PERMISSIONS.map((p) => p.key));
    for (const c of CONSUMER_ROLES) {
      for (const k of c.carries) assert.ok(known.has(k), `${c.consumer}:${c.key} carries unknown ${k}`);
    }
  });

  test('mirrors every role Inspire and InspiredREV define', () => {
    const keys = (consumer: string) =>
      CONSUMER_ROLES.filter((c) => c.consumer === consumer).map((c) => c.key).sort();
    assert.deepEqual(keys('inspire'), [
      'admin', 'auditor', 'corporate_admin', 'corporate_viewer', 'front_desk', 'gm',
      'housekeeping', 'readonly', 'revenue_manager', 'sales',
    ]);
    assert.deepEqual(keys('inspiredrev'), ['admin', 'auditor', 'readonly', 'revenue_manager', 'sales']);
  });

  test('Inspire sales ranks with gm and carries what gm carries', () => {
    const gm = consumerRole('inspire', 'gm');
    const sales = consumerRole('inspire', 'sales');
    assert.equal(sales?.rank, gm?.rank);
    assert.deepEqual(sales?.carries, gm?.carries);
  });

  test('Inspire auditor ranks with front_desk and posts, so the console auditor holds folio.post', () => {
    assert.equal(consumerRole('inspire', 'auditor')?.rank, consumerRole('inspire', 'front_desk')?.rank);
    assert.deepEqual(consumerRole('inspire', 'auditor')?.carries, ['ar.view', 'folio.post']);
    assert.deepEqual(validateLinks(ROLES).filter((f) => f.role === 'auditor'), []);
  });
});
