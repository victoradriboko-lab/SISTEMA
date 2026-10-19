import {randomBytes,randomUUID,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {MAX_MAIL_BYTES,normalizeEmail,validSender,parseIncomingMail,openGmail} from './mail-receiver.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const defaults={provider:'gmail',address:'',enabled:false,intervalSeconds:60};
export function createMail({db,body,json,config,check,dataDir,receiver=openGmail,clock=()=>Date.now(),startScheduler=true,desk=null,canOpenTicket=()=>{},smtpFactory=async options=>(await import('nodemailer')).default.createTransport(options)}){
 db.exec(`CREATE TABLE IF NOT EXISTS email_messages(id INTEGER PRIMARY KEY,fingerprint TEXT NOT NULL UNIQUE,provider_key TEXT UNIQUE,mailbox TEXT NOT NULL DEFAULT '',sender TEXT NOT NULL,sender_name TEXT NOT NULL DEFAULT '',subject TEXT NOT NULL,text TEXT NOT NULL,message_id TEXT NOT NULL DEFAULT '',mail_date TEXT,attachments TEXT NOT NULL DEFAULT '[]',risk TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',ticket_id INTEGER,client_id INTEGER,reviewed_by INTEGER,reviewed_at TEXT,received_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS email_messages_queue ON email_messages(status,id);
 CREATE INDEX IF NOT EXISTS email_messages_sender ON email_messages(sender,status);
 DROP INDEX IF EXISTS email_messages_ticket; CREATE INDEX IF NOT EXISTS email_ticket_lookup ON email_messages(ticket_id);
 CREATE TABLE IF NOT EXISTS email_senders(id INTEGER PRIMARY KEY,email TEXT NOT NULL UNIQUE,client_id INTEGER,status TEXT NOT NULL,updated_by INTEGER,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS email_receiver_state(id INTEGER PRIMARY KEY CHECK(id=1),uid_validity TEXT,last_uid INTEGER NOT NULL DEFAULT 0,last_attempt TEXT,last_success TEXT,last_error TEXT NOT NULL DEFAULT '',last_count INTEGER NOT NULL DEFAULT 0);
 INSERT OR IGNORE INTO email_receiver_state(id) VALUES(1);
 CREATE TABLE IF NOT EXISTS email_receiver_lock(id INTEGER PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL);`);
 if(!db.prepare('PRAGMA table_info(email_messages)').all().some(c=>c.name==='reply_refs'))db.exec("ALTER TABLE email_messages ADD COLUMN reply_refs TEXT NOT NULL DEFAULT '[]'");
 db.exec("CREATE TABLE IF NOT EXISTS email_outbox(id INTEGER PRIMARY KEY,ticket_id INTEGER,client_id INTEGER,recipient TEXT,subject TEXT,text TEXT,message_id TEXT UNIQUE,status TEXT DEFAULT 'pending',created TEXT DEFAULT CURRENT_TIMESTAMP,sent_at TEXT,error TEXT);");
 let running=false,changing=false,timer,stopped=false;
 const iso=()=>new Date(clock()).toISOString();
 const settings=()=>({...defaults,...JSON.parse(db.prepare("SELECT value FROM settings WHERE key='incoming-mail'").get()?.value||'{}')});
 const save=value=>db.prepare("INSERT INTO settings(key,value) VALUES('incoming-mail',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value));
 const state=()=>db.prepare('SELECT * FROM email_receiver_state WHERE id=1').get();
 const counts=()=>Object.fromEntries(['pending','ticket','rejected','blocked','ignored'].map(status=>[status,db.prepare('SELECT count(*) n FROM email_messages WHERE status=?').get(status).n]));
 const busy=()=>running||changing||!!db.prepare('SELECT id FROM email_receiver_lock WHERE expires>?').get(clock());
 const publicSettings=()=>{const s=settings();return {provider:s.provider,address:s.address,enabled:s.enabled,intervalSeconds:s.intervalSeconds,outgoingEnabled:s.outgoingEnabled===true,hasPassword:!!s.secret};};
 function key(create=false){const path=join(dataDir,'email-secret.key');try{const value=readFileSync(path);if(value.length!==32)throw Error('Invalid key');return value;}catch(error){if(error.code!=='ENOENT'||!create)fail('A chave local do e-mail não está disponível. Restaure o backup completo ou cadastre a senha de app novamente.');const value=randomBytes(32);try{writeFileSync(path,value,{flag:'wx',mode:0o600});return value;}catch(error){if(error.code==='EEXIST')return key();throw error;}}}
 function encrypt(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(true),iv),data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(v=>v.toString('base64')).join('.');}
 function credentials(s){try{const [iv,tag,data]=s.secret.split('.').map(v=>Buffer.from(v,'base64')),decipher=createDecipheriv('aes-256-gcm',key(),iv);decipher.setAuthTag(tag);return {address:s.address,appPassword:Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8')};}catch(error){if(error.status)throw error;fail('Não foi possível ler a credencial do e-mail. Cadastre a senha de app novamente.');}}
 function requireAdmin(user){if(user.role!=='admin')fail('Somente administradores podem configurar a caixa de e-mail',403);}
 function requireRead(user){if(!config.allowed(user,'tickets.read'))fail('Sem permissão para consultar a central de e-mails',403);}
 function requireWrite(user){if(!config.allowed(user,'tickets.write'))fail('Sem permissão para aprovar e-mails e remetentes',403);}
 function confirm(user,password){const row=db.prepare('SELECT password FROM users WHERE id=? AND active=1').get(user.id);if(!row||typeof password!=='string'||password.length>256||!check(password,row.password))fail('Sua senha de administrador está incorreta',403);}
 const validateClient=id=>{if(!Number.isSafeInteger(id)||!db.prepare('SELECT id FROM clients WHERE id=?').get(id))fail('Selecione uma empresa válida');};
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
 function convert(row,clientId,user=null){
  validateClient(clientId);
  const refs=JSON.parse(row.reply_refs||'[]');let linked;for(const ref of refs){linked=db.prepare('SELECT t.id FROM tickets t WHERE t.client_id=? AND (EXISTS(SELECT 1 FROM email_messages m WHERE m.ticket_id=t.id AND m.message_id=?) OR EXISTS(SELECT 1 FROM email_outbox o WHERE o.ticket_id=t.id AND o.message_id=?))').get(clientId,ref,ref);if(linked)break;}
  if(linked){db.prepare("UPDATE email_messages SET status='ticket',ticket_id=?,client_id=?,reviewed_by=?,reviewed_at=?,reason='Resposta vinculada por referência' WHERE id=?").run(linked.id,clientId,user?.id??null,iso(),row.id);desk?.event(linked.id,{name:row.sender},'message',row.text,true);return linked.id;}
  if(!user)canOpenTicket(clientId);
  const metadata=`Recebido por e-mail\nRemetente: ${row.sender}\nRecebido em: ${row.received_at}\n\n`,attachments=JSON.parse(row.attachments),suffix=attachments.length?'\n\nAnexos na caixa original (não importados): '+attachments.map(a=>a.name).join(', '):'',remaining=5000-metadata.length-suffix.slice(0,1200).length;
  const truncated=row.text.length>remaining,description=metadata+row.text.slice(0,Math.max(0,remaining-120))+(truncated?'\n[Texto resumido. Conteúdo completo na Central de e-mails.]':'')+suffix.slice(0,1200);
  const ticketId=Number(db.prepare("INSERT INTO tickets(title,description,priority,status,status_since,client_id,operator_id,service_type) VALUES(?,?,'Média','Aberto',CURRENT_TIMESTAMP,?,NULL,NULL)").run(row.subject,description,clientId).lastInsertRowid);
  db.prepare("UPDATE email_messages SET status='ticket',ticket_id=?,client_id=?,reviewed_by=?,reviewed_at=?,reason=? WHERE id=? AND status='pending'").run(ticketId,clientId,user?.id??null,iso(),user?'Liberado pelo operador':'Remetente já vinculado à empresa',row.id);
  desk?.opened(ticketId,user);desk?.event(ticketId,{name:row.sender},'message',row.text,true);config.audit(user,'mail.ticket',`E-mail #${row.id} convertido no chamado #${ticketId}, empresa #${clientId}`);return ticketId;
 }
 async function ingest(source,{providerKey=null,mailbox=settings().address}={}){
  if(providerKey){const old=db.prepare('SELECT id,status,ticket_id FROM email_messages WHERE provider_key=?').get(providerKey);if(old)return {...old,duplicate:true};}
  const parsed=await parseIncomingMail(source,{systemAddress:mailbox||settings().address});
  return transaction(()=>{
   const existing=db.prepare('SELECT id,status,ticket_id FROM email_messages WHERE fingerprint=?').get(parsed.fingerprint);if(existing)return {...existing,duplicate:true};
   const sender=db.prepare('SELECT * FROM email_senders WHERE email=?').get(parsed.sender),blocked=sender?.status==='blocked',status=parsed.ignored?'ignored':blocked?'blocked':'pending',reason=parsed.ignored|| (blocked?'Remetente bloqueado':parsed.risk==='provider_warning'?'O provedor sinalizou autenticação ou spam: exige revisão':parsed.risk==='content_review'?'Conteúdo HTML não convertido: confira o e-mail original antes de liberar':parsed.risk==='invalid_sender'?'Remetente ausente ou ambíguo: não é possível vincular':'Aguardando aprovação do remetente');
   const id=Number(db.prepare('INSERT INTO email_messages(fingerprint,provider_key,mailbox,sender,sender_name,subject,text,message_id,mail_date,attachments,risk,status,reason,received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(parsed.fingerprint,providerKey,mailbox,parsed.sender,parsed.senderName,parsed.subject,parsed.text,parsed.messageId,parsed.mailDate,JSON.stringify(parsed.attachments),parsed.risk,status,reason,iso()).lastInsertRowid);
   db.prepare('UPDATE email_messages SET reply_refs=? WHERE id=?').run(JSON.stringify(parsed.references),id);
   let ticketId=null;
   if(status==='pending'&&!parsed.risk&&sender?.status==='approved'&&db.prepare('SELECT id FROM clients WHERE id=?').get(sender.client_id)){try{ticketId=convert(db.prepare('SELECT * FROM email_messages WHERE id=?').get(id),sender.client_id);}catch(error){if(![403,409].includes(error.status))throw error;db.prepare('UPDATE email_messages SET reason=? WHERE id=?').run(error.message+' Aguardando revisão da equipe.',id);}}
   return {id,status:ticketId?'ticket':status,ticket_id:ticketId,duplicate:false};
  });
 }
 function skipped(providerKey,mailbox){db.prepare("INSERT OR IGNORE INTO email_messages(fingerprint,provider_key,mailbox,sender,subject,text,status,reason,received_at) VALUES(?,?,?,'','E-mail acima do limite','','ignored','E-mail maior que 5 MB; consulte a caixa original',?)").run(createHash('sha256').update('oversize:'+providerKey).digest('hex'),providerKey,mailbox,iso());}
 function connectionError(error){if(error.status===400||error.status===403)return error.message;if(error.mailCode==='MAILBOX_CHANGED')return error.message;if(error.code==='ERR_MODULE_NOT_FOUND')return 'Instale as dependências com npm ci no servidor antes de conectar o e-mail.';if(error.authenticationFailed||error.code==='EAUTH')return 'O Google recusou o acesso. Confira endereço, senha de app, verificação em duas etapas e as políticas de IMAP do Workspace.';return 'Não foi possível conectar ao Gmail. Confira internet, certificado, IMAP e senha de app nas políticas do Google Workspace.';}
 async function probe(value){let connection;try{connection=await receiver(credentials(value));return connection.snapshot();}catch(error){fail(connectionError(error));}finally{await connection?.close();}}
 async function sync(user=null){
  if(busy())fail('Já existe uma sincronização ou configuração em andamento',409);
  const s=settings();if(!s.enabled||!s.secret)fail('Configure e ative o recebimento antes de sincronizar');
  const owner=randomUUID(),lease=db.prepare('INSERT INTO email_receiver_lock(id,owner,expires) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE email_receiver_lock.expires<?').run(owner,clock()+180000,clock());if(!lease.changes)fail('Já existe uma sincronização em andamento',409);
  running=true;const renew=setInterval(()=>{try{db.prepare('UPDATE email_receiver_lock SET expires=? WHERE owner=?').run(clock()+180000,owner);}catch{}},30000);renew.unref();let connection,count=0;
  db.prepare('UPDATE email_receiver_state SET last_attempt=?,last_error=\'\' WHERE id=1').run(iso());
  try{
   connection=await receiver(credentials(s));const cursor=state();if(!cursor.uid_validity)fail('Reative o recebimento para definir o ponto inicial da caixa');
   await connection.collect({uidValidity:cursor.uid_validity,lastUid:cursor.last_uid},async message=>{
    const providerKey=s.address+':'+cursor.uid_validity+':'+message.uid;
    if(message.oversize){skipped(providerKey,s.address);return;}
    const result=await ingest(message.source,{providerKey,mailbox:s.address});if(!result.duplicate)count++;
   },uid=>db.prepare('UPDATE email_receiver_state SET last_uid=MAX(last_uid,?) WHERE id=1 AND uid_validity=?').run(uid,cursor.uid_validity));
   db.prepare('UPDATE email_receiver_state SET last_success=?,last_error=\'\',last_count=? WHERE id=1').run(iso(),count);
   if(user)config.audit(user,'mail.sync',`Sincronização de e-mail concluída: ${count} mensagem(ns) nova(s)`);return {ok:true,count};
  }catch(error){const message=connectionError(error);db.prepare('UPDATE email_receiver_state SET last_error=? WHERE id=1').run(message);if(error.mailCode==='MAILBOX_CHANGED')save({...s,enabled:false});throw Object.assign(Error(message),{status:400});}
  finally{await connection?.close();clearInterval(renew);db.prepare('DELETE FROM email_receiver_lock WHERE owner=?').run(owner);running=false;}
 }

 function enqueue(ticketId,message,user){
  const s=settings();if(!s.outgoingEnabled)return;
  const ticket=db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);if(!ticket?.client_id)return;
  const recipients=db.prepare("SELECT DISTINCT sender FROM email_messages m JOIN email_senders s ON s.email=m.sender WHERE m.ticket_id=? AND m.client_id=? AND s.client_id=? AND s.status='approved'").all(ticketId,ticket.client_id,ticket.client_id);
  if(user&&!user.id)return;
  if(user?.account_type==='client'&&message!=='Chamado aberto')return;
  const portalRecipients=db.prepare("SELECT DISTINCT u.email FROM ticket_events e JOIN users u ON u.id=e.actor_id WHERE e.ticket_id=? AND u.client_id=? AND u.active=1 AND u.account_type='client'").all(ticketId,ticket.client_id);for(const u of portalRecipients)if(!recipients.some(r=>r.sender===u.email))recipients.push({sender:u.email});
  for(const r of recipients)db.prepare('INSERT INTO email_outbox(ticket_id,client_id,recipient,subject,text,message_id) VALUES(?,?,?,?,?,?)').run(ticketId,ticket.client_id,r.sender,`[SERVITEC #${ticketId}] ${ticket.title}`,message,`<${randomUUID()}@servitec-vsa.local>`);
 }
 desk?.setNotify(enqueue);
 async function dispatch(){
  const s=settings();if(!s.outgoingEnabled||!s.secret)return;
  const row=db.prepare("SELECT * FROM email_outbox WHERE status='pending' ORDER BY id LIMIT 1").get();if(!row)return;
  const authorized=db.prepare("SELECT 1 FROM email_senders WHERE email=? AND client_id=? AND status='approved'").get(row.recipient,row.client_id),ticket=db.prepare('SELECT client_id FROM tickets WHERE id=?').get(row.ticket_id);
  const portalAuthorized=db.prepare("SELECT 1 FROM users WHERE email=? AND client_id=? AND account_type='client' AND active=1").get(row.recipient,row.client_id);if((!authorized&&!portalAuthorized)||ticket?.client_id!==row.client_id){db.prepare("UPDATE email_outbox SET status='cancelled',error='Vínculo de empresa alterado' WHERE id=?").run(row.id);return;}
  if(!db.prepare("UPDATE email_outbox SET status='sending' WHERE id=? AND status='pending'").run(row.id).changes)return;
  let transport;try{const cred=credentials(s);transport=await smtpFactory({host:'smtp.gmail.com',port:465,secure:true,auth:{user:cred.address,pass:cred.appPassword},connectionTimeout:15000,socketTimeout:30000,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true}});const ref=db.prepare("SELECT message_id FROM email_messages WHERE ticket_id=? AND message_id<>'' ORDER BY id DESC LIMIT 1").get(row.ticket_id)?.message_id;await transport.sendMail({from:cred.address,to:row.recipient,subject:row.subject,text:row.text,messageId:row.message_id,inReplyTo:ref,references:ref});db.prepare("UPDATE email_outbox SET status='sent',sent_at=? WHERE id=?").run(iso(),row.id);}catch{db.prepare("UPDATE email_outbox SET status='uncertain',error='Confira a caixa Enviados antes de qualquer reenvio manual.' WHERE id=?").run(row.id);}finally{transport?.close();}
 }
 let outgoingTimer;if(startScheduler){outgoingTimer=setInterval(()=>dispatch().catch(()=>{}),15000);outgoingTimer.unref();}

 async function handle(req,res,path,user){
  if(path==='/api/mail/outbox'&&req.method==='GET'){requireAdmin(user);json(res,200,db.prepare('SELECT id,ticket_id,recipient,status,created,sent_at,error FROM email_outbox ORDER BY id DESC LIMIT 100').all());return true;}
  if(path!=='/api/config/mail'&&path!=='/api/config/mail/test'&&!path.startsWith('/api/mail/'))return false;
  if(path.startsWith('/api/config/mail')){
   requireAdmin(user);
   if(path==='/api/config/mail'&&req.method==='GET'){json(res,200,{settings:publicSettings(),state:state(),running:busy()});return true;}
   if(req.method==='PUT'&&path==='/api/config/mail'){
    const b=await body(req);confirm(user,b.password);if(busy())fail('Aguarde a sincronização atual antes de alterar a caixa',409);
    const old=settings(),address=normalizeEmail(b.address),enabled=b.enabled,intervalSeconds=b.intervalSeconds;
    if(!validSender(address)||typeof enabled!=='boolean'||!Number.isInteger(intervalSeconds)||intervalSeconds<60||intervalSeconds>3600)fail('Informe e-mail válido e intervalo de 60 a 3600 segundos');
    const next={provider:'gmail',address,enabled,intervalSeconds,outgoingEnabled:b.outgoingEnabled===true,secret:old.address===address?old.secret:undefined};
    if(b.appPassword!==undefined&&b.appPassword!==''){if(typeof b.appPassword!=='string'||b.appPassword.length>256)fail('Senha de app inválida');const secret=b.appPassword.replace(/\s/g,'');if(!/^[a-zA-Z0-9]{16,256}$/.test(secret))fail('Informe a senha de app gerada pelo Google, com pelo menos 16 caracteres');next.secret=encrypt(secret);}
    if(b.clearPassword===true){if(enabled||next.outgoingEnabled)fail('Desative recebimento e envio antes de remover a credencial');delete next.secret;}
    if((enabled||next.outgoingEnabled)&&!next.secret)fail('Cadastre a senha de app antes de ativar');
    if(b.startFromNow!==undefined&&typeof b.startFromNow!=='boolean')fail('Opção de início da coleta inválida');if(b.startFromNow&&!enabled)fail('Ative o recebimento para reiniciar o ponto de coleta');
    const changed=old.address!==address;changing=true;
    try{
     let baseline;const needsBaseline=changed||!state().uid_validity||b.startFromNow===true;if(enabled&&(!old.enabled||needsBaseline||b.appPassword)){const checked=await probe(next);if(needsBaseline)baseline=checked;else if(checked.uidValidity!==state().uid_validity)fail('A identificação da caixa mudou. Marque reiniciar o ponto de coleta para começar nos próximos e-mails.');}
     transaction(()=>{save(next);if(changed)db.prepare('UPDATE email_receiver_state SET uid_validity=NULL,last_uid=0,last_attempt=NULL,last_success=NULL,last_error=\'\',last_count=0 WHERE id=1').run();if(baseline)db.prepare('UPDATE email_receiver_state SET uid_validity=?,last_uid=?,last_error=\'\' WHERE id=1').run(baseline.uidValidity,baseline.lastUid);config.audit(user,'mail.config','Configuração da caixa de entrada atualizada'+(enabled?' e ativada':' (recebimento desativado)'));});
     json(res,200,{ok:true,settings:publicSettings(),startedFromNow:!!baseline});return true;
    }finally{changing=false;}
   }
   if(req.method==='POST'&&path==='/api/config/mail/test'){const b=await body(req);confirm(user,b.password);if(busy())fail('Aguarde a sincronização atual',409);const s=settings();if(!s.secret)fail('Salve o endereço e a senha de app antes de testar');changing=true;try{await probe(s);json(res,200,{ok:true,message:'Conexão com Gmail validada. A caixa INBOX foi aberta somente para leitura.'});return true;}finally{changing=false;}}
   fail('Rota não encontrada',404);
  }
  requireRead(user);
  if(path==='/api/mail/status'&&req.method==='GET'){const s=settings();json(res,200,{outbox:db.prepare("SELECT status,count(*) AS total FROM email_outbox GROUP BY status").all(),configured:!!s.secret,address:s.address,enabled:s.enabled,running:busy(),state:state(),counts:counts()});return true;}
  if(path==='/api/mail/sync'&&req.method==='POST'){requireWrite(user);json(res,200,await sync(user));return true;}
  if(path==='/api/mail/import'&&req.method==='POST'){
   requireWrite(user);const b=await body(req);if(typeof b.source!=='string'||b.source.length>700000||!/^[A-Za-z0-9+/]*={0,2}$/.test(b.source))fail('Selecione um arquivo .eml de até 512 KB');const raw=Buffer.from(b.source,'base64');if(raw.length>512*1024||!raw.length)fail('Selecione um arquivo .eml de até 512 KB');const result=await ingest(raw,{mailbox:''});config.audit(user,'mail.import',`E-mail #${result.id} importado${result.duplicate?' (já existente)':''}`);json(res,200,result);return true;
  }
  if(path==='/api/mail/messages'&&req.method==='GET'){
   const params=new URL(req.url,'http://localhost').searchParams,status=params.get('status')||'pending',search=(params.get('search')||'').trim(),page=Number(params.get('page')||1);
   if(!['pending','ticket','rejected','blocked','ignored','all'].includes(status)||search.length>200||!Number.isSafeInteger(page)||page<1)fail('Filtro de e-mails inválido');
   const where=(status==='all'?'1=1':'m.status=?')+' AND (instr(lower(m.sender),lower(?))>0 OR instr(lower(m.subject),lower(?))>0)',args=[...(status==='all'?[]:[status]),search,search],total=db.prepare('SELECT count(*) n FROM email_messages m WHERE '+where).get(...args).n,pages=Math.max(1,Math.ceil(total/20)),current=Math.min(page,pages);
   const rows=db.prepare('SELECT m.id,m.sender,m.sender_name,m.subject,m.status,m.risk,m.reason,m.ticket_id,m.client_id,c.name AS client_name,m.received_at,m.reviewed_at,u.name AS reviewed_by_name FROM email_messages m LEFT JOIN clients c ON c.id=m.client_id LEFT JOIN users u ON u.id=m.reviewed_by WHERE '+where+' ORDER BY m.id DESC LIMIT 20 OFFSET ?').all(...args,(current-1)*20);
   json(res,200,{rows,total,page:current,pages});return true;
  }
  if(/^\/api\/mail\/messages\/\d+$/.test(path)&&req.method==='GET'){
   const row=db.prepare('SELECT m.*,c.name AS client_name,u.name AS reviewed_by_name FROM email_messages m LEFT JOIN clients c ON c.id=m.client_id LEFT JOIN users u ON u.id=m.reviewed_by WHERE m.id=?').get(Number(path.split('/').pop()));if(!row)fail('E-mail não encontrado',404);
   const sender=db.prepare('SELECT s.id,s.email,s.client_id,s.status,c.name AS client_name FROM email_senders s LEFT JOIN clients c ON c.id=s.client_id WHERE email=?').get(row.sender)||null;
   json(res,200,{...row,attachments:JSON.parse(row.attachments),senderLink:sender,pendingFromSender:db.prepare("SELECT count(*) n FROM email_messages WHERE sender=? AND status='pending' AND risk=''").get(row.sender).n});return true;
  }
  if(/^\/api\/mail\/messages\/\d+\/(approve|reject)$/.test(path)&&req.method==='POST'){
   requireWrite(user);const b=await body(req),id=Number(path.split('/')[4]),row=db.prepare('SELECT * FROM email_messages WHERE id=?').get(id);if(!row)fail('E-mail não encontrado',404);if(row.status!=='pending')fail('Este e-mail já foi tratado. Atualize a lista.',409);
   if(path.endsWith('/approve')){
    validateClient(b.clientId);if(!validSender(row.sender))fail('O e-mail não possui um remetente único e válido');if(b.remember!==undefined&&typeof b.remember!=='boolean'||b.releaseAll!==undefined&&typeof b.releaseAll!=='boolean')fail('Opções de aprovação inválidas');
    const result=transaction(()=>{
     if(b.remember!==false){db.prepare("INSERT INTO email_senders(email,client_id,status,updated_by,updated_at) VALUES(?,?,'approved',?,?) ON CONFLICT(email) DO UPDATE SET client_id=excluded.client_id,status='approved',updated_by=excluded.updated_by,updated_at=excluded.updated_at").run(row.sender,b.clientId,user.id,iso());config.audit(user,'mail.sender.approve',`Remetente #${db.prepare('SELECT id FROM email_senders WHERE email=?').get(row.sender).id} vinculado à empresa #${b.clientId}`);}
     const rows=b.releaseAll===true?db.prepare("SELECT * FROM email_messages WHERE status='pending' AND sender=? AND (risk='' OR id=?) ORDER BY id").all(row.sender,id):[row];const tickets=rows.map(message=>convert(message,b.clientId,user));return {ok:true,ticketIds:tickets,count:tickets.length};
    });json(res,200,result);return true;
   }
   const reason=typeof b.reason==='string'?b.reason.trim().slice(0,500):'';if(!reason)fail('Informe o motivo da rejeição');
   transaction(()=>{db.prepare("UPDATE email_messages SET status='rejected',reason=?,reviewed_by=?,reviewed_at=? WHERE id=?").run(reason,user.id,iso(),id);config.audit(user,'mail.reject',`E-mail #${id} rejeitado: ${reason}`);});json(res,200,{ok:true});return true;
  }
  if(path==='/api/mail/senders'&&req.method==='GET'){
   const params=new URL(req.url,'http://localhost').searchParams,search=(params.get('search')||'').trim(),page=Number(params.get('page')||1);if(search.length>200||!Number.isSafeInteger(page)||page<1)fail('Filtro de remetentes inválido');
   const where='instr(lower(s.email),lower(?))>0',total=db.prepare('SELECT count(*) n FROM email_senders s WHERE '+where).get(search).n,pages=Math.max(1,Math.ceil(total/20)),current=Math.min(page,pages);
   const rows=db.prepare('SELECT s.*,c.name AS client_name,u.name AS updated_by_name FROM email_senders s LEFT JOIN clients c ON c.id=s.client_id LEFT JOIN users u ON u.id=s.updated_by WHERE '+where+' ORDER BY s.email LIMIT 20 OFFSET ?').all(search,(current-1)*20);json(res,200,{rows,total,page:current,pages});return true;
  }
  if(path==='/api/mail/senders'&&req.method==='POST'||/^\/api\/mail\/senders\/\d+$/.test(path)&&req.method==='PATCH'){
   requireWrite(user);const b=await body(req),previous=req.method==='PATCH'?db.prepare('SELECT * FROM email_senders WHERE id=?').get(Number(path.split('/').pop())):null;if(req.method==='PATCH'&&!previous)fail('Remetente não encontrado',404);
   const email=previous?.email||normalizeEmail(b.email),status=b.status,clientId=status==='approved'?b.clientId:null;if(!validSender(email)||!['approved','blocked'].includes(status))fail('Informe e-mail e situação válidos');if(status==='approved')validateClient(clientId);
   if(!previous&&db.prepare('SELECT id FROM email_senders WHERE email=?').get(email))fail('Remetente já cadastrado. Edite o vínculo existente.',409);
   db.prepare('INSERT INTO email_senders(email,client_id,status,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET client_id=excluded.client_id,status=excluded.status,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(email,clientId,status,user.id,iso());config.audit(user,'mail.sender.update',`Remetente atualizado (${status}), empresa #${clientId??'nenhuma'}`);json(res,200,{ok:true});return true;
  }
  fail('Rota não encontrada',404);
 }
 if(!settings().secret)key(true);
 if(startScheduler){timer=setInterval(()=>{if(stopped||busy())return;const s=settings(),last=state().last_attempt;if(s.enabled&&(!last||clock()-Date.parse(last)>=s.intervalSeconds*1000))sync().catch(()=>{});},15000);timer.unref();}
 return {handle,ingest,sync,dispatch,stop(){stopped=true;clearInterval(timer);clearInterval(outgoingTimer);}};
}
