/**
 * 「我的世界」的「地图」页签:存着的世界按地图分组(纯计算,不碰存储)。
 *
 * 同一张地图 = 在一个世界的地图上打造的文明都记着最早那个世界的编号(存档修改里的 map.from,见 gen/edits.ts 文件头"文明种子");
 * 没记的就是它自己的地图。只存了地图、还没有文明的(saveStore 的 map)自己是一张地图。
 * 新建中、还没定下地图的(没建完、没有 map.from)不算哪张地图上的:只在「文明」页签里。
 * 最早那个世界删掉了,打造出来的几个照旧在一组(组的编号还是它)。
 */
import type { WorldEdits } from '../gen/edits';
import type { WorldParams } from '../gen/world';
import type { StoredWorld } from './saveStore';

export interface MapGroup {
  /** 这张地图的编号(最早那个世界 / 只存了地图的那一份) */
  key: string;
  /** 只存了地图的那一份(有的话) */
  map: StoredWorld | null;
  /** 这张地图上的文明(连同打造了一半的),最近的在前 */
  civs: StoredWorld[];
  /** 参数、地形从它看:地图那一份 / 最早那个世界 / 最近的一个文明 */
  head: StoredWorld;
  /** 组里最近打开或修改的时间(组按它排) */
  at: string;
  /** 卡片上的图:地图缩略图(组里谁有就用谁的,先看 head),都没有就用 head 的缩略图 */
  thumb: string | null;
}

/** 这个世界在哪张地图上(组的编号);新建中、还没定下地图的 = null */
export function mapKeyOf(w: Pick<StoredWorld, 'id' | 'map' | 'draft'> & { save: { edits: Pick<WorldEdits, 'map'> } }): string | null {
  if (w.map) return w.id;
  const from = w.save.edits.map?.from;
  if (from) return from;
  return w.draft ? null : w.id;
}

const newer = (a: string, b: string) => (a > b ? a : b);

/** 按地图分组,最近动过的组在前(list 是 listWorlds 的结果) */
export function mapGroups(list: readonly StoredWorld[]): MapGroup[] {
  const groups = new Map<string, { map: StoredWorld | null; civs: StoredWorld[] }>();
  for (const w of list) {
    const key = mapKeyOf(w);
    if (key === null) continue;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { map: null, civs: [] }));
    if (w.map) g.map = w;
    else g.civs.push(w);
  }
  const out: MapGroup[] = [];
  for (const [key, g] of groups) {
    g.civs.sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : a.id < b.id ? -1 : 1));
    const head = g.map ?? g.civs.find((w) => w.id === key) ?? g.civs[0];
    const all = g.map ? [g.map, ...g.civs] : g.civs;
    const at = all.reduce((t, w) => newer(t, w.at), '');
    const thumb = head.mapThumb ?? all.find((w) => w.mapThumb)?.mapThumb ?? head.thumb;
    out.push({ key, map: g.map, civs: g.civs, head, at, thumb });
  }
  return out.sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : a.key < b.key ? -1 : 1));
}

/** 地图卡片的名字:"种子 7";改过地形的"种子 7（改过地形）" */
export function mapName(head: StoredWorld): string {
  const e = head.save.edits;
  return `种子 ${head.save.params.seed}${e.terrain.length || e.sketch ? '（改过地形）' : ''}`;
}

/** 一张地图的简介:"陆地 33%，30 个板块，地形没改过" */
export function mapBriefOf(p: WorldParams, e: Pick<WorldEdits, 'terrain' | 'sketch'>): string {
  // 和 WorldOverviewGenesis 的 paramsSide 一个说法
  const side = `陆地 ${Math.round(p.landFraction * 100)}%，${p.continents ? `${p.continents} 块大陆` : `${p.plates} 个板块`}`;
  return `${side}，${e.sketch ? '照手绘图' : e.terrain.length ? `地形改过 ${e.terrain.length} 处` : '地形没改过'}`;
}

/** 展开的那块标题旁边:"陆地 33%，30 个板块，地形没改过" */
export const mapBrief = (head: StoredWorld) => mapBriefOf(head.save.params, head.save.edits);

/** 一个文明的名字 */
export const civName = (w: StoredWorld) => w.save.title || '未命名世界';

/** 地图卡片的第二行:"还没有文明" / "2 个文明：苍澜界（二）、苍澜界"(short = 手机上只写个数) */
export function mapLine(g: MapGroup, short = false): string {
  const n = g.civs.length;
  if (!n) return '还没有文明';
  return short ? `${n} 个文明` : `${n} 个文明：${g.civs.map(civName).join('、')}`;
}

/** 和 id 这个世界在同一张地图上的文明(连同它自己;edits 是它现在的修改),最近的在前 */
export function mapMates(list: readonly StoredWorld[], id: string, edits: Pick<WorldEdits, 'map'>): StoredWorld[] {
  const key = edits.map?.from ?? id;
  return list.filter((w) => !w.map && (w.id === id || mapKeyOf(w) === key)).sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : a.id < b.id ? -1 : 1));
}
