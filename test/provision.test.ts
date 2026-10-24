import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { PERMISSIONS, ROLES } from '../src/auth/catalog.ts';
import { CONSUMERS, FROM_CONSUMER, allowedRoles, consoleRoleFor } from '../src/auth/consumer-roles.ts';
import { holdsConsoleRole } from '../src/people/translate.ts';
import { mapImported } from '../src/people/import-map.ts';

const ownedBy = new Map(PERMISSIONS.map((p) => [p.key, p.ownedBy]));

describe('roles accepted from a consumer (docs/01 §2.9)', () => {
  test('every mapping lands on a console role that links back to that same consumer role', () => {
    for (const consumer of CONSUMERS) {
      for (const [role, m] of Object.entries(FROM_CONSUMER[consumer])) {
        const target = ROLES.find((r) => r.key === m.roleKey);
        assert.ok(target, `${consumer} ${role} → unknown console role ${m.roleKey}`);
        const link = target!.links[consumer];
        assert.ok(link && allowedRoles(link).includes(role), `${m.roleKey} does not become ${consumer} ${role}`);
        for (const scope of m.scopes) assert.ok(target!.assignableAt.includes(scope), `${m.roleKey} is not assignable at ${scope}`);
      }
    }
  });

  test('nothing provisioned from below can reach the console', () => {
    for (const consumer of CONSUMERS) {
      for (const m of Object.values(FROM_CONSUMER[consumer])) {
        const role = ROLES.find((r) => r.key === m.roleKey)!;
        const grant = { permissions: role.permissions.map((k) => ({ ownedBy: ownedBy.get(k) ?? '' })) };
        assert.equal(holdsConsoleRole([grant]), false, `${m.roleKey} would give console access`);
      }
    }
  });

  test('every Inspire property role has a console equivalent', () => {
    for (const r of ['admin', 'gm', 'sales', 'revenue_manager', 'front_desk', 'housekeeping', 'auditor', 'readonly']) {
      assert.ok(consoleRoleFor('inspire', r, 'property'), r);
    }
  });

  test('corporate seats are never accepted from below', () => {
    assert.equal(consoleRoleFor('inspire', 'corporate_admin', 'portfolio'), null);
    assert.equal(consoleRoleFor('inspiredrev', 'admin', 'portfolio'), null);
  });

  test('Inspire roles only arrive at one hotel', () => {
    assert.equal(consoleRoleFor('inspire', 'gm', 'portfolio'), null);
    assert.equal(consoleRoleFor('inspire', 'gm', 'property'), 'gm');
  });
});

describe('importing local accounts', () => {
  const codeFor = (id: string) => ({ 'prop-1': 'ALQBC' })[id];

  test('Inspire property roles map to their console roles at the hotel’s code', () => {
    const r = mapImported('inspire', [{ scope: 'property', ref: 'prop-1', role: 'front_desk' }], codeFor);
    assert.deepEqual(r.grants, [{ roleKey: 'front_desk', scope: 'property', scopeRef: 'ALQBC' }]);
    assert.deepEqual(r.skipped, []);
  });

  test('a hotel outside the registry is skipped, not guessed', () => {
    const r = mapImported('inspire', [{ scope: 'property', ref: 'elsewhere', role: 'gm' }], codeFor);
    assert.equal(r.grants.length, 0);
    assert.match(r.skipped[0] ?? '', /not in the registry/);
  });

  test('InspiredREV chain-wide revenue managers come in as portfolio revenue managers', () => {
    const r = mapImported('inspiredrev', [{ scope: 'portfolio', ref: '', role: 'revenue_manager' }], codeFor);
    assert.deepEqual(r.grants, [{ roleKey: 'revenue_manager', scope: 'portfolio', scopeRef: null }]);
  });

  test('an InspiredREV admin is skipped — corporate seats are made in the console', () => {
    const r = mapImported('inspiredrev', [{ scope: 'portfolio', ref: '', role: 'admin' }], codeFor);
    assert.equal(r.grants.length, 0);
    assert.equal(r.skipped.length, 1);
  });
});
