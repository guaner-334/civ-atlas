/**
 * 推演代码分两边:推演规则(src/gen/civ/ 下 story/ 以外的文件)只管把历史推出来;
 * 讲故事的文字和查询(src/gen/civ/story/:编年史、各种说明文字、人物称呼、条约和大疫的整理……)只读推演结果。
 * 规则那一边一律不许 import story/ 里的东西(连类型也不许):不然改一句说明文字就可能改了历史,
 * 换一套文字也没法不碰规则。story/ 引规则那一边没关系。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CIV = path.join('src', 'gen', 'civ');
const STORY = path.join(CIV, 'story');

/** 目录树下的 .ts 文件(跳过 story/) */
function ruleFiles(dir: string): string[] {
  const out: string[] = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) {
      if (path.resolve(p) !== path.resolve(STORY)) out.push(...ruleFiles(p));
    } else if (/\.tsx?$/.test(d.name)) out.push(p);
  }
  return out;
}

/** 一段源码里相对路径的 import / export ... from / import() 指到哪(相对 file 解析成绝对路径,不带扩展名) */
function importsOf(file: string, src: string): string[] {
  const out: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)['"](\.{1,2}\/[^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(path.resolve(path.dirname(file), m[1]));
  return out;
}

/** 这些规则文件里引了 story/ 的,写成 "文件 → 目标" */
function storyImports(files: { file: string; src: string }[]): string[] {
  const story = path.resolve(STORY);
  const slash = (p: string) => p.split(path.sep).join('/');
  const bad: string[] = [];
  for (const { file, src } of files)
    for (const t of importsOf(file, src))
      if (t === story || t.startsWith(story + path.sep)) bad.push(`${slash(file)} → ${slash(path.relative('.', t))}`);
  return bad;
}

describe('推演规则不引讲故事的文件', () => {
  it('story/ 目录在,里面有编年史', () => {
    expect(fs.existsSync(path.join(STORY, 'chronicle.ts'))).toBe(true);
  });

  it('src/gen/civ 下 story/ 以外的文件一个也不 import story/', () => {
    const files = ruleFiles(CIV).map((file) => ({ file, src: fs.readFileSync(file, 'utf8') }));
    expect(files.length).toBeGreaterThan(50);
    expect(storyImports(files)).toEqual([]);
  });

  it('查得出来:规则文件里引 story/(含只引类型、在子目录里)的会被拦,引规则那一边的不拦', () => {
    const probe = (rel: string, src: string) => storyImports([{ file: path.join(CIV, ...rel.split('/')), src }]);
    expect(probe('wars.ts', "import { regionLabel } from './story/display';")).toEqual(['src/gen/civ/wars.ts → src/gen/civ/story/display']);
    expect(probe('tables/cards.ts', "import type { Owners } from '../story/religionText';")).toEqual(['src/gen/civ/tables/cards.ts → src/gen/civ/story/religionText']);
    expect(probe('wars.ts', "const m = await import('./story/chronicle');")).toHaveLength(1);
    expect(probe('wars.ts', "import { ownersAt } from './timeline';\nimport { storyline } from './storyline';")).toEqual([]);
  });
});
