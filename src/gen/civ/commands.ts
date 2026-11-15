/**
 * 推演插件下的命令(PluginReply.commands):用干预的写法(gen/edits.ts 文件头「干预」那一节),和插件交上来的干预同一套检查
 * (checkIntervention,不替插件改),收下以后接进干预列表、到那一刻和作者下的干预同一套办(interventions.ts)。
 * from 由推演定(插件出手那一刻的下一格),作者人物、照大纲的几样不能带;国家、州、城、民族给读口里的编号(换成稳定键)或稳定键。
 */
import { YEAR_TICKS, isCommand, keyByRegion, regionOfKey, type Intervention, type InterventionKind } from '../edits';
import { checkIntervention } from '../ivCheck';
import type { CivSim } from './engine/sim';
import type { PluginRefused } from './engine/plugin';
import { Layer, type Polity } from './types';
import { fpow, keyed } from './engine/rand';
import { canCross, polityModelOf } from './polities';
import { cultureModelOf } from './cultures';
import { GROWTH_A, capitalAt, populationAt } from './growth';
import { civApi } from './api';
import { POLITICS_KNOBS } from './politics';
import { treatyModelOf, type Treaty, type Zone } from './treaties';
import { warModelOf } from './wars';
import { commandedList, interventionModelOf, issueCommands, type InterventionModel } from './interventions';

/**
 * 插件能下的几种:宣战、结盟、立约(议和)、划州、立国、迁都、灭国、天灾、大迁徙;划中立地、推一把发展;
 * 不许灭、禁止分裂、不许扩张、保住王室、不许迁;停战、称臣、放藩、断盟、废约、撤中立地、建城、改朝换代、分裂、改民族
 */
export const COMMAND_KINDS: readonly InterventionKind[] = [
  ...['declare', 'ally', 'treaty', 'cede', 'found', 'move', 'destroy', 'disaster', 'trek', 'neutral', 'boost'] as const,
  ...['protect', 'unity', 'halt', 'keep', 'stay'] as const,
  ...['peace', 'submit', 'release', 'unally', 'annul', 'unzone', 'city', 'dynasty', 'secede', 'convert'] as const,
];
/** 挡下插件命令的作者干预(PluginTurn.refused 的 why):不许灭、禁止分裂、不许扩张、结盟、不许迁、保住王室、立约、划中立地 */
export const REFUSE_REASONS = ['protect', 'unity', 'halt', 'ally', 'stay', 'keep', 'treaty', 'neutral'] as const;
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

/** 约(treaty)/ 中立地(neutral)war 是作者下令立的:它那条 cause = decree 的史事往前、同一刻最近的 intervene 是作者的干预 */
function authorDecreed(sim: CivSim, iv: InterventionModel, kind: 'treaty' | 'neutral', war: number): boolean {
  for (let k = sim.annalCount - 1; k >= 0; k--) {
    const e = sim.annal(k);
    if (e.kind !== kind || e.war !== war || e.cause !== 'decree') continue;
    for (let j = k - 1; j >= 0 && sim.annal(j).year === e.year; j--) {
      const d = sim.annal(j);
      if (d.kind === 'intervene') return !!iv.list[d.war] && !isCommand(iv.list[d.war]);
    }
    return false;
  }
  return false;
}

/**
 * 作者的干预在 t 那一刻挡下哪几条命令(挡它的干预种类,没挡 = null);插件下的否决类不挡命令。
 * 这一格收下的命令按先后办,州归谁要照前面收下的(别的插件的、这一批前面的)推着看:不然先划过去再立国、一次划两州就绕过了禁止分裂、不许灭
 */
function refusals(sim: CivSim, iv: InterventionModel, list: readonly Intervention[], t: number): (RefuseReason | null)[] {
  const pm = iv.pm!;
  const P = pm.polities;
  const owner = sim.owners[Layer.Polity];
  const peopled = sim.owners[Layer.Culture];
  /** 前面收下的命令办完以后归属变了的州 → 新主(−1 = 无主)、这一刻归属换过的州、亡了的国 */
  const moved = new Map<number, number>();
  const changed = new Set<number>();
  const dead = new Set<number>();
  /** 前面收下的立国、分裂立出来的新国:按州定位的键 → 编号(接着现有的国往后排,同推演里立国);国家编号 → 换过的国都所在州 */
  const born = new Map<string, number>();
  const capAt = new Map<number, number>();
  /** 前面收下的立国、分裂一共立出几国;建了城的州与城键;在效的约与新划 / 新撤的中立地;新收下的永久划州 */
  let made = 0;
  const built = new Set<number>();
  const builtKey = new Map<string, number>();
  const tm = treatyModelOf(sim);
  interface ProjTreaty {
    raw: Treaty | null;
    parties: readonly number[];
    out: Set<number>;
    hadZone: boolean;
    zoneRegion: number;
    ended: boolean;
  }
  const zoned = new Map<number, { owner: number; lasting: boolean }>();
  const unzoned = new Set<number>();
  const liveTreaties: ProjTreaty[] = tm
    ? tm.live.map((x) => ({
        raw: x,
        parties: x.parties,
        out: new Set(),
        hadZone: x.zone >= 0,
        zoneRegion: x.zone >= 0 && tm.zones[x.zone].ended === undefined ? tm.zones[x.zone].region : -1,
        ended: false,
      }))
    : [];
  const permCedes: { region: number; by: number }[] = [];
  const wm = warModelOf(sim);
  let wars = (wm?.active ?? []).map((w) => ({ a: w.a, b: w.b }));
  const endWar = (fn: (w: { a: number; b: number }) => boolean) => {
    wars = wars.filter((w) => !fn(w));
  };
  const settle = pm.knobs.get(POLITICS_KNOBS).SETTLE;
  const reg = pm.terrain.regions;
  const who = (k: string) => {
    const p = iv.resolve(k);
    if (p >= 0) return p;
    const q = keyByRegion(k, iv.of);
    return q === null ? -1 : (born.get(q) ?? -1);
  };
  const birth = (r: number) => {
    const id = P.length + made++;
    let n = 0;
    while (who(`polity:r${r}#${n}`) >= 0) n++;
    born.set(`polity:${r}#${n}`, id);
    capAt.set(id, r);
    return id;
  };
  const capOf = (p: number) => (p < 0 ? -1 : capAt.get(p) ?? (p < P.length ? (pm.settlements[capitalAt(P[p], t)]?.region ?? -1) : -1));
  const polOf = (p: number): Polity => {
    if (p < P.length) return P[p];
    const cr = capOf(p);
    const cu = cr >= 0 ? peopled[cr] : -1;
    return { kind: cu >= 0 ? pm.cultures[cu].kind : 'plain' } as Polity;
  };
  const cityRegionOf = (k: string) => {
    const sid = iv.resolveCity(k);
    if (sid >= 0) return pm.settlements[sid].ended === undefined ? pm.settlements[sid].region : -1;
    const q = keyByRegion(k, iv.of);
    return q === null ? -1 : (builtKey.get(q) ?? -1);
  };
  const addCity = (r: number) => {
    if (!pm.terrain.habitable[r] || pm.cityOf[r] >= 0 || built.has(r)) return;
    built.add(r);
    let n = 0;
    while (iv.resolveCity(`settlement:r${r}#${n}`) >= 0 || cityRegionOf(`settlement:r${r}#${n}`) >= 0) n++;
    builtKey.set(`settlement:${r}#${n}`, r);
  };
  const alive = (p: number) => p >= 0 && !dead.has(p) && (p >= P.length || P[p].ended === undefined);
  const ownerOf = (r: number) => moved.get(r) ?? owner[r];
  const move = (r: number, to: number) => {
    if (ownerOf(r) === to) return;
    moved.set(r, to);
    changed.add(r);
  };
  const lockedOf = (r: number) => {
    const o = ownerOf(r);
    if (o < 0) return false;
    if (permCedes.some((x) => x.region === r && x.by === o)) return true;
    return iv.list.some((v) => v.kind === 'cede' && v.permanent === true && t >= v.from && regionOfKey(v.region, iv.of) === r && who(v.a) === o);
  };
  const landsOf = (o: number) => {
    const out = (pm.lands[o] ?? []).filter((q) => ownerOf(q) === o);
    for (const [q, x] of moved) if (x === o && owner[q] !== o) out.push(q);
    return out;
  };
  const regionOf = (k: string) => {
    const r = regionOfKey(k, iv.of);
    return r >= 0 && r < sim.R && peopled[r] >= 0 ? r : -1;
  };
  const cityPopAt = (r: number) => {
    const c = pm.cityOf[r];
    if (c >= 0) return populationAt(pm.settlements[c], t);
    if (!built.has(r)) return -1;
    const { CAP_REF, CAP_EXP, PORT_CAP, RIVER_CAP } = pm.k;
    const T = pm.terrain;
    let cap = CAP_REF * fpow(T.regions.capacity[r] / pm.capNorm, CAP_EXP);
    if (pm.port[r]) cap *= PORT_CAP;
    if (T.riverSeat[r]) cap *= RIVER_CAP;
    cap *= 0.8 + 0.45 * keyed(pm.base, T.regions.seat[r], 2);
    if (pm.capFactor) cap *= pm.cityCapOf ? pm.cityCapOf(r) : pm.capFactor[r];
    return cap / (1 + GROWTH_A);
  };
  const cutOffOf = (pid: number, cap: number, rs: number[]): number[] | null => {
    if (!civApi(sim).politics.cutOff) return rs;
    const pol = P[pid];
    if (cap < 0 || ownerOf(cap) !== pid) return rs;
    const bfs = (skip?: ReadonlySet<number>) => {
      const seen = new Set<number>([cap]);
      const q = [cap];
      for (let h = 0; h < q.length; h++) {
        const r = q[h];
        for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
          const j = reg.adj[k];
          if (seen.has(j) || skip?.has(j) || ownerOf(j) !== pid || !canCross(pm, pol, reg.adjKind[k], t)) continue;
          seen.add(j);
          q.push(j);
        }
      }
      return seen;
    };
    const core = bfs();
    const inG = new Set(rs);
    const reach = bfs(inG);
    const out = rs.slice();
    for (const r of core) {
      if (reach.has(r) || inG.has(r)) continue;
      if ((wm && t - (changed.has(r) ? t : wm.since[r]) < settle) || lockedOf(r)) return null;
      out.push(r);
    }
    return out.sort((x, y) => x - y);
  };
  /** 国家 o 再丢了州 r 就没有带城的州了(国都所在州丢了,没处迁都) */
  const ends = (o: number, r: number) => !landsOf(o).some((q) => q !== r && (pm.cityOf[q] >= 0 || built.has(q)));
  /** 这条命令让州的主人丢掉它(划给别国、在那里立国):[原主, 州, 得到它的];不丢 = null */
  const loss = (v: Intervention): [number, number, number] | null => {
    if (v.kind !== 'cede' && v.kind !== 'found') return null;
    const r = regionOf(v.region);
    const o = r >= 0 ? ownerOf(r) : -1;
    const by = v.kind === 'found' ? P.length + made : who(v.a);
    if (r < 0 || o === by || (v.kind === 'cede' && !alive(by))) return null;
    return [o, r, by];
  };
  const bordersOf = (x: number, y: number) => {
    const px = polOf(x);
    for (const r of landsOf(x)) {
      for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) if (ownerOf(reg.adj[k]) === y && canCross(pm, px, reg.adjKind[k], t)) return true;
    }
    return false;
  };
  const isZone = (r: number) => zoned.has(r) || ((tm?.zoneAt[r] ?? -1) >= 0 && !unzoned.has(r));
  const inTreaty = (pt: ProjTreaty, p: number) => !pt.ended && !pt.out.has(p) && alive(p) && (pt.raw ? tm!.member(pt.raw, p) : pt.parties.includes(p));
  const zoneOkProj = (r: number, ps: readonly number[]) => {
    if (r < 0 || isZone(r) || lockedOf(r)) return false;
    const o = ownerOf(r);
    if (o >= 0 && !ps.includes(o)) return false;
    return !(o >= 0 && capOf(o) === r);
  };
  const dropZoneAt = (r: number) => {
    if (!tm) return;
    let prev = -1;
    if (zoned.has(r)) {
      prev = zoned.get(r)!.owner;
      zoned.delete(r);
    } else if (tm.zoneAt[r] >= 0 && !unzoned.has(r) && tm.zones[tm.zoneAt[r]].ended === undefined) {
      prev = tm.zones[tm.zoneAt[r]].owner;
      unzoned.add(r);
    } else return;
    for (const pt of liveTreaties) if (pt.zoneRegion === r) pt.zoneRegion = -1;
    const back = tm.backOf?.({ region: r, owner: prev } as Zone, ownerOf) ?? -1;
    if (back >= 0 && alive(back)) move(r, back);
  };
  const apply = (v: Intervention, ivIdx: number) => {
    if (v.kind === 'destroy') {
      const a = who(v.a);
      const b = v.b !== undefined ? who(v.b) : -1;
      if (!alive(a)) return;
      for (const q of landsOf(a)) move(q, alive(b) && b !== a ? b : -1);
      dead.add(a);
      endWar((w) => w.a === a || w.b === a);
      return;
    }
    if (v.kind === 'city') {
      const r = regionOf(v.region);
      if (r >= 0) addCity(r);
      return;
    }
    if (v.kind === 'move') {
      const a = who(v.a);
      const cr = cityRegionOf(v.city);
      if (alive(a) && cr >= 0 && ownerOf(cr) === a) capAt.set(a, cr);
      return;
    }
    if (v.kind === 'peace' || v.kind === 'ally') {
      const a = who(v.a);
      const b = who(v.b);
      if (a >= 0 && b >= 0 && a !== b && alive(a) && alive(b)) endWar((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
      return;
    }
    if (v.kind === 'halt') {
      const a = who(v.a);
      if (alive(a)) endWar((w) => w.a === a);
      return;
    }
    if (v.kind === 'declare') {
      const a = who(v.a);
      const b = who(v.b);
      if (!wm || !alive(a) || !alive(b) || a === b || wars.some((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a)) || !bordersOf(a, b)) return;
      wars.push({ a, b });
      if (!tm) return;
      for (const x of liveTreaties) {
        if (!inTreaty(x, a) || !inTreaty(x, b)) continue;
        x.out.add(a);
        const r = x.zoneRegion;
        if (r >= 0) {
          const lasting = zoned.has(r) ? zoned.get(r)!.lasting : tm.zoneAt[r] >= 0 && tm.zones[tm.zoneAt[r]].lasting;
          if (!lasting) dropZoneAt(r);
        }
        if (x.parties.filter((p) => inTreaty(x, p)).length < 2) x.ended = true;
      }
      return;
    }
    if (v.kind === 'treaty' || v.kind === 'neutral') {
      const a = who(v.a);
      if (!tm || !alive(a)) return;
      const others: number[] = [];
      for (const k of v.ps) {
        const q = who(k);
        if (q >= 0 && q !== a && alive(q) && !others.includes(q)) others.push(q);
      }
      if (!others.length) return;
      const yes = v.ask ? others.filter((q) => a < P.length && q < P.length && !!tm.willing?.(a, q, t, ivIdx)) : others;
      if (!yes.length) return;
      const parties = [a, ...yes];
      if (v.kind === 'treaty') {
        const r = v.zone !== undefined ? regionOf(v.zone) : -1;
        const z = zoneOkProj(r, parties) ? r : -1;
        if (z >= 0) {
          const o = ownerOf(z);
          zoned.set(z, { owner: o, lasting: false });
          if (o >= 0) move(z, -1);
        }
        liveTreaties.push({ raw: null, parties, out: new Set(), hadZone: z >= 0, zoneRegion: z, ended: false });
        endWar((w) => parties.includes(w.a) && parties.includes(w.b));
        return;
      }
      const r = regionOf(v.region);
      if (!zoneOkProj(r, parties)) return;
      const o = ownerOf(r);
      zoned.set(r, { owner: o, lasting: !!v.lasting });
      if (o >= 0) move(r, -1);
      const x = liveTreaties.find((y) => !y.ended && !y.hadZone && parties.every((p) => inTreaty(y, p)));
      if (x) {
        x.hadZone = true;
        x.zoneRegion = r;
      } else {
        liveTreaties.push({ raw: null, parties, out: new Set(), hadZone: true, zoneRegion: r, ended: false });
        endWar((w) => parties.includes(w.a) && parties.includes(w.b));
      }
      return;
    }
    if (v.kind === 'unzone' || v.kind === 'annul') {
      // 撤了的中立地(废约连带撤的也算)还给原主:后面在那州立国、划走照原主挡
      if (!tm) return;
      if (v.kind === 'unzone') {
        const r = regionOf(v.region);
        if (r >= 0) dropZoneAt(r);
        return;
      }
      const a = who(v.a);
      const b = who(v.b);
      if (a < 0 || b < 0 || a === b || !alive(a) || !alive(b)) return;
      for (const x of liveTreaties) {
        if (!inTreaty(x, a) || !inTreaty(x, b)) continue;
        x.ended = true;
        const r = x.zoneRegion;
        if (r < 0) continue;
        const lasting = zoned.has(r) ? zoned.get(r)!.lasting : tm.zoneAt[r] >= 0 && tm.zones[tm.zoneAt[r]].lasting;
        if (!lasting) dropZoneAt(r);
      }
      return;
    }
    if (v.kind === 'secede') {
      const a = who(v.a);
      if (!alive(a) || a >= P.length) return;
      const cap = capOf(a);
      const rs = [...new Set(v.regions.map(regionOf))].filter((r) => r >= 0 && r !== cap && ownerOf(r) === a && !lockedOf(r)).sort((x, y) => x - y);
      if (!rs.length) return;
      const group = cutOffOf(a, cap, rs) ?? rs;
      let seat = -1;
      let best = -1;
      for (const r of group) {
        const pop = cityPopAt(r);
        if (pop > best) {
          best = pop;
          seat = r;
        }
      }
      if (seat < 0) return;
      const id = birth(seat);
      for (const r of group) move(r, id);
      return;
    }
    const x = loss(v);
    if (v.kind === 'found') {
      const r = regionOfKey(v.region, iv.of);
      if (r >= 0 && r < sim.R && (peopled[r] >= 0 || pm.terrain.habitable[r])) {
        addCity(r);
        birth(r);
      }
    }
    if (!x) return;
    const [o, r, by] = x;
    if (v.kind === 'cede' && v.permanent) permCedes.push({ region: r, by });
    if (o >= 0 && ends(o, r)) {
      for (const q of landsOf(o)) move(q, by);
      dead.add(o);
      endWar((w) => w.a === o || w.b === o);
    }
    move(r, by);
  };
  for (const i of iv.commandsAt(t)) apply(iv.list[i], i);
  const blocked = (v: Intervention): RefuseReason | null => {
    if (v.kind === 'destroy') {
      const a = who(v.a);
      if (a >= 0 && iv.protects(a, t, true)) return 'protect';
      const b = v.b !== undefined ? who(v.b) : -1;
      return alive(a) && alive(b) && b !== a && iv.halted(b, t, true) ? 'halt' : null;
    }
    if (v.kind === 'cede' || v.kind === 'found') {
      const x = loss(v);
      if (!x) return null;
      const [o, r, by] = x;
      if (o >= 0 && iv.protects(o, t, true) && ends(o, r)) return 'protect';
      // 立国立出来的是新国,不归哪一国,不算谁扩张
      if (v.kind === 'cede') return iv.halted(by, t, true) ? 'halt' : null;
      return o >= 0 && iv.unites(o, t, true) ? 'unity' : null;
    }
    if (v.kind === 'declare') {
      const a = iv.resolve(v.a);
      const b = iv.resolve(v.b);
      if (a < 0) return null;
      if (iv.halted(a, t, true)) return 'halt';
      return b >= 0 && iv.allied(a, b, t, true) ? 'ally' : null;
    }
    if (v.kind === 'trek') {
      const cultures = cultureModelOf(sim)?.cultures ?? pm.cultures;
      const c = iv.resolveCulture(v.folk, cultures);
      return c >= 0 && iv.stays(c, t, cultures, true) ? 'stay' : null;
    }
    if (v.kind === 'unally') {
      const a = who(v.a);
      const b = who(v.b);
      return a >= 0 && b >= 0 && iv.allied(a, b, t, true) ? 'ally' : null;
    }
    if (v.kind === 'submit') {
      const b = who(v.b);
      return b >= 0 && iv.halted(b, t, true) ? 'halt' : null;
    }
    if (v.kind === 'secede') {
      const a = who(v.a);
      return a >= 0 && iv.unites(a, t, true) ? 'unity' : null;
    }
    if (v.kind === 'dynasty') {
      const a = who(v.a);
      return a >= 0 && iv.keeps(a, t, -1, true) >= 0 ? 'keep' : null;
    }
    if (v.kind === 'annul') {
      const tm = treatyModelOf(sim);
      const a = who(v.a);
      const b = who(v.b);
      if (!tm || a < 0 || b < 0) return null;
      const xs = tm.live.filter((x) => tm.member(x, a) && tm.member(x, b));
      if (xs.some((x) => authorDecreed(sim, iv, 'treaty', x.id))) return 'treaty';
      // 约废了连带撤的中立地是作者划的:同撤中立地
      const zoneOf = (x: (typeof xs)[number]) => (x.zone >= 0 && tm.zones[x.zone].ended === undefined && !tm.zones[x.zone].lasting ? x.zone : -1);
      return xs.some((x) => zoneOf(x) >= 0 && authorDecreed(sim, iv, 'neutral', zoneOf(x))) ? 'neutral' : null;
    }
    if (v.kind === 'unzone') {
      const r = regionOf(v.region);
      const z = r >= 0 ? (treatyModelOf(sim)?.zoneAt[r] ?? -1) : -1;
      return z >= 0 && authorDecreed(sim, iv, 'neutral', z) ? 'neutral' : null;
    }
    return null;
  };
  let nextIv = iv.list.length;
  return list.map((v) => {
    const why = blocked(v);
    if (!why) apply(v, nextIv++);
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
