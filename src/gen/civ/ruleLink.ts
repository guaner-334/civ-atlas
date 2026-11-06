/**
 * 一套规则和网址查询串互转:规则链接(ruleShare.ts)和带规则的预设链接(ui/presetLink.ts)共用这一段。纯计算,Node 里可测。
 *
 * meta 是名字、第几版、署名、介绍、出处这几个键的前缀:规则链接是 ''(name、v、by、about、base1、base1.by、base1.v),
 * 预设链接是 'rules.'(name 已经是预设名)。规则项(键就是编号,都带点)和 biome.<地貌的键> 不带前缀。
 * 写法见 ruleShare.ts 文件头。
 */
import { BIOME_KEYS, cleanRuleSet, type RuleSet } from './ruleSet';
import { TUNING_ITEMS, tuningItem, type TuningValue } from './tuning';

/** 规则那一段最多多少字(70 项全改、16 种地貌都改名、名字介绍署名基于谁都写满也在这以内,见单测) */
export const RULES_HASH_MAX = 16384;
/** 地貌叫法的键前缀 */
const BIOME_PREFIX = 'biome.';

/** 一项的值写成链接里的字:数原样,区间「前-后」,永不 / 关原样 */
function valueText(v: TuningValue): string {
  return Array.isArray(v) ? `${v[0]}-${v[1]}` : String(v);
}

/** 链接里的字 → 一项的值(认不出的交给 cleanTuning 去说) */
function valueOf(s: string): unknown {
  if (s === 'never' || s === 'off') return s;
  const m = /^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/.exec(s);
  if (m) return [Number(m[1]), Number(m[2])];
  return s.trim() === '' ? NaN : Number(s);
}

/** 一套规则写进 q(先清理;本机编号、换算版本不写) */
export function writeRuleParams(q: URLSearchParams, raw: RuleSet, meta = ''): void {
  const r = cleanRuleSet(raw).rules ?? cleanRuleSet({}).rules!;
  q.set(`${meta}name`, r.name);
  q.set(`${meta}v`, String(r.version));
  if (r.by) q.set(`${meta}by`, r.by);
  if (r.about) q.set(`${meta}about`, r.about);
  (r.basedOn ?? []).forEach((s, i) => {
    q.set(`${meta}base${i + 1}`, s.name);
    if (s.by) q.set(`${meta}base${i + 1}.by`, s.by);
    q.set(`${meta}base${i + 1}.v`, String(s.version));
  });
  for (const x of TUNING_ITEMS) if (x.id in r.values) q.set(x.id, valueText(r.values[x.id]));
  for (const k of BIOME_KEYS) if (r.biomes?.[k]) q.set(`${BIOME_PREFIX}${k}`, r.biomes[k]);
}

/** 从 q 读回一套规则(清理过,不带本机编号);个别项不对照样读,notes 是提示 */
export function readRuleParams(q: URLSearchParams, meta = ''): { rules: RuleSet; notes: string[] } {
  const raw: Record<string, unknown> = {};
  const name = q.get(`${meta}name`);
  if (name !== null) raw.name = name;
  const v = q.get(`${meta}v`);
  if (v !== null) raw.version = v.trim() === '' ? NaN : Number(v);
  const by = q.get(`${meta}by`);
  if (by !== null) raw.by = by;
  const about = q.get(`${meta}about`);
  if (about !== null) raw.about = about;
  const basedOn: Record<string, unknown>[] = [];
  const values: Record<string, unknown> = {};
  const biomes: Record<string, string> = {};
  for (const [key, val] of q) {
    if (meta && key.startsWith(meta)) {
      const b = /^base(\d{1,2})(?:\.(by|v))?$/.exec(key.slice(meta.length));
      if (b) addBase(basedOn, b, val);
      continue;
    }
    const b = meta ? null : /^base(\d{1,2})(?:\.(by|v))?$/.exec(key);
    if (b) addBase(basedOn, b, val);
    else if (key.startsWith(BIOME_PREFIX)) biomes[key.slice(BIOME_PREFIX.length)] = val;
    // 带点的是规则项的编号(认不出的由 cleanTuning 说一句);别的键(预设的参数、以后加的写法)不管
    else if (key.includes('.') || tuningItem(key)) values[key] = valueOf(val);
  }
  // 编号跳着写的(base1、base3)按先后挤在一起
  const list = basedOn.filter((x) => x !== undefined);
  if (list.length) raw.basedOn = list;
  raw.values = values;
  if (Object.keys(biomes).length) raw.biomes = biomes;
  const c = cleanRuleSet(raw);
  const { id: _id, ...rules } = c.rules!;
  return { rules, notes: c.notes };
}

function addBase(list: Record<string, unknown>[], b: RegExpExecArray, val: string) {
  const i = Number(b[1]) - 1;
  if (i < 0 || i >= 32) return;
  const s = (list[i] ??= {});
  if (b[2] === 'by') s.by = val;
  else if (b[2] === 'v') s.version = val.trim() === '' ? NaN : Number(val);
  else s.name = val;
}
