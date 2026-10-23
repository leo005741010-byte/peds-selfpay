// 兒科自費 Service Worker
// 改版後手機還看到舊畫面：把 CACHE 版本號 +1 再推（程式本身也會比對 core.js 的版本號自動重新載入）
const CACHE='peds-selfpay-v1';
const CORE=['./','./index.html','./admin.html','./core.js','./manifest.json','./manifest-admin.json',
  './icon-192.png','./icon-512.png','./apple-touch-icon.png','./icon-admin-192.png','./icon-admin-512.png','./apple-touch-icon-admin.png'];

self.addEventListener('install', e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE).catch(()=>{})));
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', e=>{
  const req=e.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.origin!==location.origin) return;   // 試算表、表單等跨網域請求直通，不快取

  // 網頁與程式（.html／.js／.json）：network-first，離線退回快取。
  // 一定要 no-store：GitHub Pages 帶 max-age=600，不繞過瀏覽器快取的話改版後 10 分鐘內還是舊的
  if(req.mode==='navigate' || /\.(html|js|json)$/.test(url.pathname) || url.pathname.endsWith('/')){
    e.respondWith(
      fetch(req.url,{cache:'no-store'}).then(res=>{
        if(res.ok){ const copy=res.clone(); caches.open(CACHE).then(c=>c.put(req,copy)); }
        return res;
      }).catch(()=>caches.match(req,{ignoreSearch:true}).then(r=>r||caches.match(/admin/.test(url.pathname)?'./admin.html':'./index.html')))
    );
    return;
  }

  // 圖示：cache-first
  e.respondWith(
    caches.match(req).then(cached=>cached || fetch(req).then(res=>{
      if(res.ok){ const copy=res.clone(); caches.open(CACHE).then(c=>c.put(req,copy)); }
      return res;
    }).catch(()=>cached))
  );
});
