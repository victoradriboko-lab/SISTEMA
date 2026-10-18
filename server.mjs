import {createReportModels} from './report-models.mjs';
import {createReports} from './reports.mjs';
import {createClients} from './clients.mjs';
import {createTelemetry} from './telemetry.mjs';
import {createConfiguration} from './configuration.mjs';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {mkdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
const dataDir=process.env.DATA_DIR||root+'data';
mkdirSync(dataDir,{recursive:true});
const db=new DatabaseSync(dataDir+'/sistema.db');
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER,expires INTEGER); CREATE TABLE IF NOT EXISTS tickets(id INTEGER PRIMARY KEY,title TEXT,description TEXT,priority TEXT,status TEXT DEFAULT 'Aberto',created TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE IF NOT EXISTS assets(id INTEGER PRIMARY KEY,name TEXT,owner TEXT,os TEXT,token TEXT UNIQUE,last_seen TEXT,metrics TEXT);`);
// Migração aditiva: preserva o administrador e todos os dados existentes.
const columns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!columns.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
if (!columns.includes('active')) db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 256;
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const publicUsers = () => db.prepare('SELECT id,name,email,role,active FROM users ORDER BY name,id').all();
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
const hash=(password,salt=randomBytes(16).toString('hex'))=>salt+':'+scryptSync(password,salt,64).toString('hex');
const check=(password,stored)=>{const [salt,value]=stored.split(':');return timingSafeEqual(Buffer.from(hash(password,salt).split(':')[1],'hex'),Buffer.from(value,'hex'));};
async function body(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw Object.assign(Error('Solicitação maior que 1 MB'),{status:413});chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
const str=(v,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const config=createConfiguration({db,json,body,check,root});
const clients=createClients({db,body,json,config,check});
const reportModels=createReportModels({db,body,json,config});
const reports=createReports({db,json,config});
const telemetry=createTelemetry({db,body,json,config,root,clients});
http.createServer(async(req,res)=>{try{
res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; frame-ancestors 'none'");
const path=new URL(req.url,'http://localhost').pathname;
if(path.startsWith('/api/'))res.setHeader('Cache-Control','no-store');
if(await config.publicRoute(req,res,path))return;
if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return json(res,403,{error:'Origem inválida'});
if(path==='/api/state'&&req.method==='GET'){return json(res,200,{initialized:!!db.prepare('SELECT id FROM users LIMIT 1').get()});}
if(path==='/api/setup'&&req.method==='POST'){
if(db.prepare('SELECT id FROM users LIMIT 1').get())return json(res,409,{error:'Administrador já cadastrado'});
const b=await body(req);if(!str(b.name)||!validEmail(b.email)||!validPassword(b.password))return json(res,400,{error:'Informe nome, e-mail e senha de pelo menos 12 caracteres'});
if(db.prepare('SELECT id FROM users LIMIT 1').get())return json(res,409,{error:'Administrador já cadastrado'});
const created=db.prepare('INSERT INTO users(name,email,password) VALUES(?,?,?)').run(str(b.name),str(b.email).toLowerCase(),hash(b.password));config.audit({id:Number(created.lastInsertRowid),name:str(b.name)},'users.setup','Administrador inicial cadastrado');return json(res,201,{ok:true});}
if(path==='/api/login'&&req.method==='POST'){const b=await body(req);const user=db.prepare('SELECT * FROM users WHERE email=?').get(str(b.email).toLowerCase());if(!user||!user.active||typeof b.password!=='string'||b.password.length>256||!check(b.password,user.password)){config.audit(null,'auth.failed','Tentativa de login recusada');return json(res,401,{error:'Credenciais inválidas'});}config.audit(user,'auth.login','Login realizado');const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token,user.id,Date.now()+28800000);res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/${process.env.COOKIE_SECURE==='1'?'; Secure':''}`);return json(res,200,{ok:true});}
if(await telemetry.publicRoute(req,res,path))return;
if(path.startsWith('/api/')){
const token=(req.headers.cookie||'').match(/(?:^|;\s*)session=([a-f0-9]+)/)?.[1];const session=db.prepare('SELECT users.id,users.name,users.email,users.role FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>? AND users.active=1').get(token||'',Date.now());if(!session)return json(res,401,{error:'Entre para continuar'});
if(path==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(token);config.audit(session,'auth.logout','Logout realizado');res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true});}
if(path==='/api/me'&&req.method==='GET')return json(res,200,{...session,permissions:config.permissions(session.role)});
if(path==='/api/me/password'&&req.method==='POST'){
const b=await body(req);
const user=db.prepare('SELECT password FROM users WHERE id=?').get(session.id);
if(typeof b.currentPassword!=='string'||b.currentPassword.length>256||!check(b.currentPassword,user.password))return json(res,403,{error:'Senha atual incorreta'});
if(!validPassword(b.password))return json(res,400,{error:'A nova senha deve ter de 12 a 256 caracteres'});
db.prepare('UPDATE users SET password=? WHERE id=?').run(hash(b.password),session.id);
db.prepare('DELETE FROM sessions WHERE user_id=?').run(session.id);
config.audit(session,'users.password','Própria senha alterada');return json(res,200,{ok:true,reauthenticate:true});
}
if(await reportModels.handle(req,res,path,session))return;
if(await reports.handle(req,res,path,session))return;
if(await clients.handle(req,res,path,session))return;
if(await telemetry.handle(req,res,path,session))return;
if(await config.handle(req,res,path,session))return;
if(path==='/api/users'||path.startsWith('/api/users/')){
if(session.role!=='admin')return json(res,403,{error:'Somente administradores podem gerenciar usuários'});
if(path==='/api/users'&&req.method==='GET')return json(res,200,publicUsers());
if(path==='/api/users'&&req.method==='POST'){
const b=await body(req);
if(!str(b.name)||!validEmail(b.email)||!validPassword(b.password)||!config.roleExists(b.role))return json(res,400,{error:'Informe nome, e-mail, perfil e senha de 12 a 256 caracteres'});
const email=b.email.trim().toLowerCase();
if(db.prepare('SELECT id FROM users WHERE email=?').get(email))return json(res,409,{error:'E-mail já cadastrado'});
const result=db.prepare('INSERT INTO users(name,email,password,role,active) VALUES(?,?,?,?,1)').run(str(b.name),email,hash(b.password),b.role);
config.audit(session,'users.create',`Usuário #${result.lastInsertRowid} cadastrado`);return json(res,201,{id:Number(result.lastInsertRowid)});
}
if(/^\/api\/users\/\d+$/.test(path)&&req.method==='PATCH'){
const b=await body(req),id=Number(path.split('/').pop());
const user=db.prepare('SELECT id,name,email,role,active FROM users WHERE id=?').get(id);
if(!user)return json(res,404,{error:'Usuário não encontrado'});
const name=b.name===undefined?user.name:str(b.name);
const email=b.email===undefined?user.email:str(b.email).toLowerCase();
const role=b.role===undefined?user.role:b.role;
const active=b.active===undefined?user.active:b.active;
if(!name||!validEmail(email)||!config.roleExists(role)||![0,1].includes(active))return json(res,400,{error:'Nome, e-mail, perfil ou situação inválidos'});
if(b.password!==undefined&&!validPassword(b.password))return json(res,400,{error:'A senha deve ter de 12 a 256 caracteres'});
if(b.password!==undefined&&id===session.id)return json(res,400,{error:'Use Minha senha para alterar sua própria senha'});
if(db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(email,id))return json(res,409,{error:'E-mail já cadastrado'});
if(user.role==='admin'&&user.active===1&&(role!=='admin'||active===0)&&db.prepare("SELECT COUNT(*) AS total FROM users WHERE role='admin' AND active=1").get().total<=1)return json(res,409,{error:'Mantenha pelo menos um administrador ativo'});
db.prepare('UPDATE users SET name=?,email=?,role=?,active=? WHERE id=?').run(name,email,role,active,id);
if(b.password!==undefined)db.prepare('UPDATE users SET password=? WHERE id=?').run(hash(b.password),id);
if(role!==user.role||active!==user.active||b.password!==undefined)db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
config.audit(session,'users.update',`Usuário #${id} atualizado${b.password!==undefined?' com redefinição de senha':''}`);return json(res,200,{ok:true});
}
return json(res,404,{error:'Rota não encontrada'});
}
if((path==='/api/tickets'||path.startsWith('/api/tickets/'))&&!config.allowed(session,req.method==='GET'?'tickets.read':'tickets.write'))return json(res,403,{error:'Sem permissão para acessar ou alterar chamados'});
if((path==='/api/assets'||path.startsWith('/api/assets/'))&&!config.allowed(session,req.method==='GET'?'assets.read':'assets.write'))return json(res,403,{error:'Sem permissão para acessar ou alterar equipamentos'});
if(path==='/api/tickets'&&req.method==='GET')return json(res,200,db.prepare('SELECT t.*,c.name AS client_name,u.name AS operator_name FROM tickets t LEFT JOIN clients c ON c.id=t.client_id LEFT JOIN users u ON u.id=t.operator_id ORDER BY t.id DESC').all().map(config.ticketAlert));
if(path==='/api/tickets'&&req.method==='POST'){const b=await body(req);if(!str(b.title)||!['Baixa','Média','Alta','Crítica'].includes(b.priority))return json(res,400,{error:'Título e prioridade válidos são obrigatórios'});const clientId=b.clientId?Number(b.clientId):null;if(clientId!==null&&(!Number.isSafeInteger(clientId)||!db.prepare('SELECT id FROM clients WHERE id=?').get(clientId)))return json(res,400,{error:'Selecione uma empresa válida'});const operatorId=b.operatorId===undefined||b.operatorId===null||b.operatorId===''?null:Number(b.operatorId);if(operatorId!==null&&(!Number.isSafeInteger(operatorId)||!reports.canAssignOperator(operatorId)))return json(res,400,{error:'Selecione um operador ativo com permissão de atender chamados'});const serviceType=b.serviceType===undefined||b.serviceType===null||b.serviceType===''?null:b.serviceType;if(serviceType!==null&&!['Interno','Externo'].includes(serviceType))return json(res,400,{error:'Tipo de atendimento deve ser Interno ou Externo'});const row=db.prepare('INSERT INTO tickets(title,description,priority,status_since,client_id,operator_id,service_type) VALUES(?,?,?,CURRENT_TIMESTAMP,?,?,?)').run(str(b.title),str(b.description,5000),b.priority,clientId,operatorId,serviceType);config.audit(session,'tickets.create',`Chamado #${row.lastInsertRowid} criado`);return json(res,201,{id:Number(row.lastInsertRowid)});}
if(/^\/api\/tickets\/\d+$/.test(path)&&req.method==='PATCH'){
const b=await body(req),id=Number(path.split('/').pop()),ticket=db.prepare('SELECT id,status,client_id,operator_id,service_type FROM tickets WHERE id=?').get(id);
if(!ticket)return json(res,404,{error:'Chamado não encontrado'});
if(b.status===undefined&&b.clientId===undefined&&b.operatorId===undefined&&b.serviceType===undefined)return json(res,400,{error:'Informe status, cliente, operador ou tipo de atendimento'});
const status=b.status??ticket.status,clientId=b.clientId===undefined?ticket.client_id:b.clientId===null||b.clientId===''?null:Number(b.clientId);
if(!['Aberto','Em atendimento','Resolvido'].includes(status))return json(res,400,{error:'Status inválido'});
if(clientId!==null&&(!Number.isSafeInteger(clientId)||!db.prepare('SELECT id FROM clients WHERE id=?').get(clientId)))return json(res,400,{error:'Selecione uma empresa válida'});
const operatorId=b.operatorId===undefined?ticket.operator_id:b.operatorId===null||b.operatorId===''?null:Number(b.operatorId);
if(operatorId!==null&&(!Number.isSafeInteger(operatorId)||operatorId!==ticket.operator_id&&!reports.canAssignOperator(operatorId)))return json(res,400,{error:'Selecione um operador ativo com permissão de atender chamados'});
const serviceType=b.serviceType===undefined?ticket.service_type:b.serviceType===null||b.serviceType===''?null:b.serviceType;
if(serviceType!==null&&!['Interno','Externo'].includes(serviceType))return json(res,400,{error:'Tipo de atendimento deve ser Interno ou Externo'});
db.prepare('UPDATE tickets SET status_since=CASE WHEN status<>? THEN CURRENT_TIMESTAMP ELSE status_since END,status=?,client_id=?,operator_id=?,service_type=? WHERE id=?').run(status,status,clientId,operatorId,serviceType,id);
config.audit(session,'tickets.update',`Chamado #${id}: ${status}, cliente ${clientId??'não informado'}, operador ${operatorId??'não informado'}, atendimento ${serviceType??'não informado'}`);return json(res,200,{ok:true});}

if(path==='/api/assets'&&req.method==='POST'){const b=await body(req);if(!str(b.name))return json(res,400,{error:'Nome obrigatório'});const code=str(b.code,81)||null;if(code&&code.length>80)return json(res,400,{error:'Código deve ter até 80 caracteres'});if(code&&db.prepare('SELECT id FROM assets WHERE code=?').get(code))return json(res,409,{error:'Código de equipamento já cadastrado'});const clientId=b.clientId?Number(b.clientId):null;if(clientId!==null&&(!Number.isSafeInteger(clientId)||!db.prepare('SELECT id FROM clients WHERE id=?').get(clientId)))return json(res,400,{error:'Selecione uma empresa válida'});const token=randomBytes(32).toString('hex');const row=db.prepare('INSERT INTO assets(name,owner,os,token,code,client_id) VALUES(?,?,?,?,?,?)').run(str(b.name),str(b.owner),str(b.os),token,code,clientId);config.audit(session,'assets.create',`Equipamento #${row.lastInsertRowid} cadastrado`);return json(res,201,{id:Number(row.lastInsertRowid),...(clientId?{}:{token})});}
return json(res,404,{error:'Rota não encontrada'});}
if(req.method==='GET'&&['/','/app.js','/monitor.js','/dashboard.js','/reports.js','/settings.js','/style.css'].includes(path)){const name=path==='/'?'index.html':path.slice(1);res.setHeader('Content-Type',name.endsWith('html')?'text/html; charset=utf-8':name.endsWith('js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8');return res.end(readFileSync(root+'public/'+name));}
json(res,404,{error:'Não encontrado'});
}catch(err){json(res,err.status||400,{error:err.status?err.message:'Não foi possível processar a solicitação'});}}).listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('SISTEMA iniciado na porta '+(process.env.PORT||3000)));
