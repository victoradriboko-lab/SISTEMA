import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {scryptSync} from 'node:crypto';
async function start(dir,port){
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Servidor encerrou no início');}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Startup timeout')),5000).unref())]);
 const request=async(path,method='GET',data,cookie='')=>{const res=await fetch(`http://127.0.0.1:${port}/api/${path}`,{method,headers:{'Content-Type':'application/json',Cookie:cookie},body:data?JSON.stringify(data):undefined});return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};};
 return {request,stop:async()=>{child.kill();await once(child,'exit');}};
}
test('perfis, usuários, revogação de sessões e proteção do administrador',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sistema-users-'));const app=await start(dir,3201);const call=app.request;
 const password='test-password-12345',newPassword='another-password-12345';
 try {
 assert.equal((await call('setup','POST',{name:'Admin',email:'admin@example.test',password})).status,201);
 const login=async email=>{const r=await call('login','POST',{email,password});assert.equal(r.status,200);return r.cookie;};
 const admin=await login('admin@example.test');
 assert.equal((await call('me','GET',null,admin)).data.role,'admin');
 assert.equal((await call('users','GET')).status,401);
 for(const role of ['technician','viewer'])assert.equal((await call('users','POST',{name:role,email:`${role}@example.test`,password,role},admin)).status,201);
 assert.equal((await call('users','POST',{name:'dup',email:'VIEWER@example.test',password,role:'viewer'},admin)).status,409);
 assert.equal((await call('users','POST',{name:'bad',email:'bad@example.test',password,role:'owner'},admin)).status,400);
 assert.equal((await call('users','POST',{name:'bad',email:'bad@example.test',password:'short',role:'viewer'},admin)).status,400);
 const list=(await call('users','GET',null,admin)).data;
 const viewerId=list.find(u=>u.role==='viewer').id,techId=list.find(u=>u.role==='technician').id,adminId=list.find(u=>u.role==='admin').id;
 assert.ok(list.every(u=>!('password' in u)));
 const viewer=await login('viewer@example.test'),tech=await login('technician@example.test');
 for(const cookie of [viewer,tech]){
 assert.equal((await call('users','GET',null,cookie)).status,403);
 assert.equal((await call('users','POST',{name:'hack',email:'hack@example.test',role:'admin',password},cookie)).status,403);
 assert.equal((await call('users/'+adminId,'PATCH',{role:'viewer'},cookie)).status,403);
 }
 for(const path of ['tickets','assets'])assert.equal((await call(path,'GET',null,viewer)).status,200);
 assert.equal((await call('tickets','POST',{title:'Negado',priority:'Alta'},viewer)).status,403);
 assert.equal((await call('assets','POST',{name:'Negado'},viewer)).status,403);
 const ticket=await call('tickets','POST',{title:'Permitido',priority:'Alta'},tech);assert.equal(ticket.status,201);
 assert.equal((await call('tickets/'+ticket.data.id,'PATCH',{status:'Resolvido'},viewer)).status,403);
 assert.equal((await call('tickets/'+ticket.data.id,'PATCH',{status:'Resolvido'},tech)).status,200);
 assert.equal((await call('assets','POST',{name:'Permitido'},tech)).status,201);
 assert.equal((await call('users/'+adminId,'PATCH',{active:0},admin)).status,409);
 assert.equal((await call('users/'+adminId,'PATCH',{role:'technician'},admin)).status,409);
 assert.equal((await call('users/'+techId,'PATCH',{role:'viewer'},admin)).status,200);
 assert.equal((await call('me','GET',null,tech)).status,401);
 const updatedTech=await login('technician@example.test');
 assert.equal((await call('assets','POST',{name:'Negado'},updatedTech)).status,403);
 assert.equal((await call('users/'+viewerId,'PATCH',{active:0},admin)).status,200);
 assert.equal((await call('me','GET',null,viewer)).status,401);
 assert.equal((await call('login','POST',{email:'viewer@example.test',password})).status,401);
 assert.equal((await call('users/'+viewerId,'PATCH',{active:1,password:newPassword},admin)).status,200);
 assert.equal((await call('login','POST',{email:'viewer@example.test',password})).status,401);
 const reset=await call('login','POST',{email:'viewer@example.test',password:newPassword});assert.equal(reset.status,200);
 assert.equal((await call('me/password','POST',{currentPassword:'wrong',password},reset.cookie)).status,403);
 assert.equal((await call('me/password','POST',{currentPassword:newPassword,password},reset.cookie)).status,200);
 assert.equal((await call('me','GET',null,reset.cookie)).status,401);
 const liveViewer=await login('viewer@example.test');
 assert.equal((await call('users/'+viewerId,'PATCH',{password:newPassword},admin)).status,200);
 assert.equal((await call('me','GET',null,liveViewer)).status,401);
 assert.equal((await call('users/'+adminId,'PATCH',{password:newPassword},admin)).status,400);
 assert.equal((await call('users/'+viewerId,'PATCH',{active:true},admin)).status,400);
 assert.equal((await call('users/99999','PATCH',{active:0},admin)).status,404);
 } finally {await app.stop();rmSync(dir,{recursive:true,force:true});}
});
test('migração preserva login e dados antigos e pode ser repetida',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sistema-migrate-'));const password='legacy-password-123';
 const db=new DatabaseSync(join(dir,'sistema.db'));const salt='legacy-test-salt';
 db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT)');
 db.prepare('INSERT INTO users VALUES(1,?,?,?)').run('Administrador existente','legacy@example.test',salt+':'+scryptSync(password,salt,64).toString('hex'));db.exec("CREATE TABLE tickets(id INTEGER PRIMARY KEY,title TEXT,description TEXT,priority TEXT,status TEXT DEFAULT 'Aberto',created TEXT DEFAULT CURRENT_TIMESTAMP); INSERT INTO tickets(title,description,priority) VALUES('Chamado anterior','Preservar dados','Alta')");db.exec("CREATE TABLE assets(id INTEGER PRIMARY KEY,name TEXT,owner TEXT,os TEXT,token TEXT UNIQUE,last_seen TEXT,metrics TEXT); INSERT INTO assets(name,owner,os,token) VALUES('Equipamento antigo','Equipe','Linux','legacy-agent-token')");db.close();
 try {for(let run=0;run<2;run++){
 const app=await start(dir,3202);
 try {const login=await app.request('login','POST',{email:'legacy@example.test',password});assert.equal(login.status,200);
 const me=await app.request('me','GET',null,login.cookie);assert.equal(me.data.role,'admin');assert.equal(me.data.name,'Administrador existente');
 const users=await app.request('users','GET',null,login.cookie);assert.equal(users.data.length,1);assert.equal(users.data[0].active,1);
 const tickets=await app.request('tickets','GET',null,login.cookie);assert.equal(tickets.data[0].title,'Chamado anterior');assert.ok(tickets.data[0].status_since);
 const assets=await app.request('assets','GET',null,login.cookie);assert.equal(assets.data[0].name,'Equipamento antigo');assert.equal(assets.data[0].code,null);
 const heartbeat=await fetch('http://127.0.0.1:3202/api/heartbeat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer legacy-agent-token'},body:'{"os":"Linux"}'});assert.equal(heartbeat.status,200);
 }finally{await app.stop();}
 }}finally{rmSync(dir,{recursive:true,force:true});}
});
