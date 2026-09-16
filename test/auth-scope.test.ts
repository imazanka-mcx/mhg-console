import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  covers,
  firewallViolations,
  isLive,
  isWiderThan,
  permittedAt,
  ScopeViolation,
} from '../src/auth/scope.ts';
import { PERMISSIONS, ROLES, permissionsFor, roleByKey } from '../src/auth/catalog.ts';

describe('the direct-bill firewall (docs/29 §3, docs/01 §2.3)', () => {
  const arView = { key: 'ar.view', scopeMax: 'property' } as const;
  const issue = { key: 'property.issue', scopeMax: 'portfolio' } as const;

  test('a property-capped permission is legal at property scope', () => {
    assert.equal(permittedAt(arView, 'property'), true);
  });

  test('…and illegal above it, group included', () => {
    assert.equal(permittedAt(arView, 'group'), false);
    assert.equal(permittedAt(arView, 'portfolio'), false);
  });

  test('a one-property group is still above property — cardinality is not the test', () => {
    // The bypass this closes: make a group of exactly one hotel, grant a
    // capped permission on it, and claim it is "really" property scope.
    assert.equal(permittedAt(arView, 'group'), false);
  });

  test('an uncapped permission is legal everywhere', () => {
    for (const scope of ['property', 'group', 'portfolio'] as const) {
      assert.equal(permittedAt(issue, scope), true);
    }
  });

  test('violations name exactly the offending permissions', () => {
    const v = firewallViolations([issue, arView], 'portfolio');
    assert.deepEqual(v.map((p) => p.key), ['ar.view']);
  });

  test('a legal grant reports no violations', () => {
    assert.deepEqual(firewallViolations([issue, arView], 'property'), []);
  });

  test('ScopeViolation says what was refused and why', () => {
    const err = new ScopeViolation('portfolio', [arView]);
    assert.match(err.message, /ar\.view \(max property\)/);
    assert.equal(err.scope, 'portfolio');
  });
});

describe('the seeded catalog obeys its own rule', () => {
  test('no role is assignable at a scope its permissions forbid', () => {
    for (const role of ROLES) {
      const perms = permissionsFor(role.key);
      for (const scope of role.assignableAt) {
        assert.deepEqual(
          firewallViolations(perms, scope).map((p) => p.key),
          [],
          `role ${role.key} cannot be assignable at ${scope}`,
        );
      }
    }
  });

  test('every permission a role names actually exists', () => {
    const known = new Set(PERMISSIONS.map((p) => p.key));
    for (const role of ROLES) {
      for (const key of role.permissions) {
        assert.ok(known.has(key), `role ${role.key} names unknown permission ${key}`);
      }
    }
  });

  test('owner is portfolio-only — there is no owner of one hotel', () => {
    assert.deepEqual(roleByKey('owner')?.assignableAt, ['portfolio']);
  });

  test('the A/R permissions exist and are capped at property', () => {
    for (const key of ['ar.view', 'ar.manage', 'folio.post']) {
      const p = PERMISSIONS.find((x) => x.key === key);
      assert.ok(p, `${key} missing from the catalog`);
      assert.equal(p!.scopeMax, 'property', `${key} must be capped at property`);
    }
  });

  test('no role carries an A/R permission yet — Inspire enforces those (§4 step 5)', () => {
    const capped = new Set(
      PERMISSIONS.filter((p) => p.ownedBy !== 'console').map((p) => p.key),
    );
    for (const role of ROLES) {
      for (const key of role.permissions) {
        assert.ok(!capped.has(key), `role ${role.key} should not yet carry ${key}`);
      }
    }
  });
});

describe('scope coverage', () => {
  const portfolio = { scope: 'portfolio', scopeRef: null } as const;
  const evvbc = { scope: 'property', scopeRef: 'EVVBC' } as const;
  const owbbc = { scope: 'property', scopeRef: 'OWBBC' } as const;
  const midwest = { scope: 'group', scopeRef: 'grp_midwest' } as const;

  test('a portfolio grant covers everything', () => {
    assert.equal(covers(portfolio, evvbc), true);
    assert.equal(covers(portfolio, midwest), true);
  });

  test('a property grant covers only that property', () => {
    assert.equal(covers(evvbc, evvbc), true);
    assert.equal(covers(evvbc, owbbc), false);
  });

  test('a property grant does not cover a group', () => {
    assert.equal(covers(evvbc, midwest), false);
  });

  test('portfolio is wider than group is wider than property', () => {
    assert.equal(isWiderThan('portfolio', 'group'), true);
    assert.equal(isWiderThan('group', 'property'), true);
    assert.equal(isWiderThan('property', 'portfolio'), false);
  });
});

describe('a group grant reaches its members (§2.2)', () => {
  const midwest = { scope: 'group', scopeRef: 'grp_midwest' } as const;
  const brandHx = { scope: 'group', scopeRef: 'grp_hampton' } as const;
  const evvbc = { scope: 'property', scopeRef: 'EVVBC' } as const;

  /** EVVBC is in Midwest and in the Hampton brand group; OWBBC is in neither. */
  const evvbcGroups = new Set(['grp_midwest', 'grp_hampton']);
  const noGroups = new Set<string>();

  test('a group grant covers a property inside the group', () => {
    assert.equal(covers(midwest, evvbc, evvbcGroups), true);
  });

  test('…and not one outside it', () => {
    assert.equal(covers(midwest, evvbc, noGroups), false);
  });

  test('a property in several groups is reached by a grant on any of them', () => {
    assert.equal(covers(brandHx, evvbc, evvbcGroups), true);
    // The single-parent hierarchy is what made the regional problem hard; this
    // is the assertion that says there isn't one.
  });

  test('membership is the only thing that changed — the grant is identical', () => {
    // Redrawing Midwest is an edit to PropertyGroupMember. The grant row below
    // is byte-for-byte the same before and after.
    assert.equal(covers(midwest, evvbc, new Set(['grp_midwest'])), true);
    assert.equal(covers(midwest, evvbc, new Set(['grp_southeast'])), false);
  });

  test('a group grant still covers the group itself', () => {
    assert.equal(covers(midwest, midwest), true);
    assert.equal(covers(midwest, brandHx), false);
  });

  test('a group grant with no ref covers nothing', () => {
    assert.equal(covers({ scope: 'group', scopeRef: null }, evvbc, evvbcGroups), false);
  });

  test('a property grant does not reach the groups that property is in', () => {
    // Holding one member of a set is not holding the set — otherwise a single
    // property grant would widen itself the moment somebody drew a region
    // around that hotel.
    assert.equal(covers(evvbc, midwest, evvbcGroups), false);
  });

  test('a portfolio grant needs no membership to cover anything', () => {
    assert.equal(covers({ scope: 'portfolio', scopeRef: null }, evvbc, noGroups), true);
  });

  test('group expansion cannot smuggle a capped permission down to a property', () => {
    // The firewall is evaluated at the GRANT's scope, not the target's. A group
    // grant is refused at issue time if it carries ar.view, so there is never a
    // live grant for this expansion to widen.
    const arView = { key: 'ar.view', scopeMax: 'property' } as const;
    assert.deepEqual(
      firewallViolations([arView], 'group').map((p) => p.key),
      ['ar.view'],
    );
  });
});

describe('grants are temporal (§2.5)', () => {
  const day = (s: string) => new Date(s);

  test('a closed grant is not live after its end', () => {
    const g = { effectiveFrom: day('2026-01-01'), effectiveTo: day('2026-06-01') };
    assert.equal(isLive(g, day('2026-03-01')), true);
    assert.equal(isLive(g, day('2026-09-01')), false);
  });

  test('an open grant stays live', () => {
    const g = { effectiveFrom: day('2026-01-01'), effectiveTo: null };
    assert.equal(isLive(g, day('2030-01-01')), true);
  });

  test('a future grant is not live yet', () => {
    const g = { effectiveFrom: day('2027-01-01'), effectiveTo: null };
    assert.equal(isLive(g, day('2026-09-15')), false);
  });

  test('"who had access on 3 March" is answerable from the row alone', () => {
    const g = { effectiveFrom: day('2026-02-01'), effectiveTo: day('2026-04-01') };
    assert.equal(isLive(g, day('2026-03-03')), true);
  });
});
