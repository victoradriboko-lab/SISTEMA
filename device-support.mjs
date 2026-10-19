import {validCompanyToken} from './company-tokens.mjs';
import {createHash,randomBytes} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const clean=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
export function createDeviceSupport({db,body,json,config,desk,canOpenTicket=()=>{},clock=()=>Date.now()}){
 db.exec(`CREATE TABLE IF NOT EXISTS support_devices(id INTEGER PRIMARY KEY,client_id INTEGER NOT NULL,machine_id TEXT NOT NULL,name TEXT NOT NULL,key_hash TEXT NOT NULL UNIQUE,company_key_hash TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created INTEGER NOT NULL,UNIQUE(client_id,machine_id));
 CREATE TABLE IF NOT EXISTS support_requests(device_id INTEGER NOT NULL,request_id TEXT NOT NULL,ticket_id INTEGER NOT NULL,payload_hash TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(device_id,request_id));`);
 const bearer=req=>(req.headers.authorization||'').replace(/^Bearer /,'');
 const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
 async function publicRoute(req,res,path){
  if(!['/api/agent/support/enroll','/api/agent/support/tickets'].includes(path))return false;
  if(req.method!=='POST')fail('Método não permitido',405);
  const token=bearer(req);if(path.endsWith('/enroll')?!validCompanyToken(token):!/^[0-9a-f]{64}$/.test(token))fail('Autorização do equipamento inválida',401);
  if(path.endsWith('/enroll')){
   const b=await body(req),client=db.prepare('SELECT id,name,token FROM clients WHERE token=?').get(token);if(!client)fail('Use o token vigente da empresa para autorizar o aplicativo',401);
   if(!uuid(b.machineId)||!clean(b.name,120)||typeof b.name!=='string'||b.name.length>120)fail('Identidade do equipamento inválida');
   const secret=randomBytes(32).toString('hex');db.prepare('INSERT INTO support_devices(client_id,machine_id,name,key_hash,company_key_hash,created) VALUES(?,?,?,?,?,?) ON CONFLICT(client_id,machine_id) DO UPDATE SET name=excluded.name,key_hash=excluded.key_hash,company_key_hash=excluded.company_key_hash,active=1,created=excluded.created').run(client.id,b.machineId.toLowerCase(),clean(b.name,120),sha(secret),sha(client.token),clock());config.audit(null,'support.enroll',`Aplicativo autorizado na empresa #${client.id}, equipamento ${clean(b.name,120)}`);json(res,201,{supportToken:secret,companyName:client.name});return true;
  }
  const b=await body(req),device=db.prepare('SELECT d.*,c.name AS company_name,c.token AS company_token FROM support_devices d JOIN clients c ON c.id=d.client_id WHERE d.key_hash=? AND d.active=1').get(sha(token));
  if(!device||device.company_key_hash!==sha(device.company_token))fail('Autorização revogada. Solicite a atualização do agente à equipe de TI.',401);
  if(b.clientId!==undefined||b.operatorId!==undefined||b.status!==undefined||b.priority!==undefined)fail('A empresa e a classificação são definidas pelo servidor',403);
  if(!uuid(b.requestId)||typeof b.title!=='string'||!b.title.trim()||b.title.length>500||typeof b.description!=='string'||!b.description.trim()||b.description.length>5000||typeof b.requester!=='string'||!b.requester.trim()||b.requester.length>120||b.email!==undefined&&(typeof b.email!=='string'||b.email.length>254||b.email!==''&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)))fail('Informe nome, título, descrição e um e-mail válido quando preenchido');
  const payload=sha(JSON.stringify([b.title.trim(),b.description.trim(),b.requester.trim(),b.email||''])),requestId=b.requestId.toLowerCase();
  db.exec('BEGIN IMMEDIATE');try{
   const old=db.prepare('SELECT * FROM support_requests WHERE device_id=? AND request_id=?').get(device.id,requestId);
   if(old){if(old.payload_hash!==payload)fail('Este envio já foi recebido com outro conteúdo. Abra uma nova solicitação.',409);json(res,200,{id:old.ticket_id,duplicate:true});db.exec('COMMIT');return true;}
   if(db.prepare('SELECT count(*) AS n FROM support_requests WHERE device_id=? AND created>?').get(device.id,clock()-3600000).n>=10)fail('Limite de 10 chamados por hora neste equipamento. Contate a equipe de suporte.',429);
   canOpenTicket(device.client_id);
   const description=`Origem: aplicativo instalado\nEquipamento: ${device.name}\nSolicitante informado (não autenticado individualmente): ${b.requester.trim()}\nE-mail informado (não verificado): ${b.email||'Não informado'}\n\n${b.description.trim()}`;
   const r=db.prepare("INSERT INTO tickets(title,description,priority,status_since,client_id) VALUES(?,?,'Média',CURRENT_TIMESTAMP,?)").run(b.title.trim(),description,device.client_id),id=Number(r.lastInsertRowid);db.prepare('INSERT INTO support_requests VALUES(?,?,?,?,?)').run(device.id,requestId,id,payload,clock());desk.opened(id,null);desk.event(id,null,'device',`Aberto pelo aplicativo do equipamento ${device.name}; autorização de dispositivo #${device.id}`,false);config.audit(null,'support.ticket',`Chamado #${id}, dispositivo #${device.id}, empresa #${device.client_id}`);db.exec('COMMIT');json(res,201,{id});return true;
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
 }
 async function handle(req,res,path,user){
  if(!path.startsWith('/api/support-devices'))return false;
  if(!config.allowed(user,'assets.write'))fail('Sem permissão',403);
  if(path==='/api/support-devices'&&req.method==='GET'){json(res,200,db.prepare('SELECT d.id,d.name,d.client_id,d.active,d.company_key_hash,c.token,c.name AS client_name FROM support_devices d JOIN clients c ON c.id=d.client_id ORDER BY c.name,d.name').all().map(({company_key_hash,token,...d})=>({...d,active:d.active===1&&company_key_hash===sha(token)?1:0})));return true;}
  if(/^\/api\/support-devices\/\d+\/revoke$/.test(path)&&req.method==='POST'){const id=Number(path.split('/')[3]);db.prepare('UPDATE support_devices SET active=0 WHERE id=?').run(id);config.audit(user,'support.revoke',`Autorização do dispositivo #${id} revogada`);json(res,200,{ok:true});return true;}
  fail('Rota não encontrada',404);
 }
 return {publicRoute,handle};
}
