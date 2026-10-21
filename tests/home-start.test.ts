/**
 * 打开网页时先出首页、主程序在后台下载(src/ui/Boot.tsx):什么时候算"只是打开首页"(src/ui/homeStart.ts 的 plainHome)。
 * 只有网址后面没有别的事、这一步也不是浏览器记着的某个世界时才先出首页;别的一律直接交给主程序按网址打开。
 * index.html 里最先跑的那一段(bootScript)是同一个判断:不是首页时主程序和页面代码一起下。
 * 首页上主程序等首页要的图下好了再下(src/ui/homeLoad.ts)。
 */
import { describe, expect, it, vi } from 'vitest';
import { afterHomeLoad, holdHomeLoad } from '../src/ui/homeLoad';
import { bootScript, plainHome } from '../src/ui/homeStart';

const at = (search: string, hash = '') => ({ search, hash });
const nav = (page: string, id?: string) => ({ wf: 1, idx: 0, bare: 0, prev: false, page, ...(id ? { id } : {}) });

describe('plainHome', () => {
  it('网址后面什么都没有:首页', () => {
    expect(plainHome(at(''), null)).toBe(true);
    expect(plainHome(at('?'), null)).toBe(true);
    expect(plainHome(at('', '#'), null)).toBe(true);
  });

  it('不碍事的几样(地图正中的经线、创建后放不放历史、测试用的假 AI)照样先出首页', () => {
    expect(plainHome(at('?lon=104.5'), null)).toBe(true);
    expect(plainHome(at('?play=0'), null)).toBe(true);
    expect(plainHome(at('?ai=mock&aiServer=fake'), null)).toBe(true);
  });

  it('世界、新建、分享、邀请、图层投影:直接交给主程序', () => {
    for (const s of ['?seed=7', '?w=wabc', '?new=1', '?new=image', '?s=abcd', '?invite=x', '?map=satellite', '?fill=none', '?proj=globe', '?style=fantasy', '?civ=polities', '?seed=7&play=0']) {
      expect(plainHome(at(s), null), s).toBe(false);
    }
    expect(plainHome(at('', '#v1abc'), null)).toBe(false);
  });

  it('刷新、后退回来的那一步记着世界 / 新建:交给主程序;记着首页的照样先出首页', () => {
    expect(plainHome(at(''), nav('world', 'wabc'))).toBe(false);
    expect(plainHome(at(''), nav('draft', 'wabc'))).toBe(false);
    expect(plainHome(at(''), nav('home'))).toBe(true);
    // 别的东西放进 history.state 的不认
    expect(plainHome(at(''), { page: 'world' })).toBe(true);
  });
});

/** 在假的页面里跑一遍 bootScript:返回它提前要了什么 */
function runBoot(o: { search?: string; hash?: string; state?: unknown }) {
  const got: string[] = [];
  const link: Record<string, string> = {};
  const env = {
    location: { pathname: '/', search: o.search ?? '', hash: o.hash ?? '' },
    history: { state: o.state ?? null },
    URLSearchParams,
    document: {
      createElement: () => link,
      head: { appendChild: () => got.push(`${link.rel} ${link.href}`) },
    },
  };
  new Function(...Object.keys(env), bootScript('./assets/App-x.js'))(...Object.values(env));
  return got;
}

describe('bootScript', () => {
  it('打开的就是首页:什么都不多下', () => {
    expect(runBoot({})).toEqual([]);
    expect(runBoot({ search: '?lon=30' })).toEqual([]);
    expect(runBoot({ state: nav('home') })).toEqual([]);
  });

  it('不是首页:主程序和页面代码一起下(和 plainHome 同一个判断)', () => {
    expect(runBoot({ search: '?seed=7' })).toEqual(['modulepreload ./assets/App-x.js']);
    expect(runBoot({ hash: '#v1abc' })).toEqual(['modulepreload ./assets/App-x.js']);
    expect(runBoot({ state: nav('world', 'wabc') })).toEqual(['modulepreload ./assets/App-x.js']);
    for (const search of ['', '?play=0', '?ai=mock', '?seed=7', '?w=wabc', '?map=satellite', '?new=1&seed=7']) {
      expect(runBoot({ search }).length > 0, search).toBe(!plainHome(at(search), null));
    }
  });
});

describe('afterHomeLoad', () => {
  it('首页的图下好了才做;没有在下的下一轮马上做;最多等 maxMs', () => {
    vi.useFakeTimers();
    try {
      const done: string[] = [];
      afterHomeLoad(() => done.push('马上'), 10_000);
      vi.advanceTimersByTime(0);
      expect(done).toEqual(['马上']);

      const loaded = holdHomeLoad();
      afterHomeLoad(() => done.push('等图'), 10_000);
      vi.advanceTimersByTime(5000);
      expect(done).toEqual(['马上']);
      loaded();
      loaded();
      expect(done).toEqual(['马上', '等图']);

      const stuck = holdHomeLoad();
      afterHomeLoad(() => done.push('等太久'), 10_000);
      vi.advanceTimersByTime(10_000);
      expect(done).toEqual(['马上', '等图', '等太久']);
      stuck();
      expect(done).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
