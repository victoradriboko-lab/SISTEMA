const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export function createClientAccess({db,body,json,config,hash,validEmail,validPassword,portalURL}){
 const list=()=>db.prepare("SELECT u.id,u.name,u.email,u.client_id,c.name AS client_name,u.active,u.portal_write FROM users u LEFT JOIN clients c ON c.id=u.client_id WHERE u.account_type='client' ORDER BY c.name,u.name,u.id").all();
 async function handle(req,res,path,user){
  if(path!=='/api/client-access'&&path!=='/api/client-access/portal'&&!/^\/api\/client-access\/\d+$/.test(path))return false;
  if(user.role!=='admin'||user.account_type==='client')fail('Somente administradores podem gerenciar acessos de clientes',403);
  if(path==='/api/client-access/portal'&&req.method==='GET'){json(res,200,{url:portalURL(req)});return true;}
  if(path==='/api/client-access'&&req.method==='GET'){json(res,200,list());return true;}
  if(req.method==='POST'&&path==='/api/client-access'||req.method==='PATCH'&&/^\/api\/client-access\/\d+$/.test(path)){
   const b=await body(req),id=req.method==='PATCH'?Number(path.split('/').pop()):null;
   const previous=id?db.prepare("SELECT id,name,email,client_id,active,portal_write FROM users WHERE id=? AND account_type='client'").get(id):null;if(id&&!previous)fail('Acesso de cliente não encontrado',404);
   const name=b.name===undefined?previous?.name:typeof b.name==='string'?b.name.trim():'',email=b.email===undefined?previous?.email:typeof b.email==='string'?b.email.trim().toLowerCase():'',clientId=b.clientId===undefined?previous?.client_id:b.clientId,active=b.active===undefined?(previous?.active??1):b.active;
   if(!name||name.length>500||!validEmail(email)||!Number.isSafeInteger(clientId)||!db.prepare('SELECT id FROM clients WHERE id=?').get(clientId)||![0,1].includes(active))fail('Informe nome, e-mail, empresa vinculada e situação válidos');
   if((!previous||b.password!==undefined)&&!validPassword(b.password))fail('A senha deve ter de 12 a 256 caracteres');
   if(db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(email,id??0))fail('E-mail já cadastrado',409);
   db.exec('BEGIN IMMEDIATE');let resultId=id;try{
    if(previous){db.prepare("UPDATE users SET name=?,email=?,client_id=?,active=?,role='client_viewer' WHERE id=?").run(name,email,clientId,active,id);if(b.password!==undefined)db.prepare('UPDATE users SET password=? WHERE id=?').run(hash(b.password),id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);}
    else resultId=Number(db.prepare("INSERT INTO users(name,email,password,role,active,account_type,client_id) VALUES(?,?,?,'client_viewer',?,'client',?)").run(name,email,hash(b.password),active,clientId).lastInsertRowid);
    const portalWrite=b.portalWrite===undefined?(previous?.portal_write??0):b.portalWrite===true?1:b.portalWrite===false?0:fail('Permissão inválida');db.prepare('UPDATE users SET portal_write=? WHERE id=?').run(portalWrite,resultId);config.audit(user,previous?'client-access.update':'client-access.create',`Acesso de cliente #${resultId}, empresa #${clientId}`);db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   json(res,previous?200:201,{id:resultId});return true;
  }
  fail('Rota não encontrada',404);
 }
 return {handle};
}
