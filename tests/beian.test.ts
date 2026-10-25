import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BEIAN_PAGES, BEIAN_SLOT, beianLinks, fillBeian } from '../scripts/lib/beian';
import { LOAD_STYLE, loadScreenMarkup } from '../scripts/lib/loadScreen';
import { BeianLinks } from '../src/ui/BeianLinks';
import { BEIAN, ICP_QUERY_URL, beianRecords } from '../src/ui/beian';

const NO = '京ICP备00000000号-1';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle r="46"/></svg>';

describe('备案号从哪来', () => {
  it('构建时没给号码(自己架的网站、本机开发):一个都不挂', () => {
    expect(beianRecords(undefined)).toEqual([]);
    expect(beianRecords(null)).toEqual([]);
    expect(beianRecords('')).toEqual([]);
    expect(beianRecords('  \n')).toEqual([]);
  });

  it('给了号码:原样一项,点了打开工信部的备案查询', () => {
    expect(beianRecords(` ${NO} `)).toEqual([{ id: 'icp', text: NO, href: 'https://beian.miit.gov.cn/' }]);
    expect(ICP_QUERY_URL).toBe('https://beian.miit.gov.cn/');
  });

  it('这次构建挂的就是环境变量 ICP_BEIAN 给的(没设 = 不挂)', () => {
    expect(BEIAN).toEqual(beianRecords(process.env.ICP_BEIAN));
  });
});

describe('页面上的备案号', () => {
  it('没有号码:什么都不画', () => {
    expect(renderToStaticMarkup(createElement(BeianLinks, { className: 'mw-beian', list: [] }))).toBe('');
  });

  it('有号码:整串是一个链接,新标签页打开', () => {
    const html = renderToStaticMarkup(createElement(BeianLinks, { className: 'mw-beian', list: beianRecords(NO) }));
    expect(html).toBe(`<span class="mw-beian" data-beian="true"><a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer" data-link="beian-icp">${NO}</a></span>`);
  });
});

describe('加载画面上的备案号', () => {
  it('没有号码:不加那一行', () => {
    expect(loadScreenMarkup(svg)).not.toContain('<footer');
    expect(loadScreenMarkup(svg, [])).not.toContain('<a ');
  });

  it('有号码:最底下一行,和图标、名字一起淡入', () => {
    const m = loadScreenMarkup(svg, beianRecords(NO));
    expect(m.endsWith(`<p aria-live="polite"></p><footer><a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">${NO}</a></footer>`)).toBe(true);
    // 离底和首页一样:电脑 22,手机 24 加底部横条
    expect(LOAD_STYLE).toContain('#ld footer{position:absolute;left:0;right:0;bottom:22px;');
    expect(LOAD_STYLE).toContain('@media (max-width:760px){#ld footer{bottom:calc(24px + env(safe-area-inset-bottom,0px))');
  });

  it('号码里的特殊字符转义', () => {
    expect(beianLinks([{ id: 'icp', text: 'a<b>&"', href: 'https://x/?a=1&b="2"' }])).toBe('<a href="https://x/?a=1&amp;b=&quot;2&quot;" target="_blank" rel="noreferrer">a&lt;b&gt;&amp;&quot;</a>');
  });
});

describe('隐私政策、用户协议、使用教程', () => {
  it('每一页都留了一处位置', () => {
    for (const page of BEIAN_PAGES) {
      const html = readFileSync(new URL(`../public/${page}`, import.meta.url), 'utf8');
      expect(html.split(BEIAN_SLOT).length - 1, page).toBe(1);
      expect(html, page).toMatch(/\.beian \{/);
    }
  });

  it('没有号码:只去掉留的位置', () => {
    const html = `<main><footer>x</footer>\n${BEIAN_SLOT}\n</main>`;
    expect(fillBeian(html, [])).toBe('<main><footer>x</footer>\n\n</main>');
  });

  it('有号码:换成居中的一行链接', () => {
    const html = `<main><footer>x</footer>\n${BEIAN_SLOT}\n</main>`;
    expect(fillBeian(html, beianRecords(NO))).toBe(`<main><footer>x</footer>\n<p class="beian"><a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">${NO}</a></p>\n</main>`);
  });
});
