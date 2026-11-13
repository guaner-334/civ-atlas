/**
 * 推演插件的命令里引擎现成的几样动作(干预 peace、submit、release、unally、annul、unzone、city、dynasty、secede、convert,
 * 只有推演插件下得了;字段见 gen/edits.ts 文件头"干预"):interventions.ts 在命令生效那一刻调这里。
 * 先记 intervene(各列见 types.ts「intervene 各种类的字段」),紧跟着记它引起的史事;接着推照史事重建。纯计算,不碰 DOM。
 */
import { regionOfKey, type CommandOnlyKind, type Intervention } from '../edits';
import { Layer, type Year } from './types';
import type { CivSim } from './engine/sim';
import type { InterventionModel } from './interventions';
import { foundCity, type PolityModel } from './polities';
import { capitalAt } from './growth';
import { warModelOf } from './wars';
import { diplomacyModelOf } from './diplomacy';
import { treatyModelOf } from './treaties';
import { dynastyModelOf } from './dynasty';
import { assimModelOf } from './assimilation';
import { CITIES_KNOBS } from './cities';
import { royalAt } from './regime';
import { IV_NO_THRONE } from './regents';
import { IV_PROTECTED } from './rulers';
import { civApi } from './api';

export type ActIv = Extract<Intervention, { kind: CommandOnlyKind }>;

/** 史事 intervene 的 b:这州不是中立地 / 州里已有城 / 没有能分出去的州 / 分出去的州里没有城 / 那州本来就是这一族 */
export const IV_NOT_ZONE = -21;
export const IV_HAS_CITY = -22;
export const IV_NO_LAND = -23;
export const IV_NO_CITY = -24;
export const IV_SAME = -25;

/** 改朝换代取随机数的"第几次":这里往上 + 干预下标,和看王朝、多看一眼的错开 */
const CMD_K = 1 << 26;

/** 挂上几样动作(installInterventions 调);返回办第 i 条的函数 */
export function commandActs(sim: CivSim, iv: InterventionModel, pm: PolityModel): (v: ActIv, i: number, t: Year) => void {
  const api = civApi(sim);
  const owner = sim.owners[Layer.Polity];
  const culture = sim.owners[Layer.Culture];
  const S = pm.settlements;
  const R = pm.terrain.R;
  const alive = (p: number) => p >= 0 && pm.polities[p].ended === undefined;
  /** 国家 p 此刻的国都所在州、国都(记 intervene 用) */
  const seat = (p: number, t: Year) => {
    const sid = capitalAt(pm.polities[p], t);
    return { region: S[sid]?.region ?? -1, settlement: sid };
  };
  const note = (i: number, a: number, b: number, at: { region: number; settlement: number }, n?: number) =>
    sim.record('intervene', { a, b, ...at, war: i, ...(n !== undefined ? { n } : {}) });
  const fighting = (a: number, b: number) => (warModelOf(sim)?.active ?? []).filter((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
  /** 州键 → 州号(指不到 = −1) */
  const regionOf = (k: string) => {
    const r = regionOfKey(k, iv.of);
    return r >= 0 && r < R ? r : -1;
  };
  const place = (r: number) => ({ region: r, settlement: r >= 0 ? pm.cityOf[r] : -1 });

  /** 两国之间的几样:a、b = 两国此刻的编号 */
  const pair = (v: Extract<ActIv, { kind: 'peace' | 'submit' | 'unally' | 'annul' }>, i: number, a: number, b: number, t: Year) => {
    const at = seat(a, t);
    const both = b >= 0 && b !== a && alive(a) && alive(b);
    if (v.kind === 'peace') {
      const ws = both ? fighting(a, b) : [];
      note(i, a, b, at, ws.length);
      for (const w of ws) api.war.makePeace!(w, t);
      return;
    }
    if (v.kind === 'submit') {
      const dm = diplomacyModelOf(sim);
      const ok = both && !!dm && dm.liegeOf(a) < 0 && dm.liegeOf(b) < 0;
      note(i, a, b, at, ok ? 1 : 0);
      if (!ok) return;
      // 和宗主正在打的先罢兵(同战败称臣)
      for (const w of fighting(a, b)) api.war.makePeace!(w, t);
      api.diplomacy.swear!(a, b, t);
      return;
    }
    if (v.kind === 'unally') {
      const pact = both ? diplomacyModelOf(sim)?.pactOf(a, b) : undefined;
      const cut = both && iv.commandAllied(a, b, t, i);
      note(i, a, b, at, pact || cut ? 1 : 0);
      if (pact) api.diplomacy.note!('unally', { a, b, cause: 'decree' });
      return;
    }
    const tm = treatyModelOf(sim);
    const xs = both && tm ? tm.live.filter((x) => tm.member(x, a) && tm.member(x, b)) : [];
    note(i, a, b, at, xs.length);
    for (const x of xs) tm!.annul!(x, t);
  };

  return (v, i, t) => {
    if (v.kind === 'unzone') {
      const r = regionOf(v.region);
      const tm = treatyModelOf(sim);
      const z = r >= 0 && tm ? tm.zoneAt[r] : -1;
      note(i, -1, r < 0 ? -2 : z < 0 ? IV_NOT_ZONE : -1, place(r));
      if (z >= 0) tm!.unzone!(tm!.zones[z], t);
      return;
    }
    if (v.kind === 'city') {
      const r = regionOf(v.region);
      if (r < 0 || culture[r] < 0 || !pm.terrain.habitable[r]) return note(i, r >= 0 ? owner[r] : -1, -2, place(r));
      if (pm.cityOf[r] >= 0) return note(i, owner[r], IV_HAS_CITY, place(r));
      // 故城遗址上的算重建(同立国)
      let ruin = -1;
      for (const s of S) if (s.region === r && s.ended !== undefined) ruin = s.id;
      const s = foundCity(sim, pm, r, t, ruin >= 0 ? { of: ruin, growth: pm.knobs.get(CITIES_KNOBS).REBUILD_GROWTH } : undefined);
      note(i, owner[r], -1, { region: r, settlement: s.id });
      return;
    }
    if (v.kind === 'convert') {
      const cultures = assimModelOf(sim)?.cultures ?? pm.cultures;
      const c = iv.resolveCulture(v.folk, cultures);
      if (c < 0) return;
      const r = regionOf(v.region);
      const at = place(r);
      const b = r < 0 || culture[r] < 0 ? -2 : cultures[c].ended !== undefined ? -3 : culture[r] === c ? IV_SAME : -1;
      note(i, -1, b, at, c);
      if (b === -1) assimModelOf(sim)?.convert?.(r, c, owner[r], t);
      return;
    }
    const a = iv.resolve(v.a);
    if (a < 0) return;
    if (v.kind === 'peace' || v.kind === 'submit' || v.kind === 'unally' || v.kind === 'annul') return pair(v, i, a, iv.resolve(v.b), t);
    const at = seat(a, t);
    if (!alive(a)) return note(i, a, -3, at);
    if (v.kind === 'release') {
      const L = diplomacyModelOf(sim)?.liegeOf(a) ?? -1;
      note(i, a, L, at);
      if (L >= 0) api.diplomacy.note!('defect', { a, b: L, ...at, cause: 'decree' });
      return;
    }
    if (v.kind === 'dynasty') {
      const P = pm.polities[a];
      // 同一刻后下的保住王室护着它(后下的为准,同作者下令的篡位)
      const b = !royalAt(P, t) ? IV_NO_THRONE : iv.keeps(a, t, i) >= 0 ? IV_PROTECTED : -1;
      note(i, a, b, at);
      if (b === -1) dynastyModelOf(sim)?.force?.(a, CMD_K + i, v.region ? regionOf(v.region) : -1, t);
      return;
    }
    // 分裂:a 的、不是国都、没被永久划给它的那几州,连同因此和国都断开的碎块;国都 = 其中人口最多的城
    const capR = at.region;
    const rs = [...new Set(v.regions.map(regionOf))].filter((r) => r >= 0 && owner[r] === a && r !== capR && !iv.locked(r, t)).sort((x, y) => x - y);
    const sid = rs.length ? (api.politics.biggestCity?.(rs, t) ?? -1) : -1;
    if (sid < 0) return note(i, a, rs.length ? IV_NO_CITY : IV_NO_LAND, at);
    const group = api.politics.cutOff?.(a, rs, t, Infinity) ?? rs;
    const r = S[sid].region;
    note(i, a, pm.polities.length, { region: r, settlement: sid }, group.length);
    api.politics.secede!(a, group, sid, r, t, 'split', 'decree', v.name ? { name: v.name } : undefined);
  };
}
