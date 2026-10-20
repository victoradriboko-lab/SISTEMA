const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function showSystemUpdates(element,{api,notify}){
 let state=await api('config/updates'),working=false;
 function render(){
  const next=state.github.latest,pending=['pending','starting'].includes(state.status);
  element.innerHTML=`<div class="panel system-update-panel"><h2>Atualizar o sistema</h2><p>Versão instalada: <strong>${escape(state.version)}</strong></p><p>O sistema consulta as versões publicadas no GitHub. A instalação só começa após sua aprovação com a senha de administrador. Um backup é criado antes da troca; os dados atuais são preservados ao voltar a versão.</p>
  <div class="system-update-release"><p id="update-release-text" aria-live="polite">${next?.available?`Nova versão disponível: <strong>${escape(next.version)}</strong>`:state.github.lastCheck?'Nenhuma versão mais recente disponível.':'Verifique se há uma nova versão disponível.'}</p><div class="update-actions"><button type="button" id="update-check" ${working||pending?'disabled':''}>Verificar GitHub</button>${next?`<a class="button" href="${escape(next.url)}" target="_blank" rel="noopener noreferrer">Notas da versão</a>`:''}</div></div>
  ${state.github.error?`<p class="update-message" role="status">${escape(state.github.error)}</p>`:''}
  <form id="system-update-form"><label for="update-password">Sua senha de administrador</label><input id="update-password" name="password" type="password" autocomplete="current-password" maxlength="256" required ${working||pending?'disabled':''}><div class="update-actions"><button class="primary" type="submit" ${!next?.available||working||pending?'disabled':''}>Atualizar pelo GitHub${next?.available?' para '+escape(next.version):''}</button><button type="button" id="update-rollback" ${!state.canRollback||working||pending?'disabled':''}>Voltar para a versão anterior${state.previousVersion?' ('+escape(state.previousVersion)+')':''}</button></div>
  <details><summary>Atualização manual por arquivo</summary><p>Selecione um pacote Servitec <code>.json</code> de até 32 MB, preparado para a versão instalada.</p><label for="update-file">Arquivo de atualização</label><input id="update-file" type="file" accept=".json,application/json" ${working||pending?'disabled':''}><button type="button" id="update-manual" ${working||pending?'disabled':''}>Instalar arquivo de atualização</button></details></form>
  <p id="update-operation" role="status" aria-live="polite">${pending?'Atualização preparada. Aguardando reinicialização…':state.error?escape(state.error):state.updatedAt?'Última alteração: '+escape(new Date(state.updatedAt).toLocaleString('pt-BR')):''}</p><progress id="update-progress" aria-label="Atualização em andamento" hidden></progress>
  <details><summary>Fonte e cópias de segurança</summary><p>Repositório: <strong>${escape(state.github.repository)}</strong>. A consulta automática ocorre a cada 30 minutos; ela não instala atualizações.</p><p>Em repositórios privados, configure <code>SERVITEC_UPDATE_GITHUB_TOKEN</code> no ambiente do servidor, com leitura de conteúdo. O token não é enviado ao navegador.</p><p>Backups de cada troca ficam em <code>${escape(state.backupDirectory)}</code>. A reversão restaura somente os arquivos da aplicação; o banco e os dados atuais continuam em uso.</p><form id="update-source-form"><label for="update-repository">Repositório do GitHub (proprietário/nome)</label><input id="update-repository" value="${escape(state.github.repository)}" required maxlength="180"><label for="update-source-password">Senha de administrador</label><input id="update-source-password" type="password" autocomplete="current-password" required maxlength="256"><button type="submit">Salvar origem</button></form></details></div>`;
  element.querySelector('#update-check').onclick=check;
  element.querySelector('#system-update-form').onsubmit=e=>{e.preventDefault();install('github');};
  element.querySelector('#update-rollback').onclick=()=>install('rollback');
  element.querySelector('#update-manual').onclick=()=>install('install');
  element.querySelector('#update-source-form').onsubmit=async e=>{
   e.preventDefault();if(working)return;const password=element.querySelector('#update-source-password'),value=password.value;password.value='';
   try{await api('config/updates/settings','PUT',{password:value,repository:element.querySelector('#update-repository').value.trim()});state=await api('config/updates');render();notify('Origem das atualizações salva.');}catch(error){notify(error.message,'error');}
  };
 }
 async function check(){
  if(working)return;working=true;element.querySelector('#update-check').disabled=true;
  element.querySelector('#update-release-text').textContent='Consultando versões no GitHub…';
  try{await api('config/updates/check','POST',{});state=await api('config/updates');}catch(error){state=await api('config/updates').catch(()=>state);notify(error.message,'error');}
  finally{working=false;if(element.isConnected)render();}
 }
 async function install(action){
  if(working)return;const password=element.querySelector('#update-password');if(!password.reportValidity())return;
  let pkg;
  try{
   if(action==='install'){const input=element.querySelector('#update-file'),file=input.files[0];if(!file||file.size>32*1024*1024)throw Error('Selecione um pacote JSON de até 32 MB');try{pkg=JSON.parse(await file.text());}catch{throw Error('O arquivo não contém JSON válido');}}
   const version=action==='rollback'?state.previousVersion:action==='install'?pkg.version:state.github.latest?.version;
   if(!window.confirm(`${action==='rollback'?'Voltar':'Atualizar'} para a versão ${version}? O sistema fará um backup e reiniciará. Os dados atuais serão preservados.`))return;
   const value=password.value;password.value='';working=true;
   element.querySelectorAll('button,input').forEach(e=>e.disabled=true);
   const label=element.querySelector('#update-operation'),progress=element.querySelector('#update-progress');progress.hidden=false;
   label.textContent='Validando o pacote e criando o backup. Aguarde…';
   const result=await api('config/updates/'+action,'POST',{password:value,...(pkg?{package:pkg}:action==='github'?{expectedVersion:version}:{})});
   label.textContent=result.message;
   await waitForRestart(result.version,label,progress);
  }catch(error){notify(error.message,'error');working=false;state=await api('config/updates').catch(()=>state);if(element.isConnected)render();}
 }
 async function waitForRestart(expected,label,progress){
  for(let attempt=0;attempt<90;attempt++){
   await new Promise(r=>setTimeout(r,2000));if(!element.isConnected)return;
   try{const result=await api('config/updates');if(result.version===expected&&result.status==='installed'){label.textContent='Versão '+expected+' instalada. Recarregando a plataforma…';progress.value=1;progress.max=1;window.location.reload();return;}if(result.status==='failed')throw Object.assign(Error(result.error||'A atualização foi revertida.'),{updateFailed:true});}catch(error){if(error.updateFailed)throw error;}
  }
  throw Error('A reinicialização está demorando. Recarregue a página e confira a versão; se necessário, verifique a tarefa Servitec-Sistema e o log no servidor.');
 }
 render();
 const refreshTimer=setInterval(async()=>{
  if(!element.isConnected){clearInterval(refreshTimer);return;}
  if(working||document.hidden||element.contains(document.activeElement)||element.querySelector('details[open]')||element.querySelector('#update-password').value||element.querySelector('#update-file').files.length)return;
  try{const next=await api('config/updates');if(!working&&element.isConnected&&!element.contains(document.activeElement)&&!element.querySelector('#update-password').value){state=next;render();}}catch{}
 },60000);
 if(!state.github.lastCheck&&!state.busy&&!['pending','starting'].includes(state.status))check();
}
