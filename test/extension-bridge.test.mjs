import test from 'node:test';
import assert from 'node:assert/strict';
import {createExtensionBridge} from '../scripts/lib/extension-bridge.mjs';
const origin='chrome-extension://'+ 'a'.repeat(32);
async function setup(t,options={}){
 const bridge=createExtensionBridge(options);
 await new Promise(resolve=>bridge.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+bridge.server.address().port;
 t.after(()=>bridge.close());
 const html=await (await fetch(base)).text();
 const code=html.match(/<code>(\d{6})<\/code>/)?.[1];
 const send=(path,body,token,customOrigin=origin)=>fetch(base+path,{method:body?'POST':'GET',headers:{origin:customOrigin,authorization:token||'','content-type':'application/json'},body:body?JSON.stringify(body):undefined});
 const pair=await send('/pair',{code});assert.equal(pair.status,200);
 const {token}=await pair.json();return {bridge,send,token,base};
}
test('pairing binds one extension, is paused, and survives supplied saved state',async t=>{
 let saved;
 const {bridge,send,token}=await setup(t,{onPaired:async state=>{saved=state;}});
 assert.equal(bridge.enabled(),false);assert.equal(bridge.connected(),true);
 assert.equal((await send('/command',undefined,token,'chrome-extension://'+'b'.repeat(32))).status,401);
 assert.equal((await send('/control',{enabled:true},token)).status,200);assert.equal(saved.enabled,true);
 const restart=createExtensionBridge({initialState:saved});assert.equal(restart.enabled(),true);restart.close();
});
test('ordinary websites cannot pair or invoke browser commands',async t=>{
 const {send,token}=await setup(t);
 assert.equal((await send('/command',undefined,token,'https://evil.example')).status,403);
 assert.equal((await send('/command',undefined,'bad')).status,401);
 assert.equal((await send('/pair',{code:'000000'},token)).status,403);
 assert.equal((await send('/control',{enabled:'yes'},token)).status,400);
});
test('issued input is not reissued after a lost response, result must match random id',async t=>{
 const {bridge,send,token}=await setup(t);
 const result=bridge.command('send',{message:'승인된 안내'});
 const first=await (await send('/command',undefined,token)).json();assert.equal(first.command.operation,'send');
 const second=await (await send('/command',undefined,token)).json();assert.equal(second.command,null);
 assert.equal((await send('/result',{id:'wrong',result:true},token)).status,409);
 assert.equal((await send('/result',{id:first.command.id,result:true},token)).status,200);
 assert.equal(await result,true);
 assert.equal((await send('/result',{id:first.command.id,result:true},token)).status,409);
});
test('security verification is propagated as LOGIN_REQUIRED and timeout does not retry',async t=>{
 const {bridge,send,token}=await setup(t);
 const result=bridge.command('reservation');
 const rejection=assert.rejects(result,{code:'LOGIN_REQUIRED'});
 const {command}=await (await send('/command',undefined,token)).json();
 await send('/result',{id:command.id,error:'LOGIN_REQUIRED'},token);await rejection;
 await assert.rejects(bridge.command('send',{},10),/응답/);
 assert.equal((await (await send('/command',undefined,token)).json()).command,null);
});
test('no pairing occurs from expired code or non-ASCII lookalike',async t=>{
 let time=0;const bridge=createExtensionBridge({now:()=>time});
 await new Promise(resolve=>bridge.server.listen(0,'127.0.0.1',resolve));t.after(()=>bridge.close());
 const base='http://127.0.0.1:'+bridge.server.address().port;
 const html=await(await fetch(base)).text();const code=html.match(/<code>(\d{6})<\/code>/)[1];
 const pair=code=>fetch(base+'/pair',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({code})});
 assert.equal((await pair('가'.repeat(6))).status,403);time=600001;assert.equal((await pair(code)).status,403);
});
test('local diagnostics need an origin and nonce, even with a paired extension',async t=>{
 const {send,token,base}=await setup(t);
 assert.equal((await send('/diagnose',{},token)).status,403);
 assert.equal((await fetch(base+'/diagnose',{method:'POST',headers:{origin:base}})).status,403);
});
test('Origin-less extension GET still needs paired identity and token',async t=>{
 const {base,token}=await setup(t);
 assert.equal((await fetch(base+'/command',{headers:{'x-extension-origin':origin,authorization:token}})).status,200);
 assert.equal((await fetch(base+'/command',{headers:{'x-extension-origin':origin,authorization:'wrong'}})).status,401);
 assert.equal((await fetch(base+'/command',{headers:{origin:'https://evil.example','x-extension-origin':origin,authorization:token}})).status,403);
 assert.equal((await fetch(base+'/command',{headers:{'x-extension-origin':'chrome-extension://'+'b'.repeat(32),authorization:token}})).status,403);
});
