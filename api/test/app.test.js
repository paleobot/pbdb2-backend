import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../src/app.js';

test('app builds and becomes ready without binding a port', async () => {
  const app = build();
  await app.ready();

  // Cross-cutting decorators are present, proving plugins loaded.
  assert.equal(app.hasDecorator('authenticate'), true);
  assert.equal(app.hasReplyDecorator('sendData'), true);
  assert.equal(app.hasReplyDecorator('sendList'), true);

  await app.close();
});
