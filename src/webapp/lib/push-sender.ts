/**
 * Phase 3 Step 7: Web Push 실제 발송 (RFC 8291 aes128gcm + RFC 8292 VAPID).
 *
 * Cloudflare Workers는 npm web-push를 사용할 수 없어 crypto.subtle로 직접
 * 구현. JWT는 ES256 (P-256 ECDSA), 페이로드는 ECDH P-256 + HKDF-SHA-256 +
 * AES-128-GCM.
 *
 * 호출자(cron-handler 등)는 try/catch로 감싸 발송 실패가 본 흐름을 막지
 * 않도록 한다.
 */

interface Env {
	DB: D1Database;
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	VAPID_SUBJECT?: string;
	[key: string]: unknown;
}

export interface PushPayload {
	title: string;
	body: string;
	data?: Record<string, unknown>;
	tag?: string;
	requires_confirmation?: boolean;
}

interface SubscriptionRow {
	id: number;
	user_email: string;
	endpoint: string;
	keys_p256dh: string;
	keys_auth: string;
}

// ─── 헬퍼: base64url 인코딩/디코딩 ─────────────────────────────────────

function base64UrlEncode(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

function base64UrlDecode(s: string): Uint8Array {
	let str = s.replace(/-/g, '+').replace(/_/g, '/');
	while (str.length % 4) str += '=';
	const bin = atob(str);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
	const total = arrays.reduce((sum, a) => sum + a.length, 0);
	const result = new Uint8Array(total);
	let offset = 0;
	for (const a of arrays) {
		result.set(a, offset);
		offset += a.length;
	}
	return result;
}

async function hmacSha256(
	key: Uint8Array,
	data: Uint8Array,
): Promise<Uint8Array> {
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		key,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const sig = await crypto.subtle.sign('HMAC', cryptoKey, data);
	return new Uint8Array(sig);
}

function jwkToUncompressed(jwk: JsonWebKey): Uint8Array {
	if (!jwk.x || !jwk.y) throw new Error('JWK missing x or y');
	const x = base64UrlDecode(jwk.x);
	const y = base64UrlDecode(jwk.y);
	return concatBytes(new Uint8Array([0x04]), x, y);
}

// ─── VAPID 키 import (JWK 형식) ───────────────────────────────────────

async function importVapidPrivateKey(
	privateKeyB64Url: string,
	publicKeyB64Url: string,
): Promise<CryptoKey> {
	const publicKeyBytes = base64UrlDecode(publicKeyB64Url);
	if (publicKeyBytes.length !== 65 || publicKeyBytes[0] !== 0x04) {
		throw new Error(
			`Invalid VAPID public key (expected uncompressed 65 bytes starting with 0x04, got ${publicKeyBytes.length} bytes)`,
		);
	}
	const x = base64UrlEncode(publicKeyBytes.slice(1, 33));
	const y = base64UrlEncode(publicKeyBytes.slice(33, 65));

	return await crypto.subtle.importKey(
		'jwk',
		{
			kty: 'EC',
			crv: 'P-256',
			d: privateKeyB64Url,
			x,
			y,
			ext: true,
		},
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['sign'],
	);
}

// ─── VAPID JWT (ES256) ────────────────────────────────────────────────

async function jwtSign(env: Env, audience: string): Promise<string> {
	const header = { typ: 'JWT', alg: 'ES256' };
	const now = Math.floor(Date.now() / 1000);
	const claims = {
		aud: audience,
		exp: now + 12 * 3600,
		sub: env.VAPID_SUBJECT!,
	};

	const enc = new TextEncoder();
	const headerB64 = base64UrlEncode(enc.encode(JSON.stringify(header)));
	const claimsB64 = base64UrlEncode(enc.encode(JSON.stringify(claims)));
	const signingInput = `${headerB64}.${claimsB64}`;

	const privateKey = await importVapidPrivateKey(
		env.VAPID_PRIVATE_KEY!,
		env.VAPID_PUBLIC_KEY!,
	);

	// WebCrypto ECDSA는 IEEE P1363 (r||s, 64B) 형식 — JWT ES256 그대로 사용 가능.
	const sigBuf = await crypto.subtle.sign(
		{ name: 'ECDSA', hash: 'SHA-256' },
		privateKey,
		enc.encode(signingInput),
	);

	const signatureB64 = base64UrlEncode(new Uint8Array(sigBuf));
	return `${signingInput}.${signatureB64}`;
}

// ─── RFC 8291 페이로드 암호화 (aes128gcm) ─────────────────────────────

async function encryptPayload(
	payload: Uint8Array,
	subscriptionP256dhB64: string,
	subscriptionAuthB64: string,
): Promise<Uint8Array> {
	// 1. 클라이언트 공개키 + auth secret
	const clientPublicKeyBytes = base64UrlDecode(subscriptionP256dhB64);
	if (
		clientPublicKeyBytes.length !== 65 ||
		clientPublicKeyBytes[0] !== 0x04
	) {
		throw new Error(
			`Invalid subscription p256dh (expected uncompressed 65 bytes, got ${clientPublicKeyBytes.length})`,
		);
	}
	const authSecret = base64UrlDecode(subscriptionAuthB64);

	// 2. 임시 server keypair
	const serverKeyPair = (await crypto.subtle.generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		true,
		['deriveBits'],
	)) as CryptoKeyPair;

	// 3. ECDH 공유 비밀
	const clientPubKey = await crypto.subtle.importKey(
		'raw',
		clientPublicKeyBytes,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[],
	);
	const sharedSecretBuf = await crypto.subtle.deriveBits(
		{ name: 'ECDH', public: clientPubKey } as any,
		serverKeyPair.privateKey,
		256,
	);
	const sharedSecret = new Uint8Array(sharedSecretBuf);

	// 4. 서버 공개키(uncompressed 65B)
	const serverPubJwk = (await crypto.subtle.exportKey(
		'jwk',
		serverKeyPair.publicKey,
	)) as JsonWebKey;
	const serverPublicKey = jwkToUncompressed(serverPubJwk);

	// 5. salt
	const salt = crypto.getRandomValues(new Uint8Array(16));

	// 6. HKDF (RFC 8291 §3.4)
	//    PRK_key = HMAC(authSecret, sharedSecret)
	const prkKey = await hmacSha256(authSecret, sharedSecret);

	//    key_info = "WebPush: info" || 0x00 || ua_pub || as_pub
	//    IKM      = HMAC(PRK_key, key_info || 0x01)
	const keyInfo = concatBytes(
		new TextEncoder().encode('WebPush: info\0'),
		clientPublicKeyBytes,
		serverPublicKey,
	);
	const ikm = await hmacSha256(
		prkKey,
		concatBytes(keyInfo, new Uint8Array([0x01])),
	);

	//    PRK = HMAC(salt, IKM)
	const prk = await hmacSha256(salt, ikm);

	//    CEK   = HMAC(PRK, "Content-Encoding: aes128gcm" || 0x00 || 0x01)[0..16]
	const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
	const cekFull = await hmacSha256(
		prk,
		concatBytes(cekInfo, new Uint8Array([0x01])),
	);
	const cek = cekFull.slice(0, 16);

	//    NONCE = HMAC(PRK, "Content-Encoding: nonce" || 0x00 || 0x01)[0..12]
	const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
	const nonceFull = await hmacSha256(
		prk,
		concatBytes(nonceInfo, new Uint8Array([0x01])),
	);
	const nonce = nonceFull.slice(0, 12);

	// 7. 패딩 (단일 레코드 끝 마커 0x02)
	const padded = concatBytes(payload, new Uint8Array([0x02]));

	// 8. AES-128-GCM 암호화 (auth tag 자동 16B 추가)
	const aesKey = await crypto.subtle.importKey(
		'raw',
		cek,
		{ name: 'AES-GCM' },
		false,
		['encrypt'],
	);
	const ctBuf = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: nonce },
		aesKey,
		padded,
	);
	const ciphertext = new Uint8Array(ctBuf);

	// 9. RFC 8188 본문: salt(16) || rs(4 BE) || idlen(1) || keyid(idlen) || ct
	//    rs = 4096 (record size), idlen = 65, keyid = serverPublicKey
	const rs = new Uint8Array([0x00, 0x00, 0x10, 0x00]); // 4096 BE
	const idlen = new Uint8Array([serverPublicKey.length]);

	return concatBytes(salt, rs, idlen, serverPublicKey, ciphertext);
}

// ─── 단일 구독 발송 ────────────────────────────────────────────────────

async function sendToSubscription(
	env: Env,
	sub: SubscriptionRow,
	payload: PushPayload,
): Promise<{ ok: boolean; expired: boolean; status: number }> {
	const url = new URL(sub.endpoint);
	const audience = `${url.protocol}//${url.host}`;

	const jwt = await jwtSign(env, audience);
	const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
	const body = await encryptPayload(payloadBytes, sub.keys_p256dh, sub.keys_auth);

	const res = await fetch(sub.endpoint, {
		method: 'POST',
		headers: {
			Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
			'Content-Type': 'application/octet-stream',
			'Content-Encoding': 'aes128gcm',
			TTL: '86400',
		},
		body,
	});

	if (res.status === 201 || res.status === 204) {
		console.log(`[push-sender] subscription_id=${sub.id} status=sent (${res.status})`);
		return { ok: true, expired: false, status: res.status };
	}
	if (res.status === 410 || res.status === 404) {
		console.log(`[push-sender] subscription_id=${sub.id} expired (${res.status})`);
		return { ok: false, expired: true, status: res.status };
	}

	const errText = await res.text().catch(() => '');
	console.error(
		`[push-sender] subscription_id=${sub.id} failed status=${res.status} body=${errText.slice(0, 200)}`,
	);
	return { ok: false, expired: false, status: res.status };
}

// ─── 메인 ──────────────────────────────────────────────────────────────

export async function sendPushNotification(
	env: Env,
	userEmail: string,
	payload: PushPayload,
): Promise<{ attempted: number; sent: number; failed: number }> {
	if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
		console.log('[push-sender] VAPID 키 미설정 — skip');
		return { attempted: 0, sent: 0, failed: 0 };
	}

	const subs = await env.DB.prepare(
		`SELECT id, user_email, endpoint, keys_p256dh, keys_auth
		 FROM push_subscriptions
		 WHERE user_email = ?1`,
	)
		.bind(userEmail)
		.all<SubscriptionRow>();

	const list = subs.results || [];
	if (list.length === 0) {
		console.log(`[push-sender] 구독 없음 (email=${userEmail}) — skip`);
		return { attempted: 0, sent: 0, failed: 0 };
	}

	console.log(
		`[push-sender] sending to ${list.length} subscriptions email=${userEmail}`,
	);

	let sent = 0;
	let failed = 0;
	const expiredIds: number[] = [];

	const results = await Promise.allSettled(
		list.map((sub) => sendToSubscription(env, sub, payload)),
	);

	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		const sub = list[i];
		if (r.status === 'fulfilled') {
			if (r.value.expired) {
				expiredIds.push(sub.id);
				failed++;
			} else if (r.value.ok) {
				sent++;
			} else {
				failed++;
			}
		} else {
			failed++;
			console.error(
				`[push-sender] subscription_id=${sub.id} error:`,
				r.reason,
			);
		}
	}

	if (expiredIds.length > 0) {
		const placeholders = expiredIds.map((_, i) => `?${i + 1}`).join(',');
		await env.DB.prepare(
			`DELETE FROM push_subscriptions WHERE id IN (${placeholders})`,
		)
			.bind(...expiredIds)
			.run();
		console.log(
			`[push-sender] expired ${expiredIds.length} subscriptions removed`,
		);
	}

	console.log(
		`[push-sender] result: sent=${sent}, failed=${failed}, expired=${expiredIds.length}`,
	);

	return { attempted: list.length, sent, failed };
}
