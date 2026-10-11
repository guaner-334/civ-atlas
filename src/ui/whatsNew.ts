/**
 * 新功能清单:用的人看得到的改动,每合并一个就在最前面加一条 —— PR 号、几个字的标题、一句大白话
 * (说用的人能感到的变化,不写技术说法)。纯内部的改动(检查、文档、重构)不写。
 *
 * 构建时整份清单写成网站上的 whats-new.json(vite.config.ts);正式网站和测试网站互相读对方的,
 * 版本号上列出测试网站多出来的几条(src/ui/betaNews.ts)。旧的条目留着也不会重复显示,太长了可以删掉最老的。
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

export const WHATS_NEW: NewsItem[] = [
  { pr: 76, title: '名臣名将', text: '每个朝代有几位名臣，将领有了字号、籍贯和生平' },
  { pr: 75, title: '浏览器后退', text: '按浏览器的后退、前进，能回到上一个画面' },
  { pr: 74, title: '助手', text: '说的和确认单对得上了，写史书时随时看得到进度' },
];
