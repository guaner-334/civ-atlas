/**
 * 浏览器的后退、前进(src/ui/nav.ts):换一个假的 history,看每一步记成什么、按后退 / 前进换到哪。
 * 浏览器的 history.go 是过一会儿才到的(popstate),假的也一样:flush() 才到。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetNav, getNav, navAdopt, navBack, navLayer, navReplace, navSettled, navTitle, navTo, navUrl, startNav, type NavHooks, type NavLayer, type NavState } from '../src/ui/nav';

class FakeHistory {
  list: { state: unknown; url: string }[] = [{ state: null, url: '/' }];
  i = 0;
  queue: number[] = [];
  listeners = new Set<(e: { state: unknown }) => void>();
  get state() {
    return this.list[this.i].state;
  }
  pushState(s: unknown, _t: string, url: string) {
    this.list.splice(this.i + 1);
    this.list.push({ state: structuredClone(s), url });
    this.i++;
  }
  replaceState(s: unknown, _t: string, url: string) {
    this.list[this.i] = { state: structuredClone(s), url };
  }
  go(n: number) {
    this.queue.push(n);
  }
  /** 用户按后退 / 前进 */
  back() {
    this.go(-1);
    this.flush();
  }
  forward() {
    this.go(1);
    this.flush();
  }
  flush() {
    while (this.queue.length) {
      const n = this.queue.shift()!;
      const j = Math.max(0, Math.min(this.list.length - 1, this.i + n));
      if (j === this.i) continue;
      this.i = j;
      for (const f of [...this.listeners]) f({ state: structuredClone(this.list[j].state) });
    }
  }
}

type G = { history?: unknown; location?: unknown; addEventListener?: unknown; removeEventListener?: unknown };
const g = globalThis as G;
const saved: G = {};
let h: FakeHistory;

/** 假的 App:记下 route / apply 被叫到的样子 */
function app(opts: { skip?: (to: NavState) => boolean } = {}) {
  const log: string[] = [];
  const applied: NavLayer[] = [];
  /** 离开画面时问过几次名字(App 这时记下没存着的世界) */
  const left = { n: 0 };
  /** 换了画面、世界还在生成 */
  let loading = false;
  const hooks: NavHooks = {
    route(to, _from, dir) {
      log.push(`${dir < 0 ? '后退' : '前进'}:${to.page}${to.id ? ' ' + to.id : ''}${to.seed !== undefined ? ' #' + to.seed : ''}`);
      if (opts.skip?.(to)) return 'skip';
      // App 换画面时照常调 navTo(这时只改这一步记的东西)
      navTo({ page: to.page, id: to.id, seed: to.seed });
      loading = true;
    },
    describe: () => {
      left.n++;
      return { title: '落日洋', stored: true };
    },
    settled: () => (loading || getNav()?.page !== 'world' ? null : getNav()!.id!),
    apply(l) {
      applied.push(l);
      return l;
    },
  };
  return {
    hooks,
    log,
    applied,
    left,
    /** 世界生成好了 */
    settle(id: string) {
      loading = false;
      navSettled(id);
    },
  };
}

const at = () => getNav()!;
const polity = (k: string): NavLayer => ({ sel: { kind: 'polity', id: 1, key: k } });

beforeEach(() => {
  for (const k of ['history', 'location', 'addEventListener', 'removeEventListener'] as const) saved[k] = g[k];
  h = new FakeHistory();
  g.history = h;
  g.location = {
    get href() {
      return h.list[h.i].url;
    },
  };
  g.addEventListener = (_t: string, f: (e: { state: unknown }) => void) => h.listeners.add(f);
  g.removeEventListener = (_t: string, f: (e: { state: unknown }) => void) => h.listeners.delete(f);
  _resetNav();
});

afterEach(() => {
  _resetNav();
  for (const k of ['history', 'location', 'addEventListener', 'removeEventListener'] as const) g[k] = saved[k];
});

describe('后退:三个画面之间', () => {
  it('我的世界 → 世界 → 我的世界 → 另一个世界:一步步退回来,前进再走回去', () => {
    const a = app();
    startNav({ page: 'home' }, a.hooks);
    navTo({ page: 'world', id: 'A' });
    navTo({ page: 'home' });
    navTo({ page: 'world', id: 'B' });
    expect(h.list.length).toBe(4);
    expect(at()).toMatchObject({ page: 'world', id: 'B', idx: 3, prev: true });
    // 离开时记下名字、存没存着
    expect(h.list[1].state).toMatchObject({ page: 'world', id: 'A', title: '落日洋', stored: true });
    h.back();
    h.back();
    h.back();
    expect(a.log).toEqual(['后退:home', '后退:world A', '后退:home']);
    expect(at()).toMatchObject({ page: 'home', idx: 0, prev: false });
    h.forward();
    expect(a.log.at(-1)).toBe('前进:world A');
    // 按后退换画面时不多记一步
    expect(h.list.length).toBe(4);
  });

  it('按后退 / 前进离开一个世界也让 App 记下它(没存着的世界再回来时照原样打开);同一个世界里换卡片、从我的世界离开不算', () => {
    const a = app();
    startNav({ page: 'home' }, a.hooks);
    navTo({ page: 'world', id: 'A' });
    navTo({ page: 'world', id: 'B' });
    expect(a.left.n).toBe(1);
    h.back();
    expect(a.left.n).toBe(2);
    a.settle('A');
    navLayer(polity('p1'));
    h.back();
    expect(a.left.n).toBe(2);
    h.back();
    expect(at()).toMatchObject({ page: 'home' });
    expect(a.left.n).toBe(3);
    // 从我的世界离开:没有世界可记(手上那个世界可能已经删了)
    h.forward();
    expect(at()).toMatchObject({ page: 'world', id: 'A' });
    expect(a.left.n).toBe(3);
  });

  it('地址栏里贴了只有 # 不同的分享链接(浏览器自己记了一步):也让 App 记下要离开的世界', () => {
    const a = app();
    startNav({ page: 'home' }, a.hooks);
    navTo({ page: 'world', id: 'A' });
    expect(a.left.n).toBe(0);
    h.pushState(h.state, '', '/#share=x');
    navAdopt({ page: 'world', id: 'A' });
    expect(a.left.n).toBe(1);
    expect(at()).toMatchObject({ idx: 2, page: 'world', id: 'A', bare: 2 });
  });

  it('正在看的世界改了名:这一步记的名字跟着改(别的世界、我的世界不动)', () => {
    const a = app();
    startNav({ page: 'home' }, a.hooks);
    navTo({ page: 'world', id: 'A', title: '落日洋' });
    navTitle('A', '北境');
    expect(h.list[h.i].state).toMatchObject({ page: 'world', id: 'A', title: '北境' });
    navTitle('B', '别的');
    expect(at().title).toBe('北境');
    navTitle('A', undefined);
    expect(at().title).toBeUndefined();
    expect(h.list.length).toBe(2);
    navTo({ page: 'home' });
    navTitle('A', '北境');
    expect(at()).toMatchObject({ page: 'home' });
    expect(at().title).toBeUndefined();
  });

  it('还是同一个画面:不多记一步;只换网址不动这一步记的东西', () => {
    const a = app();
    startNav({ page: 'home' }, a.hooks);
    navTo({ page: 'home' });
    navTo({ page: 'world', id: 'A' });
    navTo({ page: 'world', id: 'A' });
    expect(h.list.length).toBe(2);
    navUrl('/?w=A&layer=political');
    expect(h.list[1]).toMatchObject({ url: '/?w=A&layer=political', state: { page: 'world', id: 'A' } });
  });

  it('打开网页:刷新时接着用上次记的序号;别人放进 history 的东西不认', () => {
    h.list[0].state = { wf: 1, idx: 4, page: 'world', id: 'A', bare: 2, prev: true, layer: polity('p') };
    startNav({ page: 'world', id: 'A' }, app().hooks);
    expect(at()).toEqual({ wf: 1, idx: 4, page: 'world', id: 'A', bare: 4, prev: true });
    _resetNav();
    h.list[0].state = { foo: 1 };
    startNav({ page: 'home' }, app().hooks);
    expect(at()).toMatchObject({ idx: 0, prev: false });
  });

  it('地址栏里只改了 #(不是这个网站记的一步):不换画面', () => {
    const a = app();
    startNav({ page: 'home' }, a.hooks);
    navTo({ page: 'world', id: 'A' });
    h.pushState(null, '', '/#x');
    h.back();
    h.forward();
    expect(a.log).toEqual([]);
  });
});

describe('后退:新建世界', () => {
  it('换一颗算一步,后退换回上一颗', () => {
    const a = app();
    startNav({ page: 'home' }, a.hooks);
    navTo({ page: 'draft', id: 'D', seed: 1 });
    navTo({ page: 'draft', id: 'D', seed: 2 });
    navTo({ page: 'draft', id: 'D', seed: 2 });
    expect(h.list.length).toBe(3);
    h.back();
    expect(a.log).toEqual(['后退:draft D #1']);
    expect(at()).toMatchObject({ page: 'draft', id: 'D', seed: 1 });
  });

  it('建成了世界:按后退跳过新建那几步,回到进新建之前', () => {
    const a = app({ skip: (to) => to.page === 'draft' && to.id === 'D' });
    startNav({ page: 'home' }, a.hooks);
    navTo({ page: 'draft', id: 'D', seed: 1 });
    navTo({ page: 'draft', id: 'D', seed: 2 });
    navReplace({ page: 'world', id: 'D', title: '群星之海' });
    expect(at()).toMatchObject({ page: 'world', id: 'D', idx: 2 });
    h.back();
    expect(a.log).toEqual(['后退:draft D #1', '后退:home']);
    expect(at().page).toBe('home');
  });

  it('左上的返回:前面就是那个画面 = 退回去(中间换过的几颗星球一起退掉);不是 = false', () => {
    const a = app();
    startNav({ page: 'home' }, a.hooks);
    navTo({ page: 'draft', id: 'D', seed: 1 });
    navTo({ page: 'draft', id: 'D', seed: 2 });
    expect(navBack({ page: 'world', id: 'A' })).toBe(false);
    expect(navBack({ page: 'home' })).toBe(true);
    h.flush();
    expect(a.log).toEqual(['后退:home']);
    expect(at().idx).toBe(0);
    // 新开的页面直接进的新建:前面没有我的世界
    _resetNav();
    h = new FakeHistory();
    g.history = h;
    startNav({ page: 'draft', id: 'E', seed: 3 }, app().hooks);
    expect(navBack({ page: 'home' })).toBe(false);
  });
});

describe('后退:世界里的卡片、概览(每打开一样算一步)', () => {
  const open = () => {
    const a = app();
    startNav({ page: 'home' }, a.hooks);
    navTo({ page: 'world', id: 'A' });
    return a;
  };

  it('打开卡片记一步,后退一张张退回来,不换画面', () => {
    const a = open();
    navLayer({});
    navLayer(polity('p1'));
    navLayer({ sel: { kind: 'person', id: 9, key: 'h1' } });
    expect(h.list.length).toBe(4);
    expect(at()).toMatchObject({ idx: 3, bare: 1, layer: { sel: { kind: 'person' } } });
    h.back();
    expect(a.applied).toEqual([polity('p1')]);
    h.back();
    expect(a.applied.at(-1)).toEqual({});
    expect(a.log).toEqual([]);
    h.back();
    expect(a.log).toEqual(['后退:home']);
  });

  it('× / Esc 全收起:退回没开卡片的那一步,前进还能回去', () => {
    const a = open();
    navLayer(polity('p1'));
    navLayer(polity('p2'));
    navLayer({ ov: { tab: 'chronicle' } });
    expect(at().idx).toBe(4);
    navLayer({});
    h.flush();
    expect(at()).toMatchObject({ idx: 1, bare: 1 });
    expect(at().layer).toBeUndefined();
    expect(a.applied).toEqual([]);
    h.forward();
    expect(a.applied).toEqual([polity('p1')]);
  });

  it('只收起最上面那层、正好是前一步:退回前一步;概览换页、重推后编号变了:不记新的一步', () => {
    open();
    navLayer(polity('p1'));
    navLayer({ ...polity('p1'), ov: { tab: 'chronicle' } });
    navLayer({ ...polity('p1'), ov: { tab: 'people' } });
    expect(at()).toMatchObject({ idx: 3, layer: { ov: { tab: 'people' } } });
    navLayer(polity('p1'));
    h.flush();
    expect(at()).toMatchObject({ idx: 2, layer: polity('p1') });
    navLayer({ sel: { kind: 'polity', id: 5, key: 'p1' } });
    expect(at()).toMatchObject({ idx: 2, layer: { sel: { id: 5 } } });
    expect(h.list.length).toBe(4);
  });

  it('退回这个世界:世界生成好、历史推完了才打开记着的卡片;这之间不记卡片', () => {
    const a = open();
    navLayer(polity('p1'));
    navTo({ page: 'home' });
    h.back();
    expect(a.log).toEqual(['后退:world A']);
    expect(a.applied).toEqual([]);
    // 还没好:地图上的卡片变化不算
    navLayer({});
    expect(at()).toMatchObject({ idx: 2, layer: polity('p1') });
    a.settle('A');
    expect(a.applied).toEqual([polity('p1')]);
    navLayer(polity('p2'));
    expect(at().idx).toBe(3);
  });

  it('卡片指的东西在这份历史里没了:这一步记成实际打开的', () => {
    const a = app();
    a.hooks.apply = () => ({});
    startNav({ page: 'home' }, a.hooks);
    navTo({ page: 'world', id: 'A' });
    navLayer(polity('p1'));
    navLayer(polity('p2'));
    h.back();
    expect(at()).toMatchObject({ idx: 2 });
    expect(at().layer).toBeUndefined();
  });

  it('退回来的世界还没好就又走了:到下一个世界照常记卡片', () => {
    const a = open();
    navLayer(polity('p1'));
    navTo({ page: 'home' });
    h.back();
    navTo({ page: 'world', id: 'B' });
    a.settle('B');
    navLayer(polity('q1'));
    expect(at()).toMatchObject({ page: 'world', id: 'B', layer: polity('q1') });
  });

  it('史书:打开算一步;正在写的那部写完了(有了键)不多记', () => {
    open();
    navLayer({ book: '' });
    expect(at().idx).toBe(2);
    navLayer({ book: 'k1' });
    expect(at()).toMatchObject({ idx: 2, layer: { book: 'k1' } });
    navLayer({ book: 'k2' });
    expect(at().idx).toBe(3);
  });

  it('同一个世界里按后退 / 前进、× 退回没开卡片那一步:网址照现在的(图层这类看法、存下以后的 w=);换画面时只有看法照现在的', () => {
    const a = app();
    a.hooks.url = (from, to) => {
      const layer = new URLSearchParams(from.split('?')[1] ?? '').get('layer');
      const q = new URLSearchParams(to.split('?')[1] ?? '');
      if (layer === null) q.delete('layer');
      else q.set('layer', layer);
      return `/?${q}`;
    };
    h.list[0].url = '/?seed=1';
    startNav({ page: 'world', id: 'A' }, a.hooks);
    a.settle('A');
    navLayer(polity('p1'));
    // 开着卡片时改了第一笔:存下了,网址换成 w=
    navUrl('/?w=A&layer=terrain');
    navLayer({});
    h.flush();
    expect(at().idx).toBe(0);
    expect(h.list[0].url).toBe('/?w=A&layer=terrain');
    h.forward();
    expect(h.list[1].url).toBe('/?w=A&layer=terrain');
    navUrl('/?w=A&layer=cultures');
    h.back();
    expect(h.list[0].url).toBe('/?w=A&layer=cultures');
    // 换画面:那一步的网址,看法照现在的
    navTo({ page: 'home' });
    navUrl('/?layer=political');
    h.back();
    expect(at()).toMatchObject({ idx: 0, page: 'world', id: 'A' });
    expect(h.list[0].url).toBe('/?w=A&layer=political');
  });

  it('不在世界里时:卡片不记', () => {
    startNav({ page: 'draft', id: 'D', seed: 1 }, app().hooks);
    navLayer(polity('p1'));
    expect(h.list.length).toBe(1);
    expect(at().layer).toBeUndefined();
  });
});
