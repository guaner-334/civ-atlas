/**
 * 数表的登记卡:加一样设定 = 加一张表 + 一张卡。卡上写清这张表是什么、按什么单位记、几栏、多久算一次、上下限、
 * 读哪些表、每步怎么算、关掉时等于什么。引擎(engine.ts)只认卡,不认具体是哪样设定。
 *
 * - 单位:tile(地块)、region(州)、polity(国)、world(全世界一个数)。会往邻格扩散、地图上要看得见的按地块;
 *   一个衙门一本账的按州或国;变得慢的按州
 * - 频率:从 FREQUENCIES 里挑,大格是小格的整数倍,几张表同一年要算时对得齐
 * - 规则三种写法(可以同时有,按这个先后叠起来):
 *   · rule:这一格的新值(要自己乘 dt,例如 pop + dt * 增长)
 *   · rate:每年变多少(引擎乘上这一步的年数加到旧值上,改频率不用改公式)
 *   · move:往每个邻格每年搬走多少(不小于 0;搬出去的从这格减、加到邻格,总量不变),可以记成流向
 * - 编号表(kind: 'id'):归哪国、主要民族这类,只比是不是同一个,不加减;只能由事件层(或底图)填,规则里只读
 * - 输入表(input: true):底图或事件层每步填好的数(宜居度、是不是国都……),规则里只读
 */

export type Unit = 'tile' | 'region' | 'polity' | 'world';

/** 能选的频率(年):大格都是小格的整数倍 */
export const FREQUENCIES: readonly number[] = [0.5, 1, 5, 10, 20, 100, 1000];

export interface TableCard {
  /** 规则里用的名字(字母、汉字、数字、下划线,不以数字开头) */
  id: string;
  /** 给人看的名字 */
  name: string;
  unit: Unit;
  /** 各栏的名字(多栏表:一样东西有好几种,每种一栏);不写 = 只有一栏 */
  cols?: string[];
  /** 编号表:只比是不是同一个(−1 = 没有) */
  kind?: 'num' | 'id';
  /** 底图或事件层填的数,没有规则 */
  input?: boolean;
  /** 多少年算一次(FREQUENCIES 之一);不写 = 1 */
  every?: number;
  /** 上下限:超出的压回来(计数,太多时报"越滚越大") */
  min: number;
  max: number;
  /** 每年最多变多少(超出的压回来);不写 = 不限 */
  maxRate?: number;
  /** 开头的值:一个数,或一条公式(只能读输入表和常数);不写 = off */
  init?: number | string;
  /** 关掉时等于什么(读它的规则读到这个数;关掉后历史要和没加这张表时一样) */
  off: number;
  /** 新值(一条公式算所有栏,或每栏一条) */
  rule?: string | Record<string, string>;
  /** 每年变多少 */
  rate?: string | Record<string, string>;
  /** 每年往邻格搬走多少(所有栏同一条,col 是第几栏) */
  move?: string;
  /** 搬家记成流向:按州对州汇总,每多少年一份(不写 = 不记) */
  flowEvery?: number;
  /** 规则里用的常数:一个数,或按栏取的一串数(写成 名字[col]) */
  consts?: Record<string, number | readonly number[]>;
  /** 规则读哪些表(不写 = 照公式里用到的;写了就只许读这些,多读了算写错) */
  reads?: string[];
  /**
   * 自己是 0、邻格也全是 0 的格子跳过(扩散规则下它一定还是 0,结果和全算一样)。只在确实如此时打开:
   * 规则在"自己和邻格全 0"时一定得 0,而且不会凭空冒出来(凭空冒出要写成单独的事件)
   */
  zeroStays?: boolean;
  /** 自带规则的备份:这张卡的规则被拦下时退回它;没有 = 关掉(等于 off) */
  fallback?: TableCard;
}

/** 卡写得对不对(规则本身由 compile.ts 查);对的返回空数组 */
export function cardProblems(card: TableCard): string[] {
  const out: string[] = [];
  const say = (s: string) => out.push(`「${card.name || card.id}」${s}`);
  if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(card.id)) say(`的名字 ${card.id} 只能用字母、汉字、数字、下划线,不以数字开头`);
  if (!['tile', 'region', 'polity', 'world'].includes(card.unit)) say('的单位只能是地块、州、国或全世界');
  const every = card.every ?? 1;
  if (!FREQUENCIES.includes(every)) say(`的频率只能从 ${FREQUENCIES.join('、')} 年里挑`);
  if (!(Number.isFinite(card.min) && Number.isFinite(card.max) && card.min <= card.max)) say('要写上下限(有限的数,下限不大于上限)');
  if (!Number.isFinite(card.off)) say('要写关掉时等于什么');
  if (card.maxRate !== undefined && !(card.maxRate > 0)) say('的每年最多变多少要大于 0');
  if (card.cols && (!card.cols.length || new Set(card.cols).size !== card.cols.length)) say('的栏名不能空、不能重复');
  const cols = card.cols ?? [];
  for (const c of cols) if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(c)) say(`的栏名 ${c} 只能用字母、汉字、数字、下划线`);
  for (const key of ['rule', 'rate'] as const) {
    const r = card[key];
    if (r && typeof r === 'object') for (const c of Object.keys(r)) if (!cols.includes(c)) say(`的 ${key} 里有一栏「${c}」卡上没有`);
  }
  if (card.input || card.kind === 'id') {
    if (card.rule || card.rate || card.move) say(card.kind === 'id' ? '是编号表,只能由事件层填,不能有规则' : '是输入表,不能有规则');
  } else if (!card.rule && !card.rate && !card.move) say('没写规则(rule、rate、move 至少要有一样)');
  if (card.move && (card.unit === 'polity' || card.unit === 'world')) say('按国或全世界记,没有邻格,不能写 move');
  if (card.zeroStays && card.unit !== 'tile' && card.unit !== 'region') say('的"全 0 跳过"只对地块、州有用');
  if (card.flowEvery !== undefined && (!card.move || !FREQUENCIES.includes(card.flowEvery) || card.flowEvery < every || card.flowEvery % every)) {
    say('的流向要有 move,间隔从频率菜单里挑、是这张表频率的整数倍');
  }
  if (card.consts) {
    for (const [k, v] of Object.entries(card.consts)) {
      const ok = typeof v === 'number' ? Number.isFinite(v) : Array.isArray(v) && v.length > 0 && v.every((x) => Number.isFinite(x));
      if (!ok) say(`的常数 ${k} 要是有限的数或一串数`);
    }
  }
  if (card.fallback) {
    if (card.fallback.id !== card.id || card.fallback.unit !== card.unit || (card.fallback.cols ?? []).join() !== cols.join()) say('的备份规则要和它同名、同单位、同栏');
    out.push(...cardProblems(card.fallback));
  }
  return out;
}

/** 卡的栏数 */
export function colCount(card: TableCard): number {
  return card.cols?.length ?? 1;
}

/**
 * 速度额度:按地块每年算的栏(会扩散的表的主要开销)要控制在 TILE_COLS_PER_YEAR 以内,
 * 按州、按国的另算(每年 REGION_COLS_PER_YEAR)。频率低的按"折成每年几栏"算(每 5 年算一次的一栏 = 0.2 栏)
 */
export const TILE_COLS_PER_YEAR = 40;
export const REGION_COLS_PER_YEAR = 400;

export interface Budget {
  /** 按地块、按州(含国、全世界)折成每年几栏 */
  tile: number;
  region: number;
  /** 超额的提醒(空 = 没超) */
  warnings: string[];
}

/** 一组卡用掉多少速度额度 */
export function budgetOf(cards: readonly TableCard[]): Budget {
  let tile = 0;
  let region = 0;
  for (const c of cards) {
    if (c.input || c.kind === 'id') continue;
    const w = colCount(c) / (c.every ?? 1);
    if (c.unit === 'tile') tile += w;
    else region += w;
  }
  const warnings: string[] = [];
  if (tile > TILE_COLS_PER_YEAR) warnings.push(`按地块的表折成每年 ${round1(tile)} 栏,超过 ${TILE_COLS_PER_YEAR} 栏:推演会明显变慢,把一些表改成每 5 年、10 年算一次,或改成按州`);
  if (region > REGION_COLS_PER_YEAR) warnings.push(`按州、按国的表折成每年 ${round1(region)} 栏,超过 ${REGION_COLS_PER_YEAR} 栏:推演会明显变慢`);
  return { tile, region, warnings };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
