/**
 * 新功能清单(src/ui/news/ 的小文件)在 Node 里从硬盘读:构建配置写 whats-new.json、检查脚本用。
 * 网页里用的是 src/ui/whatsNew.ts(构建时打包),两边都经 newsFromFiles 拼,结果一样。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { newsFromFiles, type NewsEntry, type NewsItem } from '../../src/ui/newsFiles';

const DIR = new URL('../../src/ui/news/', import.meta.url);

export function readWhatsNew(): NewsItem[] {
  const files: Record<string, NewsEntry> = {};
  for (const name of readdirSync(DIR)) {
    if (name.endsWith('.json')) files[name] = JSON.parse(readFileSync(new URL(name, DIR), 'utf8')) as NewsEntry;
  }
  return newsFromFiles(files);
}
