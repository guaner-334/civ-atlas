/**
 * 拓荒:新建世界时可调的三样 —— 民族扩散快慢、国家扩张快慢、各种地形难走的程度(CivParams.frontier,清理见 cleanFrontier)。
 * 不调 = 和没有这一项逐字节一样(各系数都是 1,乘 1 不改变浮点数)。
 *
 *   民族扩散 spread  民族走一步的年数 ÷ spread(1 = 照世界标定:默认约第 3000 年九成可居州有人住;2 = 约第 1500 年)
 *   国家扩张 expand  国家走一步的年数 ÷ expand;扩张算账的门槛 ÷ expand^WORTH_EXP(调快了,没有国家的部落地留得少)
 *   地形难走 terrain 按组写"走同样远的路要花几倍的时间"(温带森林 = 1),显示值见 TERRAIN_GROUPS 的 def:
 *                   民族的群落系数 × (值 ÷ def);国家的群落系数 × (值 ÷ def)^(2/3)(国家的群落系数本来就比民族的平缓:指数 0.6 对 0.9)。
 *                   高山:翻山的过界系数、民族的海拔系数里高出来的那部分一起乘。只管走得快慢,不管能不能住
 *
 * 显示值和系数:各组的 def 是把那组代表群落的系数(cultures.ts 的 (通行代价 / 70)^0.9)取到一位小数;一组里的几种群落按同一个比例缩放
 * (沙漠 = 热荒漠、温带荒漠、寒荒漠一起)。纯计算,不碰 DOM。
 */
import { BIOMES, type Biome, type BiomeTerrainGroup } from '../biomes';
import { fpow } from './rand';
import { TERRAIN_H, TERRAIN_W } from '../terrainOps';
import type { World } from '../world';
import type { Regions } from './types';

/** 地形分组:按群落分的几组(哪种群落归哪组见地貌表的 frontier),加上不按群落的高山 */
export type TerrainGroup = BiomeTerrainGroup | 'mountain';

/** 拓荒三样(清理过的:和默认一样的项不写;都没调 = 整个不给) */
export interface Frontier {
  /** 民族扩散快慢(倍数,SPEED_STEPS 里的一档;不给 = 1) */
  spread?: number;
  /** 国家扩张快慢(倍数,SPEED_STEPS 里的一档;不给 = 1) */
  expand?: number;
  /** 改过的地形难走程度:组 → 显示值(TERRAIN_STEPS 里的一档;和 def 一样的不写) */
  terrain?: Partial<Record<TerrainGroup, number>>;
}

export interface TerrainGroupInfo {
  key: TerrainGroup;
  name: string;
  /** 这一组的群落(照地貌表的 frontier;高山不按群落,是翻山和海拔) */
  biomes: readonly Biome[];
  /** 默认的显示值(森林 = 1) */
  def: number;
}

/** 归这一组的群落 */
const groupBiomes = (g: TerrainGroup): Biome[] => BIOMES.filter((b) => b.frontier === g).map((b) => b.id);

/** 地形难走程度的分组(界面上按这个先后列) */
export const TERRAIN_GROUPS: readonly TerrainGroupInfo[] = [
  { key: 'grass', name: '草原', biomes: groupBiomes('grass'), def: 0.8 },
  { key: 'forest', name: '森林', biomes: groupBiomes('forest'), def: 1 },
  { key: 'rainforest', name: '雨林', biomes: groupBiomes('rainforest'), def: 1.1 },
  { key: 'wetland', name: '湿地', biomes: groupBiomes('wetland'), def: 2 },
  { key: 'desert', name: '沙漠', biomes: groupBiomes('desert'), def: 2.6 },
  { key: 'taiga', name: '针叶林', biomes: groupBiomes('taiga'), def: 2.6 },
  { key: 'tundra', name: '冻土', biomes: groupBiomes('tundra'), def: 11 },
  { key: 'mountain', name: '高山', biomes: [], def: 2.2 },
];

/** 民族扩散、国家扩张的档位(倍数) */
export const SPEED_STEPS: readonly number[] = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
/** 地形难走程度的档位(包含各组的默认值) */
export const TERRAIN_STEPS: readonly number[] = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.6, 3, 4, 5, 6, 8, 11, 14, 20];

/**
 * 国家扩张调快 e 倍时,扩张算账的门槛 ÷ e^WORTH_EXP。光走得快、门槛不变的话,荒漠、高山这些不划算的地方照样留给部落,看不出差别。
 * 20 个种子(1–20)到第 3000 年有人住却没有国家的州:默认 18%–35%(中位 29%),2× 7%–27%(中位 12%),0.5× 59%–75%(中位 67%)
 */
export const WORTH_EXP = 1.5;

/** 吸到最近的一档(不是数 = null) */
function snap(steps: readonly number[], v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  let best = steps[0];
  for (const s of steps) if (Math.abs(s - v) < Math.abs(best - v)) best = s;
  return best;
}

/** 清理:各项吸到最近的一档,和默认一样的去掉;都没调 = undefined */
export function cleanFrontier(x: unknown): Frontier | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  const out: Frontier = {};
  const spread = snap(SPEED_STEPS, o.spread);
  if (spread !== null && spread !== 1) out.spread = spread;
  const expand = snap(SPEED_STEPS, o.expand);
  if (expand !== null && expand !== 1) out.expand = expand;
  const t = o.terrain && typeof o.terrain === 'object' ? (o.terrain as Record<string, unknown>) : {};
  const terrain: Partial<Record<TerrainGroup, number>> = {};
  let any = false;
  for (const g of TERRAIN_GROUPS) {
    const v = snap(TERRAIN_STEPS, t[g.key]);
    if (v !== null && v !== g.def) {
      terrain[g.key] = v;
      any = true;
    }
  }
  if (any) out.terrain = terrain;
  if (out.spread === undefined && out.expand === undefined && !out.terrain) return undefined;
  return out;
}

/** 两份拓荒设定一样(都清理过;undefined = 默认) */
export function sameFrontier(a: Frontier | undefined, b: Frontier | undefined): boolean {
  if (!a || !b) return !a === !b;
  if ((a.spread ?? 1) !== (b.spread ?? 1) || (a.expand ?? 1) !== (b.expand ?? 1)) return false;
  return TERRAIN_GROUPS.every((g) => terrainValue(a, g) === terrainValue(b, g));
}

/** 一组地形的显示值(没改 = 默认) */
export function terrainValue(f: Frontier | undefined, g: TerrainGroupInfo): number {
  return f?.terrain?.[g.key] ?? g.def;
}

/** 推演里用的系数(frontierFx 算好挂在 CultureTerrain 上) */
export interface FrontierFx {
  /** 民族的群落系数倍数(按 Biome 下标) */
  people: Float64Array;
  /** 民族翻山、海拔的倍数 */
  peopleMtn: number;
  /** 国家的群落系数倍数(按 Biome 下标) */
  state: Float64Array;
  /** 国家翻山的倍数 */
  stateMtn: number;
}

/** 国家的倍数 = 民族的倍数 ^ STATE_EXP(群落系数的指数 0.6 对 0.9) */
const STATE_EXP = 2 / 3;

/** 拓荒设定 → 推演用的系数(没调地形 = 全是 1) */
export function frontierFx(f: Frontier | undefined): FrontierFx {
  const people = new Float64Array(BIOMES.length).fill(1);
  const state = new Float64Array(BIOMES.length).fill(1);
  let peopleMtn = 1;
  let stateMtn = 1;
  for (const g of TERRAIN_GROUPS) {
    const v = f?.terrain?.[g.key];
    if (v === undefined || v === g.def) continue;
    const k = v / g.def;
    const ks = fpow(k, STATE_EXP);
    if (g.key === 'mountain') {
      peopleMtn = k;
      stateMtn = ks;
    }
    for (const b of g.biomes) {
      people[b] = k;
      state[b] = ks;
    }
  }
  return { people, peopleMtn, state, stateMtn };
}

/** 改过地形难走程度(要按默认的地形标定扩张节拍,不让调整被标定抵消) */
export function terrainChanged(f: Frontier | undefined): boolean {
  return !!f?.terrain && Object.keys(f.terrain).length > 0;
}

/** 民族约第几年住满(九成可居州有人住):3000 ÷ 民族扩散倍数,取整到百年 */
export function filledYear(spread: number): number {
  return Math.round(3000 / spread / 100) * 100;
}

/** 滑条上显示的地形难走程度:10 以下一位小数("1.0""2.6"),以上取整("11") */
export function terrainText(v: number): string {
  return v >= 10 ? `${Math.round(v)}` : v.toFixed(1);
}

/** 一句话里的地形难走程度:去掉 .0("3""2.6") */
function terrainShort(v: number): string {
  return v >= 10 ? `${Math.round(v)}` : `${Math.round(v * 10) / 10}`;
}

/** 滑条上显示的快慢倍数:"1.50×" */
export function speedText(v: number): string {
  return `${v.toFixed(2)}×`;
}

/** 一句话里的快慢倍数:"1.5×""2×" */
function speedShort(v: number): string {
  return `${Math.round(v * 100) / 100}×`;
}

/** 改过几样地形 */
export function terrainChangedCount(f: Frontier | undefined): number {
  return f?.terrain ? Object.keys(f.terrain).length : 0;
}

/** 改过的地形难走程度:"雨林 3，沙漠 6，其余默认";都没改 = "默认" */
export function terrainBrief(f: Frontier | undefined): string {
  const ch = TERRAIN_GROUPS.filter((g) => f?.terrain?.[g.key] !== undefined);
  if (!ch.length) return '默认';
  const s = ch.map((g) => `${g.name} ${terrainShort(terrainValue(f, g))}`).join('，');
  return ch.length < TERRAIN_GROUPS.length ? `${s}，其余默认` : s;
}

/** 拓荒改了哪些(确认框那一行):"民族 1.5×，国家 2×，地形改过 2 样";都没改 = "" */
export function frontierBrief(f: Frontier | undefined): string {
  const out: string[] = [];
  if (f?.spread !== undefined) out.push(`民族 ${speedShort(f.spread)}`);
  if (f?.expand !== undefined) out.push(`国家 ${speedShort(f.expand)}`);
  const n = terrainChangedCount(f);
  if (n) out.push(`地形改过 ${n} 样`);
  return out.join('，');
}

// ---------------------------------------------------------------------------
// 文明起源

/** 自选起源最多几处 */
export const ORIGINS_MAX = 16;

/**
 * 自选的文明起源(CivParams.origins,清理见 cleanOrigins):第一批民族从这几处出发,第 0 年一起出现。
 * 点按世界坐标存(和地形修改同一套:x 0–2048 经度,y 0–1024 纬度,取整),改了种子、地形照样指着同一块地方;
 * 那里住不了人(海、冰原、大片荒漠……)的推演时跳过
 */
export interface Origins {
  /** [x0, y0, x1, y1, …],按点的先后(= 民族的先后) */
  pts: number[];
  /** 只有这几支:别处不再自动长出民族(不给 = 别处照常自动长,总数照自动的定) */
  only?: true;
}

/** 清理:坐标取整、x 绕回 [0, 2048)、y 夹进 [0, 1024],同一处的去掉,最多 ORIGINS_MAX 处;一处也没有 = undefined */
export function cleanOrigins(x: unknown): Origins | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.pts)) return undefined;
  const pts: number[] = [];
  const seen = new Set<string>();
  for (let i = 0; i + 1 < o.pts.length && pts.length < ORIGINS_MAX * 2; i += 2) {
    const a = o.pts[i];
    const b = o.pts[i + 1];
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    const px = ((Math.round(a) % TERRAIN_W) + TERRAIN_W) % TERRAIN_W;
    const py = Math.min(TERRAIN_H, Math.max(0, Math.round(b)));
    const k = `${px},${py}`;
    if (seen.has(k)) continue;
    seen.add(k);
    pts.push(px, py);
  }
  if (!pts.length) return undefined;
  return o.only === true ? { pts, only: true } : { pts };
}

/** 离世界坐标 (x, y) 最近的地块(左右接着的世界按近的那一边算) */
export function nearestCell(world: World, x: number, y: number): number {
  const { x: X, y: Y, n } = world.mesh;
  const W = world.width;
  let best = -1;
  let bd = Infinity;
  for (let c = 0; c < n; c++) {
    let dx = Math.abs(X[c] - x) % W;
    if (dx > W / 2) dx = W - dx;
    const d = dx * dx + (Y[c] - y) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/** 起源的点落在哪一州:落在水上 = −1(住不住得了人另看:州治所的宜居分够不够 HABITABLE_SUIT)。界面和推演共用 */
export function originRegion(world: World, regions: Regions, x: number, y: number): number {
  const c = nearestCell(world, x, y);
  return c >= 0 && world.water[c] === 0 ? regions.of[c] : -1;
}

/** 两份起源设定一样(都清理过;undefined = 自动) */
export function sameOrigins(a: Origins | undefined, b: Origins | undefined): boolean {
  if (!a || !b) return !a === !b;
  return !!a.only === !!b.only && a.pts.length === b.pts.length && a.pts.every((v, i) => v === b.pts[i]);
}
