// DDL layout guard (openspec/specs/ddl-layout/spec.md): the DDL is exactly
// 01-dictionaries.sql, 02-core.sql and 03-taxa.sql, and no file refers to a table,
// function, schema or extension defined in a later file. Reads the files only; no
// database. `--` comments are skipped, but string literals and function bodies are
// searched, because a name in dynamic SQL is still a dependency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ddlDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = ['01-dictionaries.sql', '02-core.sql', '03-taxa.sql'];

const DEFINITIONS = [
  /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w.]+)/gi,
  /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)/gi,
  /\bCREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi,
  /\bCREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi,
];

const ddlFiles = () => readdirSync(ddlDir).filter((f) => /^\d\d-.*\.sql$/.test(f)).sort();

// Line by line, so a hit can be reported by line number.
const codeLines = (file) =>
  readFileSync(join(ddlDir, file), 'utf8').split('\n').map((line) => line.replace(/--.*$/, ''));

function definedNames(lines) {
  const code = lines.join('\n');
  return new Set(DEFINITIONS.flatMap((re) => [...code.matchAll(re)].map((m) => m[1])));
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the DDL is exactly the three files of ddl-layout', () => {
  assert.deepEqual(ddlFiles(), EXPECTED);
});

test('no DDL file refers to an object defined in a later file', () => {
  const files = ddlFiles().map((name) => ({ name, lines: codeLines(name) }));
  for (const f of files) f.defines = definedNames(f.lines);

  const violations = [];
  files.forEach((earlier, i) => {
    for (const later of files.slice(i + 1)) {
      for (const name of later.defines) {
        // Case-sensitive: the DDL writes identifiers in lower case, and seed text
        // such as 'United States' must not match the table `states`.
        const re = new RegExp(`(?<![\\w.])${escape(name)}(?![\\w])`);
        earlier.lines.forEach((line, n) => {
          if (re.test(line)) violations.push(`${earlier.name}:${n + 1}: ${name} (defined in ${later.name})`);
        });
      }
    }
  });
  assert.deepEqual(violations, [], `references to later files:\n  ${violations.join('\n  ')}`);
});
