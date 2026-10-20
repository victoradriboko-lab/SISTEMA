// Executado antes do CSS para aplicar a preferência sem piscar o tema padrão.
(()=>{
 const root=document.documentElement,surface=root.dataset.surface==='client'?'client':'internal';
 const key='servitec.theme.'+surface,defaultTheme=surface==='client'?'light':'dark';
 const valid=value=>value==='light'||value==='dark';
 function apply(value){
  const theme=valid(value)?value:defaultTheme;root.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?(surface==='internal'?'#08122f':'#0b1422'):'#f3f6fc');
  document.querySelectorAll('[data-theme-toggle]').forEach(button=>{
   const dark=theme==='dark',next=dark?'modo claro':'modo escuro';
   button.setAttribute('aria-checked',String(dark));
   button.title='Ativar '+next;
  });
 }
 let saved;try{saved=localStorage.getItem(key);}catch{}
 apply(saved);
 document.addEventListener('DOMContentLoaded',()=>{
  apply(root.dataset.theme);
  document.querySelectorAll('[data-theme-toggle]').forEach(button=>button.addEventListener('click',()=>{
   const next=root.dataset.theme==='dark'?'light':'dark';apply(next);
   try{localStorage.setItem(key,next);}catch{}
  }));
 });
 window.addEventListener('storage',event=>{if(event.key===key||event.key===null)apply(event.key===null?defaultTheme:event.newValue);});
})();
