/**
 * 임시 마이그레이션: R2 → Google Drive
 * GET /api/admin/migrate-photos
 *
 * drive_file_id 컬럼 값이 R2 key 패턴("photos/...") 인 레코드를 찾아
 * R2에서 읽어 Drive에 올린 뒤 D1을 업데이트한다.
 * 완료 후 이 핸들러와 R2 binding은 삭제할 것.
 */

import { requireAuth } from './auth';
import { getValidAccessToken } from '../lib/google-tokens';

interface Env {
  DB: D1Database;
  PHOTO_BUCKET: R2Bucket;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  GOOGLE_DRIVE_PHOTOS_FOLDER_ID: string;
  [key: string]: unknown;
}

const DRIVE_UPLOAD_URL =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id';

async function uploadToDrive(
  accessToken: string,
  folderId: string,
  fileName: string,
  mimeType: string,
  data: ArrayBuffer,
): Promise<string> {
  const metadata = JSON.stringify({ name: fileName, mimeType, parents: [folderId] });
  const boundary = '----MigrateBoundary';
  const enc = new TextEncoder();
  const metaPart = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`);
  const dataPart = enc.encode(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const closing = enc.encode(`\r\n--${boundary}--`);

  const body = new Uint8Array(metaPart.byteLength + dataPart.byteLength + data.byteLength + closing.byteLength);
  let off = 0;
  body.set(metaPart, off); off += metaPart.byteLength;
  body.set(dataPart, off); off += dataPart.byteLength;
  body.set(new Uint8Array(data), off); off += data.byteLength;
  body.set(closing, off);

  const res = await fetch(DRIVE_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: body.buffer,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Drive upload ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as { id: string };
  return json.id;
}

export async function handleMigratePhotos(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  const accessToken = await getValidAccessToken(env as any);
  if (!accessToken) {
    return Response.json({ error: 'Google 인증 없음 — /auth/google?reauth=1 필요' }, { status: 503 });
  }

  // R2 key 패턴인 레코드만 조회 (Drive ID는 영숫자+_-만으로 구성, 슬래시 없음)
  const rows = await env.DB.prepare(
    `SELECT id, file_name, drive_file_id FROM photo_uploads WHERE drive_file_id LIKE 'photos/%'`
  ).all<{ id: number; file_name: string; drive_file_id: string }>();

  const list = rows.results ?? [];
  if (list.length === 0) {
    return Response.json({ message: '마이그레이션할 항목 없음', migrated: 0 });
  }

  const results: Array<{ id: number; file_name: string; status: string; drive_file_id?: string }> = [];

  for (const row of list) {
    try {
      // R2에서 읽기
      const obj = await env.PHOTO_BUCKET.get(row.drive_file_id);
      if (!obj) {
        results.push({ id: row.id, file_name: row.file_name, status: 'r2_not_found' });
        continue;
      }

      const data = await obj.arrayBuffer();
      const mimeType = obj.httpMetadata?.contentType || 'image/jpeg';
      const fileName = row.file_name || row.drive_file_id.split('/').pop() || `photo_${row.id}.jpg`;

      // Drive에 업로드
      const driveFileId = await uploadToDrive(
        accessToken,
        env.GOOGLE_DRIVE_PHOTOS_FOLDER_ID,
        fileName,
        mimeType,
        data,
      );

      // D1 업데이트
      await env.DB.prepare(
        `UPDATE photo_uploads SET drive_file_id = ?1 WHERE id = ?2`
      ).bind(driveFileId, row.id).run();

      // R2 원본 삭제
      await env.PHOTO_BUCKET.delete(row.drive_file_id).catch(() => {});

      results.push({ id: row.id, file_name: fileName, status: 'ok', drive_file_id: driveFileId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ id: row.id, file_name: row.file_name, status: 'error: ' + msg });
    }
  }

  const ok = results.filter(r => r.status === 'ok').length;
  const failed = results.filter(r => r.status !== 'ok').length;

  return Response.json({ migrated: ok, failed, results });
}
