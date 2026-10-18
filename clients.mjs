import {randomBytes} from 'node:crypto';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export function createClients({db,body,json,config,check}){
 db.exec(`CREATE TABLE IF NOT EXISTS clients(id INTEGER PRIMARY KEY,name TEXT NOT NULL,token TEXT UNIQUE NOT NULL);
 CREATE TABLE IF NOT EXISTS client_machines(client_id INTEGER NOT NULL,machine_id TEXT NOT NULL,asset_id INTEGER NOT NULL,PRIMARY KEY(client_id,machine_id));`);
 const columns=db.prepare('PRAGMA table_info(assets)').all().map(c=>c.name);
 if(!columns.includes('client_id'))db.exec('ALTER TABLE assets ADD COLUMN client_id INTEGER');
 const clean=v=>typeof v==='string'?v.trim().slice(0,500):'';
 const getClient=token=>db.prepare('SELECT id,name FROM clients WHERE token=?').get(token);
 const findDuplicate=(clientId,name,except=0)=>db.prepare('SELECT id FROM assets WHERE client_id=? AND lower(trim(name))=lower(trim(?)) AND id<>? ORDER BY id LIMIT 1').get(clientId,name,except);
 function enroll(client,sample){
  if(sample.legacy)fail('Token da empresa requer o agente Windows com identificação da máquina');
  let link=db.prepare('SELECT asset_id FROM client_machines WHERE client_id=? AND machine_id=?').get(client.id,sample.machineId);
  if(!link){
   if(!sample.inventory) return null;
   const result=db.prepare('INSERT INTO assets(name,owner,os,token,client_id,machine_id) VALUES(?,?,?,?,?,?)').run(sample.inventory.hostname,'',sample.os,randomBytes(32).toString('hex'),client.id,sample.machineId);
   link={asset_id:Number(result.lastInsertRowid)};
   db.prepare('INSERT INTO client_machines VALUES(?,?,?)').run(client.id,sample.machineId,link.asset_id);
   config.audit(null,'agent.enroll',`Equipamento #${link.asset_id} cadastrado na empresa #${client.id}`);
  }
  return db.prepare('SELECT id,name,machine_id,agent_info,last_metrics_at,last_inventory_at,os,inventory IS NOT NULL AS has_inventory FROM assets WHERE id=?').get(link.asset_id);
 }
 async function handle(req,res,path,user){
  if(!(path==='/api/clients'||path.startsWith('/api/clients/')||path==='/api/assets'&&req.method==='GET'||/^\/api\/assets\/\d+\/client$/.test(path)))return false;
  if(!config.allowed(user,req.method==='GET'?'assets.read':'assets.write'))fail('Sem permissão para gerenciar clientes e equipamentos',403);
  if(path==='/api/clients'&&req.method==='GET'){json(res,200,db.prepare('SELECT id,name,(SELECT count(*) FROM assets WHERE client_id=clients.id) AS equipment_count FROM clients ORDER BY name,id').all());return true;}
  if(path==='/api/clients'&&req.method==='POST'){
   const b=await body(req),name=clean(b.name);if(!name)fail('Nome da empresa obrigatório');
   if(db.prepare('SELECT id FROM clients WHERE lower(trim(name))=lower(?)').get(name))fail('Empresa já cadastrada',409);
   const token=randomBytes(32).toString('hex'),row=db.prepare('INSERT INTO clients(name,token) VALUES(?,?)').run(name,token);
   config.audit(user,'clients.create',`Empresa #${row.lastInsertRowid} cadastrada`);json(res,201,{id:Number(row.lastInsertRowid),token});return true;
  }
  if(/^\/api\/clients\/\d+\/token$/.test(path)&&req.method==='POST'){
   const id=Number(path.split('/')[3]),b=await body(req),stored=db.prepare('SELECT password FROM users WHERE id=?').get(user.id);
   if(typeof b.password!=='string'||b.password.length>256||!check(b.password,stored.password))fail('Senha atual incorreta',403);
   if(!db.prepare('SELECT id FROM clients WHERE id=?').get(id))fail('Empresa não encontrada',404);
   const token=randomBytes(32).toString('hex');db.prepare('UPDATE clients SET token=? WHERE id=?').run(token,id);config.audit(user,'clients.token',`Token da empresa #${id} renovado`);json(res,200,{token});return true;
  }
  if(path==='/api/assets'&&req.method==='GET'){
   const url=new URL(req.url,'http://localhost'),filter=url.searchParams.get('clientId');
   if(filter!==null&&!/^\d+$/.test(filter))fail('Filtro de cliente inválido');
   const rows=db.prepare(`SELECT a.id,a.code,a.name,a.owner,a.os,a.last_seen,a.metrics,a.agent_info,a.last_metrics_at,a.last_inventory_at,a.client_id,c.name AS client_name FROM assets a LEFT JOIN clients c ON c.id=a.client_id ${filter!==null?'WHERE coalesce(a.client_id,0)=?':''} ORDER BY c.name,a.name,a.id`).all(...(filter!==null?[Number(filter)]:[]));
   json(res,200,rows.map(a=>({...a,duplicate_of:a.client_id?(findDuplicate(a.client_id,a.name,a.id)?.id??null):null,...(!config.allowed(user,'monitor.read')?{metrics:undefined,agent_info:undefined,last_metrics_at:undefined,last_inventory_at:undefined}:{})})));return true;
  }
  if(/^\/api\/assets\/\d+\/client$/.test(path)&&req.method==='PATCH'){
   const id=Number(path.split('/')[3]),b=await body(req);
   if(!Number.isSafeInteger(b.clientId)||!db.prepare('SELECT id FROM clients WHERE id=?').get(b.clientId))fail('Selecione uma empresa válida');
   if(!db.prepare('SELECT id FROM assets WHERE id=?').get(id))fail('Equipamento não encontrado',404);
   if(db.prepare('SELECT asset_id FROM client_machines WHERE asset_id=?').get(id))fail('Equipamento conectado já pertence à empresa. Altere o token no agente para cadastrar em outra empresa.',409);
   db.prepare('UPDATE assets SET client_id=? WHERE id=?').run(b.clientId,id);config.audit(user,'assets.client',`Equipamento #${id} vinculado à empresa #${b.clientId}`);json(res,200,{ok:true});return true;
  }
  if(/^\/api\/clients\/\d+\/duplicates$/.test(path)&&req.method==='POST'){
   const clientId=Number(path.split('/')[3]),b=await body(req);
   if(!Number.isSafeInteger(b.keepId)||!Number.isSafeInteger(b.removeId)||b.keepId===b.removeId)fail('Selecione os dois cadastros e qual manter');
   const keep=db.prepare('SELECT * FROM assets WHERE id=? AND client_id=?').get(b.keepId,clientId),remove=db.prepare('SELECT * FROM assets WHERE id=? AND client_id=?').get(b.removeId,clientId);
   if(!keep||!remove||keep.name.trim().toLowerCase()!==remove.name.trim().toLowerCase())fail('Os cadastros precisam ter o mesmo nome e pertencer à mesma empresa',409);
   db.exec('BEGIN IMMEDIATE');try{
    db.prepare('INSERT OR IGNORE INTO telemetry(asset_id,sample_id,observed_at,received_at,metrics) SELECT ?,sample_id,observed_at,received_at,metrics FROM telemetry WHERE asset_id=?').run(keep.id,remove.id);
    db.prepare('DELETE FROM telemetry WHERE asset_id=?').run(remove.id);
    db.prepare('UPDATE client_machines SET asset_id=? WHERE asset_id=?').run(keep.id,remove.id);
    if(remove.machine_id)db.prepare('INSERT OR IGNORE INTO client_machines VALUES(?,?,?)').run(clientId,remove.machine_id,keep.id);
    if(!keep.inventory&&remove.inventory)db.prepare('UPDATE assets SET inventory=?,last_inventory_at=? WHERE id=?').run(remove.inventory,remove.last_inventory_at,keep.id);
    db.prepare('DELETE FROM assets WHERE id=?').run(remove.id);
    config.audit(user,'assets.merge',`Empresa #${clientId}: mantido equipamento #${keep.id}, mesclado #${remove.id}`);db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   json(res,200,{ok:true});return true;
  }
  fail('Rota não encontrada',404);
 }
 return {handle,getClient,enroll};
}
