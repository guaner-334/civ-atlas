/**
 * 推演插件接口第 1 版(sim.*@1):插件只照这里的类型写。名字、单位、上下限给出去就是承诺:加可选字段不升版,意思变了出 @2,@1 至少留 12 个月。
 * 插件只在「插件那一刻」整批出手(每隔几年、自己约的时刻、第 0 年开头),官方的决策点不等插件,只查影响口里交好的数。
 * 已知的边界:两国之间的宣战、结盟没有影响口(按国的 war.odds 乘在挑好了打谁以后,只能折成一国一个数;要指名两国就下命令);
 * 插件下过命令的历史,接着推时作者新加了干预就从第 0 年重推(结果一样,只是不省时间);插件下的灭国排在作者的干预后面,作者的「不许灭」挡不住它。
 */
import type { DisasterLevel, TrekDir, TrekReach } from '../edits';
import { OFFICIAL_INFLUENCES } from './influence';
import { SIM_READ } from './simRead';

export type { PluginAnnal, PluginEvent, PluginNote, PluginReply, PluginTurn, SimLayerSpec, SimPlugin, PluginChronicle } from './engine/plugin';
export { PLUGIN_LIMITS, PLUGIN_TIME } from './engine/plugin';
export type { TableCard } from './engine/tables';
export { FREQUENCIES } from './engine/tables';
export { CHRONICLE_LIMITS } from './engine/pluginChronicle';
export { LAYER_LIMITS } from './engine/pluginLayers';
export { COMMAND_KINDS, COMMANDS_MAX } from './commands';
export { OFFICIAL_INFLUENCES } from './influence';
export type { OfficialName, SimAnnal, SimCulture, SimFaith, SimOwnerField, SimPolity, SimRead, SimRegions, SimSettlement } from './simRead';
export { OFFICIAL_NAMES } from './simRead';

/** 插件清单 api 写的版本 */
export const SIM_API = 1;

/**
 * 推演插件能要的能力 → 用得上接口的哪几样;steer = 会改推演怎么走(权限框上显眼的那一行)。
 * 还没进 PLUGIN_CAPS:那张表是「这一版网站跑得了的」,网站能跑推演插件(清单 role 认 sim)那天连同权限框的两行一起加
 */
export const SIM_CAPS = {
  [SIM_READ]: { parts: ['turn.read', 'turn.heard', 'listen'], steer: false },
  'sim.tables@1': { parts: ['tables', 'inputs', 'layers', 'turn.table', 'reply.tables'], steer: false },
  'sim.events@1': { parts: ['every', 'turn.events', 'reply.at'], steer: false },
  'sim.chronicle@1': { parts: ['reply.chronicle'], steer: false },
  'sim.state@1': { parts: ['turn.note', 'reply.note'], steer: false },
  'sim.influence@1': { parts: ['influences', 'turn.influence', 'reply.influences'], steer: true },
  'sim.commands@1': { parts: ['reply.commands'], steer: true },
} as const satisfies Record<string, { parts: readonly string[]; steer: boolean }>;

export type SimCap = keyof typeof SIM_CAPS;

/** 影响口的名字(单位、乘还是加、上下限见 OFFICIAL_INFLUENCES) */
export type InfluenceName =
  | 'city.capacity'
  | 'rural.capacity'
  | 'unrest.add'
  | 'dev.rate'
  | 'assim.rate'
  | 'control.reach'
  | 'war.odds'
  | 'war.power'
  | 'split.odds'
  | 'dynasty.odds'
  | 'plague.odds'
  | 'plague.loss';

export const INFLUENCE_NAMES: readonly InfluenceName[] = OFFICIAL_INFLUENCES.map((p) => p.id as InfluenceName);

/** 命令里指一国、一州、一城、一族:读口里的编号(只在这一刻有效),或稳定键 */
export type SimRef = number | string;

/** 插件能下的命令(PluginReply.commands):干预的写法,from 由推演定(出手那一刻的下一格) */
export type SimCommand =
  | { kind: 'declare'; a: SimRef; b: SimRef }
  | { kind: 'ally'; a: SimRef; b: SimRef; until?: number }
  | { kind: 'treaty'; a: SimRef; ps: SimRef[]; term?: number; limited?: true; keep?: true; by?: SimRef; zone?: SimRef; ask?: true }
  | { kind: 'cede'; a: SimRef; region: SimRef; permanent?: true }
  | { kind: 'found'; region: SimRef; name?: string }
  | { kind: 'move'; a: SimRef; city: SimRef }
  | { kind: 'destroy'; a: SimRef; b?: SimRef }
  | { kind: 'disaster'; type: 'plague'; level: DisasterLevel; city: SimRef }
  | { kind: 'disaster'; type: 'famine'; level: DisasterLevel; a?: SimRef; regions?: SimRef[] }
  | { kind: 'disaster'; type: 'quake'; level: DisasterLevel; region: SimRef }
  | { kind: 'trek'; folk: SimRef; region?: SimRef; to?: SimRef; reach?: Exclude<TrekReach, 'mid'>; dir?: TrekDir };
