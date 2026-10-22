/**
 * 编年史在后台线程里算好、分块交给主线程(src/chronicleParts.ts → src/ui/chronicleHandoff.ts):
 * - 切块再拼回去(中间像线程交消息一样整个拷一遍)和 fullChronicle / buildChronicle 逐条一样;每块的份量不超过上限(一条本身更大的除外)
 * - 换上时沿用州(reuseRegions)、套改名(namedHistory)出来的历史:编年史直接用交来的那份(不重算),和在主线程上从头算的逐条一样;
 *   带地形大事的(沿用 / 不沿用各段的州)也一样
 * - 改名和线程算的时候不一样、编号对不上、块没收齐:不用交来的,照旧现算
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { buildChronicle, type ChronicleEntry } from '../src/gen/civ/chronicle';
import { fullChronicle } from '../src/gen/civ/religionText';
import { upheavalSteps } from '../src/gen/civ/upheaval';
import { applyNames, polityKey, type Upheaval } from '../src/gen/edits';
import { PART_WEIGHT, chronicleParts, joinChronicleParts, type ChroniclePart } from '../src/chronicleParts';
import { adoptChronicle, namedHistory, takeChroniclePart } from '../src/ui/chronicleHandoff';
import { reuseRegions } from '../src/ui/eras';

const PARAMS = { ...DEFAULT_PARAMS, seed: 7 };
const FLOOD: Upheaval = { year: 1600, ops: [{ kind: 'sink', pts: [1850, 520, 1930, 530, 1903, 469], r: 40, s: 1.1 }] };
let w0: World | null = null;
const world = () => (w0 ??= generateWorld(PARAMS));
let c0: Civ | null = null;
const plain = () => (c0 ??= generateCiv(world()));

/** 在主线程上从头算(浅拷一层,不走缓存) */
const fresh = (civ: Civ) => {
  const c = { ...civ };
  return { full: fullChronicle(c), build: buildChronicle(c) };
};
const text = (list: readonly ChronicleEntry[]) => JSON.stringify(list);

/** 像线程那样交:各块整个拷一遍、按顺序收,再交历史(历史也整个拷一遍);返回主线程收到的历史和各块 */
function handOff(civ: Civ, names: Record<string, string>, key: number, weight = 500): { civ: Civ; parts: ChroniclePart[] } {
  const parts = chronicleParts(civ, names, key, weight).map((p) => structuredClone(p));
  for (const p of parts) takeChroniclePart(p);
  const got = structuredClone(civ);
  adoptChronicle(got, key);
  return { civ: got, parts };
}

describe('编年史在线程里算好交过来', () => {
  it('切块再拼回去和 fullChronicle / buildChronicle 逐条一样;每块份量有上限', () => {
    const civ = plain();
    const names = { [polityKey(civ, 0)]: '甲乙国' };
    const named = applyNames(civ, names);
    for (const weight of [PART_WEIGHT, 200]) {
      const parts = chronicleParts(civ, names, 3, weight).map((p) => structuredClone(p));
      expect(parts.length).toBeGreaterThan(weight === 200 ? 5 : 0);
      for (const p of parts) {
        const w = p.entries.reduce((s, e) => s + 1 + (e.children?.length ?? 0), 0);
        const last = p.entries.at(-1)!;
        expect(w - (1 + (last.children?.length ?? 0))).toBeLessThan(weight);
        expect(p.build.length).toBe(p.entries.length);
      }
      const got = joinChronicleParts(parts, 3)!;
      expect(got.names).toEqual(names);
      expect(text(got.full)).toBe(text(fullChronicle(named)));
      expect(text(got.build)).toBe(text(buildChronicle(named)));
      expect(got.full.some((e) => e.text.includes('甲乙国'))).toBe(true);
      // 编号对不上、少一块、顺序乱了:不拼
      expect(joinChronicleParts(parts, 4)).toBeNull();
      if (parts.length > 1) {
        expect(joinChronicleParts(parts.slice(1), 3)).toBeNull();
        expect(joinChronicleParts([parts[1], parts[0], ...parts.slice(2)], 3)).toBeNull();
      }
    }
  });

  it('换上(沿用州、套改名)以后直接用交来的那份,和从头算的逐条一样;改名不一样、编号对不上就照旧现算', () => {
    const w = world();
    const old = plain();
    const names = { [polityKey(old, 0)]: '甲乙国' };
    // 再推:3000 年推到 3500 年
    const next = generateCiv(w, { endYear: 3500 });
    const { civ: got, parts } = handOff(next, names, 11);
    const raw = reuseRegions(old, got, true, true);
    const full = namedHistory(raw, { ...names });
    const sent = parts.flatMap((p) => p.entries);
    const inBuild = parts.flatMap((p) => [...p.build]);
    expect(fullChronicle(full)[0]).toBe(sent[0]);
    expect(buildChronicle(full)[0]).toBe(sent[inBuild.indexOf(1)]);
    const want = fresh(applyNames(raw, names));
    expect(text(fullChronicle(full))).toBe(text(want.full));
    expect(text(buildChronicle(full))).toBe(text(want.build));
    // 再套一次(改名的对象换了一个、内容一样):还是那份
    expect(fullChronicle(namedHistory(raw, { ...names }))).toBe(fullChronicle(full));

    // 改了名(和线程算的时候不一样):现算
    const other = namedHistory(raw, { [polityKey(old, 0)]: '丙丁国' });
    expect(fullChronicle(other)[0]).not.toBe(sent[0]);
    expect(fullChronicle(other).some((e) => e.text.includes('丙丁国'))).toBe(true);

    // 编号对不上:不记
    const parts2 = chronicleParts(next, {}, 12, 500);
    for (const p of parts2) takeChroniclePart(structuredClone(p));
    const got2 = structuredClone(next);
    adoptChronicle(got2, 13);
    expect(fullChronicle(namedHistory(got2, {}))[0]).not.toBe(parts2[0].entries[0]);
    expect(text(fullChronicle(namedHistory(got2, {})))).toBe(text(fresh(got2).full));
  });

  it('带地形大事的:沿用各段的州(大事一样)、不沿用(大事变了)换上以后,交来的那份和从头算的逐条一样', () => {
    const w = world();
    const steps = upheavalSteps(PARAMS, [], null, [FLOOD]);
    const flood = generateCiv(w, { upheavals: steps });
    // 大事一样、再推 500 年:各段的州沿用
    const later = generateCiv(w, { upheavals: steps, endYear: 3500 });
    // 大事变了(撤销了):第一段的州沿用
    for (const [old, next, sameUps] of [
      [flood, later, true],
      [flood, plain(), false],
      [plain(), flood, false],
    ] as const) {
      const names = { [polityKey(old, 0)]: '甲乙国' };
      const { civ: got, parts } = handOff(next, names, 21);
      const raw = reuseRegions(old, got, sameUps, true);
      const full = namedHistory(raw, names);
      expect(fullChronicle(full)[0]).toBe(parts[0].entries[0]);
      expect(text(fullChronicle(full))).toBe(text(fresh(applyNames(raw, names)).full));
      expect(text(buildChronicle(full))).toBe(text(fresh(applyNames(raw, names)).build));
    }
  });
});
