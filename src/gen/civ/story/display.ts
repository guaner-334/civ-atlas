/**
 * 界面显示用的小工具:民族类型的中文名、族名、州名。
 * 单独放一个文件,不引入起名器和推演代码 —— 主线程(面板、悬停信息)只用得到这些,打包时不用把地名词库带上。
 */
import type { Civ, Culture, CultureKind, Place } from '../types';

/** 治所宜居分 ≥ 这个值的州才算可居(推演用的数,定义在 kinds.ts;界面从这里取) */
export { HABITABLE_SUIT } from '../kinds';

/** 七种民族类型:中文名、一句话说明(扩张性基数是推演用的数,在 kinds.ts 的 KIND_EXPANSIONISM) */
export const KIND_INFO: Record<CultureKind, { name: string; hint: string }> = {
  farm: { name: '农耕', hint: '哪里都能种地,不偏不倚' },
  nomad: { name: '游牧', hint: '草原荒漠上来去如风,进森林很慢,几乎不渡海' },
  sea: { name: '海洋', hint: '沿海岸扩张,能跨海峡、走远洋航线,不爱深入内陆' },
  highland: { name: '高原', hint: '在高原山地如履平地,很少下到平原' },
  river: { name: '河谷', hint: '顺着大河走得快,离了河就慢' },
  lake: { name: '湖泽', hint: '依大湖而居,沿湖岸扩张' },
  forest: { name: '山林', hint: '密林、苔原里的猎人,出了林子就慢' },
};

/** 界面上的族名:"XX族" */
export function cultureLabel(cu: Culture): string {
  return `${cu.name}族`;
}

/** 界面上的州名:用户改过的(阶段 4)> 生成时起的 > "第 N 州" */
export function regionLabel(civ: Civ, r: number): string {
  return civ.regionNames?.[r] || civ.regions.name?.[r] || `第 ${r + 1} 州`;
}

/** 这个州有没有名字(用户起的或生成时起的;没有的界面上叫"第 N 州") */
export function regionNamed(civ: Civ, r: number): boolean {
  return !!(civ.regionNames?.[r] || civ.regions.name?.[r]);
}

/** 地名表 → { 据险断后的史事下标 → 守的那处关的下标 }(同一份地名表只建一次) */
const standIndex = new WeakMap<readonly Place[], Map<number, number>>();

/** 第 annal 条史事(据险断后)守的是这份地名表里的哪一处关(下标,Place.pass.stands 记着);没对上 = −1 */
export function standPass(places: readonly Place[], annal: number): number {
  let m = standIndex.get(places);
  if (!m) {
    const idx = new Map<number, number>();
    places.forEach((p, i) => {
      for (const a of p.pass?.stands ?? []) idx.set(a, i);
    });
    standIndex.set(places, (m = idx));
  }
  return m.get(annal) ?? -1;
}

/**
 * 第 annal 条史事(据险断后)守的那处关叫什么(地图上画的那处,用户改过名的照改的);没对上关 = 空。
 * 改过地形的世界:用那一年所在那一段的地名(和时间轴停在那一年时地图上画的一样,见 ui/eras.ts 的 civAtEra)
 */
export function standPassName(civ: Civ, annal: number): string {
  const y = civ.annals[annal]?.year;
  const ups = civ.upheavals ?? [];
  let k = 0;
  if (y !== undefined) while (k < ups.length && ups[k].year <= y) k++;
  const places = civ.eras && k < civ.eras.length ? civ.eras[k].places : civ.places;
  if (!places) return '';
  const i = standPass(places, annal);
  return i >= 0 ? places[i].name : '';
}
