const CACHE='zongce-app-v1-20261110-1';
const BASE=new URL('./',self.location.href);
const FILES=['./','index.html','styles.css','manifest.webmanifest','assets/icon.svg','assets/icon-192.png','assets/icon-512.png','src/app.js','src/model.js','src/rules.js','src/rules-data.json','src/scoring.js','src/forms.js','src/views.js','src/storage-db.js','src/storage-directory.js','src/backup.js','资料/综测_原始依据.pdf'];
const ALLOWED=new Set(FILES.map(p=>new URL(p,BASE).pathname));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES.map(p=>new URL(p,BASE).href)))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('zongce-app-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==BASE.origin||!ALLOWED.has(decodeURI(url.pathname))&&!ALLOWED.has(url.pathname))return;
  event.respondWith((async()=>{
    const cached=await caches.match(event.request,{ignoreSearch:true});
    if(cached)return cached;
    const response=await fetch(event.request);
    if(response.ok){const cache=await caches.open(CACHE);await cache.put(event.request,response.clone());}
    return response;
  })());
});
