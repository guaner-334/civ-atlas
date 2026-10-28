/**
 * 思潮(ideology.ts)的数表:每样数一张表、一张登记卡,规则用数表的公式语言写(tables/compile.ts),每 STEP 年算一步。
 * 规则的意思见 ideology.ts 的文件头;这里只管"写成公式"。
 *
 * 一步里的先后(after):各说在这州合不合(合)→ 各州各说的接受度(思潮)→ 各国各说的接受度(国中,按人口加权)。
 * 思潮读到的国中是这一步开头的(上一步算完的);对头(别的几说)也是这一步开头的。
 *
 * 输入表(事件层每步填好):民族、国(编号表;国 = 州 → 国);五种能力、城的人口、一州的人口(城加乡村,千人)、港口、
 * 粮和矿眼下能用多少;各国的国号档位、有几州。民族只用来看这州有没有人住,不进接受度的算法。
 */
import type { TableCard } from './tables';

/** 规则里用的常数(ideology.ts 给;名字和那边一样) */
export interface IdeoRuleConsts {
  /** 各说的名字(表的栏名) */
  NAMES: readonly string[];
  /** 五种能力的名字(能力表的栏名,次序同 development.ts 的 CAPS) */
  CAPS: readonly string[];
  /** 各说在哪扎根:一说一条公式(0–1;能读输入表,城 = 城的规模 0–1) */
  ROOTS: readonly string[];
  /** 冒出来的前提:两样(能力的下标、到哪一档;只有一样的两样写成一样) */
  NEED_A_CAP: readonly number[];
  NEED_A_LV: readonly number[];
  NEED_B_CAP: readonly number[];
  NEED_B_LV: readonly number[];
  /** 助长的发明(能力的下标、到哪一档;没有 = 档位写成 NO_BOOST) */
  BOOST_CAP: readonly number[];
  BOOST_LV: readonly number[];
  /** 对头:第 k 说被第 j 说压几成(说数 × 说数,按行) */
  RIVAL: readonly number[];
  BELOW: number;
  ABOVE: number;
  BOOST: number;
  LEARN: number;
  SAME_STATE: number;
  LINK: readonly number[];
  SEA_ROUTE: number;
  SEA_PER_TRANSPORT: number;
  RECEPT: number;
  PRESS_CAP: number;
  PRESS_LV: number;
  PRESS_UP: number;
  GROW: number;
  FOOT: number;
  FADE: number;
  CITY_HALF: number;
}

/** 输入表的上下限(只是写在卡上;输入表由事件层直接填,不压) */
const BIG = 1e15;

/** 思潮的全部表(输入表在前);step = 多少年算一步 */
export function ideoCards(k: IdeoRuleConsts, step: number): TableCard[] {
  const [生产, 运输, 信息, 行政, 动员] = k.CAPS;
  const names = [...k.NAMES];
  const K = names.length;
  const num = (id: string, name: string, cols?: readonly string[], off = 0): TableCard => ({ id, name, unit: 'region', input: true, min: -BIG, max: BIG, off, ...(cols ? { cols: [...cols] } : {}) });
  const pol = (id: string, name: string, off: number): TableCard => ({ ...num(id, name, undefined, off), unit: 'polity' });
  const id = (cid: string, name: string): TableCard => ({ id: cid, name, unit: 'region', kind: 'id', min: -1, max: 1e9, off: -1 });

  const inputs: TableCard[] = [
    id('民族', '归哪个民族'),
    id('国', '归哪国'),
    num('能力', '五种能力(和时代同一把尺子)', [生产, 运输, 信息, 行政, 动员]),
    num('城民', '城的人口(千人;没有城 = 0)'),
    num('人数', '一州的人口(城加乡村,千人)'),
    num('港口', '有没有港口'),
    num('粮', '粮眼下能用多少(0–3 档)'),
    num('矿', '铜锡、铁、煤眼下能用多少(各 0–3 档,加起来)'),
    pol('国号', '国号档位', -1),
    pol('州数', '国家有几州', 0),
  ];

  // 合:一说一条(各说的公式只读输入表;城 = 城的规模 0–1)
  const root: Record<string, string> = {};
  names.forEach((n, i) => (root[n] = [`let 城 = 城民 / (城民 + CITY_HALF)`, `clamp(${k.ROOTS[i]}, 0, 1)`].join('\n')));

  /** 能力到前提那一档的几成(差 BELOW 档 = 0,到了 = BELOW / (BELOW + ABOVE),过了 ABOVE 档 = 1) */
  const ready = (cap: string, lv: string) => `clamp((能力[${cap}] - ${lv} + BELOW) / (BELOW + ABOVE), 0, 1)`;
  /** 对头压了几成:第 j 说的接受度 × RIVAL[col × 说数 + j],加起来 */
  const press = Array.from({ length: K }, (_, j) => `RIVAL[col * ${K} + ${j}] * 思潮[${j}]`).join(' + ');
  const nbLive = 'has(nb.民族)';
  const link = `(LINK[edge.kind] + if(edge.kind == SEA_ROUTE, SEA_PER_TRANSPORT * 能力.${运输}, 0)) * if(has(国) and nb.国 == 国, SAME_STATE, 1)`;
  const ideoRule = [
    'let 在 = has(民族)',
    // 这州能到多高:合 × 前提够不够 × 助长 × (1 − 对头压的)
    `let 备 = min(${ready('NEED_A_CAP[col]', 'NEED_A_LV[col]')}, ${ready('NEED_B_CAP[col]', 'NEED_B_LV[col]')})`,
    `let 助 = 1 - BOOST + BOOST * ${ready('BOOST_CAP[col]', 'BOOST_LV[col]')}`,
    `let 压 = ${press}`,
    'let 标 = if(在, 合 * 备 * 助 * max(0, 1 - 压), 0)',
    // 向邻州学:向接受度最高的有人住的邻州靠拢,同一国快、跨国慢,翻山、过海峡、走航线更慢;合得来的学得多(合不来的学到 RECEPT 那几成,
    // 前提差得远的学不进来);有报刊的快。一步至多追平最高的邻州
    `let 差 = nbmax(nb.思潮 - 思潮, 0, ${nbLive} and nb.思潮 > 思潮)`,
    `let 学 = nbmax((nb.思潮 - 思潮) * ${link}, 0, ${nbLive} and nb.思潮 > 思潮)`,
    'let 报 = if(能力[PRESS_CAP] >= PRESS_LV, PRESS_UP, 1)',
    'let 传 = if(在, min(差, dt * LEARN * 报 * (RECEPT * 备 + (1 - RECEPT) * 标) * 学), 0)',
    // 扎根:往标长,刚传进来的(不到 FOOT)长得慢;退潮:比标高的往下掉
    'let 长 = if(思潮 < 标, GROW * (标 - 思潮) * min(1, 思潮 / FOOT), 0)',
    'let 退 = if(思潮 > 标, FADE * (思潮 - 标), 0)',
    'if(dt == 0, 思潮, clamp(思潮 + 传 + dt * (长 - 退), 0, 1))',
  ].join('\n');

  // 国中:国里有人住的各州按人口加权(一州至少算 1 千人)
  const polityRule = ['let w = sumof(人数 + 1, has(民族))', 'if(w > 0, sumof(思潮 * (人数 + 1), has(民族)) / w, 0)'].join('\n');

  const consts: Record<string, number | readonly number[]> = {
    NEED_A_CAP: k.NEED_A_CAP,
    NEED_A_LV: k.NEED_A_LV,
    NEED_B_CAP: k.NEED_B_CAP,
    NEED_B_LV: k.NEED_B_LV,
    BOOST_CAP: k.BOOST_CAP,
    BOOST_LV: k.BOOST_LV,
    RIVAL: k.RIVAL,
    BELOW: k.BELOW,
    ABOVE: k.ABOVE,
    BOOST: k.BOOST,
    LEARN: k.LEARN,
    SAME_STATE: k.SAME_STATE,
    LINK: k.LINK,
    SEA_ROUTE: k.SEA_ROUTE,
    SEA_PER_TRANSPORT: k.SEA_PER_TRANSPORT,
    RECEPT: k.RECEPT,
    PRESS_CAP: k.PRESS_CAP,
    PRESS_LV: k.PRESS_LV,
    PRESS_UP: k.PRESS_UP,
    GROW: k.GROW,
    FOOT: k.FOOT,
    FADE: k.FADE,
    CITY_HALF: k.CITY_HALF,
  };
  const tables: TableCard[] = [
    { id: '合', name: '各说在这州合不合(0–1)', unit: 'region', every: step, cols: names, min: 0, max: 1, off: 0, rule: root },
    // 自己是 0、邻州也全是 0 的格子一定还是 0(没传进来就没有;冒出来由事件层写),跳过不算
    { id: '思潮', name: '各说的接受度(0–1)', unit: 'region', every: step, cols: names, min: 0, max: 1, off: 0, after: ['合'], zeroStays: true, rule: ideoRule },
    { id: '国中', name: '各国各说的接受度(按人口加权)', unit: 'polity', every: step, cols: names, min: 0, max: 1, off: 0, after: ['思潮'], rule: polityRule },
  ];
  return [...inputs, ...tables.map((c) => ({ ...c, consts, builtin: true }))];
}
