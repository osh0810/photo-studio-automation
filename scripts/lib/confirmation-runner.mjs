/** Dependency-injected orchestration, shared by the CLI and fixture tests. */
export async function runConfirmation({ bookingId, api, browser, dryRun = true, messageKind = 'both' }) {
  if (!/^\d{10}$/.test(bookingId)) throw new Error('네이버 예약번호 10자리가 필요합니다.');
  const plan = await api('GET', { booking_id: bookingId, message_kind: messageKind });
  if (plan.status === 'already_sent') return { ...plan, skipped: true };
  if (plan.status !== 'ready') throw new Error(`예약 발송 상태: ${plan.status}. 중복 발송하지 않습니다.`);
  if (plan.route === 'api') {
    if (dryRun) return plan;
    return api('POST', { action: 'start', booking_id: bookingId, message_kind: messageKind });
  }
  const customer = await browser.openReservation(bookingId);
  if (customer.bookingId !== bookingId) throw new Error('화면의 예약번호가 일치하지 않습니다.');
  if (!/^[가-힣A-Za-z][가-힣A-Za-z ]{1,15}$/.test(customer.fullName)) throw new Error('예약자 전체 이름을 읽지 못했습니다.');
  // The conversation must originate from this exact reservation's Talk button.
  await browser.openConversation();
  await browser.verifyConversation(bookingId);
  if (messageKind !== 'additional' && await browser.hasConfirmation(bookingId)) {
    return { ...plan, customer_name: customer.fullName, status: 'already_sent', skipped: true };
  }
  if (dryRun) return { ...plan, customer_name: customer.fullName, dry_run: true };
  const attempt = await api('POST', { action: 'start', booking_id: bookingId, message_kind: messageKind, full_name: customer.fullName });
  // Echo may have linked the booking between GET and POST. In that case POST sent via API.
  if (attempt.route === 'api') return attempt;
  try {
    await browser.sendMessage(attempt.message);
    if (attempt.additional_message) await browser.sendMessage(attempt.additional_message);
    await api('POST', { action: 'complete', booking_id: bookingId, attempt_id: attempt.attempt_id, status: 'sent' });
    return { ...attempt, status: 'sent', talk_id_pending_echo: true };
  } catch (error) {
    await api('POST', { action: 'complete', booking_id: bookingId, attempt_id: attempt.attempt_id, status: 'uncertain' }).catch(() => {});
    throw error;
  }
}
