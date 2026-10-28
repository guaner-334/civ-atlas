/**
 * 一面旗由什么组成:颜色、样式、图案(西幻的纹样、东方的神兽和纹样)和它们的名字,FlagSpec;
 * 存档里一面旗的写法(encodeFlag / decodeFlag,WorldEdits.flags 的值)。
 * 怎么给国家配旗在 flags.ts;和它分开放,读存档(首页上也要读)只用得到这里的,不用跟着下载配旗的那些。纯计算,不碰 DOM。
 */

// ---------------------------------------------------------------------------
// 颜色

/** 旗的颜色:W 白、Y 金、R 红、M 绛、B 蓝、S 天蓝、G 绿、T 青、K 黑、P 紫、O 橙、N 褐 */
export type Tinct = 'W' | 'Y' | 'R' | 'M' | 'B' | 'S' | 'G' | 'T' | 'K' | 'P' | 'O' | 'N';

/** 色板:比地图的国家色深、饱和(旗要醒目);白、金是"金属色" */
export const TINCT: Record<Tinct, { hex: string; name: string; metal?: true }> = {
  W: { hex: '#F3F0E8', name: '白', metal: true },
  Y: { hex: '#E3A92E', name: '金', metal: true },
  R: { hex: '#B8322C', name: '红' },
  M: { hex: '#7E2131', name: '绛' },
  B: { hex: '#21508F', name: '蓝' },
  S: { hex: '#5C97CD', name: '天蓝' },
  G: { hex: '#2F6B3F', name: '绿' },
  T: { hex: '#1D6563', name: '青' },
  K: { hex: '#25272C', name: '黑' },
  P: { hex: '#5B3374', name: '紫' },
  O: { hex: '#D4692A', name: '橙' },
  N: { hex: '#7A5133', name: '褐' },
};

/** 色板的顺序(改旗时一排色点) */
export const TINCTS = Object.keys(TINCT) as Tinct[];

export const isMetal = (t: Tinct) => !!TINCT[t].metal;

// ---------------------------------------------------------------------------
// 旗的样子

/** 旗形:方旗、燕尾旗、牙旗(犬牙边) */
export type Shape = 'rect' | 'swallow' | 'banner';

/** 底子的分法 */
export type Layout =
  | 'plain'
  | 'bi-h'
  | 'bi-v'
  | 'tri-h'
  | 'tri-v'
  | 'fess'
  | 'pale'
  | 'nordic'
  | 'cross'
  | 'saltire'
  | 'per-bend'
  | 'chevron'
  | 'canton'
  | 'stripes'
  | 'bordure'
  | 'quarterly'
  | 'disc'
  | 'wavy'
  | 'hoist';

export const LAYOUT_NAME: Record<Layout, string> = {
  plain: '纯色',
  'bi-h': '上下两色',
  'bi-v': '左右两色',
  'tri-h': '三色横条',
  'tri-v': '三色竖条',
  fess: '中间一道横条',
  pale: '中间一道竖条',
  nordic: '偏十字',
  cross: '十字',
  saltire: '斜十字',
  'per-bend': '斜分两色',
  chevron: '旗杆边三角',
  canton: '左上角方块',
  stripes: '条纹',
  bordure: '镶边',
  quarterly: '四格',
  disc: '圆',
  wavy: '波纹',
  hoist: '旗杆边竖条',
};

/** 改旗时能挑的样式(按这个顺序排) */
export const EDIT_LAYOUTS: Layout[] = ['tri-h', 'tri-v', 'bi-h', 'bi-v', 'plain', 'fess', 'pale', 'nordic', 'cross', 'saltire', 'per-bend', 'chevron', 'canton', 'stripes', 'bordure', 'quarterly', 'disc', 'wavy'];

/** 每种样式用几块颜色(按顺序:上 / 中 / 下,或 底 / 图形 / 第三色) */
export const LAYOUT_COLORS: Record<Layout, number> = {
  plain: 1,
  'bi-h': 2,
  'bi-v': 2,
  'tri-h': 3,
  'tri-v': 3,
  fess: 2,
  pale: 2,
  nordic: 3,
  cross: 2,
  saltire: 2,
  'per-bend': 2,
  chevron: 3,
  canton: 2,
  stripes: 3,
  bordure: 2,
  quarterly: 2,
  disc: 2,
  wavy: 2,
  hoist: 2,
};

/** 西幻、汗国旗上的图案 */
export type Sym =
  | 'star'
  | 'star8'
  | 'sun'
  | 'crescent'
  | 'tower'
  | 'crown'
  | 'mountain'
  | 'ship'
  | 'anchor'
  | 'trident'
  | 'tree'
  | 'leaf'
  | 'rose'
  | 'key'
  | 'sword'
  | 'wheat'
  | 'fish'
  | 'bird'
  | 'bow'
  | 'tamga';

export const SYM_NAME: Record<Sym, string> = {
  star: '五角星',
  star8: '八角星',
  sun: '太阳',
  crescent: '新月',
  tower: '塔楼',
  crown: '王冠',
  mountain: '山',
  ship: '帆船',
  anchor: '锚',
  trident: '三叉戟',
  tree: '松树',
  leaf: '叶子',
  rose: '玫瑰',
  key: '钥匙',
  sword: '剑',
  wheat: '麦穗',
  fish: '鱼',
  bird: '飞鸟',
  bow: '弓',
  tamga: '烙印',
};

/** 改旗时能挑的图案(按这个顺序排) */
export const EDIT_SYMS: Sym[] = ['crown', 'tower', 'star', 'star8', 'sun', 'crescent', 'mountain', 'ship', 'anchor', 'trident', 'tree', 'leaf', 'rose', 'key', 'sword', 'wheat', 'fish', 'bird', 'bow', 'tamga'];

/** 东方旗上的纹样:都从古代旗帜、器物上用过的标志抽象出来 */
export type Emblem = 'ri' | 'riyue' | 'dou' | 'san' | 'lei' | 'huo' | 'taiji' | 'qian' | 'ling' | 'shui';
/** 东方旗上的神兽:四灵和《山海经》里的几种,一色剪影 */
export type Beast = 'long' | 'feng' | 'baihu' | 'hu' | 'gui' | 'yao' | 'bifang' | 'taotie';
/** 东方旗中间画的:神兽或纹样 */
export type Mark = Emblem | Beast;

export const BEASTS: Beast[] = ['long', 'feng', 'baihu', 'gui', 'hu', 'yao', 'bifang', 'taotie'];
export const EMBLEMS: Emblem[] = ['ri', 'riyue', 'dou', 'san', 'huo', 'lei', 'shui', 'ling', 'qian', 'taiji'];
/** 改旗时能挑的(神兽在前) */
export const MARKS: Mark[] = [...BEASTS, ...EMBLEMS];
export const isBeast = (m: Mark): m is Beast => (BEASTS as Mark[]).includes(m);

export const MARK_NAME: Record<Mark, string> = {
  long: '龙',
  feng: '凤',
  baihu: '白虎',
  hu: '九尾狐',
  gui: '旋龟',
  yao: '文鳐鱼',
  bifang: '毕方',
  taotie: '饕餮',
  ri: '日',
  riyue: '日月',
  dou: '北斗',
  san: '三星',
  lei: '雷纹',
  huo: '火',
  taiji: '太极',
  qian: '钱纹',
  ling: '菱纹',
  shui: '水纹',
};

/** 神兽、纹样从哪来(旗帜详情里那一行的后半句) */
export const MARK_NOTE: Record<Mark, string> = {
  long: '取自《周礼》九旗“交龙为旂”，清代黄龙旗上的龙戏珠',
  feng: '取自《山海经·南山经》丹穴山“五采而文”的凤皇',
  baihu: '取自古代行军“左青龙而右白虎”的白虎旗（《礼记·曲礼》）',
  gui: '取自《山海经·南山经》“其状如龟而鸟首虺尾”的旋龟',
  hu: '取自《山海经·南山经》青丘山的九尾狐',
  yao: '取自《山海经·西山经》“鱼身而鸟翼”、游于东海的文鳐鱼',
  bifang: '取自《山海经·西山经》“其状如鹤，一足”的火鸟毕方',
  taotie: '取自商周青铜器上的兽面纹（饕餮）',
  ri: '取自古代天子旗上的日月（《周礼》“日月为常”）',
  riyue: '取自《周礼》九旗里天子的旗“常”，上画日月',
  dou: '取自古代行军时中军的北斗旗（《礼记》“招摇在上”）',
  san: '取自参宿的三颗星，古代熊虎旗对应的星（《考工记》“熊旗六斿以象伐”）',
  huo: '取自五行里的火',
  lei: '取自商周青铜器上的雷纹',
  shui: '取自彩陶、铜镜上的水波纹',
  taiji: '取自宋明以来的太极图',
  qian: '取自圆钱方孔的钱纹',
  ling: '取自汉代织锦上的菱纹',
};

/** 图案放在哪:旗中间、旗杆边、左上角 */
export type ChargeAt = 'center' | 'hoist' | 'canton';

/** 一面旗 */
export interface FlagSpec {
  shape: Shape;
  layout: Layout;
  /** 底子的颜色(按 layout 用前几块,见 LAYOUT_COLORS) */
  c: Tinct[];
  /** 西幻、汗国的图案;烙印的样子在 tamga(主干 + 一两笔,见 render/flag 的烙印) */
  charge?: { sym: Sym; t: Tinct; at: ChargeAt; tamga?: number };
  /** 左上角的小星(分出来的国家用来区别母国):颜色、几颗 */
  mullet?: Tinct;
  mullets?: number;
  /** 东方旗:犬牙边和中间图案的颜色(有这一项 = 东方旗) */
  edge?: Tinct;
  /** 东方旗:中间的神兽或纹样;没有 = 不画 */
  mark?: Mark;
  /** 东方旗:镶边(从别国分出来的,像清代八旗的"镶") */
  trim?: Tinct;
}

/** 东方旗(牙旗,或东方的方旗 / 燕尾旗):中间画神兽、纹样,颜色按五德 */
export const isEastern = (s: FlagSpec) => s.edge !== undefined;

// ---------------------------------------------------------------------------
// 存档里的写法(WorldEdits.flags 的值):一面十几个字
//
//   形/样式/颜色[/c=图案.颜色.位置[.烙印]][/m=星的颜色几颗][/e=犬牙边][/k=神兽或纹样][/t=镶边]
//   形:r 方旗、s 燕尾旗、b 牙旗;位置:c 中间、h 旗杆边、k 左上角
//   例:"b/plain/W/e=R/k=long"(白底红犬牙边的龙旗)、"r/tri-h/RWB/c=leaf.R.c"(红白蓝三色横条,中间一片红叶子)

const SHAPE_CODE: Record<Shape, string> = { rect: 'r', swallow: 's', banner: 'b' };
const AT_CODE: Record<ChargeAt, string> = { center: 'c', hoist: 'h', canton: 'k' };
const ALL_LAYOUTS = Object.keys(LAYOUT_NAME) as Layout[];
const ALL_SYMS = Object.keys(SYM_NAME) as Sym[];
/** 存档里一面旗最长多少字 */
export const FLAG_CODE_MAX = 80;

export function encodeFlag(s: FlagSpec): string {
  const parts = [SHAPE_CODE[s.shape], s.layout, s.c.join('')];
  if (s.charge) parts.push(`c=${s.charge.sym}.${s.charge.t}.${AT_CODE[s.charge.at]}${s.charge.tamga !== undefined ? `.${s.charge.tamga}` : ''}`);
  if (s.mullet) parts.push(`m=${s.mullet}${s.mullets ?? 1}`);
  if (s.edge) parts.push(`e=${s.edge}`);
  if (s.mark) parts.push(`k=${s.mark}`);
  if (s.trim) parts.push(`t=${s.trim}`);
  return parts.join('/');
}

const isTinct = (x: string): x is Tinct => x.length === 1 && x in TINCT;
const keyOf = <T extends string>(rec: Record<T, string>, v: string): T | undefined => (Object.keys(rec) as T[]).find((k) => rec[k] === v);

/** 存档里的写法 → 旗;格式不对 = null */
export function decodeFlag(code: unknown): FlagSpec | null {
  if (typeof code !== 'string' || !code || code.length > FLAG_CODE_MAX) return null;
  const [sh, layout, cs, ...rest] = code.split('/');
  const shape = keyOf(SHAPE_CODE, sh);
  if (!shape || !ALL_LAYOUTS.includes(layout as Layout) || !cs || cs.length > 3) return null;
  const c = [...cs];
  if (!c.every(isTinct)) return null;
  const s: FlagSpec = { shape, layout: layout as Layout, c: c as Tinct[] };
  for (const part of rest) {
    const [k, v] = [part.slice(0, 2), part.slice(2)];
    if (k === 'c=') {
      const [sym, t, at, tg] = v.split('.');
      const a = keyOf(AT_CODE, at);
      if (!ALL_SYMS.includes(sym as Sym) || !isTinct(t) || !a) return null;
      s.charge = { sym: sym as Sym, t, at: a };
      if (tg !== undefined) {
        const n = Number(tg);
        if (!/^\d{1,3}$/.test(tg) || n > 0o777) return null;
        s.charge.tamga = n;
      }
    } else if (k === 'm=') {
      const n = Number(v.slice(1));
      if (!isTinct(v[0]) || !/^[1-3]$/.test(v.slice(1))) return null;
      s.mullet = v[0] as Tinct;
      s.mullets = n;
    } else if (k === 'e=' && isTinct(v)) s.edge = v;
    else if (k === 'k=' && (MARKS as string[]).includes(v)) s.mark = v as Mark;
    else if (k === 't=' && isTinct(v)) s.trim = v;
    else return null;
  }
  return s;
}
