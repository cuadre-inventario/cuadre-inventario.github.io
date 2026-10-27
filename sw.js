/* Cuadre · service worker: la app funciona sin internet.
   Guarda todos los archivos en el teléfono y los sirve desde ahí; si hay internet, los renueva por detrás. */
const V='cuadre-3f90f76206';
const FILES=['./','index.html','manifest.webmanifest','jspdf.min.js','zxing.min.js','icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png','favicon-48.png'];
/* Al instalar se baja todo directo del servidor (sin la copia temporal de GitHub, que dura 10 min), para que una actualización llegue completa y al instante. */
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>Promise.all(FILES.map(f=>fetch(new Request(f,{cache:'reload'})).then(r=>{if(!r.ok)throw new Error(f);return c.put(f,r)})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V&&k.indexOf('cuadre-')===0).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
/* Otras apps del mismo sitio (github.io) pueden borrar este caché al actualizarse: si falta algo, se vuelve a guardar al abrir la app con internet. */
let healing=null;
function heal(){
  if(healing)return healing;
  healing=caches.open(V).then(async c=>{
    const have=new Set((await c.keys()).map(k=>new URL(k.url).pathname));
    const miss=FILES.filter(f=>!have.has(new URL(f,self.registration.scope).pathname));
    if(miss.length)await c.addAll(miss);
  }).catch(()=>{}).then(()=>{healing=null});
  return healing;
}
/* «Compartir» de Android → Cuadre (share_target del manifest): la foto llega por POST a /compartir; se guarda en un caché temporal y se abre la app con ?compartido=1,
   que la muestra para recortarla (foto de producto elegida en Google Imágenes). El caché se llama «compartido-tmp» (no empieza con «cuadre-»: no lo borra la limpieza de versiones). */
async function recibirCompartido(r){
  try{
    const fd=await r.formData(),f=fd.get('foto'),c=await caches.open('compartido-tmp');
    await c.delete('compartido');await c.delete('compartido-txt');
    if(f&&typeof f!=='string'&&f.size)await c.put('compartido',new Response(f,{headers:{'Content-Type':f.type||'image/jpeg'}}));
    const txt=['title','text','url'].map(k=>fd.get(k)).filter(x=>typeof x==='string'&&x).join(' ').slice(0,2000);
    if(txt)await c.put('compartido-txt',new Response(txt));
  }catch(err){}
  return Response.redirect(new URL('./?compartido=1',self.registration.scope).href,303);
}
self.addEventListener('fetch',e=>{
  const r=e.request;
  if(r.method==='POST'){const pu=new URL(r.url);if(pu.origin===location.origin&&/\/compartir$/.test(pu.pathname))e.respondWith(recibirCompartido(r));return}
  if(r.method!=='GET')return;
  const u=new URL(r.url);if(u.origin!==location.origin)return;
  if(r.mode==='navigate')e.waitUntil(heal());
  /* El manifest (nombre, identidad y íconos de la app instalable) siempre se pide primero al servidor; la copia guardada solo sirve sin internet. */
  if(r.destination==='manifest'){
    e.respondWith(fetch(r,{cache:'no-cache'}).then(res=>{if(res&&res.ok){const cp=res.clone();caches.open(V).then(c=>c.put(r,cp))}return res}).catch(()=>caches.match(r,{ignoreSearch:true})));
    return;
  }
  e.respondWith(caches.match(r,{ignoreSearch:true}).then(hit=>{
    const net=fetch(r,{cache:'no-cache'}).then(res=>{if(res&&res.ok&&res.type==='basic'){const cp=res.clone();caches.open(V).then(c=>c.put(r,cp))}return res}).catch(()=>null);
    if(hit){e.waitUntil(net);return hit}
    return net.then(res=>res||(r.mode==='navigate'?caches.match('index.html'):Response.error()));
  }));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{for(const c of cs){if('focus' in c)return c.focus()}return self.clients.openWindow('./')}));
});
/* resumen diario con la app cerrada (Android/Chrome, app instalada) */
function idb(){return new Promise((res,rej)=>{const r=indexedDB.open('cuadre-sw',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function daily(){
  try{
    const db=await idb(),get=()=>new Promise(res=>{const q=db.transaction('kv').objectStore('kv').get('resumen');q.onsuccess=()=>res(q.result);q.onerror=()=>res(null)});
    const r=await get();if(!r||!r.on||!r.daily||!r.n)return;
    const now=new Date(),t0=new Date().setHours(0,0,0,0);if(now.getHours()<r.hour||(r.lastDaily||0)>=t0)return;
    await self.registration.showNotification('Hoy toca comprar ('+r.n+')',{body:(r.items||[]).slice(0,4).map(x=>x.nom).join(', ')+(r.n>4?'…':''),icon:'icon-192.png',badge:'icon-192.png',tag:'daily',data:{url:'./'}});
    r.lastDaily=Date.now();await new Promise(res=>{const tx=db.transaction('kv','readwrite');tx.objectStore('kv').put(r,'resumen');tx.oncomplete=()=>res()});
  }catch(e){}
}
self.addEventListener('periodicsync',e=>{if(e.tag==='cuadre-daily')e.waitUntil(daily())});
