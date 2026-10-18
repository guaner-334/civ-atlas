/** 干预 / 地形大事的"哪些是新加的、哪些删掉了":一模一样的几件按个数算。 */
import { describe, expect, it } from 'vitest';
import { multisetDiff } from '../src/gen/util';

describe('multisetDiff', () => {
  const a = { kind: 'x', from: 10 };
  const b = { kind: 'y', from: 20 };

  it('没变时两边都空', () => {
    expect(multisetDiff([a, b], [b, a])).toEqual({ added: [], removed: [] });
  });

  it('新加一件、删掉一件', () => {
    expect(multisetDiff([a, b], [a])).toEqual({ added: [b], removed: [] });
    expect(multisetDiff([a], [a, b])).toEqual({ added: [], removed: [b] });
  });

  it('一模一样的两件:加或删其中一件也认得出', () => {
    expect(multisetDiff([a, a], [a])).toEqual({ added: [a], removed: [] });
    expect(multisetDiff([a], [a, a])).toEqual({ added: [], removed: [a] });
    expect(multisetDiff([a, a, b], [a, b, b])).toEqual({ added: [a], removed: [b] });
  });
});
