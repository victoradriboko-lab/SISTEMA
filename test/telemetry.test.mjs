import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {normalizeHeartbeat} from '../telemetry.mjs';
const machineId='7cf380bd-6955-4cb5-9547-1e75cf2c33a0';
export function sample(overrides={}){return {schemaVersion:1,sampleId:randomUUID(),observedAt:new Date().toISOString(),agent:{version:'1.0.0',platform:'windows',machineId},os:'Microsoft Windows Server 2022',metrics:{cpuPercent:25,memory:{total:16*1073741824,available:8*1073741824,usedPercent:50},disks:[{name:'C:',total:200*1073741824,available:100*1073741824,usedPercent:50}],uptimeSeconds:3600},...overrides};}
test('normalização do protocolo Windows rejeita métricas e inventários inválidos',()=>{
 assert.equal(normalizeHeartbeat(sample()).metrics.cpuPercent,25);
 assert.equal(normalizeHeartbeat({os:'Linux',cpu:0.5}).legacy,true);
 for(const payload of [null,[],sample({schemaVersion:2}),sample({observedAt:'invalid'}),sample({observedAt:new Date(Date.now()+3600000).toISOString()}),sample({observedAt:new Date(Date.now()-8*86400000).toISOString()}),sample({sampleId:'<script>'}),sample({agent:{platform:'windows',machineId:'invalid'}}),sample({metrics:{cpuPercent:101}}),sample({metrics:{memory:{total:1,available:2}}}),sample({inventory:{hostname:'PC',programs:'invalid'}})])assert.throws(()=>normalizeHeartbeat(payload));
});
test('agente: vínculo, histórico, offline, deduplicação, revogação e pacote autenticado',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sistema-telemetry-'));const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,CLIENT_PORT:'0',PORT:'3205',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 const raw=(path,method='GET',body,headers={})=>fetch('http://127.0.0.1:3205/api/'+path,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const call=async(path,method='GET',body,headers)=>{const r=await raw(path,method,body,headers);return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
 await Promise.race([once(child.stdout,'data'),new Promise((_,r)=>setTimeout(()=>r(Error('Timeout')),5000).unref())]);
 const password='telemetry-test-password';await call('setup','POST',{name:'Admin',email:'admin@example.test',password});const login=await call('login','POST',{email:'admin@example.test',password});const admin={Cookie:login.cookie};
 const asset=await call('assets','POST',{name:'Servidor de teste'},admin);const id=asset.data.id,auth={Authorization:'Bearer '+asset.data.token};
 assert.equal((await call('agent/check')).status,401);assert.equal((await call('agent/check','GET',undefined,auth)).status,200);
 assert.equal((await call('assets','GET',undefined,admin)).data[0].last_seen,null);
 const old=sample({observedAt:new Date(Date.now()-3600000).toISOString()});assert.equal((await call('heartbeat','POST',old,auth)).status,200);
 assert.equal((await call('assets','GET',undefined,admin)).data[0].last_seen,null);
 assert.equal((await call('heartbeat','POST',sample({agent:{version:'1.0.0',platform:'windows',machineId:randomUUID()}}),auth)).status,409);
 assert.equal((await call('heartbeat','POST',{os:'Legacy'},auth)).status,409);
 const inventory={hostname:'SRV-TESTE',manufacturer:'Fabricante',model:'Modelo',serialNumber:'SERIAL-TESTE',osVersion:'10.0',architecture:'64 bits',productType:3,processors:[{name:'CPU de teste',cores:8,logicalProcessors:16}],network:[{name:'Ethernet',mac:'AA:BB:CC:DD:EE:FF',addresses:['192.168.1.10']}],programs:[{name:'Programa teste',version:'1.0',publisher:'Fornecedor'}],services:[{name:'Spooler',displayName:'Spooler de impressão',state:'Running',startMode:'Auto'}]};
 const fresh=sample({inventory});const sent=await call('heartbeat','POST',fresh,auth);assert.equal(sent.status,200);assert.equal(sent.data.requestInventory,false);
 assert.equal((await call('heartbeat','POST',fresh,auth)).data.duplicate,true);
 let detail=await call(`assets/${id}/telemetry`,'GET',undefined,admin);assert.equal(detail.status,200);assert.equal(detail.data.inventory.hostname,'SRV-TESTE');assert.equal(detail.data.metrics.cpuPercent,25);assert.equal(detail.data.history.length,2);assert.ok(detail.data.last_seen);assert.equal('machine_id' in detail.data,false);assert.equal('token' in detail.data,false);
 const latestTime=detail.data.last_metrics_at,lastContact=detail.data.last_seen;
 await call('heartbeat','POST',sample({observedAt:new Date(Date.now()-1800000).toISOString(),metrics:{cpuPercent:99},agent:{version:'0.9.0',platform:'windows',machineId}}),auth);
 detail=await call(`assets/${id}/telemetry`,'GET',undefined,admin);assert.equal(detail.data.metrics.cpuPercent,25);assert.equal(detail.data.last_metrics_at,latestTime);assert.equal(detail.data.agent.version,'1.0.0');assert.equal(detail.data.last_seen,lastContact);assert.equal(detail.data.history.length,3);
 assert.equal((await call('heartbeat','POST',sample({metrics:{cpuPercent:200}}),auth)).status,400);
 await call('users','POST',{name:'Consulta',email:'viewer@example.test',password,role:'viewer'},admin);const viewerLogin=await call('login','POST',{email:'viewer@example.test',password});const viewer={Cookie:viewerLogin.cookie};assert.equal((await call(`assets/${id}/telemetry`,'GET',undefined,viewer)).status,200);
 assert.equal((await raw('agent/windows-package','GET',undefined,viewer)).status,403);assert.equal((await raw('agent/windows-package')).status,401);
 const packageResponse=await raw('agent/windows-package','GET',undefined,admin);assert.equal(packageResponse.status,200);assert.equal(packageResponse.headers.get('content-type'),'application/zip');const zip=Buffer.from(await packageResponse.arrayBuffer());assert.equal(zip.subarray(0,2).toString(),'PK');
 assert.equal((await raw('agent/windows-installer')).status,401);assert.equal((await raw('agent/windows-installer','GET',undefined,viewer)).status,403);
 const installerResponse=await raw('agent/windows-installer','GET',undefined,admin);assert.equal(installerResponse.status,200);assert.equal(installerResponse.headers.get('content-disposition'),'attachment; filename="App-Servitec.exe"');assert.equal(installerResponse.headers.get('content-type'),'application/octet-stream');const exe=Buffer.from(await installerResponse.arrayBuffer());assert.equal(exe.subarray(0,2).toString(),'MZ');assert.ok(exe.includes(Buffer.from('requireAdministrator')));assert.ok(exe.includes(zip),'Instalador deve incorporar o pacote ZIP atual');
 const role=await call('config/roles','POST',{name:'Sem monitoramento'},admin);await call('config/permissions','PUT',{roles:[{id:role.data.id,permissions:['assets.read']}]},admin);await call('users','POST',{name:'Restrito',email:'restricted@example.test',password,role:role.data.id},admin);const restricted=await call('login','POST',{email:'restricted@example.test',password});const restrictedHeaders={Cookie:restricted.cookie};
 assert.equal((await call(`assets/${id}/telemetry`,'GET',undefined,restrictedHeaders)).status,403);assert.equal('metrics' in (await call('assets','GET',undefined,restrictedHeaders)).data[0],false);assert.equal('agent_info' in (await call('assets','GET',undefined,restrictedHeaders)).data[0],false);
 const renewed=await call(`assets/${id}/token`,'POST',{password},admin);assert.equal(renewed.status,200);assert.equal((await call(`assets/${id}/telemetry`,'GET',undefined,admin)).data.inventory,null);assert.equal((await call('heartbeat','POST',sample(),auth)).status,401);
 const nextAuth={Authorization:'Bearer '+renewed.data.token};assert.equal((await call('heartbeat','POST',sample({agent:{version:'1.0.0',platform:'windows',machineId:randomUUID()}}),nextAuth)).status,200);
 const noInventory=await call('assets','POST',{name:'Nova máquina'},admin);const result=await call('heartbeat','POST',sample(),{Authorization:'Bearer '+noInventory.data.token});assert.equal(result.data.requestInventory,true);
 }finally{child.kill();await once(child,'exit');rmSync(dir,{recursive:true,force:true});}
});
