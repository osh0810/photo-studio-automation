const status=document.getElementById('status');
async function refresh(){const state=await chrome.storage.local.get(['status','enabled','token']);status.textContent=state.token?`${state.status||'연결됨'}\n자동 처리: ${state.enabled?'켜짐':'중지'}`:'PC 실행기 연결 코드를 입력해주세요.';}
document.getElementById('pair').onclick=async()=>{
  try{const response=await fetch('http://127.0.0.1:18766/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:document.getElementById('code').value.trim()})});if(!response.ok)throw new Error();const {token}=await response.json();await chrome.storage.local.set({token,enabled:false,status:'연결됨'});await chrome.runtime.sendMessage({action:'tick'});await refresh();}
  catch{status.textContent='연결 코드와 PC 실행기를 확인해주세요. 코드가 만료되면 실행기를 다시 시작해주세요.';}
};
async function control(enabled){try{const result=await chrome.runtime.sendMessage({action:'control',enabled});if(result.error)throw new Error();await chrome.storage.local.set({enabled});await chrome.runtime.sendMessage({action:'tick'});await refresh();}catch{status.textContent='PC 실행기 연결을 확인해주세요.';}}
document.getElementById('enable').onclick=()=>control(true);
document.getElementById('pause').onclick=()=>control(false);
void refresh();
