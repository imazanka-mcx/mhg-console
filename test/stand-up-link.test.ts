import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { INSPIRE_STAND_UP_PATH, standUpUrl } from '../src/shell/stand-up.ts';

test('the stand-up link is built from the origin Inspire is subscribed at', () => {
  assert.equal(
    standUpUrl('https://inspire.example.com/api/registry/v1/shell', 'cm1abc'),
    'https://inspire.example.com/admin/stand-up/new?registry=cm1abc',
  );
  assert.equal(
    standUpUrl('http://localhost:3000/api/registry/v1/shell', 'a b'),
    'http://localhost:3000/admin/stand-up/new?registry=a%20b',
  );
});

test('an unparseable subscription URL gives no link rather than a broken one', () => {
  assert.equal(standUpUrl('not a url', 'cm1abc'), null);
  assert.equal(standUpUrl('', 'cm1abc'), null);
});

/**
 * The link points into another repo. Where the sibling checkout sits next to
 * this one (the Mac), make sure the page is really there; elsewhere (CI,
 * Vercel) skip, because absence is not drift — same rule as contract-copies.
 */
test('Inspire has the page the link points at', (t) => {
  const inspire = resolve(import.meta.dirname, '..', '..', 'mhotels-inspire');
  if (!existsSync(inspire)) return t.skip('mhotels-inspire is not checked out beside this repo');
  const page = resolve(inspire, 'src', 'app', '(app)', ...INSPIRE_STAND_UP_PATH.split('/').filter(Boolean), 'page.tsx');
  assert.ok(existsSync(page), `expected ${page}`);
});
