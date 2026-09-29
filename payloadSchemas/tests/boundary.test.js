// Boundary guard (openspec/specs/payload-schemas-boundary/spec.md): nothing under
// payloadSchemas/ imports or reads a file outside it. Relative import specifiers and
// new URL('…', import.meta.url) reads must resolve inside the directory; npm packages
// and node: built-ins pass. Comment lines are skipped, so provenance comments that
// name a migration script don't count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PATTERNS = [
  /\bfrom\s*(['"])([^'"]+)\1/g,
  /\bimport\s*(['"])([^'"]+)\1/g,
  /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
  /\bnew\s+URL\s*\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g,
];

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : jsFiles(p);
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

test('payloadSchemas/ imports and reads nothing outside itself', () => {
  const violations = [];
  for (const file of jsFiles(root)) {
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.')) continue;
      const target = resolve(dirname(file), spec);
      if (target !== root && !target.startsWith(root + sep)) {
        violations.push(`${relative(root, file)}: ${spec}`);
      }
    }
  }
  assert.deepEqual(violations, [], `imports outside payloadSchemas/:\n  ${violations.join('\n  ')}`);
});
