/**
 * 开放给用的人调的「规则项」:推演的旋钮(engine/knobs.ts,八百多项)里挑出来的 70 项,按大家理解的事分 7 组。
 * 一个世界用的一套规则 = 这 70 项里改过的那些项的值(TuningValues:编号 → 值,没写的 = 官方);推演前换成一套旋钮的改动(tuningPatch → KnobPatch)。
 *
 * - **编号**(war.odds、war.truce……)是存档、链接、文件里存的,和代码里的旋钮名脱钩:旋钮改名、拆开、合并,编号不变;定了就不改
 * - **三种项**:
 *     倍数档(mult):×¼ ×½ ×¾ ×1 ×1.5 ×2 ×3 ×4,能关的多一档 0(不发生);改的旋钮 = 官方值 × 倍数(inv:倒过来,官方值 ÷ 倍数,关 = Infinity)
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
import { CIV_KNOBS } from './knobs';
import type { KnobPatch, KnobValue } from './engine/knobs';

// ---------------------------------------------------------------------------
// 组、档位

export type TuningGroup = 'realm' | 'war' | 'split' | 'diplo' | 'folk' | 'disaster' | 'court';

/** 七组(照界面上的先后) */
export const TUNING_GROUPS: readonly { readonly id: TuningGroup; readonly name: string }[] = [
  { id: 'realm', name: '立国与疆域' },
  { id: 'war', name: '战争' },
  { id: 'split', name: '分与合' },
  { id: 'diplo', name: '邦交' },
  { id: 'folk', name: '民族与迁徙' },
  { id: 'disaster', name: '天灾与人口' },
  { id: 'court', name: '朝廷与人物' },
];

/** 倍数档(和新建世界里「拓荒」的档一样);能关的项最左多一档 0 */
export const MULT_STEPS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const MULT_TEXT: Readonly<Record<number, string>> = { 0: '不发生', 0.25: '×¼', 0.5: '×½', 0.75: '×¾', 1: '×1', 1.5: '×1.5', 2: '×2', 3: '×3', 4: '×4' };

/** 一项的值:倍数档 = 倍数(0 = 关);数值 = 数;区间 = 两个数;'never' = 永不(数值项最右那一档);'off' = 关(数值项最左那一档) */
export type TuningValue = number | readonly [number, number] | 'never' | 'off';
/** 一套规则:编号 → 值;只写改过的项,没写的 = 官方 */
export type TuningValues = { readonly [id: string]: TuningValue };

// ---------------------------------------------------------------------------
// 项

interface ItemBase {
  /** 编号(存档、链接里存的;定了不改) */
  readonly id: string;
  readonly group: TuningGroup;
  /** 常用(打开就看到;其余在「更多」里) */
  readonly common: boolean;
  /** 大白话名字、一句说明 */
  readonly name: string;
  readonly desc: string;
}

/** 倍数档 */
export interface MultItem extends ItemBase {
  readonly kind: 'mult';
  /** 能关(最左多一档 0 = 不发生) */
  readonly off: boolean;
  /** 改的旋钮("表.项");inv = 倒过来(数越大越少的:官方值 ÷ 倍数,关 = Infinity) */
  readonly knobs: readonly string[];
  readonly inv?: boolean;
  /** 摘要里的叫法("战争" → "战争 ×2");关掉时怎么写("不分裂") */
  readonly short: string;
  readonly offText?: string;
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
  /** 改的旋钮(几处都设成这个数) */
  readonly knobs: readonly string[];
  /** 永不、关时旋钮取的数 */
  readonly neverKnob?: number;
  readonly offKnob?: number;
  /** 摘要里怎么写 */
  readonly brief: (v: number | 'never' | 'off') => string;
}

/** 两头的区间 */
export interface RangeItem extends ItemBase {
  readonly kind: 'range';
  readonly official: readonly [number, number];
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
  readonly knobs: readonly string[];
  readonly brief: (a: string, b: string) => string;
}

export type TuningItem = MultItem | NumItem | RangeItem;

type Common = Pick<ItemBase, 'id' | 'name' | 'desc'>;
let group: TuningGroup = 'realm';
let common = true;
const mult = (b: Common, knobs: string | string[], short: string, o: { off?: string; inv?: boolean } = {}): MultItem => ({
  ...b,
  group,
  common,
  kind: 'mult',
  off: o.off !== undefined,
  knobs: typeof knobs === 'string' ? [knobs] : knobs,
  ...(o.inv ? { inv: true } : {}),
  short,
  ...(o.off !== undefined ? { offText: o.off } : {}),
});
const num = (
  b: Common,
  knobs: string | string[],
  r: { official: number; min: number; max: number; step: number; unit: string },
  brief: NumItem['brief'],
  o: Pick<NumItem, 'never' | 'offable' | 'neverKnob' | 'offKnob'> = {},
): NumItem => ({ ...b, group, common, kind: 'num', ...r, knobs: typeof knobs === 'string' ? [knobs] : knobs, brief, ...o });
const range = (b: Common, knob: string, r: { official: [number, number]; min: number; max: number; step: number; unit: string }, brief: RangeItem['brief']): RangeItem => ({
  ...b,
  group,
  common,
  kind: 'range',
  ...r,
  knobs: [knob],
  brief,
});
/** 几成(0–1 的比例)写成"7.5 成" */
const cheng = (v: number) => `${fmt(v * 10)} 成`;
const n = (v: number | 'never' | 'off') => (typeof v === 'number' ? fmt(v) : '');

const ITEMS: TuningItem[] = [];
const add = (...xs: TuningItem[]) => ITEMS.push(...xs);

// ---- 立国与疆域 ----
group = 'realm';
common = true;
add(
  mult(
    { id: 'realm.found', name: '立国早晚', desc: '城要长到多大、建起来多久才能立国。往右国家出现得更早。' },
    ['polities.FOUND_AT', 'polities.MIN_AGE'],
    '立国早',
    { inv: true },
  ),
  mult({ id: 'realm.worth', name: '荒地留给部落', desc: '国家扩张时挑地：往右越挑，荒漠、苔原、高山、离国都远的地方越多留给部落。' }, 'polities.WORTH', '荒地留给部落'),
  mult(
    { id: 'realm.sail', name: '航海时代早晚', desc: '国都一带的造船、航路发达到一定程度，普通国家才能远洋、往海外扩张。往右来得更早；最左 = 普通国家永不出海（海洋国家照旧）。' },
    'polities.SAIL_LEVEL',
    '航海时代早晚',
    { off: '普通国家不出海', inv: true },
  ),
);
common = false;
add(
  num({ id: 'realm.republic', name: '海边城邦多是共和国', desc: '海洋民族立的国里，走城邦共和一路的占几成（其余是王国）。' }, 'polities.REPUBLIC_P', { official: 0.75, min: 0, max: 1, step: 0.05, unit: '成' }, (v) => `海边城邦 ${cheng(v as number)}是共和国`),
  mult({ id: 'realm.reach', name: '国都管得到多远', desc: '离国都多远还管得住：往右边远的州也直辖，往左远处多是自治、代管。' }, 'control.REACH', '国都管得远近'),
);

// ---- 战争 ----
group = 'war';
common = true;
add(
  mult({ id: 'war.odds', name: '战争多少', desc: '各国主动开战的多少。往右仗打得更勤，国家兴亡更快。' }, 'wars.WAR_ODDS', '战争'),
  num({ id: 'war.truce', name: '议和后几年不再开战', desc: '同一对国家议和以后，隔多少年才会再打。' }, 'wars.TRUCE', { official: 5, min: 0, max: 60, step: 1, unit: '年' }, (v) => `议和后 ${n(v)} 年不再开战`),
  range({ id: 'war.length', name: '一场仗最多打几年', desc: '打到这么久还没打完就厌战议和（每场仗在这中间随机）。' }, 'wars.LENGTH', { official: [5, 18], min: 1, max: 60, step: 1, unit: '年' }, (a, b) => `一场仗最多打 ${a === b ? a : `${a}–${b}`} 年`),
  num(
    { id: 'war.crush', name: '灭国之战', desc: '国力是对方几倍以上，就不只是抢几州，要把它灭掉。最右 = 永不打灭国之战。' },
    'wars.CRUSH',
    { official: 2.5, min: 1.5, max: 10, step: 0.5, unit: '倍' },
    (v) => (v === 'never' ? '不打灭国之战' : `国力 ${n(v)} 倍就要灭国`),
    { never: true, neverKnob: Infinity },
  ),
  mult({ id: 'war.project', name: '远征吃力', desc: '离国都越远，能派出去的兵越少。往右远征更难，大国不容易跨海称霸。' }, 'wars.PROJECT', '远征吃力', { inv: true }),
);
common = false;
add(
  num({ id: 'war.rest', name: '打完仗歇几年', desc: '一国打完一场仗，至少歇这么多年才会主动再开战。' }, 'wars.REST', { official: 4, min: 0, max: 40, step: 1, unit: '年' }, (v) => `打完仗歇 ${n(v)} 年`),
  range({ id: 'war.goal', name: '一场仗想拿几州', desc: '开战时定的目标（每场仗在这中间随机），拿到就议和。' }, 'wars.GOAL', { official: [3, 20], min: 1, max: 60, step: 1, unit: '州' }, (a, b) => `一场仗想拿 ${a === b ? a : `${a}–${b}`} 州`),
  num({ id: 'war.break', name: '势如破竹', desc: '一仗打下一州以后，最多再接着连下几州。' }, 'wars.BREAK_MAX', { official: 6, min: 0, max: 15, step: 1, unit: '州' }, (v) => `一仗最多再连下 ${n(v)} 州`),
  num({ id: 'war.fronts', name: '一国最多同时打几场仗', desc: '手上的仗打满了，别国不来趁火打劫，盟国也不来援。' }, ['wars.MAX_WARS', 'diplomacy.MAX_WARS'], { official: 2, min: 1, max: 4, step: 1, unit: '场' }, (v) => `一国最多同时打 ${n(v)} 场仗`),
  num({ id: 'war.capital', name: '守国都容易', desc: '守国都的一方国力按这么多倍算。往右国都更难打下来。' }, 'wars.CAPITAL_DEF', { official: 1.8, min: 1, max: 4, step: 0.1, unit: '倍' }, (v) => `守国都 ${n(v)} 倍`),
  mult({ id: 'war.prey', name: '小国招打', desc: '只有几州的小国，邻国去打它的多少。' }, 'wars.PREY_ODDS', '小国招打'),
  mult({ id: 'war.revanche', name: '收复失地的心', desc: '邻国手里有本国原来的州时，更想打回来。最左 = 不念故土。' }, 'wars.REVANCHE', '收复失地的心', { off: '不念故土' }),
  num({ id: 'war.grudge', name: '记仇', desc: '议和时丢了州的一方，这么多年内更想打回来。' }, 'wars.GRUDGE_YEARS', { official: 80, min: 0, max: 300, step: 10, unit: '年' }, (v) => `记仇 ${n(v)} 年`),
  num(
    { id: 'war.winter', name: '冬天不出兵', desc: '要打的那州冷到这么多度以下就等开春再打。最左 = 冬天照样出兵。' },
    'wars.WINTER_T',
    { official: 3, min: -10, max: 15, step: 1, unit: '°C' },
    (v) => (v === 'off' ? '冬天照样出兵' : `冷到 ${n(v)}°C 不出兵`),
    { offable: true, offKnob: -Infinity },
  ),
  mult({ id: 'war.sack', name: '城被洗劫', desc: '攻下一州时城被洗劫、人口折损的机会。' }, 'cities.SACK_P', '城被洗劫', { off: '城不被洗劫' }),
  mult({ id: 'war.ruin', name: '城被毁', desc: '攻下一州时城被夷为平地的机会。' }, 'cities.RUIN_P', '城被毁', { off: '城不被毁' }),
  mult({ id: 'war.rebuild', name: '毁了的城重建', desc: '被毁的城在故址上重建起来的机会。' }, 'cities.REBUILD_P', '毁城重建', { off: '毁了的城不重建' }),
);

// ---- 分与合 ----
group = 'split';
common = true;
add(
  mult({ id: 'split.odds', name: '分裂多少', desc: '大国边远、异族、刚打下来的地方起兵自立的多少。' }, 'politics.SPLIT_ODDS', '分裂', { off: '不分裂' }),
  mult({ id: 'split.restore', name: '复国多少', desc: '亡了的国家在故土重新立起来的多少。最左 = 不复国（分裂出去的照样立新国）。' }, 'politics.RESTORE_ODDS', '复国', { off: '不复国' }),
  mult({ id: 'split.collapse', name: '大崩解多少', desc: '动荡到顶的大国一下子碎成好几块的多少。最左 = 没有大崩解（大迁徙打进国都也不崩）。' }, 'unrest.COLLAPSE_ODDS', '大崩解', { off: '没有大崩解' }),
  num({ id: 'split.hegemon', name: '盛极而衰', desc: '霸主占一块大陆越多，崩起来越狠。0 = 不管多大都一样。' }, 'unrest.HEG_W', { official: 2, min: 0, max: 6, step: 0.5, unit: '' }, (v) => `盛极而衰 ${n(v)}`),
  mult({ id: 'split.revolt', name: '民变多少', desc: '饥荒、瘟疫、苛政之下百姓起事的多少。' }, 'unrest.REVOLT_ODDS', '民变', { off: '没有民变' }),
  mult({ id: 'split.dynasty', name: '改朝换代多少', desc: '大国换一个王朝的多少（国势衰乱易代、权臣篡位都算）。最左 = 万世一系。' }, ['dynasty.ODDS', 'regents.USURP'], '改朝换代', { off: '万世一系' }),
  num({ id: 'split.dynastyAge', name: '王朝寿命', desc: '一个王朝大约过了这么多年以后容易易代。' }, 'dynasty.AGE_REF', { official: 310, min: 100, max: 1000, step: 10, unit: '年' }, (v) => `王朝寿命 ${n(v)} 年`),
);
common = false;
add(
  mult({ id: 'split.claim', name: '宗室争位', desc: '宗室子弟据地起兵、争夺王位的多少。' }, 'unrest.CLAIM_ODDS', '宗室争位', { off: '宗室不争位' }),
  mult({ id: 'split.merge', name: '小国并入大国', desc: '同族的小国被大国和平并入的多少。' }, 'politics.MERGE_ODDS', '小国并入大国', { off: '小国不并入大国' }),
  num({ id: 'split.share', name: '自立出去的最多占原国几成', desc: '一次分裂，自立出去的那块最多占原来国土的几成。' }, 'politics.SPLIT_FRAC', { official: 0.35, min: 0.1, max: 0.6, step: 0.05, unit: '成' }, (v) => `自立最多占原国 ${cheng(v as number)}`),
  num({ id: 'split.newborn', name: '新立的国站稳几年', desc: '分裂、复国出来的国家，这么多年内别国不打它。' }, 'wars.NEWBORN', { official: 30, min: 0, max: 150, step: 5, unit: '年' }, (v) => `新立的国站稳 ${n(v)} 年`),
  mult({ id: 'split.capMove', name: '主动迁都', desc: '国家主动把国都迁到更好的城的多少。' }, 'politics.CAPMOVE_P', '主动迁都', { off: '不主动迁都' }),
  mult({ id: 'split.edge', name: '边地自己立国', desc: '国家边上的部落受了影响、自己立国的多少。' }, 'politics.EDGE_P', '边地立国', { off: '边地不自己立国' }),
  num({ id: 'split.age', name: '王朝老了人心渐散', desc: '一朝立得越久，动荡加得越多（加满时的量）。0 = 不随年数涨。' }, 'unrest.AGE_W', { official: 0.6, min: 0, max: 2, step: 0.1, unit: '' }, (v) => `王朝老了人心渐散 ${n(v)}`),
);

// ---- 邦交 ----
group = 'diplo';
common = true;
add(
  mult({ id: 'diplo.pact', name: '结盟多少', desc: '受同一个强邻威胁的两国结盟的多少。' }, 'diplomacy.PACT_ODDS', '结盟', { off: '不结盟' }),
  mult({ id: 'diplo.submit', name: '称臣多少', desc: '小国向强邻称臣、当藩属的多少（平时遣使称臣、打不过时奉表称臣都算）。' }, ['diplomacy.SUBMIT_ODDS', 'diplomacy.SUE_OFFER'], '称臣', { off: '不称臣' }),
  mult({ id: 'diplo.treaty', name: '立约多少', desc: '两国、几国立约互不侵犯的多少（看邦交时立约、议和时顺带立约都算）。' }, ['treaties.TREATY_ODDS', 'treaties.PEACE_TREATY'], '立约', { off: '不立约' }),
  mult(
    { id: 'diplo.marry', name: '和亲多少', desc: '看邦交时结亲、议和时以和亲作结的多少。' },
    ['marriages.MARRY_PER', 'marriages.MARRY_MAX', 'marriages.MARRY_ALLY', 'marriages.PEACE_MATCH'],
    '和亲',
    { off: '不和亲' },
  ),
);
common = false;
add(
  num({ id: 'diplo.maxPacts', name: '一国最多几个盟', desc: '一国同时最多和几国结着盟。' }, 'diplomacy.MAX_PACTS', { official: 2, min: 1, max: 5, step: 1, unit: '个' }, (v) => `一国最多 ${n(v)} 个盟`),
  mult({ id: 'diplo.betray', name: '背盟', desc: '对盟国开战的多少。' }, 'diplomacy.BETRAY_ODDS', '背盟', { off: '不背盟' }),
  num({ id: 'diplo.join', name: '盟国挨打来救', desc: '盟国被第三国打时，出兵来救的机会。' }, 'diplomacy.PACT_JOIN', { official: 0.7, min: 0, max: 1, step: 0.05, unit: '成' }, (v) => `盟国 ${cheng(v as number)}来救`),
  mult({ id: 'diplo.defect', name: '藩属自立', desc: '宗主衰弱时藩属不再称臣、自立的多少。' }, 'diplomacy.DEFECT_ODDS', '藩属自立', { off: '藩属不自立' }),
  mult({ id: 'diplo.absorb', name: '藩属纳土归附', desc: '称臣久了的小藩属把国土献给宗主的多少。' }, 'diplomacy.ABSORB_ODDS', '藩属归附', { off: '藩属不归附' }),
  mult({ id: 'diplo.breach', name: '背约', desc: '立了约的国家找由头毁约来攻的多少。' }, 'treaties.BREACH_ODDS', '背约', { off: '不背约' }),
  num({ id: 'diplo.zone', name: '立约时划中立地', desc: '三国以上立约时，同时划一块谁都不进的中立地的机会。' }, 'treaties.MULTI_ZONE', { official: 0.5, min: 0, max: 1, step: 0.05, unit: '成' }, (v) => `立约 ${cheng(v as number)}划中立地`),
);

// ---- 民族与迁徙 ----
group = 'folk';
common = true;
add(
  mult({ id: 'folk.assimilate', name: '同化快慢', desc: '国内的异族渐渐变成统治民族的快慢。' }, 'assimilation.RATE', '同化'),
  num({ id: 'folk.treks', name: '大迁徙：一个世界最多几次', desc: '整族远徙、打进别国的大迁徙，一个世界最多几次。0 = 没有大迁徙。' }, 'migration.MAX', { official: 6, min: 0, max: 20, step: 1, unit: '次' }, (v) =>
    v === 0 ? '没有大迁徙' : `大迁徙最多 ${n(v)} 次`,
  ),
  mult({ id: 'folk.diverge', name: '民族分化', desc: '一族在异乡住久了，分出新的一族的多少。' }, 'assimilation.DIV_P', '民族分化', { off: '民族不分化' }),
);
common = false;
add(
  num({ id: 'folk.trekPace', name: '大迁徙大约多少年一次', desc: '天下久没有大迁徙，各族就越想走；大约每这么多年该有一次。' }, 'migration.PACE_YEARS', { official: 600, min: 150, max: 3000, step: 50, unit: '年' }, (v) => `大迁徙约 ${n(v)} 年一次`),
  num({ id: 'folk.trekSize', name: '大迁徙一支能占几州', desc: '迁徙的一支最多占下几州落脚。' }, 'migration.SIZE_MAX', { official: 8, min: 3, max: 20, step: 1, unit: '州' }, (v) => `大迁徙一支最多 ${n(v)} 州`),
  mult({ id: 'folk.flight', name: '避兵外迁', desc: '家园被打下来以后，百姓往外逃迁的多少。' }, 'assimilation.FLIGHT_ODDS', '避兵外迁', { off: '不避兵外迁' }),
  mult({ id: 'folk.trekAbsorb', name: '入主的一支被当地同化', desc: '大迁徙打进来、立了国的一支，反被当地人同化的快慢。' }, 'assimilation.TREK_K', '入主的一支被同化', { off: '入主的一支不被同化' }),
);

// ---- 天灾与人口(新建世界的「天灾 多 / 很多」再乘在上面) ----
group = 'disaster';
common = true;
add(
  mult({ id: 'disaster.plague', name: '瘟疫多少', desc: '大城起疫的多少。最左 = 不会自己起疫。' }, 'plague.ORIGIN_NORM', '瘟疫', { off: '没有瘟疫', inv: true }),
  range(
    { id: 'disaster.plagueLoss', name: '瘟疫死几成', desc: '一场瘟疫，染上的城死多少（每城在这中间随机，大城、港口多些）。' },
    'plague.LOSS',
    { official: [0.08, 0.2], min: 0.01, max: 0.5, step: 0.01, unit: '%' },
    (a, b) => `瘟疫死 ${a === b ? a : `${a}–${b}`}`,
  ),
  mult({ id: 'disaster.famine', name: '饥荒多少', desc: '灾年里闹饥荒的多少；人口越顶到上限越容易闹。最左 = 没有饥荒。' }, ['unrest.P_BASE', 'unrest.P_FULL'], '饥荒', { off: '没有饥荒' }),
);
common = false;
add(
  mult({ id: 'disaster.spread', name: '瘟疫传得快慢', desc: '一州染疫以后传给邻州的快慢。' }, 'plague.SPREAD', '瘟疫传播'),
  num({ id: 'disaster.great', name: '大瘟疫的几率', desc: '能远洋的港口起疫时，循着航线传遍几块大陆的大瘟疫占几成。' }, 'plague.GREAT_ODDS', { official: 0.3, min: 0, max: 1, step: 0.05, unit: '成' }, (v) => `大瘟疫 ${cheng(v as number)}`),
  mult({ id: 'disaster.growth', name: '城长得快慢', desc: '城的人口往上长的快慢。' }, 'polities.GROWTH', '城的成长'),
  mult({ id: 'disaster.wear', name: '种地耗地力', desc: '人多地少、种得久了地力变薄的快慢。最左 = 地力不减。' }, 'population.WEAR', '耗地力', { off: '种地不耗地力' }),
);

// ---- 朝廷与人物 ----
group = 'court';
common = true;
add(
  num({ id: 'court.reign', name: '君主在位多久', desc: '一位君主在位最长大约多少年（多数短得多）。' }, ['rulers.REIGN_MAX', 'regents.SEIZE_REIGN'], { official: 50, min: 10, max: 100, step: 5, unit: '年' }, (v) => `在位最长约 ${n(v)} 年`),
  mult({ id: 'court.strongman', name: '权臣专权', desc: '战败失地、开疆拓土以后，大臣、大将专权的多少。' }, 'regents.STRONG_P', '权臣专权', { off: '没有权臣专权' }),
  mult({ id: 'court.reform', name: '改制多少', desc: '议立宪、废君这类改制的多少。' }, 'reform.PUSH_MIN', '改制', { inv: true }),
);
common = false;
add(
  num(
    { id: 'court.maxAge', name: '君主最多活到几岁', desc: '君主（连同世系里补出来的宗室）最多活到这么多岁；将领、名臣、王子的寿数另算。' },
    'rulers.MAX_AGE',
    { official: 88, min: 65, max: 120, step: 1, unit: '岁' },
    (v) => `君主最多活到 ${n(v)} 岁`,
  ),
  mult({ id: 'court.murder', name: '君主遇弑', desc: '君主被弑的多少。' }, 'royals.MURDER', '君主遇弑', { off: '君主不遇弑' }),
  mult({ id: 'court.contest', name: '争储', desc: '新君即位时，兄长、战功更多的兄弟起来争位（拥兵、政变、被谮杀）的多少。' }, ['royals.CONTEST_ELDER', 'royals.CONTEST_MERIT'], '争储', { off: '不争储' }),
  mult({ id: 'court.coup', name: '政变', desc: '军中起事、夺取朝政的多少。' }, 'reform.COUP_ODDS', '政变', { off: '没有政变' }),
  mult({ id: 'court.restore', name: '复辟', desc: '废了君主以后，旧王室复辟的多少。' }, 'reform.RESTORE_ODDS', '复辟', { off: '不复辟' }),
  num({ id: 'court.uncle', name: '叔父摄政', desc: '幼主即位、先君有成年的兄弟时，叔父摄政的机会（其余名臣辅政）。' }, 'regents.UNCLE_P', { official: 0.4, min: 0, max: 1, step: 0.05, unit: '成' }, (v) => `叔父摄政 ${cheng(v as number)}`),
);

/** 全部 70 项(照组、常用在前的先后) */
export const TUNING_ITEMS: readonly TuningItem[] = ITEMS;
const byId = new Map(ITEMS.map((x) => [x.id, x]));
/** 按编号找一项 */
export const tuningItem = (id: string): TuningItem | undefined => byId.get(id);

// ---------------------------------------------------------------------------
// 旋钮

const tables = new Map(CIV_KNOBS.map((t) => [t.id, t]));
/** "表.项" 官方的值(登记表里没有就报错:编号对不上旋钮是写错了) */
function officialKnob(k: string): KnobValue {
  const [t, name] = k.split('.');
  const v = tables.get(t)?.values[name];
  if (v === undefined) throw new Error(`规则项改的旋钮 ${k} 不在旋钮表里`);
  return v;
}

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

/** 一项的值换成它改的那几处旋钮的值(值是清理过的) */
function knobValues(x: TuningItem, v: TuningValue): [string, KnobValue][] {
  if (x.kind === 'mult') {
    const m = v as number;
    return x.knobs.map((k) => {
      const o = officialKnob(k) as number;
      return [k, x.inv ? (m === 0 ? Infinity : o / m) : o * m];
    });
  }
  if (x.kind === 'range') {
    const [a, b] = v as readonly [number, number];
    return x.knobs.map((k) => [k, [a, b]]);
  }
  const kv = v === 'never' ? x.neverKnob! : v === 'off' ? x.offKnob! : (v as number);
  return x.knobs.map((k) => [k, kv]);
}

/**
 * 一套规则 → 推演用的一套旋钮改动(CivParams.knobs)。先过 cleanTuning(读进来的乱值不会变成乱旋钮);
 * 什么都没改 = undefined(官方)
 */
export function tuningPatch(values: unknown): KnobPatch | undefined {
  const clean = cleanTuning(values).values;
  const out: Record<string, Record<string, KnobValue>> = {};
  let any = false;
  for (const x of ITEMS) {
    if (!(x.id in clean)) continue;
    for (const [k, kv] of knobValues(x, clean[x.id])) {
      const [t, name] = k.split('.');
      (out[t] ??= {})[name] = kv;
      any = true;
    }
  }
  return any ? out : undefined;
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
const fmt = (v: number) => String(Number(v.toFixed(6)));

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
function unitText(x: NumItem | RangeItem, v: number): string {
  if (x.unit === '成') return `${fmt(v * 10)} 成`;
  if (x.unit === '%') return `${fmt(v * 100)}%`;
  if (x.unit === '°C') return `${fmt(v)}°C`;
  return x.unit ? `${fmt(v)} ${x.unit}` : fmt(v);
}

/** 两个数的一段("5–18 年""1%–50%""−10–15°C") */
function spanText(x: NumItem | RangeItem, a: number, b: number): string {
  if (a === b) return unitText(x, a);
  if (x.unit === '%') return `${unitText(x, a)}–${unitText(x, b)}`;
  return `${x.unit === '成' ? fmt(a * 10) : fmt(a)}–${unitText(x, b)}`;
}

/** 一项的值写成字(滑条旁边那个:"×2""不发生""5 年""永不""关""5–18 年") */
export function tuningValueText(x: TuningItem, v: TuningValue): string {
  if (x.kind === 'mult') return MULT_TEXT[v as number] ?? `×${fmt(v as number)}`;
  if (v === 'never') return '永不';
  if (v === 'off') return '关';
  if (x.kind === 'range') return spanText(x, (v as readonly number[])[0], (v as readonly number[])[1]);
  return unitText(x, v as number);
}

/** 摘要里一项怎么写("战争 ×2""不分裂""议和后 2 年不再开战") */
function briefOf(x: TuningItem, v: TuningValue): string {
  if (x.kind === 'mult') return v === 0 && x.offText ? x.offText : `${x.short} ${MULT_TEXT[v as number] ?? `×${fmt(v as number)}`}`;
  if (x.kind === 'range') {
    const [a, b] = v as readonly [number, number];
    const t = (y: number) => (x.unit === '%' ? `${fmt(y * 100)}%` : fmt(y));
    return x.brief(t(a), t(b));
  }
  return x.brief(v as number | 'never' | 'off');
}

/**
 * 一句摘要:"改了 6 项：战争 ×2、议和后 2 年不再开战、大崩解 ×2……"(常用的项排前面,最多列 max 项,后面省略);
 * 什么都没改 = "照官方"
 */
export function tuningSummary(values: unknown, max = 3): string {
  const v = cleanTuning(values).values;
  const list = [...ITEMS.filter((x) => x.common), ...ITEMS.filter((x) => !x.common)].filter((x) => x.id in v);
  if (!list.length) return '照官方';
  const shown = list.slice(0, max).map((x) => briefOf(x, v[x.id]));
  return `改了 ${list.length} 项：${shown.join('、')}${list.length > max ? '……' : ''}`;
}

/** 每组改了几项 */
export function tuningCounts(values: unknown): Record<TuningGroup, number> {
  const v = cleanTuning(values).values;
  const out = Object.fromEntries(TUNING_GROUPS.map((g) => [g.id, 0])) as Record<TuningGroup, number>;
  for (const x of ITEMS) if (x.id in v) out[x.group]++;
  return out;
}
