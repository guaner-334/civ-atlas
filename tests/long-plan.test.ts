/**
 * 竖版长图:写什么(src/ui/longPlan.ts)和怎么排(src/render/longImage.ts 的 layoutLong、longPages)。
 * 用真实世界(seed 7)核对:节按编年史的分法、没有国家的节不出、最后一节不重复放图、一国版只列这一国的事、
 * 切成 3:4 时每页放得下、切在能切的地方;量字用一个假的(每个字一样宽),不用画布。
 */
import { describe, expect, it } from 'vitest';
import { chronicleEraYears, filterChronicle } from '../src/gen/civ/chronicle';
import { fullChronicle } from '../src/gen/civ/religionText';
import { generateCiv } from '../src/gen/civ';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { defaultPolity, longDoc, longFileName, longPolities, polityEntries, regionCounts, type LongDoc, type LongOptions } from '../src/ui/longPlan';
import { LONG_W, PAGE_H, PAGE_PAD, layoutLong, longPages } from '../src/render/longImage';

const civ = generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed: 7 }));
const all = fullChronicle(civ);
const majors = filterChronicle(all, { major: true });
const opt: LongOptions = { scope: 'world', polity: -1, maps: 'each', events: true, title: '九州大陆', worldTitle: '九州大陆', seed: 7 };
/** 假的量字:每个字(中文、数字一样)占字号那么宽 */
const measure = (s: string, size: number) => Array.from(s).length * size;
const HALF = /[一-鿿][,;:()]|[,;:()][一-鿿]/;

describe('整个世界', () => {
  const doc = longDoc(civ, all, majors, opt);
  const span = chronicleEraYears(civ.endYear);
  const first = Math.floor(Math.min(...civ.polities.map((p) => p.founded)));

  it('按编年史的分法分节,没有国家的节不出,第一节先说一句"还没有国家"', () => {
    expect(doc.sections.length).toBeGreaterThan(2);
    expect(doc.sections[0].title).toBe(`第 ${Math.floor(first / span) * span}—${Math.floor(first / span) * span + span - 1} 年`);
    expect(doc.sections[0].rows[0].note).toBe(true);
    expect(doc.sections.at(-1)!.title).toBe(`第 ${Math.floor((civ.endYear - 1) / span) * span}—${Math.floor(civ.endYear)} 年`);
  });

  it('每节一张这一节最后一年的图,最后一节不再放图;一句话写几国并立、谁最大', () => {
    const secs = doc.sections;
    for (const s of secs.slice(0, -1)) {
      expect(s.map).not.toBeNull();
      expect(s.cap).toMatch(/^第 \d+ 年：(只有.+（\d+ 州）|\d+ 国并立，.+最大（\d+ 州）)$/);
    }
    expect(secs.at(-1)!.map).toBeNull();
    expect(secs.at(-1)!.cap).toBe(`这一节末的疆域，就是最上面那张第 ${Math.floor(civ.endYear)} 年的地图`);
    expect(doc.head).toEqual({ year: civ.endYear });
  });

  it('列的是编年史的大事,一条不少;文字都换成中文标点', () => {
    const rows = doc.sections.flatMap((s) => s.rows.filter((r) => !r.note));
    expect(rows.length).toBe(majors.filter((e) => e.year >= Math.floor(first / span) * span).length);
    for (const r of rows) expect(r.text).not.toMatch(HALF);
    for (const s of doc.sections) expect(s.cap).not.toMatch(HALF);
    expect(doc.lead).toMatch(/^从第 0 年人类登场，到第 \d+ 年。先后立国 \d+ 个，到第 \d+ 年还有 \d+ 国。$/);
  });

  it('疆域图只要开头一张、大事不列', () => {
    const d = longDoc(civ, all, majors, { ...opt, maps: 'first', events: false });
    expect(d.sections.every((s) => s.map === null && s.rows.length === 0)).toBe(true);
    expect(d.sections.length).toBe(doc.sections.length);
  });

  it('同样的选项永远得到同样的内容', () => {
    expect(JSON.stringify(longDoc(civ, all, majors, opt))).toBe(JSON.stringify(doc));
  });

  it('设了纪年:年份和大事正文都照纪年写,不剩"第 N 年"', () => {
    const era = { name: '公元', epoch: 2500 };
    const texts = (d: LongDoc) => [d.lead, d.lead2 ?? '', d.headCap, ...d.sections.flatMap((s) => [s.title, s.cap, ...s.rows.flatMap((r) => [r.label, r.text])])];
    const d = longDoc(civ, all, majors, { ...opt, era });
    expect(d.lead).toMatch(/^从公元前 2500 年人类登场，到公元 \d+ 年。/);
    expect(d.headCap).toBe(`公元 ${Math.floor(civ.endYear) - 2500 + 1} 年`);
    expect(d.sections.at(-1)!.title).toBe('公元元年—公元 501 年');
    for (const t of texts(d)) expect(t).not.toMatch(/第 \d+ 年/);
    expect(d.sections[0].rows.some((r) => r.label.startsWith('前 '))).toBe(true);
    const p = longPolities(civ).fallen[0];
    const d1 = longDoc(civ, all, majors, { ...opt, era, scope: 'one', polity: p.id, title: p.name });
    expect(d1.lead).toMatch(/^公元前 \d+ 年/);
    for (const t of texts(d1)) expect(t).not.toMatch(/第 \d+ 年/);
  });
});

describe('一国', () => {
  const { alive, fallen } = longPolities(civ);

  it('选国家的菜单:现存的按州数排,已亡的按立国先后排', () => {
    expect(alive.length + fallen.length).toBe(civ.polities.length);
    for (let i = 1; i < alive.length; i++) expect(alive[i - 1].regions).toBeGreaterThanOrEqual(alive[i].regions);
    for (let i = 1; i < fallen.length; i++) expect(fallen[i - 1].from).toBeLessThanOrEqual(fallen[i].from);
    const n = regionCounts(civ, civ.endYear);
    for (const p of alive) expect(n.get(p.id)).toBe(p.regions);
    expect(defaultPolity(civ, null)).toBe(alive[0].id);
    expect(defaultPolity(civ, 3)).toBe(3);
  });

  it('开头是国旗、立国那一句、历代国号;图裁到这一国;只列这一国的事、不列君主继位', () => {
    const id = alive[0].id;
    const d = longDoc(civ, all, majors, { ...opt, scope: 'one', polity: id, title: alive[0].name });
    const p = civ.polities[id];
    expect(d.flag).toEqual({ polity: id, year: civ.endYear });
    expect(d.lead).toMatch(new RegExp(`^第 ${Math.floor(p.founded)} 年.+。到第 \\d+ 年有 ${alive[0].regions} 州`));
    expect(d.headCap).toBe(`第 ${Math.floor(civ.endYear)} 年，红线以内是${alive[0].name}`);
    expect(d.sections[0].title.startsWith(`第 ${Math.floor(p.founded)}`)).toBe(true);
    for (const s of d.sections) if (s.map) expect(s.map.polity).toBe(id);
    const mine = polityEntries(all, id);
    expect(mine.every((e) => e.kind !== 'reign')).toBe(true);
    expect(d.sections.flatMap((s) => s.rows).length).toBe(mine.length);
    expect(d.foot.rest).toContain('九州大陆，种子 7。');
  });

  it('已亡的国家:写哪年亡,最后一节到亡国那年', () => {
    const f = fallen[0];
    const d = longDoc(civ, all, majors, { ...opt, scope: 'one', polity: f.id, title: f.name });
    expect(d.lead).toMatch(new RegExp(`第 ${f.to} 年亡，享国 \\d+ 年。$`));
    expect(d.sections.at(-1)!.title).toMatch(new RegExp(`${f.to - (Math.floor(civ.polities[f.id].ended!) === f.to ? 0 : 0)} 年$`));
  });

  it('正好在某节第一年亡的国家:最后一节是亡国那年,亡国那条列在里面;上一节不再放一张和最上面一样的图', () => {
    const span = chronicleEraYears(civ.endYear);
    const p0 = civ.polities.find((p) => p.ended !== undefined && Math.floor(p.ended / span) * span > Math.floor(p.founded))!;
    const y = Math.floor(p0.ended! / span) * span;
    const p = { ...p0, ended: y };
    const c = { ...civ, polities: civ.polities.map((q) => (q.id === p.id ? p : q)) };
    const fall = { ...all.find((e) => e.kind === 'fall')!, id: -1, year: y, end: y, text: '测试国亡', importance: 3 as const, polities: [p.id], children: undefined };
    const d = longDoc(c, [...all.filter((e) => e.year < y), fall], majors, { ...opt, scope: 'one', polity: p.id, title: 'x' });
    expect(d.lead).toMatch(new RegExp(`第 ${y} 年亡`));
    expect(d.sections.at(-1)!.title).toBe(`第 ${y} 年`);
    expect(d.sections.at(-1)!.rows.map((r) => r.text)).toContain('测试国亡');
    expect(d.sections.at(-2)!.title).toMatch(new RegExp(`${y - 1} 年$`));
    expect(d.sections.at(-2)!.map).toBeNull();
  });
});

describe('排版、切页', () => {
  const doc = longDoc(civ, all, majors, opt);
  const lay = layoutLong(doc, measure);

  it('1080 宽;每节、每行都能切;地图按出现的先后', () => {
    expect(lay.w).toBe(LONG_W);
    expect(lay.maps.length).toBe(1 + doc.sections.filter((s) => s.map).length);
    expect(lay.maps[0]).toEqual(doc.head);
    for (let i = 1; i < lay.cuts.length; i++) expect(lay.cuts[i]).toBeGreaterThan(lay.cuts[i - 1]);
    const texts = lay.ops.filter((o) => o.t === 'text');
    for (const o of texts) if (o.t === 'text') expect(o.x + measure(o.s, o.size) + (o.spacing ?? 0) * o.s.length).toBeLessThanOrEqual(LONG_W - 60 + 1);
  });

  it('切成 3:4:每页放得下,首尾相接,切在能切的地方;不把节标题和它的图分开', () => {
    const pages = longPages(lay);
    expect(pages[0][0]).toBe(0);
    expect(pages.at(-1)![1]).toBe(lay.h);
    pages.forEach(([a, b], i) => {
      expect(b - a).toBeLessThanOrEqual(PAGE_H - (i ? PAGE_PAD : 0));
      if (i) expect(a).toBe(pages[i - 1][1]);
      if (i < pages.length - 1) expect(lay.cuts).toContain(b);
    });
    for (const op of lay.ops) {
      if (op.t !== 'map') continue;
      for (const [a, b] of pages) expect(op.y >= b || op.y + op.h <= b || op.y < a).toBe(true);
    }
  });

  it('太长时去掉轻的大事,每节末尾说一句还有几件', () => {
    const short = layoutLong(doc, measure, 6000);
    expect(short.h).toBeLessThanOrEqual(6000);
    expect(short.dropped).toBeGreaterThan(0);
    const notes = short.ops.filter((o) => o.t === 'text' && /这一节还有 \d+ 件大事没列出/.test(o.s));
    expect(notes.length).toBeGreaterThan(0);
  });

  it('文件名', () => {
    expect(longFileName('文明与地图-九州大陆')).toBe('文明与地图-九州大陆-长图.jpg');
    expect(longFileName('文明与地图-九州大陆', 3)).toBe('文明与地图-九州大陆-长图-3.jpg');
  });
});
