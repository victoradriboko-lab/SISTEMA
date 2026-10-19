import {createClientManagement} from './client-management.mjs';
import {createRegistrations} from './registrations.mjs';
import {createTicketTools} from './ticket-tools.mjs';
import {createDeviceSupport} from './device-support.mjs';
import {createServiceDesk} from './service-desk.mjs';
import {createOperations} from './operations.mjs';
import {createSecurity} from './security.mjs';
import {createMail} from './mail.mjs';
import {createClientAccess} from './client-access.mjs';
import {createClientPortal} from './client-portal.mjs';
import {createBackups} from './backups.mjs';
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
const readPort=(name,fallback)=>{const value=process.env[name]??String(fallback);if(!/^\d+$/.test(value)||Number(value)>65535)throw Error(`${name} deve ser uma porta entre 0 e 65535`);return Number(value);};
const internalPort=readPort('PORT',3000),clientPort=readPort('CLIENT_PORT',3001);
if(internalPort!==0&&internalPort===clientPort)throw Error('CLIENT_PORT deve ser diferente de PORT');
const internalHost=process.env.HOST||'0.0.0.0',clientHost=process.env.CLIENT_HOST||internalHost;
let publicClientURL=null;
if(process.env.CLIENT_PUBLIC_URL){const url=new URL(process.env.CLIENT_PUBLIC_URL);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('CLIENT_PUBLIC_URL deve ser uma URL HTTP(S) sem caminho ou credenciais');publicClientURL=url.origin;}
const isClient=user=>user.account_type==='client'||user.role==='client_viewer';
const portalURL=req=>{if(publicClientURL)return publicClientURL;const url=new URL(`http://${req.headers.host}`);url.port=String(clientServer.address()?.port||clientPort);return url.origin;};
const dataDir=process.env.DATA_DIR||root+'data';
mkdirSync(dataDir,{recursive:true});
const db=new DatabaseSync(dataDir+'/sistema.db');
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER,expires INTEGER); CREATE TABLE IF NOT EXISTS tickets(id INTEGER PRIMARY KEY,title TEXT,description TEXT,priority TEXT,status TEXT DEFAULT 'Aberto',created TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE IF NOT EXISTS assets(id INTEGER PRIMARY KEY,name TEXT,owner TEXT,os TEXT,token TEXT UNIQUE,last_seen TEXT,metrics TEXT);`);
// Migração aditiva: preserva o administrador e todos os dados existentes.
const columns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!columns.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
if (!columns.includes('active')) db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
if(!columns.includes('account_type'))db.exec("ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'internal'");
if(!columns.includes('client_id'))db.exec('ALTER TABLE users ADD COLUMN client_id INTEGER');
const sessionColumns=db.prepare('PRAGMA table_info(sessions)').all().map(c=>c.name);
if(!sessionColumns.includes('audience'))db.exec("ALTER TABLE sessions ADD COLUMN audience TEXT NOT NULL DEFAULT 'internal'");
const validPassword = value => typeof value === 'string' && value.length >= 8 && value.length <= 256;
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const publicUsers = () => db.prepare("SELECT id,name,email,role,active FROM users WHERE account_type='internal' ORDER BY name,id").all();
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
const hash=(password,salt=randomBytes(16).toString('hex'))=>salt+':'+scryptSync(password,salt,64).toString('hex');
const check=(password,stored)=>{const [salt,value]=stored.split(':');return timingSafeEqual(Buffer.from(hash(password,salt).split(':')[1],'hex'),Buffer.from(value,'hex'));};
async function body(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw Object.assign(Error('Solicitação maior que 1 MB'),{status:413});chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
const str=(v,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const config=createConfiguration({db,json,body,check,root});
const backups=createBackups({db,body,json,config,check,root,dataDir});
const clients=createClients({db,body,json,config,check});
const reportModels=createReportModels({db,body,json,config});
const reports=createReports({db,json,config});
const clientAccess=createClientAccess({db,body,json,config,hash,validEmail,validPassword,portalURL});
const desk=createServiceDesk({db,body,json,config});
const clientManagement=createClientManagement({db,json,body,config});
desk.setClientAccess(clientManagement.canOpen);
const registrations=createRegistrations({db,json,body,config});
const ticketTools=createTicketTools({db,json,body,config,desk,reports});
const deviceSupport=createDeviceSupport({db,body,json,config,desk,canOpenTicket:clientManagement.canOpen});
const security=createSecurity({db,body,json,config,check,dataDir});
const operations=createOperations({db,body,json,config,desk});
const clientPortal=createClientPortal({db,json,config});
const telemetry=createTelemetry({db,body,json,config,root,clients});
const mail=createMail({db,body,json,config,check,dataDir,desk,canOpenTicket:clientManagement.canOpen});
const handler=audience=>async(req,res)=>{const customer=audience==='client',cookieName=customer?'servitec_client_session':'session',secure=(customer?process.env.CLIENT_COOKIE_SECURE??process.env.COOKIE_SECURE:process.env.COOKIE_SECURE)==='1',cookieOptions=`HttpOnly; SameSite=Strict; Path=/${secure?'; Secure':''}`;try{
res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; frame-ancestors 'none'");
const path=new URL(req.url,'http://localhost').pathname;
if(path.startsWith('/api/'))res.setHeader('Cache-Control','no-store');
if(await config.publicRoute(req,res,path))return;
if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return json(res,403,{error:'Origem inválida'});
if(path==='/api/state'&&req.method==='GET'){return json(res,200,customer?{portal:'client'}:{initialized:!!db.prepare('SELECT id FROM users LIMIT 1').get()});}
if(path==='/api/setup'&&req.method==='POST'){
if(customer)return json(res,403,{error:'Cadastros são feitos pelo administrador no sistema interno'});
if(db.prepare('SELECT id FROM users LIMIT 1').get())return json(res,409,{error:'Administrador já cadastrado'});
const b=await body(req);if(!str(b.name)||!validEmail(b.email)||!validPassword(b.password))return json(res,400,{error:'Informe nome, e-mail e senha de pelo menos 8 caracteres'});
if(db.prepare('SELECT id FROM users LIMIT 1').get())return json(res,409,{error:'Administrador já cadastrado'});
const created=db.prepare('INSERT INTO users(name,email,password) VALUES(?,?,?)').run(str(b.name),str(b.email).toLowerCase(),hash(b.password));config.audit({id:Number(created.lastInsertRowid),name:str(b.name)},'users.setup','Administrador inicial cadastrado');return json(res,201,{ok:true});}
if(path==='/api/login'&&req.method==='POST'){const b=await body(req);const attempt=security.throttle(req,b.email);const user=db.prepare('SELECT * FROM users WHERE email=?').get(str(b.email).toLowerCase());if(!user||!user.active||typeof b.password!=='string'||b.password.length>256||!check(b.password,user.password)){config.audit(null,'auth.failed','Tentativa de login recusada');return json(res,401,{error:'Credenciais inválidas'});}if(isClient(user)!==customer)return json(res,403,{error:customer?'Este painel é exclusivo para contas de clientes. Use o sistema interno com sua conta de operador.':'Esta conta pertence ao Painel do Cliente. Acesse '+portalURL(req)});if(customer&&clientManagement.isBlocked(user.client_id))return json(res,403,{error:'O acesso desta empresa está bloqueado. Contate a equipe responsável.'});security.clear(attempt);config.audit(user,'auth.login',customer?'Login no Painel do Cliente':'Login realizado');const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions(token,user_id,expires,audience) VALUES(?,?,?,?)').run(token,user.id,Date.now()+28800000,audience);res.setHeader('Set-Cookie',`${cookieName}=${token}; ${cookieOptions}`);return json(res,200,{ok:true});}
if(!customer&&await deviceSupport.publicRoute(req,res,path))return;
if(!customer&&await telemetry.publicRoute(req,res,path))return;
if(path.startsWith('/api/')){
const token=(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(cookieName+'='))?.slice(cookieName.length+1);const session=db.prepare('SELECT users.id,users.name,users.email,users.role,users.account_type,users.client_id,(SELECT name FROM clients WHERE id=users.client_id) AS client_name FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>? AND users.active=1 AND sessions.audience=?').get(token||'',Date.now(),audience);if(!session||isClient(session)!==customer)return json(res,401,{error:'Entre para continuar'});
if(customer&&clientManagement.isBlocked(session.client_id))return json(res,403,{error:'O acesso desta empresa está bloqueado. Contate a equipe responsável.'});
if(path==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(token);config.audit(session,'auth.logout','Logout realizado');res.setHeader('Set-Cookie',`${cookieName}=; ${cookieOptions}; Max-Age=0`);return json(res,200,{ok:true});}
if(path==='/api/me'&&req.method==='GET')return json(res,200,{...session,permissions:session.account_type==='client'||session.role==='client_viewer'?['portal.read',...(db.prepare('SELECT portal_write FROM users WHERE id=?').get(session.id)?.portal_write?['portal.create']:[])]:config.permissions(session.role)});
if(path==='/api/me/password'&&req.method==='POST'){
const b=await body(req);
const user=db.prepare('SELECT password FROM users WHERE id=?').get(session.id);
if(typeof b.currentPassword!=='string'||b.currentPassword.length>256||!check(b.currentPassword,user.password))return json(res,403,{error:'Senha atual incorreta'});
if(!validPassword(b.password))return json(res,400,{error:'A nova senha deve ter de 8 a 256 caracteres'});
db.prepare('UPDATE users SET password=? WHERE id=?').run(hash(b.password),session.id);
db.prepare('DELETE FROM sessions WHERE user_id=?').run(session.id);
config.audit(session,'users.password','Própria senha alterada');return json(res,200,{ok:true,reauthenticate:true});
}
if(customer&&path.startsWith('/api/security/'))return json(res,403,{error:'O Painel do Cliente utiliza apenas e-mail e senha'});
if(await security.handle(req,res,path,session))return;
if(await desk.handle(req,res,path,session,customer))return;
if(customer){await clientPortal.handle(req,res,path,session);return;}
if(await clientManagement.handle(req,res,path,session))return;
if(await registrations.handle(req,res,path,session))return;
if(await ticketTools.handle(req,res,path,session))return;
if(await deviceSupport.handle(req,res,path,session))return;
if(await operations.handle(req,res,path,session))return;
if(await mail.handle(req,res,path,session))return;
if(await clientAccess.handle(req,res,path,session))return;
if(await backups.handle(req,res,path,session))return;
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
if(!str(b.name)||!validEmail(b.email)||!validPassword(b.password)||!config.roleExists(b.role))return json(res,400,{error:'Informe nome, e-mail, perfil e senha de 8 a 256 caracteres'});
const email=b.email.trim().toLowerCase();
if(db.prepare('SELECT id FROM users WHERE email=?').get(email))return json(res,409,{error:'E-mail já cadastrado'});
const result=db.prepare('INSERT INTO users(name,email,password,role,active) VALUES(?,?,?,?,1)').run(str(b.name),email,hash(b.password),b.role);
config.audit(session,'users.create',`Usuário #${result.lastInsertRowid} cadastrado`);return json(res,201,{id:Number(result.lastInsertRowid)});
}
if(/^\/api\/users\/\d+$/.test(path)&&req.method==='PATCH'){
const b=await body(req),id=Number(path.split('/').pop());
const user=db.prepare("SELECT id,name,email,role,active FROM users WHERE id=? AND account_type='internal'").get(id);
if(!user)return json(res,404,{error:'Usuário não encontrado'});
const name=b.name===undefined?user.name:str(b.name);
const email=b.email===undefined?user.email:str(b.email).toLowerCase();
const role=b.role===undefined?user.role:b.role;
const active=b.active===undefined?user.active:b.active;
if(!name||!validEmail(email)||!config.roleExists(role)||![0,1].includes(active))return json(res,400,{error:'Nome, e-mail, perfil ou situação inválidos'});
if(b.password!==undefined&&!validPassword(b.password))return json(res,400,{error:'A senha deve ter de 8 a 256 caracteres'});
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
if(path==='/api/tickets'&&req.method==='GET')return json(res,200,db.prepare('SELECT t.*,(SELECT count(*) FROM ticket_checklist WHERE ticket_id=t.id) AS checklist_total,(SELECT count(*) FROM ticket_checklist WHERE ticket_id=t.id AND done=1) AS checklist_done,(SELECT count(*) FROM ticket_parts WHERE ticket_id=t.id) AS part_count,c.name AS client_name,u.name AS operator_name,em.sender AS email_sender FROM tickets t LEFT JOIN clients c ON c.id=t.client_id LEFT JOIN users u ON u.id=t.operator_id LEFT JOIN email_messages em ON em.id=(SELECT min(id) FROM email_messages WHERE ticket_id=t.id) ORDER BY t.id DESC').all().map(t=>desk.decorate(config.ticketAlert(t))));
if(path==='/api/tickets'&&req.method==='POST'){const b=await body(req);if(!str(b.title)||!['Baixa','Média','Alta','Crítica'].includes(b.priority))return json(res,400,{error:'Título e prioridade válidos são obrigatórios'});const clientId=b.clientId?Number(b.clientId):null;if(clientId!==null&&(!Number.isSafeInteger(clientId)||!db.prepare('SELECT id FROM clients WHERE id=?').get(clientId)))return json(res,400,{error:'Selecione uma empresa válida'});const operatorId=b.operatorId===undefined||b.operatorId===null||b.operatorId===''?null:Number(b.operatorId);if(operatorId!==null&&(!Number.isSafeInteger(operatorId)||!reports.canAssignOperator(operatorId)))return json(res,400,{error:'Selecione um operador ativo com permissão de atender chamados'});const serviceType=b.serviceType===undefined||b.serviceType===null||b.serviceType===''?null:b.serviceType;if(serviceType!==null&&!['Interno','Externo'].includes(serviceType))return json(res,400,{error:'Tipo de atendimento deve ser Interno ou Externo'});const row=db.prepare('INSERT INTO tickets(title,description,priority,status_since,client_id,operator_id,service_type) VALUES(?,?,?,CURRENT_TIMESTAMP,?,?,?)').run(str(b.title),str(b.description,5000),b.priority,clientId,operatorId,serviceType);desk.opened(Number(row.lastInsertRowid),session);config.audit(session,'tickets.create',`Chamado #${row.lastInsertRowid} criado`);return json(res,201,{id:Number(row.lastInsertRowid)});}
if(/^\/api\/tickets\/\d+$/.test(path)&&req.method==='PATCH'){
const b=await body(req),id=Number(path.split('/').pop()),ticket=db.prepare('SELECT id,status,client_id,operator_id,service_type,asset_id FROM tickets WHERE id=?').get(id);
if(!ticket)return json(res,404,{error:'Chamado não encontrado'});
if(b.status===undefined&&b.clientId===undefined&&b.operatorId===undefined&&b.serviceType===undefined)return json(res,400,{error:'Informe status, cliente, operador ou tipo de atendimento'});
const status=b.status??ticket.status,clientId=b.clientId===undefined?ticket.client_id:b.clientId===null||b.clientId===''?null:Number(b.clientId);
if(clientId!==ticket.client_id&&ticket.asset_id)return json(res,409,{error:'Desvincule o dispositivo na classificação do ticket antes de trocar a empresa.'});
if(clientId!==ticket.client_id&&(db.prepare("SELECT 1 FROM ticket_events WHERE ticket_id=? AND kind IN ('message','attachment') LIMIT 1").get(id)||db.prepare('SELECT 1 FROM ticket_work WHERE ticket_id=? LIMIT 1').get(id)))return json(res,409,{error:'Chamado com conversas, anexos ou horas não pode trocar de empresa. Crie um novo chamado para preservar o histórico.'});
if(!['Aberto','Em atendimento','Resolvido'].includes(status))return json(res,400,{error:'Status inválido'});
if(clientId!==null&&(!Number.isSafeInteger(clientId)||!db.prepare('SELECT id FROM clients WHERE id=?').get(clientId)))return json(res,400,{error:'Selecione uma empresa válida'});
const operatorId=b.operatorId===undefined?ticket.operator_id:b.operatorId===null||b.operatorId===''?null:Number(b.operatorId);
if(operatorId!==null&&(!Number.isSafeInteger(operatorId)||operatorId!==ticket.operator_id&&!reports.canAssignOperator(operatorId)))return json(res,400,{error:'Selecione um operador ativo com permissão de atender chamados'});
const serviceType=b.serviceType===undefined?ticket.service_type:b.serviceType===null||b.serviceType===''?null:b.serviceType;
if(serviceType!==null&&!['Interno','Externo'].includes(serviceType))return json(res,400,{error:'Tipo de atendimento deve ser Interno ou Externo'});
db.prepare('UPDATE tickets SET status_since=CASE WHEN status<>? THEN CURRENT_TIMESTAMP ELSE status_since END,status=?,client_id=?,operator_id=?,service_type=? WHERE id=?').run(status,status,clientId,operatorId,serviceType,id);
desk.updated(id,session,ticket);config.audit(session,'tickets.update',`Chamado #${id}: ${status}, cliente ${clientId??'não informado'}, operador ${operatorId??'não informado'}, atendimento ${serviceType??'não informado'}`);return json(res,200,{ok:true});}

if(path==='/api/assets'&&req.method==='POST'){const b=await body(req);if(!str(b.name))return json(res,400,{error:'Nome obrigatório'});const code=str(b.code,81)||null;if(code&&code.length>80)return json(res,400,{error:'Código deve ter até 80 caracteres'});if(code&&db.prepare('SELECT id FROM assets WHERE code=?').get(code))return json(res,409,{error:'Código de equipamento já cadastrado'});const clientId=b.clientId?Number(b.clientId):null;if(clientId!==null&&(!Number.isSafeInteger(clientId)||!db.prepare('SELECT id FROM clients WHERE id=?').get(clientId)))return json(res,400,{error:'Selecione uma empresa válida'});const token=randomBytes(32).toString('hex');const row=db.prepare('INSERT INTO assets(name,owner,os,token,code,client_id) VALUES(?,?,?,?,?,?)').run(str(b.name),str(b.owner),str(b.os),token,code,clientId);config.audit(session,'assets.create',`Equipamento #${row.lastInsertRowid} cadastrado`);return json(res,201,{id:Number(row.lastInsertRowid),...(clientId?{}:{token})});}
return json(res,404,{error:'Rota não encontrada'});}
const files=customer?['/list-pages.js','/workspace-tabs.js','/desk.js','/security-ui.js','/','/theme.js','/theme.css','/customer-app.js','/customer.css','/client-portal.js','/reports.js']:[ '/client-list.js','/registrations.js','/ticket-extras.js','/tickets-list.js','/sidebar.css','/list-pages.js','/navigation.js','/workspace-tabs.js','/support-devices.js','/contract-billing.js','/desk.js','/service-ui.js','/security-ui.js','/', '/mail.js','/mail-settings.js','/mail.css','/theme.js','/theme.css','/app.js','/monitor.js','/dashboard.js','/reports.js','/settings.js','/backup-settings.js','/client-access.js','/style.css'];
if(req.method==='GET'&&files.includes(path)){const name=path==='/'?(customer?'customer.html':'index.html'):path.slice(1);res.setHeader('Content-Type',name.endsWith('html')?'text/html; charset=utf-8':name.endsWith('js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8');return res.end(readFileSync(root+'public/'+name));}
json(res,404,{error:'Não encontrado'});
}catch(err){json(res,err.status||400,{error:err.status?err.message:'Não foi possível processar a solicitação'});}};
const internalServer=http.createServer(handler('internal')),clientServer=http.createServer(handler('client'));
for(const server of [internalServer,clientServer])server.on('error',error=>{console.error('Não foi possível iniciar os acessos: '+error.message);process.exit(1);});
// Anunciar prontidão somente quando os dois acessos estiverem disponíveis.
internalServer.listen(internalPort,internalHost,()=>clientServer.listen(clientPort,clientHost,()=>console.log(`SISTEMA iniciado na porta ${internalServer.address().port}; Painel do Cliente na porta ${clientServer.address().port}`)));
