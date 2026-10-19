import {DateTime} from 'luxon';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const clean=(v,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const kinds={teams:{read:'users.manage',write:'users.manage'},departments:{read:'tickets.read',write:'tickets.write'},holidays:{read:'tickets.read',write:'contracts.manage'},schedules:{read:'tickets.read',write:'contracts.manage'},documents:{read:'tickets.read',write:'company.manage'}};
export function createRegistrations({db,json,body,config}){
 db.exec(`CREATE TABLE IF NOT EXISTS directory_entries(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,data TEXT NOT NULL DEFAULT '{}',active INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS directory_entries_kind ON directory_entries(kind,active,name);
 CREATE TABLE IF NOT EXISTS directory_files(entry_id INTEGER PRIMARY KEY,filename TEXT NOT NULL,data BLOB NOT NULL);`);
 const client=id=>id===null||Number.isSafeInteger(id)&&!!db.prepare('SELECT id FROM clients WHERE id=?').get(id);
 const internal=id=>Number.isSafeInteger(id)&&!!db.prepare("SELECT id FROM users WHERE id=? AND account_type='internal'").get(id);
 function validate(kind,input){
  const b=input||{},data={};
  if(kind==='teams'){
   if(!Array.isArray(b.memberIds)||b.memberIds.length>500||b.memberIds.some(id=>!internal(id)))fail('Selecione operadores internos cadastrados');data.memberIds=[...new Set(b.memberIds)];data.leaderId=b.leaderId??null;if(data.leaderId!==null&&(!internal(data.leaderId)||!data.memberIds.includes(data.leaderId)))fail('O responsável deve fazer parte da equipe');data.notes=clean(b.notes,5000);
  }
  if(kind==='departments'){
   if(!Number.isSafeInteger(b.clientId)||!client(b.clientId))fail('Selecione a empresa do setor');data.clientId=b.clientId;data.contact=clean(b.contact);data.email=clean(b.email,254);if(data.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))fail('E-mail inválido');data.notes=clean(b.notes,5000);
  }
  if(kind==='holidays'){
   if(typeof b.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||!DateTime.fromISO(b.date).isValid)fail('Data do feriado inválida');if(typeof b.annual!=='boolean')fail('Informe a recorrência do feriado');data.date=b.date;data.annual=b.annual;data.clientId=b.clientId??null;if(!client(data.clientId))fail('Empresa inválida');data.notes=clean(b.notes,5000);
  }
  if(kind==='schedules'){
   if(!Array.isArray(b.weekdays)||!b.weekdays.length||b.weekdays.some(d=>!Number.isInteger(d)||d<1||d>7))fail('Selecione os dias úteis');if(!Number.isInteger(b.startHour)||!Number.isInteger(b.endHour)||b.startHour<0||b.endHour>24||b.startHour>=b.endHour)fail('Horário inicial deve ser menor que o final, de 0 a 24');if(typeof b.zone!=='string'||!DateTime.now().setZone(b.zone).isValid)fail('Fuso horário inválido');data.weekdays=[...new Set(b.weekdays)].sort();data.startHour=b.startHour;data.endHour=b.endHour;data.zone=b.zone;data.notes=clean(b.notes,5000);
  }
  if(kind==='documents'){
   data.category=clean(b.category,120);data.description=clean(b.description,5000);data.content=clean(b.content,20000);data.url=clean(b.url,2000);if(data.url){let url;try{url=new URL(data.url);}catch{fail('Link do documento inválido');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password)fail('Use um link HTTP ou HTTPS sem credenciais');}data.clientId=b.clientId??null;if(!client(data.clientId))fail('Empresa inválida');
  }
  return data;
 }
 async function handle(req,res,path,user){
  if(!path.startsWith('/api/registrations/'))return false;
  const m=path.match(/^\/api\/registrations\/(teams|departments|holidays|schedules|documents)(?:\/(\d+))?(?:\/(file))?$/);if(!m)fail('Cadastro não encontrado',404);const kind=m[1],id=Number(m[2]),file=m[3],permission=kinds[kind];
  if(!config.allowed(user,req.method==='GET'?permission.read:permission.write))fail('Sem permissão para este cadastro',403);
  if(file){if(kind!=='documents'||req.method!=='GET'||!id)fail('Rota não encontrada',404);const row=db.prepare("SELECT f.filename,f.data FROM directory_files f JOIN directory_entries e ON e.id=f.entry_id WHERE e.id=? AND e.kind='documents'").get(id);if(!row)fail('Arquivo não encontrado',404);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,'Cache-Control':'no-store'});res.end(row.data);return true;}
  if(req.method==='GET'&&!id){const rows=db.prepare('SELECT e.*,(SELECT filename FROM directory_files WHERE entry_id=e.id) AS filename FROM directory_entries e WHERE kind=? ORDER BY active DESC,name,id').all(kind).map(r=>({...r,data:JSON.parse(r.data)}));json(res,200,{rows,canWrite:config.allowed(user,permission.write),clients:db.prepare('SELECT id,name FROM clients ORDER BY name').all(),users:kind==='teams'?db.prepare("SELECT id,name,active FROM users WHERE account_type='internal' ORDER BY name").all():[]});return true;}
  if(!['POST','PUT','PATCH'].includes(req.method)||req.method==='POST'&&id||req.method!=='POST'&&!id)fail('Método inválido',405);
  const previous=id?db.prepare('SELECT * FROM directory_entries WHERE id=? AND kind=?').get(id,kind):null;if(id&&!previous)fail('Registro não encontrado',404);const b=await body(req);
  if(req.method==='PATCH'){if(typeof b.active!=='boolean')fail('Situação inválida');db.prepare('UPDATE directory_entries SET active=?,updated=CURRENT_TIMESTAMP WHERE id=? AND kind=?').run(b.active?1:0,id,kind);config.audit(user,'registrations.active',`${kind} #${id}: ${b.active?'ativado':'desativado'}`);json(res,200,{ok:true});return true;}
  const name=clean(b.name);if(!name)fail('Informe o nome');if(['teams','schedules'].includes(kind)&&db.prepare('SELECT id FROM directory_entries WHERE kind=? AND lower(trim(name))=lower(?) AND id<>?').get(kind,name,id||0))fail('Nome já cadastrado nesta seção',409);const data=validate(kind,b.data);
  let upload;if(b.file!==undefined){if(kind!=='documents'||typeof b.file?.base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(b.file.base64))fail('Arquivo inválido');const filename=clean(b.file.filename,180).replace(/[\\/\r\n]/g,'_'),buffer=Buffer.from(b.file.base64,'base64');if(!filename||!buffer.length||buffer.length>512*1024)fail('Anexe arquivo de até 512 KB');upload={filename,buffer};}
  db.exec('BEGIN IMMEDIATE');try{let savedId=id;if(previous)db.prepare('UPDATE directory_entries SET name=?,data=?,updated=CURRENT_TIMESTAMP WHERE id=? AND kind=?').run(name,JSON.stringify(data),id,kind);else savedId=Number(db.prepare('INSERT INTO directory_entries(kind,name,data) VALUES(?,?,?)').run(kind,name,JSON.stringify(data)).lastInsertRowid);if(upload)db.prepare('INSERT INTO directory_files(entry_id,filename,data) VALUES(?,?,?) ON CONFLICT(entry_id) DO UPDATE SET filename=excluded.filename,data=excluded.data').run(savedId,upload.filename,upload.buffer);config.audit(user,'registrations.'+(previous?'update':'create'),`${kind} #${savedId}: ${name}`);db.exec('COMMIT');json(res,previous?200:201,{id:savedId});}catch(error){db.exec('ROLLBACK');throw error;}return true;
 }
 return {handle};
}
