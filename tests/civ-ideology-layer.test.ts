import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { IDEO_SCALE, THOUGHTS, THOUGHT_COUNT, ideologyAt, thoughtOrigin } from '../src/gen/civ/ideology';
import { THOUGHT_TAG, ideologyEntries } from '../src/gen/civ/story/ideologyText';
import { fullChronicle } from '../src/gen/civ/story/religionText';
import { thoughtAuto, thoughtBand, thoughtBase, thoughtCiv, thoughtCounts, thoughtFocus } from '../src/render/civ/thoughts';
import { cheng, polityThoughtRows, regionThoughts, thoughtSide, trendOf } from '../src/ui/thoughtInfo';
import { civShowFromQuery } from '../src/ui/civView';
import { evLabel, evType } from '../src/ui/timelineLayout';

const civ = generateCiv(generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed: 7 }));
const ideo = civ.ideology!;
const K = THOUGHT_COUNT;
const firstYear = Math.min(...ideo.events.map((e) => e.year));

describe('思潮图层', () => {
  it('快照每 20 年一份;按年份插值的接受度落在五档里', () => {
    expect(ideo.events.length).toBeGreaterThan(0);
    for (let i = 1; i < ideo.snapYears.length - 1; i++) expect(ideo.snapYears[i] - ideo.snapYears[i - 1]).toBe(20);
    expect([0.04, 0.05, 0.09, 0.1, 0.29, 0.3, 0.5, 0.69, 0.7, 1].map(thoughtBand)).toEqual([-1, 0, 0, 1, 1, 2, 3, 3, 4, 4]);
    // 快照存整数,读回 Float32 时 175 / 250 = 0.69999…:照样算七成
    expect([13, 25, 75, 125, 175].map((x) => thoughtBand(new Float32Array([x / IDEO_SCALE])[0]))).toEqual([0, 1, 2, 3, 4]);
  });

  it('换进民族那一层的五档:按 civ + 哪一说缓存;各年的色块和那年的接受度一致', () => {
    const k = ideo.events[0].thought;
    const view = thoughtCiv(civ, k);
    expect(view.cultures.length).toBe(5);
    expect(thoughtCiv(civ, k)).toBe(view);
    expect(thoughtCiv(civ, (k + 1) % K)).not.toBe(view);
    expect(thoughtBase(view)).toBe(civ);
    expect(thoughtBase(civ)).toBeNull();
    for (const y of [Math.ceil(firstYear / 20) * 20 + 200, 2000, civ.endYear]) {
      const own = ownersAt(view, y);
      const v = ideologyAt(ideo, y);
      for (let r = 0; r < civ.regions.count; r++) expect(own.culture[r]).toBe(thoughtBand(v[r * K + k]));
    }
    // 世上还没有思潮:一州都不上色
    const none = thoughtCiv(civ, -1);
    expect(ownersAt(none, civ.endYear).culture.every((c) => c === -1)).toBe(true);
  });

  it('看哪一说:选过的那说有人倡了就看它,不然看到半成的州最多的那说;还没有思潮 = −1', () => {
    expect(thoughtFocus(civ, {}, Math.floor(firstYear) - 1)).toBe(-1);
    const y = civ.endYear;
    const n = thoughtCounts(civ, y);
    const auto = thoughtAuto(civ, y);
    expect(n[auto]).toBe(Math.max(...n));
    expect(thoughtFocus(civ, {}, y)).toBe(auto);
    const other = ideo.events.find((e) => e.thought !== auto)!.thought;
    expect(thoughtFocus(civ, { thought: other }, y)).toBe(other);
    // 选的那说那一年还没有人倡:看默认的
    const late = ideo.events[ideo.events.length - 1];
    expect(thoughtFocus(civ, { thought: late.thought }, Math.floor(late.year) - 1)).toBe(thoughtAuto(civ, Math.floor(late.year) - 1));
    // 网址 ideo=
    expect(civShowFromQuery(new URLSearchParams('fill=ideology&ideo=4')).thought).toBe(4);
    expect(civShowFromQuery(new URLSearchParams('fill=ideology&ideo=x')).thought).toBeUndefined();
  });

  it('侧栏:冒出来过的几说按七说的次序,还没冒出来的灰着;从没冒出来的合成一行;还没有思潮的年份换成一句话', () => {
    const y = civ.endYear;
    const side = thoughtSide(civ, y);
    expect(side.empty).toBeNull();
    expect(side.rows.map((r) => r.k)).toEqual([...side.rows.map((r) => r.k)].sort((a, b) => a - b));
    for (const r of side.rows) {
      expect(r.live).toBe(true);
      expect(r.sub).toMatch(/^\d+ 年始倡于/);
    }
    const never = THOUGHTS.filter((_, k) => !thoughtOrigin(ideo, k)).map((t) => t.name);
    if (never.length) expect(side.never).toContain(never[0]);
    else expect(side.never).toBeNull();
    const last = ideo.events[ideo.events.length - 1];
    const mid = thoughtSide(civ, Math.floor(last.year) - 1);
    expect(mid.rows.find((r) => r.k === last.thought)!.sub).toBe(`${Math.floor(last.year)} 年才有人倡`);
    const early = thoughtSide(civ, Math.floor(firstYear) - 1);
    expect(early.empty?.title).toBe(`第 ${Math.floor(firstYear) - 1} 年，世上还没有思潮`);
    expect(early.empty?.jump).toBe(Math.floor(firstYear));
    expect(early.order).toMatch(/^这个世界各说冒出来的先后：/);
  });

  it('州卡片、国家卡片:到半成的几说从多到少,几成、比百年前', () => {
    expect([0.04, 0.12, 0.63, 0.8, 0.96].map(cheng)).toEqual(['不到一成', '一成', '六成', '八成', '十成']);
    expect([trendOf(0.62, 0.59), trendOf(0.59, 0.62), trendOf(0.6, 0.59)]).toEqual(['up', 'down', 'flat']);
    const y = civ.endYear;
    const own = ownersAt(civ, y);
    let seen = 0;
    for (let r = 0; r < civ.regions.count; r += 7) {
      const list = regionThoughts(civ, r, y, own.polity[r]);
      for (let i = 1; i < list.length; i++) expect(list[i].share).toBeLessThanOrEqual(list[i - 1].share);
      for (const t of list) expect(thoughtBand(t.share)).toBeGreaterThanOrEqual(0);
      seen += list.length;
    }
    expect(seen).toBeGreaterThan(0);
    // 始倡以前几年(快照之间插值会有一点):州卡片不列
    const o = ideo.events[ideo.events.length - 1];
    const before = Math.floor(o.year) - 1;
    expect(regionThoughts(civ, o.region, before, ownersAt(civ, before).polity[o.region]).some((t) => t.k === o.thought)).toBe(false);
    const p = own.polity.find((q) => q >= 0)!;
    for (const t of polityThoughtRows(civ, p, y)) {
      expect(thoughtBand(t.share)).toBeGreaterThanOrEqual(0);
      expect(t.series.length).toBeGreaterThan(1);
      expect(t.series[t.series.length - 1]).toBeCloseTo(t.share, 5);
    }
  });
});

describe('思潮的编年史', () => {
  const list = ideologyEntries(civ);

  it('始倡:每说世上头一回一条大事,写那城、那说、主张', () => {
    const origins = list.filter((e) => e.importance === 3);
    expect(origins.length).toBe(ideo.events.length);
    for (const e of origins) {
      expect(e.kind).toBe('thought');
      expect(e.tag).toBe(THOUGHT_TAG);
      expect(e.text).toContain(`始倡${THOUGHTS[e.thought!].name},言`);
      expect(e.text).not.toMatch(/[,，]守成|[,，]法不避贵/);
    }
    expect(evType(origins[0])).toBe('thought');
    expect(evLabel(origins[0])).toBe('思潮');
  });

  it('盛于:那国当时 20 州以上、国中头一回过半;每国每说一条', () => {
    const rises = list.filter((e) => e.text.includes('盛于'));
    const seen = new Set<string>();
    for (const e of rises) {
      expect(e.importance).toBe(2);
      const p = e.polities[0];
      const key = `${p}:${e.thought}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      const own = ownersAt(civ, e.year);
      let n = 0;
      for (const q of own.polity) if (q === p) n++;
      expect(n).toBeGreaterThanOrEqual(20);
      const s = ideo.polities[p]!;
      const i = (e.year - s.from) / 20;
      expect(s.v[i * K + e.thought!]).toBeGreaterThanOrEqual(0.5 * IDEO_SCALE);
      for (let j = 0; j < i; j++) expect(s.v[j * K + e.thought!]).toBeLessThan(0.5 * IDEO_SCALE);
    }
  });

  it('渐衰:代兴的那说比衰的那说多,或已经连着压了几步', () => {
    for (const e of list.filter((x) => x.text.includes('渐衰'))) {
      expect(e.text).toMatch(/渐衰,.+代兴$/);
      const s = ideo.polities[e.polities[0]]!;
      const i = (e.year - s.from) / 20;
      const by = e.thought!;
      const fell = THOUGHTS.findIndex((t) => e.text.includes(`${t.name}渐衰`));
      expect(s.v[i * K + by]).toBeGreaterThan(s.v[i * K + fell]);
    }
  });

  it('进整本编年史,id 不和别的条目撞', () => {
    const all = fullChronicle(civ);
    const ids = new Set(all.map((e) => e.id));
    expect(ids.size).toBe(all.length);
    for (const e of list) expect(all).toContain(e);
  });
});
