/**
 * 浏览器标签上的图标写进页面(scripts/lib/inlineIcons.ts):除了留给旧版 Safari 的那一个文件,页面里不再有要另外请求的图标,
 * 写进去的内容和图标文件一个字节不差(标签上的图标看着不变)
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ICON_LINK, inlineIcons } from '../scripts/lib/inlineIcons';

const fromPublic = (f: string) => readFileSync(new URL(`../public/${f}`, import.meta.url));
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const iconTags = (h: string) => [...h.matchAll(ICON_LINK)].map((m) => m[0]);
const hrefOf = (tag: string) => /\bhref="([^"]*)"/.exec(tag)![1];
/** sizes 的第一个尺寸(Safari 也只看第一个);没写 = undefined */
const sizeOf = (tag: string) => {
  const s = /\bsizes="(\d+)x\d+/.exec(tag);
  return s ? Number(s[1]) : undefined;
};
const withoutHref = (tag: string) => tag.replace(/\bhref="[^"]*"/, '');

describe('网页图标写进页面', () => {
  const out = inlineIcons(html, fromPublic);
  const before = iconTags(html);
  const after = iconTags(out);
  const keep = before.map((t) => /\sdata-file[\s/>]/.test(t));

  it('index.html 里的图标(标了 data-file 的除外)都换成 data: 网址,内容和文件一样', () => {
    expect(after).toHaveLength(before.length);
    expect(keep.filter((k) => !k).length).toBeGreaterThanOrEqual(2);
    for (const [i, tag] of after.entries()) {
      if (keep[i]) continue;
      const m = /^data:([^;]+);base64,(.+)$/.exec(hrefOf(tag));
      expect(m, tag).not.toBeNull();
      const file = hrefOf(before[i]).replace(/^\.?\//, '');
      expect(Buffer.from(m![2], 'base64').equals(fromPublic(file))).toBe(true);
      expect(m![1]).toBe(file.endsWith('.svg') ? 'image/svg+xml' : 'image/x-icon');
      // 别的属性(sizes、type)照旧:浏览器挑哪个图标和以前一样
      expect(withoutHref(tag)).toBe(withoutHref(before[i]));
    }
  });

  it('留给旧版 Safari 的文件图标:只有一个、写在最后、sizes 比写进页面的 .ico 小,输出里去掉 data-file', () => {
    expect(keep.filter(Boolean)).toHaveLength(1);
    const k = keep.indexOf(true);
    // 写在最后、尺寸更小:Chrome 这类浏览器按 sizes 排序、取到够好的就停,轮不到它
    expect(k).toBe(before.length - 1);
    const fileSize = sizeOf(before[k]);
    expect(fileSize).toBeDefined();
    for (const [i, tag] of before.entries()) {
      if (i === k || /image\/svg\+xml/.test(tag)) continue;
      expect(sizeOf(tag), tag).toBeGreaterThan(fileSize!);
    }
    expect(after[k]).toBe(before[k].replace(/\s+data-file/, ''));
    expect(after[k]).not.toContain('data-file');
    expect(hrefOf(after[k])).toBe('favicon.ico');
  });

  it('页面别的地方不动(手机主屏图标照旧指向文件)', () => {
    const strip = (h: string) => h.replace(ICON_LINK, '');
    expect(strip(out)).toBe(strip(html));
    expect(out).toContain('<link rel="apple-touch-icon" href="apple-touch-icon.png" />');
  });

  it('写成 /favicon.ico、./favicon.svg 的也认', () => {
    for (const href of ['/favicon.ico', './favicon.svg']) {
      const tag = inlineIcons(`<link rel="icon" href="${href}" />`, fromPublic);
      const b64 = /base64,([^"]+)"/.exec(tag)![1];
      expect(Buffer.from(b64, 'base64').equals(fromPublic(href.replace(/^\.?\//, '')))).toBe(true);
    }
  });

  it('已经是 data: 的不动;指向别处的报错(标了 data-file 的也一样)', () => {
    const inline = '<link rel="icon" href="data:image/svg+xml,<svg/>" />';
    expect(inlineIcons(inline, fromPublic)).toBe(inline);
    expect(() => inlineIcons('<link rel="icon" href="https://example.com/i.png" />', fromPublic)).toThrow();
    expect(() => inlineIcons('<link rel="icon" href="icons/i.webp" />', fromPublic)).toThrow();
    expect(() => inlineIcons('<link rel="icon" href="https://example.com/i.ico" sizes="16x16" data-file />', fromPublic)).toThrow();
  });
});
