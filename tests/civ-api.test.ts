/**
 * 子系统之间的具名接口(src/gen/civ/api.ts):接口挂在每次推演自己的 CivSim.api 上,按名字分组;
 * 战争那一组(war)是别的子系统挂给战争的回调和战争提供给别人的宣战、议和、多看一眼。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { CivSim } from '../src/gen/civ/engine/sim';
import { CIV_EVENTS } from '../src/gen/civ/events';
import { resumeCiv } from '../src/gen/civ/modules';
import { warApi } from '../src/gen/civ/api';

describe('子系统之间的具名接口', () => {
  it('每次推演一份:同一次推演取到的是同一组,两次推演互不相干', () => {
    const a = new CivSim(2, CIV_EVENTS);
    const b = new CivSim(2, CIV_EVENTS);
    expect(warApi(a)).toBe(warApi(a));
    expect(warApi(a)).not.toBe(warApi(b));
    const f = () => 1;
    warApi(a).unrest = f;
    expect(warApi(a).unrest).toBe(f);
    expect(warApi(b).unrest).toBeUndefined();
  });

  it('接着推时各子系统照样把接口挂上:战争的宣战、议和、多看一眼,立约、钱粮、联姻挂给战争的', () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7, cells: 4000 });
    const civ = generateCiv(world, { endYear: 400 });
    const sim = resumeCiv(world, civ);
    const war = warApi(sim);
    for (const k of ['declare', 'makePeace', 'look', 'treaty', 'onTruce', 'onFall', 'levy', 'power', 'kin', 'onPeace', 'onAssault', 'sue'] as const)
      expect(typeof war[k], k).toBe('function');
  });
});
