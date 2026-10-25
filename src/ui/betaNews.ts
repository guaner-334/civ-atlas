/**
 * 测试版的新功能:版本号上(电脑悬停、手机点一下)看测试网站比正式网站多了哪些功能、预计哪天更新到正式网站。
 *
 * 两个网站各自带着构建时的新功能清单(whatsNew.ts),也都把它写成网站上的 whats-new.json:
 *
 *   { "built": "2026-10-11", "news": [{ "pr": 76, "title": "名臣名将", "text": "…" }, …] }
 *
 *   built  构建那天(北京时间)。测试网站每次合并都重新构建,所以就是测试网站最近一次发布的日子
 *   news   新功能清单,新的在前
 *
 * 正式网站读测试网站(beta/)的那份,挑出自己的清单里没有的几条;测试网站反过来读正式网站的,挑出正式网站还没有的
 * (正式网站还没有这份文件 = 测试网站的都算多出来的)。两边一样、读不到测试网站的清单时,版本号上什么都不加。
 * 旧版网站不显示。
 *
 * 预计日期:正式网站每周日同步一次测试网站 —— 测试网站发布那天之后的第一个周日;过了还没同步,顺延到下一个周日。
 */
import { useSyncExternalStore } from 'react';
import type { NewsItem } from './newsFiles';
import { BETA_SITE, OLD_SITE, latestUrl } from './oldSite';

export type { NewsItem };

export const NEWS_FILE = 'whats-new.json';
/** 卡片里最多列几条,多出来的写「还有 N 项」(列得多了卡片里面自己滚) */
export const NEWS_MAX = 20;

declare const __BUILD_DAY__: string | undefined;
/** 这份网页构建那天(北京时间,2026-10-11);在 Node 里直接跑(单测以外的脚本)时没有,当作今天 */
const BUILD_DAY: string = typeof __BUILD_DAY__ === 'string' ? __BUILD_DAY__ : beijingDay();

export interface NewsFile {
  built: string;
  news: NewsItem[];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 读到的 whats-new.json → 构建日期和清单;格式不对 = null。单条不对的跳过 */
export function parseNews(raw: unknown): NewsFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.built !== 'string' || !DAY_RE.test(o.built) || !Array.isArray(o.news)) return null;
  const news: NewsItem[] = [];
  for (const n of o.news as unknown[]) {
    if (!n || typeof n !== 'object') continue;
    const e = n as Record<string, unknown>;
    if (typeof e.pr !== 'number' || !Number.isInteger(e.pr) || e.pr <= 0) continue;
    if (typeof e.title !== 'string' || typeof e.text !== 'string' || !e.title.trim()) continue;
    news.push({ pr: e.pr, title: e.title.trim().slice(0, 20), text: e.text.trim().slice(0, 80) });
  }
  return { built: o.built, news };
}

/** newer 里有、older 里没有的几条(按 PR 号对),保持 newer 的先后 */
export function aheadOf(newer: NewsItem[], older: NewsItem[]): NewsItem[] {
  const had = new Set(older.map((n) => n.pr));
  return newer.filter((n) => !had.has(n.pr));
}

/** 某一刻的北京时间日期(2026-10-11) */
export function beijingDay(now = Date.now()): string {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86400_000;
  return new Date(t).toISOString().slice(0, 10);
}
/** 这天是星期几(0 = 周日) */
function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/**
 * 预计哪天更新到正式网站:测试网站发布那天(built)之后的第一个周日;那天已经过了(没按时同步),
 * 就是今天或今天以后的第一个周日
 */
export function nextSync(built: string, today: string): string {
  const after = addDays(built, 7 - weekday(built));
  if (after >= today) return after;
  return addDays(today, (7 - weekday(today)) % 7);
}

/** 2026-10-18 →「10 月 18 日」 */
export function dayText(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${m} 月 ${d} 日`;
}

/** 卡片上要显示的 */
export interface BetaNews {
  /** 测试网站多出来的几条(最多 NEWS_MAX 条) */
  items: NewsItem[];
  /** 没列出来的还有几条 */
  more: number;
  /** 预计更新到正式网站的那天,「10 月 18 日」 */
  when: string;
  /** 这是测试网站(卡片底下给正式网站的地址);正式网站上给测试地址 */
  beta: boolean;
  /** 另一个网站的地址 */
  link: string;
}

/** 两份清单 → 卡片内容;测试网站没有多出来的 = null */
export function makeNews(beta: boolean, betaFile: NewsFile, mainNews: NewsItem[], today: string, link: string): BetaNews | null {
  const ahead = aheadOf(betaFile.news, mainNews);
  if (!ahead.length) return null;
  return {
    items: ahead.slice(0, NEWS_MAX),
    more: Math.max(0, ahead.length - NEWS_MAX),
    when: dayText(nextSync(betaFile.built, today)),
    beta,
    link,
  };
}

/** 地址在卡片上的写法:去掉 https:// 和最后的斜杠(atlas.gerdor.top/beta) */
export function linkText(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

let news: BetaNews | null = null;
let started = false;
const subs = new Set<() => void>();

/** 读另一个网站的清单(只读一次) */
export async function loadNews(): Promise<void> {
  if (started) return;
  started = true;
  if (OLD_SITE !== null) return;
  const main = latestUrl();
  const betaUrl = new URL('beta/', main);
  let own: NewsFile;
  let other: NewsFile | null = null;
  try {
    // 自己的清单用到时才下载:首页不多背这几十条字
    own = { built: BUILD_DAY, news: (await import('./whatsNew')).WHATS_NEW };
    // no-cache:每次打开网站都问一下服务器换没换(没换只回一句"没变",不重新下载)
    const res = await fetch(new URL(NEWS_FILE, BETA_SITE ? main : betaUrl), { cache: 'no-cache' });
    if (res.ok) other = parseNews(await res.json().catch(() => null));
  } catch {
    return; // 断网之类:不显示
  }
  let next: BetaNews | null;
  if (BETA_SITE) {
    // 正式网站还没有这份文件(还没同步到带清单的版本):测试网站的都算多出来的
    next = makeNews(true, own, other?.news ?? [], beijingDay(), main.href);
  } else {
    next = other ? makeNews(false, other, own.news, beijingDay(), betaUrl.href) : null;
  }
  if (!next) return;
  news = next;
  subs.forEach((f) => f());
}

function subscribe(f: () => void) {
  subs.add(f);
  void loadNews();
  return () => subs.delete(f);
}

/** 测试网站多出来的新功能;没有、还没读到、旧版网站 = null */
export function useBetaNews(): BetaNews | null {
  return useSyncExternalStore(subscribe, () => news);
}
