import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runConfirmation } from './lib/confirmation-runner.mjs';

const [bookingId, ...args] = process.argv.slice(2);
const send = args.includes('--send');
const configPath = args.find(arg => arg.startsWith('--config='))?.slice(9);
const token = process.env.ADMIN_TOKEN;
const base = process.env.STUDIO_API_BASE;
if (!token || !base) throw new Error('ADMIN_TOKEN과 STUDIO_API_BASE가 필요합니다.');
const endpoint = new URL('/admin/booking-confirmation', base);
if (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(endpoint.hostname)) throw new Error('HTTPS API 주소가 필요합니다.');
async function api(method, data) {
  const url = new URL(endpoint);
  if (method === 'GET') url.search = new URLSearchParams(data).toString();
  const response = await fetch(url, { method, redirect: 'error',
    headers: { authorization: token, 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `API ${response.status}`);
  return result;
}
let context;
let reservationPage;
let conversationPage;
let config;
const browser = {
  async openReservation(id) {
    if (!configPath) throw new Error('최초 연결은 --config=설정.json이 필요합니다.');
    config = JSON.parse((await readFile(configPath, 'utf8')).replace(/^\uFEFF/, ''));
    for (const key of ['bizId', 'profileDir', 'bookingIdSelector', 'fullNameSelector', 'talkButtonSelector', 'messageInputSelector', 'sendButtonSelector', 'sentMessageSelector', 'bookingLinkSelector']) {
      if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error(`브라우저 설정 누락: ${key}`);
    }
    if (!/^\d+$/.test(config.bizId)) throw new Error('숫자 bizId가 필요합니다.');
    if (!['popup', 'same-page'].includes(config.conversationMode)) throw new Error('conversationMode: popup 또는 same-page가 필요합니다.');
    const { chromium } = await import('playwright');
    context = await chromium.launchPersistentContext(resolve(config.profileDir), { headless: false, channel: config.channel || 'msedge' });
    context.setDefaultTimeout(30000);
    reservationPage = await context.newPage();
    await reservationPage.goto(`https://partner.booking.naver.com/bizes/${config.bizId}/booking-list-view/bookings/${id}`);
    // Login can be completed manually in the dedicated browser profile.
    try {
      await reservationPage.locator(config.bookingIdSelector).waitFor({ state: 'visible', timeout: 15000 });
    } catch (error) {
      if (new URL(reservationPage.url()).hostname === 'nid.naver.com') {
        throw Object.assign(new Error('네이버 재로그인이 필요합니다.'), { code: 'LOGIN_REQUIRED' });
      }
      throw error;
    }
    const displayedId = (await reservationPage.locator(config.bookingIdSelector).innerText()).trim();
    const fullName = (await reservationPage.locator(config.fullNameSelector).innerText()).trim();
    return { bookingId: displayedId, fullName };
  },
  async openConversation() {
    if (config.conversationMode === 'popup') {
      const popup = reservationPage.waitForEvent('popup');
      await reservationPage.locator(config.talkButtonSelector).click();
      conversationPage = await popup;
    } else {
      await reservationPage.locator(config.talkButtonSelector).click();
      conversationPage = reservationPage;
    }
    if (config.dismissDialogSelector) {
      const close = conversationPage.locator(config.dismissDialogSelector).filter({ visible: true });
      await close.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      if (await close.count() === 1) await close.click();
    }
    try {
      await conversationPage.locator(config.messageInputSelector).waitFor({ state: 'visible' });
    } catch (error) {
      if (new URL(conversationPage.url()).hostname === 'nid.naver.com') {
        throw Object.assign(new Error('네이버 톡톡 재로그인이 필요합니다.'), { code: 'LOGIN_REQUIRED' });
      }
      throw error;
    }
  },
  async verifyConversation(bookingId) {
    const links = await conversationPage.locator(config.bookingLinkSelector).evaluateAll(elements => elements.map(el => el.href));
    const expected = `/bizes/${config.bizId}/booking-list-view/bookings/${bookingId}`;
    if (!links.some(link => {
      const url = new URL(link);
      return ['partner.booking.naver.com', 'm-partner.booking.naver.com'].includes(url.hostname) && url.pathname === expected;
    })) throw new Error('톡톡 대화에서 해당 예약번호의 상세 내역 링크를 확인하지 못했습니다. 발송을 중단합니다.');
  },
  async hasConfirmation(bookingId) {
    const texts = await conversationPage.locator(config.sentMessageSelector).allInnerTexts();
    return texts.some(text => /님\s+아래\s+내용으로\s+예약\s+완료되셨습니다/.test(text)
      && new RegExp(`예약번호\\s*[:：]\\s*${bookingId}(?!\\d)`).test(text));
  },
  async sendMessage(message) {
    if (message.length > 2000) throw new Error('톡톡 입력란 최대 길이 2000자를 초과했습니다.');
    const messages = conversationPage.locator(config.sentMessageSelector).filter({ hasText: message });
    const before = await messages.count();
    await conversationPage.locator(config.messageInputSelector).fill(message);
    await conversationPage.locator(config.sendButtonSelector).click();
    await messages.nth(before).waitFor({ state: 'visible' });
  },
};
try {
  const result = await runConfirmation({ bookingId, api, browser, dryRun: !send });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (error?.code === 'LOGIN_REQUIRED') {
    console.log(JSON.stringify({ error_code: 'LOGIN_REQUIRED' })); process.exitCode = 3;
  } else { throw error; }
} finally { await context?.close(); }
