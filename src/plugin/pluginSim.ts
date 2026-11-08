/**
 * 推演插件清单的 sim 段:和推演插件的设定(SimPlugin)一一对上,另加会下哪几种命令(commands)和新建世界时拨的滑条(params)。
 * 表、图层照推演引擎同一份核对。写错了抛 Error(读插件文件时算坏了)。纯计算。
 * 表的公式、先后要建一遍数表引擎才查得出,网页主线程不带数表引擎,在 pluginSimTables.ts 另查(推演线程装插件时、服务器)。
 * 两边都查过的 sim 段可以照原样交给推演:表上会让引擎少查几样的 builtin、fallback 这里就拦下了。
 * 读插件文件时只有推演插件才 import() 它。
 */
import { ANNAL_KINDS } from '../gen/civ/annals';
import { PLUGIN_LIMITS } from '../gen/civ/engine/plugin';
import { LAYER_LIMITS, LayerRun, type SimLayerSpec } from '../gen/civ/engine/pluginLayers';
import { FREQUENCIES, cardProblems, colCount, type TableCard } from '../gen/civ/engine/tables/cards';
import { OFFICIAL_NAMES, officialUnit, type OfficialName } from '../gen/civ/simOfficial';
import { checkLayerLook } from '../gen/layerLook';
import { SIM_COMMAND_TEXT, SIM_INFLUENCE_TEXT, simCommandsText } from './pluginCaps';

/** 新建世界时拨的一个滑条:插件里读 civAtlas.params.<名字> */
export interface SimParam {
  /** 滑条的名字 */
  label: string;
  min: number;
  max: number;
  default: number;
  step?: number;
}

export interface SimManifest {
  /** 每隔几年出手一次(FREQUENCIES 之一) */
  every?: number;
  tables?: TableCard[];
  /** 自己的输入表 → 官方表的稳定名字 */
  inputs?: Record<string, string>;
  /** 要听的史事种类 */
  listen?: string[];
  layers?: SimLayerSpec[];
  /** 交数给哪几个影响口 */
  influences?: string[];
  /** 会下哪几种命令;下了这里没写的算写错 */
  commands?: string[];
  params?: Record<string, SimParam>;
}

/** 一个推演插件最多几个滑条、滑条名字最长几个字 */
export const SIM_PARAMS_MAX = 8;
export const SIM_PARAM_LABEL_MAX = 12;

/** 这一版网站不认得的一样东西:什么(影响口、命令……)、叫什么 */
export interface SimNeed {
  what: string;
  name: string;
}

type Obj = Record<string, unknown>;

/** 和引擎里插件按国记表时补的那张州 → 国的编号表同名(插件自己的表不能叫它) */
export const OWNER_TABLE = '国';
const TABLE_ID_MAX = 64;
const NAME_MAX = 40;
const KEY = /^[a-z][a-z0-9.]{0,63}$/;
const PARAM_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
// eslint-disable-next-line no-control-regex
const BAD_TEXT = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/;

/** sim 段的哪一项要哪样能力(不看版本) */
export const SIM_SECTION_CAPS: readonly [keyof SimManifest, string][] = [
  ['every', 'sim.events'],
  ['listen', 'sim.read'],
  ['tables', 'sim.tables'],
  ['inputs', 'sim.tables'],
  ['layers', 'sim.tables'],
  ['influences', 'sim.influence'],
  ['commands', 'sim.commands'],
];

const fail = (message: string): never => {
  throw new Error(message);
};
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function obj(v: unknown, at: string): Obj {
  return isObj(v) ? v : fail(`${at} 不是对象`);
}
function list(v: unknown, at: string, max: number): unknown[] {
  if (!Array.isArray(v)) return fail(`${at} 不是列表`);
  return v.length > max ? fail(`${at} 最多 ${max} 项`) : v;
}
function num(v: unknown, at: string): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fail(`${at} 要是数`);
}
function bool(v: unknown, at: string): boolean {
  return typeof v === 'boolean' ? v : fail(`${at} 要是 true 或 false`);
}
function str(v: unknown, at: string, max = TABLE_ID_MAX): string {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : fail(`${at} 要写 1 到 ${max} 个字`);
}
function line(v: unknown, at: string, max: number): string {
  if (typeof v !== 'string' || !v.trim()) return fail(`${at} 不能空着`);
  if (v.length > max) fail(`${at} 太长`);
  return BAD_TEXT.test(v) ? fail(`${at} 里有不许用的字符`) : v;
}
function strings(v: unknown, at: string, max: number): string[] {
  return list(v, at, max).map((x, i) => str(x, `${at}[${i}]`));
}
/** 一串名字:不重复、合 KEY 的写法 */
function names(v: unknown, at: string, max: number): string[] {
  const out = list(v, at, max).map((x, i) => (typeof x === 'string' && KEY.test(x) ? x : fail(`${at}[${i}] 不合规矩`)));
  const dup = out.find((x, i) => out.indexOf(x) !== i);
  return dup === undefined ? out : fail(`${at} 里 ${dup} 写了两遍`);
}
/** 一条公式,或每栏一条 */
function rule(v: unknown, at: string): string | Record<string, string> {
  if (typeof v === 'string') return v;
  const o = obj(v, at);
  for (const k of Object.keys(o)) if (typeof o[k] !== 'string') fail(`${at}.${k} 要是公式`);
  return o as Record<string, string>;
}

/** 一张表的登记卡:只留引擎认的字段,类型先查好(值对不对交给引擎) */
function cardOf(raw: unknown, at: string): TableCard {
  const c = obj(raw, at);
  for (const k of ['builtin', 'fallback']) if (c[k] !== undefined) fail(`${at} 不能写 ${k}`);
  const id = str(c.id, `${at}.id`);
  if (id === OWNER_TABLE) fail(`${at}.id 不能叫 ${OWNER_TABLE}`);
  const unit = c.unit;
  if (unit === 'tile') fail(`${at} 不能按地块记`);
  if (unit !== 'region' && unit !== 'polity' && unit !== 'world') return fail(`${at}.unit 只能是 region、polity、world`);
  const card: TableCard = { id, name: line(c.name, `${at}.name`, NAME_MAX), unit, min: num(c.min, `${at}.min`), max: num(c.max, `${at}.max`), off: num(c.off, `${at}.off`) };
  if (c.cols !== undefined) card.cols = strings(c.cols, `${at}.cols`, PLUGIN_LIMITS.cols);
  if (c.kind !== undefined) card.kind = c.kind === 'num' || c.kind === 'id' ? c.kind : fail(`${at}.kind 只能是 num、id`);
  if (c.input !== undefined) card.input = bool(c.input, `${at}.input`);
  if (c.every !== undefined) card.every = num(c.every, `${at}.every`);
  if (c.maxRate !== undefined) card.maxRate = num(c.maxRate, `${at}.maxRate`);
  if (c.init !== undefined) card.init = typeof c.init === 'string' ? c.init : num(c.init, `${at}.init`);
  if (c.rule !== undefined) card.rule = rule(c.rule, `${at}.rule`);
  if (c.rate !== undefined) card.rate = rule(c.rate, `${at}.rate`);
  if (c.move !== undefined) card.move = typeof c.move === 'string' ? c.move : fail(`${at}.move 要是公式`);
  if (c.flowEvery !== undefined) card.flowEvery = num(c.flowEvery, `${at}.flowEvery`);
  if (c.consts !== undefined) {
    const o = obj(c.consts, `${at}.consts`);
    const consts: Record<string, number | number[]> = {};
    for (const k of Object.keys(o)) consts[k] = Array.isArray(o[k]) ? (o[k] as unknown[]).map((x, i) => num(x, `${at}.consts.${k}[${i}]`)) : num(o[k], `${at}.consts.${k}`);
    card.consts = consts;
  }
  if (c.reads !== undefined) card.reads = strings(c.reads, `${at}.reads`, PLUGIN_LIMITS.tables + 1);
  if (c.after !== undefined) card.after = strings(c.after, `${at}.after`, PLUGIN_LIMITS.tables);
  if (c.zeroStays !== undefined) card.zeroStays = bool(c.zeroStays, `${at}.zeroStays`);
  return card;
}

/** 表:个数、栏数照插件的上限,卡照数表引擎同一份查;公式、先后要建一遍数表引擎,在 pluginSimTables.ts 查 */
function checkTables(raw: unknown): Map<string, TableCard> {
  const cards = list(raw, '清单的 sim.tables', PLUGIN_LIMITS.tables).map((c, i) => cardOf(c, `清单的 sim.tables[${i}]`));
  const cols = cards.reduce((n, c) => n + colCount(c), 0);
  if (cols > PLUGIN_LIMITS.cols) fail(`清单的 sim.tables 所有表加起来最多 ${PLUGIN_LIMITS.cols} 栏`);
  const problems = cards.flatMap((c) => cardProblems(c));
  const dup = cards.find((c, i) => cards.findIndex((d) => d.id === c.id) !== i);
  if (dup) problems.push(`有两张表都叫 ${dup.id}`);
  if (problems.length) fail(`清单的 sim.tables:${problems.join(';')}`);
  return new Map(cards.map((c) => [c.id, c]));
}

function checkLayers(raw: unknown, cards: ReadonlyMap<string, TableCard>): void {
  const ids = new Set<string>();
  list(raw, '清单的 sim.layers', LAYER_LIMITS.layers).forEach((x, i) => {
    const at = `清单的 sim.layers[${i}]`;
    const spec = obj(x, at);
    const id = str(spec.id, `${at}.id`);
    if (ids.has(id)) fail(`${at}:图层 ${id} 写了两次`);
    ids.add(id);
    const table = str(spec.table, `${at}.table`);
    if (spec.col !== undefined) str(spec.col, `${at}.col`);
    num(spec.keep, `${at}.keep`);
    try {
      new LayerRun(spec as unknown as SimLayerSpec, cards.get(table), 1, checkLayerLook);
    } catch (e) {
      fail(`${at}:${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

function checkParams(raw: unknown): void {
  const p = obj(raw, '清单的 sim.params');
  const keys = Object.keys(p);
  if (keys.length > SIM_PARAMS_MAX) fail(`清单的 sim.params 最多 ${SIM_PARAMS_MAX} 个`);
  for (const k of keys) {
    if (!PARAM_KEY.test(k)) fail(`清单的 sim.params 里的 ${k.slice(0, 40)} 只能用字母、数字和下划线,不以数字开头,最长 32 个字`);
    const at = `清单的 sim.params.${k}`;
    const q = obj(p[k], at);
    line(q.label, `${at}.label`, SIM_PARAM_LABEL_MAX);
    const min = num(q.min, `${at}.min`);
    const max = num(q.max, `${at}.max`);
    const def = num(q.default, `${at}.default`);
    if (!(min < max)) fail(`${at}.min 要小于 max`);
    if (def < min || def > max) fail(`${at}.default 要在 min 和 max 之间`);
    if (q.step !== undefined) {
      const step = num(q.step, `${at}.step`);
      if (!(step > 0 && step <= max - min)) fail(`${at}.step 要大于 0、不超过 max − min`);
    }
  }
}

const present = (s: Obj, k: string): boolean => (k === 'every' ? s.every !== undefined : Array.isArray(s[k]) ? (s[k] as unknown[]).length > 0 : isObj(s[k]) && Object.keys(s[k] as Obj).length > 0);
const capName = (cap: string) => cap.split('@')[0];

/**
 * 查推演插件的清单(role 是 sim 的):sim 段每一项、和 requires 对不对得上。写错了抛 Error;
 * 返回这一版网站不认得的头一样(影响口、命令、史事、官方表的名字),都认得 = null
 */
export function checkSimManifest(m: { sim?: unknown; requires: readonly string[] }): SimNeed | null {
  const s = obj(m.sim, '清单的 sim');
  let need: SimNeed | null = null;
  const unknown = (what: string, name: string) => void (need ??= { what, name });

  if (s.every !== undefined && !FREQUENCIES.includes(num(s.every, '清单的 sim.every'))) fail(`清单的 sim.every 只能从 ${FREQUENCIES.join('、')} 年里挑`);
  const cards = s.tables === undefined ? new Map<string, TableCard>() : checkTables(s.tables);
  if (s.inputs !== undefined) {
    const inputs = obj(s.inputs, '清单的 sim.inputs');
    for (const t of Object.keys(inputs)) {
      const c = cards.get(t);
      if (!c || !c.input || colCount(c) !== 1) fail(`清单的 sim.inputs:接官方表的 ${t.slice(0, 64)} 要是自己的一栏的输入表`);
      const name = inputs[t];
      if (typeof name !== 'string' || !KEY.test(name)) fail(`清单的 sim.inputs.${t} 不合规矩`);
      if (!OFFICIAL_NAMES.includes(name as OfficialName)) unknown('官方表', name as string);
      else if (officialUnit(name as OfficialName) !== c!.unit) fail(`清单的 sim.inputs:${t} 和官方表 ${name} 的单位不一样`);
    }
  }
  if (s.listen !== undefined) for (const k of names(s.listen, '清单的 sim.listen', PLUGIN_LIMITS.listen)) if (!has(ANNAL_KINDS, k)) unknown('史事种类', k);
  if (s.layers !== undefined) checkLayers(s.layers, cards);
  if (s.influences !== undefined) for (const k of names(s.influences, '清单的 sim.influences', 32)) if (!has(SIM_INFLUENCE_TEXT, k)) unknown('影响口', k);
  if (s.commands !== undefined) for (const k of names(s.commands, '清单的 sim.commands', 32)) if (!has(SIM_COMMAND_TEXT, k)) unknown('命令', k);
  if (s.params !== undefined) checkParams(s.params);

  const wanted = new Set(m.requires.map(capName));
  for (const [key, cap] of SIM_SECTION_CAPS) if (present(s, key) && !wanted.has(cap)) fail(`清单的 sim.${key} 要在 requires 里写上 ${cap}@1`);
  if (wanted.has('sim.commands') && !present(s, 'commands')) fail('清单要了 sim.commands@1,要在 sim.commands 里写会下哪几种命令');
  return need;
}

/** requires 里要了、sim 段里看得出用不上的能力(只看得出表和影响口;读口、约事、编年史、小本子在代码里用) */
export function simCapsUnused(m: { sim?: SimManifest; requires: readonly string[] }): string[] {
  const s = (m.sim ?? {}) as Obj;
  const unused: string[] = [];
  for (const cap of m.requires) {
    const name = capName(cap);
    if (name !== 'sim.tables' && name !== 'sim.influence') continue;
    if (!SIM_SECTION_CAPS.some(([key, c]) => c === name && present(s, key))) unused.push(cap);
  }
  return unused;
}

/** 插件回话里的命令有没有清单 sim.commands 没写的种类:有 = 说清第几条的一句话,没有 = null(种类本身写错的交给收命令的那一口) */
export function undeclaredCommand(declared: readonly string[] | undefined, commands: readonly unknown[]): string | null {
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    const kind = isObj(c) ? c.kind : undefined;
    if (typeof kind !== 'string' || !has(SIM_COMMAND_TEXT, kind) || declared?.includes(kind)) continue;
    return `第 ${i} 条命令是「${simCommandsText([kind])}」(${kind}),清单的 sim.commands 里没写`;
  }
  return null;
}
