import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('cadastros validam vínculos, preservam arquivos e registros e isolam permissões',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'registrations-'));let child,base,portal;
 const start=async()=>{child=spawn(process.execPath,['server.mjs'],{env:{...process.env,DATA_DIR:dir,HOST:'127.0.0.1',PORT:'0',CLIENT_PORT:'0'},stdio:['ignore','pipe','pipe']});const [out]=await once(child.stdout,'data');const ports=out.toString().match(/porta (\d+); Painel do Cliente na porta (\d+)/);base='http://127.0.0.1:'+ports[1];portal='http://127.0.0.1:'+ports[2];};
 const stop=async()=>{const exited=once(child,'exit');child.kill();await exited;child=null;};
 const call=async(path,method='GET',body,cookie='',origin=base)=>{const response=await fetch(origin+'/api/'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
 try{
  await start();const password='Teste123';await call('setup','POST',{name:'Admin',email:'admin@example.test',password});const admin=(await call('login','POST',{email:'admin@example.test',password})).cookie;const company=(await call('clients','POST',{name:'Empresa existente'},admin)).data;
  const team=await call('registrations/teams','POST',{name:'Equipe TI',data:{memberIds:[1],leaderId:1,notes:'Preservar'}},admin);assert.equal(team.status,201);
  assert.equal((await call('registrations/teams','POST',{name:'Inválida',data:{memberIds:[999],leaderId:null}},admin)).status,400);
  assert.equal((await call('registrations/departments','POST',{name:'Financeiro',data:{clientId:company.id,contact:'Ana',email:'ana@example.test'}},admin)).status,201);
  assert.equal((await call('registrations/holidays','POST',{name:'Inválido',data:{date:'2026-02-30',annual:false}},admin)).status,400);
  const holiday=await call('registrations/holidays','POST',{name:'Natal',data:{date:'2026-12-25',annual:true}},admin);assert.equal(holiday.status,201);
  assert.equal((await call('registrations/schedules','POST',{name:'Comercial',data:{weekdays:[1,2,3,4,5],startHour:8,endHour:17,zone:'America/Sao_Paulo'}},admin)).status,201);
  assert.equal((await call('registrations/schedules','POST',{name:'Inválido',data:{weekdays:[8],startHour:18,endHour:8,zone:'invalid'}},admin)).status,400);
  const doc=await call('registrations/documents','POST',{name:'Manual',data:{content:'Texto original',clientId:company.id,url:'https://example.test/manual'},file:{filename:'manual.txt',base64:Buffer.from('Arquivo original').toString('base64')}},admin);assert.equal(doc.status,201);
  const filePath=base+'/api/registrations/documents/'+doc.data.id+'/file';const file=await fetch(filePath,{headers:{Cookie:admin}});assert.equal(file.status,200);assert.equal(await file.text(),'Arquivo original');
  assert.equal((await call('registrations/documents/'+doc.data.id,'PUT',{name:'Manual atualizado',data:{content:'Texto editado',clientId:company.id}},admin)).status,200);assert.equal(await (await fetch(filePath,{headers:{Cookie:admin}})).text(),'Arquivo original');
  assert.equal((await call('registrations/documents','POST',{name:'Link inválido',data:{url:'javascript:alert(1)'}},admin)).status,400);
  assert.equal((await call('registrations/teams/'+team.data.id,'PATCH',{active:false},admin)).status,200);let teams=(await call('registrations/teams','GET',undefined,admin)).data.rows;assert.equal(teams.length,1);assert.equal(teams[0].active,0);assert.equal(teams[0].data.notes,'Preservar');
  await call('users','POST',{name:'Consulta',email:'viewer@example.test',role:'viewer',password},admin);const viewer=(await call('login','POST',{email:'viewer@example.test',password})).cookie;assert.equal((await call('registrations/teams','GET',undefined,viewer)).status,403);assert.equal((await call('registrations/documents','GET',undefined,viewer)).data.canWrite,false);assert.equal((await call('registrations/holidays/'+holiday.data.id,'PATCH',{active:false},viewer)).status,403);
  await call('client-access','POST',{name:'Cliente',email:'client@example.test',password,clientId:company.id},admin);const customer=(await call('login','POST',{email:'client@example.test',password},'',portal)).cookie;assert.equal((await call('registrations/documents','GET',undefined,customer,portal)).status,403);
  const snapshot=(await call('registrations/documents','GET',undefined,admin)).data.rows;await stop();await start();assert.deepEqual((await call('registrations/documents','GET',undefined,admin)).data.rows,snapshot);assert.equal((await call('clients','GET',undefined,admin)).data[0].name,'Empresa existente');assert.equal((await call('users','GET',undefined,admin)).data.find(u=>u.id===1).email,'admin@example.test');
 }finally{if(child)await stop();rmSync(dir,{recursive:true,force:true});}
});
