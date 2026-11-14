/**
 * 插件接口的档:能力、影响口、命令、地图插件生成的步骤、帮手各一张档表,只列不是稳定档的;没写的都是稳定档。
 * 纯定义,网页、Worker、服务器共用。
 */

/** stable 只加不改;experimental 网站更新后可能改意思、改名或拿掉 */
export type ApiTier = 'stable' | 'experimental';

/** 档表里的一项;版本都是网站的版本号(package.json 的 version,如 '1.7.0') */
export interface TierNote {
  tier: ApiTier;
  /** 给用的人看的名字:权限框「用到：」后面、拿掉以后说的那个 */
  label: string;
  /** 哪一版开的 */
  since: string;
  /** 改过的那几版 */
  changed?: readonly string[];
  /** 哪一版拿掉的:登记表里去掉,这里留着,好和「网站太旧」分开 */
  removed?: string;
}

/** 能力(pluginCaps.ts 的 PLUGIN_CAPS) */
export const CAP_TIER: Readonly<Record<string, TierNote>> = {};
/** 推演插件的命令、影响口(pluginCaps.ts 的 SIM_COMMAND_TEXT、SIM_INFLUENCE_TEXT) */
export const SIM_COMMAND_TIER: Readonly<Record<string, TierNote>> = {};
export const SIM_INFLUENCE_TIER: Readonly<Record<string, TierNote>> = {};
/** 地图插件生成的步骤(pluginMap.ts 的 MAP_STAGE_CAPS)、帮手(gen/mapHelpers.ts) */
export const MAP_STAGE_TIER: Readonly<Record<string, TierNote>> = {};
export const MAP_HELPER_TIER: Readonly<Record<string, TierNote>> = {};
