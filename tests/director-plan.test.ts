/**
 * 导播的排期(src/ui/directorPlan.ts):放哪几件、停多久、合成一段、两种节奏、事太多 / 来不及时略过哪些、关注对象、镜头。
 * 手工造的纪事(挂在 seed 7 真实的城上)测规则;再用 seed 7、2024 的真实编年史核对:每次排得一样、大事不漏、一步一步排和整段排一样、够快。
 */
import { describe, expect, it } from 'vitest';
import type { ChronicleEntry } from '../src/gen/civ/story/chronicle';
import { MAJOR, entryInvolves, mergeChronicle, reignEntries } from '../src/gen/civ/story/chronicle';
import { fullChronicle } from '../src/gen/civ/story/religionText';
import { generateCiv } from '../src/gen/civ';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import type { Era } from '../src/gen/era';
import { FLY_MS } from '../src/ui/flyTo';
import { filmEvents } from '../src/ui/filmPlan';
import { entryAnchor, entrySpot, entryWeight } from '../src/ui/timelineLayout';
import {
  CROWD_MAX,
  CROWD_YEARS,
  DIRECTOR_FLY,
  DIRECTOR_HOLD,
  FIXED_SHIFT,
  MERGE_MAX,
  MERGE_REACH,
  MERGE_YEARS,
  PLOT_WEIGHT,
  directorAt,
  directorNext,
  directorPlan,
  directorTime,
  directorYear,
  type DirectorInput,
  type DirectorPlan,
  type DirectorPlot,
} from '../src/ui/directorPlan';

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
const civ = generateCiv(world);
const W = world.width;
const { x: MX, y: MY } = world.mesh;

/** 州的平均大小(和 directorPlan.ts 里算的一样) */
const unit = (() => {
  let s = 0;
  for (let r = 0; r < civ.regions.count; r++) s += civ.regions.area[r];
  return Math.sqrt(s / civ.regions.count);
})();
const dist = (a: number, b: number) => {
  const ca = civ.settlements[a].cell;
  const cb = civ.settlements[b].cell;
  let dx = MX[cb] - MX[ca];
  dx -= W * Math.round(dx / W);
  return Math.hypot(dx, MY[cb] - MY[ca]);
};
// 三座城:A、离 A 不远的 B(合得成一段)、离 A 很远的 C
const A = 0;
const B = civ.settlements.findIndex((s, i) => i !== A && dist(A, i) > 0 && dist(A, i) < MERGE_REACH * unit * 0.8);
const C = civ.settlements.findIndex((s, i) => dist(A, i) > MERGE_REACH * unit * 4);

// 手工造的纪事:编号从一百万起、一直往上加(事发地按编号缓存,不能和真实的、别的测试的撞)
let nextId = 1_000_000;
function entry(kind: ChronicleEntry['kind'], year: number, text: string, more: Partial<ChronicleEntry> = {}): ChronicleEntry {
  return { id: nextId++, kind, year, end: year, text, tag: '朝', importance: 3, polities: [0], regions: [], settlement: A, ...more };
}
/** 头等大事(改朝换代,分量 35)/ 其余大事(升格,分量 33)/ 小事(重要度 2) */
const big = (year: number, more: Partial<ChronicleEntry> = {}) => entry('dynasty', year, `第 ${year} 年改朝`, more);
const mid = (year: number, more: Partial<ChronicleEntry> = {}) => entry('rank', year, `第 ${year} 年升格`, { tag: '升', ...more });
const small = (year: number, more: Partial<ChronicleEntry> = {}) => entry('rank', year, `第 ${year} 年小事`, { tag: '升', importance: 2, ...more });

const plan = (entries: ChronicleEntry[], more: Partial<DirectorInput> = {}): DirectorPlan =>
  directorPlan(world, civ, { from: 1000, to: 2000, entries, pace: { mode: 'auto', rate: 80 }, ...more });
const told = (p: DirectorPlan) => p.segments.flatMap((s) => s.items.map((i) => i.entry));

describe('停多久', () => {
  it('头等大事字幕停 3 秒、其余大事 2 秒;镜头先飞 0.6 秒(和选中东西时一样)', () => {
    expect(DIRECTOR_FLY * 1000).toBe(FLY_MS);
    const p = plan([big(1200), mid(1500, { settlement: C })]);
    expect(p.segments).toHaveLength(2);
    const [s0, s1] = p.segments;
    expect(s0.items[0].tier).toBe('big');
    expect(s0.hold).toBeCloseTo(DIRECTOR_FLY + 3, 9);
    expect(s0.items[0].at).toBeCloseTo(s0.at + DIRECTOR_FLY, 9);
    expect(s0.items[0].hold).toBeCloseTo(3, 9);
    expect(s1.items[0].tier).toBe('major');
    expect(s1.hold).toBeCloseTo(DIRECTOR_FLY + 2, 9);
  });

  it('系数:短的减半,长的加倍;小事 1.2 秒', () => {
    const short = plan([big(1200)], { pace: { mode: 'auto', rate: 80, hold: 0.5 } });
    expect(short.segments[0].items[0].hold).toBeCloseTo(1.5, 9);
    const long = plan([big(1200)], { pace: { mode: 'auto', rate: 80, hold: 2 } });
    expect(long.segments[0].items[0].hold).toBeCloseTo(6, 9);
    const p = plan([small(1200)], { focus: { kind: 'polity', id: 0 } });
    expect(p.segments[0].items[0].tier).toBe('minor');
    expect(p.segments[0].items[0].hold).toBeCloseTo(DIRECTOR_HOLD.minor, 9);
  });

  it('字幕:编年史原句换中文标点;多年的战争刚开打时写"起"和开头一句;纪年照写', () => {
    const w = entry('war', 1500, '甲伐乙,得某州', { end: 1530, head: '甲伐乙', tag: '战' });
    const d = big(1600, { text: '甲享国 100 年而亡,乙代之' });
    const p = plan([w, d]);
    const [a, b] = p.segments.map((s) => s.items[0]);
    expect(a.label).toBe('第 1500 年起');
    expect(a.text).toBe('甲伐乙');
    expect(a.typeName).toBe('战争');
    expect(b.label).toBe('第 1600 年');
    expect(b.text).toBe('甲享国 100 年而亡，乙代之');
    expect(b.typeName).toBe('改朝');
    expect(b.place).toBe(civ.settlements[A].name);
    const era: Era = { name: '公元', epoch: 1500 };
    expect(plan([d], { era }).segments[0].items[0].label).toBe('公元 101 年');
  });
});

describe('合成一段', () => {
  it('同一个地方接连几件合成一段:镜头飞一次,字幕一件接一件;最多三件', () => {
    // 相隔 5 年一件:十年里不到三件,不算事太多
    const list = [big(1500), mid(1505), mid(1510, { settlement: B }), mid(1515)];
    const p = plan(list);
    expect(p.segments).toHaveLength(2);
    const [s, t] = p.segments;
    expect(s.items.map((i) => i.entry)).toEqual(list.slice(0, MERGE_MAX));
    expect(t.items.map((i) => i.entry)).toEqual([list[3]]);
    // 字幕一件接一件,中间不空
    expect(s.items[1].at).toBeCloseTo(s.items[0].at + s.items[0].hold, 9);
    expect(s.items[2].at).toBeCloseTo(s.items[1].at + s.items[1].hold, 9);
    expect(s.hold).toBeCloseTo(DIRECTOR_FLY + 3 + 2 + 2, 9);
    expect(s.lead).toBe(0);
    expect(s.year).toBe(1500);
    expect(s.yearEnd).toBe(1510);
  });

  it('隔得远、隔的年份久、中间插进别处的事,都不合', () => {
    expect(plan([big(1500), mid(1502, { settlement: C })]).segments).toHaveLength(2);
    expect(plan([big(1500), mid(1500 + MERGE_YEARS + 1)]).segments).toHaveLength(2);
    expect(plan([big(1500), mid(1501, { settlement: C }), mid(1502)]).segments).toHaveLength(3);
  });

  it('镜头包住这一段每一件的事发地;中心在 [0, W) 里,经纬度对得上;放大 1–3 倍', () => {
    const p = plan([big(1500), mid(1503, { settlement: B })]);
    const sh = p.segments[0].shot!;
    for (const it of p.segments[0].items) {
      const [px, py] = it.pin!;
      const vx = px - W * Math.round((px - (sh.box[0] + sh.box[2]) / 2) / W);
      expect(vx).toBeGreaterThanOrEqual(sh.box[0]);
      expect(vx).toBeLessThanOrEqual(sh.box[2]);
      expect(py).toBeGreaterThanOrEqual(sh.box[1]);
      expect(py).toBeLessThanOrEqual(sh.box[3]);
    }
    expect(sh.x).toBeGreaterThanOrEqual(0);
    expect(sh.x).toBeLessThan(W);
    expect(sh.lon).toBeCloseTo((sh.x / W) * 360 - 180, 9);
    expect(sh.lat).toBeCloseTo(90 - (sh.y / world.height) * 180, 9);
    expect(sh.zoom).toBeGreaterThanOrEqual(1);
    expect(sh.zoom).toBeLessThanOrEqual(3);
    expect(sh.target).toEqual({ kind: 'settlement', id: A });
  });
});

describe('自动节奏:事少快、事多慢', () => {
  it('没事的年份按速度走;到一件事停下(镜头飞、字幕停着),讲完接着走', () => {
    const p = plan([big(1500)]);
    const s = p.segments[0];
    expect(s.at).toBeCloseTo(500 / 80, 9);
    expect(directorYear(p, 2)).toBeCloseTo(1000 + 2 * 80, 9);
    expect(directorYear(p, s.at + 0.3)).toBeCloseTo(1500, 9);
    expect(directorYear(p, s.at + s.hold - 0.01)).toBeCloseTo(1500, 9);
    expect(directorYear(p, s.at + s.hold + 1)).toBeCloseTo(1580, 9);
    expect(p.duration).toBeCloseTo(1000 / 80 + s.hold, 9);
    expect(directorYear(p, p.duration + 5)).toBe(2000);
    // 第一次放到某一年是第几秒
    expect(directorTime(p, 1500)).toBeCloseTo(s.at, 9);
    expect(directorTime(p, 1580)).toBeCloseTo(s.at + s.hold + 1, 9);
  });

  it('合成的一段里年份从第一件走到最后一件,每件字幕出来时正好是那一年', () => {
    const p = plan([big(1500), mid(1504)]);
    const [a, b] = p.segments[0].items;
    expect(directorYear(p, a.at)).toBeCloseTo(1500, 9);
    expect(directorYear(p, b.at)).toBeCloseTo(1504, 9);
    expect(directorYear(p, (a.at + b.at) / 2)).toBeCloseTo(1502, 9);
  });

  it('事越多放得越久,没事的那几段一样快', () => {
    const few = plan([big(1500)]);
    const many = plan([big(1300), big(1500), big(1700, { settlement: C })]);
    expect(many.duration).toBeGreaterThan(few.duration + 2 * (DIRECTOR_FLY + 3) - 1e-9);
    // 第 1000–1300 年:没事,每秒 80 年
    expect(directorTime(many, 1300) - directorTime(many, 1000)).toBeCloseTo(300 / 80, 9);
  });

  it('正在放哪一段、哪一件;下一件', () => {
    const p = plan([big(1500), mid(1504), big(1800, { settlement: C })]);
    const [s, t] = p.segments;
    expect(directorAt(p, s.at - 0.1)).toBeNull();
    expect(directorAt(p, s.at + 0.1)).toEqual({ seg: 0, item: -1 });
    expect(directorAt(p, s.items[1].at + 0.1)).toEqual({ seg: 0, item: 1 });
    expect(directorAt(p, t.items[0].at)).toEqual({ seg: 1, item: 0 });
    expect(directorNext(p, 0)).toBe(0);
    expect(directorNext(p, s.at)).toBe(1);
    expect(directorNext(p, t.at)).toBe(-1);
  });

  it('事太多(十年里三件以上)只留分量重的,头等大事全留', () => {
    const places = civ.settlements.map((_, i) => i).filter((i) => dist(A, i) > MERGE_REACH * unit * 2);
    const list = [big(1500), mid(1501, { settlement: places[0] }), small(1502, { settlement: places[1], polities: [0] })];
    for (let k = 0; k < 4; k++) list.push(mid(1502 + k, { settlement: places[2 + k], kind: k % 2 ? 'faith' : 'rank', tag: k % 2 ? '创' : '升' }));
    const p = plan(list, { focus: { kind: 'polity', id: 0 } });
    const kept = told(p);
    const crowd = p.skipped.filter((s) => s.why === 'crowd');
    expect(kept).toContain(list[0]);
    expect(crowd.length).toBe(list.length - CROWD_MAX);
    const lightest = Math.min(...kept.filter((e) => e !== list[0]).map(entryWeight));
    for (const c of crowd) expect(c.weight).toBeLessThanOrEqual(lightest);
    expect(crowd.map((c) => c.entry)).toContain(list[2]);
    // 头等大事挤在一起也全留
    const bigs = [big(1500), big(1501, { settlement: places[0] }), big(1502, { settlement: places[1] }), big(1503, { settlement: places[2] })];
    expect(told(plan(bigs))).toHaveLength(4);
  });

  it('给了可用时长:最多放这么久,先略过分量轻的', () => {
    const list = [big(1100), mid(1300, { settlement: C }), big(1500), mid(1700, { settlement: C }), big(1900)];
    const p = plan(list, { pace: { mode: 'auto', rate: 80, seconds: 15 } });
    expect(p.duration).toBeLessThanOrEqual(15 + 1e-9);
    const time = p.skipped.filter((s) => s.why === 'time');
    expect(time.length).toBeGreaterThan(0);
    const keptMin = Math.min(...told(p).map(entryWeight));
    for (const s of time) expect(s.weight).toBeLessThanOrEqual(keptMin);
    // 放得下就照常,没事的年份也不加快
    const roomy = plan(list, { pace: { mode: 'auto', rate: 80, seconds: 600 } });
    expect(roomy.skipped).toHaveLength(0);
    expect(roomy.rate).toBe(80);
    // 合成一段的镜头只飞一次,按合成以后的算:同一处相隔 5 年的两件(3 + 2 秒)放得进 6 秒
    const pair = plan([big(1000), mid(1005)], { from: 1000, to: 1010, pace: { mode: 'auto', rate: 80, seconds: 6 } });
    expect(pair.skipped).toHaveLength(0);
    expect(pair.segments).toHaveLength(1);
    expect(pair.duration).toBeLessThanOrEqual(6);
    // 事都略过了,没事的年份也要加快到放得下
    const fast = plan([], { pace: { mode: 'auto', rate: 10, seconds: 20 } });
    expect(fast.duration).toBeCloseTo(20, 6);
  });
});

describe('固定速度', () => {
  it('年份一直按速度走;每件字幕在它发生的那一刻出来,镜头提前 0.6 秒起飞', () => {
    const p = plan([big(1500)], { pace: { mode: 'fixed', rate: 20 } });
    expect(p.duration).toBeCloseTo(1000 / 20, 9);
    expect(directorYear(p, 10)).toBeCloseTo(1200, 9);
    expect(directorYear(p, 27)).toBeCloseTo(1540, 9);
    const s = p.segments[0];
    expect(s.items[0].at).toBeCloseTo(25, 9);
    expect(s.at).toBeCloseTo(25 - DIRECTOR_FLY, 9);
    // 给了可用时长:整段正好放这么久
    const q = plan([big(1500)], { pace: { mode: 'fixed', seconds: 40 } });
    expect(q.rate).toBeCloseTo(25, 9);
    expect(q.duration).toBeCloseTo(40, 9);
    // 给了可用时长:最后讲不完的略过,不拖长;没给:最后一段讲过头,年份停在最后一年等它讲完
    const late = big(1999);
    const r = plan([late], { pace: { mode: 'fixed', seconds: 40 } });
    expect(r.duration).toBeCloseTo(40, 9);
    expect(r.skipped.map((s) => [s.entry, s.why])).toEqual([[late, 'time']]);
    const free = plan([late], { pace: { mode: 'fixed', rate: 25 } });
    expect(told(free)).toEqual([late]);
    expect(free.duration).toBeGreaterThan(40);
    expect(directorYear(free, free.duration - 0.1)).toBe(2000);
  });

  it('来不及讲:分量重的先排,撞了最多往后挪 1 秒,还撞的进"略过的"', () => {
    // 每秒 20 年:相隔 1 年的两件(不同地方)只放得下一件,放分量重的
    const light = mid(1500, { settlement: C });
    const heavy = big(1501);
    const p = plan([light, heavy], { pace: { mode: 'fixed', rate: 20 } });
    expect(told(p)).toEqual([heavy]);
    expect(p.skipped.map((s) => [s.entry, s.why])).toEqual([[light, 'time']]);
    // 相隔够远就都放
    expect(told(plan([light, big(1600)], { pace: { mode: 'fixed', rate: 20 } }))).toHaveLength(2);
    // 前一段刚讲完就接着放(挪了不到 1 秒)
    const a = big(1500);
    const b = big(1500 + Math.ceil((DIRECTOR_FLY + 3 - 0.5) * 20), { settlement: C });
    const q = plan([a, b], { pace: { mode: 'fixed', rate: 20 } });
    expect(q.segments).toHaveLength(2);
    expect(q.segments[1].at).toBeCloseTo(q.segments[0].at + q.segments[0].hold, 9);
    const shift = q.segments[1].at - ((b.year - 1000) / 20 - DIRECTOR_FLY);
    expect(shift).toBeGreaterThan(0);
    expect(shift).toBeLessThanOrEqual(FIXED_SHIFT);
  });

  it('合成的一段放不下时只留分量最重的那件再试', () => {
    // 每秒 2 年:别处更重的一件(第 1496 年,停到第 251 秒)挡住了这一段的开头,只放得下这段最重的那件(第 1504 年,第 252 秒)
    const blocker = entry('fall', 1496, '某国亡', { settlement: C, tag: '亡' });
    const seg = [mid(1500), mid(1502), big(1504)];
    const p = plan([blocker, ...seg], { pace: { mode: 'fixed', rate: 2 } });
    expect(entryWeight(blocker)).toBeGreaterThan(entryWeight(seg[2]));
    expect(told(p)).toEqual([blocker, seg[2]]);
    expect(p.skipped.map((s) => [s.entry, s.why])).toEqual([
      [seg[0], 'time'],
      [seg[1], 'time'],
    ]);
  });
});

describe('关注对象', () => {
  const P = 0;
  const Q = civ.polities.findIndex((p, i) => i !== P);

  it('关注一国:排这国的事(重要度 ≥ 2)+ 别国的头等大事;别国其余的大事进"略过的"', () => {
    const mine = small(1200, { polities: [P] });
    const otherBig = big(1400, { polities: [Q], settlement: C });
    const otherMid = mid(1600, { polities: [Q], settlement: C });
    const otherSmall = small(1700, { polities: [Q], settlement: C });
    const p = plan([mine, otherBig, otherMid, otherSmall], { focus: { kind: 'polity', id: P } });
    expect(told(p)).toEqual([mine, otherBig]);
    expect(p.skipped.map((s) => [s.entry, s.why])).toEqual([[otherMid, 'focus']]);
    // 别国的事一件不放
    const only = plan([mine, otherBig, otherMid], { focus: { kind: 'polity', id: P, others: 'none' } });
    expect(told(only)).toEqual([mine]);
    expect(only.skipped.map((s) => s.entry)).toEqual([otherBig, otherMid]);
    // 没有关注对象:只放全世界的大事
    expect(told(plan([mine, otherBig, otherMid, otherSmall]))).toEqual([otherBig, otherMid]);
    // 关注的国家不存在:按没有关注对象排
    expect(told(plan([mine, otherBig], { focus: { kind: 'polity', id: 1e9 } }))).toEqual([otherBig]);
  });

  it('关注一人:写到他的事都排(连继位这样的小事),他那一国在他在位时的大事也排', () => {
    const all = mergeChronicle(fullChronicle(civ), reignEntries(civ));
    const reign = reignEntries(civ).find((e) => e.people!.length >= 2)!;
    const id = reign.people![1];
    const person = civ.people![id];
    const from = Math.floor(reign.year) - 5;
    const to = Math.floor(reign.year) + 30;
    const p = directorPlan(world, civ, { from, to, entries: all, focus: { kind: 'person', id }, pace: { mode: 'auto' } });
    const kept = told(p);
    // 写到他继位的那一条:讲了,或者那几年事太多、比它重的占满了
    expect([...kept, ...p.skipped.filter((s) => s.why === 'crowd').map((s) => s.entry)]).toContain(reign);
    const a = person.from ?? person.born;
    const b = person.until ?? person.died ?? Infinity;
    for (const e of kept) {
      const mentions = !!e.people?.includes(id) || !!e.children?.some((c) => c.people?.includes(id));
      const ownBig = e.importance >= MAJOR && e.year >= a && e.year <= b && (e.polities.includes(person.polity) || !!e.children?.some((c) => c.polities.includes(person.polity)));
      expect(mentions || ownBig || entryWeight(e) >= 35).toBe(true);
    }
  });
});

describe('照大纲放', () => {
  const plot = (id: number, year: number, m: ChronicleEntry | null, more: Partial<DirectorPlot> = {}): DirectorPlot => ({
    id,
    n: id,
    total: 3,
    year,
    text: `作者写的第 ${id} 条`,
    entry: m,
    cell: civ.settlements[C].cell,
    ...more,
  });
  it('每条情节单独一段:大字是作者写的那句、小字是编年史里对上的那件,对上的那件不另放;停得和头等大事一样久', () => {
    const m = mid(1300);
    const p = plan([big(1200, { settlement: C }), m, big(1700, { settlement: C })], { plots: [plot(1, 1300, m)] });
    const caps = p.segments.flatMap((s) => s.items);
    const pc = caps.find((c) => c.plot);
    expect(pc).toBeDefined();
    expect(pc!.type).toBe('outline');
    expect(pc!.typeName).toBe('大纲');
    expect(pc!.text).toBe('作者写的第 1 条');
    expect(pc!.plot).toEqual({ id: 1, n: 1, total: 3, sub: '第 1300 年升格' });
    expect(pc!.weight).toBe(PLOT_WEIGHT);
    expect(pc!.hold).toBeCloseTo(DIRECTOR_HOLD.big, 9);
    // 对上的那件不另放;字幕挂在编号为负的条目上
    expect(caps.some((c) => c.entry.id === m.id)).toBe(false);
    expect(pc!.entry.id).toBeLessThan(0);
    // 情节不和别的合成一段
    const seg = p.segments.find((s) => s.items.some((c) => c.plot))!;
    expect(seg.items).toHaveLength(1);
  });
  it('情节之间只放头等大事,其余大事进"略过的";对不上编年史的(只讲故事)镜头去情节说的地方', () => {
    const b = big(1200, { settlement: C });
    const o = mid(1500, { settlement: C });
    const p = plan([b, o], { plots: [plot(2, 1800, null)] });
    const ids = told(p).map((e) => e.id);
    expect(ids).toContain(b.id);
    expect(ids).not.toContain(o.id);
    expect(p.skipped.some((x) => x.entry.id === o.id && x.why === 'crowd')).toBe(true);
    const pc = p.segments.flatMap((s) => s.items).find((c) => c.plot)!;
    expect(pc.plot!.sub).toBe('');
    const cell = civ.settlements[C].cell;
    expect(pc.pin).toEqual([MX[cell], MY[cell]]);
  });
  it('同一年的几条照大纲的先后放(不看情节编号)', () => {
    const p = plan([big(1200, { settlement: C })], { plots: [plot(9, 1300, null, { n: 1 }), plot(4, 1300, null, { n: 2 }), plot(6, 1300, null, { n: 3 })] });
    const caps = p.segments.flatMap((s) => s.items).filter((c) => c.plot);
    expect(caps.map((c) => c.plot!.n)).toEqual([1, 2, 3]);
  });
  it('固定速度:同一年的几条情节一条不丢,给了时长也不丢', () => {
    const plots = [plot(1, 1999, null, { n: 1 }), plot(2, 1999, null, { n: 2 }), plot(3, 1999, null, { n: 3 })];
    for (const pace of [{ mode: 'fixed', rate: 20 }, { mode: 'fixed', rate: 20, seconds: 50 }] as const) {
      const caps = plan([big(1200, { settlement: C })], { plots, pace }).segments.flatMap((s) => s.items).filter((c) => c.plot);
      expect(caps.map((c) => c.plot!.n)).toEqual([1, 2, 3]);
    }
  });
  it('讲和对上一场打了几年的仗:小字写打完的那句,不是开打那句', () => {
    const w = entry('war', 1300, '第 1300 年开战,第 1305 年讲和', { end: 1305, tag: '战', head: '第 1300 年开战' });
    const f = filmEvents([w], { from: 0, to: 3000 })[0];
    expect(f.text).not.toBe(f.head);
    const pc = plan([big(1200, { settlement: C })], { plots: [plot(1, 1305, w)] }).segments.flatMap((s) => s.items).find((c) => c.plot)!;
    expect(pc.plot!.sub).toBe(f.text);
  });
  it('范围外的情节不排;没给情节和原来一样', () => {
    const es = [big(1200), mid(1500, { settlement: C })];
    expect(plan(es, { plots: [plot(1, 2500, null)] }).segments.some((s) => s.items.some((c) => c.plot))).toBe(false);
    expect(told(plan(es, { plots: [] }))).toEqual(told(plan(es)));
  });
});

describe('真实编年史(seed 7、2024)', () => {
  const worlds = [7, 2024].map((seed) => {
    const w = seed === 7 ? world : generateWorld({ ...DEFAULT_PARAMS, seed });
    const c = seed === 7 ? civ : generateCiv(w);
    return { seed, world: w, civ: c, all: fullChronicle(c) };
  });

  for (const { seed, world: w, civ: c, all } of worlds) {
    const majors = all.filter((e) => e.importance >= MAJOR);
    // 大战里据险断后的那几下各自单独一段(镜头落在关上)
    const stands = majors.flatMap((e) => (e.kind === 'war' ? (e.children ?? []).filter((x) => x.kind === 'stand') : []));
    const shown = [...majors, ...stands].map((e) => e.id).sort((a, b) => a - b);
    const end = c.endYear;
    const run = (from: number, to: number, pace: DirectorInput['pace'], focus: DirectorInput['focus'] = null) =>
      directorPlan(w, c, { from, to, entries: all, pace, focus });

    it(`seed ${seed}:同样的输入每次排得一样`, () => {
      for (const pace of [{ mode: 'auto' }, { mode: 'fixed', rate: 20 }, { mode: 'auto', seconds: 60, hold: 0.5 }] as const) {
        for (const [from, to] of [
          [0, end],
          [2600, 2625],
        ]) {
          const a = run(from, to, pace);
          const b = directorPlan(w, c, { from, to, entries: [...all].reverse(), pace });
          expect(b).toEqual(a);
        }
      }
      const p = c.polities[0].id;
      expect(run(0, end, { mode: 'auto' }, { kind: 'polity', id: p })).toEqual(run(0, end, { mode: 'auto' }, { kind: 'polity', id: p }));
    });

    it(`seed ${seed}:大事不漏 —— 亡国、改朝换代、大战自动节奏都讲;每件大事不是讲了就是在"略过的"里,只出现一次`, () => {
      const auto = run(0, end, { mode: 'auto' });
      const ids = told(auto).map((e) => e.id);
      const seenAuto = [...ids, ...auto.skipped.map((s) => s.entry.id)];
      expect(new Set(seenAuto).size).toBe(seenAuto.length);
      expect(seenAuto.sort((a, b) => a - b)).toEqual(shown);
      // 没给可用时长、没有关注对象:略过的只会是事太多时分量轻的,不会是头等大事
      for (const s of auto.skipped) expect([s.why, s.tier]).toEqual(['crowd', 'major']);
      const heads = majors.filter((e) => e.kind === 'fall' || e.kind === 'dynasty' || e.kind === 'war');
      expect(heads.length).toBeGreaterThan(10);
      for (const e of heads) expect(ids).toContain(e.id);
      for (const rate of [20, 80]) {
        const f = run(0, end, { mode: 'fixed', rate });
        const seen = [...told(f), ...f.skipped.map((s) => s.entry)].map((e) => e.id);
        expect(new Set(seen).size).toBe(seen.length);
        expect(seen.sort((a, b) => a - b)).toEqual(shown);
        expect(f.skipped.every((s) => s.why === 'time')).toBe(true);
      }
    });

    it(`seed ${seed}:一步一步(每 25 年)排和整段排看的是同一批事,接缝上的不重复、不落下`, () => {
      const seen = (p: DirectorPlan) => [...told(p), ...p.skipped.map((s) => s.entry)].map((e) => e.id);
      const whole = seen(run(0, end, { mode: 'auto' }));
      const steps: number[] = [];
      for (let y = 0; y < end; y += 25) steps.push(...seen(run(y, Math.min(end, y + 25), { mode: 'auto' })));
      expect(steps.sort((a, b) => a - b)).toEqual(whole.sort((a, b) => a - b));
    });

    it(`seed ${seed}:合成的段同一个地方、接连发生;段和段不重叠;时钟不往回走`, () => {
      for (const p of [run(0, end, { mode: 'auto' }), run(0, end, { mode: 'auto' }, { kind: 'polity', id: c.polities[0].id }), run(0, end, { mode: 'fixed', rate: 20 })]) {
        for (const s of p.segments) {
          for (let i = 1; i < s.items.length; i++) {
            expect(s.items[i].entry.year - s.items[i - 1].entry.year).toBeLessThanOrEqual(MERGE_YEARS);
            expect(s.items[i].at).toBeGreaterThanOrEqual(s.items[i - 1].at + s.items[i - 1].hold - 1e-9);
          }
          expect(s.items.length).toBeLessThanOrEqual(MERGE_MAX);
          const a0 = entryAnchor(w, c, s.items[0].entry)!;
          const sameTown = (e: ChronicleEntry) => {
            const x = entrySpot(w, c, e);
            const y = entrySpot(w, c, s.items[0].entry);
            return x?.kind === 'settlement' && y?.kind === 'settlement' && x.id === y.id;
          };
          for (const it of s.items.slice(1)) {
            let dx = it.pin![0] - a0[0];
            dx -= w.width * Math.round(dx / w.width);
            expect(sameTown(it.entry) || Math.hypot(dx, it.pin![1] - a0[1]) <= MERGE_REACH * unitOf(c) + 1e-6).toBe(true);
          }
        }
        for (let i = 1; i < p.segments.length; i++) expect(p.segments[i].at).toBeGreaterThanOrEqual(p.segments[i - 1].at + p.segments[i - 1].hold - 1e-9);
        for (let i = 1; i < p.clock.length; i++) {
          expect(p.clock[i].t).toBeGreaterThanOrEqual(p.clock[i - 1].t);
          expect(p.clock[i].year).toBeGreaterThanOrEqual(p.clock[i - 1].year);
        }
        expect(p.clock[0]).toEqual({ t: 0, year: 0 });
        expect(p.clock[p.clock.length - 1].year).toBe(end);
      }
    });

    it(`seed ${seed}:自动节奏的总时长 = 没事的年份 + 每一段讲的时间;固定速度每件不早于它发生的那一刻`, () => {
      const p = run(0, end, { mode: 'auto' });
      const busy = p.segments.reduce((s, g) => s + (g.yearEnd - g.year), 0);
      const holds = p.segments.reduce((s, g) => s + g.hold, 0);
      expect(p.duration).toBeCloseTo((end - busy) / p.rate + holds, 6);
      const f = run(0, end, { mode: 'fixed', rate: 20 });
      for (const s of f.segments) for (const it of s.items) expect(it.at).toBeGreaterThanOrEqual(it.entry.year / 20 - 1e-9);
    });

    it(`seed ${seed}:固定速度来不及讲时,略过的那件和占了它位置的那段比,分量不更重`, () => {
      for (const rate of [20, 80]) {
        const f = run(0, end, { mode: 'fixed', rate });
        for (const s of f.skipped) {
          const t0 = s.entry.year / rate - DIRECTOR_FLY;
          const t1 = s.entry.year / rate + DIRECTOR_HOLD[s.tier] + FIXED_SHIFT;
          const over = f.segments.filter((g) => g.at < t1 && g.at + g.hold > t0);
          expect(over.length).toBeGreaterThan(0);
          expect(Math.max(...over.map((g) => g.weight))).toBeGreaterThanOrEqual(s.weight);
        }
      }
    });

    it(`seed ${seed}:事太多略过的那件,总有一个含它的十年里已经讲了三件不比它轻的`, () => {
      // 关注事最多的那一国(和它有关的重要度 ≥ 2 的事都排,挤得最厉害)
      const count = c.polities.map((q) => all.filter((e) => e.importance >= 2 && entryInvolves(e, q.id)).length);
      const busiest = c.polities[count.indexOf(Math.max(...count))].id;
      const p = run(0, end, { mode: 'auto' }, { kind: 'polity', id: busiest });
      // 讲了的那几件和它们排的时候的分量(守关那一下按那场仗的分量排)
      const kept = p.segments.flatMap((s) => s.items);
      const crowd = p.skipped.filter((s) => s.why === 'crowd');
      expect(crowd.length).toBeGreaterThan(0);
      for (const s of crowd) {
        const y = s.entry.year;
        const heavier = kept.filter((it) => it.weight >= s.weight).map((it) => it.entry.year);
        const full = heavier.some((a) => a > y - CROWD_YEARS && a <= y && heavier.filter((b) => b >= a && b < a + CROWD_YEARS).length >= CROWD_MAX) ||
          heavier.filter((b) => b >= y && b < y + CROWD_YEARS).length >= CROWD_MAX;
        expect(full).toBe(true);
      }
    });

    it(`seed ${seed}:够快 —— 排 25 年一段 < 5 ms,整个 3000 年 < 100 ms`, () => {
      run(0, end, { mode: 'auto' });
      let t = performance.now();
      let n = 0;
      for (let y = 0; y < end; y += 25, n++) run(y, y + 25, { mode: 'auto' });
      expect((performance.now() - t) / n).toBeLessThan(5);
      t = performance.now();
      for (let k = 0; k < 5; k++) {
        run(0, end, { mode: 'auto' });
        run(0, end, { mode: 'fixed', rate: 80 });
        run(0, end, { mode: 'auto' }, { kind: 'polity', id: c.polities[0].id });
      }
      expect((performance.now() - t) / 15).toBeLessThan(100);
    });
  }
});

function unitOf(c: typeof civ): number {
  let s = 0;
  for (let r = 0; r < c.regions.count; r++) s += c.regions.area[r];
  return Math.sqrt(s / c.regions.count);
}

