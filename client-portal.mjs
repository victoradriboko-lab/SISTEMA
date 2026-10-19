import {ensureAssetArchive,assetArchive} from './asset-archive.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const validDate=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value>'9998-12-31')return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;};
export function createClientPortal({db,json,config}){
 ensureAssetArchive(db);
 const fields='t.id,t.title,t.description,t.priority,t.status,t.created,t.status_since,t.service_type,u.name AS operator_name';
 function companyScope(req,user){
  if(!Number.isSafeInteger(user.client_id)||!db.prepare('SELECT id FROM clients WHERE id=?').get(user.client_id))fail('Acesso sem empresa válida. Solicite a revisão ao administrador.',403);
  const p=new URL(req.url,'http://localhost').searchParams;
  if(p.has('clientId')&&p.get('clientId')!==String(user.client_id))fail('Você só pode consultar a empresa vinculada ao seu acesso',403);
  return p;
 }
 function scope(req,user){
  const p=companyScope(req,user);
  const from=p.get('from')||'',to=p.get('to')||'',status=p.get('status')||'',search=p.get('search')||'';
  if(from&&!validDate(from)||to&&!validDate(to)||from&&to&&from>to)fail('Período inválido');
  if(status&&!['Aberto','Em atendimento','Resolvido'].includes(status)||search.length>100)fail('Filtro inválido');
  const conditions=['t.client_id=?'],args=[user.client_id];
  if(from){conditions.push('t.created>=?');args.push(from+' 00:00:00');}if(to){conditions.push('t.created<?');args.push(new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString().slice(0,10)+' 00:00:00');}
  if(status){conditions.push('t.status=?');args.push(status);}if(search){conditions.push('(instr(lower(t.title),lower(?))>0 OR instr(lower(coalesce(t.description,\'\')),lower(?))>0)');args.push(search,search);}
  return {where:'WHERE '+conditions.join(' AND '),args,filters:{from,to,status,search}};
 }
 async function handle(req,res,path,user){
  // Esta barreira é chamada antes de qualquer API interna para acessos de cliente.
  if(req.method!=='GET')fail('O acesso do cliente é somente de consulta',403);
  if(!['/api/portal/overview','/api/portal/tickets','/api/portal/assets'].includes(path)&&!/^\/api\/portal\/tickets\/\d+$/.test(path))fail('Esta área não está disponível no portal do cliente',403);
  if(path==='/api/portal/assets'){
   const p=companyScope(req,user),search=p.get('search')||'',status=p.get('status')||'',raw=p.get('page')||'1';
   if(search.length>100||!['','online','offline','pending'].includes(status))fail('Filtro inválido');
   if(!/^\d+$/.test(raw)||Number(raw)<1||Number(raw)>1000000)fail('Página inválida');
   const now=new Date(),cutoff=new Date(now.getTime()-120000).toISOString();
   const online="(a.last_seen IS NOT NULL AND julianday(a.last_seen)>=julianday(?))";
   const conditions=['a.client_id=?','NOT EXISTS (SELECT 1 FROM asset_archive ar WHERE ar.asset_id=a.id)'],args=[user.client_id];
   if(search){conditions.push("(instr(lower(a.name),lower(?))>0 OR instr(lower(coalesce(a.owner,'')),lower(?))>0 OR instr(lower(coalesce(a.code,'')),lower(?))>0 OR instr(lower(coalesce(a.os,'')),lower(?))>0)");args.push(search,search,search,search);}
   if(status==='online'){conditions.push(online);args.push(cutoff);}
   if(status==='offline'){conditions.push('a.last_seen IS NOT NULL AND NOT '+online);args.push(cutoff);}
   if(status==='pending')conditions.push('a.last_seen IS NULL');
   const where='WHERE '+conditions.join(' AND '),pageSize=20;
   const total=db.prepare(`SELECT count(*) n FROM assets a ${where}`).get(...args).n,pages=Math.max(1,Math.ceil(total/pageSize)),page=Math.min(Number(raw),pages);
   // Lista explícita: não expor tokens, inventário bruto, cofre ou ações administrativas.
   const rows=db.prepare(`SELECT a.id,a.code,a.name,a.owner,a.os,a.last_seen,${online} AS online FROM assets a ${where} ORDER BY a.name COLLATE NOCASE,a.id LIMIT ? OFFSET ?`).all(cutoff,...args,pageSize,(page-1)*pageSize).map(row=>({...row,online:!!row.online}));
   const stats=db.prepare(`SELECT count(*) total,coalesce(sum(${online}),0) online,coalesce(sum(a.last_seen IS NULL),0) pending FROM assets a WHERE a.client_id=? AND NOT EXISTS (SELECT 1 FROM asset_archive ar WHERE ar.asset_id=a.id)`).get(cutoff,user.client_id);
   stats.offline=stats.total-stats.online-stats.pending;
   json(res,200,{company:db.prepare('SELECT id,name FROM clients WHERE id=?').get(user.client_id),rows,total,page,pages,stats,filters:{search,status},updatedAt:now.toISOString()});return true;
  }
  const {where,args,filters}=scope(req,user),company=db.prepare('SELECT id,name FROM clients WHERE id=?').get(user.client_id);
  if(path==='/api/portal/overview'){
   const stats=db.prepare(`SELECT count(*) AS total,coalesce(sum(t.status='Aberto'),0) AS open,coalesce(sum(t.status='Em atendimento'),0) AS progress,coalesce(sum(t.status='Resolvido'),0) AS resolved,coalesce(sum(t.status<>'Resolvido' AND t.priority IN ('Alta','Crítica')),0) AS urgent FROM tickets t ${where}`).get(...args);
   const groups={};for(const [key,expression] of [['month',"strftime('%Y-%m',t.created)"],['status','t.status'],['service',"coalesce(t.service_type,'Não informado')"],['priority','t.priority']])groups[key]=db.prepare(`SELECT ${expression} AS label,count(*) AS total FROM tickets t ${where} GROUP BY ${expression} ORDER BY ${key==='month'?'label DESC':'total DESC,label ASC'}`).all(...args);
   const recent=db.prepare(`SELECT ${fields} FROM tickets t LEFT JOIN users u ON u.id=t.operator_id ${where} ORDER BY t.id DESC LIMIT 5`).all(...args).map(config.ticketAlert);
   json(res,200,{company,stats,groups,recent,filters,updatedAt:new Date().toISOString()});return true;
  }
  if(path==='/api/portal/tickets'){
   const raw=new URL(req.url,'http://localhost').searchParams.get('page')||'1';if(!/^\d+$/.test(raw)||Number(raw)<1||Number(raw)>1000000)fail('Página inválida');
   const total=db.prepare(`SELECT count(*) AS n FROM tickets t ${where}`).get(...args).n,pageSize=20,pages=Math.max(1,Math.ceil(total/pageSize)),page=Math.min(Number(raw),pages);
   const rows=db.prepare(`SELECT ${fields} FROM tickets t LEFT JOIN users u ON u.id=t.operator_id ${where} ORDER BY t.id DESC LIMIT ? OFFSET ?`).all(...args,pageSize,(page-1)*pageSize).map(config.ticketAlert);
   json(res,200,{company,rows,total,page,pages,filters,updatedAt:new Date().toISOString()});return true;
  }
  const ticket=db.prepare(`SELECT ${fields} FROM tickets t LEFT JOIN users u ON u.id=t.operator_id ${where} AND t.id=?`).get(...args,Number(path.split('/').pop()));if(!ticket)fail('Chamado não encontrado',404);json(res,200,config.ticketAlert(ticket));return true;
 }
 return {handle};
}
