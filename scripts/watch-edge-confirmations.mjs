import { writeFile,readFile } from 'node:fs/promises';
import {spawn} from 'node:child_process';
import { createExtensionBridge } from './lib/extension-bridge.mjs';
import { processApprovedJob } from './lib/approval-worker.mjs';
import { runConfirmation } from './lib/confirmation-runner.mjs';
const base = process.env.STUDIO_API_BASE;
const token = process.env.ADMIN_TOKEN;
if (!base || !token) throw new Error('기존 실행기 API 설정이 필요합니다.');
const endpoint = new URL('/admin/booking-confirmation',base);
if (endpoint.protocol !== 'https:') throw new Error('HTTPS API가 필요합니다.');
async function api(method,data) {
  const url=new URL(endpoint);
  if(method==='GET')url.search=new URLSearchParams(data).toString();
  const response=await fetch(url,{method,redirect:'error',headers:{authorization:token,'content-type':'application/json'},body:method==='POST'?JSON.stringify(data):undefined,signal:AbortSignal.timeout(30000)});
  const result=await response.json();
  if(!response.ok)throw new Error('운영 API 처리 실패');
  return result;
}
let busy=false,stopping=false,loginStatus='unknown';
process.on('exit',code=>console.error(`${new Date().toISOString()} [runner exit] code=${code}`));
process.on('uncaughtExceptionMonitor',error=>console.error(`${new Date().toISOString()} [runner fatal] code=${error.code || error.name}`));
const pairingState=JSON.parse(await readFile('edge-pairing.json','utf8').catch(()=>'{}'));
const bridge=createExtensionBridge({initialState:pairingState,onRequest:state=>{void writeFile('edge-transport-state.json',JSON.stringify({...state,at:new Date().toISOString()})).catch(()=>{});},onPaired:state=>writeFile('edge-pairing.json',JSON.stringify(state)),onControl:async(action)=>{
  if(action==='diagnose'&&!busy){
    busy=true;
    try {const customer=await browser.openReservation('1371639565');await browser.openConversation();await browser.verifyConversation('1371639565');await writeFile('edge-diagnostic.json',JSON.stringify({status:'verified',bookingId:customer.bookingId,customerName:customer.fullName,checkedAt:new Date().toISOString(),sent:false}));}
    catch(error){await writeFile('edge-diagnostic.json',JSON.stringify({status:error.code==='LOGIN_REQUIRED'?'login_required':'failed',code:error.code,detail:error.detail,operation:error.operation,route:error.route,sent:false}));}
    finally{busy=false;}
  }
}});
const browser={
  openReservation:bookingId=>bridge.command('reservation',{bookingId}),
  openConversation:()=>bridge.command('conversation'),
  verifyConversation:async bookingId=>{await bridge.command('verify',{bookingId});loginStatus='ready';await api('POST',{action:'runner_status',status:'ready'});},
  hasConfirmation:bookingId=>bridge.command('has_confirmation',{bookingId}),
  sendMessage:message=>bridge.command('send',{message}),
};
await new Promise((resolve,reject)=>{bridge.server.once('error',reject);bridge.server.listen(18766,'127.0.0.1',resolve);});
let awake;
if(process.platform==='win32'){
 const script=await readFile(new URL('./keep-awake.ps1',import.meta.url),'utf8');
 awake=spawn('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',`& { ${script} } -RunnerProcessId ${process.pid}`],{windowsHide:true,stdio:'ignore'});
 awake.on('error',()=>console.error('절전 방지 요청 실패'));
}
function stop(){stopping=true;bridge.close();awake?.kill();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
console.log('일반 Edge 확장 프로그램 연결을 기다립니다. 자동 처리는 확장에서 켜야 시작됩니다.');
while(!stopping){
  if(!busy&&bridge.connected()&&bridge.enabled()){
    busy=true;
    try {
      const processed=await processApprovedJob({api,run:(bookingId,messageKind)=>runConfirmation({bookingId,messageKind,api,browser,dryRun:false})});
      if(processed?.loginRequired){loginStatus='login_required';await bridge.pause();await api('POST',{action:'runner_status',status:'login_required'});}
      await writeFile('runner-state.json',JSON.stringify({connected:true,mode:'edge_extension',paused:!bridge.enabled(),loginStatus,lastPoll:new Date().toISOString(),processed}));
    }catch(error){
      console.error(`${new Date().toISOString()} [runner connection error] code=${error.cause?.code || error.code || error.name}`);
      await writeFile('runner-state.json',JSON.stringify({connected:false,mode:'edge_extension',lastPoll:new Date().toISOString()}));
    }
    finally{busy=false;}
  }else if(!busy){await writeFile('runner-state.json',JSON.stringify({connected:bridge.connected(),mode:'edge_extension',paused:!bridge.enabled(),loginStatus,lastPoll:new Date().toISOString()}));}
  await new Promise(resolve=>setTimeout(resolve,15000));
}
