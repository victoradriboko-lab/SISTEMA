import {randomInt} from 'node:crypto';
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const validCompanyToken=value=>typeof value==='string'&&value.length===10&&/^[A-Za-z0-9]{10}$/.test(value);
export function newCompanyToken(db,generate=()=>Array.from({length:10},()=>alphabet[randomInt(alphabet.length)]).join('')){
 for(let attempt=0;attempt<100;attempt++){const token=generate();if(!validCompanyToken(token))throw Error('Formato do token da empresa inválido');if(!db.prepare('SELECT id FROM clients WHERE token=?').get(token))return token;}
 throw Error('Não foi possível gerar um token único para a empresa');
}
// Troca explicitamente solicitada pelo proprietário: não apaga clientes, equipamentos ou histórico.
// Apenas tokens de empresa fora do novo formato são substituídos. Repetir a atualização não os renova.
export function compactCompanyTokens(db){
 const rows=db.prepare('SELECT id FROM clients WHERE length(token)>10').all();if(!rows.length)return 0;
 db.exec('BEGIN IMMEDIATE');try{for(const row of rows)db.prepare('UPDATE clients SET token=? WHERE id=?').run(newCompanyToken(db),row.id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return rows.length;
}
