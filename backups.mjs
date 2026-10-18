import {backup,DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,realpath,lstat,readdir,copyFile,writeFile,rename,rm,readFile,chmod} from 'node:fs/promises';
import {resolve,relative,join,isAbsolute,dirname,basename,sep} from 'node:path';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const within=(base,path)=>{const r=relative(base,path);return r===''||!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r);};
const formatter=zone=>new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'});
export function nextBackupRun(config,after=Date.now(),lastDate=null){
 if(!config.enabled)return null;
 const format=formatter(config.timeZone),[hour,minute]=config.time.split(':').map(Number),days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 for(let t=Math.floor(after/60000)*60000+60000,end=t+8*86400000;t<end;t+=60000){const p=Object.fromEntries(format.formatToParts(t).map(p=>[p.type,p.value]));if(config.frequency!=='hourly'&&`${p.year}-${p.month}-${p.day}`===lastDate)continue;if(Number(p.minute)!==minute)continue;if(config.frequency!=='hourly'&&Number(p.hour)!==hour)continue;if(config.frequency==='weekly'&&p.weekday!==days[config.weekday])continue;return new Date(t).toISOString();}
 fail('Não foi possível calcular a próxima execução');
}
async function canonical(path){let current=resolve(path),tail=[];for(;;){try{return resolve(await realpath(current),...tail.reverse());}catch(error){if(error.code!=='ENOENT')throw error;const parent=dirname(current);if(parent===current)throw error;tail.push(basename(current));current=parent;}}}
export function createBackups({db,body,json,config,check,root,dataDir,clock=()=>Date.now(),startScheduler=true}){
 db.exec(`CREATE TABLE IF NOT EXISTS backup_runs(id INTEGER PRIMARY KEY,started_at TEXT NOT NULL,finished_at TEXT,status TEXT NOT NULL,directory TEXT NOT NULL,name TEXT,error TEXT,bytes INTEGER,removed_at TEXT); CREATE TABLE IF NOT EXISTS backup_lease(id INTEGER PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL);`);
 const defaults={enabled:false,directory:'',frequency:'daily',time:'02:00',weekday:0,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',keep:7};
 const getSetting=(key,fallback)=>JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value||JSON.stringify(fallback));
 const setSetting=(key,value)=>db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
 const settings=()=>({...defaults,...getSetting('backup-schedule',{})});
 let running=false,timer;
 const iso=()=>new Date(clock()).toISOString();
 const confirm=(user,password)=>{const stored=db.prepare('SELECT password FROM users WHERE id=? AND active=1').get(user.id);if(typeof password!=='string'||password.length>256||!stored||!check(password,stored.password))fail('Senha atual incorreta',403);};
 async function destination(value){
  if(typeof value!=='string'||!value.trim()||value.length>1000||value.includes('\0')||!isAbsolute(value.trim()))fail('Informe um caminho absoluto de pasta no servidor');
  const path=await canonical(value.trim()),app=await realpath(root),data=await realpath(dataDir);
  if(within(app,path)||within(data,path))fail('Escolha uma pasta fora da aplicação e da pasta de dados');
  return path;
 }
 function validate(b){
  if(typeof b.enabled!=='boolean'||!['hourly','daily','weekly'].includes(b.frequency)||typeof b.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time)||!Number.isInteger(b.weekday)||b.weekday<0||b.weekday>6||!Number.isInteger(b.keep)||b.keep<1||b.keep>365)fail('Horário, frequência, dia da semana ou retenção inválidos');
  if(typeof b.timeZone!=='string'||b.timeZone.length>100)fail('Fuso horário inválido');try{formatter(b.timeZone).format(clock());}catch{fail('Fuso horário inválido');}
  return {enabled:b.enabled,directory:b.directory,frequency:b.frequency,time:b.time,weekday:b.weekday,timeZone:b.timeZone,keep:b.keep};
 }
 async function copyTree(source,target,excluded=[]){
  const info=await lstat(source);if(info.isSymbolicLink())return;if(excluded.some(path=>within(path,source)))return;
  if(info.isDirectory()){await mkdir(target,{recursive:true,mode:0o700});for(const entry of await readdir(source)){if(['.git','node_modules','bin','obj','__pycache__','.codex','.agents'].includes(entry)||entry.endsWith('.log'))continue;await copyTree(join(source,entry),join(target,entry),excluded);}}
  else if(info.isFile()){await copyFile(source,target);await chmod(target,0o600);}
 }
 async function manifestFiles(path,prefix=''){
  const files=[];for(const entry of await readdir(path,{withFileTypes:true})){const file=join(path,entry.name),name=prefix+entry.name;if(entry.isDirectory())files.push(...await manifestFiles(file,name+'/'));else{if(entry.isSymbolicLink()||!entry.isFile())fail('Arquivo de backup não regular');const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);files.push({path:name,size:(await lstat(file)).size,sha256:hash.digest('hex')});}}return files;
 }
 async function prune(directory,keep){
  const rows=db.prepare("SELECT id,name FROM backup_runs WHERE status='success' AND directory=? AND removed_at IS NULL ORDER BY id DESC").all(directory).slice(keep);
  for(const row of rows){if(!/^servitec-vsa-\d{8}T\d{6}Z-[a-f0-9]{8}$/.test(row.name||''))continue;const path=join(directory,row.name);try{if((await lstat(path)).isSymbolicLink())continue;const manifest=JSON.parse(await readFile(join(path,'manifest.json'),'utf8'));if(manifest.format!=='servitec-vsa-backup-v1'||manifest.backupId!==row.id)continue;await rm(path,{recursive:true});db.prepare('UPDATE backup_runs SET removed_at=? WHERE id=?').run(iso(),row.id);}catch(error){if(error.code==='ENOENT'&&!await lstat(path).then(()=>true,()=>false))db.prepare('UPDATE backup_runs SET removed_at=? WHERE id=?').run(iso(),row.id);else throw error;}}
 }
 async function run(user=null){
  if(running)fail('Já existe um backup em execução',409);
  const owner=randomUUID(),lease=db.prepare('INSERT INTO backup_lease(id,owner,expires) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE backup_lease.expires<?').run(owner,clock()+300000,clock());if(!lease.changes)fail('Já existe um backup em execução',409);
  running=true;const renewal=setInterval(()=>{try{db.prepare('UPDATE backup_lease SET expires=? WHERE id=1 AND owner=?').run(clock()+300000,owner);}catch{}},30000);renewal.unref();
  const current=settings();let id,stage;
  try{
   db.prepare("UPDATE backup_runs SET status='failed',finished_at=?,error='Execução interrompida antes da conclusão' WHERE status='running'").run(iso());
   id=Number(db.prepare("INSERT INTO backup_runs(started_at,status,directory) VALUES(?,'running',?)").run(iso(),current.directory).lastInsertRowid);
   const directory=await destination(current.directory);await mkdir(directory,{recursive:true,mode:0o700});db.prepare('UPDATE backup_runs SET directory=? WHERE id=?').run(directory,id);
   const stamp=iso().replace(/[-:]/g,'').slice(0,15)+'Z',name=`servitec-vsa-${stamp}-${randomUUID().slice(0,8)}`;
   stage=join(directory,'.parcial-'+randomUUID());await mkdir(stage,{mode:0o700});const app=join(stage,'sistema');
   await copyTree(root,app,[resolve(dataDir),await realpath(dataDir),resolve(root,'data')]);await mkdir(join(app,'data'),{recursive:true,mode:0o700});
   for(const entry of await readdir(dataDir)){if(['sistema.db','sistema.db-wal','sistema.db-shm'].includes(entry))continue;await copyTree(join(dataDir,entry),join(app,'data',entry));}
   const file=join(app,'data','sistema.db');await backup(db,file);await chmod(file,0o600);
   const snapshot=new DatabaseSync(file);try{snapshot.exec('DELETE FROM sessions; DELETE FROM backup_lease;');const c=JSON.parse(snapshot.prepare("SELECT value FROM settings WHERE key='backup-schedule'").get()?.value||'{}');snapshot.prepare("INSERT INTO settings(key,value) VALUES('backup-schedule',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({...c,enabled:false,outgoingEnabled:false}));snapshot.prepare("DELETE FROM settings WHERE key IN ('backup-next-run','backup-last-date')").run();const incoming=snapshot.prepare("SELECT value FROM settings WHERE key='incoming-mail'").get();if(incoming)snapshot.prepare("UPDATE settings SET value=? WHERE key='incoming-mail'").run(JSON.stringify({...JSON.parse(incoming.value),enabled:false,outgoingEnabled:false}));if(snapshot.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='email_receiver_lock'").get())snapshot.exec('DELETE FROM email_receiver_lock');if(snapshot.prepare("SELECT name FROM sqlite_master WHERE name='service_automation'").get())snapshot.exec('UPDATE service_automation SET enabled=0');if(snapshot.prepare("SELECT name FROM sqlite_master WHERE name='email_outbox'").get())snapshot.exec("UPDATE email_outbox SET status='cancelled' WHERE status IN ('pending','sending')");snapshot.exec("UPDATE backup_runs SET status='failed',error='Cópia restaurada; execução original não está ativa' WHERE status='running'; PRAGMA journal_mode=DELETE; VACUUM;");if(snapshot.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')fail('A verificação do banco de backup falhou');}finally{snapshot.close();}
   const files=await manifestFiles(app),bytes=files.reduce((n,f)=>n+f.size,0);
   await writeFile(join(stage,'manifest.json'),JSON.stringify({format:'servitec-vsa-backup-v1',backupId:id,createdAt:iso(),version:JSON.parse(await readFile(join(root,'package.json'),'utf8')).version,files},null,2),{mode:0o600});
   await writeFile(join(stage,'COMO-RESTAURAR.txt'),'SERVITEC VSA — restauração completa\n1. Pare a tarefa Servitec-Sistema e preserve a instalação atual.\n2. Copie o conteúdo da pasta sistema deste backup para uma pasta nova. Não misture bancos ou arquivos WAL/SHM antigos.\n3. Instale Node.js 24 ou superior e execute npm ci na pasta restaurada. Use data/sistema.db desta cópia; se usar DATA_DIR, aponte para essa pasta data restaurada.\n4. Inicie com npm start ou configure novamente a tarefa automática. Reconfigure HOST, PORT, HTTPS e variáveis do ambiente do servidor.\n5. Entre novamente e revise a pasta e o agendamento de backups. O agendamento e o recebimento automático de e-mails vêm desativados na cópia e as sessões de login foram removidas.\nO manifest.json contém tamanho e SHA-256 dos arquivos para conferência de integridade. Não contém os executáveis do Node.js, a configuração do Windows ou certificados externos.\n',{mode:0o600});
   await rename(stage,join(directory,name));stage=null;
   db.prepare("UPDATE backup_runs SET status='success',finished_at=?,name=?,bytes=? WHERE id=?").run(iso(),name,bytes,id);config.audit(user,'system.backup.complete',`Backup completo #${id} concluído`);
   try{await prune(directory,current.keep);}catch{db.prepare('UPDATE backup_runs SET error=? WHERE id=?').run('Backup concluído, mas não foi possível remover todas as cópias antigas. Verifique as permissões da pasta.',id);}
   return {ok:true,id,name,directory,bytes};
  }catch(error){const message=['EACCES','EPERM'].includes(error.code)?'Sem permissão para gravar ou ler a pasta de backup. Verifique a conta que executa o sistema.':error.code==='ENOSPC'?'Sem espaço disponível no destino do backup.':error.status?error.message:'Falha ao gerar o backup. Verifique a disponibilidade do caminho e as permissões no servidor.';if(id)db.prepare("UPDATE backup_runs SET status='failed',finished_at=?,error=? WHERE id=?").run(iso(),message,id);config.audit(user,'system.backup.failed',message);throw Object.assign(Error(message),{status:error.status||400});
  }finally{if(stage)await rm(stage,{recursive:true,force:true}).catch(()=>{});clearInterval(renewal);db.prepare('DELETE FROM backup_lease WHERE owner=?').run(owner);running=false;}
 }
 async function tick(){
  if(running)return;const current=settings();if(!current.enabled)return;
  let next=getSetting('backup-next-run',null);if(!next){next=nextBackupRun(current,clock(),getSetting('backup-last-date',null));setSetting('backup-next-run',next);}
  if(Date.parse(next)>clock())return;
  const parts=Object.fromEntries(formatter(current.timeZone).formatToParts(clock()).map(p=>[p.type,p.value]));
  try{await run();}catch(error){if(error.status===409)return;}
  setSetting('backup-last-date',`${parts.year}-${parts.month}-${parts.day}`);setSetting('backup-next-run',nextBackupRun(settings(),clock(),getSetting('backup-last-date',null)));
 }
 async function handle(req,res,path,user){
  if(!['/api/config/backups','/api/config/backups/run','/api/config/backups/verify'].includes(path))return false;
  if(!config.allowed(user,'system.manage'))fail('Somente administradores podem gerenciar backups',403);
  if(path==='/api/config/backups/verify'&&req.method==='POST'){
   const b=await body(req);confirm(user,b.password);const row=db.prepare("SELECT * FROM backup_runs WHERE id=? AND status='success' AND removed_at IS NULL").get(Number(b.id));if(!row||!/^servitec-vsa-\d{8}T\d{6}Z-[a-f0-9]{8}$/.test(row.name||''))fail('Selecione um backup completo disponível');const folder=join(row.directory,row.name);if((await lstat(folder)).isSymbolicLink())fail('Pasta de backup inválida');const m=JSON.parse(await readFile(join(folder,'manifest.json'),'utf8'));if(m.backupId!==row.id||m.format!=='servitec-vsa-backup-v1')fail('Manifesto inválido');
   const files=await manifestFiles(join(folder,'sistema'));const expected=new Map(m.files.map(f=>[f.path,f]));if(files.length!==expected.size||files.some(f=>{const e=expected.get(f.path);return !e||e.size!==f.size||e.sha256!==f.sha256;}))fail('Integridade divergente: um ou mais arquivos foram alterados');
   const copy=new DatabaseSync(join(folder,'sistema','data','sistema.db'),{readOnly:true});try{if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')fail('Banco de dados inválido');}finally{copy.close();}config.audit(user,'system.backup.verify',`Backup #${row.id}: arquivos SHA-256 e SQLite íntegros`);json(res,200,{ok:true,files:files.length,message:'Arquivos e banco íntegros. O teste não inicia a aplicação restaurada.'});return true;
  }
  if(path==='/api/config/backups'&&req.method==='GET'){json(res,200,{settings:settings(),running:running||!!db.prepare('SELECT id FROM backup_lease WHERE expires>?').get(clock()),nextRun:settings().enabled?getSetting('backup-next-run',null):null,platform:process.platform,suggestedDirectory:resolve(root,'..','Backups-SERVITEC'),history:db.prepare('SELECT * FROM backup_runs ORDER BY id DESC LIMIT 30').all()});return true;}
  if(path==='/api/config/backups'&&req.method==='PUT'){
   const b=await body(req);confirm(user,b.password);if(running||db.prepare('SELECT id FROM backup_lease WHERE expires>?').get(clock()))fail('Aguarde o backup atual antes de alterar a configuração',409);
   const value=validate(b);
   try{if(value.directory||value.enabled)value.directory=await destination(value.directory);else value.directory='';
    if(value.directory){await mkdir(value.directory,{recursive:true,mode:0o700});const probe=join(value.directory,'.servitec-teste-'+randomUUID());await writeFile(probe,'teste',{mode:0o600});await rm(probe);}
   }catch(error){if(error.status)throw error;fail('Não foi possível acessar ou gravar na pasta. Verifique o caminho, a disponibilidade do disco e a permissão da conta que executa o sistema.');}
   setSetting('backup-schedule',value);setSetting('backup-last-date',null);setSetting('backup-next-run',nextBackupRun(value,clock()));config.audit(user,'system.backup.schedule','Agendamento de backup atualizado');json(res,200,{ok:true});return true;
  }
  if(path==='/api/config/backups/run'&&req.method==='POST'){const b=await body(req);confirm(user,b.password);json(res,200,await run(user));return true;}
  fail('Rota não encontrada',404);
 }
 if(startScheduler){timer=setInterval(()=>{tick().catch(()=>{});},30000);timer.unref();setImmediate(()=>{tick().catch(()=>{});});}
 return {handle,run,tick,stop(){clearInterval(timer);}};
}
