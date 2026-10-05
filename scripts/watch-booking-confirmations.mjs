import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { processApprovedJob } from './lib/approval-worker.mjs';

const config = process.argv.slice(2).find(arg => arg.startsWith('--config='));
if (!config) throw new Error('--config=브라우저설정.json이 필요합니다.');
const token = process.env.ADMIN_TOKEN;
const base = process.env.STUDIO_API_BASE;
if (!token || !base) throw new Error('ADMIN_TOKEN과 STUDIO_API_BASE가 필요합니다.');
const endpoint = new URL('/admin/booking-confirmation', base);
if (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(endpoint.hostname)) throw new Error('HTTPS API 주소가 필요합니다.');
async function api(method, data) {
  const response = await fetch(endpoint, { method, redirect: 'error',
    headers: { authorization: token, 'content-type': 'application/json' },
    body: JSON.stringify(data), signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `API ${response.status}`);
  return result;
}
const execute = promisify(execFile);
let connected = false;
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
console.log('비서에서 승인한 예약을 기다립니다. 최초 고객은 네이버 로그인 브라우저로 처리합니다.');
while (!stopping) {
  try {
    const processed = await processApprovedJob({ api, run: async bookingId => {
      const { stdout } = await execute(process.execPath,
        [fileURLToPath(new URL('./confirm-booking.mjs', import.meta.url)), bookingId, '--send', config],
        { windowsHide: true, maxBuffer: 1024 * 1024 });
      return JSON.parse(stdout);
    } });
    await writeFile('runner-state.json', JSON.stringify({ connected: true, lastPoll: new Date().toISOString(), processed }));
    if (!connected) console.log('운영 비서 연결 확인 완료. 승인된 예약을 대기합니다.');
    connected = true;
  } catch {
    connected = false;
    await writeFile('runner-state.json', JSON.stringify({ connected: false, lastPoll: new Date().toISOString() })).catch(() => {});
    console.error('비서 연결 또는 처리 상태 저장 실패. 연결을 확인해주세요. 진행 중 예약은 자동 재발송하지 않습니다.');
  }
  if (!stopping) await new Promise(resolve => setTimeout(resolve, 15000));
}
