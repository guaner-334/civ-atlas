/**
 * 纪年:年份的全写 / 短写 / 起止、和第几年互换、没有 0 年;整理(cleanEra);一段字里"第 N 年"换成纪年的写法;
 * 时间轴刻度对准元年;作者填年份不合格时的提示;存档、分享链接带着纪年往返,认不出的按第几年写;
 * 改纪年不记撤销步。没设纪年时每一处写法都和原来一样。
 * 月份:一年几个月、整年的事不写月、和纪年一起的写法、存档带着走;月份的名字:有名字写名字、空着写数字、太长的不存、存档带着走;
 * 跳到某一年:填的字怎么算回第几年、超出范围怎么提示。
 */
import { describe, expect, it } from 'vitest';
import {
  ERA_DEFAULT,
  MONTHS_DEFAULT,
  MONTHS_MAX,
  MONTH_NAME_MAX,
  cleanEra,
  cleanMonthName,
  cleanMonthNames,
  cleanMonths,
  eraLabel,
  eraNote,
  eraText,
  eraYear,
  eraZero,
  epochOfZero,
  monthLabel,
  monthNamesInUse,
  monthOf,
  monthsOf,
  noYearZero,
  parseJump,
  sameEra,
  sameMonthNames,
  spaced,
  worldYear,
  yearAt,
  yearFull,
  yearMonthAt,
  yearMonthFull,
  yearShort,
  yearShortAt,
  yearSpan,
  yearSpanAt,
  yearTooEarly,
  yearTooLate,
  type Era,
} from '../src/gen/era';
import { evYears, rulerLabel, rulerOf } from '../src/ui/timelineLayout';
import { EMPTY_EDITS, type WorldEdits } from '../src/gen/edits';
import { DEFAULT_PARAMS } from '../src/gen/world';
import { decodeShare, editCount, editsLost, encodeShare, makeSave, parseSave, saveText } from '../src/gen/savefile';
import { currentMonthNames, currentMonths, getEdits, revertEdits, setEdits, setEra, setMonthNames, setMonths } from '../src/ui/editsStore';
import { chronicleDocument, chronicleText, type ChronicleEntry } from '../src/gen/civ/chronicle';
import type { Civ } from '../src/gen/civ/types';
import { parseChapter } from '../src/ui/BookReader';
import { draftProblem, type MarkDraft } from '../src/ui/markStore';
import { INTERVENTION_YEAR_MAX } from '../src/gen/edits';

const AD: Era = { name: '公元', epoch: 2500 };
const LIXI: Era = { name: '利希历', epoch: 1610, by: 'event', event: { tag: '创', text: '利希昂于菲内拉斯创立利希教' } };

describe('写法', () => {
  it('第 0 年是公元前 2500 年:第 2499 年公元前 1 年,第 2500 年公元元年,第 3000 年公元 501 年', () => {
    expect(yearFull(0, AD)).toBe('公元前 2500 年');
    expect(yearFull(2499, AD)).toBe('公元前 1 年');
    expect(yearFull(2500, AD)).toBe('公元元年');
    expect(yearFull(2501, AD)).toBe('公元 2 年');
    expect(yearFull(3000, AD)).toBe('公元 501 年');
    expect(yearFull(1650.7, AD)).toBe('公元前 850 年');
  });

  it('短写:前 850 / 元年 / 501;刻度上不空格', () => {
    expect(yearShort(1650, AD)).toBe('前 850');
    expect(yearShort(2500, AD)).toBe('元年');
    expect(yearShort(3000, AD)).toBe('501');
    expect(yearShortAt(1650, AD)).toBe('前 850 年');
    expect(yearShortAt(2500, AD)).toBe('元年');
    expect(rulerLabel(500, AD)).toBe('前2000');
    expect(rulerLabel(2500, AD)).toBe('元年');
  });

  it('起止:同在元年以前 / 以后的省掉后一个名字,跨过元年或碰到元年的两头写全', () => {
    expect(yearSpan(1680, 1689, AD)).toBe('前 820–前 811');
    expect(yearSpanAt(1680, 1689, AD)).toBe('公元前 820–前 811 年');
    expect(yearSpanAt(2524, 2719, AD)).toBe('公元 25–220 年');
    expect(yearSpanAt(2497, 2504, AD)).toBe('公元前 3 年–公元 5 年');
    expect(yearSpanAt(2500, 2510, AD)).toBe('公元元年–公元 11 年');
    expect(yearSpanAt(1680, 1689, AD, '—')).toBe('公元前 820—前 811 年');
  });

  it('没设纪年:和原来一字不差', () => {
    expect(yearFull(1650.4)).toBe('第 1650 年');
    expect(yearAt(1601)).toBe('1601 年');
    expect(yearShort(1650)).toBe('1650');
    expect(yearShortAt(1360)).toBe('1360 年');
    expect(yearSpan(820, 811)).toBe('820–811');
    expect(yearSpanAt(820, 911)).toBe('820–911 年');
    expect(spaced(yearAt(1650))).toBe(' 1650 年');
    expect(spaced(yearAt(1650, AD))).toBe('公元前 850 年');
    expect(evYears({ year: 2629, end: 2629, ongoing: false })).toBe('2629 年');
    expect(evYears({ year: 2940, end: 2957, ongoing: false })).toBe('2940–2957 年');
    expect(evYears({ year: 2987, end: 3000, ongoing: true })).toBe('2987 年起');
    expect(eraText('第 1200 年,昌国立国')).toBe('第 1200 年,昌国立国');
    expect(rulerLabel(1000)).toBe('1000');
  });

  it('事件卡片的年份按纪年写', () => {
    expect(evYears({ year: 1650, end: 1650, ongoing: false }, AD)).toBe('公元前 850 年');
    expect(evYears({ year: 1680, end: 1689, ongoing: false }, AD)).toBe('公元前 820–前 811 年');
    expect(evYears({ year: 2987, end: 3000, ongoing: true }, AD)).toBe('公元 488 年起');
  });

  it('别的名字:元年以前一律名字后面加「前」;侧栏写「公元纪年」/ 名字', () => {
    expect(yearFull(1609, LIXI)).toBe('利希历前 1 年');
    expect(yearFull(1610, LIXI)).toBe('利希历元年');
    expect(yearFull(1650, LIXI)).toBe('利希历 41 年');
    expect(eraLabel(AD)).toBe('公元纪年');
    expect(eraLabel(LIXI)).toBe('利希历');
  });

  it('和第几年互换;第 0 年那一格', () => {
    for (const y of [0, 1, 1650, 2499, 2500, 2501, 3000]) {
      const { pre, n } = eraYear(y, AD);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(worldYear(pre, n, AD)).toBe(y);
    }
    expect(eraZero(AD)).toEqual({ pre: true, n: 2500 });
    // 第 0 年是公元 100 年:元年在第 0 年以前
    const late: Era = { name: '公元', epoch: epochOfZero(false, 100) };
    expect(late.epoch).toBe(-99);
    expect(eraZero(late)).toEqual({ pre: false, n: 100 });
    expect(yearFull(0, late)).toBe('公元 100 年');
    // 第 0 年是公元元年
    expect(yearFull(0, { name: '公元', epoch: epochOfZero(false, 1) })).toBe('公元元年');
  });
});

describe('一段字里的年份', () => {
  it('"第 N 年""第 A—B 年"换成纪年;年数、州、章不换', () => {
    expect(eraText('第 1650 年,昌国立国', AD)).toBe('公元前 850 年,昌国立国');
    expect(eraText('第 1680—1689 年 昌渭之战', AD)).toBe('公元前 820—前 811 年 昌渭之战');
    expect(eraText('保护有鹰王朝(至第 2600 年)', AD)).toBe('保护有鹰王朝(至公元 101 年)');
    expect(eraText('享国 312 年,第 3 州,第一章', AD)).toBe('享国 312 年,第 3 州,第一章');
    expect(eraText('第1650年', AD)).toBe('公元前 850 年');
  });

  it('史书的卷名:年份按纪年短写', () => {
    expect(parseChapter('卷一 诸部初立(第 0—1045 年)', AD)).toEqual({ n: '卷一', t: '诸部初立', y: '前 2500–前 1455' });
    expect(parseChapter('卷一 诸部初立(第 0—1045 年)')).toEqual({ n: '卷一', t: '诸部初立', y: '0–1045' });
  });

  it('给 AI 的说明:元年、两头、怎么换算', () => {
    const t = eraNote(AD, 3000);
    expect(t).toContain('第 2500 年是公元元年');
    expect(t).toContain('第 0 年是公元前 2500 年');
    expect(t).toContain('第 3000 年是公元 501 年');
    expect(t).toContain('"第 N 年"');
  });
});

describe('作者填年份的提示', () => {
  it('没有 0 年、太早、太晚', () => {
    expect(noYearZero(AD)).toBe('公元没有 0 年');
    expect(yearTooEarly(AD)).toBe('年份最早填到公元前 2500 年');
    expect(yearTooEarly()).toBe('年份最早填到 0 年');
    expect(yearTooLate(3000, AD)).toBe('年份最晚填到公元 501 年');
    expect(yearTooLate(3000)).toBe('年份最大填到 3000');
  });
});

describe('标记卡片的年份(设了纪年)', () => {
  const d = (over: Partial<MarkDraft>): MarkDraft => ({ id: 0, title: '', note: '', color: 'red', fromText: '2490', toText: '', scope: 'point', at: [1, 2], regions: [], ...over });

  it('填了 0 年、早于第 0 年、晚于能存的最后一年:按纪年提示;没设纪年照旧', () => {
    setEdits({ ...EMPTY_EDITS, era: AD });
    expect(draftProblem(d({}))).toBeNull();
    expect(draftProblem(d({ fromText: 'x' }))).toBe('公元没有 0 年');
    expect(draftProblem(d({ fromText: '-1' }))).toBe('年份最早填到公元前 2500 年');
    // 纪年的年数能写到 6 位,换成第几年可能是 7 位:照样说范围,不说"没填"
    expect(draftProblem(d({ fromText: '-900000' }))).toBe('年份最早填到公元前 2500 年');
    expect(draftProblem(d({ toText: '1099998' }))).toBe(`年份最晚填到${yearFull(INTERVENTION_YEAR_MAX, AD)}`);
    expect(draftProblem(d({ toText: String(INTERVENTION_YEAR_MAX + 1) }))).toBe(`年份最晚填到${yearFull(INTERVENTION_YEAR_MAX, AD)}`);
    setEdits(EMPTY_EDITS);
    expect(draftProblem(d({ fromText: 'x' }))).toBe('填一下从哪年开始');
    expect(draftProblem(d({ fromText: '-1' }))).toBe('填一下从哪年开始');
  });
});

describe('整理', () => {
  it('名字 1–4 个字、去掉空白;元年是范围里的整数;按一件事的记下那件事', () => {
    expect(cleanEra(AD)).toEqual(AD);
    expect(cleanEra(LIXI)).toEqual(LIXI);
    expect(cleanEra({ name: ' 利 希历 ', epoch: 3 })).toEqual({ name: '利希历', epoch: 3 });
    expect(cleanEra({ name: '', epoch: 3 })).toBeUndefined();
    expect(cleanEra({ name: '五个字的历', epoch: 3 })).toBeUndefined();
    expect(cleanEra({ name: '公元', epoch: 1.5 })).toBeUndefined();
    expect(cleanEra({ name: '公元', epoch: 100000 })).toBeUndefined();
    expect(cleanEra({ name: '公元', epoch: -99998 })).toEqual({ name: '公元', epoch: -99998 });
    expect(cleanEra({ name: '公元', epoch: -99999 })).toBeUndefined();
    expect(cleanEra({ name: '公元', epoch: '2500' })).toBeUndefined();
    expect(cleanEra(null)).toBeUndefined();
    expect(cleanEra([AD])).toBeUndefined();
    // 按一件事、还没选:只记 by
    expect(cleanEra({ name: '公元', epoch: 2500, by: 'event' })).toEqual({ name: '公元', epoch: 2500, by: 'event' });
    // 那件事的正文去掉控制字符,截到 200 字;标签最多两个字
    const e = cleanEra({ name: '公元', epoch: 2500, by: 'event', event: { tag: '创立', text: `a\u0000b${'字'.repeat(300)}` } });
    expect(e?.event?.tag).toBe('创立');
    expect([...(e?.event?.text ?? '')].length).toBe(200);
    expect(e?.event?.text.startsWith('ab')).toBe(true);
    // 那一条在编年史里的编号:合格的留着(改名以后认得出),别的丢掉
    const ev = (key: unknown) => cleanEra({ ...LIXI, event: { ...LIXI.event, key } })?.event?.key;
    expect(ev('found:12')).toBe('found:12');
    expect(ev('faith:3')).toBe('faith:3');
    expect(ev('found:-1')).toBeUndefined();
    expect(ev('<b>:1')).toBeUndefined();
    expect(ev(12)).toBeUndefined();
    expect(sameEra(AD, { ...AD })).toBe(true);
    expect(sameEra(AD, undefined)).toBe(false);
    expect(ERA_DEFAULT).toEqual({ name: '公元', epoch: 2500 });
  });
});

describe('时间轴刻度', () => {
  it('没设纪年和原来一样', () => {
    expect(rulerOf(3000)).toEqual({ major: 1000, minor: 100, mid: 500, origin: 0, labels: [0, 1000, 2000, 3000] });
  });

  it('对准元年:前 2000、前 1000、元年、公元 1000 年不够远就不写;两头写起止', () => {
    const r = rulerOf(3000, AD);
    expect(r.origin).toBe(2500);
    expect(r.labels).toEqual([0, 500, 1500, 2500, 3000]);
    expect(r.labels.map((y) => rulerLabel(y, AD))).toEqual(['前2500', '前2000', '前1000', '元年', '501']);
    // 公元 1000 年 = 第 3499 年
    expect(rulerOf(6000, AD).labels).toContain(3499);
  });

  it('离两头太近的不写', () => {
    // 元年在第 100 年:离第 0 年不到半个大格
    const r = rulerOf(3000, { name: '公元', epoch: 100 });
    expect(r.labels).not.toContain(100);
    expect(r.labels[0]).toBe(0);
    expect(r.labels[r.labels.length - 1]).toBe(3000);
  });

  it('推到 60000 年:字不超过七八个;元年离开头不到半个大格,不写', () => {
    const r = rulerOf(60000, AD);
    expect(r.labels).not.toContain(2500);
    expect(r.labels).toContain(12499);
    expect(r.major).toBe(10000);
    expect(r.labels.length).toBeLessThanOrEqual(8);
    expect(new Set(r.labels).size).toBe(r.labels.length);
    expect([...r.labels].sort((a, b) => a - b)).toEqual(r.labels);
  });
});

describe('存档', () => {
  const edits = (era?: Era): WorldEdits => ({ ...EMPTY_EDITS, ...(era ? { era } : {}) });

  it('存档、分享链接带着纪年往返;按第几年写时不写这一项', async () => {
    const save = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, edits(LIXI), 'c');
    expect(save.edits.era).toEqual(LIXI);
    const r = parseSave(saveText(save));
    expect(r.ok && r.save.edits.era).toEqual(LIXI);
    expect(r.ok && r.warnings).toEqual([]);
    const d = await decodeShare(await encodeShare(save));
    expect(d.ok && d.save.edits.era).toEqual(LIXI);

    const plain = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, edits(), 'c');
    expect('era' in plain.edits).toBe(false);
    const p = parseSave(saveText(plain));
    expect(p.ok && 'era' in p.save.edits).toBe(false);
  });

  it('认不出的纪年按第几年写,提示一句', () => {
    const save = JSON.parse(saveText(makeSave({ ...DEFAULT_PARAMS, seed: 7 }, edits(), 'c'))) as { edits: Record<string, unknown> };
    save.edits.era = { name: '', epoch: 'x' };
    const r = parseSave(JSON.stringify(save));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save.edits.era).toBeUndefined();
    expect(r.warnings).toContain('纪年认不出来,年份按第几年写');
  });

  it('纪年算一处修改;两份存档纪年不同算丢一处', () => {
    expect(editCount(edits(AD))).toBe(editCount(edits()) + 1);
    const a = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, edits(AD), 'c');
    const b = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, edits(LIXI), 'c');
    expect(editsLost(a, b)).toBe(1);
    expect(editsLost(a, makeSave({ ...DEFAULT_PARAMS, seed: 7 }, edits({ ...AD }), 'c'))).toBe(0);
  });

  it('改纪年不记撤销步:撤销别的修改时纪年照现在的留着;不合格的不改', () => {
    setEdits(EMPTY_EDITS);
    setEra(AD);
    expect(getEdits().era).toEqual(AD);
    const before = getEdits();
    const after = { ...before, names: { 'polity:c1#0': '昌' } };
    setEdits(after);
    setEra(LIXI);
    expect(revertEdits(getEdits(), after, before).era).toEqual(LIXI);
    setEra({ name: '', epoch: 1 });
    expect(getEdits().era).toEqual(LIXI);
    setEra(undefined);
    expect('era' in getEdits()).toBe(false);
    setEdits(EMPTY_EDITS);
  });
});

describe('月份', () => {
  it('一年 12 个月:年里过了几成 × 12,取整 + 1;正好在年初(整年算的事)不写月', () => {
    expect(monthOf(1638, 12)).toBe(0);
    expect(monthOf(1638 + 1 / 256, 12)).toBe(1);
    expect(monthOf(1638.5, 12)).toBe(7);
    expect(monthOf(1638 + 255 / 256, 12)).toBe(12);
    expect(monthOf(1638 + 255 / 256, 24)).toBe(24);
    expect(monthOf(1638.5, 24)).toBe(13);
    expect(monthOf(1638.5, 0)).toBe(0);
    expect(monthOf(Number.NaN, 12)).toBe(0);
    // 一年 256 格,每格都落在 1–N 月里
    for (const n of [2, 12, 24, 36]) {
      for (let t = 1; t < 256; t++) {
        const m = monthOf(10 + t / 256, n);
        expect(m >= 1 && m <= n).toBe(true);
      }
    }
  });

  it('写法:第 1638 年 11 月、1638 年 11 月;和纪年一起写成公元前 850 年 3 月;只写年和原来一样', () => {
    const y = 1638 + 230 / 256;
    expect(yearMonthFull(y, 12)).toBe('第 1638 年 11 月');
    expect(yearMonthAt(y, 12)).toBe('1638 年 11 月');
    expect(yearMonthFull(y, 0)).toBe(yearFull(y));
    expect(yearMonthAt(1638, 12)).toBe(yearAt(1638));
    expect(yearMonthFull(1650 + 50 / 256, 12, AD)).toBe('公元前 850 年 3 月');
    expect(yearMonthAt(1650 + 50 / 256, 12, AD)).toBe(yearAt(1650, AD) + ' 3 月');
    expect(yearMonthFull(2500.99, 24, AD)).toBe('公元元年 24 月');
  });

  it('时间轴提示、编年史复制全文写到月;跨年的战争写起止,里面每一仗写到月', () => {
    const e = (year: number, text: string, extra: Partial<ChronicleEntry> = {}) => ({ year, end: year, text, ...extra }) as ChronicleEntry;
    expect(evYears(e(1638 + 230 / 256, 'a'), undefined, 12)).toBe('1638 年 11 月');
    expect(evYears(e(1638 + 230 / 256, 'a'))).toBe('1638 年');
    const war = e(1631.95, '伐之', { end: 1655.05, children: [e(1631.95, '起兵'), e(1636, '会盟')] });
    expect(chronicleText([war], undefined, undefined, 12).split('\n')).toEqual(['第 1631—1655 年 伐之', '    第 1631 年 12 月 起兵', '    第 1636 年 会盟']);
    expect(chronicleText([war]).split('\n')[1]).toBe('    第 1631 年 起兵');
    expect(chronicleText([war], undefined, AD, 12).split('\n')[1]).toBe('    公元前 869 年 12 月 起兵');
  });

  it('整理:0 = 只写年,2–36 照存,12(默认)和认不出的不存', () => {
    expect(cleanMonths(0)).toBe(0);
    expect(cleanMonths(24)).toBe(24);
    expect(cleanMonths(2)).toBe(2);
    expect(cleanMonths(36)).toBe(36);
    for (const bad of [12, 1, 37, 1.5, -3, '24', null, undefined, Number.NaN]) expect(cleanMonths(bad)).toBeUndefined();
    expect(monthsOf(undefined)).toBe(MONTHS_DEFAULT);
    expect(monthsOf(0)).toBe(0);
    expect(monthsOf(99)).toBe(12);
  });

  it('存档、分享链接带着月份往返;一年 12 个月时不写这一项;认不出的按 12 个月写,提示一句', async () => {
    const save = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...EMPTY_EDITS, months: 24 }, 'c');
    expect(save.edits.months).toBe(24);
    const r = parseSave(saveText(save));
    expect(r.ok && r.save.edits.months).toBe(24);
    expect(r.ok && r.warnings).toEqual([]);
    const d = await decodeShare(await encodeShare(save));
    expect(d.ok && d.save.edits.months).toBe(24);
    const off = parseSave(saveText(makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...EMPTY_EDITS, months: 0 }, 'c')));
    expect(off.ok && off.save.edits.months).toBe(0);

    const plain = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...EMPTY_EDITS, months: 12 }, 'c');
    expect('months' in plain.edits).toBe(false);

    const raw = JSON.parse(saveText(plain)) as { edits: Record<string, unknown> };
    raw.edits.months = 99;
    const w = parseSave(JSON.stringify(raw));
    expect(w.ok && 'months' in w.save.edits).toBe(false);
    expect(w.ok && w.warnings).toContain('月份设定认不出来,按一年 12 个月写');
  });

  it('月份算一处修改;两份存档月份不同算丢一处', () => {
    expect(editCount({ ...EMPTY_EDITS, months: 0 })).toBe(editCount(EMPTY_EDITS) + 1);
    expect(editCount({ ...EMPTY_EDITS, months: 12 })).toBe(editCount(EMPTY_EDITS));
    const a = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...EMPTY_EDITS, months: 24 }, 'c');
    const b = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, EMPTY_EDITS, 'c');
    expect(editsLost(a, b)).toBe(1);
    expect(editsLost(b, makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...EMPTY_EDITS, months: 12 }, 'c'))).toBe(0);
  });

  it('改月份不记撤销步:撤销别的修改时月份照现在的留着;不合格的不改;改回 12 不写这一项', () => {
    setEdits(EMPTY_EDITS);
    expect(currentMonths()).toBe(12);
    setMonths(24);
    expect(currentMonths()).toBe(24);
    const before = getEdits();
    const after = { ...before, names: { 'polity:c1#0': '昌' } };
    setEdits(after);
    setMonths(0);
    expect(revertEdits(getEdits(), after, before).months).toBe(0);
    setMonths(40);
    expect(currentMonths()).toBe(0);
    setMonths(12);
    expect('months' in getEdits()).toBe(false);
    setEdits(EMPTY_EDITS);
  });
});

describe('月份的名字', () => {
  const N12 = ['端月', '杏月', '桃月', '槐月', '蒲月', '荷月', '兰月', '桂月', '菊月', '阳月', '葭月', '冰月'];
  /** 第 y 年第 m 月(一年 n 个月)里的一刻 */
  const at = (y: number, m: number, n = 12) => y + (m - 0.5) / n;

  it('有名字写名字,紧跟在"年"后面;空着的照旧写数字;整年的事不写月;和纪年一起写', () => {
    expect(yearMonthFull(at(1552, 1), 12, null, N12)).toBe('第 1552 年端月');
    expect(yearMonthAt(at(1549, 8), 12, null, N12)).toBe('1549 年桂月');
    expect(yearMonthFull(at(1552, 1), 12, AD, N12)).toBe('公元前 948 年端月');
    expect(yearMonthFull(at(2500, 12), 12, AD, N12)).toBe('公元元年冰月');
    const some = ['端月', '', '桃月'];
    expect(yearMonthFull(at(1552, 2), 12, null, some)).toBe('第 1552 年 2 月');
    expect(yearMonthFull(at(1552, 11), 12, null, some)).toBe('第 1552 年 11 月');
    expect(yearMonthFull(at(1552, 3), 12, null, some)).toBe('第 1552 年桃月');
    expect(yearMonthFull(1552, 12, null, N12)).toBe('第 1552 年');
    expect(yearMonthFull(at(1552, 1), 0, null, N12)).toBe('第 1552 年');
    // 没有名字:和以前一字不差
    expect(yearMonthFull(at(1638, 11), 12, null, undefined)).toBe(yearMonthFull(at(1638, 11), 12));
    expect(monthLabel(3, N12)).toBe('桃月');
    expect(monthLabel(3, ['', ''])).toBe('3 月');
    expect(monthLabel(13)).toBe('13 月');
  });

  it('编年史、时间轴提示、复制全文、导出都写名字;跨年的战争写起止,里面每一仗写名字', () => {
    const e = (year: number, text: string, extra: Partial<ChronicleEntry> = {}) => ({ year, end: year, text, ...extra }) as ChronicleEntry;
    expect(evYears(e(at(1549, 8), 'a'), undefined, 12, N12)).toBe('1549 年桂月');
    expect(evYears(e(at(1549, 8), 'a'), AD, 12, N12)).toBe('公元前 951 年桂月');
    const war = e(at(1631, 12), '伐之', { end: 1655.05, children: [e(at(1631, 12), '起兵'), e(1636, '会盟'), e(at(1640, 5), '围城')] });
    expect(chronicleText([war], undefined, undefined, 12, N12).split('\n')).toEqual(['第 1631—1655 年 伐之', '    第 1631 年冰月 起兵', '    第 1636 年 会盟', '    第 1640 年蒲月 围城']);
    expect(chronicleText([war], undefined, AD, 12, N12).split('\n')[1]).toBe('    公元前 869 年冰月 起兵');
    const civ = { endYear: 3000 } as Civ;
    const doc = chronicleDocument(civ, { format: 'txt', seed: 7, entries: [war], months: 12, monthNames: N12 });
    expect(doc).toContain('    第 1640 年蒲月 围城');
    expect(chronicleDocument(civ, { format: 'md', seed: 7, entries: [war], months: 12, monthNames: ['', '', '', '', '*蒲*'] })).toContain('  - 第 1640 年\\*蒲\\* 围城');
  });

  it('整理:去掉前后空白;超过 4 个字的那一格不存(当没起名);末尾空着的去掉;一个名字都没有 = 不写', () => {
    expect(MONTH_NAME_MAX).toBe(4);
    expect(cleanMonthName(' 端月 ')).toBe('端月');
    expect(cleanMonthName('槐花飘香')).toBe('槐花飘香');
    expect(cleanMonthName('槐花飘香月')).toBe('');
    expect(cleanMonthName('Frost')).toBe('');
    expect(cleanMonthName('Ice')).toBe('Ice');
    expect(cleanMonthName(3)).toBe('');
    expect(cleanMonthNames({ names: ['端月', ' 杏月', '槐花飘香月', '', '', ''] })).toEqual({ names: ['端月', '杏月'] });
    expect(cleanMonthNames({ names: ['', '', '桃月'], off: true })).toEqual({ names: ['', '', '桃月'], off: true });
    expect(cleanMonthNames({ names: ['桃月'], off: 1 })).toEqual({ names: ['桃月'] });
    expect(cleanMonthNames({ names: Array.from({ length: 50 }, () => '月') })?.names.length).toBe(MONTHS_MAX);
    for (const bad of [undefined, null, 12, '端月', ['端月'], { names: [] }, { names: ['', ' '] }, { names: '端月' }]) expect(cleanMonthNames(bad)).toBeUndefined();
    expect(sameMonthNames({ names: ['端月'] }, { names: ['端月'] })).toBe(true);
    expect(sameMonthNames({ names: ['端月'] }, { names: ['端月'], off: true })).toBe(false);
    expect(sameMonthNames(undefined, undefined)).toBe(true);
    expect(monthNamesInUse({ names: N12 })).toEqual(N12);
    expect(monthNamesInUse({ names: N12, off: true })).toBeUndefined();
  });

  it('存档、分享链接带着名字往返;旧存档、旧分享没有这一项照旧写数字;认不出的名字当没起名,提示一句', async () => {
    const edits: WorldEdits = { ...EMPTY_EDITS, months: 24, monthNames: { names: ['立春', '雨水', '', '春分'] } };
    const save = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, edits, 'c');
    expect(save.edits.monthNames).toEqual({ names: ['立春', '雨水', '', '春分'] });
    const r = parseSave(saveText(save));
    expect(r.ok && r.save.edits.monthNames).toEqual({ names: ['立春', '雨水', '', '春分'] });
    expect(r.ok && r.warnings).toEqual([]);
    const d = await decodeShare(await encodeShare(save));
    expect(d.ok && d.save.edits.monthNames).toEqual({ names: ['立春', '雨水', '', '春分'] });
    const off = parseSave(saveText(makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...EMPTY_EDITS, monthNames: { names: ['端月'], off: true } }, 'c')));
    expect(off.ok && off.save.edits.monthNames).toEqual({ names: ['端月'], off: true });

    // 没起名字(旧存档、旧分享链接都是这样):不写这一项,读回来也没有,写数字
    const plain = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...EMPTY_EDITS, months: 24 }, 'c');
    expect('monthNames' in plain.edits).toBe(false);
    const old = parseSave(saveText(plain));
    expect(old.ok && 'monthNames' in old.save.edits).toBe(false);
    expect(old.ok && old.warnings).toEqual([]);
    expect(monthNamesInUse(old.ok ? old.save.edits.monthNames : undefined)).toBeUndefined();
    const oldShare = await decodeShare(await encodeShare(plain));
    expect(oldShare.ok && 'monthNames' in oldShare.save.edits).toBe(false);
    expect('monthNames' in makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...EMPTY_EDITS, monthNames: { names: ['', ''] } }, 'c').edits).toBe(false);

    const raw = JSON.parse(saveText(plain)) as { edits: Record<string, unknown> };
    raw.edits.monthNames = { names: ['端月', '槐花飘香月', 7, '', '桃月'] };
    const w = parseSave(JSON.stringify(raw));
    expect(w.ok && w.save.edits.monthNames).toEqual({ names: ['端月', '', '', '', '桃月'] });
    expect(w.ok && w.warnings).toContain('有 2 个月份的名字认不出来,照旧写数字');
    raw.edits.monthNames = '端月';
    const w2 = parseSave(JSON.stringify(raw));
    expect(w2.ok && 'monthNames' in w2.save.edits).toBe(false);
    expect(w2.ok && w2.warnings).toContain('月份的名字认不出来,照旧写数字');
  });

  it('名字算一处修改;两份存档名字不同算丢一处', () => {
    expect(editCount({ ...EMPTY_EDITS, monthNames: { names: ['端月'] } })).toBe(editCount(EMPTY_EDITS) + 1);
    const a = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...EMPTY_EDITS, monthNames: { names: ['端月'] } }, 'c');
    const b = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...EMPTY_EDITS, monthNames: { names: ['杏月'] } }, 'c');
    expect(editsLost(a, b)).toBe(1);
    expect(editsLost(a, makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...EMPTY_EDITS, monthNames: { names: ['端月'] } }, 'c'))).toBe(0);
  });

  it('改名字不记撤销步;改一年几个月以后名字跟着格子走,多出来的留着;只写年、换回数字时名字留着', () => {
    setEdits(EMPTY_EDITS);
    expect(currentMonthNames()).toBeUndefined();
    setMonths(24);
    setMonthNames({ names: ['立春', '雨水', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '小雪', '大雪', '冬至'] });
    expect(currentMonthNames()?.length).toBe(24);
    expect(yearMonthFull(at(1552, 23, 24), currentMonths(), null, currentMonthNames())).toBe('第 1552 年大雪');
    // 改成一年 12 个月:第 13 月以后的名字留着,只是写不到
    setMonths(12);
    expect(getEdits().monthNames?.names.length).toBe(24);
    expect(yearMonthFull(at(1552, 12), currentMonths(), null, currentMonthNames())).toBe('第 1552 年 12 月');
    expect(yearMonthFull(at(1552, 2), currentMonths(), null, currentMonthNames())).toBe('第 1552 年雨水');
    // 改回 24 个月:名字还在
    setMonths(24);
    expect(yearMonthFull(at(1552, 23, 24), currentMonths(), null, currentMonthNames())).toBe('第 1552 年大雪');
    // 只写年:名字不出现,也留着
    setMonths(0);
    expect(yearMonthFull(at(1552, 23, 24), currentMonths(), null, currentMonthNames())).toBe('第 1552 年');
    expect(getEdits().monthNames?.names[22]).toBe('大雪');
    setMonths(24);
    // 换回数字:名字留着,写数字;换回自己起名还在
    const named = getEdits().monthNames!;
    setMonthNames({ names: named.names, off: true });
    expect(currentMonthNames()).toBeUndefined();
    expect(yearMonthFull(at(1552, 23, 24), currentMonths(), null, currentMonthNames())).toBe('第 1552 年 23 月');
    setMonthNames({ names: getEdits().monthNames!.names });
    expect(currentMonthNames()?.[22]).toBe('大雪');
    // 撤销别的修改时名字照现在的留着
    const before = getEdits();
    const after = { ...before, names: { 'polity:c1#0': '昌' } };
    setEdits(after);
    setMonthNames({ names: ['端月'] });
    expect(revertEdits(getEdits(), after, before).monthNames).toEqual({ names: ['端月'] });
    // 一个名字都不剩:去掉这一项
    setMonthNames({ names: ['', ''] });
    expect('monthNames' in getEdits()).toBe(false);
    setEdits(EMPTY_EDITS);
  });
});

describe('跳到某一年', () => {
  it('没设纪年:填第几年;空着、不是数字不跳也不提示', () => {
    expect(parseJump('1400', false, undefined, 3000)).toEqual({ year: 1400, why: null, hint: null });
    expect(parseJump('0', false, undefined, 3000)).toEqual({ year: 0, why: null, hint: null });
    expect(parseJump('3000', false, undefined, 3000)).toEqual({ year: 3000, why: null, hint: null });
    expect(parseJump('', false, undefined, 3000)).toEqual({ year: null, why: null, hint: null });
    expect(parseJump('12a', false, undefined, 3000).year).toBeNull();
    expect(parseJump('1234567', false, undefined, 3000).year).toBeNull();
  });

  it('超出这个世界:提示一句,回车停在最后一年', () => {
    expect(parseJump('3500', false, undefined, 3000)).toEqual({
      year: 3000,
      why: '这个世界只推到第 3000 年',
      hint: '回车跳到最后一年（第 3000 年）',
    });
    expect(parseJump('900', false, undefined, 800.5).year).toBe(800);
  });

  it('设了纪年:按纪年算回第几年;没有 0 年;早于第 0 年停在第一年', () => {
    expect(parseJump('1300', true, AD, 3000)).toEqual({ year: 1200, why: null, hint: null });
    expect(parseJump('1', false, AD, 3000).year).toBe(2500);
    expect(parseJump('501', false, AD, 3000).year).toBe(3000);
    expect(parseJump('0', true, AD, 3000)).toEqual({ year: null, why: noYearZero(AD), hint: null });
    expect(parseJump('3000', true, AD, 3000)).toEqual({
      year: 0,
      why: '这个世界从公元前 2500 年开始',
      hint: '回车跳到第一年（公元前 2500 年）',
    });
    expect(parseJump('900', false, AD, 3000)).toMatchObject({ year: 3000, why: '这个世界只推到公元 501 年' });
  });
});
