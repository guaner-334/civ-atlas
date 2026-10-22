/**
 * 加载画面:第一次打开网站、页面的代码还没下好时先出的那一屏(网站图标 + 「文明与地图」+ 一条真的进度条),构建时写进 index.html。
 * 以前页面里只有一个空的 #root,慢网时要等样式表和代码都下好才画得出东西,前几秒一片空白,看着像卡死了。
 *
 * 怎么知道下了多少:浏览器自己下代码时不告诉页面下了多少,所以页面的代码、样式表不再直接写在页面里,
 * 改由这一段先用 fetch 一边下一边数,下好以后再放上 <link rel="stylesheet">、<script type="module">。
 * 这时浏览器从自己的缓存里拿,不会下第二遍(/assets/ 下的文件名带内容指纹,网站让浏览器缓存一年;
 * 不让缓存的服务器也只是问一句有没有变、回 304)。每个文件多大构建时写进页面(服务器发的是压过的,
 * fetch 数到的是解压以后的字节数,和文件原大小比);各个文件按压过以后的大小算份量,进度条走得和时间差不多匀。
 *
 *   网快的时候   底色一打开就有(和首页同一种浅灰),图标和字 0.4 秒后才淡入:0.4 秒内首页就出来的只看到底色
 *   过了 8 秒    多一句"网络有点慢,已下载 42%"
 *   过了 1 分钟  还在下:灰色「重新加载」,不催
 *   15 秒一点没动、下载出错:蓝色「重新加载」
 *   下好了       首页(或打开的世界)挂上以后淡出 0.2 秒(src/ui/Boot.tsx 叫 window.__ld.done(),见 src/ui/loadScreen.ts)
 *
 * 打开的不是首页(某个世界、分享链接、新建……;和 src/ui/homeStart.ts 的 plainHome 同一个判断):主程序(App)也一起下、一起算进度,
 * 加载画面一直留到主程序挂上。网址里是深色底图(卫星、地理图、高程、降水)或新建界面的用深色,和接下来的页面一个颜色(不跟系统的深色模式:
 * 网站本身不跟,跟了会从黑跳到白)。首页上主程序在后台下载时,下了多少也从这里拿(window.__ld.app)。
 *
 * 这一段出了任何错(浏览器太旧之类):直接把样式表和代码交给浏览器,和以前一样打开,只是没有进度。
 * 颜色照 src/ui/theme.css 抄的值(这一段在样式表下好之前就要画出来,用不了那里的变量;改主题色时两处一起改)。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { transformWithEsbuild, type HtmlTagDescriptor, type Plugin } from 'vite';
import { HARMLESS } from '../../src/ui/homeStart';
import { DATA_BASES, MAIN_BASES, MAP_LAYERS, baseDark, isBaseId, mapViewFromUrl } from '../../src/ui/mapLayers';

/**
 * 页面一打开要下的一个文件:[网址, 原大小(字节), 份量(gzip 压过以后的字节数), 哪一种]
 *   1 页面的入口代码(下好以后放上 <script type="module">)   2 样式表(<link rel="stylesheet">)
 *   0 入口代码 import 的别的代码(只是先下好)                  3 主程序 App(不是首页时也一起下;首页上由 Boot.tsx 叫来下)
 */
export type LoadFile = [url: string, raw: number, weight: number, kind: 0 | 1 | 2 | 3];

/** 写进页面的文件清单的变量名(scripts/first-load.ts 也按它读出首页要下哪些) */
const FILES_VAR = '__ldFiles';

/** 加载画面的样式(写在 <head> 里;手机 = 窗口窄于 600) */
export const LOAD_STYLE =
  '#ld{--b:#f5f5f7;--i:#1d1d1f;--i2:#6e6e73;--ln:rgba(60,60,67,.16);--a:#007aff;--bt:rgba(118,118,128,.12);' +
  'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
  'padding:0 24px 6vh;background:var(--b);color:var(--i);text-align:center;transition:opacity .2s ease-out;' +
  'font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}' +
  '.ld-dk #ld{--b:#1c1c1e;--i:#f5f5f7;--i2:#a1a1a6;--ln:rgba(255,255,255,.14);--a:#0a84ff;--bt:rgba(118,118,128,.26)}' +
  '#ld>*{animation:ld .3s .4s both}@keyframes ld{from{opacity:0}}' +
  '#ld svg{width:64px;height:64px}' +
  '#ld b{margin-top:16px;font-size:22px;font-weight:700;letter-spacing:.5px;line-height:1.3}' +
  '#ld i{display:block;width:200px;height:3px;margin-top:20px;border-radius:2px;background:var(--ln);overflow:hidden}' +
  '#ld s{display:block;width:3%;height:100%;border-radius:2px;background:var(--a);transition:width .3s}' +
  '#ld p{margin:16px 0 0;min-height:7.2em;max-width:22em;font-size:14px;line-height:1.6}' +
  '#ld em{font-style:normal;font-variant-numeric:tabular-nums}' +
  '#ld small{display:block;color:var(--i2);font-size:12.5px}' +
  '#ld button{display:block;margin:14px auto 0;height:32px;padding:0 14px;border:0;border-radius:8px;background:var(--bt);color:var(--i);font:inherit;font-weight:500;cursor:pointer}' +
  '#ld button.go{background:var(--a);color:#fff}' +
  '#ld.out{opacity:0;pointer-events:none}' +
  '@media (max-width:600px){#ld svg{width:56px;height:56px}#ld b{font-size:20px}#ld i{width:160px}#ld small{font-size:13px}#ld button{height:40px;padding:0 20px;font-size:15px}}' +
  // 减少动态效果:不淡入淡出、进度条不滑;图标和字照样等 0.4 秒再出来(一下子出来,网快的照样只看到底色)
  '@media (prefers-reduced-motion:reduce){#ld,#ld s{transition:none}#ld>*{animation-duration:0s}}';

/**
 * 加载画面那一块:网站图标(就是 public/favicon.svg,里面的 id 换个前缀免得和页面上的撞)、网站名、进度条、慢了以后的说明。
 * 说明那一段一开始就留好高度,字出来时上面的图标、名字不跳
 */
export function loadScreenMarkup(faviconSvg: string): string {
  const svg = faviconSvg
    .trim()
    .replace(/\s+xmlns="[^"]*"/, '')
    .replace(/\bid="a-/g, 'id="ld-')
    .replace(/url\(#a-/g, 'url(#ld-')
    .replace(/#ffffff\b/gi, '#fff')
    .replace(/^<svg\b/, '<svg aria-hidden="true"');
  if (!/^<svg\b[^>]*>[\s\S]*<\/svg>$/.test(svg)) throw new Error('public/favicon.svg 不像一个 <svg>,加载画面上的图标画不出来');
  return `${svg}<b>文明与地图</b><i role="progressbar" aria-label="正在载入"><s></s></i><p aria-live="polite"></p>`;
}

/** 深色底图:网址里 map= 是这几种(新链接) */
const DARK_BASES = [...MAIN_BASES.map((b) => b.id), ...DATA_BASES].filter((b) => baseDark(b));
/** 旧链接 style=data 时 layer= 是这几种 */
const DARK_DATA = DATA_BASES.filter((b) => baseDark(b));
/** 旧链接没有 style= 时 layer= 是这几种图层 */
const DARK_LAYERS = MAP_LAYERS.filter((l) => l.dark).map((l) => l.id);

/**
 * 照网址打开时界面是不是深色的(src/ui/App.tsx 的 readUrl + 主题那几行):新建界面(new=1)是深色的;
 * 底图看 map= / fill=(新链接)、style= / layer=(旧链接)。加载画面里那一句是照它写的(单测逐个网址对)
 */
export function urlDark(search: string): boolean {
  const q = new URLSearchParams(search);
  if (q.get('new') === '1') return true;
  const mv = mapViewFromUrl(q);
  if (mv) return baseDark(mv.base);
  // 带 style= 的旧链接(只有 civ= 的也走到这里,是手绘):写实 = 卫星;数据图层看 layer=
  const style = q.get('style');
  if (style === 'realistic') return true;
  const layer = q.get('layer');
  if (style === 'data') return isBaseId(layer) && (DATA_BASES as string[]).includes(layer) && baseDark(layer);
  return false;
}

/**
 * 加载画面那一段代码(还没压缩)。files = 页面一打开要下的文件(LoadFile)。
 * 给页面的代码留三个口子(window.__ld):done() 淡出、fail() 换成「重新加载」、app(cb) 下载主程序并数着下了多少(cb 收到 0–1)
 */
export function loadScreenScript(files: LoadFile[]): string {
  const json = JSON.stringify;
  return `var ${FILES_VAR} = ${json(files)};
(function () {
  // 这一段写在 <head> 里(网站图标那几行前面,好早一点开始下载),那一块(#ld)在 <body> 里,用到时再找
  var d = document, w = window, H = d.documentElement, ran = 0, out = 0, tick;
  function el() {
    return d.getElementById('ld');
  }
  // 淡出、拿掉(首页或主程序挂上以后,页面的代码叫)
  function done() {
    if (out++) return;
    clearInterval(tick);
    var e = el();
    if (e) e.className = 'out';
    setTimeout(function () {
      if (e && e.parentNode) e.parentNode.removeChild(e);
      H.classList.remove('ld-dk');
    }, 250);
  }
  w.__ld = { done: done, fail: function () {} };
  // 交给浏览器:先放上样式表,样式到了再跑页面的入口代码(和以前写在页面里时一样,首页出来时样式已经在了)。
  // 这时文件都在浏览器缓存里,不会再下一遍;入口代码先 modulepreload,和样式表同时从缓存里取
  function run() {
    if (ran++) return;
    var css = [], js = [], left;
    ${FILES_VAR}.forEach(function (f) {
      if (f[3] == 2) css.push(f[0]);
      if (f[3] == 1) js.push(f[0]);
    });
    function add(tag, rel, url) {
      var e = d.createElement(tag);
      if (rel) {
        e.rel = rel;
        e.href = url;
      } else {
        e.type = 'module';
        e.src = url;
      }
      e.crossOrigin = '';
      d.head.appendChild(e);
      return e;
    }
    function go() {
      if (--left > 0) return;
      js.forEach(function (u) {
        add('script', '', u).onerror = function () {
          w.__ld.fail();
        };
      });
    }
    js.forEach(function (u) {
      add('link', 'modulepreload', u);
    });
    left = css.length || 1;
    css.forEach(function (u) {
      var e = add('link', 'stylesheet', u);
      e.onload = e.onerror = go;
    });
    if (!css.length) go();
  }
  // 这一段出了任何错(浏览器太旧之类):直接交给浏览器,和以前一样打开,只是没有进度
  try {
    main();
  } catch (e) {
    run();
  }
  function main() {
    var L = location, q = new URLSearchParams(L.search), s = history.state, home = !L.hash.replace(/^#/, '');
    // 只是打开首页(和 homeStart.ts 的 plainHome 同一个判断):网址后面没有别的事,这一步也不是浏览器记着的某个世界 / 新建
    q.forEach(function (v, k) {
      if (${json(HARMLESS)}.indexOf(k) < 0) home = false;
    });
    if (s && typeof s == 'object' && s.wf === 1 && s.page !== 'home') home = false;
    // 深色:新建界面;网址里是深色底图(新链接 map= / fill=,旧链接 style= / layer=)
    var m = q.get('map'), y = q.get('style'), l = q.get('layer');
    if (q.get('new') == '1' || (m != null || q.get('fill') != null ? ${json(DARK_BASES)}.indexOf(m) > -1 : y ? y == 'realistic' || (y == 'data' && ${json(DARK_DATA)}.indexOf(l) > -1) : ${json(DARK_LAYERS)}.indexOf(l) > -1)) H.classList.add('ld-dk');
    // 不是首页:主程序也一起下、一起算进度
    var F = ${FILES_VAR}.filter(function (f) {
        return f[3] != 3 || !home;
      }),
      A = ${FILES_VAR}.filter(function (f) {
        return f[3] == 3;
      })[0];
    var G = [], t0 = Date.now(), last = t0, st = '', shown = 1, need = 0, ap, cbs = [];
    var T = {
      slow: ['网络有点慢，已下载 <em></em>', '下好一次，以后再打开就快了'],
      long: ['还在下载，已下载 <em></em>', '比平常慢很多，等不及可以重新加载试试', ''],
      stuck: ['好一会儿没有动静了', '可能是网络断了，检查一下网络再重新加载', 'go'],
      fail: ['没能下载完', '网络断了，或者网站刚更新过，重新加载试试', 'go']
    };
    // 下了百分之几:各个文件按份量(压过以后的大小)加起来
    function pct() {
      var g = 0, t = 0;
      F.forEach(function (f, i) {
        t += f[2];
        g += f[2] * Math.min(1, (G[i] || 0) / f[1]);
      });
      return t ? Math.floor((g / t) * 100) : 0;
    }
    function draw() {
      var e = el(), p = pct(), m;
      if (!e) return;
      e.querySelector('s').style.width = Math.max(3, p) + '%';
      m = e.querySelector('em');
      if (m) m.textContent = p + '%';
    }
    function moved() {
      last = Date.now();
      draw();
    }
    // 换一种说法;「重新加载」= 刷新页面(已经下好的文件在浏览器缓存里,不用重下)
    function say(k) {
      var t = T[k], e = el(), p, b;
      st = k;
      shown = !!e;
      if (!e) return;
      p = e.querySelector('p');
      p.innerHTML = t[0] + '<small>' + t[1] + '</small>' + (t[2] != null ? '<button class="' + t[2] + '">重新加载</button>' : '');
      b = p.querySelector('button');
      if (b)
        b.onclick = function () {
          L.reload();
        };
      draw();
    }
    function fail() {
      if (!out) say('fail');
    }
    // 一边下一边数(on 收到这次多下的字节数)。拿不到数据流的浏览器:下完一次算
    function get(f, on) {
      return fetch(f[0], { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw Error(r.status);
        if (!r.body || !r.body.getReader)
          return r.arrayBuffer().then(function (b) {
            on(b.byteLength);
          });
        var rd = r.body.getReader();
        return (function pump() {
          return rd.read().then(function (x) {
            if (x.done) return;
            on(x.value.length);
            return pump();
          });
        })();
      });
    }
    // 主程序:只下一次,几处要的拿同一个(没下成功的,下次叫时重来)
    function app(cb) {
      if (cb) cbs.push(cb);
      if (!ap) {
        var got = 0;
        ap = get(A, function (n) {
          got += n;
          cbs.forEach(function (c) {
            c(Math.min(1, got / A[1]));
          });
        });
        ap.then(null, function () {
          ap = null;
        });
      }
      return ap;
    }
    if (!w.fetch) return run();
    w.__ld = { done: done, fail: fail, app: app };
    // 8 秒多一句;1 分钟给灰色「重新加载」;15 秒一点没动给蓝色的(又动起来了:留着灰色的,不再收回)
    tick = setInterval(function () {
      if (!shown) say(st);
      if (st == 'fail') return;
      var now = Date.now(),
        k = now - last > 15e3 ? 'stuck' : now - t0 > 6e4 || st == 'stuck' || st == 'long' ? 'long' : now - t0 > 8e3 ? 'slow' : '';
      if (k && k != st) say(k);
    }, 1e3);
    F.forEach(function (f, i) {
      if (f[3] != 3) need++;
      (f[3] == 3
        ? app(function (x) {
            G[i] = x * f[1];
            moved();
          })
        : get(f, function (n) {
            G[i] = (G[i] || 0) + n;
            moved();
          })
      ).then(
        function () {
          if (f[3] != 3 && !--need) run();
        },
        function () {
          fail();
          run();
        }
      );
    });
  }
})();
`;
}

/** 从构建好的页面里读出写进去的文件清单(没有 = null) */
export function loadFilesIn(html: string): LoadFile[] | null {
  const m = new RegExp(`${FILES_VAR}\\s*=\\s*(\\[\\[.*?\\]\\])`).exec(html);
  return m ? (JSON.parse(m[1]) as LoadFile[]) : null;
}

/** Vite 写进页面的入口代码、样式表、预先下载的代码 */
const ENTRY_TAG = /[ \t]*<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"[^>]*><\/script>\n?/g;
const LINK_TAG = /[ \t]*<link\b[^>]*\brel="(stylesheet|modulepreload)"[^>]*\bhref="([^"]+)"[^>]*>\n?/g;

type Bundle = Record<string, { type: 'chunk'; code: string; isDynamicEntry: boolean; name: string; fileName: string } | { type: 'asset'; source: string | Uint8Array; fileName: string }>;

/**
 * 把构建好的页面改成先出加载画面:去掉 Vite 写进去的入口代码、样式表(改由加载画面数着下好再放上),
 * 文件清单(连同主程序那一份)、样式、那一块、那一段代码写进去。bundle = 构建结果(查每个文件多大)。
 * 样式和那一段代码紧跟在 <title> 后面(网站图标写进页面以后有好几 KB,放在它们前面,线路很慢时也能早一点开始下载),
 * 那一块放在 <body> 最前面
 */
export async function withLoadScreen(html: string, bundle: Bundle, faviconSvg: string, minify = true): Promise<{ html: string; tags: HtmlTagDescriptor[] }> {
  const files: LoadFile[] = [];
  const sizeOf = (url: string, kind: LoadFile[3]): LoadFile => {
    const f = bundle[url.replace(/^\.?\//, '')];
    if (!f) throw new Error(`加载画面:页面引用的 ${url} 不在构建结果里`);
    const buf = Buffer.from(f.type === 'chunk' ? f.code : f.source);
    return [url, buf.length, gzipSync(buf, { level: 9 }).length, kind];
  };
  let rest = html.replace(ENTRY_TAG, (_t, src: string) => {
    files.push(sizeOf(src, 1));
    return '';
  });
  rest = rest.replace(LINK_TAG, (_t, rel: string, href: string) => {
    files.push(sizeOf(href, rel === 'stylesheet' ? 2 : 0));
    return '';
  });
  if (!files.some((f) => f[3] === 1)) throw new Error('加载画面:页面里没找到入口代码(<script type="module" src=...>),Vite 的写法可能改过');
  const app = Object.values(bundle).find((c) => c.type === 'chunk' && c.isDynamicEntry && c.name === 'App');
  if (!app) throw new Error('加载画面:构建结果里没找到主程序(App)那一份,src/ui/Boot.tsx 的写法可能改过');
  files.push(sizeOf(`./${app.fileName}`, 3));
  const src = loadScreenScript(files);
  const js = minify ? (await transformWithEsbuild(src, 'load-screen.js', { minify: true, target: 'es2015', charset: 'utf8' })).code.trim() : src;
  const title = rest.indexOf('</title>');
  if (title < 0) throw new Error('加载画面:页面里没有 <title>,样式和那一段代码不知道放哪');
  const at = title + '</title>'.length;
  return {
    html: `${rest.slice(0, at)}\n    <style>${LOAD_STYLE}</style>\n    <script>${js}</script>${rest.slice(at)}`,
    tags: [{ tag: 'div', attrs: { id: 'ld' }, children: loadScreenMarkup(faviconSvg), injectTo: 'body-prepend' }],
  };
}

/** Vite 插件:构建时把加载画面写进 index.html(开发时不写,页面照旧直接跑代码) */
export function loadScreenPlugin(): Plugin {
  let publicDir = '';
  return {
    name: 'load-screen',
    apply: 'build',
    configResolved(c) {
      publicDir = c.publicDir;
    },
    transformIndexHtml: {
      order: 'post',
      handler: (html, ctx) => withLoadScreen(html, (ctx.bundle ?? {}) as unknown as Bundle, readFileSync(join(publicDir, 'favicon.svg'), 'utf8')),
    },
  };
}
