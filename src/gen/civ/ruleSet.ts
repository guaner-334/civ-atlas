/**
 * 一套规则:推演照它推的那些数,连同名字、出处。一个世界只用一套,建好以后不变。
 *
 * ```json
 * { "id": "rmh3k2x9a4f", "name": "战乱年代", "version": 2, "by": "明月", "about": "仗多，易代快",
 *   "basedOn": [{ "name": "群雄并起", "by": "砚山", "version": 1 }],
 *   "values": { "war.odds": 2, "war.truce": 2, "war.length": [3, 20], "war.crush": "never" },
 *   "biomes": { "temperateDesert": "灰烬荒原" } }
 * ```
 *
 * - id:本机的编号(这个浏览器的「我的规则」里那一套,ui/rulesStore.ts);随世界存下,世界里的和本机的对得上
 *   (「战乱年代 第 2 版(我的规则里已是第 3 版)」)。别的浏览器里没有这个编号就对不上,不影响推演。分享链接、规则文件里不带
 * - name:名字(最多 RULES_NAME_MAX 字,和新建世界的预设名一样长);没有 = UNNAMED_RULES
 * - version:第几版(正整数)。本机的一套被世界用过以后再改,版本加一;用过的世界存的是当时那一版,不跟着变
 * - by:署名(和分享世界时填的署名一样清理、一样长,../signature.ts);没有 = 不写
 * - about:一句介绍(最多 RULES_ABOUT_MAX 字);没有 = 不写
 * - basedOn:基于谁,最近的在前(名字、署名、第几版)。复制别人的、加进别人分享来的,都把来源记在最前面,改不掉、一路往下传;
 *   最多留 RULES_LINEAGE_MAX 层:最近的几层 + 最早的那一层(最早是谁一直留着)。没有 = 基于官方规则
 * - values:70 项规则项里改过的(tuning.ts 的 TuningValues,编号 → 值;没写的 = 官方)
 * - biomes:地貌的叫法(稳定的键 → 名字,最多 BIOME_NAME_MAX 字;只写和官方叫法不一样的)。只管叫法(图例、悬停里的字),不改历史
 *
 * 「和官方一样」= 没改规则项、也没改地貌的叫法(名字、署名、介绍、基于谁不算):这样的世界存档里不写这一项,和不用规则的世界一模一样。
 * 读进来的一套(存档、分享链接、文件、本机存的)都过 cleanRuleSet:认不出的丢、超长的截、坏的按默认,每处一句中文提示。
 * 纯计算,不碰 DOM;不引用推演本身(换成推演用的旋钮在 tuningPatch.ts),存档、首页读它不用把整个推演载进来。
 */
import { Biome, BIOMES } from '../biomes';
import { cleanSignature, SIGNATURE_MAX } from '../signature';
import { cleanTuning, type TuningValues } from './tuning';

/** 基于的一套:名字、署名(没有 = 不写)、第几版 */
export interface RuleSource {
  name: string;
  by?: string;
  version: number;
}

/** 地貌的叫法:稳定的键(BIOME_KEYS)→ 名字 */
export type BiomeNames = { readonly [key: string]: string };

/** 一套规则(见文件头) */
export interface RuleSet {
  /** 本机的编号(没有 = 不是本机「我的规则」里的) */
  id?: string;
  name: string;
  version: number;
  by?: string;
  about?: string;
  /** 基于谁(最近的在前);没有 = 基于官方规则 */
  basedOn?: readonly RuleSource[];
  /** 改过的规则项(没写的 = 官方) */
  values: TuningValues;
  /** 地貌的叫法(只写改过的) */
  biomes?: BiomeNames;
}

/** 名字最长几个字(和新建世界的预设名一样长) */
export const RULES_NAME_MAX = 24;
/** 一句介绍最长几个字 */
export const RULES_ABOUT_MAX = 60;
/** 一种地貌的叫法最长几个字 */
export const BIOME_NAME_MAX = 12;
/** 基于谁最多留几层(最近的 RULES_LINEAGE_MAX − 1 层 + 最早的那一层) */
export const RULES_LINEAGE_MAX = 4;
/** 第几版最大到多少(再大就不像了) */
export const RULES_VERSION_MAX = 99999;
/** 没起名字的一套叫什么 */
export const UNNAMED_RULES = '未命名规则';
/** 官方规则的名字 */
export const OFFICIAL_RULES_NAME = '官方规则';
/** 本机编号的样子 */
const RULES_ID = /^[a-z0-9]{4,24}$/;

// ---------------------------------------------------------------------------
// 地貌的键

/**
 * 十六种地貌各自的键(存档、链接、文件里存的):照英文名起,定了不改,和地貌在总表里的先后、编号无关。
 * 以后加一种地貌就在这里加一个键(单测查每种都有、不重复)
 */
const BIOME_KEY_LIST: readonly (readonly [Biome, string])[] = [
  [Biome.Ocean, 'ocean'],
  [Biome.Lake, 'lake'],
  [Biome.SeaIce, 'seaIce'],
  [Biome.Ice, 'ice'],
  [Biome.Tundra, 'tundra'],
  [Biome.Taiga, 'taiga'],
  [Biome.ColdDesert, 'coldDesert'],
  [Biome.TemperateDesert, 'temperateDesert'],
  [Biome.Steppe, 'steppe'],
  [Biome.TemperateForest, 'temperateForest'],
  [Biome.TemperateRainforest, 'temperateRainforest'],
  [Biome.HotDesert, 'hotDesert'],
  [Biome.Savanna, 'savanna'],
  [Biome.TropicalDryForest, 'tropicalDryForest'],
  [Biome.Rainforest, 'rainforest'],
  [Biome.Wetland, 'wetland'],
];
/** 各种地貌的键,照地貌总表的先后 */
export const BIOME_KEYS: readonly string[] = BIOMES.map((b) => BIOME_KEY_LIST.find(([id]) => id === b.id)?.[1] ?? '');
const biomeByKey = new Map(BIOME_KEY_LIST.map(([id, k]) => [k, id]));
const keyByBiome = new Map(BIOME_KEY_LIST.map(([id, k]) => [id, k]));
/** 一种地貌的键 */
export const biomeKey = (b: Biome): string => keyByBiome.get(b) ?? '';
/** 键 → 地貌(认不出 = undefined) */
export const biomeOfKey = (k: string): Biome | undefined => biomeByKey.get(k);

/** 一种地貌在这套规则里叫什么(没另起名字 = 官方的叫法) */
export function biomeName(r: Pick<RuleSet, 'biomes'> | null | undefined, b: Biome): string {
  return r?.biomes?.[biomeKey(b)] || BIOMES[b].name;
}

// ---------------------------------------------------------------------------
// 清理

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** 一段字:和署名一样清理(去掉看不见的字符、并掉多余的空白),最多 max 个字;cut = 超长截掉了 */
function cleanText(raw: unknown, max: number): { text: string; cut: boolean } {
  const full = cleanSignature(raw, Infinity);
  // 码位数不超过 max 的,看到的字数更不超过(多半是这样,不用再分一遍字)
  if ([...full].length <= max) return { text: full, cut: false };
  const text = cleanSignature(raw, max);
  return { text, cut: text !== full };
}

/** 第几版:正整数(带小数的取整),超出范围的拉回来;认不出 = undefined */
function cleanVersion(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  return Math.min(RULES_VERSION_MAX, Math.max(1, Math.round(raw)));
}

/** 基于谁太长:留最近的几层和最早的那一层 */
export function trimLineage(list: readonly RuleSource[]): RuleSource[] {
  return list.length <= RULES_LINEAGE_MAX ? list.slice() : [...list.slice(0, RULES_LINEAGE_MAX - 1), list[list.length - 1]];
}

/** 清理一层来源;名字认不出 = null(记一句) */
function cleanSource(raw: unknown, notes: string[]): RuleSource | null {
  if (!isObj(raw)) {
    notes.push('规则的出处里有一层认不出，略过');
    return null;
  }
  const name = cleanText(raw.name, RULES_NAME_MAX).text;
  if (!name) {
    notes.push('规则的出处里有一层没有名字，略过');
    return null;
  }
  const by = cleanSignature(raw.by, SIGNATURE_MAX);
  return { name, ...(by ? { by } : {}), version: cleanVersion(raw.version) ?? 1 };
}

/**
 * 清理读进来的一套规则(存档、分享链接、文件、本机存的):
 * - 不是一套规则的样子 = null(记一句);没有(undefined、null)= null,不记
 * - 名字、署名、介绍、地貌的叫法:去掉看不见的字符,超长的截断(记一句);名字没有的叫 UNNAMED_RULES
 * - 第几版:认不出的按第 1 版(记一句);基于谁:认不出的那一层去掉(记一句),太长的留最近几层和最早的那层
 * - 规则项交给 cleanTuning(认不出的编号丢掉、不在档位上的吸到最近一档、超出范围的拉回来,各记一句)
 * - 地貌:认不出的键去掉(记一句),和官方叫法一样的、空的不写
 * - 本机编号:不像的不要(不记:只是本机的记号)
 * 交出去的是新的一份(字段照固定的先后),传进来的不改
 */
export function cleanRuleSet(raw: unknown): { rules: RuleSet | null; notes: string[] } {
  const notes: string[] = [];
  if (raw === undefined || raw === null) return { rules: null, notes };
  if (!isObj(raw)) {
    notes.push('规则认不出，按官方规则算');
    return { rules: null, notes };
  }
  const name = cleanText(raw.name, RULES_NAME_MAX);
  if (name.cut) notes.push(`规则的名字太长，只留前 ${RULES_NAME_MAX} 个字`);
  else if (has(raw, 'name') && !name.text && typeof raw.name !== 'string') notes.push(`规则的名字认不出，叫它「${UNNAMED_RULES}」`);
  let version = cleanVersion(raw.version);
  if (version === undefined) {
    if (has(raw, 'version')) notes.push('规则是第几版认不出，按第 1 版算');
    version = 1;
  } else if (version !== raw.version) notes.push(`规则是第几版不对，按第 ${version} 版算`);
  const by = cleanText(raw.by, SIGNATURE_MAX);
  if (by.cut) notes.push(`规则的署名太长，只留前 ${SIGNATURE_MAX} 个字`);
  const about = cleanText(raw.about, RULES_ABOUT_MAX);
  if (about.cut) notes.push(`规则的介绍太长，只留前 ${RULES_ABOUT_MAX} 个字`);

  let basedOn: RuleSource[] = [];
  if (Array.isArray(raw.basedOn)) {
    for (const x of raw.basedOn) {
      const s = cleanSource(x, notes);
      if (s) basedOn.push(s);
    }
    basedOn = trimLineage(basedOn);
  } else if (raw.basedOn !== undefined) notes.push('规则的出处认不出，略过');

  const tuning = cleanTuning(raw.values);
  notes.push(...tuning.notes);

  const biomes: Record<string, string> = {};
  if (isObj(raw.biomes)) {
    for (const [k, v] of Object.entries(raw.biomes)) {
      const b = biomeOfKey(k);
      if (b === undefined) {
        notes.push(`「${k}」不是认得的地貌，略过`);
        continue;
      }
      const t = cleanText(v, BIOME_NAME_MAX);
      if (typeof v !== 'string') notes.push(`「${BIOMES[b].name}」的叫法认不出，照旧叫「${BIOMES[b].name}」`);
      else if (t.cut) notes.push(`「${BIOMES[b].name}」的叫法太长，只留前 ${BIOME_NAME_MAX} 个字`);
      if (t.text && t.text !== BIOMES[b].name) biomes[k] = t.text;
    }
  } else if (raw.biomes !== undefined) notes.push('地貌的叫法认不出，照旧用官方的叫法');

  const rules: RuleSet = {
    ...(typeof raw.id === 'string' && RULES_ID.test(raw.id) ? { id: raw.id } : {}),
    name: name.text || UNNAMED_RULES,
    version,
    ...(by.text ? { by: by.text } : {}),
    ...(about.text ? { about: about.text } : {}),
    ...(basedOn.length ? { basedOn } : {}),
    values: tuning.values,
    // 照地貌总表的先后排(同样的叫法写出来一样)
    ...(Object.keys(biomes).length ? { biomes: Object.fromEntries(BIOME_KEYS.filter((k) => k in biomes).map((k) => [k, biomes[k]])) } : {}),
  };
  return { rules, notes };
}

/** 和官方一样:没有,或者没改规则项、也没改地貌的叫法 */
export function isOfficialRules(r: RuleSet | Pick<RuleSet, 'values' | 'biomes'> | null | undefined): boolean {
  return !r || (!Object.keys(r.values ?? {}).length && !Object.keys(r.biomes ?? {}).length);
}

/** 世界里存的那一套:清理过;和官方一样 = undefined(存档里不写,和不用规则的世界一模一样) */
export function worldRules(raw: unknown): RuleSet | undefined {
  const r = cleanRuleSet(raw).rules;
  return r && !isOfficialRules(r) ? r : undefined;
}

/** 推演用的那部分:改过的规则项(清理过);一项也没改 = undefined(按官方推) */
export function ruleTuning(raw: unknown): TuningValues | undefined {
  const r = isObj(raw) ? cleanTuning(raw.values).values : undefined;
  return r && Object.keys(r).length ? r : undefined;
}

/** 两套规则一模一样(清理以后比;本机编号也算) */
export function sameRuleSet(a: unknown, b: unknown): boolean {
  return JSON.stringify(cleanRuleSet(a).rules) === JSON.stringify(cleanRuleSet(b).rules);
}

/** 两套规则的内容一样(名字、第几版、署名、介绍、基于谁、规则项、地貌的叫法;本机编号不算) */
export function sameRuleContent(a: RuleSet, b: RuleSet): boolean {
  const strip = (r: RuleSet) => {
    const { id: _id, ...rest } = cleanRuleSet(r).rules ?? r;
    return JSON.stringify(rest);
  };
  return strip(a) === strip(b);
}

// ---------------------------------------------------------------------------
// 新建、复制

/** 从官方规则开始的一套(没改任何项;基于官方规则) */
export function newRuleSet(name: string): RuleSet {
  return { name: cleanText(name, RULES_NAME_MAX).text || UNNAMED_RULES, version: 1, values: {} };
}

/**
 * 基于 src 的一套(复制一份、加进别人分享来的):规则项、地貌的叫法、介绍照搬;src 记在基于谁的最前面(连同它基于谁一路传下来);
 * 第几版从 1 起;署名空着(是自己的了);没有本机编号(存进「我的规则」时另起)。name 不给 = 和 src 同名
 */
export function deriveRuleSet(src: RuleSet, name?: string): RuleSet {
  const c = cleanRuleSet(src).rules ?? newRuleSet(src.name);
  const from: RuleSource = { name: c.name, ...(c.by ? { by: c.by } : {}), version: c.version };
  return {
    name: (name !== undefined && cleanText(name, RULES_NAME_MAX).text) || c.name,
    version: 1,
    ...(c.about ? { about: c.about } : {}),
    basedOn: trimLineage([from, ...(c.basedOn ?? [])]),
    values: { ...c.values },
    ...(c.biomes ? { biomes: { ...c.biomes } } : {}),
  };
}

// ---------------------------------------------------------------------------
// 写成字

/** 「战乱年代(第 2 版)」 */
export function ruleSetLabel(r: Pick<RuleSet, 'name' | 'version'>): string {
  return `${r.name}（第 ${r.version} 版）`;
}

/** 基于谁:「基于 砚山 的《群雄并起》」(没署名的「基于《群雄并起》」);没有 = 「基于官方规则」 */
export function basedOnText(r: Pick<RuleSet, 'basedOn'>): string {
  const s = r.basedOn?.[0];
  if (!s) return `基于${OFFICIAL_RULES_NAME}`;
  return s.by ? `基于 ${s.by} 的《${s.name}》` : `基于《${s.name}》`;
}

/**
 * 读进来的一套规则有几处提示,并成一句(读档提示条上一条):一处原样写,几处写「规则里有 N 处……」加上第一处
 */
export function ruleNotesLine(notes: readonly string[]): string | null {
  if (!notes.length) return null;
  if (notes.length === 1) return `规则：${notes[0]}`;
  return `规则里有 ${notes.length} 处读不懂或超出了现在的范围，已按能读的读（${notes[0]}……）`;
}

// ---------------------------------------------------------------------------
// 规则文件(ruleShare.ts 写、读;存档读到它时认出来)

/** 规则文件里写法版本的键(`"rules": 1`;和「我的世界」全部存成的文件的 `"bundle": 1` 一个写法) */
export const RULES_FILE_KEY = 'rules';
/** 当成世界存档打开了一个规则文件时说什么 */
export const RULES_FILE_ERROR = '这个文件是一套规则，不是世界的存档';
/** 看着像规则文件(有写法版本的键、没有种子和世界参数):读存档时认出来,不当坏了的存档 */
export function isRulesFileLike(raw: Record<string, unknown>): boolean {
  return raw[RULES_FILE_KEY] !== undefined && raw.seed === undefined && raw.params === undefined;
}
