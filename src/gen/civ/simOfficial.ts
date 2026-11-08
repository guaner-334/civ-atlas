/** 推演插件能接的官方表:稳定名字 → 按什么记、总登记里的「组名.表名」和栏名。单列一个文件,查插件清单时不用带上整个读口 */
import { TABLE_GROUP } from './tableGroups';

export type OfficialDef = { unit: 'region' | 'polity'; table: string; col?: string };
const st = (t: string) => `${TABLE_GROUP.state}.${t}`;
const dv = (t: string) => `${TABLE_GROUP.dev}.${t}`;
const id = (t: string) => `${TABLE_GROUP.ideology}.${t}`;

/** 按栏名找,官方以后加栏、换栏的先后不影响 */
export const OFFICIAL = {
  /** 乡村人口(千人) */
  rural: { unit: 'region', table: st('乡口') },
  /** 中央管得到几成(0–1) */
  control: { unit: 'region', table: st('管辖') },
  unrest: { unit: 'polity', table: st('动荡') },
  'dev.production': { unit: 'region', table: dv('能力'), col: '生产' },
  'dev.transport': { unit: 'region', table: dv('能力'), col: '运输' },
  'dev.information': { unit: 'region', table: dv('能力'), col: '信息' },
  'dev.administration': { unit: 'region', table: dv('能力'), col: '行政' },
  'dev.mobilization': { unit: 'region', table: dv('动员') },
  /** 物产眼下能用多少(0–3 档) */
  'res.grain': { unit: 'region', table: dv('能用'), col: '粮' },
  'res.livestock': { unit: 'region', table: dv('能用'), col: '牲畜' },
  'res.copper': { unit: 'region', table: dv('能用'), col: '铜锡' },
  'res.iron': { unit: 'region', table: dv('能用'), col: '铁' },
  'res.coal': { unit: 'region', table: dv('能用'), col: '煤' },
  'res.timber': { unit: 'region', table: dv('能用'), col: '木材' },
  'res.salt': { unit: 'region', table: dv('能用'), col: '盐' },
  'res.fish': { unit: 'region', table: dv('能用'), col: '渔获' },
  'res.oil': { unit: 'region', table: dv('能用'), col: '石油' },
  'res.rare': { unit: 'region', table: dv('能用'), col: '稀有矿' },
  'res.gold': { unit: 'region', table: dv('能用'), col: '金银' },
  /** 各说的接受度(0–1) */
  'ideology.mandate': { unit: 'region', table: id('思潮'), col: '天命之说' },
  'ideology.law': { unit: 'region', table: id('思潮'), col: '律法之说' },
  'ideology.council': { unit: 'region', table: id('思潮'), col: '共治之说' },
  'ideology.craft': { unit: 'region', table: id('思潮'), col: '技艺之说' },
  'ideology.rights': { unit: 'region', table: id('思潮'), col: '民权之说' },
  'ideology.nation': { unit: 'region', table: id('思潮'), col: '国族之说' },
  'ideology.commons': { unit: 'region', table: id('思潮'), col: '均产之说' },
} as const satisfies Record<string, OfficialDef>;

export type OfficialName = keyof typeof OFFICIAL;
export const OFFICIAL_NAMES = Object.keys(OFFICIAL) as OfficialName[];

/** 官方表按什么记:region = 一州一个数,polity = 一国一个数(按国的编号) */
export function officialUnit(name: OfficialName): 'region' | 'polity' {
  return OFFICIAL[name].unit;
}
