import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { writeFile, readFile } from 'node:fs/promises';
import { processApprovedJob } from './lib/approval-worker.mjs';
import { createLoginBridge } from './lib/login-bridge.mjs';
import { checkNaverSession } from './lib/naver-session.mjs';

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
let loginRequested = false;
let loginInProgress = false;
let loginStatus = 'unknown';
let nextLoginCheck = 0;
const abort = new AbortController();
const bridge = createLoginBridge({ onRequest: () => { loginRequested = true; }, isBusy: () => loginRequested || loginInProgress });
await new Promise((resolve, reject) => { bridge.once('error', reject); bridge.listen(18766, '127.0.0.1', resolve); });
let awake;
if (process.platform === 'win32') {
  const script = await readFile(new URL('./keep-awake.ps1', import.meta.url), 'utf8');
  // Authored local code, no machine execution-policy or power-plan changes.
  awake = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `& { ${script} } -RunnerProcessId ${process.pid}`], { windowsHide: true, stdio: 'ignore' });
  awake.on('error', () => console.error('절전 방지 요청을 시작하지 못했습니다.'));
}
function stop() { stopping = true; abort.abort(); bridge.close(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.log('비서에서 승인한 예약을 기다립니다. 최초 고객은 네이버 로그인 브라우저로 처리합니다.');
while (!stopping) {
  try {
    if (loginRequested || Date.now() >= nextLoginCheck) {
      loginInProgress = loginRequested;
      loginRequested = false;
      try {
        loginStatus = await checkNaverSession(config.slice(9), { interactive: loginInProgress, signal: abort.signal });
      } finally { loginInProgress = false; }
      nextLoginCheck = Date.now() + 5 * 60 * 1000;
      await api('POST', { action: 'runner_status', status: loginStatus });
    }
    if (loginStatus !== 'ready') {
      await writeFile('runner-state.json', JSON.stringify({ connected: true, loginStatus, lastPoll: new Date().toISOString() }));
      if (!stopping) await new Promise(resolve => setTimeout(resolve, 15000));
      continue; // Keep approvals queued until this dedicated profile is authenticated.
    }
    const processed = await processApprovedJob({ api, run: async (bookingId, messageKind) => {
      try {
        const { stdout } = await execute(process.execPath,
          [fileURLToPath(new URL('./confirm-booking.mjs', import.meta.url)), bookingId, '--send', '--message-kind=' + messageKind, config],
          { windowsHide: true, maxBuffer: 1024 * 1024 });
        return JSON.parse(stdout);
      } catch (error) {
        if (error.code === 3) throw Object.assign(new Error('네이버 재로그인 필요'), { code: 'LOGIN_REQUIRED' });
        throw error;
      }
    } });
    if (processed?.loginRequired) {
      loginStatus = 'login_required';
      nextLoginCheck = Date.now() + 5 * 60 * 1000;
      await api('POST', { action: 'runner_status', status: loginStatus });
    }
    await writeFile('runner-state.json', JSON.stringify({ connected: true, loginStatus, lastPoll: new Date().toISOString(), processed }));
    if (!connected) console.log('운영 비서 연결 확인 완료. 승인된 예약을 대기합니다.');
    connected = true;
  } catch {
    connected = false;
    await writeFile('runner-state.json', JSON.stringify({ connected: false, lastPoll: new Date().toISOString() })).catch(() => {});
    console.error('비서 연결 또는 처리 상태 저장 실패. 연결을 확인해주세요. 진행 중 예약은 자동 재발송하지 않습니다.');
  }
  if (!stopping) await new Promise(resolve => setTimeout(resolve, 15000));
}
bridge.close();
awake?.kill();
