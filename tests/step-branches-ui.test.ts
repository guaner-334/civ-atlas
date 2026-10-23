/**
 * 侧栏「支线」一组的文字(ui/StepBranches.tsx):名字、"从哪来演到哪"、切走时记下的最后一件大事。
 * 数据(另开、切换、改名、删掉、重新演绎时原来那条留成一支)在 stepwise-branches.test.ts。
 */
import { describe, expect, it } from 'vitest';
import { generateCiv } from '../src/gen/civ';
import { fullChronicle } from '../src/gen/civ/religionText';
import { BRANCH_NOTE_MAX, type PlayState, type WorldEdits } from '../src/gen/edits';
import { branchList, deleteBranch, renameBranch, rewindBranch } from '../src/gen/stepwise';
import { branchLabel, branchNote, branchRef, branchSpan } from '../src/ui/StepBranches';
import { RUN_CELLS, worldOf } from './lib/stepwiseRun';

const cur: PlayState = { year: 1525, commands: [] };
const e0: WorldEdits = { names: {}, interventions: [], terrain: [], play: cur, playFrom: 1500 };

describe('支线一行的文字', () => {
  it('没起名叫"第 N 支";起了名的写进句子加书名号;从哪来演到哪(最早那支 = 起演那年;分出来的 = 哪年从哪一支分出)', () => {
    // 第 1 支演到 1525 年,1510 年重新演绎出「伐莱尼多尔」,演到 1550 年;再从它 1530 年重新演绎出第 3 支
    let e = rewindBranch(e0, 1510, '伐莱尼多尔')!.edits;
    e = { ...e, play: { year: 1550, commands: [] } };
    e = rewindBranch(e, 1530)!.edits;
    e = { ...e, play: { year: 1541, commands: [] } };
    const all = branchList(e);
    const [b1, b2, b3] = all;
    expect(all.map(branchLabel)).toEqual(['第 1 支', '伐莱尼多尔', '第 3 支']);
    expect(all.map(branchRef)).toEqual(['第 1 支', '「伐莱尼多尔」', '第 3 支']);
    expect(branchSpan(b1, all, null)).toBe('1500 年起演绎，演到 1525 年');
    expect(branchSpan(b2, all, null)).toBe('1510 年从第 1 支分出，演到 1550 年');
    expect(branchSpan(b3, all, null)).toBe('1530 年从「伐莱尼多尔」分出，演到 1541 年');
    // 弹窗里的写法
    expect(branchSpan(b1, all, null, true)).toBe('从第 1500 年起演绎，演到第 1525 年');
    expect(branchSpan(b3, all, null, true)).toBe('第 1530 年从「伐莱尼多尔」分出，演到第 1541 年');
    // 改名跟着变;分出它的那一支删掉了:只写哪年分出
    const renamed = branchList(renameBranch(e, 2, '北伐')!);
    expect(branchSpan(renamed[2], renamed, null)).toBe('1530 年从「北伐」分出，演到 1541 年');
    const gone = branchList(deleteBranch(e, 2)!);
    expect(branchSpan(gone[1], gone, null)).toBe('1530 年分出，演到 1541 年');
  });

  it('切走时记下的最后一件大事:"年份 正文",早于"现在"、停一下会列的那么大;长了截断带"…";没有历史 = 没有', () => {
    const civ = generateCiv(worldOf(7, RUN_CELLS), { endYear: 900 });
    const s = branchNote(civ, 800)!;
    expect(s).toMatch(/^\d+ \S/);
    const y = Number(s.split(' ')[0]);
    expect(y).toBeLessThan(800);
    expect([...s].length).toBeLessThanOrEqual(BRANCH_NOTE_MAX);
    // 正文是那一年的一条史事(截断的带"…")
    const text = s.slice(s.indexOf(' ') + 1).replace(/…$/, '');
    expect(fullChronicle(civ).some((e) => Math.floor(e.year) === y && e.text.startsWith(text))).toBe(true);
    expect(branchNote(null, 800)).toBeUndefined();
    expect(branchNote(civ, 0)).toBeUndefined();
  }, 120_000);
});
