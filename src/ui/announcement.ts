/**
 * 网站公告:有要紧的事告诉所有人时(网站要停一会儿、换了交流群……),打开网页就弹出来(Announcement.tsx)。
 *
 * 不写在代码里:网站根目录放一份 announcement.json,打开网页时读一次。发公告、撤公告只换这个文件
 * (.github/workflows/announcement.yml「更新公告」),不用重新构建、发布网站。读不到、格式不对、没写标题和正文
 * (本地开发、自己部署的网站没放这个文件,或者公告撤下了)就不弹。
 *
 *   { "id": "20261024-1327", "date": "2026-10-24", "title": "网站搬家通知", "body": "第一段\n第二段", "link": "https://…" }
 *
 *   id     这条公告的编号:关过的编号记在浏览器里,同一条不再弹;换了编号就是新的一条(不写 = 按标题和正文认)
 *   date   发布日期(可不写),标题下面写成「10 月 24 日」
 *   title  标题(必填)
 *   body   正文(必填),一行一段
 *   link   详情链接(可不写,https),多一个「查看详情」
 *
 * 文件放在网站根目录、不跟着页面所在的目录走:测试网站(/beta/)和正式网站读同一份。
 */
import { useSyncExternalStore } from 'react';

export interface Notice {
  id: string;
  /** 标题下面的日期(「10 月 24 日」);没写或认不出 = '' */
  date: string;
  title: string;
  /** 正文,一段一项 */
  paras: string[];
  /** 详情链接;没有 = '' */
  link: string;
}

export const NOTICE_FILE = '/announcement.json';
const SEEN_KEY = 'civ-atlas:notice-seen';
const MAX_TITLE = 40;
const MAX_BODY = 1000;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** 读到的 announcement.json → 公告;没写标题或正文、格式不对 = null(不弹) */
export function parseNotice(raw: unknown): Notice | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const title = str(o.title).slice(0, MAX_TITLE);
  const paras = str(o.body)
    .slice(0, MAX_BODY)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!title || !paras.length) return null;
  let link = str(o.link);
  try {
    if (link && new URL(link).protocol !== 'https:') link = '';
  } catch {
    link = '';
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(o.date));
  const date = m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 ? `${+m[2]} 月 ${+m[3]} 日` : '';
  const id = str(o.id).slice(0, 64) || `${title}\n${paras.join('\n')}`;
  return { id, date, title, paras, link };
}

/** 这条关过没有(浏览器不让存时当没关过,每次都弹) */
function seen(id: string): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === id;
  } catch {
    return false;
  }
}

let notice: Notice | null = null;
let started = false;
const subs = new Set<() => void>();

function set(next: Notice | null) {
  notice = next;
  subs.forEach((f) => f());
}

/** 读 announcement.json(只读一次);关过的那条不弹 */
export async function loadNotice(): Promise<void> {
  if (started) return;
  started = true;
  let n: Notice | null = null;
  try {
    // no-cache:每次打开网站都问一下服务器换没换(没换只回一句"没变",不重新下载)
    const res = await fetch(NOTICE_FILE, { cache: 'no-cache' });
    if (res.ok) n = parseNotice(await res.json());
  } catch {
    /* 没有这个文件、不是 JSON(本地开发时拿到的是首页) */
  }
  if (n && !seen(n.id)) set(n);
}

/** 关掉公告,记下编号,同一条不再弹 */
export function closeNotice(): void {
  if (!notice) return;
  try {
    localStorage.setItem(SEEN_KEY, notice.id);
  } catch {
    /* 存不了:这次关掉,下次打开还会弹 */
  }
  set(null);
}

function subscribe(f: () => void) {
  subs.add(f);
  void loadNotice();
  return () => subs.delete(f);
}

/** 要弹的公告;没有、关过、还没读到 = null */
export function useNotice(): Notice | null {
  return useSyncExternalStore(subscribe, () => notice, () => null);
}
