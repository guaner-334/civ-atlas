/** 插件页、权限框上的几句话。纯计算,单测直接测 */
import { permissionLines, simCommandsText, simInfluencesText, type PermissionLine } from '../../plugin/pluginCaps';
import type { PluginManifest } from '../../plugin/pluginFile';
import type { SimManifest } from '../../plugin/pluginSim';
import { versionLabel, sizeText } from './pluginWords';
import { isMap, mapWhere } from './mapText';

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
  if (isMap(m)) return `${mapWhere()}。${tail}`;
  const where = isTool(m) ? (phone ? '右上竖排的拼图里' : '地图右下的「工具」里') : caps(m).has('layer.cells@1') || caps(m).has('layer.regions@1') ? '图层面板的「插件图层」里' : '';
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
  if (c.has('layer.cells@1') || c.has('layer.regions@1')) rows.push({ k: '图层', v: '在图层面板的「插件图层」里' });
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

// 开发者模式的试推(载入的是推演插件)

/** 试推交回来的一部分(DevTried 的样子,这里只用到这几样) */
export interface TriedView {
  at: number;
  file: string;
  plugins: readonly { id: string; name: string; dev: boolean }[];
  alone: boolean;
  error?: string;
  result: {
    years: number;
    stuck: { year: number; error: string } | null;
    ms: number;
    plugins: readonly { id: string; turns: number; ms: number; worst: number; worstYear: number }[];
    commands: Readonly<Record<string, number>>;
    lines: number;
    logs: readonly { year: number | null; level: DevLevel; plugin: string; text: string }[];
    resume: { same: true } | { same: false; year: number | null; what: string } | null;
  } | null;
}

/** 命令的短说法(一句话里用,不带括号) */
const COMMAND_SHORT: Record<string, string> = { declare: '宣战', ally: '结盟', treaty: '立约', cede: '割地', found: '立国', move: '迁都', destroy: '灭国', disaster: '天灾', trek: '大迁徙' };

const secText = (ms: number) => `${ms < 1000 ? (ms / 1000).toFixed(2) : (ms / 1000).toFixed(1)} 秒`;

/** 小卡第二行:试推完、推不下去、没推成 */
export function devTryLine(t: TriedView, phone: boolean): string {
  const r = t.result;
  if (!r) return `${clockText(t.at)} 没推成：${t.error ?? '后台线程出错'}`;
  if (r.stuck) return `${clockText(t.at)} 试推到第 ${r.stuck.year} 年出错停下${phone ? '' : `（${t.file}）`}`;
  return `${clockText(t.at)} 试推完：${phone ? '' : '这个世界的地图，'}第 0 年推到第 ${r.years} 年，用了 ${secText(r.ms)}${phone ? '' : `（${t.file}）`}`;
}

/** 表里一个插件一行:名字、出手几回、一共多久、最慢一次(电脑上带哪年) */
export function devTryRows(t: TriedView, phone: boolean): { id: string; name: string; turns: string; total: string; worst: string }[] {
  const r = t.result;
  if (!r) return [];
  return r.plugins.map((p) => {
    const who = t.plugins.find((x) => x.id === p.id);
    const name = who ? (who.dev ? `${who.name}（开发中）` : who.name) : p.id;
    const worst = p.turns === 0 ? '—' : `${p.worst < 1 ? '不到 1' : Math.round(p.worst)} 毫秒${phone ? '' : `，第 ${p.worstYear} 年`}`;
    return { id: p.id, name, turns: `${p.turns} 回`, total: secText(p.ms), worst };
  });
}

/** 「下了 14 条命令（立约 9、宣战 3、结盟 2），写了 14 句编年史」(手机上不列每种几条) */
export function devTryCounts(t: TriedView, phone: boolean): string {
  const r = t.result;
  if (!r) return '';
  const kinds = Object.entries(r.commands).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const n = kinds.reduce((s, [, k]) => s + k, 0);
  const cmd = n ? `下了 ${n} 条命令${phone ? '' : `（${kinds.map(([k, c]) => `${COMMAND_SHORT[k] ?? k} ${c}`).join('、')}）`}` : '没下命令';
  return `${cmd}，${r.lines ? `写了 ${r.lines} 句编年史` : '没写编年史'}`;
}

/** 分段推那一行:一样 / 不一样在哪;没查(推不下去)= null */
export function devTryResume(t: TriedView, half: number, phone: boolean): { ok: boolean; text: string } | null {
  const v = t.result?.resume;
  if (!v) return null;
  if (v.same) return { ok: true, text: phone ? '分段推和一口气推一样' : `分段推（推到第 ${half} 年存下、打开再接着推）和一口气推一样` };
  if (v.what === 'stuck') return { ok: false, text: `分段推的时候${v.year === null ? '' : `第 ${v.year} 年`}推不下去，一口气推的推得下去，多半是用了全局变量记东西` };
  return { ok: false, text: v.year === null ? `不一样：史事都一样，${v.what} 对不上，多半是用了全局变量记东西` : `不一样：第 ${v.year} 年起对不上，多半是用了全局变量记东西` };
}

/** 日志一行左边:第几年(装插件时打的写「装的时候」) */
export const devTryYear = (year: number | null): string => (year === null ? '装的时候' : `第 ${year} 年`);

/** 试推的「复制全部」:那一行、每个插件、命令和编年史、分段推、日志 */
export function devTryCopy(t: TriedView, half: number): string {
  const out = [devTryLine(t, false)];
  for (const r of devTryRows(t, false)) out.push(`${r.name}：出手 ${r.turns}，一共 ${r.total}，最慢一次 ${r.worst}`);
  if (t.result) out.push(devTryCounts(t, false));
  const v = devTryResume(t, half, false);
  if (v) out.push(v.text);
  for (const l of t.result?.logs ?? []) out.push(`${devTryYear(l.year)} ${levelText(l.level)} ${l.plugin ? `[${l.plugin}] ` : ''}${l.text}`);
  return out.join('\n');
}
