/**
 * 大迁徙(civ.migrations)在界面上的几处:点编年史那一条跳到哪年、地图上那一支亮一下,国家卡片、人物卡的「来历」。
 * 路线的画法在 render/civ/migrations.ts。
 *
 *   - 点编年史(时间轴)上大迁徙那一条:跳到落脚那年(没立成国、散居的:散居那年;还在路上的:最后一年),整条箭头亮一下(和事发州闪烁同一个节奏)
 *   - 国家卡片「来历」:迁来立的国写"克拉尔族自诺敏塔拉西徙至此立国",地名能点(跳到动身那年,事发州闪、标签钉在那里)
 *   - 人物卡「来历」:跟着迁过来的那一代人(这国的人、落脚以前生的;名臣、将领的籍贯是别族的城的不算)写
 *     "克拉尔族;1899 年随族自诺敏塔拉西徙,1911 年随众立国"(路上生的写"生于西徙途中");领头立国的那位写"率克拉尔族西徙,立萨热汗国"
 */
import { useRef } from 'react';
import type { ChronicleEntry } from '../gen/civ/chronicle';
import { fullChronicle } from '../gen/civ/religionText';
import { peopleIndex } from '../gen/civ/peopleInfo';
import type { Civ, Migration, Person } from '../gen/civ/types';
import { useChroniclePick } from './civView';

/** 编年史里大迁徙那一条(折叠的大事,动身那件是史事 trek n = 0)是第几次大迁徙;不是 = −1 */
export function trekOfEntry(civ: Civ, e: Pick<ChronicleEntry, 'id' | 'kind' | 'children'>): number {
  const a = (civ.history ?? civ).annals[e.id];
  return e.kind === 'migrate' && !!e.children?.length && a?.kind === 'trek' && a.n === 0 ? a.war : -1;
}

/** 亮一下(和点编年史时事发州闪烁同一个节奏:约两秒,亮 → 暗 → 亮 → 暗 → 亮,淡出):过了 ms 毫秒这一刻有多亮;闪完 = 0 */
export const FLASH_MS = 2200;
const FLASH_AT = [0, 0.08, 0.24, 0.4, 0.56, 0.72, 1];
const FLASH_A = [0, 1, 0.3, 1, 0.3, 1, 0];
export function flashAlpha(ms: number): number {
  const t = ms / FLASH_MS;
  if (!(t > 0) || t >= 1) return 0;
  let i = 1;
  while (i < FLASH_AT.length - 1 && FLASH_AT[i] < t) i++;
  const f = (t - FLASH_AT[i - 1]) / (FLASH_AT[i] - FLASH_AT[i - 1]);
  const e = f * f * (3 - 2 * f);
  return FLASH_A[i - 1] + (FLASH_A[i] - FLASH_A[i - 1]) * e;
}

/** 点了编年史上大迁徙那一条:哪一支、什么时候点的(performance.now());没点、点的不是 = null */
export function useTrekFlash(civ: Civ | null): { m: number; t0: number } | null {
  const pick = useChroniclePick();
  const last = useRef<{ stamp: number; v: { m: number; t0: number } | null }>({ stamp: pick.stamp, v: null });
  if (last.current.stamp !== pick.stamp) {
    const m = pick.entry && civ ? trekOfEntry(civ, pick.entry) : -1;
    last.current = { stamp: pick.stamp, v: m >= 0 ? { m, t0: performance.now() } : null };
  }
  return last.current.v;
}

/** 大迁徙那一条的经过里动身那一件(国家卡片、人物卡「来历」里的地名点了跳过去);找不到 = null */
export function departureEntry(civ: Civ, m: number): ChronicleEntry | null {
  for (const e of fullChronicle(civ)) {
    if (trekOfEntry(civ, e) !== m) continue;
    return e.children?.find((k) => k.id === e.id) ?? null;
  }
  return null;
}

/** 迁来立的国:第几次大迁徙和那一条;不是 = null */
export function polityTrek(civ: Civ, id: number): { m: number; M: Migration } | null {
  const m = civ.polities[id]?.trek;
  const M = m !== undefined ? civ.migrations?.[m] : undefined;
  return M && M.polity === id ? { m: m!, M } : null;
}

/**
 * 人物卡「来历」:这个人是不是跟着迁过来的那一代人。lead = 领头立国的那位(这国第一位君主);
 * follow = 动身以前生的;road = 路上生的。在新地方生的、名臣将领籍贯是别族的城的 = null
 */
export function personTrek(civ: Civ, x: Person): { m: number; M: Migration; how: 'lead' | 'follow' | 'road' } | null {
  const t = polityTrek(civ, x.polity);
  if (!t || t.M.settled === undefined || !(x.born < t.M.settled)) return null;
  if (x.role === 'ruler' && peopleIndex(civ).rulers[x.polity]?.[0]?.id === x.id) return { ...t, how: 'lead' };
  const home = x.home !== undefined ? civ.settlements[x.home] : undefined;
  if (home && home.culture !== t.M.culture) return null;
  return { ...t, how: x.born < t.M.year ? 'follow' : 'road' };
}
