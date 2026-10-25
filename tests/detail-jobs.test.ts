import { describe, expect, it } from 'vitest';
import { aheadOf, cancelDetailJob, detailJobPending, flushDetailJobs, submitDetailJob } from '../src/ui/detailJobs';

/**
 * 细节层分帧备料的调度(ui/detailJobs.ts):每段做一会儿就让出主线程;
 * 几层的活都备好了才在同一个任务里一起画;同一层的新活顶掉旧活
 */
const until = async (ok: () => boolean, ms = 2000) => {
  const t0 = performance.now();
  while (!ok() && performance.now() - t0 < ms) await new Promise((r) => setTimeout(r, 1));
};
const tick = () => new Promise((r) => setTimeout(r, 20));

describe('细节层分帧备料', () => {
  it('几层的活都备好了才一起画;同一层的新活顶掉旧活(旧的不画)', async () => {
    const log: string[] = [];
    let n = 0;
    submitDetailJob('a', [() => void log.push('a 备料')], () => log.push('a 画'));
    submitDetailJob('b', [() => ++n < 5, () => void log.push('b 备料')], () => log.push('b 画'));
    submitDetailJob('a', [() => void log.push('a 新备料')], () => log.push('a 新画'));
    expect(log).toEqual([]);
    await until(() => !detailJobPending('a') && !detailJobPending('b'));
    expect(n).toBe(5);
    expect(log).toEqual(['a 新备料', 'b 备料', 'a 新画', 'b 画']);
  });

  it('alone 的活自己备好就交,不等别的层;别的层照旧一起等', async () => {
    const log: string[] = [];
    let n = 0;
    // 一步 3 毫秒、12 步:要分好几段
    const slow = () => {
      const t = performance.now();
      while (performance.now() - t < 3);
      return ++n < 12;
    };
    submitDetailJob('fast', [() => void log.push('fast 备料')], () => log.push('fast 画'));
    let slowAtSwap = -1;
    submitDetailJob(
      'swap',
      [() => void log.push('swap 备料')],
      () => {
        log.push('swap 交');
        slowAtSwap = n;
      },
      { alone: true },
    );
    submitDetailJob('slow', [slow], () => log.push('slow 画'));
    await until(() => !detailJobPending('slow'));
    // swap 交的时候 slow 还没备好;fast 等着和 slow 一起画
    expect(slowAtSwap).toBeGreaterThanOrEqual(0);
    expect(slowAtSwap).toBeLessThan(12);
    expect(log).toEqual(['fast 备料', 'swap 备料', 'swap 交', 'fast 画', 'slow 画']);
  });

  it('还没备好的 alone 活也不拦着别的层一起画', async () => {
    const log: string[] = [];
    let n = 0;
    const slow = () => {
      const t = performance.now();
      while (performance.now() - t < 3);
      return ++n < 12;
    };
    let swapAtLayers = -1;
    submitDetailJob('swap', [slow], () => log.push('swap 交'), { alone: true });
    submitDetailJob('a', [() => void log.push('a 备料')], () => log.push('a 画'));
    submitDetailJob(
      'b',
      [() => void log.push('b 备料')],
      () => {
        log.push('b 画');
        swapAtLayers = n;
      },
    );
    await until(() => !detailJobPending('swap'));
    expect(swapAtLayers).toBeGreaterThanOrEqual(0);
    expect(swapAtLayers).toBeLessThan(12);
    expect(log).toEqual(['a 备料', 'b 备料', 'a 画', 'b 画', 'swap 交']);
  });

  it('别的层备料出错:那一批不画,alone 的活照常做完交上', async () => {
    const log: string[] = [];
    submitDetailJob('swap', [() => void log.push('swap 备料')], () => log.push('swap 交'), { alone: true });
    submitDetailJob('ok', [() => void log.push('ok 备料')], () => log.push('ok 画'));
    submitDetailJob(
      'bad',
      [
        () => {
          throw new Error('坏了');
        },
      ],
      () => log.push('bad 画'),
    );
    expect(() => flushDetailJobs()).toThrow('坏了');
    await until(() => !detailJobPending('swap'));
    expect(detailJobPending('ok')).toBe(false);
    expect(detailJobPending('bad')).toBe(false);
    expect(log).toContain('swap 交');
    expect(log).not.toContain('ok 画');
    expect(log).not.toContain('bad 画');
  });

  it('一段只做一会儿:长活分好几段做完(中间让出主线程)', async () => {
    let m = 0;
    const busy = () => {
      const t = performance.now();
      while (performance.now() - t < 3);
      return ++m < 12;
    };
    let stats: { prep: number; slices: number } | null = null;
    let other = 0;
    const timer = setInterval(() => other++, 0);
    submitDetailJob('a', [busy], (st) => (stats = st));
    await until(() => !!stats);
    clearInterval(timer);
    expect(m).toBe(12);
    expect(stats!.slices).toBeGreaterThan(2);
    expect(stats!.prep).toBeGreaterThan(30);
    // 分段之间别的任务(这里是计时器)照样跑
    expect(other).toBeGreaterThan(0);
  });

  it('画了一下的一步:这一段到此为止(下一下放到下一段);等不及时照样当下画完', async () => {
    const log: string[] = [];
    let more = 0;
    const steps = [
      () => void log.push('备料'),
      () => {
        log.push('画 1');
        return 'painted' as const;
      },
      () => {
        log.push('画 2');
        return ++more < 3 ? ('painting' as const) : ('painted' as const);
      },
      () => void log.push('收尾'),
    ];
    let stats: { prep: number; slices: number } | null = null;
    submitDetailJob('a', steps, (st) => (stats = st));
    await until(() => !!stats);
    expect(log).toEqual(['备料', '画 1', '画 2', '画 2', '画 2', '收尾']);
    // 备料 + 画 1 一段,画 2 三下各一段,收尾一段
    expect(stats!.slices).toBe(5);
    log.length = 0;
    more = 0;
    stats = null;
    submitDetailJob('a', steps, (st) => (stats = st));
    flushDetailJobs();
    expect(log).toEqual(['备料', '画 1', '画 2', '画 2', '画 2', '收尾']);
    expect(stats!.slices).toBe(1);
  });

  it('不要了的活不画;等不及时剩下的当下做完、马上画', async () => {
    const log: string[] = [];
    submitDetailJob('a', [() => void log.push('a 备料')], () => log.push('a 画'));
    cancelDetailJob('a');
    await tick();
    expect(log).toEqual([]);
    let k = 0;
    submitDetailJob('b', [() => ++k < 1000], () => log.push('b 画'));
    flushDetailJobs();
    expect(k).toBe(1000);
    expect(log).toEqual(['b 画']);
    expect(detailJobPending('b')).toBe(false);
    await tick();
    expect(log).toEqual(['b 画']);
  });
});

describe('拖动中提前备下一块', () => {
  // 看得见 400 × 200,四周各留 1/4(100、50)
  const vis = (x0: number, y0: number) => ({ x0, y0, x1: x0 + 400, y1: y0 + 200 });
  const d = { x0: 900, y0: 450, x1: 1500, y1: 750 };

  it('离边都还远:不用备', () => {
    expect(aheadOf(d, vis(1000, 500), 0.25, 4000, 2000)).toBeNull();
    expect(aheadOf(d, vis(1040, 520), 0.25, 4000, 2000)).toBeNull();
  });

  it('往右下拖到离边不到半个余量:往右下挪半个余量', () => {
    expect(aheadOf(d, vis(1060, 500), 0.25, 4000, 2000)).toEqual([50, 0]);
    expect(aheadOf(d, vis(1060, 530), 0.25, 4000, 2000)).toEqual([50, 25]);
    expect(aheadOf(d, vis(940, 470), 0.25, 4000, 2000)).toEqual([-50, -25]);
  });

  it('地图边上不算:一块本来就伸不出去', () => {
    const e = { x0: 0, y0: 0, x1: 600, y1: 300 };
    expect(aheadOf(e, vis(0, 0), 0.25, 4000, 2000)).toBeNull();
  });
});
