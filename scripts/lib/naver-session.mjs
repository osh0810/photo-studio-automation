import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function checkNaverSession(configPath, { interactive = false, signal } = {}) {
  const config = JSON.parse((await readFile(configPath, 'utf8')).replace(/^\uFEFF/, ''));
  if (!/^\d+$/.test(config.bizId)) throw new Error('사업장 설정 확인 필요');
  const { chromium } = await import('playwright');
  let context;
  const cancel = () => { context?.close().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    context = await chromium.launchPersistentContext(resolve(config.profileDir), {
      headless: !interactive, channel: config.channel || 'msedge',
    });
    if (signal?.aborted) throw new Error('stopped');
    const page = await context.newPage();
    await page.goto(`https://partner.booking.naver.com/bizes/${config.bizId}/booking-list-view`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!interactive && new URL(page.url()).hostname === 'nid.naver.com') return 'login_required';
    try {
      await page.getByText('예약현황', { exact: true }).first().waitFor({ state: 'visible', timeout: interactive ? 0 : 15000 });
      if (config.talkHomeUrl) {
        const talkUrl = new URL(config.talkHomeUrl);
        if (talkUrl.protocol !== 'https:' || talkUrl.hostname !== 'partner.talk.naver.com' || !talkUrl.pathname.startsWith('/chat/ct/')) throw new Error('톡톡 홈 설정 확인 필요');
        await page.goto(talkUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (!interactive && new URL(page.url()).hostname === 'nid.naver.com') return 'login_required';
        await page.locator(config.messageInputSelector || '#partner_chat_write').first().waitFor({ state: 'visible', timeout: interactive ? 0 : 15000 });
      }
      return 'ready';
    } catch (error) {
      if (new URL(page.url()).hostname === 'nid.naver.com') return 'login_required';
      throw error; // Network/selector failures do not pretend the login expired.
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    await context?.close();
  }
}
