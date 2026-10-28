/**
 * 首页下载量检查:npx tsx scripts/first-load.ts [构建目录,默认 dist](先 pnpm build)
 *
 * 打开网站时浏览器先要下载的:页面本身、它直接引用的代码(入口和入口静态 import 的几份)、样式。
 * 页面里的加载画面先数着把它们下好再交给浏览器(scripts/lib/loadScreen.ts),要下的写在那一段的文件清单里,从那里读。
 * 主程序(地图、推演、编辑地形、助手、导出……)单独一个文件,首页出来以后才在后台下载(src/ui/Boot.tsx),不算在这里;
 * 首页那颗星球的图第一次来才下,也另列。
 * 每个文件写原大小、gzip(9 级)和 brotli(11 级)压过的大小;网站服务器发预先压好的文件时,下载的就是后两种之一。
 *
 * 首页的代码 + 样式压过(gzip)以后超过 LIMIT_KB 就报错(PR 检查会挂):多半是首页用到的文件静态 import 了只有世界里才用的模块,
 * 把整串代码拖进了首页(下面列出的文件里看得出来)。先想办法拆开(只在用到时 import(),或把首页要的那一小块挪到单独的文件);
 * 首页真的要多下这么多,把 LIMIT_KB 调高,在 PR 里写明多了什么、为什么。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { loadFilesIn } from './lib/loadScreen';

/**
 * 首页的代码 + 样式,gzip 压过以后的上限(KB)。2026-10 拆开主程序后是 240 KB 左右,留了一点余量;
 * 存档里加了大纲以后调到 272:首页的「我的世界」要读存档,读存档时认大纲、把不合格式的情节挑出去的那段代码跟着进了首页(约 2 KB);
 * 大纲有了界面以后调到 276:样式不拆、一个文件跟首页一起下(src/ui/styles.ts),大纲页、编一行、侧栏一组的样式多了约 3–4 KB;
 * 照故事找世界有了界面以后调到 280:同样是样式跟首页一起下,找世界那一页(条件、结果、地图上的小牌子)的样式约 3 KB;
 * 月份能自己起名以后调到 281:读存档时认月份的名字(整理、比较两份存档)跟着进了首页,加上名字格子的样式,共约 0.5 KB
 */
const LIMIT_KB = 281;

const dist = process.argv[2] ?? 'dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
interface Size {
  file: string;
  raw: number;
  gz: number;
  br: number;
}
function sizeOf(file: string): Size {
  const buf = readFileSync(join(dist, file));
  const gz = gzipSync(buf, { level: 9 }).length;
  const br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT } }).length;
  return { file, raw: buf.length, gz: Math.min(gz, buf.length), br: Math.min(br, buf.length) };
}

/** 页面里直接引用的代码、样式(入口、modulepreload、样式表;加载画面文件清单里主程序以外的几样) */
const refs = new Set<string>();
for (const m of html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="\.?\/?([^"]+\.(?:js|css))"[^>]*>/g)) refs.add(m[1]);
const listed = loadFilesIn(html) ?? [];
const strip = (u: string) => u.replace(/^\.?\//, '');
for (const f of listed) if (f[3] !== 3) refs.add(strip(f[0]));
const entry = [...[...html.matchAll(/<script\b[^>]*type="module"[^>]*src="\.?\/?([^"]+\.js)"/g)].map((m) => m[1]), ...listed.filter((f) => f[3] === 1).map((f) => strip(f[0]))];
if (!entry.length) {
  console.error('index.html 里没找到入口代码(<script type="module" src=...>,或加载画面文件清单里的入口),构建的写法可能改过');
  process.exit(1);
}
/** 入口静态 import 的代码(压缩后的写法:import"./x.js"、from"./x.js";动态的 import("./x.js") 不算) */
const queue = [...refs].filter((f) => f.endsWith('.js'));
while (queue.length) {
  const f = queue.shift()!;
  const code = readFileSync(join(dist, f), 'utf8');
  for (const m of code.matchAll(/(?:\bimport|\bfrom)\s*["'](\.\.?\/[^"']+\.js)["']/g)) {
    const dep = posix.normalize(posix.join(dirname(f).replace(/\\/g, '/'), m[1]));
    if (!refs.has(dep)) {
      refs.add(dep);
      queue.push(dep);
    }
  }
}

const rows = [sizeOf('index.html'), ...[...refs].sort().map(sizeOf)];
const code = rows.filter((r) => /\.(js|css)$/.test(r.file));
const sum = (k: 'raw' | 'gz' | 'br', list = rows) => list.reduce((a, r) => a + r[k], 0);

const line = (r: Size) => `  ${r.file.padEnd(34)} ${kb(r.raw).padStart(10)} ${kb(r.gz).padStart(10)} ${kb(r.br).padStart(10)}`;
console.log(`首页要下载的(${dist}):                原大小       gzip     brotli`);
for (const r of rows) console.log(line(r));
console.log(line({ file: '合计', raw: sum('raw'), gz: sum('gz'), br: sum('br') }));

// 另列:第一次来时首页那颗星球的图;首页出来以后在后台下载的主程序和别的代码(进世界、打开某个功能时用)
const planet = 'home-planet.jpg';
if (existsSync(join(dist, planet))) console.log(`\n第一次来时另外下载首页那颗星球的图 ${planet}:${kb(statSync(join(dist, planet)).size)}`);
const assets = existsSync(join(dist, 'assets')) ? readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js') && !refs.has(`assets/${f}`)).sort() : [];
if (assets.length) {
  console.log('\n首页出来以后 / 用到时才下载的代码:');
  for (const f of assets) console.log(line(sizeOf(`assets/${f}`)));
}

const total = sum('gz', code);
console.log(`\n首页的代码 + 样式(gzip):${kb(total)},上限 ${LIMIT_KB} KB`);
if (total > LIMIT_KB * 1024) {
  console.error(
    `首页要下载的代码 + 样式超过上限 ${LIMIT_KB} KB(gzip)。多半是首页用到的文件静态 import 了只有世界里才用的模块,` +
      '把一大串代码拖进了首页:看上面列的文件,把它拆开(用到时再 import(),或者把首页要的那一小块挪到单独的文件)。' +
      '首页真的要多下这么多,把 scripts/first-load.ts 里的 LIMIT_KB 调高,在 PR 里写明多了什么、为什么。',
  );
  process.exit(1);
}
