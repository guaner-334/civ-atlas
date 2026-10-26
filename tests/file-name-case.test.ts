/**
 * 源码文件名不许只差大小写。
 * Windows、macOS 默认的文件系统不分大小写:同一目录里有 `GratLabels.tsx` 和 `gratLabels.ts` 时,
 * `import { GratLabels } from './GratLabels'` 先试 `.ts`,命中的是 `gratLabels.ts`,开发服务器报
 * "No matching export",整个界面白屏;Linux 上一切正常,所以 PR 检查拦不住,只能靠这条单测。
 * 只比能被不带扩展名 import 到的:脚本文件(去掉扩展名比)和目录(可经 index.ts 解析到);
 * `.css`、`.json` 这类总是带扩展名引用的不算。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** .ts .tsx .js .jsx .mjs .cjs .mts .cts */
const SCRIPT_EXT = /\.[cm]?[jt]sx?$/;

interface Entry {
  name: string;
  dir: boolean;
}

/** 一个目录里去掉扩展名后只差大小写的名字,一组一个数组;没有就是空数组 */
function caseClashes(entries: Entry[]): string[][] {
  const groups = new Map<string, { stems: Set<string>; names: string[] }>();
  for (const e of entries) {
    const stem = e.dir ? e.name : SCRIPT_EXT.test(e.name) ? e.name.replace(SCRIPT_EXT, '') : null;
    if (stem === null) continue;
    const key = stem.toLowerCase();
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { stems: new Set(), names: [] }));
    g.stems.add(stem);
    g.names.push(e.dir ? `${e.name}/` : e.name);
  }
  return [...groups.values()].filter((g) => g.stems.size > 1).map((g) => g.names.sort());
}

/** 整棵目录树里撞名的,写成 "目录: a.ts ↔ A.tsx" */
function clashesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).map((d) => ({ name: d.name, dir: d.isDirectory() }));
    for (const g of caseClashes(entries)) out.push(`${path.relative('.', dir).split(path.sep).join('/')}: ${g.join(' ↔ ')}`);
    for (const e of entries) if (e.dir && e.name !== 'node_modules') walk(path.join(dir, e.name));
  };
  walk(root);
  return out;
}

/** 名字以 / 结尾的当目录 */
const files = (...names: string[]): Entry[] =>
  names.map((n) => (n.endsWith('/') ? { name: n.slice(0, -1), dir: true } : { name: n, dir: false }));

describe('文件名只差大小写', () => {
  it('认得出撞名:脚本文件之间、脚本文件和目录之间', () => {
    expect(caseClashes(files('GratLabels.tsx', 'gratLabels.ts', 'GratLabels.css'))).toEqual([['GratLabels.tsx', 'gratLabels.ts']]);
    expect(caseClashes(files('Foo.tsx', 'foo/'))).toEqual([['Foo.tsx', 'foo/']]);
    expect(caseClashes(files('a.mjs', 'A.js', 'b.ts'))).toEqual([['A.js', 'a.mjs']]);
  });

  it('不算撞名:带扩展名引用的文件、大小写一样只差扩展名的', () => {
    expect(caseClashes(files('App.tsx', 'app.css', 'App.json'))).toEqual([]);
    expect(caseClashes(files('worker.ts', 'worker.tsx', 'Worker.md'))).toEqual([]);
    expect(caseClashes(files('theme.css', 'Theme.css'))).toEqual([]);
  });

  it('src/ 和 scripts/ 里没有只差大小写的同名', () => {
    expect([...clashesUnder('src'), ...clashesUnder('scripts')]).toEqual([]);
  });
});
