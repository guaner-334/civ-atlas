/**
 * 档表和文档、类型定义对不对得上(单测用):
 * - 档表:没拿掉的在登记表里、拿掉了的不在;版本是网站的版本号,开的 ≤ 改的 ≤ 拿掉的,不超过下一个次版本
 * - 没拿掉的实验接口:文档里它那一行表格写「实验」和「网站 X 起」;类型定义里有一段注释第一行是「实验:网站更新后可能改」、
 *   带 @experimental,注释里提到它或紧跟着的那一行声明它
 */
import { MAP_STAGE_CAPS } from '../../src/plugin/pluginMap';
import { CAP_TIER, MAP_HELPER_TIER, MAP_STAGE_TIER, SIM_COMMAND_TIER, SIM_INFLUENCE_TIER, type TierNote } from '../../src/plugin/apiTier';
import { PLUGIN_CAPS, SIM_COMMAND_TEXT, SIM_INFLUENCE_TEXT, capRole } from '../../src/plugin/pluginCaps';

export const TIER_MARK = '实验:网站更新后可能改';

type Kind = 'cap' | 'influence' | 'command' | 'stage' | 'helper';
interface Place {
  doc: string;
  dts: string;
}
const TOOL: Place = { doc: 'docs/plugins/limits.md', dts: 'src/plugin/types.ts' };
const SIM: Place = { doc: 'docs/plugins/sim.md', dts: 'examples/plugins/civ-atlas-sim.d.ts' };
const MAP: Place = { doc: 'docs/plugins/map.md', dts: 'examples/plugins/civ-atlas-map.d.ts' };

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function tables(helperNames: readonly string[]): { kind: Kind; tiers: Readonly<Record<string, TierNote>>; known: (name: string) => boolean }[] {
  return [
    { kind: 'cap', tiers: CAP_TIER, known: (k) => PLUGIN_CAPS.has(k) },
    { kind: 'influence', tiers: SIM_INFLUENCE_TIER, known: (k) => has(SIM_INFLUENCE_TEXT, k) },
    { kind: 'command', tiers: SIM_COMMAND_TIER, known: (k) => has(SIM_COMMAND_TEXT, k) },
    { kind: 'stage', tiers: MAP_STAGE_TIER, known: (k) => has(MAP_STAGE_CAPS, k) },
    { kind: 'helper', tiers: MAP_HELPER_TIER, known: (k) => helperNames.includes(k) },
  ];
}

function placeOf(kind: Kind, name: string): Place {
  if (kind === 'cap') return { sim: SIM, map: MAP, tool: TOOL }[capRole(name)];
  return kind === 'influence' || kind === 'command' ? SIM : MAP;
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const parts = (v: string) => VERSION.exec(v)!.slice(1).map(Number);
const cmp = (a: string, b: string) => {
  const [x, y] = [parts(a), parts(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/** 档表本身的问题;helperNames = 这一版网站有的帮手,site = 网站现在的版本号 */
export function tierTableProblems(helperNames: readonly string[], site: string): string[] {
  const out: string[] = [];
  const [major, minor] = parts(site);
  const next = `${major}.${minor + 1}.0`;
  for (const { kind, tiers, known } of tables(helperNames)) {
    for (const [name, note] of Object.entries(tiers)) {
      const at = `${kind} ${name}`;
      if (note.tier !== 'stable' && note.tier !== 'experimental') out.push(`${at}:档只能是 stable、experimental`);
      if (typeof note.label !== 'string' || !note.label.trim()) out.push(`${at}:要写给用的人看的名字`);
      if (note.removed === undefined && !known(name)) out.push(`${at}:没拿掉,登记表里却没有`);
      if (note.removed !== undefined && known(name)) out.push(`${at}:拿掉了,登记表里还有`);
      const versions = [note.since, ...(note.changed ?? []), ...(note.removed === undefined ? [] : [note.removed])];
      if (!versions.every((v) => typeof v === 'string' && VERSION.test(v))) {
        out.push(`${at}:版本要写成网站的版本号,如 1.7.0`);
        continue;
      }
      if (versions.some((v, i) => i > 0 && cmp(versions[i - 1], v) > 0)) out.push(`${at}:开的、改的、拿掉的版本要从早到晚`);
      if (versions.some((v) => cmp(v, next) > 0)) out.push(`${at}:版本比下一版 ${next} 还新`);
    }
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const token = (name: string) => new RegExp(`(?:^|[^\\w.@$])${escape(name)}(?![\\w.@$])`);

/** 文档里有一行表格的代码片段就是它(帮手写成 d.xxx(…)),这一行写着「实验」和「网站 X 起」 */
function docMarked(doc: string, kind: Kind, name: string, since: string): boolean {
  return doc.split('\n').some((line) => {
    if (!line.trim().startsWith('|')) return false;
    const spans = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const named = spans.some((s) => s === name || (kind === 'helper' && (s === `d.${name}` || s.startsWith(`d.${name}(`))));
    return named && line.includes('实验') && line.includes(`网站 ${since} 起`);
  });
}

/** 类型定义里有一段标了实验的注释,注释里提到它,或紧跟着的那一行声明它 */
function dtsMarked(dts: string, name: string): boolean {
  const re = /\/\*\*([\s\S]*?)\*\//g;
  const t = token(name);
  for (let m = re.exec(dts); m; m = re.exec(dts)) {
    const lines = m[1].split('\n').map((l) => l.replace(/^\s*\*?\s?/, '').trim());
    const first = lines.find((l) => l);
    if (!first?.startsWith(TIER_MARK) || !m[1].includes('@experimental')) continue;
    const after = dts
      .slice(m.index + m[0].length)
      .split('\n')
      .find((l) => l.trim());
    if (t.test(m[1]) || (after !== undefined && t.test(after))) return true;
  }
  return false;
}

/** 没拿掉的实验接口在文档、类型定义里漏标的;read = 照仓库里的路径读文件 */
export function markProblems(read: (path: string) => string, helperNames: readonly string[]): string[] {
  const out: string[] = [];
  for (const { kind, tiers } of tables(helperNames)) {
    for (const [name, note] of Object.entries(tiers)) {
      if (note.tier !== 'experimental' || note.removed !== undefined) continue;
      const { doc, dts } = placeOf(kind, name);
      if (!docMarked(read(doc).replace(/\r\n/g, '\n'), kind, name, note.since)) out.push(`${doc}:${name} 那一行要写「实验」和「网站 ${note.since} 起」`);
      if (!dtsMarked(read(dts).replace(/\r\n/g, '\n'), name)) out.push(`${dts}:${name} 的注释第一行要写「${TIER_MARK}」,带 @experimental`);
    }
  }
  return out;
}
