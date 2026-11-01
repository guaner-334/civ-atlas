/**
 * 70 项规则项(tuning.ts)只给界面、摘要看的字:七组的组名、每项一句说明、摘要里的叫法(「战争 ×2」「不分裂」「议和后 2 年不再开战」),
 * 和拿它们写成的字(滑条旁边的值、一句摘要、每组改了几项)。
 * 和项表分开放:存档、首页的「我的世界」读一套规则、清理时只用 tuning.ts,不把这些字载进来。
 * 加一项规则项时两边都要加(单测查每项都有、没有多出来的)。
 * 纯计算,不碰 DOM。
 */
import { MULT_TEXT, TUNING_ITEMS, cleanTuning, fmt, spanText, unitText, type TuningGroup, type TuningItem, type TuningValue } from './tuning';

/**
 * 七组(照界面上的先后):组名;一句话说这组管什么(desc);note = 补一句不在这组的(调规则的页电脑上接在 desc 后面,手机上不写)
 */
export const TUNING_GROUPS: readonly { readonly id: TuningGroup; readonly name: string; readonly desc: string; readonly note?: string }[] = [
  { id: 'realm', name: '立国与疆域', desc: '部落什么时候立国、国家挑哪些地扩张、什么时候出海，国都管得到多远。', note: '新建世界里的「拓荒」管扩张快慢、地形难走，不在这里。' },
  { id: 'war', name: '战争', desc: '开战、打仗、议和，还有城池在战火里的兴废。', note: '新建世界里的「拓荒」管扩张快慢，不在这里。' },
  { id: 'split', name: '分与合', desc: '分裂、复国、大崩解、民变、改朝换代：大国怎么碎开，碎了又怎么立起来。' },
  { id: 'diplo', name: '邦交', desc: '结盟、称臣、立约、和亲，还有背盟、毁约、藩属自立。' },
  { id: 'folk', name: '民族与迁徙', desc: '异族同化、一族分出新的一族，还有整族远徙的大迁徙。' },
  { id: 'disaster', name: '天灾与人口', desc: '瘟疫、饥荒，城的人口长得快慢。', note: '新建世界里的「天灾 多 / 很多」再乘在这上面。' },
  { id: 'court', name: '朝廷与人物', desc: '君主在位多久、活到几岁，权臣、政变、争储、复辟这些朝堂上的事。' },
];

/**
 * 一项给人看的字:一句说明;摘要里怎么写 —— 倍数档:叫法(short,"战争" → "战争 ×2")、关掉时怎么写(offText,"不分裂");
 * 数值:brief(值 → 一句);区间:span(两头写好的数 → 一句)
 */
export interface TuningText {
  readonly desc: string;
  readonly short?: string;
  readonly offText?: string;
  readonly brief?: (v: number | 'never' | 'off') => string;
  readonly span?: (a: string, b: string) => string;
}

/** 几成(0–1 的比例)写成"7.5 成" */
const cheng = (v: number) => `${fmt(v * 10)} 成`;
const n = (v: number | 'never' | 'off') => (typeof v === 'number' ? fmt(v) : '');

/** 各项的字(编号 → 字;照项表的先后) */
const TEXT: Readonly<Record<string, TuningText>> = {
  'realm.found': { desc: '城要长到多大、建起来多久才能立国。往右国家出现得更早。', short: '立国早' },
  'realm.worth': { desc: '国家扩张时挑地：往右越挑，荒漠、苔原、高山、离国都远的地方越多留给部落。', short: '荒地留给部落' },
  'realm.sail': { desc: '国都一带的造船、航路发达到一定程度，普通国家才能远洋、往海外扩张。往右来得更早；最左 = 普通国家永不出海（海洋国家照旧）。', short: '航海时代早晚', offText: '普通国家不出海' },
  'realm.republic': { desc: '海洋民族立的国里，走城邦共和一路的占几成（其余是王国）。', brief: (v) => `海边城邦 ${cheng(v as number)}是共和国` },
  'realm.reach': { desc: '离国都多远还管得住：往右边远的州也直辖，往左远处多是自治、代管。', short: '国都管得远近' },
  'war.odds': { desc: '各国主动开战的多少。往右仗打得更勤，国家兴亡更快。', short: '战争' },
  'war.truce': { desc: '同一对国家议和以后，隔多少年才会再打。', brief: (v) => `议和后 ${n(v)} 年不再开战` },
  'war.length': { desc: '打到这么久还没打完就厌战议和（每场仗在这中间随机）。', span: (a, b) => `一场仗最多打 ${a === b ? a : `${a}–${b}`} 年` },
  'war.crush': { desc: '国力是对方几倍以上，就不只是抢几州，要把它灭掉。最右 = 永不打灭国之战。', brief: (v) => (v === 'never' ? '不打灭国之战' : `国力 ${n(v)} 倍就要灭国`) },
  'war.project': { desc: '离国都越远，能派出去的兵越少。往右远征更难，大国不容易跨海称霸。', short: '远征吃力' },
  'war.rest': { desc: '一国打完一场仗，至少歇这么多年才会主动再开战。', brief: (v) => `打完仗歇 ${n(v)} 年` },
  'war.goal': { desc: '开战时定的目标（每场仗在这中间随机），拿到就议和。', span: (a, b) => `一场仗想拿 ${a === b ? a : `${a}–${b}`} 州` },
  'war.break': { desc: '一仗打下一州以后，最多再接着连下几州。', brief: (v) => `一仗最多再连下 ${n(v)} 州` },
  'war.fronts': { desc: '手上的仗打满了，别国不来趁火打劫，盟国也不来援。', brief: (v) => `一国最多同时打 ${n(v)} 场仗` },
  'war.capital': { desc: '守国都的一方国力按这么多倍算。往右国都更难打下来。', brief: (v) => `守国都 ${n(v)} 倍` },
  'war.prey': { desc: '只有几州的小国，邻国去打它的多少。', short: '小国招打' },
  'war.revanche': { desc: '邻国手里有本国原来的州时，更想打回来。最左 = 不念故土。', short: '收复失地的心', offText: '不念故土' },
  'war.grudge': { desc: '议和时丢了州的一方，这么多年内更想打回来。', brief: (v) => `记仇 ${n(v)} 年` },
  'war.winter': { desc: '要打的那州冷到这么多度以下就等开春再打。最左 = 冬天照样出兵。', brief: (v) => (v === 'off' ? '冬天照样出兵' : `冷到 ${n(v)}°C 不出兵`) },
  'war.sack': { desc: '攻下一州时城被洗劫、人口折损的机会。', short: '城被洗劫', offText: '城不被洗劫' },
  'war.ruin': { desc: '攻下一州时城被夷为平地的机会。', short: '城被毁', offText: '城不被毁' },
  'war.rebuild': { desc: '被毁的城在故址上重建起来的机会。', short: '毁城重建', offText: '毁了的城不重建' },
  'split.odds': { desc: '大国边远、异族、刚打下来的地方起兵自立的多少。', short: '分裂', offText: '不分裂' },
  'split.restore': { desc: '亡了的国家在故土重新立起来的多少。最左 = 不复国（分裂出去的照样立新国）。', short: '复国', offText: '不复国' },
  'split.collapse': { desc: '动荡到顶的大国一下子碎成好几块的多少。最左 = 没有大崩解（大迁徙打进国都也不崩）。', short: '大崩解', offText: '没有大崩解' },
  'split.hegemon': { desc: '霸主占一块大陆越多，崩起来越狠。0 = 不管多大都一样。', brief: (v) => `盛极而衰 ${n(v)}` },
  'split.revolt': { desc: '饥荒、瘟疫、苛政之下百姓起事的多少。', short: '民变', offText: '没有民变' },
  'split.dynasty': { desc: '大国换一个王朝的多少（国势衰乱易代、权臣篡位都算）。最左 = 万世一系。', short: '改朝换代', offText: '万世一系' },
  'split.dynastyAge': { desc: '一个王朝大约过了这么多年以后容易易代。', brief: (v) => `王朝寿命 ${n(v)} 年` },
  'split.claim': { desc: '宗室子弟据地起兵、争夺王位的多少。', short: '宗室争位', offText: '宗室不争位' },
  'split.merge': { desc: '同族的小国被大国和平并入的多少。', short: '小国并入大国', offText: '小国不并入大国' },
  'split.share': { desc: '一次分裂，自立出去的那块最多占原来国土的几成。', brief: (v) => `自立最多占原国 ${cheng(v as number)}` },
  'split.newborn': { desc: '分裂、复国出来的国家，这么多年内别国不打它。', brief: (v) => `新立的国站稳 ${n(v)} 年` },
  'split.capMove': { desc: '国家主动把国都迁到更好的城的多少。', short: '主动迁都', offText: '不主动迁都' },
  'split.edge': { desc: '国家边上的部落受了影响、自己立国的多少。', short: '边地立国', offText: '边地不自己立国' },
  'split.age': { desc: '一朝立得越久，动荡加得越多（加满时的量）。0 = 不随年数涨。', brief: (v) => `王朝老了人心渐散 ${n(v)}` },
  'diplo.pact': { desc: '受同一个强邻威胁的两国结盟的多少。', short: '结盟', offText: '不结盟' },
  'diplo.submit': { desc: '小国向强邻称臣、当藩属的多少（平时遣使称臣、打不过时奉表称臣都算）。', short: '称臣', offText: '不称臣' },
  'diplo.treaty': { desc: '两国、几国立约互不侵犯的多少（看邦交时立约、议和时顺带立约都算）。', short: '立约', offText: '不立约' },
  'diplo.marry': { desc: '看邦交时结亲、议和时以和亲作结的多少。', short: '和亲', offText: '不和亲' },
  'diplo.maxPacts': { desc: '一国同时最多和几国结着盟。', brief: (v) => `一国最多 ${n(v)} 个盟` },
  'diplo.betray': { desc: '对盟国开战的多少。', short: '背盟', offText: '不背盟' },
  'diplo.join': { desc: '盟国被第三国打时，出兵来救的机会。', brief: (v) => `盟国 ${cheng(v as number)}来救` },
  'diplo.defect': { desc: '宗主衰弱时藩属不再称臣、自立的多少。', short: '藩属自立', offText: '藩属不自立' },
  'diplo.absorb': { desc: '称臣久了的小藩属把国土献给宗主的多少。', short: '藩属归附', offText: '藩属不归附' },
  'diplo.breach': { desc: '立了约的国家找由头毁约来攻的多少。', short: '背约', offText: '不背约' },
  'diplo.zone': { desc: '三国以上立约时，同时划一块谁都不进的中立地的机会。', brief: (v) => `立约 ${cheng(v as number)}划中立地` },
  'folk.assimilate': { desc: '国内的异族渐渐变成统治民族的快慢。', short: '同化' },
  'folk.treks': { desc: '整族远徙、打进别国的大迁徙，一个世界最多几次。0 = 没有大迁徙。', brief: (v) => v === 0 ? '没有大迁徙' : `大迁徙最多 ${n(v)} 次` },
  'folk.diverge': { desc: '一族在异乡住久了，分出新的一族的多少。', short: '民族分化', offText: '民族不分化' },
  'folk.trekPace': { desc: '天下久没有大迁徙，各族就越想走；大约每这么多年该有一次。', brief: (v) => `大迁徙约 ${n(v)} 年一次` },
  'folk.trekSize': { desc: '迁徙的一支最多占下几州落脚。', brief: (v) => `大迁徙一支最多 ${n(v)} 州` },
  'folk.flight': { desc: '家园被打下来以后，百姓往外逃迁的多少。', short: '避兵外迁', offText: '不避兵外迁' },
  'folk.trekAbsorb': { desc: '大迁徙打进来、立了国的一支，反被当地人同化的快慢。', short: '入主的一支被同化', offText: '入主的一支不被同化' },
  'disaster.plague': { desc: '大城起疫的多少。最左 = 不会自己起疫。', short: '瘟疫', offText: '没有瘟疫' },
  'disaster.plagueLoss': { desc: '一场瘟疫，染上的城死多少（每城在这中间随机，大城、港口多些）。', span: (a, b) => `瘟疫死 ${a === b ? a : `${a}–${b}`}` },
  'disaster.famine': { desc: '灾年里闹饥荒的多少；人口越顶到上限越容易闹。最左 = 没有饥荒。', short: '饥荒', offText: '没有饥荒' },
  'disaster.spread': { desc: '一州染疫以后传给邻州的快慢。', short: '瘟疫传播' },
  'disaster.great': { desc: '能远洋的港口起疫时，循着航线传遍几块大陆的大瘟疫占几成。', brief: (v) => `大瘟疫 ${cheng(v as number)}` },
  'disaster.growth': { desc: '城的人口往上长的快慢。', short: '城的成长' },
  'disaster.wear': { desc: '人多地少、种得久了地力变薄的快慢。最左 = 地力不减。', short: '耗地力', offText: '种地不耗地力' },
  'court.reign': { desc: '一位君主在位最长大约多少年（多数短得多）。', brief: (v) => `在位最长约 ${n(v)} 年` },
  'court.strongman': { desc: '战败失地、开疆拓土以后，大臣、大将专权的多少。', short: '权臣专权', offText: '没有权臣专权' },
  'court.reform': { desc: '议立宪、废君这类改制的多少。', short: '改制' },
  'court.maxAge': { desc: '君主（连同世系里补出来的宗室）最多活到这么多岁；将领、名臣、王子的寿数另算。', brief: (v) => `君主最多活到 ${n(v)} 岁` },
  'court.murder': { desc: '君主被弑的多少。', short: '君主遇弑', offText: '君主不遇弑' },
  'court.contest': { desc: '新君即位时，兄长、战功更多的兄弟起来争位（拥兵、政变、被谮杀）的多少。', short: '争储', offText: '不争储' },
  'court.coup': { desc: '军中起事、夺取朝政的多少。', short: '政变', offText: '没有政变' },
  'court.restore': { desc: '废了君主以后，旧王室复辟的多少。', short: '复辟', offText: '不复辟' },
  'court.uncle': { desc: '幼主即位、先君有成年的兄弟时，叔父摄政的机会（其余名臣辅政）。', brief: (v) => `叔父摄政 ${cheng(v as number)}` },
};

/** 一项的字(说明、摘要里的叫法) */
export function tuningText(x: Pick<TuningItem, 'id'>): TuningText {
  return TEXT[x.id];
}

/** 有字的项的编号(单测核对两边一样) */
export const TUNING_TEXT_IDS: readonly string[] = Object.keys(TEXT);

/** 一项的值写成字(滑条旁边那个:"×2""不发生""5 年""永不""关""5–18 年") */
export function tuningValueText(x: TuningItem, v: TuningValue): string {
  if (x.kind === 'mult') return MULT_TEXT[v as number] ?? `×${fmt(v as number)}`;
  if (v === 'never') return '永不';
  if (v === 'off') return '关';
  if (x.kind === 'range') return spanText(x, (v as readonly number[])[0], (v as readonly number[])[1]);
  return unitText(x, v as number);
}

/** 摘要里一项怎么写("战争 ×2""不分裂""议和后 2 年不再开战";并排试推推不下去时说是哪几项也这样写) */
export function tuningBrief(x: TuningItem, v: TuningValue): string {
  const t = tuningText(x);
  if (x.kind === 'mult') return v === 0 && t.offText ? t.offText : `${t.short} ${MULT_TEXT[v as number] ?? `×${fmt(v as number)}`}`;
  if (x.kind === 'range') {
    const [a, b] = v as readonly [number, number];
    const s = (y: number) => (x.unit === '%' ? `${fmt(y * 100)}%` : fmt(y));
    return t.span!(s(a), s(b));
  }
  return t.brief!(v as number | 'never' | 'off');
}

/**
 * 一句摘要:"改了 6 项：战争 ×2、议和后 2 年不再开战、大崩解 ×2……"(常用的项排前面,最多列 max 项,后面省略);
 * 什么都没改 = "照官方"
 */
export function tuningSummary(values: unknown, max = 3): string {
  const v = cleanTuning(values).values;
  const list = [...TUNING_ITEMS.filter((x) => x.common), ...TUNING_ITEMS.filter((x) => !x.common)].filter((x) => x.id in v);
  if (!list.length) return '照官方';
  const shown = list.slice(0, max).map((x) => tuningBrief(x, v[x.id]));
  return `改了 ${list.length} 项：${shown.join('、')}${list.length > max ? '……' : ''}`;
}

/** 每组改了几项 */
export function tuningCounts(values: unknown): Record<TuningGroup, number> {
  const v = cleanTuning(values).values;
  const out = Object.fromEntries(TUNING_GROUPS.map((g) => [g.id, 0])) as Record<TuningGroup, number>;
  for (const x of TUNING_ITEMS) if (x.id in v) out[x.group]++;
  return out;
}
