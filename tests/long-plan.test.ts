/**
 * 故事长图:写什么(src/ui/longPlan.ts)和怎么排(src/render/longImage.ts 的 layoutLong、longPages)。
 * 用真实世界(seed 7)核对:段数不超上限、每段只挑几件(没列出的写还有几件)、最后一段不重复放图、一国版只列这一国的事、
 * AI 史书的章放进它开始的那一段、底部网址能关、切成 3:4 时每页放得下、切在能切的地方;
 * 量字用一个假的(每个字一样宽),不用画布。
 */
import { describe, expect, it } from 'vitest';
import { filterChronicle } from '../src/gen/civ/chronicle';
import { fullChronicle } from '../src/gen/civ/religionText';
import { generateCiv } from '../src/gen/civ';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { buildHistoryPrompts, partName } from '../src/ai/prompts/history';
import {
  bookChapters,
  defaultPolity,
  excerpt,
  longDoc,
  longFileName,
  longPolities,
  placeChapters,
  polityEntries,
  regionCounts,
  type BookSection,
  type LongBook,
  type LongDoc,
  type LongOptions,
} from '../src/ui/longPlan';
import { BRAND_NAME, BRAND_URL, LONG_W, PAGE_H, PAGE_PAD, layoutLong, longPages } from '../src/render/longImage';

const civ = generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed: 7 }));
const all = fullChronicle(civ);
const majors = filterChronicle(all, { major: true });
const opt: LongOptions = { scope: 'world', polity: -1, segments: 6, per: 3, maps: 'each', brand: true, title: '九州大陆', worldTitle: '九州大陆', seed: 7 };
/** 假的量字:每个字(中文、数字一样)占字号那么宽 */
const measure = (s: string, size: number) => Array.from(s).length * size;
const HALF = /[一-鿿][,;:()]|[,;:()][一-鿿]/;
const listed = (d: LongDoc) => d.sections.flatMap((s) => s.rows.filter((r) => !r.note));

describe('整个世界', () => {
  const doc = longDoc(civ, all, majors, opt);
  const first = Math.floor(Math.min(...civ.polities.map((p) => p.founded)));

  it('默认最多 6 段,每段写第几段;第一段先说一句"还没有国家"', () => {
    const n = doc.sections.length;
    expect(n).toBeGreaterThan(2);
    expect(n).toBeLessThanOrEqual(6);
    doc.sections.forEach((s, i) => expect(s.no).toBe(`${i + 1} / ${n}`));
    expect(doc.sections[0].title).toBe(`第 ${Math.floor(first / doc.span) * doc.span}—${Math.floor(first / doc.span) * doc.span + doc.span - 1} 年`);
    expect(doc.sections[0].rows[0].note).toBe(true);
    expect(doc.sections.at(-1)!.title).toMatch(new RegExp(`—${Math.floor(civ.endYear)} 年$`));
    expect(doc.lead).toMatch(/^从第 0 年人类登场，到第 \d+ 年。先后立国 \d+ 个，到第 \d+ 年还有 \d+ 国。$/);
  });

  it('每段一张这一段最后一年的图,最后一段不再放图;一句话写几国并立、谁最大', () => {
    const secs = doc.sections;
    for (const s of secs.slice(0, -1)) {
      expect(s.map).not.toBeNull();
      expect(s.cap).toMatch(/^第 \d+ 年：(只有.+（\d+ 州）|\d+ 国并立，.+最大（\d+ 州）)$/);
    }
    expect(secs.at(-1)!.map).toBeNull();
    expect(secs.at(-1)!.cap).toBe(`这一段末的疆域，就是最上面那张第 ${Math.floor(civ.endYear)} 年的地图`);
    expect(doc.head).toEqual({ year: civ.endYear });
  });

  it('每段最多挑 3 件,没列出的记着几件;年份写成"第 N 年",文字都是中文标点', () => {
    for (const s of doc.sections) {
      const rows = s.rows.filter((r) => !r.note);
      expect(rows.length).toBeLessThanOrEqual(3);
      expect(s.more).toBeGreaterThanOrEqual(0);
      for (const r of rows) {
        expect(r.label).toMatch(/^第 \d+(—\d+)? 年$/);
        expect(r.text).not.toMatch(HALF);
      }
      expect(s.cap).not.toMatch(HALF);
    }
    expect(doc.sections.some((s) => s.more > 0)).toBe(true);
    // 挑的加上没列出的 = 这几段里的全部大事
    const lo = Number(/\d+/.exec(doc.sections[0].title)![0]);
    expect(listed(doc).length + doc.sections.reduce((n, s) => n + s.more, 0)).toBe(majors.filter((e) => e.year >= lo).length);
  });

  it('每段大事选"全部":一件不少(原来的大事年表)', () => {
    const d = longDoc(civ, all, majors, { ...opt, per: Infinity });
    expect(d.sections.every((s) => s.more === 0)).toBe(true);
    expect(listed(d).length).toBe(listed(doc).length + doc.sections.reduce((n, s) => n + s.more, 0));
  });

  it('段数上限:最多 4 段时一段更长;地图只要开头一张', () => {
    const d = longDoc(civ, all, majors, { ...opt, segments: 4, maps: 'first' });
    expect(d.sections.length).toBeLessThanOrEqual(4);
    expect(d.span).toBeGreaterThan(doc.span);
    expect(d.sections.every((s) => s.map === null)).toBe(true);
  });

  it('结尾写标题、种子、架空声明;网址在最底下的带子里,能关', () => {
    expect(doc.foot).toBe('九州大陆，种子 7。模拟生成的架空世界，不是真实地图。');
    expect(doc.brand).toBe(true);
    expect(longDoc(civ, all, majors, { ...opt, brand: false }).brand).toBe(false);
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
    expect(d.sections[0].rows.some((r) => r.label.startsWith('公元前 '))).toBe(true);
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
    for (const s of d.sections.slice(0, -1)) expect(s.cap).toMatch(/^第 \d+ 年：.+有 \d+ 州(，世界第一大国)?$/);
    const mine = polityEntries(all, id);
    expect(mine.every((e) => e.kind !== 'reign')).toBe(true);
    const full = longDoc(civ, all, majors, { ...opt, scope: 'one', polity: id, title: alive[0].name, per: Infinity });
    expect(listed(full).length).toBe(mine.length);
    expect(d.foot).toBe(`${alive[0].name}，九州大陆，种子 7。模拟生成的架空世界，不是真实地图。`);
  });

  it('已亡的国家:写哪年亡,最后一段到亡国那年', () => {
    const f = fallen[0];
    const d = longDoc(civ, all, majors, { ...opt, scope: 'one', polity: f.id, title: f.name });
    expect(d.lead).toMatch(new RegExp(`第 ${f.to} 年亡，享国 \\d+ 年。$`));
    expect(d.sections.at(-1)!.title).toMatch(new RegExp(`${f.to} 年$`));
  });

  it('正好在某段第一年亡的国家:最后一段是亡国那年,亡国那条列在里面;上一段不再放一张和最上面一样的图', () => {
    const d0 = longDoc(civ, all, majors, { ...opt, scope: 'one', polity: alive[0].id, title: 'x' });
    const span = d0.span;
    // 挑一个跨过某段开头的国家,把它亡国的年份挪到它最后那一段的第一年
    const last = (p: (typeof civ.polities)[number]) => Math.min(p.ended ?? civ.endYear, civ.endYear - 1);
    const p0 = civ.polities.find((p) => Math.floor(last(p) / span) * span > Math.floor(p.founded) + span)!;
    const y = Math.floor(last(p0) / span) * span;
    const p = { ...p0, ended: y };
    const c = { ...civ, polities: civ.polities.map((q) => (q.id === p.id ? p : q)) };
    const fall = { ...all.find((e) => e.kind === 'fall')!, id: -1, year: y, end: y, text: '测试国亡', importance: 3 as const, polities: [p.id], children: undefined };
    const d = longDoc(c, [...all.filter((e) => e.year < y), fall], majors, { ...opt, scope: 'one', polity: p.id, title: 'x', per: Infinity });
    expect(d.lead).toMatch(new RegExp(`第 ${y} 年亡`));
    expect(d.sections.at(-1)!.title).toMatch(new RegExp(`${y} 年$`));
    expect(d.sections.at(-1)!.rows.map((r) => r.text)).toContain('测试国亡');
    const prev = d.sections.find((s) => s.title.endsWith(`${y - 1} 年`));
    if (prev) expect(prev.map).toBeNull();
  });
});

describe('AI 写的段落', () => {
  const BOOK = [
    '# 九州通史',
    '',
    '## 第一章 诸部初立(第 0—1045 年)',
    '',
    '**天下**初开,诸部各据一方。',
    '',
    '第二段不要。',
    '',
    '## 第二章 群雄并起(第 1046—1999 年)',
    '',
    '> 第 1777 年,帝翼代有桑。',
    '',
    '## 第三章 大定中兴（2000-3000）',
    '',
    '- 大定王朝收复失地。',
    '',
    '## 列传',
    '',
    '### 帝翼传',
    '',
    '列传里的不算。',
  ].join('\n');

  it('按带年份的章标题分章,取每章第一段,去掉 Markdown 记号;没写年份的(列传)不算', () => {
    const ch = bookChapters(BOOK);
    expect(ch).toEqual([
      { from: 0, to: 1045, label: '第一章', text: '天下初开,诸部各据一方。' },
      { from: 1046, to: 1999, label: '第二章', text: '第 1777 年,帝翼代有桑。' },
      { from: 2000, to: 3000, label: '第三章', text: '大定王朝收复失地。' },
    ]);
    // 没分章的短篇:整部算一章
    expect(bookChapters('# 九州通史\n\n天下初开。\n\n后来。', '第 0—3000 年')).toEqual([{ from: 0, to: 3000, label: '', text: '天下初开。' }]);
    expect(bookChapters('## 本纪·大定王朝(第 588—3000 年)\n\n大定起于凤州。')[0].label).toBe('本纪·大定王朝');
    expect(bookChapters('## 第四章 一年之变(第 1200 年)\n\n这一年。')).toEqual([{ from: 1200, to: 1200, label: '第四章', text: '这一年。' }]);
  });

  it('纪传体:篇名不带年份,按写书时的分篇对上年份;列传不放;一篇也对不上 = 整部第一段', () => {
    const secs = buildHistoryPrompts(civ, { scope: { kind: 'world' }, style: 'biography', length: 'k10' }).sections;
    const parts = secs.filter((s) => s.part !== 'lives');
    expect(parts.length).toBeGreaterThan(1);
    const text = secs.map((s, i) => `## ${partName(s)}\n\n${s.part === 'lives' ? '### 某某传\n\n某某者,凤州人也。' : `第 ${i} 篇开头。`}\n\n后文。`).join('\n\n');
    const sections: BookSection[] = secs.map((s) => ({ from: s.from, to: s.to, label: s.part ? partName(s) : undefined, skip: s.part === 'lives' }));
    expect(bookChapters(text, '第 0—3000 年', sections)).toEqual(
      parts.map((s) => ({ from: s.from, to: s.to, label: partName(s), text: `第 ${secs.indexOf(s)} 篇开头。` })),
    );
    // 篇名写走了样(没有"·"),篇数对得上:按第几篇对
    const loose = text.replace(/## (本纪|世家)·/g, '## $1 ');
    expect(bookChapters(loose, '第 0—3000 年', sections).map((c) => [c.from, c.to])).toEqual(parts.map((s) => [s.from, s.to]));
    // 短篇不分篇(先本纪、再列传):整部的第一段,列传里的不算
    expect(bookChapters('## 本纪·大定\n\n大定起于凤州。\n\n## 列传\n\n### 某某传\n\n某某者。', '第 588—3000 年', [{ from: 588, to: 3000 }])).toEqual([
      { from: 588, to: 3000, label: '', text: '大定起于凤州。' },
    ]);
    expect(bookChapters('## 列传\n\n### 某某传\n\n某某者。', '第 0—3000 年')).toEqual([]);
  });

  it('一章放在它开始的那一段;比第一段开始得早的放第一段;一段里开始了几章只放最先的', () => {
    const segs = [
      { from: 500, to: 999 },
      { from: 1000, to: 1499 },
      { from: 1500, to: 1999 },
    ];
    const ch = [
      { from: 0, to: 1045, label: '一', text: 'a' },
      { from: 1046, to: 1200, label: '二', text: 'b' },
      { from: 1201, to: 1600, label: '三', text: 'c' },
      { from: 2000, to: 3000, label: '四', text: 'd' },
    ];
    expect(placeChapters(ch, segs).map((c) => c?.label ?? null)).toEqual(['一', '二', null]);
  });

  it('太长的一段在句号处截短', () => {
    expect(excerpt('短。')).toBe('短。');
    const long = `${'甲'.repeat(80)}。${'乙'.repeat(100)}。`;
    expect(excerpt(long)).toBe(`${'甲'.repeat(80)}。`);
    expect(excerpt('丙'.repeat(200))).toBe(`${'丙'.repeat(150)}……`);
  });

  it('长图上:每段配那一章的开头,写明摘自哪一章;年份照纪年写', () => {
    const book: LongBook = { name: '《九州通史》', chapters: bookChapters(BOOK) };
    const d = longDoc(civ, all, majors, { ...opt, book });
    const withAi = d.sections.filter((s) => s.ai);
    expect(withAi.length).toBe(3);
    expect(d.sections[0].ai).toEqual({ text: '天下初开,诸部各据一方。', src: '摘自《九州通史》第一章' });
    expect(withAi[1].ai!.src).toBe('摘自《九州通史》第二章');
    const e = longDoc(civ, all, majors, { ...opt, book, era: { name: '公元', epoch: 2500 } });
    expect(e.sections.find((s) => s.ai?.src.endsWith('第二章'))!.ai!.text).toBe('公元前 723 年,帝翼代有桑。');
    // 不带 = 不给书
    expect(longDoc(civ, all, majors, opt).sections.every((s) => s.ai === null)).toBe(true);
  });
});

describe('排版、切页', () => {
  const doc = longDoc(civ, all, majors, opt);
  const lay = layoutLong(doc, measure);

  it('1080 宽;每段、每件都能切;地图按出现的先后;字不出右边', () => {
    expect(lay.w).toBe(LONG_W);
    expect(lay.maps.length).toBe(1 + doc.sections.filter((s) => s.map).length);
    expect(lay.maps[0]).toEqual(doc.head);
    for (let i = 1; i < lay.cuts.length; i++) expect(lay.cuts[i]).toBeGreaterThan(lay.cuts[i - 1]);
    for (const o of lay.ops) {
      if (o.t !== 'text') continue;
      const w = measure(o.s, o.size) + (o.spacing ?? 0) * o.s.length;
      if (o.align === 'right') expect(o.x).toBeLessThanOrEqual(LONG_W - 60 + 1);
      else expect(o.x + w).toBeLessThanOrEqual(LONG_W - 60 + 1);
    }
    const texts = lay.ops.flatMap((o) => (o.t === 'text' ? [o.s] : []));
    expect(texts).toContain('1 / ' + doc.sections.length);
    expect(texts.some((s) => /这一段还有 \d+ 件大事没列出/.test(s))).toBe(true);
  });

  it('最底下的带子:网站名和网址;关掉以后没有,架空声明还在', () => {
    const texts = (l: typeof lay) => l.ops.flatMap((o) => (o.t === 'text' ? [o.s] : []));
    expect(texts(lay)).toContain(BRAND_NAME);
    expect(texts(lay)).toContain(BRAND_URL);
    const off = layoutLong({ ...doc, brand: false }, measure);
    expect(texts(off)).not.toContain(BRAND_URL);
    expect(texts(off).join('')).toContain('模拟生成的架空世界，不是真实地图。');
    expect(lay.h - off.h).toBe(56 + 116 - 64);
  });

  it('AI 段落:开头一个"AI 写"小标签,第一行让出位置', () => {
    const book: LongBook = { name: '《九州通史》', chapters: [{ from: 0, to: 3000, label: '第一章', text: '天'.repeat(60) }] };
    const l = layoutLong(longDoc(civ, all, majors, { ...opt, book }), measure);
    const i = l.ops.findIndex((o) => o.t === 'text' && o.s === 'AI 写');
    expect(i).toBeGreaterThan(0);
    const lines = l.ops.filter((o): o is Extract<typeof o, { t: 'text' }> => o.t === 'text' && /^天+$/.test(o.s));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].x).toBeGreaterThan(lines[1].x);
    expect(l.ops.some((o) => o.t === 'text' && o.s === '摘自《九州通史》第一章')).toBe(true);
  });

  it('切成 3:4:每页放得下,首尾相接,切在能切的地方;不把段标题和它的图分开', () => {
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

  it('每段大事选"全部"又太长时去掉轻的,那一段末尾说一句还有几件', () => {
    const d = longDoc(civ, all, majors, { ...opt, per: Infinity });
    const full = layoutLong(d, measure);
    const cap = Math.round(full.h * 0.8);
    const short = layoutLong(d, measure, cap);
    expect(short.h).toBeLessThanOrEqual(cap);
    expect(short.dropped).toBeGreaterThan(0);
    const notes = short.ops.filter((o) => o.t === 'text' && /这一段还有 \d+ 件大事没列出/.test(o.s));
    expect(notes.length).toBeGreaterThan(0);
  });

  it('文件名', () => {
    expect(longFileName('文明与地图-九州大陆')).toBe('文明与地图-九州大陆-故事长图.jpg');
    expect(longFileName('文明与地图-九州大陆', 3)).toBe('文明与地图-九州大陆-故事长图-3.jpg');
  });
});
