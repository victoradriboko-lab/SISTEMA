import {createHash} from 'node:crypto';
export const MAX_MAIL_BYTES=5*1024*1024;
const clean=(value,max)=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').slice(0,max);
export const normalizeEmail=value=>typeof value==='string'?value.trim().toLowerCase():'';
export const validSender=value=>typeof value==='string'&&value.length<=254&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
export async function parseIncomingMail(source,{systemAddress=''}={}){
 if(!Buffer.isBuffer(source)||source.length>MAX_MAIL_BYTES)throw Object.assign(Error('O e-mail excede o limite de 5 MB'),{status:400});
 const {simpleParser}=await import('mailparser');
 const parsed=await simpleParser(source,{skipTextToHtml:true,skipImageLinks:true,maxHtmlLengthToParse:100000});
 const addresses=parsed.from?.value||[],sender=addresses.length===1?normalizeEmail(addresses[0].address):'';
 const usable=validSender(sender),header=key=>String(parsed.headers.get(key)||'');
 const automatic=(header('auto-submitted')&&header('auto-submitted').toLowerCase()!=='no')||/^(bulk|junk|list)$/i.test(header('precedence').trim())||parsed.headers.has('list-id');
 const flagged=/\bdmarc\s*=\s*(fail|quarantine|reject)\b/i.test(header('authentication-results'))||/^yes\b/i.test(header('x-spam-flag'))||/^yes\b/i.test(header('x-spam-status'));
 const own=usable&&sender===normalizeEmail(systemAddress);
 return {fingerprint:createHash('sha256').update(source).digest('hex'),sender:usable?sender:'',senderName:clean(addresses[0]?.name,500),subject:clean(parsed.subject,500).replace(/[\r\n]/g,' ').trim()||'(Sem assunto)',text:clean(parsed.text||'(E-mail sem conteúdo textual.)',80000),messageId:clean(parsed.messageId,1000),references:[parsed.inReplyTo,...(Array.isArray(parsed.references)?parsed.references:[parsed.references])].filter(v=>typeof v==='string').slice(0,30),mailDate:parsed.date&&!Number.isNaN(parsed.date.valueOf())?parsed.date.toISOString():null,attachments:(parsed.attachments||[]).slice(0,30).map(a=>({name:clean(a.filename||'Arquivo sem nome',200),size:a.size||0})),risk:!usable?'invalid_sender':flagged?'provider_warning':parsed.textConversionError?'content_review':'',ignored:own?'Mensagem enviada pela própria caixa do sistema':automatic?'Resposta automática, lista ou mensagem em massa':''};
}

// A caixa é aberta somente para leitura. A coleta não apaga e-mails nem muda a marcação de lido.
export async function openGmail({address,appPassword}){
 const {ImapFlow}=await import('imapflow');
 const client=new ImapFlow({host:'imap.gmail.com',port:993,secure:true,auth:{user:address,pass:appPassword},logger:false,disableAutoIdle:true,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true}});
 client.on('error',()=>{});let lock;
 try{await client.connect();lock=await client.getMailboxLock('INBOX',{readOnly:true});}
 catch(error){client.close();throw error;}
 const snapshot=()=>({uidValidity:String(client.mailbox.uidValidity),lastUid:Number(client.mailbox.uidNext)-1});
 return {snapshot,
  async collect(cursor,onMessage,onCheckpoint){
   if(snapshot().uidValidity!==cursor.uidValidity)throw Object.assign(Error('A identificação da caixa mudou. Reinicie o ponto de coleta nas configurações.'),{mailCode:'MAILBOX_CHANGED'});
   const ids=(await client.search({uid:(cursor.lastUid+1)+':*'},{uid:true})||[]).filter(uid=>uid>cursor.lastUid).sort((a,b)=>a-b).slice(0,50),started=Date.now();
   for(const uid of ids){
    if(Date.now()-started>90000)break;
    const meta=await client.fetchOne(String(uid),{uid:true,size:true},{uid:true});
    if(!meta){onCheckpoint(uid);continue;}
    if(meta.size>MAX_MAIL_BYTES)await onMessage({uid,oversize:true});
    else{const row=await client.fetchOne(String(uid),{uid:true,source:{start:0,maxLength:MAX_MAIL_BYTES+1}},{uid:true});if(row&&!row.source)throw Error('O servidor não retornou o conteúdo do e-mail');if(row?.source)await onMessage({uid,source:row.source});}
    onCheckpoint(uid);
   }
  },
  async close(){try{lock.release();await client.logout();}catch{client.close();}}
 };
}
