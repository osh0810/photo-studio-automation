import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

/** Loopback-only, user-clicked login launcher. GET never opens a browser. */
export function createLoginBridge({ onRequest, isBusy = () => false }) {
  const nonce = randomUUID();
  const server = createServer((request, response) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    if (request.headers.host !== new URL(origin).host) { response.writeHead(403); response.end(); return; }
    if (request.method === 'GET' && request.url === '/') {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>예약 실행기 네이버 로그인</title>
        <style>body{font-family:system-ui;max-width:540px;margin:60px auto;padding:24px;line-height:1.7}button{padding:14px 22px;background:#03c75a;color:white;border:0;border-radius:8px;font-size:16px}</style>
        <h2>예약 실행기 네이버 로그인</h2><p>버튼을 누르면 이 PC의 전용 Edge 창이 열립니다. 그 창에서 네이버에 로그인해주세요. 완료하면 승인된 대기 예약을 이어서 처리합니다.</p>
        <button id="login">전용 Edge에서 로그인</button><p id="result">${isBusy() ? '이미 로그인 창을 여는 중입니다.' : ''}</p>
        <script>const localToken=${JSON.stringify(nonce)};document.getElementById('login').onclick=async()=>{const b=document.getElementById('login');b.disabled=true;try{const r=await fetch('/login',{method:'POST',headers:{'x-login-token':localToken}});if(!r.ok)throw new Error();document.getElementById('result').textContent='전용 Edge 창을 확인해주세요. 진행 중인 예약이 있으면 처리 후 창이 열립니다.';}catch{document.getElementById('result').textContent='실행기 연결을 확인하고 다시 눌러주세요.';b.disabled=false;}};</script></html>`);
      return;
    }
    if (request.method === 'POST' && request.url === '/login') {
      if (request.headers.origin !== origin || request.headers['x-login-token'] !== nonce) {
        response.writeHead(403); response.end(); return;
      }
      if (!isBusy()) onRequest();
      response.writeHead(202); response.end('login requested'); return;
    }
    response.writeHead(404); response.end();
  });
  return server;
}
