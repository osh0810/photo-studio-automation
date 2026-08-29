/**
 * API 비용 현황 페이지 HTML.
 */

export function renderCostPage(userEmail: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API 비용 | 마음껏스튜디오</title>
  <style>
    :root {
      --bg: #f5f7fa; --fg: #333; --fg-muted: #888;
      --card-bg: #fff; --border: #e5e7eb;
      --accent: #3b82f6; --shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; background: var(--bg); color: var(--fg); min-height: 100vh; }
    .header { background: #fff; padding: 12px 16px; box-shadow: var(--shadow); display: flex; align-items: center; gap: 12px; position: sticky; top: 0; z-index: 10; }
    .header h1 { font-size: 18px; flex: 1; }
    .hamburger { background: none; border: none; font-size: 22px; cursor: pointer; color: #333; padding: 4px 8px; -webkit-tap-highlight-color: transparent; }
    .sidebar-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 50; }
    .sidebar { position: fixed; top: 0; left: 0; width: 260px; height: 100%; background: white; box-shadow: 2px 0 8px rgba(0,0,0,0.15); z-index: 51; display: flex; flex-direction: column; padding: 20px 0; }
    .sidebar h2 { font-size: 16px; padding: 0 20px 16px; border-bottom: 1px solid #e1e4e8; margin-bottom: 12px; }
    .sidebar nav { flex: 1; }
    .sidebar a, .sidebar .nav-item { display: block; padding: 12px 20px; color: #333; text-decoration: none; font-size: 15px; border: none; background: none; width: 100%; text-align: left; cursor: pointer; font-family: inherit; }
    .sidebar a:hover, .sidebar .nav-item:hover { background: #f5f7fa; }
    .sidebar a.active { background: #f5f7fa; font-weight: 600; color: var(--accent); }
    .sidebar .user-email { padding: 12px 20px; font-size: 12px; color: #888; border-top: 1px solid #e1e4e8; word-break: break-all; }

    .main { padding: 16px; max-width: 900px; margin: 0 auto; }
    .filter-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
    .filter-bar select { padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px; background: #fff; }

    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
    @media (max-width: 600px) { .summary-grid { grid-template-columns: 1fr 1fr; } }
    .summary-card { background: var(--card-bg); border-radius: 12px; padding: 16px; box-shadow: var(--shadow); }
    .summary-card .label { font-size: 12px; color: var(--fg-muted); margin-bottom: 6px; }
    .summary-card .value { font-size: 22px; font-weight: 700; }
    .summary-card .value.accent { color: var(--accent); }

    .section-title { font-size: 15px; font-weight: 600; margin-bottom: 10px; color: #444; }
    .table-wrap { background: var(--card-bg); border-radius: 12px; box-shadow: var(--shadow); overflow: hidden; margin-bottom: 24px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 560px; }
    thead th { background: #f8fafc; padding: 10px 12px; text-align: left; font-weight: 600; color: var(--fg-muted); border-bottom: 1px solid var(--border); white-space: nowrap; }
    tbody td { padding: 9px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover { background: #fafbfc; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
    .badge-chat { background: #dbeafe; color: #1d4ed8; }
    .badge-batch { background: #dcfce7; color: #166534; }
    .badge-memo { background: #fef3c7; color: #92400e; }
    .ctx { color: var(--fg-muted); font-size: 12px; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cost-val { font-weight: 600; font-variant-numeric: tabular-nums; }
    .loading { text-align: center; padding: 40px; color: var(--fg-muted); }
    .empty { text-align: center; padding: 40px; color: var(--fg-muted); font-size: 14px; }
  </style>
</head>
<body>
<div class="header">
  <button class="hamburger" id="hamburger">☰</button>
  <h1>💰 API 비용</h1>
</div>
<div class="main">
  <div class="filter-bar">
    <label style="font-size:13px;color:#666">조회 기간</label>
    <select id="days-select">
      <option value="7">최근 7일</option>
      <option value="30" selected>최근 30일</option>
      <option value="90">최근 90일</option>
    </select>
  </div>

  <div id="summary-area" class="summary-grid">
    <div class="loading">로딩 중...</div>
  </div>

  <div class="section-title">일별 집계</div>
  <div class="table-wrap">
    <table id="daily-table">
      <thead><tr><th>날짜(KST)</th><th>작업</th><th>호출수</th><th>입력토큰</th><th>출력토큰</th><th>비용(USD)</th></tr></thead>
      <tbody id="daily-body"><tr><td colspan="6" class="loading">로딩 중...</td></tr></tbody>
    </table>
  </div>

  <div class="section-title">최근 상세 내역 (최대 100건)</div>
  <div class="table-wrap">
    <table id="recent-table">
      <thead><tr><th>일시(KST)</th><th>작업</th><th>토큰(입력/출력)</th><th>비용(USD)</th><th>처리 대상</th></tr></thead>
      <tbody id="recent-body"><tr><td colspan="5" class="loading">로딩 중...</td></tr></tbody>
    </table>
  </div>
</div>
<script>
  const USER_EMAIL = ${JSON.stringify(userEmail)};

  function esc(s) { return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fmtCost(v) { return v != null ? '$' + Number(v).toFixed(5) : '-'; }
  function fmtNum(v) { return v != null ? Number(v).toLocaleString('ko-KR') : '-'; }
  function opBadge(op) {
    if (op === 'chat_reply')    return '<span class="badge badge-chat">💬 채팅</span>';
    if (op === 'batch_analyze') return '<span class="badge badge-batch">🤖 배치분석</span>';
    if (op === 'memo_analyze')  return '<span class="badge badge-memo">📝 개발메모</span>';
    return '<span class="badge">' + esc(op) + '</span>';
  }

  async function load() {
    const days = document.getElementById('days-select').value;
    const res = await fetch('/api/cost?days=' + days);
    if (!res.ok) { document.getElementById('summary-area').innerHTML = '<div class="empty">불러오기 실패</div>'; return; }
    const { summary, daily, recent } = await res.json();

    // 요약 카드
    document.getElementById('summary-area').innerHTML =
      card('오늘 비용', fmtCost(summary.today_cost_usd), true) +
      card('이번 달 비용', fmtCost(summary.month_cost_usd), false) +
      card('기간 내 총 비용', fmtCost(summary.total_cost_usd), false) +
      card('기간 내 총 호출', fmtNum(summary.total_calls) + '건', false) +
      card('기간 내 총 토큰', fmtNum(summary.total_tokens), false);

    // 일별 집계
    const $daily = document.getElementById('daily-body');
    if (!daily.length) { $daily.innerHTML = '<tr><td colspan="6" class="empty">데이터 없음</td></tr>'; }
    else $daily.innerHTML = daily.map(r =>
      '<tr>' +
      '<td>' + esc(r.day_kst) + '</td>' +
      '<td>' + opBadge(r.operation) + '</td>' +
      '<td>' + fmtNum(r.call_count) + '</td>' +
      '<td>' + fmtNum(r.total_input) + '</td>' +
      '<td>' + fmtNum(r.total_output) + '</td>' +
      '<td class="cost-val">' + fmtCost(r.total_cost_usd) + '</td>' +
      '</tr>'
    ).join('');

    // 최근 상세
    const $recent = document.getElementById('recent-body');
    if (!recent.length) { $recent.innerHTML = '<tr><td colspan="5" class="empty">데이터 없음</td></tr>'; }
    else $recent.innerHTML = recent.map(r =>
      '<tr>' +
      '<td style="white-space:nowrap">' + esc(r.logged_at_kst) + '</td>' +
      '<td>' + opBadge(r.operation) + '</td>' +
      '<td style="white-space:nowrap">' + fmtNum(r.input_tokens) + ' / ' + fmtNum(r.output_tokens) + '</td>' +
      '<td class="cost-val">' + fmtCost(r.cost_usd) + '</td>' +
      '<td class="ctx" title="' + esc(r.context_text || '') + '">' + esc(r.context_text || '-') + '</td>' +
      '</tr>'
    ).join('');
  }

  function card(label, value, accent) {
    return '<div class="summary-card"><div class="label">' + esc(label) + '</div><div class="value' + (accent ? ' accent' : '') + '">' + esc(value) + '</div></div>';
  }

  document.getElementById('days-select').addEventListener('change', load);

  // 사이드바
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
    nav.appendChild(mkLink('/chat',             '💬 채팅',      false));
    nav.appendChild(mkLink('/dashboard',        '📊 대시보드',  false));
    nav.appendChild(mkLink('/upload-recommend', '📤 업로드 추천', false));
    nav.appendChild(mkLink('/photos',           '🖼️ 사진 관리', false));
    nav.appendChild(mkLink('/rules',            '📋 학습 규칙', false));
    nav.appendChild(mkLink('/report',           '📈 리포트',    false));
    nav.appendChild(mkLink('/cost',             '💰 API 비용',  true));
    nav.appendChild(mkLink('/memos',            '📝 개발 메모', false));
    nav.appendChild(mkLink('/links',            '🔗 링크 관리', false));

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

  load();
</script>
</body>
</html>`;
}
