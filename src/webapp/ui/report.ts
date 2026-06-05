/**
 * 운영 점검 리포트 페이지 HTML.
 * 클라이언트가 /api/report를 fetch 한 뒤 섹션별로 렌더링한다.
 */

export function renderReportPage(userEmail: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>운영 점검 | 마음껏스튜디오</title>
  <style>
    :root {
      --bg: #f5f7fa;
      --fg: #333;
      --fg-muted: #888;
      --card-bg: #fff;
      --border: #e5e7eb;
      --accent: #3b82f6;
      --shadow: 0 1px 3px rgba(0,0,0,0.05);
      --alert-bg: #fef2f2;
      --alert-border: #fecaca;
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
    .hamburger {
      background: none;
      border: none;
      font-size: 22px;
      cursor: pointer;
      color: #333;
      padding: 4px 8px;
      -webkit-tap-highlight-color: transparent;
    }
    .refresh-btn {
      background: none;
      border: 1px solid var(--border);
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
    }
    .refresh-btn:disabled { opacity: 0.6; cursor: wait; }

    .sidebar-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 50; }
    .sidebar {
      position: fixed; top: 0; left: 0; width: 260px; height: 100%;
      background: white; box-shadow: 2px 0 8px rgba(0,0,0,0.15);
      z-index: 51; display: flex; flex-direction: column; padding: 20px 0;
    }
    .sidebar h2 { font-size: 16px; padding: 0 20px 16px; border-bottom: 1px solid #e1e4e8; margin-bottom: 12px; }
    .sidebar nav { flex: 1; }
    .sidebar a, .sidebar .nav-item {
      display: block; padding: 12px 20px; color: #333; text-decoration: none;
      font-size: 15px; border: none; background: none; width: 100%;
      text-align: left; cursor: pointer; font-family: inherit;
    }
    .sidebar a:hover, .sidebar .nav-item:hover { background: #f5f7fa; }
    .sidebar a.active { background: #f5f7fa; font-weight: 600; color: #4285F4; }
    .sidebar .user-email {
      padding: 12px 20px; font-size: 12px; color: #888;
      border-top: 1px solid #e1e4e8; word-break: break-all;
    }

    .container { max-width: 880px; margin: 0 auto; padding: 16px; }
    .meta-bar {
      display: flex; align-items: center; gap: 8px;
      margin-bottom: 12px; font-size: 12px; color: var(--fg-muted);
    }
    .meta-bar .spacer { flex: 1; }

    .section { margin-bottom: 24px; }
    .section-title {
      font-size: 16px; font-weight: 600;
      margin-bottom: 10px; display: flex; align-items: center; gap: 8px;
    }

    .alert-zone {
      background: var(--alert-bg);
      border: 1px solid var(--alert-border);
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 24px;
    }
    .alert-zone.ok {
      background: #f0fdf4;
      border-color: #bbf7d0;
      text-align: center;
      color: #166534;
      font-weight: 500;
      padding: 18px;
    }
    .alert-card {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      margin-bottom: 8px;
    }
    .alert-card:last-child { margin-bottom: 0; }
    .alert-card .head {
      font-size: 13px; font-weight: 600; margin-bottom: 6px;
      display: flex; align-items: center; gap: 6px;
    }
    .alert-card .count { color: #b91c1c; font-weight: 700; }
    .alert-card ul {
      list-style: none;
      font-size: 12px;
      color: var(--fg-muted);
      max-height: 180px;
      overflow-y: auto;
    }
    .alert-card li {
      padding: 4px 0;
      border-top: 1px solid #f3f4f6;
      word-break: break-word;
    }
    .alert-card li:first-child { border-top: none; }
    .alert-card li b { color: var(--fg); font-weight: 500; }

    table.stats {
      width: 100%;
      border-collapse: collapse;
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      font-size: 13px;
      margin-bottom: 12px;
    }
    table.stats th, table.stats td {
      padding: 8px 10px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    table.stats th {
      background: #f9fafb;
      font-size: 12px;
      color: var(--fg-muted);
      font-weight: 500;
    }
    table.stats tr:last-child td { border-bottom: none; }
    table.stats td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .stats-label { font-size: 15px; color: var(--fg); margin: 16px 0 6px; font-weight: 700; }
    .desc {
      font-size: 0.75rem;
      color: #888;
      margin-top: 4px;
      line-height: 1.45;
    }
    .desc b { color: #555; font-weight: 600; }
    .desc + .desc { margin-top: 2px; }
    .alert-card .desc { margin-bottom: 6px; }
    .stats-desc-wrap { margin: 2px 0 8px; }
    .empty-row {
      padding: 10px 12px;
      font-size: 12px;
      color: var(--fg-muted);
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 12px;
    }
    .err-row {
      padding: 8px 10px;
      font-size: 12px;
      color: #b91c1c;
      background: #fef2f2;
      border: 1px solid var(--alert-border);
      border-radius: 6px;
      margin-bottom: 8px;
    }
    .loading, .empty {
      text-align: center;
      color: var(--fg-muted);
      padding: 24px;
      font-size: 13px;
    }
    @media (min-width: 768px) {
      .container { padding: 24px; }
    }
  </style>
</head>
<body>
  <header class="header">
    <button id="hamburger" class="hamburger" aria-label="메뉴">☰</button>
    <h1>🔍 운영 점검</h1>
  </header>
  <main class="container">
    <div class="meta-bar">
      <span id="updated">불러오는 중…</span>
      <span class="spacer"></span>
      <button id="refresh" class="refresh-btn" type="button">새로고침</button>
    </div>
    <div id="content"><div class="loading">불러오는 중…</div></div>
  </main>

  <script>
    const USER_EMAIL = ${JSON.stringify(userEmail)};

    function buildNotifItem() {
      const supported =
        'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
      if (!supported) {
        const a = document.createElement('a');
        a.href = '#'; a.textContent = '🚫 알림 미지원 브라우저';
        a.style.color = '#888'; a.style.pointerEvents = 'none';
        return a;
      }
      const perm = Notification.permission;
      if (perm === 'granted') {
        const a = document.createElement('a');
        a.href = '#'; a.textContent = '✅ 알림 활성화됨';
        a.style.color = '#888'; a.style.pointerEvents = 'none';
        return a;
      }
      if (perm === 'denied') {
        const a = document.createElement('a');
        a.href = '#'; a.textContent = '🔕 알림 거부됨 (설정에서 변경)';
        a.style.color = '#888'; a.style.pointerEvents = 'none';
        return a;
      }
      const a = document.createElement('a');
      a.href = '/chat'; a.textContent = '🔔 알림 활성화 (채팅에서)';
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
      function mkLink(href, text, active) {
        const a = document.createElement('a');
        a.href = href; a.textContent = text;
        if (active) a.className = 'active';
        return a;
      }
      nav.appendChild(mkLink('/chat', '💬 채팅', false));
      nav.appendChild(mkLink('/dashboard', '📊 대시보드', false));
      nav.appendChild(mkLink('/rules', '📋 학습 규칙', false));
      nav.appendChild(mkLink('/report', '📈 리포트', true));
      nav.appendChild(buildNotifItem());
      const logoutBtn = document.createElement('button');
      logoutBtn.type = 'button';
      logoutBtn.className = 'nav-item';
      logoutBtn.textContent = '🚪 로그아웃';
      logoutBtn.addEventListener('click', async () => {
        try { await fetch('/auth/logout', { method: 'POST' }); } catch (_) {}
        location.href = '/login';
      });
      nav.appendChild(logoutBtn);
      sidebar.appendChild(nav);

      const emailDiv = document.createElement('div');
      emailDiv.className = 'user-email';
      emailDiv.textContent = USER_EMAIL;
      sidebar.appendChild(emailDiv);

      document.body.appendChild(overlay);
      document.body.appendChild(sidebar);
    });

    function el(tag, attrs, ...children) {
      const e = document.createElement(tag);
      if (attrs) for (const k in attrs) {
        if (k === 'class') e.className = attrs[k];
        else e.setAttribute(k, attrs[k]);
      }
      for (const c of children) {
        if (c == null) continue;
        if (typeof c === 'string') e.appendChild(document.createTextNode(c));
        else e.appendChild(c);
      }
      return e;
    }

    function fmtTime(s) {
      if (!s) return '-';
      return s.replace('T', ' ').replace(/\\.\\d{3}Z?$/, '');
    }

    // SQLite datetime('now')은 UTC "YYYY-MM-DD HH:MM:SS" → KST 변환 + 날짜/요일 표기
    function fmtKst(utcStr) {
      if (!utcStr) return '-';
      const iso = utcStr.replace(' ', 'T') + 'Z';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return utcStr;
      const kst = new Date(d.getTime() + 9 * 3600 * 1000);
      const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
      const month = kst.getUTCMonth() + 1;
      const day = kst.getUTCDate();
      const dayName = dayNames[kst.getUTCDay()];
      const hh = String(kst.getUTCHours()).padStart(2, '0');
      const mm = String(kst.getUTCMinutes()).padStart(2, '0');
      return month + '/' + day + '(' + dayName + ') ' + hh + ':' + mm;
    }

    function descBlock(d) {
      if (!d) return null;
      const wrap = document.createElement('div');
      if (d.description) {
        const row = el('div', { class: 'desc' });
        row.appendChild(el('b', null, '설명:'));
        row.appendChild(document.createTextNode(' ' + d.description));
        wrap.appendChild(row);
      }
      if (d.action) {
        const row = el('div', { class: 'desc' });
        row.appendChild(el('b', null, '조치:'));
        row.appendChild(document.createTextNode(' ' + d.action));
        wrap.appendChild(row);
      }
      return wrap;
    }

    function alertCard(title, section, renderItem, desc) {
      if (section.error) {
        const c = el('div', { class: 'alert-card' });
        c.appendChild(el('div', { class: 'head' }, title));
        const db = descBlock(desc);
        if (db) c.appendChild(db);
        c.appendChild(el('div', { class: 'err-row' }, '쿼리 실패: ' + section.error));
        return c;
      }
      const c = el('div', { class: 'alert-card' });
      const head = el('div', { class: 'head' });
      head.appendChild(document.createTextNode(title + ' '));
      head.appendChild(el('span', { class: 'count' }, String(section.data.length) + '건'));
      c.appendChild(head);
      const db = descBlock(desc);
      if (db) c.appendChild(db);
      const ul = el('ul');
      for (const item of section.data) {
        ul.appendChild(el('li', null, renderItem(item)));
      }
      c.appendChild(ul);
      return c;
    }

    function statsTable(label, columns, section, desc) {
      const wrap = document.createElement('div');
      wrap.appendChild(el('div', { class: 'stats-label' }, label));
      const db = descBlock(desc);
      if (db) {
        db.className = 'stats-desc-wrap';
        wrap.appendChild(db);
      }
      if (section.error) {
        wrap.appendChild(el('div', { class: 'err-row' }, '쿼리 실패: ' + section.error));
        return wrap;
      }
      if (!section.data || section.data.length === 0) {
        wrap.appendChild(el('div', { class: 'empty-row' }, '데이터 없음'));
        return wrap;
      }
      const t = el('table', { class: 'stats' });
      const thead = el('thead');
      const trh = el('tr');
      for (const col of columns) trh.appendChild(el('th', null, col.label));
      thead.appendChild(trh);
      t.appendChild(thead);
      const tbody = el('tbody');
      for (const row of section.data) {
        const tr = el('tr');
        for (const col of columns) {
          const v = row[col.key];
          const td = el('td', col.num ? { class: 'num' } : null);
          td.textContent = v == null ? '-' : String(v);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      t.appendChild(tbody);
      wrap.appendChild(t);
      return wrap;
    }

    function renderAlertZone(s) {
      const total =
        (s.unlinked_bookings.error ? 1 : s.unlinked_bookings.data.length) +
        (s.no_calendar_event.error ? 1 : s.no_calendar_event.data.length) +
        (s.unmatched_details.error ? 1 : s.unmatched_details.data.length) +
        (s.echo_issues.error ? 1 : s.echo_issues.data.length);

      const wrap = el('div', { class: 'section' });
      wrap.appendChild(el('div', { class: 'section-title' }, '🚨 즉시 확인 필요'));

      if (total === 0) {
        wrap.appendChild(el('div', { class: 'alert-zone ok' }, '✅ 즉시 확인 필요한 항목이 없습니다.'));
        return wrap;
      }

      const zone = el('div', { class: 'alert-zone' });

      zone.appendChild(alertCard('🔗 talk_id 미연결 예약 (최근 7일)', s.unlinked_bookings, (b) => {
        const span = el('span');
        span.appendChild(el('b', null, b.customer_name || '(이름 없음)'));
        span.appendChild(document.createTextNode(' / ' + b.booking_id + ' / 예약일 ' + fmtTime(b.reservation_date)));
        return span;
      }, {
        description: '메일로 예약은 들어왔지만 톡톡 채팅방과 아직 연결되지 않은 건입니다.',
        action: '고객이 톡톡으로 메시지를 보내면 자동 연결됩니다. 7일이 지나도 연결 안 되면 채팅창에서 "예약번호 XXX에 talk_id YYY 연결해줘"로 수동 연결하세요.',
      }));

      zone.appendChild(alertCard('📅 캘린더 미등록 예약', s.no_calendar_event, (b) => {
        const span = el('span');
        span.appendChild(el('b', null, b.customer_name || '(이름 없음)'));
        span.appendChild(document.createTextNode(' / ' + b.booking_id + ' / 촬영 ' + fmtTime(b.shoot_date)));
        return span;
      }, {
        description: '촬영일이 있는데 Google 캘린더에 일정이 등록되지 않은 건입니다.',
        action: '채팅창에서 "/test/calendar-create?bookingId=XXX" 엔드포인트로 수동 등록하거나, 관리자에게 문의하세요.',
      }));

      zone.appendChild(alertCard('❓ 매칭 실패 booking_details', s.unmatched_details, (d) => {
        const span = el('span');
        span.appendChild(el('b', null, '#' + d.id + ' ' + (d.customer_name || '')));
        span.appendChild(document.createTextNode(' / ' + d.booking_id + ' / ' + (d.raw_text || '')));
        return span;
      }, {
        description: '예약 메일의 상품명이 DB 상품 목록과 매칭되지 않은 건입니다.',
        action: '채팅창에서 "booking_detail_id=N을 PRODUCT_CODE로 매칭해줘"로 수동 매칭하거나, 새 상품을 등록해주세요.',
      }));

      zone.appendChild(alertCard('🔁 echo 이슈 (최근 7일)', s.echo_issues, (e) => {
        const span = el('span');
        span.appendChild(el('b', null, e.type || '?'));
        span.appendChild(document.createTextNode(' / ' + fmtTime(e.created_at) + ' / ' + (e.preview || '')));
        return span;
      }, {
        description: '확정문자 발송 후 예약 자동 매칭에 실패했거나 talk_id 충돌이 발생한 건입니다.',
        action: 'echo_no_booking이면 해당 메일 누락 여부 확인. echo_conflict이면 채팅창에서 올바른 talk_id로 수동 연결하세요.',
      }));

      wrap.appendChild(zone);
      return wrap;
    }

    function renderStatsSection(stats) {
      const wrap = el('div', { class: 'section' });
      wrap.appendChild(el('div', { class: 'section-title' }, '📊 어제 처리 통계'));

      wrap.appendChild(statsTable('메일', [
        { key: 'email_type', label: '종류' },
        { key: 'processing_result', label: '결과' },
        { key: 'cnt', label: '건수', num: true },
      ], stats.email, {
        description: '네이버 예약 확정/취소 메일 자동 처리 결과입니다. success가 정상, parse_failed/error는 처리 실패입니다.',
        action: 'parse_failed나 error가 있으면 채팅창에서 해당 메일 ID로 수동 처리하세요.',
      }));

      wrap.appendChild(statsTable('톡톡', [
        { key: 'processing_status', label: '상태' },
        { key: 'cnt', label: '건수', num: true },
      ], stats.talk, {
        description: '고객 톡톡 메시지 자동 분류 결과입니다.',
        action: 'pending이 남아있으면 cron이 멈춘 것일 수 있으니 관리자에게 문의하세요.',
      }));

      wrap.appendChild(statsTable('Echo 매칭', [
        { key: 'type', label: '타입' },
        { key: 'cnt', label: '건수', num: true },
      ], stats.echo, {
        description: '작가님이 발송한 확정문자 echo의 자동 매칭 결과입니다.',
        action: 'echo_no_booking, echo_conflict가 있으면 위 즉시 확인 필요 섹션에서 확인하세요.',
      }));

      wrap.appendChild(statsTable('캘린더 알림', [
        { key: 'type', label: '타입' },
        { key: 'cnt', label: '건수', num: true },
      ], stats.calendar, {
        description: '캘린더 자동 등록/변경/취소 처리 중 오류가 발생한 건입니다.',
        action: 'calendar_error가 있으면 해당 예약을 캘린더 미등록 섹션에서 확인 후 수동 등록하세요.',
      }));

      return wrap;
    }

    function renderAiCalls(section) {
      const wrap = el('div', { class: 'section' });
      wrap.appendChild(el('div', { class: 'section-title' }, '🤖 AI 호출 현황 (최근 7일)'));
      wrap.appendChild(statsTable('일자별 AI 응답 수', [
        { key: 'day', label: '날짜' },
        { key: 'cnt', label: '호출 수', num: true },
      ], section, {
        description: '채팅창에서 AI를 호출한 횟수입니다. 일 200회 초과 시 비용이 급증할 수 있습니다.',
        action: '평소보다 급격히 높으면 비정상적인 반복 호출 여부를 확인하세요.',
      }));
      return wrap;
    }

    async function load() {
      const content = document.getElementById('content');
      const updated = document.getElementById('updated');
      const refresh = document.getElementById('refresh');
      refresh.disabled = true;
      try {
        const res = await fetch('/api/report', { credentials: 'same-origin' });
        if (res.status === 401) { location.href = '/login'; return; }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const body = await res.json();
        content.innerHTML = '';
        content.appendChild(renderAlertZone(body.sections));
        content.appendChild(renderStatsSection(body.sections.stats));
        content.appendChild(renderAiCalls(body.sections.ai_calls));
        updated.textContent = '마지막 업데이트: ' + fmtKst(body.generated_at);
      } catch (e) {
        content.innerHTML = '';
        content.appendChild(el('div', { class: 'empty' }, '불러오기 실패: ' + (e && e.message ? e.message : String(e))));
        updated.textContent = '불러오기 실패';
      } finally {
        refresh.disabled = false;
      }
    }

    document.getElementById('refresh').addEventListener('click', load);
    load();
  </script>
</body>
</html>`;
}
