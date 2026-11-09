/** 世界用的推演插件:世界设定里那一行的小字、本机对不上或网站关了插件时问的窗上的话。纯计算,单测直接测 */
import { endParamOf, type WorldEdits } from '../../gen/edits';
import type { SimPluginCheck } from '../../plugin/pluginWorld';
import type { UsedPlugin } from './worldPlugins';
import { versionLabel } from './pluginWords';
import { MAP_STAGE_TEXT } from './mapText';

type Other = Extract<SimPluginCheck, { status: 'other' }>;
/** 另存的那份叫什么(和旧版本世界另存的同一个叫法) */
const newTitle = (title: string) => `${title}（新版）`;

/** 推演插件本机有没有世界记的那一版(现在用的、留着的上一版都算) */
export function simHere(u: Pick<UsedPlugin, 'plugin' | 'installed'>): 'same' | 'other' | 'none' {
  const have = u.installed;
  if (!have) return 'none';
  const sum = u.plugin?.sum;
  return have.current.sum === sum || have.previous?.sum === sum ? 'same' : 'other';
}

/** 推演插件那一行的小字:第几个出手、滑条拨到几;只装了别的版本的说要装回哪一版 */
export function simLines(u: Pick<UsedPlugin, 'plugin' | 'installed'>, order: number): string[] {
  const spec = u.installed?.current.manifest.sim?.params ?? {};
  const given = Object.entries(u.plugin?.params ?? {}).filter((e): e is [string, number] => typeof e[1] === 'number');
  const changed = given.filter(([k, v]) => !spec[k] || v !== spec[k].default);
  const knobs = !given.length ? '' : !changed.length ? '滑条都是默认' : `滑条：${changed.map(([k, v]) => (spec[k] ? `${spec[k].label} ${v}（默认 ${spec[k].default}）` : `${k} ${v}`)).join('、')}${changed.length < given.length ? '，别的是默认' : ''}`;
  const out = [`第 ${order} 个出手。${knobs}`.replace(/。$/, '')];
  if (simHere(u) === 'other' && u.plugin) out.push(`要接着推，得装回${versionLabel(u.plugin.version)}；不装也照常能看`);
  return out;
}

/** 地图插件那一行的小字:哪一步、第几个出手、滑条拨到几;出的图层;对不上的说改地形要装回哪一版 */
export function mapLines(u: Pick<UsedPlugin, 'plugin' | 'installed'>, order: number, titles: readonly string[]): string[] {
  const m = u.installed?.current.manifest.map;
  const spec = m?.params ?? {};
  const given = Object.entries(u.plugin?.params ?? {}).filter((e): e is [string, number] => typeof e[1] === 'number');
  const changed = given.filter(([k, v]) => !spec[k] || v !== spec[k].default);
  const knobs = !given.length ? '' : !changed.length ? '滑条都是默认' : `滑条：${changed.map(([k, v]) => (spec[k] ? `${spec[k].label} ${v}（默认 ${spec[k].default}）` : `${k} ${v}`)).join('、')}${changed.length < given.length ? '，别的是默认' : ''}`;
  const steps = m ? m.stages.map((k) => MAP_STAGE_TEXT[k] ?? k).join('、') : '';
  const out = [`${steps ? `${steps}，` : ''}第 ${order} 个出手。${knobs}`.replace(/。$/, '')];
  if (titles.length) out.push(`出了${titles.length > 1 ? ` ${titles.length} 张` : '一张'}图层${titles.map((t) => `「${t}」`).join('')}，存在世界里，没装也照常能看（图层面板「插件图层」）`);
  if (simHere(u) !== 'same' && u.plugin) out.push(`要改地形，得装回${versionLabel(u.plugin.version)}`);
  return out;
}

/** 要先装的那一句 */
export function missingText(title: string, miss: readonly Pick<SimPluginCheck, 'id' | 'plugin'>[]): string {
  const list = miss.map((c) => `「${c.plugin.name ?? c.id}」${versionLabel(c.plugin.version)}`).join('、');
  return `「${title}」用了推演插件${list}。看不用装；要接着推，得先装上同一版，推出来的历史才对得上。`;
}

/** 被网站停用了:框的标题 */
export function blockedLabel(blocked: readonly Pick<SimPluginCheck, 'id' | 'plugin'>[]): string {
  return blocked.length === 1 ? `「${blocked[0].plugin.name ?? blocked[0].id}」被网站停用了` : `${blocked.length} 个推演插件被网站停用了`;
}

/** 被网站停用了:框里那两句 */
export function blockedText(title: string, blocked: readonly Pick<SimPluginCheck, 'id' | 'plugin'>[]): [string, string] {
  const list = blocked.map((c) => `「${c.plugin.name ?? c.id}」${versionLabel(c.plugin.version)}`).join('、');
  const it = blocked.length > 1 ? '它们' : '它';
  return [
    `「${title}」用了推演插件${list}，${it}被网站停用了，不再跑。这个世界照样能看；要接着推，只能另存一份不带${it}的。`,
    `原来的「${title}」不动；另存一份「${newTitle(title)}」，地图和你写的东西留下，历史不带${it}、从第 0 年重推，整段都会不一样。`,
  ];
}

/** 网站暂时关了插件(插件界面关着):框的标题 */
export const OFF_LABEL = '网站暂时关了插件';

/** 网站暂时关了插件:框里那两句 */
export function offText(title: string, list: readonly Pick<SimPluginCheck, 'id' | 'plugin'>[]): [string, string] {
  const names = list.map((c) => `「${c.plugin.name ?? c.id}」${versionLabel(c.plugin.version)}`).join('、');
  const it = list.length > 1 ? '它们' : '它';
  return [
    `「${title}」用了推演插件${names}。看不受影响；要接着推，得等插件开回来，推出来的历史才对得上。`,
    `不想等的话，可以另存一份「${newTitle(title)}」：地图和你写的东西留下，历史不带${it}、从第 0 年重推，整段都会不一样。原来的「${title}」不动。`,
  ];
}

/** 另存一份那两句 */
export function otherText(title: string, other: readonly Pick<Other, 'id' | 'plugin' | 'installed'>[], what: string): [string, string] {
  const one = other.length === 1 ? other[0] : null;
  const first = one
    ? `「${title}」是用推演插件「${one.plugin.name ?? one.id}」${versionLabel(one.plugin.version)}推的，你装的是${versionLabel(one.installed.version)}。推演的话，地图和你写的东西留下，历史按${versionLabel(one.installed.version)}从第 0 年重推，整段都会不一样。`
    : `「${title}」用的推演插件，你装的是别的版本：${other.map((c) => `「${c.plugin.name ?? c.id}」${versionLabel(c.plugin.version)}（你装的是${versionLabel(c.installed.version)}）`).join('、')}。推演的话，地图和你写的东西留下，历史按你装的版本从第 0 年重推，整段都会不一样。`;
  const back = one ? `要照原样接着推，得装回${versionLabel(one.plugin.version)}。` : '要照原样接着推，得装回原来那几版。';
  return [first, `原来的「${title}」不动；另存一份「${newTitle(title)}」，在那一份上${what}。${back}`];
}

/** 问「另存一份再推演？」时说这次要做的:再推几年、推演几条命令 */
export function simWhat(now: WorldEdits, next: WorldEdits): string {
  const a = endParamOf(now) ?? 3000;
  const b = endParamOf(next) ?? 3000;
  if (b > a) return `再推 ${Math.round(b - a)} 年`;
  const n = next.interventions.length - now.interventions.length;
  return n > 0 ? `推演这 ${n} 条命令` : '推演';
}
