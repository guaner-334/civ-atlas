/**
 * 插件能要的能力(「名字@大版本」),和装插件时权限框上对应的那一行。
 * 这张表里没有的能力(名字认得、版本更高的也算)一律当这一版网站还没有。纯定义,网页、Worker、服务器共用。
 */

export type PermissionKey = 'map' | 'history' | 'authorRead' | 'authorWrite' | 'view' | 'layer' | 'storeWorld' | 'sim' | 'simSteer';

/** 权限框上的各行,按这个先后列;loud = 显眼;note = 网站写的那行小字(每个插件都一样,在作者写的理由上面) */
export const PERMISSIONS: Readonly<Record<PermissionKey, { text: string; loud: boolean; note?: string }>> = {
  map: { text: '看地图（地形、气候、河流）', loud: false },
  history: { text: '看历史（国家、城市、人物、编年史）', loud: false },
  authorRead: { text: '看你写的东西（笔记、标记、AI 写的正文）', loud: true },
  authorWrite: { text: '会改你写的东西（改国名人名、加标记和批注、下命令）', loud: true, note: '改了顶上会说一声，能撤销；下了命令，那一年往后的历史重新推演' },
  view: { text: '知道你在看哪一年、点了哪里（只在用它的时候）', loud: false },
  layer: { text: '在地图上加图层和标注', loud: false },
  storeWorld: { text: '在世界里存自己的数据', loud: false, note: '存了以后那个世界不能公开分享，能存成文件发给别人。每个世界第一次存的时候还会问你' },
  sim: { text: '在推演里加自己的数和事件、写编年史', loud: false },
  simSteer: { text: '会改推演怎么走（只影响用它新推的世界，已经推好的世界不变）', loud: true },
};

/** 权限框底下固定的一行;会改你写的东西的插件下的命令会让历史重推,推演插件本来就改历史,各换一句 */
export const PERMISSION_FOOTER = '它不能联网、看不到你的 AI 密钥和账号、看不到别的世界、改不了历史。';
export const PERMISSION_FOOTER_WRITE = '它不能联网、看不到你的 AI 密钥和账号、看不到别的世界、改不了地形和推演规则。';
export const PERMISSION_FOOTER_SIM = '它不能联网、看不到你的 AI 密钥和账号、看不到别的世界、改不了地形。';

/** 这几行权限底下该配哪一句;role = 清单的 role(推演插件一样能力都不要也不说「改不了历史」) */
export function permissionFooter(lines: readonly { key: PermissionKey }[], role?: string): string {
  if (role === 'sim' || lines.some((l) => l.key === 'sim' || l.key === 'simSteer')) return PERMISSION_FOOTER_SIM;
  return lines.some((l) => l.key === 'authorWrite') ? PERMISSION_FOOTER_WRITE : PERMISSION_FOOTER;
}

/** 这一版网站有的能力 → 权限框上归哪一行;null = 不单列(哪个插件都有)。sim. 开头的只给推演插件,别的只给工具插件 */
export const PLUGIN_CAPS: ReadonlyMap<string, PermissionKey | null> = new Map<string, PermissionKey | null>([
  ['world.read@1', 'map'],
  ['history.read@1', 'history'],
  ['author.read@1', 'authorRead'],
  ['author.write@1', 'authorWrite'],
  ['view.read@1', 'view'],
  ['input.pick@1', 'view'],
  ['ui.panel@1', null],
  ['layer.cells@1', 'layer'],
  ['layer.regions@1', 'layer'],
  ['layer.marks@1', 'layer'],
  ['store.local@1', null],
  ['store.world@1', 'storeWorld'],
  ['sim.read@1', 'sim'],
  ['sim.tables@1', 'sim'],
  ['sim.events@1', 'sim'],
  ['sim.chronicle@1', 'sim'],
  ['sim.state@1', 'sim'],
  ['sim.influence@1', 'simSteer'],
  ['sim.commands@1', 'simSteer'],
]);

/** 能力名的写法:小写的点分名字 + @ + 大版本 */
export const CAP_NAME = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+@[1-9][0-9]{0,3}$/;

/** 能力给哪种插件:sim. 开头的给推演插件,别的给工具插件 */
export const capRole = (cap: string): 'sim' | 'tool' => (cap.startsWith('sim.') ? 'sim' : 'tool');

/** 权限框上的一行;why = 作者给这一行里各能力写的理由 */
export interface PermissionLine {
  key: PermissionKey;
  text: string;
  loud: boolean;
  note?: string;
  why: string[];
}

/** 装这个插件时权限框上要列的行;optional 里这一版网站没有的不会给,也不列 */
export function permissionLines(m: { requires: readonly string[]; optional?: readonly string[]; why?: Readonly<Record<string, string>> }): PermissionLine[] {
  const caps = [...m.requires, ...(m.optional ?? [])];
  const lines: PermissionLine[] = [];
  for (const key of Object.keys(PERMISSIONS) as PermissionKey[]) {
    const mine = caps.filter((c) => PLUGIN_CAPS.get(c) === key);
    if (!mine.length) continue;
    const why = mine.flatMap((c) => (m.why && Object.prototype.hasOwnProperty.call(m.why, c) ? [m.why[c]] : []));
    lines.push({ key, ...PERMISSIONS[key], why });
  }
  return lines;
}

/** 推演插件会下的命令、会影响的地方,网站自己的说法(作者改不了;键就是这一版网站认得的那几种) */
export const SIM_COMMAND_TEXT: Readonly<Record<string, string>> = {
  declare: '宣战',
  ally: '结盟',
  treaty: '立约（议和、罢兵）',
  cede: '割地',
  found: '立国',
  move: '迁都',
  destroy: '灭国',
  disaster: '天灾（瘟疫、饥荒、地震水旱）',
  trek: '大迁徙',
};
export const SIM_INFLUENCE_TEXT: Readonly<Record<string, string>> = {
  'city.capacity': '城的人口上限（按州）',
  'rural.capacity': '乡村人口上限（按州）',
  'unrest.add': '动荡（按州）',
  'dev.rate': '发展快慢（按州）',
  'assim.rate': '同化快慢（按州）',
  'control.reach': '中央管得到多远（按国）',
  'war.odds': '宣战的几率（按国）',
  'war.power': '国力（按国）',
  'split.odds': '分裂的几率（按国）',
  'dynasty.odds': '改朝换代的几率（按国）',
  'plague.odds': '起瘟疫的几率（按州）',
  'plague.loss': '瘟疫死几成（按州）',
};

/** 清单 sim.commands → 「宣战、结盟」 */
export const simCommandsText = (kinds: readonly string[]): string => kinds.map((k) => (Object.prototype.hasOwnProperty.call(SIM_COMMAND_TEXT, k) ? SIM_COMMAND_TEXT[k] : k)).join('、');
/** 清单 sim.influences → 「动荡（按州）、宣战的几率（按国）」 */
export const simInfluencesText = (names: readonly string[]): string => names.map((k) => (Object.prototype.hasOwnProperty.call(SIM_INFLUENCE_TEXT, k) ? SIM_INFLUENCE_TEXT[k] : k)).join('、');
