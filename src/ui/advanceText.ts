/**
 * 推进设置的几句话(纯计算,单测直接测;界面在 StepwiseDialogs.tsx 的 AdvanceFields、侧栏 Stepwise.tsx 的 StepSideGroup):
 *
 * - 「一步走」六档:一个月 / 一季 / 半年 / 一年 / 五年 / 自己填(一个数 + 单位 年 / 个月 / 格,最短 1 格、最长 5 年);
 *   一季、半年存成 64 格、128 格(见 gen/edits.ts 文件头"推进设置")。
 * - 下面那一句只写选中那一档的后果:一步短于一年的写"推得慢"(演绎 100 年要算几步、这台设备上约多久)、
 *   "大事少"(几成的步子全世界没有大事)和好处;一年、五年照原来的说法。
 *   "约多久" = 步数 × 一步要几秒(perStep:这台设备刚才推的速度,还没推过按打开这个世界时量的速度估;不知道 = 不写)。
 *   "几成的步子没有大事"按大事平均每年 QUIET_RATE 件、互不相干估(实测一年一步约七成没有、一个月一步约 96% 没有)。
 * - 「停一下」多一档「每一步」(every = 0):那一句写停几次、没有大事的步子只停几秒。
 */
import { ADVANCE_STEP_MAX, ADVANCE_UNIT_MAX, YEAR_TICKS, type Advance, type AdvanceUnit } from '../gen/edits';
import { EMPTY_STOP_SECS, STEP_RATE, stepMonths, stepYears } from './stepwisePlan';

/** 一段字:b = 加粗 */
export interface Run {
  t: string;
  b?: true;
}

/** 「一步走」的六档 */
export type StepPick = 'month' | 'season' | 'half' | 'year' | 'five' | 'own';

/** 六档各是什么(自己填没有固定的值) */
export const STEP_PICKS: readonly { v: StepPick; label: string; adv?: Pick<Advance, 'step' | 'unit'> }[] = [
  { v: 'month', label: '一个月', adv: { step: 1, unit: 'month' } },
  { v: 'season', label: '一季', adv: { step: YEAR_TICKS / 4, unit: 'tick' } },
  { v: 'half', label: '半年', adv: { step: YEAR_TICKS / 2, unit: 'tick' } },
  { v: 'year', label: '一年', adv: { step: 1, unit: 'year' } },
  { v: 'five', label: '五年', adv: { step: 5, unit: 'year' } },
  { v: 'own', label: '自己填' },
];

/** 这份推进设置是六档里的哪一档(不是前五档的 = 自己填) */
export function stepPickOf(a: Pick<Advance, 'step' | 'unit'>): StepPick {
  return STEP_PICKS.find((p) => p.adv && p.adv.step === a.step && p.adv.unit === a.unit)?.v ?? 'own';
}

/** 自己填的单位 */
export const STEP_UNITS: readonly { v: AdvanceUnit; label: string }[] = [
  { v: 'year', label: '年' },
  { v: 'month', label: '个月' },
  { v: 'tick', label: '格' },
];

/** 自己填的数最多多少:年 5,格 5 × 256,月 5 × 这个世界一年几个月(只写年的照 12 个月) */
export function stepUnitMax(unit: AdvanceUnit, months: number): number {
  return unit === 'month' ? ADVANCE_STEP_MAX * stepMonths(months) : ADVANCE_UNIT_MAX[unit];
}

/** 自己填:数 n、单位 unit → 一步(取整、夹回 1 到这个单位的最多) */
export function ownStep(n: number, unit: AdvanceUnit, months: number): Pick<Advance, 'step' | 'unit'> {
  const k = Number.isFinite(n) ? Math.round(n) : 1;
  return { step: Math.min(stepUnitMax(unit, months), Math.max(1, k)), unit };
}

const CN = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'];
const YEAR_NAMES = ['', '一年', '两年', '三年', '四年', '五年'];

/** 一步多长,写进句子里:"一个月""一季""半年""一年""两年""3 个月""3 格" */
export function stepLabel(a: Pick<Advance, 'step' | 'unit'>): string {
  const pick = stepPickOf(a);
  if (pick !== 'own') return STEP_PICKS.find((p) => p.v === pick)!.label;
  if (a.unit === 'year') return YEAR_NAMES[a.step] ?? `${a.step} 年`;
  return a.unit === 'month' ? `${a.step} 个月` : `${a.step} 格`;
}

/** 侧栏「推进设置」那一行:"一步一年，每 25 年停一下""一步一个月，每一步都停""一步 3 格，每 25 年停一下" */
export function advanceBrief(a: Pick<Advance, 'step' | 'unit' | 'every'>): string {
  const s = stepLabel(a);
  return `一步${/^\d/.test(s) ? ' ' : ''}${s}，${a.every > 0 ? `每 ${a.every} 年停一下` : '每一步都停'}`;
}

/** 大事平均每年几件(估"几成的步子没有大事"用;种子 7、2024 第 500–3000 年实测:一个月一步约 96% 没有) */
export const QUIET_RATE = 0.49;

/** 一步 years 年,全世界没有大事的步子约占几成(0–1) */
export function quietShare(years: number): number {
  return Math.exp(-QUIET_RATE * Math.max(0, years));
}

/** "约 40 秒""约 8 分钟""约 1 分半""约 3 小时""约 2 个半小时" */
export function aboutTime(sec: number): string {
  if (sec < 59.5) return `约 ${Math.max(1, Math.round(sec))} 秒`;
  const m = sec / 60;
  if (m < 59.5) {
    if (m < 9.75) {
      const h = Math.round(m * 2) / 2;
      return h % 1 ? `约 ${Math.floor(h)} 分半` : `约 ${h} 分钟`;
    }
    return `约 ${Math.round(m)} 分钟`;
  }
  const h = Math.round((sec / 3600) * 2) / 2;
  return h % 1 ? `约 ${Math.floor(h)} 个半小时` : `约 ${h} 小时`;
}

/** 演绎 100 年要算几步 */
export function stepsPer100(a: Pick<Advance, 'step' | 'unit'>, months: number): number {
  return Math.round(100 / stepYears(a, months));
}

/**
 * 「一步走」下面那一句(只写选中那一档)。months = 这个世界一年几个月(0 = 只写年);perStep = 这台设备上一步约几秒(不知道 = null);
 * phone = 手机(句子短一点、写"这台手机")
 */
export function stepWhy(a: Pick<Advance, 'step' | 'unit'>, months: number, perStep: number | null, phone: boolean): Run[] {
  const years = stepYears(a, months);
  const label = stepLabel(a);
  if (years >= 1) {
    // 一年以上照原来的说法
    if (years === 1) return [{ t: '一年', b: true }, { t: phone ? '：约七成的步子全世界没有大事，导播一闪而过。' : '：约七成的步子全世界没有大事，导播一闪而过；干预最晚一年后生效。' }];
    const n = YEAR_NAMES[Math.round(years)] ?? `${years} 年`;
    return [{ t: label, b: true }, { t: phone ? `：每一步事多，干预最多要等${n}。` : `：每一步事多，但干预最多要等${n}才生效。` }];
  }
  const pick = stepPickOf(a);
  const out: Run[] = [{ t: label, b: true }];
  if (a.unit === 'tick' && pick === 'own') out.push({ t: phone ? '（一年 256 格，一格约一天半）' : '（一年分 256 格，一格约一天半，推演能分到的最细一刻）' });
  const n = stepsPer100(a, months);
  const veryslow = n > 3000;
  out.push({ t: '：' }, { t: veryslow ? '推得很慢' : '推得慢', b: true });
  let slow = `，演绎 100 年要算 ${n} 步`;
  if (perStep !== null && perStep > 0) {
    slow += `，这台${phone ? '手机' : '电脑'}上${aboutTime(n * perStep)}`;
    if (!phone && !veryslow) {
      slow += `（一步一年${aboutTime(100 * perStep)}）`;
      // 算得比 1× 放得还慢:放的时候播放头追着算,1×、4× 一样快
      if (years / perStep < STEP_RATE[1]) slow += '，放的时候 1×、4× 一样快';
    }
  }
  out.push({ t: `${slow}；` });
  const q = quietShare(years);
  if (q >= 0.99) out.push({ t: '几乎每一步都没有大事', b: true });
  else {
    const what = pick === 'month' ? '月份' : pick === 'season' ? '季度' : pick === 'half' ? '半年' : '步子';
    const share = q >= 0.95 ? ` ${Math.round(q * 100)}% ` : `${CN[Math.round(q * 10)]}成`;
    out.push({ t: '大事少', b: true }, { t: `，约${share}的${what}全世界没有大事` });
  }
  const lead = phone ? '' : '好处是';
  let tail: string;
  if (pick === 'month') tail = `。${lead}干预下个月初就生效，出了大事当月就停。`;
  else if (pick === 'season') tail = `。${lead}干预下一季初就生效，出了大事当季就停。`;
  else if (pick === 'half') tail = `。${lead}干预最晚半年后生效，出了大事半年内就停。`;
  else if (a.unit === 'tick' && a.step * stepMonths(months) < YEAR_TICKS) tail = '；同一个月里的几步，编年史上记的是同一个月。';
  else tail = `。${lead}干预最晚${label}后生效，出了大事${label}内就停。`;
  out.push({ t: tail });
  if (months === 0) out.push({ t: '这个世界只写年，看不出月份。' });
  return out;
}

/** "演绎 100 年停 4 次" */
export function everyNote(every: number): string {
  if (every <= 100) return `演绎 100 年停 ${Math.floor(100 / every)} 次`;
  if (every <= 1000) return `演绎 1000 年停 ${Math.floor(1000 / every)} 次`;
  return `演绎 ${every} 年才停 1 次`;
}

/** 每一步都停时"每 X 停""没有大事的 X":"月""季""半年""年";别的 = null(写"步子") */
function perWord(a: Pick<Advance, 'step' | 'unit'>): string | null {
  const pick = stepPickOf(a);
  return pick === 'month' ? '月' : pick === 'season' ? '季' : pick === 'half' ? '半年' : pick === 'year' ? '年' : null;
}

/** 「停一下」下面那一句 */
export function everyWhy(a: Pick<Advance, 'step' | 'unit' | 'every'>, months: number, phone: boolean): Run[] {
  if (a.every > 0) {
    const head: Run = { t: `每 ${a.every} 年`, b: true };
    return phone
      ? [head, { t: `停一次：${everyNote(a.every)}。隔得越短、开了「出大事也停」，停得越勤。` }]
      : [head, { t: `停一次：${everyNote(a.every)}，每次导播先把这一段的大事放一遍。隔得越短停得越勤；开「出大事也停」故事更有起伏，也停得更多。` }];
  }
  const n = stepsPer100(a, months);
  const label = stepLabel(a);
  const sp = /^\d/.test(label) ? ' ' : '';
  if (phone) {
    const w = perWord(a);
    const every = w ? `就是每${w}停` : `就是每${sp}${label}停一次`;
    return [{ t: '每一步', b: true }, { t: `停一次：一步${sp}${label}${every}，演绎 100 年停 ${n} 次；没有大事的${w ?? '步子'}只停 ${EMPTY_STOP_SECS} 秒。` }];
  }
  return [
    { t: '每一步', b: true },
    { t: `停一次：现在一步${sp}${label}，演绎 100 年停 ${n} 次。这一步没有大事的只停 ${EMPTY_STOP_SECS} 秒，写一句“全世界没有大事”；有大事的照下面的倒计时停。` },
  ];
}
