const fail=(m,s=400)=>{throw Object.assign(Error(m),{status:s});};
export function createOperations({db,body,json,config,desk,clock=()=>Date.now(),startScheduler=true}){
 db.exec(`CREATE TABLE IF NOT EXISTS service_alerts(id INTEGER PRIMARY KEY,asset_id INTEGER,kind TEXT,since INTEGER,last_seen INTEGER,resolved INTEGER,ack_by INTEGER);
 CREATE UNIQUE INDEX IF NOT EXISTS active_service_alert ON service_alerts(asset_id,kind) WHERE resolved IS NULL;
 CREATE TABLE IF NOT EXISTS preventive_plans(id INTEGER PRIMARY KEY,client_id INTEGER,title TEXT,interval_days INTEGER,next_date TEXT,active INTEGER DEFAULT 1);
 CREATE TABLE IF NOT EXISTS preventive_runs(plan_id INTEGER,due TEXT,ticket_id INTEGER,UNIQUE(plan_id,due));
 CREATE TABLE IF NOT EXISTS remote_requests(id INTEGER PRIMARY KEY,asset_id INTEGER,actor_id INTEGER,reason TEXT,consent TEXT,remote_id TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS service_automation(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 1);INSERT OR IGNORE INTO service_automation(id) VALUES(1);`);
 function tick(){if(!db.prepare('SELECT enabled FROM service_automation WHERE id=1').get().enabled)return;const now=clock();db.exec('BEGIN IMMEDIATE');try{
  for(const asset of db.prepare('SELECT id,last_seen,metrics FROM assets WHERE last_seen IS NOT NULL').all()){
   let m={};try{m=JSON.parse(asset.metrics||'{}');}catch{}const offline=now-Date.parse(asset.last_seen)>300000;
   const conditions={offline,cpu:!offline&&Number(m.cpuPercent??m.cpu?.usagePercent)>90,memory:!offline&&Number(m.memory?.usedPercent??m.memoryUsedPercent)>90,disk:!offline&&Array.isArray(m.disks)&&m.disks.some(d=>Number(d.usedPercent)>90)};
   for(const [kind,bad] of Object.entries(conditions)){const active=db.prepare('SELECT * FROM service_alerts WHERE asset_id=? AND kind=? AND resolved IS NULL').get(asset.id,kind);if(bad){if(active)db.prepare('UPDATE service_alerts SET last_seen=? WHERE id=?').run(now,active.id);else db.prepare('INSERT INTO service_alerts(asset_id,kind,since,last_seen) VALUES(?,?,?,?)').run(asset.id,kind,now,now);}else if(active)db.prepare('UPDATE service_alerts SET resolved=? WHERE id=?').run(now,active.id);}
  }
  const today=new Date(now).toISOString().slice(0,10);
  for(const p of db.prepare('SELECT * FROM preventive_plans WHERE active=1 AND next_date<=?').all(today)){
   if(!db.prepare('SELECT 1 FROM preventive_runs WHERE plan_id=? AND due=?').get(p.id,p.next_date)){
    const r=db.prepare("INSERT INTO tickets(title,description,priority,status_since,client_id) VALUES(?,?,'Baixa',CURRENT_TIMESTAMP,?)").run(p.title,`Preventiva #${p.id}, prevista para ${p.next_date}`,p.client_id),id=Number(r.lastInsertRowid);db.prepare('INSERT INTO preventive_runs VALUES(?,?,?)').run(p.id,p.next_date,id);desk.opened(id,null);
   }
   const next=new Date(Date.parse(today+'T00:00:00Z')+p.interval_days*86400000).toISOString().slice(0,10);db.prepare('UPDATE preventive_plans SET next_date=? WHERE id=?').run(next,p.id);
  }
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}}
 if(startScheduler){const timer=setInterval(()=>{try{tick();}catch{console.error('Falha no ciclo de operações; nova tentativa em 60 segundos.');}},60000);timer.unref();}
 async function handle(req,res,path,user){if(!path.startsWith('/api/operations/'))return false;const part=path.slice(16).split('/'),method=req.method,p=part[0]==='automation'?'system.manage':part[0]==='remote'?'remote.use':part[0]==='alerts'?'monitor.read':method==='GET'?'tickets.read':'contracts.manage';if(!config.allowed(user,p))fail('Sem permissão',403);
  if(part[0]==='automation'){if(method==='GET'){json(res,200,db.prepare('SELECT enabled FROM service_automation WHERE id=1').get());return true;}if(method==='PUT'){const b=await body(req);if(typeof b.enabled!=='boolean')fail('Opção inválida');db.prepare('UPDATE service_automation SET enabled=? WHERE id=1').run(b.enabled?1:0);config.audit(user,'operations.automation',b.enabled?'Automações ativadas':'Automações pausadas');json(res,200,{ok:true});return true;}fail('Rota inválida',404);}
  if(part[0]==='alerts'&&method==='GET'){
   const rows=db.prepare("SELECT s.*,a.name,a.client_id,c.name AS client_name FROM service_alerts s JOIN assets a ON a.id=s.asset_id LEFT JOIN clients c ON c.id=a.client_id WHERE s.resolved IS NOT NULL OR s.kind='offline' OR s.last_seen-s.since>=120000 ORDER BY s.id DESC LIMIT 200").all();
   const overdue=config.allowed(user,'tickets.read')?db.prepare("SELECT t.id AS ticket_id,t.title AS name,t.client_id,c.name AS client_name,s.response_due,s.resolution_due,s.responded_at FROM ticket_sla s JOIN tickets t ON t.id=s.ticket_id LEFT JOIN clients c ON c.id=t.client_id WHERE t.status<>'Resolvido' AND (CASE WHEN s.responded_at IS NULL THEN s.response_due ELSE s.resolution_due END)<?").all(new Date(clock()).toISOString()):[];
   json(res,200,[...overdue.map(t=>({...t,kind:'sla',since:Date.parse(t.responded_at?t.resolution_due:t.response_due),ack_by:1})),...rows]);return true;
  }
  if(part[0]==='alerts'&&method==='POST'){if(!config.allowed(user,'tickets.write'))fail('Sem permissão',403);const id=Number(part[1]);db.prepare('UPDATE service_alerts SET ack_by=? WHERE id=?').run(user.id,id);config.audit(user,'alerts.ack',`Alerta #${id}`);json(res,200,{ok:true});return true;}
  if(part[0]==='preventives'){
   if(method==='GET'){json(res,200,db.prepare('SELECT p.*,c.name AS client_name FROM preventive_plans p JOIN clients c ON c.id=p.client_id ORDER BY next_date').all());return true;}
   const b=await body(req);if(method==='PATCH'){const r=db.prepare('UPDATE preventive_plans SET active=? WHERE id=?').run(b.active===true?1:0,Number(part[1]));if(!r.changes)fail('Plano não encontrado',404);}
   else if(method==='POST'){if(!db.prepare('SELECT id FROM clients WHERE id=?').get(Number(b.clientId))||typeof b.title!=='string'||!b.title.trim()||b.title.length>500||!Number.isInteger(Number(b.intervalDays))||Number(b.intervalDays)<1||Number(b.intervalDays)>366||!/^\d{4}-\d{2}-\d{2}$/.test(b.nextDate)||!Number.isFinite(Date.parse(b.nextDate+'T00:00:00Z'))||new Date(b.nextDate).toISOString().slice(0,10)!==b.nextDate)fail('Plano inválido');db.prepare('INSERT INTO preventive_plans(client_id,title,interval_days,next_date) VALUES(?,?,?,?)').run(Number(b.clientId),b.title.trim(),Number(b.intervalDays),b.nextDate);}else fail('Rota inválida',404);config.audit(user,'preventives.save','Plano de manutenção atualizado');json(res,200,{ok:true});return true;
  }
  if(part[0]==='remote'){
   if(method==='GET'){json(res,200,{provider:'RustDesk',requests:db.prepare('SELECT r.*,a.name FROM remote_requests r LEFT JOIN assets a ON a.id=r.asset_id ORDER BY r.id DESC LIMIT 100').all(),notice:'Instale e configure o RustDesk nas duas máquinas. Este registro abre o aplicativo; não confirma conexão e não transmite tela.'});return true;}
   const b=await body(req),asset=db.prepare('SELECT id FROM assets WHERE id=?').get(Number(b.assetId));if(method!=='POST'||!asset||!/^\d{6,12}$/.test(b.remoteId)||typeof b.reason!=='string'||b.reason.trim().length<5||b.reason.length>1000||typeof b.consent!=='string'||b.consent.trim().length<5||b.consent.length>1000)fail('Informe equipamento, ID RustDesk numérico, motivo e autorização do responsável');const r=db.prepare('INSERT INTO remote_requests(asset_id,actor_id,reason,consent,remote_id) VALUES(?,?,?,?,?)').run(asset.id,user.id,b.reason.trim(),b.consent.trim(),b.remoteId);config.audit(user,'remote.request',`Solicitação #${r.lastInsertRowid}, equipamento #${asset.id}`);json(res,201,{id:Number(r.lastInsertRowid),url:'rustdesk://connection/new/'+b.remoteId});return true;
  }
  fail('Rota não encontrada',404);
 }
 return {handle,tick};
}
