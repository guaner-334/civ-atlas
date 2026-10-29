/**
 * 做法表:时代不只改数值,也改一国"怎么办事"。一样做法一行:前提是国都所在州的哪样能力到了哪一档(直接用发明表的档位,
 * 国都那州到了,这国就有了,不要求世上第一个),或者国都那州进了哪个时代;有了以后改什么。以后加一种做法 = 加一行。
 *
 *   户籍       行政到"户籍"那一档    有了才能议直征(没有时议直征最多和地方分成)
 *   文官考选   行政到"文官考选"那一档  有了才能议铨选(收任免;许了自辟的收回辟署不要它);豪族把持的州的阻力减半
 *   常备军     动员到"常备军"那一档   有了才能议收兵权(禁军、监军;设了边镇的罢边镇不要它)
 *   人口普查   行政到"人口普查"那一档  直征、分成多收一截,开销打折
 *   铁路       运输到"铁路"那一档    管得到的远近 × RAIL_REACH(数表「管辖」),割据收回得容易
 *   电报       信息到"电报"那一档    新起割据的赔率乘 WIRE_LORD
 *   报刊       信息到"报刊"那一档    只记下前提(思潮、改制用)
 *   封镇渐废   国都进了火药时代       分封边地、设边镇少议;改土归流、罢边镇更容易
 *   封镇尽废   国都进了工业时代       分封边地、设边镇不再议(已经分封、设了的照旧,直到议事收回)
 *
 * 怎么用:
 *   - 政局的数表(stateTables.ts)里一张"国都能力"输入表(国都所在州的五种能力和时代,control.ts 每年填)和一张"做法"表
 *     (一样做法一栏,有了 = 1),规则由这张表生成;「管辖」读"做法.铁路"。
 *   - 事件层(议事 council.ts、割据 control.ts)和数表看的是同一行前提:practiceMask 按国都那州此刻的能力现算(和议事的底气同一处取),
 *     不另存,接着推时也一样。界面、编年史按发展度的快照算(practiceInfo.ts)。
 * 只放数据和小函数,不依赖推演模块(数表在模块加载时就要读它)。纯计算,不碰 DOM。
 */
import type { TableCard } from './tables';
import { CAPS, INVENTIONS } from './inventions';

/** 做法(下标就是 PRACTICES 里第几行、"做法"表第几栏) */
export const enum Practice {
  Register = 0,
  Exam = 1,
  Army = 2,
  Census = 3,
  Rail = 4,
  Wire = 5,
  Press = 6,
  FiefLess = 7,
  FiefNone = 8,
}

/** 国都能力那一行:五种能力 + 时代(时代在最后一栏) */
export const CAPITAL_COLS: readonly string[] = [...CAPS, '时代'];
export const ERA_COL = CAPS.length;

/** 一行:id 是"做法"表的栏名;前提是发明表里的那一样(invention),或者国都进了第几个时代(era);does 写有了以后改什么 */
export interface PracticeRow {
  id: string;
  /** 给人看的名字(界面上"要等国中有了某某") */
  name: string;
  need: { invention: string } | { era: number };
  does: string;
}

export const PRACTICES: readonly PracticeRow[] = [
  { id: '户籍', name: '户籍', need: { invention: '户籍' }, does: '有了才能议直征' },
  { id: '考选', name: '文官考选', need: { invention: '文官考选' }, does: '有了才能议铨选;豪族把持的州的阻力减半' },
  { id: '常备军', name: '常备军', need: { invention: '常备军' }, does: '有了才能议收兵权' },
  { id: '普查', name: '人口普查', need: { invention: '人口普查' }, does: '直征、分成多收一截,开销打折' },
  { id: '铁路', name: '铁路', need: { invention: '铁路' }, does: '管得到的远近更远,割据收回得容易' },
  { id: '电报', name: '电报', need: { invention: '电报' }, does: '新起割据的赔率减半' },
  { id: '报刊', name: '报刊', need: { invention: '报刊' }, does: '只记下前提' },
  { id: '封镇渐废', name: '火药时代', need: { era: 4 }, does: '分封边地、设边镇少议;改土归流、罢边镇更容易' },
  { id: '封镇尽废', name: '工业时代', need: { era: 5 }, does: '分封边地、设边镇不再议' },
];

/** 每样做法看国都能力的哪一栏、到几 */
const NEED_COL: readonly number[] = PRACTICES.map((row) => {
  if ('era' in row.need) return ERA_COL;
  const name = row.need.invention;
  const inv = INVENTIONS.find((x) => x.name === name);
  if (!inv) throw new Error(`做法表:发明表里没有「${name}」`);
  return inv.cap;
});
const NEED_LEVEL: readonly number[] = PRACTICES.map((row) => ('era' in row.need ? row.need.era : INVENTIONS.find((x) => x.name === (row.need as { invention: string }).invention)!.level));

/** 第 i 样做法的前提:国都能力的第几栏(CAPITAL_COLS)、到几 */
export function practiceNeed(i: Practice): { col: number; level: number } {
  return { col: NEED_COL[i], level: NEED_LEVEL[i] };
}

// ---- 有了以后改什么(数) ----
/** 铁路:管得到的远近乘这么多;割据每次看内政收回的机会乘这么多 */
export const RAIL_REACH = 1.5;
export const RAIL_RECLAIM = 2;
/** 电报:新起割据的赔率乘这么多 */
export const WIRE_LORD = 0.5;
/** 人口普查:直征、分成多收的几成乘 CENSUS_LIFT,开销乘 CENSUS_COST */
export const CENSUS_LIFT = 1.3;
export const CENSUS_COST = 0.6;
/** 文官考选:议收任免时豪族把持的州的阻力乘这么多 */
export const EXAM_STAKE = 0.5;
/** 封镇渐废:分封边地、设边镇只有这么几成的机会议;改土归流、罢边镇的分加这么多 */
export const FIEF_LESS_ODDS = 0.5;
export const FIEF_LESS_EASE = 0.3;

/**
 * 国都那州(lv 是州 × 五种能力,r 是国都所在的州,era 是那州的时代数值)有了哪几样做法:按位(1 << Practice)。
 * 能力不是数的当作没有
 */
export function practiceMask(lv: ArrayLike<number>, r: number, era: number): number {
  let m = 0;
  const o = r * CAPS.length;
  for (let i = 0; i < PRACTICES.length; i++) {
    const v = NEED_COL[i] === ERA_COL ? era : lv[o + NEED_COL[i]];
    if (v >= NEED_LEVEL[i]) m |= 1 << i;
  }
  return m;
}

/** 按位里有没有第 i 样 */
export function hasPractice(mask: number, i: Practice): boolean {
  return (mask & (1 << i)) !== 0;
}

/** 输入表的上下限(只是写在卡上;事件层直接填) */
const BIG = 1e15;

/**
 * 做法的两张表(放进政局的数表):国都能力(输入,control.ts 每年填:国都所在州的五种能力和时代)、
 * 做法(一样一栏,国都能力到了前提 = 1)。规则由上面的表生成
 */
export function practiceCards(): TableCard[] {
  return [
    { id: '国都能力', name: '国都所在州的五种能力和时代', unit: 'polity', input: true, cols: [...CAPITAL_COLS], min: -BIG, max: BIG, off: 0 },
    {
      id: '做法',
      name: '时代做法(国都那州到了前提就有:1)',
      unit: 'polity',
      cols: PRACTICES.map((r) => r.id),
      min: 0,
      max: 1,
      off: 0,
      builtin: true,
      consts: { NEED_COL, NEED_LEVEL },
      rule: 'if(国都能力[NEED_COL[col]] >= NEED_LEVEL[col], 1, 0)',
    },
  ];
}
