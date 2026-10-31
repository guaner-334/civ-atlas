/**
 * 国家方针在界面上的说法和小工具(纯计算,不碰 DOM;方针页 PolicyPage.tsx、国家卡片、人物卡、单子、演一国用):
 *
 * - 方针页的草稿(PolicyDraft):一键选的那一种 + 四个旋钮 + 亲仇 + 发展重点;和干预 policy 互相换(draftOf / draftIv)。
 *   一键选:把旋钮、发展重点填成那一种的(亲、仇不动);"照君主性格" = 旋钮归零、不挑发展重点。拧过旋钮就不算哪一种了(presetOn = null)
 * - 某年一国照哪条方针(policyAt:推过的历史里生效了的),国家卡片「方针」一行写什么(policyRow:待推演 / 下一步生效 / 某年起 / 没定方针)
 * - 单子上的一行(policyQueueText)、推完的提示条(policyDoneText)
 * - 人物卡「倾向」:君主自己的倾向加上方针(leanRows / peaceRow)
 * - 演一国:别国的干预入口变灰(roleLock)
 */
import type { Civ, Person, RulerLeanings } from '../gen/civ/types';
import { heOrShe, type Sexed } from '../gen/civ/story/gender';
import { POLICY_KNOBS, POLICY_PICK_MAX, cleanIntervention, polityKey, resolveKey, type PolicyFocus, type PolicyKnob, type PolicyPreset } from '../gen/edits';
import { POLICY_PRESETS, POLICY_PRESET_NAMES, emptyPolicy, policiesFrom, policyName, withPolicy, type PolicyIv } from '../gen/civ/policy';
import { interventionFate } from '../gen/stepwise';
import { eraText, yearAt, type Era } from '../gen/era';
import { nameAt } from './Interventions';
import type { Pending } from './pendingStore';

/** 方针页上正在填的(旋钮各 −50…50,0 = 照君主;亲、仇是国家的稳定键) */
export interface PolicyDraft {
  /** 从哪一种一键选的起(拧过旋钮也留着:名字写"扩张(细调过)") */
  preset?: PolicyPreset;
  war: number;
  expand: number;
  coast: number;
  peace: number;
  foes: string[];
  friends: string[];
  focus?: PolicyFocus;
}

export const EMPTY_DRAFT: PolicyDraft = { war: 0, expand: 0, coast: 0, peace: 0, foes: [], friends: [] };

/** 一条方针 → 草稿(没有 = 照君主性格) */
export function draftOf(v: PolicyIv | null | undefined): PolicyDraft {
  if (!v) return { ...EMPTY_DRAFT, foes: [], friends: [] };
  const d: PolicyDraft = { war: v.war ?? 0, expand: v.expand ?? 0, coast: v.coast ?? 0, peace: v.peace ?? 0, foes: [...(v.foes ?? [])], friends: [...(v.friends ?? [])] };
  if (v.preset) d.preset = v.preset;
  if (v.focus) d.focus = v.focus;
  return d;
}

/** 草稿 → 干预(清理过:0 的旋钮、空的亲仇不写;都没填 = 罢方针) */
export function draftIv(a: string, from: number, d: PolicyDraft): PolicyIv {
  const raw = { kind: 'policy', a, from, preset: d.preset, war: d.war, expand: d.expand, coast: d.coast, peace: d.peace, foes: d.foes, friends: d.friends, focus: d.focus };
  return (cleanIntervention(raw) as PolicyIv | null) ?? { kind: 'policy', a, from };
}

/** 点一种一键选:旋钮、发展重点照那一种填(亲、仇不动);null = 照君主性格(旋钮归零、不挑发展重点) */
export function withPreset(d: PolicyDraft, p: PolicyPreset | null): PolicyDraft {
  const out: PolicyDraft = { war: 0, expand: 0, coast: 0, peace: 0, foes: d.foes, friends: d.friends };
  if (!p) return out;
  const v = POLICY_PRESETS[p];
  out.preset = p;
  for (const k of POLICY_KNOBS) out[k] = v[k] ?? 0;
  if (v.focus) out.focus = v.focus;
  return out;
}

/** 拧一个旋钮 / 换发展重点(一键选的那一种留着,名字写"细调过") */
export function withKnob(d: PolicyDraft, k: PolicyKnob, n: number): PolicyDraft {
  return { ...d, [k]: Math.max(-50, Math.min(50, Math.round(n))) };
}

/** 一键选的哪一行打勾:'none' = 照君主性格(旋钮都在中间、不挑发展重点);拧过旋钮的 = null(哪一行都不勾,算自定) */
export function presetOn(d: PolicyDraft): PolicyPreset | 'none' | null {
  const knobs = POLICY_KNOBS.every((k) => !d[k]) && !d.focus;
  if (knobs) return 'none';
  if (!d.preset) return null;
  const v = POLICY_PRESETS[d.preset];
  return POLICY_KNOBS.every((k) => (v[k] ?? 0) === d[k]) && (v.focus ?? null) === (d.focus ?? null) ? d.preset : null;
}

/** 两条方针一样(不管从哪年起;null / 罢方针算一样) */
export function samePolicy(a: PolicyIv | null | undefined, b: PolicyIv | null | undefined): boolean {
  const norm = (v: PolicyIv | null | undefined) => {
    if (!v || emptyPolicy(v)) return '';
    const { kind: _k, a: _a, from: _f, ...rest } = v;
    void _k;
    void _a;
    void _f;
    return JSON.stringify(rest);
  };
  return norm(a) === norm(b);
}

/** 亲、仇点一国:已经挑了 = 去掉;没挑 = 加上(在另一边的挪过来);满了 = 原因 */
export function togglePick(d: PolicyDraft, side: 'foes' | 'friends', key: string): PolicyDraft | string {
  const other = side === 'foes' ? 'friends' : 'foes';
  if (d[side].includes(key)) return { ...d, [side]: d[side].filter((k) => k !== key) };
  if (d[side].length >= POLICY_PICK_MAX) return `最多挑 ${POLICY_PICK_MAX} 国，先点一个已选的去掉`;
  return { ...d, [side]: [...d[side], key], [other]: d[other].filter((k) => k !== key) };
}

// ---------------------------------------------------------------------------
// 某年照哪条方针、卡片上那一行

const segCache = new WeakMap<Civ, ReturnType<typeof policiesFrom>>();

/**
 * 国家 id 在 t 那一刻照的方针(推过的历史里生效了的;t 那一年定的也算;罢了 / 没定 = null)。
 * 照大纲顺着引的不算(引的时候加在它自己的方针上、引完换回去,跳过它们就是它自己的那一条)
 */
export function policyAt(civ: Civ, id: number, t: number): PolicyIv | null {
  let m = segCache.get(civ);
  if (!m) segCache.set(civ, (m = policiesFrom(civ.annals, civ.interventions)));
  const segs = m.get(id);
  if (!segs) return null;
  for (let i = segs.length - 1; i >= 0; i--) if (segs[i].t <= t + 1e-6 && !segs[i].v.guide) return emptyPolicy(segs[i].v) ? null : segs[i].v;
  return null;
}

/** 方针在卡片、常驻条上的名字:"扩张""扩张(细调过)""自定";只挑了亲仇的"只定亲仇";罢方针 / 没定 = "照君主性格" */
export function policyLabel(v: PolicyIv | null | undefined): string {
  if (!v || emptyPolicy(v)) return '照君主性格';
  return policyName(v) || '只定亲仇';
}

/** 单子里这国最后一条方针(还没推演;没有 = null) */
export function pendingPolicy(pending: readonly Pending[], key: string): PolicyIv | null {
  for (let i = pending.length - 1; i >= 0; i--) {
    const x = pending[i];
    if (x.kind === 'iv' && x.v.kind === 'policy' && x.v.a === key) return x.v;
  }
  return null;
}

/**
 * 国家卡片概况「方针」一行:name = 写什么(点了进方针页);tag = 还在单子里("待推演" / 逐年推演"下一步生效");
 * note = 生效了的"1500 年起" / 没定的"没定方针"
 */
export function policyRow(civ: Civ, id: number, year: number, pending: readonly Pending[], step: boolean, era: Era | undefined): { name: string; tag?: string; note?: string } {
  const queued = pendingPolicy(pending, polityKey(civ, id));
  if (queued) return { name: policyLabel(queued), tag: step ? '下一步生效' : '待推演' };
  const v = policyAt(civ, id, year);
  if (!v) return { name: '照君主性格', note: '没定方针' };
  return { name: policyLabel(v), note: `${yearAt(v.from, era)}起` };
}

// ---------------------------------------------------------------------------
// 单子上的一行、推完的提示条

const KNOB_WORD: Record<PolicyKnob, string> = { war: '胆量', expand: '开拓', coast: '沿海', peace: '和谈' };
const FOCUS_WORD: Record<PolicyFocus, string> = { production: '生产', transport: '运输', information: '信息', administration: '行政', mobilization: '动员' };
/** 发展重点的五样(方针页的分段按钮,次序同 POLICY_FOCI) */
export const FOCUS_NAMES = FOCUS_WORD;

/** "＋25" / "−30" */
export const signed = (n: number) => (n > 0 ? `＋${n}` : `−${-n}`);

/** 拧过的几项:"胆量＋25、开拓＋25、和谈＋15、重运输"(在中间的不写) */
export function policyKnobsText(v: PolicyIv): string {
  const parts = POLICY_KNOBS.filter((k) => v[k]).map((k) => `${KNOB_WORD[k]}${signed(v[k]!)}`);
  if (v.focus) parts.push(`重${FOCUS_WORD[v.focus]}`);
  return parts.join('、');
}

/** 国家的稳定键 → 那一年的国名(这份历史里没有 = 空串) */
function keyName(civ: Civ, key: string, year: number): string {
  const r = resolveKey(civ, key);
  return r?.kind === 'polity' && civ.polities[r.id] ? nameAt(civ.polities[r.id], year) : '';
}

/** 亲仇的后半句:",仇莱尼多尔王国,亲温兹汗国"(没挑 = 空串) */
function picksText(civ: Civ, v: PolicyIv): string {
  const names = (keys: readonly string[] | undefined) =>
    (keys ?? [])
      .map((k) => keyName(civ, k, v.from))
      .filter(Boolean)
      .join('、');
  const foes = names(v.foes);
  const friends = names(v.friends);
  return `${foes ? `，仇${foes}` : ''}${friends ? `，亲${friends}` : ''}`;
}

/**
 * 待推演 / 下一步生效的单子上的一行(A = 下令的国家怎么称呼):
 * "大澜王朝定方针「扩张」，仇莱尼多尔王国，亲温兹汗国";细调过的写拧过的几项"大澜王朝定方针「扩张」（胆量＋25、开拓＋25、和谈＋15、重运输）";
 * 没从一键选起的叫「自定」;只挑了亲仇的"大澜王朝定方针，仇莱尼多尔王国";罢方针"大澜王朝不再定方针（照君主性格）"
 */
export function policyQueueText(civ: Civ, v: PolicyIv, A: string): string {
  if (emptyPolicy(v)) return `${A}不再定方针（照君主性格）`;
  const name = policyName(v);
  const plain = v.preset ? POLICY_PRESET_NAMES[v.preset] : name;
  const knobs = name && name !== POLICY_PRESET_NAMES[v.preset!] ? `（${policyKnobsText(v)}）` : '';
  return `${A}定方针${plain ? `「${plain}」` : ''}${knobs}${picksText(civ, v)}`;
}

/**
 * 推完的提示条:"大澜王朝定方针「扩张」"(后面由调用方接"；已从……起重新推演");罢方针"大澜王朝不再定方针（照君主性格）";
 * 没生效(黄色)"大澜王朝的方针没生效：第 1630 年大澜王朝已亡"。i = 它在这份历史的 Civ.interventions 里是第几条(−1 = 不查)
 */
export function policyDoneText(civ: Civ, v: PolicyIv, i: number, A: string, era: Era | undefined): { ok: boolean; text: string } {
  const f = i >= 0 ? interventionFate(civ, i) : null;
  if (f?.state === 'void') {
    const why = f.why.startsWith('那一年') ? `第 ${v.from} 年${f.why.slice(3)}` : f.why;
    return { ok: false, text: `${A}的方针没生效：${eraText(why, era)}` };
  }
  if (emptyPolicy(v)) return { ok: true, text: `${A}不再定方针（照君主性格）` };
  const name = policyName(v);
  return { ok: true, text: name ? `${A}定方针「${name}」` : `${A}定方针${picksText(civ, v)}` };
}

// ---------------------------------------------------------------------------
// 方针页旋钮下面那一句

const clamp = (x: number) => Math.min(100, Math.max(0, x));

/**
 * 旋钮下面一句:现在在位那位的数、加上方针以后的数(l = 他的倾向,没有君主 = null;ruler = 他的名字;x = 他,分他 / 她)
 *   打仗胆量 "燕溟好战 50，加上方针 = 75：更容易开战，打起来更难停。"
 *   开拓     "开拓 53 → 78"      沿海 "重商 63 → 98"      在中间的 "重商 63，照他的意思"
 *   和谈底线 "打得更久才厌战，要多拿几州才肯停；守方打惨了也更不肯称臣。"
 */
export function knobNote(k: PolicyKnob, n: number, l: RulerLeanings | null | undefined, ruler: string, x?: Sexed): string {
  if (k === 'peace') {
    if (!n) return '照君主的意思，不另加减。';
    return n > 0 ? '打得更久才厌战，要多拿几州才肯停；守方打惨了也更不肯称臣。' : '打不了多久就想停，少拿几州也肯议和；守方打不过也早些称臣。';
  }
  if (k === 'war') {
    const head = l ? `${ruler}好战 ${l.war}` : '';
    if (!n) return l ? `${head}，照${heOrShe(x)}的意思` : '照君主的意思';
    const tail = n > 0 ? '更容易开战，打起来更难停。' : '更少开战，打起来也早些停。';
    return l ? `${head}，加上方针 = ${clamp(l.war + n)}：${tail}` : tail;
  }
  const word = k === 'expand' ? '开拓' : '重商';
  const base = l ? (k === 'expand' ? l.expand : l.trade) : null;
  if (base === null) return n ? '' : '照君主的意思';
  return n ? `${word} ${base} → ${clamp(base + n)}` : `${word} ${base}，照${heOrShe(x)}的意思`;
}

// ---------------------------------------------------------------------------
// 人物卡「倾向」:君主的倾向加上方针

/** 倾向的哪一项受哪个旋钮管(发展不受) */
const LEAN_KNOB: Record<keyof RulerLeanings, PolicyKnob | null> = { expand: 'expand', war: 'war', develop: null, trade: 'coast' };
const LEAN_WHY: Record<PolicyKnob, [string, string]> = {
  expand: ['往外占', '少往外扩'],
  war: ['更敢打', '少打仗'],
  coast: ['更看重沿海、大河', '偏向内陆'],
  peace: ['', ''],
};

/** 倾向一项:base = 他自己的,add = 方针加减多少(0 = 不管),actual = 合起来的(夹在 0–100),why = 说明后面接的半句 */
export interface LeanRow {
  k: keyof RulerLeanings;
  base: number;
  add: number;
  actual: number;
  why: string;
}

/** 君主 l 的四项倾向加上方针 v(没有方针 = add 都是 0;x = 这位君主,说明里分他 / 她) */
export function leanRows(l: RulerLeanings, v: PolicyIv | null, x?: Sexed): LeanRow[] {
  const c = v ? withPolicy(l, v).leanings : l;
  const name = v ? policyName(v) : '';
  const who = name ? `方针「${name}」` : '方针';
  return (['expand', 'war', 'develop', 'trade'] as const).map((k) => {
    const knob = LEAN_KNOB[k];
    const add = v && knob ? (v[knob] ?? 0) : 0;
    return { k, base: l[k], add, actual: c[k], why: add ? `；${who}让${heOrShe(x)}${LEAN_WHY[knob!][add > 0 ? 0 : 1]}` : '' };
  });
}

/** 和谈底线那一行:"方针让他不轻易议和（＋15）" / "方针让他早议和（−25）";没拧 = null(x = 这位君主,分他 / 她) */
export function peaceRow(v: PolicyIv | null, x?: Sexed): string | null {
  const n = v?.peace ?? 0;
  if (!n) return null;
  return `方针让${heOrShe(x)}${n > 0 ? '不轻易议和' : '早议和'}（${signed(n)}）`;
}

/** 人物卡上这位君主那时照的方针:时间轴那一年(夹在他在位的年份里);不是君主 / 没有方针 = null */
export function rulerPolicy(civ: Civ, x: Person, year: number): PolicyIv | null {
  if (x.role !== 'ruler' || x.from === undefined) return null;
  const end = x.until ?? civ.endYear;
  const t = Math.min(Math.max(year, x.from), Math.max(x.from, end - 1 / 256));
  return policyAt(civ, x.polity, t);
}

// ---------------------------------------------------------------------------
// 演一国

/** 演的那一国在这份历史里的编号(没在演 / 这份历史里没有 = −1) */
export function rolePolity(civ: Civ, role: string | null): number {
  if (!role) return -1;
  const r = resolveKey(civ, role);
  return r?.kind === 'polity' && civ.polities[r.id] ? r.id : -1;
}

/** 演一国时国家 id 的干预入口要不要变灰:是别国 = { me: 演的那国 }(没在演、就是自己 = null) */
export function roleLock(civ: Civ, role: string | null, id: number): { me: number } | null {
  const me = rolePolity(civ, role);
  return me >= 0 && me !== id ? { me } : null;
}
