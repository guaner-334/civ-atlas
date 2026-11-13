/**
 * 插件用了哪些实验档的接口、哪些已经被拿掉的接口(各登记表的档在 pluginCaps.ts)。纯计算,网页、Worker、服务器、打包共用。
 */
import { CAP_TIER, MAP_HELPER_TIER, MAP_STAGE_TIER, SIM_COMMAND_TIER, SIM_INFLUENCE_TIER, type TierNote } from './pluginCaps';

export type ExperimentalWhat = '能力' | '影响口' | '命令' | '生成的一步' | '帮手';

/** 用到的一样实验接口:什么、叫什么 */
export interface ExperimentalUse {
  what: ExperimentalWhat;
  name: string;
}

/** 用到的一样已经拿掉的实验接口;removed = 哪一版网站拿掉的 */
export interface RemovedUse extends ExperimentalUse {
  removed: string;
}

/** 看的是清单里这几项(读进来的清单,或打包前作者写的) */
export interface ExperimentalSource {
  role?: string;
  requires?: readonly string[];
  optional?: readonly string[];
  sim?: { influences?: readonly string[]; commands?: readonly string[] };
  map?: { stages?: readonly string[] };
}

type Tiers = Readonly<Record<string, TierNote | undefined>>;

const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const noteOf = (tiers: Tiers, name: string): TierNote | undefined => (Object.prototype.hasOwnProperty.call(tiers, name) ? tiers[name] : undefined);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 代码里有这个名字(前后不连着字母、数字、_、$):d.xxx、d['xxx']、解构出来的都算,注释里写到也算 */
const mentions = (code: string, name: string): boolean => new RegExp(`(?:^|[^\\w$])${escape(name)}(?![\\w$])`).test(code);

/** 清单和代码里提到的每一样,和它的档 */
function notes(m: ExperimentalSource, code: string | undefined): { what: ExperimentalWhat; name: string; note: TierNote }[] {
  const out: { what: ExperimentalWhat; name: string; note: TierNote }[] = [];
  const add = (what: ExperimentalWhat, tiers: Tiers, list: readonly string[]) => {
    for (const name of list) {
      const note = noteOf(tiers, name);
      if (note) out.push({ what, name, note });
    }
  };
  add('能力', CAP_TIER, [...names(m.requires), ...names(m.optional)]);
  add('影响口', SIM_INFLUENCE_TIER, names(m.sim?.influences));
  add('命令', SIM_COMMAND_TIER, names(m.sim?.commands));
  add('生成的一步', MAP_STAGE_TIER, names(m.map?.stages));
  if (m.role === 'map' && code !== undefined) add('帮手', MAP_HELPER_TIER, Object.keys(MAP_HELPER_TIER).filter((name) => mentions(code, name)));
  return out;
}

/**
 * 清单和代码里用到的、这一版网站还有的实验接口:按能力、影响口、命令、生成的一步、帮手排,同一种照清单里的先后(帮手照档表的先后)。
 * 帮手是地图插件代码里调的,只在 role 是 map、给了 code 时看
 */
export function experimentalUses(m: ExperimentalSource, code?: string): ExperimentalUse[] {
  return notes(m, code).flatMap(({ what, name, note }) => (note.tier === 'experimental' && note.removed === undefined ? [{ what, name }] : []));
}

/** 用到的、网站已经拿掉的接口(插件开不了时,和「网站太旧、还没有」分开说);排法同 experimentalUses。optional 里的能力拿掉了照样能开,不算 */
export function removedUses(m: ExperimentalSource, code?: string): RemovedUse[] {
  const optional = new Set(names(m.optional));
  return notes(m, code).flatMap(({ what, name, note }) => (note.removed !== undefined && !(what === '能力' && optional.has(name)) ? [{ what, name, removed: note.removed }] : []));
}

/** 新版比旧版多用的实验接口 */
export function addedExperimental(old: readonly ExperimentalUse[], next: readonly ExperimentalUse[]): ExperimentalUse[] {
  return next.filter((u) => !old.some((o) => o.what === u.what && o.name === u.name));
}
