/**
 * 故事长图的内容(纯计算,不碰 DOM):这个世界(或一国)按时代一段一段讲下来。
 *
 *   开头 —— 标题、一句话(一国:国旗、立国那一句、到最后有多少州、历代国号)、最后一年的地图
 *   每段 —— 分几段、每段挑哪几件大事、配哪一年的地图由 storyStrip.ts 定(段数有上限,推得再久也不会太长):
 *           段标题和"第几段 / 共几段"、这一段最后一年的地图(最后一段的疆域就是开头那张,不再放图)、
 *           一句"几国并立,谁最大"(一国:这一国当时多少州)、世界写过 AI 史书时那一章开头的一段(标"AI 写")、
 *           挑出的几件大事;没列出的写一句还有几件
 *   结尾 —— 标题、种子、"模拟生成的架空世界";最底下一条网站名和网址(能关)
 *
 * 一国版:地图裁到这一国、描红边;大事只列和这一国有关的(不列每一次君主继位)。
 * 设了纪年(gen/era.ts)的世界,年份和大事正文、AI 写的段落里的"第 N 年"都照纪年写。
 * 排版、画法在 render/longImage.ts,地图由 longRun.ts 按这里给的年份拍。同一个世界、同样的选项永远得到同样的内容。
 */
import type { Civ, Polity } from '../gen/civ/types';
import type { ChronicleEntry } from '../gen/civ/story/chronicle';
import { eraText, yearFull, yearSpanAt, type Era } from '../gen/era';
import { cnPunct } from './filmPlan';
import { polityNameAt, polityUsedNames } from './searchIndex';
import { polityEntries, polityLastYear, regionCounts, storyStrip, type StripPlan } from './storyStrip';
import { entryWeight, evType, type EvType } from './timelineLayout';

export { polityEntries, polityLastYear, regionCounts };

export type LongScope = 'world' | 'one';

/** 世界写过的 AI 史书:书名(带书名号)和各章(有年份的) */
export interface LongBook {
  /** "《九州通史》" */
  name: string;
  chapters: BookChapter[];
}

export interface BookChapter {
  /** 这一章从哪年到哪年(原始年份,没套纪年) */
  from: number;
  to: number;
  /** "第三章""卷二""本纪·大定王朝";没分章的书 = '' */
  label: string;
  /** 这一章开头的一段(去掉了 Markdown 记号) */
  text: string;
}

/** 写这部史书时分的章 / 篇(纪传体的篇名不带年份,靠它对上年份) */
export interface BookSection {
  from: number;
  to: number;
  /** 纪传体的篇名:"本纪·大定" / "世家·萨布斯坦王国" / "列传";按时间分章的没有 */
  label?: string;
  /** 列传:写人的,不按年份放进长图 */
  skip?: boolean;
}

export interface LongOptions {
  scope: LongScope;
  /** 一国版:哪一国 */
  polity: number;
  /** 最多几段 */
  segments: number;
  /** 每段挑几件大事(Infinity = 全部) */
  per: number;
  /** 地图:每段一张 / 只要开头一张 */
  maps: 'each' | 'first';
  /** 最底下带不带网站名和网址 */
  brand: boolean;
  /** 带上 AI 写的段落(没写过史书 / 选了不带 = 不给) */
  book?: LongBook | null;
  /** 标题(大字) */
  title: string;
  /** 世界名(一国版结尾写;没起名 = '') */
  worldTitle: string;
  seed: number;
  /** 纪年(没设 = 按第几年写) */
  era?: Era;
}

/** 一张地图:拍哪一年;一国版裁到这一国、描红边 */
export interface LongMap {
  year: number;
  polity?: number;
}

export interface LongRow {
  /** "第 1199 年""第 2478—2514 年";说明行 = '' */
  label: string;
  /** 小圆点的颜色(和时间轴上一样);说明行 = null(灰点) */
  type: EvType | null;
  text: string;
  /** 说明行(灰字,没有年份) */
  note?: boolean;
  /** 放不下时先去掉轻的(timelineLayout 的 entryWeight) */
  weight: number;
}

export interface LongSection {
  /** "第 500—999 年" */
  title: string;
  /** 右上角"1 / 6" */
  no: string;
  map: LongMap | null;
  cap: string;
  /** AI 写的段落和出处("摘自《九州通史》第三章") */
  ai: { text: string; src: string } | null;
  rows: LongRow[];
  /** 这一段还有几件大事没列出 */
  more: number;
}

export interface LongDoc {
  title: string;
  /** 一国版的国旗(那一国最后一年的那一面) */
  flag: { polity: number; year: number } | null;
  lead: string;
  /** 一国版:历代国号 */
  lead2: string | null;
  head: LongMap;
  headCap: string;
  /** 一段多少年 */
  span: number;
  sections: LongSection[];
  /** 结尾那句:标题、种子、架空声明 */
  foot: string;
  /** 最底下一条网站名和网址 */
  brand: boolean;
}

/** 州数从多到少(一样多按编号) */
function ranked(n: Map<number, number>): [number, number][] {
  return [...n].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
}

export interface LongPolityItem {
  id: number;
  name: string;
  /** 现存:州数;已亡:起止年份 */
  regions: number;
  from: number;
  to: number;
}

/** 选哪一国的菜单:现存的按州数排,已亡的按立国先后排 */
export function longPolities(civ: Civ): { alive: LongPolityItem[]; fallen: LongPolityItem[] } {
  const end = civ.endYear;
  const n = regionCounts(civ, end);
  const alive: LongPolityItem[] = [];
  const fallen: LongPolityItem[] = [];
  for (const p of civ.polities) {
    if (!(p.founded <= end)) continue;
    const r = n.get(p.id) ?? 0;
    const item = { id: p.id, name: polityNameAt(p, polityLastYear(civ, p)), regions: r, from: Math.floor(p.founded), to: Math.floor(p.ended ?? end) };
    (r > 0 ? alive : fallen).push(item);
  }
  alive.sort((a, b) => b.regions - a.regions || a.id - b.id);
  fallen.sort((a, b) => a.from - b.from || a.id - b.id);
  return { alive, fallen };
}

/** 一国版默认哪一国:地图上选中的;没选 = 最后一年最大的 */
export function defaultPolity(civ: Civ, selected: number | null): number | null {
  if (selected !== null && selected >= 0 && selected < civ.polities.length) return selected;
  const { alive, fallen } = longPolities(civ);
  return alive[0]?.id ?? fallen[0]?.id ?? null;
}

/** 起止:"第 500—999 年";纪年 "公元前 2000—前 1501 年";同一年 = "第 500 年" */
function spanText(a: number, b: number, era?: Era): string {
  const x = Math.floor(a);
  const z = Math.floor(b);
  if (z <= x) return yearFull(x, era);
  return era ? yearSpanAt(x, z, era, '—') : `第 ${x}—${z} 年`;
}

function rowOf(e: ChronicleEntry, era?: Era): LongRow {
  return { label: spanText(e.year, e.end, era), type: evType(e), text: cnPunct(eraText(e.text, era)), weight: entryWeight(e) };
}

const FOOT_NOTE = '模拟生成的架空世界，不是真实地图。';
const BEFORE_NOTE = '此前各民族从发源地向外扩散，还没有国家';

// ---------------------------------------------------------------------------
// AI 写的段落

/** 章标题末尾的年份:"(第 0—1045 年)""（1045-1536）""(第 1200 年)" */
const CH_YEARS = /\s*[(（]\s*(?:第\s*)?(\d+)\s*(?:年)?\s*(?:[—–\-~至到]+\s*(?:第\s*)?(\d+)\s*年?\s*)?[)）]\s*$/;
/** 列传:写人的,不按年份放进长图 */
const CH_LIVES = /^列传/;
const CH_NUM = /^(第[一二三四五六七八九十百零〇两\d]+[章卷篇回]|卷[一二三四五六七八九十百零〇\d]+)/;
const CH_PART = /^(本纪|世家)\s*[·・:：]\s*(.+)$/;

function chapterLabel(head: string): string {
  const n = CH_NUM.exec(head);
  if (n) return n[1];
  const p = CH_PART.exec(head);
  if (p) return `${p[1]}·${p[2].trim()}`;
  return head;
}

/**
 * 史书正文(Markdown)分成章,取每章标题下面的第一段:
 * - "## 第三章 群雄并起(第 1500—1999 年)"这样标题带年份的,年份照标题;
 * - 不带年份的(纪传体的"## 本纪·大定")按写书时的分章 sections 对上年份:先按篇名对,对不上而标题和分章一样多时按第几个对;
 * - 列传写的是人,不放;
 * - 一章也没对上(短篇不分章、标题都没年份)= 整部书第一段(列传里的不算)算一章,年份按 range("第 0—3000 年")
 */
export function bookChapters(text: string, range = '', sections: readonly BookSection[] = []): BookChapter[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const heads = lines.filter((l) => /^##(?!#)/.test(l)).length;
  const out: BookChapter[] = [];
  let cur: BookChapter | null = null;
  let lives = false;
  let k = -1;
  let first = '';
  for (const line of lines) {
    const h = /^(#{1,6})\s*(.*)$/.exec(line);
    if (h) {
      if (h[1].length > 2) continue;
      if (h[1].length === 2) k++;
      const body = h[2].replace(/\*\*/g, '').trim();
      const ym = CH_YEARS.exec(body);
      const label = chapterLabel((ym ? body.slice(0, ym.index) : body).trim());
      if (h[1].length === 1 && !ym) continue; // 书名
      const sec = sections.find((s) => s.label !== undefined && s.label === label) ?? (heads === sections.length ? sections[k] : undefined);
      lives = CH_LIVES.test(label) || !!sec?.skip;
      cur = null;
      if (lives) continue;
      const from = ym ? Number(ym[1]) : sec?.from;
      const to = ym ? Number(ym[2] ?? ym[1]) : sec?.to;
      if (from !== undefined && to !== undefined && to >= from) out.push((cur = { from, to, label, text: '' }));
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) continue;
    const para = line
      .replace(/^>\s?/, '')
      .replace(/^[-*·]\s+/, '')
      .replace(/\*\*/g, '')
      .trim();
    if (!para || lives) continue;
    if (!first) first = para;
    if (cur && !cur.text) cur.text = para;
  }
  const ok = out.filter((c) => c.text);
  if (ok.length || !first) return ok;
  const m = /(\d+)(?:\D+(\d+))?/.exec(range);
  return m ? [{ from: Number(m[1]), to: Number(m[2] ?? m[1]), label: '', text: first }] : [];
}

/** 一段太长就截短:在 max 个字以内最后一个句号处断开;没有句号就截断加"……" */
export function excerpt(s: string, max = 150): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  const head = chars.slice(0, max).join('');
  const cut = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'));
  if (cut >= head.length * 0.4) return head.slice(0, cut + 1);
  return `${head.replace(/[，、；：,;:\s]+$/, '')}……`;
}

/**
 * 每段配哪一章:一章放在它开始的那一段(开始得比第一段还早、又和第一段有交集的,放第一段);
 * 一段里开始了几章,只放最先写的那一章
 */
export function placeChapters(chapters: readonly BookChapter[], segs: readonly { from: number; to: number }[]): (BookChapter | null)[] {
  const out: (BookChapter | null)[] = segs.map(() => null);
  if (!segs.length) return out;
  const lo = segs[0].from;
  const hi = segs[segs.length - 1].to;
  for (const c of chapters) {
    if (c.to < lo || c.from > hi) continue;
    const y = Math.max(c.from, lo);
    const i = segs.findIndex((s) => y >= s.from && y <= s.to);
    if (i >= 0 && !out[i]) out[i] = c;
  }
  return out;
}

function aiOf(book: LongBook | null | undefined, plan: StripPlan, era?: Era): (LongSection['ai'] | null)[] {
  if (!book) return plan.segments.map(() => null);
  return placeChapters(book.chapters, plan.segments).map((c) =>
    c ? { text: excerpt(eraText(c.text, era)), src: `摘自${book.name}${c.label}` } : null,
  );
}

// ---------------------------------------------------------------------------

/**
 * 长图的内容。all = 全部纪事(编年史"全部",一国版从里面挑),majors = 编年史"大事"(整个世界挑这些)。
 * 一国版的 polity 不存在(换了世界)、还没立国时按整个世界出。
 */
export function longDoc(civ: Civ, all: readonly ChronicleEntry[], majors: readonly ChronicleEntry[], opt: LongOptions): LongDoc {
  const p = opt.scope === 'one' ? civ.polities[opt.polity] : undefined;
  const plan = storyStrip(civ, all, majors, { polity: p?.id ?? null, maxSegments: opt.segments, perSegment: opt.per });
  return plan.polity !== null ? polityDoc(civ, all, plan, civ.polities[plan.polity], opt) : worldDoc(civ, plan, opt);
}

function sectionsOf(plan: StripPlan, opt: LongOptions, cap: (to: number, mapYear: number) => string, headText: string, note: (i: number) => boolean, polity?: number): LongSection[] {
  const n = plan.segments.length;
  const ai = aiOf(opt.book, plan, opt.era);
  return plan.segments.map((seg, i) => {
    const same = seg.mapYear >= plan.headYear;
    const rows = seg.events.map((e) => rowOf(e, opt.era));
    if (note(i)) rows.unshift({ label: '', type: null, text: BEFORE_NOTE, note: true, weight: Infinity });
    return {
      title: spanText(seg.from, seg.to, opt.era),
      no: `${i + 1} / ${n}`,
      map: !same && opt.maps === 'each' ? { year: seg.mapYear, ...(polity !== undefined ? { polity } : {}) } : null,
      cap: same ? `这一段末的疆域，就是最上面那张${headText}的地图` : cap(seg.to, seg.mapYear),
      ai: ai[i],
      rows,
      more: seg.total - seg.events.length,
    };
  });
}

function worldDoc(civ: Civ, plan: StripPlan, opt: LongOptions): LongDoc {
  const end = Math.floor(civ.endYear);
  const founded = civ.polities.map((p) => p.founded).filter((y) => y <= civ.endYear);
  const first = founded.length ? Math.floor(Math.min(...founded)) : Infinity;
  const aliveEnd = regionCounts(civ, civ.endYear).size;
  const Y = (y: number) => yearFull(y, opt.era);
  const lead = founded.length
    ? `从${Y(0)}人类登场，到${Y(end)}。先后立国 ${founded.length} 个，到${Y(end)}还有 ${aliveEnd} 国。`
    : `从${Y(0)}人类登场，到${Y(end)}。这期间还没有国家兴起。`;
  const cap = (to: number, at: number) => {
    const top = ranked(regionCounts(civ, at));
    const name = (id: number) => polityNameAt(civ.polities[id], at);
    if (!top.length) return `${Y(to)}：没有国家`;
    if (top.length === 1) return `${Y(to)}：只有${name(top[0][0])}（${top[0][1]} 州）`;
    return `${Y(to)}：${top.length} 国并立，${name(top[0][0])}最大（${top[0][1]} 州）`;
  };
  return {
    title: opt.title,
    flag: null,
    lead,
    lead2: null,
    head: { year: civ.endYear },
    headCap: Y(end),
    span: plan.span,
    sections: sectionsOf(plan, opt, cap, Y(end), (i) => i === 0 && first > plan.segments[0].from),
    foot: `${opt.title}，种子 ${opt.seed}。${FOOT_NOTE}`,
    brand: opt.brand,
  };
}

function polityDoc(civ: Civ, all: readonly ChronicleEntry[], plan: StripPlan, p: Polity, opt: LongOptions): LongDoc {
  const end = Math.floor(civ.endYear);
  const f = Math.floor(p.founded);
  const lastY = polityLastYear(civ, p);
  const L = Math.floor(lastY);
  const name = polityNameAt(p, lastY);
  const Y = (y: number) => yearFull(y, opt.era);
  // 开头一句:立国那一条 + 到最后有多少州(已亡:哪年亡、享国几年)
  const found = polityEntries(all, p.id).find((e) => e.kind === 'found' && e.polities[0] === p.id);
  let lead = `${Y(f)}${found ? cnPunct(eraText(found.text, opt.era)) : '立国'}。`;
  if (p.ended === undefined || p.ended > civ.endYear) {
    const top = ranked(regionCounts(civ, civ.endYear));
    const k = top.findIndex(([id]) => id === p.id);
    const n = k >= 0 ? top[k][1] : 0;
    const rank =
      k === 0 && top.length > 1
        ? '，是世界第一大国'
        : k === 1
          ? `，仅次于${polityNameAt(civ.polities[top[0][0]], civ.endYear)}`
          : k > 1
            ? `，在 ${top.length} 国里排第 ${k + 1}`
            : '';
    lead += `到${Y(end)}有 ${n} 州${rank}。`;
  } else {
    const e = Math.floor(p.ended);
    lead += `${Y(e)}亡，享国 ${Math.max(1, e - f)} 年。`;
  }
  const used = polityUsedNames(p);
  const cap = (to: number, at: number) => {
    const top = ranked(regionCounts(civ, at));
    const k = top.findIndex(([id]) => id === p.id);
    const n = k >= 0 ? top[k][1] : 0;
    return `${Y(to)}：${polityNameAt(p, at)}有 ${n} 州${k === 0 && top.length > 1 ? '，世界第一大国' : ''}`;
  };
  const world = opt.worldTitle.trim();
  return {
    title: opt.title,
    flag: { polity: p.id, year: lastY },
    lead,
    lead2: used.length > 1 ? `国号：${used.join(' → ')}` : null,
    head: { year: lastY, polity: p.id },
    headCap: `${Y(L)}，红线以内是${name}`,
    span: plan.span,
    sections: sectionsOf(plan, opt, cap, Y(L), () => false, p.id),
    foot: `${opt.title}，${world ? `${world}，` : ''}种子 ${opt.seed}。${FOOT_NOTE}`,
    brand: opt.brand,
  };
}

/** 文件名:文明与地图-九州大陆-故事长图.jpg;切开的 -故事长图-1.jpg …… */
export function longFileName(base: string, page?: number): string {
  return `${base}-故事长图${page ? `-${page}` : ''}.jpg`;
}
