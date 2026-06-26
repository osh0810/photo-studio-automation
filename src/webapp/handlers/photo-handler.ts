/**
 * Phase 7: 사진 업로드 & 관리 API (Google Drive 저장)
 *
 * POST   /api/photos/upload              — 사진 1장 Drive 저장 + D1 INSERT
 * POST   /api/photos/batch-message       — 업로드 완료 후 채팅 메시지 생성
 * GET    /api/photos/serve/:driveFileId  — Drive 파일 프록시 서빙
 * GET    /api/photos/thumb/:photoId      — photo_id 기반 썸네일 서빙
 * POST   /api/photos/caption             — 캡션 저장 (append)
 * POST   /api/photos/group               — 사진 묶음 생성 / 편입
 * POST   /api/photos/ungroup-one         — 특정 사진만 그룹에서 분리
 * DELETE /api/photos/group/:groupId      — 그룹 전체 해제 (묶음 해제, 파일 보존)
 * DELETE /api/photos/photo/:photoId     — 사진 1장 삭제 (Drive + DB)
 * DELETE /api/photos/group-all/:groupId — 그룹 전체 사진 삭제 (Drive + DB)
 * GET    /api/photos/sets                — 사진 세트 목록 (관리 페이지용)
 * GET    /api/photos/storage             — 총 사용 용량
 * DELETE /api/photos/booking/:bookingId  — 특정 booking 사진 세트 전체 삭제
 * POST   /api/photos/booking-link        — booking_candidates 카드 선택 처리
 */

import { requireAuth } from './auth';
import { extractCustomerNameFromFilename } from '../lib/drive-folder-parser';
import { getValidAccessToken } from '../lib/google-tokens';

interface Env {
  DB: D1Database;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  GOOGLE_DRIVE_PHOTOS_FOLDER_ID: string;
  [key: string]: unknown;
}

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

// 기존 캡션이 있으면 줄바꿈으로 이어붙이는 SQL 표현식
const CAPTION_APPEND_SQL =
  `CASE WHEN caption IS NULL OR caption = '' THEN ?1 ELSE caption || char(10) || ?1 END`;

const DRIVE_UPLOAD_URL =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,size';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

// ─── Google Drive 업로드 ──────────────────────────────────────────────────────

async function uploadToDrive(
  accessToken: string,
  folderId: string,
  fileName: string,
  mimeType: string,
  data: ArrayBuffer,
): Promise<{ fileId: string }> {
  const metadata = JSON.stringify({
    name: fileName,
    mimeType,
    parents: [folderId],
  });

  const boundary = '----DriveUploadBoundary';
  const metaPart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`;
  const dataPart = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;

  const encoder = new TextEncoder();
  const metaBytes = encoder.encode(metaPart);
  const dataPartBytes = encoder.encode(dataPart);
  const closingBytes = encoder.encode(closing);

  const body = new Uint8Array(
    metaBytes.byteLength + dataPartBytes.byteLength + data.byteLength + closingBytes.byteLength,
  );
  let offset = 0;
  body.set(metaBytes, offset); offset += metaBytes.byteLength;
  body.set(dataPartBytes, offset); offset += dataPartBytes.byteLength;
  body.set(new Uint8Array(data), offset); offset += data.byteLength;
  body.set(closingBytes, offset);

  const res = await fetch(DRIVE_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: body.buffer,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Drive upload failed ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { id: string; size?: string };
  return { fileId: json.id };
}

// ─── Google Drive 파일 삭제 ───────────────────────────────────────────────────

async function deleteFromDrive(accessToken: string, fileId: string): Promise<void> {
  await fetch(`${DRIVE_FILES_URL}/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => {});
}

// ─── POST /api/photos/upload ──────────────────────────────────────────────────

export async function handlePhotoUpload(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError(400, '잘못된 요청');
  }

  const file = formData.get('file') as File | null;
  if (!file || !file.type.startsWith('image/')) {
    return jsonError(400, '이미지 파일이 필요합니다');
  }

  const width = parseInt((formData.get('width') as string) || '0') || null;
  const height = parseInt((formData.get('height') as string) || '0') || null;
  const arrayBuffer = await file.arrayBuffer();

  const accessToken = await getValidAccessToken(env as any);
  if (!accessToken) {
    return jsonError(503, 'Google 인증 토큰 없음 — /auth/google?reauth=1 재인증 필요');
  }

  // Google Drive 저장
  let driveFileId: string;
  try {
    const result = await uploadToDrive(
      accessToken,
      env.GOOGLE_DRIVE_PHOTOS_FOLDER_ID,
      file.name,
      file.type || 'image/jpeg',
      arrayBuffer,
    );
    driveFileId = result.fileId;
  } catch (e) {
    console.error('[photo] Drive 업로드 실패:', e);
    return jsonError(500, 'Google Drive 업로드 실패');
  }

  // 파일명 기반 booking 매칭
  const fileName = file.name;
  let bookingId: string | null = null;
  let candidates: Array<{
    index: number;
    booking_id: string;
    customer_name: string;
    shoot_date: string | null;
  }> = [];

  const customerName = extractCustomerNameFromFilename(fileName);
  if (customerName) {
    const rows = await env.DB.prepare(
      `SELECT booking_id, customer_name, shoot_date
       FROM bookings
       WHERE customer_name LIKE ?1
         AND cancelled = 0
       ORDER BY shoot_date DESC
       LIMIT 5`
    )
      .bind(`%${customerName}%`)
      .all<{ booking_id: string; customer_name: string; shoot_date: string | null }>();

    const list = rows.results ?? [];
    if (list.length === 1) {
      bookingId = list[0].booking_id;
    } else if (list.length > 1) {
      candidates = list.map((r, i) => ({
        index: i + 1,
        booking_id: r.booking_id,
        customer_name: r.customer_name,
        shoot_date: r.shoot_date,
      }));
    }
  }

  // D1 INSERT
  const row = await env.DB.prepare(
    `INSERT INTO photo_uploads (booking_id, drive_file_id, file_name, file_size, width, height, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
     RETURNING id`
  )
    .bind(bookingId, driveFileId, fileName, arrayBuffer.byteLength, width, height)
    .first<{ id: number }>();

  if (!row) {
    await deleteFromDrive(accessToken, driveFileId);
    return jsonError(500, 'DB 저장 실패');
  }

  return Response.json({
    photo_id: row.id,
    drive_file_id: driveFileId,
    matched_booking_id: bookingId,
    candidates: candidates.length > 0 ? candidates : undefined,
    match_failed: bookingId === null && candidates.length === 0,
  });
}

// ─── POST /api/photos/batch-message ──────────────────────────────────────────

export async function handlePhotoBatchMessage(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  let body: {
    photo_ids: number[];
    has_unmatched?: boolean;
    candidates?: Array<{
      index: number;
      booking_id: string;
      customer_name: string;
      shoot_date: string | null;
    }>;
  };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, '잘못된 JSON');
  }
  if (!body.photo_ids?.length) return jsonError(400, 'photo_ids 필요');

  const photoIds = body.photo_ids;
  const placeholders = photoIds.map((_, i) => `?${i + 1}`).join(',');

  const photos = await env.DB.prepare(
    `SELECT id, file_name, booking_id FROM photo_uploads WHERE id IN (${placeholders})`
  )
    .bind(...photoIds)
    .all<{ id: number; file_name: string; booking_id: string | null }>();

  const photoList = photos.results ?? [];
  const matchedBookingId = photoList.find((p) => p.booking_id)?.booking_id ?? null;

  // 채팅 메시지 생성
  const msgRow = await env.DB.prepare(
    `INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
     VALUES ('system', ?1, ?2, datetime('now'))
     RETURNING id, created_at`
  )
    .bind(
      `📷 사진 ${photoIds.length}장 업로드`,
      JSON.stringify({
        type: 'photo_upload',
        photo_ids: photoIds,
        photo_count: photoIds.length,
        booking_id: matchedBookingId,
      })
    )
    .first<{ id: number; created_at: string }>();

  if (!msgRow) return jsonError(500, '채팅 메시지 저장 실패');

  // chat_message_id 역참조 저장
  const updatePlaceholders = photoIds.map((_, i) => `?${i + 2}`).join(',');
  await env.DB.prepare(
    `UPDATE photo_uploads SET chat_message_id = ?1 WHERE id IN (${updatePlaceholders})`
  )
    .bind(msgRow.id, ...photoIds)
    .run();

  // 2장 이상 배치 업로드 → 자동 그룹 생성
  if (photoIds.length > 1) {
    const groupId = crypto.randomUUID();
    for (let i = 0; i < photoIds.length; i++) {
      await env.DB.prepare(
        `UPDATE photo_uploads SET group_id = ?1, group_order = ?2 WHERE id = ?3`
      ).bind(groupId, i, photoIds[i]).run();
    }
  }

  // booking 후보 선택 카드
  if (body.candidates && body.candidates.length > 0) {
    await env.DB.prepare(
      `INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
       VALUES ('system', ?1, ?2, datetime('now'))`
    )
      .bind(
        '이 사진들을 어느 예약에 연결할까요?',
        JSON.stringify({
          type: 'photo_booking_candidates',
          photo_ids: photoIds,
          candidates: body.candidates,
        })
      )
      .run();
  }

  // 예약 매칭 실패 알림
  if (body.has_unmatched) {
    const failedNames = photoList
      .filter((p) => !p.booking_id)
      .map((p) => p.file_name)
      .join(', ');
    await env.DB.prepare(
      `INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
       VALUES ('system', ?1, ?2, datetime('now'))`
    )
      .bind(
        `⚠️ 예약을 찾지 못했습니다.\n파일명: ${failedNames}\n\n채팅에서 "이 사진 [고객명] 예약에 연결해줘" 라고 말씀해 주세요.`,
        JSON.stringify({ type: 'photo_unmatched', photo_ids: photoIds })
      )
      .run();
  }

  return Response.json({ message_id: msgRow.id, created_at: msgRow.created_at });
}

// ─── GET /api/photos/serve/:driveFileId ──────────────────────────────────────

export async function handlePhotoServe(
  _request: Request,
  env: Env,
  driveFileId: string
): Promise<Response> {
  const accessToken = await getValidAccessToken(env as any);
  if (!accessToken) {
    return new Response('Google 인증 필요', { status: 503 });
  }

  const res = await fetch(
    `${DRIVE_FILES_URL}/${encodeURIComponent(driveFileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!res.ok) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  const ct = res.headers.get('Content-Type');
  if (ct) headers.set('Content-Type', ct);
  headers.set('Cache-Control', 'private, max-age=3600');

  return new Response(res.body, { headers });
}

// ─── GET /api/photos/thumb/:photoId ──────────────────────────────────────────

export async function handlePhotoThumb(
  request: Request,
  env: Env,
  photoId: string
): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT drive_file_id FROM photo_uploads WHERE id = ?1`
  )
    .bind(parseInt(photoId, 10))
    .first<{ drive_file_id: string }>();

  if (!row) return new Response('Not found', { status: 404 });
  return handlePhotoServe(request, env, row.drive_file_id);
}

// ─── POST /api/photos/caption ─────────────────────────────────────────────────

export async function handlePhotoCaption(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  let body: { photo_id?: number; group_id?: string; caption: string };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, '잘못된 JSON');
  }
  if (!body.caption?.trim()) return jsonError(400, 'caption 필요');

  if (body.group_id) {
    await env.DB.prepare(
      `UPDATE photo_uploads SET caption = ${CAPTION_APPEND_SQL} WHERE group_id = ?2 AND group_order = 0`
    ).bind(body.caption.trim(), body.group_id).run();
  } else if (body.photo_id) {
    await env.DB.prepare(
      `UPDATE photo_uploads SET caption = ${CAPTION_APPEND_SQL} WHERE id = ?2`
    ).bind(body.caption.trim(), body.photo_id).run();
  } else {
    return jsonError(400, 'photo_id 또는 group_id 필요');
  }

  return Response.json({ ok: true });
}

// ─── POST /api/photos/group ───────────────────────────────────────────────────

export async function handlePhotoGroup(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  let body: { photo_ids: number[]; target_group_id?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, '잘못된 JSON');
  }
  if (!body.photo_ids?.length) return jsonError(400, 'photo_ids 필요');

  const groupId = body.target_group_id ?? crypto.randomUUID();

  const maxOrder = await env.DB.prepare(
    `SELECT COALESCE(MAX(group_order), -1) as max_order FROM photo_uploads WHERE group_id = ?1`
  )
    .bind(groupId)
    .first<{ max_order: number }>();

  let order = (maxOrder?.max_order ?? -1) + 1;
  for (const photoId of body.photo_ids) {
    await env.DB.prepare(
      `UPDATE photo_uploads SET group_id = ?1, group_order = ?2 WHERE id = ?3`
    ).bind(groupId, order++, photoId).run();
  }

  return Response.json({ ok: true, group_id: groupId });
}

// ─── POST /api/photos/ungroup-one ────────────────────────────────────────────

export async function handlePhotoUngroupOne(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  let body: { photo_id: number };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, '잘못된 JSON');
  }

  const photo = await env.DB.prepare(
    `SELECT group_id FROM photo_uploads WHERE id = ?1`
  )
    .bind(body.photo_id)
    .first<{ group_id: string | null }>();

  if (photo?.group_id) {
    await env.DB.prepare(
      `UPDATE photo_uploads SET group_id = NULL, group_order = 0 WHERE id = ?1`
    ).bind(body.photo_id).run();

    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM photo_uploads WHERE group_id = ?1`
    ).bind(photo.group_id).first<{ cnt: number }>();

    if ((remaining?.cnt ?? 0) <= 1) {
      await env.DB.prepare(
        `UPDATE photo_uploads SET group_id = NULL, group_order = 0 WHERE group_id = ?1`
      ).bind(photo.group_id).run();
    }
  }

  return Response.json({ ok: true });
}

// ─── DELETE /api/photos/group/:groupId ───────────────────────────────────────

export async function handlePhotoGroupDissolve(
  request: Request,
  env: Env,
  groupId: string
): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  await env.DB.prepare(
    `UPDATE photo_uploads SET group_id = NULL, group_order = 0 WHERE group_id = ?1`
  ).bind(groupId).run();

  return Response.json({ ok: true });
}

// ─── GET /api/photos/sets ─────────────────────────────────────────────────────

export async function handlePhotoSets(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  const sets = await env.DB.prepare(`
    SELECT
      pu.booking_id,
      b.customer_name,
      b.shoot_date,
      COUNT(pu.id) AS photo_count,
      SUM(pu.file_size) AS total_size,
      MIN(pu.created_at) AS first_uploaded,
      (SELECT COUNT(*) FROM insta_drafts d WHERE d.booking_id = pu.booking_id) AS draft_count,
      (SELECT COUNT(*) FROM insta_drafts d WHERE d.booking_id = pu.booking_id AND d.uploaded_at IS NOT NULL) AS uploaded_count
    FROM photo_uploads pu
    LEFT JOIN bookings b ON b.booking_id = pu.booking_id
    GROUP BY pu.booking_id
    ORDER BY first_uploaded ASC
  `).all<{
    booking_id: string | null;
    customer_name: string | null;
    shoot_date: string | null;
    photo_count: number;
    total_size: number;
    first_uploaded: string;
    draft_count: number;
    uploaded_count: number;
  }>();

  const result = await Promise.all(
    (sets.results ?? []).map(async (set) => {
      const q = set.booking_id
        ? env.DB.prepare(
            `SELECT id, drive_file_id, group_id, group_order, caption
             FROM photo_uploads WHERE booking_id = ?1
             ORDER BY group_id, group_order, id`
          ).bind(set.booking_id)
        : env.DB.prepare(
            `SELECT id, drive_file_id, group_id, group_order, caption
             FROM photo_uploads WHERE booking_id IS NULL
             ORDER BY group_id, group_order, id`
          );

      const photos = await q.all<{
        id: number;
        drive_file_id: string;
        group_id: string | null;
        group_order: number;
        caption: string | null;
      }>();

      return {
        ...set,
        photos: (photos.results ?? []).map((p) => ({
          ...p,
          thumb_url: `/api/photos/serve/${p.drive_file_id}`,
        })),
      };
    })
  );

  return Response.json({ sets: result });
}

// ─── GET /api/photos/storage ──────────────────────────────────────────────────

export async function handlePhotoStorage(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(file_size), 0) as total FROM photo_uploads`
  ).first<{ total: number }>();

  return Response.json({ total_bytes: row?.total ?? 0 });
}

// ─── DELETE /api/photos/booking/:bookingId ────────────────────────────────────

export async function handlePhotoSetDelete(
  request: Request,
  env: Env,
  bookingId: string
): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  const isUnmatched = bookingId === '__unmatched__';

  const photos = isUnmatched
    ? await env.DB.prepare(
        `SELECT drive_file_id FROM photo_uploads WHERE booking_id IS NULL`
      ).all<{ drive_file_id: string }>()
    : await env.DB.prepare(
        `SELECT drive_file_id FROM photo_uploads WHERE booking_id = ?1`
      ).bind(bookingId).all<{ drive_file_id: string }>();

  const accessToken = await getValidAccessToken(env as any);
  if (accessToken) {
    await Promise.all(
      (photos.results ?? []).map((p) => deleteFromDrive(accessToken, p.drive_file_id))
    );
  }

  if (isUnmatched) {
    await env.DB.prepare(`DELETE FROM photo_uploads WHERE booking_id IS NULL`).run();
  } else {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM insta_drafts WHERE booking_id = ?1`).bind(bookingId),
      env.DB.prepare(`DELETE FROM photo_uploads WHERE booking_id = ?1`).bind(bookingId),
    ]);
  }

  return Response.json({ ok: true, deleted: photos.results?.length ?? 0 });
}

// ─── POST /api/photos/booking-link ───────────────────────────────────────────

export async function handlePhotoBookingLink(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  let body: { photo_ids: number[]; booking_id: string };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, '잘못된 JSON');
  }
  if (!body.photo_ids?.length || !body.booking_id) {
    return jsonError(400, 'photo_ids, booking_id 필요');
  }

  const placeholders = body.photo_ids.map((_, i) => `?${i + 2}`).join(',');
  await env.DB.prepare(
    `UPDATE photo_uploads SET booking_id = ?1 WHERE id IN (${placeholders})`
  ).bind(body.booking_id, ...body.photo_ids).run();

  const booking = await env.DB.prepare(
    `SELECT customer_name FROM bookings WHERE booking_id = ?1`
  ).bind(body.booking_id).first<{ customer_name: string }>();

  return Response.json({ ok: true, customer_name: booking?.customer_name });
}

// ─── DELETE /api/photos/photo/:photoId ───────────────────────────────────────

export async function handlePhotoDelete(
  request: Request,
  env: Env,
  photoId: string,
): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  const row = await env.DB.prepare(
    `SELECT drive_file_id, group_id FROM photo_uploads WHERE id = ?1`
  ).bind(parseInt(photoId, 10)).first<{ drive_file_id: string; group_id: string | null }>();

  if (!row) return jsonError(404, '사진을 찾을 수 없습니다');

  const accessToken = await getValidAccessToken(env as any);
  if (accessToken) await deleteFromDrive(accessToken, row.drive_file_id);

  await env.DB.prepare(`DELETE FROM photo_uploads WHERE id = ?1`).bind(parseInt(photoId, 10)).run();

  // 그룹에 1장 이하 남으면 그룹 해제
  if (row.group_id) {
    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM photo_uploads WHERE group_id = ?1`
    ).bind(row.group_id).first<{ cnt: number }>();
    if ((remaining?.cnt ?? 0) <= 1) {
      await env.DB.prepare(
        `UPDATE photo_uploads SET group_id = NULL, group_order = 0 WHERE group_id = ?1`
      ).bind(row.group_id).run();
    }
  }

  return Response.json({ ok: true });
}

// ─── DELETE /api/photos/group-all/:groupId ───────────────────────────────────

export async function handlePhotoGroupAllDelete(
  request: Request,
  env: Env,
  groupId: string,
): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  const photos = await env.DB.prepare(
    `SELECT drive_file_id FROM photo_uploads WHERE group_id = ?1`
  ).bind(groupId).all<{ drive_file_id: string }>();

  const accessToken = await getValidAccessToken(env as any);
  if (accessToken) {
    await Promise.all(
      (photos.results ?? []).map((p) => deleteFromDrive(accessToken, p.drive_file_id))
    );
  }

  await env.DB.prepare(`DELETE FROM photo_uploads WHERE group_id = ?1`).bind(groupId).run();

  return Response.json({ ok: true, deleted: photos.results?.length ?? 0 });
}
