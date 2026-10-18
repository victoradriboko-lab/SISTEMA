const fail=message=>{throw Object.assign(Error(message),{status:400});};
export const equipmentRates={computer:90,notebook:90,server:300};
export function calculateBilling(billing,legacyMonthly=0){
 if(!billing||billing.model==='fixed'){
  const monthly=Number(legacyMonthly);if(!Number.isFinite(monthly)||monthly<0||monthly>1e8)fail('Mensalidade inválida');
  return {model:'fixed',monthly:Math.round(monthly*100)/100};
 }
 if(billing.model!=='equipment')fail('Modelo de cobrança inválido');
 const items=Object.fromEntries(Object.entries(equipmentRates).map(([type,base])=>{
  for(const value of [billing.items?.[type]?.count,billing.items?.[type]?.unitPrice])if(value!==undefined&&(typeof value!=='number'&&typeof value!=='string'||value===null||typeof value==='string'&&!value.trim()))fail('Quantidade ou preço inválido');
  const count=Number(billing.items?.[type]?.count??0),unitPrice=Number(billing.items?.[type]?.unitPrice??base);
  if(!Number.isInteger(count)||count<0||count>100000||!Number.isFinite(unitPrice)||unitPrice<0||unitPrice>1e6||Math.abs(unitPrice*100-Math.round(unitPrice*100))>0.000001)fail('Informe quantidades inteiras e valores unitários com até duas casas decimais');
  const subtotalCents=count*Math.round(unitPrice*100);return [type,{count,unitPrice,subtotal:subtotalCents/100}];
 }));
 const complexityNote=typeof billing.complexityNote==='string'?billing.complexityNote.trim():'';
 if(complexityNote.length>2000)fail('A justificativa deve ter até 2.000 caracteres');
 if(Object.entries(items).some(([type,item])=>item.unitPrice!==equipmentRates[type])&&!complexityNote)fail('Descreva a complexidade ou condição negociada que justifica os valores diferentes do padrão');
 const monthly=Object.values(items).reduce((total,item)=>total+Math.round(item.subtotal*100),0)/100;
 if(monthly>1e8)fail('Valor total do contrato acima do limite');
 return {model:'equipment',items,complexityNote,monthly};
}
