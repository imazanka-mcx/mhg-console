import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * The CLIs must stay loadable by plain Node.
 *
 * `next/headers` and friends resolve only inside the Next bundler, so anything
 * a script reaches — however indirectly — must not import them. This bit once:
 * sunrise imported access.ts, which imported session.ts, which imported
 * next/headers, and the whole command failed to load.
 *
 * A static walk of the relative import graph catches it without running
 * anything, which matters because these scripts write to a real registry and
 * are not something a test should execute.
 */

const ENTRYPOINTS = ['scripts/sunrise.ts', 'scripts/issue.ts', 'prisma/seed.ts'];

/** Bare specifiers a plain-Node entrypoint may not reach, at any depth. */
const BUNDLER_ONLY = [/^next\//, /^next$/, /^react-dom\//, /^server-only$/];

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  // Covers `import … from 'x'`, `export … from 'x'` and bare `import 'x'`.
  const re = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const spec = m[1] ?? m[2];
    if (spec) out.push(spec);
  }
  return out;
}

function walk(entry: string): { file: string; via: string[] }[] {
  const seen = new Set<string>();
  const offences: { file: string; via: string[] }[] = [];

  function visit(file: string, trail: string[]): void {
    if (seen.has(file)) return;
    seen.add(file);
    if (!existsSync(file)) return;

    for (const spec of importsOf(file)) {
      if (BUNDLER_ONLY.some((re) => re.test(spec))) {
        offences.push({ file: spec, via: [...trail, file] });
        continue;
      }
      if (!spec.startsWith('.')) continue; // other packages are fine
      visit(resolve(dirname(file), spec), [...trail, file]);
    }
  }

  visit(entry, []);
  return offences;
}

describe('CLI entrypoints stay loadable outside Next', () => {
  for (const entry of ENTRYPOINTS) {
    test(`${entry} reaches nothing bundler-only`, () => {
      const offences = walk(entry);
      assert.deepEqual(
        offences,
        [],
        offences
          .map((o) => `${o.file} via ${o.via.join(' → ')}`)
          .join('\n') || undefined,
      );
    });
  }

  test('the walker actually detects a violation when there is one', () => {
    // Guards the guard: a scanner that silently matches nothing would pass
    // every case above while proving nothing at all.
    const offences = walk('src/auth/actor.ts');
    assert.ok(
      offences.length > 0,
      'actor.ts imports session.ts which imports next/headers — the walker should see it',
    );
  });
});
