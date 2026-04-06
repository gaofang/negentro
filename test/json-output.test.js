import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createJsonErrorPayload,
  createJsonSuccessPayload,
} from '../src/shared/json-output.js';

test('createJsonSuccessPayload keeps data and logs together', () => {
  const payload = createJsonSuccessPayload({
    command: 'run',
    data: { phase: 'needs_human', openQuestions: 2 },
    logs: ['line one'],
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'run');
  assert.deepEqual(payload.data, { phase: 'needs_human', openQuestions: 2 });
  assert.deepEqual(payload.logs, ['line one']);
});

test('createJsonErrorPayload normalizes thrown errors', () => {
  const payload = createJsonErrorPayload({
    command: 'build',
    error: new Error('build failed'),
    logs: ['before failure'],
  });

  assert.equal(payload.ok, false);
  assert.equal(payload.command, 'build');
  assert.equal(payload.error.message, 'build failed');
  assert.deepEqual(payload.logs, ['before failure']);
});
