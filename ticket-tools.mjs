const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const text=(value,max=500)=>typeof value==='string'?value.trim().slice(0,max):'';
export function createTicketTools({db,json,body,config,desk,reports}){
 const columns=new Set(db.prepare('PRAGMA table_info(tickets)').all().map(c=>c.name));
 for(const [name,type] of [['category','TEXT'],['subcategory','TEXT'],['contact','TEXT'],['unit','TEXT'],['ticket_type','TEXT'],['asset_id','INTEGER'],['progress','INTEGER'],['updated_at','TEXT']])if(!columns.has(name))db.exec(`ALTER TABLE tickets ADD COLUMN ${name} ${type}`);
 db.exec(`CREATE TABLE IF NOT EXISTS ticket_checklist(id INTEGER PRIMARY KEY,ticket_id INTEGER NOT NULL,label TEXT NOT NULL,done INTEGER NOT NULL DEFAULT 0,actor_id INTEGER,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS ticket_followers(ticket_id INTEGER NOT NULL,user_id INTEGER NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(ticket_id,user_id));
 CREATE TABLE IF NOT EXISTS ticket_parts(id INTEGER PRIMARY KEY,ticket_id INTEGER NOT NULL,name TEXT NOT NULL,quantity INTEGER NOT NULL,unit_cents INTEGER NOT NULL,note TEXT NOT NULL DEFAULT '',actor_id INTEGER,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS knowledge_articles(id INTEGER PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL,actor_id INTEGER,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS ticket_knowledge(ticket_id INTEGER NOT NULL,article_id INTEGER NOT NULL,PRIMARY KEY(ticket_id,article_id));
 CREATE INDEX IF NOT EXISTS ticket_checklist_ticket ON ticket_checklist(ticket_id,id);
 CREATE INDEX IF NOT EXISTS ticket_parts_ticket ON ticket_parts(ticket_id,id);`);

 const touch=id=>db.prepare('UPDATE tickets SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
 function audit(id,user,kind,message){touch(id);desk.event(id,user,kind,message,false);config.audit(user,'tickets.'+kind,`Chamado #${id}: ${message}`);}
 const get=id=>{const t=db.prepare('SELECT * FROM tickets WHERE id=?').get(id);if(!t)fail('Chamado não encontrado',404);return t;};
 function preparePatch(ticket,patch){
  const allowed=['title','description','priority','status','operatorId','serviceType','category','subcategory','contact','unit','ticketType','assetId','progress'];
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||!Object.keys(patch).length||Object.keys(patch).some(k=>!allowed.includes(k)))fail('Campos da atualização inválidos');
  const result={};
  for(const key of ['title','description','category','subcategory','contact','unit','ticketType'])if(patch[key]!==undefined){if(typeof patch[key]!=='string'||patch[key].length>(key==='description'?5000:500)||key==='title'&&!patch[key].trim())fail('Texto inválido: '+key);result[key==='ticketType'?'ticket_type':key]=patch[key];}
  if(patch.priority!==undefined){if(!['Baixa','Média','Alta','Crítica'].includes(patch.priority))fail('Prioridade inválida');result.priority=patch.priority;}
  if(patch.status!==undefined){if(!['Aberto','Em atendimento','Resolvido'].includes(patch.status))fail('Situação inválida');result.status=patch.status;}
  if(patch.serviceType!==undefined){if(patch.serviceType!==null&&!['Interno','Externo'].includes(patch.serviceType))fail('Atendimento deve ser Interno ou Externo');result.service_type=patch.serviceType;}
  const status=result.status??ticket.status,serviceType=result.service_type===undefined?ticket.service_type:result.service_type;
  if(patch.status!==undefined&&['Em atendimento','Resolvido'].includes(status)&&!serviceType)fail('Informe o tipo de atendimento para iniciar ou resolver');
  if(patch.operatorId!==undefined){if(patch.operatorId!==null&&(!Number.isSafeInteger(patch.operatorId)||!reports.canAssignOperator(patch.operatorId)))fail('Selecione um operador ativo com permissão de atendimento');result.operator_id=patch.operatorId;}
  if(patch.progress!==undefined){if(!Number.isInteger(patch.progress)||patch.progress<0||patch.progress>100)fail('Progresso deve ser um número inteiro de 0 a 100');result.progress=patch.progress;}
  if(patch.assetId!==undefined){if(patch.assetId!==null){if(!Number.isSafeInteger(patch.assetId))fail('Equipamento inválido');const asset=db.prepare('SELECT id,client_id FROM assets WHERE id=?').get(patch.assetId);if(!Number.isSafeInteger(patch.assetId)||!asset||asset.client_id!==ticket.client_id)fail('O equipamento deve pertencer à empresa do chamado');}result.asset_id=patch.assetId;}
  return result;
 }
 function update(ticket,fields,user){
  if(fields.status!==undefined&&fields.status!==ticket.status)db.prepare('UPDATE tickets SET status_since=CURRENT_TIMESTAMP WHERE id=?').run(ticket.id);
  const entries=Object.entries(fields);db.prepare(`UPDATE tickets SET ${entries.map(([key])=>key+'=?').join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...entries.map(([,value])=>value),ticket.id);
  if(fields.status!==undefined)desk.updated(ticket.id,user,ticket);
  desk.event(ticket.id,user,'edited','Dados do ticket atualizados: '+entries.map(([k])=>k).join(', '),false);config.audit(user,'tickets.edit',`Chamado #${ticket.id}: ${entries.map(([k])=>k).join(', ')}`);
 }
 async function handle(req,res,path,user){
  if(!path.startsWith('/api/ticket-tools/'))return false;
  if(!config.allowed(user,req.method==='GET'?'tickets.read':'tickets.write'))fail('Sem permissão para esta operação',403);
  if(path==='/api/ticket-tools/bulk'&&req.method==='POST'){
   const b=await body(req);if(!Array.isArray(b.ids)||!b.ids.length||b.ids.length>100||b.ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(b.ids).size!==b.ids.length)fail('Selecione de 1 a 100 tickets distintos');
   const updates=b.ids.map(id=>{const ticket=get(id);return {ticket,fields:preparePatch(ticket,b.patch)};});
   db.exec('BEGIN IMMEDIATE');try{for(const {ticket,fields} of updates)update(ticket,fields,user);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}json(res,200,{ok:true,count:updates.length});return true;
  }
  const match=path.match(/^\/api\/ticket-tools\/tickets\/(\d+)(?:\/(checklist|followers|parts|knowledge|recalculate)(?:\/(\d+))?)?$/);if(!match)fail('Rota não encontrada',404);
  const id=Number(match[1]),action=match[2],itemId=Number(match[3]),ticket=get(id);
  if(!action&&req.method==='GET'){
   const checklist=db.prepare('SELECT * FROM ticket_checklist WHERE ticket_id=? ORDER BY id').all(id),followers=db.prepare('SELECT f.user_id,u.name FROM ticket_followers f JOIN users u ON u.id=f.user_id WHERE ticket_id=? ORDER BY u.name').all(id),parts=db.prepare('SELECT * FROM ticket_parts WHERE ticket_id=? ORDER BY id').all(id);
   const knowledge=db.prepare('SELECT a.* FROM ticket_knowledge k JOIN knowledge_articles a ON a.id=k.article_id WHERE k.ticket_id=? ORDER BY a.id').all(id),knowledgeCatalog=db.prepare('SELECT id,title FROM knowledge_articles ORDER BY id DESC LIMIT 200').all(),incoming=db.prepare('SELECT id,sender,subject,text,mail_date,received_at FROM email_messages WHERE ticket_id=? ORDER BY id').all(id),outgoing=db.prepare('SELECT id,recipient,subject,text,status,created,sent_at FROM email_outbox WHERE ticket_id=? ORDER BY id').all(id);
   const companyEntries=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='company_entries'").get()?db.prepare("SELECT kind,name,data FROM company_entries WHERE client_id=? AND active=1 AND kind IN ('units','contacts','groups')").all(ticket.client_id).map(e=>({...e,data:JSON.parse(e.data)})):[];
   const companyChoices={unit:companyEntries.filter(e=>e.kind==='units').map(e=>e.name),contact:companyEntries.filter(e=>e.kind==='contacts').map(e=>e.name),category:[...new Set(companyEntries.filter(e=>e.kind==='groups').flatMap(e=>e.data.categories||[]))]};
   json(res,200,{companyChoices,checklist,followers,parts,knowledge,knowledgeCatalog,incoming,outgoing,users:db.prepare("SELECT id,name FROM users WHERE active=1 AND account_type='internal' ORDER BY name").all(),assets:config.allowed(user,'assets.read')?db.prepare('SELECT id,name FROM assets WHERE client_id IS ? ORDER BY name').all(ticket.client_id):[]});return true;
  }
  const b=req.method==='DELETE'?{}:await body(req);
  if(!action&&req.method==='PATCH'){const fields=preparePatch(ticket,b);db.exec('BEGIN IMMEDIATE');try{update(ticket,fields,user);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}json(res,200,{ok:true});return true;}
  if(action==='recalculate'&&req.method==='POST'&&!itemId){if(!config.allowed(user,'contracts.manage'))fail('Sem permissão para recalcular SLA',403);if(b.confirm!==true)fail('Confirme o recálculo do SLA');desk.recalculate(id,user);touch(id);json(res,200,{ok:true});return true;}
  if(action==='checklist'){
   if(req.method==='POST'&&!itemId){const label=text(b.label);if(!label)fail('Informe o item do checklist');db.prepare('INSERT INTO ticket_checklist(ticket_id,label,actor_id) VALUES(?,?,?)').run(id,label,user.id);audit(id,user,'checklist','Item adicionado: '+label);}
   else{const item=db.prepare('SELECT * FROM ticket_checklist WHERE id=? AND ticket_id=?').get(itemId,id);if(!item)fail('Item não encontrado',404);if(req.method==='PATCH'){if(typeof b.done!=='boolean')fail('Conclusão inválida');db.prepare('UPDATE ticket_checklist SET done=? WHERE id=? AND ticket_id=?').run(b.done?1:0,itemId,id);audit(id,user,'checklist',`${b.done?'Concluído':'Reaberto'}: ${item.label}`);}else if(req.method==='DELETE'){db.prepare('DELETE FROM ticket_checklist WHERE id=? AND ticket_id=?').run(itemId,id);audit(id,user,'checklist','Item removido: '+item.label);}else fail('Método inválido',405);}
  }else if(action==='followers'){
   if(req.method==='POST'&&!itemId){if(!Number.isSafeInteger(b.userId)||!db.prepare("SELECT id FROM users WHERE id=? AND active=1 AND account_type='internal'").get(b.userId))fail('Selecione um usuário interno ativo');db.prepare('INSERT OR IGNORE INTO ticket_followers(ticket_id,user_id) VALUES(?,?)').run(id,b.userId);audit(id,user,'followers','Seguidor adicionado #'+b.userId);}
   else if(req.method==='DELETE'&&itemId){db.prepare('DELETE FROM ticket_followers WHERE ticket_id=? AND user_id=?').run(id,itemId);audit(id,user,'followers','Seguidor removido #'+itemId);}else fail('Método inválido',405);
  }else if(action==='knowledge'){
   if(req.method==='POST'&&!itemId){
    let articleId=b.articleId;
    if(articleId!==undefined){if(!Number.isSafeInteger(articleId)||!db.prepare('SELECT id FROM knowledge_articles WHERE id=?').get(articleId))fail('Artigo não encontrado',404);}
    else{const title=text(b.title),content=text(b.content,20000);if(!title||!content)fail('Informe título e conteúdo do artigo');articleId=Number(db.prepare('INSERT INTO knowledge_articles(title,content,actor_id) VALUES(?,?,?)').run(title,content,user.id).lastInsertRowid);}
    db.prepare('INSERT OR IGNORE INTO ticket_knowledge(ticket_id,article_id) VALUES(?,?)').run(id,articleId);audit(id,user,'knowledge','Artigo vinculado #'+articleId);
   }else if(req.method==='DELETE'&&itemId){db.prepare('DELETE FROM ticket_knowledge WHERE ticket_id=? AND article_id=?').run(id,itemId);audit(id,user,'knowledge','Artigo desvinculado #'+itemId);}else fail('Método inválido',405);
  }else if(action==='parts'){
   if(req.method==='POST'&&!itemId){const name=text(b.name),quantity=Number(b.quantity),price=Number(b.unitPrice);if(!name||!Number.isInteger(quantity)||quantity<1||quantity>100000||!Number.isFinite(price)||price<0||price>1e7||Math.abs(price*100-Math.round(price*100))>0.0001)fail('Informe peça, quantidade positiva e preço com até duas casas decimais');db.prepare('INSERT INTO ticket_parts(ticket_id,name,quantity,unit_cents,note,actor_id) VALUES(?,?,?,?,?,?)').run(id,name,quantity,Math.round(price*100),text(b.note,2000),user.id);audit(id,user,'parts',`Peça adicionada: ${name} · ${quantity} unidade(s)`);}
   else if(req.method==='DELETE'&&itemId){const part=db.prepare('SELECT * FROM ticket_parts WHERE id=? AND ticket_id=?').get(itemId,id);if(!part)fail('Peça não encontrada',404);db.prepare('DELETE FROM ticket_parts WHERE id=? AND ticket_id=?').run(itemId,id);audit(id,user,'parts','Peça removida: '+part.name);}else fail('Método inválido',405);
  }else fail('Rota não encontrada',404);
  json(res,200,{ok:true});return true;
 }
 return {handle};
}
