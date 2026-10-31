/**
 * 一套规则(ruleSet.ts)做成分享链接、存成文件,和从链接、文件读回来。纯计算:不碰 DOM、不读浏览器存储,Node 里可测。
 *
 * **分享链接**(和新建世界的预设链接一个写法,数全在链接里、不经服务器):
 *
 *   https://…/#rules=1&name=战乱年代&v=2&by=明月&about=…&base1=群雄并起&base1.by=砚山&base1.v=1&war.odds=2&war.length=3-20&war.crush=never&biome.temperateDesert=灰烬荒原
 *
 * - 放在 # 后面:浏览器不发给服务器,只在打开链接的人自己的页面里读
 * - rules=1:写法的版本。以后有不兼容的改动加一;读到比自己新的不读,提示刷新页面
 * - name、v(第几版)、by(署名)、about(介绍):没有的不写(v 总写)
 * - base1、base1.by、base1.v,base2……:基于谁,最近的是 base1
 * - 规则项:键就是规则项的编号(tuning.ts),只写改过的;倍数、数值写数,区间写成「前-后」(3-20),永不 / 关写 never / off
 * - biome.<地貌的键>:地貌的叫法
 * - 本机编号不写(打开的人加进自己的「我的规则」时另起一个)
 * - 中文按网址的规矩转义(URLSearchParams);聊天软件折了行的(多出来的空白)也认。读回来过 cleanRuleSet,有不对的附提示
 *
 * **文件**(.json;世界的存档本来就带着规则,不用另存):
 *
 * ```json
 * { "app": "文明与地图", "rules": 1, "savedAt": "2026-10-31T08:00:00.000Z",
 *   "name": "战乱年代", "version": 2, "by": "明月", "values": { "war.odds": 2 }, "biomes": { "temperateDesert": "灰烬荒原" } }
 * ```
 * rules = 这种文件的写法版本(和「全部存成文件」的 "bundle": 1 一个写法;比自己新的不读,提示刷新页面),其余就是一套规则(ruleSet.ts 的字段,不带本机编号)
 */
import { SAVE_APP } from '../savefile';
import { BIOME_KEYS, RULES_FILE_KEY, cleanRuleSet, type RuleSet } from './ruleSet';
import { TUNING_ITEMS, tuningItem, type TuningValue } from './tuning';

export type RulesReadResult = { ok: true; rules: RuleSet; warnings: string[] } | { ok: false; error: string };

/** 读回来的一套不带本机编号 */
function withoutId(r: RuleSet): RuleSet {
  const { id: _id, ...rest } = r;
  return rest;
}

// ---------------------------------------------------------------------------
// 分享链接

/** # 后面的键:#rules=… */
export const RULES_HASH_KEY = 'rules';
/** 写法的版本 */
export const RULES_LINK_FORMAT = 1;
/** # 后面最多多少字(70 项全改、16 种地貌都改名、名字介绍署名基于谁都写满也在这以内,见单测) */
const RULES_HASH_MAX = 16384;
/** 地貌叫法的键前缀 */
const BIOME_PREFIX = 'biome.';

export const RULES_LINK_BROKEN = '规则链接不完整或被改动过(可能复制时少了一截),请让对方重新复制一次链接';
const RULES_LINK_EMPTY = '链接里没有规则';

/** 网址的 # 那段是不是规则链接(#rules=…) */
export function isRulesHash(hash: string): boolean {
  return typeof hash === 'string' && new RegExp(`^#?\\s*${RULES_HASH_KEY}=`).test(hash.trim());
}

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

/** 一套规则 → 网址的 # 那段(`#rules=1&name=…`,接在网站地址后面就是分享链接);先清理,本机编号不写 */
export function rulesHash(raw: RuleSet): string {
  const r = cleanRuleSet(raw).rules ?? cleanRuleSet({}).rules!;
  const q = new URLSearchParams();
  q.set(RULES_HASH_KEY, String(RULES_LINK_FORMAT));
  q.set('name', r.name);
  q.set('v', String(r.version));
  if (r.by) q.set('by', r.by);
  if (r.about) q.set('about', r.about);
  (r.basedOn ?? []).forEach((s, i) => {
    q.set(`base${i + 1}`, s.name);
    if (s.by) q.set(`base${i + 1}.by`, s.by);
    q.set(`base${i + 1}.v`, String(s.version));
  });
  for (const x of TUNING_ITEMS) if (x.id in r.values) q.set(x.id, valueText(r.values[x.id]));
  for (const k of BIOME_KEYS) if (r.biomes?.[k]) q.set(`${BIOME_PREFIX}${k}`, r.biomes[k]);
  return `#${q.toString()}`;
}

/**
 * 网址的 # 那段(`#rules=…`,也认不带 # 的)→ 一套规则。不是规则链接、坏了、来自更新的版本给中文错误;
 * 个别项不对(认不出的编号、超出范围的值、太长的名字……)照样读,附提示
 */
export function decodeRulesHash(hash: string): RulesReadResult {
  if (typeof hash !== 'string' || !isRulesHash(hash)) return { ok: false, error: RULES_LINK_EMPTY };
  // 聊天软件折过行:去掉所有空白(名字里的空格已经转义成 + 或 %20)
  const s = hash.trim().replace(/^#/, '').replace(/\s+/g, '');
  if (s.length > RULES_HASH_MAX) return { ok: false, error: '链接太长,不像「文明与地图」的规则链接' };
  let q: URLSearchParams;
  try {
    // 先试一遍转义写得对不对(URLSearchParams 遇到坏的 % 不报错,会原样留着)
    decodeURIComponent(s.replace(/\+/g, ' '));
    q = new URLSearchParams(s);
  } catch {
    return { ok: false, error: RULES_LINK_BROKEN };
  }
  const fv = q.get(RULES_HASH_KEY) ?? '';
  if (!/^\d{1,4}$/.test(fv) || Number(fv) < 1) return { ok: false, error: RULES_LINK_BROKEN };
  if (Number(fv) > RULES_LINK_FORMAT) return { ok: false, error: '这个规则链接来自更新版本的「文明与地图」,请刷新页面换到最新版再打开' };

  const raw: Record<string, unknown> = {};
  const name = q.get('name');
  if (name !== null) raw.name = name;
  const v = q.get('v');
  if (v !== null) raw.version = v.trim() === '' ? NaN : Number(v);
  const by = q.get('by');
  if (by !== null) raw.by = by;
  const about = q.get('about');
  if (about !== null) raw.about = about;
  const basedOn: Record<string, unknown>[] = [];
  const values: Record<string, unknown> = {};
  const biomes: Record<string, string> = {};
  for (const [k, val] of q) {
    const b = /^base(\d{1,2})(?:\.(by|v))?$/.exec(k);
    if (b) {
      const i = Number(b[1]) - 1;
      if (i < 0 || i >= 32) continue;
      const s = (basedOn[i] ??= {});
      if (b[2] === 'by') s.by = val;
      else if (b[2] === 'v') s.version = val.trim() === '' ? NaN : Number(val);
      else s.name = val;
    } else if (k.startsWith(BIOME_PREFIX)) biomes[k.slice(BIOME_PREFIX.length)] = val;
    // 带点的是规则项的编号(认不出的由 cleanTuning 说一句);别的键(以后加的写法)不管
    else if (k.includes('.') || tuningItem(k)) values[k] = valueOf(val);
  }
  // 编号跳着写的(base1、base3)按先后挤在一起
  const list = basedOn.filter((x) => x !== undefined);
  if (list.length) raw.basedOn = list;
  raw.values = values;
  if (Object.keys(biomes).length) raw.biomes = biomes;
  const c = cleanRuleSet(raw);
  return { ok: true, rules: withoutId(c.rules!), warnings: c.notes };
}

// ---------------------------------------------------------------------------
// 文件

/** 文件的写法版本 */
export const RULES_FILE_FORMAT = 1;
/** 文件最大多少字节(再大就不像规则文件了) */
const RULES_FILE_MAX = 1024 * 1024;

/** 一套规则 → 文件内容(缩进两格,人也能读);先清理,本机编号不写 */
export function rulesFileText(raw: RuleSet, savedAt = new Date().toISOString()): string {
  const r = withoutId(cleanRuleSet(raw).rules ?? cleanRuleSet({}).rules!);
  return JSON.stringify({ app: SAVE_APP, [RULES_FILE_KEY]: RULES_FILE_FORMAT, savedAt, ...r }, null, 2) + '\n';
}

/** 下载用的文件名:文明与地图-规则-战乱年代.json */
export function rulesFileName(r: Pick<RuleSet, 'name'>): string {
  // eslint-disable-next-line no-control-regex
  const t = (cleanRuleSet({ name: r.name }).rules?.name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/^\.+/, '').trim();
  return `${SAVE_APP}-规则-${t || '未命名'}.json`;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * 读规则文件:文件内容 → 一套规则。读不了(不是 JSON、不是本应用的规则文件、写法比自己新)给中文错误;
 * 个别项不对照样读,附提示
 */
export function parseRulesFile(text: string): RulesReadResult {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: '文件是空的' };
  if (text.length > RULES_FILE_MAX) return { ok: false, error: '文件太大,不像「文明与地图」的规则文件' };
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return { ok: false, error: '读不懂这个文件:它不是「文明与地图」的规则文件(.json)' };
  }
  if (!isObj(raw) || raw.app !== SAVE_APP) return { ok: false, error: '这不是「文明与地图」的规则文件' };
  const f = raw[RULES_FILE_KEY];
  if (f === undefined) return { ok: false, error: raw.seed !== undefined || raw.params !== undefined ? '这个文件是世界的存档,不是一套规则' : '这不是「文明与地图」的规则文件' };
  if (typeof f !== 'number' || !Number.isInteger(f) || f < 1) return { ok: false, error: '规则文件坏了:缺少格式版本' };
  if (f > RULES_FILE_FORMAT) return { ok: false, error: '这个规则文件来自更新版本的「文明与地图」,请刷新页面换到最新版再打开' };
  const { app: _app, [RULES_FILE_KEY]: _f, savedAt: _at, id: _id, ...rest } = raw;
  const c = cleanRuleSet(rest);
  return { ok: true, rules: withoutId(c.rules!), warnings: c.notes };
}
