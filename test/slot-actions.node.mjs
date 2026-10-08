import {test} from 'node:test';
import assert from 'node:assert/strict';
import {slotAction} from '../edge-extension/slot-actions.mjs';
import {processSlotClosure} from '../scripts/lib/slot-closure-worker.mjs';
function fixture(t,{wrongDate=false,ambiguous=false}={}){
 const old={document:globalThis.document,location:globalThis.location};t.after(()=>Object.assign(globalThis,old));
 const date={textContent:wrongDate?'26. 10. 9. 금':'26. 11. 1. 일',getClientRects:()=>[{}]};
 const toggles=[];const input=(checked)=>({checked,disabled:false,click(){this.checked=!this.checked;toggles.push(this);}});
 const matching=input(true),closed=input(false),otherHour=input(true);
 const mkrow=(name,current)=>({children:Array.from({length:25},(_,i)=>({querySelectorAll:()=>i===11?(ambiguous?[current,current]:[current]):i===12?[otherHour]:[]})),querySelector:selector=>selector.includes('title')?{textContent:name}:null});
 const header={children:[{textContent:'종일'},...Array.from({length:24},(_,i)=>({textContent:String(i).padStart(2,'0')+':00'}))],querySelector:selector=>selector.includes('time')?{}:null};
 const rows=[header,mkrow('상품A',matching),mkrow('상품B',closed)];
 globalThis.location={hostname:'partner.booking.naver.com',pathname:'/bizes/745146/simple-management'};
 globalThis.document={body:{innerText:''},querySelector:s=>s.includes('date-info')?date:null,querySelectorAll:s=>s.includes('management-row')?rows:s.includes('title')?[{},{}]:[]};
 return {matching,closed,otherHour,toggles};
}
test('closes only the exact hour and skips already closed products; verification is read-only',async t=>{
 const f=fixture(t);assert.deepEqual(await slotAction('close_slots',{shootDate:'2026-11-01 10:00:00'}),{verified:false,total:2});
 assert.equal(f.matching.checked,false);assert.equal(f.otherHour.checked,true);assert.equal(f.toggles.length,1);
 assert.deepEqual(await slotAction('verify_slots',{shootDate:'2026-11-01 10:00:00'}),{verified:true,total:2});assert.equal(f.toggles.length,1);
});
test('ambiguous cells fail before changing any switch',async t=>{
 const f=fixture(t,{ambiguous:true});assert.deepEqual(await slotAction('close_slots',{shootDate:'2026-11-01 10:00:00'}),{error:'AMBIGUOUS_SLOT_TIME'});assert.equal(f.toggles.length,0);
});
test('waits for a temporarily disabled switch before closing it',async t=>{
 const f=fixture(t);f.matching.disabled=true;
 setTimeout(()=>{f.matching.disabled=false;},650);
 assert.deepEqual(await slotAction('close_slots',{shootDate:'2026-11-01 10:00:00'}),{verified:false,total:2});
 assert.equal(f.toggles.length,1);
});
test('unsupported minutes fail without closing the whole hour',async t=>{
 const f=fixture(t);assert.deepEqual(await slotAction('close_slots',{shootDate:'2026-11-01 10:30:00'}),{error:'UNSUPPORTED_SLOT_TIME'});assert.equal(f.toggles.length,0);
});
test('calendar selection ignores the outer root containing both months',async t=>{
 const f=fixture(t,{wrongDate:true});
 const doc=globalThis.document, read=doc.querySelector, readAll=doc.querySelectorAll;
 const date=read('date-info');date.click=()=>{};
 let selected=false;
 const day={disabled:false,querySelector:()=>({textContent:'12'}),click(){setTimeout(()=>{selected=true;},0);}};
 const month={getClientRects:()=>[{}],querySelector:()=>({textContent:'2026.11'}),querySelectorAll:s=>s.includes('monthly-top')?[{}]:[day]};
 const outer={...month,querySelectorAll:s=>s.includes('monthly-top')?[{},{}]:[day,day]};
 doc.querySelector=s=>s.includes('layer-calendar')?{getClientRects:()=>[]}:read(s);
 doc.querySelectorAll=s=>s.includes('Calendar__root__')?[outer,month]:s==='button'?[{textContent:'적용',getClientRects:()=>[{}],click(){assert.equal(selected,true);date.textContent='26. 11. 12. 목';}}]:readAll(s);
 assert.deepEqual(await slotAction('close_slots',{shootDate:'2026-11-12 10:00:00'}),{verified:false,total:2});
 assert.equal(f.matching.checked,false);
});
test('closure failure is recorded separately and never invokes customer sending',async()=>{
 const calls=[];const api=async(method,data)=>{calls.push(data);return data.action==='claim_slot_closure'?{job:{booking_id:'1234567890',shoot_date:'2026-11-01 10:00:00',claim_id:'claim'}}:{};};
 await processSlotClosure({api,close:async()=>{throw new Error('Browser interrupted');}});
 assert.deepEqual(calls.map(c=>c.action),['claim_slot_closure','complete_slot_closure']);assert.equal(calls[1].status,'failed');
});
