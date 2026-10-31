/**
 * 国家方针(干预 policy,字段见 gen/edits.ts 文件头的表):一国从某年起照方针走,直到它的下一条方针换掉它。
 *
 * **怎么和君主的倾向合起来**(叠加):方针的几个滑条加减在此刻在位君主的倾向上,各自夹回 0–100,再照君主倾向那样折算成推演里的倍数
 * (rulers.ts 的 leaningEffect):
 *   - 打仗胆量 war  → 加在好战上:宣战的赔率、亲征,也管打多久、想拿几州、肯不肯称臣;
 *                     宣战的赔率另 × e^(POLICY_DECLARE·胆量/50)(倾向折算出来的倍数在赔率高时差别不大,定了方针要看得出来)
 *   - 开拓 expand   → 加在开拓上:扩张算账的门槛
 *   - 沿海 coast    → 加在重商上:沿海、大河、港口的州门槛更低,内陆的更高(负 = 偏内陆)
 *   - 和谈底线 peace → 只加在"打多久、想拿几州、肯不肯称臣"用的那一份好战上(leaningEffect 的 settle)
 * 换一位君主照样加减,所以历史仍有起伏;滑条拧到头(±50)基本盖过君主自己的性格。
 * **亲、仇**(wars.ts、diplomacy.ts 在做决定的地方查):仇国 —— 看邻国时挑它的赔率 × FOE_ODDS(先打它),不和它结盟;
 *   亲国 —— 不主动打它,结盟时先找它,和它结着盟时它挨打更肯出兵援盟(FRIEND_JOIN)。
 * **发展重点**(development.ts):治下各州挑中的那一样能力"自己长"× FOCUS_UP,别的 × FOCUS_DOWN(发展度 20 年一步,几十年才看得出)。
 * **国力、动荡加减**(只有照大纲顺着引出来的方针带,gen/outline.ts):国力(wars.ts 的 powers、diplomacy.ts 的 powerOf)× (1 + power/100);
 *   动荡(unrest.ts 的数表,control.ts 读的时候加上:分裂、大崩解、民变、趁虚而入都看它)+ GUIDE_UNREST × unrest/50,改朝换代的动荡(dynasty.ts)× e^(GUIDE_DYNASTY × unrest/50)。
 *
 * **从哪一刻起**:from 那一刻(干预事件)登记,下一刻(1/256 年后)起照新方针算 —— 同一刻里先发生的事照旧,
 * 接着推(resumeCiv)按史事重放时也一样(和作者立的君主同一个做法,见 rulers.ts)。门槛放低了的,下一刻从现有国土往外重新看一遍
 * (polities.ts 的 Ev.Respread,a = POLICY_RESPREAD)。
 * 生效了的方针推演里登记在 PolityModel.policies(polities.ts 的 setPolicy);不存进 Civ:接着推、排人物时由史事 intervene 推出来(policiesFrom)。
 * 没有方针的国家什么都不变(只多一次判空),所以没有方针的世界逐字节不变。纯计算,不碰 DOM。
 */
import type { Intervention, PolicyFocus, PolicyKnob, PolicyPreset } from '../edits';
import { POLICY_FOCI } from '../edits';
import type { Annal, RulerLeanings, Year } from './types';
import { leaningEffect, type LeaningEffect, type Reign } from './rulers';
import { fexp } from './rand';

export type PolicyIv = Extract<Intervention, { kind: 'policy' }>;

/** 一键选的几种方针各把旋钮填成什么(没写的 = 0;亲、仇不动) */
export const POLICY_PRESETS: Record<PolicyPreset, Partial<Record<PolicyKnob, number>> & { focus?: PolicyFocus }> = {
  expand: { war: 25, expand: 25, peace: 15 },
  hold: { war: -30, expand: -30, peace: -25 },
  trade: { war: -15, coast: 35, focus: 'transport' },
  peace: { war: -45, expand: -10, peace: -35, focus: 'production' },
};

// ---- 调参(scripts/policy-stats.ts 的 20 个种子统计) ----
/** 打仗胆量另乘在宣战赔率上的倍数:e^(POLICY_DECLARE·胆量/50) —— 胆量 +25 约 × 2.1,−45 约 × 0.26 */
export const POLICY_DECLARE = 1.5;
/** 仇国:看邻国时挑它的赔率倍数 */
export const FOE_ODDS = 3;
/** 亲国:结盟挑对象时的分数倍数 */
export const FRIEND_PACT = 3;
/** 亲国挨打:结着盟的援盟机会(寻常 PACT_JOIN 0.7) */
export const FRIEND_JOIN = 0.95;
/** 发展重点:挑中的那一样"自己长"的倍数、别的几样的倍数;挑动员的,动员的目标多这么多 */
export const FOCUS_UP = 1.6;
export const FOCUS_DOWN = 0.9;
export const FOCUS_MOB = 0.3;

/**
 * 顺着引的动荡加减拧到头(±50)时:动荡加减多少(一般国家 0–3,大崩解的门槛 2.35 上下;看内政 40 年一次,窗口里多半只看一两次,
 * 得一下子推到门槛上才引得动);改朝换代的动荡(≥ 1)乘 e^(±GUIDE_DYNASTY)(约 × 5 / ÷ 5)
 */
export const GUIDE_UNREST = 3;
export const GUIDE_DYNASTY = 1.6;

/** Ev.Respread 的 a:定了方针的下一刻(门槛放低了才从现有国土往外重新看) */
export const POLICY_RESPREAD = 1;

const clamp = (x: number) => Math.min(100, Math.max(0, x));

/** 什么都没定(罢方针:照君主的倾向) */
export function emptyPolicy(v: PolicyIv): boolean {
  return !v.war && !v.expand && !v.coast && !v.peace && !v.foes?.length && !v.friends?.length && !v.focus && !v.power && !v.unrest;
}

/** 方针的国力倍数(没加减 = 1) */
export const powerScale = (v: PolicyIv | null): number => (v?.power ? 1 + v.power / 100 : 1);

/** 方针的动荡加减,−1…1(没加减 = 0) */
export const unrestShift = (v: PolicyIv | null): number => (v?.unrest ? v.unrest / 50 : 0);

/** 有没有拧滑条(没拧 = 倍数和君主自己的一样) */
const knobbed = (v: PolicyIv) => !!(v.war || v.expand || v.coast || v.peace);

/**
 * 君主的倾向加上方针:leanings = 实际的四项(发展不变),settle = 算"打多久、想拿几州、肯不肯称臣"用的好战(再加上和谈底线)
 */
export function withPolicy(l: RulerLeanings, v: PolicyIv): { leanings: RulerLeanings; settle: number } {
  const war = clamp(l.war + (v.war ?? 0));
  return {
    leanings: { expand: clamp(l.expand + (v.expand ?? 0)), war, develop: l.develop, trade: clamp(l.trade + (v.coast ?? 0)) },
    settle: clamp(l.war + (v.war ?? 0) + (v.peace ?? 0)),
  };
}

/** 君主倾向加上方针以后推演里的倍数 */
export function policyEffect(l: RulerLeanings, v: PolicyIv): LeaningEffect {
  const c = withPolicy(l, v);
  const e = leaningEffect(c.leanings, c.settle);
  if (v.war) e.declare *= fexp((POLICY_DECLARE * v.war) / 50);
  return e;
}

/** 一国的一段方针:t 那一刻定的(下一刻起算),v = 那条干预,iv = 第几条干预 */
export interface PolicySeg {
  t: Year;
  v: PolicyIv;
  iv: number;
  /** 各位君主在这段方针下的倍数(按"国家 + 这一段 + 这一位(作者改过倾向的按改过的那一份)"缓存:rulerOf 在扩张算账里调用很频繁) */
  memo: WeakMap<object, LeaningEffect>;
}

export function policySeg(v: PolicyIv, t: Year, iv: number): PolicySeg {
  return { t, v, iv, memo: new WeakMap() };
}

/** t 这一刻照哪一段方针(那一段的 t 早于此刻;没有 / 罢了 = null) */
export function segAt(segs: readonly PolicySeg[] | undefined, t: Year): PolicySeg | null {
  if (!segs) return null;
  for (let i = segs.length - 1; i >= 0; i--) if (segs[i].t < t) return emptyPolicy(segs[i].v) ? null : segs[i];
  return null;
}

/** 君主 r(此刻的倾向,见 rulers.ts 的 leaningsAt)在这段方针下的倍数(没有方针 / 没拧滑条 = 他自己的) */
export function segEffect(seg: PolicySeg | null, r: Pick<Reign, 'leanings' | 'eff'>): LeaningEffect {
  if (!seg || !knobbed(seg.v)) return r.eff;
  let e = seg.memo.get(r);
  if (!e) seg.memo.set(r, (e = policyEffect(r.leanings, seg.v)));
  return e;
}

/** 发展重点是第几样能力(development.ts 的 CAPS 的下标;没挑 = −1) */
export function focusIndex(seg: PolicySeg | null): number {
  return seg?.v.focus ? POLICY_FOCI.indexOf(seg.v.focus) : -1;
}

/**
 * 史事里生效了的方针(intervene,b = −1,那一条干预是 policy)→ 国家编号 → 各段(按生效先后)。
 * list = 推出这份历史时带着的干预(史事 intervene 的 war 列是它的下标)
 */
export function policiesFrom(annals: readonly Annal[], list: readonly Intervention[] | null | undefined): Map<number, PolicySeg[]> {
  const out = new Map<number, PolicySeg[]>();
  if (!list?.length) return out;
  for (const e of annals) {
    if (e.kind !== 'intervene' || e.b !== -1 || e.a < 0) continue;
    const v = list[e.war];
    if (v?.kind !== 'policy') continue;
    const s = policySeg(v, e.year, e.war);
    const at = out.get(e.a);
    if (at) at.push(s);
    else out.set(e.a, [s]);
  }
  return out;
}

/** 方针拧过哪几样(界面上"细调过"、编年史里的说法用):和一键选的那一种比,不一样的滑条 / 发展重点 */
export function tweaked(v: PolicyIv): boolean {
  const p = v.preset ? POLICY_PRESETS[v.preset] : {};
  return (['war', 'expand', 'coast', 'peace'] as const).some((k) => (v[k] ?? 0) !== (p[k] ?? 0)) || (v.focus ?? null) !== (p.focus ?? null);
}

/** 一键选的几种方针叫什么 */
export const POLICY_PRESET_NAMES: Record<PolicyPreset, string> = { expand: '扩张', hold: '守成', trade: '商贸', peace: '和平发展' };

/**
 * 方针的名字:一键选的那一种("扩张";拧过旋钮的"扩张(细调过)");没从一键选起、拧过旋钮的 = "自定";
 * 只挑了亲仇的 / 罢方针 = 空串
 */
export function policyName(v: PolicyIv): string {
  if (v.preset) return POLICY_PRESET_NAMES[v.preset] + (tweaked(v) ? '(细调过)' : '');
  return knobbed(v) || v.focus ? '自定' : '';
}
