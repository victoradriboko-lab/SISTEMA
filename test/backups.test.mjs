import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createBackups,nextBackupRun} from '../backups.mjs';
const schedule={enabled:true,directory:'',frequency:'daily',time:'02:00',weekday:0,timeZone:'UTC',keep:2};
test('agendamento calcula hora, dia, semana e evita repetição diária no horário de verão',()=>{
 const now=Date.parse('2026-10-18T01:59:00Z');assert.equal(nextBackupRun(schedule,now),'2026-10-18T02:00:00.000Z');
 assert.equal(nextBackupRun({...schedule,frequency:'hourly',time:'02:15'},now),'2026-10-18T02:15:00.000Z');
 assert.equal(nextBackupRun({...schedule,frequency:'weekly',weekday:1},now),'2026-10-19T02:00:00.000Z');assert.equal(nextBackupRun({...schedule,enabled:false},now),null);
 assert.equal(nextBackupRun({...schedule,time:'01:30',timeZone:'America/New_York'},Date.parse('2026-11-01T05:31:00Z'),'2026-11-01'),'2026-11-02T06:30:00.000Z');
});
test('backup consistente, retenção restrita, exclusão de sessões e recuperação de agenda vencida',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'servitec-backups-')),root=join(dir,'app'),dataDir=join(dir,'runtime'),destination=join(dir,'copies');await mkdir(root);await mkdir(dataDir);await writeFile(join(root,'package.json'),' {"version":"test"}');await writeFile(join(root,'server.mjs'),'// código de teste');await mkdir(join(root,'node_modules'));await writeFile(join(root,'node_modules','excluido'),'não copiar');await writeFile(join(dataDir,'anexo.txt'),'Anexo de teste');
 const db=new DatabaseSync(join(dataDir,'sistema.db'));db.exec("PRAGMA journal_mode=WAL; CREATE TABLE users(id INTEGER PRIMARY KEY,password TEXT,active INTEGER); INSERT INTO users VALUES(1,'test-password',1); CREATE TABLE sessions(token TEXT); INSERT INTO sessions VALUES('login-token'); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE tickets(id INTEGER PRIMARY KEY,title TEXT); INSERT INTO tickets VALUES(1,'Chamado preservado');");let now=Date.parse('2026-10-18T01:59:00Z');
 const config={allowed:user=>user.role==='admin',audit:()=>{}};const manager=createBackups({db,body:async req=>req.data,json:(res,status,data)=>Object.assign(res,{status,data}),config,check:(a,b)=>a===b,root,dataDir,clock:()=>now,startScheduler:false});
 const call=async(method,data={},path='/api/config/backups')=>{const res={};await manager.handle({method,data},res,path,{id:1,role:'admin'});return res;};
 try{
 assert.equal((await call('GET')).data.settings.enabled,false);
 await assert.rejects(call('PUT',{...schedule,directory:join(root,'backups'),password:'test-password'}),/fora da aplicação/);
 const link=join(dir,'alias');await symlink(root,link);await assert.rejects(call('PUT',{...schedule,directory:join(link,'backups'),password:'test-password'}),/fora da aplicação/);
 await assert.rejects(call('PUT',{...schedule,directory:destination,password:'wrong'}),error=>error.status===403);
 await call('PUT',{...schedule,directory:destination,password:'test-password'});await writeFile(join(destination,'arquivo-do-usuario.txt'),'não apagar');
 const firstPromise=manager.run();await assert.rejects(manager.run(),error=>error.status===409);const first=await firstPromise;
 const manifest=JSON.parse(await readFile(join(destination,first.name,'manifest.json'),'utf8'));assert.ok(manifest.files.some(f=>f.path==='data/anexo.txt'));assert.ok(manifest.files.every(f=>!f.path.includes('node_modules')));
 for(const file of manifest.files){const bytes=await readFile(join(destination,first.name,'sistema',file.path));assert.equal(file.sha256,createHash('sha256').update(bytes).digest('hex'));}
 const snapshot=new DatabaseSync(join(destination,first.name,'sistema/data/sistema.db'));try{assert.equal(snapshot.prepare('SELECT count(*) n FROM sessions').get().n,0);assert.equal(snapshot.prepare('SELECT title FROM tickets').get().title,'Chamado preservado');assert.equal(JSON.parse(snapshot.prepare("SELECT value FROM settings WHERE key='backup-schedule'").get().value).enabled,false);assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{snapshot.close();}
 now=Date.parse('2026-10-18T02:01:00Z');db.prepare('INSERT INTO backup_lease(id,owner,expires) VALUES(1,?,?)').run('outro-processo',now+300000);await manager.tick();assert.equal((await call('GET')).data.nextRun,'2026-10-18T02:00:00.000Z');assert.equal((await call('GET')).data.history.length,1);db.exec('DELETE FROM backup_lease');await manager.tick();let status=(await call('GET')).data;assert.equal(status.history.filter(r=>r.status==='success').length,2);assert.equal(status.nextRun,'2026-10-19T02:00:00.000Z');await manager.tick();assert.equal((await call('GET')).data.history.length,2);
 const restarted=createBackups({db,body:async r=>r.data,json:()=>{},config,check:(a,b)=>a===b,root,dataDir,clock:()=>now,startScheduler:false});now=Date.parse('2026-10-20T05:00:00Z');await restarted.tick();restarted.stop();
 status=(await call('GET')).data;assert.equal(status.history.length,3);assert.equal(status.nextRun,'2026-10-21T02:00:00.000Z');assert.equal(status.history.filter(r=>r.removed_at).length,1);assert.equal((await readdir(destination)).filter(n=>n.startsWith('servitec-vsa-')).length,2);assert.equal(await readFile(join(destination,'arquivo-do-usuario.txt'),'utf8'),'não apagar');
 const bad=join(dir,'unavailable');await writeFile(bad,'arquivo, não pasta');db.prepare("UPDATE settings SET value=? WHERE key='backup-schedule'").run(JSON.stringify({...schedule,directory:bad}));await assert.rejects(manager.run());assert.equal((await call('GET')).data.history[0].status,'failed');
 }finally{manager.stop();db.close();await rm(dir,{recursive:true,force:true});}
});
test('API administrativa cria backup completo que inicia com dados e login restaurados',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'servitec-backup-api-')),data=join(dir,'live'),destination=join(dir,'backups');const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,CLIENT_PORT:'0',PORT:'3233',DATA_DIR:data},stdio:['ignore','pipe','pipe']});let restored;
 const call=async(path,method='GET',body,headers={},port=3233)=>{const r=await fetch(`http://127.0.0.1:${port}/api/`+path,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
 await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(Error('Timeout')),5000).unref())]);const password='Backup-Administrador-2026';await call('setup','POST',{name:'Admin',email:'admin@example.test',password});const login=await call('login','POST',{email:'admin@example.test',password}),admin={Cookie:login.cookie};
 assert.equal((await call('config/backups')).status,401);await call('users','POST',{name:'Consulta',email:'viewer@example.test',password,role:'viewer'},admin);const viewer=await call('login','POST',{email:'viewer@example.test',password});assert.equal((await call('config/backups','GET',undefined,{Cookie:viewer.cookie})).status,403);
 assert.equal((await call('config/backups','PUT',{...schedule,directory:destination,password:'wrong'},admin)).status,403);
 assert.equal((await call('config/backups','PUT',{...schedule,enabled:false,directory:destination,password},admin)).status,200);await call('tickets','POST',{title:'Chamado para restauração',priority:'Alta'},admin);
 const result=await call('config/backups/run','POST',{password},admin);assert.equal(result.status,200);const app=join(destination,result.data.name,'sistema');
 restored=spawn(process.execPath,['server.mjs'],{cwd:app,env:{...process.env,CLIENT_PORT:'0',PORT:'3234',DATA_DIR:join(app,'data')},stdio:['ignore','pipe','pipe']});await Promise.race([once(restored.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(Error('Timeout restauração')),5000).unref())]);
 assert.equal((await call('me','GET',undefined,admin,3234)).status,401);const nextLogin=await call('login','POST',{email:'admin@example.test',password},{},3234);assert.equal(nextLogin.status,200);const nextAdmin={Cookie:nextLogin.cookie};assert.equal((await call('tickets','GET',undefined,nextAdmin,3234)).data[0].title,'Chamado para restauração');assert.equal((await call('config/backups','GET',undefined,nextAdmin,3234)).data.settings.enabled,false);
 }finally{if(restored){restored.kill();await once(restored,'exit');}child.kill();await once(child,'exit');await rm(dir,{recursive:true,force:true});}
});
