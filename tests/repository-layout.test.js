// Repository guard (openspec/specs/repository-layout/spec.md): nothing outside
// migrations/ imports or reads a file under it, so migrations/ can be deleted when
// the migrations retire. Same scan as payloadSchemas/tests/boundary.test.js:
// relative import specifiers and new URL('…', import.meta.url) reads, with comment
// lines skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrations = join(root, 'migrations');

const PATTERNS = [
  /\bfrom\s*(['"])([^'"]+)\1/g,
  /\bimport\s*(['"])([^'"]+)\1/g,
  /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
  /\bnew\s+URL\s*\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g,
];

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      return e.name === 'node_modules' || e.name.startsWith('.') || p === migrations ? [] : jsFiles(p);
    }
    return e.name.endsWith('.js') ? [p] : [];
  });
}

function specifiers(source) {
  const code = source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');
  return PATTERNS.flatMap((re) => [...code.matchAll(re)].map((m) => m[2]));
}

test('nothing outside migrations/ imports or reads from it', () => {
  const violations = [];
  for (const file of jsFiles(root)) {
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.')) continue;
      const target = resolve(dirname(file), spec);
      if (target === migrations || target.startsWith(migrations + sep)) {
        violations.push(`${relative(root, file)}: ${spec}`);
      }
    }
  }
  assert.deepEqual(violations, [], `imports into migrations/:\n  ${violations.join('\n  ')}`);
});
