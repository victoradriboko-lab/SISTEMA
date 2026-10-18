export function syncNavigation(page){
 const nav=document.querySelector('#sidebar-nav');if(!nav)return;
 for(const group of nav.querySelectorAll('.nav-group')){
  const trigger=group.querySelector('[data-nav-group]'),items=group.querySelector('.nav-submenu'),allowed=[...items.querySelectorAll('[data-page]')].filter(button=>!button.hidden);group.hidden=!allowed.length;
  const open=allowed.some(button=>button.dataset.page===page);items.hidden=!open;trigger.setAttribute('aria-expanded',String(open));group.dataset.open=String(open);trigger.classList.toggle('contains-active',open);
  if(!trigger.dataset.bound){trigger.dataset.bound='true';trigger.onclick=()=>{const show=items.hidden;for(const sibling of nav.querySelectorAll('.nav-group')){const expanded=sibling===group&&show;sibling.querySelector('.nav-submenu').hidden=!expanded;sibling.querySelector('[data-nav-group]').setAttribute('aria-expanded',String(expanded));sibling.dataset.open=String(expanded);}};}
 }
}
