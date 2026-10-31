/**
 * 给别人看的一小段字(分享世界时填的署名、一套规则的名字和介绍……)怎么清理:去掉看不见的字符、并掉多余的空白、按看到的字数截断。
 * 纯计算,不碰 DOM(存档 savefile.ts、规则 civ/ruleSet.ts 都用;放在这里,两边不互相引用)。
 */

/** 署名最长几个字 */
export const SIGNATURE_MAX = 20;
/** 看不见、但组合表情和连写离不开的字符:零宽连接(👩‍💻)、零宽不连接、各种变体选择(❤️、蒙古文的)、表情旗帜里的标签 */
const JOINERS = /[‌‍\p{Variation_Selector}\u{E0020}-\u{E007F}]/u;
const JOINERS_ALL = new RegExp(JOINERS.source, 'gu');
/** 开头的这些字符和空白(前面没有字可以组合,没有用) */
const LEADING = new RegExp(`^(?:${JOINERS.source}|\\s)+`, 'u');
/** 署名最多占多长(UTF-16 码元;一个字后面挂上一长串看不见的字符也只算一个字,得另外限住) */
export const SIGNATURE_UNITS = 320;

/**
 * 署名:去掉控制字符和别的看不见的字符(换行、制表这类算空白;零宽空格、改文字方向的都去掉,组合表情要用的留着)、首尾空白,
 * 开头的组合用字符去掉,连续空白并成一个,超长截断(按看到的字数,另外总长不超过 SIGNATURE_UNITS);空(只剩组合用的字符也算)= 没署名
 */
export function cleanSignature(raw: unknown, max: number = SIGNATURE_MAX): string {
  if (typeof raw !== 'string') return '';
  const s = raw
    .replace(/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, (c) => (/\s/.test(c) ? ' ' : JOINERS.test(c) ? c : ''))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEADING, '');
  let t = '';
  let n = 0;
  // 只分前面够用的一段(超出总长的反正放不下)
  for (const g of graphemes(s.slice(0, SIGNATURE_UNITS + 1))) {
    if (n >= max || t.length + g.length > SIGNATURE_UNITS) break;
    t += g;
    n++;
  }
  t = t.trimEnd();
  return t.replace(JOINERS_ALL, '').trim() ? t : '';
}

/** 按看到的字分开(一个组合表情、一个带变体选择的 ❤️ 都算一个字);太旧的浏览器没有这个功能就按码位分 */
function graphemes(s: string): string[] {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return [...s];
  return Array.from(new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(s), (x) => x.segment);
}
