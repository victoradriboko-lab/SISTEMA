const normalize=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function syncNavigation(page){
 const nav=document.querySelector('#sidebar-nav');if(!nav)return;
 const search=document.querySelector('#module-search');
 const filter=()=>{
  const query=normalize(search?.value||'');
  for(const button of nav.querySelectorAll('[data-page]'))button.classList.toggle('nav-filtered',!!query&&!normalize(button.textContent).includes(query));
  for(const group of nav.querySelectorAll('.nav-group')){
   const trigger=group.querySelector('[data-nav-group]'),items=group.querySelector('.nav-submenu');
   const allowed=[...items.querySelectorAll('[data-page]')].filter(button=>!button.hidden),matchesGroup=!!query&&normalize(trigger.textContent).includes(query);
   if(matchesGroup)for(const button of allowed)button.classList.remove('nav-filtered');
   group.hidden=!allowed.some(button=>!button.classList.contains('nav-filtered'));
   const active=allowed.some(button=>button.dataset.page===page),open=!group.hidden&&(!!query||active);
   items.hidden=!open;trigger.setAttribute('aria-expanded',String(open));group.dataset.open=String(open);trigger.classList.toggle('contains-active',active);
   if(!trigger.dataset.bound){trigger.dataset.bound='true';trigger.onclick=()=>{
    const show=items.hidden;
    for(const sibling of nav.querySelectorAll('.nav-group')){
     const expanded=sibling===group&&show;sibling.querySelector('.nav-submenu').hidden=!expanded;sibling.querySelector('[data-nav-group]').setAttribute('aria-expanded',String(expanded));sibling.dataset.open=String(expanded);
    }
   };}
  }
  const download=nav.querySelector('#agent-download');download?.classList.toggle('nav-filtered',!!query&&!normalize(download.textContent).includes(query));
  const empty=document.querySelector('#module-search-empty');if(empty)empty.hidden=[...nav.querySelectorAll('[data-page],#agent-download')].some(button=>!button.hidden&&!button.classList.contains('nav-filtered'));
 };
 if(search){search.oninput=filter;search.onkeydown=event=>{if(event.key==='Escape'){search.value='';filter();}};}
 filter();
}
