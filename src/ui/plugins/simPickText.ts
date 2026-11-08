/** 新建世界选推演插件那一页上的几句话。纯计算,单测直接测 */
import { OFFICIAL_INFLUENCES } from '../../gen/civ/influence';
import { SIM_COMMAND_TEXT, SIM_INFLUENCE_TEXT } from '../../plugin/pluginCaps';
import type { SimManifest, SimParam } from '../../plugin/pluginSim';

/** 对照表里的说法去掉括号里的(「立约（议和、罢兵）」→「立约」) */
const short = (t: string): string => t.replace(/（.*）$/, '');
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const commandText = (k: string) => (has(SIM_COMMAND_TEXT, k) ? short(SIM_COMMAND_TEXT[k]) : k);
const influenceText = (k: string) => (has(SIM_INFLUENCE_TEXT, k) ? short(SIM_INFLUENCE_TEXT[k]) : k);

/** 名字下面那一行:「每 5 年出手，会下令宣战、结盟」「每 5 年出手，加一个图层」 */
export function simBrief(sim: Pick<SimManifest, 'every' | 'listen' | 'commands' | 'layers' | 'influences'>): string {
  const when = sim.every ? (sim.every === 1 ? '每年出手' : `每 ${sim.every} 年出手`) : '只在约好的年份出手';
  if (sim.commands?.length) return `${when}，会下令${sim.commands.map(commandText).join('、')}`;
  if (sim.layers?.length) return `${when}，加${sim.layers.length === 1 ? '一' : ` ${sim.layers.length} `}个图层`;
  if (sim.influences?.length) return `${when}；影响${sim.influences.map(influenceText).join('、')}`;
  return when;
}

/** 「滑条 4 个，改过 1 个」「滑条 2 个，都是默认」;没有滑条 = 「没有滑条」 */
export function paramsBrief(spec: Readonly<Record<string, Pick<SimParam, 'default'>>> | undefined, values: Readonly<Record<string, number>> | undefined): string {
  const keys = Object.keys(spec ?? {});
  if (!keys.length) return '没有滑条';
  const changed = keys.filter((k) => values && has(values, k) && values[k] !== spec![k].default).length;
  return `滑条 ${keys.length} 个，${changed ? `改过 ${changed} 个` : '都是默认'}`;
}

/** 选上的几个交到同一个影响口:每个口一句「厌战和宗教生效都会影响宣战的几率，两边的数乘在一起。」(三个以上写「几边」) */
export function sharedNotes(chosen: readonly { name: string; influences?: readonly string[] }[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of chosen)
    for (const k of p.influences ?? []) {
      if (seen.has(k)) continue;
      seen.add(k);
      const who = chosen.filter((q) => q.influences?.includes(k)).map((q) => q.name);
      if (who.length < 2) continue;
      const names = who.length === 2 ? `${who[0]}和${who[1]}` : `${who.slice(0, -1).join('、')}和${who.at(-1)}`;
      const op = OFFICIAL_INFLUENCES.find((x) => x.id === k)?.op === 'add' ? '加在一起' : '乘在一起';
      out.push(`${names}都会影响${influenceText(k)}，${who.length === 2 ? '两' : '几'}边的数${op}。`);
    }
  return out;
}

/** 「推演插件」那一行右边:选上的名字;没选 = 不用 */
export const chosenText = (names: readonly string[]): string => (names.length ? names.join('、') : '不用');

/** 滑条一格多大:作者没写按上下限分 100 格,取个整齐的数 */
export function paramStep(p: Pick<SimParam, 'min' | 'max' | 'step'>): number {
  if (p.step && p.step > 0) return p.step;
  const raw = (p.max - p.min) / 100;
  if (!(raw > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
}

/** 数值框里写几位小数(跟着一格的大小) */
export function paramDigits(step: number): number {
  const s = String(step);
  const e = /e-(\d+)$/.exec(s);
  if (e) return Number(e[1]);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : Math.min(4, s.length - dot - 1);
}
