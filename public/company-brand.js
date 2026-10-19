// Identidade visual. Não grava nem substitui configurações existentes.
(()=>{
 const officialLogo='https://www.servitecbrasil.com.br/logo.svg';
 let customLogo=null;
 function prepare(image){
  if(image.dataset.brandPrepared)return;
  image.dataset.brandPrepared='true';
  const frame=image.closest('.servitec-logo-frame'),fallback=frame?.querySelector('.servitec-logo-fallback');
  const show=()=>{image.hidden=false;if(fallback)fallback.hidden=true;};
  const failed=()=>{
   if(image.getAttribute('src')!==officialLogo){image.src=officialLogo;return;}
   image.hidden=true;if(fallback)fallback.hidden=false;
  };
  image.addEventListener('load',show);image.addEventListener('error',failed);
  if(customLogo)image.src=customLogo;
  if(image.complete){if(image.naturalWidth)show();else failed();}
 }
 const scan=node=>{if(node.nodeType!==1)return;if(node.matches('img[data-company-logo]'))prepare(node);node.querySelectorAll('img[data-company-logo]').forEach(prepare);};
 scan(document.documentElement);
 new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(scan))).observe(document.body,{childList:true,subtree:true});
 fetch('/api/branding').then(response=>{if(!response.ok)throw Error('Marca indisponível');return response.json();}).then(branding=>{
  if(!branding.hasLogo)return;
  customLogo='/brand-logo';document.querySelectorAll('img[data-company-logo]').forEach(image=>{image.src=customLogo;});
 }).catch(()=>{});
})();
