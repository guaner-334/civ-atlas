/**
 * 作品墙搜索(纯计算,单测直接测):框里的字按空格切成词,每个词都要在这个作品的某一段字里出现(可以分在不同段);
 * 英文不分大小写、全角半角当一样,每个词搜到的地方各自标出来。
 */
import type { GalleryWork } from '../account/gallery';

/** 框里最多几个字 */
export const FIND_MAX = 40;

/** 逐字换算再比:全角的字母、数字、符号换成半角,全角空格换成空格,英文换小写。不改长度,比出来的位置就是原文的位置 */
export function fold(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xff01 && c <= 0xff5e) c -= 0xfee0;
    else if (c === 0x3000) c = 0x20;
    const ch = String.fromCharCode(c);
    const lo = ch.toLowerCase();
    out += lo.length === 1 ? lo : ch;
  }
  return out;
}

/** 框里的字切成词(原样,给人看的);只有空格 = 没有词 = 没在搜 */
export function findWords(raw: string): string[] {
  return raw.slice(0, FIND_MAX).trim().split(/\s+/).filter(Boolean);
}

/** 拿来比的词 */
export const findKeys = (words: readonly string[]): string[] => words.map(fold);

/** 一个作品拿来搜的几段字:作品名、署名、一句话介绍;插件另有插件名和说明,规则作品另有规则名和摘要 */
export function workTexts(w: GalleryWork): string[] {
  const out = [w.title, w.by, w.blurb];
  if (w.kind === 'plugin') {
    // 直接读服务器给的 plugin:整理它的代码连着插件那一包,搜索不该把它拖进来
    const p = (w.plugin ?? {}) as { name?: unknown; description?: unknown };
    for (const t of [p.name, p.description]) if (typeof t === 'string') out.push(t);
  } else if (w.kind === 'rules' && w.rules) out.push(w.rules.name, w.rules.brief);
  return out.filter(Boolean);
}

/** 每个词都在某一段里(texts 是 fold 过的) */
export const findHit = (texts: readonly string[], keys: readonly string[]): boolean => keys.every((k) => texts.some((t) => t.includes(k)));

/** 一段字切成搜到的和没搜到的几截(重叠、挨着的合成一截) */
export function findPieces(text: string, keys: readonly string[]): { text: string; hit: boolean }[] {
  const t = fold(text);
  const spans: [number, number][] = [];
  for (const k of keys) if (k) for (let i = t.indexOf(k); i >= 0; i = t.indexOf(k, i + 1)) spans.push([i, i + k.length]);
  spans.sort((a, b) => a[0] - b[0]);
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (let i = 0; i < spans.length;) {
    const from = spans[i][0];
    let to = spans[i][1];
    for (i++; i < spans.length && spans[i][0] <= to; i++) to = Math.max(to, spans[i][1]);
    if (from > at) out.push({ text: text.slice(at, from), hit: false });
    out.push({ text: text.slice(from, to), hit: true });
    at = to;
  }
  if (at < text.length || !out.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

/** 「搜到 N 个」旁边那句:名字、作者、介绍里有「图层」/ 同时有「海」和「图层」 */
export function findLead(words: readonly string[]): string {
  const q = words.map((w) => `「${w}」`);
  return `名字、作者、介绍里${q.length > 1 ? `同时有${q.slice(0, -1).join('、')}和${q[q.length - 1]}` : `有${q[0] ?? ''}`}`;
}
