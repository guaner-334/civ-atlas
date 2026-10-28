/**
 * 纪年:年份怎么写。世界里的年份一律是"第几年"(第 0 年 = 第一批定居者到来那年),推演、存档、网址、干预都用它;
 * 纪年只换写法 —— 作者在世界设定里定一个名字(默认「公元」)和元年是第几年,界面、导出、AI 的提示词里的年份都照它写。
 * 改纪年不重新推演。纯计算,不碰 DOM(界面、导出、AI 提示词共用)。
 *
 * 写法(和公元一样没有 0 年;元年 = 第 E 年):
 *
 * | 第 y 年      | 全写             | 短写    |
 * |--------------|------------------|---------|
 * | y < E        | 公元前 (E − y) 年 | 前 850  |
 * | y = E        | 公元元年          | 元年    |
 * | y > E        | 公元 (y − E + 1) 年 | 501   |
 * | 没设纪年     | 第 y 年(句子里 "y 年") | y |
 *
 * 全写用在句子、标题、时间轴大字;短写用在窄的一列(编年史的年份、侧栏最近大事、卡片上的起止)和时间轴刻度。
 * 元年怎么定:按年份("第 0 年是公元前 2500 年" → E = 2500;"第 0 年是公元 100 年" → E = −99),
 * 或者按一件事(那件事那一年就是元年;记下那件事的标签和正文,只用来在设置里显示,不影响写法)。
 */

/** 纪年 */
export interface Era {
  /** 名字(1–ERA_NAME_MAX 个字):"公元""利希历" */
  name: string;
  /** 元年是第几年 */
  epoch: number;
  /** 元年怎么定:按一件事;没有 = 按年份 */
  by?: 'event';
  /** 按一件事:那件事(还没选 = 没有;年份就是 epoch) */
  event?: EraEvent;
}

/** 当元年的那件事:编年史里那一条的一字标签和正文(选的那一刻的样子) */
export interface EraEvent {
  tag: string;
  text: string;
  /** 那一条在编年史里的编号("种类:下标"),改名以后用它认出是哪一条、换成现在的正文;没有 = 一直用记下的正文 */
  key?: string;
}

/** 名字最多几个字 */
export const ERA_NAME_MAX = 4;
/** "第 0 年是公元前 / 公元多少年"最多填多少 */
export const ERA_ZERO_MAX = 99999;
/** 刚换成纪年时:公元,第 0 年是公元前 2500 年 */
export const ERA_DEFAULT: Era = Object.freeze({ name: '公元', epoch: 2500 });
/** 当元年的那件事,正文最多存几个字 */
const EVENT_TEXT_MAX = 200;

/** 元年最早、最晚是第几年(第 0 年是公元 99999 年 … 公元前 99999 年) */
const EPOCH_MIN = 1 - ERA_ZERO_MAX;
const EPOCH_MAX = ERA_ZERO_MAX;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** 名字:去掉控制字符和空白;空、超过 ERA_NAME_MAX 个字 = '' */
export function cleanEraName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f\s]/g, '');
  return s && [...s].length <= ERA_NAME_MAX ? s : '';
}

/** 整理纪年:名字不合格、元年不是范围里的整数 = undefined(按"第几年"写) */
export function cleanEra(raw: unknown): Era | undefined {
  if (!isObj(raw)) return undefined;
  const name = cleanEraName(raw.name);
  const e = raw.epoch;
  if (!name || typeof e !== 'number' || !Number.isInteger(e) || e < EPOCH_MIN || e > EPOCH_MAX) return undefined;
  const era: Era = { name, epoch: e };
  if (raw.by === 'event') {
    era.by = 'event';
    const ev = raw.event;
    if (isObj(ev) && typeof ev.tag === 'string' && typeof ev.text === 'string') {
      // eslint-disable-next-line no-control-regex
      const text = ev.text.replace(/[\u0000-\u001f\u007f]/g, '').trim();
      const tag = [...ev.tag.trim()].slice(0, 2).join('');
      if (text) {
        era.event = { tag, text: [...text].slice(0, EVENT_TEXT_MAX).join('') };
        if (typeof ev.key === 'string' && /^[a-z]{1,16}:\d{1,9}$/.test(ev.key)) era.event.key = ev.key;
      }
    }
  }
  return era;
}

export function sameEra(a: Era | undefined, b: Era | undefined): boolean {
  return a === b || JSON.stringify(cleanEra(a) ?? null) === JSON.stringify(cleanEra(b) ?? null);
}

/** "第 0 年是公元前 / 公元多少年":pre = 公元前;n = 年数(1 起) */
export function eraZero(era: Pick<Era, 'epoch'>): { pre: boolean; n: number } {
  return era.epoch > 0 ? { pre: true, n: era.epoch } : { pre: false, n: 1 - era.epoch };
}

/** 反过来:"第 0 年是公元前 n 年" → 元年是第几年 */
export function epochOfZero(pre: boolean, n: number): number {
  return pre ? n : 1 - n;
}

/** 第 y 年按纪年是哪一年:pre = 名字前;n = 年数(元年 = 1) */
export function eraYear(y: number, era: Pick<Era, 'epoch'>): { pre: boolean; n: number } {
  const v = Math.floor(y);
  return v < era.epoch ? { pre: true, n: era.epoch - v } : { pre: false, n: v - era.epoch + 1 };
}

/** 反过来:纪年的"名字前 n 年" / "名字 n 年" → 第几年 */
export function worldYear(pre: boolean, n: number, era: Pick<Era, 'epoch'>): number {
  return pre ? era.epoch - n : era.epoch + n - 1;
}

/** 全写:"第 1650 年";纪年 "公元前 850 年""公元元年""公元 501 年" */
export function yearFull(y: number, era?: Era | null): string {
  const v = Math.floor(y);
  if (!era) return `第 ${v} 年`;
  const { pre, n } = eraYear(v, era);
  if (pre) return `${era.name}前 ${n} 年`;
  return n === 1 ? `${era.name}元年` : `${era.name} ${n} 年`;
}

/** 句子里接在动词前面:"1601 年立国";纪年和全写一样 "公元前 1601 年立国" */
export function yearAt(y: number, era?: Era | null): string {
  return era ? yearFull(y, era) : `${Math.floor(y)} 年`;
}

/** 短写:"1650";纪年 "前 850""元年""501" */
export function yearShort(y: number, era?: Era | null): string {
  const v = Math.floor(y);
  if (!era) return String(v);
  const { pre, n } = eraYear(v, era);
  return pre ? `前 ${n}` : n === 1 ? '元年' : String(n);
}

/** 短写带"年":"1360 年";纪年 "前 1360 年""元年""501 年"(窄处的"…年起") */
export function yearShortAt(y: number, era?: Era | null): string {
  const s = yearShort(y, era);
  return s === '元年' ? s : `${s} 年`;
}

/** 起止,短写:"820–811"(同一年只写一个:"820");纪年 "前 820–前 811" */
export function yearSpan(a: number, b: number, era?: Era | null): string {
  if (Math.floor(a) === Math.floor(b)) return yearShort(a, era); // 起止同一年只写一个
  return `${yearShort(a, era)}–${yearShort(b, era)}`;
}

/**
 * 起止,句子里:"820–811 年";纪年 "公元前 820–前 811 年""公元 25–220 年";
 * 起止同一年只写一次:"1488 年"(接"领兵""在位"都是"1488 年领兵");跨过元年、或者有一头是元年的两头都写全:"公元前 3 年–公元 5 年"。dash = 连接号(编年史的旧写法用"—")
 */
export function yearSpanAt(a: number, b: number, era?: Era | null, dash = '–'): string {
  const x = Math.floor(a);
  const z = Math.floor(b);
  if (x === z) return yearAt(x, era); // 起止同一年只写一个年份:"1488 年"
  if (!era) return `${x}${dash}${z} 年`;
  const A = eraYear(x, era);
  const B = eraYear(z, era);
  if (A.pre && B.pre) return `${era.name}前 ${A.n}${dash}前 ${B.n} 年`;
  if (!A.pre && !B.pre && A.n > 1) return `${era.name} ${A.n}${dash}${B.n} 年`;
  return `${yearFull(x, era)}${dash}${yearFull(z, era)}`;
}

/** 接在汉字后面:数字开头的前面空一格("当前 1650 年""当前公元前 850 年") */
export function spaced(s: string): string {
  return /^\d/.test(s) ? ` ${s}` : s;
}

/**
 * 一段字里写着"第 N 年""第 N—M 年"的地方换成纪年的写法(推演写的纪事、AI 的提示词都是这样写年份的;
 * "享国 312 年"这类年数没有"第",不换)。没设纪年 = 原样
 */
export function eraText(s: string, era?: Era | null): string {
  if (!era || !s.includes('第')) return s;
  return s
    .replace(/第 ?(\d+) ?([—–]) ?(\d+) ?年/g, (_, a: string, d: string, b: string) => yearSpanAt(Number(a), Number(b), era, d))
    .replace(/第 ?(\d+) ?年/g, (_, a: string) => yearFull(Number(a), era));
}

/** 作者填的年份(人物的生卒、标记的起止)不合格时的提示:填了纪年的 0 年、早于第 0 年、晚于能存的最后一年 */
export function noYearZero(era?: Era | null): string {
  return `${era?.name ?? ''}没有 0 年`;
}
export function yearTooEarly(era?: Era | null): string {
  return `年份最早填到${spaced(yearAt(0, era))}`;
}
export function yearTooLate(max: number, era?: Era | null): string {
  return era ? `年份最晚填到${yearFull(max, era)}` : `年份最大填到 ${max}`;
}

/**
 * 给 AI 的一段说明(助手、说一句话改历史):设了纪年时,作者说的年份可能是纪年的写法。
 * 材料、工具、修改里的年份仍是第几年;AI 回的话也写"第 N 年",界面显示时再换成纪年的写法
 */
export function eraNote(era: Era, end: number): string {
  const n = era.name;
  return (
    `作者给这个世界定了纪年「${n}」:第 ${era.epoch} 年是${n}元年,和公元一样没有 0 年;第 0 年是${yearFull(0, era)},第 ${Math.floor(end)} 年是${yearFull(end, era)}。` +
    `作者说"${n}前 X 年"就是第 (${era.epoch} − X) 年,"${n} X 年"就是第 (${era.epoch} + X − 1) 年,先换算成第几年再用。` +
    `材料、工具和修改里的年份都是第几年;回给作者的话里年份也一律写成"第 N 年"(界面会换成${n}的写法),不要自己换算成${n}。`
  );
}

/** 世界设定页侧栏那一行的写法:名字是「公元」写"公元纪年",别的直接写名字 */
export function eraLabel(era: Era): string {
  return era.name === '公元' ? '公元纪年' : era.name;
}

// ---------------------------------------------------------------------------
// 月份:编年史、地图上的事件卡片、时间轴的提示写到"第 1638 年 11 月"。
// 推演里每件事本来就记着发生在一年里的哪一格(1/256 年),一年分 N 个月,月份 = 那一年过了几成 × N,取整 + 1。
// 年份正好落在年初的(宗教的传播、干预、地形大事这类按整年算的事)不写月。只换写法,不参与推演。

/** 一年几个月:默认、最少、最多 */
export const MONTHS_DEFAULT = 12;
export const MONTHS_MIN = 2;
export const MONTHS_MAX = 36;

/** 整理 WorldEdits.months:0 = 只写年;MONTHS_MIN–MONTHS_MAX 的整数 = 一年几个月;默认(12)和认不出的 = undefined(不写) */
export function cleanMonths(raw: unknown): number | undefined {
  if (raw === 0) return 0;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < MONTHS_MIN || raw > MONTHS_MAX || raw === MONTHS_DEFAULT) return undefined;
  return raw;
}

/** 这个世界一年几个月(0 = 只写年) */
export function monthsOf(raw: unknown): number {
  return cleanMonths(raw) ?? MONTHS_DEFAULT;
}

/** 第 y 年(带小数)是那一年的第几月(1 起);只写年(months = 0)、正好在年初 = 0(不写月) */
export function monthOf(y: number, months: number): number {
  if (!months || !Number.isFinite(y)) return 0;
  const f = y - Math.floor(y);
  if (f <= 0) return 0;
  return Math.min(months, Math.floor(f * months) + 1);
}

/** 接在年份后面的月份:" 11 月";不写月 = '' */
export function monthTail(y: number, months: number): string {
  const m = monthOf(y, months);
  return m ? ` ${m} 月` : '';
}

/** 全写带月:"第 1638 年 11 月""公元前 850 年 3 月";不写月 = yearFull */
export function yearMonthFull(y: number, months: number, era?: Era | null): string {
  return yearFull(y, era) + monthTail(y, months);
}

/** 句子里带月:"1638 年 11 月";纪年 "公元前 850 年 3 月";不写月 = yearAt */
export function yearMonthAt(y: number, months: number, era?: Era | null): string {
  return yearAt(y, era) + monthTail(y, months);
}

// ---------------------------------------------------------------------------
// 跳到某一年:时间轴上的年份、编年史上面那一格填的字怎么算

/** 填的年份算出来的结果:year = 跳到第几年(不能跳 = null);why = 提示(没问题 = null);hint = 提示下面的小字 */
export interface JumpParse {
  year: number | null;
  why: string | null;
  hint: string | null;
}

/**
 * 输入框里的数字 → 跳到第几年。text 只有数字(最多 6 位);设了纪年时 pre = 前面的小按钮是"名字前",数字是纪年的年数。
 * 空着 = 不跳;纪年填 0 = 不跳(没有 0 年);超出这个世界(0–end)= 提示一句,回车停在最后一年 / 第 0 年。
 * future = 逐年推演(end 是"现在"):比"现在"晚的写"以后的事还没发生",回车停在"现在"
 */
export function parseJump(text: string, pre: boolean, era: Era | null | undefined, end: number, future = false): JumpParse {
  const s = text.trim();
  if (!/^\d{1,6}$/.test(s)) return { year: null, why: null, hint: null };
  const n = Number(s);
  if (era && n < 1) return { year: null, why: noYearZero(era), hint: null };
  const y = era ? worldYear(pre, n, era) : n;
  const last = Math.max(0, Math.floor(end));
  if (y > last && future) return { year: last, why: '以后的事还没发生', hint: `回车跳到「现在」（${yearFull(last, era)}）` };
  if (y > last) return { year: last, why: `这个世界只推到${yearFull(last, era)}`, hint: `回车跳到最后一年（${yearFull(last, era)}）` };
  if (y < 0) return { year: 0, why: `这个世界从${yearFull(0, era)}开始`, hint: `回车跳到第一年（${yearFull(0, era)}）` };
  return { year: y, why: null, hint: null };
}
