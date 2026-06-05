/**
 * 채팅 메인 페이지 (단일 HTML, CSS+JS 인라인).
 * 모바일 우선, PWA 준비.
 */

export function renderChatPage(userEmail: string): string {
  const safeEmail = userEmail.replace(/[<>&"']/g, (c) => {
    const m: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return m[c];
  });

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="theme-color" content="#4285F4">
  <link rel="manifest" href="/manifest.json">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="apple-touch-icon" href="/icon.svg">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="스튜디오비서">
  <meta name="mobile-web-app-capable" content="yes">
  <title>MAUM</title>
  <style>
    :root {
      --bg: #ffffff;
      --bg-soft: #f5f7fa;
      --fg: #1a1a1a;
      --fg-muted: #666;
      --border: #e1e4e8;
      --user-bg: #4285F4;
      --user-fg: #ffffff;
      --ai-bg: #F1F3F4;
      --ai-fg: #1a1a1a;
      --sys-bg: #F8F9FA;
      --sys-fg: #555;
      --topbar-bg: #ffffff;
      --accent: #4285F4;
      --quote-bg: rgba(0,0,0,0.05);
      --shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1a1a1a;
        --bg-soft: #0f0f0f;
        --fg: #e8e8e8;
        --fg-muted: #999;
        --border: #2a2a2a;
        --user-bg: #4285F4;
        --user-fg: #ffffff;
        --ai-bg: #2a2a2a;
        --ai-fg: #e8e8e8;
        --sys-bg: #222;
        --sys-fg: #aaa;
        --topbar-bg: #1f1f1f;
        --quote-bg: rgba(255,255,255,0.08);
        --shadow: 0 1px 3px rgba(0,0,0,0.3);
      }
    }

    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    html, body {
      height: 100%;
      overflow: hidden;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
      background: var(--bg-soft);
      color: var(--fg);
      font-size: 16px;
      line-height: 1.4;
      display: flex;
      flex-direction: column;
      height: 100dvh;
    }

    /* ─── 상단 바 ─── */
    .topbar {
      background: var(--topbar-bg);
      box-shadow: var(--shadow);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      flex-shrink: 0;
      z-index: 10;
    }
    .topbar h1 { font-size: 17px; font-weight: 600; }
    .topbar button {
      background: none;
      border: none;
      font-size: 22px;
      cursor: pointer;
      color: var(--fg);
      padding: 4px 8px;
      position: relative;
    }
    .badge {
      position: absolute;
      top: 0; right: 0;
      background: #ea4335;
      color: white;
      font-size: 11px;
      font-weight: 600;
      min-width: 16px;
      height: 16px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 4px;
    }
    .hidden { display: none !important; }

    /* ─── 사이드바 ─── */
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
      background: var(--bg);
      box-shadow: 2px 0 8px rgba(0,0,0,0.15);
      z-index: 51;
      display: flex;
      flex-direction: column;
      padding: 20px 0;
    }
    .sidebar h2 {
      font-size: 16px;
      padding: 0 20px 16px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 12px;
    }
    .sidebar nav { flex: 1; }
    .sidebar a, .sidebar .nav-item {
      display: block;
      padding: 12px 20px;
      color: var(--fg);
      text-decoration: none;
      font-size: 15px;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
      cursor: pointer;
    }
    .sidebar a:hover, .sidebar .nav-item:hover { background: var(--bg-soft); }
    .sidebar a.active { background: var(--bg-soft); font-weight: 600; color: var(--accent); }
    .sidebar a.disabled { color: var(--fg-muted); pointer-events: none; }
    .sidebar .user-email {
      padding: 12px 20px;
      font-size: 12px;
      color: var(--fg-muted);
      border-top: 1px solid var(--border);
    }

    /* ─── 메시지 영역 ─── */
    .msg-list {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      -webkit-overflow-scrolling: touch;
    }
    .msg-row { display: flex; flex-direction: column; max-width: 80%; }
    @media (min-width: 768px) {
      .msg-row { max-width: 60%; }
    }
    .msg-row.user { align-self: flex-end; align-items: flex-end; }
    .msg-row.ai { align-self: flex-start; align-items: flex-start; }
    .msg-row.system {
      align-self: center;
      width: 100%;
      max-width: 85%;
      min-width: 200px;
      align-items: stretch;
    }
    /* 카드 컨테이너 — details + 푸터를 함께 감싼다 */
    .msg-system-card {
      background: var(--sys-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 12px;
    }
    .msg-system-card .msg-system-footer {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid rgba(0,0,0,0.06);
    }
    .msg-system-card .msg-system-footer .time-text {
      font-size: 0.75rem;
      color: #888;
    }
    .msg-system-card .msg-system-footer .copy-btn {
      padding: 2px 8px;
      font-size: 13px;
      opacity: 0.7;
    }
    .msg-system-card .msg-system-footer .copy-btn:hover { opacity: 1; }
    /* 🛍️ 현장 추가 상품 카드 등 동작 버튼 행 — details 바깥 표시 */
    .drive-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 8px;
      padding: 0 4px;
    }
    .drive-actions button {
      padding: 6px 16px;
      border-radius: 8px;
      border: none;
      font-size: 0.9rem;
      color: #fff;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .drive-actions button.primary { background: #22c55e; }
    .drive-actions button.secondary { background: #9ca3af; }
    .drive-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
    .drive-actions-done {
      text-align: right;
      margin-top: 8px;
      padding: 0 4px;
      font-size: 0.85rem;
      color: var(--fg-muted);
    }
    .send-message-header {
      font-weight: 600;
      font-size: 14px;
      padding-bottom: 8px;
      margin-bottom: 8px;
      color: var(--fg);
      border-bottom: 1px solid var(--border);
    }
    .send-message-warning {
      background: #fef9c3;
      border: 1px solid #fde68a;
      color: #854d0e;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 12px;
      margin-bottom: 8px;
    }
    .send-message-body {
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 14px;
      line-height: 1.5;
    }
    /* drive_send_message 카드는 summary 자식들을 세로 배치 (제목 + 본문) */
    .msg-system summary.send-message-summary {
      flex-direction: column;
      align-items: stretch;
      gap: 0;
    }

    .msg-bubble {
      padding: 10px 14px;
      border-radius: 16px;
      word-break: break-word;
      white-space: pre-wrap;
      box-shadow: var(--shadow);
    }
    .msg-row.user .msg-bubble {
      background: var(--user-bg);
      color: var(--user-fg);
      border-bottom-right-radius: 4px;
    }
    .msg-row.ai .msg-bubble {
      background: var(--ai-bg);
      color: var(--ai-fg);
      border-bottom-left-radius: 4px;
    }
    .msg-time {
      font-size: 11px;
      color: var(--fg-muted);
      margin-top: 4px;
      padding: 0 4px;
    }

    /* 답장 인용 박스 */
    .msg-quote {
      background: var(--quote-bg);
      border-left: 3px solid var(--accent);
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 13px;
      margin-bottom: 4px;
      cursor: pointer;
      max-width: 100%;
    }
    .msg-quote .q-sender { font-weight: 600; color: var(--accent); margin-right: 6px; }
    .msg-quote .q-text {
      color: var(--fg-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: block;
    }

    /* 액션 버튼 */
    .msg-actions {
      margin-top: 6px;
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .action-btn {
      background: var(--bg);
      color: var(--fg);
      border: 1px solid var(--border);
      padding: 6px 12px;
      border-radius: 16px;
      font-size: 13px;
      cursor: pointer;
    }
    .action-btn:hover { background: var(--bg-soft); }
    .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* 시스템 메시지 */
    .msg-system {
      /* 카드 컨테이너(.msg-system-card)가 배경/보더 담당 — details는 투명 */
      color: var(--sys-fg);
      font-size: 13px;
      width: 100%;
    }
    .msg-system summary {
      cursor: pointer;
      list-style: none;
      display: flex;
      align-items: flex-start;
      gap: 6px;
    }
    .msg-system summary::-webkit-details-marker { display: none; }
    .msg-system .sys-time { color: var(--fg-muted); font-size: 11px; }
    .msg-system .sys-icon { font-size: 14px; }
    .msg-system .sys-content {
      flex: 1;
      min-width: 0;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .copy-btn {
      background: transparent;
      border: none;
      cursor: pointer;
      font-size: 15px;
      opacity: 0.5;
      transition: opacity 0.15s, color 0.15s;
      padding: 4px 8px;
      border-radius: 4px;
      flex-shrink: 0;
      align-self: flex-start;
      color: inherit;
    }
    .copy-btn:hover { opacity: 1; background: rgba(0, 0, 0, 0.05); }
    .copy-btn:focus { outline: none; opacity: 1; }
    .copy-btn.copied { color: #22c55e; opacity: 1; }
    .msg-system .confirm-buttons {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    .msg-system .confirm-buttons button {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg);
      color: var(--fg);
      font-size: 14px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .msg-system .confirm-buttons button:hover:not(:disabled) {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
    }
    .msg-system .confirm-buttons button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .msg-system .confirm-result {
      margin-top: 8px;
      padding: 8px 12px;
      font-size: 13px;
      color: var(--fg-muted);
      border-radius: 6px;
      background: var(--bg);
      border: 1px solid var(--border);
    }
    .msg-system .confirm-result.success { color: var(--accent); }
    .msg-system .confirm-result.cancel { color: var(--fg-muted); }
    .msg-system .sys-meta {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--border);
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 11px;
      white-space: pre-wrap;
      word-break: break-all;
    }

    /* 강조(scroll target) */
    @keyframes flash-highlight {
      0%, 100% { background-color: transparent; }
      40% { background-color: rgba(66, 133, 244, 0.25); }
    }
    .flash { animation: flash-highlight 1.2s ease; border-radius: 16px; }

    /* 타이핑 인디케이터 */
    .typing {
      align-self: flex-start;
      max-width: 80%;
      padding: 10px 14px;
      background: var(--ai-bg);
      color: var(--fg-muted);
      border-radius: 16px;
      border-bottom-left-radius: 4px;
      font-size: 14px;
    }
    .typing .dots::after {
      content: '...';
      animation: dots 1.2s steps(4, end) infinite;
    }
    @keyframes dots {
      0%, 20% { content: ''; }
      40% { content: '.'; }
      60% { content: '..'; }
      80%, 100% { content: '...'; }
    }

    /* ─── 답장 바 ─── */
    .reply-bar {
      background: var(--bg);
      border-top: 1px solid var(--border);
      padding: 8px 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }
    .reply-bar .icon { color: var(--accent); }
    .reply-bar .preview {
      flex: 1;
      color: var(--fg-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .reply-bar button {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 16px;
      color: var(--fg-muted);
    }

    /* ─── 입력 영역 ─── */
    .composer {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      padding: 10px 12px;
      background: var(--bg);
      border-top: 1px solid var(--border);
      flex-shrink: 0;
    }
    .composer textarea {
      flex: 1;
      resize: none;
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 10px 14px;
      font-size: 16px;
      font-family: inherit;
      background: var(--bg-soft);
      color: var(--fg);
      max-height: 120px;
      overflow-y: auto;
      line-height: 1.4;
    }
    .composer textarea:focus { outline: none; border-color: var(--accent); }
    .composer #send {
      background: var(--accent);
      color: white;
      border: none;
      width: 40px;
      height: 40px;
      border-radius: 20px;
      font-size: 18px;
      cursor: pointer;
      flex-shrink: 0;
    }
    .composer #send:disabled { opacity: 0.5; cursor: not-allowed; }
    .shortcut-wrap { position: relative; flex-shrink: 0; }
    #btn-plus {
      background: var(--accent);
      border: none;
      color: white;
      width: 40px;
      height: 40px;
      border-radius: 20px;
      font-size: 22px;
      font-weight: 300;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    #btn-plus:hover { filter: brightness(1.1); }
    .shortcut-menu {
      position: absolute;
      bottom: calc(100% + 8px);
      left: 0;
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.14);
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 150px;
      z-index: 100;
    }
    .shortcut-menu-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border: none;
      background: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-family: inherit;
      color: var(--fg);
      white-space: nowrap;
      text-align: left;
    }
    .shortcut-menu-item:hover { background: var(--bg-soft); }
    .shortcut-menu-item svg { flex-shrink: 0; color: var(--accent); }

    /* ─── 예약 추가 모달 ─── */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.45);
      z-index: 200; display: flex; align-items: flex-end; justify-content: center;
    }
    @media (min-width: 600px) { .modal-overlay { align-items: center; } }
    .modal-card {
      background: var(--bg); width: 100%; max-width: 480px;
      border-radius: 16px 16px 0 0; padding: 20px 16px 24px;
      max-height: 90vh; overflow-y: auto;
      box-shadow: 0 -4px 24px rgba(0,0,0,0.15);
    }
    @media (min-width: 600px) { .modal-card { border-radius: 16px; } }
    .modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .modal-header h2 { font-size: 17px; font-weight: 600; }
    .modal-close { background: none; border: none; font-size: 22px; cursor: pointer; color: var(--fg-muted, #888); padding: 4px; }
    .modal-field { margin-bottom: 13px; }
    .modal-field label { display: block; font-size: 13px; color: #555; margin-bottom: 4px; font-weight: 500; }
    .modal-field input, .modal-field select {
      width: 100%; padding: 9px 12px; border: 1px solid var(--border);
      border-radius: 8px; font-size: 15px; font-family: inherit;
      background: var(--bg-soft); color: var(--fg);
    }
    .modal-field input:focus, .modal-field select:focus { outline: none; border-color: var(--accent); }
    .modal-autocomplete-wrap { position: relative; }
    .modal-autocomplete-dropdown {
      position: absolute; top: 100%; left: 0; right: 0;
      background: white; border: 1px solid var(--border); border-top: none;
      border-radius: 0 0 8px 8px; z-index: 10; max-height: 160px; overflow-y: auto;
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    }
    .modal-autocomplete-item {
      padding: 9px 12px; cursor: pointer; font-size: 14px;
    }
    .modal-autocomplete-item:hover { background: var(--bg-soft); }
    .modal-error { color: #ef4444; font-size: 13px; margin-bottom: 10px; }
    .modal-footer { display: flex; gap: 10px; margin-top: 18px; }
    .modal-footer button { flex: 1; padding: 11px; border: none; border-radius: 10px; font-size: 15px; font-family: inherit; cursor: pointer; font-weight: 500; }
    .modal-btn-cancel { background: var(--bg-soft); color: var(--fg); }
    .modal-btn-save { background: var(--accent); color: white; }
    .modal-btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
    .modal-time-row { display: flex; gap: 8px; }
    .modal-time-row input[type="date"] { flex: 2; min-width: 0; }
    .modal-time-row select { flex: 1; min-width: 0; }
    .modal-product-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; min-height: 0; }
    .modal-product-tag { background: var(--accent); color: white; padding: 4px 10px; border-radius: 20px; font-size: 13px; display: flex; align-items: center; gap: 6px; }
    .modal-product-tag-remove { cursor: pointer; font-size: 16px; line-height: 1; opacity: 0.8; }
    .modal-field input[readonly] { background: var(--bg); color: #888; cursor: default; }
    .modal-money-row { display: flex; gap: 8px; }
    .modal-money-row .modal-field { flex: 1; margin-bottom: 0; }

    /* ─── 토스트 ─── */
    .toast {
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.8);
      color: white;
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 13px;
      z-index: 100;
      max-width: 90%;
      text-align: center;
    }

    /* 컨텍스트 메뉴 */
    .ctx-menu {
      position: fixed;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 80;
      min-width: 120px;
      overflow: hidden;
    }
    .ctx-menu button {
      display: block;
      width: 100%;
      padding: 10px 14px;
      background: none;
      border: none;
      text-align: left;
      font-size: 14px;
      cursor: pointer;
      color: var(--fg);
    }
    .ctx-menu button:hover { background: var(--bg-soft); }
  </style>
</head>
<body>
  <header class="topbar">
    <button id="hamburger" aria-label="메뉴">☰</button>
    <h1>MAUM</h1>
    <button id="bell" aria-label="알림">
      🔔<span id="badge" class="badge hidden">0</span>
    </button>
  </header>

  <main id="messages" class="msg-list" aria-live="polite"></main>

  <div id="reply-bar" class="reply-bar hidden">
    <span class="icon">↩</span>
    <span class="preview" id="reply-preview"></span>
    <button id="reply-cancel" aria-label="답장 취소">✕</button>
  </div>

  <div id="booking-modal" class="modal-overlay" style="display:none">
    <div class="modal-card">
      <div class="modal-header">
        <h2>예약 추가</h2>
        <button type="button" class="modal-close" id="booking-modal-close">✕</button>
      </div>
      <div id="booking-modal-error" class="modal-error" style="display:none"></div>
      <div class="modal-field">
        <label>고객명 <span style="color:#ef4444">*</span></label>
        <input type="text" id="bm-name" placeholder="홍길동" autocomplete="off">
      </div>
      <div class="modal-field">
        <label>연락처</label>
        <input type="tel" id="bm-phone" placeholder="010-0000-0000" autocomplete="off">
      </div>
      <div class="modal-field">
        <label>상담채널</label>
        <select id="bm-channel">
          <option value="">선택</option>
          <option value="톡톡(네이버)">톡톡(네이버)</option>
          <option value="카톡">카톡</option>
          <option value="문자">문자</option>
        </select>
      </div>
      <div class="modal-field">
        <label>결제방식</label>
        <select id="bm-payment">
          <option value="현장결제">현장결제</option>
          <option value="계좌이체">계좌이체</option>
          <option value="계좌이체-예약금">계좌이체-예약금</option>
        </select>
      </div>
      <div class="modal-field">
        <label>촬영일 <span style="color:#ef4444">*</span></label>
        <div class="modal-time-row">
          <input type="date" id="bm-shoot-date">
          <select id="bm-shoot-hour">
            <option value="08">08시</option><option value="09">09시</option>
            <option value="10">10시</option><option value="11" selected>11시</option>
            <option value="12">12시</option><option value="13">13시</option>
            <option value="14">14시</option><option value="15">15시</option>
            <option value="16">16시</option><option value="17">17시</option>
            <option value="18">18시</option><option value="19">19시</option>
            <option value="20">20시</option><option value="21">21시</option>
          </select>
          <select id="bm-shoot-min">
            <option value="00">00분</option>
            <option value="30">30분</option>
          </select>
        </div>
      </div>
      <div class="modal-field">
        <label>상품명 <span style="font-weight:400;color:#888;font-size:12px">(Enter 또는 선택으로 추가)</span></label>
        <div id="bm-products-list" class="modal-product-tags"></div>
        <div class="modal-autocomplete-wrap">
          <input type="text" id="bm-product-name" placeholder="상품명 검색 또는 직접 입력" autocomplete="off">
          <div id="bm-product-dropdown" class="modal-autocomplete-dropdown" style="display:none"></div>
        </div>
      </div>
      <div class="modal-field">
        <label>총액</label>
        <input type="text" id="bm-amount" placeholder="0" inputmode="numeric" autocomplete="off">
      </div>
      <div class="modal-money-row" style="margin-bottom:13px">
        <div class="modal-field">
          <label>선입금</label>
          <input type="text" id="bm-deposit" placeholder="0" inputmode="numeric" autocomplete="off">
        </div>
        <div class="modal-field">
          <label>잔액</label>
          <input type="text" id="bm-balance" readonly placeholder="자동계산">
        </div>
      </div>
      <div class="modal-field">
        <label>메모</label>
        <input type="text" id="bm-note" placeholder="특이사항" autocomplete="off">
      </div>
      <div class="modal-footer">
        <button type="button" class="modal-btn-cancel" id="bm-cancel">취소</button>
        <button type="button" class="modal-btn-save" id="bm-save">저장</button>
      </div>
    </div>
  </div>

  <form id="composer" class="composer">
    <div class="shortcut-wrap">
      <div id="shortcut-menu" class="shortcut-menu" style="display:none">
        <button type="button" class="shortcut-menu-item" id="sm-booking"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>예약 추가</button>
        <button type="button" class="shortcut-menu-item" id="sm-email"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,13 22,4"/></svg>새 예약 확인</button>
        <button type="button" class="shortcut-menu-item" id="sm-schedule"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>현재 일정</button>
      </div>
      <button type="button" id="btn-plus" aria-label="단축 메뉴">+</button>
    </div>
    <textarea id="input" rows="1" placeholder="메시지 입력..." autocomplete="off"></textarea>
    <button type="submit" id="send" aria-label="전송">➤</button>
  </form>

  <script>
  (function() {
    'use strict';

    const USER_EMAIL = ${JSON.stringify(safeEmail)};
    const POLL_INTERVAL_MS = 5000;
    const HISTORY_LIMIT = 50;

    const state = {
      messages: [],
      seenIds: new Set(),
      replyTo: null,
      polling: null,
      busy: false,
      typingEl: null,
      ctxMenu: null,
      lastTouchTimer: null,
      cursor: null,
      hasMore: true,
      loadingMore: false,
    };

    const $messages = document.getElementById('messages');
    const $input = document.getElementById('input');
    const $send = document.getElementById('send');
    const $form = document.getElementById('composer');
    // ── 단축 메뉴 ────────────────────────────────────────────
    const $btnPlus = document.getElementById('btn-plus');
    const $shortcutMenu = document.getElementById('shortcut-menu');
    function closeShortcutMenu() {
      $shortcutMenu.style.display = 'none';
      $btnPlus.textContent = '+';
    }
    $btnPlus.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = $shortcutMenu.style.display !== 'none';
      if (isOpen) { closeShortcutMenu(); } else {
        $shortcutMenu.style.display = 'flex';
        $btnPlus.textContent = '✕';
      }
    });
    document.addEventListener('click', (e) => {
      if (!$btnPlus.contains(e.target) && !$shortcutMenu.contains(e.target)) closeShortcutMenu();
    });
    document.getElementById('sm-schedule').addEventListener('click', () => {
      closeShortcutMenu();
      sendMessage('현재일정 알려줘');
    });

    // ── 예약 추가 모달 ────────────────────────────────────────
    const $bookingModal = document.getElementById('booking-modal');
    const $bmError = document.getElementById('booking-modal-error');
    let bmSelectedProducts = [];

    function bmEsc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function parseMoney(s) { return parseInt(String(s).replace(/,/g, '')) || 0; }
    function fmtMoney(n) { return n ? Number(n).toLocaleString('ko-KR') : ''; }

    function renderProductTags() {
      const $list = document.getElementById('bm-products-list');
      $list.innerHTML = bmSelectedProducts.map((p, i) =>
        '<span class="modal-product-tag">' + bmEsc(p.product_name) +
        ' <span class="modal-product-tag-remove" data-idx="' + i + '">×</span></span>'
      ).join('');
    }
    document.getElementById('bm-products-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.modal-product-tag-remove');
      if (!btn) return;
      bmSelectedProducts.splice(Number(btn.dataset.idx), 1);
      renderProductTags();
    });

    function updateBalance() {
      const total = parseMoney(document.getElementById('bm-amount').value);
      const dep = parseMoney(document.getElementById('bm-deposit').value);
      document.getElementById('bm-balance').value = (total || dep) ? fmtMoney(total - dep) : '';
    }
    ['bm-amount','bm-deposit'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', updateBalance);
      el.addEventListener('blur', () => { const n = parseMoney(el.value); el.value = n ? fmtMoney(n) : ''; updateBalance(); });
    });

    function openBookingModal() {
      bmSelectedProducts = [];
      renderProductTags();
      ['bm-name','bm-phone','bm-product-name','bm-note','bm-amount','bm-deposit','bm-balance'].forEach(id => { document.getElementById(id).value = ''; });
      document.getElementById('bm-channel').value = '';
      document.getElementById('bm-payment').value = '현장결제';
      document.getElementById('bm-shoot-date').value = '';
      document.getElementById('bm-shoot-hour').value = '11';
      document.getElementById('bm-shoot-min').value = '00';
      document.getElementById('bm-product-dropdown').style.display = 'none';
      $bmError.style.display = 'none';
      $bookingModal.style.display = 'flex';
    }
    function closeBookingModal() { $bookingModal.style.display = 'none'; }

    function hasBookingInput() {
      return (
        document.getElementById('bm-name').value.trim() !== '' ||
        document.getElementById('bm-phone').value.trim() !== '' ||
        document.getElementById('bm-shoot-date').value !== '' ||
        bmSelectedProducts.length > 0 ||
        document.getElementById('bm-product-name').value.trim() !== '' ||
        document.getElementById('bm-amount').value.trim() !== '' ||
        document.getElementById('bm-note').value.trim() !== ''
      );
    }

    function confirmCloseBookingModal() {
      if (hasBookingInput() && !confirm('입력 중인 내용이 있습니다. 닫으시겠습니까?')) return;
      closeBookingModal();
    }

    document.getElementById('sm-booking').addEventListener('click', () => { closeShortcutMenu(); openBookingModal(); });
    document.getElementById('booking-modal-close').addEventListener('click', confirmCloseBookingModal);
    document.getElementById('bm-cancel').addEventListener('click', confirmCloseBookingModal);
    $bookingModal.addEventListener('click', (e) => { if (e.target === $bookingModal) confirmCloseBookingModal(); });

    // 상품 자동완성 + 다중 추가
    let productSearchTimer;
    const $productName = document.getElementById('bm-product-name');
    const $productDropdown = document.getElementById('bm-product-dropdown');

    function addProduct(product_id, product_name) {
      if (!product_name.trim()) return;
      bmSelectedProducts.push({ product_id: product_id || '', product_name: product_name.trim() });
      renderProductTags();
      $productName.value = '';
      $productDropdown.style.display = 'none';
    }
    $productName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addProduct('', $productName.value); }
    });
    $productName.addEventListener('input', () => {
      clearTimeout(productSearchTimer);
      const q = $productName.value.trim();
      if (!q) { $productDropdown.style.display = 'none'; return; }
      productSearchTimer = setTimeout(async () => {
        try {
          const data = await api('GET', '/api/products/search?q=' + encodeURIComponent(q));
          const items = data.products || [];
          if (!items.length) { $productDropdown.style.display = 'none'; return; }
          $productDropdown.innerHTML = items.map(p =>
            '<div class="modal-autocomplete-item" data-id="' + bmEsc(p.product_id) + '" data-name="' + bmEsc(p.product_name) + '">' +
            bmEsc(p.product_name) + (p.price ? ' (' + p.price.toLocaleString() + '원)' : '') + '</div>'
          ).join('');
          $productDropdown.style.display = 'block';
        } catch(_) { $productDropdown.style.display = 'none'; }
      }, 300);
    });
    $productDropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.modal-autocomplete-item');
      if (!item) return;
      addProduct(item.dataset.id, item.dataset.name);
    });
    document.addEventListener('click', (e) => {
      if (!$productName.contains(e.target) && !$productDropdown.contains(e.target))
        $productDropdown.style.display = 'none';
    });

    // 저장
    document.getElementById('bm-save').addEventListener('click', async () => {
      const name = document.getElementById('bm-name').value.trim();
      const dateVal = document.getElementById('bm-shoot-date').value;
      const hourVal = document.getElementById('bm-shoot-hour').value;
      const minVal = document.getElementById('bm-shoot-min').value;
      if (!name) { $bmError.textContent = '고객명을 입력해주세요.'; $bmError.style.display = 'block'; return; }
      if (!dateVal) { $bmError.textContent = '촬영일을 선택해주세요.'; $bmError.style.display = 'block'; return; }
      // 입력 중인 상품명도 자동 추가
      const pendingProduct = $productName.value.trim();
      if (pendingProduct) addProduct('', pendingProduct);
      const shoot_date = dateVal + ' ' + hourVal + ':' + minVal + ':00';
      const $save = document.getElementById('bm-save');
      $save.disabled = true; $save.textContent = '저장 중...';
      $bmError.style.display = 'none';
      try {
        const body = {
          customer_name: name,
          phone: document.getElementById('bm-phone').value.trim() || undefined,
          consultation_channel: document.getElementById('bm-channel').value || undefined,
          payment_method: document.getElementById('bm-payment').value || undefined,
          shoot_date,
          products: bmSelectedProducts.length > 0 ? bmSelectedProducts : undefined,
          payment_amount: parseMoney(document.getElementById('bm-amount').value) || undefined,
          payment_deposit: parseMoney(document.getElementById('bm-deposit').value) || undefined,
          request_note: document.getElementById('bm-note').value.trim() || undefined,
        };
        const res = await api('POST', '/api/bookings/manual', body);
        if (!res.success) throw new Error(res.error || '저장 실패');
        alert('예약이 저장되었습니다.\\n확정문자가 채팅창에 추가되었습니다.');
        closeBookingModal();
        pollOnce();
      } catch(e) {
        $bmError.textContent = e.message || '저장 중 오류가 발생했습니다.';
        $bmError.style.display = 'block';
      } finally {
        $save.disabled = false; $save.textContent = '저장';
      }
    });
    document.getElementById('sm-email').addEventListener('click', async () => {
      closeShortcutMenu();
      // 임시 카드 추가
      const tempId = 'email-check-' + Date.now();
      const tempEl = document.createElement('div');
      tempEl.id = tempId;
      tempEl.className = 'msg msg-system';
      tempEl.innerHTML = '<details open><summary class="msg-system-summary">📧 새 예약 확인 중...</summary></details>';
      $messages.appendChild(tempEl);
      scrollToBottom();
      try {
        const res = await fetch('/api/chat/trigger-email');
        const data = await res.json();
        const el = document.getElementById(tempId);
        if (el) el.querySelector('summary').textContent = data.ok ? '📧 메일 확인 완료' : '📧 메일 확인 실패: ' + (data.error || '');
      } catch(e) {
        const el = document.getElementById(tempId);
        if (el) el.querySelector('summary').textContent = '📧 메일 확인 실패';
      }
    });
    const $replyBar = document.getElementById('reply-bar');
    const $replyPreview = document.getElementById('reply-preview');
    const $replyCancel = document.getElementById('reply-cancel');
    const $hamburger = document.getElementById('hamburger');

    // ─── 유틸 ─────────────────────────────────────────────
    // 모든 메시지(user/ai/system) 시간 표시는 Asia/Seoul로 통일 (MM/DD HH:mm)
    // SQLite datetime('now') 형식("YYYY-MM-DD HH:MM:SS")은 UTC인데 Z가 없어
    // 브라우저마다 로컬 해석할 수 있음 → 명시적으로 UTC(Z) 부여 후 파싱.
    function formatTime(iso) {
      if (!iso) return '';
      const s = String(iso);
      const normalized = s.includes('T') ? s : s.replace(' ', 'T') + 'Z';
      const d = new Date(normalized);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }

    function el(tag, attrs, ...children) {
      const e = document.createElement(tag);
      if (attrs) {
        for (const k in attrs) {
          if (k === 'class') e.className = attrs[k];
          else if (k === 'dataset') Object.assign(e.dataset, attrs[k]);
          else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
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

    function showToast(text, ms) {
      const t = el('div', { class: 'toast' }, text);
      document.body.appendChild(t);
      setTimeout(() => t.remove(), ms || 2500);
    }

    async function api(method, path, body) {
      const opts = { method, headers: {} };
      if (body != null) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      const res = await fetch(path, opts);
      if (!res.ok) {
        let errMsg = res.status + ' ' + res.statusText;
        try { const j = await res.json(); if (j.error) errMsg = j.error; } catch(_) {}
        const err = new Error(errMsg);
        err.status = res.status;
        throw err;
      }
      return res.json();
    }

    // ─── 렌더링 ──────────────────────────────────────────
    function renderQuote(reply) {
      if (!reply) return null;
      const senderLabel = reply.sender === 'ai' ? 'AI' :
                          reply.sender === 'system' ? '시스템' : '작가님';
      const q = el('div', {
        class: 'msg-quote',
        dataset: { target: String(reply.id) },
        onclick: () => scrollToMessage(reply.id),
      });
      q.appendChild(el('span', { class: 'q-sender' }, '↩ ' + senderLabel));
      q.appendChild(el('span', { class: 'q-text' }, reply.message));
      return q;
    }

    function renderActions(m) {
      const buttons = m.metadata && Array.isArray(m.metadata.buttons) ? m.metadata.buttons : null;
      if (!buttons || buttons.length === 0) return null;
      const wrap = el('div', { class: 'msg-actions' });
      buttons.forEach((b) => {
        if (!b || typeof b.label !== 'string' || typeof b.value !== 'string') return;
        const btn = el('button', {
          class: 'action-btn',
          type: 'button',
          dataset: { msgId: String(m.id) },
          onclick: () => {
            if (state.busy) return;
            state.replyTo = { id: m.id, sender: m.sender, message: m.message };
            updateReplyBar();
            sendMessage(b.value);
          },
        }, b.label);
        wrap.appendChild(btn);
      });
      return wrap.children.length > 0 ? wrap : null;
    }

    function renderSystemMessage(m) {
      // metadata.icon이 명시될 때만 sys-icon 표시 — 본문 첫 이모지와 중복 방지
      const icon = (m.metadata && m.metadata.icon) || '';
      const time = formatTime(m.created_at);
      const root = el('div', {
        class: 'msg-row system',
        dataset: { id: String(m.id) },
      });

      const details = el('details', { class: 'msg-system' });
      const isSendMessage = m.metadata && m.metadata.type === 'drive_send_message';
      const summary = el('summary', isSendMessage ? { class: 'send-message-summary' } : null);

      // drive_send_message: 📝 헤더 + 플레이스홀더 경고 + 본문 (펼침 불필요한 구조)
      if (isSendMessage) {
        const sendType = m.metadata.send_type === 'retouched' ? '보정본' : '원본';
        summary.appendChild(
          el('div', { class: 'send-message-header' }, '📝 ' + sendType + ' 발송 문구'),
        );
        if (m.metadata.has_placeholders) {
          summary.appendChild(
            el(
              'div',
              { class: 'send-message-warning' },
              '⚠️ 일부 정보를 찾을 수 없어 플레이스홀더로 표시했습니다. 수정 후 발송하세요.',
            ),
          );
        }
        summary.appendChild(el('div', {
          class: 'send-message-body',
          style: 'white-space: pre-wrap; word-break: break-word;',
        }, m.message));
      } else {
        if (icon) summary.appendChild(el('span', { class: 'sys-icon' }, icon));
        summary.appendChild(el('span', { class: 'sys-content' }, m.message));
      }
      details.appendChild(summary);

      // confirmation 버튼/결과 렌더링
      const confirmation =
        m.metadata && m.metadata.processing && m.metadata.processing.confirmation;
      if (confirmation && Array.isArray(confirmation.buttons) && confirmation.buttons.length > 0) {
        const responded = m.metadata.processing.responded;
        if (!responded) {
          const buttonRow = el('div', { class: 'confirm-buttons' });
          confirmation.buttons.forEach((btn) => {
            if (!btn || typeof btn.label !== 'string' || typeof btn.value !== 'string') return;
            const button = el('button', {
              type: 'button',
              dataset: { action: confirmation.action_id, value: btn.value },
              onclick: () => handleConfirm(m.id, confirmation.action_id, btn.value, details),
            }, btn.label);
            buttonRow.appendChild(button);
          });
          details.appendChild(buttonRow);
        } else {
          const cls = responded === 'yes' ? 'success' : 'cancel';
          const text = responded === 'yes' ? '✅ 처리 완료' : '❌ 취소됨';
          details.appendChild(el('div', { class: 'confirm-result ' + cls }, text));
        }
      }

      if (m.metadata) {
        const meta = el('div', { class: 'sys-meta' }, JSON.stringify(m.metadata, null, 2));
        details.appendChild(meta);
      }

      // 카드 컨테이너 — details + 카드 안쪽 푸터(시간/복사)를 함께 감싼다
      const card = el('div', { class: 'msg-system-card' });
      card.appendChild(details);
      const footer = el('div', { class: 'msg-system-footer' });
      footer.appendChild(el('span', { class: 'time-text' }, time));
      const copyBtn = el('button', {
        type: 'button',
        class: 'copy-btn',
        title: '메시지 복사',
        'aria-label': '메시지 복사',
        onclick: (e) => {
          e.stopPropagation();
          e.preventDefault();
          handleCopy(m.message, copyBtn);
        },
      }, '📋');
      footer.appendChild(copyBtn);
      card.appendChild(footer);
      root.appendChild(card);

      // 🛍️ 현장 추가 상품 카드: 카드 바깥에 [✅ 추가] [❌ 건너뛰기] 버튼
      const mtype = m.metadata && m.metadata.type;
      if (mtype === 'drive_new_products_detected') {
        const row = el('div', { class: 'drive-actions' });
        const yesBtn = el('button', {
          type: 'button',
          class: 'primary',
          onclick: () => {
            if (state.busy) return;
            row.querySelectorAll('button').forEach((b) => (b.disabled = true));
            // AI hallucination 방지: 도구 직접 트리거용 sentinel
            sendMessage('[DRIVE_CONFIRM_ADD]');
          },
        }, '✅ 추가');
        const noBtn = el('button', {
          type: 'button',
          class: 'secondary',
          onclick: () => {
            if (state.busy) return;
            row.querySelectorAll('button').forEach((b) => (b.disabled = true));
            sendMessage('[DRIVE_CONFIRM_SKIP]');
          },
        }, '❌ 건너뛰기');
        row.appendChild(yesBtn);
        row.appendChild(noBtn);
        root.appendChild(row);
      } else if (mtype === 'drive_new_products_used') {
        const done = el('div', { class: 'drive-actions-done' }, '처리완료');
        root.appendChild(done);
      } else if (mtype === 'revision_confirm_pending') {
        const row = el('div', { class: 'drive-actions' });
        const yesBtn = el('button', {
          type: 'button',
          class: 'primary',
          onclick: () => {
            if (state.busy) return;
            row.querySelectorAll('button').forEach((b) => (b.disabled = true));
            sendMessage('[REVISION_CONFIRM_YES]');
          },
        }, '✅ 네, 기록할게요');
        const noBtn = el('button', {
          type: 'button',
          class: 'secondary',
          onclick: () => {
            if (state.busy) return;
            row.querySelectorAll('button').forEach((b) => (b.disabled = true));
            sendMessage('[REVISION_CONFIRM_NO]');
          },
        }, '❌ 아니오');
        row.appendChild(yesBtn);
        row.appendChild(noBtn);
        root.appendChild(row);
      } else if (mtype === 'revision_confirm_used') {
        const done = el('div', { class: 'drive-actions-done' }, '처리완료');
        root.appendChild(done);
      } else if (mtype === 'name_update_pending') {
        const row = el('div', { class: 'drive-actions' });
        const yesBtn = el('button', {
          type: 'button',
          class: 'primary',
          onclick: () => {
            if (state.busy) return;
            row.querySelectorAll('button').forEach((b) => (b.disabled = true));
            sendMessage('[NAME_UPDATE_YES]');
          },
        }, '✅ 변경');
        const noBtn = el('button', {
          type: 'button',
          class: 'secondary',
          onclick: () => {
            if (state.busy) return;
            row.querySelectorAll('button').forEach((b) => (b.disabled = true));
            sendMessage('[NAME_UPDATE_NO]');
          },
        }, '❌ 취소');
        row.appendChild(yesBtn);
        row.appendChild(noBtn);
        root.appendChild(row);
      } else if (mtype === 'name_update_used') {
        const done = el('div', { class: 'drive-actions-done' }, '처리완료');
        root.appendChild(done);
      } else if (mtype === 'frame_sent_pending') {
        const candidates = (m.metadata && Array.isArray(m.metadata.candidates)) ? m.metadata.candidates : [];
        if (candidates.length > 0) {
          const row = el('div', { class: 'drive-actions' });
          candidates.slice(0, 5).forEach((c) => {
            const btn = el('button', {
              type: 'button',
              class: 'secondary',
              onclick: () => {
                if (state.busy) return;
                row.querySelectorAll('button').forEach((b) => (b.disabled = true));
                sendMessage('[FRAME_SENT_SELECT_' + c.index + ']');
              },
            }, c.index + '번');
            row.appendChild(btn);
          });
          root.appendChild(row);
        }
      } else if (mtype === 'frame_sent_used' || mtype === 'frame_sent_expired') {
        const done = el('div', { class: 'drive-actions-done' }, '처리완료');
        root.appendChild(done);
      } else if (mtype === 'link_confirm_pending') {
        const row = el('div', { class: 'drive-actions' });
        const yesBtn = el('button', {
          type: 'button',
          class: 'primary',
          onclick: () => {
            if (state.busy) return;
            row.querySelectorAll('button').forEach((b) => (b.disabled = true));
            sendMessage('[LINK_CONFIRM_YES]');
          },
        }, '✅ 덮어쓰기');
        const noBtn = el('button', {
          type: 'button',
          class: 'secondary',
          onclick: () => {
            if (state.busy) return;
            row.querySelectorAll('button').forEach((b) => (b.disabled = true));
            sendMessage('[LINK_CONFIRM_NO]');
          },
        }, '❌ 취소');
        row.appendChild(yesBtn);
        row.appendChild(noBtn);
        root.appendChild(row);
      } else if (mtype === 'link_confirm_used' || mtype === 'link_confirm_expired') {
        const done = el('div', { class: 'drive-actions-done' }, '처리완료');
        root.appendChild(done);
      } else if (mtype === 'link_candidates') {
        const candidates = (m.metadata && Array.isArray(m.metadata.candidates)) ? m.metadata.candidates : [];
        if (candidates.length > 0) {
          const row = el('div', { class: 'drive-actions' });
          candidates.slice(0, 5).forEach((c) => {
            const label = c.index + '번: ' + (c.customer_name || '') + (c.shoot_date ? ' (' + c.shoot_date + ')' : '');
            const btn = el('button', {
              type: 'button',
              class: 'secondary',
              onclick: () => {
                if (state.busy) return;
                row.querySelectorAll('button').forEach((b) => (b.disabled = true));
                sendMessage('[LINK_SELECT_' + c.index + ']');
              },
            }, label);
            row.appendChild(btn);
          });
          root.appendChild(row);
        }
      } else if (mtype === 'link_candidates_used') {
        const done = el('div', { class: 'drive-actions-done' }, '처리완료');
        root.appendChild(done);
      }

      return root;
    }

    async function handleCopy(text, btn) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          // fallback (HTTP/구형 브라우저)
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        btn.textContent = '✓';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = '📋';
          btn.classList.remove('copied');
        }, 2000);
      } catch (err) {
        console.error('[chat] 복사 실패:', err);
        showToast('복사 실패');
      }
    }

    async function handleConfirm(messageId, actionId, value, detailsEl) {
      const buttonRow = detailsEl.querySelector('.confirm-buttons');
      const buttons = buttonRow ? buttonRow.querySelectorAll('button') : [];
      buttons.forEach((b) => (b.disabled = true));

      try {
        const res = await api('POST', '/api/chat/confirm', {
          message_id: messageId,
          action_id: actionId,
          value,
        });
        // 부분 DOM 갱신: 버튼 제거 + 결과 박스 삽입
        if (buttonRow) buttonRow.remove();
        const cls = value === 'yes' ? 'success' : 'cancel';
        const text = value === 'yes' ? '✅ 처리 완료' : '❌ 취소됨';
        const resultBox = el('div', { class: 'confirm-result ' + cls }, text);
        const meta = detailsEl.querySelector('.sys-meta');
        if (meta) detailsEl.insertBefore(resultBox, meta);
        else detailsEl.appendChild(resultBox);
        // 후속 ai 메시지 가져오기
        await pollOnce();
        scrollToBottom();
        return res;
      } catch (e) {
        if (e && e.status === 401) {
          location.href = '/login';
          return;
        }
        const reason = e && e.message ? e.message : String(e);
        showToast('처리 실패: ' + reason);
        buttons.forEach((b) => (b.disabled = false));
      }
    }

    // Drive 확정 버튼 sentinel — user 메시지로 저장되지만 UI에는 친숙한 텍스트로 표시
    const SENTINEL_DISPLAY = {
      '[DRIVE_CONFIRM_ADD]': '✅ 추가',
      '[DRIVE_CONFIRM_SKIP]': '❌ 건너뛰기',
      '[REVISION_CONFIRM_YES]': '네',
      '[REVISION_CONFIRM_NO]': '아니오',
      '[NAME_UPDATE_YES]': '변경',
      '[NAME_UPDATE_NO]': '취소',
      '[FRAME_SENT_SELECT_1]': '1번',
      '[FRAME_SENT_SELECT_2]': '2번',
      '[FRAME_SENT_SELECT_3]': '3번',
      '[FRAME_SENT_SELECT_4]': '4번',
      '[FRAME_SENT_SELECT_5]': '5번',
      '[LINK_CONFIRM_YES]': '✅ 덮어쓰기',
      '[LINK_CONFIRM_NO]': '❌ 취소',
      '[LINK_SELECT_1]': '1번',
      '[LINK_SELECT_2]': '2번',
      '[LINK_SELECT_3]': '3번',
      '[LINK_SELECT_4]': '4번',
      '[LINK_SELECT_5]': '5번',
    };

    function renderUserAiMessage(m) {
      const cls = m.sender === 'user' ? 'user' : 'ai';
      const row = el('div', {
        class: 'msg-row ' + cls,
        dataset: { id: String(m.id) },
      });
      const quote = renderQuote(m.reply_to);
      if (quote) row.appendChild(quote);
      const displayText =
        m.sender === 'user' && SENTINEL_DISPLAY[m.message]
          ? SENTINEL_DISPLAY[m.message]
          : m.message;
      const bubble = el('div', { class: 'msg-bubble' }, displayText);
      attachContextHandlers(bubble, m);
      row.appendChild(bubble);
      const actions = renderActions(m);
      if (actions) row.appendChild(actions);
      row.appendChild(el('div', { class: 'msg-time' }, formatTime(m.created_at)));
      return row;
    }

    function renderMessage(m) {
      if (m.sender === 'system') return renderSystemMessage(m);
      return renderUserAiMessage(m);
    }

    function appendMessage(m) {
      if (state.seenIds.has(m.id)) return;
      state.seenIds.add(m.id);
      state.messages.push(m);
      $messages.appendChild(renderMessage(m));
    }

    function appendOptimistic(text, replyTo) {
      const tempId = -Date.now();
      const m = {
        id: tempId,
        sender: 'user',
        message: text,
        reply_to_id: replyTo ? replyTo.id : null,
        reply_to: replyTo || null,
        metadata: null,
        created_at: new Date().toISOString(),
      };
      appendMessage(m);
      scrollToBottom();
      return tempId;
    }

    function replaceOptimistic(tempId, real) {
      const idx = state.messages.findIndex((x) => x.id === tempId);
      if (idx >= 0) state.messages[idx] = real;
      state.seenIds.delete(tempId);
      state.seenIds.add(real.id);
      const oldEl = $messages.querySelector('[data-id="' + tempId + '"]');
      if (oldEl) oldEl.replaceWith(renderMessage(real));
    }

    function showTyping() {
      hideTyping();
      const t = el('div', { class: 'typing' },
        'AI 입력 중',
        el('span', { class: 'dots' }));
      $messages.appendChild(t);
      state.typingEl = t;
      scrollToBottom();
    }
    function hideTyping() {
      if (state.typingEl) { state.typingEl.remove(); state.typingEl = null; }
    }

    function scrollToBottom() {
      requestAnimationFrame(() => {
        $messages.scrollTop = $messages.scrollHeight;
      });
    }
    function scrollToMessage(id) {
      const target = $messages.querySelector('[data-id="' + id + '"]');
      if (!target) {
        showToast('원본 메시지가 현재 화면에 없습니다');
        return;
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const bubble = target.querySelector('.msg-bubble') || target;
      bubble.classList.remove('flash');
      void bubble.offsetWidth;
      bubble.classList.add('flash');
    }

    // ─── 답장 바 ────────────────────────────────────────
    function updateReplyBar() {
      if (state.replyTo) {
        const senderLabel = state.replyTo.sender === 'ai' ? 'AI' :
                            state.replyTo.sender === 'system' ? '시스템' : '작가님';
        $replyPreview.textContent = senderLabel + ': ' + state.replyTo.message;
        $replyBar.classList.remove('hidden');
      } else {
        $replyBar.classList.add('hidden');
      }
    }
    $replyCancel.addEventListener('click', () => {
      state.replyTo = null;
      updateReplyBar();
    });

    // ─── 컨텍스트 메뉴 (답장) ────────────────────────────
    function closeCtxMenu() {
      if (state.ctxMenu) { state.ctxMenu.remove(); state.ctxMenu = null; }
    }
    function openCtxMenu(x, y, m) {
      closeCtxMenu();
      const menu = el('div', { class: 'ctx-menu' });
      menu.appendChild(el('button', {
        type: 'button',
        onclick: () => {
          state.replyTo = { id: m.id, sender: m.sender, message: m.message };
          updateReplyBar();
          $input.focus();
          closeCtxMenu();
        },
      }, '↩ 답장'));
      menu.style.left = Math.min(x, window.innerWidth - 140) + 'px';
      menu.style.top = Math.min(y, window.innerHeight - 60) + 'px';
      document.body.appendChild(menu);
      state.ctxMenu = menu;
      setTimeout(() => {
        document.addEventListener('click', closeCtxMenu, { once: true });
      }, 0);
    }
    function attachContextHandlers(bubble, m) {
      bubble.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openCtxMenu(e.clientX, e.clientY, m);
      });
      let touchTimer = null;
      bubble.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        touchTimer = setTimeout(() => {
          openCtxMenu(t.clientX, t.clientY, m);
        }, 500);
      }, { passive: true });
      bubble.addEventListener('touchend', () => {
        if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
      });
      bubble.addEventListener('touchmove', () => {
        if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
      });
    }

    // ─── 데이터 로드 ─────────────────────────────────────
    async function loadInitial() {
      try {
        const data = await api('GET', '/api/chat/messages?limit=' + HISTORY_LIMIT);
        const list = (data.messages || []).slice().reverse();
        list.forEach((m) => appendMessage(m));
        state.hasMore = data.hasMore ?? false;
        if (list.length > 0) state.cursor = Math.min(...list.map((m) => m.id));
        scrollToBottom();
      } catch (e) {
        if (e.status === 401) { location.href = '/login'; return; }
        showToast('메시지 로드 실패: ' + e.message);
      }
    }

    async function loadMore() {
      if (state.loadingMore || !state.hasMore || state.cursor === null) return;
      state.loadingMore = true;

      // 로딩 인디케이터
      const indicator = document.createElement('div');
      indicator.id = 'load-more-indicator';
      indicator.style.cssText = 'text-align:center;padding:10px;font-size:13px;color:#888';
      indicator.textContent = '이전 메시지 불러오는 중...';
      $messages.insertBefore(indicator, $messages.firstChild);

      const heightBefore = $messages.scrollHeight;

      try {
        const data = await api('GET', '/api/chat/messages?limit=20&before=' + state.cursor);
        const list = (data.messages || []).slice().reverse();
        const newOnes = list.filter((m) => !state.seenIds.has(m.id));

        indicator.remove();

        if (newOnes.length > 0) {
          // prepend: 기존 첫 메시지 앞에 삽입
          const fragment = document.createDocumentFragment();
          newOnes.forEach((m) => {
            state.seenIds.add(m.id);
            state.messages.unshift(m);
            fragment.appendChild(renderMessage(m));
          });
          $messages.insertBefore(fragment, $messages.firstChild);
          // 스크롤 보정 (prepend로 인한 점프 방지)
          $messages.scrollTop += $messages.scrollHeight - heightBefore;
          state.cursor = Math.min(...newOnes.map((m) => m.id));
        }

        state.hasMore = data.hasMore ?? false;
        if (!state.hasMore) {
          const done = document.createElement('div');
          done.style.cssText = 'text-align:center;padding:10px;font-size:13px;color:#888';
          done.textContent = '모든 메시지를 불러왔습니다';
          $messages.insertBefore(done, $messages.firstChild);
          setTimeout(() => done.remove(), 2000);
        }
      } catch (e) {
        indicator.remove();
        if (e.status === 401) { location.href = '/login'; return; }
      } finally {
        state.loadingMore = false;
      }
    }

    async function pollOnce() {
      if (state.busy) return;
      try {
        const data = await api('GET', '/api/chat/messages?limit=20');
        const list = (data.messages || []).slice().reverse();
        const newOnes = list.filter((m) => !state.seenIds.has(m.id));
        if (newOnes.length === 0) return;
        const wasNearBottom = $messages.scrollTop + $messages.clientHeight >= $messages.scrollHeight - 100;
        newOnes.forEach((m) => appendMessage(m));
        if (wasNearBottom) scrollToBottom();
      } catch (e) {
        if (e.status === 401) { location.href = '/login'; return; }
      }
    }

    // ─── 전송 ────────────────────────────────────────────
    async function sendMessage(text) {
      const trimmed = (text || '').trim();
      if (!trimmed || state.busy) return;
      state.busy = true;
      $send.disabled = true;

      const replyTo = state.replyTo;
      const tempId = appendOptimistic(trimmed, replyTo);

      try {
        const sent = await api('POST', '/api/chat/send', {
          message: trimmed,
          reply_to_id: replyTo ? replyTo.id : undefined,
        });
        const realUser = {
          id: sent.id,
          sender: 'user',
          message: trimmed,
          reply_to_id: replyTo ? replyTo.id : null,
          reply_to: replyTo || null,
          metadata: null,
          created_at: sent.created_at,
        };
        replaceOptimistic(tempId, realUser);

        state.replyTo = null;
        updateReplyBar();

        showTyping();
        const aiMsg = await api('POST', '/api/chat/ai-process', {
          user_message_id: sent.id,
        });
        hideTyping();
        appendMessage(aiMsg);
        scrollToBottom();
      } catch (e) {
        hideTyping();
        if (e.status === 401) { location.href = '/login'; return; }
        if (e.status === 429) {
          showToast('AI 호출 한도 초과 — 내일 다시 시도해주세요');
        } else {
          showToast('전송 실패: ' + e.message);
        }
      } finally {
        state.busy = false;
        $send.disabled = false;
        $input.focus();
      }
    }

    // ─── 입력 영역 ───────────────────────────────────────
    function autoGrow() {
      $input.style.height = 'auto';
      $input.style.height = Math.min($input.scrollHeight, 120) + 'px';
    }
    $input.addEventListener('input', autoGrow);
    $input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        const text = $input.value;
        $input.value = '';
        autoGrow();
        sendMessage(text);
      }
    });
    $form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = $input.value;
      $input.value = '';
      autoGrow();
      sendMessage(text);
    });

    // ─── 사이드바 ────────────────────────────────────────
    function buildNotifItem(onActivate) {
      const supported =
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        typeof Notification !== 'undefined';

      if (!supported) {
        const item = el('a', { href: '#', class: 'disabled' }, '🚫 알림 미지원 브라우저');
        item.addEventListener('click', (e) => e.preventDefault());
        return item;
      }

      const perm = Notification.permission;
      if (perm === 'granted') {
        const item = el('a', { href: '#', class: 'disabled' }, '✅ 알림 활성화됨');
        item.addEventListener('click', (e) => e.preventDefault());
        return item;
      }
      if (perm === 'denied') {
        const item = el('a', { href: '#', class: 'disabled' }, '🔕 알림 거부됨 (설정에서 변경)');
        item.addEventListener('click', (e) => e.preventDefault());
        return item;
      }
      // default
      return el('button', {
        class: 'nav-item',
        type: 'button',
        onclick: onActivate,
      }, '🔔 알림 활성화');
    }

    $hamburger.addEventListener('click', () => {
      const overlay = el('div', {
        class: 'sidebar-overlay',
        onclick: () => { overlay.remove(); sidebar.remove(); },
      });
      const sidebar = el('aside', { class: 'sidebar' });
      sidebar.addEventListener('click', (e) => e.stopPropagation());
      sidebar.appendChild(el('h2', null, '메뉴'));
      const nav = el('nav');
      const linkChat = el('a', { href: '/chat', class: 'active' }, '💬 채팅');
      const linkDash = el('a', { href: '/dashboard' }, '📊 대시보드');
      const linkRules = el('a', { href: '/rules' }, '📋 학습 규칙');
      const linkReport = el('a', { href: '/report' }, '📈 리포트');

      let notifItem;
      const onActivate = async (ev) => {
        if (notifItem.disabled) return;
        notifItem.disabled = true;
        notifItem.textContent = '⏳ 권한 요청 중...';
        try {
          const ok = await requestPushPermissionAndSubscribe();
          const replacement = buildNotifItem(onActivate);
          notifItem.replaceWith(replacement);
          notifItem = replacement;
          if (ok) showToast('알림이 활성화되었습니다');
          else if (Notification.permission === 'denied') {
            showToast('알림이 거부되었습니다 — 설정에서 다시 허용할 수 있습니다');
          } else {
            showToast('알림 활성화에 실패했습니다');
          }
        } catch (e) {
          notifItem.disabled = false;
          notifItem.textContent = '🔔 알림 활성화';
          showToast('오류: ' + (e && e.message ? e.message : e));
        }
      };
      notifItem = buildNotifItem(onActivate);

      const logoutBtn = el('button', {
        class: 'nav-item',
        type: 'button',
        onclick: async () => {
          try {
            await fetch('/auth/logout', { method: 'POST' });
          } catch(_) {}
          location.href = '/login';
        },
      }, '🚪 로그아웃');
      nav.appendChild(linkChat);
      nav.appendChild(linkDash);
      nav.appendChild(linkRules);
      nav.appendChild(linkReport);
      nav.appendChild(notifItem);
      nav.appendChild(logoutBtn);
      sidebar.appendChild(nav);
      sidebar.appendChild(el('div', { class: 'user-email' }, USER_EMAIL));
      document.body.appendChild(overlay);
      document.body.appendChild(sidebar);
    });

    // ─── 폴링 ────────────────────────────────────────────
    function startPolling() {
      stopPolling();
      state.polling = setInterval(pollOnce, POLL_INTERVAL_MS);
    }
    function stopPolling() {
      if (state.polling) { clearInterval(state.polling); state.polling = null; }
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopPolling();
      else { pollOnce(); startPolling(); }
    });

    // ─── 푸시 알림 (PWA) ─────────────────────────────────
    function urlB64ToUint8Array(b64) {
      const padding = '='.repeat((4 - b64.length % 4) % 4);
      const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
      const raw = atob(base64);
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    }

    // SW만 자동 등록 (권한 요청은 사용자 클릭 시 호출)
    async function registerServiceWorker() {
      try {
        if (!('serviceWorker' in navigator)) {
          console.log('[push] SW 미지원');
          return null;
        }
        const reg = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        console.log('[push] SW 등록 완료');
        return reg;
      } catch (e) {
        console.log('[push] SW 등록 실패:', e && e.message);
        return null;
      }
    }

    // 사용자 클릭 직후 호출 — iOS는 인터랙션 컨텍스트에서만 prompt 허용
    async function requestPushPermissionAndSubscribe() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
        console.log('[push] 미지원 환경');
        return false;
      }
      try {
        const reg = (await navigator.serviceWorker.getRegistration('/'))
          || (await navigator.serviceWorker.register('/sw.js'));
        await navigator.serviceWorker.ready;

        if (Notification.permission === 'default') {
          // 사용자 인터랙션 직후 — 즉시 await
          const result = await Notification.requestPermission();
          if (result !== 'granted') {
            console.log('[push] 권한 미허용:', result);
            return false;
          }
        } else if (Notification.permission !== 'granted') {
          return false;
        }

        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          const r = await api('GET', '/api/push/vapid-public-key');
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlB64ToUint8Array(r.key),
          });
        }

        await api('POST', '/api/push/subscribe', sub.toJSON());
        console.log('[push] 구독 완료');
        return true;
      } catch (e) {
        console.log('[push] 구독 실패:', e && e.message);
        throw e;
      }
    }

    // SW에서 navigate 메시지 수신 → 메시지로 스크롤
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'navigate' && e.data.data) {
          const id = e.data.data.chat_message_id;
          if (id) setTimeout(() => scrollToMessage(id), 300);
        }
      });
    }

    // ─── 무한 스크롤 ─────────────────────────────────────
    $messages.addEventListener('scroll', () => {
      if ($messages.scrollTop < 100 && state.hasMore && !state.loadingMore && state.cursor !== null) loadMore();
    });

    // ─── 시작 ────────────────────────────────────────────
    loadInitial().then(() => {
      startPolling();
      $input.focus();
      // SW만 자동 등록 (권한 prompt는 사이드바 버튼 클릭 시)
      registerServiceWorker();
    });
  })();
  </script>
</body>
</html>`;
}
