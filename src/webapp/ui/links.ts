/**
 * 프록시 링크 관리 페이지.
 */

export function renderLinksPage(userEmail: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>링크 관리 | 마음껏스튜디오</title>
  <style>
    :root {
      --bg: #f5f7fa; --fg: #333; --fg-muted: #888;
      --card-bg: #fff; --border: #e5e7eb;
      --accent: #3b82f6; --shadow: 0 1px 3px rgba(0,0,0,0.05);
      --green: #10b981; --red: #ef4444; --orange: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; background: var(--bg); color: var(--fg); min-height: 100vh; }
    .header { background: #fff; padding: 12px 16px; box-shadow: var(--shadow); display: flex; align-items: center; gap: 12px; position: sticky; top: 0; z-index: 10; }
    .header h1 { font-size: 18px; flex: 1; }
    .hamburger { background: none; border: none; font-size: 22px; cursor: pointer; color: #333; padding: 4px 8px; -webkit-tap-highlight-color: transparent; }
    .sidebar-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 50; }
    .sidebar { position: fixed; top: 0; left: 0; width: 260px; height: 100%; background: white; box-shadow: 2px 0 8px rgba(0,0,0,0.15); z-index: 51; display: flex; flex-direction: column; padding: 20px 0; }
    .sidebar h2 { font-size: 16px; padding: 0 20px 16px; border-bottom: 1px solid #e1e4e8; margin-bottom: 12px; }
    .sidebar nav { flex: 1; overflow-y: auto; }
    .sidebar a, .sidebar .nav-item { display: block; padding: 12px 20px; color: #333; text-decoration: none; font-size: 15px; border: none; background: none; width: 100%; text-align: left; cursor: pointer; font-family: inherit; }
    .sidebar a:hover, .sidebar .nav-item:hover { background: #f5f7fa; }
    .sidebar a.active { background: #f5f7fa; font-weight: 600; color: var(--accent); }
    .sidebar .user-email { padding: 12px 20px; font-size: 12px; color: #888; border-top: 1px solid #e1e4e8; word-break: break-all; }

    .container { max-width: 900px; margin: 0 auto; padding: 20px 16px; }
    .filter-bar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; align-items: center; }
    .filter-btn { padding: 6px 14px; border-radius: 20px; border: 1px solid var(--border); background: #fff; font-size: 13px; cursor: pointer; color: var(--fg); }
    .filter-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
    .summary { margin-left: auto; font-size: 13px; color: var(--fg-muted); }

    .link-card { background: var(--card-bg); border-radius: 10px; box-shadow: var(--shadow); margin-bottom: 10px; padding: 14px 16px; }
    .link-card-top { display: flex; align-items: flex-start; gap: 10px; }
    .badge { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 600; flex-shrink: 0; margin-top: 2px; }
    .badge-active { background: #d1fae5; color: #065f46; }
    .badge-expired { background: #fee2e2; color: #991b1b; }
    .badge-type { background: #e0f2fe; color: #075985; margin-left: 4px; }
    .customer-name { font-weight: 600; font-size: 15px; }
    .customer-meta { font-size: 12px; color: var(--fg-muted); margin-top: 2px; }
    .link-url { font-size: 12px; color: var(--accent); margin-top: 8px; word-break: break-all; text-decoration: none; }
    .link-url:hover { text-decoration: underline; }
    .link-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; flex-wrap: wrap; gap: 6px; }
    .expiry-text { font-size: 12px; color: var(--fg-muted); }
    .expiry-text.urgent { color: var(--orange); font-weight: 600; }
    .expiry-text.expired { color: var(--red); }
    .btn-revoke { padding: 4px 12px; font-size: 12px; border: 1px solid #fca5a5; color: var(--red); background: #fff; border-radius: 6px; cursor: pointer; }
    .btn-revoke:hover { background: #fee2e2; }
    .btn-copy { padding: 4px 12px; font-size: 12px; border: 1px solid var(--border); color: var(--fg); background: #fff; border-radius: 6px; cursor: pointer; }
    .btn-copy:hover { background: #f5f7fa; }

    .empty { text-align: center; color: var(--fg-muted); padding: 60px 0; font-size: 15px; }
    .loading { text-align: center; color: var(--fg-muted); padding: 40px 0; }

    .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #333; color: #fff; padding: 10px 20px; border-radius: 8px; font-size: 14px; z-index: 999; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
    .toast.show { opacity: 1; }

    .settings-card { background: var(--card-bg); border-radius: 10px; box-shadow: var(--shadow); padding: 16px 20px; margin-bottom: 16px; }
    .settings-card h2 { font-size: 14px; font-weight: 600; color: var(--fg-muted); margin-bottom: 14px; letter-spacing: 0.03em; }
    .setting-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 0; }
    .setting-row + .setting-row { margin-top: 12px; border-top: 1px solid var(--border); padding-top: 14px; }
    .setting-label { font-size: 14px; font-weight: 500; }
    .setting-desc { font-size: 12px; color: var(--fg-muted); margin-top: 2px; }
    .toggle-wrap { position: relative; width: 44px; height: 24px; flex-shrink: 0; }
    .toggle-wrap input { opacity: 0; width: 0; height: 0; position: absolute; }
    .toggle-slider { position: absolute; inset: 0; border-radius: 24px; background: #d1d5db; cursor: pointer; transition: background 0.2s; }
    .toggle-slider::after { content: ''; position: absolute; left: 3px; top: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
    .toggle-wrap input:checked + .toggle-slider { background: var(--accent); }
    .toggle-wrap input:checked + .toggle-slider::after { transform: translateX(20px); }
    .expiry-row { display: flex; align-items: center; gap: 8px; }
    .expiry-input { width: 70px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 14px; text-align: center; }
    .expiry-input:focus { outline: none; border-color: var(--accent); }
    .btn-save { padding: 6px 16px; background: var(--accent); color: #fff; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; }
    .btn-save:hover { opacity: 0.9; }
    .btn-save:disabled { opacity: 0.5; cursor: default; }
  </style>
</head>
<body>
<div class="header">
  <button class="hamburger" id="hamburger" aria-label="메뉴">☰</button>
  <h1>🔗 링크 관리</h1>
</div>

<div class="container">
  <!-- 설정 카드 -->
  <div class="settings-card">
    <h2>⚙️ 프록시 링크 설정</h2>
    <div class="setting-row">
      <div>
        <div class="setting-label">프록시 링크 사용</div>
        <div class="setting-desc">비활성화 시 Drive 링크를 그대로 발송 문구에 삽입</div>
      </div>
      <label class="toggle-wrap">
        <input type="checkbox" id="toggle-proxy" />
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="setting-row">
      <div>
        <div class="setting-label">기본 유효기간</div>
        <div class="setting-desc">새로 생성되는 프록시 링크에 적용</div>
      </div>
      <div class="expiry-row">
        <input type="number" class="expiry-input" id="expiry-days" min="1" max="365" value="60" />
        <span style="font-size:13px;color:var(--fg-muted)">일</span>
        <button class="btn-save" id="btn-save-expiry">저장</button>
      </div>
    </div>
  </div>

  <div class="filter-bar">
    <button class="filter-btn active" data-filter="all">전체</button>
    <button class="filter-btn" data-filter="active">유효</button>
    <button class="filter-btn" data-filter="expired">만료</button>
    <span class="summary" id="summary"></span>
  </div>
  <div id="list"><div class="loading">불러오는 중...</div></div>
</div>

<div class="toast" id="toast"></div>

<script>
const USER_EMAIL = ${JSON.stringify(userEmail)};
let currentFilter = 'all';

// ── 설정 로드 / 저장 ──────────────────────────────────────
async function loadSettings() {
  try {
    const res = await fetch('/api/settings?keys=proxy_link_enabled,proxy_link_expires_days');
    if (!res.ok) return;
    const { settings } = await res.json();
    document.getElementById('toggle-proxy').checked = settings['proxy_link_enabled'] !== 'false';
    document.getElementById('expiry-days').value = settings['proxy_link_expires_days'] ?? '60';
  } catch(e) {}
}

async function saveSetting(key, value) {
  const res = await fetch('/api/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
  return res.ok;
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();

  document.getElementById('toggle-proxy').addEventListener('change', async (e) => {
    const ok = await saveSetting('proxy_link_enabled', e.target.checked ? 'true' : 'false');
    showToast(ok
      ? (e.target.checked ? '프록시 링크 활성화됨' : '프록시 링크 비활성화됨')
      : '저장 실패');
  });

  const saveBtn = document.getElementById('btn-save-expiry');
  document.getElementById('expiry-days').addEventListener('input', () => {
    saveBtn.disabled = false;
  });
  saveBtn.addEventListener('click', async () => {
    const days = parseInt(document.getElementById('expiry-days').value, 10);
    if (!days || days < 1 || days > 365) { showToast('1~365 사이로 입력해주세요'); return; }
    saveBtn.disabled = true;
    const ok = await saveSetting('proxy_link_expires_days', String(days));
    showToast(ok ? \`유효기간 \${days}일로 저장됨\` : '저장 실패');
  });
});

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

function formatDate(dtStr) {
  if (!dtStr) return '-';
  const d = new Date(dtStr.includes('T') ? dtStr : dtStr.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function daysUntil(dtStr) {
  const d = new Date(dtStr.includes('T') ? dtStr : dtStr.replace(' ', 'T') + 'Z');
  return Math.ceil((d - Date.now()) / 86400000);
}

function linkTypeLabel(t) {
  if (t === 'original') return '원본';
  if (t === 'retouched') return '보정본';
  if (t === 'revision') return '추가보정';
  return t || '기타';
}

async function load(filter) {
  document.getElementById('list').innerHTML = '<div class="loading">불러오는 중...</div>';
  try {
    const res = await fetch('/api/proxy-links?filter=' + filter);
    if (res.status === 401) { location.href = '/login'; return; }
    const { links } = await res.json();
    render(links);
  } catch(e) {
    document.getElementById('list').innerHTML = '<div class="empty">불러오기 실패</div>';
  }
}

function render(links) {
  const list = document.getElementById('list');
  document.getElementById('summary').textContent = \`총 \${links.length}건\`;
  if (!links.length) { list.innerHTML = '<div class="empty">링크가 없습니다</div>'; return; }

  list.innerHTML = '';
  links.forEach(link => {
    const days = daysUntil(link.expires_at);
    const isExpired = days <= 0;
    const isUrgent = !isExpired && days <= 7;

    const card = document.createElement('div');
    card.className = 'link-card';

    const proxyUrl = location.origin + '/f/' + link.token;

    let expiryClass = 'expiry-text';
    let expiryText = '';
    if (isExpired) {
      expiryClass += ' expired';
      expiryText = '만료됨 (' + formatDate(link.expires_at) + ')';
    } else if (isUrgent) {
      expiryClass += ' urgent';
      expiryText = 'D-' + days + ' (' + formatDate(link.expires_at) + ')';
    } else {
      expiryText = '유효 D-' + days + ' (' + formatDate(link.expires_at) + ')';
    }

    const lastAccessed = link.last_accessed_at
      ? (() => {
          const d = new Date(link.last_accessed_at.replace(' ', 'T') + 'Z');
          const diffDays = Math.floor((Date.now() - d) / 86400000);
          if (diffDays === 0) return '오늘';
          if (diffDays === 1) return '어제';
          return diffDays + '일 전';
        })()
      : null;
    const accessText = link.access_count > 0
      ? \`조회 \${link.access_count}회\${lastAccessed ? ' · 마지막 ' + lastAccessed : ''}\`
      : '조회 기록 없음';

    card.innerHTML = \`
      <div class="link-card-top">
        <div>
          <span class="badge \${isExpired ? 'badge-expired' : 'badge-active'}">\${isExpired ? '만료' : '유효'}</span>
          <span class="badge badge-type">\${linkTypeLabel(link.link_type)}</span>
        </div>
        <div style="flex:1;margin-left:8px">
          <div class="customer-name">\${link.customer_name || '(미등록)'}</div>
          <div class="customer-meta">촬영일: \${link.shoot_date ? link.shoot_date.slice(0,10) : '-'} · 예약번호: \${link.booking_id || '-'}</div>
          <a class="link-url" href="\${proxyUrl}" target="_blank">\${proxyUrl}</a>
        </div>
      </div>
      <div class="link-footer">
        <div style="display:flex;flex-direction:column;gap:2px">
          <span class="\${expiryClass}">\${expiryText}</span>
          <span style="font-size:12px;color:var(--fg-muted)">\${accessText}</span>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn-copy" onclick="navigator.clipboard.writeText('\${proxyUrl}').then(()=>showToast('복사됨'))">복사</button>
          \${!isExpired ? \`<button class="btn-revoke" data-token="\${link.token}">즉시 만료</button>\` : ''}
        </div>
      </div>
    \`;
    list.appendChild(card);
  });

  list.querySelectorAll('.btn-revoke').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('이 링크를 즉시 만료시킬까요?')) return;
      const token = btn.dataset.token;
      const res = await fetch('/api/proxy-links/' + token, { method: 'DELETE' });
      if (res.ok) { showToast('링크가 만료되었습니다'); load(currentFilter); }
      else showToast('실패');
    });
  });
}

// 필터 버튼
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    load(currentFilter);
  });
});

// 햄버거 메뉴
document.getElementById('hamburger').addEventListener('click', () => {
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  const close = () => { overlay.remove(); sidebar.remove(); };
  overlay.addEventListener('click', close);

  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  sidebar.addEventListener('click', e => e.stopPropagation());

  const h2 = document.createElement('h2'); h2.textContent = '메뉴'; sidebar.appendChild(h2);
  const nav = document.createElement('nav');

  function mkLink(href, text, active) {
    const a = document.createElement('a');
    a.href = href; a.textContent = text;
    if (active) a.className = 'active';
    return a;
  }
  nav.appendChild(mkLink('/chat',             '💬 채팅',        false));
  nav.appendChild(mkLink('/dashboard',        '📊 대시보드',    false));
  nav.appendChild(mkLink('/upload-recommend', '📤 업로드 추천', false));
  nav.appendChild(mkLink('/photos',           '🖼️ 사진 관리',  false));
  nav.appendChild(mkLink('/rules',            '📋 학습 규칙',   false));
  nav.appendChild(mkLink('/report',           '📈 리포트',      false));
  nav.appendChild(mkLink('/cost',             '💰 API 비용',    false));
  nav.appendChild(mkLink('/memos',            '📝 개발 메모',   false));
  nav.appendChild(mkLink('/links',            '🔗 링크 관리',   true));

  const logoutBtn = document.createElement('button');
  logoutBtn.type = 'button'; logoutBtn.className = 'nav-item'; logoutBtn.textContent = '🚪 로그아웃';
  logoutBtn.addEventListener('click', async () => {
    try { await fetch('/auth/logout', { method: 'POST' }); } catch(_) {}
    location.href = '/login';
  });
  nav.appendChild(logoutBtn);
  sidebar.appendChild(nav);

  const emailDiv = document.createElement('div');
  emailDiv.className = 'user-email'; emailDiv.textContent = USER_EMAIL;
  sidebar.appendChild(emailDiv);

  document.body.appendChild(overlay);
  document.body.appendChild(sidebar);
});

load(currentFilter);
</script>
</body>
</html>`;
}
