/**
 * 浏览器标签上的小图标直接写进页面(data: 网址),不让浏览器另外去要。
 *
 * 网页会把正在看的位置、图层写进网址(拖完地图、换了图层就改一次,刷新、复制网址都还在)。
 * Chrome 这类浏览器每换一次网址,都按 <link rel="icon"> 的网址把图标重新要一遍:内容没变,服务器回 304,
 * 但每拖一下地图就多一个请求。图标写成 data: 网址以后浏览器从页面里直接取,换网址不再发请求。
 *
 * 图标文件本身(public/favicon.svg、favicon.ico)照旧发布:说明、隐私政策、用户协议几页还在用,
 * 有的浏览器不看页面、直接找网站根目录的 /favicon.ico。手机主屏图标(apple-touch-icon)不是标签上的图标,不动。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const TYPES: Record<string, string> = { svg: 'image/svg+xml', ico: 'image/x-icon', png: 'image/png' };
/** 页面里的 <link rel="icon" …>(属性的引号里可以有 >,以前写在页面里的 data:image/svg+xml,<svg …> 就是) */
export const ICON_LINK = /<link\b(?:[^>"]|"[^"]*")*\brel="icon"(?:[^>"]|"[^"]*")*>/g;

/**
 * 页面里每个 <link rel="icon" href="文件名"> 换成 data: 网址(内容一个字节不改,别的属性照旧);read 按文件名取文件内容。
 * 已经是 data: 的不动;指向别处、认不出的格式就报错(构建失败),免得悄悄又变回另外请求
 */
export function inlineIcons(html: string, read: (file: string) => Uint8Array): string {
  return html.replace(ICON_LINK, (tag) => {
    const href = /\bhref="([^"]*)"/.exec(tag)?.[1];
    if (href?.startsWith('data:')) return tag;
    const m = href ? /^(?:\.\/)?([\w.-]+)\.(svg|ico|png)$/.exec(href) : null;
    if (!m) throw new Error(`网页图标 ${tag} 写不进页面:只认同一目录下的 .svg / .ico / .png 文件`);
    const data = Buffer.from(read(`${m[1]}.${m[2]}`)).toString('base64');
    return tag.replace(`href="${href}"`, `href="data:${TYPES[m[2]]};base64,${data}"`);
  });
}

/** Vite 插件:开发和构建时都把 index.html 里的图标换成 data: 网址,文件从 public 目录取 */
export function inlineIconsPlugin(): Plugin {
  let publicDir = '';
  return {
    name: 'inline-icons',
    configResolved(c) {
      publicDir = c.publicDir;
    },
    transformIndexHtml(html) {
      return inlineIcons(html, (file) => readFileSync(join(publicDir, file)));
    },
  };
}
