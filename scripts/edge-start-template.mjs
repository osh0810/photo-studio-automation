import {openSync,writeFileSync,appendFileSync,mkdirSync,statSync,rmdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runtimeEnv} from './runner-runtime.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
// A reused PID can belong to a different program. Check the actual loopback service.
try {await fetch('http://127.0.0.1:18766/',{signal:AbortSignal.timeout(4000)});console.log('예약 실행기가 이미 켜져 있습니다.');process.exit(0);}catch{}
const lock=root+'start.lock';
try {mkdirSync(lock);}catch(error){
 if(error.code!=='EEXIST')throw error;
 if(Date.now()-statSync(lock).mtimeMs<60000)process.exit(0);
 try{rmdirSync(lock);mkdirSync(lock);}catch{process.exit(0);}
}
try {
const output=openSync(root+'runner.log','a');
const child=spawn(process.execPath,['scripts/watch-edge-confirmations.mjs'],{cwd:root,env:runtimeEnv(),detached:true,windowsHide:true,stdio:['ignore',output,output]});
child.once('error',error=>appendFileSync(root+'runner.log',`${new Date().toISOString()} [start failed] ${error.code || 'UNKNOWN'}\n`));
writeFileSync(root+'runner.pid',String(child.pid));child.unref();
appendFileSync(root+'runner.log',`${new Date().toISOString()} [start] pid=${child.pid}\n`);
console.log('일반 Edge 확장 연결 실행기를 시작했습니다. 확장에서 자동 처리를 켜면 승인 건을 처리합니다.');
}finally{rmdirSync(lock);}
