/**
 * 开放给用的人调的「规则项」:推演的旋钮(engine/knobs.ts,八百多项)里挑出来的 70 项,按大家理解的事分 7 组。
 * 一个世界用的一套规则 = 这 70 项里改过的那些项的值(TuningValues:编号 → 值,没写的 = 官方);推演前换成一套旋钮的改动
 * (tuningPatch.ts 的 tuningPatch → KnobPatch)。
 * 这个文件只放读、清理一套规则要的(编号、组、档位、范围、清理时提示里用的名字);每项改哪几处旋钮在 tuningPatch.ts(只有推演用),
 * 只给界面、摘要看的字(每项的说明、摘要里的叫法、组名)在 tuningText.ts。存档、首页的「我的世界」读一套规则时只引用这个文件,
 * 不把旋钮表(整个推演)和那些字载进来。
 *
 * - **编号**(war.odds、war.truce……)是存档、链接、文件里存的,和代码里的旋钮名脱钩:旋钮改名、拆开、合并,编号不变;定了就不改
 * - **三种项**:
 *     倍数档(mult):×¼ ×½ ×¾ ×1 ×1.5 ×2 ×3 ×4,能关的多一档 0(不发生);改的旋钮 = 官方值 × 倍数(倒过来的:官方值 ÷ 倍数,关 = Infinity)
 *     数值(num):范围、步长、单位;有的最右多一档「永不」(存 'never'),有的最左多一档「关」(存 'off')
 *     区间(range):两个数(前一个不大于后一个),各自在范围里
 * - **一项可以连着改几处**:同一个意思在几张表里各存一份的(一国最多同时打几场仗:战争、邦交各一份)一起改,两边对得上;
 *   「关 = 不发生」要几处一起关的(立约:看邦交时立约、议和顺带立约)一起乘
 * - **存的值都能进 JSON**:倍数档存倍数(0 = 关),数值存数,区间存两个数,永不 / 关存字符串;推演用的 Infinity 只在换成旋钮时才出现
 * - **范围、档位在这一层定**:旋钮那一层只查形状(engine/knobs.ts 的 knobValueOk),除数、间隔取 0、次数不是整数这类,靠这里的范围和步长挡住。
 *   范围是照极端值压力测试(scripts/stress.ts 的「规则项」那一段:每项两头各推一遍,全部拉到最左、最右各一遍)定的
 *
 * 读进来的值(存档、链接、文件)先过 cleanTuning:认不出的编号丢掉、不在档位上的吸到最近一档、超出范围的拉回来、区间前大后小的对调,每处一句提示。
 * 纯计算,不碰 DOM。
 */


// ---------------------------------------------------------------------------
// 组、档位

/** 七组(组名、先后见 tuningText.ts 的 TUNING_GROUPS) */
export type TuningGroup = 'realm' | 'war' | 'split' | 'diplo' | 'folk' | 'disaster' | 'court';

/** 倍数档(和新建世界里「拓荒」的档一样);能关的项最左多一档 0 */
export const MULT_STEPS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
/** 倍数档写成字("×2";0 = 不发生) */
export const MULT_TEXT: Readonly<Record<number, string>> = { 0: '不发生', 0.25: '×¼', 0.5: '×½', 0.75: '×¾', 1: '×1', 1.5: '×1.5', 2: '×2', 3: '×3', 4: '×4' };

/** 一项的值:倍数档 = 倍数(0 = 关);数值 = 数;区间 = 两个数;'never' = 永不(数值项最右那一档);'off' = 关(数值项最左那一档) */
export type TuningValue = number | readonly [number, number] | 'never' | 'off';
/** 一套规则:编号 → 值;只写改过的项,没写的 = 官方 */
export type TuningValues = { readonly [id: string]: TuningValue };

// ---------------------------------------------------------------------------
// 换算版本

/**
 * 规则项换成旋钮的换算版本(第几版;换算表在 tuningPatch.ts):滑条上同一档换出来的旋钮变了(加强一项、一项多连改几处)就加一,
 * 以前各版的换算原样留着。官方值那一档在每一版里都什么也不改,官方规则的世界和换算版本无关。
 * 一个世界建成的那一刻用的是哪一版,记在它的那套规则上(ruleSet.ts 的 RuleSet.calc;没记 = 第 1 版),之后一直照那一版推:
 * 换算改了,已经建好的世界照样推出原来的历史;新建的世界、并排试推本机的和别人分享的规则,用最新的一版
 */
export const TUNING_CALC = 3;

/** 推演要的那部分:改过的规则项 + 按第几版换算 */
export interface WorldTuning {
  readonly values: TuningValues;
  readonly calc: number;
}

/** 换算版本:正整数;别的(没有、不是整数、小于 1)= undefined */
export function cleanCalc(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : undefined;
}

// ---------------------------------------------------------------------------
// 项

interface ItemBase {
  /** 编号(存档、链接里存的;定了不改) */
  readonly id: string;
  readonly group: TuningGroup;
  /** 常用(打开就看到;其余在「更多」里) */
  readonly common: boolean;
  /** 大白话名字(清理时的提示里用;一句说明在 tuningText.ts) */
  readonly name: string;
}

/** 倍数档 */
export interface MultItem extends ItemBase {
  readonly kind: 'mult';
  /** 能关(最左多一档 0 = 不发生) */
  readonly off: boolean;
}

/** 数值(存的就是旋钮的值;单位 '成' 和 '%' 存的是 0–1 的比例,显示时 × 10 / × 100) */
export interface NumItem extends ItemBase {
  readonly kind: 'num';
  readonly official: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
  /** 最右多一档「永不」;最左多一档「关」 */
  readonly never?: boolean;
  readonly offable?: boolean;
}

/** 两头的区间 */
export interface RangeItem extends ItemBase {
  readonly kind: 'range';
  readonly official: readonly [number, number];
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
}

export type TuningItem = MultItem | NumItem | RangeItem;

type Common = Pick<ItemBase, 'id' | 'name'>;
let group: TuningGroup = 'realm';
let common = true;
const mult = (b: Common, o: { off?: boolean } = {}): MultItem => ({ ...b, group, common, kind: 'mult', off: !!o.off });
const num = (b: Common, r: { official: number; min: number; max: number; step: number; unit: string }, o: Pick<NumItem, 'never' | 'offable'> = {}): NumItem => ({
  ...b,
  group,
  common,
  kind: 'num',
  ...r,
  ...o,
});
const range = (b: Common, r: { official: [number, number]; min: number; max: number; step: number; unit: string }): RangeItem => ({ ...b, group, common, kind: 'range', ...r });

const ITEMS: TuningItem[] = [];
const add = (...xs: TuningItem[]) => ITEMS.push(...xs);

// ---- 立国与疆域 ----
group = 'realm';
common = true;
add(
  mult({ id: 'realm.found', name: '立国早晚' }),
  mult({ id: 'realm.worth', name: '荒地留给部落' }),
  mult({ id: 'realm.sail', name: '航海时代早晚' }, { off: true }),
);
common = false;
add(
  num({ id: 'realm.republic', name: '海边城邦多是共和国' }, { official: 0.75, min: 0, max: 1, step: 0.05, unit: '成' }),
  mult({ id: 'realm.reach', name: '国都管得到多远' }),
);

// ---- 战争 ----
group = 'war';
common = true;
add(
  mult({ id: 'war.odds', name: '战争多少' }),
  num({ id: 'war.truce', name: '议和后几年不再开战' }, { official: 5, min: 0, max: 60, step: 1, unit: '年' }),
  range({ id: 'war.length', name: '一场仗最多打几年' }, { official: [5, 18], min: 1, max: 60, step: 1, unit: '年' }),
  num({ id: 'war.crush', name: '灭国之战' }, { official: 2.5, min: 1.5, max: 10, step: 0.5, unit: '倍' }, { never: true }),
  mult({ id: 'war.project', name: '远征吃力' }),
);
common = false;
add(
  num({ id: 'war.rest', name: '打完仗歇几年' }, { official: 4, min: 0, max: 40, step: 1, unit: '年' }),
  range({ id: 'war.goal', name: '一场仗想拿几州' }, { official: [3, 20], min: 1, max: 60, step: 1, unit: '州' }),
  num({ id: 'war.break', name: '势如破竹' }, { official: 6, min: 0, max: 15, step: 1, unit: '州' }),
  num({ id: 'war.fronts', name: '一国最多同时打几场仗' }, { official: 2, min: 1, max: 4, step: 1, unit: '场' }),
  num({ id: 'war.capital', name: '守国都容易' }, { official: 1.8, min: 1, max: 4, step: 0.1, unit: '倍' }),
  mult({ id: 'war.prey', name: '小国招打' }),
  mult({ id: 'war.revanche', name: '收复失地的心' }, { off: true }),
  num({ id: 'war.grudge', name: '记仇' }, { official: 80, min: 0, max: 300, step: 10, unit: '年' }),
  num({ id: 'war.winter', name: '冬天不出兵' }, { official: 3, min: -10, max: 15, step: 1, unit: '°C' }, { offable: true }),
  mult({ id: 'war.sack', name: '城被洗劫' }, { off: true }),
  mult({ id: 'war.ruin', name: '城被毁' }, { off: true }),
  mult({ id: 'war.rebuild', name: '毁了的城重建' }, { off: true }),
);

// ---- 分与合 ----
group = 'split';
common = true;
add(
  mult({ id: 'split.odds', name: '分裂多少' }, { off: true }),
  mult({ id: 'split.restore', name: '复国多少' }, { off: true }),
  mult({ id: 'split.collapse', name: '大崩解多少' }, { off: true }),
  num({ id: 'split.hegemon', name: '盛极而衰' }, { official: 2, min: 0, max: 6, step: 0.5, unit: '' }),
  mult({ id: 'split.revolt', name: '民变多少' }, { off: true }),
  mult({ id: 'split.dynasty', name: '改朝换代多少' }, { off: true }),
  num({ id: 'split.dynastyAge', name: '王朝寿命' }, { official: 310, min: 100, max: 1000, step: 10, unit: '年' }),
);
common = false;
add(
  mult({ id: 'split.claim', name: '宗室争位' }, { off: true }),
  mult({ id: 'split.merge', name: '小国并入大国' }, { off: true }),
  num({ id: 'split.share', name: '自立出去的最多占原国几成' }, { official: 0.35, min: 0.1, max: 0.6, step: 0.05, unit: '成' }),
  num({ id: 'split.newborn', name: '新立的国站稳几年' }, { official: 30, min: 0, max: 150, step: 5, unit: '年' }),
  mult({ id: 'split.capMove', name: '主动迁都' }, { off: true }),
  mult({ id: 'split.edge', name: '边地自己立国' }, { off: true }),
  num({ id: 'split.age', name: '王朝老了人心渐散' }, { official: 0.6, min: 0, max: 2, step: 0.1, unit: '' }),
);

// ---- 邦交 ----
group = 'diplo';
common = true;
add(
  mult({ id: 'diplo.pact', name: '结盟多少' }, { off: true }),
  mult({ id: 'diplo.submit', name: '称臣多少' }, { off: true }),
  mult({ id: 'diplo.treaty', name: '立约多少' }, { off: true }),
  mult({ id: 'diplo.marry', name: '和亲多少' }, { off: true }),
);
common = false;
add(
  num({ id: 'diplo.maxPacts', name: '一国最多几个盟' }, { official: 2, min: 1, max: 5, step: 1, unit: '个' }),
  mult({ id: 'diplo.betray', name: '背盟' }, { off: true }),
  num({ id: 'diplo.join', name: '盟国挨打来救' }, { official: 0.7, min: 0, max: 1, step: 0.05, unit: '成' }),
  mult({ id: 'diplo.defect', name: '藩属自立' }, { off: true }),
  mult({ id: 'diplo.absorb', name: '藩属纳土归附' }, { off: true }),
  mult({ id: 'diplo.breach', name: '背约' }, { off: true }),
  num({ id: 'diplo.zone', name: '立约时划中立地' }, { official: 0.5, min: 0, max: 1, step: 0.05, unit: '成' }),
);

// ---- 民族与迁徙 ----
group = 'folk';
common = true;
add(
  mult({ id: 'folk.assimilate', name: '同化快慢' }),
  num({ id: 'folk.treks', name: '大迁徙：一个世界最多几次' }, { official: 6, min: 0, max: 20, step: 1, unit: '次' }),
  mult({ id: 'folk.diverge', name: '民族分化' }, { off: true }),
);
common = false;
add(
  num({ id: 'folk.trekPace', name: '大迁徙大约多少年一次' }, { official: 600, min: 150, max: 3000, step: 50, unit: '年' }),
  num({ id: 'folk.trekSize', name: '大迁徙一支能占几州' }, { official: 8, min: 3, max: 20, step: 1, unit: '州' }),
  mult({ id: 'folk.flight', name: '避兵外迁' }, { off: true }),
  mult({ id: 'folk.trekAbsorb', name: '入主的一支被当地同化' }, { off: true }),
);

// ---- 天灾与人口(新建世界的「天灾 多 / 很多」再乘在上面) ----
group = 'disaster';
common = true;
add(
  mult({ id: 'disaster.plague', name: '瘟疫多少' }, { off: true }),
  range({ id: 'disaster.plagueLoss', name: '瘟疫死几成' }, { official: [0.08, 0.2], min: 0.01, max: 0.5, step: 0.01, unit: '%' }),
  mult({ id: 'disaster.famine', name: '饥荒多少' }, { off: true }),
);
common = false;
add(
  mult({ id: 'disaster.spread', name: '瘟疫传得快慢' }),
  num({ id: 'disaster.great', name: '大瘟疫的几率' }, { official: 0.3, min: 0, max: 1, step: 0.05, unit: '成' }),
  mult({ id: 'disaster.growth', name: '城长得快慢' }),
  mult({ id: 'disaster.wear', name: '种地耗地力' }, { off: true }),
);

// ---- 朝廷与人物 ----
group = 'court';
common = true;
add(
  num({ id: 'court.reign', name: '君主在位多久' }, { official: 50, min: 10, max: 100, step: 5, unit: '年' }),
  mult({ id: 'court.strongman', name: '权臣专权' }, { off: true }),
  mult({ id: 'court.reform', name: '改制多少' }),
);
common = false;
add(
  num({ id: 'court.maxAge', name: '君主最多活到几岁' }, { official: 88, min: 65, max: 120, step: 1, unit: '岁' }),
  mult({ id: 'court.murder', name: '君主遇弑' }, { off: true }),
  mult({ id: 'court.contest', name: '争储' }, { off: true }),
  mult({ id: 'court.coup', name: '政变' }, { off: true }),
  mult({ id: 'court.restore', name: '复辟' }, { off: true }),
  num({ id: 'court.uncle', name: '叔父摄政' }, { official: 0.4, min: 0, max: 1, step: 0.05, unit: '成' }),
);

/** 全部 70 项(照组、常用在前的先后) */
export const TUNING_ITEMS: readonly TuningItem[] = ITEMS;
const byId = new Map(ITEMS.map((x) => [x.id, x]));
/** 按编号找一项 */
export const tuningItem = (id: string): TuningItem | undefined => byId.get(id);

// ---------------------------------------------------------------------------
// 档位、两头

/** 一项的官方值:倍数档 = 1 */
export function officialValue(x: TuningItem): TuningValue {
  return x.kind === 'mult' ? 1 : x.official;
}

/** 一项可以取的倍数(能关的多一个 0) */
export function multSteps(x: MultItem): readonly number[] {
  return x.off ? [0, ...MULT_STEPS] : MULT_STEPS;
}

/** 一项的两头:最左(能关的是关 / 0,倍数档 ×¼,数值最小,区间两个数都取最小)、最右(倍数档 ×4,数值最大或永不,区间都取最大) */
export function tuningEnds(x: TuningItem): [TuningValue, TuningValue] {
  if (x.kind === 'mult') return [x.off ? 0 : MULT_STEPS[0], MULT_STEPS[MULT_STEPS.length - 1]];
  if (x.kind === 'range') return [[x.min, x.min], [x.max, x.max]];
  return [x.offable ? 'off' : x.min, x.never ? 'never' : x.max];
}

// ---------------------------------------------------------------------------
// 清理读进来的值

/** 步长的小数位数(吸到档上以后按它舍入,免得 0.1 × 3 这样的尾数) */
const decimals = (x: number) => {
  const s = String(x);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
};
/** v 吸到 [min, max] 里步长 step 的最近一档 */
function snap(v: number, min: number, max: number, step: number): number {
  const d = Math.max(decimals(step), decimals(min));
  const k = Math.round((Math.min(max, Math.max(min, v)) - min) / step);
  return Math.min(max, Number((min + k * step).toFixed(d)));
}
/** 去掉浮点尾数的写法(0.30000000000000004 → "0.3") */
export const fmt = (v: number) => String(Number(v.toFixed(6)));

const sameValue = (a: TuningValue, b: TuningValue) => (Array.isArray(a) && Array.isArray(b) ? a[0] === b[0] && a[1] === b[1] : a === b);

/**
 * 清理一套读进来的规则(存档、链接、文件):认不出的编号丢掉;倍数不在档位上的吸到最近一档(不能关的项给了 0 按 ×¼);
 * 数值超出范围的拉回来、不在步长上的吸到最近一档;区间前大后小的对调;永不 / 关只认有这一档的项;值认不出的按官方。
 * 和官方一样的项不写(不提示)。每处改动附一句中文提示(notes)。交出去的 values 照项的先后、冻住
 */
export function cleanTuning(raw: unknown): { values: TuningValues; notes: string[] } {
  const notes: string[] = [];
  const out: Record<string, TuningValue> = {};
  if (raw === undefined || raw === null) return { values: Object.freeze(out), notes };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    notes.push('规则的格式认不出，按官方规则算');
    return { values: Object.freeze(out), notes };
  }
  const src = raw as Record<string, unknown>;
  for (const id of Object.keys(src)) if (!byId.has(id)) notes.push(`「${id}」不是能调的项，略过`);
  for (const x of ITEMS) {
    if (!Object.prototype.hasOwnProperty.call(src, x.id)) continue;
    const v = cleanOne(x, src[x.id], notes);
    if (v !== undefined && !sameValue(v, officialValue(x))) out[x.id] = Array.isArray(v) ? Object.freeze([v[0], v[1]] as const) : v;
  }
  return { values: Object.freeze(out), notes };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && !Number.isNaN(v);

/** 清理一项(认不出 = undefined,记一句) */
function cleanOne(x: TuningItem, v: unknown, notes: string[]): TuningValue | undefined {
  const bad = () => {
    notes.push(`「${x.name}」的值认不出，按官方算`);
    return undefined;
  };
  if (x.kind === 'mult') {
    if (!isNum(v)) return bad();
    const steps = multSteps(x);
    let best = steps[0];
    for (const s of steps) if (Math.abs(s - v) < Math.abs(best - v) || (Math.abs(s - v) === Math.abs(best - v) && s > best)) best = s;
    if (best !== v) notes.push(v === 0 && !x.off ? `「${x.name}」不能关，按 ${MULT_TEXT[best]} 算` : `「${x.name}」×${fmt(v)} 不在档位上，按 ${MULT_TEXT[best]} 算`);
    return best;
  }
  if (x.kind === 'range') {
    if (!Array.isArray(v) || v.length !== 2 || !isNum(v[0]) || !isNum(v[1])) return bad();
    let [a, b] = [numIn(x, v[0], notes), numIn(x, v[1], notes)];
    if (a > b) {
      notes.push(`「${x.name}」前一个数比后一个大，已对调`);
      [a, b] = [b, a];
    }
    return [a, b];
  }
  if (v === 'never') return x.never ? 'never' : bad();
  if (v === 'off') return x.offable ? 'off' : bad();
  if (!isNum(v)) return bad();
  if (v === Infinity && x.never) return 'never';
  if (v === -Infinity && x.offable) return 'off';
  return numIn(x, v, notes);
}

/** 数值吸到范围里的一档(超出范围、不在档上各记一句) */
function numIn(x: NumItem | RangeItem, v: number, notes: string[]): number {
  if (v < x.min || v > x.max) {
    const c = snap(v, x.min, x.max, x.step);
    notes.push(`「${x.name}」${unitText(x, v)}超出范围（${spanText(x, x.min, x.max)}），按 ${unitText(x, c)}算`);
    return c;
  }
  const s = snap(v, x.min, x.max, x.step);
  if (s !== v) notes.push(`「${x.name}」${unitText(x, v)}不在档位上，按 ${unitText(x, s)}算`);
  return s;
}

// ---------------------------------------------------------------------------
// 写成字

/** 一个数带单位("5 年""7.5 成""8%""3°C") */
export function unitText(x: NumItem | RangeItem, v: number): string {
  if (x.unit === '成') return `${fmt(v * 10)} 成`;
  if (x.unit === '%') return `${fmt(v * 100)}%`;
  if (x.unit === '°C') return `${fmt(v)}°C`;
  return x.unit ? `${fmt(v)} ${x.unit}` : fmt(v);
}

/** 两个数的一段("5–18 年""1%–50%""−10–15°C") */
export function spanText(x: NumItem | RangeItem, a: number, b: number): string {
  if (a === b) return unitText(x, a);
  if (x.unit === '%') return `${unitText(x, a)}–${unitText(x, b)}`;
  return `${x.unit === '成' ? fmt(a * 10) : fmt(a)}–${unitText(x, b)}`;
}
