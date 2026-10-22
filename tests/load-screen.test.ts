/**
 * 第一次打开时的加载画面(scripts/lib/loadScreen.ts):在假的页面里跑写进 index.html 的那一段代码,看它
 * 下哪几个文件、进度条走没走、慢了 / 卡住 / 出错时说什么、下好以后怎么交给浏览器(先样式表、样式到了再跑入口代码)、
 * 什么时候用深色(和 App 照网址打开时的主题一致),以及构建时怎么改写页面。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFilesIn, loadScreenMarkup, loadScreenScript, urlDark, withLoadScreen, type LoadFile } from '../scripts/lib/loadScreen';
import { plainHome } from '../src/ui/homeStart';

const JS = './assets/index-a.js';
const CSS = './assets/index-a.css';
const APP = './assets/App-a.js';
/** 入口代码 300 字节(份量 3)、样式表 100 字节(份量 1)、主程序 1000 字节(份量 4) */
const FILES: LoadFile[] = [
  [JS, 300, 3, 1],
  [CSS, 100, 1, 2],
  [APP, 1000, 4, 3],
];

/** 一个一点点给数据的下载(fetch 的回应) */
function download() {
  const queue: { done: boolean; value?: Uint8Array }[] = [];
  let wake: ((x: { done: boolean; value?: Uint8Array }) => void) | null = null;
  let fail: ((e: Error) => void) | null = null;
  const give = (x: { done: boolean; value?: Uint8Array }) => {
    if (wake) {
      const w = wake;
      wake = fail = null;
      w(x);
    } else queue.push(x);
  };
  const reader = {
    read: () =>
      new Promise<{ done: boolean; value?: Uint8Array }>((res, rej) => {
        if (queue.length) res(queue.shift()!);
        else {
          wake = res;
          fail = rej;
        }
      }),
  };
  return {
    res: { ok: true, status: 200, body: { getReader: () => reader } },
    push: (n: number) => give({ done: false, value: new Uint8Array(n) }),
    end: () => give({ done: true }),
    error: () => fail?.(new Error('网断了')),
  };
}

interface El {
  tag: string;
  rel?: string;
  href?: string;
  src?: string;
  type?: string;
  crossOrigin?: string;
  onload?: () => void;
  onerror?: () => void;
}

/** 在假的页面里跑加载画面那一段;返回能看、能拨的几样 */
function boot(o: { search?: string; hash?: string; state?: unknown; files?: LoadFile[]; script?: string; noFetch?: boolean; noSearchParams?: boolean; late?: boolean; parsing?: boolean } = {}) {
  const downloads = new Map<string, ReturnType<typeof download>>();
  const fetched: string[] = [];
  const head: El[] = [];
  const htmlClass = new Set<string>();
  let removed = false;
  /** 那一块在 <body> 里,那一段代码在 <head> 里先跑:late = 跑的时候那一块还没出来 */
  let attached = !o.late;
  /** parsing = 页面还没读完(document.readyState 是 loading) */
  const loaded: (() => void)[] = [];
  const msg = {
    html: '',
    em: null as { textContent: string } | null,
    btn: null as { onclick: null | (() => void) } | null,
    get innerHTML() {
      return this.html;
    },
    set innerHTML(v: string) {
      this.html = v;
      this.em = v.includes('<em>') ? { textContent: '' } : null;
      this.btn = v.includes('<button') ? { onclick: null } : null;
    },
    querySelector(sel: string) {
      return sel === 'em' ? this.em : sel === 'button' ? this.btn : null;
    },
  };
  const bar = { style: { width: '' } };
  const ld = {
    className: '',
    querySelector: (sel: string) => (sel === 's' ? bar : sel === 'p' ? msg : sel === 'em' ? msg.em : null),
    parentNode: {
      removeChild: () => {
        removed = true;
      },
    },
  };
  const win: Record<string, unknown> = {};
  const fetch = (url: string) => {
    fetched.push(url);
    const d = download();
    downloads.set(url, d);
    return Promise.resolve(d.res);
  };
  if (!o.noFetch) win.fetch = fetch;
  const location = { search: o.search ?? '', hash: o.hash ?? '', reload: vi.fn() };
  const env = {
    document: {
      readyState: o.parsing ? 'loading' : 'interactive',
      addEventListener: (type: string, f: () => void) => type === 'DOMContentLoaded' && loaded.push(f),
      documentElement: { classList: { add: (c: string) => htmlClass.add(c), remove: (c: string) => htmlClass.delete(c) } },
      getElementById: (id: string) => (id === 'ld' && attached ? ld : null),
      createElement: (tag: string) => ({ tag }) as El,
      head: { appendChild: (e: El) => head.push(e) },
    },
    window: win,
    location,
    history: { state: o.state ?? null },
    fetch,
    URLSearchParams: o.noSearchParams ? undefined : URLSearchParams,
  };
  new Function(...Object.keys(env), o.script ?? loadScreenScript(o.files ?? FILES))(...Object.values(env));
  const api = win.__ld as { done(): void; fail(): void; app?(cb: (x: number) => void): Promise<unknown> };
  return {
    ld,
    bar,
    msg,
    head,
    fetched,
    location,
    api,
    get removed() {
      return removed;
    },
    /** 用深色(<html> 上的标记) */
    dark: () => htmlClass.has('ld-dk'),
    /** 那一块出来了(页面往下读到了 <body>) */
    attach: () => {
      attached = true;
    },
    /** 页面读完了(DOMContentLoaded) */
    parsed: () => loaded.splice(0).forEach((f) => f()),
    /** url 这个文件再下 n 字节 */
    push: (url: string, n: number) => downloads.get(url)!.push(n),
    end: (url: string) => downloads.get(url)!.end(),
    error: (url: string) => downloads.get(url)!.error(),
    /** 页面上放了什么(样式表、预先下载、入口代码),按先后 */
    tags: () => head.map((e) => (e.tag === 'script' ? `script ${e.src}` : `${e.rel} ${e.href}`)),
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('加载画面:下载、进度、交给浏览器', () => {
  it('首页:只下入口代码和样式表,数着下了多少(按份量);下好以后先放样式表,样式到了才跑入口代码', async () => {
    const p = boot();
    expect(p.fetched).toEqual([JS, CSS]);
    expect(p.dark()).toBe(false);
    await flush();
    p.push(CSS, 100); // 样式表下完 = 份量 1 / 4
    await flush();
    expect(p.bar.style.width).toBe('25%');
    p.push(JS, 150); // 入口代码下了一半 = 1.5 / 4
    await flush();
    expect(p.bar.style.width).toBe('62%');
    p.end(CSS);
    await flush();
    expect(p.tags()).toEqual([]);
    p.push(JS, 150);
    p.end(JS);
    await flush();
    expect(p.bar.style.width).toBe('100%');
    // 入口代码先预先下载(从缓存里取),和样式表同时;样式到了才放 <script>
    expect(p.tags()).toEqual([`modulepreload ${JS}`, `stylesheet ${CSS}`]);
    expect(p.head.every((e) => e.crossOrigin === '')).toBe(true);
    p.head[1].onload!();
    expect(p.tags()).toEqual([`modulepreload ${JS}`, `stylesheet ${CSS}`, `script ${JS}`]);
    expect(p.head[2].type).toBe('module');
    // 首页挂上了:淡出,过一会儿拿掉
    p.api.done();
    expect(p.ld.className).toBe('out');
    expect(p.removed).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(p.removed).toBe(true);
  });

  it('页面还没读完(文件都从缓存里来得很快):等读完了再跑入口代码,免得 #root 还没有', async () => {
    const p = boot({ parsing: true });
    await flush();
    for (const u of [JS, CSS]) p.end(u);
    await flush();
    p.head[1].onload!();
    expect(p.tags()).not.toContain(`script ${JS}`);
    p.parsed();
    expect(p.tags()).toContain(`script ${JS}`);
  });

  it('样式表没下成也照样跑入口代码', async () => {
    const p = boot();
    await flush();
    for (const u of [JS, CSS]) p.end(u);
    await flush();
    p.head[1].onerror!();
    expect(p.tags()).toContain(`script ${JS}`);
  });

  it('不是首页(和 plainHome 同一个判断):主程序也一起下、一起算进度;入口代码不等主程序', async () => {
    for (const search of ['', '?play=0', '?ai=mock&lon=30', '?seed=7', '?w=wabc', '?map=satellite', '?new=1&seed=7', '?s=abcd']) {
      expect(boot({ search }).fetched.includes(APP), search).toBe(!plainHome({ search, hash: '' }, null));
    }
    expect(boot({ hash: '#v1abc' }).fetched).toContain(APP);
    expect(boot({ state: { wf: 1, page: 'world', id: 'wabc' } }).fetched).toContain(APP);
    expect(boot({ state: { wf: 1, page: 'home' } }).fetched).not.toContain(APP);

    const p = boot({ search: '?seed=7' });
    await flush();
    for (const u of [JS, CSS]) {
      p.push(u, u === JS ? 300 : 100);
      p.end(u);
    }
    await flush();
    // 入口、样式表下完 = 4 / 8;主程序还在下,入口代码照样交给浏览器
    expect(p.bar.style.width).toBe('50%');
    p.head[1].onload!();
    expect(p.tags()).toContain(`script ${JS}`);
    // 页面的代码要主程序:拿的是同一个下载(不再 fetch 一次),接着数
    const seen: number[] = [];
    const done = p.api.app!((x) => seen.push(x));
    expect(p.fetched.filter((u) => u === APP)).toHaveLength(1);
    p.push(APP, 500);
    await flush();
    expect(seen).toEqual([0.5]);
    expect(p.bar.style.width).toBe('75%');
    p.push(APP, 500);
    p.end(APP);
    await flush();
    await expect(done).resolves.toBeUndefined();
    expect(p.bar.style.width).toBe('100%');
  });

  it('首页:主程序等页面的代码来要时才下,只下一次;没下成的下次再要时重来', async () => {
    const p = boot();
    expect(p.fetched).not.toContain(APP);
    const a = p.api.app!(() => {});
    const b = p.api.app!(() => {});
    expect(a).toBe(b);
    expect(p.fetched.filter((u) => u === APP)).toHaveLength(1);
    await flush();
    p.error(APP);
    await expect(a).rejects.toThrow();
    await flush();
    p.api.app!(() => {});
    expect(p.fetched.filter((u) => u === APP)).toHaveLength(2);
  });
});

describe('加载画面:慢了、卡住、出错', () => {
  it('8 秒多一句下了多少;15 秒一点没动给蓝色「重新加载」;又动起来了留着灰色的', async () => {
    const p = boot();
    await flush();
    p.push(JS, 120);
    await vi.advanceTimersByTimeAsync(7000);
    expect(p.msg.innerHTML).toBe('');
    await vi.advanceTimersByTimeAsync(2000);
    expect(p.msg.innerHTML).toContain('网络有点慢，已下载 <em></em>');
    expect(p.msg.innerHTML).toContain('下好一次，以后再打开就快了');
    expect(p.msg.innerHTML).not.toContain('button');
    expect(p.msg.em?.textContent).toBe('30%');
    p.push(JS, 40);
    await flush();
    expect(p.msg.em?.textContent).toBe('40%');
    // 最后一次有动静是第 9 秒:过了 15 秒(第 25 秒那一下)算卡住
    await vi.advanceTimersByTimeAsync(15_500);
    expect(p.msg.innerHTML).not.toContain('button');
    await vi.advanceTimersByTimeAsync(1000);
    expect(p.msg.innerHTML).toContain('好一会儿没有动静了');
    expect(p.msg.innerHTML).toContain('<button class="go">重新加载</button>');
    p.push(JS, 10);
    await vi.advanceTimersByTimeAsync(1000);
    expect(p.msg.innerHTML).toContain('还在下载，已下载 <em></em>');
    expect(p.msg.innerHTML).toContain('<button class="">重新加载</button>');
    // 点「重新加载」= 刷新页面
    p.msg.btn!.onclick!();
    expect(p.location.reload).toHaveBeenCalledTimes(1);
  });

  it('1 分钟了还在下:灰色「重新加载」,不催', async () => {
    const p = boot();
    await flush();
    for (let s = 0; s < 61; s += 5) {
      p.push(JS, 1);
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(p.msg.innerHTML).toContain('还在下载，已下载');
    expect(p.msg.innerHTML).toContain('比平常慢很多，等不及可以重新加载试试');
    expect(p.msg.innerHTML).toContain('<button class="">重新加载</button>');
  });

  it('下载出错:马上给蓝色「重新加载」,照样交给浏览器试一次', async () => {
    const p = boot();
    await flush();
    p.error(JS);
    await flush();
    expect(p.msg.innerHTML).toContain('没能下载完');
    expect(p.msg.innerHTML).toContain('<button class="go">重新加载</button>');
    expect(p.tags()).toContain(`stylesheet ${CSS}`);
    // 出错了就停在这里,不再换成别的说法
    await vi.advanceTimersByTimeAsync(70_000);
    expect(p.msg.innerHTML).toContain('没能下载完');
  });

  it('那一段在 <head> 里先跑:那一块还没出来时出的错,等它出来补上;深色的淡出以后拿掉标记', async () => {
    const p = boot({ late: true, search: '?map=satellite&seed=7' });
    expect(p.dark()).toBe(true);
    await flush();
    p.error(JS);
    await flush();
    expect(p.msg.innerHTML).toBe('');
    p.attach();
    await vi.advanceTimersByTimeAsync(1000);
    expect(p.msg.innerHTML).toContain('没能下载完');
    const q = boot({ search: '?map=satellite&seed=7' });
    q.api.done();
    expect(q.dark()).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(q.dark()).toBe(false);
  });

  it('页面的代码说主程序下不下来:换成「重新加载」;已经淡出的不再出来', async () => {
    const p = boot({ search: '?seed=7' });
    p.api.fail();
    expect(p.msg.innerHTML).toContain('没能下载完');
    const q = boot();
    q.api.done();
    q.api.fail();
    expect(q.msg.innerHTML).toBe('');
  });

  it('浏览器没有 fetch、这一段出了错:直接交给浏览器,和以前一样打开(淡出照样能叫)', () => {
    for (const p of [boot({ noFetch: true }), boot({ noSearchParams: true })]) {
      expect(p.fetched).toEqual([]);
      expect(p.tags()).toEqual([`modulepreload ${JS}`, `stylesheet ${CSS}`]);
      p.head[1].onload!();
      expect(p.tags()).toContain(`script ${JS}`);
      p.api.done();
      expect(p.ld.className).toContain('out');
    }
  });
});

describe('加载画面:深色跟着接下来打开的页面', () => {
  const urls = [
    '',
    '?seed=7',
    '?new=1&seed=7',
    '?new=image',
    '?map=satellite',
    '?map=satellite&sat=detail',
    '?map=geo',
    '?map=blank',
    '?map=elevation&fill=none',
    '?map=precipitation',
    '?map=temperature',
    '?map=biomes',
    '?map=nonsense',
    '?fill=cultures',
    '?seed=7&style=realistic',
    '?style=realistic&map=fantasy',
    '?style=data&layer=elevation',
    '?style=data&layer=precipitation',
    '?style=data&layer=temperature',
    '?style=data&layer=political',
    '?style=fantasy&layer=elevation',
    '?layer=realistic',
    '?layer=elevation',
    '?layer=precipitation',
    '?layer=political',
    '?layer=faith',
    '?civ=polities',
    '?civ=polities&layer=elevation',
  ];

  it('深色底图(卫星、地理图、高程、降水)、新建界面用深色;别的浅色', () => {
    expect(urlDark('?map=satellite')).toBe(true);
    expect(urlDark('?map=geo')).toBe(true);
    expect(urlDark('?new=1')).toBe(true);
    expect(urlDark('?style=realistic')).toBe(true);
    expect(urlDark('?layer=elevation')).toBe(true);
    expect(urlDark('')).toBe(false);
    expect(urlDark('?map=blank')).toBe(false);
    expect(urlDark('?style=data&layer=temperature')).toBe(false);
  });

  it('页面里那一句和 urlDark 逐个网址一致', () => {
    for (const search of urls) expect(boot({ search }).dark(), search).toBe(urlDark(search));
  });
});

describe('构建时改写页面', () => {
  const html = `<!doctype html>
<html>
  <head>
    <title>文明与地图</title>
    <link rel="icon" href="data:image/svg+xml;base64,AAAA" type="image/svg+xml" />
    <script type="module" crossorigin src="./assets/index-a.js"></script>
    <link rel="modulepreload" crossorigin href="./assets/vendor-a.js">
    <link rel="stylesheet" crossorigin href="./assets/index-a.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;
  const bundle = {
    'assets/index-a.js': { type: 'chunk' as const, code: 'x'.repeat(3000), isDynamicEntry: false, name: 'index', fileName: 'assets/index-a.js' },
    'assets/vendor-a.js': { type: 'chunk' as const, code: '文'.repeat(100), isDynamicEntry: false, name: 'vendor', fileName: 'assets/vendor-a.js' },
    'assets/App-a.js': { type: 'chunk' as const, code: 'y'.repeat(5000), isDynamicEntry: true, name: 'App', fileName: 'assets/App-a.js' },
    'assets/index-a.css': { type: 'asset' as const, source: 'z'.repeat(1000), fileName: 'assets/index-a.css' },
  };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><clipPath id="a-disk"><circle r="46"/></clipPath></defs><g clip-path="url(#a-disk)" stroke="#ffffff"/></svg>';

  it('去掉页面里的入口代码、样式表、预先下载,文件清单(原大小、份量、哪一种)连同主程序写进那一段', async () => {
    const out = await withLoadScreen(html, bundle, svg, false);
    expect(out.html).not.toMatch(/<script\b[^>]*src=/);
    expect(out.html).not.toMatch(/rel="(stylesheet|modulepreload)"/);
    expect(out.html).toContain('rel="icon"');
    // 样式、那一段代码紧跟 <title>,在网站图标前面
    expect(out.html.indexOf('<style>#ld{')).toBeGreaterThan(out.html.indexOf('</title>'));
    expect(out.html.indexOf('<script>var __ldFiles')).toBeGreaterThan(out.html.indexOf('<style>#ld{'));
    expect(out.html.indexOf('<script>var __ldFiles')).toBeLessThan(out.html.indexOf('rel="icon"'));
    const files = loadFilesIn(out.html)!;
    expect(files.map((f) => [f[0], f[1], f[3]])).toEqual([
      ['./assets/index-a.js', 3000, 1],
      ['./assets/vendor-a.js', 300, 0],
      ['./assets/index-a.css', 1000, 2],
      ['./assets/App-a.js', 5000, 3],
    ]);
    expect(files.every((f) => f[2] > 0 && f[2] < f[1])).toBe(true);
    expect(out.tags.map((t) => [t.tag, t.attrs?.id, t.injectTo])).toEqual([['div', 'ld', 'body-prepend']]);
  });

  it('压缩以后的那一段照样能用(首页:下好、交给浏览器、淡出)', async () => {
    const out = await withLoadScreen(html, bundle, svg);
    const script = /<script>(var __ldFiles[\s\S]*?)<\/script>/.exec(out.html)![1];
    expect(script.length).toBeLessThan(loadScreenScript(loadFilesIn(script)!).length);
    // 界面上的中文原样留着(不转成 \\u 编码,页面小一点)
    expect(script).toContain('网络有点慢');
    const p = boot({ script });
    expect(p.fetched).toEqual(['./assets/index-a.js', './assets/vendor-a.js', './assets/index-a.css']);
    await flush();
    for (const u of p.fetched) p.end(u);
    await flush();
    expect(p.tags()).toEqual(['modulepreload ./assets/index-a.js', 'stylesheet ./assets/index-a.css']);
    p.head[1].onload!();
    expect(p.tags()).toContain('script ./assets/index-a.js');
    const q = boot({ script, search: '?map=geo&seed=7' });
    expect(q.dark()).toBe(true);
    expect(q.fetched).toContain('./assets/App-a.js');
  });

  it('网站图标照 public/favicon.svg 画,里面的 id 换个前缀', () => {
    const m = loadScreenMarkup(svg);
    expect(m).toMatch(/^<svg aria-hidden="true" viewBox="0 0 100 100">/);
    expect(m).toContain('id="ld-disk"');
    expect(m).toContain('url(#ld-disk)');
    expect(m).not.toContain('a-disk');
    expect(m).toContain('<b>文明与地图</b><i role="progressbar" aria-label="正在载入"><s></s></i><p aria-live="polite"></p>');
  });

  it('构建结果里找不到入口代码、主程序、引用的文件:构建失败', async () => {
    await expect(withLoadScreen('<html><head></head><body></body></html>', bundle, svg, false)).rejects.toThrow(/入口代码/);
    const { ['assets/App-a.js']: _app, ...noApp } = bundle;
    await expect(withLoadScreen(html, noApp, svg, false)).rejects.toThrow(/主程序/);
    const { ['assets/index-a.css']: _css, ...noCss } = bundle;
    await expect(withLoadScreen(html, noCss, svg, false)).rejects.toThrow(/index-a\.css/);
  });
});
