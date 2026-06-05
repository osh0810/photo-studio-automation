/**
 * 대시보드 페이지 HTML (v2).
 * - 새 API: GET /api/dashboard/bookings, PATCH /api/dashboard/bookings/:id/milestone
 * - 우측 사이드 패널 (PC: flex, 모바일: fixed overlay)
 * - shoot_date: datetime-local input, KST 입력값 그대로 저장 (UTC 변환 없음), 표시도 DB 값 그대로
 * - 나머지 milestone: date-only input (YYYY-MM-DD)
 */

export function renderDashboardPage(userEmail: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>대시보드 | 마음껏스튜디오</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; background: #f5f7fa; color: #333; min-height: 100vh; }

    /* 헤더 */
    .header { background: white; padding: 12px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; align-items: center; gap: 12px; position: sticky; top: 0; z-index: 10; height: 52px; }
    .header h1 { font-size: 18px; flex: 1; }
    .hamburger { background: none; border: none; font-size: 22px; cursor: pointer; color: #333; padding: 4px 8px; -webkit-tap-highlight-color: transparent; }

    /* 사이드바 메뉴 */
    .sidebar-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 50; }
    .sidebar { position: fixed; top: 0; left: 0; width: 260px; height: 100%; background: white; box-shadow: 2px 0 8px rgba(0,0,0,0.15); z-index: 51; display: flex; flex-direction: column; padding: 20px 0; }
    .sidebar h2 { font-size: 16px; padding: 0 20px 16px; border-bottom: 1px solid #e1e4e8; margin-bottom: 12px; }
    .sidebar nav { flex: 1; }
    .sidebar a, .sidebar .nav-item { display: block; padding: 12px 20px; color: #333; text-decoration: none; font-size: 15px; border: none; background: none; width: 100%; text-align: left; cursor: pointer; font-family: inherit; }
    .sidebar a:hover, .sidebar .nav-item:hover { background: #f5f7fa; }
    .sidebar a.active { background: #f5f7fa; font-weight: 600; color: #4285F4; }
    .sidebar .user-email { padding: 12px 20px; font-size: 12px; color: #888; border-top: 1px solid #e1e4e8; word-break: break-all; }

    /* 컨테이너 */
    .container { max-width: 1440px; margin: 0 auto; padding: 20px; }

    /* 통계 카드 */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 20px; }
    .stat-card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .stat-card .label { font-size: 13px; color: #888; margin-bottom: 8px; }
    .stat-card .value { font-size: 28px; font-weight: 600; }
    .stat-card.warning .value { color: #f59e0b; }
    .stat-card.danger .value { color: #ef4444; }

    /* 툴바 */
    .toolbar { background: white; padding: 12px 16px; border-radius: 12px; margin-bottom: 16px; display: flex; gap: 10px; flex-wrap: wrap; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .search-box { flex: 1; min-width: 150px; padding: 9px 14px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; }
    .filter-select { padding: 9px 12px; border: 1px solid #ddd; border-radius: 8px; background: white; font-size: 13px; cursor: pointer; }

    /* 컨텐츠 영역 */
    .content-area { display: flex; gap: 16px; align-items: flex-start; }
    .list-area { flex: 1; min-width: 0; overflow: hidden; }
    .table-wrapper { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    thead { background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
    th { text-align: left; padding: 10px 13px; font-size: 12px; font-weight: 600; color: #666; white-space: nowrap; }
    td { padding: 10px 13px; border-bottom: 1px solid #f3f4f6; font-size: 13px; }
    tr:last-child td { border-bottom: none; }
    tbody tr:hover { background: #f9fafb; cursor: pointer; }
    tbody tr.selected td { background: #eff6ff !important; }
    .empty-state { text-align: center; padding: 60px 20px; color: #888; }

    /* 단계 배지 */
    .stage-badge { display: inline-block; padding: 3px 9px; border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap; }
    .sb-yellow { background: #fef3c7; color: #92400e; }
    .sb-blue   { background: #dbeafe; color: #1e40af; }
    .sb-purple { background: #ede9fe; color: #5b21b6; }
    .sb-gray   { background: #e4e4e7; color: #3f3f46; }
    .sb-red    { background: #fee2e2; color: #991b1b; }

    /* ──── 사이드 패널 ──── */
    .side-panel { width: 400px; flex-shrink: 0; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); position: sticky; top: 68px; max-height: calc(100vh - 84px); overflow-y: auto; }
    .panel-header { display: flex; align-items: center; padding: 13px 16px; border-bottom: 1px solid #e5e7eb; position: sticky; top: 0; background: white; z-index: 1; }
    .panel-header h3 { flex: 1; font-size: 14px; color: #555; }
    .panel-close { background: none; border: none; font-size: 18px; cursor: pointer; color: #888; padding: 3px 8px; border-radius: 4px; line-height: 1; }
    .panel-close:hover { background: #f3f4f6; color: #333; }
    .panel-body { padding: 0 0 24px; }
    .panel-section { padding: 13px 15px; border-bottom: 1px solid #f3f4f6; }
    .panel-section:last-child { border-bottom: none; }
    .section-title { font-size: 10px; font-weight: 700; color: #94a3b8; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 10px; }

    /* 필드 행 */
    .field-row { display: flex; gap: 8px; padding: 3px 0; font-size: 13px; align-items: flex-start; }
    .field-label { min-width: 80px; color: #888; font-size: 11px; padding-top: 2px; flex-shrink: 0; }
    .field-val { flex: 1; word-break: break-all; line-height: 1.5; }
    .field-edit-wrap { flex: 1; }
    .field-display { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-height: 22px; }
    .text-muted { color: #aaa; }
    code { font-size: 11px; background: #f3f4f6; padding: 1px 5px; border-radius: 3px; }

    /* 인라인 편집 */
    .edit-btn { background: none; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 11px; padding: 2px 7px; cursor: pointer; color: #64748b; flex-shrink: 0; }
    .edit-btn:hover { background: #f1f5f9; }
    .edit-form { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 6px; }
    .edit-form input[type="date"],
    .edit-form input[type="datetime-local"] { padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; flex: 1; min-width: 0; }
    .btn-save { padding: 4px 10px; background: #3b82f6; color: white; border: none; border-radius: 5px; font-size: 12px; cursor: pointer; white-space: nowrap; }
    .btn-save:hover { background: #2563eb; }
    .btn-cancel { padding: 4px 10px; background: #f1f5f9; color: #475569; border: none; border-radius: 5px; font-size: 12px; cursor: pointer; white-space: nowrap; }
    .btn-cancel:hover { background: #e2e8f0; }
    .btn-clear { padding: 2px 7px; background: #fee2e2; color: #b91c1c; border: none; border-radius: 4px; font-size: 11px; cursor: pointer; flex-shrink: 0; }
    .btn-clear:hover { background: #fecaca; }
    .copy-btn { padding: 1px 6px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 3px; font-size: 10px; cursor: pointer; color: #64748b; flex-shrink: 0; }
    .copy-btn:hover { background: #e2e8f0; }
    .link-btn { color: #3b82f6; text-decoration: none; font-size: 12px; padding: 2px 8px; border: 1px solid #bfdbfe; border-radius: 4px; }
    .link-btn:hover { background: #eff6ff; }
    .detail-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; font-size: 12px; margin-bottom: 6px; line-height: 1.5; }
    .detail-card:last-child { margin-bottom: 0; }

    /* 모바일 */
    @media (max-width: 768px) {
      .container { padding: 12px; }
      .stats-grid { grid-template-columns: repeat(2, 1fr); gap: 8px; }
      .stat-card { padding: 14px; }
      .stat-card .value { font-size: 22px; }
      .toolbar { padding: 10px 12px; }
      table { font-size: 12px; }
      th, td { padding: 9px 10px; }
      .col-product, .col-elapsed { display: none; }
      .content-area { display: block; }
      .side-panel { position: fixed; inset: 0; width: 100%; border-radius: 0; margin: 0; z-index: 200; max-height: 100vh; top: 0; }
    }
  </style>
</head>
<body>
  <header class="header">
    <button id="hamburger" class="hamburger" aria-label="메뉴">☰</button>
    <h1>📸 마음껏스튜디오</h1>
  </header>

  <div class="container">
    <div class="stats-grid">
      <div class="stat-card"><div class="label">전체 예약</div><div class="value" id="stat-total">-</div></div>
      <div class="stat-card"><div class="label">오늘 촬영</div><div class="value" id="stat-today">-</div></div>
      <div class="stat-card warning"><div class="label">검토 필요</div><div class="value" id="stat-review">-</div></div>
      <div class="stat-card"><div class="label">진행 중</div><div class="value" id="stat-progress">-</div></div>
    </div>

    <div class="toolbar">
      <input type="text" id="search" placeholder="고객명 검색..." class="search-box" />
      <select id="stage-filter" class="filter-select">
        <option value="all">전체 단계</option>
        <option value="예약접수">예약접수</option>
        <option value="예약확정">예약확정</option>
        <option value="원본발송완료">원본발송완료</option>
        <option value="셀렉완료">셀렉완료</option>
        <option value="보정완료">보정완료</option>
        <option value="재보정요청">재보정요청</option>
        <option value="재보정완료">재보정완료</option>
        <option value="추가보정없음">추가보정없음</option>
        <option value="액자발주완료">액자발주완료</option>
        <option value="취소">취소</option>
      </select>
      <select id="sort" class="filter-select">
        <option value="updated_at">최근 수정 순</option>
        <option value="shoot_date">촬영일 순</option>
      </select>
    </div>

    <div class="content-area">
      <div class="list-area">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>고객명</th>
                <th class="col-product">상품</th>
                <th>촬영일</th>
                <th>단계</th>
                <th class="col-elapsed">경과일</th>
                <th>최종수정</th>
              </tr>
            </thead>
            <tbody id="bookings-tbody">
              <tr><td colspan="6" class="empty-state">불러오는 중...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="side-panel" id="side-panel" style="display:none">
        <div class="panel-header">
          <h3>예약 상세</h3>
          <button class="panel-close" id="panel-close-btn">✕</button>
        </div>
        <div class="panel-body" id="panel-body"></div>
      </div>
    </div>
  </div>

  <script>
    const USER_EMAIL = ${JSON.stringify(userEmail)};
    let currentBookingId = null;
    const bookingsCache = {};
    let searchTimer;

    // ── shoot_date 포맷 헬퍼 ──────────────────────────────────────────────
    // DB 값(KST 그대로 저장) → 화면 표시용 문자열
    // '2026-05-30 11:00:00' → '2026-05-30 11:00'
    function shootDateDisplay(dbStr) {
      if (!dbStr) return '-';
      return dbStr.length > 10 ? dbStr.slice(0, 16) : dbStr.slice(0, 10);
    }

    // DB 값 → datetime-local input value
    // '2026-05-30 11:00:00' → '2026-05-30T11:00'
    function shootDateToInput(dbStr) {
      if (!dbStr) return '';
      return dbStr.length > 10 ? dbStr.slice(0, 16).replace(' ', 'T') : dbStr + 'T00:00';
    }

    // datetime-local input value → SQLite 문자열 (변환 없이 그대로)
    // '2026-05-30T11:00' → '2026-05-30 11:00:00'
    function shootInputToSqlite(inputVal) {
      if (!inputVal) return null;
      return inputVal.replace('T', ' ') + ':00';
    }

    // ── 경과일 ────────────────────────────────────────────────────────────
    function elapsedDays(shootDateStr) {
      if (!shootDateStr) return '-';
      const dateOnly = shootDateStr.slice(0, 10);
      const shootMs = new Date(dateOnly + 'T00:00:00Z').getTime();
      const nowKst = new Date(Date.now() + 9 * 3600000);
      const todayMs = new Date(nowKst.toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
      const diff = Math.round((todayMs - shootMs) / 86400000);
      if (diff === 0) return '<span style="color:#f59e0b;font-weight:600">오늘</span>';
      if (diff > 0) return '<span style="color:#94a3b8">+' + diff + '일</span>';
      return '<span style="color:#3b82f6">D' + diff + '</span>';
    }

    // ── 단계 배지 ─────────────────────────────────────────────────────────
    const STAGE_CLASS = {
      '예약접수':'sb-yellow', '예약확정':'sb-yellow',
      '원본발송완료':'sb-blue', '셀렉완료':'sb-blue',
      '보정완료':'sb-purple', '재보정요청':'sb-purple',
      '재보정완료':'sb-purple', '추가보정없음':'sb-purple',
      '액자발주완료':'sb-gray', '취소':'sb-red'
    };
    function stageBadge(stage) {
      const cls = STAGE_CLASS[stage] || 'sb-gray';
      return '<span class="stage-badge ' + cls + '">' + escapeHtml(stage) + '</span>';
    }

    // ── 유틸 ─────────────────────────────────────────────────────────────
    function escapeHtml(s) {
      if (s == null) return '';
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
    function copyToClipboard(text) {
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => showToast('복사됨'));
    }
    let toastTimer;
    function showToast(msg) {
      let el = document.getElementById('toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'toast';
        el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e293b;color:white;padding:8px 18px;border-radius:8px;font-size:13px;z-index:9999;pointer-events:none;opacity:0;transition:opacity 0.2s';
        document.body.appendChild(el);
      }
      el.textContent = msg;
      el.style.opacity = '1';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2000);
    }

    // ── 통계 ─────────────────────────────────────────────────────────────
    async function fetchStats() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        const stageMap = {};
        data.stages.forEach(s => { stageMap[s.current_stage] = s.count; });
        const total = data.stages.reduce((sum, s) => sum + s.count, 0);
        const inProgress = total - (stageMap['S7 액자발주'] || 0);
        document.getElementById('stat-total').textContent = total;
        document.getElementById('stat-today').textContent = data.todayShoot;
        document.getElementById('stat-review').textContent = data.reviewNeeded;
        document.getElementById('stat-progress').textContent = inProgress;
      } catch (e) { console.error('Stats 오류:', e); }
    }

    // ── 예약 목록 ────────────────────────────────────────────────────────
    async function fetchBookings() {
      const search = document.getElementById('search').value;
      const stage = document.getElementById('stage-filter').value;
      const sort = document.getElementById('sort').value;
      const params = new URLSearchParams({ search, stage, sort });
      try {
        const res = await fetch('/api/dashboard/bookings?' + params);
        const data = await res.json();
        data.bookings.forEach(b => { bookingsCache[b.booking_id] = b; });
        renderBookings(data.bookings);
      } catch (e) { console.error('Bookings 오류:', e); }
    }

    function renderBookings(bookings) {
      const tbody = document.getElementById('bookings-tbody');
      if (!bookings.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">조건에 맞는 예약 없음</td></tr>';
        return;
      }
      let html = '';
      for (const b of bookings) {
        const product = (b.booking_details && b.booking_details.length > 0)
          ? b.booking_details[0] : (b.product_name || '-');
        const shootDisplay = b.shoot_date ? shootDateDisplay(b.shoot_date) : '-';
        const updDisplay = b.updated_at ? b.updated_at.slice(0, 10) : '-';
        const sel = b.booking_id === currentBookingId ? ' selected' : '';
        html += '<tr data-id="' + escapeHtml(b.booking_id) + '" class="booking-row' + sel + '">';
        html += '<td><strong>' + escapeHtml(b.customer_name) + '</strong></td>';
        html += '<td class="col-product" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(product.slice(0, 30)) + '</td>';
        html += '<td class="cell-shoot" style="white-space:nowrap">' + escapeHtml(shootDisplay) + '</td>';
        html += '<td class="cell-stage">' + stageBadge(b.computed_stage) + '</td>';
        html += '<td class="col-elapsed cell-elapsed">' + elapsedDays(b.shoot_date) + '</td>';
        html += '<td class="cell-updated" style="color:#888">' + escapeHtml(updDisplay) + '</td>';
        html += '</tr>';
      }
      tbody.innerHTML = html;
    }

    // tbody 클릭 위임
    document.getElementById('bookings-tbody').addEventListener('click', e => {
      const row = e.target.closest('tr.booking-row');
      if (row && row.dataset.id) openPanel(row.dataset.id);
    });

    // ── 사이드 패널 ──────────────────────────────────────────────────────
    function openPanel(bookingId) {
      const booking = bookingsCache[bookingId];
      if (!booking) return;
      currentBookingId = bookingId;
      document.getElementById('panel-body').innerHTML = renderPanelContent(booking);
      document.getElementById('side-panel').style.display = 'block';
      document.querySelectorAll('tr.booking-row').forEach(r => {
        r.classList.toggle('selected', r.dataset.id === bookingId);
      });
    }

    document.getElementById('panel-close-btn').addEventListener('click', closePanel);
    function closePanel() {
      currentBookingId = null;
      document.getElementById('side-panel').style.display = 'none';
      document.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
    }

    // ── 패널 내용 렌더링 ─────────────────────────────────────────────────
    function renderPanelContent(b) {
      function sec(title, body) {
        return '<div class="panel-section"><div class="section-title">' + title + '</div>' + body + '</div>';
      }
      function fr(label, val) {
        const v = (val !== null && val !== undefined && val !== '') ? val : '<span class="text-muted">-</span>';
        return '<div class="field-row"><span class="field-label">' + label + '</span><div class="field-val">' + v + '</div></div>';
      }
      // 날짜 전용 편집 가능 필드
      function efDate(field, label, currentVal, hasClear) {
        const dv = currentVal ? escapeHtml(currentVal.slice(0, 10)) : '<span class="text-muted">-</span>';
        const clearBtn = hasClear
          ? ' <button class="btn-clear" data-action="clear" data-field="' + field + '">초기화</button>' : '';
        return '<div class="field-row"><span class="field-label">' + label + '</span>' +
          '<div class="field-edit-wrap">' +
          '<div class="field-display" id="fd-' + field + '">' +
          '<span id="fv-' + field + '">' + dv + '</span>' +
          ' <button class="edit-btn" data-action="edit" data-field="' + field + '">편집</button>' +
          clearBtn + '</div>' +
          '<div class="edit-form" id="ef-' + field + '" style="display:none">' +
          '<input type="date" id="ei-' + field + '" />' +
          ' <button class="btn-save" data-action="save" data-field="' + field + '">저장</button>' +
          ' <button class="btn-cancel" data-action="cancel" data-field="' + field + '">취소</button>' +
          '</div></div></div>';
      }
      // 날짜+시간 편집 가능 필드 (shoot_date, DB 값 그대로 표시)
      function efDateTime(field, label, currentVal) {
        const dv = currentVal ? escapeHtml(shootDateDisplay(currentVal)) : '<span class="text-muted">-</span>';
        return '<div class="field-row"><span class="field-label">' + label + '</span>' +
          '<div class="field-edit-wrap">' +
          '<div class="field-display" id="fd-' + field + '">' +
          '<span id="fv-' + field + '">' + dv + '</span>' +
          ' <button class="edit-btn" data-action="edit" data-field="' + field + '">편집</button>' +
          '</div>' +
          '<div class="edit-form" id="ef-' + field + '" style="display:none">' +
          '<input type="datetime-local" id="ei-' + field + '" />' +
          ' <button class="btn-save" data-action="save" data-field="' + field + '">저장</button>' +
          ' <button class="btn-cancel" data-action="cancel" data-field="' + field + '">취소</button>' +
          '</div></div></div>';
      }

      let html = '';

      // ① 기본정보
      let s1 = '';
      s1 += '<div class="field-row"><span class="field-label">예약번호</span><div class="field-val"><code>' +
        escapeHtml(b.booking_id) + '</code>' +
        ' <button class="copy-btn" data-action="copy" data-value="' + escapeHtml(b.booking_id) + '">복사</button></div></div>';
      s1 += '<div class="field-row"><span class="field-label">톡ID</span><div class="field-val">' +
        (b.talk_id
          ? '<code>' + escapeHtml(b.talk_id) + '</code> <button class="copy-btn" data-action="copy" data-value="' + escapeHtml(b.talk_id) + '">복사</button>'
          : '<span class="text-muted">미연결</span>') +
        '</div></div>';
      s1 += fr('고객명', escapeHtml(b.customer_name));
      s1 += fr('요청사항', b.request_note ? escapeHtml(b.request_note) : '');
      s1 += fr('예약일', b.reservation_date ? escapeHtml(b.reservation_date.slice(0, 10)) : '');
      s1 += fr('홍보동의', b.promotion_consent ? '✅ 동의' : '❌ 미동의');
      s1 += fr('현재단계',
        '<span class="stage-badge ' + (STAGE_CLASS[b.computed_stage] || 'sb-gray') + '" id="panel-stage">' +
        escapeHtml(b.computed_stage) + '</span>');
      html += sec('기본정보', s1);

      // ② 촬영 일정 (datetime-local, KST/UTC)
      html += sec('촬영 일정', efDateTime('shoot_date', '촬영일', b.shoot_date));

      // ③ 처리 단계 타임라인
      const timeline = [
        ['original_sent_at',     '원본발송'],
        ['selection_received_at','셀렉완료'],
        ['retouched_sent_at',    '보정완료'],
        ['revision_requested_at','재보정요청'],
        ['revision_sent_at',     '재보정완료'],
        ['revision_no_more_at',  '추가보정없음'],
        ['frame_ordered_at',     '액자발주'],
      ];
      let s3 = '';
      for (const [field, label] of timeline) {
        s3 += efDate(field, label, b[field], false);
      }
      html += sec('처리 단계', s3);

      // ④ 알림/기타
      let s4 = '';
      s4 += efDate('urgent_retouch_until', '긴급 마감일', b.urgent_retouch_until, true);
      s4 += efDate('alert_paused_until', '알림정지', b.alert_paused_until, true);
      s4 += fr('취소여부', b.cancelled ? '✅ 취소됨' : '정상');
      if (b.cancelled) {
        s4 += fr('취소일', b.cancelled_at ? escapeHtml(b.cancelled_at.slice(0, 10)) : '');
        s4 += fr('취소사유', b.cancellation_reason ? escapeHtml(b.cancellation_reason) : '');
      }
      s4 += fr('등록일', b.created_at ? escapeHtml(b.created_at.slice(0, 16)) : '');
      s4 += fr('최종수정', '<span id="panel-updated-at">' +
        (b.updated_at ? escapeHtml(b.updated_at.slice(0, 16)) : '-') + '</span>');
      html += sec('알림/기타', s4);

      // ⑤ 연동 정보
      let s5 = '';
      s5 += fr('캘린더', b.has_calendar ? '✅ 연동됨' : '❌ 미연동');
      s5 += fr('원본폴더', b.original_folder_url
        ? '<a class="link-btn" href="' + escapeHtml(b.original_folder_url) + '" target="_blank" rel="noopener">열기</a>' : '');
      s5 += fr('보정폴더', b.retouched_folder_url
        ? '<a class="link-btn" href="' + escapeHtml(b.retouched_folder_url) + '" target="_blank" rel="noopener">열기</a>' : '');
      s5 += fr('액자주소', b.frame_address ? '✅ 주소 있음' : '❌ 주소 없음');
      html += sec('연동 정보', s5);

      // ⑥ 예약 상품
      let s6 = '';
      if (b.booking_details && b.booking_details.length > 0) {
        for (const detail of b.booking_details) {
          s6 += '<div class="detail-card">' + escapeHtml(detail) + '</div>';
        }
      } else {
        s6 += '<div class="text-muted" style="font-size:13px">등록된 상품 없음</div>';
      }
      html += sec('예약 상품', s6);

      return html;
    }

    // 패널 이벤트 위임
    document.getElementById('panel-body').addEventListener('click', e => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const { action, field, value } = el.dataset;
      if (action === 'copy')   copyToClipboard(value);
      else if (action === 'edit')   startEdit(field);
      else if (action === 'save')   saveField(field);
      else if (action === 'cancel') cancelEdit(field);
      else if (action === 'clear')  clearField(field);
    });

    // ── 인라인 편집 ─────────────────────────────────────────────────────
    function startEdit(field) {
      const booking = bookingsCache[currentBookingId];
      if (!booking) return;
      const input = document.getElementById('ei-' + field);
      if (!input) return;
      if (field === 'shoot_date') {
        input.value = shootDateToInput(booking.shoot_date);
      } else {
        const raw = booking[field];
        input.value = raw ? raw.slice(0, 10) : '';
      }
      document.getElementById('fd-' + field).style.display = 'none';
      document.getElementById('ef-' + field).style.display = 'flex';
      input.focus();
    }

    function cancelEdit(field) {
      document.getElementById('fd-' + field).style.display = 'flex';
      document.getElementById('ef-' + field).style.display = 'none';
    }

    async function saveField(field) {
      const input = document.getElementById('ei-' + field);
      if (!input) return;
      const inputVal = input.value.trim();
      let apiValue = null;
      if (inputVal) {
        apiValue = field === 'shoot_date'
          ? shootInputToSqlite(inputVal)
          : inputVal + ' 00:00:00';
      }
      await patchField(field, apiValue);
    }

    async function clearField(field) {
      await patchField(field, null);
    }

    async function patchField(field, value) {
      if (!currentBookingId) return;
      try {
        const res = await fetch(
          '/api/dashboard/bookings/' + encodeURIComponent(currentBookingId) + '/milestone',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ field, value }),
          }
        );
        const data = await res.json();
        if (!data.success) { alert('저장 실패: ' + (data.error || '알 수 없는 오류')); return; }

        // 캐시 갱신
        bookingsCache[currentBookingId][field] = value;
        bookingsCache[currentBookingId].computed_stage = data.computed_stage;
        bookingsCache[currentBookingId].updated_at = data.updated_at;

        // 패널 값 갱신
        const fvEl = document.getElementById('fv-' + field);
        if (fvEl) {
          fvEl.innerHTML = value
            ? (field === 'shoot_date'
                ? escapeHtml(shootDateDisplay(value))
                : escapeHtml(value.slice(0, 10)))
            : '<span class="text-muted">-</span>';
        }
        cancelEdit(field);

        // 패널 단계 배지
        const stageEl = document.getElementById('panel-stage');
        if (stageEl) {
          stageEl.textContent = data.computed_stage;
          stageEl.className = 'stage-badge ' + (STAGE_CLASS[data.computed_stage] || 'sb-gray');
        }
        const updEl = document.getElementById('panel-updated-at');
        if (updEl) updEl.textContent = data.updated_at ? data.updated_at.slice(0, 16) : '-';

        // 목록 행 갱신
        const row = document.querySelector('tr[data-id="' + currentBookingId + '"]');
        if (row) {
          const badge = row.querySelector('.cell-stage .stage-badge');
          if (badge) {
            badge.textContent = data.computed_stage;
            badge.className = 'stage-badge ' + (STAGE_CLASS[data.computed_stage] || 'sb-gray');
          }
          if (field === 'shoot_date') {
            const shootCell = row.querySelector('.cell-shoot');
            if (shootCell) shootCell.textContent = value ? shootDateDisplay(value) : '-';
            const elapsedCell = row.querySelector('.cell-elapsed');
            if (elapsedCell) elapsedCell.innerHTML = elapsedDays(value);
          }
          const updCell = row.querySelector('.cell-updated');
          if (updCell) updCell.textContent = data.updated_at ? data.updated_at.slice(0, 10) : '-';
        }

        showToast('저장 완료');
      } catch (e) { alert('저장 중 오류: ' + e.message); }
    }

    // ── 검색/필터 이벤트 ────────────────────────────────────────────────
    document.getElementById('search').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(fetchBookings, 300);
    });
    document.getElementById('stage-filter').addEventListener('change', fetchBookings);
    document.getElementById('sort').addEventListener('change', fetchBookings);

    // ── 사이드바 (기존 유지) ─────────────────────────────────────────────
    function buildNotifItem() {
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
      if (!supported) { const a = document.createElement('a'); a.href='#'; a.textContent='🚫 알림 미지원 브라우저'; a.style.color='#888'; a.style.pointerEvents='none'; return a; }
      const perm = Notification.permission;
      if (perm === 'granted') { const a = document.createElement('a'); a.href='#'; a.textContent='✅ 알림 활성화됨'; a.style.color='#888'; a.style.pointerEvents='none'; return a; }
      if (perm === 'denied') { const a = document.createElement('a'); a.href='#'; a.textContent='🔕 알림 거부됨 (설정에서 변경)'; a.style.color='#888'; a.style.pointerEvents='none'; return a; }
      const a = document.createElement('a'); a.href='/chat'; a.textContent='🔔 알림 활성화 (채팅에서)'; return a;
    }
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
      const linkChat = document.createElement('a'); linkChat.href='/chat'; linkChat.textContent='💬 채팅';
      const linkDash = document.createElement('a'); linkDash.href='/dashboard'; linkDash.className='active'; linkDash.textContent='📊 대시보드';
      const linkRules = document.createElement('a'); linkRules.href='/rules'; linkRules.textContent='📋 학습 규칙';
      const linkReport = document.createElement('a'); linkReport.href='/report'; linkReport.textContent='📈 리포트';
      const notifItem = buildNotifItem();
      const logoutBtn = document.createElement('button'); logoutBtn.type='button'; logoutBtn.className='nav-item'; logoutBtn.textContent='🚪 로그아웃';
      logoutBtn.addEventListener('click', async () => {
        try { await fetch('/auth/logout', { method: 'POST' }); } catch (_) {}
        location.href = '/login';
      });
      [linkChat, linkDash, linkRules, linkReport, notifItem, logoutBtn].forEach(el => nav.appendChild(el));
      sidebar.appendChild(nav);
      const emailDiv = document.createElement('div'); emailDiv.className='user-email'; emailDiv.textContent=USER_EMAIL; sidebar.appendChild(emailDiv);
      document.body.appendChild(overlay); document.body.appendChild(sidebar);
    });

    // ── 초기 로드 ───────────────────────────────────────────────────────
    fetchStats();
    fetchBookings();
  </script>
</body>
</html>`;
}
