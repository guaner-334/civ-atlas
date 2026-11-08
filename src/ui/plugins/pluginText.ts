/** 插件页、权限框上的几句话。纯计算,单测直接测 */
import { permissionLines, simCommandsText, simInfluencesText, type PermissionLine } from '../../plugin/pluginCaps';
import type { PluginManifest } from '../../plugin/pluginFile';
import type { SimManifest } from '../../plugin/pluginSim';
import { versionLabel, sizeText } from './pluginWords';

export { versionText, versionLabel, sizeText, moreText } from './pluginWords';

/** 11 月 8 日(不是今年的带上年) */
export function dayText(at: number, now = Date.now()): string {
  const d = new Date(at);
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : `${d.getFullYear()} 年 `;
  return `${year}${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

const who = (m: PluginManifest): string[] => (m.author ? [`${m.author.name} 写的`] : []);

/** 权限框标题下面那行;phone 不写许可证 */
export function askByLine(m: PluginManifest, bytes: number, phone: boolean): string {
  return [...who(m), versionLabel(m.version), sizeText(bytes), ...(phone ? [] : [`开源许可证 ${m.license}`])].join('，');
}

/** 插件页名字下面那行(版本号在名字旁边) */
export function pageByLine(m: PluginManifest, bytes: number): string {
  return [...who(m), `开源许可证 ${m.license}`, sizeText(bytes)].join('，');
}

type Caps = Pick<PluginManifest, 'requires' | 'optional' | 'why'>;

/** 更新时新多出来的权限行(旧版没有的行;同一行里多要了一样能力不算) */
export function addedLines(old: Caps, next: Caps): PermissionLine[] {
  const had = new Set(permissionLines(old).map((l) => l.key));
  return permissionLines(next).filter((l) => !had.has(l.key));
}

const caps = (m: PluginManifest) => new Set([...m.requires, ...(m.optional ?? [])]);

/** 出现在「工具」里:要了面板或点选的(只交图层的在图层面板) */
export function isTool(m: PluginManifest): boolean {
  const c = caps(m);
  return c.has('ui.panel@1') || c.has('input.pick@1');
}

/** 装好以后提示条第二行:工具在哪 */
export function toolWhere(m: PluginManifest, phone: boolean): string | undefined {
  if (!isTool(m)) return undefined;
  return phone ? `右上竖排的拼图里多了「${m.name}」` : `地图右下的「工具」里多了「${m.name}」`;
}

/** 从作品墙装好以后提示条第二行:作品墙那一页没有地图,说打开一个世界以后在哪 */
export function wallInstalledText(m: PluginManifest, phone: boolean): string {
  const tail = '装在这个浏览器里，所有世界都能用。';
  if (isSim(m)) return `${simWhere(phone)}。${tail}`;
  const where = isTool(m) ? (phone ? '右上竖排的拼图里' : '地图右下的「工具」里') : caps(m).has('layer.cells@1') ? '图层面板的「插件图层」里' : '';
  return where ? `打开一个世界，${where}就有它。${tail}` : tail;
}

/** 作者写的「这一版改了什么」:没带句末标点的补一个句号 */
export function noteText(note: string): string {
  const t = note.trim();
  return /[。！？.!?]$/.test(t) ? t : `${t}。`;
}

export interface AddsRow {
  k: string;
  v: string;
  small?: string;
}

/** 插件页「它加了什么」 */
export function addsRows(m: PluginManifest, phone: boolean): AddsRow[] {
  const c = caps(m);
  const rows: AddsRow[] = [];
  if (isTool(m)) rows.push({ k: `工具「${m.name}」`, v: phone ? '在右上竖排的拼图里' : '在地图右下的「工具」里' });
  if (c.has('layer.cells@1')) rows.push({ k: '图层', v: '在图层面板的「插件图层」里' });
  const k = '往世界里存东西';
  if (c.has('store.world@1')) rows.push({ k, v: '存它自己的数据', small: '存了以后那个世界不能公开分享，能存成文件发给别人' });
  else if (c.has('author.write@1')) rows.push({ k, v: '不存它自己的数据', small: phone ? '改的东西记进你的修改，照常能分享' : '改的东西记进你的修改，和你自己改的一样：能分享、能撤销' });
  else rows.push({ k, v: '不存', small: '它算的关掉就没了，世界不变' });
  return rows;
}

// ---------------------------------------------------------------------------
// 推演插件

export const isSim = (m: Pick<PluginManifest, 'role'>): boolean => m.role === 'sim';

/** 装好以后提示条第二行:去哪选它 */
export const simWhere = (phone: boolean): string => (phone ? '新建世界时，在「更多设定」的「推演插件」里选上它' : '新建世界时，在「文明」那一步的「推演插件」里选上它');

/** 听的史事的说法(没列的写「别的史事」) */
const LISTEN_TEXT: Readonly<Record<string, string>> = {
  found: '立国',
  war: '打仗',
  conquer: '攻下',
  peace: '议和',
  fall: '灭国',
  capital: '迁都',
  split: '分裂',
  merge: '合并',
  dynasty: '改朝换代',
  migrate: '迁徙',
  assimilate: '同化',
  battle: '交战',
  alliance: '结盟',
  submit: '称臣',
  famine: '饥荒',
  revolt: '民变',
  plague: '瘟疫',
  treaty: '立约',
};

/** 「每 5 年一次（出手时看打仗、攻下、议和）」:听的史事只在出手时交给它,不多出手 */
export function simWhenText(sim: Pick<SimManifest, 'every' | 'listen'>): string {
  const every = sim.every ? (sim.every === 1 ? '每年一次' : `每 ${sim.every} 年一次`) : '只在开头和自己约好的年份';
  const heard = [...new Set((sim.listen ?? []).map((k) => LISTEN_TEXT[k] ?? '别的史事'))].join('、');
  return heard ? `${every}（出手时看${heard}）` : every;
}

/** 插件页「它在推演里做什么」 */
export function simRows(sim: SimManifest, caps: readonly string[], phone: boolean): AddsRow[] {
  const params = Object.values(sim.params ?? {});
  const one = params.length === 1 ? params[0] : null;
  const tables = (sim.tables ?? []).filter((t) => !t.input && t.kind !== 'id');
  const layers = sim.layers ?? [];
  const when: AddsRow = { k: phone ? '出手' : '什么时候出手', v: simWhenText(sim) };
  const steer: AddsRow = { k: '会影响', v: sim.influences?.length ? simInfluencesText(sim.influences) : '不影响' };
  const orders: AddsRow = { k: phone ? '命令' : '会下的命令', v: sim.commands?.length ? simCommandsText(sim.commands) : '不下' };
  const own: AddsRow[] = tables.length ? [{ k: '自己的数', v: tables.map((t) => `${t.name}（每${t.unit === 'polity' ? '国' : '州'}一个，${t.min}–${t.max}）`).join('、') }] : [];
  const chron: AddsRow = { k: '编年史', v: caps.includes('sim.chronicle@1') ? '会写' : '不写' };
  const layer: AddsRow = layers.length ? { k: '图层', v: `${layers.map((l) => `「${l.title}」`).join('')}，跟着年份变`, small: '在图层面板「插件图层」里' } : { k: '图层', v: '不加' };
  const knobs: AddsRow = params.length
    ? { k: '滑条', v: one ? `1 个：${one.label}（${one.min}–${one.max}，默认 ${one.default}）` : `${params.length} 个：${params.map((p) => p.label).join('、')}`, ...(phone ? {} : { small: '新建世界选它时拨' }) }
    : { k: '滑条', v: '没有' };
  return phone ? [when, steer, orders, ...own, layer, chron, knobs] : [when, steer, orders, ...own, chron, layer, knobs];
}

// ---------------------------------------------------------------------------
// 开发者模式的小卡

export type DevLevel = 'info' | 'warn' | 'error' | 'site';

export interface DevLog {
  at: number;
  level: DevLevel;
  text: string;
  /** 第几次载入时记的 */
  run: number;
}

const LEVEL: Record<DevLevel, string> = { info: '信息', warn: '警告', error: '出错', site: '网站' };
export const levelText = (l: DevLevel): string => LEVEL[l];

/** 14:32:05 */
export function clockText(at: number): string {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

/** 最近一次载入的排在最上面,同一次里照先后 */
export function devLogOrder(logs: readonly DevLog[]): DevLog[] {
  return [...logs].sort((a, b) => b.run - a.run);
}

/** 「复制全部」:和小卡上一样的顺序,一条一行 */
export function devLogCopy(logs: readonly DevLog[]): string {
  return devLogOrder(logs)
    .map((l) => `${clockText(l.at)} ${levelText(l.level)} ${l.text}`)
    .join('\n');
}

/** 小卡第二行;ms = null 是没开起来 */
export function devLoadLine(at: number, again: boolean, ms: number | null, file: string): string {
  const how = ms === null ? '没开起来' : `算了 ${Math.max(1, Math.round(ms))} 毫秒`;
  return `${clockText(at)} ${again ? '重新载入' : '载入'}，${how}（${file}）`;
}

const STOPPED: Record<string, string> = {
  crashed: '插件出错，已经停下',
  'start-timeout': '插件代码顶层 10 秒没跑完，已经停下',
  unresponsive: '插件没反应，已经停下',
  protocol: '插件发来看不懂的话，已经停下',
  flood: '插件一秒发话太多，已经停下',
  oversize: '插件发来的东西太大，已经停下',
};

/** 插件停下时网站记的一句;网站自己停的(重新载入、关掉)= null。出错的那句话另记一条「出错」 */
export function devStopText(reason: string, detail: string): string | null {
  const t = STOPPED[reason];
  if (!t) return null;
  return detail && reason !== 'crashed' ? `${t}（${detail}）` : t;
}
