/**
 * 再推 N 年的界面状态和纯计算(src/ui/extendStore.ts)、非整千年的时间轴刻度字(timelineLayout.ts 的 rulerOf 给了轨道宽度时):
 * 选几年、推到第几年(到第 60000 年为止)、原来那段挤到左边百分之几;"这台电脑约 N 秒"的估算和写法;
 * 推的进度只认这一次、只增不减;上次推的那一档记在浏览器里;刻度字只有真和结尾挤住才省。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { END_YEAR_MAX } from '../src/gen/edits';
import { YEAR_TICKS } from '../src/gen/edits';
import {
  EXTEND_DEFAULT,
  _resetExtendForTest,
  busyParts,
  durationText,
  extendMs,
  extendPlan,
  extendProgress,
  extendRoom,
  extendStart,
  extendStop,
  getExtend,
  noteExtendSpeed,
  pickYears,
  resetExtend,
  setExtendBusy,
  setExtendFresh,
  setExtendOpen,
  setExtendPick,
  setExtendRunner,
  stopTip,
} from '../src/ui/extendStore';
import { rulerOf } from '../src/ui/timelineLayout';

beforeEach(() => _resetExtendForTest());

describe('选几年', () => {
  it('默认 500 年;自己填的没填 / 填 0 不算', () => {
    expect(getExtend().pick).toBe(EXTEND_DEFAULT);
    expect(pickYears(500, null)).toBe(500);
    expect(pickYears('own', 2500)).toBe(2500);
    expect(pickYears('own', null)).toBeNull();
    expect(pickYears('own', 0)).toBeNull();
  });

  it('推到第几年、原来那段挤到左边百分之几', () => {
    expect(extendPlan(3000, 500)).toEqual({ to: 3500, over: false, squeeze: 86 });
    expect(extendPlan(3000, 2500)).toEqual({ to: 5500, over: false, squeeze: 55 });
    expect(extendPlan(3000, 100)).toEqual({ to: 3100, over: false, squeeze: 97 });
  });

  it('一直能推到第 60000 年;填多了按推到上限算', () => {
    expect(extendRoom(3000)).toBe(57000);
    expect(extendPlan(3000, 99999)).toEqual({ to: END_YEAR_MAX, over: true, squeeze: 5 });
    expect(extendPlan(59900, 500)).toEqual({ to: END_YEAR_MAX, over: true, squeeze: 100 });
    expect(extendRoom(END_YEAR_MAX)).toBe(0);
  });
});

describe('这台电脑约多久', () => {
  it('还没测过 = 不写', () => {
    expect(extendMs(3000, 500)).toBeNull();
  });

  it('按实测的推:再推得越多越久,有地形大事(从第 0 年整段推)更久', () => {
    // 实测:3000 → 3500 年 312 毫秒
    noteExtendSpeed(3000, 3500, 312);
    expect(extendMs(3000, 500)).toBeCloseTo(312, 5);
    const a = extendMs(3000, 1000)!;
    const b = extendMs(3000, 2500)!;
    expect(a).toBeGreaterThan(312);
    expect(b).toBeGreaterThan(a);
    expect(extendMs(3000, 500, true)!).toBeGreaterThan(312);
    // 生成世界时推文明那一步(从第 0 年推到第 3000 年)也能拿来估
    noteExtendSpeed(0, 3000, 1200);
    expect(extendMs(3000, 500)).toBeCloseTo(500, 5);
  });

  it('不合理的实测不记', () => {
    noteExtendSpeed(3000, 3500, 312);
    noteExtendSpeed(3000, 3500, 0);
    noteExtendSpeed(3000, 3500, NaN);
    expect(extendMs(3000, 500)).toBeCloseTo(312, 5);
  });

  it('写法:不到 1 秒写到一位小数,一分钟以内写整秒,再久写分钟', () => {
    expect(durationText(312)).toBe('约 0.3 秒');
    expect(durationText(20)).toBe('约 0.1 秒');
    expect(durationText(980)).toBe('约 1 秒');
    expect(durationText(4400)).toBe('约 4 秒');
    expect(durationText(150_000)).toBe('约 3 分钟');
  });
});

describe('推的时候', () => {
  it('进度只认正在推的这一次,只增不减', () => {
    setExtendBusy({ xid: 2, from: 3000, to: 3500, year: null, pct: 0, slow: false });
    extendProgress(1, 3400, 0.5);
    expect(getExtend().busy!.year).toBeNull();
    extendProgress(2, 3240, 0.14);
    expect(getExtend().busy).toMatchObject({ year: 3240, pct: 0.14 });
    extendProgress(2, 3200, 0.1);
    expect(getExtend().busy).toMatchObject({ year: 3240, pct: 0.14 });
    extendProgress(2, 3500, 1.5);
    expect(getExtend().busy).toMatchObject({ year: 3500, pct: 1 });
  });

  it('推到哪了、「停下」的提示:推到一年中间的写到月(起了名字的写名字),正好在年初的只写年', () => {
    const N12 = ['端月', '杏月', '桃月', '槐月', '蒲月', '荷月', '兰月', '桂月', '菊月', '阳月', '葭月', '冰月'];
    // 第 1549 年 9 月(菊月)停下的世界再推 500 年
    const from = 1549 + 171 / YEAR_TICKS;
    const b = { xid: 1, from, to: from + 500, year: null as number | null, pct: 0, slow: false };
    expect(stopTip(b, undefined, 12, undefined)).toBe('停下：不推了，还是到第 1549 年 9 月');
    expect(stopTip(b, undefined, 12, N12)).toBe('停下：不推了，还是到第 1549 年菊月');
    expect(stopTip({ from: 3000 }, undefined, 12, N12)).toBe('停下：不推了，还是到第 3000 年');
    expect(stopTip(b, undefined, 0, N12)).toBe('停下：不推了，还是到第 1549 年');
    expect(stopTip(b, { name: '公元', epoch: 1000 }, 12, undefined)).toBe('停下：不推了，还是到公元 550 年 9 月');
    // 刚开始推(在原来那一刻)写到月;推到整十年的只写年;数字标主色、月份跟在后面
    expect(busyParts({ ...b, year: from }, undefined, 12, undefined)).toEqual(['正在推，到第 ', '1549', ' 年 9 月']);
    expect(busyParts({ ...b, year: from }, undefined, 12, N12)).toEqual(['正在推，到第 ', '1549', ' 年菊月']);
    expect(busyParts({ ...b, year: 1560 }, undefined, 12, N12)).toEqual(['正在推，到第 ', '1560', ' 年']);
    expect(busyParts({ ...b, year: from }, { name: '公元', epoch: 1000 }, 12, undefined)).toEqual(['正在推，到', '公元 550 年', ' 9 月']);
    expect(busyParts({ ...b, year: 3240, from: 3000, to: 3500 }, undefined, 12, N12)).toEqual(['正在推，到第 ', '3240', ' 年']);
    // 推演推到头、还没回报、有地形大事:只有一段
    expect(busyParts({ ...b, year: b.to }, undefined, 12, N12)).toEqual(['收尾：起名、人物、道路', '', '']);
    expect(busyParts(b, undefined, 12, N12)).toEqual(['正在推', '', '']);
    expect(busyParts({ ...b, slow: true }, undefined, 12, N12, true)[0]).toBe('有地形大事，要从第 0 年重推，慢一些');
  });

  it('弹层里点「再推」:收起弹层、交给 App 推这么多年;「停下」交给 App', () => {
    const start = vi.fn();
    const stop = vi.fn();
    setExtendRunner({ start, stop });
    setExtendOpen(true);
    setExtendPick('own', 2500);
    extendStart(2500);
    expect(getExtend().open).toBe(false);
    expect(start).toHaveBeenCalledWith(2500);
    extendStop();
    expect(stop).toHaveBeenCalledTimes(1);
    setExtendRunner(null);
    extendStart(500);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('换了世界:弹层收起、不在推、刚推的那段不标', () => {
    setExtendOpen(true);
    setExtendBusy({ xid: 1, from: 3000, to: 3500, year: 3100, pct: 0.1, slow: false });
    setExtendFresh({ from: 2000, to: 3000 });
    resetExtend();
    expect(getExtend()).toMatchObject({ open: false, busy: null, fresh: null });
  });
});

describe('记住上次推的那一档', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('推了以后记下,下次打开网页先选着它', async () => {
    setExtendPick('own', 400);
    extendStart(400);
    vi.resetModules();
    const again = await import('../src/ui/extendStore');
    expect(again.getExtend()).toMatchObject({ pick: 'own', own: 400 });
  });

  it('坏了的记录不认,用默认', async () => {
    store.set('wenming-ditu:extend', '{"pick":7,"own":-3}');
    vi.resetModules();
    const again = await import('../src/ui/extendStore');
    expect(again.getExtend()).toMatchObject({ pick: EXTEND_DEFAULT, own: null });
  });
});

describe('非整千年的刻度字:只有真和结尾挤住才省(电脑上轨道约 819 像素)', () => {
  const W = 819;
  it('再推以后的 3500 年照样写 3000(接着推的那一年)', () => {
    expect(rulerOf(3500, null, W).labels).toEqual([0, 1000, 2000, 3000, 3500]);
  });
  it('3100 年:3000 和 3100 挨得太近,省掉 3000', () => {
    expect(rulerOf(3100, null, W).labels).toEqual([0, 1000, 2000, 3100]);
  });
  it('12345 年:大格 5000 年,10000 照样写', () => {
    expect(rulerOf(12345, null, W).labels).toEqual([0, 5000, 10000, 12345]);
  });
  it('轨道窄(窗口小)的时候照样不叠', () => {
    expect(rulerOf(3500, null, 200).labels).toEqual([0, 1000, 2000, 3500]);
  });
  it('整千年的世界和没给宽度时和原来一样', () => {
    expect(rulerOf(3000, null, W).labels).toEqual([0, 1000, 2000, 3000]);
    expect(rulerOf(3500).labels).toEqual([0, 1000, 2000, 3500]);
  });
});
