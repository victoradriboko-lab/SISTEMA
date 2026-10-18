import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createMail} from '../mail.mjs';
import {parseIncomingMail,MAX_MAIL_BYTES} from '../mail-receiver.mjs';
const eml=(from,id,subject='Preciso de suporte',text='Computador não liga.',headers='')=>Buffer.from(`From: Cliente <${from}>\r\nTo: suporte@example.test\r\nMessage-ID: <${id}@example.test>\r\nSubject: ${subject}\r\nDate: Sun, 18 Oct 2026 10:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n${headers}\r\n${text}`);

test('parser de e-mail trata MIME/HTML, remetente ambíguo, automáticos, anexos e sinalização',async()=>{
 const parsed=await parseIncomingMail(eml('Pessoa@EXAMPLE.TEST','one','Impressora','Falha na impressão.'),{systemAddress:'suporte@example.test'});assert.equal(parsed.sender,'pessoa@example.test');assert.equal(parsed.subject,'Impressora');assert.match(parsed.text,/impressão/);assert.equal(parsed.risk,'');
 assert.ok((await parseIncomingMail(eml('auto@example.test','auto','Ausente','Férias','Auto-Submitted: auto-replied\r\n'))).ignored);
 assert.ok((await parseIncomingMail(eml('suporte@example.test','own'),{systemAddress:'suporte@example.test'})).ignored);
 assert.equal((await parseIncomingMail(eml('fake@example.test','fake','Assunto','Texto','Authentication-Results: mx.google.com; dmarc=fail header.from=example.test\r\n'))).risk,'provider_warning');
 assert.equal((await parseIncomingMail(Buffer.from('From: A <a@example.test>, B <b@example.test>\r\nSubject: x\r\n\r\nTexto'))).risk,'invalid_sender');
 const html=Buffer.from('From: a@example.test\r\nSubject: HTML\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<h1>Solicitação</h1><p>Ajuda na rede.</p><img src="https://example.test/pixel">');
 const rendered=await parseIncomingMail(html);assert.match(rendered.text,/Ajuda na rede/);assert.equal((await parseIncomingMail(Buffer.from('From: a@example.test\r\nContent-Type: text/html\r\n\r\n'+ '<p>'+ 'x'.repeat(110000)+'</p>'))).risk,'content_review');assert.ok(!rendered.text.includes('<h1>'));
 const multipart=Buffer.from('From: a@example.test\r\nSubject: Anexo\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="demo"\r\n\r\n--demo\r\nContent-Type: text/plain\r\n\r\nAjuda\r\n--demo\r\nContent-Type: text/plain; name="teste.txt"\r\nContent-Disposition: attachment; filename="teste.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\nb2k=\r\n--demo--\r\n');
 assert.deepEqual((await parseIncomingMail(multipart)).attachments,[{name:'teste.txt',size:2}]);
 await assert.rejects(()=>parseIncomingMail(Buffer.alloc(MAX_MAIL_BYTES+1)),/5 MB/);
});

test('central de e-mails: aprovação, vínculo automático, duplicados, bloqueio, revisão e permissões',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'servitec-mail-api-')),child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',CLIENT_PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});let db;
 try{
  const [started]=await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Falha na inicialização');}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Timeout')),5000).unref())]);const ports=started.toString().match(/porta (\d+); Painel do Cliente na porta (\d+)/);
  const call=async(path,method='GET',body,cookie='',portal=false)=>{const response=await fetch(`http://127.0.0.1:${ports[portal?2:1]}/api/`+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
  const password='Email-Administracao-Teste-2026';await call('setup','POST',{name:'Admin',email:'admin@example.test',password});const admin=(await call('login','POST',{email:'admin@example.test',password})).cookie;
  const a=(await call('clients','POST',{name:'Empresa Alpha'},admin)).data,b=(await call('clients','POST',{name:'Empresa Beta'},admin)).data;
  await call('users','POST',{name:'Operador',email:'operador@example.test',password,role:'technician'},admin);const tech=(await call('login','POST',{email:'operador@example.test',password})).cookie;
  await call('users','POST',{name:'Consulta',email:'consulta@example.test',password,role:'viewer'},admin);const viewer=(await call('login','POST',{email:'consulta@example.test',password})).cookie;
  assert.equal((await call('mail/messages')).status,401);assert.equal((await call('config/mail','GET',undefined,tech)).status,403);
  assert.equal((await call('mail/status','GET',undefined,viewer)).status,200);
  assert.equal((await call('mail/import','POST',{source:eml('ana@example.test','x').toString('base64')},viewer)).status,403);
  const receive=async(source,cookie=tech)=>call('mail/import','POST',{source:source.toString('base64')},cookie);
  const first=(await receive(eml('Ana@EXAMPLE.TEST','first','Impressora da Alpha'))).data;
  assert.equal(first.status,'pending');assert.equal((await call('tickets','GET',undefined,admin)).data.length,0);
  const second=(await receive(eml('ana@example.test','second','Rede da Alpha'))).data;
  assert.equal((await call('mail/messages/'+first.id+'/approve','POST',{clientId:a.id},viewer)).status,403);
  assert.equal((await call('mail/messages/'+first.id+'/approve','POST',{clientId:99999},tech)).status,400);
  const approved=await call('mail/messages/'+first.id+'/approve','POST',{clientId:a.id,remember:true,releaseAll:true},tech);assert.equal(approved.status,200);assert.equal(approved.data.count,2);
  const tickets=(await call('tickets','GET',undefined,tech)).data;assert.equal(tickets.length,2);assert.ok(tickets.every(t=>t.client_id===a.id&&t.email_sender==='ana@example.test'&&t.status==='Aberto'));
  const repeated=await receive(eml('Ana@EXAMPLE.TEST','first','Impressora da Alpha'));assert.equal(repeated.data.duplicate,true);assert.equal((await call('tickets','GET',undefined,admin)).data.length,2);
  assert.equal((await call('mail/messages/'+first.id+'/approve','POST',{clientId:a.id},tech)).status,409);
  const automatic=(await receive(eml('ana@example.test','next','Novo chamado já vinculado'))).data;assert.equal(automatic.status,'ticket');
  const flagged=(await receive(eml('ana@example.test','warning','Revisar origem','Texto','Authentication-Results: mx.google.com; dmarc=fail\r\n'))).data;assert.equal(flagged.status,'pending');
  const queued=(await receive(eml('bia@example.test','bia','E-mail de outra empresa'))).data;assert.equal(queued.status,'pending');
  assert.equal((await receive(eml('ana@example.test','autoresponse','Fora do escritório','Automático','Auto-Submitted: auto-replied\r\n'))).data.status,'ignored');
  const sender=(await call('mail/senders','GET',undefined,tech)).data.rows[0];
  await call('mail/senders/'+sender.id,'PATCH',{status:'approved',clientId:b.id},tech);
  const moved=(await receive(eml('ana@example.test','moved','Próxima solicitação para Beta'))).data;assert.equal(moved.status,'ticket');
  assert.equal((await call('tickets','GET',undefined,tech)).data.find(t=>t.id===moved.ticket_id).client_id,b.id);assert.ok(tickets.every(t=>t.client_id===a.id));
  await call('mail/senders/'+sender.id,'PATCH',{status:'blocked'},tech);
  assert.equal((await receive(eml('ana@example.test','blocked'))).data.status,'blocked');
  assert.equal((await call('mail/messages/'+queued.id+'/reject','POST',{reason:''},tech)).status,400);
  assert.equal((await call('mail/messages/'+queued.id+'/reject','POST',{reason:'Sem solicitação de suporte'},tech)).status,200);
  const oneTime=(await receive(eml('carlos@example.test','once'))).data;
  await call('mail/messages/'+oneTime.id+'/approve','POST',{clientId:a.id,remember:false},tech);
  assert.equal((await receive(eml('carlos@example.test','twice'))).data.status,'pending');
  assert.equal((await call('mail/senders?search=carlos','GET',undefined,tech)).data.total,0);
  const invalid=(await receive(Buffer.from('Subject: Sem remetente\r\n\r\nTeste'))).data;
  assert.equal((await call('mail/messages/'+invalid.id+'/approve','POST',{clientId:a.id},tech)).status,400);
  assert.equal((await call('mail/messages?status=wrong','GET',undefined,tech)).status,400);
  assert.equal((await call('mail/sync','POST',undefined,tech)).status,400);
  await call('client-access','POST',{name:'Cliente Alpha',email:'cliente@example.test',password,clientId:a.id},admin);const client=(await call('login','POST',{email:'cliente@example.test',password},'',true)).cookie;
  for(const path of ['mail/status','mail/messages','mail/senders','config/mail'])assert.equal((await call(path,'GET',undefined,client,true)).status,403,path);
  assert.equal((await call('mail/import','POST',{source:eml('a@example.test','no').toString('base64')},client,true)).status,403);
  const own=(await call('portal/tickets','GET',undefined,client,true)).data.rows;assert.ok(own.some(t=>t.id===automatic.ticket_id));assert.ok(!own.some(t=>t.id===moved.ticket_id));
  const settings=await call('config/mail','PUT',{address:'suporte@example.test',enabled:false,intervalSeconds:60,appPassword:'abcd efgh ijkl mnop',password},admin);assert.equal(settings.status,200);
  const publicConfig=(await call('config/mail','GET',undefined,admin)).data;assert.equal(publicConfig.settings.hasPassword,true);assert.ok(!JSON.stringify(publicConfig).includes('abcdefghijklmnop'));
  assert.equal((await call('config/mail','PUT',{address:'suporte@example.test',enabled:false,intervalSeconds:60,password:'errada'},admin)).status,403);
  db=new DatabaseSync(join(dir,'sistema.db'));assert.ok(!db.prepare("SELECT value FROM settings WHERE key='incoming-mail'").get().value.includes('abcdefghijklmnop'));assert.equal(readFileSync(join(dir,'email-secret.key')).length,32);
  const live=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='incoming-mail'").get().value);db.prepare("UPDATE settings SET value=? WHERE key='incoming-mail'").run(JSON.stringify({...live,enabled:true}));
  const backupResponse=await fetch(`http://127.0.0.1:${ports[1]}/api/config/backup`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:admin},body:JSON.stringify({password})});assert.equal(backupResponse.status,200);
  const {writeFileSync}=await import('node:fs');writeFileSync(join(dir,'copy.sqlite'),Buffer.from(await backupResponse.arrayBuffer()));const copy=new DatabaseSync(join(dir,'copy.sqlite'));assert.equal(JSON.parse(copy.prepare("SELECT value FROM settings WHERE key='incoming-mail'").get().value).enabled,false);assert.equal(copy.prepare('SELECT count(*) n FROM sessions').get().n,0);copy.close();db.prepare("UPDATE settings SET value=? WHERE key='incoming-mail'").run(JSON.stringify(live));
  assert.equal(db.prepare("SELECT count(*) n FROM activity WHERE action='mail.sender.approve'").get().n,1);
  assert.ok(!db.prepare("SELECT group_concat(detail) text FROM activity").get().text.includes('abcdefghijklmnop'));
 }finally{db?.close();if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}rmSync(dir,{recursive:true,force:true});}
});

test('coleta retoma cursor após falha, deduplica e protege credencial; pausa retoma o cursor e reinício explícito define novo ponto',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'servitec-mail-sync-')),db=new DatabaseSync(join(dir,'sistema.db'));let now=Date.parse('2026-10-18T12:00:00Z'),nextUid=10,queue=[],failure=false,closeCount=0,receivedCredentials;
 db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,password TEXT,active INTEGER); INSERT INTO users VALUES(1,'Admin','admin-test',1); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE clients(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO clients VALUES(1,'Alpha'); CREATE TABLE tickets(id INTEGER PRIMARY KEY,title TEXT,description TEXT,priority TEXT,status TEXT,status_since TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP,client_id INTEGER,operator_id INTEGER,service_type TEXT);");
 const audit=[],config={allowed:()=>true,audit:(user,action,detail)=>audit.push({action,detail})},admin={id:1,name:'Admin',role:'admin'};
 const receiver=async credentials=>{receivedCredentials=credentials;return {snapshot:()=>({uidValidity:'validity',lastUid:nextUid}),collect:async(cursor,onMessage,checkpoint)=>{for(const message of queue.filter(m=>m.uid>cursor.lastUid)){if(failure&&message.uid===12)throw Error('NETWORK WITH secret');await onMessage(message);checkpoint(message.uid);}},close:async()=>{closeCount++;}};};
 const mail=createMail({db,config,check:(pass,stored)=>pass===stored,body:async req=>req.data,json:(res,status,data)=>{res.status=status;res.data=data;},dataDir:dir,receiver,clock:()=>now,startScheduler:false});
 const call=async(path,method,data)=>{const res={};await mail.handle({method,data,url:path},res,path,admin);return res;};
 try{
  await call('/api/config/mail','PUT',{address:'suporte@example.test',enabled:true,intervalSeconds:60,appPassword:'abcdefghijklmnop',password:'admin-test'});
  assert.equal(receivedCredentials.appPassword,'abcdefghijklmnop');assert.equal(closeCount,1);assert.equal(db.prepare('SELECT last_uid FROM email_receiver_state').get().last_uid,10);
  queue=[{uid:11,source:eml('ana@example.test','q11')},{uid:12,source:eml('bia@example.test','q12')}];failure=true;
  await assert.rejects(()=>mail.sync(),error=>!error.message.includes('secret'));assert.equal(db.prepare('SELECT last_uid FROM email_receiver_state').get().last_uid,11);assert.equal(db.prepare('SELECT count(*) n FROM email_receiver_lock').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM email_messages').get().n,1);
  failure=false;now+=60000;assert.equal((await mail.sync()).count,1);assert.equal(db.prepare('SELECT last_uid FROM email_receiver_state').get().last_uid,12);assert.equal((await mail.sync()).count,0);
  await call('/api/config/mail','PUT',{address:'suporte@example.test',enabled:false,intervalSeconds:60,password:'admin-test'});nextUid=30;
  await call('/api/config/mail','PUT',{address:'suporte@example.test',enabled:true,intervalSeconds:60,password:'admin-test'});assert.equal(db.prepare('SELECT last_uid FROM email_receiver_state').get().last_uid,12);await call('/api/config/mail','PUT',{address:'suporte@example.test',enabled:true,startFromNow:true,intervalSeconds:60,password:'admin-test'});assert.equal(db.prepare('SELECT last_uid FROM email_receiver_state').get().last_uid,30);
  const saved=db.prepare("SELECT value FROM settings WHERE key='incoming-mail'").get().value;assert.ok(!saved.includes('abcdefghijklmnop'));if(process.platform!=='win32')assert.equal(statSync(join(dir,'email-secret.key')).mode&0o777,0o600);
  await assert.rejects(()=>call('/api/config/mail','PUT',{address:'outra@example.test',enabled:true,intervalSeconds:60,password:'admin-test'}),/senha de app/);
  assert.ok(!JSON.stringify(audit).includes('abcdefghijklmnop'));
 }finally{mail.stop();db.close();rmSync(dir,{recursive:true,force:true});}
});
