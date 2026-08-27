import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPublicHealthPayload } from '../src/app';

test('public health payload exposes readiness without infrastructure metadata', () => {
  const payload = buildPublicHealthPayload();
  const serialized = JSON.stringify(payload);

  assert.deepEqual(Object.keys(payload).sort(), ['service', 'status', 'timestamp', 'uptime']);
  assert.doesNotMatch(serialized, /smtp|supabase|storage|mail|host|port|from|issue|driver|fallback/i);
});
