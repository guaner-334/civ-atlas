/**
 * 算法要改、旧的要留一份时,把现在这一版读取代码复制成存底。整套步骤见 src/gen/readers/index.ts。
 *
 *   npx tsx scripts/freeze-reader.ts terrain              从 origin/main 上取(先 git fetch)
 *   npx tsx scripts/freeze-reader.ts query --from <提交>   从指定的提交上取
 *
 * 取的是 git 里的代码,不是工作区的:一般是算法已经改了、测试红了才想起来要留,工作区里已经是新的了。
 * 只复制,不改版本号和登记表;要改的那两处打印出来。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { READER_VERSIONS, type ReaderKind } from '../src/gen/readers/versions';
import { frozenText, readerFiles, type ReadFile } from './lib/readerCopy';

const ROOT = 'src/gen';
const [kind] = process.argv.slice(2);
const at = process.argv.indexOf('--from');
const rev = at > 0 ? process.argv[at + 1] : 'origin/main';

if (kind !== 'terrain' && kind !== 'query') {
  console.error('用法见文件头:要写 terrain 或 query');
  process.exit(1);
}

const version = READER_VERSIONS[kind as ReaderKind];
const dir = `${ROOT}/readers/${kind}/v${version}`;
if (existsSync(dir)) {
  console.error(`${dir} 已经有了。存底只读,不重新复制;版本号是不是还没加一?`);
  process.exit(1);
}

const cache = new Map<string, string | null>();
const read: ReadFile = (path) => {
  if (!cache.has(path)) {
    try {
      cache.set(path, execFileSync('git', ['show', `${rev}:${path}`], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch {
      cache.set(path, null);
    }
  }
  return cache.get(path)!;
};

const entry = `${ROOT}/readers/${kind}Code.ts`;
const files = readerFiles(read, entry, ROOT);
const set = new Set(files);
const note = `第 ${version} 版${kind === 'terrain' ? '地貌' : '查询'}读取代码的存底:打开记着这一版的老世界时用。只读,不要改,改了老世界打开就变样(见 src/gen/readers/index.ts)。`;
for (const f of files) {
  const to = join(dir, relative(ROOT, f));
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, frozenText(read, f, set, dir, ROOT, note));
}
console.log(`从 ${rev} 复制了 ${files.length} 个文件到 ${dir}。接下来:`);
const Type = kind === 'terrain' ? 'TerrainReader' : 'QueryReader';
console.log(`  1. src/gen/readers/${kind}Reader.ts 的 OLDER 里加一行:`);
console.log(`     ${version}: () => import('./${kind}/v${version}/readers/${kind}Code') as Promise<unknown> as Promise<${Type}>,`);
console.log(`  2. src/gen/readers/versions.ts 的 READER_VERSIONS.${kind} 改成 ${version + 1}`);
console.log('  3. 跑 tests/saved-world-stable.test.ts,再照 src/gen/readers/index.ts 的步骤往下做');
