import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dashboardSummary,renderDashboard} from '../public/dashboard.js';
const now=Date.parse('2026-10-18T12:00:00Z');
const assets=[
 {id:1,name:'PC-01',client_id:1,last_seen:new Date(now-30000).toISOString(),metrics:JSON.stringify({cpuPercent:90,memory:{usedPercent:95},disks:[{name:'C:',usedPercent:99}]})},
 {id:2,name:'PC-02',client_id:1,last_seen:new Date(now-120000).toISOString(),metrics:JSON.stringify({cpuPercent:100})},
 {id:3,name:'PC-03',client_id:null,last_seen:null,metrics:'invalid'},
 {id:4,name:'PC-04',client_id:2,last_seen:new Date(now-1000).toISOString(),metrics:JSON.stringify({cpuPercent:89.9,memory:{usedPercent:10},disks:[]})}
];
const tickets=[{id:1,status:'Aberto',priority:'Crítica',attention:'warning'},{id:2,status:'Em atendimento',priority:'Alta',attention:'critical'},{id:3,status:'Resolvido',priority:'Crítica',attention:'resolved'}];
const clients=[{id:1,name:'Empresa A'},{id:2,name:'Empresa B'},{id:3,name:'Empresa C'}];
test('dashboard distingue offline de nunca conectado, ignora métricas antigas e agrupa clientes',()=>{
 const s=dashboardSummary({assets,tickets,clients,permissions:['assets.read','monitor.read','tickets.read'],now});
 assert.equal(s.connected.length,2);assert.equal(s.offline.length,1);assert.equal(s.waiting.length,1);
 assert.equal(s.critical.length,1);assert.equal(s.critical[0].reasons.length,3);
 assert.deepEqual([s.open,s.progress,s.resolved,s.urgent.length,s.delayed.length],[1,1,1,2,2]);
 assert.deepEqual(s.byClient.map(c=>[c.id,c.total,c.online]),[[1,2,1],[2,1,1],[3,0,0]]);assert.equal(s.unassigned,1);
});
test('dashboard respeita permissões e escapa o conteúdo dos cadastros',()=>{
 const s=dashboardSummary({assets,tickets,clients,permissions:[],now});assert.equal(s.fleet.length,0);assert.equal(s.requests.length,0);assert.equal(s.companies.length,0);
 const restricted=renderDashboard({assets,tickets,clients,user:{name:'Consulta',permissions:[]},now});assert.ok(!restricted.includes('Empresa A'));assert.ok(!restricted.includes('data-dashboard-client'));assert.ok(!restricted.includes('data-dashboard-page'));
 const html=renderDashboard({assets:[{...assets[0],name:'<img src=x onerror=alert(1)>'}],tickets:[],clients,user:{name:'<script>teste</script>',permissions:['assets.read','monitor.read']},now});assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('&lt;script&gt;'));
 const inventoryOnly=dashboardSummary({assets,tickets,clients,permissions:['assets.read'],now});assert.equal(inventoryOnly.critical.length,0);assert.equal(inventoryOnly.connected.length,0);assert.equal(inventoryOnly.byClient[0].online,null);
});
test('painel filtra por cliente, prioridade e operador e calcula SLA com dados reais',()=>{
 const requests=[
  {id:1,client_id:1,operator_id:7,priority:'Alta',status:'Aberto',sla:{state:'overdue',response_due:new Date(now-1000).toISOString()}},
  {id:2,client_id:2,operator_id:8,priority:'Baixa',status:'Em atendimento',sla:{state:'running',response_due:new Date(now+1800000).toISOString()}},
  {id:3,client_id:1,operator_id:7,priority:'Alta',status:'Resolvido',sla:null}
 ];
 const user={id:7,name:'Admin',permissions:['tickets.read','assets.read','monitor.read']};
 const value=(html,label)=>Number(html.match(new RegExp('ops-tile-label">'+label+'<[^]*?<strong>(\\d+)</strong>'))[1]);
 const all=renderDashboard({tickets:requests,assets,clients,user,now});
 assert.equal(value(all,'Abertos'),2);assert.equal(value(all,'Meus'),1);assert.equal(value(all,'Estourados'),1);assert.equal(value(all,'Prestes a estourar'),1);assert.equal(value(all,'Dispositivos'),4);
 const filtered=renderDashboard({tickets:requests,assets,clients,user,now,filters:{clientId:'1',priority:'Alta',operatorId:'7'}});
 assert.equal(value(filtered,'Abertos'),1);assert.equal(value(filtered,'Resolvidos'),1);assert.equal(value(filtered,'Dispositivos'),2);assert.equal(value(filtered,'Prestes a estourar'),0);
 const empty=renderDashboard({tickets:requests,assets,clients,user,now,filters:{clientId:'1',priority:'Baixa'}});assert.equal(value(empty,'Abertos'),0);assert.equal(value(empty,'Dispositivos'),2);
});
