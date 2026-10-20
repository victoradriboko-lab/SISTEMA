import {randomUUID} from 'node:crypto';
import {createUpdateStore,MAX_UPDATE_BYTES} from './update-store.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export function createUpdates({db,config,check,json,root,dataDir,restart,fetcher=fetch,startScheduler=true}){
 const store=createUpdateStore({root,dataDir});let busy=false,timer,latest=null,checking=false,lastCheck=null,lastError=null;
 const setting=()=>({...{repository:'victoradriboko-lab/SISTEMA'},...JSON.parse(db.prepare("SELECT value FROM settings WHERE key='system-updates'").get()?.value||'{}')});
 const confirm=(user,password)=>{const stored=db.prepare('SELECT password FROM users WHERE id=? AND active=1').get(user.id);if(typeof password!=='string'||password.length>256||!stored||!check(password,stored.password))fail('Senha atual incorreta',403);};
 async function readJSON(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_UPDATE_BYTES)fail('O pacote deve ter até 32 MB',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('Arquivo JSON inválido');}}
 const status=()=>({...store.status(),busy,github:{...setting(),latest,checking,lastCheck,error:lastError,tokenConfigured:!!process.env.SERVITEC_UPDATE_GITHUB_TOKEN}});
 async function responseBytes(response,max){const chunks=[];let size=0;if(!response.ok)fail(response.status===404?'Nenhuma Release compatível encontrada ou sem acesso ao repositório privado.':response.status===401||response.status===403?'GitHub recusou o acesso. Configure SERVITEC_UPDATE_GITHUB_TOKEN com leitura do repositório.':'Falha ao consultar o GitHub ('+response.status+').',502);if(!response.body)fail('Resposta vazia do GitHub',502);for await(const chunk of response.body){size+=chunk.length;if(size>max)fail('Resposta do GitHub excede o limite permitido',413);chunks.push(chunk);}return Buffer.concat(chunks);}
 const headers=()=>({'Accept':'application/vnd.github+json','User-Agent':'Servitec-Updater',...(process.env.SERVITEC_UPDATE_GITHUB_TOKEN?{'Authorization':'Bearer '+process.env.SERVITEC_UPDATE_GITHUB_TOKEN}:{})});
 function repository(){const repo=setting().repository;if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))fail('Repositório inválido');return repo;}
 async function checkGitHub(){
  if(checking)fail('Consulta ao GitHub já em andamento',409);checking=true;
  try{
   const response=await fetcher('https://api.github.com/repos/'+repository()+'/releases/latest',{headers:headers(),redirect:'error',signal:AbortSignal.timeout(20000)});
   const data=JSON.parse((await responseBytes(response,1024*1024)).toString('utf8'));
   const version=String(data.tag_name||'').replace(/^v/,'');
   const asset=data.assets?.find(a=>a.name==='servitec-update.json');
   if(data.draft||data.prerelease||!/^\d+\.\d+\.\d+$/.test(version)||!asset||!Number.isSafeInteger(asset.id)||asset.size>MAX_UPDATE_BYTES)fail('A Release precisa conter servitec-update.json e uma versão estável no formato v1.2.3');
   latest={version,assetId:asset.id,url:'https://github.com/'+repository()+'/releases/tag/'+encodeURIComponent(data.tag_name),publishedAt:data.published_at,available:newer(version,store.status().version)};
   lastError=null;return latest;
  }catch(error){lastError=error.status?error.message:'Não foi possível consultar o GitHub. Verifique a conexão do servidor.';fail(lastError,error.status||502);}
  finally{lastCheck=new Date().toISOString();checking=false;}
 }
 function newer(a,b){const aa=a.split('.').map(Number),bb=b.split('.').map(Number);return aa[0]!==bb[0]?aa[0]>bb[0]:aa[1]!==bb[1]?aa[1]>bb[1]:aa[2]>bb[2];}
 async function download(expectedVersion){
  const item=await checkGitHub();if(item.version!==expectedVersion)fail('A versão disponível mudou. Consulte as notas e aprove a nova versão antes de instalar',409);if(!item.available)fail('A versão instalada já está atualizada',409);
  let response=await fetcher('https://api.github.com/repos/'+repository()+'/releases/assets/'+item.assetId,{headers:{...headers(),Accept:'application/octet-stream'},redirect:'manual',signal:AbortSignal.timeout(30000)});
  if([301,302,303,307,308].includes(response.status)){
   const url=new URL(response.headers.get('location'));
   if(url.protocol!=='https:'||url.username||url.password||!['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(url.hostname))fail('Destino de download do GitHub não permitido');
   // Nunca encaminhar o token para o armazenamento de arquivos/redirecionamentos.
   response=await fetcher(url.href,{headers:{Accept:'application/octet-stream'},redirect:'error',signal:AbortSignal.timeout(60000)});
  }
  let pkg;try{pkg=JSON.parse((await responseBytes(response,MAX_UPDATE_BYTES)).toString('utf8'));}catch(error){if(error.status)throw error;fail('O pacote publicado não contém JSON válido');}
  if(pkg.version!==item.version)fail('A versão do pacote difere da Release');return pkg;
 }
 async function install({pkg,rollback=false,user=null,github=false,expectedVersion}){
  if(busy)fail('Há uma atualização em andamento',409);busy=true;let leaseOwner=null;
  try{
   if(github){if(typeof expectedVersion!=='string'||!/^\d+\.\d+\.\d+$/.test(expectedVersion))fail('Confirme a versão que deseja instalar');pkg=await download(expectedVersion);}
   const owner='update-'+randomUUID(),now=Date.now();
   const lease=db.prepare('INSERT INTO backup_lease(id,owner,expires) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE backup_lease.expires<?').run(owner,now+300000,now);
   if(!lease.changes)fail('Aguarde o backup em execução antes de atualizar',409);leaseOwner=owner;
   const record=await store.prepare({pkg,rollback,db,actor:user?.id||null});
   config.audit(user,rollback?'system.update.rollback':'system.update.install',`${record.fromVersion} → ${record.toVersion}${github?' (GitHub)':''}`);
   return {ok:true,version:record.toVersion,message:'Pacote validado e backup concluído. O sistema está reiniciando para aplicar a versão.'};
  }finally{if(leaseOwner)db.prepare('DELETE FROM backup_lease WHERE owner=?').run(leaseOwner);busy=false;}
 }
 async function tick(){
  if(busy||checking||['pending','starting'].includes(store.status().status))return;
  try{await checkGitHub();}catch{}
 }
 async function handle(req,res,path,user){
  if(!path.startsWith('/api/config/updates'))return false;
  if(user.role!=='admin'||!config.allowed(user,'system.manage'))fail('Somente administradores podem atualizar o sistema',403);
  if(path==='/api/config/updates'&&req.method==='GET'){json(res,200,status());return true;}
  if(path==='/api/config/updates/check'&&req.method==='POST'){json(res,200,{latest:await checkGitHub()});return true;}
  if(path==='/api/config/updates/settings'&&req.method==='PUT'){
   const b=await readJSON(req);confirm(user,b.password);if(busy||['pending','starting'].includes(store.status().status))fail('Aguarde a atualização atual',409);
   if(typeof b.repository!=='string'||!/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.test(b.repository)||b.repository.length>180)fail('Configuração do GitHub inválida');
   db.prepare("INSERT INTO settings(key,value) VALUES('system-updates',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({repository:b.repository}));
   latest=null;config.audit(user,'system.update.settings','Fonte das atualizações: '+b.repository);json(res,200,{ok:true});return true;
  }
  if(['/api/config/updates/install','/api/config/updates/rollback','/api/config/updates/github'].includes(path)&&req.method==='POST'){
   const b=await readJSON(req);confirm(user,b.password);
   if(!process.send&&!restart.available)fail('Inicie a plataforma com node server.mjs para habilitar a reinicialização das versões',409);
   const result=await install({pkg:b.package,rollback:path.endsWith('/rollback'),github:path.endsWith('/github'),expectedVersion:b.expectedVersion,user});
   res.once('finish',restart);json(res,202,result);return true;
  }
  fail('Rota não encontrada',404);
 }
 if(startScheduler){timer=setInterval(()=>tick(),30*60000);timer.unref();}
 return {handle,status,tick,stop(){clearInterval(timer);},checkGitHub};
}
