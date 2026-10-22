/**
 * 备案号写进不经过 React 的地方(号码从哪来见 src/ui/beian.ts):
 *
 *   加载画面            index.html 里那一块的最底下(scripts/lib/loadScreen.ts 用 beianLinks)
 *   public/ 下的静态页  隐私政策、用户协议、使用教程:页面里留了 <!--beian--> 的位置,构建完换成备案号那一行
 *                      (样式写在各页自己的 .beian 里);没有号码时只去掉留的位置。开发时静态页原样发出去,不显示
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { BeianRecord } from '../../src/ui/beian';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 备案号那几个链接(新标签页打开查询页);没有号码 = 空串 */
export function beianLinks(list: BeianRecord[]): string {
  return list.map((r) => `<a href="${esc(r.href)}" target="_blank" rel="noreferrer">${esc(r.text)}</a>`).join('');
}

/** 静态页里给备案号留的位置 */
export const BEIAN_SLOT = '<!--beian-->';

/** 要写备案号的静态页(public/ 下) */
export const BEIAN_PAGES = ['privacy.html', 'terms.html', 'guide.html'];

/** 把静态页里留的位置换成备案号那一行(<p class="beian">);没有号码时只去掉留的位置 */
export function fillBeian(html: string, list: BeianRecord[]): string {
  return html.replace(BEIAN_SLOT, list.length ? `<p class="beian">${beianLinks(list)}</p>` : '');
}

/** Vite 插件:构建完(public/ 已经抄进输出目录)把 BEIAN_PAGES 里留的位置换掉 */
export function beianPagesPlugin(list: BeianRecord[]): Plugin {
  let outDir = '';
  return {
    name: 'beian-pages',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    async writeBundle() {
      for (const page of BEIAN_PAGES) {
        const file = join(outDir, page);
        const html = await readFile(file, 'utf8');
        if (!html.includes(BEIAN_SLOT)) throw new Error(`备案号:${page} 里没有留位置(${BEIAN_SLOT})`);
        await writeFile(file, fillBeian(html, list));
      }
    },
  };
}
