/** Injected into the paired Naver page; no credentials or network APIs are used. */
export async function slotAction(operation,args={}) {
 try {
  if(location.hostname!=='partner.booking.naver.com'||location.pathname!=='/bizes/745146/simple-management')throw new Error('WRONG_MANAGEMENT');
  if(document.querySelector('input[type="password"]')||/보안을 위해 추가 확인|자동입력 방지|보호조치/.test(document.body.innerText))throw new Error('LOGIN_REQUIRED');
  const match=/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):00(?::00)?$/.exec(args.shootDate||'');
  if(!match||!['close_slots','verify_slots'].includes(operation))throw new Error('UNSUPPORTED_SLOT_TIME');
  const [year,month,day,hour]=match.slice(1).map(Number);
  if(month<1||month>12||day<1||day>31||hour>23)throw new Error('INVALID_SLOT_DATE');
  const text=e=>e?.textContent.trim()||'';
  const visible=e=>e&&e.getClientRects().length>0;
  const wait=async(read,label='SLOT_PAGE_NOT_READY')=>{const end=Date.now()+15000;do{const v=read();if(v)return v;await new Promise(r=>setTimeout(r,200));}while(Date.now()<end);throw new Error(label);};
  const dateText=`${String(year).slice(-2)}. ${month}. ${day}.`;
  const dateElement=()=>document.querySelector('a[class*="DatePeriodCalendar__date-info__"]');
  if(!text(dateElement()).startsWith(dateText)){
   (await wait(dateElement)).click();
   let selected=false;
   for(let i=0;i<24;i++){
    const roots=await wait(()=>{const list=[...document.querySelectorAll('[class*="Calendar__root__"]')].filter(root=>visible(root)&&root.querySelectorAll('[class*="Calendar__monthly-top__"]').length===1);return list.length?list:false;});
    const target=roots.find(root=>text(root.querySelector('[class*="Calendar__monthly-top__"]'))===`${year}.${month}`);
    if(target){
     const buttons=[...target.querySelectorAll('button[class*="Calendar__btn-day__"]')].filter(b=>Number(text(b.querySelector('[class*="Calendar__num__"]')))===day);
     if(buttons.length!==1||buttons[0].disabled)throw new Error('SLOT_DAY_UNAVAILABLE');
     buttons[0].click();await new Promise(r=>setTimeout(r,500));selected=true;break;
    }
    const first=text(roots[0].querySelector('[class*="Calendar__monthly-top__"]')).split('.').map(Number);
    const direction=year*12+month<first[0]*12+first[1]?'이전 달':'다음 달';
    const button=[...document.querySelectorAll('button')].find(b=>visible(b)&&text(b)===direction);
    if(!button)throw new Error('SLOT_MONTH_UNAVAILABLE');
    const before=text(roots[0].querySelector('[class*="Calendar__monthly-top__"]'));button.click();
    await wait(()=>text(document.querySelector('[class*="Calendar__monthly-top__"]'))!==before);
   }
   if(!selected)throw new Error('SLOT_MONTH_UNAVAILABLE');
   const apply=[...document.querySelectorAll('button')].find(b=>visible(b)&&text(b)==='적용');
   if(!apply)throw new Error('SLOT_DATE_CONTROL_MISSING');apply.click();
   await wait(()=>text(dateElement()).startsWith(dateText),'SLOT_DATE_NOT_APPLIED');
   await wait(()=>!document.querySelector('[class*="DatePeriodCalendar__layer-calendar__"]')?.getClientRects().length,'SLOT_CALENDAR_NOT_CLOSED');
  }
  await wait(()=>[...document.querySelectorAll('[class*="SimpleManagement__title__"]')].length>0);
  // Give the date change request time to mount its loading indicator, then wait for completion.
  await new Promise(r=>setTimeout(r,500));
  await wait(()=>![...document.querySelectorAll('[class*="Loading__load_area_wrapper__"]')].some(visible),'SLOT_LOADING_TIMEOUT');
  const collect=()=>{
   if(!text(dateElement()).startsWith(dateText))throw new Error('WRONG_SLOT_DATE');
   const rows=[...document.querySelectorAll('[class*="SimpleManagement__management-row__"]')];
   const header=rows.find(r=>r.querySelector('[class*="SimpleManagement__time__"]'));
   const times=[...header?.children||[]].map(text);
   if(times.length!==25||times[hour+1]!==`${String(hour).padStart(2,'0')}:00`)throw new Error('AMBIGUOUS_SLOT_COLUMNS');
   const targets=[];
   for(const row of rows.filter(r=>r.querySelector('[class*="SimpleManagement__title__"]'))){
    if(row.children.length!==25)throw new Error('AMBIGUOUS_SLOT_ROW');
    const cell=row.children[hour+1];const inputs=[...cell.querySelectorAll('input[role="switch"]')];
    if(inputs.length>1)throw new Error('AMBIGUOUS_SLOT_TIME');
    if(!inputs.length)continue; // Product has no session at this exact start time.

    targets.push({name:text(row.querySelector('[class*="SimpleManagement__title__"]')),input:inputs[0]});
   }
   if(!targets.length)throw new Error('NO_MATCHING_SLOTS');
   if(new Set(targets.map(t=>t.name)).size!==targets.length)throw new Error('AMBIGUOUS_SLOT_PRODUCT');
   return targets;
  };
  const targets=collect();
  if(operation==='close_slots'){
   for(const target of targets){
    const current=collect().find(t=>t.name===target.name);
    if(!current)throw new Error('SLOT_PRODUCT_CHANGED');
    if(!current.input.checked)continue;
    await wait(()=>!collect().find(t=>t.name===target.name)?.input.disabled,'SLOT_CONTROL_DISABLED');
    collect().find(t=>t.name===target.name).input.click();
    await wait(()=>{const after=collect().find(t=>t.name===target.name);return after&&!after.input.checked;},'SLOT_SWITCH_NOT_SAVED');
   }
  }
  const after=collect();
  if(after.some(t=>t.input.checked))throw new Error('SLOT_NOT_CLOSED');
  return {verified:operation==='verify_slots',total:after.length};
 }catch(error){return {error:error.message};}
}
