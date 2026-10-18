import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max=500)=>{if(value===null||value===undefined)return '';if(typeof value!=='string'||value.length>max)fail('Texto do inventário inválido');return value;};
const number=(value,max=Number.MAX_SAFE_INTEGER)=>{if(value===null||value===undefined)return null;if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>max)fail('Métrica numérica inválida');return value;};
const list=(value,max,convert)=>{if(!Array.isArray(value)||value.length>max)fail('Lista do inventário inválida');return value.map(item=>{if(!object(item))fail('Item do inventário inválido');return convert(item);});};
const jsonOrNull=value=>value?JSON.parse(value):null;
function normalizeInventory(value){
  if(!object(value))fail('Inventário inválido');
  const result={};
  for(const key of ['hostname','manufacturer','model','serialNumber','biosVersion','domain','osVersion','architecture'])result[key]=text(value[key]);
  if(!result.hostname)fail('Nome do computador é obrigatório no inventário');
  result.productType=number(value.productType,3);
  result.processors=list(value.processors??[],32,p=>({name:text(p.name),cores:number(p.cores,4096),logicalProcessors:number(p.logicalProcessors,8192)}));
  result.network=list(value.network??[],32,n=>{if(!Array.isArray(n.addresses)||n.addresses.length>32)fail('Endereços de rede inválidos');return {name:text(n.name),mac:text(n.mac,80),addresses:n.addresses.map(v=>text(v,100))};});
  result.programs=list(value.programs??[],500,p=>({name:text(p.name),version:text(p.version),publisher:text(p.publisher)}));
  result.services=list(value.services??[],300,s=>({name:text(s.name),displayName:text(s.displayName),state:text(s.state,80),startMode:text(s.startMode,80)}));
  return result;
}
export function normalizeHeartbeat(payload,now=Date.now()){
  if(!object(payload))fail('Mensagem inválida');
  if(payload.schemaVersion===undefined){
    if(payload.cpu!==undefined)number(payload.cpu);
    if(Buffer.byteLength(JSON.stringify(payload))>32768)fail('Mensagem do agente básico muito grande');
    let disks=[];if(payload.disk!==undefined){if(!object(payload.disk))fail('Disco inválido');const total=number(payload.disk.total),used=number(payload.disk.used);if(total!==null&&used!==null){if(used>total)fail('Uso maior que o disco');disks=[{name:'/',total,available:total-used,usedPercent:total?used/total*100:null}];}}
    return {legacy:true,sampleId:randomUUID(),observedAt:now,os:text(payload.os),metrics:{cpu:payload.cpu,memory:payload.memory,disk:payload.disk,disks}};
  }
  if(payload.schemaVersion!==1)fail('Versão de protocolo não suportada');
  if(typeof payload.sampleId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(payload.sampleId))fail('Identificador da amostra inválido');
  const observedAt=typeof payload.observedAt==='string'?Date.parse(payload.observedAt):NaN;
  if(!Number.isFinite(observedAt)||observedAt>now+300000||observedAt<now-7*86400000)fail('Horário da amostra fora do intervalo aceito');
  if(!object(payload.agent)||payload.agent.platform!=='windows'||typeof payload.agent.machineId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(payload.agent.machineId))fail('Identificação do agente inválida');
  if(!object(payload.metrics))fail('Métricas inválidas');
  const m=payload.metrics,memory=m.memory??{};if(!object(memory))fail('Memória inválida');
  const metrics={cpuPercent:number(m.cpuPercent,100),memory:{total:number(memory.total),available:number(memory.available),usedPercent:number(memory.usedPercent,100)},uptimeSeconds:number(m.uptimeSeconds),disks:list(m.disks??[],64,d=>({name:text(d.name,80),total:number(d.total),available:number(d.available),usedPercent:number(d.usedPercent,100)}))};
  if(metrics.memory.total!==null&&metrics.memory.available!==null&&metrics.memory.available>metrics.memory.total)fail('Memória disponível maior que o total');
  for(const d of metrics.disks)if(d.total!==null&&d.available!==null&&d.available>d.total)fail('Espaço livre maior que o disco');
  return {legacy:false,sampleId:payload.sampleId,observedAt,os:text(payload.os),agent:{version:text(payload.agent.version,40),platform:'windows'},machineId:payload.agent.machineId.toLowerCase(),metrics,inventory:payload.inventory===undefined?undefined:normalizeInventory(payload.inventory)};
}

export function createTelemetry({db,body,json,config,root}){
  const columns=db.prepare('PRAGMA table_info(assets)').all().map(c=>c.name);
  for(const name of ['agent_info','inventory','machine_id','last_metrics_at','last_inventory_at'])if(!columns.includes(name))db.exec(`ALTER TABLE assets ADD COLUMN ${name} TEXT`);
  db.exec('CREATE TABLE IF NOT EXISTS telemetry(id INTEGER PRIMARY KEY,asset_id INTEGER NOT NULL,sample_id TEXT NOT NULL,observed_at INTEGER NOT NULL,received_at INTEGER NOT NULL,metrics TEXT NOT NULL,UNIQUE(asset_id,sample_id)); CREATE INDEX IF NOT EXISTS telemetry_asset_time ON telemetry(asset_id,observed_at DESC)');
  const cleanup=new Map();
  async function publicRoute(req,res,path){
    if(!(path==='/api/heartbeat'&&req.method==='POST'||path==='/api/agent/check'&&req.method==='GET'))return false;
    const token=(req.headers.authorization||'').replace(/^Bearer /,'');
    const asset=db.prepare('SELECT id,name,machine_id,agent_info,last_metrics_at,last_inventory_at,os,inventory IS NOT NULL AS has_inventory FROM assets WHERE token=?').get(token);
    if(!asset){json(res,401,{error:'Token inválido'});return true;}
    if(path==='/api/agent/check'){json(res,200,{ok:true,protocolVersion:1,asset:{id:asset.id,name:asset.name}});return true;}
    const sample=normalizeHeartbeat(await body(req));
    if(asset.machine_id&&(sample.legacy||asset.machine_id!==sample.machineId))fail('Token vinculado a outra instalação. Renove o token do equipamento para reinstalar.',409);
    // Revalida o token depois da leitura do corpo, caso tenha sido renovado.
    const current=db.prepare('SELECT id,name,machine_id,agent_info,last_metrics_at,last_inventory_at,os,inventory IS NOT NULL AS has_inventory FROM assets WHERE id=? AND token=?').get(asset.id,token);if(!current)fail('Token revogado',401);
    if(current.machine_id&&(sample.legacy||current.machine_id!==sample.machineId))fail('Token vinculado a outra instalação',409);
    if(db.prepare('SELECT id FROM telemetry WHERE asset_id=? AND sample_id=?').get(asset.id,sample.sampleId)){json(res,200,{ok:true,duplicate:true});return true;}
    const now=Date.now(),observed=new Date(sample.observedAt).toISOString();
    db.exec('BEGIN IMMEDIATE');try{
      db.prepare('INSERT INTO telemetry(asset_id,sample_id,observed_at,received_at,metrics) VALUES(?,?,?,?,?)').run(asset.id,sample.sampleId,sample.observedAt,now,JSON.stringify(sample.metrics));
      if(!current.last_metrics_at||Date.parse(current.last_metrics_at)<=sample.observedAt)db.prepare('UPDATE assets SET metrics=?,last_metrics_at=?,os=? WHERE id=?').run(JSON.stringify(sample.metrics),observed,sample.os||current.os,asset.id);
      if(now-sample.observedAt<=120000)db.prepare('UPDATE assets SET last_seen=? WHERE id=?').run(new Date(now).toISOString(),asset.id);
      if(!sample.legacy){db.prepare('UPDATE assets SET machine_id=? WHERE id=?').run(sample.machineId,asset.id);if(!current.agent_info||!current.last_metrics_at||Date.parse(current.last_metrics_at)<=sample.observedAt)db.prepare('UPDATE assets SET agent_info=? WHERE id=?').run(JSON.stringify(sample.agent),asset.id);if(sample.inventory&&(!current.last_inventory_at||Date.parse(current.last_inventory_at)<=sample.observedAt))db.prepare('UPDATE assets SET inventory=?,last_inventory_at=? WHERE id=?').run(JSON.stringify(sample.inventory),observed,asset.id);}
      if(now-(cleanup.get(asset.id)||0)>3600000){db.prepare('DELETE FROM telemetry WHERE asset_id=? AND observed_at<?').run(asset.id,now-48*3600000);db.prepare('DELETE FROM telemetry WHERE asset_id=? AND id NOT IN (SELECT id FROM telemetry WHERE asset_id=? ORDER BY observed_at DESC LIMIT 5760)').run(asset.id,asset.id);cleanup.set(asset.id,now);}
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    json(res,200,{ok:true,serverTime:new Date(now).toISOString(),requestInventory:!sample.legacy&&!sample.inventory&&!current.has_inventory});return true;
  }
  async function handle(req,res,path,user){
    if(path==='/api/agent/windows-package'&&req.method==='GET'){
      if(!config.allowed(user,'assets.write'))fail('Sem permissão para instalar agentes',403);
      let data;try{data=readFileSync(join(root,'agents/windows/servitec-agent-windows.zip'));}catch{fail('Pacote do agente ainda não foi gerado no servidor',503);}
      res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="servitec-agent-windows.zip"'});res.end(data);return true;
    }
    if(/^\/api\/assets\/\d+\/telemetry$/.test(path)&&req.method==='GET'){
      if(!config.allowed(user,'monitor.read'))fail('Sem permissão para consultar monitoramento',403);
      const id=Number(path.split('/')[3]),asset=db.prepare('SELECT id,name,os,last_seen,metrics,inventory,agent_info,last_metrics_at,last_inventory_at FROM assets WHERE id=?').get(id);if(!asset)fail('Equipamento não encontrado',404);
      const history=db.prepare('SELECT observed_at,metrics FROM telemetry WHERE asset_id=? ORDER BY observed_at DESC LIMIT 120').all(id).reverse().map(row=>{const m=jsonOrNull(row.metrics);return {at:new Date(row.observed_at).toISOString(),cpuPercent:m?.cpuPercent??null,memoryPercent:m?.memory?.usedPercent??null};});
      json(res,200,{...asset,metrics:jsonOrNull(asset.metrics),inventory:jsonOrNull(asset.inventory),agent:jsonOrNull(asset.agent_info),agent_info:undefined,history});return true;
    }
    return false;
  }
  return {publicRoute,handle};
}
