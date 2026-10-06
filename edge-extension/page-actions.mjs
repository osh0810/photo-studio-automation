/** Runs only in the two permitted Naver partner origins, with no desktop input. */
export async function pageAction(operation,args={}) {
  try {
  const visible=el=>!!el&&el.getClientRects().length>0;
  const text=el=>el?.textContent?.trim()||'';
  const wait=async(read,ms=15000)=>{const end=Date.now()+ms;do{const value=read();if(value)return value;await new Promise(r=>setTimeout(r,250));}while(Date.now()<end);throw new Error('PAGE_NOT_READY');};
  if(document.querySelector('input[type="password"]')||/보안을 위해 추가 확인|자동입력 방지|보호조치/.test(document.body.innerText))throw new Error('LOGIN_REQUIRED');
  if(operation==='reservation'){
    if(location.hostname!=='partner.booking.naver.com'||!location.pathname.endsWith('/bookings/'+args.bookingId))throw new Error('WRONG_RESERVATION');
    const scope=await wait(()=>document.querySelector('[class*="SideFrame__root__"]'));
    return await wait(()=>{const items=[...scope.querySelectorAll('[class*="Summary__item__"]')];
    const item=items.find(el=>[...el.children].some(child=>text(child)==='예약번호'));
    const bookingId=text(item?.querySelector('[class*="Summary__item-dsc__"]'));
    const fullName=text(scope.querySelector('[class*="Summary__name__"]'));
    if(bookingId!==args.bookingId||!/^[가-힣A-Za-z][가-힣A-Za-z ]{1,15}$/.test(fullName))return false;
    return {bookingId,fullName};});
  }
  if(location.hostname!=='partner.talk.naver.com'||!/^\/chat\/ct\/w4vwob\/[A-Za-z0-9]+/.test(location.pathname))throw new Error('WRONG_CONVERSATION');
  for(const button of document.querySelectorAll('button'))if(visible(button)&&text(button)==='닫기')button.click();
  if(operation==='verify'){
    const tabs=[...document.querySelectorAll('button,a,li,span,div')].filter(el=>visible(el)&&text(el)==='예약이력');
    if(tabs.length)tabs.at(-1).click();
    await wait(()=>{
      const links=[...document.querySelectorAll('a[href*="/booking-list-view/bookings/"]')];
      if(links.some(a=>{const url=new URL(a.href);return ['partner.booking.naver.com','m-partner.booking.naver.com'].includes(url.hostname)&&url.pathname===`/bizes/745146/booking-list-view/bookings/${args.bookingId}`;}))return true;
      // Reservation history shows an exact booking number even when its card has no anchor.
      return new RegExp(`예약번호\\s*[:：]?\\s*${args.bookingId}(?!\\d)`).test(document.body.innerText);
    });
    await wait(()=>document.querySelector('#partner_chat_write'));
    return true;
  }
  const messages=()=>[...document.querySelectorAll('li[data-sender="partner"] p.title_content')].map(el=>text(el));
  if(operation==='has_confirmation')return messages().some(message=>/님\s+아래\s+내용으로\s+예약\s+완료되셨습니다/.test(message)&&new RegExp(`예약번호\\s*[:：]\\s*${args.bookingId}(?!\\d)`).test(message));
  if(operation!=='send'||typeof args.message!=='string'||!args.message||args.message.length>2000)throw new Error('INVALID_MESSAGE');
  const input=await wait(()=>document.querySelector('#partner_chat_write'));
  const button=document.querySelector('button.chat_write_btn');
  if(!button)throw new Error('SEND_CONTROL_MISSING');
  const before=messages().filter(message=>message===args.message.trim()).length;
  const descriptor=Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value');
  descriptor.set.call(input,args.message);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  await wait(()=>!button.disabled,3000);
  button.click();
  await wait(()=>messages().filter(message=>message===args.message.trim()).length>before,20000);
  return true;
  } catch(error) {return {error:error.message};}
}

/** Capture the reservation's own Talk URL without opening a foreground popup. */
export async function captureConversation() {
  try {
  if(location.hostname!=='partner.booking.naver.com')throw new Error('WRONG_RESERVATION');
  const scope=document.querySelector('[class*="SideFrame__root__"]');
  const buttons=[...scope?.querySelectorAll('button')||[]].filter(el=>el.textContent.trim()==='톡톡 대화하기');
  if(buttons.length!==1)throw new Error('TALK_BUTTON_MISSING');
  const original=window.open;
  let captured;
  window.open=function(url){if(typeof url==='string')captured=new URL(url,location.href).href;return {focus(){},close(){},closed:false};};
  try {
    buttons[0].click();
    const end=Date.now()+5000;
    while(!captured&&Date.now()<end)await new Promise(r=>setTimeout(r,100));
    if(!captured)throw new Error('TALK_URL_MISSING');
    const url=new URL(captured);
    if(url.protocol!=='https:'||url.hostname!=='partner.talk.naver.com'||!(/^\/chat\/ct\/w4vwob\/[A-Za-z0-9]+\/?$/.test(url.pathname)||/^\/ct\/partner\/w4vwob\/chat\/[A-Za-z0-9]+\/popup$/.test(url.pathname)))return {error:'WRONG_CONVERSATION',route:url.origin+url.pathname};
    return url.href;
  }finally{window.open=original;}
  }catch(error){return {error:error.message};}
}
