/**
 * 逐年推演的支线(数据;格式见 gen/edits.ts 文件头"支线",另开、切换、改名、删掉在 gen/stepwise.ts):
 * - 另开一支只记一笔(不切过去);切过去以后原来那一支留在列表里,切回来进度原样回来
 * - 随机一长串操作(另开、切换、往下走、在"现在"下命令、重新演绎、改名、删掉、存档往返):每一步每一支完整的进度
 *   都和"照它自己走过的路记下的"一样;别的几支的 from 不晚于当前这一支走到的那年
 * - 清理:没有进度不要、编号重复换新的、不合格的那一支去掉、from 太晚的改记法(完整的进度不变)、只有当前这一支不写
 * - 存档往返一样;旧存档(没有这一项)照旧;存档里的 play 就是当前这一支完整的进度(只认识 play 的版本看到的就是它)
 * - 从推演模式开始、存回推演模式不带支线;撤销别的修改时支线照留
 * 真的推演(种子 7、2024、11,分出三支各下几条命令,切回每一支和从第 0 年推到那一年逐字段相等)在 stepwise-branches-run-*.test.ts。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/gen/world';
import { BRANCH_NAME_MAX, cleanBranches, issueCommands, playFromOf, type Intervention, type PlayState, type WorldEdits } from '../src/gen/edits';
import { editsLost, makeSave, parseSave, saveText } from '../src/gen/savefile';
import { branchList, branchPlay, deleteBranch, forkBranch, renameBranch, rewindStepwise, startStepwise, stepwiseToNormal, switchBranch } from '../src/gen/stepwise';
import { revertEdits } from '../src/ui/editsStore';

const base: WorldEdits = { names: {}, interventions: [], terrain: [] };
const params = { ...DEFAULT_PARAMS, seed: 7 };
/** 第 y 年下的一条命令(n 区分是哪一条) */
const cmd = (y: number, n: number): Intervention => ({ kind: 'protect', a: `polity:c${n}#0`, from: y });
const c300 = cmd(300, 1);
const c400 = cmd(400, 2);
const c400b = cmd(400, 3);
const c500 = cmd(500, 4);
const c650 = cmd(650, 5);
const cur: PlayState = { year: 700, commands: [c300, c400, c400b, c500, c650] };
const e0: WorldEdits = { ...base, play: cur, playFrom: 300, advance: { step: 5 } };

/** 存档往返(没有提示) */
function roundTrip(e: WorldEdits): WorldEdits {
  const r = parseSave(saveText(makeSave(params, e, 'x')));
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error('读不回来');
  expect(r.warnings).toEqual([]);
  return r.save.edits;
}

describe('另开一支、切换、改名、删掉', () => {
  it('另开一支只记一笔:停在那一年年初、还没下命令,进度不动;年份取整、夹到 [0, 现在]', () => {
    const f = forkBranch(e0, 450.7)!;
    expect(f.id).toBe(2);
    expect(f.edits.play).toBe(cur);
    expect(f.edits.playFrom).toBe(300);
    expect(f.edits.advance).toEqual({ step: 5 });
    expect(f.edits.branches).toEqual({ id: 1, list: [{ id: 2, from: 450, year: 450, commands: [], playFrom: 300 }] });
    // 从起演那年以前另开:那一支从那一年起演;第 0 年不写
    expect(forkBranch(e0, 200)!.edits.branches!.list[0]).toEqual({ id: 2, from: 200, year: 200, commands: [], playFrom: 200 });
    expect(forkBranch(e0, -5)!.edits.branches!.list[0]).toEqual({ id: 2, from: 0, year: 0, commands: [] });
    expect(forkBranch(e0, NaN)!.edits.branches!.list[0].from).toBe(0);
    expect(forkBranch(e0, 9999)!.edits.branches!.list[0]).toMatchObject({ from: 700, year: 700 });
    // 名字清理过
    expect(forkBranch(e0, 450, '  北\n伐  ')!.edits.branches!.list[0].name).toBe('北伐');
    // 没在逐年推演 = null
    expect(forkBranch(base, 10)).toBeNull();
    expect(switchBranch(base, 1)).toBeNull();
    expect(branchList(base)).toEqual([]);
  });

  it('切过去:那一支换成进度,原来的留在列表里(记着最后一件大事);切回来进度原样回来', () => {
    const f = forkBranch(e0, 450)!;
    const s = switchBranch(f.edits, f.id, '北方大旱')!;
    expect(s.play).toEqual({ year: 450, commands: [c300, c400, c400b] });
    expect(s.playFrom).toBe(300);
    expect(s.advance).toEqual({ step: 5 });
    expect(s.branches).toEqual({ id: 2, list: [{ id: 1, from: 450, year: 700, commands: [c500, c650], playFrom: 300, last: '北方大旱' }] });
    // 列表:按编号排,完整的进度
    expect(branchList(s)).toEqual([
      { id: 1, current: false, from: 450, year: 700, playFrom: 300, play: cur, last: '北方大旱' },
      { id: 2, current: true, year: 450, playFrom: 300, play: s.play },
    ]);
    // 切回来:和原来一样(只有当前这一支、编号 1 = 不写支线 —— 这里还留着另开的那一支)
    const back = switchBranch(s, 1)!;
    expect(back.play).toEqual(cur);
    expect(back.playFrom).toBe(300);
    expect(back.branches).toEqual({ id: 1, list: [{ id: 2, from: 450, year: 450, commands: [], playFrom: 300 }] });
    // 已经是当前这一支 = 原样;没有这一支 = null
    expect(switchBranch(s, 2)).toBe(s);
    expect(switchBranch(s, 9)).toBeNull();
  });

  it('改名(当前这一支也行,空 = 去掉名字);删掉(当前这一支不能删);删到只剩当前这一支、没起名、编号 1 = 不写', () => {
    const f = forkBranch(e0, 450)!;
    const named = renameBranch(renameBranch(f.edits, 2, '南迁')!, 1, '原来那条')!;
    expect(named.branches).toEqual({ id: 1, name: '原来那条', list: [{ id: 2, name: '南迁', from: 450, year: 450, commands: [], playFrom: 300 }] });
    expect(renameBranch(named, 2, '一'.repeat(40))!.branches!.list[0].name).toBe('一'.repeat(BRANCH_NAME_MAX));
    expect(renameBranch(named, 2, '  ')!.branches!.list[0]).not.toHaveProperty('name');
    expect(renameBranch(named, 9, '无')).toBeNull();
    expect(deleteBranch(named, 1)).toBeNull();
    expect(deleteBranch(named, 9)).toBeNull();
    const del = deleteBranch(named, 2)!;
    expect(del.branches).toEqual({ id: 1, name: '原来那条', list: [] });
    const plain = deleteBranch(f.edits, 2)!;
    expect('branches' in plain).toBe(false);
    expect(plain.play).toBe(cur);
    // 切走以后当前这一支的编号不是 1:只剩它也写着编号
    const s = switchBranch(f.edits, 2)!;
    expect(deleteBranch(s, 1)!.branches).toEqual({ id: 2, list: [] });
  });

  it('从这一年重新演绎:别的几支照旧留着,完整的进度不变;存回推演模式、从推演模式重新开始不带支线', () => {
    // 当前这一支(编号 2)从第 450 年分出、走到第 700 年;另开在第 600 年的一支(编号 3,第 600 年下过一条)
    let e = switchBranch(forkBranch(e0, 450)!.edits, 2)!;
    const p2: PlayState = { year: 700, commands: [c300, c400, c400b, cmd(450, 6), cmd(600, 7)] };
    e = { ...e, play: p2 };
    const f3 = forkBranch(e, 600)!;
    e = switchBranch(f3.edits, f3.id)!;
    e = { ...e, play: { year: 640, commands: [...e.play!.commands, cmd(600, 8)] } };
    const before = new Map(branchList(e).map((b) => [b.id, b.play]));
    const r = rewindStepwise(e, 420)!;
    expect(r.dropped).toEqual([cmd(450, 6), cmd(600, 8)]);
    expect(r.edits.play).toEqual({ year: 420, commands: [c300, c400, c400b] });
    const after = new Map(branchList(r.edits).map((b) => [b.id, b.play]));
    expect(after.get(1)).toEqual(before.get(1));
    expect(after.get(2)).toEqual(before.get(2));
    expect(r.edits.branches!.list.every((b) => b.from <= 420)).toBe(true);
    // 存回推演模式:只存当前这一支
    const normal = stepwiseToNormal(e)!;
    expect('branches' in normal).toBe(false);
    expect(normal.interventions).toEqual(e.play!.commands);
    // 从推演模式(或已经在逐年推演的世界)重新开始:不带支线
    expect('branches' in startStepwise(e, 100)).toBe(false);
    // 只有不合格的支线、没有进度的:存回推演模式去掉它
    expect(stepwiseToNormal({ ...base, branches: { id: 1, list: [] } })).toEqual(base);
  });

  it('撤销别的修改时,支线照现在的留着', () => {
    const e = forkBranch(e0, 450)!.edits;
    const after: WorldEdits = { ...e, names: { 'polity:c12#0': '昌' } };
    const undone = revertEdits(after, after, e);
    expect(undone.names).toEqual({});
    expect(undone.branches).toBe(e.branches);
    expect(undone.play).toBe(cur);
  });
});

describe('随机一长串操作:每一支完整的进度都和它自己走过的路一样', () => {
  for (const seed of [7, 2024, 11]) {
    it(`seed ${seed}:400 步(另开、切换、往下走、下命令、重新演绎、改名、删掉、存档往返)`, () => {
      let s = seed >>> 0;
      const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
      const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
      let e: WorldEdits = startStepwise(base, 100);
      /** 照每一支自己走过的路记下的:编号 → 完整的进度、从第几年起、名字 */
      const model = new Map<number, { play: PlayState; playFrom: number; name?: string }>([[1, { play: e.play!, playFrom: 100 }]]);
      let at = 1;
      let n = 100;
      let trips = 0;
      for (let step = 0; step < 400; step++) {
        const r = rnd();
        const now = e.play!;
        if (r < 0.3) {
          // 在"现在"下 0–2 条命令,往下走 1–60 年
          const k = Math.floor(rnd() * 3);
          const issued = issueCommands(now, Array.from({ length: k }, () => cmd(now.year, n++))).play;
          const next = { year: now.year + 1 + Math.floor(rnd() * 60), commands: issued.commands };
          e = { ...e, play: next };
          model.get(at)!.play = next;
        } else if (r < 0.45) {
          const T = Math.floor(rnd() * (now.year + 1));
          const f = forkBranch(e, T, rnd() < 0.3 ? `支${step}` : undefined)!;
          const m = model.get(at)!;
          model.set(f.id, { play: { year: T, commands: m.play.commands.filter((v) => v.from < T) }, playFrom: Math.min(m.playFrom, T) });
          const name = f.edits.branches!.list.find((b) => b.id === f.id)!.name;
          if (name) model.get(f.id)!.name = name;
          e = f.edits;
        } else if (r < 0.65) {
          const id = pick([...model.keys()]);
          const next = switchBranch(e, id, rnd() < 0.5 ? `第${step}步` : undefined)!;
          expect(next).not.toBeNull();
          if (id === at) expect(next).toBe(e);
          e = next;
          at = id;
        } else if (r < 0.75) {
          const T = Math.floor(rnd() * (now.year + 1));
          const back = rewindStepwise(e, T)!;
          const m = model.get(at)!;
          m.play = { year: T, commands: m.play.commands.filter((v) => v.from < T) };
          m.playFrom = Math.min(m.playFrom, T);
          e = back.edits;
        } else if (r < 0.82) {
          const others = [...model.keys()].filter((id) => id !== at);
          if (others.length) {
            const id = pick(others);
            e = deleteBranch(e, id)!;
            model.delete(id);
          }
        } else if (r < 0.9) {
          const id = pick([...model.keys()]);
          const name = rnd() < 0.2 ? '' : `名${step}`;
          e = renameBranch(e, id, name)!;
          if (name) model.get(id)!.name = name;
          else delete model.get(id)!.name;
        } else {
          e = roundTrip(e);
          trips++;
        }
        // 核对:几支和记下的一样(编号、完整的进度、从第几年起、名字),当前这一支对得上;别的几支的 from 不晚于现在
        const list = branchList(e);
        expect(list.map((b) => b.id), `第 ${step} 步`).toEqual([...model.keys()].sort((a, b) => a - b));
        for (const b of list) {
          const m = model.get(b.id)!;
          expect(b.play, `第 ${step} 步 第 ${b.id} 支`).toEqual(m.play);
          expect(b.playFrom, `第 ${step} 步 第 ${b.id} 支起演`).toBe(m.playFrom);
          expect(b.name, `第 ${step} 步 第 ${b.id} 支名字`).toBe(m.name);
          expect(b.current).toBe(b.id === at);
        }
        expect(playFromOf(e)).toBe(model.get(at)!.playFrom);
        for (const b of e.branches?.list ?? []) {
          expect(b.from).toBeLessThanOrEqual(e.play!.year);
          expect(b.commands.every((v) => v.from >= b.from && v.from <= b.year)).toBe(true);
        }
        // 清理过的就是它自己(格式一直合格)
        if (e.branches) expect(cleanBranches(e.branches, e.play)).toBe(e.branches);
      }
      expect(model.size).toBeGreaterThan(2);
      expect(trips).toBeGreaterThan(5);
    });
  }
});

describe('清理、存档', () => {
  it('清理:没有进度不要;编号不合格、重复的换新的;year、from 不合格的那一支去掉;from 太晚的改记法;只有当前这一支不写;合格的原样返回', () => {
    const ok = { id: 3, name: '北伐', list: [{ id: 1, from: 450, year: 700, commands: [c500, c650] }] };
    expect(cleanBranches(ok, cur)).toBe(ok);
    expect(cleanBranches(ok, undefined)).toBeUndefined();
    expect(cleanBranches(ok, { year: -1, commands: [] })).toBeUndefined();
    expect(cleanBranches('x', cur)).toBeUndefined();
    expect(cleanBranches({ id: 1, list: [] }, cur)).toBeUndefined();
    expect(cleanBranches({ list: [] }, cur)).toBeUndefined();
    expect(cleanBranches({ id: 1, name: '主线', list: [] }, cur)).toEqual({ id: 1, name: '主线', list: [] });
    const messy = cleanBranches(
      {
        id: 2,
        name: 5,
        list: [
          { id: 2, from: 100, year: 200, commands: [] }, // 和当前这一支编号重复:换新的
          { id: 'x', from: 100, year: 150, commands: [cmd(120, 9), { kind: 'nope' }, cmd(90, 8), cmd(160, 7)] }, // 编号不合格;命令只收 [from, year] 里合格的
          { id: 5, from: 300, year: 200, commands: [] }, // from 晚于 year:去掉
          { id: 6, from: 1.5, year: 200, commands: [] }, // from 不是整数:去掉
          { id: 7, year: 200, commands: [] }, // 没有 from:去掉
          { id: 8, from: 10, year: 70000, commands: [] }, // year 超范围:去掉
          { id: 9, from: 100, year: 300, commands: [], playFrom: 999.6, last: ' 大\t事 ', name: '' },
          { id: 9, from: 100, year: 300, commands: [], playFrom: -4 }, // 和前面重复:换新的
        ],
      },
      cur,
    )!;
    expect(messy).toEqual({
      id: 2,
      list: [
        { id: 10, from: 100, year: 200, commands: [] },
        { id: 11, from: 100, year: 150, commands: [cmd(120, 9)] },
        { id: 9, from: 100, year: 300, commands: [], playFrom: 300, last: '大事' },
        { id: 12, from: 100, year: 300, commands: [] },
      ],
    });
    // from 晚于当前这一支走到的那年:改记成从那一年起,补上当前这一支那一年下的;完整的进度不变
    const short: PlayState = { year: 400, commands: [c300, c400, c400b] };
    const late = { id: 1, list: [{ id: 2, from: 450, year: 500, commands: [c500] }] };
    const fixed = cleanBranches(late, short)!;
    expect(fixed.list[0]).toEqual({ id: 2, from: 400, year: 500, commands: [c400, c400b, c500] });
    expect(branchPlay(short, fixed.list[0])).toEqual(branchPlay(short, late.list[0]));
  });

  it('存档往返一样;存档里的 play 是当前这一支完整的进度;旧存档没有这一项照旧;认不出的那一支跳过、提示一句;没有进度的不要', () => {
    const e = switchBranch(renameBranch(forkBranch(e0, 450, '南迁')!.edits, 1, '原来那条')!, 2, '北方大旱')!;
    const back = roundTrip(e);
    expect(back.branches).toEqual(e.branches);
    expect(back.play).toEqual(e.play);
    expect(back.playFrom).toBe(300);
    expect(branchList(back)).toEqual(branchList(e));
    // 存档是复制的:之后改原来的不影响
    const save = makeSave(params, e, 'x');
    expect(save.edits.branches).toEqual(e.branches);
    expect(save.edits.branches).not.toBe(e.branches);
    expect(save.edits.branches!.list[0].commands).not.toBe(e.branches!.list[0].commands);
    // 只认识 play 的版本:存档里的 play 是当前这一支(第 450 年分出的那支)完整的进度,另开的几支只在 branches 里
    const raw = JSON.parse(saveText(save)) as { edits: Record<string, unknown> };
    expect(raw.edits.play).toEqual({ year: 450, commands: [c300, c400, c400b] });
    // 旧存档(没有这一项):照旧,没有支线
    const old = roundTrip({ ...e0 });
    expect('branches' in old).toBe(false);
    expect(old.play).toEqual(cur);
    // 认不出的那一支跳过,提示一句
    const text = (branches: unknown) => JSON.stringify({ ...save, edits: { ...save.edits, branches } });
    const bad = parseSave(text({ ...e.branches, list: [...e.branches!.list, { id: 7, from: 'x', year: 1, commands: [] }] }));
    expect(bad.ok && bad.save.edits.branches).toEqual(e.branches);
    expect(bad.ok && bad.warnings).toEqual(['逐年推演的支线里有 1 支认不出来,已跳过']);
    const odd = parseSave(text({ ...e.branches, id: 'x' }));
    expect(odd.ok && odd.warnings).toEqual(['逐年推演的支线里有认不出来的地方,已按认得出的读']);
    // 没有进度:支线不要,不另提示
    const { play: _play, ...rest } = save.edits;
    const noPlay = parseSave(JSON.stringify({ ...save, edits: rest }));
    expect(noPlay.ok && 'branches' in noPlay.save.edits).toBe(false);
    expect(noPlay.ok && noPlay.warnings).toEqual([]);
  });

  it('换成别处的修改会丢掉几支:按另开的几支逐支数', () => {
    const e = forkBranch(forkBranch(e0, 450)!.edits, 500)!.edits;
    const a = makeSave(params, e, 'x');
    expect(editsLost(a, makeSave(params, e, 'x'))).toBe(0);
    expect(editsLost(a, makeSave(params, deleteBranch(e, 2)!, 'x'))).toBe(1);
    expect(editsLost(a, makeSave(params, e0, 'x'))).toBe(2);
  });
});
