/**
 * 「拓荒」几条滑条(新建世界弹窗 NewWorldDialog.tsx、新建界面「世界参数」studio/Studio.tsx 共用):
 * 民族扩散、国家扩张、各样地形难走程度。值只取 SPEED_STEPS / TERRAIN_STEPS 里的档;滑条按对数摆(0.5× 到 1× 和 1× 到 2× 一样长),
 * 拖到哪吸到最近的一档。
 */
import {
  SPEED_STEPS,
  TERRAIN_GROUPS,
  TERRAIN_STEPS,
  cleanFrontier,
  filledYear,
  speedText,
  terrainText,
  terrainValue,
  type Frontier,
  type TerrainGroupInfo,
} from '../gen/civ/frontier';
import type { SliderLike } from './WorldOverviewGenesis';

/** 滑条一共多少格(对数刻度) */
const POS = 1000;

/** 一串档位的滑条:位置 ↔ 档位 */
export interface LadderSlider extends SliderLike {
  /** 滑条位置 → 档位上的值 */
  value: (pos: number) => number;
  /** 值 → 滑条位置 */
  pos: (v: number) => number;
}

function ladder(steps: readonly number[], o: { key: string; name: string; hint: string; fmt: (v: number) => string; more?: (v: number) => string | null }): LadderSlider {
  const lo = steps[0];
  const span = Math.log(steps[steps.length - 1] / lo);
  const pos = (v: number) => Math.round((POS * Math.log(v / lo)) / span);
  const value = (p: number) => {
    const t = lo * Math.exp((p / POS) * span);
    let best = steps[0];
    for (const s of steps) if (Math.abs(Math.log(s / t)) < Math.abs(Math.log(best / t))) best = s;
    return best;
  };
  const more = o.more;
  return {
    key: o.key,
    name: o.name,
    hint: o.hint,
    min: 0,
    max: POS,
    step: 1,
    fmt: (p) => o.fmt(value(p)),
    more: more && ((p) => more(value(p))),
    snap: (p) => pos(value(p)),
    value,
    pos,
  };
}

export const SPREAD_SLIDER = ladder(SPEED_STEPS, { key: 'spread', name: '民族扩散', hint: '人往荒地走得多快', fmt: speedText });
/** 新建界面上的民族扩散:数字后面写大约第几年住满 */
export const SPREAD_SLIDER_MORE = ladder(SPEED_STEPS, { key: 'spread', name: '民族扩散', hint: '人往荒地走得多快', fmt: speedText, more: (v) => `约第 ${filledYear(v)} 年住满` });
export const EXPAND_SLIDER = ladder(SPEED_STEPS, { key: 'expand', name: '国家扩张', hint: '国家把周围没有国家的地并进来有多快', fmt: speedText });

/** 一样地形的难走程度 */
export const TERRAIN_SLIDERS: { g: TerrainGroupInfo; s: LadderSlider }[] = TERRAIN_GROUPS.map((g) => ({
  g,
  s: ladder(TERRAIN_STEPS, { key: `terrain-${g.key}`, name: g.name, hint: `走同样远的路，${g.name}要花几倍的时间（森林算 1）`, fmt: terrainText }),
}));

/** 改一样(值是档位上的),清理好;都回到默认 = undefined */
export function withSpeed(f: Frontier | undefined, key: 'spread' | 'expand', v: number): Frontier | undefined {
  return cleanFrontier({ ...f, [key]: v });
}
export function withTerrain(f: Frontier | undefined, g: TerrainGroupInfo, v: number): Frontier | undefined {
  return cleanFrontier({ ...f, terrain: { ...f?.terrain, [g.key]: v } });
}
/** 地形难走程度都回到默认 */
export function withoutTerrain(f: Frontier | undefined): Frontier | undefined {
  return cleanFrontier({ ...f, terrain: undefined });
}

export { terrainValue };
