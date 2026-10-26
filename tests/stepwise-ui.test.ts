/**
 * 逐年推演的界面状态和节奏(src/ui/stepwiseStore.ts、stepwisePlan.ts 的放的快慢和停一下的卡片、directorStore.ts 一份份接着放):
 * - 这一段的状态:一步交出去 / 算回来、下一步从哪年起、走到该停的那年停下、倒计时、先停着、接着演绎、一件大事也没有就不停
 * - 放的快慢:算得比放得慢时按算的打折;快追上还在算的那一步时放慢
 * - 停一下时卡片里列哪几件(seed 7 第 2650–2675 年:分教、五场仗、改朝、两次灭国、改朝)
 * - 导播一份份接着放:前一份放完接下一份,同一件事不放两次,字幕不在两份之间断掉
 * - 照界面的做法从第 2650 年一步一年演绎到第 2700 年(第 2675 年停下时加两条干预),存回推演模式:
 *   普通世界推到第 2700 年,第 2700 年以前的历史和逐年推演出来的一样
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { fullChronicle } from '../src/gen/civ/religionText';
import { polityName } from '../src/gen/civ/growth';
import { playCiv, playStop, playTurn } from '../src/gen/civ/play';
import { advanceOf, endYearOf, polityKey, type Intervention, type WorldEdits } from '../src/gen/edits';
import { startStepwise } from '../src/gen/stepwise';
import { directorPlan, type DirectorPlan } from '../src/ui/directorPlan';
import { directorBegin, directorDone, directorFeed, directorPlanNow, directorStep, getDirector } from '../src/ui/directorStore';
import { setCivTime } from '../src/ui/civView';
import { REVIEW_WEIGHT, STEP_EASE_MIN, STEP_RATE, nextStep, reviewItems, stepEase, stepPause, stepRate } from '../src/ui/stepwisePlan';
import {
  _resetStepwise,
  clearFresh,
  enterStepwise,
  enterStop,
  getSeen,
  getStepwise,
  holdClock,
  nextYear,
  openStepDialog,
  passStop,
  resumeFromStop,
  branchSwitching,
  rewoundTo,
  saveBackEdits,
  stepArrived,
  stepSent,
  tickClock,
} from '../src/ui/stepwiseStore';
import { entryWeight } from '../src/ui/timelineLayout';

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
/** 推演模式里的这个世界(推 3000 年,没有干预) */
const WORLD: WorldEdits = { names: {}, interventions: [], terrain: [] };

describe('这一段的状态', () => {
  beforeEach(() => _resetStepwise());

  it('一步交出去、算回来;下一步从哪年起(在算的那一步算完以后的那一年)', () => {
    enterStepwise(2650, 2650);
    const s0 = getStepwise();
    expect(s0.on).toBe(true);
    expect([s0.start, s0.since, s0.now]).toEqual([2650, 2650, 2650]);
    expect(nextYear()).toBe(2650);
    const plan = nextStep(advanceOf(WORLD), 2650, 2650);
    expect(plan).toEqual({ years: 1, to: 2651, pause: null });
    stepSent(2650, plan);
    expect(getStepwise().busy?.to).toBe(2651);
    // 在算的时候新下的干预:那一步算完以后的那一年年初生效
    expect(nextYear()).toBe(2651);
    stepArrived(2651, null);
    expect(getStepwise().busy).toBeNull();
    expect(getStepwise().now).toBe(2651);
    expect(nextYear()).toBe(2651);
  });

  it('停一下:倒计时走完 = 该接着走;先停着 / 在干预时倒计时停住;接着演绎从停下的那一年数下一段', () => {
    enterStepwise(2650, 2675);
    enterStop({ from: 2650, to: 2675, why: 'every', big: [], items: [] }, 60);
    expect(getStepwise().clock).toEqual({ total: 60, left: 60, run: true, why: null });
    expect(tickClock(13)).toBe(false);
    expect(getStepwise().clock?.left).toBe(47);
    holdClock('user');
    expect(getStepwise().clock?.run).toBe(false);
    expect(tickClock(100)).toBe(false);
    expect(getStepwise().clock?.left).toBe(47);
    resumeFromStop();
    expect(getStepwise().stop).toBeNull();
    expect(getStepwise().clock).toBeNull();
    expect(getStepwise().since).toBe(2675);
    // 倒计时走完
    enterStop({ from: 2675, to: 2700, why: 'every', big: [], items: [] }, 30);
    expect(tickClock(29.5)).toBe(false);
    expect(tickClock(1)).toBe(true);
    // 不倒计时:没有倒计时,停着等你点
    enterStop({ from: 2675, to: 2700, why: 'every', big: [], items: [] }, 0);
    expect(getStepwise().clock).toBeNull();
    holdClock('act');
    expect(getStepwise().clock).toBeNull();
  });

  it('这一段一件大事也没有:不停,这一年当作新一段的开头', () => {
    enterStepwise(0, 25);
    stepArrived(25, { why: 'every', big: [] });
    passStop(25);
    expect(getStepwise().since).toBe(25);
    expect(getStepwise().due).toBeNull();
    expect(getStepwise().stop).toBeNull();
  });

  it('往回翻按停过的那几年切段;从某一年重新演绎:"现在"就是那一年,停着等接着演绎(不倒计时),这一段从那一年数起', () => {
    enterStepwise(2650, 2650);
    expect(getStepwise().marks).toEqual([2650]);
    expect(getSeen()).toBe(2650);
    enterStop({ from: 2650, to: 2675, why: 'every', big: [], items: [] }, 60);
    resumeFromStop();
    stepArrived(2700, { why: 'every', big: [] });
    enterStop({ from: 2675, to: 2700, why: 'every', big: [], items: [] }, 60);
    expect(getStepwise().marks).toEqual([2650, 2675]);
    expect(getSeen()).toBe(2700);
    // 往回翻到第 2667 年、从那里重新演绎
    rewoundTo(2650, 2667);
    const s = getStepwise();
    expect([s.start, s.since, s.now]).toEqual([2650, 2667, 2667]);
    expect([s.stop, s.clock, s.busy, s.due, s.page]).toEqual([null, null, null, null, null]);
    expect(s.fresh).toBe(true);
    expect(s.marks).toEqual([2650]);
    expect(getSeen()).toBe(2667);
    expect(nextYear()).toBe(2667);
    clearFresh();
    expect(getStepwise().fresh).toBe(false);
    // 倒回到起演那年以前:起演那年跟着变,以前停过的都在这一年以后
    rewoundTo(2640, 2640);
    expect([getStepwise().start, getStepwise().since]).toEqual([2640, 2640]);
    expect(getStepwise().marks).toEqual([]);
    passStop(2665);
    expect(getStepwise().marks).toEqual([2665]);
    // 切到别的一支:算的时候记着切到哪一支;推完换上(= 打开那一支)就不在切了
    branchSwitching({ to: 3, from: 1 });
    expect(getStepwise().switching).toEqual({ to: 3, from: 1 });
    // 切的时候不问重新演绎(地图上还是原来那支),别的窗口照开
    openStepDialog({ kind: 'rewind', year: 2600 });
    expect(getStepwise().dialog).toBe(null);
    openStepDialog({ kind: 'save' });
    expect(getStepwise().dialog).toEqual({ kind: 'save' });
    openStepDialog(null);
    // 打开别的逐年推演的世界:从头来
    enterStepwise(100, 300);
    expect(getStepwise().marks).toEqual([100]);
    expect(getStepwise().fresh).toBe(false);
    expect(getStepwise().switching).toBe(null);
  });
});

describe('放的快慢', () => {
  it('算得比放得慢:按算的速度打折;还不知道算多快 = 照想要的', () => {
    expect(stepRate(STEP_RATE[4], null)).toBe(STEP_RATE[4]);
    expect(stepRate(STEP_RATE[4], 100)).toBe(STEP_RATE[4]);
    const r = stepRate(STEP_RATE[4], 2);
    expect(r).toBeLessThan(2);
    expect(r).toBeGreaterThan(1);
  });
  it('快追上还在算的那一步:越近越慢,最慢有个底;离得远照常走', () => {
    expect(stepEase(10, 2)).toBe(1);
    const a = stepEase(0.6, 2);
    const b = stepEase(0.2, 2);
    expect(a).toBeLessThan(1);
    expect(b).toBeLessThan(a);
    expect(stepEase(0, 2)).toBe(STEP_EASE_MIN);
  });
});

describe('seed 7 从第 2650 年演绎到第 2700 年', () => {
  // 推演模式第 2650 年 → 逐年推演(照默认:一步一年、每 25 年停一下)
  const edits0 = startStepwise(WORLD, 2650);
  const adv = advanceOf(edits0);
  let civ: Civ = playCiv(world, {}, edits0.play!);
  let play = edits0.play!;
  let since = 2650;
  /** 照界面:一步步往下走,走完看停不停(出大事也停没勾,只看每隔 25 年);到 stopAt 那年停下 */
  const walk = (to: number, cmds: (civ: Civ, now: number) => Intervention[] = () => []) => {
    while (play.year < to) {
      const plan = nextStep(adv, since, play.year);
      const before = civ;
      const r = playTurn(world, civ, {}, play, cmds(civ, play.year), plan.years);
      expect(r.rejected).toEqual([]);
      civ = r.civ;
      play = r.play;
      const why = stepPause(adv, play.year - plan.years, plan, fullChronicle(civ), fullChronicle(before)).why;
      if (why) {
        expect(why).toBe('every');
        expect(play.year % 25).toBe(0);
        since = play.year;
      }
    }
  };
  /** 第 2675 年停下时加的两条:大霄王朝向克拉尔汗国宣战、大霄王朝禁止分裂 */
  let added: Intervention[] = [];

  it('第 2650–2675 年停下:卡片里列这一段分量重的几件(打仗、灭国、自立、改朝……),按先后,每件有字幕和事发地', () => {
    walk(2675);
    expect(civ.endYear).toBe(playStop(2675));
    const entries = fullChronicle(civ);
    const items = reviewItems(world, civ, 2650, 2675, entries);
    expect(items.map((it) => [Math.floor(it.cap.entry.year), it.cap.typeName])).toEqual([
      [2650, '教派'],
      [2651, '战争'],
      [2652, '战争'],
      [2655, '战争'],
      [2655, '改朝'],
      [2658, '灭亡'],
      [2662, '战争'],
      [2664, '灭亡'],
      [2664, '改朝'],
    ]);
    for (const it of items) {
      expect(entryWeight(it.cap.entry)).toBeGreaterThanOrEqual(REVIEW_WEIGHT);
      expect(it.cap.text.length).toBeGreaterThan(4);
      expect(it.cap.pin).not.toBeNull();
    }
    // 打了几年的仗(大定伐奥利亚帝国,第 2662–2674 年):字幕只写开头一句,年份写"起"
    const war = items[6].cap;
    expect(war.entry.end).toBeGreaterThan(2670);
    expect(war.label).toBe('第 2662 年起');
    // 这一段里分量没到的几件(重要度 2 的灾异、迁都……)不列
    const light = entries.filter((e) => e.year >= 2650 && e.year < 2675 && e.importance >= 2 && entryWeight(e) < REVIEW_WEIGHT);
    expect(light.length).toBeGreaterThan(0);
  }, 300_000);

  it('导播一份份接着放(每份 = 算好的那一步):同一件事不放两次,放到的年份只往后走', () => {
    const entries = fullChronicle(civ);
    const make = (from: number, to: number): DirectorPlan => directorPlan(world, civ, { from, to, entries, pace: { mode: 'auto', rate: 4 } });
    setCivTime({ year: 2650, playing: true });
    directorBegin(() => make(2650, 2651), 'k', 2650);
    const seen: number[] = [];
    let last = 2650;
    for (let y = 2651; y <= 2675; ) {
      const yy = directorStep(1 / 30);
      expect(yy).not.toBeNull();
      expect(yy!).toBeGreaterThanOrEqual(last - 1e-9);
      last = yy!;
      const sh = getDirector().shown;
      if (sh && !sh.peek && seen[seen.length - 1] !== sh.cap.entry.id) seen.push(sh.cap.entry.id);
      if (directorDone() && y < 2675) {
        directorFeed(make(directorPlanNow()!.to, y + 1), 'k');
        y++;
      } else if (directorDone()) break;
    }
    expect(last).toBe(2675);
    expect(new Set(seen).size).toBe(seen.length);
    const majors = entries.filter((e) => e.year >= 2650 && e.year < 2675 && e.importance >= 3).map((e) => e.id);
    expect(seen.filter((id) => majors.includes(id)).length).toBe(seen.length);
    // 这一段重要度 3 以上的至少两件(两次改朝……)
    expect(seen.length).toBeGreaterThanOrEqual(2);
    setCivTime({ year: null, playing: false });
  });

  it('第 2675 年加两条干预、接着演绎到第 2700 年,存回推演模式:普通世界推到第 2700 年,以前的历史一样', () => {
    // 大霄王朝(第 2655 年起的国号)和相邻的克拉尔汗国
    const name = (id: number) => polityName(civ.polities[id], 2674.5);
    const xiao = civ.polities.find((p) => p.ended === undefined && name(p.id).includes('大霄'));
    const kang = civ.polities.find((p) => p.ended === undefined && name(p.id).includes('克拉尔'));
    expect(xiao && kang).toBeTruthy();
    const A = polityKey(civ, xiao!.id);
    added = [
      { kind: 'declare', a: A, b: polityKey(civ, kang!.id), from: 2675 },
      { kind: 'unity', a: A, from: 2675 },
    ];
    // 第一条在第 2675 年那一步交出去;第二条留在单子里,存回推演模式时一起存进去
    walk(2700, (_c, now) => (now === 2675 ? [added[0]] : []));
    // 到第 2700 年停下,存回推演模式(单子里还有一条没交出去的,当作在"现在"下的)
    expect(play.year).toBe(2700);
    const stepEdits: WorldEdits = { ...edits0, play };
    const queuedLate = { ...added[1], from: 2000 } as Intervention;
    const normal = saveBackEdits(stepEdits, [queuedLate])!;
    expect(normal).not.toBeNull();
    expect(normal.play).toBeUndefined();
    expect(endYearOf(normal)).toBe(2700);
    expect(normal.interventions).toEqual([added[0], { ...added[1], from: 2700 }]);
    // 普通世界打开(从第 0 年推到第 2700 年):第 2700 年以前和逐年推演出来的一样
    const opened = generateCiv(world, { interventions: normal.interventions, endYear: 2700 });
    expect(opened.annals.filter((e) => e.year < 2700)).toEqual(civ.annals.filter((e) => e.year < 2700));
    expect(opened.polities.filter((p) => p.founded < 2700).map((p) => [p.name, p.founded])).toEqual(civ.polities.filter((p) => p.founded < 2700).map((p) => [p.name, p.founded]));
    // 宣战那一条在第 2675 年记了一条史事
    expect(civ.annals.some((e) => e.kind === 'intervene' && Math.floor(e.year) === 2675)).toBe(true);
  }, 300_000);
});
