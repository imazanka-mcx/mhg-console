import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  RULE_FIELDS,
  RuleError,
  describeRule,
  matches,
  parseRule,
  selectMatching,
  type GroupRule,
  type PropertySubject,
} from '../src/groups/rules.ts';
import { slugForGroupName } from '../src/groups/ids.ts';

/**
 * Rule-backed membership (docs/01 §2.2).
 *
 * These run without a database on purpose: a rule is a statement about a
 * property, and if deciding it needs a fixture then the rule engine has quietly
 * become part of the data layer.
 */

function property(over: Partial<PropertySubject> = {}): PropertySubject {
  return {
    brandCode: 'BC',
    chainCode: 'HI',
    state: 'IN',
    city: 'Evansville',
    status: 'active',
    ...over,
  };
}

describe('rule matching', () => {
  test('values within a field are OR', () => {
    const rule: GroupRule = { brandCode: ['HX', 'HP'] };
    assert.equal(matches(rule, property({ brandCode: 'HX' })), true);
    assert.equal(matches(rule, property({ brandCode: 'HP' })), true);
    assert.equal(matches(rule, property({ brandCode: 'BC' })), false);
  });

  test('fields are AND', () => {
    const rule: GroupRule = { brandCode: ['HX'], state: ['IN'] };
    assert.equal(matches(rule, property({ brandCode: 'HX', state: 'IN' })), true);
    assert.equal(matches(rule, property({ brandCode: 'HX', state: 'KY' })), false);
  });

  test('comparison ignores case and surrounding space', () => {
    assert.equal(matches({ state: [' in '] }, property({ state: 'IN' })), true);
    assert.equal(matches({ city: ['EVANSVILLE'] }, property({ city: 'Evansville' })), true);
  });

  test('a rule that does not mention status excludes retired codes', () => {
    // A region that quietly accumulates dead hotels stops being a list of
    // places anyone operates.
    const rule: GroupRule = { state: ['IN'] };
    assert.equal(matches(rule, property({ status: 'retired' })), false);
    assert.equal(matches(rule, property({ status: 'pipeline' })), true);
  });

  test('…and one that does mention it means it', () => {
    const rule: GroupRule = { state: ['IN'], status: ['retired'] };
    assert.equal(matches(rule, property({ status: 'retired' })), true);
    assert.equal(matches(rule, property({ status: 'active' })), false);
  });

  test('selectMatching keeps input order', () => {
    const all = [
      property({ brandCode: 'HX', city: 'A' }),
      property({ brandCode: 'BC', city: 'B' }),
      property({ brandCode: 'HX', city: 'C' }),
    ];
    assert.deepEqual(
      selectMatching({ brandCode: ['HX'] }, all).map((p) => p.city),
      ['A', 'C'],
    );
  });
});

describe('rule parsing refuses what it cannot mean', () => {
  test('an empty rule is refused — that is portfolio scope wearing a group name', () => {
    assert.throws(() => parseRule({}), RuleError);
    assert.throws(() => parseRule({ state: [] }), RuleError);
  });

  test('an unknown field is refused rather than ignored', () => {
    assert.throws(() => parseRule({ region: ['Midwest'] }), RuleError);
  });

  test('non-text values are refused', () => {
    assert.throws(() => parseRule({ state: ['IN', 7] }), RuleError);
  });

  test('a non-object is refused', () => {
    assert.throws(() => parseRule('brandCode=HX'), RuleError);
    assert.throws(() => parseRule([['state', 'IN']]), RuleError);
  });

  test('values are trimmed and de-duplicated', () => {
    assert.deepEqual(parseRule({ state: [' IN ', 'IN', 'KY'] }), { state: ['IN', 'KY'] });
  });

  test('every declared field parses', () => {
    for (const field of RULE_FIELDS) {
      assert.deepEqual(parseRule({ [field]: ['x'] }), { [field]: ['x'] });
    }
  });

  test('a parsed rule round-trips through JSON unchanged', () => {
    const rule = parseRule({ brandCode: ['HX', 'HP'], state: ['IN'] });
    assert.deepEqual(parseRule(JSON.parse(JSON.stringify(rule))), rule);
  });
});

describe('rule descriptions say what the rule does', () => {
  test('the implicit retired exclusion is stated, not hidden', () => {
    assert.match(describeRule({ state: ['IN'] }), /excluding retired/);
    assert.doesNotMatch(describeRule({ state: ['IN'], status: ['active'] }), /excluding retired/);
  });

  test('ors and ands read as such', () => {
    assert.equal(
      describeRule({ brandCode: ['HX', 'HP'], state: ['IN'], status: ['active'] }),
      'brand HX or HP, and state IN, and status active',
    );
  });
});

describe('group ids are minted once', () => {
  test('a name becomes a slug under grp_', () => {
    assert.equal(slugForGroupName('Midwest'), 'grp_midwest');
    assert.equal(slugForGroupName('  Ohio Valley / South  '), 'grp_ohio_valley_south');
  });

  test('a rename would produce a different id — which is why it is never recomputed', () => {
    // Guards the reasoning, not the function: if these were ever equal, nothing
    // would stop a rename from silently orphaning every grant on the group.
    assert.notEqual(slugForGroupName('Midwest'), slugForGroupName('Great Lakes'));
  });

  test('a name with nothing sluggable in it is refused', () => {
    assert.throws(() => slugForGroupName('———'), /at least one letter or digit/);
  });

  test('the slug is bounded and never ends in a separator', () => {
    const id = slugForGroupName('x'.repeat(60) + ' tail');
    assert.ok(id.length <= 44, id);
    assert.doesNotMatch(id, /_$/);
  });
});
