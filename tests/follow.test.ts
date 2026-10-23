/**
 * 关注一个人(src/ui/followInfo.ts、directorPlan.ts 的接着跟、edits.follow 的存法):
 * 按稳定键找回(重推、往前推以后编号变了也是他;找不回就回到他的国家)、他不在了接着跟下一位(君主跟继任的,将领、名臣回到他的国家)、
 * 导播排期照着跟的那一段排、选人列表;关注、取消不记撤销步;存档往返一样、旧存档照开、认不出的当没有。
 * 用 seed 7、2024 真实的人物。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { generateCiv } from '../src/gen/civ';
import { playCiv } from '../src/gen/civ/play';
import { MAJOR, mergeChronicle, reignEntries } from '../src/gen/civ/chronicle';
import { fullChronicle } from '../src/gen/civ/religionText';
import { personSpan, rulerNeighbors } from '../src/gen/civ/peopleInfo';
import type { Civ, Person } from '../src/gen/civ/types';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { EMPTY_EDITS, FOLLOW_KEY_MAX, cleanFollow, personKey, polityKey, sameFollow, type WorldEdits } from '../src/gen/edits';
import { editCount, editsLost, makeSave, parseSave, saveText } from '../src/gen/savefile';
import { recipeOfSave, recipeText } from '../src/gen/snapshot';
import { stepwiseToNormal } from '../src/gen/stepwise';
import { directorPlan } from '../src/ui/directorPlan';
import {
  activeAt,
  canFollow,
  directorFocusOf,
  followAt,
  followChoices,
  followLegs,
  followNext,
  followRefOf,
  followRole,
  followSub,
  goneWord,
  personEnd,
  polityKeyOfPerson,
  resolveFollow,
} from '../src/ui/followInfo';
import { canUndoEdit, clearEdits, getEdits, revertEdits, setEdits, setFollow } from '../src/ui/editsStore';
import { getDirectorFollow, setDirectorFollow } from '../src/ui/directorStore';

const world7 = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
const civ7 = generateCiv(world7);
const world24 = generateWorld({ ...DEFAULT_PARAMS, seed: 2024 });
const civ24 = generateCiv(world24);

const people = (civ: Civ) => civ.people ?? [];
/** 有继任的君主(继任的也有自己的在位年份) */
const rulerWithNext = (civ: Civ) => people(civ).find((x) => x.role === 'ruler' && x.until !== undefined && rulerNeighbors(civ, x).next && x.from !== undefined && x.until - x.from > 5)!;

describe('存法(edits.follow)', () => {
  it('cleanFollow:种类和键要对得上,多余的字段去掉;sameFollow 按清理过的比', () => {
    const p = { kind: 'person', key: 'person:polity:c12#0|ruler|燕溟|1477' } as const;
    expect(cleanFollow(p)).toBe(p);
    expect(cleanFollow({ ...p, x: 1 })).toEqual(p);
    expect(cleanFollow({ kind: 'polity', key: 'polity:c12#0' })).toEqual({ kind: 'polity', key: 'polity:c12#0' });
    for (const bad of [null, 1, 'x', [], {}, { kind: 'person' }, { kind: 'person', key: 'polity:c12#0' }, { kind: 'polity', key: 'person:polity:c1#0|ruler|a|1' }, { kind: 'world', key: 'world:1' }, { kind: 'polity', key: 'polity:' }, { kind: 'polity', key: `polity:${'x'.repeat(FOLLOW_KEY_MAX)}` }])
      expect(cleanFollow(bad)).toBeUndefined();
    expect(sameFollow(undefined, null)).toBe(true);
    expect(sameFollow(p, { ...p })).toBe(true);
    expect(sameFollow(p, { kind: 'polity', key: 'polity:c12#0' })).toBe(false);
  });

  it('存档往返一样;不算修改、不进配方指纹;旧存档(没有这一项)照开;认不出的当没有并提示', () => {
    const ruler = rulerWithNext(civ7);
    const follow = followRefOf(civ7, { kind: 'person', id: ruler.id })!;
    const edits: WorldEdits = { ...EMPTY_EDITS, follow };
    const save = makeSave(DEFAULT_PARAMS, edits, 'x');
    expect(save.edits.follow).toEqual(follow);
    const back = parseSave(saveText(save));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.save.edits.follow).toEqual(follow);
    expect(back.warnings).toEqual([]);
    // 再存一次逐字一样
    expect(saveText(makeSave(DEFAULT_PARAMS, back.save.edits, 'x', undefined, save.savedAt))).toBe(saveText(save));
    // 不算修改,换成别的存档也不算丢了一处;配方一样
    const plain = makeSave(DEFAULT_PARAMS, EMPTY_EDITS, 'x', undefined, save.savedAt);
    expect(editCount(edits)).toBe(0);
    expect(editsLost(save, plain)).toBe(0);
    expect(recipeText(recipeOfSave(save))).toBe(recipeText(recipeOfSave(plain)));
    // 旧存档:没有这一项
    const old = parseSave(saveText(plain));
    expect(old.ok && old.save.edits.follow).toBeFalsy();
    expect(old.ok && old.warnings).toEqual([]);
    // 认不出的:当没有,提示一句
    const raw = JSON.parse(saveText(save));
    raw.edits.follow = { kind: 'person', key: 42 };
    const bad = parseSave(JSON.stringify(raw));
    expect(bad.ok).toBe(true);
    if (bad.ok) {
      expect(bad.save.edits.follow).toBeUndefined();
      expect(bad.warnings.some((w) => w.includes('导播跟着谁'))).toBe(true);
    }
    // 存回推演模式也带着
    expect(stepwiseToNormal({ ...edits, play: { year: 1600, commands: [] } })?.follow).toEqual(follow);
  });

  describe('关注、取消(不记撤销步,撤销别的时照留)', () => {
    beforeEach(() => clearEdits());
    it('setFollow / setDirectorFollow', () => {
      const ref = followRefOf(civ7, { kind: 'person', id: rulerWithNext(civ7).id })!;
      setDirectorFollow(ref);
      expect(getEdits().follow).toEqual(ref);
      expect(getDirectorFollow()).toEqual(ref);
      expect(canUndoEdit()).toBe(false);
      // 同一个:不换对象
      const now = getEdits();
      setFollow({ ...ref });
      expect(getEdits()).toBe(now);
      // 取消
      setDirectorFollow(null);
      expect(getEdits().follow).toBeUndefined();
      expect(getDirectorFollow()).toBeNull();
      // 不合格的当取消
      setFollow(ref);
      setFollow({ kind: 'person', key: 'nope' });
      expect(getEdits().follow).toBeUndefined();
      expect(canUndoEdit()).toBe(false);
    });
    it('撤销别的修改时照现在的留着', () => {
      const ref = followRefOf(civ7, { kind: 'polity', id: 0 })!;
      const a: WorldEdits = { ...EMPTY_EDITS, names: { 'polity:c1#0': '甲' } };
      const b: WorldEdits = { ...EMPTY_EDITS };
      setEdits({ ...a, follow: ref });
      expect(revertEdits(getEdits(), a, b).follow).toEqual(ref);
    });
  });
});

describe('按稳定键找回', () => {
  it('国家、人物:编号 → 键 → 编号;重推以后照样找回(同名、同年生、同身份)', () => {
    for (const civ of [civ7, civ24]) {
      const again = generateCiv(civ === civ7 ? world7 : world24);
      for (const x of people(civ).filter((p, i) => canFollow(p) && i % 7 === 0)) {
        const ref = followRefOf(civ, { kind: 'person', id: x.id })!;
        expect(ref.kind).toBe('person');
        expect(resolveFollow(civ, ref)).toEqual({ kind: 'person', id: x.id });
        const t = resolveFollow(again, ref)!;
        const y = again.people![t.id];
        expect([y.name, y.born, y.role]).toEqual([x.name, x.born, x.role]);
        expect(polityKeyOfPerson(ref.key)).toBe(polityKey(civ, x.polity));
      }
      const pref = followRefOf(civ, { kind: 'polity', id: 1 })!;
      expect(resolveFollow(again, pref)).toEqual({ kind: 'polity', id: 1 });
    }
  });

  it('找不回这个人 = 回到他的国家;国家键也不对 = null', () => {
    const x = rulerWithNext(civ7);
    const key = personKey(civ7, x.id).replace(/\|\d+$/, '|99999');
    expect(resolveFollow(civ7, { kind: 'person', key })).toEqual({ kind: 'polity', id: x.polity });
    expect(resolveFollow(civ7, { kind: 'person', key: 'person:polity:c999999999#7|ruler|无|1' })).toBeNull();
    expect(resolveFollow(civ7, null)).toBeNull();
    expect(followRefOf(civ7, { kind: 'person', id: 1e9 })).toBeNull();
  });

  it('逐年推演往前推:还在世时记下的人,推到他去世以后还是按键找回,接着跟继任的', () => {
    const w = generateWorld({ ...DEFAULT_PARAMS, seed: 2024, cells: 12000 });
    const a = playCiv(w, {}, { year: 1400, commands: [] });
    const b = playCiv(w, {}, { year: 1500, commands: [] });
    // 1400 年在位、1500 年以前失位的君主
    const x = people(a).find((p) => p.role === 'ruler' && p.until === undefined && p.from !== undefined && p.from < 1395 && b.people!.some((q) => personKey(b, q.id) === personKey(a, p.id) && q.until !== undefined && q.until < 1495));
    expect(x).toBeTruthy();
    const ref = followRefOf(a, { kind: 'person', id: x!.id })!;
    // 1400 年那一份:他还在,一路跟到底
    expect(followAt(a, resolveFollow(a, ref), 1399.5).target).toEqual({ kind: 'person', id: x!.id });
    expect(followLegs(a, resolveFollow(a, ref))).toHaveLength(1);
    // 1500 年那一份:找回的是他;他失位以后跟的是下一位
    const start = resolveFollow(b, ref)!;
    const y = b.people![start.id];
    expect([y.name, y.born]).toEqual([x!.name, x!.born]);
    const leg = followAt(b, start, y.until! + 0.5);
    expect(leg.prev?.id).toBe(y.id);
    expect(leg.target).toEqual(followNext(b, y));
  });
});

describe('他不在了接着跟下一位', () => {
  it('君主:失位那一刻起跟继任的;一路接下去,每一段首尾相接', () => {
    for (const civ of [civ7, civ24]) {
      const x = rulerWithNext(civ);
      const next = rulerNeighbors(civ, x).next!;
      const start = { kind: 'person' as const, id: x.id };
      expect(followAt(civ, start, x.until! - 0.01).target).toEqual(start);
      const after = followAt(civ, start, x.until!);
      expect(after.target).toEqual({ kind: 'person', id: next.id });
      expect(after.prev).toBe(x);
      expect(after.from).toBe(x.until);
      const legs = followLegs(civ, start);
      expect(legs[0]).toMatchObject({ from: -Infinity, to: x.until, prev: null });
      for (let i = 1; i < legs.length; i++) {
        expect(legs[i].from).toBe(legs[i - 1].to);
        expect(legs[i].prev).not.toBeNull();
      }
      expect(legs[legs.length - 1].to).toBe(Infinity);
      // 排到哪年为止:只算到那一年
      expect(followLegs(civ, start, x.until! - 1)).toHaveLength(1);
    }
  });

  it('将领、名臣:去世 / 去职以后回到他的国家(那时国家已经没了 = 全世界的大事)', () => {
    for (const civ of [civ7, civ24]) {
      for (const role of ['general', 'minister'] as const) {
        const list = people(civ).filter((p) => p.role === role && personEnd(p) < Infinity);
        expect(list.length).toBeGreaterThan(0);
        for (const x of list.slice(0, 20)) {
          const leg = followAt(civ, { kind: 'person', id: x.id }, personEnd(x) + 0.1);
          const P = civ.polities[x.polity];
          expect(leg.prev).toBe(x);
          expect(leg.target).toEqual(P.ended === undefined || P.ended > personEnd(x) ? { kind: 'polity', id: P.id } : null);
          expect(leg.to).toBe(Infinity);
        }
      }
    }
  });

  it('没有继任的末代君主:回到国家;国家同时亡了 = 全世界的大事', () => {
    const last = people(civ24).filter((p) => p.role === 'ruler' && p.until !== undefined && !rulerNeighbors(civ24, p).next);
    expect(last.length).toBeGreaterThan(0);
    for (const x of last) {
      const P = civ24.polities[x.polity];
      expect(followNext(civ24, x)).toEqual(P.ended === undefined || P.ended > x.until! ? { kind: 'polity', id: P.id } : null);
    }
  });

  it('名牌上的字:身份、"在位第 N 年" / "N 年起领兵"、怎么不在了', () => {
    const x = rulerWithNext(civ24);
    expect(followRole(civ24, x)).toMatch(/.+/);
    expect(followSub(civ24, x, x.from! + 3.5)).toMatch(/^在[位任]第 4 年$/);
    expect(followSub(civ24, x, x.from! - 2)).toMatch(/^\d+ 年(即位|就任)$/);
    expect(goneWord(civ24, x)).toMatch(/.+/);
    const g = people(civ24).find((p) => p.role === 'general' && p.commands?.length)!;
    expect(followSub(civ24, g, g.commands![0].from + 1)).toBe(`${Math.floor(g.commands![0].from)} 年起领兵`);
    expect(['战死', '去世']).toContain(goneWord(civ24, g));
  });
});

describe('导播排期跟着这一路排', () => {
  const all = mergeChronicle(fullChronicle(civ24), reignEntries(civ24));
  const told = (p: ReturnType<typeof directorPlan>) => p.segments.flatMap((s) => s.items.map((i) => i.entry));
  const mentions = (e: (typeof all)[number], id: number) => !!e.people?.includes(id) || !!e.children?.some((c) => c.people?.includes(id));

  it('directorFocusOf:国家只放它的事;人 = 接着跟、他在台上时他那一国重要度 ≥ 2 的也算', () => {
    const x = rulerWithNext(civ24);
    expect(directorFocusOf(civ24, followRefOf(civ24, { kind: 'polity', id: x.polity }))).toEqual({ kind: 'polity', id: x.polity, others: 'none' });
    expect(directorFocusOf(civ24, followRefOf(civ24, { kind: 'person', id: x.id }))).toEqual({ kind: 'person', id: x.id, others: 'none', min: 2, relay: true });
    expect(directorFocusOf(civ24, null)).toBeNull();
  });

  it('跨过他失位那年:之前讲他的事,之后讲继任的;不接着跟就不讲继任的事', () => {
    const x = rulerWithNext(civ24);
    const next = rulerNeighbors(civ24, x).next!;
    const from = Math.floor(x.from!);
    const to = Math.min(civ24.endYear, Math.floor(next.until ?? civ24.endYear) + 1);
    const focus = directorFocusOf(civ24, followRefOf(civ24, { kind: 'person', id: x.id }))!;
    const p = directorPlan(world24, civ24, { from, to, entries: all, focus, pace: { mode: 'auto' } });
    const own = (e: (typeof all)[number], y: Person) => {
      const s = personSpan(y);
      return e.importance >= 2 && e.year >= s.from && e.year <= (s.until ?? Infinity) && (e.polities.includes(y.polity) || !!e.children?.some((c) => c.polities.includes(y.polity)));
    };
    const kept = told(p);
    const legs = followLegs(civ24, { kind: 'person', id: x.id }, to);
    for (const e of kept) {
      const leg = [...legs].reverse().find((l) => e.year >= l.from)!;
      const y = leg.target?.kind === 'person' ? civ24.people![leg.target.id] : null;
      const ok = (y && (mentions(e, y.id) || own(e, y))) || legs.some((l) => l.target?.kind === 'person' && mentions(e, l.target.id)) || (leg.target?.kind === 'polity' && e.importance >= 2) || (!leg.target && e.importance >= MAJOR);
      expect(ok).toBe(true);
    }
    // 继任的那几年:讲到了继任的(写到他的事、或他在位时他那一国的事)
    const later = kept.filter((e) => e.year >= x.until!);
    const plain = directorPlan(world24, civ24, { from, to, entries: all, focus: { ...focus, relay: false }, pace: { mode: 'auto' } });
    const laterPlain = told(plain).filter((e) => e.year > x.until! + 1);
    expect(later.length).toBeGreaterThanOrEqual(laterPlain.length);
    for (const e of laterPlain) expect(mentions(e, x.id) || e.year <= (x.until ?? 0)).toBe(true);
  });
});

describe('选人列表', () => {
  it('这一年在台上的君主、将领、名臣(没有宗室),按国家分组,大国在前;正跟着的人列在最前面', () => {
    const year = 1500;
    const rank = (p: number) => p;
    const groups = followChoices(civ24, year, rank);
    expect(groups.length).toBeGreaterThan(0);
    const ids = new Set(groups.flatMap((g) => g.people.map((x) => x.id)));
    for (const x of people(civ24)) expect(ids.has(x.id)).toBe(x.role !== 'prince' && activeAt(x, year) && !!civ24.polities[x.polity]);
    for (const g of groups) for (const x of g.people) expect(x.polity).toBe(g.polity);
    expect(groups.map((g) => g.polity)).toEqual([...groups.map((g) => g.polity)].sort((a, b) => a - b));
    // 正跟着、这一年不在台上的那位:列在他那一国的最前面,那一国排第一
    const gone = people(civ24).find((x) => x.role === 'general' && !activeAt(x, year) && civ24.polities[x.polity])!;
    const kept = followChoices(civ24, year, rank, gone.id);
    expect(kept[0].polity).toBe(gone.polity);
    expect(kept[0].people[0]).toBe(gone);
  });
});
