/**
 * 国家方针在界面上的部分(ui/policyInfo.ts、ui/Interventions.tsx 的说法):
 * - 方针页存取:草稿和干预互相换、单子里这国最后一条、某年照的哪条、国家卡片「方针」一行
 * - 一键选和细调:点一种填好旋钮(亲、仇不动),拧过就不算哪一种;亲、仇最多 3 国、两边互斥
 * - 演一国:别国的干预入口变灰,自己的不灰;没在演、这份历史里没有那国 = 都不灰
 * - 单子上的一行、「我的干预」、推完的提示条、旋钮下面那一句、人物卡倾向加上方针
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { POLICY_PRESETS, emptyPolicy, policyName, type PolicyIv } from '../src/gen/civ/policy';
import { POLICY_PICK_MAX, polityKey } from '../src/gen/edits';
import {
  EMPTY_DRAFT,
  draftIv,
  draftOf,
  knobNote,
  leanRows,
  peaceRow,
  pendingPolicy,
  policyAt,
  policyDoneText,
  policyKnobsText,
  policyLabel,
  policyQueueText,
  policyRow,
  presetOn,
  roleLock,
  rolePolity,
  samePolicy,
  togglePick,
  withKnob,
  withPreset,
} from '../src/ui/policyInfo';
import { interventionText, nameAt } from '../src/ui/Interventions';
import type { Pending } from '../src/ui/pendingStore';

const seed = 7;
const T = 1500;
let w: World | null = null;
let b: Civ | null = null;
const world = () => (w ??= generateWorld({ ...DEFAULT_PARAMS, seed }));
const base = () => (b ??= generateCiv(world()));

/** T 年州最多的两国(大的在前) */
function biggest(civ: Civ, t: number): [number, number] {
  const n = new Map<number, number>();
  for (const o of ownersAt(civ, t).polity) if (o >= 0) n.set(o, (n.get(o) ?? 0) + 1);
  const s = [...n.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]);
  return [s[0][0], s[1][0]];
}

const queued = (v: PolicyIv, id = 1): Pending => ({ id, from: v.from, text: '', kind: 'iv', v });

describe('方针页 · 存取', () => {
  it('草稿 → 干预 → 草稿一样;旋钮在中间、没挑亲仇的不写;什么都没定 = 罢方针', () => {
    const d = { ...withPreset(EMPTY_DRAFT, 'expand'), foes: ['polity:c1#0'], friends: ['polity:c2#0'] };
    const v = draftIv('polity:c9#0', T, d);
    expect(v).toEqual({ kind: 'policy', a: 'polity:c9#0', from: T, preset: 'expand', war: 25, expand: 25, peace: 15, foes: ['polity:c1#0'], friends: ['polity:c2#0'] });
    expect(draftOf(v)).toEqual({ ...d, coast: 0 });
    const none = draftIv('polity:c9#0', T, EMPTY_DRAFT);
    expect(emptyPolicy(none)).toBe(true);
    expect(draftOf(none)).toEqual(EMPTY_DRAFT);
    expect(draftOf(null)).toEqual(EMPTY_DRAFT);
    // 两条只差在年份上 = 一样;罢方针和没有一样
    expect(samePolicy(v, { ...v, from: T + 30 })).toBe(true);
    expect(samePolicy(v, draftIv('polity:c9#0', T, withPreset(d, 'hold')))).toBe(false);
    expect(samePolicy(none, null)).toBe(true);
  });

  it('单子里这国最后一条;推过的历史里那年照的哪条;国家卡片「方针」一行:没定 / 某年起 / 待推演 / 下一步生效', () => {
    const civ0 = base();
    const [A] = biggest(civ0, T);
    const key = polityKey(civ0, A);
    const v = draftIv(key, T, withPreset(EMPTY_DRAFT, 'expand'));
    const hold = draftIv(key, T, withPreset(EMPTY_DRAFT, 'hold'));
    const other = draftIv('polity:c0#9', T, withPreset(EMPTY_DRAFT, 'trade'));
    expect(pendingPolicy([queued(v), queued(other, 2), queued(hold, 3)], key)).toBe(hold);
    expect(pendingPolicy([queued(other)], key)).toBeNull();
    // 推演前:没定方针
    expect(policyAt(civ0, A, T + 10)).toBeNull();
    expect(policyRow(civ0, A, T + 10, [], false, undefined)).toEqual({ name: '照君主性格', note: '没定方针' });
    expect(policyRow(civ0, A, T + 10, [queued(v)], false, undefined)).toEqual({ name: '扩张', tag: '待推演' });
    expect(policyRow(civ0, A, T + 10, [queued(v)], true, undefined)).toEqual({ name: '扩张', tag: '下一步生效' });
    // 推演后:那一年起照它,之前没有;罢了以后又没有
    const civ = generateCiv(world(), { interventions: [v, { kind: 'policy', a: key, from: T + 50 }] });
    expect(policyAt(civ, A, T - 1)).toBeNull();
    expect(policyAt(civ, A, T)).toEqual(v);
    expect(policyAt(civ, A, T + 20)).toEqual(v);
    expect(policyAt(civ, A, T + 60)).toBeNull();
    expect(policyRow(civ, A, T + 20, [], false, undefined)).toEqual({ name: '扩张', note: '1500 年起' });
    expect(policyRow(civ, A, T + 60, [], false, undefined)).toEqual({ name: '照君主性格', note: '没定方针' });
  }, 120_000);
});

describe('方针页 · 一键选和细调', () => {
  it('点一种:旋钮、发展重点照那一种填,亲、仇不动;照君主性格 = 旋钮归零', () => {
    const d0 = { ...EMPTY_DRAFT, foes: ['polity:c1#0'], friends: [] };
    const t = withPreset(d0, 'trade');
    expect(t).toMatchObject({ preset: 'trade', war: -15, expand: 0, coast: 35, peace: 0, focus: 'transport', foes: ['polity:c1#0'] });
    expect(presetOn(t)).toBe('trade');
    const back = withPreset(t, null);
    expect(back).toEqual({ ...EMPTY_DRAFT, foes: ['polity:c1#0'], friends: [] });
    expect(presetOn(back)).toBe('none');
    for (const k of Object.keys(POLICY_PRESETS) as (keyof typeof POLICY_PRESETS)[]) expect(presetOn(withPreset(EMPTY_DRAFT, k))).toBe(k);
  });

  it('拧过旋钮就哪一行都不勾,名字写"细调过";夹在 −50…50;拧回原数又算那一种;没从一键选起的叫"自定"', () => {
    const e = withPreset(EMPTY_DRAFT, 'expand');
    const t = withKnob(e, 'war', 40);
    expect(presetOn(t)).toBeNull();
    expect(policyName(draftIv('polity:c1#0', T, t))).toBe('扩张(细调过)');
    expect(withKnob(e, 'war', 80).war).toBe(50);
    expect(withKnob(e, 'coast', -77.6).coast).toBe(-50);
    expect(presetOn(withKnob(t, 'war', 25))).toBe('expand');
    const own = withKnob(EMPTY_DRAFT, 'coast', 20);
    expect(presetOn(own)).toBeNull();
    expect(policyName(draftIv('polity:c1#0', T, own))).toBe('自定');
    expect(policyLabel(draftIv('polity:c1#0', T, own))).toBe('自定');
    // 只挑了亲仇:卡片上写"只定亲仇";罢方针写"照君主性格"
    expect(policyLabel(draftIv('polity:c1#0', T, { ...EMPTY_DRAFT, foes: ['polity:c2#0'] }))).toBe('只定亲仇');
    expect(policyLabel(draftIv('polity:c1#0', T, EMPTY_DRAFT))).toBe('照君主性格');
    expect(policyLabel(null)).toBe('照君主性格');
  });

  it('亲、仇:再点一次去掉;最多 3 国;挑进一边的从另一边挪过来', () => {
    let d = { ...EMPTY_DRAFT, foes: [] as string[], friends: ['polity:c4#0'] };
    for (const k of ['polity:c1#0', 'polity:c2#0', 'polity:c3#0']) d = togglePick(d, 'foes', k) as typeof d;
    expect(d.foes).toEqual(['polity:c1#0', 'polity:c2#0', 'polity:c3#0']);
    expect(POLICY_PICK_MAX).toBe(3);
    expect(togglePick(d, 'foes', 'polity:c4#0')).toBe('最多挑 3 国，先点一个已选的去掉');
    const less = togglePick(d, 'foes', 'polity:c2#0') as typeof d;
    expect(less.foes).toEqual(['polity:c1#0', 'polity:c3#0']);
    const moved = togglePick(less, 'foes', 'polity:c4#0') as typeof d;
    expect(moved.foes).toEqual(['polity:c1#0', 'polity:c3#0', 'polity:c4#0']);
    expect(moved.friends).toEqual([]);
  });
});

describe('方针 · 演一国', () => {
  it('演的那国自己的不灰,别国的灰(写演的是哪国);没在演 / 这份历史里没有那国 = 都不灰', () => {
    const civ = base();
    const [A, B] = biggest(civ, T);
    const me = polityKey(civ, A);
    expect(rolePolity(civ, me)).toBe(A);
    expect(roleLock(civ, me, A)).toBeNull();
    expect(roleLock(civ, me, B)).toEqual({ me: A });
    expect(roleLock(civ, null, B)).toBeNull();
    expect(rolePolity(civ, 'polity:c99999#0')).toBe(-1);
    expect(roleLock(civ, 'polity:c99999#0', B)).toBeNull();
  }, 120_000);
});

describe('方针 · 说法', () => {
  it('单子上的一行:一键选的带亲仇;细调过的写拧过的几项;自定;只定亲仇;罢方针', () => {
    const civ = base();
    const [A, B] = biggest(civ, T);
    const a = polityKey(civ, A);
    const nB = nameAt(civ.polities[B], T);
    const e = withPreset(EMPTY_DRAFT, 'expand');
    expect(policyQueueText(civ, draftIv(a, T, { ...e, foes: [polityKey(civ, B)] }), '甲国')).toBe(`甲国定方针「扩张」，仇${nB}`);
    expect(policyQueueText(civ, draftIv(a, T, { ...e, friends: [polityKey(civ, B)] }), '甲国')).toBe(`甲国定方针「扩张」，亲${nB}`);
    const t = draftIv(a, T, { ...withKnob(e, 'war', 30), focus: 'transport' });
    expect(policyKnobsText(t)).toBe('胆量＋30、开拓＋25、和谈＋15、重运输');
    expect(policyQueueText(civ, t, '甲国')).toBe('甲国定方针「扩张」（胆量＋30、开拓＋25、和谈＋15、重运输）');
    expect(policyQueueText(civ, draftIv(a, T, withKnob(EMPTY_DRAFT, 'coast', -20)), '甲国')).toBe('甲国定方针「自定」（沿海−20）');
    expect(policyQueueText(civ, draftIv(a, T, { ...EMPTY_DRAFT, foes: [polityKey(civ, B)] }), '甲国')).toBe(`甲国定方针，仇${nB}`);
    expect(policyQueueText(civ, draftIv(a, T, EMPTY_DRAFT), '甲国')).toBe('甲国不再定方针（照君主性格）');
  }, 120_000);

  it('「我的干预」:"甲国:方针「扩张」",细调过的带上拧过的几项;罢方针', () => {
    const civ = base();
    const a = polityKey(civ, biggest(civ, T)[0]);
    const e = withPreset(EMPTY_DRAFT, 'expand');
    expect(interventionText(civ, draftIv(a, T, e), -1, '甲国')).toBe('甲国:方针「扩张」');
    expect(interventionText(civ, draftIv(a, T, withKnob(e, 'peace', 0)), -1, '甲国')).toBe('甲国:方针「扩张(细调过)」（胆量＋25、开拓＋25）');
    expect(interventionText(civ, draftIv(a, T, EMPTY_DRAFT), -1, '甲国')).toBe('甲国:不再定方针(照君主性格)');
  }, 120_000);

  it('推完的提示条:生效了写名字;那国已亡写原因(黄色)', () => {
    const civ0 = base();
    const A = biggest(civ0, T)[0];
    const a = polityKey(civ0, A);
    const v = draftIv(a, T, withPreset(EMPTY_DRAFT, 'hold'));
    const civ = generateCiv(world(), { interventions: [v] });
    expect(policyDoneText(civ, v, 0, '甲国', undefined)).toEqual({ ok: true, text: '甲国定方针「守成」' });
    expect(policyDoneText(civ, draftIv(a, T, EMPTY_DRAFT), -1, '甲国', undefined)).toEqual({ ok: true, text: '甲国不再定方针（照君主性格）' });
    // 一国亡了以后才定的
    const dead = civ0.polities.find((p) => p.ended !== undefined && p.ended < T - 10 && p.founded < p.ended - 20)!;
    const late = draftIv(polityKey(civ0, dead.id), T, withPreset(EMPTY_DRAFT, 'expand'));
    const civ2 = generateCiv(world(), { interventions: [late] });
    const r = policyDoneText(civ2, late, 0, '乙国', undefined);
    expect(r.ok).toBe(false);
    expect(r.text.startsWith('乙国的方针没生效：')).toBe(true);
    expect(r.text).toContain('已亡');
  }, 180_000);

  it('旋钮下面一句、人物卡倾向加上方针、和谈那一行', () => {
    const l = { expand: 53, war: 50, develop: 40, trade: 63 };
    expect(knobNote('war', 25, l, '燕溟')).toBe('燕溟好战 50，加上方针 = 75：更容易开战，打起来更难停。');
    expect(knobNote('war', 0, l, '燕溟')).toBe('燕溟好战 50，照他的意思');
    expect(knobNote('expand', 25, l, '燕溟')).toBe('开拓 53 → 78');
    expect(knobNote('coast', 0, l, '燕溟')).toBe('重商 63，照他的意思');
    expect(knobNote('coast', 50, l, '燕溟')).toBe('重商 63 → 100');
    const v: PolicyIv = { kind: 'policy', a: 'polity:c1#0', from: T, preset: 'expand', ...POLICY_PRESETS.expand };
    const rows = leanRows(l, v);
    expect(rows.map((x) => [x.k, x.base, x.add, x.actual])).toEqual([
      ['expand', 53, 25, 78],
      ['war', 50, 25, 75],
      ['develop', 40, 0, 40],
      ['trade', 63, 0, 63],
    ]);
    expect(rows[0].why).toBe('；方针「扩张」让他往外占');
    expect(leanRows(l, null).every((x) => x.add === 0 && x.actual === x.base)).toBe(true);
    expect(peaceRow(v)).toBe('方针让他不轻易议和（＋15）');
    expect(peaceRow({ ...v, peace: -25 })).toBe('方针让他早议和（−25）');
    expect(peaceRow(null)).toBeNull();
  });
});
