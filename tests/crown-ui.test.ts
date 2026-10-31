/**
 * 让作者的人物即位在界面上的部分(ui/crownInfo.ts、gen/edits.ts 的 foundedPolityKey、gen/characters.ts 的性格):
 * - 另立一国、同一年让他即位:立国以前就能算出新国的稳定键,和推演后的一样
 * - 人物卡上的性格:清理、没填过的默认值
 * - 一条即位的说法(单子、「我的干预」、提示条):退位 / 到卒年 / 没写卒年
 * - 人物卡上他的即位:待推演 / 下一步生效、生效了、没生效(写原因)
 * - 改朝换代以后新朝的称呼:东方"国号大辰",西幻"卡诺王朝"
 * - 改人物的卒年、生年、性格,删人物时问的那一句(一起改 / 只改人物卡;连即位一起去掉 / 只删人物);世系图里他那一棵、接他位那一棵上面写什么
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/timeline';
import { polityName } from '../src/gen/civ/growth';
import { cleanIntervention, foundedPolityKey, polityKey, regionKey, resolveKey, type Intervention } from '../src/gen/edits';
import { CHAR_LEANING_DEFAULT, characterLeanings, cleanCharacter } from '../src/gen/characters';
import { alivePolities, characterCrowns, crownDeleteAsk, crownDoneText, crownEditAsk, crownLine, newReignName } from '../src/ui/crownInfo';
import { peopleIndex } from '../src/gen/civ/story/peopleInfo';
import { dynastyRows, layoutDynasty, lineageText, treeLabel } from '../src/gen/civ/story/lineageInfo';
import type { Pending } from '../src/ui/pendingStore';

const seed = 7;
let w: World | null = null;
let b: Civ | null = null;
const world = () => (w ??= generateWorld({ ...DEFAULT_PARAMS, seed }));
const base = () => (b ??= generateCiv(world()));
type CrownIv = Extract<Intervention, { kind: 'crown' }>;
const LEAN = { expand: 70, war: 80, develop: 40, trade: 30 };
const crown = (a: string, from: number, o: Partial<CrownIv> = {}): CrownIv => ({ kind: 'crown', a, char: 1, from, born: from - 32, leanings: LEAN, ...o });
/**
 * 林小满即位的那一国:第 1500 年国土最大、到 1600 年还在的国家(以前写死第 2 国;GENERATOR_VERSION 46 大迁徙以后
 * 早年迁来立的国占了前面的编号,第 2 国 1500 年已经亡了,改成按条件找)
 */
let pidMemo: number | null = null;
const pid = (): number => {
  if (pidMemo !== null) return pidMemo;
  const civ = base();
  const own = ownersAt(civ, 1500).polity;
  const n = new Map<number, number>();
  for (const p of own) if (p >= 0) n.set(p, (n.get(p) ?? 0) + 1);
  let best = -1;
  for (const [p, k] of n) if ((civ.polities[p].ended ?? Infinity) > 1600 && (best < 0 || k > n.get(best)!)) best = p;
  return (pidMemo = best);
};

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
    expect(crownLine('林小满', '有桑皇朝', { until: 1530, abdicate: true }, 1541, undefined)).toBe('林小满即有桑皇朝君位，1530 年退位');
    expect(crownLine('林小满', '有桑皇朝', { until: 1541 }, 1541, undefined)).toBe('林小满即有桑皇朝君位，到 1541 年卒');
    expect(crownLine('林小满', '有桑皇朝', {}, undefined, undefined)).toBe('林小满即有桑皇朝君位');
    // 填了退位年份,后来把卒年改成同一年:照旧是"退位"(以前的存档没有 abdicate:和卒年一样 = 到卒年)
    expect(crownLine('林小满', '有桑皇朝', { until: 1530, abdicate: true }, 1530, undefined)).toBe('林小满即有桑皇朝君位，1530 年退位');
    expect(crownLine('林小满', '有桑皇朝', { until: 1530 }, 1541, undefined)).toBe('林小满即有桑皇朝君位，1530 年退位');
  });

  it('干预里的 abdicate:有下台年份才留,只认 true', () => {
    const k = polityKey(base(), pid());
    const v = crown(k, 1500, { until: 1530, abdicate: true });
    expect(cleanIntervention(v)).toBe(v);
    expect(cleanIntervention({ ...v, until: undefined })).toEqual(crown(k, 1500));
    expect(cleanIntervention({ ...v, abdicate: 1 })).toEqual(crown(k, 1500, { until: 1530 }));
  }, 120_000);

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

describe('让作者的人物即位 · 改人物、删人物时问一句;世系图', () => {
  // 种子 7:林小满 1500 年即那时国土最大的国家(见 pid)君位,填了 1530 年退位;卒年 1541
  const T = 1500;
  const LIN = { id: 1, name: '林小满', born: 1468, died: 1541, color: 'red' as const, leanings: LEAN };
  let made: { civ: Civ; ivs: Intervention[]; A: string } | null = null;
  const setup = () => {
    if (made) return made;
    const key = polityKey(base(), pid());
    const ivs: Intervention[] = [crown(key, T, { born: 1468, until: 1530, abdicate: true })];
    const civ = generateCiv(world(), { interventions: ivs });
    return (made = { civ, ivs, A: polityName(civ.polities[pid()], T) });
  };

  it('卒年改得比退位那年早:默认一起改(到卒年下台),只改人物卡照旧当到退位那年', () => {
    const { civ, ivs, A } = setup();
    const ask = crownEditAsk(civ, ivs, LIN, { ...LIN, died: 1525 }, undefined)!;
    expect(ask.title).toBe('要一起改他的即位吗？');
    expect(ask.lead).toBe(`林小满当过${A}的君主（1500 年即位，1530 年退位）。卒年改成 1525 年，比退位那年早。`);
    expect(ask.yes).toEqual(['一起改：到 1525 年卒时下台', '从第 1500 年起重新推演；之后照常有人继位']);
    expect(ask.no).toEqual(['只改人物卡', '推演里他照旧当到 1530 年，和卒年对不上']);
    expect(ask.ivs).toEqual([crown(polityKey(civ, pid()), T, { born: 1468, until: 1525 })]);
    expect(crownLine('林小满', A, ask.ivs[0] as CrownIv, 1525, undefined)).toBe(`林小满即${A}君位，到 1525 年卒`);
    // 卒年改晚了:填的退位年份照旧,不用问;只改了名字、身份:不用问
    expect(crownEditAsk(civ, ivs, LIN, { ...LIN, died: 1560 }, undefined)).toBeNull();
    expect(crownEditAsk(civ, ivs, LIN, { ...LIN, name: '林大满', role: '边将' }, undefined)).toBeNull();
    // 填了 1530 年退位,卒年改成 1530:不用问,说法照旧是退位
    expect(crownEditAsk(civ, ivs, LIN, { ...LIN, died: 1530 }, undefined)).toBeNull();
    expect(crownLine('林小满', A, ivs[0] as CrownIv, 1530, undefined)).toBe(`林小满即${A}君位，1530 年退位`);
  }, 120_000);

  it('到卒年的即位跟着新卒年;卒年早到即位以前 = 去掉这条;生年、性格照新的抄进去', () => {
    const { civ, ivs } = setup();
    // 到卒年(没填退位年份):这份历史要按它推
    const { abdicate: _, ...v0 } = ivs[0] as CrownIv;
    const toDeath: Intervention[] = [{ ...v0, until: 1541 }];
    const civ2 = generateCiv(world(), { interventions: toDeath });
    const later = crownEditAsk(civ2, toDeath, LIN, { ...LIN, died: 1550 }, undefined)!;
    expect((later.ivs[0] as CrownIv).until).toBe(1550);
    expect(later.yes[0]).toBe('一起改：到 1550 年卒时下台');
    expect(later.lead.endsWith('（1500 年即位，到 1541 年卒）。卒年改成 1550 年。')).toBe(true);
    const gone = crownEditAsk(civ, ivs, LIN, { ...LIN, died: 1490 }, undefined)!;
    expect(gone.ivs).toEqual([]);
    expect(gone.yes[0]).toBe('一起改：去掉这条即位');
    expect(gone.lead.endsWith('卒年改成 1490 年，在即位那年之前。')).toBe(true);
    const lean = { expand: 10, war: 20, develop: 30, trade: 40 };
    const both = crownEditAsk(civ, ivs, LIN, { ...LIN, born: 1470, leanings: lean }, undefined)!;
    expect(both.ivs[0]).toMatchObject({ born: 1470, leanings: lean, until: 1530, abdicate: true });
    expect(both.yes).toEqual(['一起改', '从第 1500 年起重新推演；推演里他的年纪跟着改']);
    expect(both.no[1]).toBe('推演里他的年纪照旧，和生年对不上');
    expect(crownEditAsk(civ, ivs, LIN, { ...LIN, leanings: lean }, undefined)!.no[1]).toBe('推演里他照旧按原来的性格行事');
    // 别人的即位不动
    expect(crownEditAsk(civ, ivs, { ...LIN, id: 2 }, { ...LIN, id: 2, died: 1490 }, undefined)).toBeNull();
  }, 120_000);

  it('删当过君主的人物:问连即位一起去掉还是只删人物;没当过的不问', () => {
    const { civ, ivs, A } = setup();
    const ask = crownDeleteAsk(civ, ivs, LIN, undefined)!;
    expect(ask.title).toBe('删除人物「林小满」');
    expect(ask.lead).toBe(`他当过${A}的君主（1500–1530 年）。`);
    expect(ask.yes).toEqual(['连他的即位一起去掉', `从第 1500 年起重新推演，${A}照原来的历史走`]);
    expect(ask.no).toEqual(['只删人物，君位留着', '推演里那位君主改叫「作者的人物」，历史不变']);
    expect(ask.ivs).toEqual([]);
    expect(ask.done).toBe('已删除人物「林小满」和他的即位');
    expect(crownDeleteAsk(civ, ivs, { ...LIN, id: 2 }, undefined)).toBeNull();
  }, 120_000);

  it('世系图:他单独一棵写"作者立的君主",接他位的那一棵写"继他之位"', () => {
    const { civ } = setup();
    const me = peopleIndex(civ).rulers[pid()].find((r) => r.author === 1)!;
    expect(me).toBeTruthy();
    const row = dynastyRows(civ, pid()).find((r) => r.rulers.includes(me))!;
    const trees = layoutDynasty(civ, row);
    const i = trees.findIndex((t) => t.nodes.some((n) => n.p === me));
    expect(treeLabel(row, trees, i)).toBe(i === 0 ? '' : '作者立的君主');
    const next = row.rulers[row.rulers.indexOf(me) + 1];
    const j = trees.findIndex((t) => t.nodes.some((n) => n.p === next));
    if (j === i + 1) expect(treeLabel(row, trees, j)).toBe('继他之位');
    expect(treeLabel(row, trees, 0)).toBe('');
    expect(lineageText(civ, pid())).toContain('作者立的君主');
  }, 120_000);
});
