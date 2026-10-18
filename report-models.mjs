const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const types=['tickets-client','tickets-month','tickets-operator','tickets-service','tickets-status','tickets-priority','assets-client','assets-connection'];
const columns=['label','operatorId','total','open','progress','resolved','share','online','offline','waiting'];
export function createReportModels({db,body,json,config}){
 db.exec('CREATE TABLE IF NOT EXISTS report_models(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,name TEXT NOT NULL,definition TEXT NOT NULL,UNIQUE(user_id,name))');
 const permitted=(user,type)=>types.includes(type)&&config.allowed(user,type.startsWith('tickets-')?'tickets.read':'assets.read')&&(type!=='assets-connection'||config.allowed(user,'monitor.read'));
 function validate(definition){
  if(!definition||typeof definition!=='object'||!types.includes(definition.type))fail('Modelo de relatório inválido');
  const filters={},source=definition.filters||{};
  for(const key of ['clientId','operatorId','from','to','status','priority','serviceType']){const value=source[key]??'';if(typeof value!=='string'||value.length>80)fail('Filtro do modelo inválido');filters[key]=value;}
  for(const key of ['clientId','operatorId'])if(filters[key]&&(!/^\d+$/.test(filters[key])||!Number.isSafeInteger(Number(filters[key]))))fail('Cliente ou operador do modelo inválido');
  for(const key of ['from','to'])if(filters[key]){const value=filters[key],parsed=/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(value+'T00:00:00Z'):null;if(!parsed||!Number.isFinite(parsed.getTime())||value>'9998-12-31'||parsed.toISOString().slice(0,10)!==value)fail('Data do modelo inválida');}
  if(filters.from&&filters.to&&filters.from>filters.to)fail('Período do modelo inválido');
  for(const [key,values] of [['status',['Aberto','Em atendimento','Resolvido']],['priority',['Baixa','Média','Alta','Crítica']],['serviceType',['Interno','Externo','unclassified']]])if(filters[key]&&!values.includes(filters[key]))fail('Filtro do modelo inválido');
  const input=definition.view||{},view={};
  for(const [key,max] of [['title',120],['note',1000]]){const value=input[key]??'';if(typeof value!=='string'||value.length>max)fail('Título ou observação muito longo');view[key]=value.trim();}
  view.chartType=input.chartType??'bars';if(!['bars','pie'].includes(view.chartType))fail('Tipo de gráfico inválido');
  view.metric=input.metric??'total';if(!columns.includes(view.metric)||['label','operatorId','share'].includes(view.metric))fail('Indicador inválido');
  view.sortBy=input.sortBy??'original';if(!['original',...columns].includes(view.sortBy))fail('Ordenação inválida');
  view.sortDirection=input.sortDirection??'desc';if(!['asc','desc'].includes(view.sortDirection))fail('Sentido da ordenação inválido');
  view.limit=input.limit??12;if(![5,10,12].includes(view.limit))fail('Limite do gráfico inválido');
  view.columns=input.columns??[];if(!Array.isArray(view.columns)||view.columns.length>columns.length||view.columns.some(c=>!columns.includes(c))||new Set(view.columns).size!==view.columns.length)fail('Colunas inválidas');
  for(const key of ['showSummary','showChart','showTable']){view[key]=input[key]??true;if(typeof view[key]!=='boolean')fail('Opção de exibição inválida');}
  if(!view.showSummary&&!view.showChart&&!view.showTable)fail('Selecione ao menos um bloco para o relatório');
  return {type:definition.type,filters,view};
 }
 async function handle(req,res,path,user){
  if(path!=='/api/report-models'&&!/^\/api\/report-models\/\d+$/.test(path))return false;
  if(!config.allowed(user,'tickets.read')&&!config.allowed(user,'assets.read'))fail('Sem permissão para modelos de relatórios',403);
  if(path==='/api/report-models'&&req.method==='GET'){
   const models=db.prepare('SELECT id,name,definition FROM report_models WHERE user_id=? ORDER BY name,id').all(user.id).map(m=>({...m,definition:JSON.parse(m.definition)})).filter(m=>permitted(user,m.definition.type));json(res,200,models);return true;
  }
  if(path==='/api/report-models'&&req.method==='POST'){
   const b=await body(req);if(typeof b.name!=='string'||!b.name.trim()||b.name.length>100)fail('Informe um nome de até 100 caracteres');
   const definition=validate(b.definition);if(!permitted(user,definition.type))fail('Sem permissão para este tipo de relatório',403);
   if(db.prepare('SELECT id FROM report_models WHERE user_id=? AND name=?').get(user.id,b.name.trim()))fail('Já existe um modelo com esse nome. Use outro nome ou exclua o anterior.',409);
   if(db.prepare('SELECT count(*) AS total FROM report_models WHERE user_id=?').get(user.id).total>=50)fail('Limite de 50 modelos por usuário atingido');
   const row=db.prepare('INSERT INTO report_models(user_id,name,definition) VALUES(?,?,?)').run(user.id,b.name.trim(),JSON.stringify(definition));config.audit(user,'reports.model.create',`Modelo de relatório #${row.lastInsertRowid} salvo`);json(res,201,{id:Number(row.lastInsertRowid)});return true;
  }
  if(req.method==='DELETE'&&/^\/api\/report-models\/\d+$/.test(path)){
   const result=db.prepare('DELETE FROM report_models WHERE id=? AND user_id=?').run(Number(path.split('/').pop()),user.id);if(!result.changes)fail('Modelo não encontrado',404);config.audit(user,'reports.model.delete',`Modelo de relatório #${Number(path.split('/').pop())} excluído`);json(res,200,{ok:true});return true;
  }
  fail('Rota não encontrada',404);
 }
 return {handle};
}
