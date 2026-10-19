import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {scryptSync} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

test('portas dedicadas isolam contas, sessões, origens e arquivos; migração preserva sessão interna',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'servitec-portas-')),password='Cliente-Portas-Teste-2026',salt='legacy-salt';
 const seed=new DatabaseSync(join(dir,'sistema.db'));
 seed.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT); CREATE TABLE sessions(token TEXT PRIMARY KEY,user_id INTEGER,expires INTEGER);');
 seed.prepare('INSERT INTO users VALUES(1,?,?,?)').run('Admin anterior','admin@example.test',salt+':'+scryptSync(password,salt,64).toString('hex'));
 seed.prepare('INSERT INTO sessions VALUES(?,?,?)').run('a'.repeat(64),1,Date.now()+600000);seed.close();
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',CLIENT_PORT:'0',COOKIE_SECURE:'0',CLIENT_COOKIE_SECURE:'1',CLIENT_PUBLIC_URL:'https://clientes.example.test',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});let db;
 try{
  const [started]=await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Servidor encerrou antes de iniciar');}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Timeout')),5000).unref())]);
  const match=started.toString().match(/porta (\d+); Painel do Cliente na porta (\d+)/);assert.ok(match);
  const internal='http://127.0.0.1:'+match[1],portal='http://127.0.0.1:'+match[2];assert.notEqual(internal,portal);
  const call=async(base,path,method='GET',body,cookie,origin)=>{const response=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json(),setCookie:response.headers.get('set-cookie'),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
  const oldCookie='session='+'a'.repeat(64);assert.equal((await call(internal,'me','GET',undefined,oldCookie)).status,200);
  assert.equal((await call(portal,'me','GET',undefined,oldCookie)).status,401);
  assert.equal((await call(portal,'me','GET',undefined,'servitec_client_session='+'a'.repeat(64))).status,401);
  assert.equal((await call(portal,'state')).data.portal,'client');assert.equal((await call(portal,'state')).data.initialized,undefined);
  assert.equal((await call(portal,'setup','POST',{name:'Novo admin',email:'new@example.test',password})).status,403);
  const company=await call(internal,'clients','POST',{name:'Empresa de teste'},oldCookie);
  await call(internal,'client-access','POST',{name:'Cliente',email:'cliente@example.test',password,clientId:company.data.id},oldCookie);
  const metadata=await call(internal,'client-access/portal','GET',undefined,oldCookie);assert.equal(metadata.data.url,'https://clientes.example.test');
  const credentials={email:'cliente@example.test',password},adminCredentials={email:'admin@example.test',password};
  assert.equal((await call(internal,'login','POST',credentials)).status,403);
  assert.equal((await call(portal,'login','POST',adminCredentials)).status,403);
  assert.equal((await call(portal,'login','POST',credentials,undefined,internal)).status,403);
  const a=await call(internal,'login','POST',adminCredentials),c=await call(portal,'login','POST',credentials);
  assert.equal(a.status,200);assert.equal(c.status,200);assert.match(a.cookie,/^session=/);assert.match(c.cookie,/^servitec_client_session=/);
  assert.match(c.setCookie,/HttpOnly/);assert.match(c.setCookie,/SameSite=Strict/);assert.match(c.setCookie,/; Secure/);assert.doesNotMatch(a.setCookie,/; Secure/);
  const both=a.cookie+'; '+c.cookie;
  assert.equal((await call(internal,'me','GET',undefined,both)).data.account_type,'internal');assert.equal((await call(portal,'me','GET',undefined,both)).data.account_type,'client');
  assert.equal((await call(internal,'me','GET',undefined,'session='+c.cookie.split('=')[1])).status,401);
  assert.equal((await call(portal,'me','GET',undefined,'servitec_client_session='+a.cookie.split('=')[1])).status,401);
  db=new DatabaseSync(join(dir,'sistema.db'));
  // Clientes com MFA antigo entram apenas com senha; MFA interno continua obrigatório.
  const clientId=db.prepare('SELECT id FROM users WHERE email=?').get(credentials.email).id;
  db.prepare("INSERT INTO user_mfa(user_id,secret,enabled) VALUES(?,'',1)").run(clientId);
  assert.equal((await call(portal,'login','POST',credentials)).status,200);
  assert.equal((await call(portal,'security/setup','POST',{password},c.cookie)).status,403);
  db.prepare("INSERT INTO user_mfa(user_id,secret,enabled) VALUES(1,'',1)").run();
  assert.equal((await call(internal,'login','POST',adminCredentials)).status,401);
  db.prepare('DELETE FROM user_mfa WHERE user_id IN (?,1)').run(clientId);

  const clientToken=c.cookie.split('=')[1];db.prepare("UPDATE sessions SET audience='internal' WHERE token=?").run(clientToken);
  assert.equal((await call(internal,'me','GET',undefined,'session='+clientToken)).status,401);
  db.prepare("UPDATE sessions SET audience='client' WHERE token=?").run(clientToken);
  for(const path of ['users','clients','assets','config/backups','client-access/portal'])assert.equal((await call(portal,path,'GET',undefined,both)).status,403,path);
  assert.equal((await call(internal,'portal/overview','GET',undefined,a.cookie)).status,404);
  for(const path of ['/app.js','/settings.js','/style.css','/client-access.js'])assert.equal((await fetch(portal+path)).status,404,path);
  assert.match(await (await fetch(portal+'/')).text(),/Painel do Cliente/);assert.match(await (await fetch(internal+'/')).text(),/Sistema Informática SERVITEC VSA/);
  assert.equal((await fetch(internal+'/customer-app.js')).status,404);
  await call(portal,'logout','POST',undefined,both);
  assert.equal((await call(portal,'me','GET',undefined,both)).status,401);assert.equal((await call(internal,'me','GET',undefined,both)).status,200);
  // Senha do cliente continua gerenciada no cadastro interno e revoga sessões do painel.
  const fresh=await call(portal,'login','POST',credentials);const list=await call(internal,'client-access','GET',undefined,a.cookie);
  await call(internal,'client-access/'+list.data[0].id,'PATCH',{active:0},a.cookie);
  assert.equal((await call(portal,'me','GET',undefined,fresh.cookie)).status,401);
 }finally{db?.close();if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}rmSync(dir,{recursive:true,force:true});}
});
