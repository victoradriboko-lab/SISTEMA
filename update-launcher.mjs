import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createUpdateStore} from './update-store.mjs';
export async function startPlatform(){
 const root=fileURLToPath(new URL('.',import.meta.url)),dataDir=resolve(process.env.DATA_DIR||root+'data');
 const store=createUpdateStore({root,dataDir});let child,stopping=false;
 const stop=()=>{if(stopping)return;stopping=true;if(child){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),12000);timer.unref();}else process.exit(0);};
 process.on('SIGTERM',stop);process.on('SIGINT',stop);
 function launch(){
  if(stopping)return;const applied=store.applyPending();let ready=false,restart=false;
  child=fork(new URL('./runtime-server.mjs',import.meta.url),[],{env:{...process.env,SERVITEC_SUPERVISED:'1',DATA_DIR:dataDir},stdio:['inherit','inherit','inherit','ipc']});
  const timer=setTimeout(()=>{if(!ready)child.kill('SIGTERM');},45000);timer.unref();
  child.on('message',message=>{
   if(message?.type==='ready'){ready=true;clearTimeout(timer);if(applied)store.complete(applied.id);}
   if(message?.type==='restart-for-update'&&ready){restart=true;child.send({type:'shutdown'});}
  });
  child.on('error',error=>console.error('Falha ao iniciar a plataforma: '+error.message));
  child.on('exit',(code)=>{
   clearTimeout(timer);
   if(stopping){process.exit(code||0);return;}
   if(applied&&!ready){store.restore(applied.id,'A nova versão não iniciou. Os arquivos anteriores foram recuperados; os dados atuais foram preservados.');console.error('Atualização revertida porque a nova versão não iniciou.');launch();return;}
   if(restart){launch();return;}
   process.exit(code||0);
  });
 }
 launch();
}
