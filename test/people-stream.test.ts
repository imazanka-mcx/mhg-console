import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { holdsConsoleRole, translateGrants } from '../src/people/translate.ts';
import {
  PEOPLE_CONTRACT,
  coalescePeople,
  isBcryptHash,
  passwordChangeProblem,
  peopleBatchProblem,
  peopleUrlFor,
  personProblem,
  type Person,
} from '../src/shell/contract.ts';
import { PERMISSIONS, ROLES } from '../src/auth/catalog.ts';

const HASH = '$2a$12$' + 'a'.repeat(53);

describe('translating grants for each consumer (docs/01 §2.8)', () => {
  test('a GM grant with no recorded choice takes the crosswalk defaults', () => {
    const t = translateGrants([{ scope: 'property', ref: 'prop-1', roleKey: 'gm', downstream: [] }]);
    assert.deepEqual(t.inspire, [{ scope: 'property', ref: 'prop-1', role: 'gm' }]);
    assert.deepEqual(t.inspiredrev, [{ scope: 'property', ref: 'prop-1', role: 'revenue_manager' }]);
  });

  test('a recorded choice wins over the default', () => {
    const t = translateGrants([
      {
        scope: 'property',
        ref: 'prop-1',
        roleKey: 'gm',
        downstream: [
          { consumer: 'inspire', consumerRole: 'gm' },
          { consumer: 'inspiredrev', consumerRole: 'readonly' },
        ],
      },
    ]);
    assert.deepEqual(t.inspiredrev, [{ scope: 'property', ref: 'prop-1', role: 'readonly' }]);
  });

  test('a role with no link to a consumer sends nothing there', () => {
    const t = translateGrants([{ scope: 'property', ref: 'prop-1', roleKey: 'front_desk', downstream: [] }]);
    assert.equal(t.inspire.length, 1);
    assert.deepEqual(t.inspiredrev, []);
  });

  test('portfolio grants carry an empty ref; group grants carry the group id', () => {
    const t = translateGrants([
      { scope: 'portfolio', ref: null, roleKey: 'owner', downstream: [] },
      { scope: 'group', ref: 'grp_midwest', roleKey: 'revenue_manager', downstream: [] },
    ]);
    assert.ok(t.inspire.some((g) => g.scope === 'portfolio' && g.ref === '' && g.role === 'corporate_admin'));
    assert.ok(t.inspiredrev.some((g) => g.scope === 'group' && g.ref === 'grp_midwest' && g.role === 'revenue_manager'));
  });

  test('a property grant whose code resolved to nothing confers nothing', () => {
    const t = translateGrants([{ scope: 'property', ref: null, roleKey: 'gm', downstream: [] }]);
    assert.deepEqual(t, { inspire: [], inspiredrev: [] });
  });

  test('duplicates collapse', () => {
    const g = { scope: 'property' as const, ref: 'prop-1', roleKey: 'gm', downstream: [] };
    assert.equal(translateGrants([g, g]).inspire.length, 1);
  });

  test('a director of sales is sales in Inspire and sales in InspiredREV', () => {
    const t = translateGrants([{ scope: 'property', ref: 'prop-1', roleKey: 'director_of_sales', downstream: [] }]);
    assert.equal(t.inspire[0]?.role, 'sales');
    assert.equal(t.inspiredrev[0]?.role, 'sales');
  });
});

describe('who may use the console', () => {
  const ownedBy = new Map(PERMISSIONS.map((p) => [p.key, p.ownedBy]));
  const asGrant = (roleKey: string) => ({
    permissions: (ROLES.find((r) => r.key === roleKey)?.permissions ?? []).map((k) => ({ ownedBy: ownedBy.get(k) ?? '' })),
  });

  test('corporate roles do', () => {
    for (const k of ['owner', 'registrar', 'viewer']) assert.equal(holdsConsoleRole([asGrant(k)]), true, k);
  });

  test('property-operations roles do not — not even an owner or a GM', () => {
    for (const k of ['property_owner', 'gm', 'property_admin', 'director_of_sales', 'front_desk', 'housekeeping', 'auditor', 'revenue_manager', 'sales']) {
      assert.equal(holdsConsoleRole([asGrant(k)]), false, k);
    }
  });

  test('a corporate seat alongside a property role still gets in', () => {
    assert.equal(holdsConsoleRole([asGrant('gm'), asGrant('viewer')]), true);
  });

  test('nobody with no grants', () => {
    assert.equal(holdsConsoleRole([]), false);
  });
});

describe('the people contract', () => {
  const person: Person = {
    contract: PEOPLE_CONTRACT,
    personId: 'p1',
    email: 'gm@example.com',
    name: 'A GM',
    status: 'active',
    passwordHash: HASH,
    personVersion: 3,
    grants: [{ scope: 'property', ref: 'prop-1', role: 'gm' }],
  };

  test('a well-formed person passes', () => {
    assert.equal(personProblem(person), null);
  });

  test('a person with no password yet is allowed — nobody can sign in as them', () => {
    assert.equal(personProblem({ ...person, passwordHash: '' }), null);
  });

  test('a password that is not a bcrypt hash is refused — plaintext never travels', () => {
    assert.match(personProblem({ ...person, passwordHash: 'hunter2hunter2' }) ?? '', /bcrypt/);
  });

  test('a portfolio grant must have no ref, and only it', () => {
    assert.ok(personProblem({ ...person, grants: [{ scope: 'portfolio', ref: 'x', role: 'admin' }] }));
    assert.ok(personProblem({ ...person, grants: [{ scope: 'property', ref: '', role: 'gm' }] }));
  });

  test('batches must ascend and stay within `through`', () => {
    const batch = { contract: PEOPLE_CONTRACT, subscriber: 'inspire', after: 0, through: 2, events: [{ seq: 2, person }, { seq: 1, person }], sentAt: '' };
    assert.match(peopleBatchProblem(batch) ?? '', /ascending/);
    assert.equal(peopleBatchProblem({ ...batch, events: [{ seq: 1, person }, { seq: 2, person }] }), null);
  });

  test('a password change carries a bcrypt hash', () => {
    const base = { contract: PEOPLE_CONTRACT, subscriber: 'inspire', personId: 'p1', passwordHash: HASH, sentAt: '' };
    assert.equal(passwordChangeProblem(base), null);
    assert.ok(passwordChangeProblem({ ...base, passwordHash: 'plain text password' }));
  });

  test('bcrypt detection', () => {
    assert.equal(isBcryptHash(HASH), true);
    assert.equal(isBcryptHash('$2b$10$short'), false);
  });

  test('a burst of notices for one person delivers once, at its last seq', () => {
    const c = coalescePeople([{ seq: 1, personId: 'a' }, { seq: 2, personId: 'b' }, { seq: 3, personId: 'a' }]);
    assert.equal(c.through, 3);
    assert.deepEqual(c.latest, [{ seq: 2, personId: 'b' }, { seq: 3, personId: 'a' }]);
  });

  test('the people receiver sits beside the shell receiver', () => {
    assert.equal(peopleUrlFor('https://inspire.example.com/api/registry/v1/shell'), 'https://inspire.example.com/api/registry/v1/people');
  });
});
