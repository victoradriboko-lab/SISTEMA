import {paginateElements} from './list-pages.js';
let nextId=0;
export function mountTabs(container,items,{active,onChange=()=>{}}={}){
 const prefix='workspace-'+(++nextId),bar=document.createElement('div');bar.className='workspace-pages';bar.setAttribute('role','group');bar.setAttribute('aria-label','Paginação da tela');
 const label=document.createElement('label');label.textContent='Página';const select=document.createElement('select');select.setAttribute('aria-label','Página do cadastro');select.dataset.pageSelect='';label.append(select);
 const previous=document.createElement('button'),next=document.createElement('button'),counter=document.createElement('span');previous.type=next.type='button';previous.textContent='← Anterior';next.textContent='Próximo →';previous.dataset.step='previous';next.dataset.step='next';counter.setAttribute('role','status');counter.className='workspace-page-count';bar.append(label,counter,previous,next);
 items.forEach((item,index)=>{const option=document.createElement('option');option.value=item.key;option.textContent=item.label;select.append(option);if(!item.panel.id)item.panel.id=prefix+'-pane-'+index;item.panel.setAttribute('role','region');item.panel.setAttribute('aria-label',item.label);item.panel.classList.add('workspace-pane');});
 const available=()=>items.filter(item=>!item.panel.dataset.equipmentPage||container.elements?.billingModel?.value!=='fixed');
 const activate=key=>{const pages=available();if(!pages.some(item=>item.key===key))key=pages[0]?.key;const index=pages.findIndex(item=>item.key===key);for(const item of items){item.panel.hidden=item.key!==key;select.querySelector(`option[value="${item.key}"]`).hidden=!pages.includes(item);}select.value=key;container.dataset.activeTab=key;previous.disabled=index<=0;next.disabled=index>=pages.length-1;counter.textContent=`Página ${index+1} de ${pages.length}`;onChange(key);};
 const move=delta=>{const pages=available(),index=pages.findIndex(item=>item.key===container.dataset.activeTab);activate(pages[Math.max(0,Math.min(pages.length-1,index+delta))]?.key);};
 select.onchange=()=>activate(select.value);previous.onclick=()=>move(-1);next.onclick=()=>move(1);container.prepend(bar);container.activatePage=activate;activate(active||items[0]?.key);
 container.addEventListener('invalid',event=>{const item=items.find(item=>item.panel.contains(event.target));if(item)activate(item.key);},true);
 container.addEventListener('change',event=>{if(event.target.name==='billingModel')activate(container.dataset.activeTab);});return activate;
}
export function organizeCompanyForm(form){
 form.querySelector(':scope > h2')?.remove();form.setAttribute('aria-label','Cadastro da empresa');
 const fieldset=form.querySelector('fieldset'),definitions=[['profile','Dados cadastrais'],['contacts','Contatos'],['units','Unidades e filiais'],['documents','Documentação'],['contract','Modelo do contrato'],['equipment','Quantidades e preços'],['billing','Valores e condições'],['calendar','Horário de atendimento'],['sla-standard','SLA: baixa e média'],['sla-priority','SLA: alta e crítica']],panels=new Map(definitions.map(([key])=>[key,document.createElement('div')])),footer=document.createElement('div');footer.className='workspace-savebar';
 const category=name=>['cnpj','address'].includes(name)?'profile':['contact','phone','email','technician'].includes(name)?'contacts':name==='sites'?'units':['documents','notes'].includes(name)?'documents':['contractName','billingModel'].includes(name)?'contract':/^(computer|notebook|server)(Count|Price)$/.test(name)?'equipment':['complexityNote','monthly','includedHours','hourCost'].includes(name)?'billing':['enabled','calendar','zone','startHour','endHour'].includes(name)?'calendar':/^(response|resolution)[01]$/.test(name)?'sla-standard':/^(response|resolution)[23]$/.test(name)?'sla-priority':null;
 for(const node of [...fieldset.children]){
  if(node.tagName==='BUTTON'){footer.append(node);continue;}if(node.tagName==='H2')continue;
  const name=node.querySelector('[name]')?.name,key=category(name||'');if(key){panels.get(key).append(node);continue;}
  if(node.id==='billing-breakdown'){panels.get('billing').append(node);continue;}
  if(node.textContent.startsWith('Valores padrão:')){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Valores padrão e cálculo';details.append(summary,node);panels.get('contract').append(details);continue;}
  if(node.textContent.startsWith('Metas em minutos')){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Como funcionam os prazos';details.append(summary,node);panels.get('calendar').append(details);}
 }
 fieldset.replaceChildren();
 const items=definitions.filter(([key])=>panels.get(key).childElementCount).map(([key,label])=>{const panel=panels.get(key);panel.className='company-fields';if(key==='equipment'){panel.dataset.equipmentPage='true';panel.classList.add('equipment-page');}fieldset.append(panel);return {key,label,panel};});
 mountTabs(form,items);if(footer.childElementCount){footer.querySelector('button').textContent='Salvar todas as alterações';const status=document.createElement('span');status.className='workspace-draft';status.setAttribute('role','status');status.textContent='Salva o cadastro completo.';footer.append(status);form.insertBefore(footer,fieldset);for(const event of ['input','change'])form.addEventListener(event,event=>{if(event.target.matches('[data-page-select]'))return;form.dataset.dirty='true';status.textContent='Alterações não salvas';});}
}
export function organizeTicket(root,active){
 const panels=[...root.children],history=panels[1],attachments=document.createElement('div');attachments.className='panel';const heading=history.querySelector('h3');if(heading){let node=heading;while(node){const next=node.nextSibling;attachments.append(node);node=next;}}
 const items=[{key:'history',label:'Histórico',panel:history}];const reply=root.querySelector('#desk-message'),files=root.querySelector('#desk-file'),work=root.querySelector('#desk-work');
 if(reply)items.push({key:'reply',label:'Mensagens e notas',panel:reply});
 if(files)attachments.append(files);items.push({key:'files',label:'Anexos',panel:attachments});
 const list=panels.at(-1),hasWorkList=list?.querySelector('h2')?.textContent==='Horas registradas';if(work||hasWorkList){const panel=document.createElement('div');if(work)panel.append(work);if(hasWorkList&&list!==work)panel.append(list);items.push({key:'work',label:'Horas e despesas',panel});}
 const holder=document.createElement('div');holder.className='ticket-workspace';items.forEach(item=>holder.append(item.panel));root.append(holder);mountTabs(holder,items,{active});paginateElements(history,[...history.querySelectorAll('article')],{pageSize:5});paginateElements(attachments,[...attachments.querySelectorAll(':scope > p')]);if(hasWorkList)paginateElements(list,[...list.querySelectorAll(':scope > p')]);
}
