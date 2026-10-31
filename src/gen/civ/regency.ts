/**
 * 掌实权的人在推演里什么时候办(规则、候选、结局在 regents.ts):挂在同一个推演引擎(sim.ts)上,
 * 记史事 regent(掌权、还政、伏诛、篡位、卒),登记进 PolityModel.regents(扩张算账、打仗、议和、邦交、议事照掌权的人的倾向,见 polities.ts 的 effOf)。
 *
 * 流程(index.ts 在 installCouncil 之后调用 installRegency):
 *   - 君主即位那一刻(polities.ts 的 afterReign;开国之君在立国拿到第一州那一刻):他晚年的引兵入朝、太子监国的候选(regents.ts 的 latePlans)
 *     各预约一次 Ev.Regency;继位的幼主当即定摄政 / 辅政(childPlan),掌权、预约结局那一刻
 *   - Ev.Regency(到了那一刻,b = 国家):先办到期的结局(还掌着权才办):
 *       还政 / 伏诛 / 卒:记一条 regent;
 *       叔父篡位:Polity.seizes 加一条(在位表里幼主那一刻下台、叔父接着在位),预约叔父的即位(Ev.Reign);
 *       名臣、大臣篡位:改朝换代(Polity.dynasties 加一条,新朝起于国都、第一位就是他,见 rulers.ts),先记 regent 再记 dynasty;
 *       那一刻这国有干预「保住王室」护着(interventions.ts 的 keeps;结局是掌权时定的,挡不挡在这一刻现查,接着推也一样):
 *       先记一条 keep(未遂),再记结局 —— 叔父还政,名臣、大臣伏诛;
 *     再看此刻在位的君主有没有这一刻的候选:没人掌着权、他不是作者立的君主、(引兵入朝)本国正在打仗 —— 掌权,记一条 regent
 *   - 看王朝时没改朝换代(dynasty.ts 调 strong):王国、帝国这些年战败失地、丢过国都,或接连开疆,有机会出一位专权的大臣、大将
 *   - 引兵入朝那一刻本国正在打的仗:本国国力 × MARCH_SUPPLY,MARCH_FADE 年里淡回(wars.ts 的胜率)
 * **不存内存状态**:掌权的几段由史事 regent 推出来(regents.ts 的 regentsFrom;resumePolities 里就要用),
 *   还没到的掌权候选、结局按此刻在位的君主、还掌着权的那段补进引擎(resumeRegency)。纯计算,不碰 DOM。
 */
import type { Civ, Polity, Year } from './types';
import { Layer } from './types';
import { quantize, type CivSim } from './engine/sim';
import { bookOf, dynastyReign, polityModelOf, regencyCtx, rulerOf, type PolityModel } from './polities';
import { warModelOf, type War } from './wars';
import { dynastyModelOf } from './dynasty';
import { capitalAt } from './growth';
import { KEEP_REGENT, reignStart, type Reign } from './rulers';
import {
  MARCH_FADE,
  MARCH_SUPPLY,
  MARCH_WAR,
  REGENCY_KINDS,
  RG_DIED,
  RG_PURGE,
  RG_RETURN,
  RG_START,
  RG_USURP,
  STRONG_GAIN,
  STRONG_LOSS,
  STRONG_P,
  STRONG_TIER,
  STRONG_YEARS,
  YOUNG,
  IV_GONE,
  IV_HELD,
  IV_NO_THRONE,
  IV_REGENT_AGE,
  childPlan,
  holds,
  ivRegency,
  latePlans,
  makeRegency,
  seizeUntil,
  strongRolls,
  type Regency,
  type RegencyCtx,
  type RegencyKind,
  type RegentIv,
} from './regents';
import { IV_NOT_HIM } from './rulers';
import { royalAt, royalSeg } from './regime';
import type { CivModule } from './modules';
import { Ev } from './events';

export interface RegencyModel {
  pm: PolityModel;
  cx: RegencyCtx;
  /**
   * 作者下令"让他掌权"(干预第 i 条,interventions.ts 在那一刻调):先查这一刻能不能(note 记史事 intervene,b 列见 regents.ts 的 IV_HELD 等),
   * 能就掌权(记 regent,foe 列 = i)、预约到期的那一刻
   */
  intervene?: (v: RegentIv, i: number, pid: number, t: Year, note: (b: number) => void) => void;
}

const models = new WeakMap<CivSim, RegencyModel>();

/** 推演引擎上挂着的掌实权模型(测试、统计用) */
export function regencyModelOf(sim: CivSim): RegencyModel | undefined {
  return models.get(sim);
}

/** 登记掌实权的事件处理和钩子(installCouncil 之后调用;要先装好战争、王朝、动荡) */
export function installRegency(sim: CivSim, pm: PolityModel): RegencyModel {
  return hook(sim, pm);
}

/**
 * 接着推(resumeCiv,在 resumeCouncil 之后):掌权的几段 resumePolities 已经由史事推出来了;
 * 补上此刻在位的君主晚年的候选、还掌着权的那段的结局(重复预约的什么都不做)
 */
export function resumeRegency(sim: CivSim, _civ: Civ): void {
  const pm = polityModelOf(sim);
  if (!pm || !warModelOf(sim)) return;
  const rm = hook(sim, pm);
  const now = sim.now;
  for (const P of pm.polities) {
    if (P.ended !== undefined || !royalAt(P, now)) continue;
    for (const c of latePlans(rm.cx, P.id, rulerOf(pm, P.id, now))) if (quantize(c.t) > now) sim.schedule(c.t, Ev.Regency, 0, P.id);
    const list = pm.regents.get(P.id);
    const g = list?.[list.length - 1];
    if (g && !g.closed && g.stop < Infinity && quantize(g.stop) > now) sim.schedule(g.stop, Ev.Regency, 0, P.id);
  }
}

function hook(sim: CivSim, pm: PolityModel): RegencyModel {
  const wm = warModelOf(sim);
  if (!wm) throw new Error('installRegency:先 installWars');
  const cx = regencyCtx(pm);
  const rm: RegencyModel = { pm, cx };
  models.set(sim, rm);

  const listOf = (pid: number) => pm.regents.get(pid);
  /** 在位表第 k 位在位时有过引兵入朝 */
  const marched = (pid: number, k: number) => !!listOf(pid)?.some((g) => g.kind === 'march' && g.k === k);
  const capital = (P: Polity, t: Year) => {
    const sid = capitalAt(P, t);
    return { region: pm.settlements[sid]?.region ?? -1, settlement: sid };
  };
  /** 此刻有人掌着权(含这一刻刚掌权的、这一刻刚改朝换代的) */
  const busy = (P: Polity, t: Year, r: Reign): boolean => {
    const d = P.dynasties;
    if (d && d.length > 1 && d[d.length - 1].year === t) return true;
    const list = listOf(P.id);
    const g = list?.[list.length - 1];
    if (!g) return false;
    return g.start === t || (g.start < t && t < g.stop && holds(P, g, t, r, bookOf(pm, P.id, t)));
  };
  /** 国家 pid 正在打仗,或 MARCH_WAR 年内打过仗(继承人还在军中;战争按宣战先后排) */
  const campaigning = (pid: number, t: Year): boolean => {
    for (let i = wm.wars.length - 1; i >= 0; i--) {
      const w = wm.wars[i];
      if (w.a !== pid && w.b !== pid) continue;
      if (w.end === undefined || t - w.end < MARCH_WAR) return true;
      if (t - w.start >= MARCH_WAR + 60) break;
    }
    return false;
  };
  /** 预约国家 pid 的君主 r 晚年的候选(此刻以后的) */
  const late = (pid: number, r: Reign) => {
    for (const c of latePlans(cx, pid, r)) if (c.t > sim.now) sim.schedule(c.t, Ev.Regency, 0, pid);
  };
  /** 掌权:登记、记史事、预约结局 */
  const start = (P: Polity, kind: RegencyKind, k: number, t: Year): void => {
    const g = makeRegency(cx, P.id, kind, k, t, (kk) => marched(P.id, kk), sim.annalCount);
    if (!g) return;
    const list = listOf(P.id);
    if (list) list.push(g);
    else pm.regents.set(P.id, [g]);
    sim.record('regent', { a: P.id, b: REGENCY_KINDS.indexOf(kind), n: RG_START, ...capital(P, t), war: k });
    if (g.stop < Infinity) sim.schedule(g.stop, Ev.Regency, 0, P.id);
  };
  /** 到期办结局(g 此刻还掌着权) */
  const close = (P: Polity, g: Regency, t: Year): void => {
    g.closed = true;
    const b = REGENCY_KINDS.indexOf(g.kind);
    const cap = capital(P, t);
    const note = (n: number) => sim.record('regent', { a: P.id, b, n, ...cap, war: g.k });
    if (g.outcome !== 'usurp') {
      note(g.outcome === 'return' ? RG_RETURN : g.outcome === 'purge' ? RG_PURGE : RG_DIED);
      return;
    }
    // 保住王室(干预):篡位挡下 —— 先记一句未遂,紧跟着记结局:宗室(叔父、太子)到期还政,名臣、大臣事泄伏诛。
    // 作者下令"让他掌权"到期篡位的,和保住王室撞上:后下的为准(保住王室排在那条后面才挡)
    const kept = pm.iv ? pm.iv.keeps(P.id, t, g.iv ?? -1) : -1;
    if (kept >= 0) {
      sim.record('keep', { a: P.id, b: KEEP_REGENT, ...cap, war: kept, n: 0 });
      note(g.kind === 'uncle' || g.kind === 'march' || g.kind === 'heir' ? RG_RETURN : RG_PURGE);
      return;
    }
    if (g.kind === 'uncle' || g.kind === 'march' || g.kind === 'heir') {
      // 叔父废了幼主,接着在位(同一朝):在位表跟着重排,预约他的即位(下一刻起在位;幼主原定的交接到时对不上,丢掉)
      // (作者下令"让他掌权"的太子到期篡位,同样废了父亲接着在位)
      (P.seizes ??= []).push({ year: t, k: g.k, born: g.born, until: seizeUntil(cx, g, t), leanings: { ...g.leanings } });
      note(RG_USURP);
      const nx = bookOf(pm, P.id, t + 1 / 256)[g.k + 1];
      if (nx?.seize) sim.schedule(reignStart(nx), Ev.Reign, g.k + 1, P.id);
      return;
    }
    // 名臣、大臣篡位:改朝换代,新朝起于国都、第一位就是他(rulers.ts 照 usurper 排)
    if (!P.dynasties) P.dynasties = [{ year: P.founded, name: '', seat: P.capital }];
    P.dynasties.push({ year: t, name: '', seat: cap.settlement, usurper: { born: g.born, leanings: { ...g.leanings } } });
    dynastyReign(sim, pm, P.id, t);
    note(RG_USURP);
    sim.record('dynasty', { a: P.id, region: cap.region, settlement: cap.settlement });
  };

  sim.on(Ev.Regency, (_a, pid, t) => {
    const P = pm.polities[pid];
    if (!P || P.ended !== undefined || !(P.founded <= t)) return;
    const r = rulerOf(pm, pid, t);
    // 到期的结局:还掌着权、这一刻没别人改朝换代才办
    const list = listOf(pid);
    const g = list?.[list.length - 1];
    if (g && !g.closed && g.stop === t && g.start < t && holds(P, g, t, r, bookOf(pm, pid, t)) && (P.dynasties?.length ?? 1) - 1 === g.dyn) {
      close(P, g, t);
      return;
    }
    // 君主晚年的引兵入朝、太子监国
    if (r.crown) return;
    for (const c of latePlans(cx, pid, r)) {
      if (c.t !== t || busy(P, t, r)) continue;
      if (c.kind === 'march' && !campaigning(pid, t)) continue;
      start(P, c.kind, r.k, t);
    }
  });

  // 开国之君(立国、分裂、复国拿到第一州时):预约他晚年的候选
  sim.onChange(Layer.Polity, (_r, v, _prev, cause) => {
    if (v >= 0 && (cause === Ev.PolityFound || cause === Ev.Split) && pm.size[v] === 1) {
      const r = bookOf(pm, v, sim.now)[0];
      if (r) late(v, r);
    }
  });

  // 新君即位(unrest.ts 的宗室争位、treaties.ts 的放逐之后,那边截住了也照样看):预约他晚年的候选;继位的幼主当即定摄政 / 辅政
  pm.afterReign = (pid, k, list, t) => {
    const P = pm.polities[pid];
    if (P.ended !== undefined) return;
    const r = list[k];
    late(pid, r);
    if (r.age >= YOUNG || r.j === 0 || r.crown || r.seize || busy(P, t, r)) return;
    const c = childPlan(cx, pid, r, (kk) => marched(pid, kk));
    if (c) start(P, c.kind, r.k, t);
  };

  // 看王朝时没改朝换代:专权的大臣、大将
  const dm = dynastyModelOf(sim);
  if (dm)
    dm.strong = (p: number, t: Year) => {
      const P = pm.polities[p];
      if (!royalAt(P, t) || pm.tier[p] < STRONG_TIER) return;
      const r = rulerOf(pm, p, t);
      if (r.crown || busy(P, t, r)) return;
      let lost = 0;
      let gained = 0;
      for (const w of wm.wars) {
        if (!w || (w.a !== p && w.b !== p) || (w.end !== undefined && t - w.end >= STRONG_YEARS)) continue;
        for (const e of w.takes) if (t - e.year < STRONG_YEARS) e.by === p ? gained++ : lost++;
      }
      const caps = P.capitals!;
      const moved = caps.length > 1 ? caps[caps.length - 1].year : -Infinity;
      const d = P.dynasties;
      const seat = d && d.length ? d[d.length - 1].year : P.founded;
      const crisis = lost >= STRONG_LOSS || (t - moved < STRONG_YEARS && moved !== seat);
      const glory = gained >= STRONG_GAIN;
      if (!crisis && !glory) return;
      const u = strongRolls(cx, p, t);
      if (u.u >= STRONG_P) return;
      start(P, glory && (!crisis || u.kind < 0.5) ? 'general' : 'chancellor', r.k, t);
    };

  // 作者下令"让他掌权":这国此刻在、不是共和国、在位的不是作者立的君主、没人掌着权、他对得上(regents.ts 的 ivRegency)才掌权。
  // 作者的人物先看他自己(还没出生、已去世、不满 16 岁),再看这国
  rm.intervene = (v, i, pid, t, noteIv) => {
    const P = pm.polities[pid];
    if (!P || P.ended !== undefined || !(P.founded <= t)) return noteIv(-3);
    if (v.char !== undefined) {
      if (v.born > t) return noteIv(-2);
      if (v.died !== undefined && v.died <= t) return noteIv(IV_GONE);
      if (t - v.born < IV_REGENT_AGE) return noteIv(IV_NOT_HIM);
    }
    const r = rulerOf(pm, pid, t);
    if (!royalSeg(P, r.dynasty) || r.crown) return noteIv(IV_NO_THRONE);
    if (busy(P, t, r)) return noteIv(IV_HELD);
    const g = ivRegency(cx, pid, v, i, r, t, -1);
    if (!g) return noteIv(IV_NOT_HIM);
    noteIv(-1);
    g.annal = sim.annalCount;
    const list = listOf(pid);
    if (list) list.push(g);
    else pm.regents.set(pid, [g]);
    sim.record('regent', { a: pid, b: REGENCY_KINDS.indexOf(g.kind), n: RG_START, ...capital(P, t), war: r.k, foe: i });
    if (g.stop < Infinity) sim.schedule(g.stop, Ev.Regency, 0, pid);
  };

  // 引兵入朝那一刻正在打的仗:粮饷为掌权的人所制
  wm.supply = (w: War, x: number, t: Year): number => {
    const list = listOf(x);
    if (!list) return 1;
    for (let i = list.length - 1; i >= 0; i--) {
      const g = list[i];
      if (!(w.start < g.start)) break;
      if (g.kind === 'march' && t > g.start && t - g.start < MARCH_FADE) return MARCH_SUPPLY + ((1 - MARCH_SUPPLY) * (t - g.start)) / MARCH_FADE;
    }
    return 1;
  };
  return rm;
}

/** 模块:掌实权:引兵入朝、太子监国、宗室摄政、名臣辅政、大臣大将专权(清单和次序见 modules.ts) */
export const regencyModule: CivModule = {
  id: 'regency',
  install: (c) => {
    if (c.pm) installRegency(c.sim, c.pm);
  },
  resume: (c) => resumeRegency(c.sim, c.civ),
};
