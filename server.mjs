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
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
const hash=(password,salt=randomBytes(16).toString('hex'))=>salt+':'+scryptSync(password,salt,64).toString('hex');
const check=(password,stored)=>{const [salt,value]=stored.split(':');return timingSafeEqual(Buffer.from(hash(password,salt).split(':')[1],'hex'),Buffer.from(value,'hex'));};
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>65536)throw Error('Corpo muito grande');}return JSON.parse(text||'{}');}
const str=(v,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
http.createServer(async(req,res)=>{try{
res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'");
const path=new URL(req.url,'http://localhost').pathname;
if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return json(res,403,{error:'Origem inválida'});
if(path==='/api/state'&&req.method==='GET'){return json(res,200,{initialized:!!db.prepare('SELECT id FROM users LIMIT 1').get()});}
if(path==='/api/setup'&&req.method==='POST'){
if(db.prepare('SELECT id FROM users LIMIT 1').get())return json(res,409,{error:'Administrador já cadastrado'});
const b=await body(req);if(!str(b.name)||!str(b.email).includes('@')||typeof b.password!=='string'||b.password.length<12)return json(res,400,{error:'Informe nome, e-mail e senha de pelo menos 12 caracteres'});
db.prepare('INSERT INTO users(name,email,password) VALUES(?,?,?)').run(str(b.name),str(b.email).toLowerCase(),hash(b.password));return json(res,201,{ok:true});}
if(path==='/api/login'&&req.method==='POST'){const b=await body(req);const user=db.prepare('SELECT * FROM users WHERE email=?').get(str(b.email).toLowerCase());if(!user||typeof b.password!=='string'||!check(b.password,user.password))return json(res,401,{error:'Credenciais inválidas'});const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token,user.id,Date.now()+28800000);res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/${process.env.COOKIE_SECURE==='1'?'; Secure':''}`);return json(res,200,{ok:true});}
if(path==='/api/heartbeat'&&req.method==='POST'){const token=(req.headers.authorization||'').replace(/^Bearer /,'');const asset=db.prepare('SELECT id FROM assets WHERE token=?').get(token);if(!asset)return json(res,401,{error:'Token inválido'});const b=await body(req);db.prepare('UPDATE assets SET last_seen=?,metrics=?,os=? WHERE id=?').run(new Date().toISOString(),JSON.stringify({cpu:b.cpu,memory:b.memory,disk:b.disk}),str(b.os),asset.id);return json(res,200,{ok:true});}
if(path.startsWith('/api/')){
const token=(req.headers.cookie||'').match(/(?:^|;\s*)session=([a-f0-9]+)/)?.[1];const session=db.prepare('SELECT users.id,users.name,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?').get(token||'',Date.now());if(!session)return json(res,401,{error:'Entre para continuar'});
if(path==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(token);res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true});}
if(path==='/api/me')return json(res,200,session);
if(path==='/api/tickets'&&req.method==='GET')return json(res,200,db.prepare('SELECT * FROM tickets ORDER BY id DESC').all());
if(path==='/api/tickets'&&req.method==='POST'){const b=await body(req);if(!str(b.title)||!['Baixa','Média','Alta','Crítica'].includes(b.priority))return json(res,400,{error:'Título e prioridade válidos são obrigatórios'});const row=db.prepare('INSERT INTO tickets(title,description,priority) VALUES(?,?,?)').run(str(b.title),str(b.description,5000),b.priority);return json(res,201,{id:Number(row.lastInsertRowid)});}
if(/^\/api\/tickets\/\d+$/.test(path)&&req.method==='PATCH'){const b=await body(req);if(!['Aberto','Em atendimento','Resolvido'].includes(b.status))return json(res,400,{error:'Status inválido'});const result=db.prepare('UPDATE tickets SET status=? WHERE id=?').run(b.status,Number(path.split('/').pop()));return json(res,result.changes?200:404,{ok:!!result.changes});}
if(path==='/api/assets'&&req.method==='GET')return json(res,200,db.prepare('SELECT id,name,owner,os,last_seen,metrics FROM assets ORDER BY id DESC').all());
if(path==='/api/assets'&&req.method==='POST'){const b=await body(req);if(!str(b.name))return json(res,400,{error:'Nome obrigatório'});const token=randomBytes(32).toString('hex');const row=db.prepare('INSERT INTO assets(name,owner,os,token) VALUES(?,?,?,?)').run(str(b.name),str(b.owner),str(b.os),token);return json(res,201,{id:Number(row.lastInsertRowid),token});}
return json(res,404,{error:'Rota não encontrada'});}
if(req.method==='GET'&&['/','/app.js','/style.css'].includes(path)){const name=path==='/'?'index.html':path.slice(1);res.setHeader('Content-Type',name.endsWith('html')?'text/html; charset=utf-8':name.endsWith('js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8');return res.end(readFileSync(root+'public/'+name));}
json(res,404,{error:'Não encontrado'});
}catch(err){json(res,400,{error:'Não foi possível processar a solicitação'});}}).listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('SISTEMA iniciado na porta '+(process.env.PORT||3000)));
