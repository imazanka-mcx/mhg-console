import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The shell contract is copied verbatim into both consumers rather than
 * published (src/shell/contract.ts explains why). This keeps the copies honest
 * wherever the sibling repos sit next to this one — on the Mac they do, under
 * ~/Desktop/mcx_ecosystem/mhg_ecosystem/. Where they do not (CI, Vercel), the
 * check is skipped rather than failed, because absence is not drift.
 */

const canonical = readFileSync(resolve('src/shell/contract.ts'), 'utf8');

for (const repo of ['mhotels-inspire', 'mhg-inspiredrev']) {
  const copy = resolve('..', repo, 'src/lib/registry/contract.ts');
  test(`${repo} carries an identical copy of the shell contract`, { skip: !existsSync(copy) && `${repo} is not alongside this repo` }, () => {
    assert.equal(
      readFileSync(copy, 'utf8'),
      canonical,
      `${repo}/src/lib/registry/contract.ts has drifted — copy src/shell/contract.ts over it.`,
    );
  });
}
