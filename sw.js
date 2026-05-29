// ═══ FINANÇAS FAMÍLIA — Service Worker ═══
// Permite notificações com app fechada no iOS/Android

const CACHE = 'financas-v1';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwBOSA92zLMidjTOG5WvyM3_O4mBoNlmty23U8bSVkePxWlBZUmLfs2uY0eJ-VbMBbc/exec';

// Instala e faz cache dos ficheiros principais
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(['/', '/index.html']))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

// Serve da cache quando offline
self.addEventListener('fetch', e => {
  if(e.request.url.includes('script.google.com')) return; // não cachear API
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// Background sync — verifica transações novas a cada 30s quando app fechada
let lastKnownIds = new Set();
let bgTimer = null;

async function checkForNewTx(){
  try{
    const cfg = await getFromDB('ff_cfg');
    if(!cfg) return;
    const deleted = (await getFromDB('ff_deleted')) || [];
    
    const r = await fetch(GAS_URL + '?action=get', {mode:'cors'});
    if(!r.ok) return;
    const data = await r.json();
    if(!data.ok || !data.txs) return;

    const allDel = [...new Set([...(data.deletedIds||[]),...deleted])];
    const txs = data.txs.filter(t => !allDel.includes(t.id));

    // Detecta txs novas do outro utilizador
    const newTxs = txs.filter(t => 
      !lastKnownIds.has(t.id) && 
      t.who !== cfg.myName
    );

    if(lastKnownIds.size > 0 && newTxs.length > 0){
      // Há transações novas — notifica!
      const tx = newTxs[0];
      const cats = {food:'🛒',rest:'🍽️',home:'🏠',trans:'🚌',health:'💊',leisure:'🎬',salary:'💼',other:'📦',savings:'🏦'};
      const ico = cats[tx.cat] || '📦';
      const sign = tx.type === 'exp' ? '−' : '+';
      const amt = Math.abs(parseFloat(tx.amt)||0).toLocaleString('pt-PT',{minimumFractionDigits:2}) + ' €';
      
      await self.registration.showNotification('💚 ' + tx.who + ' adicionou', {
        body: ico + ' "' + tx.desc + '" ' + sign + amt,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'ff-tx-' + tx.id,
        renotify: true,
        vibrate: [300, 100, 300],
        data: { txId: tx.id }
      });

      // Avisa a app se estiver aberta
      const clients = await self.clients.matchAll({type:'window'});
      clients.forEach(c => c.postMessage({type:'NEW_TX', tx}));
    }

    // Atualiza lista conhecida
    txs.forEach(t => lastKnownIds.add(t.id));
  }catch(e){
    console.error('SW check error:', e);
  }
}

// Helper: lê localStorage via IDB (SW não tem acesso ao localStorage da página)
async function getFromDB(key){
  try{
    // Pedimos à página activa
    const clients = await self.clients.matchAll({type:'window'});
    if(clients.length > 0){
      return new Promise(resolve => {
        const ch = new MessageChannel();
        ch.port1.onmessage = e => resolve(e.data);
        clients[0].postMessage({type:'GET_LS', key}, [ch.port2]);
      });
    }
    return null;
  }catch(e){ return null; }
}

// Recebe dados da página
self.addEventListener('message', e => {
  if(e.data && e.data.type === 'LS_DATA'){
    // Dados do localStorage enviados pela página
  }
  if(e.data && e.data.type === 'START_BG'){
    if(bgTimer) clearInterval(bgTimer);
    bgTimer = setInterval(checkForNewTx, 30000);
    checkForNewTx(); // verifica imediatamente
  }
});

// Notificação clicada — abre a app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({type:'window'}).then(clients => {
      if(clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('/');
    })
  );
});
