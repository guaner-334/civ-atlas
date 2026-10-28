/**
 * 民族卡片「更多」里的"讲讲风俗":让 AI 按这一族的生计、特质和来由、信仰、住的地方、迁徙和大事写一段风俗(两三百字)。
 * 材料只取世界里的真事实(cultureMaterial,单测核对);写好的存在本地(ai/library.ts,kind = "风俗",键 = "风俗:" + 民族的稳定键),
 * 历史改写过(干预、改地形)以后标"写于历史改写前"(customsStamp 对不上)。
 */
import type { Civ } from '../../gen/civ/types';
import type { ChronicleEntry } from '../../gen/civ/chronicle';
import { BIOMES } from '../../gen/biomes';
import { KIND_INFO, cultureLabel, regionLabel } from '../../gen/civ/display';
import { polityName, populationLabel } from '../../gen/civ/growth';
import { cultureTraits } from '../../gen/civ/cultureTraits';
import { cultureKey } from '../../gen/edits';
import { evText } from '../../ui/timelineLayout';
import { cultureBranches, cultureEntries, cultureNow, culturePopSeries, cultureShownYear, cultureWaves, waveText } from '../../ui/cultureInfo';
import { ownersAt, type Owners } from '../../gen/civ/timeline';
import { faithAt } from '../../gen/civ/religion';
import { nameStamp, styleGuide } from './names';
import type { AiMessage, AiRequest } from '../types';
import type { ScanOptions } from '../realWords';

/** 风俗的字数:要 min–max 字,说"不要超过 cap 字" */
export const CUSTOMS_CHARS = { min: 200, max: 280, cap: 320 };

/** 材料里列几条大事(最近的) */
const EVENTS = 8;

export interface CustomsMaterial {
  /** 民族编号 */
  id: number;
  /** 界面上的族名("奥利亚族") */
  shown: string;
  /** 材料按哪一年写的 */
  year: number;
  /** 材料(一条一行) */
  lines: string[];
  /** 历史改写检查用(见 customsStamp) */
  stamp: string;
}

/** 存风俗的键 */
export function customsNoteKey(civ: Civ, id: number): string {
  return `风俗:${cultureKey(civ, id)}`;
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

/** 风俗的指纹(按整段历史、民族缓存:卡片每画一次都要对一下) */
const stampCache = new WeakMap<object, Map<number, string>>();

/**
 * 风俗的指纹:改名不变,历史改写 / 改地形才变 —— 族名由来那一份(出现、发源、迁徙),这一族整段历史里的大事
 * (迁徙、大迁徙、同化、分化、消亡,本族之国的兴亡),每一百年住哪几州、归哪国(按国都的地块认)、信什么、多少人
 * (材料里"住在哪、信什么、多少人"都从这几样来:干预把一州划给别国、天灾少了人,指纹都跟着变)
 */
export function customsStamp(civ: Civ, id: number): string {
  const full = civ.history ?? civ;
  let m = stampCache.get(full.log);
  if (!m) stampCache.set(full.log, (m = new Map()));
  const hit = m.get(id);
  if (hit !== undefined) return hit;
  const A = full.annals;
  const parts: string[] = [];
  for (const a of A) {
    if ((a.kind === 'migrate' || a.kind === 'assimilate' || a.kind === 'vanish' || a.kind === 'diverge') && (a.a === id || a.b === id)) parts.push(`${a.kind}${Math.floor(a.year)}:${a.region}`);
    else if (a.kind === 'trek' && a.a === id) parts.push(`trek${Math.floor(a.year)}:${a.n ?? ''}`);
    else if ((a.kind === 'found' || a.kind === 'fall') && full.polities[a.a]?.culture === id) parts.push(`${a.kind}${Math.floor(a.year)}`);
  }
  const capCell = (q: number) => (q >= 0 && full.polities[q] ? (full.settlements[full.polities[q].capital]?.cell ?? -1) : -1);
  let own: Owners | undefined;
  let faith: Int16Array | undefined;
  for (let y = 0; y <= full.endYear; y += 100) {
    own = ownersAt(full, y, own);
    faith = full.religion ? faithAt(full, y, faith) : undefined;
    const rs: string[] = [];
    for (let r = 0; r < full.regions.count; r++) if (own.culture[r] === id) rs.push(`${r}>${capCell(own.polity[r])}/${faith ? faith[r] : -1}`);
    parts.push(rs.join(','));
  }
  parts.push(culturePopSeries(full, id).map((p) => Math.round(p)).join(','));
  const out = `${nameStamp(full, { kind: 'culture', id })}|${hash(parts.join(';'))}`;
  m.set(id, out);
  return out;
}

/** 写风俗的材料(时间轴停在 year:按那一年的样子写;已消亡的按消亡前) */
export function cultureMaterial(civ: Civ, id: number, year: number): CustomsMaterial | null {
  const cu = civ.cultures[id];
  if (!cu || cu.unborn) return null;
  const y = Math.floor(cultureShownYear(cu, year));
  const lines: string[] = [];
  const info = KIND_INFO[cu.kind];
  const born = Math.floor(cu.born);
  const parent = cu.parent !== undefined ? civ.cultures[cu.parent] : undefined;
  lines.push(`民族:${cultureLabel(cu)}`);
  lines.push(`生计:${info.name}(${info.hint})`);
  lines.push(
    parent
      ? `来历:第 ${born} 年从${cultureLabel(parent)}分出,发源${regionLabel(civ, cu.hearth)}`
      : `来历:第 ${born} 年自然兴起,发源${regionLabel(civ, cu.hearth)}(${BIOMES[civ.regions.biome[cu.hearth]]?.name ?? '—'})`,
  );
  if (cu.ended !== undefined && cu.ended <= year) lines.push(`消亡:第 ${Math.floor(cu.ended)} 年`);
  const style = styleGuide(cu.style);
  if (style) lines.push(`语感(起新名字时照这个):${style.aiLabel} —— ${style.aiDesc}`);

  const own = ownersAt(civ, y);
  const now = cultureNow(civ, id, y, own);
  lines.push('', `【第 ${y} 年的样子】`);
  lines.push(`- 住 ${now.regions.length} 州,${populationLabel(now.pop)}`);
  const where = now.polities.slice(0, 5).map((p) => `${polityName(civ.polities[p.id], y)} ${p.n} 州`);
  if (now.wild) where.push(`无主之地 ${now.wild} 州`);
  if (where.length) lines.push(`- 住在:${where.join('、')}`);
  const faiths = now.faiths.slice(0, 4).map((f) => `${civ.religion!.faiths[f.id].name} ${f.n} 州`);
  if (faiths.length) lines.push(`- 信:${faiths.join('、')}`);
  // 地貌:住的州里最多的几种
  const land = new Map<number, number>();
  for (const r of now.regions) land.set(civ.regions.biome[r], (land.get(civ.regions.biome[r]) ?? 0) + 1);
  const lands = [...land].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (lands.length) lines.push(`- 住的地方:${lands.map(([b, n]) => `${BIOMES[b]?.name ?? '—'} ${n} 州`).join('、')}`);

  const tr = cultureTraits(civ, id, y);
  if (tr && tr.traits.length) {
    lines.push('', `【特质(据第 ${tr.window.from}–${tr.window.to} 年的历史读出来的)】`);
    for (const t of tr.traits) lines.push(`- ${t.word}:${t.why}`);
  }

  const waves = cultureWaves(civ, id, y);
  const kids = cultureBranches(civ, id, y);
  if (waves.length || kids.length || parent) {
    lines.push('', '【族系、迁徙】');
    if (parent) lines.push(`- 母族:${cultureLabel(parent)}`);
    if (kids.length) lines.push(`- 分出去的支族:${kids.map((k) => `${cultureLabel(k)}(第 ${Math.floor(k.born)} 年分出)`).join('、')}`);
    if (waves.length) {
      const last = waves[waves.length - 1];
      lines.push(`- 成规模的迁徙 ${waves.length} 次,最近一次第 ${Math.floor(last.year)} 年${waveText(civ, last)}`);
    }
  }

  const events = cultureEntries(civ, id).filter((e) => e.year <= y + 1e-6);
  if (events.length) {
    lines.push('', '【和这一族有关的大事(最近几条)】');
    for (const e of events.slice(-EVENTS)) lines.push(`- 第 ${Math.floor(e.year)} 年 ${eventUpTo(e, y)}`);
  }
  return { id, shown: cultureLabel(cu), year: y, lines, stamp: customsStamp(civ, id) };
}

/**
 * 一条大事写到 y 年为止:折叠的条目(一场仗、一次大迁徙)到 y 年还没完的,只写到 y 年为止发生的那几件
 * (标题写的是结局,不能当成那一年已经有的事)
 */
export function eventUpTo(e: ChronicleEntry, y: number): string {
  if (!e.children?.length || e.end <= y + 1e-6) return evText(e);
  const done = e.children.filter((c) => c.year <= y + 1e-6);
  return done.length ? done.map((c) => evText(c)).join(';') : evText(e.children[0]);
}

export function customsSystem(): string {
  return `你是一个架空世界的民族志执笔人,为中文原创世界(OC)的作者写一个民族的"风俗"。

写法:
1. 一段 ${CUSTOMS_CHARS.min}–${CUSTOMS_CHARS.max} 字的中文正文(不要超过 ${CUSTOMS_CHARS.cap} 字):不分段、不加标题、不列要点,不用 Markdown。
2. 写这一族怎么过日子:吃住、衣着、婚丧、节庆、成人礼、待客、禁忌里挑几样写,每一样都要从材料里找得到由头 ——
   生计(游牧写马和帐篷,海洋写船和港口,湖泽写渔……)、特质和它的来由、信的教、住的地方、迁徙和大事。
3. 只用材料里给出的事实(年份、国名、教名、州名、人数):不要编材料里没有的战争、国家、人物、年份;风俗细节可以设想,
   但不能和材料矛盾。节日、器物、习俗要起名字时,按材料里的"语感"起这个世界自己的名字。
4. 不要提现实中的民族、国家、宗教、节日、语言、典籍和人物(不写"春节""清明""蒙古包""佛""基督"之类)。
5. 年份一律写"第 N 年"(这个世界的纪年)。
6. 语气像地方志里的"风俗"条,平实好懂,不堆砌辞藻。材料里的"仙侠风""精灵风"之类是给你的风格提示,不要写进正文。直接写正文,不要开场白。`;
}

/** 讲讲风俗(流式) */
export function customsRequest(m: CustomsMaterial): AiRequest {
  const user = `请为下面这个民族写"风俗"(${CUSTOMS_CHARS.min}–${CUSTOMS_CHARS.max} 字)。\n\n${m.lines.join('\n')}`;
  const messages: AiMessage[] = [
    { role: 'system', content: customsSystem() },
    { role: 'user', content: user },
  ];
  return { feature: '风俗', title: `${m.shown} · 风俗`, messages, temperature: 0.8, maxTokens: 1000 };
}

/** 写完扫现实里的词:材料里有的不算(语感说明那一行不算材料,里面有提到现实的字眼);不许引古诗文、不许拉丁字母拼写 */
export function customsScan(m: CustomsMaterial): ScanOptions {
  return { material: m.lines.filter((l) => !l.startsWith('语感')).join('\n'), allowClassics: false, allowSpelling: false };
}

/** 去掉 AI 偶尔加的标题、引号、Markdown(和释名一样的毛病) */
export function cleanCustoms(text: string): string {
  return text
    .replace(/^\s*#+\s*[^\n]*\n/, '')
    .replace(/^\s*(风俗|【风俗】)[::]?\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\s*\n+\s*/g, '')
    .trim();
}
