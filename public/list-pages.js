const positions=new Map();
export function paginateElements(root,elements,{key,pageSize=10}={}){
 root.querySelector(':scope > .list-pages')?.remove();if(elements.length<=pageSize){elements.forEach(element=>element.hidden=false);return;}
 const state=positions.get(key)||{page:1},pages=Math.ceil(elements.length/pageSize),bar=document.createElement('div');bar.className='list-pages';bar.setAttribute('role','group');bar.setAttribute('aria-label','Páginas da lista');const previous=document.createElement('button'),next=document.createElement('button'),label=document.createElement('span');previous.type=next.type='button';previous.textContent='← Anterior';next.textContent='Próxima →';label.setAttribute('role','status');bar.append(previous,label,next);root.prepend(bar);
 function show(page){state.page=Math.max(1,Math.min(pages,page));if(key)positions.set(key,state);elements.forEach((element,index)=>element.hidden=index<(state.page-1)*pageSize||index>=state.page*pageSize);label.textContent=`Página ${state.page} de ${pages} · ${elements.length} registro(s)`;previous.disabled=state.page===1;next.disabled=state.page===pages;}
 previous.onclick=()=>show(state.page-1);next.onclick=()=>show(state.page+1);show(state.page);
}
export function paginateTables(root,key){root.querySelectorAll('table').forEach((table,index)=>paginateElements(table.parentElement,[...table.querySelectorAll('tbody > tr')],{key:key+':'+index}));}
