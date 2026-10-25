/**
 * 新功能清单的一条条小文件(src/ui/news/<PR 号>.json)拼成整份清单。网页里用 whatsNew.ts(构建时打包进来),
 * 构建配置和 Node 脚本用 scripts/lib/whatsNew.ts(从硬盘读);两边都走这里,拼出来一模一样。
 * 这个文件不能 import 别的代码(vite.config.ts 构建前就要读它)。
 */
export interface NewsItem {
  /** 改动的 PR 号:两个网站的清单按它对 */
  pr: number;
  /** 几个字的标题 */
  title: string;
  /** 一句话说多了什么 */
  text: string;
}

/** 一个小文件里写的:标题和一句话(PR 号就是文件名) */
export interface NewsEntry {
  title: string;
  text: string;
}

const NAME_RE = /(?:^|\/)(\d+)\.json$/;

/** 小文件(路径 → 内容)→ 清单,PR 号大的在前;文件名不是「PR 号.json」的跳过 */
export function newsFromFiles(files: Record<string, NewsEntry>): NewsItem[] {
  const news: NewsItem[] = [];
  for (const [path, e] of Object.entries(files)) {
    const m = NAME_RE.exec(path);
    if (!m) continue;
    news.push({ pr: Number(m[1]), title: e.title, text: e.text });
  }
  return news.sort((a, b) => b.pr - a.pr);
}
