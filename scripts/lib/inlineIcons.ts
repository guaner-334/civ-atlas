/**
 * 浏览器标签上的小图标直接写进页面(data: 网址),不让浏览器另外去要。
 *
 * 网页会把正在看的位置、图层写进网址(拖完地图、换了图层就改一次,刷新、复制网址都还在)。
 * Chrome 这类浏览器在一些情况下(比如无痕窗口)每换一次网址,都按 <link rel="icon"> 的网址把图标重新要一遍:
 * 内容没变,服务器回 304,但每拖一下地图就多一个请求。图标写成 data: 网址以后浏览器从页面里直接取,换网址不再发请求。
 *
 * 旧版 Safari(18 及更早)不认 data: 网址的图标(Safari 26 才支持),给它留一个文件:页面里写
 *   <link rel="icon" href="favicon.ico" sizes="16x16" data-file />
 * 插件只去掉 data-file、网址不动。它要写在最后、sizes 比写进页面的那个 .ico 小:
 * Chrome 这类浏览器按 sizes 给图标打分、从高往低取,取到的已经不比下一个差就停,
 * 写进页面的几个分数都比它高、取下来也比它好,所以轮不到这个文件(电脑上要 16 / 32 像素的,手机上要最大的,都一样);
 * 旧版 Safari 跳过 data: 的图标,只剩这一个。
 *
 * 图标文件本身(public/favicon.svg、favicon.ico)照旧发布:说明、隐私政策、用户协议几页还在用。
 * 手机主屏图标(apple-touch-icon)不是标签上的图标,不动。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const TYPES: Record<string, string> = { svg: 'image/svg+xml', ico: 'image/x-icon', png: 'image/png' };
/** 页面里的 <link rel="icon" …>(属性的引号里可以有 >,以前写在页面里的 data:image/svg+xml,<svg …> 就是) */
export const ICON_LINK = /<link\b(?:[^>"]|"[^"]*")*\brel="icon"(?:[^>"]|"[^"]*")*>/g;
/** 标了这个的图标留作文件(给不认 data: 图标的旧版 Safari),输出时去掉这个标记 */
const KEEP_FILE = /\s+data-file(?=[\s/>])/;

/**
 * 页面里每个 <link rel="icon" href="文件名"> 换成 data: 网址(内容一个字节不改,别的属性照旧);read 按文件名取文件内容。
 * 标了 data-file 的留作文件、只去掉标记;已经是 data: 的不动;指向别处、认不出的格式就报错(构建失败),免得悄悄又变回另外请求
 */
export function inlineIcons(html: string, read: (file: string) => Uint8Array): string {
  return html.replace(ICON_LINK, (tag) => {
    const href = /\bhref="([^"]*)"/.exec(tag)?.[1];
    if (href?.startsWith('data:')) return tag;
    const m = href ? /^(?:\.?\/)?([\w.-]+)\.(svg|ico|png)$/.exec(href) : null;
    if (!m) throw new Error(`网页图标 ${tag} 写不进页面:只认 public 目录最上一层的 .svg / .ico / .png 文件`);
    if (KEEP_FILE.test(tag)) return tag.replace(KEEP_FILE, '');
    const data = Buffer.from(read(`${m[1]}.${m[2]}`)).toString('base64');
    return tag.replace(`href="${href}"`, `href="data:${TYPES[m[2]]};base64,${data}"`);
  });
}

/**
 * Vite 插件:开发和构建时都把 index.html 里的图标换成 data: 网址,文件从 public 目录取。
 * 排在 Vite 自己处理页面之前(order: 'pre'):开发时 Vite 会把指向 public 的网址改写成 /favicon.ico 这样
 */
export function inlineIconsPlugin(): Plugin {
  let publicDir = '';
  return {
    name: 'inline-icons',
    configResolved(c) {
      publicDir = c.publicDir;
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => inlineIcons(html, (file) => readFileSync(join(publicDir, file))),
    },
  };
}
