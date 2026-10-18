import {showMailSettings} from './mail-settings.js';
import {showBackupSettings} from './backup-settings.js';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fields={name:'Nome fantasia',legalName:'Razão social',cnpj:'CNPJ',registration:'Inscrição estadual',address:'Endereço',city:'Cidade / UF',phone:'Telefone',email:'E-mail',site:'Site'};
const actionNames={'users.setup':'Cadastro inicial','auth.login':'Login','auth.logout':'Saída','auth.failed':'Login recusado','users.password':'Troca de senha','users.create':'Novo usuário','users.update':'Edição de usuário','roles.create':'Novo perfil','permissions.update':'Permissões','rules.update':'Regras de atendimento','company.update':'Dados da empresa','system.backup':'Backup','system.backup.schedule':'Agendamento de backup','system.backup.complete':'Backup completo','system.backup.failed':'Falha de backup','assets.import':'Importação','assets.token':'Token de agente','assets.create':'Novo equipamento','mail.config':'Configuração de e-mail','mail.sync':'Sincronização de e-mail','mail.import':'Importação de e-mail','mail.ticket':'Chamado por e-mail','mail.sender.approve':'Remetente aprovado','mail.sender.update':'Vínculo de remetente','mail.reject':'E-mail rejeitado','tickets.create':'Novo chamado','tickets.status':'Status de chamado'};
export function createSettings({api,notify,onCompany,onRoles,onUsers}){
  let section='permissions',host,user,sequence=0;
  const has=p=>user.permissions.includes(p);
  function available(){return [['permissions','Permissões','permissions.manage'],['rules','Atendimento','rules.manage'],['company','Empresa','company.manage'],['imports','Importações','imports.manage'],['activity','Atividades','audit.read'],['mail','E-mail','system.manage'],['backups','Backups','system.manage'],['system','Sistema','system.manage']].filter(([, ,p])=>has(p));}
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function bindForm(id,action){host.querySelector(id).onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{await action(e);}catch(error){notify(error.message,'error');}finally{button.disabled=false;}};}
  function currentBody(){return host.querySelector(`[data-settings-pane="${section}"]`);}
  async function show(element,me,refresh=true){
    const reuse=host===element&&user?.id===me.id&&element.isConnected&&element.querySelector('[data-settings-pane]');host=element;user=me;const tabs=available();if(!tabs.some(([key])=>key===section))section=tabs[0]?.[0];if(!section){host.textContent='Nenhuma configuração disponível para seu perfil.';return;}
    const id=++sequence;
    if(!reuse){host.innerHTML=`<nav class="settings-tabs" aria-label="Configurações">${has('users.manage')?'<button id="settings-users">Usuários</button>':''}${tabs.map(([key,label])=>`<button data-section="${key}">${label}</button>`).join('')}</nav>${tabs.map(([key])=>`<div class="settings-body" data-settings-pane="${key}" hidden></div>`).join('')}`;
      host.querySelector('#settings-users')?.addEventListener('click',onUsers);
      host.querySelectorAll('[data-section]').forEach(button=>button.onclick=()=>{section=button.dataset.section;notify('');show(host,user,false);});
    }
    host.querySelectorAll('[data-section]').forEach(button=>{const selected=button.dataset.section===section;button.classList.toggle('active',selected);if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
    host.querySelectorAll('[data-settings-pane]').forEach(pane=>pane.hidden=pane.dataset.settingsPane!==section);
    const pane=currentBody();if(!refresh&&pane.dataset.loaded==='true')return;pane.textContent='Carregando…';
    try{
      if(section==='permissions')await permissions(id);
      if(section==='rules')await rules(id);
      if(section==='company')await company(id);
      if(section==='imports')imports();
      if(section==='activity')await activity(id);
      if(section==='mail')await showMailSettings(pane,{api,notify});
      if(section==='backups')await showBackupSettings(pane,{api,notify});
      if(section==='system')await system(id);
      if(id===sequence)pane.dataset.loaded='true';
    }catch(error){if(id===sequence){pane.textContent=error.message;notify(error.message,'error');}}
  }
  function target(id,html){if(id!==sequence)return false;currentBody().innerHTML=html;return true;}
  async function permissions(id){
    const data=await api('config/permissions');
    if(!target(id,`<div class="panel"><h2>Perfis e permissões</h2><p>Marque o que cada perfil pode fazer e salve. As permissões de administração são fixas. A alteração encerra as sessões dos perfis editados.</p><details><summary>Criar novo perfil</summary><form id="new-role" class="inline-form"><label for="role-name">Nome do perfil</label><input id="role-name" name="name" maxlength="80" required><button class="primary">Criar perfil</button></form></details></div><form id="permissions-form"><div class="panel matrix-panel"><table class="permission-matrix"><thead><tr><th>Permissão</th>${data.roles.map(r=>`<th>${escape(r.name)}<small>${r.users} usuário(s)</small></th>`).join('')}</tr></thead><tbody>${data.catalog.map(p=>`<tr><th scope="row">${escape(p.label)}${p.locked?' <span title="Exclusiva do administrador">🔒</span>':''}<small>${escape(p.group)}</small></th>${data.roles.map(r=>`<td><input class="permission-check" type="checkbox" aria-label="${escape(p.label)} — ${escape(r.name)}" data-role="${r.id}" data-permission="${p.key}" ${r.permissions.includes(p.key)?'checked':''} ${r.id==='admin'||p.locked?'disabled':''}></td>`).join('')}</tr>`).join('')}</tbody></table></div><button class="primary settings-save">Salvar permissões</button></form>`))return;
    const dependencies={'tickets.write':'tickets.read','assets.write':'assets.read','monitor.read':'assets.read','imports.manage':'assets.write'};
    const original=new Map(data.roles.map(r=>[r.id,[...r.permissions].sort().join(',')]));
    host.querySelectorAll('[data-permission]').forEach(box=>box.onchange=()=>{
      const find=key=>host.querySelector(`[data-role="${box.dataset.role}"][data-permission="${key}"]`);
      if(box.checked){let key=box.dataset.permission;while(dependencies[key]){key=dependencies[key];find(key).checked=true;}}
      else {let changed=true;while(changed){changed=false;for(const [key,dependency]of Object.entries(dependencies))if(find(key).checked&&!find(dependency).checked){find(key).checked=false;changed=true;}}}
    });
    bindForm('#permissions-form',async()=>{
      const roles=data.roles.filter(r=>r.id!=='admin').map(r=>({id:r.id,permissions:[...host.querySelectorAll(`[data-role="${r.id}"]:checked`)].map(b=>b.dataset.permission)})).filter(r=>[...r.permissions].sort().join(',')!==original.get(r.id));
      if(!roles.length){notify('Nenhuma permissão foi alterada.');return;}
      await api('config/permissions','PUT',{roles});await onRoles();await show(host,user);notify('Permissões salvas. Os usuários afetados precisam entrar novamente.');
    });
    bindForm('#new-role',async e=>{await api('config/roles','POST',{name:new FormData(e.target).get('name')});await onRoles();await show(host,user);notify('Perfil criado sem permissões. Selecione os acessos e salve.');});
  }
  async function rules(id){
    const data=await api('config/rules');if(!target(id,`<form id="rules-form" class="panel"><h2>Alertas de chamados parados</h2><p>Destaque chamados que permanecem na mesma situação. A contagem reinicia quando o status muda. Chamados resolvidos não recebem alerta.</p><div class="form-grid"><div><label for="warning-days">Amarelo a partir de (dias)</label><input id="warning-days" name="warningDays" type="number" min="1" max="364" step="1" required value="${data.warningDays}"></div><div><label for="critical-days">Vermelho a partir de (dias)</label><input id="critical-days" name="criticalDays" type="number" min="2" max="365" step="1" required value="${data.criticalDays}"></div></div><p>Nos chamados antigos, a contagem inicial usa a data de criação. Estes alertas são visuais e não enviam e-mail.</p><button class="primary">Salvar regras</button></form>`))return;
    bindForm('#rules-form',async e=>{const values=Object.fromEntries(new FormData(e.target));await api('config/rules','PUT',{warningDays:Number(values.warningDays),criticalDays:Number(values.criticalDays)});notify('Regras de atendimento salvas.');});
  }
  async function company(id){
    const data=await api('config/company');
    if(!target(id,`<form id="company-form" class="panel"><h2>Dados da empresa</h2><p>O nome fantasia aparece no cabeçalho e o logotipo no menu. O nome da plataforma é Sistema Informática SERVITEC VSA.</p><div class="form-grid">${Object.entries(fields).map(([key,label])=>`<div><label for="company-${key}">${label}</label><input id="company-${key}" name="${key}" type="${key==='email'?'email':key==='site'?'url':'text'}" maxlength="500" ${key==='name'?'required':''} value="${escape(data[key])}"></div>`).join('')}</div><label for="company-logo">Logotipo (PNG, JPEG ou WebP, até 256 KB)</label>${data.hasLogo?'<img class="logo-preview" src="/brand-logo" alt="Logotipo atual"><label class="check-label"><input type="checkbox" name="removeLogo"> Remover logotipo atual</label>':''}<input id="company-logo" type="file" accept="image/png,image/jpeg,image/webp"><button class="primary">Salvar dados da empresa</button></form>`))return;
    bindForm('#company-form',async e=>{
      const values=Object.fromEntries(new FormData(e.target));values.removeLogo=values.removeLogo==='on';
      const file=host.querySelector('#company-logo').files[0];
      if(file){if(file.size>256*1024)throw Error('O logotipo deve ter até 256 KB');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);values.logo={type:file.type,data:btoa(binary)};}
      await api('config/company','PUT',values);await onCompany();await show(host,user);notify('Dados da empresa salvos.');
    });
  }
  function imports(){
    currentBody().innerHTML=`<div class="panel"><h2>Importar equipamentos</h2><p>Selecione um CSV UTF-8 com cabeçalhos <code>codigo;nome;responsavel;sistema</code>. Código e nome são obrigatórios. Códigos existentes são atualizados; o mesmo arquivo não duplica equipamentos. Os registros antigos sem código são preservados.</p><p>Até 1.000 equipamentos e 512 KB por arquivo. Revise a prévia antes de confirmar. Campos opcionais ausentes mantêm os valores existentes; campos vazios no CSV limpam esses valores.</p><button id="csv-template">Baixar modelo CSV</button><form id="csv-form"><label for="csv-file">Arquivo CSV</label><input id="csv-file" type="file" accept=".csv,text/csv" required><button class="primary">Visualizar importação</button></form></div><div id="import-preview"></div>`;
    host.querySelector('#csv-template').onclick=()=>download(new Blob(['\uFEFFcodigo;nome;responsavel;sistema\r\nTI-001;Computador recepção;Equipe TI;Windows 11\r\n'],{type:'text/csv;charset=utf-8'}),'modelo-equipamentos.csv');
    let csv='';host.querySelector('#csv-file').onchange=()=>{csv='';host.querySelector('#import-preview').innerHTML='';};
    bindForm('#csv-form',async()=>{
      const file=host.querySelector('#csv-file').files[0];if(!file||file.size>512*1024)throw Error('Escolha um CSV de até 512 KB');
      csv=await file.text();const preview=await api('import/assets/preview','POST',{csv});
      host.querySelector('#import-preview').innerHTML=`<div class="panel"><h2>Prévia da importação</h2><p>${preview.total} equipamento(s): ${preview.counts.create} novo(s), ${preview.counts.update} atualizado(s), ${preview.counts.unchanged} sem alteração. Exibindo até 20 linhas.</p><table><thead><tr><th>Código</th><th>Equipamento</th><th>Responsável</th><th>Sistema</th><th>Ação</th></tr></thead><tbody>${preview.rows.map(r=>`<tr><td>${escape(r.code)}</td><td>${escape(r.name)}</td><td>${escape(r.owner??'Manter existente')}</td><td>${escape(r.os??'Manter existente')}</td><td>${({create:'Cadastrar',update:'Atualizar',unchanged:'Manter'})[r.operation]}</td></tr>`).join('')}</tbody></table><button class="primary settings-save" id="confirm-import">Confirmar importação</button></div>`;
      host.querySelector('#confirm-import').onclick=async e=>{e.target.disabled=true;try{const result=await api('import/assets','POST',{csv,confirm:true});host.querySelector('#import-preview').innerHTML='';notify(`Importação concluída: ${result.counts.create} novo(s), ${result.counts.update} atualizado(s), ${result.counts.unchanged} sem alteração.`);}catch(error){notify(error.message,'error');e.target.disabled=false;}};
    });
  }
  async function activity(id){
    const rows=await api('config/activity');if(!target(id,'<div class="panel"><h2>Histórico de atividades</h2><p>Logins, alterações de cadastro, permissões, chamados, importações e backups. Horários convertidos para seu fuso local.</p><div id="activity-table"></div><button id="older-activity">Carregar anteriores</button></div>'))return;
    let all=rows;
    function render(){host.querySelector('#activity-table').innerHTML=all.length?`<table><thead><tr><th>Quando</th><th>Usuário</th><th>Atividade</th><th>Descrição</th></tr></thead><tbody>${all.map(r=>`<tr><td>${escape(new Date(r.created.replace(' ','T')+'Z').toLocaleString('pt-BR'))}</td><td>${escape(r.actor_name)}</td><td>${escape(actionNames[r.action]||r.action)}</td><td>${escape(r.detail)}</td></tr>`).join('')}</tbody></table>`:'<p>Nenhuma atividade registrada.</p>';host.querySelector('#older-activity').hidden=rows.length<100;}
    render();host.querySelector('#older-activity').onclick=async e=>{e.target.disabled=true;try{const older=await api('config/activity?before='+all.at(-1).id);all=all.concat(older);render();e.target.hidden=older.length<100;}catch(error){notify(error.message,'error');}finally{e.target.disabled=false;}};
  }
  async function system(id){
    const data=await api('config/system');if(!target(id,`<div class="panel"><h2>Versão instalada</h2><div class="system-facts"><p>Versão <strong>${escape(data.version)}</strong></p><p>Revisão <code>${escape(data.revision)}</code></p><p>Node.js <strong>${escape(data.node)}</strong></p></div><p>${data.counts.users} usuário(s), ${data.counts.tickets} chamado(s) e ${data.counts.assets} equipamento(s).</p></div><form id="backup-form" class="panel"><h2>Backup do banco</h2><p>Baixe uma cópia consistente dos dados, incluindo usuários, configurações e tokens dos agentes. Guarde em local seguro. As sessões de login não são incluídas no backup.</p><label for="backup-password">Confirme sua senha de administrador</label><input id="backup-password" type="password" autocomplete="current-password" maxlength="256" required><button class="primary">Baixar backup</button></form><div class="panel"><h2>Atualização pelo GitHub</h2><p>Mantenha o procedimento atual: pare a tarefa Servitec-Sistema, faça backup da pasta data, atualize com Pull no GitHub Desktop (ou git pull --ff-only) e inicie a tarefa novamente. Depois use Ctrl+F5 no navegador.</p><p>O backup acima contém o banco, não os arquivos de código. Para voltar a uma versão anterior, preserve o backup completo antes de atualizar e consulte o procedimento no README. Esta tela não instala arquivos de atualização enviados por terceiros.</p></div>`))return;
    bindForm('#backup-form',async e=>{
      const input=host.querySelector('#backup-password');const password=input.value;input.value='';
      const response=await fetch('/api/config/backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
      if(!response.ok)throw Error((await response.json()).error);
      download(await response.blob(),`sistema-backup-${new Date().toISOString().slice(0,10)}.sqlite`);notify('Backup baixado. Guarde o arquivo em local seguro.');
    });
  }
  return {show,showMail(element,me){section='mail';return show(element,me);}};
}
