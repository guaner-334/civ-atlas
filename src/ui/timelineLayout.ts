/**
 * 时间轴、最近事件、地图上的事件标签的纯计算部分:事件类型和配色、排刻度(太密就合并)、
 * 播放经过的大事、标签的淡入淡出和摆放、事发地在哪。
 * 不碰 DOM,单测直接测(tests/timeline-layout.test.ts);组件在 CivTimeline.tsx、TimelineMarks.tsx、
 * RecentEvents.tsx、EventPins.tsx。
 *
 * - 事件类型:史事种类(types.ts 的 AnnalKind)归成五类 + 宗教 + 干预,颜色用 CSS 变量(timeline.css 的 [data-ev=…]):
 *   战争(打仗、战役、攻占、议和、洗劫、毁城、灭亡)/ 改朝(改朝换代、君主继位、迁都、旧都衰落)/
 *   立国(立国、分裂自立、复国、重建、藩属绝贡自立)/ 称帝(升格、称帝、降格、合并、称臣、结盟、盟约断了)/
 *   同化(同化、迁徙、民族消亡)/ 宗教(创教、立国教、传入、教派分立、圣城易主)/ 灾异(饥荒、瘟疫、民变、大崩解、民变被讨平)/ 干预(主色)。
 *   卡片上的类型名按一字标签细分("攻占""迁都"……)。
 * - 刻度:每条纪事一个小菱形(战争画在开战那年);挨得太近(DIAMOND_GAP 像素以内)合并成一个,
 *   颜色取其中分量最重的那一件,悬停列出每一件。干预单独一种"令"标记、地形大事一种"变"标记,不和菱形合并。
 *   合并进来的有新国家立起来(bringsState)、点本身又不是立国的颜色:上面叠一颗小绿点(hidesFounding),立国不会被盖住。
 * - 选中国家时两头的字("2391 立国""2837 亡")怎么摆:lifeLabels。
 * - 刻度尺(rulerOf):3000 年的世界每 100 年一小格、1000 年写字;推得更久的放大大格(2000 / 5000 / 10000 年),字不超过七个。
 *   设了纪年的刻度对准元年:字写在元年和它前后整千年(整大格)的地方("前2000""元年""1000"),两头写起止,离两头太近的不写。
 * - 播放:推得比 3000 年久的世界,播放速度、自动播放放的那一段、方向键一次走的年数跟着年数放大(放完整段的时间不变)。
 */
import type { ChronicleEntry } from '../gen/civ/chronicle';
import type { Civ } from '../gen/civ/types';
import type { World } from '../gen/world';
import { capitalAt } from '../gen/civ/growth';
import { standPass } from '../gen/civ/display';
import { nearX, wrapOf } from '../render/common';
import { END_YEAR_DEFAULT, YEAR_TICKS } from '../gen/edits';
import { yearShort, yearSpanAt, yearAt, yearMonthAt, type Era } from '../gen/era';

// ---------------------------------------------------------------------------
// 事件类型

/** 五类事件 + 宗教(faith)+ 时代(era)+ 灾异(calamity)+ 干预(order);CSS 里 [data-ev=war] 等配色 */
export type EvType = 'war' | 'dynasty' | 'found' | 'empire' | 'assim' | 'faith' | 'era' | 'calamity' | 'order';

const KIND_TYPE: Readonly<Record<string, EvType>> = {
  war: 'war',
  battle: 'war',
  stand: 'war',
  conquer: 'war',
  peace: 'war',
  sack: 'war',
  ruin: 'war',
  fall: 'war',
  dynasty: 'dynasty',
  reign: 'dynasty',
  capital: 'dynasty',
  decline: 'dynasty',
  found: 'found',
  split: 'found',
  rebuild: 'found',
  rank: 'empire',
  merge: 'empire',
  submit: 'empire',
  alliance: 'empire',
  unally: 'empire',
  treaty: 'empire',
  expire: 'empire',
  neutral: 'empire',
  breach: 'war',
  exile: 'dynasty',
  defect: 'found',
  assimilate: 'assim',
  migrate: 'assim',
  vanish: 'assim',
  diverge: 'assim',
  faith: 'faith',
  era: 'era',
  intervene: 'order',
  upheaval: 'order',
  famine: 'calamity',
  revolt: 'calamity',
  collapse: 'calamity',
  plague: 'calamity',
  warlord: 'calamity',
  defy: 'calamity',
  reclaim: 'dynasty',
  fiscal: 'calamity',
  council: 'dynasty',
  regent: 'dynasty',
  marry: 'empire',
  keep: 'dynasty',
  // 改制:立宪、改制(废君、还政)、复辟和改朝、继位一类(蓝);革命、政变动了兵,和战争一类(红)
  reform: 'dynasty',
  revolution: 'war',
  coup: 'war',
};

/** 这条纪事归哪一类(不认识的种类算"改朝":蓝色,和普通链接一样不抢眼) */
export function evType(e: Pick<ChronicleEntry, 'kind'> & Partial<Pick<ChronicleEntry, 'tag'>>): EvType {
  // 民变被讨平(灭亡那一条,标签"平")也归灾异
  if (e.tag === '平') return 'calamity';
  return KIND_TYPE[e.kind] ?? 'dynasty';
}

/** 一字标签 → 卡片上的类型名 */
const TAG_LABEL: Readonly<Record<string, string>> = {
  立: '立国',
  兴: '兴起',
  升: '升格',
  降: '衰微',
  战: '战争',
  役: '战役',
  占: '攻占',
  征: '征服',
  和: '议和',
  割: '割地',
  亡: '灭亡',
  迁: '迁都',
  分: '自立',
  复: '复国',
  合: '合并',
  朝: '改朝',
  保: '王朝',
  嗣: '继位',
  徙: '迁徙',
  化: '同化',
  湮: '消亡',
  衍: '分化',
  掠: '洗劫',
  毁: '毁城',
  建: '重建',
  衰: '衰落',
  干: '干预',
  创: '创教',
  皈: '国教',
  传: '传入',
  派: '教派',
  圣: '圣城',
  代: '时代',
  商: '商道',
  臣: '称臣',
  盟: '结盟',
  绝: '盟绝',
  背: '背盟',
  叛: '绝贡',
  饥: '饥荒',
  起: '民变',
  崩: '崩解',
  平: '平定',
  疫: '瘟疫',
  疠: '大疫',
  据: '割据',
  收: '收回',
  抗: '抗命',
  匮: '匮乏',
  议: '议事',
  约: '立约',
  续: '续约',
  满: '约满',
  违: '背约',
  中: '中立',
  逐: '放逐',
  奔: '出奔',
  权: '掌权',
  还: '还政',
  诛: '伏诛',
  篡: '篡位',
  亲: '亲政',
  姻: '结亲',
  宪: '立宪',
  制: '改制',
  革: '革命',
  政: '政变',
  辟: '复辟',
};

/** 卡片 / 最近事件 / 提示里的类型名:"战争""改朝""称帝"…… */
export function evLabel(e: Pick<ChronicleEntry, 'tag' | 'kind' | 'text'>): string {
  if (e.kind === 'rank' && e.text.includes('称帝')) return '称帝';
  if (e.kind === 'intervene') return '干预';
  if (e.kind === 'upheaval') return '地形大事';
  return TAG_LABEL[e.tag] ?? '纪事';
}

/** 正文(干预的"【干预】"前缀去掉:类型名已经写了;照大纲硬改的留着【照大纲】,和自己下的干预分得开) */
export function evText(e: Pick<ChronicleEntry, 'text'>): string {
  return e.text.replace(/^【干预】/, '');
}

/**
 * 年份:"2629 年";跨年的 "2940–2957 年";打到最后还没打完的 "2987 年起"(纪年:"公元前 850 年""公元前 820–前 811 年")。
 * months = 一年几个月(不给 / 0 = 只写年):不跨年的写到月 "2629 年 3 月";monthNames = 月份的名字,起了名字的写 "2629 年桃月"
 */
export function evYears(e: Pick<ChronicleEntry, 'year' | 'end' | 'ongoing'>, era?: Era | null, months = 0, monthNames?: readonly string[] | null): string {
  const a = Math.floor(e.year);
  if (e.ongoing) return `${yearAt(a, era)}起`;
  const b = Math.floor(e.end);
  return b > a ? yearSpanAt(a, b, era) : yearMonthAt(e.year, months, era, monthNames);
}

/** 种类的分量:同一处挤了几件事时画哪一件的颜色。不认识的种类算中等 */
const KIND_WEIGHT: Readonly<Record<string, number>> = {
  fall: 6,
  split: 5,
  war: 5,
  dynasty: 5,
  found: 4,
  merge: 4,
  rank: 3,
  capital: 2,
  conquer: 1,
  peace: 0,
  vanish: 5,
  migrate: 3,
  diverge: 3,
  assimilate: 1,
  ruin: 4,
  rebuild: 2,
  decline: 2,
  sack: 1,
  faith: 2,
  era: 2,
  intervene: 9,
  upheaval: 9,
  collapse: 6,
  revolt: 5,
  famine: 1,
  warlord: 4,
  reclaim: 3,
  defy: 1,
  fiscal: 1,
  council: 2,
  regent: 3,
  marry: 1,
  submit: 4,
  defect: 4,
  alliance: 2,
  unally: 1,
};

/** 一条纪事的分量(先看重要度,再看种类) */
export function entryWeight(e: ChronicleEntry): number {
  return e.importance * 10 + (KIND_WEIGHT[e.kind] ?? 3);
}

function heavier(a: ChronicleEntry, b: ChronicleEntry): ChronicleEntry {
  const d = entryWeight(b) - entryWeight(a);
  return d > 0 || (d === 0 && b.year < a.year) ? b : a;
}

// ---------------------------------------------------------------------------
// 播放

/** 1× / 4× 每秒走多少年(3000 年的世界;推得更久的乘 timeScale) */
export const PLAY_RATE: Readonly<Record<1 | 4, number>> = { 1: 20, 4: 80 };
/** "回放世界形成"接着放文明:从第 0 年放到结束年份用几秒 */
export const STORY_SECONDS = 15;
/** 自动播放、放完再点播放:从结束年份往前这么多年放起(3000 年的世界 = 第 2600 年;推得更久的乘 timeScale) */
export const REPLAY_SPAN = 400;

/** 推得比 3000 年久的世界,时间上放大几倍(60000 年 = 20 倍;3000 年及以下 = 1) */
export function timeScale(end: number): number {
  return Math.max(1, end / END_YEAR_DEFAULT);
}

/** 这个世界 1× / 4× 每秒走多少年:1× 放完整段总是两分半左右 */
export function playRate(speed: 1 | 4, end: number): number {
  return (PLAY_RATE[speed] ?? PLAY_RATE[1]) * timeScale(end);
}

/** 自动播放 / 重播从哪一年起 */
export function replayStart(end: number): number {
  return Math.max(0, Math.floor(end - REPLAY_SPAN * timeScale(end)));
}

/** 写字的大格可选几年一格(从小到大挑第一个让字不超过七个的) */
const RULER_STEPS = [1000, 2000, 5000, 10000, 20000];

/** 刻度字:11 像素的数字一个约多宽(像素);整格的字居中写、结尾的字靠右写,两个字中间至少空 RULER_GAP */
const RULER_DIGIT = 6.2;
const RULER_GAP = 8;

/**
 * 时间轴的刻度尺:major 年一个写字的大格,major / 2 一个中格,major / 10 一个小格,从 origin 那年数起(没设纪年 = 第 0 年);
 * labels = 写字的年份(0、每个大格,最后一定写结束年份;最后一个大格和结束年份的字挤在一起就不写它)。
 * 3000 年的世界 = 每 100 年一小格、500 年一中格、1000 年写字(和原来一样)。
 * 挤不挤:给了轨道宽 width(像素)按字真占的地方算 —— 再推以后的 3500 年照样写 3000(你接着推的那一年),
 * 3100 年才省掉 3000;没给宽度按年数算,离结尾不到半个大格的不写。
 * 设了纪年:格子对准元年,字写在元年、元年以前整大格("前2000")、以后整大格("1000",公元 1000 年)和两头;
 * 离两头不到半个大格的不写
 */
export function rulerOf(end: number, era?: Era | null, width?: number): { major: number; minor: number; mid: number; origin: number; labels: number[] } {
  const major = RULER_STEPS.find((m) => end / m <= 6) ?? RULER_STEPS[RULER_STEPS.length - 1];
  const labels: number[] = [];
  if (era) {
    const E = era.epoch;
    // 两头的字("前2500""501")比中间的长:离两头不到半个大格的不写,免得叠在一起
    const near = major / 2;
    const ok = (y: number) => y >= near && end - y >= near;
    const inner: number[] = [];
    // 元年以前:前 1000、前 2000……;元年;以后:公元 1000、2000 年……(没有 0 年,公元 1000 年 = 元年后 999 年)
    for (let y = E - major; y > 0; y -= major) if (y < end && ok(y)) inner.push(y);
    if (E > 0 && E < end && ok(E)) inner.push(E);
    for (let y = E - 1 + major; y < end; y += major) if (y > 0 && ok(y)) inner.push(y);
    labels.push(0, ...inner.sort((a, b) => a - b), end);
    return { major, minor: major / 10, mid: major / 2, origin: E, labels };
  }
  for (let y = 0; y <= end; y += major) labels.push(y);
  if (end % major !== 0) {
    const last = labels[labels.length - 1];
    const crowded =
      width && width > 0
        ? (last / end) * width + (String(last).length * RULER_DIGIT) / 2 + RULER_GAP > width - String(end).length * RULER_DIGIT
        : end - last <= major / 2;
    if (last > 0 && crowded) labels.pop();
    labels.push(end);
  }
  return { major, minor: major / 10, mid: major / 2, origin: 0, labels };
}

/** 刻度上的字:"1000";纪年 "前2000""元年""501"(不空格,刻度上字小) */
export function rulerLabel(y: number, era?: Era | null): string {
  return yearShort(y, era).replace(' ', '');
}

/** 年份在 (y0, y1] 里的条目(entries 按年份排好) */
export function crossed(entries: readonly ChronicleEntry[], y0: number, y1: number): ChronicleEntry[] {
  const out: ChronicleEntry[] = [];
  for (let i = countUpTo(entries, y0); i < entries.length && entries[i].year <= y1; i++) out.push(entries[i]);
  return out;
}

/** 年份 ≤ y 的条目有几条(entries 按年份排好;二分) */
export function countUpTo(entries: readonly ChronicleEntry[], y: number): number {
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (entries[m].year <= y) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/**
 * 侧栏「最近大事」列到哪(countUpTo 的 y):历史不是推到年初的(mid:故事模式 —— 历史推到停下那一刻的前一格,停在年初的推到上一年最后一格;
 * 普通世界推到一年中间)、看的是推到的那一刻(atEnd)时,历史推到的那一格(end 所在的那一格,那一格的事也推完了)以前的都列上;
 * 别的照旧列到看的那一年(year,取过整)
 */
export function recentUpTo(year: number, end: number, mid: boolean, atEnd: boolean): number {
  return mid && atEnd ? (Math.floor(end * YEAR_TICKS + 1e-6) + 1) / YEAR_TICKS : year;
}

/** 最近事件:到第 y 年为止(含)最近的 n 条,旧的在前 */
export function recentEntries(entries: readonly ChronicleEntry[], y: number, n = 4): ChronicleEntry[] {
  const k = countUpTo(entries, y);
  return entries.slice(Math.max(0, k - n), k);
}

// ---------------------------------------------------------------------------
// 刻度

/** 菱形挨得比这近(像素)就合并 */
export const DIAMOND_GAP = 8;
/** "令"标记挨得比这近(像素)就并成一个(字在竖线右边,约 14 像素宽) */
export const ORDER_GAP = 16;

export interface Diamond {
  /** 在刻度行里的位置(像素,0 = 第 0 年,width = 结束年份) */
  x: number;
  /** 画出来的颜色 / 点它跳到的那一件:分量最重的(一样重取先发生的) */
  lead: ChronicleEntry;
  /** 合并进来的每一件(按年份) */
  items: ChronicleEntry[];
}

export interface DiamondLayout {
  marks: Diamond[];
  /** 干预的"令"标记:挨得太近的并成一个,不和菱形合并 */
  orders: Diamond[];
  /** 地形大事的"变"标记(和"令"一个样子,各自合并) */
  shifts: Diamond[];
}

/** 排刻度:entries 按年份排好(buildChronicle / filterChronicle 的顺序);width = 刻度行的像素宽 */
export function layoutDiamonds(entries: readonly ChronicleEntry[], end: number, width: number): DiamondLayout {
  const marks: Diamond[] = [];
  const orders: Diamond[] = [];
  const shifts: Diamond[] = [];
  if (!(end > 0) || !(width > 0)) return { marks, orders, shifts };
  const at = (y: number) => (Math.min(end, Math.max(0, y)) / end) * width;
  let cur: { sum: number; items: ChronicleEntry[]; lead: ChronicleEntry } | null = null;
  const flush = () => {
    if (cur) marks.push({ x: cur.sum / cur.items.length, lead: cur.lead, items: cur.items });
    cur = null;
  };
  for (const e of entries) {
    const x = at(e.year);
    if (e.kind === 'intervene' || e.kind === 'upheaval') {
      const list = e.kind === 'intervene' ? orders : shifts;
      const last = list[list.length - 1];
      if (last && x - last.x < ORDER_GAP) last.items.push(e);
      else list.push({ x, lead: e, items: [e] });
      continue;
    }
    // 和正在攒的这一团的中心(平均位置)挨得太近就并进去:各团中心之间至少隔 DIAMOND_GAP
    if (cur && x - cur.sum / cur.items.length < DIAMOND_GAP) {
      cur.items.push(e);
      cur.sum += x;
      cur.lead = heavier(cur.lead, e);
    } else {
      flush();
      cur = { sum: x, items: [e], lead: e };
    }
  }
  flush();
  return { marks, orders, shifts };
}

/**
 * 这一条里有没有新国家立起来:立国、分裂自立、复国、饥民起事立的国、大崩解时分出来的几国(崩解那一条下面有自立的子条目)。
 * 藩属绝贡自立(defect)不算:那个国家早就有了
 */
export function bringsState(e: Pick<ChronicleEntry, 'kind' | 'children'>): boolean {
  if (e.kind === 'found' || e.kind === 'split' || e.kind === 'revolt') return true;
  return e.kind === 'collapse' && !!e.children?.some((c) => c.kind === 'split');
}

/** 这个点上面要不要叠一颗立国的绿点:合并进来的里有新国家立起来,点本身的颜色又不是立国的 */
export function hidesFounding(d: Diamond): boolean {
  return evType(d.lead) !== 'found' && d.items.some(bringsState);
}

/** 选中国家那一道两头的字:写在哪(像素,轨道左端 = 0)、怎么对齐(mid = 字的中间对准,start = 字从这里往右写,end = 字写到这里为止) */
export interface LifeLabel {
  x: number;
  align: 'mid' | 'start' | 'end';
}

/** 两个字之间至少空这么多(像素) */
const LIFE_LABEL_GAP = 6;
/** 两头的字:字号、左右留白加起来(像素,和 timeline.css 的 .tb-life-lab 一致) */
export const LIFE_FONT = 11.5;
export const LIFE_PAD = 8;

/** 一个字占的地方 [左, 右](像素;w = 字宽) */
export function labelSpan(l: LifeLabel, w: number): [number, number] {
  return l.align === 'mid' ? [l.x - w / 2, l.x + w / 2] : l.align === 'start' ? [l.x, l.x + w] : [l.x - w, l.x];
}

/**
 * 选中国家时,时间轴上立国那头("2391 立国")和亡的那头("2837 亡")的字怎么摆:
 * 平常字的中间对准那一年;出了轨道两头就往里挂;两个字挤在一起时立国的往左挂、亡的往右挂,还挤(或往外挂出了轨道)就只写立国。
 * a / b = 立国 / 亡那一年在轨道上的位置(还在 = null),wa / wb = 两个字的宽,width = 轨道宽
 */
export function lifeLabels(a: number, b: number | null, wa: number, wb: number, width: number): { found: LifeLabel; end: LifeLabel | null } {
  const fit = (x: number, w: number): LifeLabel['align'] => (x - w / 2 < 0 ? 'start' : x + w / 2 > width ? 'end' : 'mid');
  const found: LifeLabel = { x: a, align: fit(a, wa) };
  if (b === null) return { found, end: null };
  const end: LifeLabel = { x: b, align: fit(b, wb) };
  if (labelSpan(found, wa)[1] + LIFE_LABEL_GAP <= labelSpan(end, wb)[0]) return { found, end };
  // 立国的写到那一年为止、亡的从那一年写起:两个字一左一右,不会叠
  if (a - wa >= 0 && b + wb <= width) return { found: { x: a, align: 'end' }, end: { x: b, align: 'start' } };
  return { found, end: null };
}

/** 估一行字有多宽(像素):数字、字母按半个字多一点,空格三分之一,汉字一个字;pad = 左右留白加起来 */
export function textWidth(s: string, size: number, pad = 0): number {
  let w = 0;
  for (const c of s) w += c === ' ' ? size * 0.3 : /[\x00-\x7f]/.test(c) ? size * 0.6 : size;
  return w + pad;
}

/**
 * 指针在刻度行的 x 处:先认"令""变"标记(哪个近认哪个;一样近 = 同一年,"变"画在上面,认"变"),再认最近的菱形;
 * radius = 离多远以内算指到了(像素)
 */
export function hitDiamonds(layout: DiamondLayout, x: number, radius = 6): Diamond | null {
  const near = (list: Diamond[]) => {
    let best: Diamond | null = null;
    for (const d of list) if (Math.abs(d.x - x) <= radius && (!best || Math.abs(d.x - x) < Math.abs(best.x - x))) best = d;
    return best;
  };
  const o = near(layout.orders);
  const s = near(layout.shifts);
  return (o && s ? (Math.abs(o.x - x) < Math.abs(s.x - x) ? o : s) : (s ?? o)) ?? near(layout.marks);
}

// ---------------------------------------------------------------------------
// 地图上的事件标签

/** 一个标签停多久(毫秒,含淡入淡出) */
export const PIN_SHOW_MS = 3800;
/** 点最近事件 / 刻度跳过去时,那一件的标签停多久 */
export const PIN_JUMP_MS = 5000;
export const PIN_FADE_IN_MS = 200;
export const PIN_FADE_OUT_MS = 600;
/** 同时最多几个(再来新的,最早的那个提前淡出) */
export const PIN_MAX = 3;

export interface LivePin {
  e: ChronicleEntry;
  start: number;
  until: number;
}

/** 加几个标签(now = performance.now());超过 PIN_MAX 个没在淡出的,最早的提前淡出 */
export function addPins(live: readonly LivePin[], add: readonly ChronicleEntry[], now: number, show = PIN_SHOW_MS, max = PIN_MAX): LivePin[] {
  const out = live.filter((p) => p.until > now && !add.includes(p.e)).map((p) => ({ ...p }));
  for (const e of add) out.push({ e, start: now, until: now + show });
  const active = out.filter((p) => p.until - now > PIN_FADE_OUT_MS);
  for (let i = 0; i < active.length - max; i++) active[i].until = now + PIN_FADE_OUT_MS;
  return out;
}

/** 标签此刻的不透明度(淡入 PIN_FADE_IN_MS,最后 PIN_FADE_OUT_MS 淡出) */
export function pinOpacity(p: LivePin, now: number): number {
  return Math.max(0, Math.min(1, (p.until - now) / PIN_FADE_OUT_MS, (now - p.start) / PIN_FADE_IN_MS));
}

/**
 * 标签的卡片放在圆环的哪一边(相对圆环中心的左上角偏移;w、h = 卡片大小):
 * 右边(默认,卡片上沿略高于圆环)→ 左边 → 右下 → 左下 → 右上 → 左上
 */
export function cardOffset(side: number, w: number, h: number): [number, number] {
  const R = 16;
  switch (side) {
    case 1:
      return [-R - w, -24];
    case 2:
      return [R, 14];
    case 3:
      return [-R - w, 14];
    case 4:
      return [R, -14 - h];
    case 5:
      return [-R - w, -14 - h];
    default:
      return [R, -24];
  }
}
export const CARD_SIDES = 6;
/** 圆环(含光晕)的半径 */
const RING_R = 13;

export interface PinBox {
  /** 圆环中心(屏幕像素,标签层里的坐标) */
  x: number;
  y: number;
  /** 卡片大小 */
  w: number;
  h: number;
  /** 上一帧放在哪一边(没放过 = −1) */
  side: number;
}

type Rect = [number, number, number, number];
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * 摆卡片:按先后(先来的先挑),每张挑一边 —— 不出标签层(四边留 pad,底下再让出 bottom:时间轴那一行)、
 * 不压别的卡片和圆环;上一帧那一边还完全放得下就不换(拖动地图时不来回跳)。都放不下就挑压得最少的。
 * 返回每张的那一边(cardOffset 的 side)
 */
export function placeCards(pins: readonly PinBox[], bw: number, bh: number, pad = 8, bottom = 0): number[] {
  const placed: Rect[] = [];
  const rings: Rect[] = pins.map((p) => [p.x - RING_R, p.y - RING_R, RING_R * 2, RING_R * 2]);
  const out: number[] = [];
  pins.forEach((p, i) => {
    const cost = (side: number) => {
      const [dx, dy] = cardOffset(side, p.w, p.h);
      const r: Rect = [p.x + dx, p.y + dy, p.w, p.h];
      const inside = overlap(r, [pad, pad, bw - pad * 2, bh - pad * 2 - bottom]);
      let c = (p.w * p.h - inside) * 4;
      for (const q of placed) c += overlap(r, q);
      rings.forEach((q, j) => j !== i && (c += overlap(r, q)));
      return { c, r };
    };
    const sticky = p.side >= 0 && p.side < CARD_SIDES ? cost(p.side) : null;
    let side = p.side;
    let rect: Rect = sticky ? sticky.r : [p.x, p.y, p.w, p.h];
    if (!sticky || sticky.c > 0) {
      let bc = Infinity;
      for (let s = 0; s < CARD_SIDES && bc > 0; s++) {
        const k = cost(s);
        if (k.c < bc) [bc, side, rect] = [k.c, s, k.r];
      }
    }
    placed.push(rect);
    out.push(side);
  });
  return out;
}

// ---------------------------------------------------------------------------
// 事发地

/**
 * 事发地是哪一处:圆环画在哪块地(cell),那块地是哪座城 / 哪一州的治所 / 哪一国那一年的国都 / 哪一处关隘的口子
 * (kind + id;关隘的 id = civ.places 的下标;导播的镜头拿它当飞过去的目标)
 */
export interface EntrySpot {
  cell: number;
  kind: 'settlement' | 'region' | 'polity' | 'pass';
  id: number;
}

const spotCache = new WeakMap<Civ, Map<number, { spot: EntrySpot | null; at: [number, number] | null }>>();

function spotOf(world: World, civ: Civ, e: ChronicleEntry): { spot: EntrySpot | null; at: [number, number] | null } {
  let m = spotCache.get(civ);
  if (!m) spotCache.set(civ, (m = new Map()));
  const hit = m.get(e.id);
  if (hit) return hit;
  const spot = findSpot(world, civ, e);
  const v = { spot, at: spot ? ([world.mesh.x[spot.cell], world.mesh.y[spot.cell]] as [number, number]) : null };
  m.set(e.id, v);
  return v;
}

/**
 * 纪事的事发地(世界坐标;标签的圆环画在这里):
 * 据险断后守的口子画在地图上(Place.pass.stands 记着这一条)就是那处关的口子;
 * 有相关的城(立国 / 迁都的国都、改朝入主的城)就是那座城;否则是事发各州(攻占的州、同化的州……)
 * 里离它们中心最近的那一州的治所;都没有就是第一个相关国家那一年的国都。找不到 = null
 */
export function entryAnchor(world: World, civ: Civ, e: ChronicleEntry): [number, number] | null {
  return spotOf(world, civ, e).at;
}

/** 事发地是哪一处(和 entryAnchor 同一块地,多给出它是哪座城 / 哪一州 / 哪一国);找不到 = null */
export function entrySpot(world: World, civ: Civ, e: ChronicleEntry): EntrySpot | null {
  return spotOf(world, civ, e).spot;
}

function findSpot(world: World, civ: Civ, e: ChronicleEntry): EntrySpot | null {
  const { x, y } = world.mesh;
  const n = world.mesh.n;
  const ok = (c: number) => c >= 0 && c < n;
  if (e.kind === 'stand' && civ.places) {
    const p = standPass(civ.places, e.id);
    const c = p >= 0 ? (civ.places[p].cell ?? -1) : -1;
    if (ok(c)) return { cell: c, kind: 'pass', id: p };
  }
  const s = e.settlement;
  if (s >= 0 && s < civ.settlements.length) {
    const c = civ.settlements[s].cell;
    return ok(c) ? { cell: c, kind: 'settlement', id: s } : null;
  }
  const regs = e.regions.filter((r) => r >= 0 && r < civ.regions.count && ok(civ.regions.seat[r]));
  if (regs.length) {
    const seats = regs.map((r) => civ.regions.seat[r]);
    // 跨 180° 经线的一片按连着算:都挪到离第一个最近的那一份再求中心
    const W = wrapOf(world);
    const ref = x[seats[0]];
    let sx = 0;
    let sy = 0;
    for (const c of seats) {
      sx += nearX(x[c], ref, W);
      sy += y[c];
    }
    const cx = sx / seats.length;
    const cy = sy / seats.length;
    let best = 0;
    let bd = Infinity;
    seats.forEach((c, i) => {
      const d = (nearX(x[c], cx, W) - cx) ** 2 + (y[c] - cy) ** 2;
      if (d < bd) [best, bd] = [i, d];
    });
    return { cell: seats[best], kind: 'region', id: regs[best] };
  }
  for (const id of e.polities) {
    const p = civ.polities[id];
    if (!p) continue;
    const cap = capitalAt(p, e.year);
    if (cap >= 0 && cap < civ.settlements.length) {
      const c = civ.settlements[cap].cell;
      return ok(c) ? { cell: c, kind: 'polity', id } : null;
    }
  }
  return null;
}
