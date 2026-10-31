/**
 * 宗教卡片「更多」里的"讲讲教义":让 AI 按这一教的材料写一段教义(两三百字)。
 * 大教:拜什么、讲什么道理、守什么规矩和祭礼,再一两句怎么传开;教派:哪年在哪国从本教分出、和本教哪里不同。民间信仰没有这一项。
 * 材料只取世界里的真事实(faithMaterial,单测核对):类型、创教者、圣城、立教年份、奉为国教的国和君主、传入的国、教派、圣城易主,
 * 时间轴停在哪年就写到哪年;写好的存在本地(ai/library.ts,kind = "教义",键 = "教义:" + 信仰的稳定键),
 * 历史改写过(干预、改地形)以后标"写于历史改写前"(doctrineStamp 对不上)。
 */
import type { Civ, Faith, FaithEvent, Religion } from '../../gen/civ/types';
import { KIND_INFO, cultureLabel } from '../../gen/civ/story/display';
import { capitalAt, polityAlive, polityName } from '../../gen/civ/growth';
import { ownersAt, type Owners } from '../../gen/civ/engine/timeline';
import { faithAt, faithRoot } from '../../gen/civ/religion';
import { FORM_NOTE, faithEventText } from '../../gen/civ/story/religionText';
import { faithKey } from '../../gen/edits';
import { styleGuide } from './names';
import type { AiMessage, AiRequest } from '../types';
import type { ScanOptions } from '../realWords';
import type { WriteupJob } from '../writeup';

/** 教义的字数:要 min–max 字,说"不要超过 cap 字" */
export const DOCTRINE_CHARS = { min: 200, max: 300, cap: 350 };

/** 传播的大事列几条:多了留头 HEAD 条、尾 TAIL 条,中间写"从略" */
const HEAD = 4;
const TAIL = 6;
/** 信众多在哪几国 */
const WHERE = 5;

export interface DoctrineMaterial {
  /** 信仰编号 */
  id: number;
  /** 大教 / 教派 */
  kind: 'great' | 'sect';
  /** 界面上的教名 */
  shown: string;
  /** 材料按哪一年写的 */
  year: number;
  /** 材料(一条一行) */
  lines: string[];
  /** 历史改写检查用(见 doctrineStamp) */
  stamp: string;
}

/** 存教义的键 */
export function doctrineNoteKey(civ: Civ, id: number): string {
  return `教义:${faithKey(civ, id)}`;
}

/** 短哈希(FNV-1a,36 进制) */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** 教义的指纹(按整段历史、信仰缓存:卡片每画一次都要对一下) */
const stampCache = new WeakMap<object, Map<number, string>>();

/**
 * 教义的指纹:改名不变,历史改写 / 改地形才变 —— 本教连同它的教派:创立(分出)的年份和地方、创教者生年,
 * 宗教大事(创教、传入、立国教、分立、圣城易主)、各国奉为国教的起止,这一教每一百年在哪几州、归哪国(按国都的地块认)。
 * 地方一律按地块认,不按编号(重推以后编号会变)
 */
export function doctrineStamp(civ: Civ, id: number): string {
  const full = civ.history ?? civ;
  const rel = full.religion;
  const f = rel?.faiths[id];
  if (!rel || !f) return '';
  let m = stampCache.get(rel);
  if (!m) stampCache.set(rel, (m = new Map()));
  const hit = m.get(id);
  if (hit !== undefined) return hit;
  const S = full.settlements;
  const cityCell = (s: number | undefined) => (s !== undefined && s >= 0 ? (S[s]?.cell ?? -1) : -1);
  const capCell = (p: number | undefined) => (p !== undefined && p >= 0 && full.polities[p] ? cityCell(full.polities[p].capital) : -1);
  const r1 = (y: number | undefined) => (y === undefined ? '' : String(Math.round(y * 10) / 10));
  const ref = (x: Faith) => (x.kind === 'sect' ? `s${cityCell(x.seat)}` : `g${cityCell(x.holy)}`);
  const root = faithRoot(rel, id);
  const family = new Set(rel.faiths.filter((x) => faithRoot(rel, x.id) === root).map((x) => x.id));
  const parts: string[] = [];
  for (const x of family) {
    const y = rel.faiths[x];
    parts.push(`${ref(y)}|${r1(y.founded)}|${capCell(y.polity)}|${r1(y.founder?.born)}`);
  }
  for (const e of rel.events) if (family.has(e.faith)) parts.push(`${e.kind}${r1(e.year)}:${ref(rel.faiths[e.faith])}:${capCell(e.polity)}:${e.region}:${cityCell(e.settlement)}`);
  for (const s of rel.states) if (family.has(s.faith)) parts.push(`st:${ref(rel.faiths[s.faith])}@${capCell(s.polity)}:${r1(s.from)}-${r1(s.until)}`);
  let own: Owners | undefined;
  for (const cp of rel.checkpoints) {
    own = ownersAt(full, cp.year, own);
    const rs: string[] = [];
    for (let r = 0; r < cp.faith.length; r++) if (cp.faith[r] === id) rs.push(`${r}>${capCell(own.polity[r])}`);
    parts.push(rs.join(','));
  }
  const out = `F|${ref(f)}|${hash(parts.join(';'))}`;
  m.set(id, out);
  return out;
}

const polName = (civ: Civ, p: number | undefined, y: number) => (p !== undefined && p >= 0 && civ.polities[p] ? polityName(civ.polities[p], y) : '');

/** 圣城这一年归谁:"今属大景王朝" / "今为部落地带" / "已成故城"(和宗教卡片圣城那一行一样) */
function holyNow(civ: Civ, city: number, y: number, own: Owners): string {
  const s = civ.settlements[city];
  if (!s || y < s.founded) return '';
  if (s.ended !== undefined && y >= s.ended) return '已成故城';
  const cap = civ.polities.find((p) => polityAlive(p, y) && capitalAt(p, y) === city);
  const owner = cap ?? civ.polities[own.polity[s.region]];
  return owner ? `今属${polityName(owner, y)}` : '今为部落地带';
}

/** 一串大事:多了留头尾,中间写从略 */
function clip(lines: string[]): string[] {
  if (lines.length <= HEAD + TAIL + 1) return lines;
  return [...lines.slice(0, HEAD), `- ……(中间还有 ${lines.length - HEAD - TAIL} 件,从略)`, ...lines.slice(-TAIL)];
}

/** 一件宗教大事写成材料里的一行 */
const eventLine = (civ: Civ, e: FaithEvent) => `- 第 ${Math.floor(e.year)} 年 ${faithEventText(civ, e)}`;

/** 某一年住在某州的民族(创教、分立那年当地是谁) */
function cultureAt(civ: Civ, own: Owners, region: number, fallback?: number) {
  return civ.cultures[own.culture[region]] ?? (fallback !== undefined ? civ.cultures[fallback] : undefined);
}

/** 这一教这一年的信众:几州、多在哪几国、哪几国奉为国教 */
function nowLines(civ: Civ, rel: Religion, id: number, y: number, at: number, own: Owners): string[] {
  const faith = faithAt(civ, at);
  const by = new Map<number, number>();
  let n = 0;
  let wild = 0;
  for (let r = 0; r < faith.length; r++) {
    if (faith[r] !== id) continue;
    n++;
    const p = own.polity[r];
    if (p >= 0 && civ.polities[p]) by.set(p, (by.get(p) ?? 0) + 1);
    else wild++;
  }
  const out = [`- 信众 ${n} 州`];
  const where = [...by].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, WHERE).map(([p, k]) => `${polName(civ, p, y)} ${k} 州`);
  if (wild) where.push(`无主之地 ${wild} 州`);
  if (where.length) out.push(`- 信众多在:${where.join('、')}`);
  const states = rel.states
    .filter((s) => s.faith === id && s.from <= at && (s.until === undefined || s.until > at) && civ.polities[s.polity] && polityAlive(civ.polities[s.polity], at))
    .sort((a, b) => a.from - b.from || a.polity - b.polity);
  out.push(states.length ? `- 奉为国教的国家:${states.map((s) => polName(civ, s.polity, y)).join('、')}` : '- 这一年没有国家奉它为国教');
  return out;
}

/**
 * 写教义的材料(时间轴停在 year:按那一年写,那以后的教派、国教不提;还没创立 / 分出的按创立那年写)。
 * 民间信仰没有教义这一项(民族卡片的"讲讲风俗"已经讲到这一族拜什么) = null
 */
export function faithMaterial(civ: Civ, id: number, year: number): DoctrineMaterial | null {
  const rel = civ.religion;
  const f = rel?.faiths[id];
  if (!rel || !f || f.kind === 'folk' || f.founded === undefined) return null;
  const at = Math.max(year, f.founded);
  const y = Math.floor(at);
  const upTo = (e: { year: number }) => e.year <= at + 1e-6;
  const lines: string[] = [];
  const formLine = f.form ? `类型:${f.form}(${FORM_NOTE[f.form]})` : '';
  const own0 = ownersAt(civ, f.founded);
  const own = ownersAt(civ, at);
  const root = f.kind === 'sect' && f.parent !== undefined ? rel.faiths[f.parent] : f;
  const holy = root.holy !== undefined ? civ.settlements[root.holy] : undefined;
  // 起名的语感:照本教创教之地的民族(生成时本教、教派的名字都按这一族起)
  const rootOwn = root === f ? own0 : ownersAt(civ, root.founded ?? 0);
  const rootCu = holy ? cultureAt(civ, rootOwn, holy.region, holy.culture) : undefined;
  const style = styleGuide(rootCu?.style);
  const styleLine = style ? `语感(给神、经典、节日、祭礼起名字时照这个):${style.aiLabel} —— ${style.aiDesc}` : '';
  const founderOf = (x: Faith) => {
    const p = x.founder;
    if (!p?.name) return '';
    return p.died <= at ? `${p.name}(第 ${Math.floor(p.born)}–${Math.floor(p.died)} 年)` : `${p.name}(生于第 ${Math.floor(p.born)} 年)`;
  };

  if (f.kind === 'great') {
    lines.push(`宗教:${f.name}`);
    if (formLine) lines.push(formLine);
    const found = rel.events.find((e) => e.kind === 'found' && e.faith === id);
    lines.push(`创立:第 ${Math.floor(f.founded)} 年,${founderOf(f)}${holy ? `创于${holy.name}` : '创立'}`);
    if (holy) {
      const cu = cultureAt(civ, own0, holy.region, holy.culture);
      const pol = polName(civ, found?.polity, f.founded);
      lines.push(`创教那年:${holy.name}${pol ? `属${pol}` : '不属哪一国'}${cu ? `,当地住的是${cultureLabel(cu)}(${KIND_INFO[cu.kind].name})` : ''}`);
      const note = holyNow(civ, holy.id, at, own);
      lines.push(`圣城:${holy.name}${note ? `(第 ${y} 年${note})` : ''}`);
    }
    if (styleLine) lines.push(styleLine);

    const spread = rel.events.filter((e) => e.faith === id && e.kind !== 'found' && upTo(e));
    if (spread.length) lines.push('', `【传播(到第 ${y} 年为止)】`, ...clip(spread.map((e) => eventLine(civ, e))));
    const sects = rel.events.filter((e) => e.kind === 'schism' && rel.faiths[e.faith]?.parent === id && upTo(e));
    if (sects.length) lines.push('', `【分出的教派(到第 ${y} 年为止)】`, ...sects.map((e) => eventLine(civ, e)));
  } else {
    const parent = root;
    const seat = f.seat !== undefined ? civ.settlements[f.seat] : undefined;
    lines.push(`教派:${f.name}`);
    if (formLine) lines.push(`${formLine},和本教一样`);
    const pf = parent.founder?.name ? `${parent.founder.name}创于${holy?.name ?? '—'}` : `创于${holy?.name ?? '—'}`;
    lines.push(`本教:${parent.name}(${parent.form ?? ''};第 ${Math.floor(parent.founded ?? 0)} 年${pf}${holy ? `,圣城${holy.name}` : ''})`);
    const schism = rel.events.find((e) => e.kind === 'schism' && e.faith === id);
    lines.push(`分出:第 ${Math.floor(f.founded)} 年,${schism ? faithEventText(civ, schism) : `自${parent.name}分出`}`);
    const before = rel.states.find((s) => s.polity === f.polity && s.faith === parent.id && s.until !== undefined && Math.abs(s.until - f.founded!) < 1e-6);
    if (before) lines.push(`分出以前:${polName(civ, before.polity, f.founded)}从第 ${Math.floor(before.from)} 年起奉${parent.name}为国教,分出以后改奉${f.name}`);
    if (seat) {
      const cu = cultureAt(civ, own0, seat.region, seat.culture);
      const pol = polName(civ, f.polity, f.founded);
      lines.push(`分出的地方:${seat.name}${pol ? `(${pol}的国都)` : ''}${cu ? `,当地住的是${cultureLabel(cu)}(${KIND_INFO[cu.kind].name})` : ''}`);
      if (holy) {
        const hp = polName(civ, own0.polity[holy.region], f.founded);
        const apart = civ.regions.landmass[seat.region] !== civ.regions.landmass[holy.region];
        lines.push(`分出那年的圣城:${holy.name}${hp ? `属${hp}` : '不属哪一国'}${apart ? `;${seat.name}和${holy.name}不在同一块陆地上` : ''}`);
      }
    }
    if (styleLine) lines.push(styleLine);

    const spread = rel.events.filter((e) => e.faith === id && e.kind !== 'schism' && upTo(e));
    if (spread.length) lines.push('', `【传播(到第 ${y} 年为止)】`, ...clip(spread.map((e) => eventLine(civ, e))));
    const siblings = rel.events.filter((e) => e.kind === 'schism' && e.faith !== id && rel.faiths[e.faith]?.parent === parent.id && upTo(e));
    if (siblings.length) lines.push('', `【同出本教的别的教派(到第 ${y} 年为止)】`, ...siblings.map((e) => eventLine(civ, e)));
  }

  lines.push('', `【第 ${y} 年的样子】`, ...nowLines(civ, rel, id, y, at, own));
  return { id, kind: f.kind, shown: f.name, year: y, lines, stamp: doctrineStamp(civ, id) };
}

export function doctrineSystem(kind: 'great' | 'sect'): string {
  const what =
    kind === 'great'
      ? `2. 先讲它拜什么 —— 照材料里的"类型"写(一神只拜一位神,多神拜很多神,二元讲善神恶神相争,哲理讲修身处世、不拜神,修行讲出家修行),
   再讲它讲什么道理、守什么规矩和祭礼;最后用一两句讲它怎么传开(哪年谁在哪里创立、圣城、哪些国奉为国教、传到了哪里),只挑材料里有的写。`
      : `2. 这是一个教派:先用一句话讲它哪年在哪一国从本教分出,然后写它和本教哪里不同(侧重的道理、规矩、祭礼、朝圣……),
   不要把本教的教义从头再讲一遍。`;
  return `你是一个架空世界的宗教志执笔人,为中文原创世界(OC)的作者讲一个${kind === 'great' ? '宗教' : '教派'}的"教义"。

写法:
1. 中文正文 ${DOCTRINE_CHARS.min}–${DOCTRINE_CHARS.max} 字(不要超过 ${DOCTRINE_CHARS.cap} 字),分两到四段,段与段之间只换一行;不加标题、不列要点,不用 Markdown。
${what}
3. 只用材料里给出的事实(年份、国名、城名、人名、教名):不要编材料里没有的战争、国家、人物、年份、教派;
   神名、经典、教规、祭礼可以设想,但不能和材料矛盾。要起名字时,按材料里的"语感"起这个世界自己的名字。
4. 材料写到哪一年就讲到哪一年:那以后的事(后来分出的教派、后来奉它的国家)不要提。
5. 不要提现实中的宗教、神祇、教派、经典、节日和人物(不写"佛""菩萨""基督""上帝""真主""弥撒"之类)。
6. 年份一律写"第 N 年"(这个世界的纪年)。
7. 语气像百科、地方志里的宗教条目,平实好懂,不堆砌辞藻,不劝人信教。材料里的"仙侠风""精灵风"之类是给你的风格提示,不要写进正文。直接写正文,不要开场白。`;
}

/** 讲讲教义(流式) */
export function doctrineRequest(m: DoctrineMaterial): AiRequest {
  const user = `请为下面这个${m.kind === 'great' ? '宗教' : '教派'}讲"教义"(${DOCTRINE_CHARS.min}–${DOCTRINE_CHARS.max} 字${m.kind === 'sect' ? ',写它和本教哪里不同' : ''}),材料写到第 ${m.year} 年。\n\n${m.lines.join('\n')}`;
  const messages: AiMessage[] = [
    { role: 'system', content: doctrineSystem(m.kind) },
    { role: 'user', content: user },
  ];
  return { feature: '教义', title: `${m.shown} · 教义`, messages, temperature: 0.8, maxTokens: 1000 };
}

/** 写完扫现实里的词:材料里有的不算(语感说明那一行不算材料,里面有提到现实的字眼);不许引古诗文、不许拉丁字母拼写 */
export function doctrineScan(m: DoctrineMaterial): ScanOptions {
  return { material: m.lines.filter((l) => !l.startsWith('语感')).join('\n'), allowClassics: false, allowSpelling: false };
}

/** 去掉 AI 偶尔加的标题、Markdown、空行(段与段之间只留一个换行) */
export function cleanDoctrine(text: string): string {
  return text
    .replace(/^\s*#+\s*[^\n]*\n/, '')
    .replace(/^\s*(教义|【教义】)[::]?\s*/, '')
    .replace(/\*\*/g, '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

/** 写一段教义要的东西(ai/writeup.ts 写、存);找不到这一教(或是民间信仰)= null */
export function doctrineJob(civ: Civ, id: number, year: number, world: string): WriteupJob | null {
  const m = faithMaterial(civ, id, year);
  if (!m) return null;
  const req = doctrineRequest(m);
  return { world, key: doctrineNoteKey(civ, id), kind: '教义', shown: m.shown, req, clean: cleanDoctrine, scan: doctrineScan(m), stamp: m.stamp, year: m.year };
}
