/**
 * 推不下去时说可能是哪几项(src/ui/rules/suspects.ts):到了滑条最边上的先挑,再比往那一头走了几成、走了几格,一样的照项表先后;
 * 区间按走得最远的把手;写法和规则摘要一样;一项都没改 = 没有
 */
import { describe, expect, it } from 'vitest';
import { suspectItems } from '../src/ui/rules/suspects';

describe('推不下去时可能是哪几项', () => {
  it('到了最边上的先挑,再比走了几成、几格', () => {
    // 战争 ×4(最右,4 格)、议和后 0 年(最左,5 格)、分裂 ×1.5(没到边上)
    expect(suspectItems({ 'war.odds': 4, 'war.truce': 0, 'split.odds': 1.5 })).toEqual([
      { id: 'war.truce', text: '议和后 0 年不再开战' },
      { id: 'war.odds', text: '战争 ×4' },
    ]);
    // 没到边上的:往那一头走了几成大的先挑(×3 = 那一头的 3/4,×½ = 那一头的一半)
    expect(suspectItems({ 'split.odds': 0.5, 'war.odds': 3 }).map((s) => s.id)).toEqual(['war.odds', 'split.odds']);
    // 关(不发生)也是最边上
    expect(suspectItems({ 'diplo.marry': 0, 'war.odds': 2 }, 1).map((s) => s.id)).toEqual(['diplo.marry']);
  });

  it('只改了一项就只说一项;没改 = 没有;官方值不算改', () => {
    expect(suspectItems({ 'war.odds': 2 }).map((s) => s.id)).toEqual(['war.odds']);
    expect(suspectItems({})).toEqual([]);
    expect(suspectItems(undefined)).toEqual([]);
    expect(suspectItems({ 'war.odds': 1 })).toEqual([]);
  });
});
