/**
 * 打开网页时读网址、定去向(src/ui/world/pageUrl.ts):只带 ?w=世界编号 时沿用存档里的投影和中央经线,
 * 带着 seed= 的完整世界网址刷新时照网址本身(0° 省略 lon= 时留着 0°)。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_EDITS } from '../src/gen/edits';
import { makeSave, type SaveView } from '../src/gen/savefile';
import { DEFAULT_PARAMS } from '../src/gen/world';
import { _resetNav, startNav } from '../src/ui/nav';
import * as saveStore from '../src/ui/saveStore';
import { firstRoute, readUrl, writeProjectionUrl } from '../src/ui/world/pageUrl';
import { writeWorldUrl } from '../src/ui/world/worldTarget';

class FakeStorage {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

class FakeHistory {
  state: unknown = null;
  url = '/';
  pushState(s: unknown, _t: string, url: string) {
    this.state = structuredClone(s);
    this.url = url;
  }
  replaceState(s: unknown, _t: string, url: string) {
    this.state = structuredClone(s);
    this.url = url;
  }
  go() {}
}

type G = Record<string, unknown>;
const g = globalThis as unknown as G;
const saved: G = {};
let h: FakeHistory;

function setAt(url: string) {
  h.url = url;
  h.state = null;
}

function storeWorld(view?: SaveView, seed = 6): string {
  const save = makeSave({ ...DEFAULT_PARAMS, seed }, EMPTY_EDITS, 'chk1', '有鹊两千七百年', undefined, view);
  const id = saveStore.importSave(save);
  expect(id).toBeTruthy();
  return id!;
}

beforeEach(() => {
  for (const k of ['localStorage', 'sessionStorage', 'history', 'location', 'addEventListener', 'removeEventListener']) saved[k] = g[k];
  g.localStorage = new FakeStorage();
  g.sessionStorage = new FakeStorage();
  h = new FakeHistory();
  g.history = h;
  g.location = {
    get href() {
      return new URL(h.url, 'https://atlas.gerdor.top').href;
    },
    get pathname() {
      return new URL(h.url, 'https://atlas.gerdor.top').pathname;
    },
    get search() {
      return new URL(h.url, 'https://atlas.gerdor.top').search;
    },
    get hash() {
      return new URL(h.url, 'https://atlas.gerdor.top').hash;
    },
  };
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  saveStore._resetForTest();
  _resetNav();
});

afterEach(() => {
  _resetNav();
  saveStore._resetForTest();
  for (const k of Object.keys(saved)) g[k] = saved[k];
});

describe('pageUrl · ?w= 世界编号与存档里的中央经线 / 投影', () => {
  it('只带 ?w=编号 打开存着的世界:沿用存档里的中央经线 −109°,改写网址后也带着 lon=-109', () => {
    const id = storeWorld({ projection: 'equirect', center: -109, graticule: 0, contours: '' });
    setAt(`/?w=${id}`);

    const init = readUrl();
    expect(init.proj).toBe('equirect');
    expect(init.lon).toBe(-109);
    expect(init.grat).toBe(0);
    expect(init.iso).toBeNull();

    const route = firstRoute(init);
    expect(route.stage).toBe('world');
    expect(route.target?.id).toBe(id);
    expect(route.target?.view).toEqual({ projection: 'equirect', center: -109, graticule: 0, contours: '' });

    startNav({ page: 'world', id }, { route: () => {}, describe: () => ({}), settled: () => null, apply: (l) => l });
    writeProjectionUrl({ projection: init.proj, mapCenter: init.lon ?? 0, graticule: init.grat, contourKind: init.iso });
    writeWorldUrl(route.target!);
    const q = new URLSearchParams((g.location as Location).search);
    expect(q.get('w')).toBe(id);
    expect(q.get('seed')).toBe('6');
    expect(q.get('lon')).toBe('-109');
  });

  it('只带 ?w=编号 时投影、经纬网、等值线也沿用存档;网址里写了哪项就只盖哪项', () => {
    const id = storeWorld({ projection: 'robinson', center: -109, graticule: 15, contours: 'elev' });

    setAt(`/?w=${id}`);
    const full = readUrl();
    expect({ proj: full.proj, lon: full.lon, grat: full.grat, iso: full.iso }).toEqual({
      proj: 'robinson',
      lon: -109,
      grat: 15,
      iso: 'elev',
    });

    setAt(`/?w=${id}&lon=30`);
    const moved = readUrl();
    expect({ proj: moved.proj, lon: moved.lon, grat: moved.grat, iso: moved.iso }).toEqual({
      proj: 'robinson',
      lon: 30,
      grat: 15,
      iso: 'elev',
    });

    setAt(`/?w=${id}&lon=0&proj=equirect&grat=0&iso=none`);
    const zero = readUrl();
    expect({ proj: zero.proj, lon: zero.lon, grat: zero.grat, iso: zero.iso }).toEqual({
      proj: 'equirect',
      lon: 0,
      grat: 0,
      iso: null,
    });
  });

  it('带 seed= 的世界网址刷新时(拖回 0° 省略了 lon=):保持 0°,不被旧存档里的 −109° 盖回去', () => {
    const id = storeWorld({ projection: 'robinson', center: -109, graticule: 15, contours: 'elev' });
    setAt(`/?seed=6&w=${id}&gen=57`);

    const init = readUrl();
    expect(init.proj).toBe('equirect');
    expect(init.lon).toBeNull();
    expect(init.grat).toBe(0);
    expect(init.iso).toBeNull();

    const route = firstRoute(init);
    expect(route.stage).toBe('world');
    expect(route.target?.view).toBeUndefined();
  });

  it('只存了地图的记录(?w=地图编号):回到我的世界,不套它的中央经线', () => {
    const id = saveStore.newWorldId();
    const save = makeSave({ ...DEFAULT_PARAMS, seed: 8 }, EMPTY_EDITS, 'chk2', '一张地图', undefined, {
      projection: 'equirect',
      center: -109,
      graticule: 0,
      contours: '',
    });
    expect(saveStore.putSyncedWorld(id, { save: JSON.stringify(save), meta: { map: true }, thumb: null })).toBe(true);
    setAt(`/?w=${id}`);

    const init = readUrl();
    expect(init.lon).toBeNull();
    const route = firstRoute(init);
    expect(route).toEqual({ stage: 'home', target: null });
  });
});
