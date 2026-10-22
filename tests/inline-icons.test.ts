/**
 * 浏览器标签上的图标写进页面(scripts/lib/inlineIcons.ts):页面里不再有要另外请求的图标,
 * 写进去的内容和图标文件一个字节不差(标签上的图标看着不变)
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ICON_LINK, inlineIcons } from '../scripts/lib/inlineIcons';

const fromPublic = (f: string) => readFileSync(new URL(`../public/${f}`, import.meta.url));
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const iconTags = (h: string) => [...h.matchAll(ICON_LINK)].map((m) => m[0]);

describe('网页图标写进页面', () => {
  const out = inlineIcons(html, fromPublic);

  it('index.html 里的图标都换成 data: 网址,内容和文件一样', () => {
    const before = iconTags(html);
    const after = iconTags(out);
    expect(before.length).toBeGreaterThanOrEqual(2);
    expect(after).toHaveLength(before.length);
    for (const [i, tag] of after.entries()) {
      const m = /\bhref="data:([^;]+);base64,([^"]+)"/.exec(tag);
      expect(m, tag).not.toBeNull();
      const file = /\bhref="(?:\.\/)?([^"]+)"/.exec(before[i])![1];
      expect(Buffer.from(m![2], 'base64').equals(fromPublic(file))).toBe(true);
      expect(m![1]).toBe(file.endsWith('.svg') ? 'image/svg+xml' : 'image/x-icon');
      // 别的属性(sizes、type)照旧:浏览器挑哪个图标和以前一样
      expect(tag.replace(/\bhref="[^"]*"/, '')).toBe(before[i].replace(/\bhref="[^"]*"/, ''));
    }
  });

  it('页面别的地方不动(手机主屏图标照旧指向文件)', () => {
    const strip = (h: string) => h.replace(ICON_LINK, '');
    expect(strip(out)).toBe(strip(html));
    expect(out).toContain('<link rel="apple-touch-icon" href="apple-touch-icon.png" />');
  });

  it('已经是 data: 的不动;指向别处的报错', () => {
    const inline = '<link rel="icon" href="data:image/svg+xml,<svg/>" />';
    expect(inlineIcons(inline, fromPublic)).toBe(inline);
    expect(() => inlineIcons('<link rel="icon" href="https://example.com/i.png" />', fromPublic)).toThrow();
    expect(() => inlineIcons('<link rel="icon" href="icons/i.webp" />', fromPublic)).toThrow();
  });
});
