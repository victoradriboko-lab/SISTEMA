import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

test('aplicativo sem login: empresa fixa, autorização restrita, reenvio seguro, revogação e limites',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'servitec-support-')),child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',CLIENT_PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});let db;
 try{
  const [line]=await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Servidor não iniciou');})]);const ports=line.toString().match(/porta (\d+); Painel do Cliente na porta (\d+)/);
  const call=async(path,method='GET',body,token='',cookie='',portal=false)=>{const r=await fetch(`http://127.0.0.1:${ports[portal?2:1]}/api/${path}`,{method,headers:{'Content-Type':'application/json',Authorization:token?'Bearer '+token:'',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const password='Teste-Aplicativo-2026';await call('setup','POST',{name:'Admin',email:'admin@example.test',password});const admin=(await call('login','POST',{email:'admin@example.test',password})).cookie;
  const a=(await call('clients','POST',{name:'Empresa Alpha'},'',admin)).data,b=(await call('clients','POST',{name:'Empresa Beta'},'',admin)).data,machineId=randomUUID();
  assert.equal((await call('agent/support/enroll','POST',{machineId,name:'PC-ALPHA'})).status,401);
  const enrolled=await call('agent/support/enroll','POST',{machineId,name:'PC-ALPHA'},a.token);assert.equal(enrolled.status,201);assert.equal(enrolled.data.companyName,'Empresa Alpha');const secret=enrolled.data.supportToken;assert.match(secret,/^[a-f0-9]{64}$/);assert.notEqual(secret,a.token);
  const request={requestId:randomUUID(),requester:'Ana',email:'ana@example.test',title:'Impressora parou',description:'Não imprime na recepção.'};
  assert.equal((await call('agent/support/tickets','POST',request,a.token)).status,401);
  assert.equal((await call('agent/support/tickets','POST',request,secret,'',true)).status,401);
  assert.equal((await call('agent/support/tickets','POST',{...request,clientId:b.id},secret)).status,403);
  const created=await call('agent/support/tickets','POST',request,secret);assert.equal(created.status,201);assert.equal(created.cookie,undefined);
  const repeated=await call('agent/support/tickets','POST',request,secret);assert.equal(repeated.status,200);assert.equal(repeated.data.id,created.data.id);assert.equal(repeated.data.duplicate,true);
  assert.equal((await call('agent/support/tickets','POST',{...request,title:'Mudou'},secret)).status,409);
  const tickets=(await call('tickets','GET',undefined,'',admin)).data;assert.equal(tickets.length,1);assert.equal(tickets[0].client_id,a.id);assert.equal(tickets[0].priority,'Média');assert.equal(tickets[0].operator_id,null);assert.match(tickets[0].description,/PC-ALPHA/);assert.match(tickets[0].description,/não autenticado individualmente/);
  assert.equal((await call('tickets','GET',undefined,secret)).status,401);assert.equal((await call('me','GET',undefined,secret)).status,401);assert.equal((await call('portal/tickets','GET',undefined,secret,'',true)).status,401);
  db=new DatabaseSync(join(dir,'sistema.db'));assert.equal(db.prepare('SELECT count(*) AS n FROM email_senders').get().n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM email_outbox').get().n,0);assert.notEqual(db.prepare('SELECT key_hash FROM support_devices').get().key_hash,secret);assert.ok(!JSON.stringify(db.prepare('SELECT * FROM activity').all()).includes(secret));
  const devices=(await call('support-devices','GET',undefined,'',admin)).data;assert.equal(devices[0].active,1);assert.ok(!JSON.stringify(devices).includes(secret));assert.ok(!JSON.stringify(devices).includes(a.token));
  await call('support-devices/'+devices[0].id+'/revoke','POST',{},'',admin);assert.equal((await call('agent/check','GET',undefined,a.token)).status,200);assert.equal((await call('agent/support/tickets','POST',{...request,requestId:randomUUID()},secret)).status,401);
  const reenrolled=(await call('agent/support/enroll','POST',{machineId,name:'PC-ALPHA'},a.token)).data;assert.notEqual(reenrolled.supportToken,secret);assert.equal((await call('agent/support/tickets','POST',{...request,requestId:randomUUID()},secret)).status,401);
  for(let i=0;i<9;i++)assert.equal((await call('agent/support/tickets','POST',{...request,requestId:randomUUID()},reenrolled.supportToken)).status,201);
  assert.equal((await call('agent/support/tickets','POST',{...request,requestId:randomUUID()},reenrolled.supportToken)).status,429);
  await call('clients/'+a.id+'/token','POST',{password},'',admin);assert.equal((await call('agent/support/tickets','POST',{...request,requestId:randomUUID()},reenrolled.supportToken)).status,401);assert.equal((await call('support-devices','GET',undefined,'',admin)).data[0].active,0);
 }finally{db?.close();if(child.exitCode===null){child.kill();await once(child,'exit');}rmSync(dir,{recursive:true,force:true});}
});
