/**
 * 从大纲点一条到地图上看(src/ui/OutlineMap.tsx、outlineInfo.ts、outlineStore.ts):
 * 地图上小牌子的一句话、立在哪(城 / 州治所 / 那时的国都);选中的还是点过来时那个才算在看。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { capitalAt, polityAlive } from '../src/gen/civ/growth';
import { polityKey, regionKey, settlementKey, type Plot } from '../src/gen/edits';
import { plotCell, plotHeadline, plotText, type OutlineCtx } from '../src/ui/outlineInfo';
import { focusHolds } from '../src/ui/outlineStore';

const civ = generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed: 7 }));
const year = 1500;
const alive = civ.polities.filter((p) => polityAlive(p, year));
const [A, B] = alive;
const ctx = (plots: Plot[]): OutlineCtx => ({ civ, plots });
const capCell = (id: number, y: number) => civ.settlements[capitalAt(civ.polities[id], y)].cell;

describe('地图上的小牌子', () => {
  it('一句话:亡国写并入谁,占据写哪片地方,只讲故事写作者那句', () => {
    const fall: Plot = { id: 1, kind: 'fall', year, a: polityKey(civ, A.id), b: polityKey(civ, B.id) };
    expect(plotHeadline(ctx([fall]), fall)).toMatch(/^.+亡，并入.+$/);
    const alone: Plot = { id: 2, kind: 'fall', year, a: polityKey(civ, A.id) };
    expect(plotHeadline(ctx([alone]), alone)).toMatch(/^.+亡$/);
    const hold: Plot = { id: 3, kind: 'hold', year, a: polityKey(civ, A.id), regions: [regionKey(civ, 0), regionKey(civ, 1)] };
    expect(plotHeadline(ctx([hold]), hold)).toMatch(/占据现圈 2 州$/);
    const story: Plot = { id: 4, kind: 'story', year, text: '雨夜出逃。' };
    expect(plotHeadline(ctx([story]), story)).toBe('雨夜出逃');
    expect(plotText({ id: 5, kind: 'war', year })).toBe('开战');
  });

  it('立在哪:国家 = 那时的国都;州 = 治所;城 = 那座城;说不出地方 = −1', () => {
    const war: Plot = { id: 1, kind: 'war', year, a: polityKey(civ, A.id), b: polityKey(civ, B.id) };
    expect(plotCell(ctx([war]), war, undefined)).toBe(capCell(A.id, year));
    // 批改落定的那年比情节的年份准
    expect(plotCell(ctx([war]), war, { id: 1, status: 'natural', year: year + 5 })).toBe(capCell(A.id, year + 5));
    const found: Plot = { id: 2, kind: 'found', year, region: regionKey(civ, 3) };
    expect(plotCell(ctx([found]), found, undefined)).toBe(civ.regions.seat[3]);
    const s = civ.settlements[0];
    const cap: Plot = { id: 3, kind: 'capital', year, a: polityKey(civ, A.id), city: settlementKey(civ, s.id) };
    expect(plotCell(ctx([cap]), cap, undefined)).toBe(s.cell);
    // 亡了的国家:亡国前一年的国都
    const dead = civ.polities.find((p) => p.ended !== undefined && p.ended > p.founded + 2)!;
    const fall: Plot = { id: 4, kind: 'fall', year: dead.ended! + 30, a: polityKey(civ, dead.id) };
    expect(plotCell(ctx([fall]), fall, undefined)).toBe(capCell(dead.id, dead.ended! - 1));
    expect(plotCell(ctx([]), { id: 5, kind: 'story', year }, undefined)).toBe(-1);
  });
});

describe('在看哪一条', () => {
  it('选中的还是点过来时那个才算', () => {
    const f = { plot: 3, sel: { kind: 'polity' as const, id: 5 } };
    expect(focusHolds(f, { kind: 'polity', id: 5 })).toBe(true);
    expect(focusHolds(f, { kind: 'polity', id: 6 })).toBe(false);
    expect(focusHolds(f, { kind: 'region', id: 5 })).toBe(false);
    expect(focusHolds(f, null)).toBe(false);
    expect(focusHolds(null, { kind: 'polity', id: 5 })).toBe(false);
  });
});
