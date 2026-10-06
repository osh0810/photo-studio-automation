import {pageAction,captureConversation} from './page-actions.mjs';
const local='http://127.0.0.1:18766';
let running=false;
async function request(path,body){
  const {token}=await chrome.storage.local.get('token');
  const response=await fetch(local+path,{method:body?'POST':'GET',headers:{authorization:token||'','content-type':'application/json','x-extension-origin':chrome.runtime.getURL('').replace(/\/$/,'')},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('LOCAL_CONNECTION');
  return response.json();
}
async function page(tabId,func,args=[],world='ISOLATED'){
  const tab=await chrome.tabs.get(tabId);
  if(tab.url?.startsWith('https://nid.naver.com/')||tab.url?.includes('/nidlogin.'))throw new Error('LOGIN_REQUIRED');
  const results=await chrome.scripting.executeScript({target:{tabId},func,args,world});
  const result=results[0]?.result;
  if(result===undefined)throw new Error('PAGE_ACTION_FAILED');
  if(result?.error)throw Object.assign(new Error(result.error),{route:result.route});
  return result;
}
async function ready(tabId){
  const end=Date.now()+30000;
  while(Date.now()<end){const tab=await chrome.tabs.get(tabId);if(tab.status==='complete')return;await new Promise(r=>setTimeout(r,500));}
  throw new Error('PAGE_LOAD_TIMEOUT');
}
async function execute(command){
  const {reservationTab,conversationTab}=await chrome.storage.session.get(['reservationTab','conversationTab']);
  const {operation,args}=command;
  if(operation==='reservation'){
    if(!/^\d{10}$/.test(args.bookingId))throw new Error('WRONG_RESERVATION');
    const tab=await chrome.tabs.create({url:`https://partner.booking.naver.com/bizes/745146/booking-list-view/bookings/${args.bookingId}`,active:false});
    await chrome.storage.session.set({reservationTab:tab.id});await ready(tab.id);
    return page(tab.id,pageAction,['reservation',args]);
  }
  if(operation==='conversation'){
    if(!reservationTab)throw new Error('NO_RESERVATION');
    const url=await page(reservationTab,captureConversation,[],'MAIN');
    const tab=await chrome.tabs.create({url,active:false});
    await chrome.storage.session.set({conversationTab:tab.id});await ready(tab.id);return true;
  }
  if(!conversationTab||!['verify','has_confirmation','send'].includes(operation))throw new Error('INVALID_OPERATION');
  return page(conversationTab,pageAction,[operation,args]);
}
async function tick(){
  if(running)return;running=true;
  try{
    const {token}=await chrome.storage.local.get('token');if(!token)return;
    const end=Date.now()+240000;let idle=0;
    while(Date.now()<end&&idle<3){
      const {command,enabled}=await request('/command');
      await chrome.storage.local.set({enabled,lastCheck:Date.now()});
      if(!command){idle++;await new Promise(r=>setTimeout(r,1500));continue;}
      idle=0;
      // Persist before input; an interrupted worker never repeats an issued command.
      await chrome.storage.session.set({lastCommand:command.id});
      try{const result=await execute(command);await request('/result',{id:command.id,result});await chrome.storage.local.set({status:'연결 정상'});}
      catch(error){const login=/LOGIN_REQUIRED/.test(error.message);await request('/result',{id:command.id,error:login?'LOGIN_REQUIRED':'BROWSER_ERROR',detail:/^[A-Z_]+$/.test(error.message)?error.message:'EXTENSION_ERROR',route:error.route});await chrome.storage.local.set({status:login?'네이버 로그인 또는 보안 확인 필요':'처리 결과 확인 필요'});}
    }
  }catch{await chrome.storage.local.set({status:'PC 실행기 연결 필요'});}
  finally{running=false;}
}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='booking')void tick();});
chrome.runtime.onInstalled.addListener(()=>chrome.alarms.create('booking',{periodInMinutes:0.5}));
chrome.runtime.onStartup.addListener(()=>chrome.alarms.create('booking',{periodInMinutes:0.5}));
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(message.action==='tick'){void tick();reply({ok:true});return;}
  if(message.action==='control'){request('/control',{enabled:message.enabled}).then(reply,()=>reply({error:true}));return true;}
});
void chrome.alarms.get('booking').then(alarm=>{if(!alarm)return chrome.alarms.create('booking',{periodInMinutes:0.5});});
