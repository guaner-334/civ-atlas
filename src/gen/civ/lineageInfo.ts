/**
 * 世系图要用的:谁是谁的父亲、子嗣,一国有几朝,一朝的家谱树怎么排、标题和结尾怎么写、复制成文字。
 * 只读推演记下的 Person.parent(lineage.ts),纯计算;人物页的世系图(PeopleLineage.tsx)、人物卡片的「父亲」「子嗣」用它。
 *
 * 一朝一棵树:这一朝即位的君主 + 推演补上的没即位的宗室(role = 'prince',dynasty 同一朝)。
 * 树的排法:一代一行;兄弟按长幼从左往右;父亲在传下去的那一支(子孙里有最后即位的君主)正上方,所以主干是一条直线往下;
 * 子树之间按每一代的左右边缘挤紧(位置以"一格"为单位,一格 = 一个方框宽加间距)。
 * 找不到合年纪的父亲、兜底成"宗室"的君主连不上这一朝开国的那一支:另起一小棵(远支)。
 * 争位不成、据地自立做了别国之君的儿子(Person.claim.how = secede)也挂在父亲下面(只他一个,他的子孙在他自己那一国的树里),不算这一朝的君主。
 * 复国之君(接上故国世系,lineage.ts)两头都画:故国那一朝的树里,他挂在补的宗室(或末帝的儿子、末帝)下面,照据地自立的画法;
 * 他自己那一国第一朝的树,树根是他在故国的父辈,再往上几代(到故国的一位君主为止)画在树顶上(LineageTree.up),衬故国的颜色。
 */
import type { Civ, Person, Year } from './types';
import { polityName } from './growth';
import { peopleIndex, riseText } from './peopleInfo';
import { personName, rulerShort } from './peopleText';
import { heOrShe, kinWord, spouseWord } from './gender';
import { heldOver, polityShort } from './regentInfo';
import { cnNumber } from './chronicle';
import { yearAt, yearShort, yearSpanAt, type Era } from '../era';

interface LineageIndex {
  /** 人物编号 → 子嗣(按出生先后) */
  kids: Map<number, Person[]>;
  /** 国家 → 没即位的宗室 */
  princes: Person[][];
  /** 国家 → 据地自立、做了别国之君的儿子(按父亲那一国) */
  seceders: Person[][];
  /** 国家 → 复这一国的复国之君(父辈在这一国:接上故国世系) */
  restorers: Person[][];
}

const cache = new WeakMap<object, LineageIndex>();

function lineageIndex(civ: Civ): LineageIndex {
  const key = civ.people ?? civ.annals;
  const hit = cache.get(key);
  if (hit && hit.princes.length === civ.polities.length) return hit;
  const ix: LineageIndex = { kids: new Map(), princes: civ.polities.map(() => []), seceders: civ.polities.map(() => []), restorers: civ.polities.map(() => []) };
  for (const x of civ.people ?? []) {
    if (x.role === 'prince' && ix.princes[x.polity]) ix.princes[x.polity].push(x);
    if (x.parent === undefined) continue;
    const f = civ.people![x.parent];
    if (f && f.polity !== x.polity && x.claim?.how === 'secede') ix.seceders[f.polity]?.push(x);
    if (f && f.polity !== x.polity && x.rise === 'restore') ix.restorers[f.polity]?.push(x);
    if (!ix.kids.has(x.parent)) ix.kids.set(x.parent, []);
    ix.kids.get(x.parent)!.push(x);
  }
  for (const ks of ix.kids.values()) ks.sort((a, b) => a.born - b.born || a.id - b.id);
  cache.set(key, ix);
  return ix;
}

/** 父亲(没记 = undefined:一朝的第一位、共和国执政官、将领、兜底成宗室的君主) */
export function fatherOf(civ: Civ, x: Person): Person | undefined {
  return x.parent !== undefined ? civ.people?.[x.parent] : undefined;
}

/** 子嗣(按出生先后;只有世系图里有的人:即位的君主和他们没即位的父辈) */
export function kidsOf(civ: Civ, x: Person): Person[] {
  return lineageIndex(civ).kids.get(x.id) ?? [];
}

/** 这国有没有世系图:不是共和国、有君主 */
export function hasLineage(civ: Civ, polity: number): boolean {
  const p = civ.polities[polity];
  return !!p && p.lineage !== 'republic' && (peopleIndex(civ).rulers[polity]?.length ?? 0) > 0;
}

/** 一国的一朝(只列有君主的) */
export interface DynastyRow {
  /** Polity.dynasties 的下标(= Person.dynasty) */
  index: number;
  /** 朝名("景";没改朝换代过的国家 = 国名) */
  name: string;
  from: Year;
  /** 到哪年(下一朝开始、亡国);还在 = undefined */
  to?: Year;
  /** 这一朝的君主(即位先后) */
  rulers: Person[];
}

/** 一国的各朝,先后排 */
export function dynastyRows(civ: Civ, polity: number): DynastyRow[] {
  const p = civ.polities[polity];
  if (!p) return [];
  const ds = p.dynasties ?? [];
  const by = new Map<number, Person[]>();
  for (const r of peopleIndex(civ).rulers[polity] ?? []) {
    const d = r.dynasty ?? 0;
    if (!by.has(d)) by.set(d, []);
    by.get(d)!.push(r);
  }
  const pname = polityName(p, Math.min(civ.endYear, p.ended ?? civ.endYear) - 1 / 512);
  return [...by]
    .sort((a, b) => a[0] - b[0])
    .map(([d, rulers]) => {
      const from = d === 0 ? p.founded : (ds[d]?.year ?? rulers[0].from ?? p.founded);
      return { index: d, name: (by.size > 1 && ds[d]?.name) || pname, from, to: ds[d + 1]?.year ?? p.ended, rulers };
    });
}

/** year 那一年的那一朝(rows 的下标):还没立国 = 第一朝;已经亡了 = 最后一朝 */
export function dynastyRowAt(rows: readonly DynastyRow[], year: Year): number {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].from <= year) return i;
  return 0;
}

/** 这一朝第几位君主(1 起;不是这一朝的君主 = 0) */
export function reignOrder(row: DynastyRow, x: Person): number {
  return row.rulers.indexOf(x) + 1;
}

/**
 * 树的标题后半句:"2377–2794 年，27 位君主；太祖柳渺玄起兵代衍朝开国"(开国那句:起兵代某朝开国 / 立国 / 篡位 /
 * 叛某国自立 / 复某国之国 / 起兵建立新朝;继位来的不写)
 */
export function dynastyNote(civ: Civ, rows: readonly DynastyRow[], i: number, era?: Era): string {
  const row = rows[i];
  const span = row.to !== undefined ? yearSpanAt(row.from, row.to, era) : `${yearAt(row.from, era)}起`;
  const first = row.rulers[0];
  const p = civ.polities[first.polity];
  let rise = '';
  if (first.rise === 'rise' && p?.eastern && rows[i - 1]) rise = `起兵代${rows[i - 1].name}朝开国`;
  else if (first.rise && first.rise !== 'heir') rise = riseText(civ, first).replace('，', '');
  return `${span}，${row.rulers.length} 位君主${rise ? `；${personName(civ, first)}${rise}` : ''}`;
}

/** 最后一位下面那句这一朝怎么结束:"2794 年，渊朝起兵代之""2884 年，提贝亚国亡";还在 = 空串 */
export function dynastyEnd(civ: Civ, rows: readonly DynastyRow[], i: number, era?: Era): string {
  const row = rows[i];
  if (!row || row.to === undefined) return '';
  const p = civ.polities[row.rulers[0].polity];
  const y = yearAt(row.to, era);
  const next = rows[i + 1];
  if (!next) return `${y}，${polityName(p, row.to - 1 / 512)}亡`;
  const nu = next.rulers[0];
  if (nu.rise === 'usurp') return `${y}，${rulerShort(civ, nu)}篡位`;
  if (p.eastern) return `${y}，${next.name}朝起兵代之`;
  return `${y}，${p.lineage === 'khanate' ? '汗位易主' : '王室更迭'}，${next.name}兴`;
}

/**
 * 一朝树里的人:这一朝的君主 + 同一朝补上的宗室 + 据地自立的儿子(父亲是这一朝的君主)+ 复这一国的复国之君(父辈是这一朝的人);
 * 复国的这一国第一朝再加上树根:复国之君(和接到同一位父辈下面的兄弟子侄)在故国的父辈
 */
export function dynastyMembers(civ: Civ, row: DynastyRow): Person[] {
  const polity = row.rulers[0]?.polity ?? -1;
  const ix = lineageIndex(civ);
  const princes = ix.princes[polity] ?? [];
  const sec = (ix.seceders[polity] ?? []).filter((x) => row.rulers.includes(civ.people![x.parent!]));
  const res = (ix.restorers[polity] ?? []).filter((x) => (civ.people![x.parent!].dynasty ?? 0) === row.index);
  const own = [...row.rulers, ...princes.filter((x) => (x.dynasty ?? 0) === row.index), ...sec, ...res];
  const fallen = row.index === 0 ? civ.polities[polity]?.restores : undefined;
  if (fallen === undefined) return own;
  const roots = new Set<Person>();
  for (const x of own) {
    const f = fatherOf(civ, x);
    if (f && f.polity === fallen && x.polity === polity) roots.add(f);
  }
  return [...own, ...roots];
}

/** 父亲那一国的世系图里,他是不是据地自立、做了别国之君的儿子 */
export function secededFrom(civ: Civ, x: Person, polity: number): boolean {
  return x.polity !== polity && x.claim?.how === 'secede';
}

/** 故国的世系图里,他是不是复了这一国的复国之君 */
export function restoredFrom(civ: Civ, x: Person, polity: number): boolean {
  return x.polity !== polity && x.rise === 'restore';
}

/** 复国之君那一国的世系图里,他是不是故国的人(树顶上衬故国颜色的那几代) */
export function fromFallen(civ: Civ, x: Person, polity: number): boolean {
  return x.polity !== polity && civ.polities[polity]?.restores === x.polity;
}

/** 几代孙:2 孙子、3 曾孙、4 玄孙、再往下"五世孙""十二世孙"(女的:孙女、曾孙女……);1 = 子 / 女 */
export function descentWord(x: Pick<Person, 'female'>, gen: number): string {
  if (gen === 2) return x.female ? '孙女' : '孙子';
  const w = gen <= 1 ? '子' : gen === 3 ? '曾孙' : gen === 4 ? '玄孙' : `${cnNumber(gen)}世孙`;
  if (!x.female) return w;
  return gen <= 1 ? '女' : `${w}女`;
}

/** 复国之君出自故国哪位君主、是他的第几代孙(没有 = null) */
export function descentOf(civ: Civ, x: Person): { from: Person; gen: number } | null {
  const d = x.descent;
  const from = d ? civ.people?.[d.from] : undefined;
  return d && from ? { from, gen: d.gen } : null;
}

/** 这位君主是不是他那一国的末代(最后一位即位的;还在的国家也算它目前最后一位) */
export function isLastRuler(civ: Civ, x: Person): boolean {
  const rs = peopleIndex(civ).rulers[x.polity] ?? [];
  return x.role === 'ruler' && rs[rs.length - 1] === x;
}

/**
 * 世系图里名字后面的小灰字:没即位的宗室写结局(战死、争储被杀;摄政时被亲政的幼主诛杀的写"伏诛"),没有就写"养子";
 * 据地自立做了别国之君的儿子(在父亲那一国的图里)写"自立"。
 * 再接上掌实权的(regentInfo.ts):掌过实权的(一直没即位,或即位以前)"掌权",在位时被架空过的君主(儿子引兵入朝、大臣大将专权;
 * 幼主有人辅政、太子监国不算)"虚位";几样都有用"、"连着。别的不写 = ''
 */
export function lineageTag(civ: Civ, x: Person, polity: number): string {
  if (secededFrom(civ, x, polity)) return '自立';
  const tags: string[] = [];
  if (x.role === 'prince' && x.fate === 'battle') tags.push('战死');
  else if (x.role === 'prince' && x.fate === 'purged') tags.push(x.regencies?.some((g) => g.end === 'purged') ? '伏诛' : '争储被杀');
  else if (x.adopted) tags.push(kinWord(x, '养子'));
  if (x.regencies?.length) tags.push('掌权');
  if (x.role === 'ruler' && heldOver(civ, x).some((h) => VOID_KINDS.has(h.g.kind))) tags.push('虚位');
  return tags.join('、');
}

/** 算"虚位"的几种:被儿子引兵入朝架空、被大臣大将专权(幼主有人辅政、太子监国不算) */
const VOID_KINDS: ReadonlySet<string> = new Set(['march', 'chancellor', 'general']);

/** 世系图第二行的小标:娶了别国宗室女 "妻大澜"、母亲是别国宗室女 "母大澜"(只写一样,妻子优先;polity = 那一国,画它的颜色);没有 = null */
export function lineageKin(civ: Civ, x: Person): { text: string; polity: number } | null {
  const s = x.spouses?.[0];
  if (s) return { text: `${spouseWord(x)}${polityShort(civ, s.polity, s.year)}`, polity: s.polity };
  const m = x.mother;
  if (m) return { text: `母${polityShort(civ, m.polity, m.year)}`, polity: m.polity };
  return null;
}

/** 排好的一个人:x = 第几格(可以是负的、整数),depth = 第几代(0 = 树根) */
export interface PlacedPerson {
  p: Person;
  x: number;
  depth: number;
}

/**
 * 一朝的一棵树;distant = 连不上开国那一支的远支。
 * up = 复国之君那一国第一朝的第一棵:树根是故国的人(他在故国的父辈),再往上的几代(从上往下,到故国的一位君主为止;不含树根)
 */
export interface LineageTree {
  nodes: PlacedPerson[];
  distant: boolean;
  up?: Person[];
}

/**
 * 一棵树上面写的那一行:第一棵(开国那一支)不写 = '';作者立的君主(让作者的人物即位,连不上谁,单独一棵)= "作者立的君主";
 * 紧跟在他那一棵后面、里面有接他位的那位 = "继他之位";别的远支 = "宗室远支"
 */
export function treeLabel(row: DynastyRow, trees: readonly LineageTree[], i: number): string {
  const t = trees[i];
  if (!t?.distant) return '';
  if (t.nodes.some((n) => n.p.author !== undefined)) return '作者立的君主';
  const a = trees[i - 1]?.nodes.find((n) => n.p.author !== undefined)?.p;
  const k = a ? row.rulers.indexOf(a) : -1;
  const next = k >= 0 ? row.rulers[k + 1] : undefined;
  return next && t.nodes.some((n) => n.p === next) ? `继${heOrShe(a)}之位` : '宗室远支';
}

/** 一朝排成几棵树:第一棵是开国那一支,远支按即位先后跟在后面 */
export function layoutDynasty(civ: Civ, row: DynastyRow): LineageTree[] {
  const members = dynastyMembers(civ, row);
  const inTree = new Set(members);
  const kids = (n: Person) => kidsOf(civ, n).filter((k) => inTree.has(k));
  // 这一朝的君主(据地自立做了别国之君的不算)
  const polity = row.rulers[0]?.polity ?? -1;
  const reigned = (n: Person) => n.role === 'ruler' && n.polity === polity;
  // 这一支里最后即位的那年:父亲放在这个值最大的儿子正上方
  const last = new Map<Person, number>();
  const lastReign = (n: Person): number => {
    let v = last.get(n);
    if (v === undefined) {
      v = Math.max(reigned(n) ? (n.from ?? n.born) : -Infinity, ...kids(n).map(lastReign));
      last.set(n, v);
    }
    return v;
  };
  // 每棵子树:每一代最左、最右占到第几格(相对子树的根),各人的位置
  const lay = (n: Person): { lc: number[]; rc: number[]; pos: [Person, number, number][] } => {
    const ks = kids(n);
    if (!ks.length) return { lc: [0], rc: [0], pos: [[n, 0, 0]] };
    const subs = ks.map(lay);
    const offs = [0];
    const L = subs[0].lc.slice();
    const R = subs[0].rc.slice();
    for (let i = 1; i < subs.length; i++) {
      const s = subs[i];
      let shift = -Infinity;
      for (let d = 0; d < Math.min(R.length, s.lc.length); d++) shift = Math.max(shift, R[d] - s.lc[d] + 1);
      offs[i] = shift;
      for (let d = 0; d < s.rc.length; d++) {
        R[d] = s.rc[d] + shift;
        if (d >= L.length) L[d] = s.lc[d] + shift;
      }
    }
    let main = 0;
    ks.forEach((k, i) => lastReign(k) > lastReign(ks[main]) && (main = i));
    const mid = offs[main];
    const pos: [Person, number, number][] = [[n, 0, 0]];
    subs.forEach((s, i) => s.pos.forEach(([k, x, d]) => pos.push([k, x + offs[i] - mid, d + 1])));
    return { lc: [0, ...L.map((x) => x - mid)], rc: [0, ...R.map((x) => x - mid)], pos };
  };
  const roots = members.filter((x) => x.parent === undefined || !inTree.has(civ.people![x.parent]));
  const first = row.rulers[0];
  const rootOf = (x: Person): Person => {
    let r = x;
    for (let f = fatherOf(civ, r); f && inTree.has(f); f = fatherOf(civ, r)) r = f;
    return r;
  };
  const top = first ? rootOf(first) : roots[0];
  // 远支:按这一支第一位即位的先后
  const firstReign = (n: Person): number => Math.min(reigned(n) ? (n.from ?? n.born) : Infinity, ...kids(n).map(firstReign));
  const rest = roots.filter((r) => r !== top).sort((a, b) => firstReign(a) - firstReign(b));
  return [top, ...rest]
    .filter((r): r is Person => !!r)
    .map((r) => {
      const t: LineageTree = { nodes: lay(r).pos.map(([p, x, depth]) => ({ p, x, depth })), distant: r !== top };
      if (r === top && fromFallen(civ, r, polity)) t.up = upLine(civ, r);
      return t;
    });
}

/** 树根(故国的人)往上几代,从上往下:到故国的一位君主为止(他自己是君主就不往上) */
function upLine(civ: Civ, root: Person): Person[] {
  const out: Person[] = [];
  for (let x = root; x.role !== 'ruler'; ) {
    const f = fatherOf(civ, x);
    if (!f || f.polity !== root.polity || out.includes(f)) break;
    out.unshift(f);
    x = f;
  }
  return out;
}

/** 树顶故国那一块左上角写的:"故国大嘉王室";国名本来带"国"字的不重复:"故滦国王室" */
export function fallenLabel(civ: Civ, polity: number): string {
  const p = civ.polities[polity];
  if (!p) return '';
  const name = polityShort(civ, polity, (p.ended ?? civ.endYear) - 1 / 512);
  return name.endsWith('国') ? `故${name}王室` : `故国${name}王室`;
}

/** 复国之君那条连线旁写的:他自己那一国的树 "2527 年复国";故国的树 "2527 年复国，立后嘉" */
export function restoreCaption(civ: Civ, x: Person, inFallen: boolean, era?: Era): string {
  const at = x.from ?? x.born;
  return `${yearAt(at, era)}复国${inFallen ? `，立${polityShort(civ, x.polity, at)}` : ''}`;
}

/**
 * 一国的家谱写成缩进的文字(人物页世系图的"复制全文"):一朝一段,标题行、一人一行(下一代多缩两格)、结尾那句。
 * "  3 懿宗柳离琅 2394–2421 年在位" / "  柳曜玄 未即位 2428–2467"
 */
export function lineageText(civ: Civ, polity: number, era?: Era): string {
  const rows = dynastyRows(civ, polity);
  const out: string[] = [];
  rows.forEach((_, i) => out.push(...dynastyLines(civ, polity, rows, i, era), ''));
  return out.join('\n').trim();
}

/** 一朝的那一段(lineageText 的一段;AI 写家传的材料也用它):标题行、一人一行(下一代多缩两格)、结尾那句 */
export function dynastyLines(civ: Civ, polity: number, rows: readonly DynastyRow[], i: number, era?: Era): string[] {
  const row = rows[i];
  if (!row) return [];
  const out: string[] = [`${row.name}(${dynastyNote(civ, rows, i, era)})`];
  const trees = layoutDynasty(civ, row);
  trees.forEach((t, ti) => {
    const label = treeLabel(row, trees, ti);
    if (label) out.push(label);
    const inTree = new Set(t.nodes.map((n) => n.p));
    const walk = (x: Person, depth: number) => {
      const pad = '  '.repeat(depth);
      const k = reignOrder(row, x);
      const from = x.from ?? x.born;
      const reign = `${!era ? `${Math.floor(from)}–${x.until !== undefined ? Math.floor(x.until) : ''} 年` : x.until !== undefined ? yearSpanAt(from, x.until, era) : `${yearAt(from, era)}起`}在位`;
      if (k) out.push(`${pad}${k} ${personName(civ, x)} ${reign}`);
      else if (secededFrom(civ, x, polity)) out.push(`${pad}${personName(civ, x)} 自立为${polityName(civ.polities[x.polity], from)}之君 ${reign}`);
      else if (restoredFrom(civ, x, polity)) out.push(`${pad}${personName(civ, x)} ${restoreCaption(civ, x, true, era)}，${reign}`);
      else {
        const tag = lineageTag(civ, x, polity);
        out.push(`${pad}${personName(civ, x)} 未即位${tag ? `(${tag})` : ''} ${yearShort(x.born, era)}–${x.died !== undefined ? yearShort(x.died, era) : ''}`);
      }
      for (const c of kidsOf(civ, x)) if (inTree.has(c)) walk(c, depth + 1);
    };
    const root = t.nodes.find((n) => n.depth === 0);
    if (root && fromFallen(civ, root.p, polity)) {
      // 树顶故国那几代写成一行,再从复国之君(和他的兄弟子侄)往下
      const line = [...(t.up ?? []), root.p].map((x) => {
        const span = x.role === 'ruler' ? `${isLastRuler(civ, x) ? '末帝，' : ''}${yearShort(x.from ?? x.born, era)}–${x.until !== undefined ? yearShort(x.until, era) : ''} 在位` : `${yearShort(x.born, era)}–${x.died !== undefined ? yearShort(x.died, era) : ''}`;
        return `${personName(civ, x)}(${span})`;
      });
      out.push(`${fallenLabel(civ, root.p.polity)}：${line.join(' — ')}`);
      for (const c of kidsOf(civ, root.p)) if (inTree.has(c)) walk(c, 0);
    } else if (root) walk(root.p, 0);
  });
  const end = dynastyEnd(civ, rows, i, era);
  if (end) out.push(end);
  return out;
}
