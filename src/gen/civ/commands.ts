/**
 * 推演插件下的命令(PluginReply.commands):用干预的写法(gen/edits.ts 文件头「干预」那一节),和插件交上来的干预同一套检查
 * (checkIntervention,不替插件改),收下以后接进干预列表、到那一刻和作者下的干预同一套办(interventions.ts)。
 * from 由推演定(插件出手那一刻的下一格),作者人物、照大纲的几样不能带;国家、州、城、民族给读口里的编号(换成稳定键)或稳定键。
 */
import { YEAR_TICKS, isCommand, regionOfKey, type Intervention, type InterventionKind } from '../edits';
import { checkIntervention } from '../ivCheck';
import type { CivSim } from './engine/sim';
import type { PluginRefused } from './engine/plugin';
import { Layer } from './types';
import { polityModelOf } from './polities';
import { cultureModelOf } from './cultures';
import { commandedList, interventionModelOf, issueCommands, type InterventionModel } from './interventions';

/** 插件能下的几种:宣战、结盟、立约(议和)、划州、立国、迁都、灭国、天灾、大迁徙 */
export const COMMAND_KINDS: readonly InterventionKind[] = ['declare', 'ally', 'treaty', 'cede', 'found', 'move', 'destroy', 'disaster', 'trek'];
/** 挡下插件命令的作者干预(PluginTurn.refused 的 why):不许灭、禁止分裂、不许扩张、结盟、不许迁 */
export const REFUSE_REASONS = ['protect', 'unity', 'halt', 'ally', 'stay'] as const;
export type RefuseReason = (typeof REFUSE_REASONS)[number];
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

/**
 * 作者的干预在 t 那一刻挡下哪几条命令(挡它的干预种类,没挡 = null)。插件下不了 protect、unity、halt、stay,查到的这几样都是作者的。
 * 这一格收下的命令按先后办,州归谁要照前面收下的(别的插件的、这一批前面的)推着看:不然先划过去再立国、一次划两州就绕过了禁止分裂、不许灭
 */
function refusals(sim: CivSim, iv: InterventionModel, list: readonly Intervention[], t: number): (RefuseReason | null)[] {
  const pm = iv.pm!;
  const owner = sim.owners[Layer.Polity];
  const peopled = sim.owners[Layer.Culture];
  /** 前面收下的命令办完以后归属变了的州 → 新主(−1 = 无主,NEW = 立国立出来的新国)、亡了的国 */
  const moved = new Map<number, number>();
  const dead = new Set<number>();
  const alive = (p: number) => p >= 0 && !dead.has(p) && pm.polities[p].ended === undefined;
  const NEW = -2;
  const ownerOf = (r: number) => moved.get(r) ?? owner[r];
  const landsOf = (o: number) => {
    const out = pm.lands[o].filter((q) => ownerOf(q) === o);
    for (const [q, x] of moved) if (x === o && owner[q] !== o) out.push(q);
    return out;
  };
  const regionOf = (k: string) => {
    const r = regionOfKey(k, iv.of);
    return r >= 0 && r < sim.R && peopled[r] >= 0 ? r : -1;
  };
  /** 国家 o 再丢了州 r 就没有带城的州了(国都所在州丢了,没处迁都) */
  const ends = (o: number, r: number) => !landsOf(o).some((q) => q !== r && pm.cityOf[q] >= 0);
  /** 这条命令让州的主人丢掉它(划给别国、在那里立国):[原主, 州, 得到它的];不丢 = null */
  const loss = (v: Intervention): [number, number, number] | null => {
    if (v.kind !== 'cede' && v.kind !== 'found') return null;
    const r = regionOf(v.region);
    const o = r >= 0 ? ownerOf(r) : -1;
    const by = v.kind === 'found' ? NEW : iv.resolve(v.a);
    if (r < 0 || o === by || (v.kind === 'cede' && !alive(by))) return null;
    return [o, r, by];
  };
  const apply = (v: Intervention) => {
    if (v.kind === 'destroy') {
      const a = iv.resolve(v.a);
      const b = v.b !== undefined ? iv.resolve(v.b) : -1;
      if (!alive(a)) return;
      for (const q of landsOf(a)) moved.set(q, alive(b) && b !== a ? b : -1);
      dead.add(a);
      return;
    }
    const x = loss(v);
    if (!x) return;
    const [o, r, by] = x;
    if (o >= 0 && ends(o, r)) {
      for (const q of landsOf(o)) moved.set(q, by);
      dead.add(o);
    }
    moved.set(r, by);
  };
  for (const i of iv.commandsAt(t)) apply(iv.list[i]);
  const blocked = (v: Intervention): RefuseReason | null => {
    if (v.kind === 'destroy') {
      const a = iv.resolve(v.a);
      return a >= 0 && iv.protects(a, t) ? 'protect' : null;
    }
    if (v.kind === 'cede' || v.kind === 'found') {
      const x = loss(v);
      const o = x ? x[0] : -1;
      if (o < 0) return null;
      if (iv.protects(o, t) && ends(o, x![1])) return 'protect';
      return v.kind === 'found' && iv.unites(o, t) ? 'unity' : null;
    }
    if (v.kind === 'declare') {
      const a = iv.resolve(v.a);
      const b = iv.resolve(v.b);
      if (a < 0) return null;
      if (iv.halted(a, t)) return 'halt';
      return b >= 0 && iv.allied(a, b, t, true) ? 'ally' : null;
    }
    if (v.kind === 'trek') {
      const cultures = cultureModelOf(sim)?.cultures ?? pm.cultures;
      const c = iv.resolveCulture(v.folk, cultures);
      return c >= 0 && iv.stays(c, t, cultures) ? 'stay' : null;
    }
    return null;
  };
  return list.map((v) => {
    const why = blocked(v);
    if (!why) apply(v);
    return why;
  });
}

/** 规则包收推演插件命令的那一口(PluginBridge.commands):作者的干预挡下的不收、不记,交回去下一回合告诉插件 */
export function commandTaker(sim: CivSim, seed: number): (plugin: string, list: readonly unknown[], at: number) => PluginRefused[] {
  return (plugin, list, at) => {
    const key = keyMaker(sim);
    const all = list.map((raw, i) => {
      try {
        return commandOf(raw, plugin, at, key);
      } catch (e) {
        throw new Error(`第 ${i} 条:${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    });
    const iv = interventionModelOf(sim);
    const whys = iv ? refusals(sim, iv, all, at) : [];
    const refused: PluginRefused[] = [];
    const out = all.filter((v, i) => {
      const why = whys[i];
      if (why) refused.push({ kind: v.kind, index: i, why });
      return !why;
    });
    const had = (commandedList(sim) ?? []).reduce((n, v) => n + (isCommand(v) ? 1 : 0), 0);
    if (had + out.length > COMMANDS_MAX) throw new Error(`一个世界里推演插件一共最多下 ${COMMANDS_MAX} 条命令`);
    if (out.length) issueCommands(sim, seed, out);
    return refused;
  };
}
