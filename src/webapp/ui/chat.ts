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
    .confirm-banner {
      background: #fef3c7;
      border-bottom: 2px solid #f59e0b;
      padding: 8px 14px;
      font-size: 13px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      color: #92400e;
      font-weight: 500;
    }
    .confirm-banner.hidden { display: none; }
    .confirm-banner-list {
      background: #fffbeb;
      border-bottom: 1px solid #fcd34d;
      padding: 0 14px 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 40vh;
      overflow-y: auto;
    }
    .confirm-banner-list.hidden { display: none; }
    .confirm-banner-item {
      font-size: 12px;
      color: #78350f;
      padding: 4px 0;
      border-bottom: 1px solid #fde68a;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .confirm-banner-item:last-child { border-bottom: none; }
    .confirm-banner-item-text {
      flex: 1;
      cursor: pointer;
    }
    .confirm-banner-item-text:hover { color: #451a03; }
    .confirm-banner-skip {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 13px;
      color: #b45309;
      padding: 0 2px;
      line-height: 1;
      opacity: 0.6;
      flex-shrink: 0;
    }
    .confirm-banner-skip:hover { opacity: 1; }
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
    .modal-talk-dropdown { max-height: 220px; }
    .modal-talk-section { padding: 6px 12px 2px; font-size: 11px; font-weight: 600; color: #aaa; text-transform: uppercase; letter-spacing: 0.05em; }
    .modal-talk-item { padding: 8px 12px; cursor: pointer; font-size: 13px; border-top: 1px solid var(--border); }
    .modal-talk-item:hover { background: var(--bg-soft); }
    .modal-talk-item-main { font-weight: 500; }
    .modal-talk-item-sub { font-size: 11px; color: #888; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .modal-talk-selected { font-size: 12px; color: var(--accent); margin-top: 4px; padding: 4px 8px; background: var(--bg-soft); border-radius: 6px; display: flex; align-items: center; justify-content: space-between; }
    .modal-talk-clear { cursor: pointer; font-size: 14px; color: #aaa; padding: 0 2px; }

    /* ─── 사진 말풍선 ─── */
    .photo-grid {
      display: grid;
      gap: 3px;
      border-radius: 12px;
      overflow: hidden;
      max-width: 280px;
      cursor: pointer;
    }
    .photo-grid.count-1 { grid-template-columns: 1fr; max-width: 260px; }
    .photo-grid.count-2 { grid-template-columns: 1fr 1fr; }
    .photo-grid.count-3 { grid-template-columns: 1fr 1fr; }
    .photo-grid.count-3 .photo-thumb:first-child { grid-column: span 2; }
    .photo-grid.count-4 { grid-template-columns: 1fr 1fr; }
    .photo-grid.count-many { grid-template-columns: 1fr 1fr 1fr; }
    .photo-thumb {
      aspect-ratio: 1;
      overflow: hidden;
      background: #ddd;
      position: relative;
    }
    .photo-thumb img {
      width: 100%; height: 100%;
      object-fit: cover;
      display: block;
    }
    .photo-thumb .photo-more {
      position: absolute; inset: 0;
      background: rgba(0,0,0,0.45);
      color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 600;
    }
    .photo-group-badge {
      font-size: 11px;
      color: var(--fg-muted);
      margin-bottom: 3px;
      padding: 0 4px;
    }
    .photo-caption-btn {
      font-size: 12px;
      color: var(--accent);
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px 4px;
      margin-top: 4px;
      text-align: left;
    }
    /* 업로드 진행 표시 */
    .upload-progress {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      background: var(--ai-bg);
      border-radius: 12px;
      font-size: 13px;
      color: var(--fg-muted);
      max-width: 80%;
    }
    .upload-progress-bar {
      width: 100px;
      height: 4px;
      background: var(--border);
      border-radius: 2px;
      overflow: hidden;
    }
    .upload-progress-fill {
      height: 100%;
      background: var(--accent);
      transition: width 0.2s;
    }
    /* 채팅창 드래그오버 */
    .msg-list.drag-over {
      outline: 2px dashed var(--accent);
      outline-offset: -4px;
    }
    .photo-thumb[draggable="true"] { cursor: grab; }
    .photo-thumb[draggable="true"]:active { cursor: grabbing; }
    .photo-thumb.drop-target { outline: 3px solid var(--accent); border-radius: 4px; }

    /* ─── 사진 미리보기 (라이트박스) ─── */
    .photo-viewer {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.96);
      z-index: 300;
      display: flex;
      flex-direction: column;
      touch-action: none;
    }
    .pv-header {
      position: absolute;
      top: 0; left: 0; right: 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 16px;
      z-index: 1;
    }
    .pv-close {
      background: rgba(255,255,255,0.12);
      border: none;
      color: white;
      font-size: 20px;
      width: 36px; height: 36px;
      border-radius: 50%;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
    }
    .pv-counter {
      color: rgba(255,255,255,0.65);
      font-size: 14px;
    }
    .pv-main {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow: hidden;
      cursor: zoom-out;
    }
    .pv-img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      pointer-events: none;
      user-select: none;
      -webkit-user-drag: none;
    }
    .pv-nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(255,255,255,0.15);
      border: none;
      color: white;
      font-size: 26px;
      width: 44px; height: 44px;
      border-radius: 50%;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s;
    }
    .pv-nav:hover { background: rgba(255,255,255,0.28); }
    .pv-nav.pv-prev { left: 12px; }
    .pv-nav.pv-next { right: 12px; }
    .pv-strip-wrap {
      flex-shrink: 0;
      background: rgba(0,0,0,0.6);
      padding: 8px 10px;
    }
    .pv-strip {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .pv-strip::-webkit-scrollbar { display: none; }
    .pv-strip-thumb {
      width: 58px; height: 58px;
      flex-shrink: 0;
      border-radius: 4px;
      overflow: hidden;
      cursor: pointer;
      opacity: 0.5;
      border: 2px solid transparent;
      transition: opacity 0.15s, border-color 0.15s;
    }
    .pv-strip-thumb.active { opacity: 1; border-color: #fff; }
    .pv-strip-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .pv-info {
      position: absolute;
      bottom: 0; left: 0; right: 0;
      background: linear-gradient(transparent, rgba(0,0,0,0.65));
      padding: 28px 14px 10px;
      pointer-events: none;
    }
    .pv-filename {
      color: rgba(255,255,255,0.9);
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 2px;
    }
    .pv-datetime {
      color: rgba(255,255,255,0.55);
      font-size: 11px;
    }

    /* ─── 업로드 오버레이 (스크롤 위치 유지용 고정 표시바) ─── */
    .upload-overlay {
      position: fixed;
      bottom: 76px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--ai-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px 16px;
      font-size: 13px;
      color: var(--fg-muted);
      display: flex;
      align-items: center;
      gap: 10px;
      z-index: 90;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      white-space: nowrap;
    }

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
    <h1 onclick="location.reload()" style="cursor:pointer">MAUM</h1>
    <button id="bell" aria-label="알림">
      🔔<span id="badge" class="badge hidden">0</span>
    </button>
  </header>

  <div id="confirm-banner" class="confirm-banner hidden"></div>
  <div id="confirm-banner-list" class="confirm-banner-list hidden"></div>

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
        <label>톡톡 연결 <span style="font-weight:400;color:#888;font-size:12px">(선택사항 — 이름·전화번호·대화내용 검색)</span></label>
        <div class="modal-autocomplete-wrap">
          <input type="text" id="bm-talk-search" placeholder="예: 홍길동 / 010-1234 / 색감 얘기한 분" autocomplete="off">
          <div id="bm-talk-dropdown" class="modal-autocomplete-dropdown modal-talk-dropdown" style="display:none"></div>
        </div>
        <div id="bm-talk-selected" style="display:none"></div>
      </div>
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

  <input type="file" id="photo-file-input" accept="image/*" multiple style="display:none">

  <form id="composer" class="composer">
    <div class="shortcut-wrap">
      <div id="shortcut-menu" class="shortcut-menu" style="display:none">
        <button type="button" class="shortcut-menu-item" id="sm-photo"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg>사진 업로드</button>
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

    // ─── 사진 업로드 ──────────────────────────────────────────────────────
    const $photoInput = document.getElementById('photo-file-input');

    document.getElementById('sm-photo').addEventListener('click', () => {
      closeShortcutMenu();
      $photoInput.click();
    });

    $photoInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) uploadPhotos(files);
      e.target.value = '';
    });

    // 채팅창 드래그&드롭 + 자동 스크롤
    const DRAG_SCROLL_ZONE = 80;   // 상단/하단 감지 영역 (px)
    const DRAG_SCROLL_SPEED = 12;  // 스크롤 속도 (px/frame)
    let dragScrollRaf = null;

    function startDragScroll(direction) {
      if (dragScrollRaf !== null) return;
      function step() {
        $messages.scrollTop += direction * DRAG_SCROLL_SPEED;
        dragScrollRaf = requestAnimationFrame(step);
      }
      dragScrollRaf = requestAnimationFrame(step);
    }

    function stopDragScroll() {
      if (dragScrollRaf !== null) {
        cancelAnimationFrame(dragScrollRaf);
        dragScrollRaf = null;
      }
    }

    $messages.addEventListener('dragover', (e) => {
      e.preventDefault();
      $messages.classList.add('drag-over');

      const rect = $messages.getBoundingClientRect();
      const y = e.clientY - rect.top;
      if (y < DRAG_SCROLL_ZONE) {
        startDragScroll(-1);
      } else if (y > rect.height - DRAG_SCROLL_ZONE) {
        startDragScroll(1);
      } else {
        stopDragScroll();
      }
    });
    $messages.addEventListener('dragleave', (e) => {
      if (!$messages.contains(e.relatedTarget)) {
        $messages.classList.remove('drag-over');
        stopDragScroll();
      }
    });
    $messages.addEventListener('drop', (e) => {
      e.preventDefault();
      $messages.classList.remove('drag-over');
      stopDragScroll();
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      if (files.length > 0) uploadPhotos(files);
    });

    async function resizeImage(file, maxPx) {
      return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(url);
          const { naturalWidth: w, naturalHeight: h } = img;
          const scale = Math.min(1, maxPx / Math.max(w, h));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => resolve({
            blob, width: canvas.width, height: canvas.height,
          }), 'image/jpeg', 0.85);
        };
        img.src = url;
      });
    }

    async function uploadPhotos(files) {
      if (state.busy) return;
      state.busy = true;
      $send.disabled = true;

      // 진행 표시 엘리먼트
      const progressEl = document.createElement('div');
      progressEl.className = 'upload-progress';
      progressEl.innerHTML =
        '<span id="upload-status">업로드 준비 중...</span>' +
        '<div class="upload-progress-bar"><div class="upload-progress-fill" id="upload-fill" style="width:0%"></div></div>';
      $messages.appendChild(progressEl);
      scrollToBottom();

      const uploadedIds = [];
      let allCandidates = null;
      let hasUnmatched = false;

      const beforeUnloadHandler = (e) => {
        e.preventDefault();
        e.returnValue = '업로드가 진행 중입니다. 정말 나가시겠습니까?';
      };
      window.addEventListener('beforeunload', beforeUnloadHandler);

      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          document.getElementById('upload-status').textContent =
            '업로드 중... ' + (i + 1) + ' / ' + files.length;
          document.getElementById('upload-fill').style.width =
            Math.round((i / files.length) * 100) + '%';

          try {
            const { blob, width, height } = await resizeImage(file, 2000);
            const fd = new FormData();
            fd.append('file', blob, file.name);
            fd.append('width', String(width));
            fd.append('height', String(height));

            const res = await fetch('/api/photos/upload', { method: 'POST', body: fd });
            if (!res.ok) throw new Error('업로드 실패 (' + res.status + ')');
            const data = await res.json();
            uploadedIds.push(data.photo_id);
            if (data.candidates && !allCandidates) allCandidates = data.candidates;
            if (data.match_failed) hasUnmatched = true;
          } catch (e) {
            showToast((i + 1) + '번째 파일 업로드 실패: ' + (e.message || ''));
          }
        }

        if (uploadedIds.length > 0) {
          document.getElementById('upload-status').textContent = '채팅에 등록 중...';
          await api('POST', '/api/photos/batch-message', {
            photo_ids: uploadedIds,
            candidates: allCandidates,
            has_unmatched: hasUnmatched || undefined,
          });
        }
      } finally {
        window.removeEventListener('beforeunload', beforeUnloadHandler);
        progressEl.remove();
        state.busy = false;
        $send.disabled = false;
        if (uploadedIds.length > 0) {
          await pollOnce();
          scrollToBottom();
        }
      }
    }

    // PC에서 드래그된 파일을 기존 사진과 그룹으로 묶어 업로드
    async function uploadPhotosToGroup(files, targetPhotoId, targetGroupId) {
      if (state.busy) return;
      state.busy = true;
      $send.disabled = true;

      // 고정 오버레이로 표시 — $messages에 붙이지 않아 스크롤 위치 유지
      const progressEl = document.createElement('div');
      progressEl.className = 'upload-overlay';
      const statusSpan = document.createElement('span');
      statusSpan.textContent = '업로드 준비 중...';
      const barWrap = document.createElement('div');
      barWrap.className = 'upload-progress-bar';
      const barFill = document.createElement('div');
      barFill.className = 'upload-progress-fill';
      barFill.style.width = '0%';
      barWrap.appendChild(barFill);
      progressEl.appendChild(statusSpan);
      progressEl.appendChild(barWrap);
      document.body.appendChild(progressEl);

      const uploadedIds = [];
      try {
        for (let i = 0; i < files.length; i++) {
          statusSpan.textContent = '업로드 중... ' + (i + 1) + ' / ' + files.length;
          barFill.style.width = Math.round((i / files.length) * 100) + '%';
          try {
            const { blob, width, height } = await resizeImage(files[i], 2000);
            const fd = new FormData();
            fd.append('file', blob, files[i].name);
            fd.append('width', String(width));
            fd.append('height', String(height));
            const res = await fetch('/api/photos/upload', { method: 'POST', body: fd });
            if (!res.ok) throw new Error('업로드 실패 (' + res.status + ')');
            const data = await res.json();
            uploadedIds.push(data.photo_id);
          } catch (e) {
            showToast((i + 1) + '번째 파일 업로드 실패: ' + (e.message || ''));
          }
        }

        if (uploadedIds.length > 0) {
          statusSpan.textContent = '채팅에 등록 중...';
          await api('POST', '/api/photos/batch-message', { photo_ids: uploadedIds });

          // 기존 그룹이 있으면 합류, 없으면 타겟 사진과 새 그룹 생성
          const groupPhotoIds = targetGroupId ? uploadedIds : [targetPhotoId, ...uploadedIds];
          await api('POST', '/api/photos/group', {
            photo_ids: groupPhotoIds,
            target_group_id: targetGroupId || undefined,
          });
          showToast('그룹으로 묶었습니다');
        }
      } finally {
        progressEl.remove();
        if (uploadedIds.length > 0) {
          // busy는 리로드 완료 후 해제 — pollOnce가 중간에 끼어들어 scrollToBottom 호출하지 못하도록 차단
          state.seenIds.clear();
          state.messages = [];
          $messages.innerHTML = '';
          state.cursor = null;
          state.hasMore = true;
          await loadInitial(true);
          state.busy = false;
          $send.disabled = false;
          requestAnimationFrame(() => {
            const t = $messages.querySelector('[data-photo-id="' + targetPhotoId + '"]');
            if (t) t.scrollIntoView({ block: 'center' });
          });
        } else {
          state.busy = false;
          $send.disabled = false;
        }
      }
    }

    // ─── 사진 말풍선 렌더링 ───────────────────────────────────────────────
    // 드래그 상태
    const dragState = { photoId: null, msgId: null, justEnded: false };

    function makePhotoThumb(photoId, msgId, groupId, fileName, createdAt) {
      const thumb = document.createElement('div');
      thumb.className = 'photo-thumb';
      thumb.draggable = true;
      thumb.dataset.photoId = String(photoId);
      if (groupId) thumb.dataset.groupId = groupId;
      if (fileName) thumb.dataset.fileName = fileName;
      if (createdAt) thumb.dataset.createdAt = createdAt;

      const img = document.createElement('img');
      img.src = '/api/photos/thumb/' + photoId;
      img.loading = 'lazy';
      img.alt = '사진';
      img.draggable = false; // 이미지 자체의 기본 드래그 차단
      thumb.appendChild(img);

      thumb.addEventListener('dragstart', (e) => {
        dragState.photoId = photoId;
        dragState.msgId = msgId;
        // setData 필수 — 없으면 Firefox/Chrome에서 드래그 동작 안 함
        e.dataTransfer.setData('text/plain', String(photoId));
        e.dataTransfer.effectAllowed = 'move';
        requestAnimationFrame(() => { thumb.style.opacity = '0.5'; });
      });

      thumb.addEventListener('dragend', () => {
        thumb.style.opacity = '';
        document.querySelectorAll('.photo-thumb.drop-target').forEach((t) => {
          t.classList.remove('drop-target');
        });
        dragState.photoId = null;
        dragState.msgId = null;
        dragState.justEnded = true;
        setTimeout(() => { dragState.justEnded = false; }, 200);
      });

      thumb.addEventListener('click', () => {
        if (dragState.justEnded) return;
        openPhotoViewer(photoId);
      });

      thumb.addEventListener('dragover', (e) => {
        const isExistingPhoto = dragState.photoId !== null && dragState.photoId !== photoId;
        const isFileFromPC = dragState.photoId === null &&
          Array.from(e.dataTransfer.types).includes('Files');
        if (isExistingPhoto || isFileFromPC) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          thumb.classList.add('drop-target');
          stopDragScroll(); // 사진 위에 올라오면 스크롤 멈춤
        }
      });

      thumb.addEventListener('dragleave', (e) => {
        if (!thumb.contains(e.relatedTarget)) {
          thumb.classList.remove('drop-target');
        }
      });

      thumb.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        $messages.classList.remove('drag-over');
        thumb.classList.remove('drop-target');

        // 기존 채팅 사진 → 기존 채팅 사진
        if (dragState.photoId !== null && dragState.photoId !== photoId) {
          const fromId = dragState.photoId;
          try {
            await api('POST', '/api/photos/group', {
              photo_ids: [fromId, photoId],
              target_group_id: groupId || undefined,
            });
            showToast('그룹으로 묶었습니다');
            // pollOnce가 리로드 중간에 끼어들어 scrollToBottom 호출하지 못하도록 차단
            state.busy = true;
            $send.disabled = true;
            state.seenIds.clear();
            state.messages = [];
            $messages.innerHTML = '';
            state.cursor = null;
            state.hasMore = true;
            await loadInitial(true);
            requestAnimationFrame(() => {
              const t = $messages.querySelector('[data-photo-id="' + photoId + '"]');
              if (t) t.scrollIntoView({ block: 'center' });
            });
          } catch (err) {
            showToast('그룹 묶기 실패: ' + (err.message || ''));
          } finally {
            state.busy = false;
            $send.disabled = false;
          }
          return;
        }

        // PC 파일 → 기존 채팅 사진 위에 드롭 → 업로드 후 그룹 묶기
        if (dragState.photoId === null) {
          const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
          if (files.length > 0) await uploadPhotosToGroup(files, photoId, groupId);
        }
      });

      thumb.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPhotoCtxMenu(e.clientX, e.clientY, photoId, groupId);
      });

      return thumb;
    }

    async function reloadMessages() {
      const savedTop = $messages.scrollTop;
      state.busy = true;
      $send.disabled = true;
      state.seenIds.clear(); state.messages = []; $messages.innerHTML = '';
      state.cursor = null; state.hasMore = true;
      await loadInitial(true);
      $messages.scrollTop = savedTop;
      state.busy = false;
      $send.disabled = false;
    }

    // 썸네일 제거 후 grid count 클래스 갱신
    function updateGridCount(grid) {
      if (!grid) return;
      const cnt = grid.querySelectorAll('.photo-thumb').length;
      grid.className = grid.className.replace(/\bcount-\S+/, '').trim();
      if (cnt === 0) {
        grid.style.display = 'none';
      } else {
        const cls = cnt === 1 ? 'count-1' : cnt === 2 ? 'count-2'
          : cnt === 3 ? 'count-3' : cnt === 4 ? 'count-4' : 'count-many';
        grid.classList.add(cls);
      }
    }

    // 사진이 모두 없어진 메시지 행 숨김
    function checkMsgRowEmpty(row) {
      if (!row) return;
      if (row.querySelectorAll('.photo-thumb').length === 0) row.style.display = 'none';
    }

    // DOM에서 썸네일 즉시 제거, API는 백그라운드 — 실패 시 재로드
    function removePhotoFromDom(photoId) {
      const thumb = $messages.querySelector('[data-photo-id="' + photoId + '"]');
      if (!thumb) return;
      const grid = thumb.closest('.photo-grid');
      const row  = thumb.closest('.msg-row');
      thumb.remove();
      updateGridCount(grid);
      checkMsgRowEmpty(row);
      // pvState에서도 제거
      pvState.photos = pvState.photos.filter((p) => p.photoId !== photoId);
    }

    function removeGroupFromDom(groupId) {
      const thumbs = $messages.querySelectorAll('[data-group-id="' + groupId + '"]');
      const grids = new Set();
      const rows  = new Set();
      thumbs.forEach((t) => {
        grids.add(t.closest('.photo-grid'));
        rows.add(t.closest('.msg-row'));
        pvState.photos = pvState.photos.filter((p) => p.photoId !== parseInt(t.dataset.photoId));
        t.remove();
      });
      grids.forEach((g) => updateGridCount(g));
      rows.forEach((r)  => checkMsgRowEmpty(r));
    }

    function openPhotoCtxMenu(x, y, photoId, groupId) {
      closeCtxMenu();
      const menu = el('div', { class: 'ctx-menu' });

      if (groupId) {
        menu.appendChild(el('button', {
          type: 'button',
          onclick: async () => {
            closeCtxMenu();
            try {
              await api('POST', '/api/photos/ungroup-one', { photo_id: photoId });
              showToast('그룹에서 분리했습니다');
              await reloadMessages();
            } catch (e) { showToast('분리 실패'); }
          },
        }, '이 사진만 그룹에서 분리'));

        menu.appendChild(el('button', {
          type: 'button',
          onclick: async () => {
            closeCtxMenu();
            try {
              await api('DELETE', '/api/photos/group/' + groupId);
              showToast('묶음을 해제했습니다');
              await reloadMessages();
            } catch (e) { showToast('해제 실패'); }
          },
        }, '묶음 전체 해제'));

        menu.appendChild(el('button', {
          type: 'button',
          style: 'color:#ef4444',
          onclick: async () => {
            closeCtxMenu();
            if (!confirm('이 사진을 삭제할까요? (Drive에서도 삭제됩니다)')) return;
            removePhotoFromDom(photoId);
            try {
              await api('DELETE', '/api/photos/photo/' + photoId);
              showToast('사진을 삭제했습니다');
            } catch (e) {
              showToast('삭제 실패 — 새로고침합니다');
              await reloadMessages();
            }
          },
        }, '이 사진만 삭제'));

        menu.appendChild(el('button', {
          type: 'button',
          style: 'color:#ef4444',
          onclick: async () => {
            closeCtxMenu();
            if (!confirm('그룹 사진 전체를 삭제할까요? (Drive에서도 삭제됩니다)')) return;
            removeGroupFromDom(groupId);
            try {
              await api('DELETE', '/api/photos/group-all/' + groupId);
              showToast('그룹 사진을 모두 삭제했습니다');
            } catch (e) {
              showToast('삭제 실패 — 새로고침합니다');
              await reloadMessages();
            }
          },
        }, '그룹 삭제'));
      } else {
        menu.appendChild(el('button', {
          type: 'button',
          style: 'color:#ef4444',
          onclick: async () => {
            closeCtxMenu();
            if (!confirm('이 사진을 삭제할까요? (Drive에서도 삭제됩니다)')) return;
            removePhotoFromDom(photoId);
            try {
              await api('DELETE', '/api/photos/photo/' + photoId);
              showToast('사진을 삭제했습니다');
            } catch (e) {
              showToast('삭제 실패 — 새로고침합니다');
              await reloadMessages();
            }
          },
        }, '사진 삭제'));
      }

      menu.appendChild(el('button', {
        type: 'button',
        onclick: () => { closeCtxMenu(); },
      }, '닫기'));

      menu.style.left = Math.min(x, window.innerWidth - 160) + 'px';
      menu.style.top = Math.min(y, window.innerHeight - 100) + 'px';
      document.body.appendChild(menu);
      state.ctxMenu = menu;
      setTimeout(() => document.addEventListener('click', closeCtxMenu, { once: true }), 0);
    }

    // ─── 사진 미리보기 (라이트박스) ──────────────────────────────────────────
    const pvState = { photos: [], current: 0, overlay: null };

    function buildPhotoList() {
      return Array.from($messages.querySelectorAll('.photo-thumb[data-photo-id]')).map((el) => ({
        photoId: parseInt(el.dataset.photoId),
        groupId: el.dataset.groupId || null,
        fileName: el.dataset.fileName || '',
        createdAt: el.dataset.createdAt || '',
      }));
    }

    function openPhotoViewer(photoId) {
      const photos = buildPhotoList();
      const idx = photos.findIndex((p) => p.photoId === photoId);
      if (idx === -1) return;
      pvState.photos = photos;
      pvState.current = idx;
      renderViewer();
    }

    function renderViewer() {
      if (pvState.overlay) pvState.overlay.remove();

      const photos = pvState.photos;
      const current = pvState.current;
      const { photoId, groupId, fileName, createdAt } = photos[current];

      const overlay = document.createElement('div');
      overlay.className = 'photo-viewer';
      pvState.overlay = overlay;

      // 헤더
      const header = document.createElement('div');
      header.className = 'pv-header';
      const closeBtn = document.createElement('button');
      closeBtn.className = 'pv-close';
      closeBtn.type = 'button';
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeViewer(); });
      const counter = document.createElement('span');
      counter.className = 'pv-counter';
      counter.textContent = (current + 1) + ' / ' + photos.length;
      header.appendChild(closeBtn);
      header.appendChild(counter);
      overlay.appendChild(header);

      // 메인 영역
      const main = document.createElement('div');
      main.className = 'pv-main';
      main.addEventListener('click', (e) => { if (e.target === main || e.target === img) closeViewer(); });

      const img = document.createElement('img');
      img.className = 'pv-img';
      img.src = '/api/photos/thumb/' + photoId;
      img.alt = '사진';
      main.appendChild(img);

      // 파일명 + 업로드 시각
      if (fileName || createdAt) {
        const info = document.createElement('div');
        info.className = 'pv-info';
        if (fileName) {
          const fn = document.createElement('div');
          fn.className = 'pv-filename';
          fn.textContent = fileName;
          info.appendChild(fn);
        }
        if (createdAt) {
          const dt = document.createElement('div');
          dt.className = 'pv-datetime';
          dt.textContent = formatTime(createdAt);
          info.appendChild(dt);
        }
        main.appendChild(info);
      }

      if (current > 0 || state.hasMore) {
        const prev = document.createElement('button');
        prev.className = 'pv-nav pv-prev';
        prev.type = 'button';
        prev.textContent = current === 0 && state.hasMore ? '⟳' : '‹';
        prev.addEventListener('click', (e) => { e.stopPropagation(); navigateViewer(-1); });
        main.appendChild(prev);
      }
      if (current < photos.length - 1) {
        const next = document.createElement('button');
        next.className = 'pv-nav pv-next';
        next.type = 'button';
        next.textContent = '›';
        next.addEventListener('click', (e) => { e.stopPropagation(); navigateViewer(1); });
        main.appendChild(next);
      }
      overlay.appendChild(main);

      // 그룹 썸네일 스트립
      if (groupId) {
        const groupPhotos = photos.filter((p) => p.groupId === groupId);
        if (groupPhotos.length > 1) {
          const wrap = document.createElement('div');
          wrap.className = 'pv-strip-wrap';
          const strip = document.createElement('div');
          strip.className = 'pv-strip';
          for (const gp of groupPhotos) {
            const t = document.createElement('div');
            t.className = 'pv-strip-thumb' + (gp.photoId === photoId ? ' active' : '');
            const ti = document.createElement('img');
            ti.src = '/api/photos/thumb/' + gp.photoId;
            ti.loading = 'lazy';
            ti.alt = '';
            t.appendChild(ti);
            t.addEventListener('click', (e) => {
              e.stopPropagation();
              pvState.current = photos.findIndex((p) => p.photoId === gp.photoId);
              renderViewer();
            });
            strip.appendChild(t);
          }
          wrap.appendChild(strip);
          overlay.appendChild(wrap);
          // 현재 활성 썸네일 중앙 정렬
          requestAnimationFrame(() => {
            const active = strip.querySelector('.active');
            if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
          });
        }
      }

      // 터치 스와이프
      let touchStartX = 0;
      overlay.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
      }, { passive: true });
      overlay.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 50) navigateViewer(dx < 0 ? 1 : -1);
      }, { passive: true });

      document.body.appendChild(overlay);
    }

    async function navigateViewer(dir) {
      // 첫 사진에서 이전 이동 → 더 오래된 메시지 로드
      if (dir === -1 && pvState.current === 0 && state.hasMore) {
        const prevFirstId = pvState.photos[0]?.photoId;
        // 로딩 중 표시
        const counter = pvState.overlay && pvState.overlay.querySelector('.pv-counter');
        if (counter) counter.textContent = '불러오는 중...';
        await loadMore();
        const newPhotos = buildPhotoList();
        pvState.photos = newPhotos;
        // 이전 첫 사진의 새 인덱스 → 그 직전 사진으로 이동
        const prevFirstIdx = newPhotos.findIndex((p) => p.photoId === prevFirstId);
        pvState.current = prevFirstIdx > 0 ? prevFirstIdx - 1 : 0;
        renderViewer();
        return;
      }
      const next = pvState.current + dir;
      if (next < 0 || next >= pvState.photos.length) return;
      pvState.current = next;
      renderViewer();
    }

    function closeViewer() {
      if (pvState.overlay) { pvState.overlay.remove(); pvState.overlay = null; }
    }

    document.addEventListener('keydown', (e) => {
      if (!pvState.overlay) return;
      if (e.key === 'Escape') closeViewer();
      else if (e.key === 'ArrowLeft') navigateViewer(-1);
      else if (e.key === 'ArrowRight') navigateViewer(1);
    });

    function renderPhotoUploadMessage(m) {
      const allPhotoIds = m.metadata && Array.isArray(m.metadata.photo_ids)
        ? m.metadata.photo_ids : [];
      const groups = m.metadata?.groups || [];
      const ungrouped = m.metadata?.ungrouped ?? allPhotoIds;
      const photoInfo = m.metadata?.photo_info || {};

      // 이 메시지에 표시할 사진이 없으면 (모두 다른 메시지의 그룹에 흡수됨) 숨김
      const hasVisible = ungrouped.length > 0 || groups.some(g => g.is_primary && g.photo_ids.length > 0);
      if (!hasVisible) return el('div', { style: 'display:none', dataset: { id: String(m.id) } });

      const root = el('div', {
        class: 'msg-row system',
        dataset: { id: String(m.id) },
      });
      const card = el('div', { class: 'msg-system-card' });

      if (allPhotoIds.length === 0) {
        card.appendChild(el('div', null, '📷 사진 업로드'));
      } else {
        const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:6px;' });

        // 그룹 사진들
        for (const grp of groups) {
          if (!grp.is_primary) continue; // non-primary 메시지는 이 그룹 사진 표시 안 함

          // primary: 그룹 전체 사진을 일반 그리드처럼 표시 (테두리/뱃지 없음)
          const cnt = grp.photo_ids.length;
          const countClass = cnt === 1 ? 'count-1' : cnt === 2 ? 'count-2'
            : cnt === 3 ? 'count-3' : cnt === 4 ? 'count-4' : 'count-many';
          const grid = el('div', { class: 'photo-grid ' + countClass });
          for (const pid of grp.photo_ids) {
            const info = photoInfo[String(pid)] || {};
            grid.appendChild(makePhotoThumb(pid, m.id, grp.group_id, info.file_name, info.created_at));
          }
          wrap.appendChild(grid);
        }

        // 개별(미그룹) 사진들
        if (ungrouped.length > 0) {
          const countClass = ungrouped.length === 1 ? 'count-1'
            : ungrouped.length === 2 ? 'count-2'
            : ungrouped.length === 3 ? 'count-3'
            : ungrouped.length === 4 ? 'count-4' : 'count-many';
          const grid = el('div', { class: 'photo-grid ' + countClass });
          const maxShow = Math.min(ungrouped.length, 9);
          for (let i = 0; i < maxShow; i++) {
            const uinfo = photoInfo[String(ungrouped[i])] || {};
            const thumb = makePhotoThumb(ungrouped[i], m.id, null, uinfo.file_name, uinfo.created_at);
            if (i === maxShow - 1 && ungrouped.length > maxShow) {
              const more = el('div', { class: 'photo-more' }, '+' + (ungrouped.length - maxShow));
              thumb.appendChild(more);
            }
            grid.appendChild(thumb);
          }
          wrap.appendChild(grid);
        }

        card.appendChild(wrap);
      }

      const captionBtn = el('button', {
        type: 'button',
        class: 'photo-caption-btn',
        onclick: () => {
          state.replyTo = { id: m.id, sender: m.sender, message: m.message };
          updateReplyBar();
          $input.focus();
        },
      }, '✏️ 캡션 달기');

      const footer = el('div', { class: 'msg-system-footer' });
      footer.appendChild(captionBtn);
      footer.appendChild(el('span', { class: 'time-text' }, formatTime(m.created_at)));
      card.appendChild(footer);
      root.appendChild(card);
      return root;
    }

    function renderPhotoBookingCandidates(m) {
      const candidates = m.metadata && Array.isArray(m.metadata.candidates)
        ? m.metadata.candidates : [];
      const photoIds = m.metadata?.photo_ids ?? [];
      const isUsed = m.metadata?.type === 'photo_booking_candidates_used';

      const root = el('div', {
        class: 'msg-row system',
        dataset: { id: String(m.id) },
      });
      const card = el('div', { class: 'msg-system-card' });
      const details = el('details', { class: 'msg-system', open: '' });
      const summary = el('summary');
      summary.appendChild(el('span', { class: 'sys-content' }, m.message));
      details.appendChild(summary);
      card.appendChild(details);
      root.appendChild(card);

      if (!isUsed && candidates.length > 0) {
        const row = el('div', { class: 'drive-actions' });
        candidates.slice(0, 5).forEach((c) => {
          const label = c.index + '번: ' + c.customer_name + (c.shoot_date ? ' (' + c.shoot_date.slice(0, 10) + ')' : '');
          const btn = el('button', {
            type: 'button',
            class: 'secondary',
            onclick: () => {
              if (state.busy) return;
              row.querySelectorAll('button').forEach((b) => (b.disabled = true));
              sendMessage('[PHOTO_LINK_SELECT_' + c.index + ']');
            },
          }, label);
          row.appendChild(btn);
        });
        root.appendChild(row);
      } else if (isUsed) {
        root.appendChild(el('div', { class: 'drive-actions-done' }, '연결완료'));
      }
      return root;
    }

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

    // ── 톡톡 선택 로직 ──
    let bmSelectedTalkId = null;
    let bmTalkTimer = null;
    const $talkSearch = document.getElementById('bm-talk-search');
    const $talkDropdown = document.getElementById('bm-talk-dropdown');
    const $talkSelected = document.getElementById('bm-talk-selected');

    function bmTalkEsc(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

    function clearTalkSelection() {
      bmSelectedTalkId = null;
      $talkSearch.value = '';
      $talkSelected.style.display = 'none';
      $talkSelected.innerHTML = '';
    }

    function selectTalk(talkId, label, name, phone) {
      bmSelectedTalkId = talkId;
      $talkDropdown.style.display = 'none';
      $talkSearch.value = '';
      $talkSelected.style.display = 'block';
      $talkSelected.innerHTML =
        '<div class="modal-talk-selected">' +
        '<span>✓ ' + bmTalkEsc(label) + '</span>' +
        '<span class="modal-talk-clear" id="bm-talk-clear">✕</span>' +
        '</div>';
      document.getElementById('bm-talk-clear').addEventListener('click', clearTalkSelection);
      if (name) document.getElementById('bm-name').value = name;
      if (phone) document.getElementById('bm-phone').value = phone;
    }

    function renderTalkDropdown(customers, talkOnly) {
      if (!customers.length && !talkOnly.length) {
        $talkDropdown.innerHTML = '<div style="padding:10px 12px;font-size:13px;color:#aaa">검색 결과 없음</div>';
        $talkDropdown.style.display = 'block';
        return;
      }
      let html = '';
      if (customers.length) {
        html += '<div class="modal-talk-section">📋 기존 고객</div>';
        customers.forEach(c => {
          const sub = c.phone ? c.phone : '전화번호 없음';
          html += '<div class="modal-talk-item" data-type="customer" data-talk-id="' + bmTalkEsc(c.talk_id) +
            '" data-name="' + bmTalkEsc(c.customer_name) + '" data-phone="' + bmTalkEsc(c.phone || '') + '">' +
            '<div class="modal-talk-item-main">' + bmTalkEsc(c.customer_name) + '</div>' +
            '<div class="modal-talk-item-sub">' + bmTalkEsc(sub) + '</div>' +
            '</div>';
        });
      }
      if (talkOnly.length) {
        html += '<div class="modal-talk-section">💬 톡톡 대화만 있는 고객</div>';
        talkOnly.forEach(t => {
          const date = t.last_message_at ? t.last_message_at.slice(0, 10) : '';
          const preview = (t.matched_message || t.last_message || '').slice(0, 40);
          html += '<div class="modal-talk-item" data-type="talk" data-talk-id="' + bmTalkEsc(t.talk_id) + '">' +
            '<div class="modal-talk-item-main">' + bmTalkEsc(date ? date + ' 대화' : '미상') + '</div>' +
            '<div class="modal-talk-item-sub">' + bmTalkEsc(preview) + '</div>' +
            '</div>';
        });
      }
      $talkDropdown.innerHTML = html;
      $talkDropdown.style.display = 'block';
      $talkDropdown.querySelectorAll('.modal-talk-item').forEach(el => {
        el.addEventListener('click', () => {
          const type = el.dataset.type;
          const talkId = el.dataset.talkId;
          if (type === 'customer') {
            const name = el.dataset.name;
            const phone = el.dataset.phone;
            selectTalk(talkId, name + (phone ? ' ' + phone : ''), name, phone);
          } else {
            const sub = el.querySelector('.modal-talk-item-sub').textContent;
            selectTalk(talkId, '톡톡: ' + sub.slice(0, 20) + '…', null, null);
          }
        });
      });
    }

    $talkSearch.addEventListener('input', () => {
      const q = $talkSearch.value.trim();
      if (!q) { $talkDropdown.style.display = 'none'; return; }
      clearTimeout(bmTalkTimer);
      bmTalkTimer = setTimeout(async () => {
        try {
          const res = await api('GET', '/api/talk-contacts?q=' + encodeURIComponent(q));
          renderTalkDropdown(res.customers || [], res.talkOnly || []);
        } catch { $talkDropdown.style.display = 'none'; }
      }, 300);
    });

    $talkSearch.addEventListener('blur', () => { setTimeout(() => { $talkDropdown.style.display = 'none'; }, 200); });

    function openBookingModal() {
      bmSelectedProducts = [];
      renderProductTags();
      clearTalkSelection();
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
          talk_id: bmSelectedTalkId || undefined,
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

    function showBookingDetail(bookingId) {
      var ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1000;display:flex;justify-content:flex-end;';
      var pn = document.createElement('div');
      pn.style.cssText = 'background:#fff;width:420px;max-width:100%;height:100%;overflow-y:auto;box-sizing:border-box;box-shadow:-2px 0 8px rgba(0,0,0,.1);display:flex;flex-direction:column;';
      var hd = document.createElement('div');
      hd.style.cssText = 'position:sticky;top:0;background:#fff;z-index:1;display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid #e5e7eb;';
      hd.innerHTML = '<h3 style="flex:1;font-size:14px;color:#555;margin:0;font-weight:600;">예약 상세</h3>';
      var xb = document.createElement('button');
      xb.style.cssText = 'background:none;border:none;font-size:18px;cursor:pointer;color:#888;padding:3px 8px;border-radius:4px;';
      xb.textContent = 'x';
      xb.onclick = function() { ov.remove(); };
      hd.appendChild(xb);
      var bd = document.createElement('div');
      bd.innerHTML = '<div style="padding:24px;text-align:center;color:#aaa;font-size:13px;">불러오는 중...</div>';
      pn.appendChild(hd); pn.appendChild(bd);
      ov.appendChild(pn);
      ov.addEventListener('click', function(ev) { if (ev.target === ov) ov.remove(); });
      document.body.appendChild(ov);
      var SBADGE = {'예약접수':{bg:'#fef3c7',fg:'#92400e'},'예약확정':{bg:'#fef3c7',fg:'#92400e'},'원본발송완료':{bg:'#dbeafe',fg:'#1e40af'},'셀렉완료':{bg:'#dbeafe',fg:'#1e40af'},'보정완료':{bg:'#ede9fe',fg:'#5b21b6'},'재보정요청':{bg:'#ede9fe',fg:'#5b21b6'},'재보정완료':{bg:'#ede9fe',fg:'#5b21b6'},'추가보정없음':{bg:'#ede9fe',fg:'#5b21b6'},'액자발주완료':{bg:'#e4e4e7',fg:'#3f3f46'},'취소':{bg:'#fee2e2',fg:'#991b1b'}};
      function loadDetail() {
        fetch('/api/bookings/' + bookingId).then(function(r){ return r.json(); }).then(function(d){
          var b = d.booking;
          if (!b) { bd.innerHTML = '<div style="padding:20px;color:#aaa;">데이터 없음</div>'; return; }
          function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
          function fd(s,n){ return s ? esc(s.slice(0,n||10)) : '<span style="color:#ccc">-</span>'; }
          var cpSt = 'background:#f3f4f6;border:none;cursor:pointer;padding:2px 6px;border-radius:3px;font-size:11px;color:#555;margin-left:4px;';
          var edSt = 'background:#f3f4f6;border:none;cursor:pointer;padding:2px 6px;border-radius:3px;font-size:11px;color:#555;';
          function sec(t,c){ return '<div style="padding:13px 15px;border-bottom:1px solid #f3f4f6;"><div style="font-size:11px;color:#888;font-weight:600;letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px;">'+esc(t)+'</div>'+c+'</div>'; }
          function fr(l,v){ return '<div style="display:flex;align-items:flex-start;padding:5px 0;font-size:13px;"><span style="color:#888;width:80px;flex-shrink:0;padding-top:1px;">'+esc(l)+'</span><div style="flex:1;color:#333;word-break:break-all;">'+(v||'<span style="color:#ccc">-</span>')+'</div></div>'; }
          function eft(field,label,val){
            var dv = val ? esc(val) : '<span style="color:#ccc">-</span>';
            return '<div style="display:flex;align-items:flex-start;padding:5px 0;font-size:13px;">' +
              '<span style="color:#888;width:80px;flex-shrink:0;padding-top:1px;">'+esc(label)+'</span>' +
              '<div style="flex:1;">' +
                '<div id="bfd-'+field+'" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">' +
                  '<span id="bfv-'+field+'">'+dv+'</span>' +
                  '<button style="'+edSt+'" data-action="edit" data-field="'+field+'">편집</button>' +
                '</div>' +
                '<div id="bef-'+field+'" style="display:none;flex-direction:column;gap:4px;">' +
                  '<input type="text" id="bei-'+field+'" style="border:1px solid #d1d5db;border-radius:4px;padding:4px 8px;font-size:13px;width:100%;box-sizing:border-box;" />' +
                  '<div style="display:flex;gap:4px;">' +
                    '<button style="background:#1ec800;border:none;cursor:pointer;padding:4px 10px;border-radius:4px;font-size:12px;color:#fff;" data-action="save" data-field="'+field+'" data-text="1">저장</button>' +
                    '<button style="'+edSt+'" data-action="cancel" data-field="'+field+'">취소</button>' +
                  '</div>' +
                '</div>' +
              '</div></div>';
          }
          function ef(field,label,val){
            var isDt = field === 'shoot_date';
            var dv = val ? esc(val.slice(0, isDt ? 16 : 10)) : '<span style="color:#ccc">-</span>';
            return '<div style="display:flex;align-items:flex-start;padding:5px 0;font-size:13px;">' +
              '<span style="color:#888;width:80px;flex-shrink:0;padding-top:1px;">'+esc(label)+'</span>' +
              '<div style="flex:1;">' +
                '<div id="bfd-'+field+'" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">' +
                  '<span id="bfv-'+field+'">'+dv+'</span>' +
                  '<button style="'+edSt+'" data-action="edit" data-field="'+field+'">편집</button>' +
                '</div>' +
                '<div id="bef-'+field+'" style="display:none;flex-direction:column;gap:4px;">' +
                  '<input type="'+(isDt ? 'datetime-local' : 'date')+'" id="bei-'+field+'" style="border:1px solid #d1d5db;border-radius:4px;padding:4px 8px;font-size:13px;width:100%;box-sizing:border-box;" />' +
                  '<div style="display:flex;gap:4px;">' +
                    '<button style="background:#1ec800;border:none;cursor:pointer;padding:4px 10px;border-radius:4px;font-size:12px;color:#fff;" data-action="save" data-field="'+field+'">저장</button>' +
                    '<button style="'+edSt+'" data-action="cancel" data-field="'+field+'">취소</button>' +
                  '</div>' +
                '</div>' +
              '</div></div>';
          }
          function cs(x) {
            if (x.cancelled) return '취소';
            if (x.frame_ordered_at) return '액자발주완료';
            if (x.revision_no_more_at) return '추가보정없음';
            if (x.revision_requested_at) {
              if (!x.revision_sent_at) return '재보정요청';
              if (x.revision_sent_at >= x.revision_requested_at) return '재보정완료';
              return '재보정요청';
            }
            if (x.retouched_sent_at) return '보정완료';
            if (x.selection_received_at) return '셀렉완료';
            if (x.original_sent_at) return '원본발송완료';
            if (x.shoot_date) return '예약확정';
            return '예약접수';
          }
          var stLabel = cs(b);
          var stColors = SBADGE[stLabel] || {bg:'#e4e4e7',fg:'#3f3f46'};
          var stBg = stColors.bg;
          var stFg = stColors.fg;
          var h = '';
          h += sec('기본정보',
            fr('예약번호','<code style="font-size:12px;">'+esc(b.booking_id)+'</code><button style="'+cpSt+'" data-copy="'+esc(b.booking_id)+'">복사</button>') +
            fr('톡ID', b.talk_id ? '<code style="font-size:11px;word-break:break-all;">'+esc(b.talk_id)+'</code><button style="'+cpSt+'" data-copy="'+esc(b.talk_id)+'">복사</button>' : '<span style="color:#ccc">미연결</span>') +
            fr('고객명', esc(b.customer_name)) +
            fr('요청사항', b.request_note ? esc(b.request_note) : '') +
            fr('예약일', b.reservation_date ? esc(b.reservation_date.slice(0,10)) : '') +
            fr('홍보동의', b.promotion_consent ? '✅ 동의' : '❌ 미동의') +
            fr('현재단계','<span style="background:'+stBg+';color:'+stFg+';padding:2px 8px;border-radius:10px;font-size:12px;font-weight:500;">'+esc(stLabel)+'</span>')
          );
          h += sec('촬영 일정', ef('shoot_date','촬영일',b.shoot_date));
          h += sec('처리 단계',
            ef('original_sent_at','원본발송',b.original_sent_at) +
            ef('selection_received_at','셀렉완료',b.selection_received_at) +
            eft('selection_cuts','셀렉컷',b.selection_cuts) +
            ef('retouched_sent_at','보정완료',b.retouched_sent_at) +
            ef('revision_requested_at','재보정요청',b.revision_requested_at) +
            ef('revision_sent_at','재보정완료',b.revision_sent_at) +
            ef('revision_no_more_at','추가보정없음',b.revision_no_more_at) +
            ef('frame_ordered_at','액자발주',b.frame_ordered_at)
          );
          h += sec('알림/기타',
            ef('urgent_retouch_until','긴급 마감일',b.urgent_retouch_until) +
            ef('alert_paused_until','알림정지',b.alert_paused_until) +
            fr('취소여부', b.cancelled ? '✅ 취소됨' : '정상') +
            fr('등록일',fd(b.created_at,16)) + fr('최종수정',fd(b.updated_at,16))
          );
          h += sec('연동 정보',
            fr('캘린더', b.calendar_event_id ? '✅ 연동됨' : '❌ 미연동') +
            fr('원본폴더', b.original_folder_url ? '<a href="'+esc(b.original_folder_url)+'" target="_blank" style="color:#3b82f6;text-decoration:none;">열기</a>' : '') +
            fr('보정폴더', b.retouched_folder_url ? '<a href="'+esc(b.retouched_folder_url)+'" target="_blank" style="color:#3b82f6;text-decoration:none;">열기</a>' : '') +
            fr('액자주소', b.frame_address ? esc(b.frame_address) : '❌ 주소 없음') +
            fr('수령인', b.frame_recipient ? esc(b.frame_recipient) : '') +
            fr('연락처', b.frame_phone ? esc(b.frame_phone) : '')
          );
          h += '<div style="height:40px;"></div>';
          bd.innerHTML = h;
          bd.onclick = function(ev) {
            var tgt = ev.target;
            if (tgt.dataset.copy !== undefined) {
              navigator.clipboard.writeText(tgt.dataset.copy).then(function(){ var old = tgt.textContent; tgt.textContent = '복사됨'; setTimeout(function(){ tgt.textContent = old; },1500); });
              return;
            }
            var action = tgt.dataset.action, field = tgt.dataset.field;
            if (!action || !field) return;
            if (action === 'edit') {
              var raw = b[field];
              var inp = document.getElementById('bei-' + field);
              if (inp) inp.value = raw ? (field === 'shoot_date' ? raw.slice(0,16).replace(' ','T') : (inp.type === 'text' ? raw : raw.slice(0,10))) : '';
              document.getElementById('bfd-' + field).style.display = 'none';
              var ef2 = document.getElementById('bef-' + field);
              ef2.style.display = 'flex'; ef2.style.flexDirection = 'column';
              if (inp) inp.focus();
            } else if (action === 'cancel') {
              document.getElementById('bfd-' + field).style.display = 'flex';
              document.getElementById('bef-' + field).style.display = 'none';
            } else if (action === 'save') {
              var inp2 = document.getElementById('bei-' + field);
              var val = inp2 ? inp2.value.trim() : '';
              var apiVal = null;
              var isText = tgt.getAttribute('data-text') === '1';
              if (val) apiVal = isText ? val : (field === 'shoot_date' ? val.replace('T',' ') + ':00' : val + ' 00:00:00');
              fetch('/api/dashboard/bookings/' + encodeURIComponent(bookingId) + '/milestone', {
                method: 'PATCH',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({field: field, value: apiVal})
              }).then(function(){ loadDetail(); }).catch(function(e){ console.error(e); });
            }
          };
        }).catch(function(){ bd.innerHTML = '<div style="padding:20px;color:#aaa;">로드 실패</div>'; });
      }
      loadDetail();
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
        var _custs = (m.metadata && m.metadata.type === 'morning_report' && Array.isArray(m.metadata.customers) && m.metadata.customers.length > 0) ? m.metadata.customers : null;
        if (_custs) {
          var _nl = String.fromCharCode(10);
          var _sp = document.createElement('span');
          _sp.className = 'sys-content';
          var _ls = (m.message || '').split(_nl);
          for (var _li = 0; _li < _ls.length; _li++) {
            if (_li > 0) _sp.appendChild(document.createTextNode(_nl));
            var _l = _ls[_li];
            var _ok = false;
            for (var _ci = 0; _ci < _custs.length; _ci++) {
              var _c = _custs[_ci];
              if (!_c || !_c.name || !_c.url) continue;
              var _p = _l.indexOf(_c.name);
              if (_p !== -1) {
                _sp.appendChild(document.createTextNode(_l.slice(0, _p)));
                var _a = document.createElement('a');
                _a.href = _c.url;
                _a.target = '_blank';
                _a.setAttribute('style', 'color:inherit;text-decoration:underline;');
                _a.textContent = _c.name;
                _sp.appendChild(_a);
                _sp.appendChild(document.createTextNode(_l.slice(_p + _c.name.length)));
                if ((_c.section === 'retouch' || _c.section === 'frame') && _c.booking_id) {
                  var _btn = document.createElement('button');
                  _btn.setAttribute('style', 'background:none;border:none;cursor:pointer;font-size:14px;padding:0 0 0 8px;vertical-align:middle;opacity:.8;');
                  _btn.textContent = '📋';
                  _btn.setAttribute('data-bid', _c.booking_id);
                  _btn.addEventListener('click', function(ev) {
                    ev.stopPropagation();
                    ev.preventDefault();
                    showBookingDetail(this.getAttribute('data-bid'));
                  });
                  _sp.appendChild(_btn);
                }
                _ok = true;
                break;
              }
            }
            if (!_ok) _sp.appendChild(document.createTextNode(_l));
          }
          summary.appendChild(_sp);
        } else {
          summary.appendChild(el('span', { class: 'sys-content' }, m.message));
        }
      }
      details.appendChild(summary);

      if (m.metadata) {
        const meta = el('div', { class: 'sys-meta' }, JSON.stringify(m.metadata, null, 2));
        details.appendChild(meta);
      }

      // 카드 컨테이너 — details + 카드 안쪽 푸터(시간/복사)를 함께 감싼다
      const card = el('div', { class: 'msg-system-card' });
      card.appendChild(details);

      // confirmation 버튼/결과 렌더링 — details 바깥(card 안)에 배치
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
              onclick: () => handleConfirm(m.id, confirmation.action_id, btn.value, card),
            }, btn.label);
            buttonRow.appendChild(button);
          });
          card.appendChild(buttonRow);
        } else {
          const cls = responded === 'yes' ? 'success' : 'cancel';
          const text = responded === 'yes' ? '✅ 처리 완료' : '❌ 취소됨';
          card.appendChild(el('div', { class: 'confirm-result ' + cls }, text));
        }
      }
      const footer = el('div', { class: 'msg-system-footer' });
      footer.appendChild(el('span', { class: 'time-text' }, time));
      const replyBtn = el('button', {
        type: 'button',
        class: 'copy-btn',
        title: '답장',
        'aria-label': '답장',
        onclick: (e) => {
          e.stopPropagation();
          e.preventDefault();
          state.replyTo = { id: m.id, sender: m.sender, message: m.message };
          updateReplyBar();
          $input.focus();
        },
      }, '↩');
      footer.appendChild(replyBtn);
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
      } else if (mtype === 'cancel_candidates') {
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
                sendMessage('[CANCEL_SELECT_' + c.index + ']');
              },
            }, label);
            row.appendChild(btn);
          });
          root.appendChild(row);
        }
      } else if (mtype === 'cancel_candidates_used') {
        const done = el('div', { class: 'drive-actions-done' }, '선택완료');
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
        const footer = detailsEl.querySelector('.msg-system-footer');
        if (footer) detailsEl.insertBefore(resultBox, footer);
        else detailsEl.appendChild(resultBox);
        // 후속 ai 메시지 가져오기
        await pollOnce();
        refreshConfirmBanner();
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
      '[CANCEL_SELECT_1]': '1번',
      '[CANCEL_SELECT_2]': '2번',
      '[CANCEL_SELECT_3]': '3번',
      '[CANCEL_SELECT_4]': '4번',
      '[CANCEL_SELECT_5]': '5번',
      '[PHOTO_LINK_SELECT_1]': '1번',
      '[PHOTO_LINK_SELECT_2]': '2번',
      '[PHOTO_LINK_SELECT_3]': '3번',
      '[PHOTO_LINK_SELECT_4]': '4번',
      '[PHOTO_LINK_SELECT_5]': '5번',
      '[MEMO_CONFIRM_YES]': '✅ 저장',
      '[MEMO_CONFIRM_NO]': '❌ 취소',
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
      if (m.sender === 'system') {
        const mtype = m.metadata && m.metadata.type;
        if (mtype === 'photo_upload') return renderPhotoUploadMessage(m);
        if (mtype === 'photo_booking_candidates' || mtype === 'photo_booking_candidates_used') {
          return renderPhotoBookingCandidates(m);
        }
        return renderSystemMessage(m);
      }
      return renderUserAiMessage(m);
    }

    function appendMessage(m) {
      if (state.seenIds.has(m.id)) return;
      state.seenIds.add(m.id);
      state.messages.push(m);
      try {
        $messages.appendChild(renderMessage(m));
      } catch (e) {
        console.error('[renderMessage] id=' + m.id + ' 실패:', e);
        const err = document.createElement('div');
        err.style.cssText = 'padding:6px 12px;color:#aaa;font-size:12px;';
        err.textContent = '[메시지 렌더링 오류]';
        $messages.appendChild(err);
      }
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
          if (m.sender === 'user') {
            const rect = bubble.getBoundingClientRect();
            openCtxMenu(rect.right, rect.bottom + 6, m);
          } else {
            openCtxMenu(t.clientX, t.clientY, m);
          }
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
    async function loadInitial(skipScroll) {
      try {
        const data = await api('GET', '/api/chat/messages?limit=' + HISTORY_LIMIT);
        const list = (data.messages || []).slice().reverse();
        list.forEach((m) => appendMessage(m));
        state.hasMore = data.hasMore ?? false;
        if (list.length > 0) state.cursor = Math.min(...list.map((m) => m.id));
        if (!skipScroll) scrollToBottom();
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
        if (newOnes.some((m) => m.metadata && m.metadata.processing && m.metadata.processing.type === 'ai_confirm')) {
          refreshConfirmBanner();
        }
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
      const linkUpload = el('a', { href: '/upload-recommend' }, '📤 업로드 추천');
      const linkPhotos = el('a', { href: '/photos' }, '🖼️ 사진 관리');
      const linkRules = el('a', { href: '/rules' }, '📋 학습 규칙');
      const linkReport = el('a', { href: '/report' }, '📈 리포트');
      const linkCost = el('a', { href: '/cost' }, '💰 API 비용');
      const linkMemos = el('a', { href: '/memos' }, '📝 개발 메모');
      const linkLinks = el('a', { href: '/links' }, '🔗 링크 관리');

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
      nav.appendChild(linkUpload);
      nav.appendChild(linkPhotos);
      nav.appendChild(linkRules);
      nav.appendChild(linkReport);
      nav.appendChild(linkCost);
      nav.appendChild(linkMemos);
      nav.appendChild(linkLinks);
      nav.appendChild(notifItem);
      nav.appendChild(logoutBtn);
      sidebar.appendChild(nav);
      sidebar.appendChild(el('div', { class: 'user-email' }, USER_EMAIL));
      document.body.appendChild(overlay);
      document.body.appendChild(sidebar);
    });

    // ─── 미답변 확인 배너 ─────────────────────────────────
    const $confirmBanner = document.getElementById('confirm-banner');
    const $confirmBannerList = document.getElementById('confirm-banner-list');
    let bannerListOpen = false;

    async function refreshConfirmBanner() {
      try {
        const data = await api('GET', '/api/chat/pending-confirmations');
        const items = data.items || [];
        if (items.length === 0) {
          $confirmBanner.classList.add('hidden');
          $confirmBannerList.classList.add('hidden');
          return;
        }
        $confirmBanner.textContent = '❓ 확인 필요 ' + items.length + '건 — 탭하여 목록 보기';
        $confirmBanner.classList.remove('hidden');

        $confirmBannerList.innerHTML = '';
        items.forEach((item) => {
          const div = document.createElement('div');
          div.className = 'confirm-banner-item';

          const name = item.customer_name ? '[' + item.customer_name + '] ' : '';
          const textSpan = document.createElement('span');
          textSpan.className = 'confirm-banner-item-text';
          textSpan.textContent = '↩ ' + name + item.summary;
          textSpan.addEventListener('click', () => {
            $confirmBannerList.classList.add('hidden');
            bannerListOpen = false;
            jumpToConfirmMessage(item.id);
          });

          const skipBtn = document.createElement('button');
          skipBtn.className = 'confirm-banner-skip';
          skipBtn.textContent = '✕';
          skipBtn.title = '답변 스킵';
          skipBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const ok = window.confirm((name || '이 건') + '을 답변 없이 스킵하시겠어요? (milestone은 기록되지 않습니다)');
            if (!ok) return;
            try {
              await api('POST', '/api/chat/skip-confirm', { message_id: item.id });
              refreshConfirmBanner();
            } catch (err) {
              showToast('스킵 처리 실패');
            }
          });

          div.appendChild(textSpan);
          div.appendChild(skipBtn);
          $confirmBannerList.appendChild(div);
        });
      } catch (e) {
        // 배너 갱신 실패는 조용히 무시
      }
    }

    async function jumpToConfirmMessage(targetId) {
      const flashTarget = (el) => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const bubble = el.querySelector('.msg-system-card') || el;
        bubble.classList.remove('flash');
        void bubble.offsetWidth;
        bubble.classList.add('flash');
      };

      const existing = $messages.querySelector('[data-id="' + targetId + '"]');
      if (existing) { flashTarget(existing); return; }

      if (!state.hasMore) { showToast('메시지를 찾을 수 없습니다'); return; }

      const prevText = $confirmBanner.textContent;
      $confirmBanner.textContent = '🔍 메시지 찾는 중...';

      let safety = 0;
      while (state.hasMore && safety++ < 60) {
        while (state.loadingMore) {
          await new Promise((r) => setTimeout(r, 200));
        }
        if (!state.hasMore) break;
        await loadMore();
        const found = $messages.querySelector('[data-id="' + targetId + '"]');
        if (found) {
          flashTarget(found);
          refreshConfirmBanner();
          return;
        }
      }

      $confirmBanner.textContent = prevText;
      showToast('메시지를 찾을 수 없습니다');
    }

    $confirmBanner.addEventListener('click', () => {
      bannerListOpen = !bannerListOpen;
      if (bannerListOpen) $confirmBannerList.classList.remove('hidden');
      else $confirmBannerList.classList.add('hidden');
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
      refreshConfirmBanner();
      $input.focus();
      // SW만 자동 등록 (권한 prompt는 사이드바 버튼 클릭 시)
      registerServiceWorker();
    });
  })();
  </script>
</body>
</html>`;
}
