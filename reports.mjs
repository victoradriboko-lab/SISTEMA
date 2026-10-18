const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const date=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value>'9998-12-31')return false;const parsed=new Date(value+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;};
export function createReports({db,json,config}){
 if(!db.prepare('PRAGMA table_info(tickets)').all().some(c=>c.name==='client_id'))db.exec('ALTER TABLE tickets ADD COLUMN client_id INTEGER');
 if(!db.prepare('PRAGMA table_info(tickets)').all().some(c=>c.name==='operator_id'))db.exec('ALTER TABLE tickets ADD COLUMN operator_id INTEGER');
 if(!db.prepare('PRAGMA table_info(tickets)').all().some(c=>c.name==='service_type'))db.exec('ALTER TABLE tickets ADD COLUMN service_type TEXT');
 const canAssignOperator=id=>{const operator=db.prepare('SELECT role,active FROM users WHERE id=?').get(id);return !!operator?.active&&config.allowed(operator,'tickets.write');};
 db.exec('CREATE INDEX IF NOT EXISTS tickets_operator_created ON tickets(operator_id,created)');
 db.exec('CREATE INDEX IF NOT EXISTS tickets_client_created ON tickets(client_id,created)');
 async function handle(req,res,path,user){
  if(path==='/api/ticket-operators'&&req.method==='GET'){
   if(!config.allowed(user,'tickets.read')&&!config.allowed(user,'tickets.write'))fail('Sem permissão para consultar operadores',403);
   const assigned=new Set(db.prepare('SELECT DISTINCT operator_id FROM tickets WHERE operator_id IS NOT NULL').all().map(r=>r.operator_id));
   const operators=db.prepare('SELECT id,name,role,active FROM users ORDER BY name,id').all().map(o=>({id:o.id,name:o.name,assignable:!!o.active&&config.allowed(o,'tickets.write')})).filter(o=>o.assignable||assigned.has(o.id));
   json(res,200,operators);return true;
  }
  if(path==='/api/ticket-clients'&&req.method==='GET'){
   if(!config.allowed(user,'tickets.read')&&!config.allowed(user,'tickets.write'))fail('Sem permissão para consultar clientes dos chamados',403);
   json(res,200,db.prepare('SELECT id,name FROM clients ORDER BY name,id').all());return true;
  }
  if(path!=='/api/reports'||req.method!=='GET')return false;
  const p=new URL(req.url,'http://localhost').searchParams,type=p.get('type')||'tickets-client';
  const titles={'tickets-client':'Chamados por cliente','tickets-service':'Atendimentos internos e externos','tickets-operator':'Chamados por operador','tickets-month':'Chamados por mês','tickets-status':'Chamados por status','tickets-priority':'Chamados por prioridade','assets-client':'Equipamentos por cliente','assets-connection':'Situação dos agentes'};
  if(!titles[type])fail('Relatório inválido');
  const tickets=type.startsWith('tickets-'),monitor=config.allowed(user,'monitor.read');
  if(!config.allowed(user,tickets?'tickets.read':'assets.read')||type==='assets-connection'&&!monitor)fail('Sem permissão para consultar este relatório',403);
  const client=p.get('clientId')||'',from=p.get('from')||'',to=p.get('to')||'',status=p.get('status')||'',priority=p.get('priority')||'',operator=p.get('operatorId')||'',serviceType=p.get('serviceType')||'';
  if(client&&(!/^\d+$/.test(client)||!Number.isSafeInteger(Number(client))||Number(client)>0&&!db.prepare('SELECT id FROM clients WHERE id=?').get(Number(client))))fail('Cliente inválido');
  if(operator&&(!/^\d+$/.test(operator)||!Number.isSafeInteger(Number(operator))||Number(operator)>0&&!db.prepare('SELECT id FROM users WHERE id=?').get(Number(operator))))fail('Operador inválido');
  if((from&&!date(from))||(to&&!date(to))||from&&to&&from>to)fail('Informe um período válido: data inicial menor ou igual à final');
  if(status&&!['Aberto','Em atendimento','Resolvido'].includes(status)||priority&&!['Baixa','Média','Alta','Crítica'].includes(priority))fail('Status ou prioridade inválidos');
  if(serviceType&&!['Interno','Externo','unclassified'].includes(serviceType))fail('Tipo de atendimento inválido');
  const where=[],args=[];
  if(client){where.push('coalesce(a.client_id,0)=?');args.push(Number(client));}
  if(tickets&&serviceType){where.push(serviceType==='unclassified'?'a.service_type IS NULL':'a.service_type=?');if(serviceType!=='unclassified')args.push(serviceType);}
  if(tickets&&operator){where.push('coalesce(a.operator_id,0)=?');args.push(Number(operator));}
  if(tickets){if(from){where.push('a.created>=?');args.push(from+' 00:00:00');}if(to){where.push('a.created<?');args.push(new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString().slice(0,10)+' 00:00:00');}if(status){where.push('a.status=?');args.push(status);}if(priority){where.push('a.priority=?');args.push(priority);}}
  const sqlWhere=where.length?'WHERE '+where.join(' AND '):'';
  let columns,rows,total;
  if(tickets){
   const group=type==='tickets-service'?"coalesce(a.service_type,'Não informado')":type==='tickets-operator'?"coalesce(a.operator_id,0)":type==='tickets-client'?"coalesce(a.client_id,0)":type==='tickets-month'?"strftime('%Y-%m',a.created)":type==='tickets-status'?'a.status':'a.priority';
   const label=type==='tickets-operator'?"coalesce(u.name,'Sem operador')":type==='tickets-client'?"coalesce(c.name,'Sem cliente')":group;
   columns=[{key:'label',label:type==='tickets-service'?'Tipo de atendimento':type==='tickets-operator'?'Operador':type==='tickets-client'?'Cliente':type==='tickets-month'?'Mês (ano-mês)':type==='tickets-status'?'Status':'Prioridade'},...(type==='tickets-operator'?[{key:'operatorId',label:'Código do operador'}]:[]),{key:'total',label:'Total'},{key:'open',label:'Abertos'},{key:'progress',label:'Em atendimento'},{key:'resolved',label:'Resolvidos'}];
   rows=db.prepare(`SELECT ${label} AS label,${type==='tickets-operator'?'coalesce(a.operator_id,0) AS operatorId,':''}count(*) AS total,sum(a.status='Aberto') AS open,sum(a.status='Em atendimento') AS progress,sum(a.status='Resolvido') AS resolved FROM tickets a LEFT JOIN clients c ON c.id=a.client_id LEFT JOIN users u ON u.id=a.operator_id ${sqlWhere} GROUP BY ${group} ORDER BY ${type==='tickets-month'?'label ASC':'total DESC,label ASC'}`).all(...args);
   total=rows.reduce((n,r)=>n+r.total,0);
   if(type==='tickets-service'){columns.push({key:'share',label:'Participação (%)'});for(const row of rows)row.share=total?Math.round(row.total/total*1000)/10:0;}

  }else{
   const assets=db.prepare(`SELECT a.client_id,c.name AS client_name,a.last_seen FROM assets a LEFT JOIN clients c ON c.id=a.client_id ${sqlWhere}`).all(...args),now=Date.now();
   const online=a=>a.last_seen&&now-Date.parse(a.last_seen)<120000;
   if(type==='assets-connection'){
    columns=[{key:'label',label:'Situação'},{key:'total',label:'Equipamentos'}];
    rows=[{label:'Online',total:assets.filter(online).length},{label:'Sem comunicação',total:assets.filter(a=>a.last_seen&&!online(a)).length},{label:'Aguardando agente',total:assets.filter(a=>!a.last_seen).length}];
   }else{
    columns=[{key:'label',label:'Cliente'},{key:'total',label:'Equipamentos'},...(monitor?[{key:'online',label:'Online'},{key:'offline',label:'Sem comunicação'},{key:'waiting',label:'Aguardando agente'}]:[])];
    const groups=new Map();for(const a of assets){const key=a.client_id||0;if(!groups.has(key))groups.set(key,{label:a.client_name||'Sem cliente',total:0,...(monitor?{online:0,offline:0,waiting:0}:{})});const row=groups.get(key);row.total++;if(monitor)row[online(a)?'online':a.last_seen?'offline':'waiting']++;}
    rows=[...groups.values()].sort((a,b)=>b.total-a.total||a.label.localeCompare(b.label,'pt-BR'));
   }
   total=assets.length;
  }
  json(res,200,{title:titles[type],type,columns,rows,total,generatedAt:new Date().toISOString(),filters:{clientId:client,...(tickets?{from,to,status,priority,operatorId:operator,serviceType}:{})}});return true;
 }
 return {handle,canAssignOperator};
}
