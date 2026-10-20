import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {cpSync,readdirSync,existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once,EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {createUpdateStore,updatePath} from '../update-store.mjs';
import {createUpdates} from '../updates.mjs';
const entry=(path,content)=>{const bytes=Buffer.from(content);return {path,data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};};
const pkg=(manifest,fromVersion,version,files=[])=>({format:'servitec-update-v1',dataPolicy:'preserve-additive',fromVersion,version,files:[entry('package.json',JSON.stringify({...manifest,version})),...files]});
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'servitec-updates-')),root=join(dir,'app'),dataDir=join(dir,'data');await mkdir(root);await mkdir(dataDir);
 const manifest={name:'sistema-ti',type:'module',version:'1.0.0',dependencies:{},engines:{node:'>=24'}};await writeFile(join(root,'package.json'),JSON.stringify(manifest));
 const db=new DatabaseSync(join(dataDir,'sistema.db'));db.exec("PRAGMA journal_mode=WAL; CREATE TABLE users(id INTEGER PRIMARY KEY,password TEXT,active INTEGER); INSERT INTO users VALUES(1,'admin-pass',1); CREATE TABLE tickets(id INTEGER PRIMARY KEY,title TEXT); INSERT INTO tickets VALUES(1,'Preservar chamado'); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE backup_lease(id INTEGER PRIMARY KEY,owner TEXT,expires INTEGER);");
 await writeFile(join(dataDir,'security.key'),'CHAVE EXISTENTE');
 return {dir,root,dataDir,db,manifest,store:createUpdateStore({root,dataDir}),async close(){db.close();await rm(dir,{recursive:true,force:true,maxRetries:30,retryDelay:100});}};
}
test('atualização e reversão preservam dados atuais, chave e backup consistente',async()=>{
 const f=await fixture();try{
  await mkdir(join(f.root,'public'));await writeFile(join(f.root,'public','app.js'),'// anterior');
  const record=await f.store.prepare({db:f.db,pkg:pkg(f.manifest,'1.0.0','1.1.0',[entry('public/app.js','// nova'),entry('new-module.mjs','export const value=1;')]),actor:1});
  assert.equal(JSON.parse(await readFile(join(f.root,'package.json'))).version,'1.0.0');
  const copy=new DatabaseSync(join(f.dataDir,'.updates',record.id,'database-before.sqlite'),{readOnly:true});assert.equal(copy.prepare('SELECT title FROM tickets').get().title,'Preservar chamado');copy.close();
  assert.equal(await readFile(join(f.dataDir,'.updates',record.id,'data-before','security.key'),'utf8'),'CHAVE EXISTENTE');
  const applied=f.store.applyPending();assert.equal(applied.id,record.id);f.store.complete(record.id);assert.equal(f.store.status().version,'1.1.0');
  f.db.exec("INSERT INTO tickets VALUES(2,'Criado depois da atualização')");
  const reverse=await f.store.prepare({db:f.db,rollback:true,actor:1});f.store.applyPending();f.store.complete(reverse.id);
  assert.equal(f.store.status().version,'1.0.0');assert.equal(await readFile(join(f.root,'public/app.js'),'utf8'),'// anterior');assert.equal(existsSync(join(f.root,'new-module.mjs')),false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM tickets').get().n,2);assert.equal(f.db.prepare('SELECT password FROM users').get().password,'admin-pass');assert.equal(await readFile(join(f.dataDir,'security.key'),'utf8'),'CHAVE EXISTENTE');
 }finally{await f.close();}
});
test('pacotes inválidos, links, dados, dependências e sintaxe não alteram a instalação',async()=>{
 const f=await fixture();try{
  for(const name of ['../package.json','public/../../data/sistema.db','data/sistema.db','.env','.git/config','public/a\\b.js','public/CON:foo.js','public/NUL.js','public/dir./app.js'])assert.equal(updatePath(name),false);
  const valid=pkg(f.manifest,'1.0.0','1.1.0');
  for(const change of [p=>p.fromVersion='0.1.0',p=>p.files[0].sha256='0'.repeat(64),p=>p.files.push(entry('data/sistema.db','evil')),p=>p.files.push(p.files[0]),p=>p.files.push(entry('bad.mjs','const = ;')),p=>p.files[0]=entry('package.json',JSON.stringify({...f.manifest,version:'1.1.0',dependencies:{untrusted:'1'}}))]){
   const bad=structuredClone(valid);change(bad);await assert.rejects(f.store.prepare({db:f.db,pkg:bad}));assert.equal(f.store.status().version,'1.0.0');
  }
  await mkdir(join(f.root,'public'));await symlink(f.dataDir,join(f.root,'public','linked'),process.platform==='win32'?'junction':'dir');await assert.rejects(f.store.prepare({db:f.db,pkg:pkg(f.manifest,'1.0.0','1.1.0',[entry('public/linked/app.js','bad')])}),/links/);
  assert.equal(existsSync(join(f.dataDir,'app.js')),false);assert.equal(f.db.prepare('SELECT count(*) n FROM tickets').get().n,1);
 }finally{await f.close();}
});
test('interrupção durante aplicação recupera arquivos; alteração externa antes de aplicar é preservada',async()=>{
 const f=await fixture();try{
  const update=pkg(f.manifest,'1.0.0','1.1.0');await f.store.prepare({db:f.db,pkg:update});f.store.applyPending();
  createUpdateStore(f).applyPending();assert.equal(f.store.status().version,'1.0.0');assert.equal(f.store.status().status,'failed');
  await f.store.prepare({db:f.db,pkg:update});const external={...f.manifest,description:'edição externa'};await writeFile(join(f.root,'package.json'),JSON.stringify(external));
  assert.equal(f.store.applyPending(),null);assert.deepEqual(JSON.parse(await readFile(join(f.root,'package.json'))),external);
 }finally{await f.close();}
});
test('consulta automática ao GitHub não instala; exige administrador e senha para aplicar',async()=>{
 const f=await fixture();const oldToken=process.env.SERVITEC_UPDATE_GITHUB_TOKEN;process.env.SERVITEC_UPDATE_GITHUB_TOKEN='TEST-SECRET';
 try{
  const calls=[],config={allowed:u=>u.role==='admin',audit:()=>{}};let restarted=0;
  const restart=()=>restarted++;restart.available=true;
  const source=pkg(f.manifest,'1.0.0','1.1.0');
  const fetcher=async(url,options)=>{calls.push({url,options});if(url.endsWith('/releases/latest'))return new Response(JSON.stringify({tag_name:'v1.1.0',assets:[{id:123,name:'servitec-update.json',size:1000}]}));if(url.endsWith('/assets/123'))return new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/download/test'}});return new Response(JSON.stringify(source));};
  const manager=createUpdates({db:f.db,config,check:(a,b)=>a===b,json:(res,status,data)=>Object.assign(res,{status,data}),root:f.root,dataDir:f.dataDir,restart,fetcher,startScheduler:false});
  const call=async(path,method='GET',data={},user={id:1,role:'admin'})=>{const req=Readable.from([Buffer.from(JSON.stringify(data))]);req.method=method;const res=new EventEmitter();await manager.handle(req,res,path,user);return res;};
  await manager.tick();assert.equal(manager.status().github.latest.version,'1.1.0');assert.equal(manager.status().github.latest.available,true);assert.equal(restarted,0);assert.equal(f.store.status().status,'idle');
  assert.equal(JSON.stringify(manager.status()).includes('TEST-SECRET'),false);
  await assert.rejects(call('/api/config/updates','GET',{}, {id:1,role:'viewer'}),e=>e.status===403);
  await assert.rejects(call('/api/config/updates/github','POST',{password:'wrong'}),e=>e.status===403);assert.equal(f.store.status().status,'idle');
  await assert.rejects(call('/api/config/updates/github','POST',{password:'admin-pass',expectedVersion:'1.0.1'}),e=>e.status===409);
  f.db.prepare('INSERT INTO backup_lease VALUES(1,?,?)').run('another-backup',Date.now()+60000);
  await assert.rejects(call('/api/config/updates/github','POST',{password:'admin-pass',expectedVersion:'1.1.0'}),e=>e.status===409);
  f.db.exec('DELETE FROM backup_lease');
  const response=await call('/api/config/updates/github','POST',{password:'admin-pass',expectedVersion:'1.1.0'});assert.equal(response.status,202);assert.equal(restarted,0);response.emit('finish');assert.equal(restarted,1);
  assert.equal(calls.at(-1).options.headers.Authorization,undefined);assert.equal(calls.at(-2).options.headers.Authorization,'Bearer TEST-SECRET');assert.equal(f.store.status().version,'1.0.0');
  await assert.rejects(call('/api/config/updates/install','POST',{password:'admin-pass',package:source}),e=>e.status===409);
 }finally{if(oldToken===undefined)delete process.env.SERVITEC_UPDATE_GITHUB_TOKEN;else process.env.SERVITEC_UPDATE_GITHUB_TOKEN=oldToken;await f.close();}
});
test('plataforma reinicia, aplica, reverte e recupera falha de inicialização mantendo login e chamados',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'servitec-updates-live-')),root=join(dir,'app'),dataDir=join(dir,'data');await mkdir(root);
 for(const name of readdirSync(resolve('.'))){if(name.endsWith('.mjs')||name==='package.json')cpSync(resolve(name),join(root,name));}
 cpSync(resolve('public'),join(root,'public'),{recursive:true});await symlink(resolve('node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
 const manifest=JSON.parse(readFileSync(join(root,'package.json'))),child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,DATA_DIR:dataDir,HOST:'127.0.0.1',CLIENT_HOST:'127.0.0.1',PORT:'0',CLIENT_PORT:'0'},stdio:['ignore','pipe','pipe']});let port,stderr='';child.stdout.on('data',data=>{const match=data.toString().match(/SISTEMA iniciado na porta (\d+)/);if(match)port=Number(match[1]);});child.stderr.on('data',data=>stderr+=data);
 const delay=()=>new Promise(r=>setTimeout(r,100));
 async function raw(path,method='GET',data,cookie){return fetch('http://127.0.0.1:'+port+'/api/'+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(2000)});}
 async function until(check){for(let i=0;i<200;i++){try{if(await check())return;}catch{}await delay();}throw Error('Timeout: '+stderr);}
 try{
  await until(()=>port);const password='update-admin-password';await raw('setup','POST',{name:'Admin',email:'updates@example.test',password});const login=await raw('login','POST',{email:'updates@example.test',password}),cookie=login.headers.get('set-cookie').split(';')[0];
  await raw('tickets','POST',{title:'Chamado antes da troca',description:'Preservar',priority:'Média'},cookie);
  const company=await (await raw('clients','POST',{name:'Empresa preservada'},cookie)).json();
  const asset=await (await raw('assets','POST',{name:'Equipamento preservado'},cookie)).json();
  const originalKey=readFileSync(join(dataDir,'security.key'));
  assert.equal((await raw('config/updates')).status,401);
  const update=pkg(manifest,manifest.version,'0.5.1',[entry('public/update-marker.js','export const version="0.5.1";')]);
  assert.equal((await raw('config/updates/install','POST',{password:'wrong',package:update},cookie)).status,403);
  assert.equal((await raw('config/updates/install','POST',{password,package:update},cookie)).status,202);
  await until(async()=>{const r=await raw('config/updates','GET',undefined,cookie);const s=await r.json();return s.version==='0.5.1'&&s.status==='installed';});
  assert.equal((await (await raw('tickets','GET',undefined,cookie)).json()).length,1);
  await raw('tickets','POST',{title:'Chamado depois da troca',description:'Preservar também',priority:'Média'},cookie);
  assert.equal((await raw('config/updates/rollback','POST',{password},cookie)).status,202);
  await until(async()=>{const s=await (await raw('config/updates','GET',undefined,cookie)).json();return s.version===manifest.version&&s.status==='installed';});
  assert.equal((await (await raw('tickets','GET',undefined,cookie)).json()).length,2);
  const broken=pkg(manifest,manifest.version,'0.5.2',[entry('runtime-server.mjs','throw new Error("STARTUP-TEST-FAILURE");')]);
  assert.equal((await raw('config/updates/install','POST',{password,package:broken},cookie)).status,202);
  await until(async()=>{const s=await (await raw('config/updates','GET',undefined,cookie)).json();return s.version===manifest.version&&s.status==='failed';});
  assert.equal((await (await raw('tickets','GET',undefined,cookie)).json()).length,2);
  assert.equal((await raw('me','GET',undefined,cookie)).status,200);
  const saved=new DatabaseSync(join(dataDir,'sistema.db'),{readOnly:true});
  try{assert.equal(saved.prepare('SELECT token FROM clients WHERE id=?').get(company.id).token,company.token);assert.equal(saved.prepare('SELECT token FROM assets WHERE id=?').get(asset.id).token,asset.token);}finally{saved.close();}
  assert.deepEqual(readFileSync(join(dataDir,'security.key')),originalKey);
 }finally{const ended=once(child,'exit');child.kill('SIGTERM');await ended;await rm(dir,{recursive:true,force:true,maxRetries:30,retryDelay:100});}
});
