/**
 * 개발 메모 페이지 HTML.
 * GET /api/memos 로 목록을 fetch 해서 todo / in-progress / done 섹션으로 렌더링.
 * 같은 섹션 내 카드를 드래그앤드롭으로 순서 변경 → POST /api/memos/reorder
 */

export function renderMemosPage(userEmail: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>개발 메모 | 마음껏스튜디오</title>
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

    .main { max-width: 720px; margin: 0 auto; padding: 20px 16px 80px; }

    .section { margin-bottom: 28px; }
    .section-title {
      font-size: 16px; font-weight: 700; color: var(--fg);
      margin-bottom: 12px; display: flex; align-items: center; gap: 8px;
    }
    .section-count { background: var(--border); color: var(--fg-muted); font-size: 11px; padding: 1px 6px; border-radius: 10px; }
    .empty-msg { font-size: 13px; color: var(--fg-muted); padding: 12px 0; }

    /* ── 카드 ── */
    .memo-card {
      background: var(--card-bg); border: 1px solid var(--border);
      border-radius: 10px; padding: 14px 16px; margin-bottom: 8px;
      box-shadow: var(--shadow);
      cursor: grab;
      transition: box-shadow 0.15s, opacity 0.15s;
      user-select: none;
    }
    .memo-card:active { cursor: grabbing; }
    .memo-card.done { opacity: 0.55; }
    .memo-card.dragging { opacity: 0.35; box-shadow: none; }
    .memo-card.drag-over {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(59,130,246,0.25);
    }

    .drag-handle {
      display: inline-block; margin-right: 8px; color: #ccc;
      font-size: 14px; cursor: grab; vertical-align: middle;
    }

    .memo-top { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 6px; }
    .priority-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
    .priority-dot.urgent { background: #ef4444; }
    .priority-dot.normal { background: #f59e0b; }
    .priority-dot.low    { background: #6b7280; }
    .memo-title { font-size: 14px; font-weight: 600; line-height: 1.4; flex: 1; }
    .memo-card.done .memo-title { text-decoration: line-through; color: var(--fg-muted); }
    .memo-body { font-size: 13px; color: var(--fg-muted); line-height: 1.5; margin-left: 18px; margin-bottom: 10px; }
    .memo-footer { display: flex; align-items: center; gap: 6px; margin-left: 18px; }
    .memo-date { font-size: 11px; color: var(--fg-muted); flex: 1; }

    .btn { font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border); background: #fff; color: var(--fg); cursor: pointer; transition: background 0.15s; }
    .btn:hover { background: var(--bg); }
    .btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    .btn.primary:hover { background: #2563eb; }
    .btn.danger { color: #ef4444; }
    .btn.danger:hover { background: #fef2f2; border-color: #fca5a5; }

    .loading { text-align: center; padding: 40px; color: var(--fg-muted); font-size: 14px; }
  </style>
</head>
<body>
<div class="header">
  <button class="hamburger" id="hamburger">☰</button>
  <h1>📝 개발 메모</h1>
</div>

<div class="main">
  <div id="root"><div class="loading">불러오는 중…</div></div>
</div>

<script>
  const USER_EMAIL = ${JSON.stringify(userEmail)};
  let allMemos = [];
  let dragSrcId = null;   // 드래그 중인 카드의 memo id
  let dragSrcStatus = null; // 드래그 시작 섹션 (같은 섹션 내에서만 허용)

  async function load() {
    const res = await fetch('/api/memos');
    if (!res.ok) { document.getElementById('root').innerHTML = '<div class="loading">불러오기 실패</div>'; return; }
    const data = await res.json();
    allMemos = data.memos || [];
    render();
  }

  function render() {
    const groups = { todo: [], 'in-progress': [], done: [] };
    for (const m of allMemos) {
      if (groups[m.status]) groups[m.status].push(m);
    }

    const sections = [
      { key: 'todo',        label: '할 일',   icon: '📋' },
      { key: 'in-progress', label: '진행 중', icon: '🚧' },
      { key: 'done',        label: '완료',    icon: '✅' },
    ];

    const root = document.getElementById('root');
    root.innerHTML = '';

    sections.forEach(({ key, label, icon }) => {
      const items = groups[key];

      const section = document.createElement('div');
      section.className = 'section';

      const titleEl = document.createElement('div');
      titleEl.className = 'section-title';
      titleEl.innerHTML = icon + ' ' + label + ' <span class="section-count">' + items.length + '</span>';
      section.appendChild(titleEl);

      if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-msg';
        empty.textContent = '없음';
        section.appendChild(empty);
      } else {
        items.forEach(m => {
          section.appendChild(buildCard(m, key));
        });
      }

      root.appendChild(section);
    });
  }

  function buildCard(m, statusKey) {
    const isDone = m.status === 'done';
    const card = document.createElement('div');
    card.className = 'memo-card' + (isDone ? ' done' : '');
    card.dataset.id = String(m.id);
    card.dataset.status = m.status;

    // 드래그앤드롭 (완료 섹션 제외)
    if (!isDone) {
      card.draggable = true;
      card.addEventListener('dragstart', onDragStart);
      card.addEventListener('dragover',  onDragOver);
      card.addEventListener('dragleave', onDragLeave);
      card.addEventListener('drop',      onDrop);
      card.addEventListener('dragend',   onDragEnd);
    }

    // 상단: 핸들 + 점 + 제목
    const top = document.createElement('div');
    top.className = 'memo-top';

    if (!isDone) {
      const handle = document.createElement('span');
      handle.className = 'drag-handle';
      handle.textContent = '⠿';
      top.appendChild(handle);
    }

    const dot = document.createElement('div');
    dot.className = 'priority-dot ' + (m.priority || 'normal');
    top.appendChild(dot);

    const title = document.createElement('div');
    title.className = 'memo-title';
    title.textContent = m.title;
    top.appendChild(title);
    card.appendChild(top);

    // 본문
    if (m.body) {
      const body = document.createElement('div');
      body.className = 'memo-body';
      body.innerHTML = esc(m.body).replace(/\\n/g, '<br>');
      card.appendChild(body);
    }

    // 푸터
    const footer = document.createElement('div');
    footer.className = 'memo-footer';

    const date = document.createElement('span');
    date.className = 'memo-date';
    date.textContent = m.created_at ? m.created_at.slice(0, 10) : '';
    footer.appendChild(date);

    if (!isDone) {
      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn primary';
      nextBtn.textContent = m.status === 'todo' ? '진행 시작' : '완료';
      nextBtn.onclick = () => advance(m.id, m.status);
      footer.appendChild(nextBtn);
    } else {
      const revertBtn = document.createElement('button');
      revertBtn.className = 'btn';
      revertBtn.textContent = '되돌리기';
      revertBtn.onclick = () => revert(m.id);
      footer.appendChild(revertBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'btn danger';
    delBtn.textContent = '삭제';
    delBtn.onclick = () => del(m.id);
    footer.appendChild(delBtn);

    card.appendChild(footer);
    return card;
  }

  // ── 드래그앤드롭 핸들러 ──────────────────────────────────────────────────

  function onDragStart(e) {
    dragSrcId = Number(this.dataset.id);
    dragSrcStatus = this.dataset.status;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragSrcId));
  }

  function onDragOver(e) {
    e.preventDefault();
    // 같은 섹션 내에서만 허용
    if (this.dataset.status !== dragSrcStatus) return;
    if (Number(this.dataset.id) === dragSrcId) return;
    e.dataTransfer.dropEffect = 'move';
    this.classList.add('drag-over');
  }

  function onDragLeave() {
    this.classList.remove('drag-over');
  }

  function onDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over');
    if (this.dataset.status !== dragSrcStatus) return;
    const targetId = Number(this.dataset.id);
    if (targetId === dragSrcId) return;

    // allMemos 내에서 같은 status 그룹 재정렬
    const group = allMemos.filter(m => m.status === dragSrcStatus);
    const srcIdx = group.findIndex(m => m.id === dragSrcId);
    const tgtIdx = group.findIndex(m => m.id === targetId);
    if (srcIdx === -1 || tgtIdx === -1) return;

    // 배열에서 srcIdx 빼서 tgtIdx 위치에 삽입
    const [moved] = group.splice(srcIdx, 1);
    group.splice(tgtIdx, 0, moved);

    // allMemos에 반영
    const otherMemos = allMemos.filter(m => m.status !== dragSrcStatus);
    allMemos = [...otherMemos, ...group];

    render();
    saveOrder(group.map(m => m.id));
  }

  function onDragEnd() {
    this.classList.remove('dragging');
    // drag-over 잔재 정리
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    dragSrcId = null;
    dragSrcStatus = null;
  }

  async function saveOrder(ids) {
    await fetch('/api/memos/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
  }

  // ── CRUD ────────────────────────────────────────────────────────────────

  async function advance(id, currentStatus) {
    await patch(id, { status: currentStatus === 'todo' ? 'in-progress' : 'done' });
  }
  async function revert(id) { await patch(id, { status: 'todo' }); }
  async function del(id) {
    if (!confirm('삭제할까요?')) return;
    await fetch('/api/memos/' + id, { method: 'DELETE' });
    allMemos = allMemos.filter(m => m.id !== id);
    render();
  }
  async function patch(id, body) {
    await fetch('/api/memos/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const m = allMemos.find(m => m.id === id);
    if (m) Object.assign(m, body);
    render();
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── 사이드바 ─────────────────────────────────────────────────────────────

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
    nav.appendChild(mkLink('/memos',            '📝 개발 메모',   true));
    nav.appendChild(mkLink('/links',            '🔗 링크 관리',   false));

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
