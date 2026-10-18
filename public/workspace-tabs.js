let nextId=0;
export function mountTabs(container,items,{active,onChange=()=>{}}={}){
 const prefix='workspace-'+(++nextId),bar=document.createElement('div');bar.className='workspace-tabs';bar.setAttribute('role','tablist');bar.setAttribute('aria-label','Seções da tela');
 const activate=key=>{if(!items.some(item=>item.key===key))key=items[0]?.key;for(const item of items){const selected=item.key===key;item.panel.hidden=!selected;const button=bar.querySelector(`[data-tab-key="${item.key}"]`);button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}container.dataset.activeTab=key;onChange(key);};
 items.forEach((item,index)=>{const button=document.createElement('button');button.type='button';button.textContent=item.label;button.dataset.tabKey=item.key;button.id=prefix+'-tab-'+index;button.setAttribute('role','tab');if(!item.panel.id)item.panel.id=prefix+'-pane-'+index;button.setAttribute('aria-controls',item.panel.id);item.panel.setAttribute('role','tabpanel');item.panel.setAttribute('aria-labelledby',button.id);item.panel.classList.add('workspace-pane');button.onclick=()=>activate(item.key);button.onkeydown=e=>{let target;if(e.key==='ArrowRight')target=(index+1)%items.length;if(e.key==='ArrowLeft')target=(index+items.length-1)%items.length;if(e.key==='Home')target=0;if(e.key==='End')target=items.length-1;if(target!==undefined){e.preventDefault();activate(items[target].key);bar.children[target].focus();}};bar.append(button);});
 container.prepend(bar);activate(active||items[0]?.key);container.addEventListener('invalid',event=>{const item=items.find(item=>item.panel.contains(event.target));if(item)activate(item.key);},true);return activate;
}
export function organizeCompanyForm(form){
 form.querySelector(':scope > h2')?.remove();form.setAttribute('aria-label','Cadastro da empresa');
 const fieldset=form.querySelector('fieldset'),panels=new Map(['profile','documents','billing','sla'].map(key=>[key,document.createElement('div')]));let current='profile';const footer=document.createElement('div');footer.className='workspace-savebar';
 for(const node of [...fieldset.children]){const name=node.querySelector('[name]')?.name;
  if(['sites','documents','notes'].includes(name))current='documents';
  if(node.tagName==='H2'||name==='contractName')current='billing';
  if(node.tagName==='H2'&&node.textContent==='Contrato e metas de SLA')continue;
  if(name==='enabled')current='sla';
  if(node.tagName==='BUTTON'){footer.append(node);continue;}
  panels.get(current).append(node);
 }
 const labels={profile:'Dados da empresa',documents:'Unidades e documentação',billing:'Contrato e equipamentos',sla:'SLA e atendimento'};
 const items=[...panels].filter(([,panel])=>panel.childElementCount).map(([key,panel])=>{panel.className='company-fields';fieldset.append(panel);return {key,label:labels[key],panel};});
 mountTabs(form,items);if(footer.childElementCount){footer.querySelector('button').textContent='Salvar todas as alterações';const status=document.createElement('span');status.className='workspace-draft';status.setAttribute('role','status');status.textContent='Todas as abas são salvas juntas.';footer.append(status);form.append(footer);form.addEventListener('input',()=>{form.dataset.dirty='true';status.textContent='Alterações não salvas';});form.addEventListener('change',()=>{form.dataset.dirty='true';status.textContent='Alterações não salvas';});}
}
export function organizeTicket(root,active){
 const panels=[...root.children],history=panels[1],attachments=document.createElement('div');attachments.className='panel';const heading=history.querySelector('h3');if(heading){let node=heading;while(node){const next=node.nextSibling;attachments.append(node);node=next;}}
 const items=[{key:'history',label:'Histórico',panel:history}];const reply=root.querySelector('#desk-message'),files=root.querySelector('#desk-file'),work=root.querySelector('#desk-work');
 if(reply)items.push({key:'reply',label:'Mensagens e notas',panel:reply});
 if(files)attachments.append(files);items.push({key:'files',label:'Anexos',panel:attachments});
 const list=panels.at(-1),hasWorkList=list?.querySelector('h2')?.textContent==='Horas registradas';if(work||hasWorkList){const panel=document.createElement('div');if(work)panel.append(work);if(hasWorkList&&list!==work)panel.append(list);items.push({key:'work',label:'Horas e despesas',panel});}
 const holder=document.createElement('div');holder.className='ticket-workspace';items.forEach(item=>holder.append(item.panel));root.append(holder);mountTabs(holder,items,{active});
}
