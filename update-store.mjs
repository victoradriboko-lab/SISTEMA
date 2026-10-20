import {createHash,randomUUID} from 'node:crypto';
import {copyFileSync,chmodSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,join,dirname,relative,sep,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';
import {backup,DatabaseSync} from 'node:sqlite';

export const MAX_UPDATE_BYTES=32*1024*1024;
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const inside=(base,path)=>{const r=relative(base,path);return r===''||(!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r));};
export function updatePath(name){
 if(typeof name!=='string'||name.length>200||name.includes('\\')||!name.split('/').every(p=>/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p)&&p!=='.'&&p!=='..'&&!p.endsWith('.')&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))return false;
 return /^[A-Za-z0-9-]+\.mjs$/.test(name)||name==='package.json'||/^public\/[A-Za-z0-9/_.-]+\.(js|css|html|png|jpg|jpeg|webp|svg|ico)$/.test(name)||/^agents\/windows\/[A-Za-z0-9/_.-]+\.(exe|zip|config|ps1|bat|cs|csproj|ico|md|sha256)$/.test(name);
}
export function createUpdateStore({root,dataDir}){
 root=resolve(root);dataDir=resolve(dataDir);const folder=join(dataDir,'.updates');
 const safeDirectory=path=>{if(existsSync(path)&&lstatSync(path).isSymbolicLink())fail('Pasta de atualização não pode ser um link');mkdirSync(path,{recursive:true,mode:0o700});};
 safeDirectory(folder);
 const file=name=>join(folder,name);
 function atomic(path,bytes){const temp=path+'.tmp-'+randomUUID();try{writeFileSync(temp,bytes,{mode:0o600,flag:'wx',flush:true});renameSync(temp,path);}finally{rmSync(temp,{force:true});}}
 const write=(name,value)=>atomic(file(name),JSON.stringify(value));
 const read=(name,fallback=null)=>existsSync(file(name))?JSON.parse(readFileSync(file(name),'utf8')):fallback;
 const state=()=>read('state.json',{status:'idle',previous:null});
 const info=()=>JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
 function target(name){
  if(!updatePath(name))fail('Caminho não permitido no pacote: '+String(name).slice(0,200));
  const path=resolve(root,name);if(!inside(root,path)||inside(dataDir,path))fail('O pacote não pode alterar a pasta de dados');
  let current=root;for(const part of name.split('/')){current=join(current,part);if(existsSync(current)&&lstatSync(current).isSymbolicLink())fail('Atualização não permite links: '+name);}
  if(existsSync(path)&&!lstatSync(path).isFile())fail('O destino não é um arquivo: '+name);
  return path;
 }
 function snapshot(name){const path=target(name);return existsSync(path)?readFileSync(path).toString('base64'):null;}
 function applyFiles(files){for(const entry of files){const path=target(entry.path);if(entry.data===null)rmSync(path,{force:true});else{mkdirSync(dirname(path),{recursive:true});atomic(path,Buffer.from(entry.data,'base64'));}}}
 function release(id){if(!/^[a-f0-9-]{36}$/.test(id||''))fail('Identificador de atualização inválido');return read(id+'/release.json');}
 function packageFiles(pkg){
  if(!pkg||pkg.format!=='servitec-update-v1'||pkg.dataPolicy!=='preserve-additive')fail('Selecione um pacote de atualização Servitec válido');
  if(typeof pkg.version!=='string'||!/^\d+\.\d+\.\d+$/.test(pkg.version)||pkg.version.length>80)fail('Versão inválida');
  if(pkg.fromVersion!==info().version)fail('Este pacote exige a versão '+String(pkg.fromVersion).slice(0,80)+'. Versão instalada: '+info().version,409);
  if(pkg.version===pkg.fromVersion)fail('A versão do pacote deve ser diferente da instalada');
  if(!Array.isArray(pkg.files)||!pkg.files.length||pkg.files.length>500)fail('Quantidade de arquivos inválida');
  const names=new Set();let total=0;
  const files=pkg.files.map(entry=>{
   target(entry.path);const key=entry.path.toLowerCase();if(names.has(key))fail('Arquivo duplicado no pacote');names.add(key);
   if(typeof entry.data!=='string'||entry.data.length>16*1024*1024||(entry.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(entry.data)))fail('Conteúdo inválido: '+entry.path);
   const bytes=Buffer.from(entry.data,'base64');total+=bytes.length;if(total>22*1024*1024)fail('O pacote excede o tamanho permitido',413);
   if(!/^[a-f0-9]{64}$/.test(entry.sha256||'')||sha(bytes)!==entry.sha256)fail('Integridade inválida: '+entry.path);
   return {path:entry.path,data:entry.data};
  });
  const manifest=files.find(f=>f.path==='package.json');if(!manifest)fail('O pacote precisa conter package.json');
  let next;try{next=JSON.parse(Buffer.from(manifest.data,'base64'));}catch{fail('package.json inválido');}
  const current=info();if(next.name!==current.name||next.version!==pkg.version||next.type!==current.type)fail('Identificação do pacote incompatível');
  for(const key of ['dependencies','devDependencies','optionalDependencies','engines'])if(JSON.stringify(next[key]||{})!==JSON.stringify(current[key]||{}))fail('Mudanças nas dependências ou no Node.js exigem atualização pelo administrador no servidor');
  return files;
 }
 function verifySyntax(files,id){
  const stage=file(id+'/syntax');mkdirSync(stage,{recursive:true,mode:0o700});
  try{for(const entry of files){if(entry.data!==null&&/\.(mjs|js)$/.test(entry.path)){const path=join(stage,entry.path.replaceAll('/','_')+'.mjs');writeFileSync(path,Buffer.from(entry.data,'base64'));try{execFileSync(process.execPath,['--check',path],{timeout:10000,stdio:'pipe'});}catch{fail('Erro de sintaxe no arquivo '+entry.path);}}}}finally{rmSync(stage,{recursive:true,force:true});}
 }
 async function prepare({pkg,rollback=false,db,actor}){
  if(existsSync(file('pending.json'))||existsSync(file('journal.json')))fail('Há uma atualização aguardando reinicialização',409);
  const current=info();let files,toVersion;
  if(rollback){const previous=state().previous;if(!previous)fail('Não há versão anterior disponível',409);const old=release(previous);if(old.toVersion!==current.version)fail('Os arquivos foram alterados fora do atualizador; revise a versão no servidor',409);files=old.before;toVersion=old.fromVersion;}
  else{files=packageFiles(pkg);toVersion=pkg.version;}
  const id=randomUUID(),destination=file(id);safeDirectory(destination);
  try{
   verifySyntax(files,id);
   const before=files.map(entry=>({path:entry.path,data:snapshot(entry.path)}));
   // A cópia consistente do SQLite nunca é restaurada automaticamente na reversão.
   await backup(db,join(destination,'database-before.sqlite'));
   const copy=new DatabaseSync(join(destination,'database-before.sqlite'),{readOnly:true});try{if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')fail('Falha na integridade do backup');}finally{copy.close();}
   function copyData(source,dest){mkdirSync(dest,{recursive:true,mode:0o700});for(const entry of readdirSync(source,{withFileTypes:true})){if(entry.name==='.updates'||['sistema.db','sistema.db-wal','sistema.db-shm'].includes(entry.name)||entry.name.endsWith('.log'))continue;const src=join(source,entry.name),out=join(dest,entry.name);if(entry.isSymbolicLink())fail('A pasta de dados contém um link; faça o backup manual antes de atualizar');if(entry.isDirectory())copyData(src,out);else if(entry.isFile()){copyFileSync(src,out);chmodSync(out,0o600);}}}
   copyData(dataDir,join(destination,'data-before'));
   const record={id,action:rollback?'rollback':'install',fromVersion:current.version,toVersion,files,before,createdAt:new Date().toISOString(),actor};
   write(id+'/release.json',record);write('pending.json',{id});write('state.json',{...state(),status:'pending',pendingVersion:toVersion,error:null});return record;
  }catch(error){rmSync(destination,{recursive:true,force:true});throw error;}
 }
 function restore(id,message){const record=release(id);applyFiles(record.before);rmSync(file('journal.json'),{force:true});rmSync(file('pending.json'),{force:true});write('state.json',{...state(),status:'failed',pendingVersion:null,error:message});}
 function applyPending(){
  const interrupted=read('journal.json');if(interrupted)restore(interrupted.id,'A aplicação da atualização foi interrompida. Os arquivos anteriores foram recuperados.');
  const pending=read('pending.json');if(!pending)return null;
  const record=release(pending.id);
  try{
   if(info().version!==record.fromVersion||record.before.some(f=>snapshot(f.path)!==f.data))fail('Os arquivos mudaram desde a preparação. Gere o pacote para a instalação atual.');
   write('journal.json',{id:record.id});applyFiles(record.files);write('state.json',{...state(),status:'starting'});return record;
  }catch(error){if(existsSync(file('journal.json')))restore(record.id,error.message);else{rmSync(file('pending.json'),{force:true});write('state.json',{...state(),status:'failed',pendingVersion:null,error:error.message});}return null;}
 }
 function complete(id){const record=release(id);write('state.json',{status:'installed',previous:id,version:record.toVersion,updatedAt:new Date().toISOString(),action:record.action,error:null});rmSync(file('pending.json'),{force:true});rmSync(file('journal.json'),{force:true});}
 function status(){const s=state();let previousVersion=null;if(s.previous){try{previousVersion=release(s.previous).fromVersion;}catch{}}return {...s,version:info().version,previousVersion,canRollback:!!previousVersion&&!existsSync(file('pending.json')),backupDirectory:folder};}
 return {prepare,applyPending,complete,restore,status};
}
