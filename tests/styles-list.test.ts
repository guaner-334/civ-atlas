/**
 * 所有样式都列在 src/ui/styles.ts 里(打开网页时和首页的代码一起下载、拼成一个文件、先后照那里)。
 * 漏列的样式会跟着主程序晚一步才到,页面先按没有它的样子画一下,先后也和原来不一样。
 * 例外:ON_DEMAND 里的是点了才下载的那一包自己的样式(和它的代码一起下载,代码跑起来之前就到了,不会先按没有它的样子画),
 * 不列进 styles.ts,免得打开网页时多下载用不着的样式。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const UI = join(__dirname, '..', 'src', 'ui');
/** 点了才下载的那一包自己的样式(立体地形:ui/terrain3d/,App 里按需加载;调规则的页:ui/rules/,打开时才加载) */
const ON_DEMAND = ['terrain3d/terrain3d.css', 'rules/rules.css'];

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...cssFiles(p));
    else if (e.name.endsWith('.css')) out.push(relative(UI, p).replace(/\\/g, '/'));
  }
  return out;
}

describe('styles.ts', () => {
  it('src/ui 下的样式文件都列在 styles.ts 里,各一次', () => {
    const listed = [...readFileSync(join(UI, 'styles.ts'), 'utf8').matchAll(/^import '\.\/(.+\.css)';$/gm)].map((m) => m[1]);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(cssFiles(UI).filter((f) => !ON_DEMAND.includes(f)).sort());
    for (const f of ON_DEMAND) expect(cssFiles(UI)).toContain(f);
  });

  it('样式只在 src/ui 下(别处的样式也要加进 styles.ts)', () => {
    const src = join(UI, '..');
    const elsewhere = readdirSync(src, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'ui')
      .flatMap((e) => cssFiles(join(src, e.name)));
    expect(elsewhere).toEqual([]);
  });
});
