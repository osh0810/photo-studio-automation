/** A reservation is executable only after a server-side user approval is atomically claimed. */
export async function processApprovedJob({ api, run }) {
  const { job } = await api('POST', { action: 'claim_job' });
  if (!job) return false;
  let status = 'uncertain';
  let error;
  try {
    const result = await run(job.booking_id);
    if (!['sent', 'already_sent'].includes(result.status)) throw new Error('발송 완료를 확인하지 못했습니다.');
    status = result.status;
  } catch (failure) {
    if (failure?.code === 'LOGIN_REQUIRED') {
      await api('POST', { action: 'defer_login', booking_id: job.booking_id, claim_id: job.claim_id });
      return { loginRequired: true };
    }
    // Do not disclose browser output or credentials. Never requeue an ambiguous send.
    error = 'PC 실행 중 중단되었습니다. 예약 및 톡톡 대화창을 확인해주세요.';
  }
  await api('POST', { action: 'complete_job', booking_id: job.booking_id, claim_id: job.claim_id, status, error });
  return true;
}
