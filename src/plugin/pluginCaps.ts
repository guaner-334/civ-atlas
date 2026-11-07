/**
 * 插件能要的能力(「名字@大版本」),和装插件时权限框上对应的那一行。
 * 这张表里没有的能力(名字认得、版本更高的也算)一律当这一版网站还没有。纯定义,网页、Worker、服务器共用。
 */

export type PermissionKey = 'map' | 'history' | 'authorRead' | 'authorWrite' | 'view' | 'layer' | 'storeWorld';

/** 权限框上的各行,按这个先后列;loud = 显眼 */
export const PERMISSIONS: Readonly<Record<PermissionKey, { text: string; loud: boolean }>> = {
  map: { text: '看地图（地形、气候、河流）', loud: false },
  history: { text: '看历史（国家、城市、人物、编年史）', loud: false },
  authorRead: { text: '看你写的东西（笔记、标记、AI 写的正文）', loud: true },
  authorWrite: { text: '会改你写的东西（改名、批注、标记、干预）', loud: true },
  view: { text: '知道你在看哪一年、点了哪里（只在用它的时候）', loud: false },
  layer: { text: '在地图上加图层和标注', loud: false },
  storeWorld: { text: '在世界里存自己的数据（存了以后这个世界不能公开分享）', loud: true },
};

/** 权限框底下固定的一行 */
export const PERMISSION_FOOTER = '它不能联网、看不到你的 AI 密钥和账号、看不到别的世界、改不了历史。';

/** 这一版网站有的能力 → 权限框上归哪一行;null = 不单列(哪个插件都有) */
export const PLUGIN_CAPS: ReadonlyMap<string, PermissionKey | null> = new Map<string, PermissionKey | null>([
  ['world.read@1', 'map'],
  ['history.read@1', 'history'],
  ['author.read@1', 'authorRead'],
  ['author.write@1', 'authorWrite'],
  ['view.read@1', 'view'],
  ['input.pick@1', 'view'],
  ['ui.panel@1', null],
  ['layer.cells@1', 'layer'],
  ['layer.marks@1', 'layer'],
  ['store.local@1', null],
  ['store.world@1', 'storeWorld'],
]);

/** 能力名的写法:小写的点分名字 + @ + 大版本 */
export const CAP_NAME = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+@[1-9][0-9]{0,3}$/;

/** 权限框上的一行;why = 作者给这一行里各能力写的理由 */
export interface PermissionLine {
  key: PermissionKey;
  text: string;
  loud: boolean;
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
