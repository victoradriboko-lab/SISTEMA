import {DateTime} from 'luxon';
const fail=(m,s=400)=>{throw Object.assign(Error(m),{status:s});};
const text=(v,n=5000)=>typeof v==='string'?v.trim().slice(0,n):'';
export function deadline(start,minutes,contract){
 let date=DateTime.fromMillis(start,{zone:contract.zone||'America/Sao_Paulo'}),left=minutes;
 if(contract.calendar==='24x7')return date.plus({minutes}).toUTC().toISO();
 for(let day=0;day<3700&&left>0;day++){
  if(date.weekday>5){date=date.plus({days:1}).startOf('day');continue;}
  const begin=date.startOf('day').plus({hours:contract.startHour??8}),end=date.startOf('day').plus({hours:contract.endHour??18});
  if(date<begin)date=begin;
  if(date>=end){date=date.plus({days:1}).startOf('day');continue;}
  const available=end.diff(date,'minutes').minutes;if(left<=available)return date.plus({minutes:left}).toUTC().toISO();left-=available;date=date.plus({days:1}).startOf('day');
 }
 fail('Prazo de SLA fora do limite');
}
export function createServiceDesk({db,body,json,config,clock=()=>Date.now()}){
 db.exec(`CREATE TABLE IF NOT EXISTS service_companies(client_id INTEGER PRIMARY KEY,profile TEXT NOT NULL DEFAULT '{}',contract TEXT NOT NULL DEFAULT '{}');
 CREATE TABLE IF NOT EXISTS ticket_events(id INTEGER PRIMARY KEY,ticket_id INTEGER NOT NULL,actor_id INTEGER,actor_name TEXT,kind TEXT NOT NULL,public INTEGER NOT NULL DEFAULT 0,text TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS ticket_files(id INTEGER PRIMARY KEY,ticket_id INTEGER NOT NULL,event_id INTEGER,filename TEXT NOT NULL,data BLOB NOT NULL,public INTEGER NOT NULL DEFAULT 0,created TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS ticket_work(id INTEGER PRIMARY KEY,ticket_id INTEGER NOT NULL,actor_id INTEGER NOT NULL,actor_name TEXT,minutes INTEGER NOT NULL,hour_cost REAL NOT NULL,expenses REAL NOT NULL,note TEXT NOT NULL,worked_on TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS ticket_sla(ticket_id INTEGER PRIMARY KEY,client_id INTEGER,contract TEXT NOT NULL,response_due TEXT,resolution_due TEXT,responded_at TEXT,resolved_at TEXT);
 CREATE INDEX IF NOT EXISTS ticket_events_ticket ON ticket_events(ticket_id,id);`);
 const userCols=db.prepare('PRAGMA table_info(users)').all();if(!userCols.some(c=>c.name==='portal_write'))db.exec('ALTER TABLE users ADD COLUMN portal_write INTEGER NOT NULL DEFAULT 0');
 let notify=()=>{};
 const company=id=>db.prepare('SELECT * FROM service_companies WHERE client_id=?').get(id);
 function event(id,user,kind,message,pub=false){const r=db.prepare('INSERT INTO ticket_events(ticket_id,actor_id,actor_name,kind,text,public) VALUES(?,?,?,?,?,?)').run(id,user?.id??null,user?.name||'Sistema',kind,text(message),pub?1:0);config.audit(user,'desk.'+kind,`Chamado #${id}`);if(pub&&kind!=='attachment')notify(id,text(message),user);return Number(r.lastInsertRowid);}
 function opened(id,user){const ticket=db.prepare('SELECT * FROM tickets WHERE id=?').get(id);if(!ticket)return;event(id,user,'created','Chamado aberto',true);snapshot(ticket);}
 function snapshot(ticket){db.prepare('DELETE FROM ticket_sla WHERE ticket_id=?').run(ticket.id);const contract=JSON.parse(company(ticket.client_id)?.contract||'{}');if(!contract.enabled)return;const target=contract.targets[ticket.priority];db.prepare('INSERT INTO ticket_sla(ticket_id,client_id,contract,response_due,resolution_due) VALUES(?,?,?,?,?)').run(ticket.id,ticket.client_id,JSON.stringify(contract),deadline(clock(),target.response,contract),deadline(clock(),target.resolution,contract));}
 function updated(id,user,before){const t=db.prepare('SELECT * FROM tickets WHERE id=?').get(id);event(id,user,'changed',`Situação: ${before.status} → ${t.status}; empresa: ${t.client_id??'—'}; operador: ${t.operator_id??'—'}; atendimento: ${t.service_type??'—'}`,false);if(before.client_id!==t.client_id)snapshot(t);if(t.status!=='Aberto')db.prepare('UPDATE ticket_sla SET responded_at=coalesce(responded_at,?) WHERE ticket_id=?').run(new Date(clock()).toISOString(),id);if(t.status==='Resolvido')db.prepare('UPDATE ticket_sla SET resolved_at=coalesce(resolved_at,?) WHERE ticket_id=?').run(new Date(clock()).toISOString(),id);else if(before.status==='Resolvido')db.prepare('UPDATE ticket_sla SET resolved_at=NULL WHERE ticket_id=?').run(id);}
 function decorate(t){const sla=db.prepare('SELECT * FROM ticket_sla WHERE ticket_id=?').get(t.id);if(!sla)return {...t,sla:null};const due=!sla.responded_at?sla.response_due:!sla.resolved_at?sla.resolution_due:null;return {...t,sla:{...sla,contract:undefined,state:due?(Date.parse(due)<clock()?'overdue':'running'):'complete'}};}
 function detail(id,user,portal){const ticket=db.prepare('SELECT * FROM tickets WHERE id=?').get(id);if(!ticket||portal&&ticket.client_id!==user.client_id)fail('Chamado não encontrado',404);const events=db.prepare(`SELECT id,actor_name,kind,text,public,created FROM ticket_events WHERE ticket_id=? ${portal?'AND public=1':''} ORDER BY id`).all(id),files=db.prepare(`SELECT id,filename,created FROM ticket_files WHERE ticket_id=? ${portal?'AND public=1':''}`).all(id);return {ticket:decorate(ticket),events,files,work:portal?undefined:db.prepare('SELECT id,actor_name,minutes,note,worked_on FROM ticket_work WHERE ticket_id=? ORDER BY id DESC').all(id)};}
 async function handle(req,res,path,user,portal=false){
  if(!path.startsWith('/api/desk/'))return false;
  const part=path.slice(10).split('/'),method=req.method;
  if(portal&&!['tickets','files'].includes(part[0]))fail('Área interna',403);
  const need=p=>{if(!config.allowed(user,p))fail('Sem permissão',403);};
  if(!portal)need(part[0]==='finance'?'finance.read':method==='GET'?'tickets.read':part[0]==='companies'?'contracts.manage':'tickets.write');
  if(portal){if(!Number.isSafeInteger(user.client_id)||!db.prepare('SELECT id FROM clients WHERE id=?').get(user.client_id))fail('Empresa não autorizada',403);if(method!=='GET'&&!db.prepare('SELECT portal_write FROM users WHERE id=?').get(user.id)?.portal_write)fail('Seu acesso é somente de consulta',403);}
  if(part[0]==='companies'){
   if(method==='GET'){json(res,200,db.prepare('SELECT c.id,c.name,s.profile,s.contract FROM clients c LEFT JOIN service_companies s ON s.client_id=c.id ORDER BY c.name').all().map(c=>({...c,profile:JSON.parse(c.profile||'{}'),contract:config.allowed(user,'contracts.manage')?JSON.parse(c.contract||'{}'):undefined})));return true;}
   const id=Number(part[1]);if(method!=='PUT'||!db.prepare('SELECT id FROM clients WHERE id=?').get(id))fail('Empresa não encontrada',404);const b=await body(req),p=b.profile||{},c=b.contract||{};
   const profile=Object.fromEntries(['cnpj','address','contact','phone','email','technician','notes','sites','documents'].map(k=>[k,text(p[k],k==='notes'||k==='sites'||k==='documents'?5000:500)]));
   const contract={enabled:c.enabled===true,name:text(c.name,200),monthly:Number(c.monthly||0),hourCost:Number(c.hourCost||0),includedHours:Number(c.includedHours||0),calendar:c.calendar==='24x7'?'24x7':'business',zone:c.zone||'America/Sao_Paulo',startHour:Number(c.startHour??8),endHour:Number(c.endHour??18),targets:c.targets};
   if(!DateTime.now().setZone(contract.zone).isValid||![contract.monthly,contract.hourCost,contract.includedHours].every(v=>Number.isFinite(v)&&v>=0&&v<=1e8)||!Number.isInteger(contract.startHour)||!Number.isInteger(contract.endHour)||contract.startHour<0||contract.endHour>24||contract.startHour>=contract.endHour)fail('Valores ou calendário inválidos');
   contract.targets=Object.fromEntries(['Baixa','Média','Alta','Crítica'].map(k=>{const v=c.targets?.[k]||{response:240,resolution:1440};if(![v.response,v.resolution].every(x=>Number.isInteger(x)&&x>=1&&x<=525600)||v.resolution<v.response)fail('SLA deve conter minutos positivos e solução maior ou igual à resposta');return [k,v];}));
   db.prepare('INSERT INTO service_companies(client_id,profile,contract) VALUES(?,?,?) ON CONFLICT(client_id) DO UPDATE SET profile=excluded.profile,contract=excluded.contract').run(id,JSON.stringify(profile),JSON.stringify(contract));config.audit(user,'contracts.save',`Empresa #${id}`);json(res,200,{ok:true});return true;
  }
  if(part[0]==='finance'&&method==='GET'){
   const month=new URL(req.url,'http://localhost').searchParams.get('month')||new Date(clock()).toISOString().slice(0,7);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail('Mês inválido');
   const rows=db.prepare('SELECT c.id,c.name,s.contract FROM clients c LEFT JOIN service_companies s ON s.client_id=c.id').all().map(c=>{const contract=JSON.parse(c.contract||'{}'),tot=db.prepare("SELECT coalesce(sum(w.minutes),0) AS minutes,coalesce(sum(w.minutes*w.hour_cost/60+w.expenses),0) AS cost FROM ticket_work w JOIN tickets t ON t.id=w.ticket_id WHERE t.client_id=? AND substr(w.worked_on,1,7)=?").get(c.id,month),revenue=Number(contract.monthly||0);return {id:c.id,name:c.name,...tot,revenue,margin:revenue-tot.cost,includedHours:Number(contract.includedHours||0)};});json(res,200,{month,rows,basis:'Receita mensal contratada atual; custos registrados na data do trabalho. Não substitui contabilidade.'});return true;
  }
  if(part[0]==='files'&&method==='GET'){
   const file=db.prepare('SELECT * FROM ticket_files WHERE id=?').get(Number(part[1]));if(!file)fail('Arquivo não encontrado',404);detail(file.ticket_id,user,portal);if(portal&&!file.public)fail('Arquivo não encontrado',404);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`});res.end(file.data);return true;
  }
  if(part[0]==='tickets'){
   if(!part[1]&&method==='POST'&&portal){const b=await body(req);if(!text(b.title,500)||!text(b.description))fail('Informe título e descrição');if(b.clientId!==undefined&&Number(b.clientId)!==user.client_id)fail('Empresa não autorizada',403);const r=db.prepare("INSERT INTO tickets(title,description,priority,status_since,client_id) VALUES(?,?,'Média',CURRENT_TIMESTAMP,?)").run(text(b.title,500),text(b.description),user.client_id),id=Number(r.lastInsertRowid);opened(id,user);json(res,201,{id});return true;}
   const id=Number(part[1]),d=detail(id,user,portal);
   if(method==='GET'&&part.length===2){if(!portal&&!config.allowed(user,'contracts.manage')&&d.ticket.sla)d.ticket.sla.contract=undefined;json(res,200,d);return true;}
   if(method!=='POST')fail('Rota não encontrada',404);const b=await body(req);
   if(part[2]==='messages'){if(!text(b.text))fail('Escreva a mensagem');const pub=portal||b.public===true;event(id,user,pub?'message':'note',b.text,pub);if(pub&&!portal)db.prepare('UPDATE ticket_sla SET responded_at=coalesce(responded_at,?) WHERE ticket_id=?').run(new Date(clock()).toISOString(),id);}
   else if(part[2]==='files'){const data=typeof b.base64==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(b.base64)?Buffer.from(b.base64,'base64'):null,filename=text(b.filename,180).replace(/[\\/\r\n]/g,'_');if((db.prepare('SELECT coalesce(sum(length(data)),0) AS n FROM ticket_files WHERE ticket_id=?').get(id).n)+(data?.length||0)>20*1024*1024)fail('Limite de anexos deste chamado: 20 MB');if(!filename||!data?.length||data.length>512*1024)fail('Anexe um arquivo de até 512 KB');const pub=portal||b.public===true,eventId=event(id,user,'attachment',`Arquivo: ${filename}`,pub);db.prepare('INSERT INTO ticket_files(ticket_id,event_id,filename,data,public) VALUES(?,?,?,?,?)').run(id,eventId,filename,data,pub?1:0);}
   else if(part[2]==='work'&&!portal){const minutes=Number(b.minutes),expenses=Number(b.expenses||0),contract=JSON.parse(company(d.ticket.client_id)?.contract||'{}');if(!Number.isInteger(minutes)||minutes<1||minutes>1440||!Number.isFinite(expenses)||expenses<0||expenses>1e8||!/^\d{4}-\d{2}-\d{2}$/.test(b.workedOn)||!DateTime.fromISO(b.workedOn).isValid||!text(b.note))fail('Informe data válida, minutos (1–1440), custos e descrição');db.prepare('INSERT INTO ticket_work(ticket_id,actor_id,actor_name,minutes,hour_cost,expenses,note,worked_on) VALUES(?,?,?,?,?,?,?,?)').run(id,user.id,user.name,minutes,Number(contract.hourCost||0),expenses,text(b.note),b.workedOn);event(id,user,'work',`${minutes} minuto(s) registrados`,false);}
   else fail('Rota não permitida',403);json(res,201,{ok:true});return true;
  }
  fail('Rota não encontrada',404);
 }
 return {handle,opened,updated,event,decorate,setNotify:fn=>{notify=fn;}};
}
