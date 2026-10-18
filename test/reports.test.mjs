import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {reportsCSV} from '../public/reports.js';
test('CSV preserva acentos e aspas e neutraliza fórmulas de planilha',()=>{
 const csv=reportsCSV({columns:[{key:'name',label:'Cliente'},{key:'total',label:'Total'}],rows:[{name:'Empresa "São José"; Centro',total:2},{name:' =HYPERLINK("x")',total:1},{name:'@SUM(A1)',total:1}]});
 assert.ok(csv.startsWith('\ufeff"Cliente";"Total"\r\n'));assert.ok(csv.includes('"Empresa ""São José""; Centro";"2"'));assert.ok(csv.includes('"\' =HYPERLINK'));assert.ok(csv.includes('"\'@SUM(A1)"'));assert.ok(csv.endsWith('\r\n'));
});
test('relatórios agregam por cliente e mês, filtram datas inclusivas e respeitam permissões',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sistema-reports-')),child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'3226',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 const call=async(path,method='GET',body,headers={})=>{const r=await fetch('http://127.0.0.1:3226/api/'+path,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 let db;
 try{
 await Promise.race([once(child.stdout,'data'),new Promise((_,r)=>setTimeout(()=>r(Error('Timeout')),5000).unref())]);
 const password='Reports-Teste-2026';await call('setup','POST',{name:'Admin',email:'admin@example.test',password});const login=await call('login','POST',{email:'admin@example.test',password}),admin={Cookie:login.cookie};
 const a=await call('clients','POST',{name:'Empresa A'},admin),b=await call('clients','POST',{name:'Empresa B'},admin);
 const fixtures=[[a.data.id,'2026-01-01 00:00:00','Aberto','Alta'],[a.data.id,'2026-01-31 23:59:59','Resolvido','Média'],[b.data.id,'2026-02-01 00:00:00','Em atendimento','Crítica'],[null,'2026-01-15 10:00:00','Aberto','Baixa'],[null,'2025-12-31 23:59:59','Resolvido','Baixa']];
 db=new DatabaseSync(join(dir,'sistema.db'));
 const ids=[];for(const [clientId,created,status,priority] of fixtures){const r=await call('tickets','POST',{title:'Chamado de teste',priority,clientId},admin);assert.equal(r.status,201);ids.push(r.data.id);db.prepare('UPDATE tickets SET created=?,status=? WHERE id=?').run(created,status,r.data.id);}
 assert.equal((await call('tickets','POST',{title:'Inválido',priority:'Alta',clientId:9999},admin)).status,400);
 const january=await call('reports?type=tickets-client&from=2026-01-01&to=2026-01-31','GET',undefined,admin);assert.equal(january.status,200);assert.equal(january.data.total,3);assert.deepEqual(january.data.rows.find(r=>r.label==='Empresa A'),{label:'Empresa A',total:2,open:1,progress:0,resolved:1});
 const month=await call('reports?type=tickets-month','GET',undefined,admin);assert.deepEqual(month.data.rows.map(r=>[r.label,r.total]),[['2025-12',1],['2026-01',3],['2026-02',1]]);
 assert.equal((await call('reports?type=tickets-status&status=Resolvido','GET',undefined,admin)).data.total,2);
 assert.equal((await call('reports?type=tickets-priority&priority=Alta&clientId='+a.data.id,'GET',undefined,admin)).data.total,1);
 for(const query of ['type=invalid','from=2026-02-29','from=2026-02-01&to=2026-01-01','clientId=9999','status=Desconhecido'])assert.equal((await call('reports?'+query,'GET',undefined,admin)).status,400);
 assert.equal((await call('tickets/'+ids[3],'PATCH',{clientId:b.data.id},admin)).status,200);assert.equal((await call('reports?type=tickets-client&clientId=0','GET',undefined,admin)).data.total,1);
 const linked=(await call('tickets','GET',undefined,admin)).data.find(t=>t.id===ids[3]);assert.equal(linked.client_name,'Empresa B');assert.equal(linked.status,'Aberto');
 await call('assets','POST',{name:'PC-01',clientId:a.data.id},admin);await call('assets','POST',{name:'PC-02'},admin);
 const connections=await call('reports?type=assets-connection','GET',undefined,admin);assert.equal(connections.data.total,2);assert.equal(connections.data.rows.find(r=>r.label==='Aguardando agente').total,2);
 for(const [name,permissions] of [['Só chamados',['tickets.read']],['Só inventário',['assets.read']],['Sem acesso',[]]]){
  const role=await call('config/roles','POST',{name},admin);await call('config/permissions','PUT',{roles:[{id:role.data.id,permissions}]},admin);const email=role.data.id+'@example.test';await call('users','POST',{name,email,password,role:role.data.id},admin);const login=await call('login','POST',{email,password}),headers={Cookie:login.cookie};
  assert.equal((await call('reports?type=tickets-client','GET',undefined,headers)).status,permissions.includes('tickets.read')?200:403);
  const equipment=await call('reports?type=assets-client','GET',undefined,headers);assert.equal(equipment.status,permissions.includes('assets.read')?200:403);
  if(equipment.status===200){assert.deepEqual(equipment.data.columns.map(c=>c.key),['label','total']);assert.ok(equipment.data.rows.every(r=>!('online' in r)));}
  assert.equal((await call('reports?type=assets-connection','GET',undefined,headers)).status,403);
  assert.equal((await call('ticket-clients','GET',undefined,headers)).status,permissions.includes('tickets.read')?200:403);
 }
 assert.equal((await call('reports')).status,401);
 }finally{db?.close();child.kill();await once(child,'exit');rmSync(dir,{recursive:true,force:true});}
});
