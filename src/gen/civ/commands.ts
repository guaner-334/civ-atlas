/**
 * 推演插件下的命令(PluginReply.commands):用干预的写法(gen/edits.ts 文件头「干预」那一节),和插件交上来的干预同一套检查
 * (checkIntervention,不替插件改),收下以后接进干预列表、到那一刻和作者下的干预同一套办(interventions.ts)。
 * from 由推演定(插件出手那一刻的下一格),作者人物、照大纲的几样不能带;国家、州、城、民族给读口里的编号(换成稳定键)或稳定键。
 */
import { YEAR_TICKS, isCommand, type Intervention, type InterventionKind } from '../edits';
import { checkIntervention } from '../ivCheck';
import type { CivSim } from './engine/sim';
import { polityModelOf } from './polities';
import { cultureModelOf } from './cultures';
import { commandedList, issueCommands } from './interventions';

/** 插件能下的几种:宣战、结盟、立约(议和)、划州、立国、迁都、灭国、天灾、大迁徙 */
export const COMMAND_KINDS: readonly InterventionKind[] = ['declare', 'ally', 'treaty', 'cede', 'found', 'move', 'destroy', 'disaster', 'trek'];
/** 天灾里能下的几种(全球大疫不行) */
const COMMAND_DISASTERS: readonly string[] = ['plague', 'famine', 'quake'];
/** 推演定的、作者人物和照大纲的:插件不能带 */
const RESERVED = ['from', 'fromTick', 'plugin', 'author', 'plot', 'guide', 'lead'];
/** 一个世界里推演插件一共最多下几条命令 */
export const COMMANDS_MAX = 10_000;

type Ref = 'polity' | 'region' | 'settlement' | 'culture';
/** 哪些字段是国家、州、城、民族(一个或几个) */
const REFS: Readonly<Record<string, Ref>> = { a: 'polity', b: 'polity', by: 'polity', ps: 'polity', region: 'region', to: 'region', zone: 'region', regions: 'region', city: 'settlement', folk: 'culture' };

const isInt = (x: unknown, n: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < n;

/** 读口里的编号 → 稳定键(和 interventions.ts 解析键同一个算法,这一刻解析回来就是它) */
function keyMaker(sim: CivSim): (ref: Ref, x: number) => string | null {
  const pm = polityModelOf(sim)!;
  const reg = pm.terrain.regions;
  const seat = reg.keySeat ?? reg.seat;
  const R = sim.R;
  const at = (r: number) => (r >= 0 && r < seat.length ? `c${seat[r]}` : `r${r}`);
  return (ref, x) => {
    const S = pm.settlements;
    if (ref === 'region') return isInt(x, R) ? `region:${at(x)}` : null;
    if (ref === 'settlement') {
      if (!isInt(x, S.length)) return null;
      let n = 0;
      for (let i = 0; i < x; i++) if (S[i].region === S[x].region) n++;
      return `settlement:${at(S[x].region)}#${n}`;
    }
    if (ref === 'polity') {
      const P = pm.polities;
      if (!isInt(x, P.length)) return null;
      const r = S[P[x].capital]?.region ?? -1;
      let n = 0;
      for (let i = 0; i < x; i++) if ((S[P[i].capital]?.region ?? -1) === r) n++;
      return `polity:${at(r)}#${n}`;
    }
    const C = cultureModelOf(sim)?.cultures ?? pm.cultures;
    if (!isInt(x, C.length)) return null;
    const c = C[x];
    let n = 0;
    for (let i = 0; i < C.length; i++) if (i !== x && C[i].hearth === c.hearth && (C[i].born < c.born || (C[i].born === c.born && i < x))) n++;
    return `culture:${at(c.hearth)}#${n}`;
  };
}

/** 一条命令查过、编号换成键,补上 from、plugin;不合格抛错 */
function commandOf(raw: unknown, plugin: string, at: number, key: (ref: Ref, x: number) => string | null): Intervention {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('要是一个对象');
  const o = raw as Record<string, unknown>;
  if (!COMMAND_KINDS.includes(o.kind as InterventionKind)) throw new Error(`kind 只能是 ${COMMAND_KINDS.join('、')}`);
  for (const k of RESERVED) if (o[k] !== undefined) throw new Error(`不能带 ${k}`);
  if (o.kind === 'disaster' && !COMMAND_DISASTERS.includes(o.type as string)) throw new Error(`天灾的 type 只能是 ${COMMAND_DISASTERS.join('、')}`);
  const from = Math.floor(at);
  const tick = Math.round((at - from) * YEAR_TICKS);
  const c: Record<string, unknown> = {};
  for (const k of Object.keys(o)) {
    const ref = REFS[k];
    const x = o[k];
    const one = (y: unknown, where: string) => {
      if (typeof y !== 'number') return y;
      const s = key(ref, y);
      if (s === null) throw new Error(`${where} 没有编号 ${y}`);
      return s;
    };
    c[k] = ref === undefined ? x : Array.isArray(x) ? x.map((y, i) => one(y, `${k}[${i}]`)) : one(x, k);
  }
  c.from = from;
  if (tick) c.fromTick = tick;
  c.plugin = plugin;
  const r = checkIntervention(c);
  if ('error' in r) throw new Error(r.error);
  return r.ok;
}

/** 规则包收推演插件命令的那一口(PluginBridge.commands) */
export function commandTaker(sim: CivSim, seed: number): (plugin: string, list: readonly unknown[], at: number) => void {
  return (plugin, list, at) => {
    const key = keyMaker(sim);
    const out = list.map((raw, i) => {
      try {
        return commandOf(raw, plugin, at, key);
      } catch (e) {
        throw new Error(`第 ${i} 条:${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    });
    const had = (commandedList(sim) ?? []).reduce((n, v) => n + (isCommand(v) ? 1 : 0), 0);
    if (had + out.length > COMMANDS_MAX) throw new Error(`一个世界里推演插件一共最多下 ${COMMANDS_MAX} 条命令`);
    issueCommands(sim, seed, out);
  };
}
