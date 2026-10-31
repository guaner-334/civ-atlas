/**
 * 国家旗帜:推演结束后照已有的历史给每个国家配旗("贴上去",国界、战争、人物一样不改,不影响 GENERATOR_VERSION)。
 * 纯计算,不碰 DOM。画法在 render/flag/,旗上每样东西的意思在 flagText.ts。
 *
 * ## 怎么配
 *
 * - 颜色看民族:每个民族按它的稳定键挑 2–3 色(一个金属色白 / 金 + 一两个颜色),同族的国家都从这几色里取;
 *   各语感有偏好(斯拉夫白红蓝、北境红白蓝、沙海绿白黑红、精灵绿白青……)。相邻两块尽量一个金属色一个颜色(纹章的老规矩)。
 * - 样式看国体和语感:王国照本族常用的样式,河湖民族有四成是波纹;共和国用条纹 / 三色竖条 / 十字 / 左上角方块;
 *   汗国(和游牧民族的国家)用燕尾旗 + 部族烙印;东方语感的王朝用牙旗(犬牙边)。
 * - 图案看王室兴起的城(第一朝 = 立国时的国都,之后 = 每朝的根据地):港口、山城、河边、林中、草原沙漠、平原各有几样。
 * - 东方牙旗:底色按五德(木青、火红、土黄、金白、水黑),立国那朝随机,之后每换一朝按相生(木 → 火 → 土 → 金 → 水 → 木)换;
 *   旗上不写字,中间一只神兽或一样纹样(古代旗帜、器物上用过的),和犬牙边同色,换朝代换一样、和上一朝不重样。
 * - 换朝代:西幻换图案(颜色、样式不变);东方换底色和图案;汗国换烙印。
 * - 改制(regime.ts):只在"君主没了 / 回来了"的时候换旗 —— 废君、革命改共和:西幻和汗国颜色、城的图案留着,
 *   样式换成共和国常用的(条纹、三色竖条、十字、左上角方块),王冠、剑、烙印这类王室的东西拿掉;东方牙旗改方旗、底色留着,
 *   神兽换成纹样(避开日、日月这类像现实国旗的)。立宪、政变、还政不换。复辟迎回旧王室:用回改制前那面;
 *   旧王室没人了、拥立的人自己做君主:当成换了一朝(西幻在共和的旗上换成新王室的图案,东方方旗改回牙旗、按五德往下推一德、换一只神兽)。
 * - 分家:西幻沿用母国当时的旗,换一个颜色、左上角加星(第几个分出来就几颗,最多三颗);
 *   东方沿用母国当时的德和图案,加一道镶边;汗国在母国的烙印上加一笔。复国:用回故国亡国前的最后那面旗。
 * - 随机数都从 subSeed(种子, 'flag:' + 国家的稳定键 …) 取:同一个种子永远同一面旗。
 *
 * ## 作者改过的旗
 *
 * WorldEdits.flags(edits.ts):稳定键 → 编码过的旗(encodeFlag)。键是国家(`polity:…`,第一朝)或朝代(`dynasty:…/2`,第 2 朝);
 * 改的是"这一国从这一朝起"的旗:之后换朝代时照改过的那面往下配(东方从改过的底色按五德往下推,西幻换图案、颜色样式照改过的)。
 * 旧存档没有这一项 = 全部自动配。
 */
import type { World } from '../../world';
import type { Civ, Polity } from '../types';
import { biomeTagged } from '../../biomes';
import { mulberry32, subSeed, type Rng } from '../../util';
import { cultureKey, dynastyKey, polityKey } from '../../edits';
import { BEASTS, decodeFlag, EDIT_LAYOUTS, isBeast, isEastern, isMetal, MARKS, type ChargeAt, type FlagSpec, type Layout, type Mark, type Shape, type Sym, type Tinct } from './flagSpec';

// 颜色、样式、图案的名字、FlagSpec 和存档里的写法在 flagSpec.ts;原来从这里 import 的照旧能用
export * from './flagSpec';

// ---------------------------------------------------------------------------
// 各语感的偏好

/** 各语感偏爱的颜色(前面的更常用)和样式 */
const TASTE: Record<string, { colors: Tinct[]; layouts: Layout[] }> = {
  slavic: { colors: ['W', 'R', 'B', 'Y', 'M'], layouts: ['tri-h', 'tri-h', 'bi-h', 'chevron', 'cross'] },
  nordic: { colors: ['R', 'W', 'B', 'Y', 'K'], layouts: ['nordic', 'nordic', 'nordic', 'bi-h'] },
  kingdom: { colors: ['R', 'W', 'Y', 'B', 'K'], layouts: ['quarterly', 'cross', 'saltire', 'bi-v', 'bordure', 'plain'] },
  imperial: { colors: ['P', 'Y', 'M', 'W', 'R'], layouts: ['bordure', 'pale', 'plain', 'fess', 'disc'] },
  hellenic: { colors: ['B', 'W', 'S', 'Y'], layouts: ['stripes', 'cross', 'bi-h', 'plain', 'disc'] },
  desert: { colors: ['G', 'W', 'K', 'R', 'Y'], layouts: ['tri-h', 'chevron', 'pale', 'plain'] },
  steppe: { colors: ['S', 'Y', 'R', 'B', 'W'], layouts: ['plain', 'hoist'] },
  elven: { colors: ['G', 'W', 'T', 'S', 'Y'], layouts: ['bordure', 'per-bend', 'pale', 'disc', 'wavy'] },
  frontier: { colors: ['R', 'K', 'W', 'Y', 'S'], layouts: ['plain', 'hoist'] },
};

const tasteOf = (style: string) => TASTE[style] ?? TASTE.kingdom;

const REPUBLIC_LAYOUTS: Layout[] = ['stripes', 'tri-v', 'cross', 'canton'];
/** 改共和以后东方方旗上的纹样(避开日、日月、太极这类像现实国旗的) */
const REPUBLIC_MARKS: Mark[] = ['dou', 'san', 'lei', 'qian', 'ling', 'shui', 'huo'];

/** 王室兴起的城是哪一类 */
export type Seat = 'sea' | 'mountain' | 'river' | 'forest' | 'dry' | 'plain';

const SEAT_SYMS: Record<Seat, Sym[]> = {
  sea: ['ship', 'anchor', 'trident', 'star8'],
  mountain: ['mountain', 'star', 'tower'],
  river: ['fish', 'tower', 'key'],
  forest: ['tree', 'leaf', 'bird'],
  dry: ['sun', 'crescent', 'star8'],
  plain: ['wheat', 'tower', 'crown', 'sword', 'key', 'rose'],
};

/** 东方:神兽、纹样各占一半 */
const SEAT_MARKS: Record<Seat, Mark[]> = {
  sea: ['yao', 'long', 'dou', 'shui'],
  mountain: ['baihu', 'taotie', 'san', 'lei'],
  river: ['gui', 'long', 'shui', 'qian'],
  forest: ['hu', 'feng', 'taiji', 'ling'],
  dry: ['bifang', 'huo', 'ri'],
  plain: ['feng', 'long', 'riyue', 'qian'],
};

// ---------------------------------------------------------------------------
// 五德

export const DE = ['木', '火', '土', '金', '水'] as const;
/** 五德的底色 */
export const DE_TINCT: Tinct[] = ['T', 'R', 'Y', 'W', 'K'];
/** 五德的犬牙边(土德、金德用红,水德用白) */
export const DE_EDGE: Tinct[] = ['Y', 'Y', 'R', 'R', 'W'];
/** 底色是第几德(不是五德的颜色 = −1) */
export const deOf = (t: Tinct | undefined) => (t ? DE_TINCT.indexOf(t) : -1);

// ---------------------------------------------------------------------------
// 一国历代的旗

/** 这一面是怎么来的(旗帜详情里讲意思用,见 flagText.ts) */
export interface FlagWhy {
  /** 东方(牙旗)/ 汗国(燕尾旗 + 烙印)/ 西幻和共和国 */
  kind: 'east' | 'khan' | 'west';
  /** 第几朝(Polity.dynasties 的下标;0 = 立国那一朝) */
  dyn: number;
  /** 这一朝兴起的城(Settlement id)和它是哪一类 */
  city: number;
  seat: Seat;
  /** 从哪国分出来的(只在第一面);mentor = true 时是受哪国影响立的国(边缘立国,Polity.mentor),旗仿它的样式 */
  parent?: number;
  mentor?: true;
  /** 西幻分家:第几个分出来的、换掉的颜色(旧 → 新) */
  nth?: number;
  swap?: [Tinct, Tinct];
  /** 东方分家:第一面沿用了母国的图案 */
  inheritMark?: boolean;
  /** 汗国分家:在母国的烙印上加了一笔 */
  nomadParent?: boolean;
  /** 复国:用回了哪个故国的旗(只在第一面) */
  restores?: number;
  /**
   * 改制(这一面是改制那一刻起的):republic 废君 / 革命改共和换的;keep 政变、还政没换(和上一面一样);
   * restore 复辟迎回旧王室,用回改制前那面;crown 复辟时拥立的人自己做君主,当成换了一朝。寻常的不给
   */
  reform?: 'republic' | 'keep' | 'restore' | 'crown';
  /** 改制以前用的是第几面(eras 的下标;旗帜详情里"改制以前用的是这面") */
  prior?: number;
}

export interface FlagEra {
  /** 从哪年起(第一面 = 立国那年) */
  year: number;
  /** 第几朝 */
  dyn: number;
  /** 作者改旗用的稳定键:第一朝 = 国家的键,之后 = 朝代的键 */
  key: string;
  spec: FlagSpec;
  /** auto = 按规则配的;edited = 作者改的这一面;derived = 照作者更早改过的那面往下配的 */
  how: 'auto' | 'edited' | 'derived';
  why: FlagWhy;
}

/** 作者改过的旗(稳定键 → 旗),见文件头 */
export type FlagOverrides = Readonly<Record<string, FlagSpec>>;

const pick = <T>(rng: Rng, a: readonly T[]): T => a[Math.floor(rng() * a.length)];
/** 偏向前面的挑法 */
const pickFront = <T>(rng: Rng, a: readonly T[]): T => a[Math.floor(rng() * rng() * a.length)];

/** 民族的一套颜色:2–3 色,至少一个金属色(白 / 金)和一个颜色 */
export function culturePalette(seed: number, civ: Civ, cu: number): Tinct[] {
  const c = civ.cultures[cu];
  const rng = mulberry32(subSeed(seed, 'flag-culture:' + cultureKey(civ, cu)));
  const taste = tasteOf(c.style);
  const metals = taste.colors.filter(isMetal);
  const colors = taste.colors.filter((t) => !isMetal(t));
  const m = pickFront(rng, metals.length ? metals : (['W', 'Y'] as Tinct[]));
  const a = pickFront(rng, colors);
  const rest = colors.filter((t) => t !== a);
  const out: Tinct[] = [a, m];
  if (rng() < 0.65 && rest.length) out.push(pickFront(rng, rest));
  return out;
}

/** 林中、草原沙漠的城(按 Biome 下标,见地貌表的标签 forest、arid) */
const FOREST = biomeTagged('forest');
const DRY = biomeTagged('arid');

/** 城是哪一类:港口、海拔 1100 米以上、大河边、林中、草原沙漠、平原 */
export function seatOf(world: World, civ: Civ, sid: number): Seat {
  const s = civ.settlements[sid];
  if (!s) return 'plain';
  if (s.port) return 'sea';
  const r = s.region;
  const el = civ.regions.elevation[r];
  if (el > 1100) return 'mountain';
  if ((world.flux[s.cell] ?? 0) > world.riverThreshold * 2) return 'river';
  const b = civ.regions.biome[r];
  if (FOREST[b]) return 'forest';
  if (DRY[b]) return 'dry';
  return 'plain';
}

/** 图案放在哪个颜色上(用来挑反差色) */
export function underCharge(spec: Pick<FlagSpec, 'layout' | 'c'>, at: ChargeAt): Tinct {
  const c = spec.c;
  switch (spec.layout) {
    case 'plain':
    case 'bordure':
    case 'saltire':
      return c[0];
    case 'disc':
      return c[1] ?? c[0];
    case 'bi-h':
    case 'tri-h':
      return at === 'canton' ? c[0] : (c[1] ?? c[0]);
    case 'fess':
    case 'pale':
    case 'tri-v':
    case 'canton':
      return c[1] ?? c[0];
    case 'bi-v':
      return c[0];
    case 'chevron':
      return c[2] ?? c[0];
    case 'stripes':
      return c[2] ?? c[1] ?? c[0];
    case 'quarterly':
    case 'nordic':
    case 'cross':
    case 'per-bend':
    case 'wavy':
    case 'hoist':
      return c[0];
  }
}

/** 按样式,图案放在哪 */
export function chargeAt(layout: Layout): ChargeAt {
  if (layout === 'canton' || layout === 'stripes' || layout === 'quarterly' || layout === 'nordic' || layout === 'cross' || layout === 'per-bend' || layout === 'wavy') return 'canton';
  if (layout === 'chevron' || layout === 'bi-v' || layout === 'fess' || layout === 'hoist') return 'hoist';
  return 'center';
}

/** 和底色有反差的颜色:底是金属色就挑颜色,反之挑金属色 */
function contrast(rng: Rng, under: Tinct, pal: Tinct[]): Tinct {
  const want = (isMetal(under) ? pal.filter((t) => !isMetal(t)) : pal.filter(isMetal)).filter((t) => t !== under);
  const fall: Tinct[] = isMetal(under) ? ['R', 'B', 'K'] : ['Y', 'W'];
  return pickFront(rng, want.length ? want : fall);
}

/** 按样式排好颜色:相邻的块尽量一个金属色一个颜色 */
function arrange(rng: Rng, layout: Layout, pal: Tinct[]): Tinct[] {
  const metals = pal.filter(isMetal);
  const colors = pal.filter((t) => !isMetal(t));
  const m = metals[0] ?? 'W';
  const a = colors[0] ?? 'R';
  const b = colors[1];
  switch (layout) {
    case 'tri-h':
    case 'tri-v':
      // 中间是金属色:颜色、金属、颜色;只有一种颜色就 金属、颜色、金属
      return b ? (rng() < 0.5 ? [a, m, b] : [b, m, a]) : [m, a, m];
    case 'fess':
    case 'pale':
      return [a, m, a];
    case 'chevron':
      return b ? [m, a, b] : [m, a, a === 'K' ? 'R' : 'K'];
    case 'stripes':
      return [a, m, b ?? (a === 'B' ? 'R' : 'B')];
    case 'quarterly':
    case 'disc':
    case 'hoist':
    case 'bordure':
    case 'canton':
      return [a, m];
    case 'nordic':
    case 'cross':
    case 'saltire':
      return b ? [a, m, b] : [a, m];
    case 'bi-h':
    case 'bi-v':
    case 'per-bend':
      return rng() < 0.6 ? [m, a] : [a, m];
    default:
      return [a, m];
  }
}

/** 烙印:低 3 位是主干(六种),再往上每 3 位一笔(0 = 没有) */
function tamgaCode(rng: Rng): number {
  const base = Math.floor(rng() * 6);
  const m1 = 1 + Math.floor(rng() * 6);
  return base | (m1 << 3);
}

/** 给烙印加一笔(分出来的部族) */
function tamgaPlus(code: number, rng: Rng): number {
  const used = [(code >> 3) & 7, (code >> 6) & 7];
  if (!used[0]) return (code & 7) | ((1 + Math.floor(rng() * 6)) << 3);
  if (!used[1]) {
    let m = 1 + Math.floor(rng() * 6);
    if (m === used[0]) m = (m % 6) + 1;
    return (code & 0o77) | (m << 6);
  }
  let m = 1 + Math.floor(rng() * 6);
  if (m === used[0] || m === used[1]) m = (m % 6) + 1;
  return (code & 0o7) | (used[0] << 3) | (m << 6);
}

/** 东方语感、不是汗国的国家:配牙旗 */
const easternRealm = (p: Polity) => !!p.eastern && p.lineage !== 'khanate';
/** 汗国或游牧民族的国家:配燕尾旗 */
const nomadic = (civ: Civ, p: Polity) => p.lineage === 'khanate' || civ.cultures[p.culture]?.kind === 'nomad';

/** 两国的旗是不是一路(都配牙旗 / 都配燕尾旗 / 都配西幻的旗):是才能沿用 */
function sameFamily(civ: Civ, p: Polity, q: Polity): boolean {
  if (easternRealm(p) || easternRealm(q)) return easternRealm(p) && easternRealm(q);
  return nomadic(civ, p) === nomadic(civ, q);
}

/** 某一年的那一面(没立国 = 第一面,已亡 = 最后一面) */
export function flagAt(eras: readonly FlagEra[], year: number): FlagEra {
  let e = eras[0];
  for (const x of eras) if (x.year <= year) e = x;
  return e;
}

/** 历朝:没改朝换代过 = 一朝(立国那年、国都) */
function dynastiesOf(p: Polity): { year: number; name: string; seat: number; regime?: 'republic' | 'junta'; house?: number }[] {
  return p.dynasties && p.dynasties.length ? p.dynasties : [{ year: p.founded, name: p.name, seat: p.capital }];
}

/** 第 i 朝的改旗键 */
export function flagKey(civ: Civ, id: number, i: number): string {
  return i === 0 ? polityKey(civ, id) : dynastyKey(civ, id, i);
}

interface Ctx {
  world: World;
  civ: Civ;
  seed: number;
  overrides: FlagOverrides;
  memo: Map<number, FlagEra[]>;
}

/** 某国在某年的那一面(分家、复国要看母国 / 故国当时的旗) */
function specOf(ctx: Ctx, id: number, year: number): FlagSpec {
  const eras = polityEras(ctx, id);
  return eras.length ? flagAt(eras, year).spec : { shape: 'rect', layout: 'plain', c: ['W'] };
}

const copy = (s: FlagSpec): FlagSpec => ({ ...s, c: s.c.slice(), charge: s.charge ? { ...s.charge } : undefined });

/**
 * 一个国家历代的旗(第一面 = 立国那年;每换一朝一面)。overrides = 作者改过的(见文件头);
 * memo 存已经算过的国家(分出来的要看母国,复国的要看故国)
 */
function polityEras(ctx: Ctx, id: number): FlagEra[] {
  const hit = ctx.memo.get(id);
  if (hit) return hit;
  // 先占位:母国、故国的链再长也不会绕回自己(保险起见)
  ctx.memo.set(id, []);
  const { world, civ, seed } = ctx;
  const p = civ.polities[id];
  const key = polityKey(civ, id);
  const rng = mulberry32(subSeed(seed, 'flag:' + key));
  const cu = civ.cultures[p.culture];
  const pal = culturePalette(seed, civ, p.culture);
  const taste = tasteOf(cu.style);
  const dyn = dynastiesOf(p);
  const eras: FlagEra[] = [];
  // 边缘立国(Polity.mentor)的国家:旗仿影响它的那一国的样式(和分出来的一样沿用,只是不加分家的星、镶边);
  // 两国的旗不是一路(牙旗 / 燕尾旗 / 西幻的旗)就不仿,自己配
  const M = p.parent === undefined && p.mentor !== undefined ? civ.polities[p.mentor] : undefined;
  const byMentor = !!M && sameFamily(civ, p, M);
  const parent = p.parent !== undefined ? civ.polities[p.parent] : byMentor ? M : undefined;
  const cityOf = (i: number) => (i === 0 ? p.capital : dyn[i].seat);
  let edited = false;
  /** 套上作者改过的:这一朝改过 = 用改过的那面 */
  const push = (i: number, spec: FlagSpec, why: FlagWhy) => {
    const k = flagKey(civ, id, i);
    const ov = ctx.overrides[k];
    if (ov) edited = true;
    eras.push({ year: i === 0 ? p.founded : dyn[i].year, dyn: i, key: k, spec: ov ? copy(ov) : spec, how: ov ? 'edited' : edited ? 'derived' : 'auto', why });
  };

  // ---- 第一面 ----
  const why0 = (kind: FlagWhy['kind']): FlagWhy => ({ kind, dyn: 0, city: p.capital, seat: seatOf(world, civ, p.capital), parent: parent ? parent.id : undefined, ...(byMentor ? { mentor: true as const } : {}) });
  if (p.restores !== undefined && civ.polities[p.restores]) {
    // 复国:用回故国最后那面旗
    const old = polityEras(ctx, p.restores);
    const last = old[old.length - 1];
    if (last) push(0, copy(last.spec), { ...why0(last.why.kind), parent: undefined, restores: p.restores });
  }
  if (!eras.length && easternRealm(p)) {
    // 东方王朝:牙旗,五德
    let de = Math.floor(rng() * 5);
    let inherit: FlagSpec | undefined;
    let trim: Tinct | undefined;
    if (parent && easternRealm(parent)) {
      inherit = specOf(ctx, parent.id, p.founded);
      de = Math.max(0, deOf(inherit.c[0]));
      // 清代八旗:正黄 → 镶黄(加红边);红旗镶白边。受影响立的国不加边(不是分家)
      if (!byMentor) {
        trim = inherit.c[0] === 'R' ? 'W' : 'R';
        if (inherit.trim === trim) trim = trim === 'R' ? 'Y' : 'R';
      }
    }
    const republic = p.lineage === 'republic' || !!dyn[0].regime;
    const shape: Shape = republic ? 'rect' : 'banner';
    const seat = seatOf(world, civ, p.capital);
    const drng = mulberry32(subSeed(seed, `flag:${key}/0`));
    let mark: Mark = inherit?.mark ? inherit.mark : pick(drng, SEAT_MARKS[seat]);
    // 白底红日太像别处的国旗:金德(白底)改画日月
    if (mark === 'ri' && DE_TINCT[de] === 'W') mark = 'riyue';
    // 革命自立的共和国:神兽换成纹样
    if (dyn[0].regime && isBeast(mark)) mark = republicMark(drng, seat, undefined);
    push(0, { shape, layout: 'plain', c: [DE_TINCT[de]], edge: trim ?? DE_EDGE[de], mark, trim }, { ...why0('east'), inheritMark: !!inherit?.mark });
  } else if (!eras.length && nomadic(civ, p) && !dyn[0].regime) {
    // 汗国:燕尾旗 + 烙印
    let code = tamgaCode(rng);
    let spec: FlagSpec;
    const layout: Layout = pick(rng, ['plain', 'hoist'] as Layout[]);
    const nomadParent = !!parent && nomadic(civ, parent);
    if (nomadParent) {
      const at = specOf(ctx, parent!.id, p.founded);
      code = tamgaPlus(at.charge?.tamga ?? code, rng);
      const c = at.c.slice();
      // 换底色
      const alt = pal.filter((t) => !isMetal(t) && t !== c[0]);
      c[0] = alt.length ? alt[0] : c[0] === 'S' ? 'R' : 'S';
      spec = { ...at, c, charge: { sym: 'tamga', t: contrast(rng, c[0], pal), at: 'hoist', tamga: code } };
      if (!at.charge || at.shape !== 'swallow') spec = { ...spec, shape: 'swallow', edge: undefined, mark: undefined, trim: undefined };
    } else {
      const c = arrange(rng, layout, pal);
      spec = { shape: 'swallow', layout, c, charge: { sym: 'tamga', t: contrast(rng, c[0], pal), at: layout === 'hoist' ? 'center' : 'hoist', tamga: code } };
    }
    push(0, spec, { ...why0('khan'), nomadParent });
  } else if (!eras.length) {
    // 西幻王国 / 共和国
    let base: FlagSpec;
    let split: Pick<FlagWhy, 'nth' | 'swap'> | null = null;
    if (parent && dyn[0].regime && !parent.eastern && parent.lineage !== 'khanate') {
      // 革命据地自立的共和国:母国的颜色留着,样式换成共和国常用的,王冠、剑拿掉(和废君改共和一样)
      base = republicStep(specOf(ctx, parent.id, p.founded), seatOf(world, civ, p.capital), pal, mulberry32(subSeed(seed, `flag:${key}/0`)));
    } else if (parent && !parent.eastern && parent.lineage !== 'khanate') {
      // 沿用母国的样式,换一种颜色,左上角加星
      const at = specOf(ctx, parent.id, p.founded);
      const c = at.c.slice();
      const swap = c.findIndex((t) => !isMetal(t));
      const alt = [...pal, ...(TASTE[cu.style]?.colors ?? [])].filter((t) => !isMetal(t) && !c.includes(t));
      if (swap >= 0 && alt.length) c[swap] = alt[0];
      if (byMentor) {
        // 受影响立的国:沿用样式、换一种颜色,不加星
        base = { ...at, c };
        delete base.mullet;
        delete base.mullets;
        split = { swap: swap >= 0 ? [at.c[swap], c[swap]] : undefined };
      } else {
        const nth = civ.polities.filter((q) => q.parent === parent.id && q.restores === undefined && q.id <= p.id).length;
        const ns = Math.min(3, Math.max(1, nth));
        base = { ...at, c, mullet: isMetal(c[0]) ? 'R' : 'W', mullets: ns };
        split = { nth, swap: swap >= 0 ? [at.c[swap], c[swap]] : undefined };
      }
    } else {
      let layout: Layout;
      if (p.lineage === 'republic' || dyn[0].regime) layout = pick(rng, REPUBLIC_LAYOUTS);
      else {
        layout = pickFront(rng, taste.layouts);
        if ((cu.kind === 'river' || cu.kind === 'lake') && rng() < 0.4) layout = 'wavy';
      }
      base = { shape: 'rect', layout, c: arrange(rng, layout, pal) };
    }
    const drng = mulberry32(subSeed(seed, `flag:${key}/0`));
    const seat = seatOf(world, civ, p.capital);
    const spec = westStep(base, undefined, seat, p, pal, drng, !!dyn[0].regime);
    // 分出来的:图案沿用母国的,只重新挑颜色
    if (split && base.charge) spec.charge = { ...base.charge, t: contrast(drng, underCharge(base, chargeAt(base.layout)), [...pal, ...base.c]) };
    push(0, spec, { ...why0('west'), ...split });
  }

  // ---- 之后每换一朝 ----
  for (let i = 1; i < dyn.length; i++) {
    const prev = eras[i - 1].spec;
    const city = cityOf(i);
    const seat = seatOf(world, civ, city);
    const drng = mulberry32(subSeed(seed, `flag:${key}/${i}`));
    const why: FlagWhy = { kind: 'west', dyn: i, city, seat };
    const d = dyn[i];
    const kindOf = (x: FlagSpec): FlagWhy['kind'] => (isEastern(x) ? 'east' : x.charge?.sym === 'tamga' ? 'khan' : 'west');
    if (d.regime && (d.regime === 'junta' || dyn[i - 1].regime)) {
      // 政变、还政:君主没变(本来就没有),旗不换
      push(i, copy(prev), { ...why, kind: kindOf(prev), reform: 'keep', prior: i - 1 });
      continue;
    }
    if (d.regime) {
      // 废君、革命改共和
      if (isEastern(prev)) {
        const mark = prev.mark && !isBeast(prev.mark) && REPUBLIC_MARKS.includes(prev.mark) ? prev.mark : republicMark(drng, seat, prev.mark);
        push(i, { shape: 'rect', layout: 'plain', c: [prev.c[0]], edge: prev.edge, mark, ...(prev.trim ? { trim: prev.trim } : {}) }, { ...why, kind: 'east', reform: 'republic', prior: i - 1 });
      } else push(i, republicStep(prev, seat, pal, drng), { ...why, reform: 'republic', prior: i - 1 });
      continue;
    }
    if (d.house !== undefined) {
      // 复辟迎回旧王室:用回改制前那面(改制以前最后一段王室的旗)
      let j = i - 1;
      while (j > 0 && dyn[j].regime) j--;
      push(i, copy(eras[j].spec), { ...why, kind: kindOf(eras[j].spec), reform: 'restore', prior: j });
      continue;
    }
    if (dyn[i - 1].regime) {
      // 复辟、旧王室没人了:拥立的人自己做君主,当成换了一朝
      let spec: FlagSpec;
      if (isEastern(prev)) {
        const d0 = deOf(prev.c[0]);
        const de = d0 < 0 ? -1 : (d0 + 1) % 5;
        const c0 = de < 0 ? prev.c[0] : DE_TINCT[de];
        const beasts = SEAT_MARKS[seat].filter(isBeast);
        const mark: Mark = pick(drng, beasts.length ? beasts : BEASTS);
        spec = { shape: 'banner', layout: 'plain', c: [c0], edge: prev.trim ?? (de < 0 ? prev.edge : DE_EDGE[de]), mark, ...(prev.trim ? { trim: prev.trim } : {}) };
      } else if (nomadic(civ, p)) {
        const layout: Layout = pick(drng, ['plain', 'hoist'] as Layout[]);
        const c = arrange(drng, layout, pal);
        spec = { shape: 'swallow', layout, c, charge: { sym: 'tamga', t: contrast(drng, c[0], pal), at: layout === 'hoist' ? 'center' : 'hoist', tamga: tamgaCode(drng) } };
      } else spec = westStep({ ...prev, charge: undefined }, prev.charge?.sym, seat, p, pal, drng);
      push(i, spec, { ...why, kind: kindOf(spec), reform: 'crown', prior: i - 1 });
      continue;
    }
    if (isEastern(prev)) {
      // 东方:按五德相生换底色,换一样图案(和上一朝不重样)
      const d0 = deOf(prev.c[0]);
      const de = d0 < 0 ? -1 : (d0 + 1) % 5;
      const ms = SEAT_MARKS[seat];
      let mark: Mark = pick(drng, ms);
      if (mark === prev.mark) mark = ms.find((z) => z !== prev.mark) ?? (prev.mark === 'ri' ? 'dou' : 'ri');
      const c0 = de < 0 ? prev.c[0] : DE_TINCT[de];
      if (mark === 'ri' && c0 === 'W') mark = 'riyue';
      push(i, { ...prev, c: [c0], edge: prev.trim ?? (de < 0 ? prev.edge : DE_EDGE[de]), mark }, { ...why, kind: 'east' });
    } else if (prev.charge?.sym === 'tamga') {
      // 汗国:换一家部族掌权,换烙印
      push(i, { ...prev, charge: { ...prev.charge, tamga: tamgaCode(drng) } }, { ...why, kind: 'khan' });
    } else {
      // 西幻:换王室换图案,颜色和样式不变
      push(i, westStep({ ...prev, charge: undefined }, prev.charge?.sym, seat, p, pal, drng), why);
    }
  }
  ctx.memo.set(id, eras);
  return eras;
}

/** 改共和以后东方方旗上的纹样:先挑这座城那一类里的纹样,没有就从共和的几样里挑;和上一面不重样 */
function republicMark(drng: Rng, seat: Seat, prev: Mark | undefined): Mark {
  const own = SEAT_MARKS[seat].filter((m) => REPUBLIC_MARKS.includes(m) && m !== prev);
  const list = own.length ? own : REPUBLIC_MARKS.filter((m) => m !== prev);
  return pick(drng, list);
}

/**
 * 西幻、汗国废君改共和:颜色留着(按共和国常用的样式重排),样式换成共和国常用的;
 * 城的图案留着,王冠、剑、烙印这类王室的东西拿掉,换一样这座城那一类的图案
 */
function republicStep(prev: FlagSpec, seat: Seat, pal: Tinct[], drng: Rng): FlagSpec {
  const own = [...new Set(prev.c)];
  const colors = own.some((t) => !isMetal(t)) && own.some(isMetal) ? own : [...own, ...pal.filter((t) => !own.includes(t))];
  const layout = pick(drng, REPUBLIC_LAYOUTS.filter((l) => l !== prev.layout));
  const base: FlagSpec = { shape: 'rect', layout, c: arrange(drng, layout, colors) };
  const keep = prev.charge && prev.charge.sym !== 'crown' && prev.charge.sym !== 'sword' && prev.charge.sym !== 'tamga' ? prev.charge.sym : undefined;
  if (keep) {
    const at = chargeAt(layout);
    return { ...base, charge: { sym: keep, t: contrast(drng, underCharge(base, at), [...pal, ...base.c]), at } };
  }
  return westStep(base, prev.charge?.sym, seat, null, pal, drng, true);
}

/** 西幻换一朝:按王室兴起的城挑一样图案(和上一朝不重样),颜色挑和底子有反差的;共和国(republic)不用王冠、剑 */
function westStep(base: FlagSpec, prevSym: Sym | undefined, seat: Seat, p: Polity | null, pal: Tinct[], drng: Rng, republic = false): FlagSpec {
  let syms = SEAT_SYMS[seat].slice();
  if (republic || p?.lineage === 'republic') syms = syms.filter((s) => s !== 'crown' && s !== 'sword');
  let sym: Sym = pickFront<Sym>(drng, syms.length ? syms : ['star']);
  if (prevSym === sym) sym = syms.find((x) => x !== prevSym) ?? (prevSym === 'crown' ? 'tower' : 'crown');
  const at = base.shape === 'swallow' && base.layout === 'plain' ? 'hoist' : chargeAt(base.layout);
  return { ...base, charge: { sym, t: contrast(drng, underCharge(base, at), [...pal, ...base.c]), at } };
}

/** 一个世界里所有国家的旗(下标 = 国家编号) */
export interface FlagBook {
  eras: FlagEra[][];
}

/** 算出所有国家历代的旗;overrides = 作者改过的(键 → 旗) */
export function flagBook(world: World, civ: Civ, overrides: FlagOverrides = {}): FlagBook {
  const ctx: Ctx = { world, civ, seed: civ.seed, overrides, memo: new Map() };
  return { eras: civ.polities.map((p) => polityEras(ctx, p.id)) };
}

/** 某国某年的那一面(没立国 = 第一面,已亡 = 最后一面);没有这国 = null */
export function polityFlagAt(book: FlagBook, id: number, year: number): FlagEra | null {
  const eras = book.eras[id];
  return eras && eras.length ? flagAt(eras, year) : null;
}

/** 某国所有朝代的改旗键(恢复自动配的时一起删) */
export function polityFlagKeys(civ: Civ, id: number): string[] {
  return dynastiesOf(civ.polities[id]).map((_, i) => flagKey(civ, id, i));
}

// ---------------------------------------------------------------------------
// 换一面:同样的规矩换几次随机

/**
 * 某国某一朝的候选旗(第 batch 批,每批 n 面;不含现在这面):
 * - 东方旗:底色不变,换神兽或纹样(先挑这朝兴起的城那一类)、犬牙边和图案的颜色、旗形(牙旗 / 方旗 / 燕尾)
 * - 汗国:燕尾旗,本族的颜色,换样式和烙印
 * - 西幻 / 共和国:本族的颜色和常用样式,图案按这一朝兴起的城挑
 */
export function flagAlternatives(world: World, civ: Civ, id: number, era: FlagEra, batch = 0, n = 8): FlagSpec[] {
  const p = civ.polities[id];
  const seed = civ.seed;
  const pal = culturePalette(seed, civ, p.culture);
  const taste = tasteOf(civ.cultures[p.culture].style);
  const seat = era.why.seat;
  const cur = era.spec;
  // 共和国(海洋城邦共和一系、改制开的共和 / 军政府那一段):共和国常用的样式,不用王冠、剑
  const republic = p.lineage === 'republic' || !!p.dynasties?.[era.dyn]?.regime;
  const out: FlagSpec[] = [];
  const seen = new Set([sameKey(cur)]);
  for (let k = 0; out.length < n && k < 80; k++) {
    const j = batch * 80 + k;
    const rng = mulberry32(subSeed(seed, `flag-alt:${era.key}#${j}`));
    let spec: FlagSpec;
    if (isEastern(cur)) {
      const own = SEAT_MARKS[seat];
      const mark: Mark = rng() < 0.5 ? pick(rng, own) : pick(rng, MARKS);
      const shape: Shape = pick(rng, ['banner', 'banner', 'banner', 'rect', 'swallow'] as Shape[]);
      const base = cur.c[0];
      const edges = (isMetal(base) ? ['R', 'K', 'B', 'T', 'M'] : base === 'K' ? ['W', 'Y', 'R'] : ['Y', 'W']) as Tinct[];
      const edge = cur.trim ?? pick(rng, edges);
      spec = { shape, layout: 'plain', c: [base], edge, mark: mark === 'ri' && base === 'W' ? 'riyue' : mark, trim: cur.trim };
    } else if (cur.charge?.sym === 'tamga') {
      const layout: Layout = pick(rng, ['plain', 'hoist', 'plain', 'bi-h'] as Layout[]);
      const c = arrange(rng, layout, pal);
      const at: ChargeAt = layout === 'hoist' ? 'center' : 'hoist';
      spec = { shape: 'swallow', layout, c, charge: { sym: 'tamga', t: contrast(rng, underCharge({ layout, c }, at), pal), at, tamga: tamgaCode(rng) } };
    } else {
      // 先照本族常用的样式配;本族的样式太少、配不满一批,再从全部样式里挑
      const layouts = republic ? REPUBLIC_LAYOUTS : taste.layouts;
      const layout = j < layouts.length ? layouts[j] : pick(rng, k < 40 ? layouts : EDIT_LAYOUTS);
      const c = arrange(rng, layout, pal);
      let syms = SEAT_SYMS[seat];
      if (republic) syms = syms.filter((s) => s !== 'crown' && s !== 'sword');
      const sym = pick(rng, syms);
      const at = chargeAt(layout);
      spec = { shape: 'rect', layout, c, charge: { sym, t: contrast(rng, underCharge({ layout, c }, at), pal), at } };
    }
    const sk = sameKey(spec);
    if (seen.has(sk)) continue;
    seen.add(sk);
    out.push(spec);
  }
  return out;
}

/** 两面旗看起来差不多(候选里不重复):样式 + 图案 + 旗形 */
function sameKey(s: FlagSpec): string {
  return isEastern(s) ? `e/${s.shape}/${s.mark ?? ''}/${s.edge}` : `${s.shape}/${s.layout}/${s.charge?.sym ?? ''}/${s.charge?.tamga ?? ''}`;
}

/** WorldEdits.flags(键 → 写法)→ 能用的(格式不对的跳过) */
export function flagOverrides(flags: Readonly<Record<string, string>> | undefined): Record<string, FlagSpec> {
  const out: Record<string, FlagSpec> = {};
  if (!flags) return out;
  for (const [k, v] of Object.entries(flags)) {
    const s = decodeFlag(v);
    if (s) out[k] = s;
  }
  return out;
}
