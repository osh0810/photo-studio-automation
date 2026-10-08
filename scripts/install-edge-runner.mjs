import {mkdir,copyFile,readFile,writeFile,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const targetArg=process.argv.find(arg=>arg.startsWith('--target='));
if(!targetArg)throw new Error('기존 실행기 경로 --target=... 이 필요합니다.');
const target=resolve(targetArg.slice(9));
const root=fileURLToPath(new URL('../',import.meta.url));
await access(join(target,'runner-runtime.mjs'));
try{const pid=Number(await readFile(join(target,'runner.pid'),'utf8'));process.kill(pid,0);throw new Error('기존 실행기를 중지한 뒤 설치해주세요.');}catch(error){if(error.code!=='ESRCH'&&error.code!=='ENOENT')throw error;}
await mkdir(join(target,'scripts/lib'),{recursive:true});
for(const file of ['scripts/watch-edge-confirmations.mjs','scripts/keep-awake.ps1','scripts/lib/extension-bridge.mjs','scripts/lib/approval-worker.mjs','scripts/lib/confirmation-runner.mjs','scripts/lib/slot-closure-worker.mjs'])await copyFile(join(root,file),join(target,file));
const starter=await readFile(new URL('./edge-start-template.mjs',import.meta.url),'utf8');
await copyFile(join(target,'start-runner.mjs'),join(target,'start-runner-playwright.backup.mjs'));
await writeFile(join(target,'start-runner.mjs'),starter);
console.log('Edge 확장 실행기를 설치했습니다. 기존 시작 바로가기는 그대로 사용하며, 확장 연결 전에는 발송하지 않습니다.');
