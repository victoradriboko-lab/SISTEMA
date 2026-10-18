import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
test('token por empresa: cadastro automático, filtro, duplicados, união, isolamento e revogação',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sistema-clients-')),child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'3222',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 const call=async(path,method='GET',body,headers={})=>{const r=await fetch('http://127.0.0.1:3222/api/'+path,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const sample=(machineId,name='PC-01',inventory=true)=>({schemaVersion:1,sampleId:randomUUID(),observedAt:new Date().toISOString(),agent:{platform:'windows',version:'1.0.0',machineId},metrics:{cpuPercent:25},...(inventory?{inventory:{hostname:name}}:{})});
 try{
 await Promise.race([once(child.stdout,'data'),new Promise((_,r)=>setTimeout(()=>r(Error('Timeout')),5000).unref())]);
 const password='Cliente-Token-Teste-2026';await call('setup','POST',{name:'Admin',email:'admin@example.test',password});const login=await call('login','POST',{email:'admin@example.test',password}),admin={Cookie:login.cookie};
 const a=await call('clients','POST',{name:'Empresa A'},admin),b=await call('clients','POST',{name:'Empresa B'},admin);assert.equal(a.status,201);assert.equal((await call('clients','POST',{name:'empresa a'},admin)).status,409);
 const auth={Authorization:'Bearer '+a.data.token},authB={Authorization:'Bearer '+b.data.token};
 assert.equal((await call('agent/check','GET',undefined,auth)).data.client.id,a.data.id);
 assert.equal((await call('heartbeat','POST',{os:'legacy'},auth)).status,400);
 const m1=randomUUID(),m2=randomUUID();assert.equal((await call('heartbeat','POST',sample(m1,'PC-01',false),auth)).data.requestInventory,true);
 await call('heartbeat','POST',sample(m1),auth);await call('heartbeat','POST',sample(m2),auth);await call('heartbeat','POST',sample(m1),authB);
 let rows=(await call('assets?clientId='+a.data.id,'GET',undefined,admin)).data;assert.equal(rows.length,2);assert.ok(rows.every(r=>r.client_id===a.data.id&&r.duplicate_of));assert.ok(rows.every(r=>!('token' in r)));
 assert.equal((await call('assets?clientId='+b.data.id,'GET',undefined,admin)).data.length,1);
 const keep=rows[0],remove=rows[1];assert.equal((await call('clients/'+b.data.id+'/duplicates','POST',{keepId:keep.id,removeId:remove.id},admin)).status,409);
 assert.equal((await call('clients/'+a.data.id+'/duplicates','POST',{keepId:keep.id,removeId:remove.id},admin)).status,200);
 await call('heartbeat','POST',sample(m1),auth);await call('heartbeat','POST',sample(m2),auth);
 rows=(await call('assets?clientId='+a.data.id,'GET',undefined,admin)).data;assert.equal(rows.length,1);assert.equal(rows[0].id,keep.id);assert.equal(rows[0].duplicate_of,null);
 assert.equal((await call('assets/'+keep.id+'/telemetry','GET',undefined,admin)).data.history.length,4);
 const legacy=await call('assets','POST',{name:'PC manual'},admin);assert.equal((await call('assets/'+legacy.data.id+'/client','PATCH',{clientId:a.data.id},admin)).status,200);
 assert.equal((await call('assets?clientId=0','GET',undefined,admin)).data.length,0);
 await call('users','POST',{name:'Consulta',email:'consulta@example.test',password,role:'viewer'},admin);const viewerLogin=await call('login','POST',{email:'consulta@example.test',password});const viewer={Cookie:viewerLogin.cookie};
 assert.equal((await call('clients','POST',{name:'Negado'},viewer)).status,403);assert.equal((await call('clients/'+a.data.id+'/duplicates','POST',{keepId:keep.id,removeId:remove.id},viewer)).status,403);
 assert.equal((await call('clients/'+a.data.id+'/token','POST',{password:'incorreta'},admin)).status,403);
 const renewed=await call('clients/'+a.data.id+'/token','POST',{password},admin);assert.equal(renewed.status,200);assert.equal((await call('heartbeat','POST',sample(m1),auth)).status,401);
 assert.equal((await call('heartbeat','POST',sample(m1),{Authorization:'Bearer '+renewed.data.token})).status,200);
 assert.equal((await call('assets?clientId='+a.data.id,'GET',undefined,admin)).data.length,2);
 }finally{child.kill();await once(child,'exit');rmSync(dir,{recursive:true,force:true});}
});
