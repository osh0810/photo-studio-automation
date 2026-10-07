import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
test('starts despite a stale reused PID, avoids duplicate launches, and recovers after exit',async()=>{
 const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const root=await mkdtemp(join(tmpdir(),'maum-runner-test-'));let child;
 const ready=async()=>{for(let i=0;i<50;i++){try{await fetch(`http://127.0.0.1:${port}/`);return;}catch{await new Promise(r=>setTimeout(r,100));}}throw new Error('Test worker did not start');};
 try {
  await mkdir(join(root,'scripts'));
  const starter=(await readFile(new URL('../scripts/edge-start-template.mjs',import.meta.url),'utf8')).replace('127.0.0.1:18766',`127.0.0.1:${port}`);
  await writeFile(join(root,'start.mjs'),starter);
  await writeFile(join(root,'runner-runtime.mjs'),'export function runtimeEnv(){return process.env;}');
  await writeFile(join(root,'scripts/watch-edge-confirmations.mjs'),`import{createServer}from'node:http';createServer((q,r)=>r.end('test')).listen(${port},'127.0.0.1');`);
  await writeFile(join(root,'runner.pid'),String(process.pid));
  const start=()=>exec(process.execPath,[join(root,'start.mjs')],{windowsHide:true});
  await start();child=Number(await readFile(join(root,'runner.pid'),'utf8'));assert.notEqual(child,process.pid);await ready();
  await start();assert.equal(Number(await readFile(join(root,'runner.pid'),'utf8')),child);
  process.kill(child);child=undefined;await new Promise(r=>setTimeout(r,300));
  await start();child=Number(await readFile(join(root,'runner.pid'),'utf8'));await ready();
 }finally{if(child){try{process.kill(child);}catch{}}await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
