import {env,applyD1Migrations} from 'cloudflare:test';
import {beforeAll,beforeEach,afterEach,it,expect,vi} from 'vitest';
import {processEmail} from '../src/webapp/lib/email-processor';
beforeAll(()=>applyD1Migrations(env.DB,env.TEST_MIGRATIONS));
beforeEach(async()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-07T03:00:00Z'));await env.DB.prepare('DELETE FROM processed_emails').run();await env.DB.prepare('DELETE FROM ai_chat_messages').run();});
afterEach(()=>vi.useRealTimers());
const mail:any={id:'retry-test',payload:{headers:[{name:'Subject',value:'other notification'},{name:'Date',value:'Tue, 06 Oct 2026 21:40:51 +0900'}],mimeType:'text/plain',body:{data:btoa('test body')}}};
it('retries a saved transient failure and replaces it with success',async()=>{
 await env.DB.prepare("INSERT INTO processed_emails(message_id,email_type,processing_result,error_message) VALUES ('retry-test','unknown','error','D1_ERROR: Network connection lost.')").run();
 const result=await processEmail({DB:env.DB},mail);
 expect(result.result).toBe('success');
 const saved=await env.DB.prepare("SELECT processing_result,error_message FROM processed_emails WHERE message_id='retry-test'").first<any>();
 expect(saved.processing_result).toBe('success');expect(saved.error_message).toBeNull();
 expect((await processEmail({DB:env.DB},mail)).result).toBe('duplicate');
});

it('finishes historical recovery without generating booking actions or changing an existing booking',async()=>{
 const body='예약자명 한*은님\n예약신청 일시 2026.08.15. 19:06:05\n예약번호 1324088472\n예약상품 가족사진(클래식)\n이용일시 2026.08.21.(금) 오전 10:00\n결제상태 결제완료\n결제수단 신용카드 간편결제\n선택메뉴 클래식 가족사진 220,000원 = 220,000원\n결제금액 220,000원';
 await env.DB.prepare("INSERT OR IGNORE INTO bookings (booking_id,customer_name,shoot_date,reservation_date,current_stage,created_at,updated_at) VALUES ('1324088472','한혜은','2026-08-21 10:00:00','2026-08-15','S6',datetime('now'),datetime('now'))").run();
 await env.DB.prepare("INSERT INTO processed_emails(message_id,email_type,processing_result,error_message) VALUES ('historical-retry','confirm','error','D1_ERROR: Network connection lost.')").run();
 const message:any={...mail,id:'historical-retry',payload:{...mail.payload,headers:[{name:'Subject',value:'[네이버 예약] 마음껏 스튜디오 새로운 예약이 확정 되었습니다.'}],body:{data:btoa(String.fromCharCode(...new TextEncoder().encode(body)))}}};
 expect((await processEmail({DB:env.DB},message)).result).toBe('success');
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM ai_chat_messages').first<number>('n')).toBe(0);
 expect(await env.DB.prepare("SELECT current_stage FROM bookings WHERE booking_id='1324088472'").first<string>('current_stage')).toBe('S6');
 expect((await processEmail({DB:env.DB},message)).result).toBe('duplicate');
});
it('a failure before processing is recorded and remains eligible for the next run',async()=>{
 let fail=true;
 const db={prepare(sql:string){if(fail&&sql.startsWith('SELECT message_id')){fail=false;throw new Error('D1_ERROR: Network connection lost.');}return env.DB.prepare(sql);}} as D1Database;
 expect((await processEmail({DB:db},mail)).result).toBe('error');
 expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM ai_chat_messages WHERE json_extract(metadata,'$.type')='email_retry_pending'").first<number>('n')).toBe(1);
 expect((await processEmail({DB:env.DB},mail)).result).toBe('success');
});
it('a recovered mail overlapping a manual booking is held without a second booking',async()=>{
 const body='예약자명 박*나님\n예약신청 일시 2026.10.06. 21:40:38\n예약번호 1372220570\n예약상품 아기사진(전통상)\n이용일시 2026.10.29.(목) 오후 12:00\n결제상태 결제완료\n결제수단 신용카드 간편결제\n선택메뉴 전통상 아기사진 220,000원 = 220,000원\n결제금액 220,000원';
 await env.DB.prepare("INSERT OR IGNORE INTO bookings (booking_id,customer_name,shoot_date,reservation_date,created_at,updated_at) VALUES ('MANUAL_RETRY_TEST','박서나','2026-10-29 12:00:00','2026-10-06',datetime('now'),datetime('now'))").run();
 const message:any={...mail,id:'manual-conflict',payload:{...mail.payload,headers:[{name:'Subject',value:'[네이버 예약] 마음껏 스튜디오 새로운 예약이 확정 되었습니다.'}],body:{data:btoa(String.fromCharCode(...new TextEncoder().encode(body)))}}};
 const result=await processEmail({DB:env.DB},message);
 expect(result.result).toBe('parse_failed');
 expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM bookings WHERE booking_id='1372220570'").first<number>('n')).toBe(0);
 expect(await env.DB.prepare("SELECT error_message FROM processed_emails WHERE message_id='manual-conflict'").first<string>('error_message')).toBe('MANUAL_BOOKING_CONFLICT');
});

