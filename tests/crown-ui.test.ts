/**
 * 让作者的人物即位在界面上的部分(ui/crownInfo.ts、gen/edits.ts 的 foundedPolityKey、gen/characters.ts 的性格):
 * - 另立一国、同一年让他即位:立国以前就能算出新国的稳定键,和推演后的一样
 * - 人物卡上的性格:清理、没填过的默认值
 * - 一条即位的说法(单子、「我的干预」、提示条):退位 / 到卒年 / 没写卒年
 * - 人物卡上他的即位:待推演 / 下一步生效、生效了、没生效(写原因)
 * - 改朝换代以后新朝的称呼:东方"国号大辰",西幻"卡诺王朝"
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/timeline';
import { polityName } from '../src/gen/civ/growth';
import { foundedPolityKey, polityKey, regionKey, resolveKey, type Intervention } from '../src/gen/edits';
import { CHAR_LEANING_DEFAULT, characterLeanings, cleanCharacter } from '../src/gen/characters';
import { alivePolities, characterCrowns, crownDoneText, crownLine, newReignName } from '../src/ui/crownInfo';
import type { Pending } from '../src/ui/pendingStore';

const seed = 7;
let w: World | null = null;
let b: Civ | null = null;
const world = () => (w ??= generateWorld({ ...DEFAULT_PARAMS, seed }));
const base = () => (b ??= generateCiv(world()));
type CrownIv = Extract<Intervention, { kind: 'crown' }>;
const LEAN = { expand: 70, war: 80, develop: 40, trade: 30 };
const crown = (a: string, from: number, o: Partial<CrownIv> = {}): CrownIv => ({ kind: 'crown', a, char: 1, from, born: from - 32, leanings: LEAN, ...o });

describe('让作者的人物即位 · 另立一国', () => {
  it('立国以前算出的新国稳定键,和推演后立出来的国家一样;州键不对 = null', () => {
    const civ = base();
    const T = 1500;
    const own = ownersAt(civ, T).polity;
    const caps = new Set(civ.polities.flatMap((p) => (p.capitals ?? []).map((c) => c.settlement)));
    // 有国家的一州、有城、不是哪国的国都
    const s = civ.settlements.find((x) => x.founded < T && (x.ended === undefined || x.ended > T) && own[x.region] >= 0 && !caps.has(x.id))!;
    const rk = regionKey(civ, s.region);
    const key = foundedPolityKey(civ, rk, T);
    const after = generateCiv(world(), { interventions: [{ kind: 'found', region: rk, from: T }] });
    const made = after.annals.find((e) => e.kind === 'intervene')!.a;
    expect(made).toBeGreaterThanOrEqual(0);
    expect(key).toBe(polityKey(after, made));
    expect(resolveKey(after, key!)).toEqual({ kind: 'polity', id: made });
    expect(foundedPolityKey(civ, 'region:nope', T)).toBeNull();
    // 同一州单子里还有一条更早的立国(还没推演):新国是这州的下一个
    const two = generateCiv(world(), { interventions: [{ kind: 'found', region: rk, from: T - 50 }, { kind: 'found', region: rk, from: T }] });
    const made2 = two.annals.filter((e) => e.kind === 'intervene').map((e) => e.a);
    expect(made2.length).toBe(2);
    expect(foundedPolityKey(civ, rk, T - 50)).toBe(polityKey(two, made2[0]));
    expect(made2[1]).toBeGreaterThanOrEqual(0);
    expect(foundedPolityKey(civ, rk, T, 1)).toBe(polityKey(two, made2[1]));
    expect(foundedPolityKey(civ, rk, T)).not.toBe(polityKey(two, made2[1]));
  }, 120_000);

  it('那一年还在的国家:有国土的才列,大的在前,写州数和那年在位的君主', () => {
    const civ = base();
    const list = alivePolities(civ, 1500);
    expect(list.length).toBeGreaterThan(3);
    for (let i = 1; i < list.length; i++) expect(list[i - 1].regions).toBeGreaterThanOrEqual(list[i].regions);
    const own = ownersAt(civ, 1500).polity;
    for (const p of list) expect(own.filter((o) => o === p.id).length).toBe(p.regions);
    expect(list[0].name).toBe(polityName(civ.polities[list[0].id], 1500));
  });
});

describe('让作者的人物即位 · 性格', () => {
  it('四项取整夹到 0–100,缺的补 50;不是对象当作没填;没填过的四项都是 50', () => {
    const c = cleanCharacter({ id: 1, name: '甲', born: 1400, leanings: { expand: 120.4, war: -3, develop: 'x', trade: 33.6 } })!;
    expect(c.leanings).toEqual({ expand: 100, war: 0, develop: CHAR_LEANING_DEFAULT, trade: 34 });
    expect(cleanCharacter({ id: 1, name: '甲', born: 1400, leanings: [1, 2] })!.leanings).toBeUndefined();
    expect(characterLeanings({})).toEqual({ expand: 50, war: 50, develop: 50, trade: 50 });
    expect(characterLeanings({ leanings: LEAN })).toBe(LEAN);
  });
});

describe('让作者的人物即位 · 说法', () => {
  it('填了退位年份 / 到卒年 / 人物没写卒年', () => {
    expect(crownLine('林小满', '有桑皇朝', 1530, 1541, undefined)).toBe('林小满即有桑皇朝君位，1530 年退位');
    expect(crownLine('林小满', '有桑皇朝', 1541, 1541, undefined)).toBe('林小满即有桑皇朝君位，到 1541 年卒');
    expect(crownLine('林小满', '有桑皇朝', undefined, undefined, undefined)).toBe('林小满即有桑皇朝君位');
  });

  it('改朝换代以后新朝的称呼:东方写国号简称,西幻写王朝;没起名 = 空串', () => {
    const civ = base();
    const east = civ.polities.find((p) => p.eastern && (p.dynasties?.length ?? 0) > 1 && p.dynasties![1].name);
    if (east) {
      const r = newReignName(east, 1);
      expect(r.eastern).toBe(true);
      expect(r.name).toContain(east.dynasties![1].name);
    }
    const west = civ.polities.find((p) => !p.eastern && (p.dynasties?.length ?? 0) > 1 && p.dynasties![1].name);
    if (west) expect(newReignName(west, 1)).toEqual({ name: `${west.dynasties![1].name}王朝`, eastern: false });
    expect(east || west).toBeTruthy();
    expect(newReignName(civ.polities[0], 99).name).toBe('');
  });
});

describe('让作者的人物即位 · 人物卡上他的即位', () => {
  it('还在单子里:待推演 / 下一步生效;生效了:推演里的他;没生效:写原因,能去掉', () => {
    const civ0 = base();
    const T = 1500;
    const own = ownersAt(civ0, T).polity;
    const pid = own.find((o) => o >= 0)!;
    const ok = crown(polityKey(civ0, pid), T, { until: 1530 });
    // 那一年已亡的国家
    const gone = civ0.polities.find((p) => p.ended !== undefined && p.ended < T - 20 && p.founded < T - 200)!;
    const bad = crown(polityKey(civ0, gone.id), T + 10, { char: 2, born: T - 20 });
    const queued: Pending = { id: 1, from: T, text: '', kind: 'iv', v: ok };
    expect(characterCrowns(civ0, 1, [queued], [], false, undefined)).toEqual([{ kind: 'queued', v: ok, step: false, A: polityName(civ0.polities[pid], T) }]);
    expect(characterCrowns(civ0, 1, [queued], [], true, undefined)[0]).toMatchObject({ kind: 'queued', step: true });
    expect(characterCrowns(civ0, 2, [queued], [], false, undefined)).toEqual([]);

    const ivs = [ok, bad];
    const civ = generateCiv(world(), { interventions: ivs });
    const [done] = characterCrowns(civ, 1, [], ivs, false, undefined);
    expect(done.kind).toBe('done');
    if (done.kind === 'done') expect(done.x).toMatchObject({ author: 1, from: T, polity: pid, rise: 'crown' });
    const [v] = characterCrowns(civ, 2, [], ivs, false, undefined);
    expect(v).toMatchObject({ kind: 'void', at: 1 });
    if (v.kind === 'void') expect(v.why).toBe(`那一年${polityName(gone, gone.ended! - 1 / 512)}已经亡了（${Math.floor(gone.ended!)} 年）`);
    // 提示条
    const chars = [
      { id: 1, name: '林小满', born: T - 32, died: 1541, color: 'red' as const },
      { id: 2, name: '苏晚', born: T - 20, color: 'purple' as const },
    ];
    expect(crownDoneText(civ, ok, 0, chars, undefined)).toEqual({ ok: true, text: `林小满即${polityName(civ.polities[pid], T)}君位，1530 年退位` });
    const f = crownDoneText(civ, bad, 1, chars, undefined);
    expect(f.ok).toBe(false);
    expect(f.text.startsWith(`苏晚没能即位：第 ${T + 10} 年`)).toBe(true);
  }, 120_000);
});
