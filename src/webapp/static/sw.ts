/**
 * Service Worker (정적 응답).
 * 수신만 담당 — 발송 코드는 Step 6b에서 추가.
 */

export const SW_JS = `/* 마음껏스튜디오 비서 SW */
'use strict';

const SW_VERSION = 'v1-2026-05-02';

self.addEventListener('install', (event) => {
  console.log('[sw] install', SW_VERSION);
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[sw] activate', SW_VERSION);
  event.waitUntil(self.clients.claim());
});

// 푸시 수신
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: '알림', body: event.data ? event.data.text() : '' };
  }
  console.log('[sw] push received', data);

  const title = data.title || '마음껏스튜디오 비서';
  const options = {
    body: data.body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: data.data || {},
    tag: data.tag,
    renotify: !!data.tag,
    requireInteraction: !!data.requires_confirmation,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 알림 클릭
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = '/chat' + (data.chat_message_id ? '#msg-' + data.chat_message_id : '');

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    for (const client of clientList) {
      const url = new URL(client.url);
      if (url.pathname === '/chat' || url.pathname === '/') {
        await client.focus();
        client.postMessage({ type: 'navigate', target, data });
        return;
      }
    }

    await self.clients.openWindow(target);
  })());
});

// 구독 만료 처리 (서버에서 410을 받았을 때를 대비)
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[sw] pushsubscriptionchange', event);
});
`;
