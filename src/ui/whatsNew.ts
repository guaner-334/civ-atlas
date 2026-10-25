/**
 * 新功能清单:用的人看得到的改动,每合并一个就在 src/ui/news/ 里加一个小文件,文件名是 PR 号(257.json),里面写
 *
 *   { "title": "几个字的标题(20 字以内)", "text": "一句大白话(80 字以内)" }
 *
 * 说用的人能感到的变化,不写技术说法;纯内部的改动(检查、文档、重构)不写。一个功能一个文件,几件事同时开发时
 * 不会都去改同一行。清单按 PR 号排,大的在前。
 *
 * 构建时整份清单写成网站上的 whats-new.json(vite.config.ts);正式网站和测试网站互相读对方的,
 * 版本号上列出测试网站多出来的几条(src/ui/betaNews.ts)。旧的条目留着也不会重复显示,太多了可以删掉最老的几个文件。
 */
import { newsFromFiles, type NewsEntry, type NewsItem } from './newsFiles';

export type { NewsItem };

/**
 * 构建(和单测)时把 news/ 里的小文件都打包进来。直接用 Node 跑的脚本没有这一步,拿到的是空清单
 * —— 那边要整份清单的读 scripts/lib/whatsNew.ts
 */
function bundled(): Record<string, NewsEntry> {
  try {
    return import.meta.glob<NewsEntry>('./news/*.json', { eager: true, import: 'default' });
  } catch {
    return {};
  }
}

export const WHATS_NEW: NewsItem[] = newsFromFiles(bundled());
