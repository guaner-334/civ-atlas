/**
 * 照故事找世界那一页上的话:条件写成一句话(搜的时候顶上的概括、点开一个结果的「条件逐条」、卡在哪几条)、
 * 差在哪("差：隘口只比山脊低 637 米")、放宽一点怎么说("翻山降到两成")。纯文字,不碰 DOM;
 * 要用到地名的(港口叫什么、交界那州叫什么)由调用的地方另外补上。
 */
import { ERAS } from '../gen/civ/development';
import {
  LARGE,
  MEDIUM_MIN,
  SMALL_ALONE,
  SMALL_RATIO,
  condList,
  relaxCond,
  type Check,
  type Fact,
  type FateKind,
  type FinderCond,
  type FinderQuery,
  type FinderRow,
  type RelaxHint,
  type RoleCond,
  type TogetherCond,
} from '../gen/finder/query';

/** 时代名(青铜、铁器……);认不出 = "第 N 个" */
export const eraName = (i: number | null | undefined): string => (i !== null && i !== undefined && ERAS[i] ? ERAS[i] : `第 ${(i ?? 0) + 1} 个`);

const CN = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'];
/** 几成:0.2 → "两成" */
export const tenths = (x: number): string => {
  const n = Math.round(x * 10);
  return n >= 0 && n <= 10 ? `${CN[n]}成` : `${Math.round(x * 100)}%`;
};
/** 几国:3 → "三国" */
export const nations = (n: number): string => `${n >= 0 && n <= 10 ? CN[n] : n}国`;

/** 一国的叫法(下标认不出 = "另一国") */
const roleName = (q: FinderQuery, i: number) => q.roles[i]?.name || '另一国';

const FATE_NAMES: Record<FateKind, string> = { fall: '亡', split: '分裂', dynasty: '改朝' };
/** 亡、分裂、改朝里选了哪几种:"分裂或亡" */
export function fateText(what: readonly FateKind[]): string {
  const order: FateKind[] = ['split', 'fall', 'dynasty'];
  const w = order.filter((k) => what.includes(k));
  return w.length ? w.map((k) => FATE_NAMES[k]).join('或') : '亡';
}

/** 大小那一档的说明("40 州以上""不到帝国的一半") */
export function sizeHint(q: FinderQuery, role: number, c: Extract<RoleCond, { kind: 'size' }>): string {
  if (c.size === 'small') {
    const other = q.roles.findIndex((_, i) => i !== role);
    const r = c.ratio ?? SMALL_RATIO;
    const part = r === 0.5 ? '一半' : tenths(r);
    return other >= 0 ? `不到${roleName(q, other)}的${part}` : `不到 ${Math.round(r * SMALL_ALONE)} 州`;
  }
  if (c.size === 'medium') return `${MEDIUM_MIN}–${LARGE - 1} 州`;
  if (c.size === 'large') return `${LARGE} 州以上`;
  if (c.size === 'top') return '比每个邻国都大';
  return '';
}

const SIZE_NAMES = { small: '小国', medium: '中等', large: '大国', top: '附近最大' } as const;

/** 州数那一档:"至少 30 州""10–20 州" */
function sizeRange(c: { min?: number; max?: number }): string {
  if (c.min !== undefined && c.max !== undefined) return `${c.min}–${c.max} 州`;
  if (c.max !== undefined) return `不超过 ${c.max} 州`;
  return `至少 ${c.min ?? 1} 州`;
}

/** 搜的时候顶上那一行里的一条(短):"大国""至少 4 个邻国""和帝国隔山有隘口" */
export function condBrief(q: FinderQuery, role: number, c: FinderCond): string {
  const o = (i: number) => roleName(q, i);
  switch (c.kind) {
    case 'size':
      return c.size ? SIZE_NAMES[c.size] : sizeRange(c);
    case 'neighbors':
      return c.min !== undefined && c.max !== undefined ? `${c.min}–${c.max} 个邻国` : c.max !== undefined ? `邻国不超过 ${c.max} 个` : `至少 ${c.min ?? 1} 个邻国`;
    case 'ports':
      return c.min <= 1 ? '有港口' : `至少 ${c.min} 个港口`;
    case 'age':
      return c.max !== undefined ? `立国不到 ${c.max} 年` : `立国 ${c.min ?? 0} 年以上`;
    case 'era':
      return `在${eraName(c.era)}时代`;
    case 'eraEnter':
      return `${c.min}–${c.max} 年后进${eraName(c.era)}`;
    case 'fate':
      return `${c.within} 年内${fateText(c.what)}`;
    case 'mountain':
      return `${tenths(c.min)}翻山`;
    case 'elevation':
      return `平均海拔 ${c.min} 米以上`;
    case 'higher':
      return `比${o(c.other)}高 ${c.by} 米`;
    case 'border':
      return `和${o(c.other)}接壤`;
    case 'pass':
      return `和${o(c.other)}隔山有隘口`;
    case 'war':
      return `${c.within} 年内和${o(c.other)}打仗`;
    case 'conquer':
      return c.dir === 'took' ? `${c.within} 年内占${o(c.other)} ${c.min} 州` : `${c.within} 年内被${o(c.other)}占 ${c.min} 州`;
    case 'junction':
      if (role >= 0) return `一州挨着 ${c.min} 国`;
      return `${nations(c.min)}交界${'unowned' in c && c.unowned ? '，无主' : ''}`;
    case 'span':
      return `讲 ${c.years} 年`;
    case 'start':
      if ('from' in c) return `第 ${c.from}–${c.to} 年开场`;
      return `${o(c.role)}进${eraName(c.enter)}前 ${c.min}–${c.max} 年开场`;
  }
}

/** 搜的时候顶上的概括:每国一行("大国，至少 4 个邻国，有港口"),「一起」一行("三国交界，讲 130 年") */
export function querySummary(q: FinderQuery): { roles: string[]; together: string } {
  return {
    roles: q.roles.map((r, i) => r.conds.map((c) => condBrief(q, i, c)).join('，')),
    together: q.together.map((c) => condBrief(q, -1, c)).join('，'),
  };
}

/** 「故事讲多少年」里撑下来的是谁:"两国都""帝国" */
export function spanWho(q: FinderQuery): string {
  const n = q.roles.length;
  return n === 1 ? roleName(q, 0) : n === 2 ? '两国都' : n === 3 ? '三国都' : '';
}

/** 一条条件的完整说法(条件逐条、卡在哪几条):"帝国是大国（40 州以上）""隘口比山脊低 800 米以上" */
export function condLine(q: FinderQuery, role: number, c: FinderCond): string {
  const r = role >= 0 ? roleName(q, role) : '';
  const o = (i: number) => roleName(q, i);
  switch (c.kind) {
    case 'size':
      if (c.size === 'small') return `${r}是小国（${sizeHint(q, role, c)}）`;
      if (c.size === 'medium') return `${r}是中等国（${sizeHint(q, role, c)}）`;
      if (c.size === 'large') return `${r}是大国（${sizeHint(q, role, c)}）`;
      if (c.size === 'top') return `${r}比每个邻国都大`;
      return `${r}${sizeRange(c)}`;
    case 'neighbors':
      return c.max !== undefined && c.min === undefined ? `${r}邻国不超过 ${c.max} 个` : `${r}至少 ${c.min ?? 1} 个邻国`;
    case 'ports':
      return c.min <= 1 ? `${r}有通航线的港口` : `${r}至少 ${c.min} 个通航线的港口`;
    case 'age':
      return c.max !== undefined ? `${r}开场时立国不到 ${c.max} 年` : `${r}开场时已立国 ${c.min ?? 0} 年以上`;
    case 'era':
      return `${r}开场时在${eraName(c.era)}时代`;
    case 'eraEnter':
      return `${r}开场后 ${c.min}–${c.max} 年进${eraName(c.era)}`;
    case 'fate':
      return `${r}开场后 ${c.within} 年内${fateText(c.what)}`;
    case 'mountain':
      return `${r}边界至少${tenths(c.min)}是翻山`;
    case 'elevation':
      return `${r}平均海拔高过 ${c.min} 米`;
    case 'higher':
      return `${r}比${o(c.other)}高 ${c.by} 米以上`;
    case 'border':
      return `${r}和${o(c.other)}接壤`;
    case 'pass':
      return `隘口比山脊低 ${c.gap} 米以上`;
    case 'war':
      return `${r}和${o(c.other)}开场后 ${c.within} 年内打过仗`;
    case 'conquer':
      return c.dir === 'took' ? `${r}开场后 ${c.within} 年内占过${o(c.other)}至少 ${c.min} 州` : `${r}开场后 ${c.within} 年内被${o(c.other)}占过至少 ${c.min} 州`;
    case 'junction':
      if (role >= 0) return `${r}有一州同时挨着 ${c.min} 国`;
      return `有一州同时挨着 ${c.min} 国${'unowned' in c && c.unowned ? '，无主' : ''}`;
    case 'span':
      return q.roles.length ? `${spanWho(q)}撑过 ${c.years} 年` : `故事讲 ${c.years} 年`;
    case 'start':
      if ('from' in c) return `第 ${c.from}–${c.to} 年开场`;
      return `${o(c.role)}${c.era !== undefined ? `在${eraName(c.era)}时代，` : ''}${c.min}–${c.max} 年后进${eraName(c.enter)}`;
  }
}

/** 条件逐条里的一行:说法、合不合、右边写的实际数 */
export interface CheckLine {
  text: string;
  ok: boolean;
  /** 右边的实际数("107 州""低 1380 米");量不出 = '' */
  value: string;
  /** condList 的下标 */
  cond: number;
}

/** 名字补得上的地方(港口叫什么、交界那州叫什么):cond = condList 的下标 */
export type PlaceNames = Map<number, string>;

/**
 * 一种配法逐条:每条一行;隘口拆成两行(口子比山脊低多少、能过的地方几处),和「条件逐条」的样子一样。
 * year = 开场年份("到 1885 年都在");names = 地名(港口、交界那州;没有就不写)
 */
export function checkLines(q: FinderQuery, checks: readonly Check[], facts: readonly Fact[], year: number, names?: PlaceNames): CheckLine[] {
  const out: CheckLine[] = [];
  condList(q).forEach((ref, i) => {
    const c = ref.cond;
    const ch = checks[i];
    if (!ch) return;
    const f = facts[i];
    const v = ch.value;
    const name = names?.get(i);
    const line = (text: string, ok: boolean, value: string) => out.push({ text, ok, value, cond: i });
    const num = (x: number | null, unit: string) => (x === null ? '' : `${Math.round(x)} ${unit}`);
    switch (c.kind) {
      case 'pass': {
        const narrow = f?.[2] ?? null;
        const gapOk = ch.ok || ch.why === 'wide';
        line(condLine(q, ref.role, c), gapOk, v === null ? '不接壤' : `低 ${Math.round(v)} 米`);
        line(`能过的地方不超过 ${c.narrow} 处`, ch.ok || (ch.why !== 'wide' && ch.why !== 'none' && ch.why !== 'shape' && narrow !== null && narrow <= c.narrow), narrow === null ? '' : `${narrow} 处`);
        return;
      }
      case 'size':
      case 'conquer':
        return line(condLine(q, ref.role, c), ch.ok, num(v, '州'));
      case 'neighbors':
        return line(condLine(q, ref.role, c), ch.ok, num(v, '个'));
      case 'ports':
        return line(condLine(q, ref.role, c), ch.ok, v === null ? '' : `${v} 个${name && v > 0 ? `，最近的${name}` : ''}`);
      case 'age':
        return line(condLine(q, ref.role, c), ch.ok, num(v, '年'));
      case 'era':
        return line(condLine(q, ref.role, c), ch.ok, v === null ? '' : `${eraName(v)}时代`);
      case 'eraEnter':
      case 'fate':
        return line(condLine(q, ref.role, c), ch.ok, v === null ? '没有' : `${Math.round(v)} 年后`);
      case 'war':
        return line(condLine(q, ref.role, c), ch.ok, v === null ? '没打' : `${Math.round(v)} 年后开战`);
      case 'mountain':
        return line(condLine(q, ref.role, c), ch.ok, v === null ? '' : `${Math.round(v * 100)}%`);
      case 'elevation':
        return line(condLine(q, ref.role, c), ch.ok, num(v, '米'));
      case 'higher':
        return line(condLine(q, ref.role, c), ch.ok, v === null ? '' : v >= 0 ? `高 ${Math.round(v)} 米` : `低 ${Math.round(-v)} 米`);
      case 'border':
        return line(condLine(q, ref.role, c), ch.ok, ch.ok ? '接壤' : '不接壤');
      case 'junction':
        return line(condLine(q, ref.role, c), ch.ok, ch.ok && name ? name : num(v, '国'));
      case 'span':
        return line(condLine(q, ref.role, c), ch.ok, v === null ? '' : ch.ok ? `到 ${year + c.years} 年都在` : `${Math.round(v)} 年后有一国没了`);
      case 'start':
        if ('from' in c) return line(condLine(q, ref.role, c), ch.ok, v === null ? '' : `第 ${v} 年`);
        return line(condLine(q, ref.role, c), ch.ok, ch.why === 'era' ? `开场时在${eraName(f?.[0] ?? null)}时代` : v === null ? '没进' : `${Math.round(v)} 年后`);
    }
  });
  return out;
}

/** 差一条的那一条差在哪:"隘口只比山脊低 637 米";full = 地图上那块牌子,再补一句要多少("，要 1200 米") */
export function missText(q: FinderQuery, row: Pick<FinderRow, 'verdict' | 'cand'>, full = false): string {
  const list = condList(q);
  const i = row.verdict.checks.findIndex((c) => !c.ok);
  if (i < 0) return '';
  const ref = list[i];
  const c = ref.cond;
  const ch = row.verdict.checks[i];
  const f = row.cand.facts[i];
  const v = ch.value;
  const r = ref.role >= 0 ? roleName(q, ref.role) : '';
  const o = (k: number) => roleName(q, k);
  const want = (s: string) => (full ? `，${s}` : '');
  const n = (x: number | null) => (x === null ? 0 : Math.round(x));
  switch (c.kind) {
    case 'size':
      if (c.size === 'small') return `${r}有 ${n(v)} 州，不算小${want(sizeHint(q, ref.role, c))}`;
      if (c.size === 'large') return `${r}只有 ${n(v)} 州${want(`要 ${LARGE} 州以上`)}`;
      if (c.size === 'medium') return `${r}有 ${n(v)} 州${want(`要 ${MEDIUM_MIN}–${LARGE - 1} 州`)}`;
      if (c.size === 'top') return `${r}不是附近最大的`;
      return `${r}有 ${n(v)} 州${want(`要${sizeRange(c)}`)}`;
    case 'neighbors':
      return c.max !== undefined && (v ?? 0) > c.max ? `${r}有 ${n(v)} 个邻国${want(`要不超过 ${c.max} 个`)}` : `${r}只有 ${n(v)} 个邻国${want(`要至少 ${c.min ?? 1} 个`)}`;
    case 'ports':
      return v ? `${r}只有 ${n(v)} 个通航线的港口${want(`要 ${c.min} 个`)}` : `${r}没有通航线的港口`;
    case 'age':
      return `${r}开场时立国 ${n(v)} 年`;
    case 'era':
      return `${r}开场时在${eraName(v)}时代${want(`要${eraName(c.era)}`)}`;
    case 'eraEnter':
      return v === null ? `${r}一直没进${eraName(c.era)}` : v < c.min ? `${r} ${n(v)} 年后就进了${eraName(c.era)}` : `${r} ${n(v)} 年后才进${eraName(c.era)}`;
    case 'fate':
      return v === null ? `${r}一直没${fateText(c.what)}` : `${r} ${n(v)} 年后才${fateText(c.what)}`;
    case 'mountain':
      return `${r}边界只有 ${Math.round((v ?? 0) * 100)}% 是翻山${want(`要${tenths(c.min)}`)}`;
    case 'elevation':
      return `${r}平均海拔只有 ${n(v)} 米${want(`要 ${c.min} 米`)}`;
    case 'higher':
      return `${r}比${o(c.other)}只高 ${n(v)} 米${want(`要 ${c.by} 米`)}`;
    case 'border':
      return `${r}和${o(c.other)}不接壤`;
    case 'pass':
      if (ch.why === 'none') return `${r}和${o(c.other)}不接壤`;
      if (ch.why === 'shape') return `${r}和${o(c.other)}之间的山不像关隘`;
      if (ch.why === 'wide') return `能过的地方有 ${n(f?.[2] ?? null)} 处${want(`要不超过 ${c.narrow} 处`)}`;
      return `隘口只比山脊低 ${n(v)} 米${want(`要 ${c.gap} 米`)}`;
    case 'war':
      return v === null ? `${r}和${o(c.other)}一直没打仗` : `${r}和${o(c.other)} ${n(v)} 年后才打仗`;
    case 'conquer':
      return c.dir === 'took' ? `${r}只占过${o(c.other)} ${n(v)} 州` : `${r}只被${o(c.other)}占过 ${n(v)} 州`;
    case 'junction':
      return 'unowned' in c && c.unowned ? `无主的州最多挨着 ${n(v)} 国` : `一州最多挨着 ${n(v)} 国${want(`要 ${c.min} 国`)}`;
    case 'span':
      return `有一国只撑了 ${n(v)} 年${want(`要 ${c.years} 年`)}`;
    case 'start':
      if ('from' in c) return `开场年份不在第 ${c.from}–${c.to} 年`;
      if (ch.why === 'era') return `开场时${o(c.role)}在${eraName(f?.[0] ?? null)}时代`;
      return v === null ? `${o(c.role)}一直没进${eraName(c.enter)}` : v < c.min ? `${o(c.role)} ${n(v)} 年后就进了${eraName(c.enter)}` : `${o(c.role)} ${n(v)} 年后才进${eraName(c.enter)}`;
  }
}

/** 差一条的那几个世界差在哪一类(搜的时候顶上一句"差在：山国翻山不够 4 个、隘口不够险 4 个") */
function missKind(q: FinderQuery, role: number, c: FinderCond, ch: Check): string {
  const r = role >= 0 ? roleName(q, role) : '';
  switch (c.kind) {
    case 'size':
      return `${r}大小不对`;
    case 'neighbors':
      return c.max !== undefined && (ch.value ?? 0) > c.max ? `${r}邻国太多` : `${r}邻国不够`;
    case 'ports':
      return `${r}港口不够`;
    case 'age':
      return `${r}立国年数不对`;
    case 'era':
      return `${r}时代不对`;
    case 'eraEnter':
      return `${r}进${eraName(c.era)}太早或太晚`;
    case 'fate':
      return `${r}没有${fateText(c.what)}`;
    case 'mountain':
      return `${r}翻山不够`;
    case 'elevation':
    case 'higher':
      return `${r}不够高`;
    case 'border':
      return '不接壤';
    case 'pass':
      return ch.why === 'none' ? '不接壤' : '隘口不够险';
    case 'war':
      return '没打仗';
    case 'conquer':
      return '占地不够';
    case 'junction':
      return '交界不够';
    case 'span':
      return '撑不够年数';
    case 'start':
      if ('from' in c) return '开场年份不对';
      return ch.why === 'era' ? `${roleName(q, c.role)}时代不对` : `进${eraName(c.enter)}太早或太晚`;
  }
}

/** 差一条的那些按差在哪归类、数个数(多的在前):"山国翻山不够 4 个、隘口不够险 4 个" */
export function nearSummary(q: FinderQuery, near: readonly FinderRow[]): string {
  const list = condList(q);
  const count = new Map<string, number>();
  for (const row of near) {
    const i = row.verdict.checks.findIndex((c) => !c.ok);
    if (i < 0) continue;
    const k = missKind(q, list[i].role, list[i].cond, row.verdict.checks[i]);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n} 个`)
    .join('、');
}

/** 放宽一条以后怎么说:"翻山降到两成""隘口降到比山脊低 800 米";松不了 = '' */
export function relaxText(q: FinderQuery, role: number, c: FinderCond): string {
  const x = relaxCond(c);
  if (!x || x.kind !== c.kind) {
    if (x && x.kind === 'size' && c.kind === 'size') return `${roleName(q, role)}放宽到${sizeRange(x)}`;
    return '';
  }
  const r = role >= 0 ? roleName(q, role) : '';
  switch (x.kind) {
    case 'size':
      if (x.size === 'small') return `小国放宽到不到${q.roles.length > 1 ? roleName(q, q.roles.findIndex((_, i) => i !== role)) : '别国'}的${tenths(x.ratio ?? SMALL_RATIO)}`;
      return `${r}放宽到${sizeRange(x)}`;
    case 'neighbors':
      return x.max !== undefined && x.min === undefined ? `邻国放宽到不超过 ${x.max} 个` : `邻国降到至少 ${x.min ?? 1} 个`;
    case 'ports':
      return `港口降到至少 ${x.min} 个`;
    case 'age':
      return x.max !== undefined ? `立国放宽到不到 ${x.max} 年` : `立国降到 ${x.min ?? 0} 年以上`;
    case 'eraEnter':
      return `进${eraName(x.era)}放宽到 ${x.min}–${x.max} 年后`;
    case 'fate':
      return `放宽到 ${x.within} 年内${fateText(x.what)}`;
    case 'mountain':
      return `翻山降到${tenths(x.min)}`;
    case 'elevation':
      return `海拔降到 ${x.min} 米`;
    case 'higher':
      return `降到比${roleName(q, x.other)}高 ${x.by} 米`;
    case 'pass':
      return `隘口降到比山脊低 ${x.gap} 米`;
    case 'war':
      return `放宽到 ${x.within} 年内打仗`;
    case 'conquer':
      return `放宽到 ${x.within} 年内占 ${x.min} 州`;
    case 'junction':
      if (c.kind === 'junction' && 'unowned' in c && c.unowned && !('unowned' in x && x.unowned)) return '交界那州不要求无主';
      return `交界降到挨着 ${x.min} 国`;
    case 'span':
      return `故事讲 ${x.years} 年就行`;
    case 'start':
      if ('from' in x) return `开场放宽到第 ${x.from}–${x.to} 年`;
      return `进${eraName(x.enter)}放宽到 ${x.min}–${x.max} 年后`;
    default:
      return '';
  }
}

/** 「放宽一点试试」一行:放宽一条照那一条说;两条"两条都放宽";更多"全部放宽一点" */
export function hintText(q: FinderQuery, h: RelaxHint): string {
  const list = condList(q);
  if (h.which.length === 1) {
    const ref = list[h.which[0]];
    return ref ? relaxText(q, ref.role, ref.cond) || '放宽这一条' : '放宽这一条';
  }
  return h.which.length === 2 ? '两条都放宽' : '全部放宽一点';
}

/** 「卡在哪几条」:每条有几个世界合,最少的几条在前 */
export interface StuckLine {
  text: string;
  count: number;
  cond: number;
}
export function stuckLines(q: FinderQuery, passCount: readonly number[]): StuckLine[] {
  const list = condList(q);
  return list
    .map((ref, i) => ({ text: condLine(q, ref.role, ref.cond), count: passCount[i] ?? 0, cond: i }))
    .sort((a, b) => a.count - b.count || a.cond - b.cond);
}

/** 「一起」那几条在条件页上的标签 */
export function togetherLabel(c: TogetherCond): string {
  return c.kind === 'junction' ? '交界' : c.kind === 'span' ? '讲多久' : '开场';
}
