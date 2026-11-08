/**
 * 插件改了你写的东西以后提示条怎么说、插件交来的修改不合格式时插件卡里怎么说。纯计算(单测直接测)。
 * 开头永远是「插件「XX」」,让人知道不是自己改的;说法照网站现成的撤销提示条。
 */
import { polityName } from '../../../gen/civ/growth';
import type { Civ } from '../../../gen/civ/types';
import { resolveKey, type KeyKind, type WorldEdits } from '../../../gen/edits';

/** 一批修改里有什么:改的名字(改之前、改之后)、新加的标记(名字)、新下的命令(几条) */
export interface BatchParts {
  names: { kind: KeyKind; before: string; after: string }[];
  marks: string[];
  commands: number;
}

export interface Said {
  text: string;
  more?: string[];
}

const WORD: Record<KeyKind, string> = {
  polity: '国名',
  dynasty: '国名',
  settlement: '城名',
  place: '地名',
  culture: '族名',
  region: '州名',
  faith: '教名',
  person: '人名',
  treaty: '约名',
  trade: '商道名',
};

const who = (plugin: string) => `插件「${plugin}」`;

/** 稳定键在这份历史里那一年叫什么;找不到 = 空串 */
export function keyName(civ: Civ | null, key: string, year: number): string {
  const r = civ ? resolveKey(civ, key) : null;
  if (!civ || !r) return '';
  if (r.kind === 'polity' || r.kind === 'dynasty') {
    const p = civ.polities[r.id];
    if (!p) return '';
    if (r.kind === 'dynasty' && r.index) return p.dynasties?.[r.index]?.name ?? '';
    return polityName(p, Math.max(p.founded, Math.min(year, (p.ended ?? Infinity) - 1)));
  }
  if (r.kind === 'settlement') return civ.settlements[r.id]?.name ?? '';
  if (r.kind === 'place') return civ.places[r.id]?.name ?? '';
  if (r.kind === 'culture') return civ.cultures[r.id]?.name ?? '';
  if (r.kind === 'region') return (civ.regionNames ?? civ.regions.name)?.[r.id] ?? '';
  if (r.kind === 'faith') return civ.religion?.faiths[r.id]?.name ?? '';
  if (r.kind === 'person') return civ.people?.[r.id]?.name ?? '';
  return '';
}

/** before → after 这一批里有什么;names(key, 改之前 / 改之后)给名字 */
export function batchParts(before: WorldEdits, after: WorldEdits, nameOf: (key: string, when: 'before' | 'after') => { kind: KeyKind; name: string } | null): BatchParts {
  const names: BatchParts['names'] = [];
  for (const k of new Set([...Object.keys(before.names), ...Object.keys(after.names)])) {
    if ((before.names[k] ?? '') === (after.names[k] ?? '')) continue;
    const b = nameOf(k, 'before');
    const a = nameOf(k, 'after');
    const kind = a?.kind ?? b?.kind;
    if (kind) names.push({ kind, before: b?.name ?? '', after: a?.name || after.names[k] || '' });
  }
  const had = new Set((before.marks ?? []).map((m) => m.id));
  const marks = (after.marks ?? []).filter((m) => !had.has(m.id)).map((m) => m.title || '新标记');
  return { names, marks, commands: Math.max(0, after.interventions.length - before.interventions.length) };
}

/** 列头几个:三个以内全列,再多列两个、说还有几个 */
function head(items: string[], sep: string): string {
  if (items.length <= 3) return items.join(sep);
  return `${items.slice(0, 2).join(sep)}，还有 ${items.length - 2} 个`;
}

function namesWord(b: BatchParts): string {
  const w = new Set(b.names.map((n) => WORD[n.kind]));
  return w.size === 1 ? [...w][0] : '名字';
}

/** 「改了 2 个国名、加了 3 个标记、下了 2 条命令」 */
function kinds(b: BatchParts): string {
  const out: string[] = [];
  if (b.names.length) out.push(`改了 ${b.names.length} 个${namesWord(b)}`);
  if (b.marks.length) out.push(`加了 ${b.marks.length} 个标记`);
  if (b.commands) out.push(`下了 ${b.commands} 条命令`);
  return out.join('、');
}

const count = (b: BatchParts) => b.names.length + b.marks.length + b.commands;

/** 不用重新推演的(只改名、加标记):照办以后当场说 */
export function sayBatch(plugin: string, b: BatchParts): Said {
  const p = who(plugin);
  if (!b.marks.length && b.names.length === 1) {
    const n = b.names[0];
    return n.before && n.before !== n.after ? { text: `${p}把${n.before}改名为${n.after}` } : { text: `${p}改了 1 个${WORD[n.kind]}`, more: [n.after] };
  }
  if (!b.marks.length) return { text: `${p}改了 ${b.names.length} 个${namesWord(b)}`, more: [head(b.names.map((n) => (n.before && n.before !== n.after ? `${n.before}改叫${n.after}` : n.after)), '，')] };
  if (!b.names.length) return b.marks.length === 1 ? { text: `${p}加了标记「${b.marks[0]}」` } : { text: `${p}加了 ${b.marks.length} 个标记`, more: [head(b.marks, '、')] };
  return { text: `${p}改了 ${count(b)} 处`, more: [kinds(b)] };
}

/** 下了命令、正在重新推演时提示条的开头(后面接"正在重新推演 1650–3000 年") */
export function sayBusy(plugin: string, b: BatchParts): string {
  return `${who(plugin)}下了 ${b.commands} 条命令，`;
}

/** 推完:from = "从哪年起"的那一年("1650 年"),failed = 几条命令没生效 */
export function sayDone(plugin: string, b: BatchParts, from: string, failed: number): Said {
  const p = who(plugin);
  const miss = failed ? `${failed} 条命令没生效，原因见概览"我的干预"` : '';
  if (!b.names.length && !b.marks.length) return { text: `${p}下了 ${b.commands} 条命令，已从${from}起重新推演`, ...(miss ? { more: [miss] } : {}) };
  return { text: `${p}改了 ${count(b)} 处，已从${from}起重新推演`, more: [miss ? `${kinds(b)}；${miss}` : kinds(b)] };
}

// ---------------------------------------------------------------------------
// 插件交来的修改不合格式:哪几处不对

export interface Refusal {
  /** 交来几处 */
  total: number;
  /** 查出几处不对;0 = 不是哪一处的问题(一批太多、改完存不下……),lines 里是那一句 */
  bad: number;
  lines: string[];
}

/** 最多列几处 */
const LINES_MAX = 5;

const FIELDS: [string, string][] = [
  ['mark.title', '标记的名字'],
  ['mark.note', '标记的说明'],
  ['mark.color', '标记的颜色'],
  ['mark.size', '标记的字号'],
  ['mark.from', '标记的年份'],
  ['mark.to', '标记的年份'],
  ['mark.at', '标记的位置'],
  ['mark.regions', '标记圈的州'],
  ['mark', '标记'],
  ['key', '改的东西'],
  ['name', '名字'],
  ['v', '命令'],
  ['kind', '种类'],
];

/** 网站查出来的一句(「changes[0].name 最多 16 个字」)换成给用的人看的 */
export function changeText(change: unknown, message: string): string {
  const m = /^changes\[\d+\]\.?(\S*)\s*(.*)$/.exec(message);
  if (!m) return message;
  const [, path, rest] = m;
  if (!path) return `这一处${rest}`;
  const c = change as { kind?: unknown; name?: unknown };
  const long = /^最多 (\d+) 个字/.exec(rest);
  if (path === 'name' && long && typeof c.name === 'string') return `名字有 ${[...c.name.trim()].length} 个字，最多 ${long[1]} 个字`;
  const field = path.replace(/\[\d+\]/g, '');
  const hit = FIELDS.find(([f]) => field === f || field.startsWith(`${f}.`));
  return hit ? `${hit[1]}${rest}` : `${path} ${rest}`;
}

/** check(一处) = 这一处单独提时网站查出来的那一句;都单独查得过 = 整批的问题 */
export function refusalOf(args: unknown, message: string, check: (change: unknown) => string | null): Refusal {
  const list = args && typeof args === 'object' && Array.isArray((args as { changes?: unknown }).changes) ? ((args as { changes: unknown[] }).changes as unknown[]) : null;
  const bad: string[] = [];
  if (list && list.length <= 200)
    list.forEach((c, i) => {
      const why = check(c);
      if (why) bad.push(`第 ${i + 1} 处：${changeText(c, why)}`);
    });
  if (!bad.length) return { total: list?.length ?? 0, bad: 0, lines: [message] };
  const lines = bad.slice(0, LINES_MAX);
  if (bad.length > LINES_MAX) lines.push(`还有 ${bad.length - LINES_MAX} 处`);
  return { total: list!.length, bad: bad.length, lines };
}
