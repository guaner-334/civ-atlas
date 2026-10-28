/**
 * 商道(gen/civ/trade.ts)装载时就要用的物产下标不从 development.ts 取:推演的几个文件互相引用,
 * 先引发展度(development.ts)时,它引的推演引擎(sim.ts)又引 trade.ts,trade.ts 比 development.ts 先装载完。
 * 这里照那个先后引一遍,看值都在。
 */
import { RESOURCES } from '../src/gen/civ/development';
import { CivSim } from '../src/gen/civ/sim';
import { describe, expect, it } from 'vitest';
import { TRADE_GOODS } from '../src/gen/civ/trade';

describe('商道:先引发展度也装载得了', () => {
  it('货的下标都在', () => {
    expect(typeof CivSim).toBe('function');
    expect(RESOURCES.length).toBe(11);
    expect(TRADE_GOODS.length).toBe(8);
    for (const g of TRADE_GOODS) expect(Number.isInteger(g)).toBe(true);
  });
});
