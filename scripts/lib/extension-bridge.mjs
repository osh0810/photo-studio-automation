import { createServer } from 'node:http';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

/** A loopback transport. Admin credentials never leave the Node runner. */
export function createExtensionBridge({ onControl = async () => {}, onPaired = async () => {}, onRequest = () => {}, initialState = {}, now = Date.now }) {
  const code = String(randomInt(100000, 1000000));
  const token = /^[a-f0-9]{64}$/.test(initialState.token || '') ? initialState.token : randomBytes(32).toString('hex');
  const nonce = randomBytes(24).toString('hex');
  const born = now();
  let origin = /^chrome-extension:\/\/[a-p]{32}$/.test(initialState.origin || '') ? initialState.origin : undefined;
  let guesses = 0, enabled = !!origin && initialState.enabled === true, heartbeat = 0, pending;
  const same = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const server = createServer(async (req, res) => {
    onRequest({method:req.method,path:req.url,origin:req.headers.origin,declaredOrigin:req.headers['x-extension-origin']});
    const local = `http://127.0.0.1:${server.address().port}`;
    const reply = (status, value) => { res.writeHead(status, {'content-type':'application/json', 'cache-control':'no-store'}); res.end(JSON.stringify(value)); };
    if (req.headers.host !== new URL(local).host) return reply(403, {});
    const extensionOrigin = req.headers.origin;
    const extension = /^chrome-extension:\/\/[a-p]{32}$/.test(extensionOrigin || '');
    if (extension && (!origin || origin === extensionOrigin)) {
      res.setHeader('access-control-allow-origin', extensionOrigin);
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-headers', 'authorization,content-type,x-extension-origin');
      res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    }
    if (req.method === 'OPTIONS') return reply(extension ? 204 : 403, {});
    if (req.method === 'GET' && req.url === '/') {
      res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
      res.writeHead(200, {'content-type':'text/html;charset=utf-8','cache-control':'no-store'});
      res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>마음껏 예약 실행기 연결</title><style>body{font-family:system-ui;max-width:640px;margin:60px auto;line-height:1.8}button{padding:12px}code{font-size:24px}</style><h2>일반 Edge 예약 실행기</h2><p>Edge 확장 프로그램에서 연결 코드를 입력해주세요. 코드는 실행기 시작 후 10분간 유효합니다.</p><code>${origin ? '연결됨' : code}</code><p>자동 처리: ${enabled ? '켜짐' : '중지'}</p><p>네이버 재로그인은 평소 사용하는 Edge의 예약관리 화면에서 진행해주세요. 보안 확인은 직접 완료해야 합니다.</p><a href="https://partner.booking.naver.com/bizes/745146/booking-list-view" target="_blank" rel="noreferrer">네이버 예약관리 열기</a><p><button id="check">김윤영님 연결만 시험</button></p><p id="result"></p><script>document.getElementById('check').onclick=async()=>{document.getElementById('check').disabled=true;const r=await fetch('/diagnose',{method:'POST',headers:{'x-local-nonce':'${nonce}'}});document.getElementById('result').textContent=r.ok?'확장 프로그램에서 예약·톡톡 연결을 확인합니다. 메시지는 보내지 않습니다.':'확장 프로그램 연결 및 실행기 상태를 확인해주세요.';}</script></html>`);
      return;
    }
    let body = {};
    if (req.method === 'POST') {
      let text = '';
      for await (const chunk of req) { text += chunk; if (text.length > 12000) return reply(413, {}); }
      try { body = text ? JSON.parse(text) : {}; } catch { return reply(400, {}); }
    }
    if (req.url === '/diagnose' && req.method === 'POST') {
      if (req.headers.origin !== local || !same(req.headers['x-local-nonce'], nonce)) return reply(403, {});
      if (!origin || now() - heartbeat > 45000) return reply(409, {});
      reply(202, {}); onControl('diagnose').catch(() => {}); return;
    }
    // Extension GET requests can omit Origin; the paired token still authenticates them.
    const authenticatedOrigin = extensionOrigin || req.headers['x-extension-origin'];
    if (!extension && !(origin && extensionOrigin === undefined && authenticatedOrigin === origin)) return reply(403, {});
    if (req.url === '/pair' && req.method === 'POST') {
      if (origin || now() - born > 600000 || ++guesses > 5 || !same(body.code, code)) return reply(403, {});
      origin = extensionOrigin; heartbeat = now();
      try {await onPaired({origin,token,enabled:false});} catch {origin=undefined;return reply(500,{});}
      return reply(200, {token});
    }
    if (origin !== authenticatedOrigin || !same(req.headers.authorization, token)) return reply(401, {});
    heartbeat = now();
    if (req.url === '/control' && req.method === 'POST') {
      if (typeof body.enabled !== 'boolean') return reply(400, {});
      enabled = body.enabled;
      await onPaired({origin,token,enabled});
      reply(200, {enabled}); onControl(enabled ? 'resume' : 'pause').catch(() => {}); return;
    }
    if (req.url === '/command' && req.method === 'GET') {
      if (!pending || pending.issued) return reply(200, {command:null,enabled});
      pending.issued = true;
      return reply(200, {command:{id:pending.id,operation:pending.operation,args:pending.args},enabled});
    }
    if (req.url === '/result' && req.method === 'POST') {
      if (!pending || !pending.issued || body.id !== pending.id) return reply(409, {});
      const current = pending; pending = null; clearTimeout(current.timer);
      if (body.error) current.reject(Object.assign(new Error('Edge 처리 확인 필요'), {code:body.error === 'LOGIN_REQUIRED' ? 'LOGIN_REQUIRED' : 'BROWSER_ERROR',detail:/^[A-Z_]{1,64}$/.test(body.detail||'')?body.detail:undefined,operation:current.operation,route:typeof body.route==='string'?body.route.slice(0,250):undefined}));
      else current.resolve(body.result);
      return reply(200, {});
    }
    return reply(404, {});
  });
  return {
    server,
    connected: () => !!origin && now() - heartbeat < 45000,
    enabled: () => enabled,
    pause: async () => { enabled = false; await onPaired({origin,token,enabled}); },
    command(operation, args = {}, timeoutMs = 90000) {
      if (pending) return Promise.reject(new Error('이미 진행 중인 Edge 명령이 있습니다.'));
      return new Promise((resolve, reject) => {
        const id = randomUUID();
        const timer = setTimeout(() => { if (pending?.id === id) pending = null; reject(new Error('Edge 응답이 없어 재발송하지 않습니다.')); }, timeoutMs);
        pending = {id,operation,args,resolve,reject,timer,issued:false};
      });
    },
    close() { if (pending) {clearTimeout(pending.timer); pending.reject(new Error('stopped'));pending=null;} server.close(); },
  };
}
