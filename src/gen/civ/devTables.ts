/**
 * 发展度(development.ts)的数表:每样数一张表、一张登记卡,规则用数表的公式语言写(tables/compile.ts),每 STEP 年算一步。
 * 规则的意思见 development.ts 的文件头;这里只管"写成公式",运算的先后和以前手写的循环一样,结果逐位一样。
 *
 * 一步里的先后(after;同一层的几张表互不相干):
 *   有没有人住过、近年战乱、各国有哪些物产 → 附近买得到哪些物产 → 四样能力 → 动员
 *   →(事件层:上一步到这一步的攻占、战役、洗劫、毁城、大崩解,扣能力、记战乱)
 *   → 到过的最高值、时代、物产哪年发现 → 物产的存量 → 眼下能用多少
 * 能力读到的时代、到过的最高值、眼下能用的物产都是这一步开头的(上一步算完的)。
 *
 * 输入表(事件层每步填好):民族、国(编号表;国 = 州 → 国);人口、城的规模、有没有路、港口、大河、平原、是不是国都、游牧、
 * 归了现在的民族 / 国家是哪一年;物产的底子、物产从哪一年起有;各国的国号档位、有几州、立国的年份、发展重点的倍数;
 * 这一步里全球大疫的凋敝占几成(pandemic.ts;没有全球大疫时全是 0,规则走平常那一支);推一把发展的倍数(boost.ts;没推的州全是 1,规则算出来逐位不变)。
 */
import type { TableCard } from './tables';

/** 物产还没发现(发现的年份记成这个;表里不许存无穷大) */
export const NEVER = 1e12;
/** 输入表的上下限(只是写在卡上;输入表由事件层直接填,不压) */
const BIG = 1e15;

/** 规则里用的常数(development.ts 给;名字和那边一样) */
export interface DevRuleConsts {
  RESOURCES: readonly string[];
  CAPS: readonly string[];
  /** 五种能力里前四样的下标:生产、运输、信息、行政 */
  ERA_YEARS: readonly number[];
  LEVEL_MAX: number;
  LEARN: readonly number[];
  SAME_STATE: number;
  ADMIN_ABROAD: number;
  LINK: readonly number[];
  SEA_ROUTE: number;
  SEA_PER_TRANSPORT: number;
  OVERSHOOT: number;
  OVERSHOOT_LEARN: number;
  OVERSHOOT_SLOW: number;
  GATE_NEAR: number;
  GATE_SLOW: number;
  RECOVER: number;
  /** 全球大疫的凋敝里向邻居学只剩几成(自己长、恢复都停下) */
  SLUMP_LEARN: number;
  WAR_KEEP: number;
  SETTLE_CARRY: number;
  ABANDON_KEEP: number;
  ADMIN_SIZE: number;
  TRIBAL_ADMIN_MAX: number;
  ERA_WEIGHT: readonly number[];
  ADMIN_GAP: number;
  WAR_CALM: number;
  FOCUS_MOB: number;
  DISCOVER_AT: readonly number[];
  LIFE: readonly number[];
  DEPLETE: readonly number[];
  REGROW: number;
  /** 卡脖子的几样物产(下标):铜锡、铁、煤、石油、稀有矿 */
  GATE_RES: readonly number[];
  /** 林、渔、田、牧的下标 */
  TIMBER: number;
  FISH: number;
  GRAIN: number;
}

/** 发展度的全部表(输入表在前);step = 多少年算一步 */
export function devCards(k: DevRuleConsts, step: number): TableCard[] {
  const R = k.RESOURCES;
  const [生产, 运输, 信息, 行政] = k.CAPS;
  const gateCols = k.GATE_RES.map((i) => R[i]);
  const num = (id: string, name: string, cols?: readonly string[], off = 0): TableCard => ({ id, name, unit: 'region', input: true, min: -BIG, max: BIG, off, ...(cols ? { cols: [...cols] } : {}) });
  const pol = (id: string, name: string, off: number, cols?: readonly string[]): TableCard => ({ ...num(id, name, cols, off), unit: 'polity' });
  const id = (cid: string, name: string): TableCard => ({ id: cid, name, unit: 'region', kind: 'id', min: -1, max: 1e9, off: -1 });
  const calc = (card: Omit<TableCard, 'unit' | 'every'>): TableCard => ({ unit: 'region', every: step, ...card });

  const inputs: TableCard[] = [
    id('民族', '归哪个民族'),
    id('国', '归哪国'),
    num('人口', '人口的规模(0–1)'),
    num('城', '城的规模(0–1)'),
    num('路', '有没有路'),
    num('港口', '有没有港口'),
    num('大河', '有没有大河'),
    num('平原', '治所是不是平原'),
    num('国都', '是不是国都'),
    num('游牧', '是不是游牧民族'),
    num('归族', '归了现在的民族是哪一年'),
    num('归国', '归了现在的国家是哪一年'),
    num('物产', '物产的底子(0–3 档)', R),
    num('物产起', '物产从哪一年起有', R),
    pol('国号', '国号档位', -1),
    pol('州数', '国家有几州', 0),
    pol('立国', '立国的年份', 0),
    pol('重点', '发展重点:自己长的倍数', 1, [生产, 运输, 信息, 行政]),
    pol('重点动员', '发展重点:挑动员的时间占几成', 0),
    num('凋敝', '这一步里全球大疫的凋敝占了几成(0–1;没有 = 0)'),
    num('推', '推一把发展:这一步里自己长、向邻居学的倍数(没推 = 1)', undefined, 1),
  ];

  // 有人住的邻州(动力、学、带着本事来,都只看有人住的邻居)
  const live = 'has(民族)';
  const nbLive = 'has(nb.民族)';
  /** 和邻州 nb 在同一国 */
  const same = '(有国 and nb.国 == 国)';
  /** 这条邻边学得多快:按边的类型,航线另加本州运输能力的几成;同一国里快几倍 */
  const link = `(LINK[edge.kind] + if(edge.kind == SEA_ROUTE, SEA_PER_TRANSPORT * 能力.${运输}, 0)) * if(${same}, SAME_STATE, 1)`;
  /** 附近(本州、本国、有人住的邻州)买不买得到第 i 样卡脖子的物产 */
  const lack = (i: number) => `近有.${gateCols[i]} == 0`;
  // 刚有人住(或空了以后又有人来):取邻居最高值的几成,和本州留下的取高的;没人住了:慢慢掉
  const settled = (t: string, grow: string) =>
    `if(dt == 0, ${t},\n  if(not 在, if(住过 >= 1, ${t} * ABANDON_KEEP, ${t}),\n  if(住过 != 1, nbmax(nb.${t} * SETTLE_CARRY, ${t}, ${nbLive}),\n  ${grow})))`;

  const capRule = [
    `let 在 = ${live}`,
    'let 有国 = has(国)',
    'let 和平 = 1 / (1 + 战乱)',
    `let 外邦 = min(4, nbcount(${nbLive} and nb.国 != 国))`,
    // 动力:生产看粮和人口,运输看路、大河、港口、木材,信息看大城、国都、外邦,行政看国家
    `let 动力 = if(col == 0, 0.15 + 0.1 * 能用.${R[k.GRAIN]} + 1.2 * 人口,`,
    `  if(col == 1, 0.1 + 0.3 * 路 + 0.2 * 大河 + 0.3 * 港口 + 0.05 * 能用.${R[k.TIMBER]} + 0.6 * 人口,`,
    `  if(col == 2, 0.1 + 1.2 * 城 + if(国都, 0.3, 0) + 0.08 * 外邦 + 0.2 * 路,`,
    '  if(有国, 0.3 + 0.15 * 国号 + 0.2 * min(1, 州数 / ADMIN_SIZE) + if(国都, 0.4, 0) + 0.3 * min(1, (year - 立国) / 400), 0.15))))',
    // 向这样能力最高的有人住的邻州学;行政跨国只剩几成
    // (乘 1 不改变一个数:写成 link × (跨国的行政 ? ADMIN_ABROAD : 1),和"跨国的行政取 link × ADMIN_ABROAD、别的取 link"逐位一样)
    `let 学 = nbmax((nb.能力 - 能力) * LEARN[col] * (${link} * if(col == 3 and not ${same}, ADMIN_ABROAD, 1)), 0, ${nbLive} and nb.能力 - 能力 > 0)`,
    // 跨时代的门槛:离下一个时代不到 GATE_NEAR 时查物产(只卡生产)、组织、太平和城、地理
    'let 门 = floor(能力) + 1',
    'let 近门 = 能力 > floor(能力) + 1 - GATE_NEAR',
    `let 缺物 = col == 0 and if(门 == 1, ${lack(0)}, if(门 == 2, ${lack(1)}, if(门 == 5, ${lack(2)} or ${lack(1)}, if(门 == 6, ${lack(3)}, if(门 == 7, ${lack(4)}, 0)))))`,
    `let 不够 = (门 >= 2 and not 有国) or (门 >= 3 and (国号 < 1 or 能力.${行政} < 门 - ADMIN_GAP)) or (门 >= 4 and (战乱 > WAR_CALM or 路 == 0)) or (门 >= 5 and not (港口 or 大河 or 平原))`,
    // 自己长:动力 ÷ 这一档要的年数,打仗的地方慢;发展重点;领先时代太多、卡在门口时慢;推一把发展再乘「推」(卡在门口时不乘,和没推一样慢)
    'let 长 = 动力 * 和平 / ERA_YEARS[min(ERA_YEARS_LAST, floor(能力))] * 重点 * if(能力 > 时代 + OVERSHOOT, OVERSHOOT_SLOW, 1) * if(近门 and (缺物 or 不够), GATE_SLOW, 推)',
    // 向邻居学:推一把发展的乘「推」,一步里至多追平最高的邻居(没推的 = 学,逐位不变)
    `let 得 = if(推 == 1, 学, min(学 * 推, nbmax(nb.能力 - 能力, 0, ${nbLive} and nb.能力 - 能力 > 0) / dt)) * if(能力 > 时代 + OVERSHOOT_LEARN, OVERSHOOT_SLOW, 1)`,
    // 跌下去的按到过的最高值较快地恢复
    'let 复 = (最高[col] - 能力) * RECOVER',
    'let 平常 = 能力 + dt * (长 + 得 + if(复 > 0, 复, 0))',
    // 全球大疫的凋敝里(占这一步的几成):不自己长、不恢复,向邻居学只剩 SLUMP_LEARN(没有凋敝的照平常算,逐位一样)
    'let 新 = if(凋敝 > 0, 能力 + dt * ((1 - 凋敝) * (长 + 得 + if(复 > 0, 复, 0)) + 凋敝 * SLUMP_LEARN * 得), 平常)',
    'let 封顶 = if(col == 3 and not 有国 and 新 > TRIBAL_ADMIN_MAX, max(能力, TRIBAL_ADMIN_MAX), 新)',
    settled('能力', 'min(LEVEL_MAX, 封顶)'),
  ].join('\n');

  const mobRule = [
    `let 在 = ${live}`,
    'let 有国 = has(国)',
    // 跟着生产和行政走(这一步刚算完的),游牧另高一截;挑了动员当发展重点的再高一点
    `let 目标 = 0.5 * (能力.${生产} + 能力.${行政}) + if(游牧, 0.7, 0) + if(有国, 0.15, 0) + FOCUS_MOB * 重点动员`,
    settled('动员', 'min(LEVEL_MAX, 动员 + (目标 - 动员) * min(1, 0.01 * dt))'),
  ].join('\n');

  const w = k.ERA_WEIGHT;
  const eraRule = `if(${live}, 1 / (${w[0]} / (能力.${生产} + 1) + ${w[1]} / (能力.${运输} + 1) + ${w[2]} / (能力.${信息} + 1) + ${w[3]} / (能力.${行政} + 1)) - 1, 0)`;

  const foundRule = [
    `let 产 = 能力.${生产}`,
    `let 原 = prev(能力.${生产})`,
    'let t0 = year - dt',
    // 这一步里哪一刻过了门槛(按上一步到这一步线性估;不早于这州归了现在的民族和国家、不早于这样物产有了)
    'let 过 = t0 + (year - t0) * if(产 > 原, min(1, max(0, (DISCOVER_AT[col] - 原) / (产 - 原))), 1)',
    `if(发现 < NEVER or 物产 == 0 or not ${live} or 产 < DISCOVER_AT[col], 发现, min(year, max(max(max(归族, 归国), 物产起), 过)))`,
  ].join('\n');

  // 存量、眼下能用:还没有、还没发现的不动
  const untouched = '物产 == 0 or 发现 >= NEVER';
  const tech = `min(1, 0.25 + 0.5 * max(0, 能力.${生产} - DISCOVER_AT[col]))`;
  const stock: Record<string, string> = {};
  const avail: Record<string, string> = {};
  R.forEach((name, i) => {
    if (k.LIFE[i]) {
      // 矿:技术越高采得越多;只扣发现以后、有人住以后的那几年
      stock[name] = [`let 技 = ${tech}`, 'let 年 = max(0, min(dt, year - max(发现, 归族)))', `if(${untouched}, 存量, if(${live}, max(0, 存量 - 年 * 技 * (0.4 + 0.6 * 人口)), 存量))`].join('\n');
      avail[name] = [`let 技 = ${tech}`, `if(${untouched}, 能用, 物产 * 技 * min(1, 存量 / (0.3 * 物产 * LIFE[col])))`].join('\n');
    } else if (k.DEPLETE[i]) {
      // 林、渔、田、牧:人多、开发久就吃空,人少了慢慢长回来;捕鱼到火药以后才吃得空
      const press =
        i === k.TIMBER ? 'max(0, 人 - 0.35) * (1 + 0.3 * max(0, 时代 - 3))'
        : i === k.FISH ? 'max(0, 人 - 0.3) * max(0, 时代 - 3.5)'
        : i === k.GRAIN ? 'max(0, 人 - 0.7)'
        : 'max(0, 人 - 0.55)';
      stock[name] = [`let 人 = if(${live}, 人口, 0)`, `let 压 = ${press}`, `if(${untouched}, 存量, min(1, max(0.05, 存量 + dt * (REGROW * (1 - 存量) - DEPLETE[col] * 压 * 存量))))`].join('\n');
      avail[name] = `if(${untouched}, 能用, 物产 * 存量)`;
    } else avail[name] = `if(${untouched}, 能用, 物产)`;
  });

  const consts: Record<string, number | readonly number[]> = {
    ERA_YEARS: k.ERA_YEARS,
    ERA_YEARS_LAST: k.ERA_YEARS.length - 1,
    LEVEL_MAX: k.LEVEL_MAX,
    LEARN: k.LEARN,
    SAME_STATE: k.SAME_STATE,
    ADMIN_ABROAD: k.ADMIN_ABROAD,
    LINK: k.LINK,
    SEA_ROUTE: k.SEA_ROUTE,
    SEA_PER_TRANSPORT: k.SEA_PER_TRANSPORT,
    OVERSHOOT: k.OVERSHOOT,
    OVERSHOOT_LEARN: k.OVERSHOOT_LEARN,
    OVERSHOOT_SLOW: k.OVERSHOOT_SLOW,
    GATE_NEAR: k.GATE_NEAR,
    GATE_SLOW: k.GATE_SLOW,
    RECOVER: k.RECOVER,
    SLUMP_LEARN: k.SLUMP_LEARN,
    WAR_KEEP: k.WAR_KEEP,
    SETTLE_CARRY: k.SETTLE_CARRY,
    ABANDON_KEEP: k.ABANDON_KEEP,
    ADMIN_SIZE: k.ADMIN_SIZE,
    TRIBAL_ADMIN_MAX: k.TRIBAL_ADMIN_MAX,
    ADMIN_GAP: k.ADMIN_GAP,
    WAR_CALM: k.WAR_CALM,
    FOCUS_MOB: k.FOCUS_MOB,
    DISCOVER_AT: k.DISCOVER_AT,
    LIFE: k.LIFE,
    DEPLETE: k.DEPLETE,
    REGROW: k.REGROW,
    NEVER,
    GATE_RES: k.GATE_RES,
  };
  const top = k.LEVEL_MAX + 1;
  const tables: TableCard[] = [
    calc({ id: '住过', name: '有没有人住过(0 没有、1 住着、3 住过后来空了)', min: 0, max: 3, off: 0, rule: `if(dt == 0, 住过, if(${live}, 1, if(住过 >= 1, 3, 0)))` }),
    // 打仗的旧账每步留几成;这一步的仗由事件层加上
    calc({ id: '战乱', name: '近年战乱', min: 0, max: 1e9, off: 0, rule: '战乱 * WAR_KEEP' }),
    { id: '国有', name: '国里有没有这样物产', unit: 'polity', every: step, cols: gateCols, min: 0, max: 1, off: 0, rule: 'maxof(if(能用[GATE_RES[col]] > 0, 1, 0))' },
    calc({ id: '近有', name: '附近买不买得到这样物产', cols: gateCols, min: 0, max: 1, off: 0, after: ['国有'], rule: `let 邻 = nbcount(${nbLive} and nb.能用[GATE_RES[col]] > 0)\nif(能用[GATE_RES[col]] > 0 or 国有 > 0 or 邻 > 0, 1, 0)` }),
    calc({ id: '能力', name: '四样能力', cols: [生产, 运输, 信息, 行政], min: 0, max: top, off: 0, after: ['近有'], rule: capRule }),
    calc({ id: '动员', name: '动员能力', min: 0, max: top, off: 0, after: ['能力'], rule: mobRule }),
    calc({ id: '最高', name: '能力到过的最高值', cols: [...k.CAPS], min: 0, max: top, off: 0, after: ['动员'], rule: 'let 现 = if(col < 4, 能力[col], 动员)\nif(现 > 最高, 现, 最高)' }),
    calc({ id: '时代', name: '时代', min: 0, max: top, off: 0, after: ['动员'], rule: eraRule }),
    calc({ id: '发现', name: '物产哪一年发现', cols: [...R], min: -BIG, max: 2 * NEVER, off: NEVER, init: NEVER, after: ['动员'], rule: foundRule }),
    calc({ id: '存量', name: '物产的存量(矿还剩几年的量,林渔田牧还剩几成)', cols: [...R], min: 0, max: 1e9, off: 0, after: ['发现', '时代'], rule: stock }),
    calc({ id: '能用', name: '物产眼下能用多少(0–3 档)', cols: [...R], min: 0, max: 1e3, off: 0, after: ['存量'], rule: avail }),
  ];
  return [...inputs, ...tables.map((c) => ({ ...c, consts, builtin: true }))];
}
