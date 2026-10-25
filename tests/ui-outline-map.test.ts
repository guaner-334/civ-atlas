/**
 * 从大纲点一条到地图上看(src/ui/OutlineMap.tsx、outlineInfo.ts、outlineStore.ts):
 * 地图上小牌子的一句话、立在哪(城 / 州治所 / 那时的国都);选中的还是点过来时那个才算在看。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { capitalAt, polityAlive } from '../src/gen/civ/growth';
import { personKey, polityKey, regionKey, settlementKey, type Plot } from '../src/gen/edits';
import { directorPlots, plotCell, plotHeadline, plotText, type OutlineCtx } from '../src/ui/outlineInfo';
import type { ChronicleEntry } from '../src/gen/civ/chronicle';
import { focusHolds } from '../src/ui/outlineStore';
import { nextInGroup, tickGroups } from '../src/ui/OutlineMap';

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

describe('时间轴上的记号', () => {
  const t = (n: number, year: number, on = false) => ({ id: n, n, year, on });
  it('挨得太近(不到 10 像素)的合成一颗,按年份排', () => {
    const g = tickGroups([t(3, 1500), t(1, 1000), t(2, 1000), t(4, 1503)], (y) => y / 2);
    expect(g.map((x) => x.items.map((i) => i.n))).toEqual([[1, 2], [3, 4]]);
    expect(g[0].x).toBe(500);
  });
  it('点一下轮着看:正看着其中一条 = 下一条,看到最后回到第一条', () => {
    expect(nextInGroup([t(1, 0), t(2, 0)]).n).toBe(1);
    expect(nextInGroup([t(1, 0, true), t(2, 0)]).n).toBe(2);
    expect(nextInGroup([t(1, 0), t(2, 0, true)]).n).toBe(1);
    // 点到的那条在地图上选不了东西(没在看):照上次点到的接着轮
    expect(nextInGroup([t(1, 0), t(2, 0), t(3, 0)], 1).n).toBe(2);
    expect(nextInGroup([t(1, 0), t(2, 0)], 9).n).toBe(1);
  });
});

describe('导播照大纲放:情节对上编年史里哪一件', () => {
  it('两国之间的情节两国都得对上:同一年开了两场仗,对上打的是情节说的那国的', () => {
    const C = alive[2];
    const war = (id: number, b: number, importance: ChronicleEntry['importance']): ChronicleEntry => ({ id, kind: 'war', year, end: year + 3, text: '', tag: '战', importance, polities: [A.id, b], regions: [], settlement: -1 });
    const other = war(1, C.id, 3);
    const hit = war(2, B.id, 2);
    const p: Plot = { id: 7, kind: 'war', year, a: polityKey(civ, A.id), b: polityKey(civ, B.id) };
    const o: OutlineCtx = { civ, plots: [p], review: [{ id: 7, status: 'natural', year }] };
    expect(directorPlots(o, [other, hit])[0].entry).toBe(hit);
    expect(directorPlots(o, [other])[0].entry).toBeNull();
  });
  it('天灾:种类、地方都对上才算 —— 饥荒说的那几州,别处同一年更大的瘟疫、饥荒都不算', () => {
    const [r0, r1] = [0, 1].map((i) => civ.settlements[i].region);
    const ev = (id: number, kind: ChronicleEntry['kind'], region: number, importance: ChronicleEntry['importance']): ChronicleEntry => ({ id, kind, year, end: year, text: '', tag: '灾', importance, polities: [], regions: [region], settlement: -1 });
    const p: Plot = { id: 9, kind: 'disaster', type: 'famine', year, regions: [regionKey(civ, r0)] };
    const o: OutlineCtx = { civ, plots: [p], review: [{ id: 9, status: 'natural', year }] };
    const hit = ev(3, 'famine', r0, 2);
    expect(directorPlots(o, [ev(1, 'plague', r0, 3), ev(2, 'famine', r1, 3), hit])[0].entry).toBe(hit);
    expect(directorPlots(o, [ev(1, 'plague', r0, 3), ev(2, 'famine', r1, 3)])[0].entry).toBeNull();
  });
  it('人死了:只认写到这个人的那件,同一年别的大事不算', () => {
    const P = civ.people!.find((x) => x.died !== undefined)!;
    const y = Math.floor(P.died!);
    const ev = (id: number, people?: number[]): ChronicleEntry => ({ id, kind: 'war', year: y, end: y, text: '', tag: '战', importance: 3, polities: [P.polity], regions: [], settlement: -1, people });
    const p: Plot = { id: 8, kind: 'death', year: y, person: personKey(civ, P.id) };
    const o: OutlineCtx = { civ, plots: [p], review: [{ id: 8, status: 'natural', year: y }] };
    expect(directorPlots(o, [ev(1)])[0].entry).toBeNull();
    const hit = ev(2, [P.id]);
    expect(directorPlots(o, [ev(1), hit])[0].entry).toBe(hit);
  });
});
