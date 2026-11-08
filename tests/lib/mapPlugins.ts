/**
 * 测试用的三个地图插件:环形山(改海拔)、季风和柯本气候(改气候 + 出图层)、潮汐(出图层)。
 * 照接口写,同一份源码既直接跑(withParams 包上滑条),也去掉类型当插件代码关进 QuickJS(civAtlas.map(craters()) 这样登记)。
 * 文件里只能有 import type:QuickJS 里没有别的代码。指数、三角、非整数次幂舍入到 24 位(r24),哪里算都逐位一样。
 */
import type { ClimateInput, HeightInput, LayersInput, MapPlugin } from '../../src/gen/mapHooks';

type Params = { params: Readonly<Record<string, number>> };

/** 和 src/gen/civ/engine/rand.ts 的 round24 一样 */
function r24(x: number): number {
  if (!(Math.abs(x) < 1e290)) return x;
  const c = x * 536870913;
  return c - (c - x);
}

/** 撒 count 个陨石坑(默认 40):坑底下陷、坑沿隆起,坑沿高低不平 */
export function craters() {
  return {
    id: 'craters',
    key: 'craters@1',
    stages: ['height'] as const,
    height(d: HeightInput & Params) {
      const n = d.n;
      const e = d.elevation.slice();
      const count = d.params.count ?? 40;
      const jag = d.noise({ km: 250, octaves: 3, salt: 'rim' });
      for (let k = 0; k < count; k++) {
        const c = Math.floor(d.rand(k, 1) * n);
        const R = 150 + 450 * d.rand(k, 2);
        const depth = 300 + 1500 * d.rand(k, 3);
        const cells = d.near(c, 2 * R);
        for (let q = 0; q < cells.length; q++) {
          const i = cells[q];
          const t = d.km(c, i) / R;
          const bowl = t < 1 ? (t * t - 1) * depth : 0;
          const rim = 0.3 * depth * r24(Math.exp(-((t - 1) * (t - 1)) / 0.06)) * (1 + 0.3 * jag[i]);
          e[i] += bowl + rim;
        }
      }
      return { elevation: e };
    },
  };
}

const KOPPEN = ['Af', 'Am', 'Aw', 'BWh', 'BWk', 'BSh', 'BSk', 'Csa', 'Csb', 'Csc', 'Cwa', 'Cwb', 'Cwc', 'Cfa', 'Cfb', 'Cfc', 'Dsa', 'Dsb', 'Dsc', 'Dsd', 'Dwa', 'Dwb', 'Dwc', 'Dwd', 'Dfa', 'Dfb', 'Dfc', 'Dfd', 'ET', 'EF'];

/** 季风:副热带东岸、离海不远的陆地夏天多雨,全年降水多两成;出一张柯本气候分类图(30 类的编号,海和湖不画) */
export function koppen() {
  const monsoonOf = (lat: number, lon: number, dist: number) => {
    const a = Math.abs(lat);
    const belt = a > 10 && a < 35 ? 1 : a > 5 && a < 40 ? 0.5 : 0;
    const coast = dist <= 8 ? 1 - dist / 9 : 0;
    const east = 0.5 + 0.5 * r24(Math.cos(((lon + 40) * Math.PI) / 90));
    return { m: belt * coast * east, east };
  };
  return {
    id: 'koppen',
    key: 'koppen@1',
    stages: ['climate', 'layers'] as const,
    layerIds: ['koppen'],
    climate(d: ClimateInput & Params) {
      const dist = d.steps(d.water);
      const P = d.precipitation.slice();
      for (let i = 0; i < d.n; i++) {
        if (d.water[i] !== 0) continue;
        P[i] *= 1 + 0.2 * monsoonOf(d.lat[i], d.lon[i], dist[i]).m;
      }
      return { precipitation: P };
    },
    layers(d: LayersInput & Params) {
      const { n, lat, lon, water, temperature: T, precipitation: P } = d;
      const dist = d.steps(water);
      const cls = new Float32Array(n).fill(NaN);
      const mt = new Float64Array(12);
      const mp = new Float64Array(12);
      for (let i = 0; i < n; i++) {
        if (water[i] !== 0) continue;
        const a = Math.abs(lat[i]);
        const cont = Math.min(1, Math.max(0, dist[i]) / 14);
        const range = 3 + (6 + 30 * cont) * r24(Math.sin((a * Math.PI) / 180));
        const north = lat[i] >= 0 ? 1 : -1;
        const { m: monsoon, east } = monsoonOf(lat[i], lon[i], dist[i]);
        const medi = a > 30 && a < 45 ? (1 - east) * (dist[i] <= 6 ? 1 : 0.3) : 0;
        const summer = Math.min(0.9, Math.max(0.15, 0.5 + 0.35 * monsoon - 0.3 * medi));
        let tmin = Infinity;
        let tmax = -Infinity;
        let warm = 0;
        let psum = 0;
        let pdriest = Infinity;
        let psMin = Infinity;
        let psMax = 0;
        let pwMin = Infinity;
        let pwMax = 0;
        for (let k = 0; k < 12; k++) {
          const ph = r24(Math.cos((2 * Math.PI * (k - 6.5)) / 12)) * north;
          mt[k] = T[i] + 0.5 * range * ph;
          const isSummer = ph > 0;
          mp[k] = ((P[i] * (isSummer ? summer : 1 - summer)) / 6) * (1 + 0.3 * Math.abs(ph) * (isSummer ? 1 : -1) * (summer - 0.5) * 2);
          tmin = Math.min(tmin, mt[k]);
          tmax = Math.max(tmax, mt[k]);
          if (mt[k] >= 10) warm++;
          psum += mp[k];
          pdriest = Math.min(pdriest, mp[k]);
          if (isSummer) {
            psMin = Math.min(psMin, mp[k]);
            psMax = Math.max(psMax, mp[k]);
          } else {
            pwMin = Math.min(pwMin, mp[k]);
            pwMax = Math.max(pwMax, mp[k]);
          }
        }
        const pth = 20 * T[i] + (summer >= 0.7 ? 280 : summer <= 0.3 ? 0 : 140);
        let code: string;
        if (tmax < 10) code = tmax < 0 ? 'EF' : 'ET';
        else if (psum < 2 * pth) code = psum < pth ? (T[i] >= 18 ? 'BWh' : 'BWk') : T[i] >= 18 ? 'BSh' : 'BSk';
        else if (tmin >= 18) code = pdriest >= 60 ? 'Af' : pdriest >= 100 - psum / 25 ? 'Am' : 'Aw';
        else {
          const dry = psMin < 40 && psMin < pwMax / 3 ? 's' : pwMin < psMax / 10 ? 'w' : 'f';
          const third = tmax >= 22 ? 'a' : warm >= 4 ? 'b' : tmin < -38 ? 'd' : 'c';
          code = (tmin > -3 ? 'C' : 'D') + dry + (tmin > -3 && third === 'd' ? 'c' : third);
        }
        cls[i] = KOPPEN.indexOf(code);
      }
      return { layers: { koppen: cls } };
    },
  };
}

/** 潮差(米,只画近岸的海):大陆架越宽、海湾越封闭越大(芬迪湾那样) */
export function tides() {
  return {
    id: 'tides',
    key: 'tides@1',
    stages: ['layers'] as const,
    layerIds: ['tide'],
    layers(d: LayersInput & Params) {
      const { n, water, elevation: e, adjStart: s, adj } = d;
      const coastal = new Uint8Array(n);
      const shallow = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (water[i] !== 1) continue;
        if (e[i] > -200) shallow[i] = 1;
        for (let k = s[i]; k < s[i + 1]; k++) {
          if (water[adj[k]] === 0) {
            coastal[i] = 1;
            break;
          }
        }
      }
      // 从近岸的海往外走浅水能走几步(最多算 12 步)
      const shelf = d.steps(coastal, shallow);
      const tide = new Float32Array(n).fill(NaN);
      const seen = new Int32Array(n).fill(-1);
      const ring = new Int32Array(n);
      const depth = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        if (!coastal[i]) continue;
        let head = 0;
        let tail = 0;
        let land = 0;
        let all = 0;
        let far = 0;
        ring[tail++] = i;
        seen[i] = i;
        depth[i] = 0;
        while (head < tail) {
          const c = ring[head++];
          all++;
          if (water[c] === 0) {
            land++;
            continue;
          }
          far = Math.max(far, Math.min(12, shelf[c]));
          if (depth[c] >= 4) continue;
          for (let k = s[c]; k < s[c + 1]; k++) {
            const j = adj[k];
            if (seen[j] === i) continue;
            seen[j] = i;
            depth[j] = depth[c] + 1;
            ring[tail++] = j;
          }
        }
        const closed = land / all;
        tide[i] = 0.5 + 1.5 * (far / 12) + 9 * r24(Math.pow(Math.max(0, closed - 0.35), 1.5)) * (0.4 + far / 12);
      }
      return { layers: { tide } };
    },
  };
}

/** 直接跑:插件拿到的 d 上加上滑条(QuickJS 里是我们那一层加的) */
export function withParams(pl: ReturnType<typeof craters> | ReturnType<typeof koppen> | ReturnType<typeof tides>, params: Readonly<Record<string, number>> = {}): MapPlugin {
  const p = pl as unknown as MapPlugin & Record<string, unknown>;
  const out: MapPlugin = { id: p.id, key: p.key, stages: p.stages, ...(p.layerIds ? { layerIds: p.layerIds } : {}) };
  for (const s of p.stages) {
    const fn = p[s] as (d: unknown) => never;
    (out as unknown as Record<string, unknown>)[s] = (d: object) => fn.call(p, { ...d, params });
  }
  return out;
}
