/**
 * 代码分层:生成(src/gen)→ 画图(src/render)→ 界面(src/ui),只许后面的引前面的。
 *   - src/gen 是纯计算(后台线程、Node 里都跑),不许引 render、ui、ai、account
 *   - src/render 只读世界数据画图,不许引 ui、ai、account
 * 反过来引会把画图、界面(连带 React)拉进生成的后台线程,生成和画图也没法单独测试、复用。
 * 认 import、import type、export … from、动态 import(用 TypeScript 自带的扫描,注释和字符串里的不算)。
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** 每一层(src 下的顶层目录)不许引哪几层 */
const FORBIDDEN: Readonly<Record<string, readonly string[]>> = {
  gen: ['render', 'ui', 'ai', 'account'],
  render: ['ui', 'ai', 'account'],
};

const SCRIPT_EXT = /\.tsx?$/;

/** 一段源码引到的模块(写在引号里的原样) */
function importsOf(source: string): string[] {
  return ts.preProcessFile(source, true, true).importedFiles.map((f) => f.fileName);
}

/** file(src 下的路径,用 /)引 spec 时落到 src 下哪个顶层目录;依赖包、出了 src 的 = null */
function layerOf(file: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const to = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
  if (to === '..' || to.startsWith('../')) return null;
  return to.split('/')[0];
}

/** file(src 下的路径,用 /)里不许有的引用,写成 "gen/a.ts → ../render/b" */
function violations(file: string, source: string): string[] {
  const banned = FORBIDDEN[file.split('/')[0]] ?? [];
  return importsOf(source)
    .filter((spec) => {
      const layer = layerOf(file, spec);
      return layer !== null && banned.includes(layer);
    })
    .map((spec) => `${file} → ${spec}`);
}

/** src 下某个目录里所有的 .ts / .tsx(src 下的路径,用 /) */
function scriptsUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const d of fs.readdirSync(path.join('src', rel), { withFileTypes: true })) {
      const next = `${rel}/${d.name}`;
      if (d.isDirectory()) walk(next);
      else if (SCRIPT_EXT.test(d.name)) out.push(next);
    }
  };
  walk(dir);
  return out.sort();
}

describe('代码分层', () => {
  it('认得出各种写法;注释和字符串里的不算', () => {
    const source = [
      "/** 例子:import { x } from '../ui/inDoc'; */",
      "// import y from '../ui/inComment';",
      "import type { A } from '../ui/a';",
      'import {',
      '  b,',
      '  type C,',
      "} from '../ui/b';",
      "export { d } from '../ui/d';",
      "export type { E } from '../ui/e';",
      "import '../ui/f';",
      "const g = await import('../ui/g');",
      "const h = \"from '../ui/inString'\";",
    ].join('\n');
    expect(importsOf(source)).toEqual(['../ui/a', '../ui/b', '../ui/d', '../ui/e', '../ui/f', '../ui/g']);
  });

  it('按路径认层:往上走几级都认得,同层、往下引和依赖包不算', () => {
    const gen = ["import { a } from '../../render/common';", "import { b } from '../util';", "import c from 'simplex-noise';", "import type { D } from '../../account/x';"].join('\n');
    expect(violations('gen/civ/x.ts', gen)).toEqual(['gen/civ/x.ts → ../../render/common', 'gen/civ/x.ts → ../../account/x']);
    const render = [
      "import type { T } from '../ui/y';",
      "import { g } from '../gen/z';",
      "import { h } from './common';",
      "import { k } from '../ai/k';",
      "import type { M } from '../account/m';",
    ].join('\n');
    expect(violations('render/x.ts', render)).toEqual(['render/x.ts → ../ui/y', 'render/x.ts → ../ai/k', 'render/x.ts → ../account/m']);
    expect(violations('ui/x.ts', "import { r } from '../render/common';")).toEqual([]);
  });

  it('src/gen 不引 render、ui、ai、account;src/render 不引 ui、ai、account', () => {
    const files = [...scriptsUnder('gen'), ...scriptsUnder('render')];
    expect(files.length).toBeGreaterThan(50);
    const bad = files.flatMap((f) => violations(f, fs.readFileSync(path.join('src', f), 'utf8')));
    expect(bad).toEqual([]);
  });
});
