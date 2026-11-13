/**
 * 插件用了哪些实验档的接口(各登记表的档在 pluginCaps.ts)。纯计算,网页、Worker、服务器、打包共用。
 */
import { CAP_TIER, MAP_HELPER_TIER, MAP_STAGE_TIER, SIM_COMMAND_TIER, SIM_INFLUENCE_TIER, type ApiTier } from './pluginCaps';

export type ExperimentalWhat = '能力' | '影响口' | '命令' | '生成的一步' | '帮手';

/** 用到的一样实验接口:什么、叫什么 */
export interface ExperimentalUse {
  what: ExperimentalWhat;
  name: string;
}

/** 看的是清单里这几项(读进来的清单,或打包前作者写的) */
export interface ExperimentalSource {
  role?: string;
  requires?: readonly string[];
  optional?: readonly string[];
  sim?: { influences?: readonly string[]; commands?: readonly string[] };
  map?: { stages?: readonly string[] };
}

const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const isExperimental = (tiers: Readonly<Record<string, ApiTier | undefined>>, name: string): boolean =>
  Object.prototype.hasOwnProperty.call(tiers, name) && tiers[name] === 'experimental';
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 代码里有这个名字(前后不连着字母、数字、_、$):d.xxx、d['xxx']、解构出来的都算,注释里写到也算 */
const mentions = (code: string, name: string): boolean => new RegExp(`(?:^|[^\\w$])${escape(name)}(?![\\w$])`).test(code);

/**
 * 清单和代码里用到的实验接口:按能力、影响口、命令、生成的一步、帮手排,同一种照清单里的先后(帮手照档表的先后)。
 * 帮手是地图插件代码里调的,只在 role 是 map、给了 code 时看
 */
export function experimentalUses(m: ExperimentalSource, code?: string): ExperimentalUse[] {
  const out: ExperimentalUse[] = [];
  const add = (what: ExperimentalWhat, tiers: Readonly<Record<string, ApiTier | undefined>>, list: readonly string[]) => {
    for (const name of list) if (isExperimental(tiers, name)) out.push({ what, name });
  };
  add('能力', CAP_TIER, [...names(m.requires), ...names(m.optional)]);
  add('影响口', SIM_INFLUENCE_TIER, names(m.sim?.influences));
  add('命令', SIM_COMMAND_TIER, names(m.sim?.commands));
  add('生成的一步', MAP_STAGE_TIER, names(m.map?.stages));
  if (m.role === 'map' && code !== undefined) {
    const helpers: Readonly<Record<string, ApiTier | undefined>> = MAP_HELPER_TIER;
    add('帮手', helpers, Object.keys(helpers).filter((name) => mentions(code, name)));
  }
  return out;
}

/** 新版比旧版多用的实验接口 */
export function addedExperimental(old: readonly ExperimentalUse[], next: readonly ExperimentalUse[]): ExperimentalUse[] {
  return next.filter((u) => !old.some((o) => o.what === u.what && o.name === u.name));
}
