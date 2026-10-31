/**
 * 逐年推演停在年中时界面下的令(gen/edits.ts 的 commandsNow:ui/Stepwise.tsx 交出去的一步、ui/stepwiseStore.ts 的存回推演模式、
 * 重新演绎 / 切走时留下原来那一支都照它写)和按"年 + 第几格"比先后的几处显示:
 * - 停在年中:命令带上那一格(from = 那一年、fromTick = 那一格),推演收下、在那一格生效;只写年份的会被当成"不是现在"不收
 * - 停在年初(第 0 格):和以前的写法({ ...v, from: play.year })逐字段一样,字段先后也一样
 * - 存回推演模式:单子里没交出去的在那一格生效;停在年初的和以前一样
 * - 人物:年中下令即位的君主从那一格起在位;人物卡上的即位按年 + 第几格排先后(单子里的在下一步开头那一格)
 * - 方针:年中下的方针从那一格起才算;大纲里顺着引时,"作者自己当时的方针"按年 + 第几格找
 * - 大纲:窗口里年中下令结盟的,查下令的那一刻(那一年年初还没结盟)
 * - 支线自己下的命令按分出来的那一刻(年 + 第几格)分;干预没生效的原因按生效那一刻查国家在不在
 */
import { describe, expect, it } from 'vitest';
import { generateCiv, type Civ } from '../src/gen/civ';
import { playCiv, playTicks, playTo } from '../src/gen/civ/play';
import { peopleIndex } from '../src/gen/civ/story/peopleInfo';
import { polityAlive } from '../src/gen/civ/growth';
import { polityTies } from '../src/gen/civ/diplomacy';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import {
  YEAR_TICKS,
  basePolicy,
  commandYear,
  commandsNow,
  endAtOf,
  guideNotes,
  issueCommands,
  polityKey,
  type Intervention,
  type PlayState,
  type WorldEdits,
} from '../src/gen/edits';
import { interventionFate, stepwiseToNormal, type BranchInfo } from '../src/gen/stepwise';
import { runOutline } from '../src/gen/outline';
import { saveBackEdits } from '../src/ui/stepwiseStore';
import { characterCrowns } from '../src/ui/crownInfo';
import { policyAt } from '../src/ui/policyInfo';
import { ownCommands } from '../src/ui/StepBranches';
import type { Pending } from '../src/ui/pendingStore';
import { RUN_CELLS, bigAndNeighbor, worldOf } from './lib/stepwiseRun';

const w = worldOf(7, RUN_CELLS);
let base: Civ | null = null;
/** 推演模式里推完 3000 年、没有干预的历史 */
const baseCiv = () => (base ??= generateCiv(w));

const LEAN = { expand: 70, war: 80, develop: 40, trade: 30 };
const protect = (n: number, from: number, fromTick?: number): Intervention => (fromTick ? { kind: 'protect', a: `polity:c${n}#0`, from, fromTick } : { kind: 'protect', a: `polity:c${n}#0`, from });
/** 以前的写法:生效年份换成进度那一年(不带第几格) */
const oldWay = (play: PlayState, list: readonly Intervention[]) => list.map((v) => ({ ...v, from: play.year }) as Intervention);

describe('下令带上进度停在的那一格', () => {
  it('停在年初:和以前的写法逐字段一样(字段先后也一样);停在年中:带上那一格,原来带的第几格换掉', () => {
    // 单子里的几条:干预页按"下一步开头那一年"写的生效年份,有一条带着别的第几格(不该留下)
    const queued: Intervention[] = [
      { kind: 'ally', a: 'polity:c1#0', b: 'polity:c2#0', from: 1500, until: 1530 },
      { kind: 'policy', a: 'polity:c1#0', from: 1490, preset: 'expand', war: 25 },
      protect(3, 1500, 40),
    ];
    const atStart: PlayState = { year: 1500, commands: [] };
    // 年初:没带第几格的和以前一字不差
    const plain = queued.slice(0, 2);
    expect(JSON.stringify(commandsNow(atStart, plain))).toBe(JSON.stringify(oldWay(atStart, plain)));
    expect(commandsNow(atStart, queued)[2]).toEqual(protect(3, 1500));
    // 年中:每条都带上那一格,其余字段和先后不变
    const mid: PlayState = { year: 1500, tick: 100, commands: [] };
    const now = commandsNow(mid, queued);
    expect(now).toEqual([
      { ...queued[0], fromTick: 100 },
      { ...queued[1], from: 1500, fromTick: 100 },
      protect(3, 1500, 100),
    ]);
    expect(Object.keys(now[1])).toEqual([...Object.keys(queued[1]), 'fromTick']);
    // 推演只收"现在"那一刻的:带上那一格的全收;以前的写法(只写年份)在年中一条也不收
    expect(issueCommands(mid, now).rejected).toEqual([]);
    expect(issueCommands(mid, oldWay(mid, queued)).accepted).toEqual([]);
    expect(issueCommands(atStart, commandsNow(atStart, plain)).accepted).toEqual(oldWay(atStart, plain));
    // 原来的不改
    expect(queued[2]).toEqual(protect(3, 1500, 40));
  });

  it('存回推演模式:单子里没交出去的在进度那一刻生效;停在年初的和以前一样', () => {
    const e0: WorldEdits = { names: {}, interventions: [protect(9, 1200)], terrain: [], playFrom: 1400 };
    const q = protect(5, 1450);
    // 年初:和以前的做法(生效年份换成那一年再收)一样
    const atStart: PlayState = { year: 1500, commands: [protect(4, 1480)] };
    const before = stepwiseToNormal({ ...e0, play: issueCommands(atStart, oldWay(atStart, [q])).play });
    expect(saveBackEdits({ ...e0, play: atStart }, [q])).toEqual(before);
    expect(JSON.stringify(saveBackEdits({ ...e0, play: atStart }, [q]))).toBe(JSON.stringify(before));
    // 年中:推到那一年的那一格,单子里那条在那一格生效(以前的做法会被当成"不是现在"丢掉)
    const mid: PlayState = { year: 1500, tick: 100, commands: [protect(4, 1500, 40)] };
    const normal = saveBackEdits({ ...e0, play: mid }, [q])!;
    expect(endAtOf(normal)).toBe(1500 + 100 / YEAR_TICKS);
    expect(normal.interventions).toEqual([protect(9, 1200), protect(4, 1500, 40), protect(5, 1500, 100)]);
    expect(stepwiseToNormal({ ...e0, play: issueCommands(mid, oldWay(mid, [q])).play })!.interventions).toEqual([protect(9, 1200), protect(4, 1500, 40)]);
  });

  it('停到第 1500 年第 100 格下令(方针、即位):推演收下、在那一格生效;方针、人物按那一格算', () => {
    const T = 1500;
    const K = 100;
    const at = T + K / YEAR_TICKS;
    const play0: PlayState = { year: T, commands: [] };
    const s1 = playTo(w, playCiv(w, {}, play0), {}, play0, [], { year: T, tick: K });
    expect(s1.play).toEqual({ year: T, tick: K, commands: [] });
    const two = bigAndNeighbor(s1.civ, at - 1 / YEAR_TICKS)!;
    expect(two).toBeTruthy();
    const A = polityKey(s1.civ, two.big);
    const B = polityKey(s1.civ, two.next);
    // 干预页写进单子的(生效年份 = 下一步开头那一年),交出去时照界面的做法盖上"现在"
    const queued: Intervention[] = [
      { kind: 'policy', a: A, from: T, preset: 'expand', war: 25, expand: 25 },
      { kind: 'crown', a: B, char: 1, from: T, born: T - 32, leanings: LEAN },
    ];
    expect(issueCommands(s1.play, oldWay(s1.play, queued)).rejected.length).toBe(2);
    const cmds = commandsNow(s1.play, queued);
    const s2 = playTicks(w, s1.civ, {}, s1.play, cmds, 3 * YEAR_TICKS);
    expect(s2.rejected).toEqual([]);
    expect(s2.play).toEqual({ year: T + 3, tick: K, commands: cmds });
    // 史事记在那一格(不是那一年年初)
    const ivs = s2.civ.annals.filter((e) => e.kind === 'intervene');
    for (const i of [0, 1]) expect(ivs.find((e) => e.war === i)?.year).toBe(at);
    expect(commandYear(s2.civ.interventions![0])).toBe(at);
    // 方针:那一格以前照旧(没定方针),那一格起是新方针
    expect(policyAt(s2.civ, two.big, at - 1 / YEAR_TICKS)).toBeNull();
    expect(policyAt(s2.civ, two.big, at)).toMatchObject({ kind: 'policy', preset: 'expand', from: T, fromTick: K });
    // 人物:作者立的君主从那一格起在位;人物卡上他的即位"生效了",推演里的他也从那一格起
    const ruler = peopleIndex(s2.civ).rulers[two.next].find((r) => r.author === 1);
    expect(ruler?.from).toBe(at);
    const [st] = characterCrowns(s2.civ, 1, [], [], true, undefined, K);
    expect(st.kind).toBe('done');
    if (st.kind === 'done') expect(st.x.from).toBe(at);
  }, 300_000);
});

describe('显示按年 + 第几格排先后', () => {
  it('人物卡上的即位:推过的按年 + 第几格;单子里的在逐年推演时排在下一步开头那一格,不在逐年推演时在年初;都在年初的和以前一样', () => {
    const civ = baseCiv();
    const pid = ownersAt(civ, 1600).polity.find((o) => o >= 0)!;
    const key = polityKey(civ, pid);
    const crown = (from: number, fromTick?: number): Intervention => ({ kind: 'crown', a: key, char: 1, from, born: from - 30, leanings: LEAN, ...(fromTick ? { fromTick } : {}) });
    // 存回推演模式时并进来的(1600 年第 200 格)排在后来加的 1600 年年初那条前面
    const late = crown(1600, 200);
    const early = crown(1600);
    const c2 = { ...civ, interventions: [late, early] };
    const q = crown(1600);
    const queued: Pending = { id: 1, from: 1600, text: '', kind: 'iv', v: q };
    expect(characterCrowns(c2, 1, [], [], false, undefined).map((x) => x.v)).toEqual([early, late]);
    expect(characterCrowns(c2, 1, [queued], [], true, undefined, 220).map((x) => x.v)).toEqual([early, late, q]);
    expect(characterCrowns(c2, 1, [queued], [], false, undefined).map((x) => x.v)).toEqual([early, q, late]);
    // 都在年初:照年份排,同一年照原来的先后(和以前一样)
    const a = crown(1700);
    const b = crown(1600);
    const q2 = crown(1650);
    const c3 = { ...civ, interventions: [a, b] };
    const queued2: Pending = { id: 2, from: 1650, text: '', kind: 'iv', v: q2 };
    expect(characterCrowns(c3, 1, [queued2], [], true, undefined).map((x) => x.v)).toEqual([b, q2, a]);
    expect(characterCrowns(c3, 1, [queued2], [], false, undefined).map((x) => x.v)).toEqual([b, q2, a]);
  }, 300_000);

  it('大纲顺着引时作者自己的方针:年中下的到那一格才算;年初的和以前一样', () => {
    const A = 'polity:c1#0';
    const p0: Intervention = { kind: 'policy', a: A, from: 1500, war: 10 };
    const p1: Intervention = { kind: 'policy', a: A, from: 1520, fromTick: 100, war: 30 };
    const g: Intervention = { kind: 'policy', a: A, from: 1520, war: 40, plot: 1, guide: true };
    expect(basePolicy([p0, p1, g], A, 1520)).toBe(p0);
    expect(basePolicy([p0, p1, g], A, 1521)).toBe(p1);
    expect(guideNotes([p0, p1, g], 1)).toMatchObject([{ a: A, from: 1520, war: 30 }]);
    // 同一条在年初下的:和以前一样算进去
    const p1y: Intervention = { kind: 'policy', a: A, from: 1520, war: 30 };
    expect(basePolicy([p0, p1y, g], A, 1520)).toBe(p1y);
    expect(guideNotes([p0, p1y, g], 1)).toMatchObject([{ a: A, from: 1520, war: 10 }]);
  });

  it('支线自己下的命令:按分出来的那一刻(年 + 第几格)分', () => {
    const cmds = [protect(1, 1500, 40), protect(2, 1500, 100), protect(3, 1505)];
    const b: BranchInfo = { id: 2, current: false, from: 1500, fromTick: 100, year: 1510, playFrom: 1400, play: { year: 1510, commands: cmds }, forkOf: 1, forkAt: 1500, forkTick: 100 };
    expect(ownCommands(b)).toEqual(cmds.slice(1));
    // 年初分出来的、最早那一支:和以前一样
    expect(ownCommands({ ...b, fromTick: undefined, forkTick: undefined })).toEqual(cmds);
    expect(ownCommands({ ...b, forkAt: undefined, forkTick: undefined, playFrom: 1505 })).toEqual(cmds.slice(2));
  });

  it('干预没生效的原因:按生效那一刻查国家立了没有', () => {
    const civ = baseCiv();
    // 年中立国、过了一年多还在的国家
    const P = civ.polities.find((p) => p.founded > 100 && p.founded < 2900 && p.founded % 1 > 0.05 && p.founded % 1 < 0.9 && (p.ended === undefined || p.ended > p.founded + 2))!;
    expect(P).toBeTruthy();
    const Y = Math.floor(P.founded);
    const k = Math.floor((P.founded - Y) * YEAR_TICKS) + 2;
    const key = polityKey(civ, P.id);
    // 立国以后那一格下的(推演里没生效,原因不是"还没立国")
    const after = { ...civ, interventions: [{ kind: 'protect', a: key, from: Y, fromTick: k } as Intervention] };
    expect(interventionFate(after, 0)).toEqual({ state: 'void', annal: -1, why: '没有生效' });
    // 那一年年初下的:那时还没立国(和以前一样)
    const start = { ...civ, interventions: [{ kind: 'protect', a: key, from: Y } as Intervention] };
    const f = interventionFate(start, 0);
    expect(f.state === 'void' && f.why).toContain(`第 ${Y} 年才立国`);
  }, 300_000);
});

describe('大纲查结盟', () => {
  it('窗口头一年年中下令结盟、没到窗口最后一年就散了:查下令的那一刻,算自然发生', async () => {
    const civ = baseCiv();
    const own = ownersAt(civ, 1505).polity;
    const size = (p: number) => own.filter((x) => x === p).length;
    const alive = civ.polities.filter((p) => polityAlive(p, 1500) && polityAlive(p, 1530) && size(p.id) >= 2).sort((x, y) => size(y.id) - size(x.id));
    // 挑一对窗口里(1505–1525 年)自己没结盟的:作者 1505 年第 128 格下令结盟,1508 年散
    let pick: { a: number; b: number; list: Intervention[] } | null = null;
    for (let i = 0; i < alive.length && !pick; i++)
      for (let j = i + 1; j < alive.length && !pick; j++) {
        const a = alive[i].id;
        const b = alive[j].id;
        const list: Intervention[] = [{ kind: 'ally', a: polityKey(civ, a), b: polityKey(civ, b), from: 1505, fromTick: 128, until: 1508 }];
        const c = generateCiv(w, { interventions: list });
        const pair = (e: { a: number; b: number }) => (e.a === a && e.b === b) || (e.a === b && e.b === a);
        if (c.annals.some((e) => e.kind === 'alliance' && pair(e) && e.year >= 1505 && e.year < 1526)) continue;
        if ([1505, 1525].some((y) => polityTies(c, a, y).allies.some((x) => x.id === b))) continue;
        // 下令的那一刻两国在盟
        if (!polityTies(c, a, 1505.5).allies.some((x) => x.id === b)) continue;
        pick = { a, b, list };
      }
    expect(pick).toBeTruthy();
    const { a, b, list } = pick!;
    const out = (await runOutline(w, {}, { plots: [{ id: 1, kind: 'ally', year: 1515, a: polityKey(civ, a), b: polityKey(civ, b) }], interventions: list }))!;
    expect(out.review[0], JSON.stringify(out.review)).toMatchObject({ status: 'natural', year: 1505 });
    expect(out.interventions).toEqual(list);
  }, 300_000);
});
