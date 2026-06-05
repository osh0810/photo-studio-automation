/**
 * 학습 규칙 목록 페이지 HTML.
 * 클라이언트가 /api/rules를 fetch 한 뒤 카드를 렌더링한다.
 */

export function renderRulesPage(userEmail: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>학습 규칙 | 마음껏스튜디오</title>
  <style>
    :root {
      --bg: #f5f7fa;
      --fg: #333;
      --fg-muted: #888;
      --card-bg: #fff;
      --border: #e5e7eb;
      --accent: #3b82f6;
      --shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
      background: var(--bg);
      color: var(--fg);
      min-height: 100vh;
    }
    .header {
      background: #fff;
      padding: 12px 16px;
      box-shadow: var(--shadow);
      display: flex;
      align-items: center;
      gap: 12px;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .header h1 { font-size: 18px; flex: 1; }
    .header .count { font-size: 13px; color: var(--fg-muted); }
    .hamburger {
      background: none;
      border: none;
      font-size: 22px;
      cursor: pointer;
      color: #333;
      padding: 4px 8px;
      -webkit-tap-highlight-color: transparent;
    }

    /* 사이드바 */
    .sidebar-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      z-index: 50;
    }
    .sidebar {
      position: fixed;
      top: 0; left: 0;
      width: 260px;
      height: 100%;
      background: white;
      box-shadow: 2px 0 8px rgba(0,0,0,0.15);
      z-index: 51;
      display: flex;
      flex-direction: column;
      padding: 20px 0;
    }
    .sidebar h2 {
      font-size: 16px;
      padding: 0 20px 16px;
      border-bottom: 1px solid #e1e4e8;
      margin-bottom: 12px;
    }
    .sidebar nav { flex: 1; }
    .sidebar a, .sidebar .nav-item {
      display: block;
      padding: 12px 20px;
      color: #333;
      text-decoration: none;
      font-size: 15px;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
      cursor: pointer;
      font-family: inherit;
    }
    .sidebar a:hover, .sidebar .nav-item:hover { background: #f5f7fa; }
    .sidebar a.active { background: #f5f7fa; font-weight: 600; color: #4285F4; }
    .sidebar .user-email {
      padding: 12px 20px;
      font-size: 12px;
      color: #888;
      border-top: 1px solid #e1e4e8;
      word-break: break-all;
    }
    .container { max-width: 720px; margin: 0 auto; padding: 16px; }
    .empty {
      text-align: center;
      color: var(--fg-muted);
      padding: 48px 16px;
      font-size: 14px;
    }
    .loading {
      text-align: center;
      color: var(--fg-muted);
      padding: 24px;
      font-size: 13px;
    }
    .rule-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 12px;
      box-shadow: var(--shadow);
    }
    .rule-card.inactive { opacity: 0.5; }
    .rule-card .top {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .rule-card .top .spacer { flex: 1; }
    .toggle-btn {
      border: 1px solid var(--border);
      background: #fff;
      color: var(--fg);
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      -webkit-tap-highlight-color: transparent;
    }
    .toggle-btn.deactivate { color: #555; }
    .toggle-btn.activate {
      background: #dcfce7;
      color: #166534;
      border-color: #86efac;
    }
    .toggle-btn:disabled { opacity: 0.6; cursor: wait; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
      background: #f3f4f6;
      color: #555;
    }
    .badge.auto { background: #dcfce7; color: #166534; }
    .badge.confirm { background: #fef9c3; color: #854d0e; }
    .badge.never { background: #fee2e2; color: #991b1b; }
    .badge.inactive { background: #e5e7eb; color: #555; }
    .rule-card .pattern {
      font-weight: 600;
      font-size: 15px;
      line-height: 1.4;
      margin-bottom: 10px;
      word-break: break-word;
    }
    .rule-card .json-block {
      background: #f9fafb;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 10px;
      font-family: "SF Mono", Monaco, Menlo, Consolas, monospace;
      font-size: 12px;
      color: #444;
      white-space: pre-wrap;
      word-break: break-word;
      margin-bottom: 6px;
      overflow-x: auto;
    }
    .rule-card .json-label {
      font-size: 11px;
      color: var(--fg-muted);
      margin-bottom: 2px;
    }
    .rule-card .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      margin-top: 10px;
      font-size: 12px;
      color: var(--fg-muted);
    }
    .rule-card .meta b { color: var(--fg); font-weight: 500; }
    @media (min-width: 768px) {
      .container { padding: 24px; }
      .rule-card { padding: 18px 20px; }
    }
  </style>
</head>
<body>
  <header class="header">
    <button id="hamburger" class="hamburger" aria-label="메뉴">☰</button>
    <h1>📋 학습 규칙 관리</h1>
    <span class="count" id="count"></span>
  </header>
  <main class="container">
    <div id="list" class="loading">불러오는 중…</div>
  </main>
  <script>
    // 사이드바 (대시보드와 동일 패턴)
    const USER_EMAIL = ${JSON.stringify(userEmail)};

    // 알림 상태 표시 (실제 권한 요청은 채팅 페이지에서)
    function buildNotifItem() {
      const supported =
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        typeof Notification !== 'undefined';
      if (!supported) {
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = '🚫 알림 미지원 브라우저';
        a.style.color = '#888';
        a.style.pointerEvents = 'none';
        return a;
      }
      const perm = Notification.permission;
      if (perm === 'granted') {
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = '✅ 알림 활성화됨';
        a.style.color = '#888';
        a.style.pointerEvents = 'none';
        return a;
      }
      if (perm === 'denied') {
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = '🔕 알림 거부됨 (설정에서 변경)';
        a.style.color = '#888';
        a.style.pointerEvents = 'none';
        return a;
      }
      const a = document.createElement('a');
      a.href = '/chat';
      a.textContent = '🔔 알림 활성화 (채팅에서)';
      return a;
    }

    document.getElementById('hamburger').addEventListener('click', () => {
      const overlay = document.createElement('div');
      overlay.className = 'sidebar-overlay';
      const close = () => { overlay.remove(); sidebar.remove(); };
      overlay.addEventListener('click', close);

      const sidebar = document.createElement('aside');
      sidebar.className = 'sidebar';
      sidebar.addEventListener('click', (e) => e.stopPropagation());

      const h2 = document.createElement('h2');
      h2.textContent = '메뉴';
      sidebar.appendChild(h2);

      const nav = document.createElement('nav');
      const linkChat = document.createElement('a');
      linkChat.href = '/chat';
      linkChat.textContent = '💬 채팅';
      const linkDash = document.createElement('a');
      linkDash.href = '/dashboard';
      linkDash.textContent = '📊 대시보드';
      const linkRules = document.createElement('a');
      linkRules.href = '/rules';
      linkRules.className = 'active';
      linkRules.textContent = '📋 학습 규칙';
      const linkReport = document.createElement('a');
      linkReport.href = '/report';
      linkReport.textContent = '📈 리포트';
      const notifItem = buildNotifItem();
      const logoutBtn = document.createElement('button');
      logoutBtn.type = 'button';
      logoutBtn.className = 'nav-item';
      logoutBtn.textContent = '🚪 로그아웃';
      logoutBtn.addEventListener('click', async () => {
        try { await fetch('/auth/logout', { method: 'POST' }); } catch (_) {}
        location.href = '/login';
      });
      nav.appendChild(linkChat);
      nav.appendChild(linkDash);
      nav.appendChild(linkRules);
      nav.appendChild(linkReport);
      nav.appendChild(notifItem);
      nav.appendChild(logoutBtn);
      sidebar.appendChild(nav);

      const emailDiv = document.createElement('div');
      emailDiv.className = 'user-email';
      emailDiv.textContent = USER_EMAIL;
      sidebar.appendChild(emailDiv);

      document.body.appendChild(overlay);
      document.body.appendChild(sidebar);
    });

    (function () {
      const TYPE_BADGE = {
        auto_process:     { cls: 'auto',    label: '🟢 자동처리' },
        auto_apply:       { cls: 'auto',    label: '🟢 자동처리' },
        confirm_required: { cls: 'confirm', label: '🟡 확인필요' },
        never_apply:      { cls: 'never',   label: '🔴 차단' },
      };

      function el(tag, attrs, ...children) {
        const e = document.createElement(tag);
        if (attrs) {
          for (const k in attrs) {
            if (k === 'class') e.className = attrs[k];
            else e.setAttribute(k, attrs[k]);
          }
        }
        for (const c of children) {
          if (c == null) continue;
          if (typeof c === 'string') e.appendChild(document.createTextNode(c));
          else e.appendChild(c);
        }
        return e;
      }

      function prettyJson(raw) {
        if (raw == null || raw === '') return null;
        try {
          return JSON.stringify(JSON.parse(raw), null, 2);
        } catch (_) {
          return String(raw);
        }
      }

      function formatDateTime(s) {
        if (!s) return '없음';
        return s.replace('T', ' ').replace(/\\.\\d{3}Z?$/, '');
      }

      function renderCard(rule) {
        const typeInfo = TYPE_BADGE[rule.rule_type] || { cls: '', label: rule.rule_type };
        const card = el('div', {
          class: 'rule-card' + (rule.is_active ? '' : ' inactive'),
          'data-id': String(rule.id),
        });

        const top = el('div', { class: 'top' });
        const typeBadge = el('span', { class: 'badge ' + typeInfo.cls }, typeInfo.label);
        top.appendChild(typeBadge);
        const inactiveBadge = el('span', { class: 'badge inactive' }, '비활성');
        if (!rule.is_active) {
          top.appendChild(inactiveBadge);
        }
        top.appendChild(el('span', { class: 'spacer' }));

        const toggleBtn = el('button', { type: 'button', class: 'toggle-btn' });
        function applyToggleLabel(active) {
          toggleBtn.textContent = active ? '비활성화하기' : '활성화하기';
          toggleBtn.className =
            'toggle-btn ' + (active ? 'deactivate' : 'activate');
        }
        applyToggleLabel(!!rule.is_active);
        toggleBtn.addEventListener('click', async () => {
          const wasActive = card.classList.contains('inactive') ? false : true;
          const original = toggleBtn.textContent;
          toggleBtn.disabled = true;
          toggleBtn.textContent = '처리중...';
          try {
            const res = await fetch('/api/rules/' + rule.id + '/toggle', {
              method: 'PATCH',
              credentials: 'include',
            });
            if (res.status === 401) { location.href = '/login'; return; }
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            const nowActive = data.is_active === 1;
            if (nowActive) {
              card.classList.remove('inactive');
              if (inactiveBadge.parentNode === top) top.removeChild(inactiveBadge);
              typeBadge.className = 'badge ' + typeInfo.cls;
              typeBadge.textContent = typeInfo.label;
            } else {
              card.classList.add('inactive');
              if (inactiveBadge.parentNode !== top) {
                top.insertBefore(inactiveBadge, top.children[1] || null);
              }
            }
            applyToggleLabel(nowActive);
          } catch (e) {
            console.error('[rules] toggle 실패:', e);
            toggleBtn.textContent = original;
            alert('토글 실패. 다시 시도해주세요.');
          } finally {
            toggleBtn.disabled = false;
          }
        });
        top.appendChild(toggleBtn);

        card.appendChild(top);

        card.appendChild(el('div', { class: 'pattern' }, rule.pattern_description || '(설명 없음)'));

        const condPretty = prettyJson(rule.conditions);
        if (condPretty) {
          card.appendChild(el('div', { class: 'json-label' }, 'conditions'));
          card.appendChild(el('div', { class: 'json-block' }, condPretty));
        }

        const actionPretty = prettyJson(rule.action);
        if (actionPretty) {
          card.appendChild(el('div', { class: 'json-label' }, 'action'));
          card.appendChild(el('div', { class: 'json-block' }, actionPretty));
        }

        const meta = el('div', { class: 'meta' });
        const lastApplied = el('span');
        lastApplied.appendChild(document.createTextNode('마지막 적용: '));
        lastApplied.appendChild(el('b', null, formatDateTime(rule.last_applied_at)));
        meta.appendChild(lastApplied);

        const cnt = el('span');
        cnt.appendChild(document.createTextNode('적용 횟수: '));
        cnt.appendChild(el('b', null, (rule.application_count ?? 0) + '회'));
        meta.appendChild(cnt);

        const created = el('span');
        created.appendChild(document.createTextNode('등록일: '));
        created.appendChild(el('b', null, formatDateTime(rule.created_at)));
        meta.appendChild(created);

        card.appendChild(meta);
        return card;
      }

      async function load() {
        const listEl = document.getElementById('list');
        const countEl = document.getElementById('count');
        try {
          const res = await fetch('/api/rules', { credentials: 'same-origin' });
          if (res.status === 401) { location.href = '/login'; return; }
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const rules = await res.json();
          countEl.textContent = '총 ' + rules.length + '개';
          listEl.innerHTML = '';
          listEl.className = '';
          if (rules.length === 0) {
            listEl.appendChild(el('div', { class: 'empty' }, '아직 등록된 학습 규칙이 없습니다.'));
            return;
          }
          for (const r of rules) listEl.appendChild(renderCard(r));
        } catch (e) {
          listEl.className = 'empty';
          listEl.textContent = '불러오기 실패: ' + (e && e.message ? e.message : String(e));
        }
      }

      load();
    })();
  </script>
</body>
</html>`;
}
