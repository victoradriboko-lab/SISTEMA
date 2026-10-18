import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
test('cadastro, autenticação, chamados, inventário e telemetria',async()=>{
const dir=mkdtempSync(join(tmpdir(),'sistema-test-'));
const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,CLIENT_PORT:'0',PORT:'3199',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
let cookie='';
const call=async(path,method='GET',data,headers={})=>{const r=await fetch('http://127.0.0.1:3199/api/'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie,...headers},body:data?JSON.stringify(data):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};};
try{
await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(Error('Startup timeout')),5000).unref())]);
assert.equal((await call('tickets')).status,401);
assert.equal((await call('setup','POST',{name:'Admin',email:'admin@example.test',password:'a-test-password-123'})).status,201);
assert.equal((await call('setup','POST',{})).status,409);
assert.equal((await call('login','POST',{email:'admin@example.test',password:'wrong'})).status,401);
const login=await call('login','POST',{email:'admin@example.test',password:'a-test-password-123'});assert.equal(login.status,200);cookie=login.cookie.split(';')[0];
assert.equal((await call('tickets','POST',{title:'Rede indisponível',description:'Teste funcional',priority:'Alta'})).status,201);
const list=await call('tickets');assert.equal(list.body.length,1);assert.equal(list.body[0].title,'Rede indisponível');
assert.equal((await call('tickets/'+list.body[0].id,'PATCH',{status:'Resolvido'})).status,200);
assert.equal((await call('tickets')).body[0].status,'Resolvido');
assert.equal((await call('tickets','POST',{title:'x',priority:'Alta'},{Origin:'https://attacker.invalid'})).status,403);
const asset=await call('assets','POST',{name:'PC teste',owner:'TI',os:'Linux'});assert.equal(asset.status,201);
assert.equal((await call('heartbeat','POST',{cpu:1},{Authorization:'Bearer invalid'})).status,401);
assert.equal((await call('heartbeat','POST',{cpu:1,os:'Linux'},{Authorization:'Bearer '+asset.body.token})).status,200);
const assets=await call('assets');assert.ok(assets.body[0].last_seen);assert.equal('token' in assets.body[0],false);
assert.equal((await call('logout','POST')).status,200);assert.equal((await call('tickets')).status,401);
}finally{child.kill();await once(child,'exit');rmSync(dir,{recursive:true,force:true});}
});
