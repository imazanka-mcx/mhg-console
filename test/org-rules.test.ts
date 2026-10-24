import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  blocks,
  checkAsset,
  checkAssignmentStart,
  checkOrganization,
  checkPrincipal,
  checkTerm,
  managementFindings,
  openFindings,
  slugForOrgName,
  type OrgFacts,
} from '../src/orgs/rules.ts';

const owner = (over: Partial<OrgFacts> = {}): OrgFacts => ({
  id: 'org_riverside',
  kind: 'ownership',
  name: 'Riverside Capital',
  registeredState: 'IN',
  registrationNumber: '',
  archived: false,
  principals: [{ name: 'Dana Reyes', email: 'dana@riverside.example' }],
  ...over,
});

const manager = (over: Partial<OrgFacts> = {}): OrgFacts => ({
  id: 'org_tristate',
  kind: 'management',
  name: 'Tri-State Hospitality',
  registeredState: 'IN',
  registrationNumber: '2026-0001234',
  archived: false,
  principals: [{ name: 'Sam Ortiz', email: 'sam@tristate.example' }],
  ...over,
});

const codes = (fs: { code: string }[]) => fs.map((f) => f.code).sort();

describe('the management rule', () => {
  test('a registered third party with no shared principals passes clean', () => {
    assert.deepEqual(managementFindings(owner(), manager()), []);
  });

  test('a principal of the owner may not operate the hotel — matched on email, any case', () => {
    const f = managementFindings(
      owner(),
      manager({ principals: [{ name: 'D. Reyes', email: ' DANA@Riverside.example ' }] }),
    );
    assert.deepEqual(codes(blocks(f)), ['shared_principal']);
  });

  test('the same name under different emails warns rather than blocks', () => {
    const f = managementFindings(
      owner(),
      manager({ principals: [{ name: 'Dana Reyes', email: 'dreyes@tristate.example' }] }),
    );
    assert.deepEqual(blocks(f), []);
    assert.deepEqual(codes(f), ['similar_principal']);
  });

  test('an unregistered manager is not a registered third party', () => {
    assert.deepEqual(codes(managementFindings(owner(), manager({ registrationNumber: '' }))), ['manager_unregistered']);
  });

  test('an ownership group cannot be assigned as manager, and cannot manage itself', () => {
    const o = owner();
    const f = managementFindings(o, { ...o });
    assert.ok(codes(f).includes('manager_kind'));
    assert.ok(codes(f).includes('self_managed'));
  });

  test('an archived manager fails wherever it is still assigned', () => {
    assert.deepEqual(codes(managementFindings(owner(), manager({ archived: true }))), ['manager_archived']);
  });
});

describe('opening a hotel', () => {
  const base = { streetAddress: '100 Riverside Dr', keyCount: 120 };

  test('needs an owner and a manager', () => {
    const f = openFindings({ ...base, owner: null, manager: null });
    assert.deepEqual(codes(blocks(f)), ['no_manager', 'no_owner']);
  });

  test('carries the management rule through', () => {
    const f = openFindings({ ...base, owner: owner(), manager: manager({ registrationNumber: '' }) });
    assert.deepEqual(codes(blocks(f)), ['manager_unregistered']);
  });

  test('missing address and keys warn but do not block', () => {
    const f = openFindings({ owner: owner(), manager: manager(), streetAddress: '', keyCount: null });
    assert.deepEqual(blocks(f), []);
    assert.deepEqual(codes(f), ['no_address', 'no_keys']);
  });
});

describe('organizations', () => {
  test('ids are minted from the name', () => {
    assert.equal(slugForOrgName('Riverside Capital, LLC'), 'org_riverside_capital_llc');
    assert.throws(() => slugForOrgName('—'));
  });

  test('a management company must carry its registration', () => {
    const r = checkOrganization({ kind: 'management', name: 'Tri-State' });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.errors.registeredState);
      assert.ok(r.errors.registrationNumber);
    }
  });

  test('an ownership group does not, and fields are normalized', () => {
    const r = checkOrganization({ kind: 'ownership', name: ' Riverside ', registeredState: 'in', contactEmail: 'A@B.CO' });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.name, 'Riverside');
      assert.equal(r.value.registeredState, 'IN');
      assert.equal(r.value.contactEmail, 'a@b.co');
    }
  });

  test('a principal needs an email, because the rule compares on it', () => {
    assert.equal(checkPrincipal({ name: 'Dana' }).ok, false);
    assert.deepEqual(checkPrincipal({ name: 'Dana', email: 'Dana@X.io' }), {
      ok: true,
      value: { name: 'Dana', email: 'dana@x.io', title: '' },
    });
  });
});

describe('assignments', () => {
  test('a new assignment cannot start before the live one did', () => {
    assert.equal(checkAssignmentStart('2026-10-01', '2026-01-01'), null);
    assert.equal(checkAssignmentStart('2026-01-01', '2026-01-01'), null);
    assert.match(checkAssignmentStart('2025-12-31', '2026-01-01') ?? '', /cannot start before/);
    assert.match(checkAssignmentStart('soon', null) ?? '', /YYYY-MM-DD/);
  });

  test('a term ends after it begins', () => {
    assert.equal(checkTerm('Licence', '2026-01-01', '2036-01-01'), null);
    assert.ok(checkTerm('Licence', '2026-01-01', '2026-01-01'));
    assert.equal(checkTerm('Licence', '', '2026-01-01'), null);
  });
});

describe('the asset', () => {
  test('normalizes what it accepts and leaves absent fields absent', () => {
    assert.deepEqual(checkAsset({ keyCount: '120', serviceLevel: 'select_service' }), {
      ok: true,
      value: { keyCount: 120, serviceLevel: 'select_service' },
    });
    assert.deepEqual(checkAsset({ keyCount: '' }), { ok: true, value: { keyCount: null } });
  });

  test('refuses impossible values', () => {
    const r = checkAsset({ keyCount: '0', yearOpened: '2010', yearRenovated: '2005', pipStatus: 'soon' }, 2026);
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(Object.keys(r.errors).sort(), ['keyCount', 'pipStatus', 'yearRenovated']);
  });

  test('a QA result needs its date', () => {
    assert.equal(checkAsset({ qaLastResult: 'pass', qaLastDate: '' }).ok, false);
    assert.equal(checkAsset({ qaLastResult: 'pass', qaLastDate: '2026-09-30' }).ok, true);
  });
});
