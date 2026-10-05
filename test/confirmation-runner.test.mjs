import test from 'node:test';
import assert from 'node:assert/strict';
import { runConfirmation } from '../scripts/lib/confirmation-runner.mjs';
import { processApprovedJob } from '../scripts/lib/approval-worker.mjs';

function fixture(route = 'browser') {
  const calls = [];
  const api = async (method, body) => {
    calls.push({ method, body });
    if (method === 'GET') return { route, status: 'ready' };
    if (body.action === 'start') return { route, attempt_id: 'attempt', message: '홍길동님 예약번호 : 1234567890' };
    return { success: true };
  };
  const browser = {
    openReservation: async () => ({ bookingId: '1234567890', fullName: '홍길동' }),
    openConversation: async () => { calls.push('open-talk'); },
    verifyConversation: async () => {},
    hasConfirmation: async () => false,
    sendMessage: async message => { calls.push(message); },
  };
  return { bookingId: '1234567890', api, browser, calls, dryRun: false };
}
test('first contact opens reservation conversation and records browser send', async () => {
  const f = fixture(); const result = await runConfirmation(f);
  assert.equal(result.talk_id_pending_echo, true);
  assert.equal(f.calls[2].body.full_name, '홍길동');
  assert.equal(f.calls.at(-1).body.status, 'sent');
});
test('saved talkId skips the browser', async () => {
  const f = fixture('api');
  f.browser.openReservation = async () => { throw new Error('must not open'); };
  await runConfirmation(f);
  assert.equal(f.calls.length, 2);
});
test('dry run makes no start or completion mutation', async () => {
  const f = fixture(); f.dryRun = true;
  await runConfirmation(f);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
});
test('wrong reservation number blocks send', async () => {
  const f = fixture();
  f.browser.openReservation = async () => ({ bookingId: '9999999999', fullName: '홍길동' });
  await assert.rejects(runConfirmation(f), /예약번호/);
  assert.equal(f.calls.length, 1);
});
test('masked names block send', async () => {
  const f = fixture();
  f.browser.openReservation = async () => ({ bookingId: '1234567890', fullName: '홍*동' });
  await assert.rejects(runConfirmation(f), /전체 이름/);
});
test('browser failure is marked uncertain without a retry', async () => {
  const f = fixture(); f.browser.sendMessage = async () => { throw new Error('timeout'); };
  await assert.rejects(runConfirmation(f), /timeout/);
  assert.equal(f.calls.at(-1).body.status, 'uncertain');
});
test('already sent confirmation skips both claim and send', async () => {
  const f = fixture(); f.browser.hasConfirmation = async () => true;
  f.browser.sendMessage = async () => { throw new Error('must not send'); };
  assert.equal((await runConfirmation(f)).status, 'already_sent');
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
});
test('conversation without exact reservation link blocks all mutations', async () => {
  const f = fixture(); f.browser.verifyConversation = async () => { throw new Error('wrong conversation'); };
  await assert.rejects(runConfirmation(f), /wrong conversation/);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
});
test('browser sends additional question after confirmation and locks a second-message failure', async () => {
  const f = fixture();
  const original = f.api;
  f.api = async (method, data) => {
    const result = await original(method, data);
    return data.action === 'start' ? { ...result, additional_message: '아이 정보 질문' } : result;
  };
  await runConfirmation(f);
  assert.deepEqual(f.calls.filter(call => typeof call === 'string').slice(-2), ['홍길동님 예약번호 : 1234567890', '아이 정보 질문']);
  const failed = fixture(); const originalApi = failed.api;
  failed.api = async (method, data) => {
    const result = await originalApi(method, data);
    return data.action === 'start' ? { ...result, additional_message: '아이 정보 질문' } : result;
  };
  failed.browser.sendMessage = async message => { if (message === '아이 정보 질문') throw new Error('timeout'); };
  await assert.rejects(runConfirmation(failed), /timeout/);
  assert.equal(failed.calls.at(-1).body.status, 'uncertain');
});
test('PC worker only executes claimed approvals and never retries a failed run', async () => {
  let runs = 0; const completed = [];
  const empty = { api: async () => ({ job: null }), run: async () => { runs++; } };
  assert.equal(await processApprovedJob(empty), false);
  assert.equal(runs, 0);
  await processApprovedJob({ api: async (_, data) => {
    if (data.action === 'claim_job') return { job: { booking_id: '1234567890', claim_id: 'claim' } };
    completed.push(data); return {};
  }, run: async id => { assert.equal(id, '1234567890'); runs++; throw new Error('timeout'); } });
  assert.equal(runs, 1);
  assert.equal(completed[0].status, 'uncertain');
  assert.equal(completed[0].claim_id, 'claim');
});
