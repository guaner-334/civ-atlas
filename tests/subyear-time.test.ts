/**
 * 时刻 = 第几年 + 那一年的第几格(gen/edits.ts 文件头"时刻"):逐年推演的进度、命令、支线、干预都能落在年中。
 * - 清理:第几格是 0–255 的整数才认;0 不写;进度的第几格不合格 = 没在逐年推演(不悄悄当成年初);命令按时刻排先后
 * - 命令只能下在"现在"那一刻(年 + 第几格都要对上)
 * - 旧存档(只有年份、格式 1)照读,读进来落在那一年的第 0 格,和以前一模一样;只到年初的新存档照旧写格式 1、一个字不多
 * - 有年中时刻的存档写格式 2(旧版本读到会提示更新页面),往返一样、没有提示;比现在新的格式不读
 * - 支线、倒回、另开一支、切换、存回推演模式按时刻算(停在年中存回的推到那一格,见 subyear-save.test.ts)
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/gen/world';
import type { Civ } from '../src/gen/civ/types';
import { playStop } from '../src/gen/civ/play';
import {
  YEAR_TICKS,
  cleanBranches,
  cleanIntervention,
  cleanPlay,
  commandAt,
  issueCommands,
  playAt,
  ticksAt,
  type Intervention,
  type PlayState,
  type WorldEdits,
} from '../src/gen/edits';
import { SAVE_FORMAT, makeSave, parseSave, saveFormatOf, saveText } from '../src/gen/savefile';
import { branchList, branchPlay, forkBranch, interventionFate, rewindStepwise, stepwiseToNormal, switchBranch } from '../src/gen/stepwise';

const base: WorldEdits = { names: {}, interventions: [], terrain: [] };
const params = { ...DEFAULT_PARAMS, seed: 7 };
/** 第 y 年第 t 格下的一条命令(n 区分是哪一条) */
const cmd = (y: number, n: number, t = 0): Intervention => (t ? { kind: 'protect', a: `polity:c${n}#0`, from: y, fromTick: t } : { kind: 'protect', a: `polity:c${n}#0`, from: y });

/** 存档往返(没有提示),连存下的格式一起返回 */
function roundTrip(e: WorldEdits): { edits: WorldEdits; format: number; text: string } {
  const text = saveText(makeSave(params, e, 'x'));
  const r = parseSave(text);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error('读不回来');
  expect(r.warnings).toEqual([]);
  return { edits: r.save.edits, format: (JSON.parse(text) as { format: number }).format, text };
}

describe('时刻的清理', () => {
  it('命令的第几格:1–255 的整数才记;0、小数、越界的当年初;本来就合格的原样返回', () => {
    const v = cmd(300, 1, 128);
    expect(cleanIntervention(v)).toBe(v);
    expect(cleanIntervention({ ...cmd(300, 1), fromTick: 0 })).toEqual(cmd(300, 1));
    expect(cleanIntervention({ ...cmd(300, 1), fromTick: 1.5 })).toEqual(cmd(300, 1));
    expect(cleanIntervention({ ...cmd(300, 1), fromTick: YEAR_TICKS })).toEqual(cmd(300, 1));
    expect(cleanIntervention({ ...cmd(300, 1), fromTick: -3 })).toEqual(cmd(300, 1));
    expect(commandAt(v)).toBe(ticksAt(300, 128));
    expect(commandAt(cmd(300, 1))).toBe(300 * YEAR_TICKS);
  });

  it('进度的第几格:合格的照记,0 去掉;不合格 = 没在逐年推演;命令按时刻排,晚于进度、比前一条早的丢掉', () => {
    const ok: PlayState = { year: 300, tick: 100, commands: [cmd(200, 1), cmd(300, 2), cmd(300, 3, 100)] };
    expect(cleanPlay(ok)).toBe(ok);
    expect(cleanPlay({ year: 300, tick: 0, commands: [] })).toEqual({ year: 300, commands: [] });
    for (const tick of [-1, 256, 12.5, '3', null]) expect(cleanPlay({ year: 300, tick, commands: [] }), String(tick)).toBeUndefined();
    // 晚于进度那一刻(同一年的后几格、下一年)丢掉;同一年里比前一条早的也丢掉
    expect(cleanPlay({ year: 300, tick: 100, commands: [cmd(300, 1, 50), cmd(300, 2, 20), cmd(300, 3, 101), cmd(300, 4, 100), cmd(301, 5)] })).toEqual({
      year: 300,
      tick: 100,
      commands: [cmd(300, 1, 50), cmd(300, 4, 100)],
    });
    // 停在年初:那一年年中的命令都晚于进度
    expect(cleanPlay({ year: 300, commands: [cmd(300, 1), cmd(300, 2, 1)] })).toEqual({ year: 300, commands: [cmd(300, 1)] });
    expect(playAt({ year: 300 })).toBe(300 * YEAR_TICKS);
    expect(playAt({ year: 300, tick: 7 })).toBe(300 * YEAR_TICKS + 7);
  });

  it('命令只能下在"现在"那一刻:年份、第几格都要对上', () => {
    const mid: PlayState = { year: 300, tick: 64, commands: [] };
    const now = cmd(300, 1, 64);
    const r = issueCommands(mid, [cmd(300, 2), now, cmd(300, 3, 65), cmd(299, 4, 64)]);
    expect(r.accepted).toEqual([now]);
    expect(r.rejected).toEqual([cmd(300, 2), cmd(300, 3, 65), cmd(299, 4, 64)]);
    expect(r.play).toEqual({ year: 300, tick: 64, commands: [now] });
    // 停在年初:和以前一样只收 from = 那一年、不带第几格的
    const r0 = issueCommands({ year: 300, commands: [] }, [cmd(300, 1), cmd(300, 2, 64)]);
    expect(r0.accepted).toEqual([cmd(300, 1)]);
    expect(r0.play).toEqual({ year: 300, commands: [cmd(300, 1)] });
  });

  it('停在哪:年初和以前一样是前一年的最后一格,年中是那一格的前一格', () => {
    expect(playStop(300)).toBe(300 - 1 / 256);
    expect(playStop(300, 0)).toBe(300 - 1 / 256);
    expect(playStop(300, 1)).toBe(300);
    expect(playStop(300, 192)).toBe(300 + 191 / 256);
  });
});

describe('存档:旧档照读,年中的写新格式', () => {
  it('旧存档(格式 1,只有年份)照读:落在那一年的第 0 格,和以前一样;重存还是格式 1、一个字不多', () => {
    const old = {
      app: '文明与地图',
      format: 1,
      generator: 45,
      seed: 7,
      params,
      edits: {
        names: {},
        interventions: [],
        terrain: [],
        play: { year: 825, commands: [{ kind: 'declare', a: 'polity:c4567#0', b: 'polity:c8123#0', from: 825 }] },
        playFrom: 800,
        branches: { id: 2, list: [{ id: 1, from: 810, year: 900, commands: [{ kind: 'unity', a: 'polity:c4567#0', from: 810 }], forkAt: 810 }] },
      },
      check: 'c',
      savedAt: '2026-10-01T00:00:00.000Z',
    };
    const r = parseSave(JSON.stringify(old));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const play = r.save.edits.play!;
    expect(play).toEqual(old.edits.play);
    expect('tick' in play).toBe(false);
    expect(playAt(play)).toBe(825 * YEAR_TICKS);
    expect(playStop(play.year, play.tick)).toBe(playStop(825));
    expect(r.save.edits.branches).toEqual(old.edits.branches);
    expect(r.save.format).toBe(1);
    const again = saveText(makeSave(params, r.save.edits, 'c', undefined, old.savedAt));
    expect(JSON.parse(again).format).toBe(1);
    expect(again).not.toMatch(/tick|Tick/i);
  });

  it('只到年初的新存档照旧写格式 1;有年中时刻(进度、命令、干预、支线)的写格式 2,往返一样', () => {
    expect(roundTrip({ ...base, play: { year: 300, commands: [cmd(300, 1)] } }).format).toBe(1);
    const cases: WorldEdits[] = [
      { ...base, play: { year: 300, tick: 9, commands: [] } },
      { ...base, play: { year: 300, tick: 9, commands: [cmd(300, 1, 9)] } },
      { ...base, interventions: [cmd(300, 1, 9)] },
      { ...base, play: { year: 300, commands: [] }, branches: { id: 2, list: [{ id: 1, from: 200, fromTick: 3, year: 250, commands: [] }] } },
      { ...base, play: { year: 300, commands: [] }, branches: { id: 2, list: [{ id: 1, from: 200, year: 250, tick: 3, commands: [] }] } },
      { ...base, play: { year: 300, commands: [] }, branches: { id: 2, forkOf: 1, forkAt: 200, forkTick: 3, list: [{ id: 1, from: 200, year: 250, commands: [] }] } },
    ];
    for (const e of cases) {
      const r = roundTrip(e);
      expect(r.format, JSON.stringify(e)).toBe(SAVE_FORMAT);
      expect(saveFormatOf(e)).toBe(2);
      for (const k of ['play', 'interventions', 'branches'] as const) expect(r.edits[k], k).toEqual(e[k]);
    }
  });

  it('只认识年份的版本(格式 1)读到格式 2 会提示更新页面;比现在新的格式不读', () => {
    const text = saveText(makeSave(params, { ...base, play: { year: 300, tick: 9, commands: [] } }, 'x'));
    expect(JSON.parse(text).format).toBeGreaterThan(1);
    const r = parseSave(JSON.stringify({ ...JSON.parse(text), format: SAVE_FORMAT + 1 }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe(`这个存档来自更新版本的「文明与地图」(存档格式 ${SAVE_FORMAT + 1}),请刷新页面换到最新版再打开`);
  });

  it('进度的第几格不合格:当没在逐年推演,提示一句(不悄悄当成年初)', () => {
    const good = JSON.parse(saveText(makeSave(params, base, 'x')));
    const r = parseSave(JSON.stringify({ ...good, format: 2, edits: { ...base, play: { year: 300, tick: 300, commands: [] } } }));
    expect(r.ok && r.save.edits.play).toBeUndefined();
    expect(r.ok && r.warnings).toContain('逐年推演的进度认不出来,已跳过');
  });
});

describe('支线、倒回、存回推演模式按时刻', () => {
  // 现在停在第 700 年第 128 格;命令有年初的、年中的
  const c300 = cmd(300, 1);
  const c400 = cmd(400, 2, 64);
  const c400b = cmd(400, 3, 200);
  const c700 = cmd(700, 4, 128);
  const cur: PlayState = { year: 700, tick: 128, commands: [c300, c400, c400b, c700] };
  const e0: WorldEdits = { ...base, play: cur, playFrom: 300 };

  it('倒回到年中的一刻:那一刻和以后的命令不要,进度停在那一刻;给年份 = 那一年年初', () => {
    const r = rewindStepwise(e0, { year: 400, tick: 100 })!;
    expect(r.edits.play).toEqual({ year: 400, tick: 100, commands: [c300, c400] });
    expect(r.dropped).toEqual([c400b, c700]);
    const y = rewindStepwise(e0, 400)!;
    expect(y.edits.play).toEqual({ year: 400, commands: [c300] });
    // 正好倒回到一条命令那一刻:那一条也不要(和年初的一样,那一刻的事还没发生)
    expect(rewindStepwise(e0, { year: 400, tick: 64 })!.edits.play).toEqual({ year: 400, tick: 64, commands: [c300] });
    // 夹到现在:晚于进度的当成现在(现在那一刻下的命令和年初时一样不要);第几格夹回 0–255
    expect(rewindStepwise(e0, { year: 900, tick: 5 })!.edits.play).toEqual({ year: 700, tick: 128, commands: [c300, c400, c400b] });
    expect(rewindStepwise(e0, { year: 400, tick: 999 })!.edits.play).toEqual({ year: 400, tick: 255, commands: [c300, c400, c400b] });
    // 从第几年起演绎只记到年
    expect(rewindStepwise(e0, { year: 200, tick: 50 })!.edits.playFrom).toBe(200);
  });

  it('另开一支、切过去、切回来:每一支完整的进度不变,按时刻记;存档往返一样', () => {
    const f = forkBranch(e0, { year: 400, tick: 100 }, '北伐')!;
    const b = f.edits.branches!.list[0];
    expect(b).toEqual({ id: 2, name: '北伐', from: 400, fromTick: 100, year: 400, tick: 100, commands: [], playFrom: 300, forkOf: 1, forkAt: 400, forkTick: 100 });
    expect(branchPlay(cur, b)).toEqual({ year: 400, tick: 100, commands: [c300, c400] });
    const s = switchBranch(f.edits, 2, '旧的')!;
    expect(s.play).toEqual({ year: 400, tick: 100, commands: [c300, c400] });
    const old = s.branches!.list.find((x) => x.id === 1)!;
    expect(old).toMatchObject({ from: 400, fromTick: 100, year: 700, tick: 128, commands: [c400b, c700] });
    expect(branchPlay(s.play!, old)).toEqual(cur);
    // 在新的一支往下走、下年中的命令,切回原来那一支:原样回来
    const mine = cmd(400, 9, 100);
    const walked: WorldEdits = { ...s, play: { year: 450, tick: 100, commands: [...s.play!.commands, mine] } };
    const back = switchBranch(walked, 1)!;
    expect(back.play).toEqual(cur);
    const two = back.branches!.list.find((x) => x.id === 2)!;
    expect(branchPlay(back.play!, two)).toEqual({ year: 450, tick: 100, commands: [c300, c400, mine] });
    // 列表里带着时刻(年初的不写第几格)
    const info = branchList(back);
    expect(info.find((x) => x.current)).toMatchObject({ id: 1, year: 700, tick: 128 });
    expect(info.find((x) => !x.current)).toMatchObject({ id: 2, from: 400, fromTick: 100, year: 450, tick: 100, forkAt: 400, forkTick: 100 });
    // 存档往返一样(格式 2),清理过的就是原样
    const rt = roundTrip(back);
    expect(rt.format).toBe(2);
    expect(rt.edits.branches).toEqual(back.branches);
    expect(cleanBranches(back.branches, back.play)).toBe(back.branches);
  });

  it('倒回到一支分出来以前:另开的几支换记法(按时刻),分出的那一刻跟着改', () => {
    const f = forkBranch(e0, { year: 600, tick: 30 })!;
    const s = switchBranch(f.edits, 2)!;
    const r = rewindStepwise(s, { year: 400, tick: 100 })!;
    expect(r.edits.branches).toMatchObject({ id: 2, forkOf: 1, forkAt: 400, forkTick: 100 });
    const kept = r.edits.branches!.list.find((x) => x.id === 1)!;
    expect(kept).toMatchObject({ from: 400, fromTick: 100 });
    expect(branchPlay(r.edits.play!, kept)).toEqual(cur);
    // 倒回到年初:分出的那一刻不留第几格
    const r0 = rewindStepwise(s, 400)!;
    expect(r0.edits.branches!.forkAt).toBe(400);
    expect('forkTick' in r0.edits.branches!).toBe(false);
    expect(branchPlay(r0.edits.play!, r0.edits.branches!.list.find((x) => x.id === 1)!)).toEqual(cur);
  });

  it('支线的第几格不合格:那一支去掉;分出的那一刻不合格只去掉那一项;晚于现在的改记成从现在起', () => {
    const play: PlayState = { year: 700, tick: 128, commands: [c300, c700] };
    const raw = {
      id: 3,
      list: [
        { id: 1, from: 200, fromTick: 1.5, year: 250, commands: [] },
        { id: 2, from: 200, year: 250, tick: 999, commands: [] },
        { id: 4, from: 250, fromTick: 9, year: 250, tick: 8, commands: [] },
        { id: 5, from: 200, year: 250, commands: [], forkAt: 200, forkTick: 'x' },
        { id: 6, from: 700, fromTick: 200, year: 800, commands: [cmd(750, 7)] },
      ],
    };
    const bs = cleanBranches(raw, play)!;
    expect(bs.list.map((b) => b.id)).toEqual([5, 6]);
    expect(bs.list[0]).toEqual({ id: 5, from: 200, year: 250, commands: [] });
    expect(bs.list[1]).toEqual({ id: 6, from: 700, fromTick: 128, year: 800, commands: [c700, cmd(750, 7)] });
  });

  it('存回推演模式:停在年中的推到那一年的那一格,下过的命令一条不丢;年中的命令在干预里照带第几格', () => {
    const n = stepwiseToNormal(e0)!;
    expect(n.endYear).toBe(700);
    expect(n.endTick).toBe(128);
    expect(n.interventions).toEqual([c300, c400, c400b, c700]);
    expect(saveFormatOf(n)).toBe(2);
    expect(stepwiseToNormal({ ...base, play: { year: 700, commands: [] } })!.endYear).toBe(700);
  });

  it('干预还没到那一刻 = later(按年中的那一刻比)', () => {
    const civ = { interventions: [cmd(300, 1, 128)], endYear: 300 + 100 / 256 } as unknown as Civ;
    expect(interventionFate(civ, 0)).toEqual({ state: 'later' });
  });
});
