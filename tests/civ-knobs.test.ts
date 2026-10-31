/**
 * 旋钮表(src/gen/civ/engine/knobs.ts 的 defineKnobs;总目录 src/gen/civ/knobs.ts):
 * 各子系统"调参"那一段的数登记成表,推演照表里的数算(名字只在一张表里不重复,不同表里可以同名)。
 * 这里核对表的形状,并钉住几项的默认值(改了默认值,同一种子的历史就变了)。
 */
import { describe, expect, it } from 'vitest';
import { CIV_KNOBS } from '../src/gen/civ/knobs';
import { WARS_KNOBS } from '../src/gen/civ/wars';
import { OFFICIAL_KNOBS } from '../src/gen/civ/engine/knobs';

describe('旋钮表', () => {
  it('表名不重复;每张表至少一项;各项是数或一串数(都是有限数或 ±Infinity,没有 NaN)', () => {
    const ids = CIV_KNOBS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of CIV_KNOBS) {
      expect(t.names.length, t.id).toBeGreaterThan(0);
      expect(t.names).toEqual(Object.keys(t.values));
      for (const n of t.names) {
        const v = t.values[n];
        const nums = typeof v === 'number' ? [v] : [...v];
        for (const x of nums) expect(Number.isNaN(x), `${t.id}.${n}`).toBe(false);
      }
    }
  });

  it('不收随机数分流的编号(U_ 开头的那些只是给随机数分流用的,不是能调的数)', () => {
    for (const t of CIV_KNOBS) for (const n of t.names) expect(n.startsWith('U_'), `${t.id}.${n}`).toBe(false);
  });

  it('官方那套数取出来的就是表本身的值(不复制)', () => {
    for (const t of CIV_KNOBS) expect(OFFICIAL_KNOBS.get(t), t.id).toBe(t.values);
    expect(WARS_KNOBS.values.WAR_ODDS).toBe(0.3);
    expect(WARS_KNOBS.values.GAP).toEqual([0.7, 2]);
  });
});
