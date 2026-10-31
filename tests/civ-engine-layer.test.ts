/**
 * 推演引擎(src/gen/civ/engine/:事件堆、两层归属和日志、史事、检查点、每隔几年、数表引擎、确定性随机数)
 * 不认识任何子系统:只许 import 引擎自己、共用的数据形状(civ/types.ts)和通用小工具(gen/util.ts)。
 * 子系统(战争、分合、发展度……)都在规则那一边,经 modules.ts 按清单的次序挂上来。
 * 还没理干净的写在 KNOWN 里,理掉一处就删一处;新加的反向引用会被拦。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ENGINE = path.join('src', 'gen', 'civ', 'engine');
/** 引擎可以引的(不带扩展名,相对仓库根) */
const ALLOWED = ['src/gen/civ/types', 'src/gen/util'];
/** 还没理干净的:引擎文件 → 规则文件。CivSim 带着「天灾」设定(calamity)的类型 */
const KNOWN = ['src/gen/civ/engine/sim.ts → src/gen/civ/calamity'];

const slash = (p: string) => p.split(path.sep).join('/');

function engineFiles(dir: string): string[] {
  const out: string[] = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...engineFiles(p));
    else if (/\.tsx?$/.test(d.name)) out.push(p);
  }
  return out;
}

/** 这些引擎文件里引到引擎以外、又不在 ALLOWED 里的,写成 "文件 → 目标" */
function outsideImports(files: { file: string; src: string }[]): string[] {
  const engine = path.resolve(ENGINE);
  const allowed = new Set(ALLOWED.map((a) => path.resolve(a)));
  const bad: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)['"](\.{1,2}\/[^'"]+)['"]/gm;
  for (const { file, src } of files) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const t = path.resolve(path.dirname(file), m[1]);
      if (t.startsWith(engine + path.sep) || allowed.has(t)) continue;
      bad.push(`${slash(file)} → ${slash(path.relative('.', t))}`);
    }
  }
  return bad;
}

describe('推演引擎不认识子系统', () => {
  it('engine/ 下的文件只引引擎自己、civ/types 和 gen/util(KNOWN 里列着的除外)', () => {
    const files = engineFiles(ENGINE).map((file) => ({ file, src: fs.readFileSync(file, 'utf8') }));
    expect(files.length).toBeGreaterThan(5);
    expect(outsideImports(files).sort()).toEqual([...KNOWN].sort());
  });

  it('查得出来:引擎文件里引子系统的会被拦,引自己、types、util 的不拦', () => {
    const probe = (rel: string, src: string) => outsideImports([{ file: path.join(ENGINE, ...rel.split('/')), src }]);
    expect(probe('sim.ts', "import { warModelOf } from '../wars';")).toEqual(['src/gen/civ/engine/sim.ts → src/gen/civ/wars']);
    expect(probe('tables/engine.ts', "import type { Ideology } from '../../ideology';")).toEqual(['src/gen/civ/engine/tables/engine.ts → src/gen/civ/ideology']);
    expect(probe('sim.ts', "import { Layer } from '../types';\nimport { MinHeap } from '../../util';\nimport { round24 } from './rand';")).toEqual([]);
  });
});
