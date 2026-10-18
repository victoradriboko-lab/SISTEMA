import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {deadline} from '../service-desk.mjs';
import {totp} from '../security.mjs';
import {createOperations} from '../operations.mjs';

test('SLA considera fim de semana, fuso horário e calendário 24x7',()=>{
 const friday=Date.parse('2026-10-16T20:30:00Z');
 assert.equal(deadline(friday,120,{calendar:'business',zone:'America/Sao_Paulo',startHour:8,endHour:18}),'2026-10-19T12:30:00.000Z');
 assert.equal(deadline(friday,120,{calendar:'24x7',zone:'America/Sao_Paulo'}),'2026-10-16T22:30:00.000Z');
 // RFC 6238 SHA1, eight-digit reference 94287082 => six digits 287082
 assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',59000),'287082');
});

test('gestão integrada: contratos, histórico, isolamento, horas, preventivas, cofre, remoto e MFA',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'servitec-desk-')),child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',CLIENT_PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});let db;
 try{
  const [started]=await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Servidor não iniciou');})]);const ports=started.toString().match(/porta (\d+); Painel do Cliente na porta (\d+)/);
  const call=async(path,method='GET',data,cookie='',portal=false)=>{const r=await fetch(`http://127.0.0.1:${ports[portal?2:1]}/api/${path}`,{method,headers:{'Content-Type':'application/json',Cookie:cookie},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const password='Servitec-Validacao-2026';await call('setup','POST',{name:'Admin',email:'admin@example.test',password});const admin=(await call('login','POST',{email:'admin@example.test',password})).cookie;
  const a=(await call('clients','POST',{name:'Alpha'},admin)).data,b=(await call('clients','POST',{name:'Beta'},admin)).data;
  const contract={enabled:true,monthly:3000,hourCost:120,includedHours:20,calendar:'business',zone:'America/Sao_Paulo',targets:Object.fromEntries(['Baixa','Média','Alta','Crítica'].map(k=>[k,{response:60,resolution:480}]))};
  assert.equal((await call('desk/companies/'+a.id,'PUT',{profile:{contact:'Ana',sites:'Matriz e filial'},contract},admin)).status,200);
  assert.equal((await call('desk/companies/'+a.id,'PUT',{contract:{...contract,zone:'inexistente'}},admin)).status,400);
  const id=(await call('tickets','POST',{title:'Rede indisponível',description:'Roteador',priority:'Alta',clientId:a.id},admin)).data.id;
  let detail=(await call('desk/tickets/'+id,'GET',undefined,admin)).data;assert.ok(detail.ticket.sla.response_due);assert.equal(detail.events.length,1);
  await call('desk/tickets/'+id+'/messages','POST',{text:'Senha do roteador na nota interna',public:false},admin);
  await call('desk/tickets/'+id+'/messages','POST',{text:'Estamos verificando',public:true},admin);
  await call('desk/tickets/'+id+'/files','POST',{filename:'interno.txt',base64:Buffer.from('Interno').toString('base64'),public:false},admin);
  await call('desk/tickets/'+id+'/files','POST',{filename:'cliente.txt',base64:Buffer.from('Público').toString('base64'),public:true},admin);
  await call('desk/tickets/'+id+'/work','POST',{minutes:90,expenses:20,note:'Diagnóstico',workedOn:'2026-10-18'},admin);
  const finance=(await call('desk/finance?month=2026-10','GET',undefined,admin)).data.rows.find(c=>c.id===a.id);assert.equal(finance.cost,200);assert.equal(finance.margin,2800);
  const createClient=async(email,clientId,portalWrite)=>call('client-access','POST',{name:email,email,password,clientId,portalWrite},admin);
  const access=await createClient('ana@example.test',a.id,false);await createClient('beta@example.test',b.id,true);
  let client=(await call('login','POST',{email:'ana@example.test',password},'',true)).cookie;const beta=(await call('login','POST',{email:'beta@example.test',password},'',true)).cookie;
  assert.equal((await call('desk/tickets','POST',{title:'Solicitação',description:'Ajuda'},client,true)).status,403);
  assert.equal((await call('desk/companies','GET',undefined,client,true)).status,403);
  assert.equal((await call('desk/tickets/'+id,'GET',undefined,beta,true)).status,404);
  detail=(await call('desk/tickets/'+id,'GET',undefined,client,true)).data;assert.ok(detail.events.every(e=>e.public===1));assert.equal(detail.work,undefined);assert.equal(detail.files.length,1);assert.ok(!JSON.stringify(detail).includes('Senha do roteador'));
  const forbidden=await fetch(`http://127.0.0.1:${ports[2]}/api/desk/files/1`,{headers:{Cookie:client}});assert.equal(forbidden.status,404);
  await call('client-access/'+access.data.id,'PATCH',{portalWrite:true},admin);assert.equal((await call('me','GET',undefined,client,true)).status,401);client=(await call('login','POST',{email:'ana@example.test',password},'',true)).cookie;
  assert.equal((await call('desk/tickets','POST',{title:'Fraude',description:'x',clientId:b.id},client,true)).status,403);
  const created=(await call('desk/tickets','POST',{title:'Portal',description:'Impressora',operatorId:1,priority:'Crítica'},client,true)).data.id;
  assert.equal((await call('tickets','GET',undefined,admin)).data.find(t=>t.id===created).client_id,a.id);
  assert.equal((await call('desk/tickets/'+created+'/messages','POST',{text:'Mais detalhes',public:false},client,true)).status,201);
  assert.equal((await call('desk/tickets/'+created+'/work','POST',{minutes:10},client,true)).status,403);
  assert.equal((await call('tickets/'+id,'PATCH',{clientId:b.id},admin)).status,409);
  assert.equal((await call('operations/preventives','POST',{clientId:a.id,title:'Verificar backups',intervalDays:30,nextDate:'2026-10-18'},admin)).status,200);
  db=new DatabaseSync(join(dir,'sistema.db'));const ops=createOperations({db,body:async()=>({}),json:()=>{},config:{audit:()=>{}},desk:{opened:()=>{}},clock:()=>Date.parse('2026-10-18T12:00:00Z'),startScheduler:false});ops.tick();ops.tick();assert.equal(db.prepare('SELECT count(*) n FROM preventive_runs').get().n,1);
  const asset=(await call('assets','POST',{name:'PC Alpha',clientId:a.id},admin)).data.id;
  db.prepare('UPDATE assets SET last_seen=?,metrics=? WHERE id=?').run('2026-10-18T11:00:00Z','{}',asset);ops.tick();ops.tick();assert.equal(db.prepare("SELECT count(*) n FROM service_alerts WHERE kind='offline' AND resolved IS NULL").get().n,1);
  db.prepare('UPDATE assets SET last_seen=? WHERE id=?').run('2026-10-18T12:00:00Z',asset);ops.tick();assert.equal(db.prepare('SELECT count(*) n FROM service_alerts WHERE resolved IS NULL').get().n,0);
  const vault=await call('vault','POST',{clientId:a.id,label:'Roteador',secret:'segredo-nao-pode-vazar',password},admin);assert.equal(vault.status,201);assert.ok(!db.prepare('SELECT secret FROM service_vault').get().secret.includes('segredo-nao'));assert.ok(!JSON.stringify((await call('vault','GET',undefined,admin)).data).includes('segredo-nao'));
  assert.equal((await call('vault/'+vault.data.id+'/reveal','POST',{password:'errada'},admin)).status,403);assert.equal((await call('vault/'+vault.data.id+'/reveal','POST',{password},admin)).data.secret,'segredo-nao-pode-vazar');
  const remote=await call('operations/remote','POST',{assetId:asset,remoteId:'123456789',reason:'Suporte de rede',consent:'Ana autorizou pelo telefone'},admin);assert.equal(remote.status,201);assert.match(remote.data.url,/^rustdesk:/);
  const setup=(await call('security/setup','POST',{password},admin)).data;assert.equal(setup.secret.length,32);const enabled=await call('security/confirm','POST',{password,code:totp(setup.secret)},admin);assert.equal(enabled.status,200);assert.equal(enabled.data.codes.length,8);assert.equal((await call('me','GET',undefined,admin)).status,401);
  assert.equal((await call('login','POST',{email:'admin@example.test',password})).status,401);const recovery=enabled.data.codes[0];assert.equal((await call('login','POST',{email:'admin@example.test',password,code:recovery})).status,200);assert.equal((await call('login','POST',{email:'admin@example.test',password,code:recovery})).status,401);
  for(let i=0;i<9;i++)await call('login','POST',{email:'unknown@example.test',password:'wrong'});assert.equal((await call('login','POST',{email:'unknown@example.test',password:'wrong'})).status,429);
  assert.equal(readFileSync(join(dir,'security.key')).length,32);
 }finally{db?.close();if(child.exitCode===null){child.kill();await once(child,'exit');}rmSync(dir,{recursive:true,force:true});}
});
