/**
 * Validation against the schemas the API publishes (lib/published-schemas.js)
 * and the envelope around them (plugins/envelope.js). Response schemas have no
 * runtime effect (responses are not serialized through them), so these checks
 * are what keep the published contract true. Shared by the unit and
 * integration suites.
 */
import assert from 'node:assert/strict';

import { createAjv } from '../../payloadSchemas/lib/ajv.js';
import { publishedComponents } from '../src/lib/published-schemas.js';
import { singleEnvelope, listEnvelope, INDEX_ENVELOPE } from '../src/plugins/envelope.js';

const ajv = createAjv();
for (const schema of publishedComponents()) ajv.addSchema(schema);

const check = (validate, value, label) =>
  assert.equal(validate(value), true, `${label}: ${JSON.stringify(validate.errors)}`);

/** Each record in `data` (one or an array) is valid against the published component `name`. */
export function assertPublished(name, data) {
  const validate = ajv.getSchema(name);
  assert.ok(validate, `no published schema '${name}'`);
  for (const item of Array.isArray(data) ? data : [data]) check(validate, item, `${name} ${item?.permid}`);
}

const envelopes = new Map();
function envelope(kind, name) {
  const key = `${kind}:${name}`;
  if (!envelopes.has(key)) {
    const schema = kind === 'index' ? INDEX_ENVELOPE : (kind === 'list' ? listEnvelope : singleEnvelope)({ $ref: `${name}#` });
    envelopes.set(key, ajv.compile(schema));
  }
  return envelopes.get(key);
}

/** A whole response body is valid: `kind` is `single`, `list` or `index`; `name` the record's component. */
export function assertEnvelope(kind, name, body) {
  check(envelope(kind, name), body, `${kind} ${name ?? ''}`);
}
