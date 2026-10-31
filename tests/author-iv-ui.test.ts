/**
 * 作者的人物当将领、名臣、掌权在界面上的部分(ui/authorIvInfo.ts、gen/civ/appoint.ts 的 appointPreview、gen/civ/officials.ts 的 deedPosts):
 * - 一条的说法(单子、「我的干预」):卸任年 / 到卒年 / 没写卒年、能力、名臣、掌权;没生效那段话的后半(女的写"她")
 * - 人物卡上他的一条:待推演 / 下一步生效、生效了、没生效(那国已亡,写亡国那年)
 * - 名臣经手的事:最大的 5 件,其余折起来
 * - 挂帅的每一仗:胜 / 无功 / 兵败、战绩一行;仕途一行
 * - 任将页"照现在的推演,他会领哪几仗"和真推完的一样
 * - 名臣的官:侍郎做起、经手一件升一级(经手完的下一刻)、做到最高时已有作者的名臣做着就写次一级
 * - 编年史:以他为某国将;从将领任上入朝的"某国将林小满入朝为侍郎(,副将某某代领其军)";开战"以他为将、某某为副";议和写在推演的名臣后面
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import type { PersonDeed } from '../src/gen/civ/types';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { polityName } from '../src/gen/civ/growth';
import { buildChronicle, type ChronicleEntry } from '../src/gen/civ/story/chronicle';
import { appointPreview, authorPostsFrom } from '../src/gen/civ/appoint';
import { AUTHOR_MINISTER_BELOW, authorMinisterLadder, deedPosts } from '../src/gen/civ/officials';
import { applyCharacters } from '../src/gen/characters';
import { polityKey, type Intervention } from '../src/gen/edits';
import {
  DEEDS_SHOWN,
  careerLine,
  characterPosts,
  deedsShown,
  ledWars,
  postLine,
  voidTail,
  warLines,
  warTally,
  type AppointIv,
} from '../src/ui/authorIvInfo';
import type { Pending } from '../src/ui/pendingStore';
import { OFFICIAL_KNOBS } from '../src/gen/civ/engine/knobs';

const LEAN = { expand: 35, war: 25, develop: 70, trade: 60 };

describe('说法', () => {
  const g = (o: Partial<AppointIv> = {}): AppointIv => ({ kind: 'appoint', a: 'polity:x', char: 1, role: 'general', born: 2398, from: 2421, ...o });
  it('任将:到卸任年 / 到卒年 / 没写卒年到 65 岁卸甲;能力写在国名后面', () => {
    expect(postLine('林小满', '大衍王朝', g({ until: 2442, died: 2461 }), undefined)).toBe('林小满为大衍王朝将，到 2442 年卸任');
    expect(postLine('林小满', '大衍王朝', g({ died: 2461 }), undefined)).toBe('林小满为大衍王朝将，到卒年（2461 年）');
    expect(postLine('林小满', '大衍王朝', g(), undefined)).toBe('林小满为大衍王朝将，到 65 岁卸甲');
    expect(postLine('林小满', '大衍王朝', g({ skill: 'great', until: 2442 }), undefined)).toBe('林小满为大衍王朝将（名将），到 2442 年卸任');
  });
  it('任臣:入某国为臣,到去职年 / 到卒年 / 到 70 岁致仕;掌权:以大臣专权掌国政,几年后还政', () => {
    expect(postLine('林小满', '大衍王朝', g({ role: 'minister', until: 2450 }), undefined)).toBe('林小满入大衍王朝为臣，到 2450 年去职');
    expect(postLine('林小满', '大衍王朝', g({ role: 'minister', died: 2461 }), undefined)).toBe('林小满入大衍王朝为臣，到卒年（2461 年）');
    expect(postLine('林小满', '大衍王朝', g({ role: 'minister' }), undefined)).toBe('林小满入大衍王朝为臣，到 70 岁致仕');
    const r: Intervention = { kind: 'regent', a: 'polity:x', char: 2, born: 2402, died: 2458, from: 2436, how: 'chancellor', end: 'return', years: 5, leanings: LEAN };
    expect(postLine('苏晚', '大衍王朝', r, undefined)).toBe('苏晚以大臣专权掌大衍王朝国政，5 年后还政');
    expect(postLine('苏晚', '大衍王朝', { ...r, years: undefined, how: 'general' }, undefined)).toBe('苏晚以大将专权掌大衍王朝国政，到卒年（2458 年）');
  });
  it('没生效那段话:将领 / 名臣 / 掌权;女的写"她"', () => {
    expect(voidTail(g(), null)).toBe('推演里没有这位将领。改年份或换一国，点「进推演…」重新下一条。');
    expect(voidTail(g({ role: 'minister' }), null)).toContain('推演里没有这位名臣');
    const r: Intervention = { kind: 'regent', a: 'polity:x', char: 2, born: 2402, from: 2436, how: 'chancellor', end: 'return', leanings: LEAN };
    expect(voidTail(r, { female: true })).toContain('推演里她没有掌权');
    expect(voidTail(r, null)).toContain('推演里他没有掌权');
  });
  it(`名臣经手的事:${DEEDS_SHOWN} 件以内全列;多了列最大的 ${DEEDS_SHOWN} 件(按年份),其余折起来`, () => {
    const d = (kind: PersonDeed['kind'], year: number): PersonDeed => ({ kind, year });
    const few = [d('peace', 1), d('war', 2), d('defend', 3)];
    expect(deedsShown(few)).toEqual({ shown: few, folded: [] });
    const many = [d('defend', 1), d('war', 2), d('peace', 3), d('relief', 4), d('defend', 5), d('enthrone', 6), d('capital', 7), d('war', 8)];
    const { shown, folded } = deedsShown(many);
    expect(shown.length).toBe(DEEDS_SHOWN);
    expect(folded.length).toBe(many.length - DEEDS_SHOWN);
    // 拥立、迁都、议和、赈灾都列上,剩下一件挑最早的主战;守御两件、后一件主战折起来
    expect(shown.map((x) => x.kind)).toEqual(['war', 'peace', 'relief', 'enthrone', 'capital']);
    expect(folded.map((x) => x.year)).toEqual([1, 5, 8]);
    expect(shown.map((x) => x.year)).toEqual([...shown.map((x) => x.year)].sort((a, b) => a - b));
  });
});

// ---------------------------------------------------------------------------
// 种子 7(同稿子):第 2421 年国土最大的国家

const seed = 7;
let w: World | null = null;
let b: Civ | null = null;
const world = () => (w ??= generateWorld({ ...DEFAULT_PARAMS, seed }));
const base = () => (b ??= generateCiv(world()));
const T = 2421;
let pidMemo: number | null = null;
/** 第 T 年国土最大、到 T + 30 年还在的东方国家 */
const pid = (): number => {
  if (pidMemo !== null) return pidMemo;
  const civ = base();
  const n = new Map<number, number>();
  for (const p of ownersAt(civ, T).polity) if (p >= 0) n.set(p, (n.get(p) ?? 0) + 1);
  const ok = [...n.entries()].filter(([id]) => {
    const P = civ.polities[id];
    return P.eastern && P.lineage !== 'republic' && P.founded < T - 50 && (P.ended ?? Infinity) > T + 30;
  });
  return (pidMemo = ok.sort((a, b) => b[1] - a[1])[0][0]);
};
const named = (civ: Civ) => applyCharacters(civ, [{ id: 1, name: '林小满', color: 'red', born: 2398, died: 2461 }]);
const flat = (es: ChronicleEntry[]): ChronicleEntry[] => es.flatMap((e) => [e, ...flat(e.children ?? [])]);

describe(`人物卡上的一条(种子 ${seed})`, () => {
  it('任将页"照现在的推演他会领哪几仗"和真推完的一样;任臣的任期也一样', () => {
    const civ = base();
    const a = polityKey(civ, pid());
    for (const v of [
      { kind: 'appoint', a, char: 1, role: 'general', born: 2398, died: 2461, from: T, until: T + 21 },
      { kind: 'appoint', a, char: 1, role: 'minister', born: 2398, died: 2461, from: T + 21 },
    ] as AppointIv[]) {
      const pre = appointPreview(civ, v, pid());
      expect(pre).not.toBeNull();
      const real = authorPostsFrom(generateCiv(world(), { interventions: [v] })).find((p) => p.iv === 0)!;
      expect(pre!.until).toBe(real.until);
      expect(pre!.end).toBe(real.end);
      expect(pre!.wars.map((x) => [x.war, x.side, x.from, x.until])).toEqual(real.wars.map((x) => [x.war, x.side, x.from, x.until]));
    }
    // 那一刻已亡的国家:null
    const gone = civ.polities.find((p) => p.ended !== undefined && p.ended < T - 10 && p.founded < T - 100)!;
    expect(appointPreview(civ, { kind: 'appoint', a: polityKey(civ, gone.id), char: 1, role: 'general', born: 2398, from: T }, gone.id)).toBeNull();
  });

  it('待推演 / 下一步生效、生效了(为将、为臣:战绩、仕途)、没生效(那国已亡,写亡国那年)', { timeout: 120_000 }, () => {
    const civ0 = base();
    const P = pid();
    const a = polityKey(civ0, P);
    const gv: AppointIv = { kind: 'appoint', a, char: 1, role: 'general', born: 2398, died: 2461, from: T, until: T + 21 };
    const mv: AppointIv = { kind: 'appoint', a, char: 1, role: 'minister', born: 2398, died: 2461, from: T + 21 };
    // 单子里:待推演 / 下一步生效
    const queued: Pending = { id: 1, from: T, text: '', kind: 'iv', v: gv };
    expect(characterPosts(civ0, 1, [queued], [], false, undefined)).toEqual([{ kind: 'queued', v: gv, step: false, A: polityName(civ0.polities[P], T) }]);
    expect(characterPosts(civ0, 1, [queued], [], true, undefined)[0]).toMatchObject({ kind: 'queued', step: true });
    expect(characterPosts(civ0, 2, [queued], [], false, undefined)).toEqual([]);
    // 那一年已亡的国家:没生效,写亡国那年
    const gone = civ0.polities.find((p) => p.ended !== undefined && p.ended < T - 2 && p.ended > T - 60 && p.founded < T - 100)!;
    const bad: AppointIv = { kind: 'appoint', a: polityKey(civ0, gone.id), char: 1, role: 'general', born: 2398, died: 2461, from: T };
    const civ = named(generateCiv(world(), { interventions: [gv, mv, bad] }));
    const sts = characterPosts(civ, 1, [], [gv, mv, bad], false, undefined);
    expect(sts.map((s) => s.kind)).toEqual(['done', 'void', 'done']);
    const v = sts[1] as Extract<(typeof sts)[number], { kind: 'void' }>;
    expect(v.why).toBe(`那一年${polityName(gone, gone.ended! - 1 / 512)}已亡（${Math.floor(gone.ended!)} 年）`);
    expect(v.at).toBe(2);
    // 生效了:为将那一任,挂帅的仗胜负、战绩一行和挂帅几仗对得上
    const gen = sts[0] as Extract<(typeof sts)[number], { kind: 'done' }>;
    expect(gen.x).toMatchObject({ role: 'general', polity: P, from: T, until: T + 21, author: 1 });
    const ws = ledWars(civ, gen.x);
    expect(new Set(ws.map((x) => x.war)).size).toBe(ws.length);
    if (ws.length) {
      expect(warTally(ws)).toMatch(new RegExp(`^挂帅 ${ws.length} 仗：`));
      for (const x of ws) {
        expect(['win', 'even', 'lose']).toContain(x.result);
        if (x.fell) expect(x.result).toBe('win');
        else if (x.gained.length > x.lost.length) expect(x.result).toBe('win');
        const [l1] = warLines(civ, x, gen.x, '他', false, undefined);
        expect(l1).toMatch(/^\d+(–\d+)? 年/);
        for (const d of x.deputies) expect(l1).toContain(d.name);
      }
    } else expect(warTally(ws)).toBe('');
    // 派他出征换过去、打完又回来领原来那场(A、B、A):原来那场只算一仗
    const cs = gen.x.commands ?? [];
    if (cs.length >= 2 && cs[0].war !== cs[1].war) {
      const again = { ...cs[0], from: cs[1].until, until: cs[1].until + 1 };
      const fake = { ...gen.x, commands: [cs[0], cs[1], again] };
      const fw = ledWars(civ, fake);
      expect(fw.map((x) => x.war)).toEqual([cs[0].war, cs[1].war]);
      expect(fw[0].until).toBe(again.until);
    }
    // 为臣那一任;仕途一行写两样、从任将那年起
    const min = sts[2] as Extract<(typeof sts)[number], { kind: 'done' }>;
    expect(min.x).toMatchObject({ role: 'minister', polity: P, from: T + 21 });
    const career = careerLine(sts, undefined)!;
    expect(career.titles.split('、')).toEqual([gen.x.posts!.at(-1)!.title, min.x.posts!.at(-1)!.title]);
    expect(career.span.startsWith(`${T}`)).toBe(true);
    // 没当过的:没有仕途一行
    expect(careerLine(characterPosts(civ, 1, [queued], [], false, undefined).filter((s) => s.kind !== 'done'), undefined)).toBeNull();

    // 编年史:以他为某国将;从将领任上入朝;开战他为将、原来那位为副;议和写在推演的名臣后面;名字记在 people 上(点了开人物卡)
    const lines = flat(buildChronicle(civ));
    const A = polityName(civ.polities[P], T);
    const ap = lines.find((e) => e.kind === 'intervene' && e.year === T && e.text === `【干预】以林小满为${A}将`);
    expect(ap?.people).toContain(gen.x.id);
    const into = lines.find((e) => e.kind === 'intervene' && e.year === T + 21)!;
    expect(into.text).toMatch(new RegExp(`^【干预】.+将林小满入朝为${min.x.posts![0].title}(,副将.+代领其军)?$`));
    expect(into.people).toContain(min.x.id);
    for (const e of lines) {
      if (e.kind === 'war' && e.text.includes('以林小满为将')) expect(e.text).not.toContain('为帅');
      if (e.text.includes('议和') && e.text.includes('林小满') && e.people?.includes(min.x.id)) {
        const other = civ.people!.find((x) => x.role === 'minister' && x.author === undefined && e.people!.includes(x.id) && x.polity === P);
        if (other) expect(e.text.indexOf(other.name)).toBeLessThan(e.text.indexOf('林小满'));
      }
    }
  });
});

describe('名臣的官(照推演里名臣的升法)', () => {
  it(`入朝比最高的低 ${AUTHOR_MINISTER_BELOW} 级、经手一件升一级(经手完的下一刻),做到最高为止;已有作者的名臣做着最高的就写次一级`, () => {
    const civ = base();
    const P = civ.polities[pid()];
    const lad = authorMinisterLadder(P, T);
    expect(lad.start).not.toBe(lad.top);
    const d = (year: number): PersonDeed => ({ kind: 'peace', year });
    // 没经手事:就是入朝那个官
    expect(deedPosts(OFFICIAL_KNOBS, P, T, [], () => false)).toEqual({ posts: [{ title: lad.start, from: T }] });
    // 经手两件:做到最高(议和升的尚书是礼部)
    const two = deedPosts(OFFICIAL_KNOBS, P, T, [d(T + 3), d(T + 9), d(T + 12)], () => false);
    expect(two.posts.length).toBe(3);
    expect(two.posts[1].from).toBeCloseTo(T + 3 + 1 / 256, 9);
    expect(two.posts[2]).toEqual({ title: lad.top, from: T + 9 + 1 / 256 });
    expect(two.top).toEqual({ title: lad.top, at: T + 9 + 1 / 256 });
    if (lad.start === '侍郎') expect(two.posts[1].title).toBe('礼部尚书');
    // 已有作者的名臣做着最高的:写次一级,不算升到最高
    const held = deedPosts(OFFICIAL_KNOBS, P, T, [d(T + 3), d(T + 9)], () => true);
    expect(held.posts.at(-1)!.title).not.toBe(lad.top);
    expect(held.top).toBeUndefined();
  });
});
