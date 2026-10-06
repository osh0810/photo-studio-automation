import {openSync,readFileSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runtimeEnv} from './runner-runtime.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
try{const pid=Number(readFileSync(root+'runner.pid','utf8'));if(pid>0){process.kill(pid,0);console.log('예약 실행기가 이미 켜져 있습니다.');process.exit(0);}}catch{}
const output=openSync(root+'runner.log','a');
const child=spawn(process.execPath,['scripts/watch-edge-confirmations.mjs'],{cwd:root,env:runtimeEnv(),detached:true,windowsHide:true,stdio:['ignore',output,output]});
writeFileSync(root+'runner.pid',String(child.pid));child.unref();
console.log('일반 Edge 확장 연결 실행기를 시작했습니다. 확장에서 자동 처리를 켜면 승인 건을 처리합니다.');
