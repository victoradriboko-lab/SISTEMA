import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {ensureAssetArchive} from '../asset-archive.mjs';
import {inventoryStatus,filterInventory} from '../public/inventory-list.js';

test('migração de arquivamento é aditiva, repetível e não altera cadastros anteriores',()=>{
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE assets(id INTEGER PRIMARY KEY,name TEXT,token TEXT,last_seen TEXT);INSERT INTO assets VALUES(1,'PC anterior','token anterior','2026-10-19T13:00:00Z')");const previous=db.prepare('SELECT * FROM assets').all();ensureAssetArchive(db);ensureAssetArchive(db);assert.deepEqual(db.prepare('SELECT * FROM assets').all(),previous);assert.equal(db.prepare('SELECT count(*) n FROM asset_archive').get().n,0);
 const rows=[{id:1,last_seen:new Date().toISOString(),network:[]},{id:2,last_seen:new Date().toISOString(),deleted_at:new Date().toISOString(),network:[]}];assert.equal(inventoryStatus(rows[1]),'offline');assert.deepEqual(filterInventory(rows).map(r=>r.id),[1]);assert.deepEqual(filterInventory(rows,{category:'deleted',status:'offline'}).map(r=>r.id),[2]);db.close();
});

test('arquivamento preserva histórico e vínculos, ignora agente, restringe alterações e permite restaurar',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'servitec-archive-'));let child,db,internal,portal;
 async function start(){child=spawn(process.execPath,['server.mjs'],{env:{...process.env,DATA_DIR:dir,PORT:'0',CLIENT_PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});const [out]=await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(Error('Timeout')),5000).unref())]);const ports=[...out.toString().matchAll(/porta (\d+)/g)].map(m=>m[1]);internal='http://127.0.0.1:'+ports[0];portal='http://127.0.0.1:'+ports[1];}
 async function stop(){if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}}
 async function call(path,method='GET',payload,headers={},customer=false){const r=await fetch((customer?portal:internal)+'/api/'+path,{method,headers:{'Content-Type':'application/json',...headers},body:payload===undefined?undefined:JSON.stringify(payload)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 try{
  await start();const password='Teste123';await call('setup','POST',{name:'Admin',email:'admin@example.test',password});const admin={Cookie:(await call('login','POST',{email:'admin@example.test',password})).cookie};
  const company=await call('clients','POST',{name:'Empresa preservada'},admin),other=await call('clients','POST',{name:'Outra empresa'},admin);
  const machineId=randomUUID(),sample=()=>({schemaVersion:1,sampleId:randomUUID(),observedAt:new Date().toISOString(),agent:{version:'1.2.4',platform:'windows',machineId},os:'Windows 11',inventory:{hostname:'PC ORIGINAL'},metrics:{cpuPercent:25}}),auth={Authorization:'Bearer '+company.data.token};
  assert.equal((await call('heartbeat','POST',sample(),auth)).status,200);
  const asset=(await call('assets','GET',undefined,admin)).data[0],id=asset.id;
  const manual=await call('assets','POST',{name:'PC manual',clientId:company.data.id},admin);await call('assets','POST',{name:'PC de outra empresa',clientId:other.data.id},admin);
  assert.equal((await call('asset-details/'+id+'/ticket','POST',{title:'Histórico preservado',description:'Atendimento anterior'},admin)).status,201);
  await call('asset-details/'+id+'/manual','PATCH',{notes:'Observação preservada'},admin);
  await call('client-access','POST',{name:'Cliente',email:'cliente@example.test',password,clientId:company.data.id},admin);const customer={Cookie:(await call('login','POST',{email:'cliente@example.test',password},{},true)).cookie};
  await call('users','POST',{name:'Consulta',email:'viewer@example.test',password,role:'viewer'},admin);const viewer={Cookie:(await call('login','POST',{email:'viewer@example.test',password})).cookie};
  db=new DatabaseSync(join(dir,'sistema.db'));const previous=db.prepare('SELECT * FROM assets WHERE id=?').get(id),telemetry=db.prepare('SELECT * FROM telemetry WHERE asset_id=?').all(id),links=db.prepare('SELECT * FROM client_machines WHERE asset_id=?').all(id),tickets=db.prepare('SELECT * FROM tickets WHERE asset_id=?').all(id);assert.equal(tickets.length,1);
  const archive=(ids,headers=admin)=>call('inventory-list/archive','POST',{ids,confirm:true},headers);
  assert.equal((await archive([id],viewer)).status,403);assert.equal((await call('inventory-list/archive','POST',{ids:[id],confirm:true},customer,true)).status,403);
  for(const ids of [[id,999999],[id,id],[],Array(101).fill(id)])assert.equal((await archive(ids)).status,400);assert.equal((await call('inventory-list/archive','POST',{ids:[id]},admin)).status,400);assert.equal(db.prepare('SELECT count(*) n FROM asset_archive').get().n,0);
  assert.equal((await archive([id])).status,200);assert.equal((await archive([id,manual.data.id])).status,409);assert.equal(db.prepare('SELECT count(*) n FROM asset_archive').get().n,1);
  assert.ok(!(await call('assets','GET',undefined,admin)).data.some(a=>a.id===id));assert.equal((await call('portal/assets','GET',undefined,customer,true)).data.total,1);assert.equal((await call('portal/assets?clientId='+other.data.id,'GET',undefined,customer,true)).status,403);
  const listed=(await call('inventory-list','GET',undefined,admin)).data.find(a=>a.id===id);assert.ok(listed.deleted_at);assert.equal(inventoryStatus(listed),'offline');assert.ok(!('token' in listed));const detail=(await call('asset-details/'+id,'GET',undefined,admin)).data;assert.ok(detail.deleted_at);assert.equal(detail.manual.notes,'Observação preservada');assert.equal(detail.tickets.length,1);
  for(const [path,method,payload] of [['inventory-list/bulk','PATCH',{ids:[id,manual.data.id],patch:{owner:'Não alterar'}}],['asset-details/'+id+'/manual','PATCH',{notes:'Não alterar'}],['asset-details/'+id+'/simulate','POST',{confirm:true}],['assets/'+id+'/client','PATCH',{clientId:other.data.id}]])assert.equal((await call(path,method,payload,admin)).status,409);
  const ignored=await call('heartbeat','POST',sample(),auth);assert.equal(ignored.status,200);assert.equal(ignored.data.archived,true);assert.deepEqual(db.prepare('SELECT * FROM assets WHERE id=?').get(id),previous);assert.deepEqual(db.prepare('SELECT * FROM telemetry WHERE asset_id=?').all(id),telemetry);assert.deepEqual(db.prepare('SELECT * FROM client_machines WHERE asset_id=?').all(id),links);assert.deepEqual(db.prepare('SELECT * FROM tickets WHERE asset_id=?').all(id),tickets);assert.equal(db.prepare('SELECT count(*) n FROM assets WHERE machine_id=?').get(machineId).n,1);
  // Tokens antigos também não atualizam amostras quando o equipamento está excluído.
  assert.equal((await archive([manual.data.id])).status,200);assert.equal((await call('heartbeat','POST',{cpu:30},{Authorization:'Bearer '+db.prepare('SELECT token FROM assets WHERE id=?').get(manual.data.id).token})).data.archived,true);
  db.close();db=null;await stop();await start();assert.ok((await call('asset-details/'+id,'GET',undefined,admin)).data.deleted_at);assert.equal((await call('heartbeat','POST',sample(),auth)).data.archived,true);
  assert.equal((await call('inventory-list/restore','POST',{ids:[id],confirm:true},viewer)).status,403);assert.equal((await call('inventory-list/restore','POST',{ids:[id],confirm:true},admin)).status,200);assert.equal((await call('inventory-list/restore','POST',{ids:[id],confirm:true},admin)).status,409);
  assert.ok((await call('assets','GET',undefined,admin)).data.some(a=>a.id===id));assert.equal((await call('heartbeat','POST',sample(),auth)).status,200);const restored=(await call('asset-details/'+id,'GET',undefined,admin)).data;assert.equal(restored.deleted_at,null);assert.equal(restored.history.length,telemetry.length+1);assert.equal(restored.manual.notes,'Observação preservada');assert.equal((await call('portal/assets','GET',undefined,customer,true)).data.total,1);
  const activity=(await call('config/activity','GET',undefined,admin)).data;assert.ok(activity.some(a=>a.action==='inventory.archive'));assert.ok(activity.some(a=>a.action==='inventory.restore'));
 }finally{db?.close();await stop();rmSync(dir,{recursive:true,force:true});}
});
