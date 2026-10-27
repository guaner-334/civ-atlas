/**
 * 大纲搬家(大纲页「找更合的世界」→ 照故事找世界 →「用这个世界」建好):
 *
 * - 点「找更合的世界」时记下原来那个世界的大纲(outlineFrom):大纲里的国家键 → 原来那国的编号、每条情节每一项原来叫什么
 * - 大纲里写到最多的几国(最多 3 国)先列成「故事里的国家」(outlineRoles):叫法用大纲里的国名,ref = 原来那国,条件空着让作者自己加
 * - 建好找到的那个世界以后(moveOutline):情节里的国家照 ref 换成结果里对上的那一国(新世界里的稳定键);
 *   别的对不上的(没对上的国家、州、城、人物、作者的人物、作者标记)从情节里去掉,记进 redo(原来叫什么),大纲页上标「要重新指」
 *   (格式见 gen/edits.ts 文件头"要重新指")。都用同一张地图找的(只换文明种子):州还是那块地方,州键照旧;城在新历史里还在那一处的照旧。
 *   `plot:编号`(大纲里立起来的国家)、年份、作者写的那句都照旧;上一次照大纲推演的批改不要了(历史换了)
 * 纯计算,不碰 DOM。
 */
import type { Civ } from '../gen/civ/types';
import { cleanPlot, keyCells, polityKey, regionOfKey, resolveKey, type Plot, type PlotRedo, type PlotRedoField } from '../gen/edits';
import { ROLE_NAME_MAX, type FinderQuery, type FinderRole } from '../gen/finder/query';
import { areaText, charName, cityName, personKeyName, plotPolityId, plotPolityName, regionName, type OutlineCtx } from './outlineInfo';

/** 从大纲页来的:原来那个世界和它的大纲 */
export interface OutlineFrom {
  /** 原来那个世界的编号(「‹ 大纲」回它) */
  world: string;
  /** 原来那张地图(参数、地形、草图;和找到的世界一样 = 都用这张地图找的) */
  mapKey: string;
  /** 原来的大纲(不带批改) */
  plots: Plot[];
  /** 大纲里的国家键 → 原来那个世界里的国家编号(认不出的不记) */
  polities: Record<string, number>;
  /** 每条情节(编号)每一项原来叫什么(说不出 = 空串) */
  names: Record<number, PlotRedo>;
}

/** 说不出名字时 outlineInfo 写的"（这段历史里没有的国家）"这类:当说不出 */
const known = (s: string) => (s.startsWith('（') ? '' : s);

/** 点「找更合的世界」时:记下原来那个世界的大纲 */
export function outlineFrom(o: OutlineCtx, world: string, mapKey: string): OutlineFrom {
  const polities: Record<string, number> = {};
  const names: Record<number, PlotRedo> = {};
  for (const p of o.plots) {
    const n: PlotRedo = {};
    for (const f of ['a', 'b'] as const) {
      const k = p[f];
      if (!k || k.startsWith('plot:')) continue;
      const id = plotPolityId(o, k);
      if (id >= 0) polities[k] = id;
      n[f] = id >= 0 ? known(plotPolityName(o, k, p.year)) : '';
    }
    if (p.region) n.region = known(regionName(o.civ, p.region));
    if (p.regions?.length) {
      const first = known(regionName(o.civ, p.regions[0]));
      n.regions = first ? `${first}${p.regions.length > 1 ? `等 ${p.regions.length} 州` : ''}` : `圈的 ${p.regions.length} 州`;
    }
    if (p.city) n.city = known(cityName(o.civ, p.city));
    if (p.person) n.person = known(personKeyName(o.civ, p.person));
    if (p.char !== undefined) n.char = o.characters?.find((c) => c.id === p.char) ? charName(o, p.char) : '';
    if (p.mark !== undefined) n.mark = known(areaText(o, { mark: p.mark }).name);
    // 上一次搬过来还没重新指的:照旧记着原来的名字
    names[p.id] = { ...(p.redo ?? {}), ...n };
  }
  const plots = o.plots.map((p) => ({ ...p }));
  return { world, mapKey, plots, polities, names };
}

/** 国名当叫法:超过字数先去掉"王国""帝国"这类尾巴,还长就截断 */
function roleName(name: string): string {
  if ([...name].length <= ROLE_NAME_MAX) return name;
  const short = name.replace(/(王朝|帝国|王国|汗国|皇朝|公国|共和国|联邦|部落|部|国)$/, '') || name;
  return [...short].slice(0, ROLE_NAME_MAX).join('');
}

/** 大纲里写到最多的几国(一样多的先写到的在前)→ 故事里的国家:叫法用大纲里的国名,条件空着 */
export function outlineRoles(from: OutlineFrom, max = 3): FinderRole[] {
  const seen = new Map<number, { n: number; at: number; name: string }>();
  let at = 0;
  for (const p of from.plots)
    for (const f of ['a', 'b'] as const) {
      const k = p[f];
      const id = k ? from.polities[k] : undefined;
      if (id === undefined) continue;
      const s = seen.get(id);
      if (s) s.n++;
      else seen.set(id, { n: 1, at: at++, name: from.names[p.id]?.[f] ?? '' });
    }
  return [...seen.entries()]
    .sort((x, y) => y[1].n - x[1].n || x[1].at - y[1].at)
    .slice(0, max)
    .map(([ref, s], i) => ({ name: roleName(s.name) || `第 ${i + 1} 国`, ref, conds: [] }));
}

/** 搬好的大纲:情节、其中几条有要重新指的 */
export interface MovedOutline {
  plots: Plot[];
  redo: number;
}

/**
 * 大纲搬到找到的那个世界:q = 找的时候的条件(每国带 ref 的那几国),found = 结果里每国对上的国家编号(和 q.roles 一一对应),
 * civ = 新世界的历史,sameMap = 都用原来那张地图找的(州键照旧能用)
 */
export function moveOutline(from: OutlineFrom, q: FinderQuery, found: readonly number[], civ: Civ, sameMap: boolean): MovedOutline {
  // 原来那国 → 新世界里对上的那一国的稳定键
  const to = new Map<number, string>();
  q.roles.forEach((r, i) => {
    const p = found[i];
    if (r.ref !== undefined && p !== undefined && p >= 0 && p < civ.polities.length && !to.has(r.ref)) to.set(r.ref, polityKey(civ, p));
  });
  const of = keyCells(civ.regions);
  const regionOk = (k: string) => {
    const r = regionOfKey(k, of);
    return r >= 0 && r < civ.regions.count;
  };
  const cityOk = (k: string) => resolveKey(civ, k)?.kind === 'settlement';
  const plots: Plot[] = [];
  for (const p0 of from.plots) {
    const { redo: old, ...rest } = p0;
    const p = rest as Record<string, unknown>;
    const redo: PlotRedo = { ...(old ?? {}) };
    const was = from.names[p0.id] ?? {};
    const drop = (f: PlotRedoField) => {
      delete p[f];
      redo[f] = was[f] ?? '';
    };
    for (const f of ['a', 'b'] as const) {
      const k = p0[f];
      if (!k || k.startsWith('plot:')) continue;
      const id = from.polities[k];
      const key = id === undefined ? undefined : to.get(id);
      if (key) p[f] = key;
      else drop(f);
    }
    if (p0.region && !(sameMap && regionOk(p0.region))) drop('region');
    if (p0.regions) {
      const keep = sameMap ? p0.regions.filter(regionOk) : [];
      if (keep.length) p.regions = keep;
      else drop('regions');
    }
    if (p0.city && !(sameMap && cityOk(p0.city))) drop('city');
    if (p0.person) drop('person');
    if (p0.char !== undefined) drop('char');
    if (p0.mark !== undefined) drop('mark');
    if (Object.keys(redo).length) p.redo = redo;
    const c = cleanPlot(p);
    if (c) plots.push(c);
  }
  return { plots, redo: plots.filter((p) => p.redo).length };
}
