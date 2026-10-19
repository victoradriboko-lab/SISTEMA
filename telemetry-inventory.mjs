// Campos opcionais do agente ampliado. Campos ausentes continuam desconhecidos.
export function extendInventory(value,result,{text,number,reportedNumber,list,object,fail}){
 const bool=v=>v==null?null:typeof v==='boolean'?v:fail('Valor booleano inválido');
 for(const key of ['loggedUser','osBuild','deviceType'])result[key]=text(value[key]);
 result.totalMemory=number(value.totalMemory);result.memorySlots=reportedNumber(value.memorySlots,256);
 const board=value.motherboard??{};if(!object(board))fail('Placa-mãe inválida');result.motherboard=Object.fromEntries(['manufacturer','product','serialNumber','version'].map(k=>[k,text(board[k])]));
 result.memoryModules=list(value.memoryModules??[],64,m=>({slot:text(m.slot),capacity:number(m.capacity),type:reportedNumber(m.type,255),speedMHz:reportedNumber(m.speedMHz,100000),manufacturer:text(m.manufacturer),partNumber:text(m.partNumber)}),'inventory.memoryModules');
 result.peripherals=list(value.peripherals??[],200,p=>({name:text(p.name),manufacturer:text(p.manufacturer),type:text(p.type)}),'inventory.peripherals');
 result.video=list(value.video??[],32,v=>({name:text(v.name),vram:number(v.vram),driver:text(v.driver),manufacturer:text(v.manufacturer)}),'inventory.video');
 result.storage=list(value.storage??[],64,d=>({name:text(d.name),size:number(d.size),mediaType:text(d.mediaType),interfaceType:text(d.interfaceType),serialNumber:text(d.serialNumber),status:text(d.status)}),'inventory.storage');
 const security=value.security??{};if(!object(security))fail('Segurança inválida');result.security={antivirusEnabled:bool(security.antivirusEnabled),realTimeProtection:bool(security.realTimeProtection),products:list(security.products??[],16,p=>({name:text(p.name),productState:number(p.productState,16777215)}))};
 for(const key of ['loggedUser','osBuild','deviceType','totalMemory','memorySlots','motherboard','memoryModules','peripherals','video','storage','security'])if(!Object.hasOwn(value,key))delete result[key];
 return result;
}
