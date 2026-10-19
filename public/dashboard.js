const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const online=(asset,now)=>!!asset.last_seen&&now-Date.parse(asset.last_seen)<120000;
const parse=value=>{try{return typeof value==='string'?JSON.parse(value):value;}catch{return null;}};
const link=(page,label,extra='')=>`<button data-dashboard-page="${page}" ${extra}>${label} →</button>`;
const empty=message=>`<p class="dashboard-empty">${message}</p>`;
export function dashboardSummary({tickets=[],assets=[],clients=[],permissions=[],now=Date.now()}){
 const allowed=key=>permissions.includes(key),inventory=allowed('assets.read'),monitor=inventory&&allowed('monitor.read'),support=allowed('tickets.read');
 const fleet=inventory?assets:[],requests=support?tickets:[],companies=inventory?clients:[];
 const connected=monitor?fleet.filter(a=>online(a,now)):[],offline=monitor?fleet.filter(a=>a.last_seen&&!online(a,now)):[],waiting=monitor?fleet.filter(a=>!a.last_seen):[];
 const critical=connected.flatMap(a=>{const m=parse(a.metrics),reasons=[];if(m?.cpuPercent>=90)reasons.push(`CPU ${Math.round(m.cpuPercent)}%`);if(m?.memory?.usedPercent>=90)reasons.push(`Memória ${Math.round(m.memory.usedPercent)}%`);for(const disk of m?.disks||[])if(disk.usedPercent>=90)reasons.push(`Disco ${disk.name}: ${Math.round(disk.usedPercent)}%`);return reasons.length?[{...a,reasons}]:[];});
 const open=requests.filter(t=>t.status==='Aberto').length,progress=requests.filter(t=>t.status==='Em atendimento').length,resolved=requests.filter(t=>t.status==='Resolvido').length;
 const urgent=requests.filter(t=>t.status!=='Resolvido'&&(t.priority==='Crítica'||t.priority==='Alta'));
 const delayed=requests.filter(t=>t.status!=='Resolvido'&&['warning','critical'].includes(t.attention));
 const duplicateGroups=new Set(fleet.filter(a=>a.duplicate_of).map(a=>`${a.client_id}:${a.name.trim().toLowerCase()}`)).size;
 const byClient=companies.map(c=>{const machines=fleet.filter(a=>a.client_id===c.id);return {...c,total:machines.length,online:monitor?machines.filter(a=>online(a,now)).length:null};}).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'pt-BR'));
 return {inventory,monitor,support,fleet,companies,connected,offline,waiting,critical,open,progress,resolved,urgent,delayed,duplicateGroups,byClient,unassigned:fleet.filter(a=>!a.client_id).length,requests};
}

const option=(value,label,selected)=>`<option value="${escape(value)}" ${String(value)===String(selected)?'selected':''}>${escape(label)}</option>`;
export function renderDashboard({user,tickets=[],assets=[],clients=[],filters={},now=Date.now()}){
 const permissions=user?.permissions||[],support=permissions.includes('tickets.read'),inventory=permissions.includes('assets.read');
 const visibleTickets=tickets.filter(t=>(!filters.clientId||String(t.client_id)===filters.clientId)&&(!filters.priority||t.priority===filters.priority)&&(!filters.operatorId||String(t.operator_id)===filters.operatorId));
 const visibleAssets=assets.filter(a=>!filters.clientId||String(a.client_id)===filters.clientId);
 const s=dashboardSummary({tickets:visibleTickets,assets:visibleAssets,clients:filters.clientId?clients.filter(c=>String(c.id)===filters.clientId):clients,permissions,now});
 const active=s.requests.filter(t=>t.status!=='Resolvido'),withSla=active.filter(t=>t.sla),overdue=withSla.filter(t=>t.sla.state==='overdue');
 const near=withSla.filter(t=>{const due=!t.sla.responded_at?t.sla.response_due:!t.sla.resolved_at?t.sla.resolution_due:null;return due&&Date.parse(due)>=now&&Date.parse(due)-now<=3600000;});
 const operators=[...new Map(tickets.filter(t=>t.operator_id).map(t=>[t.operator_id,t.operator_name||`Operador #${t.operator_id}`])).entries()];
 const companies=inventory?clients:[...new Map(tickets.filter(t=>t.client_id).map(t=>[t.client_id,{id:t.client_id,name:t.client_name||`Cliente #${t.client_id}`}])).values()];
 const tile=(label,count,color,icon,page,allowed,description)=>{const tag=allowed?'button':'div';return `<${tag} class="ops-tile ops-${color}" ${allowed?`type="button" data-dashboard-page="${page}" title="${escape(description)} · Abrir módulo"`:'aria-disabled="true"'}><span class="ops-tile-label">${label}</span><span class="ops-tile-icon" aria-hidden="true">${icon}</span><strong>${allowed?count:'—'}</strong><small>${allowed?description:'Sem permissão para consultar'}</small></${tag}>`;};
 const group=(title,tiles)=>`<section class="ops-group" aria-label="${title}"><h2>${title}</h2><div class="ops-tiles">${tiles.join('')}</div></section>`;
 const resourceCount=test=>s.connected.filter(a=>test(parse(a.metrics))).length;
 return `<div class="ops-dashboard"><div class="ops-toolbar"><div><span class="eyebrow">DASHBOARDS · TICKETS · GERAL</span><p>Olá, ${escape(user?.name||'usuário')}. <time datetime="${new Date(now).toISOString()}">Atualizado às ${new Date(now).toLocaleTimeString('pt-BR')}</time></p></div><div class="ops-filters" role="group" aria-label="Filtros do dashboard">${support||inventory?`<label>Cliente<select data-dashboard-filter="clientId">${option('','Todos os clientes',filters.clientId)}${companies.map(c=>option(c.id,c.name,filters.clientId)).join('')}</select></label>`:''}${support?`<label>Prioridade<select data-dashboard-filter="priority">${option('','Todas',filters.priority)}${['Baixa','Média','Alta','Crítica'].map(p=>option(p,p,filters.priority)).join('')}</select></label><label>Operador<select data-dashboard-filter="operatorId">${option('','Todos',filters.operatorId)}${operators.map(([id,name])=>option(id,name,filters.operatorId)).join('')}</select></label>`:''}${support||inventory?'<button type="button" id="dashboard-clear-filters">Limpar filtros</button>':''}</div></div>
 ${group('Chamados',[
 tile('A fazer',s.open,'red','⚑','tickets',s.support,'Chamados abertos aguardando atendimento'),
 tile('Em atendimento',s.progress,'cyan','◉','tickets',s.support,'Chamados em atendimento'),
 tile('Abertos',active.length,'green','▤','tickets',s.support,'Total de chamados ainda não resolvidos'),
 tile('Meus',active.filter(t=>Number(t.operator_id)===Number(user?.id)).length,'blue','♙','tickets',s.support,'Chamados ativos atribuídos a você'),
 tile('Resolvidos',s.resolved,'neutral','✓','tickets',s.support,'Chamados resolvidos'),
 tile('Alta / crítica',s.urgent.length,'red','!','tickets',s.support,'Chamados ativos de prioridade alta ou crítica'),
 tile('Alertas de atraso',s.delayed.length,'yellow','◷','tickets',s.support,'Alertas conforme regras de atendimento')])}
 ${group('SLA',[
 tile('Estourados',overdue.length,'red','◴','tickets',s.support,'Chamados ativos com SLA vencido'),
 tile('Prestes a estourar',near.length,'yellow','◷','tickets',s.support,'Próxima meta vence em até uma hora'),
 tile('Sem SLA',active.filter(t=>!t.sla).length,'purple','◇','tickets',s.support,'Chamados ativos sem meta de contrato'),
 tile('Dentro do prazo',withSla.filter(t=>t.sla.state==='running').length,'green','✓','tickets',s.support,'Chamados ativos com SLA em andamento')])}
 ${group('Inventário',[
 tile('Dispositivos',s.fleet.length,'green','▣','assets',s.inventory,'Equipamentos cadastrados'),
 tile('Alertas',s.critical.length,'red','!','monitor',s.monitor,'Equipamentos online com CPU, memória ou disco a partir de 90%'),
 tile('Aguardando agente',s.waiting.length,'neutral','◌','monitor',s.monitor,'Equipamentos sem primeira comunicação'),
 tile('Online',s.connected.length,'cyan','◉','monitor',s.monitor,'Último contato há menos de dois minutos'),
 tile('Sem comunicação',s.offline.length,'red','⟳','monitor',s.monitor,'Equipamentos já conectados que estão offline')])}
 ${group('Monitoramento de recursos',[
 tile('CPU ≥ 90%',resourceCount(m=>m?.cpuPercent>=90),'red','⌁','monitor',s.monitor,'CPU elevada em equipamentos online'),
 tile('Memória ≥ 90%',resourceCount(m=>m?.memory?.usedPercent>=90),'yellow','▥','monitor',s.monitor,'Memória elevada em equipamentos online'),
 tile('Disco ≥ 90%',resourceCount(m=>m?.disks?.some(d=>d.usedPercent>=90)),'red','▰','monitor',s.monitor,'Ao menos um disco com ocupação elevada'),
 tile('Sem cliente',s.unassigned,'purple','◇','assets',s.inventory,'Equipamentos sem vínculo com uma empresa')])}
 <p class="ops-caption">Atualização automática a cada 10 segundos. Filtro de cliente aplicado a chamados e equipamentos; prioridade e operador aplicados aos chamados. Alertas de recursos consideram equipamentos online.</p>
 ${s.inventory?`<div class="ops-client-links"><span>Inventário por cliente</span>${s.byClient.map(c=>`<button type="button" data-dashboard-client="${c.id}">${escape(c.name)} <b>${c.total}</b></button>`).join('')||'<small>Nenhuma empresa cadastrada.</small>'}</div>`:''}</div>`;
}
