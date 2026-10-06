import test from 'node:test';
import assert from 'node:assert/strict';
import {pageAction,captureConversation} from '../edge-extension/page-actions.mjs';
function environment(t,hostname='partner.booking.naver.com'){
 const old={location:globalThis.location,document:globalThis.document,window:globalThis.window};
 globalThis.location={hostname,pathname:'/bizes/745146/booking-list-view/bookings/1371639565',href:'https://'+hostname};
 globalThis.document={querySelector:()=>null,body:{innerText:''}};
 globalThis.window={open(){throw new Error('unexpected popup');}};
 t.after(()=>Object.assign(globalThis,old));
}
test('security challenge stops before accessing send controls',async t=>{environment(t);document.body.innerText='보안을 위해 추가 확인';assert.deepEqual(await pageAction('send',{message:'안내'}),{error:'LOGIN_REQUIRED'});});
test('wrong booking number cannot pass reservation validation',async t=>{environment(t);assert.deepEqual(await pageAction('reservation',{bookingId:'1371251146'}),{error:'WRONG_RESERVATION'});});
test('captured popup uses exact partner account and always restores window.open',async t=>{
 environment(t);const original=window.open;
 document.querySelector=()=>({querySelectorAll:()=>[{textContent:'톡톡 대화하기',click(){window.open('https://partner.talk.naver.com/chat/ct/w4vwob/bKzsN?mode=popup');}}]});
 assert.match(await captureConversation(),/w4vwob\/bKzsN/);assert.equal(window.open,original);
});
test('unexpected popup destination is rejected without opening a native window',async t=>{
 environment(t);const original=window.open;
 document.querySelector=()=>({querySelectorAll:()=>[{textContent:'톡톡 대화하기',click(){window.open('https://evil.example/');}}]});
 assert.deepEqual(await captureConversation(),{error:'WRONG_CONVERSATION',route:'https://evil.example/'});assert.equal(window.open,original);
});

test('reservation waits for customer data after the side frame appears',async t=>{
 environment(t);let reads=0;
 const name={textContent:'김윤영'};
 const item={children:[{textContent:'예약번호'}],querySelector:()=>({textContent:'1371639565'})};
 const scope={querySelectorAll:()=>++reads<2?[]:[item],querySelector:()=>name};
 document.querySelector=selector=>selector.includes('SideFrame')?scope:null;
 assert.deepEqual(await pageAction('reservation',{bookingId:'1371639565'}),{bookingId:'1371639565',fullName:'김윤영'});
 assert.ok(reads>=2);
});


test('reservation Talk popup launch route is accepted for the same partner account',async t=>{
 environment(t);document.querySelector=()=>({querySelectorAll:()=>[{textContent:'톡톡 대화하기',click(){window.open('https://partner.talk.naver.com/ct/partner/w4vwob/chat/bKzsN/popup');}}]});
 assert.equal(await captureConversation(),'https://partner.talk.naver.com/ct/partner/w4vwob/chat/bKzsN/popup');
});
