/**
 * PWA Manifest (정적 응답).
 */

export const MANIFEST_JSON = JSON.stringify({
  name: '마음껏스튜디오 비서',
  short_name: '스튜디오비서',
  description: '사진관 업무 비서',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#ffffff',
  theme_color: '#4285F4',
  lang: 'ko-KR',
  icons: [
    {
      src: '/icon.svg',
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any maskable',
    },
  ],
});
