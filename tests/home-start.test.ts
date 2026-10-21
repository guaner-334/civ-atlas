/**
 * 打开网页时先出首页、主程序在后台下载(src/ui/Boot.tsx):什么时候算"只是打开首页"(src/ui/homeStart.ts 的 plainHome)。
 * 只有网址后面没有别的事、这一步也不是浏览器记着的某个世界时才先出首页;别的一律直接交给主程序按网址打开。
 * index.html 里最先跑的那一段(bootScript)是同一个判断:首页第一次来先下星球的图,不是首页时主程序和页面代码一起下。
 */
import { describe, expect, it } from 'vitest';
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

/** 在假的页面里跑一遍 bootScript:返回它要了什么(星球的图、提前下载的主程序) */
function runBoot(o: { path?: string; search?: string; hash?: string; state?: unknown; stored?: number }, appUrl: string | null = './assets/App-x.js') {
  const got: string[] = [];
  const link: Record<string, string> = {};
  const env = {
    location: { pathname: o.path ?? '/', search: o.search ?? '', hash: o.hash ?? '' },
    history: { state: o.state ?? null },
    localStorage: { length: o.stored ?? 0 },
    URLSearchParams,
    Image: class {
      set src(v: string) {
        got.push(`image ${v}`);
      }
    },
    document: {
      createElement: () => link,
      head: { appendChild: () => got.push(`${link.rel} ${link.href}`) },
    },
  };
  new Function(...Object.keys(env), bootScript(appUrl))(...Object.values(env));
  return got;
}

describe('bootScript', () => {
  it('第一次来、打开的就是首页:先下星球的图,不提前下主程序', () => {
    expect(runBoot({})).toEqual(['image home-planet.jpg']);
    expect(runBoot({ path: '/beta/', search: '?lon=30' })).toEqual(['image home-planet.jpg']);
  });

  it('存过东西的(多半有世界、星球用不上)、网址少了结尾斜杠的:首页什么都不先下', () => {
    expect(runBoot({ stored: 3 })).toEqual([]);
    expect(runBoot({ path: '/beta' })).toEqual([]);
  });

  it('不是首页:主程序和页面代码一起下(和 plainHome 同一个判断)', () => {
    expect(runBoot({ search: '?seed=7' })).toEqual(['modulepreload ./assets/App-x.js']);
    expect(runBoot({ hash: '#v1abc' })).toEqual(['modulepreload ./assets/App-x.js']);
    expect(runBoot({ state: nav('world', 'wabc') })).toEqual(['modulepreload ./assets/App-x.js']);
    expect(runBoot({ state: nav('home') })).toEqual(['image home-planet.jpg']);
    for (const search of ['', '?play=0', '?seed=7', '?w=wabc', '?map=satellite']) {
      expect(runBoot({ search }).some((x) => x.startsWith('modulepreload')), search).toBe(!plainHome(at(search), null));
    }
  });

  it('开发时没有打包好的主程序:不提前下', () => {
    expect(runBoot({ search: '?seed=7' }, null)).toEqual([]);
  });
});
