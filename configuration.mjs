import {randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';

export const permissionCatalog = [
  {key:'tickets.read',label:'Visualizar chamados',group:'Chamados'},
  {key:'tickets.write',label:'Criar/alterar chamados e aprovar e-mails e remetentes',group:'Chamados'},
  {key:'assets.read',label:'Consultar equipamentos',group:'Equipamentos'},
  {key:'assets.write',label:'Cadastrar equipamentos e renovar tokens de agentes',group:'Equipamentos'},
  {key:'monitor.read',label:'Visualizar monitoramento',group:'Monitoramento'},
  {key:'imports.manage',label:'Importar equipamentos por CSV',group:'Configurações'},
  {key:'rules.manage',label:'Configurar alertas de chamados parados',group:'Configurações'},
  {key:'company.manage',label:'Editar dados e logotipo da empresa',group:'Configurações'},
  {key:'audit.read',label:'Consultar histórico de atividades',group:'Configurações'},
  {key:'users.manage',label:'Gerenciar usuários e senhas',group:'Administração',locked:true},
  {key:'permissions.manage',label:'Criar perfis e editar permissões',group:'Administração',locked:true},
  {key:'system.manage',label:'Consultar versão e gerenciar backups e agendamento',group:'Administração',locked:true},
];
const defaults={admin:permissionCatalog.map(p=>p.key),technician:['tickets.read','tickets.write','assets.read','assets.write','monitor.read'],viewer:['tickets.read','assets.read','monitor.read']};
const companyFields=['name','legalName','cnpj','registration','address','city','phone','email','site'];
const emptyCompany=()=>Object.fromEntries(companyFields.map(f=>[f,f==='name'?'Servitec':'']));
const dependencies={'tickets.write':'tickets.read','assets.write':'assets.read','monitor.read':'assets.read','imports.manage':'assets.write'};
function error(message,status=400){return Object.assign(new Error(message),{status});}

// RFC 4180-style CSV, with comma or semicolon and optional UTF-8 BOM.
export function parseEquipmentCsv(csv){
  if(typeof csv!=='string'||!csv.trim()||Buffer.byteLength(csv)>512*1024)throw error('Envie um CSV UTF-8 de até 512 KB');
  csv=csv.replace(/^\uFEFF/,'');
  const line=csv.split(/\r?\n/,1)[0];
  const separator=(line.match(/;/g)||[]).length>(line.match(/,/g)||[]).length?';':',';
  const rows=[];let row=[],field='',quoted=false,afterQuote=false;
  function cell(){row.push(field.trim());field='';afterQuote=false;}
  function record(){cell();if(row.some(v=>v!==''))rows.push(row);row=[];if(rows.length>1001)throw error('Importe no máximo 1.000 equipamentos por arquivo');}
  for(let i=0;i<csv.length;i++){
    const c=csv[i];
    if(quoted){if(c==='"'){if(csv[i+1]==='"'){field+='"';i++;}else{quoted=false;afterQuote=true;}}else field+=c;continue;}
    if(c==='"'){if(field||afterQuote)throw error('CSV inválido: aspas fora do início do campo');quoted=true;continue;}
    if(c===separator){cell();continue;}
    if(c==='\n'||c==='\r'){if(c==='\r'&&csv[i+1]==='\n')i++;record();continue;}
    if(afterQuote){if(!/\s/.test(c))throw error('CSV inválido após fechamento de aspas');continue;}
    field+=c;
  }
  if(quoted)throw error('CSV inválido: campo com aspas não fechado');
  if(field||row.length||afterQuote)record();
  if(rows.length<2)throw error('CSV sem equipamentos');
  const aliases={codigo:'code',nome:'name',responsavel:'owner',sistema:'os'};
  const headers=rows.shift().map(v=>aliases[v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()]);
  if(!headers.includes('code')||!headers.includes('name'))throw error('Cabeçalhos obrigatórios: codigo e nome. Opcionais: responsavel e sistema');
  const recognized=headers.filter(Boolean);if(new Set(recognized).size!==recognized.length)throw error('CSV com cabeçalhos repetidos');
  const codes=new Set();
  return rows.map((values,index)=>{
    if(values.length!==headers.length)throw error(`Linha ${index+2}: número de colunas diferente do cabeçalho`);
    const item=Object.fromEntries(headers.map((key,i)=>[key,values[i]]).filter(([key])=>key));
    if(!item.code||item.code.length>80||!item.name||Object.values(item).some(v=>v.length>500))throw error(`Linha ${index+2}: informe código (até 80 caracteres), nome e campos de até 500 caracteres`);
    if(codes.has(item.code))throw error(`Linha ${index+2}: código repetido no arquivo`);
    codes.add(item.code);return item;
  });
}

export function createConfiguration({db,json,body,check,root}){
  db.exec(`CREATE TABLE IF NOT EXISTS roles(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,permissions TEXT NOT NULL,builtin INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY,actor_id INTEGER,actor_name TEXT,action TEXT NOT NULL,detail TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP);`);
  const ticketColumns=db.prepare('PRAGMA table_info(tickets)').all().map(c=>c.name);
  if(!ticketColumns.includes('status_since')){db.exec('ALTER TABLE tickets ADD COLUMN status_since TEXT');db.exec('UPDATE tickets SET status_since=COALESCE(created,CURRENT_TIMESTAMP)');}
  const assetColumns=db.prepare('PRAGMA table_info(assets)').all().map(c=>c.name);
  if(!assetColumns.includes('code'))db.exec('ALTER TABLE assets ADD COLUMN code TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS assets_code_unique ON assets(code) WHERE code IS NOT NULL');
  for(const [id,name] of Object.entries({admin:'Administrador',technician:'Técnico',viewer:'Consulta'}))db.prepare('INSERT OR IGNORE INTO roles(id,name,permissions,builtin) VALUES(?,?,?,1)').run(id,name,JSON.stringify(defaults[id]));
  const packageInfo=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  let revision='não disponível';try{revision=execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root,timeout:2000,stdio:['ignore','pipe','ignore']}).toString().trim();}catch{}
  const roleExists=id=>!!db.prepare('SELECT id FROM roles WHERE id=?').get(id);
  const permissions=role=>role==='admin'?defaults.admin:JSON.parse(db.prepare('SELECT permissions FROM roles WHERE id=?').get(role)?.permissions||'[]');
  const allowed=(user,key)=>permissions(user.role).includes(key);
  const audit=(user,action,detail)=>db.prepare('INSERT INTO activity(actor_id,actor_name,action,detail) VALUES(?,?,?,?)').run(user?.id??null,user?.name??'Não autenticado',action,detail);
  const company=()=>({...emptyCompany(),...JSON.parse(db.prepare("SELECT value FROM settings WHERE key='company'").get()?.value||'{}')});
  const ticketRules=()=>JSON.parse(db.prepare("SELECT value FROM settings WHERE key='ticket-rules'").get()?.value||'{"warningDays":2,"criticalDays":5}');
  const ticketAlert=ticket=>{const ageDays=Math.max(0,Math.floor((Date.now()-Date.parse((ticket.status_since||ticket.created).replace(' ','T')+'Z'))/86400000));const rules=ticketRules();return {...ticket,ageDays,attention:ticket.status==='Resolvido'?'resolved':ageDays>=rules.criticalDays?'critical':ageDays>=rules.warningDays?'warning':'normal'};};
  const getRoles=()=>db.prepare('SELECT id,name,permissions,builtin,(SELECT count(*) FROM users WHERE role=roles.id) AS users FROM roles ORDER BY builtin DESC,name').all().map(r=>({...r,permissions:permissions(r.id)}));
  const requirePermission=(user,key)=>{if(!allowed(user,key))throw error('Você não tem permissão para esta operação',403);};
  function confirmPassword(user,password){const stored=db.prepare('SELECT password FROM users WHERE id=? AND active=1').get(user.id);if(typeof password!=='string'||password.length>256||!stored||!check(password,stored.password))throw error('Senha atual incorreta',403);}
  async function publicRoute(req,res,path){
    if(req.method==='GET'&&path==='/api/branding'){const c=company();json(res,200,{name:c.name,hasLogo:!!c.logo});return true;}
    if(req.method==='GET'&&path==='/brand-logo'){
      const logo=company().logo;res.setHeader('Cache-Control','no-store');
      if(!logo){res.writeHead(404);res.end();return true;}
      res.writeHead(200,{'Content-Type':logo.type});res.end(Buffer.from(logo.data,'base64'));return true;
    }
    return false;
  }
  async function handle(req,res,path,user){
    if(path==='/api/roles'&&req.method==='GET'){json(res,200,getRoles().map(r=>({id:r.id,name:r.name})));return true;}
    if(path==='/api/config/permissions'){
      requirePermission(user,'permissions.manage');
      if(req.method==='GET'){json(res,200,{catalog:permissionCatalog,roles:getRoles()});return true;}
      if(req.method==='PUT'){
        const b=await body(req);if(!Array.isArray(b.roles)||b.roles.length>100)throw error('Lista de perfis inválida');
        const seen=new Set();
        for(const r of b.roles){
          if(!roleExists(r.id)||seen.has(r.id)||!Array.isArray(r.permissions)||r.permissions.length>permissionCatalog.length||r.permissions.some(p=>!permissionCatalog.some(entry=>entry.key===p)))throw error('Perfil ou permissão inválidos');
          seen.add(r.id);
          if(r.id==='admin')throw error('As permissões do administrador são fixas');
          if(r.permissions.some(key=>permissionCatalog.find(p=>p.key===key).locked))throw error('Permissões de administração são exclusivas do administrador');
          for(const [key,dependency] of Object.entries(dependencies))if(r.permissions.includes(key)&&!r.permissions.includes(dependency))throw error(`A permissão ${key} exige ${dependency}`);
        }
        db.exec('BEGIN IMMEDIATE');try{
          for(const r of b.roles){db.prepare('UPDATE roles SET permissions=? WHERE id=?').run(JSON.stringify([...new Set(r.permissions)]),r.id);db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role=?)').run(r.id);}
          audit(user,'permissions.update',`Permissões atualizadas em ${b.roles.length} perfil(is)`);db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');throw e;}
        json(res,200,{ok:true});return true;
      }
    }
    if(path==='/api/config/roles'&&req.method==='POST'){
      requirePermission(user,'permissions.manage');const b=await body(req),name=typeof b.name==='string'?b.name.trim():'';
      if(!name||name.length>80)throw error('Nome do perfil deve ter de 1 a 80 caracteres');
      if(db.prepare('SELECT id FROM roles WHERE name=? COLLATE NOCASE').get(name))throw error('Nome de perfil já cadastrado',409);
      const id='role_'+randomBytes(8).toString('hex');db.prepare('INSERT INTO roles VALUES(?,?,?,0)').run(id,name,'[]');audit(user,'roles.create',`Perfil criado: ${name}`);json(res,201,{id});return true;
    }
    if(path==='/api/config/rules'){
      requirePermission(user,'rules.manage');
      if(req.method==='GET'){json(res,200,ticketRules());return true;}
      if(req.method==='PUT'){
        const b=await body(req);if(!Number.isInteger(b.warningDays)||!Number.isInteger(b.criticalDays)||b.warningDays<1||b.criticalDays<=b.warningDays||b.criticalDays>365)throw error('Use dias inteiros: amarelo a partir de 1 dia e vermelho acima do amarelo, até 365 dias');
        const value={warningDays:b.warningDays,criticalDays:b.criticalDays};db.prepare("INSERT INTO settings VALUES('ticket-rules',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value));audit(user,'rules.update',`Alertas de chamados: atenção em ${b.warningDays} dia(s), crítico em ${b.criticalDays} dia(s)`);json(res,200,{ok:true});return true;
      }
    }
    if(path==='/api/config/company'){
      requirePermission(user,'company.manage');
      if(req.method==='GET'){const c=company();json(res,200,{...c,logo:undefined,hasLogo:!!c.logo});return true;}
      if(req.method==='PUT'){
        const b=await body(req);const c=company();
        for(const key of companyFields)if(b[key]!==undefined){if(typeof b[key]!=='string'||b[key].length>500)throw error('Campo da empresa inválido');c[key]=b[key].trim();}
        if(!c.name)throw error('Nome fantasia é obrigatório');
        if(c.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))throw error('E-mail inválido');
        if(c.site){try{if(!['http:','https:'].includes(new URL(c.site).protocol))throw Error();}catch{throw error('Site deve começar com http:// ou https://');}}
        if(b.removeLogo===true)delete c.logo;
        if(b.logo!==undefined){
          if(!b.logo||!['image/png','image/jpeg','image/webp'].includes(b.logo.type)||typeof b.logo.data!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(b.logo.data))throw error('Envie uma imagem PNG, JPEG ou WebP');
          const data=Buffer.from(b.logo.data,'base64');if(!data.length||data.length>256*1024)throw error('O logotipo deve ter até 256 KB');
          const valid=(b.logo.type==='image/png'&&data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))||(b.logo.type==='image/jpeg'&&data[0]===255&&data[1]===216&&data[2]===255)||(b.logo.type==='image/webp'&&data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP');
          if(!valid)throw error('O conteúdo do arquivo não corresponde ao tipo de imagem');
          c.logo={type:b.logo.type,data:data.toString('base64')};
        }
        db.prepare("INSERT INTO settings VALUES('company',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(c));audit(user,'company.update','Dados da empresa atualizados');json(res,200,{ok:true});return true;
      }
    }
    if(path==='/api/config/activity'&&req.method==='GET'){
      requirePermission(user,'audit.read');const url=new URL(req.url,'http://localhost');const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(before)||before<1)throw error('Paginação inválida');
      json(res,200,db.prepare('SELECT id,actor_name,action,detail,created FROM activity WHERE id<? ORDER BY id DESC LIMIT 100').all(before));return true;
    }
    if(path==='/api/config/system'&&req.method==='GET'){
      requirePermission(user,'system.manage');json(res,200,{version:packageInfo.version,revision,node:process.versions.node,counts:{users:db.prepare('SELECT count(*) n FROM users').get().n,tickets:db.prepare('SELECT count(*) n FROM tickets').get().n,assets:db.prepare('SELECT count(*) n FROM assets').get().n}});return true;
    }
    if(path==='/api/config/backup'&&req.method==='POST'){
      requirePermission(user,'system.manage');const b=await body(req);confirmPassword(user,b.password);
      const directory=mkdtempSync(join(tmpdir(),'servitec-backup-'));const file=join(directory,'sistema.sqlite');
      try{
        audit(user,'system.backup','Backup do banco solicitado');db.prepare('VACUUM INTO ?').run(file);
        const copy=new DatabaseSync(file);try{
          copy.exec('DELETE FROM sessions; PRAGMA journal_mode=DELETE;');
          const schedule=copy.prepare("SELECT value FROM settings WHERE key='backup-schedule'").get();if(schedule)copy.prepare("UPDATE settings SET value=? WHERE key='backup-schedule'").run(JSON.stringify({...JSON.parse(schedule.value),enabled:false}));
          copy.prepare("DELETE FROM settings WHERE key IN ('backup-next-run','backup-last-date')").run();
          if(copy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='backup_lease'").get())copy.exec('DELETE FROM backup_lease');
          const incoming=copy.prepare("SELECT value FROM settings WHERE key='incoming-mail'").get();if(incoming)copy.prepare("UPDATE settings SET value=? WHERE key='incoming-mail'").run(JSON.stringify({...JSON.parse(incoming.value),enabled:false}));
          if(copy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='email_receiver_lock'").get())copy.exec('DELETE FROM email_receiver_lock');
          copy.exec('VACUUM');
        }finally{copy.close();}
        const data=readFileSync(file);res.writeHead(200,{'Content-Type':'application/vnd.sqlite3','Content-Disposition':`attachment; filename="sistema-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite"`});res.end(data);
      }finally{rmSync(directory,{recursive:true,force:true});}
      return true;
    }
    if(['/api/import/assets/preview','/api/import/assets'].includes(path)&&req.method==='POST'){
      requirePermission(user,'imports.manage');requirePermission(user,'assets.write');const b=await body(req),rows=parseEquipmentCsv(b.csv);
      const existing=db.prepare('SELECT id,name,owner,os FROM assets WHERE code=?');
      const preview=rows.map(r=>{const old=existing.get(r.code);const changed=old&&(old.name!==r.name||(r.owner!==undefined&&old.owner!==r.owner)||(r.os!==undefined&&old.os!==r.os));return {...r,operation:!old?'create':changed?'update':'unchanged'};});
      const counts={create:0,update:0,unchanged:0};preview.forEach(r=>counts[r.operation]++);
      if(path.endsWith('/preview')){json(res,200,{counts,total:rows.length,rows:preview.slice(0,20)});return true;}
      if(b.confirm!==true)throw error('Confirme a importação após revisar o arquivo');
      db.exec('BEGIN IMMEDIATE');try{
        for(const r of rows){const old=existing.get(r.code);if(old)db.prepare('UPDATE assets SET name=?,owner=?,os=? WHERE id=?').run(r.name,r.owner??old.owner,r.os??old.os,old.id);else db.prepare('INSERT INTO assets(code,name,owner,os,token) VALUES(?,?,?,?,?)').run(r.code,r.name,r.owner??'',r.os??'',randomBytes(32).toString('hex'));}
        audit(user,'assets.import',`Importação: ${counts.create} novo(s), ${counts.update} atualizado(s), ${counts.unchanged} sem alteração`);db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
      json(res,200,{ok:true,counts,total:rows.length});return true;
    }
    if(/^\/api\/assets\/\d+\/token$/.test(path)&&req.method==='POST'){
      requirePermission(user,'assets.write');const b=await body(req);confirmPassword(user,b.password);const id=Number(path.split('/')[3]);
      if(!db.prepare('SELECT id FROM assets WHERE id=?').get(id))throw error('Equipamento não encontrado',404);
      const token=randomBytes(32).toString('hex');db.prepare('UPDATE assets SET token=?,last_seen=NULL,metrics=NULL,machine_id=NULL,agent_info=NULL,last_metrics_at=NULL,inventory=NULL,last_inventory_at=NULL WHERE id=?').run(token,id);audit(user,'assets.token',`Token do agente renovado no equipamento #${id}`);json(res,200,{token});return true;
    }
    return false;
  }
  return {allowed,permissions,roleExists,audit,handle,publicRoute,ticketAlert};
}
