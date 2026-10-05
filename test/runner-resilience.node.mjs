import test from 'node:test';
import assert from 'node:assert/strict';
import { processApprovedJob } from '../scripts/lib/approval-worker.mjs';
import { createLoginBridge } from '../scripts/lib/login-bridge.mjs';
test('login expiry before any send defers approval instead of marking it failed', async () => {
  const calls = [];
  const result = await processApprovedJob({ api: async (_, data) => {
    calls.push(data);
    return data.action === 'claim_job' ? { job: { booking_id: '1234567890', claim_id: 'one' } } : {};
  }, run: async () => { throw Object.assign(new Error('login'), { code: 'LOGIN_REQUIRED' }); } });
  assert.equal(result.loginRequired, true);
  assert.equal(calls.at(-1).action, 'defer_login');
  assert.equal(calls.filter(c => c.action === 'complete_job').length, 0);
});
test('local login page requires an explicit same-origin click; remote requests cannot launch it', async () => {
  let requests = 0;
  const server = createLoginBridge({ onRequest: () => requests++ });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(origin);
    const html = await page.text();
    assert.equal(requests, 0);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const nonce = html.match(/const localToken="([a-f0-9-]+)"/)[1];
    assert.equal((await fetch(origin + '/login', { method: 'POST', headers: { origin: 'https://evil.example', 'x-login-token': nonce } })).status, 403);
    assert.equal((await fetch(origin + '/login', { method: 'POST', headers: { origin } })).status, 403);
    assert.equal(requests, 0);
    assert.equal((await fetch(origin + '/login', { method: 'POST', headers: { origin, 'x-login-token': nonce } })).status, 202);
    assert.equal(requests, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
