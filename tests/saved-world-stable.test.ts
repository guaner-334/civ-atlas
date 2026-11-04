/**
 * 存下的世界,软件更新以后打开还要是原来的样子。
 *
 * 存下的数据是胶片,读它的代码是放映机:数据原样存着,读的代码一变,世界照样变样。这里从仓库里的样本
 * (tests/fixtures/saved-worlds/)读出世界,用当前的代码算出结果和基准比,**不重新生成世界**,所以升生成器版本不用动样本。
 * 比什么、不比什么、基准长什么样,见 tests/lib/savedWorlds.ts。
 *
 * 另外看着世界的重量:默认世界打包压缩后不能超预算。
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateCiv } from '../src/gen/civ';
import { flagBook } from '../src/gen/civ/story/flags';
import { fullChronicle } from '../src/gen/civ/story/religionText';
import { makePart } from '../src/gen/snapshot';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { BASELINE_FILE, CHRONICLE_FILE, GROUPS, chronicleChange, itemChange, readSample, readSamples, type ChronicleDigest, type Digest, type SampleReading } from './lib/savedWorlds';

const SAMPLES = readSamples();
const BASE = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Record<string, Record<string, Digest>>;
const CHRONICLE = JSON.parse(readFileSync(CHRONICLE_FILE, 'utf8')) as Record<string, ChronicleDigest>;

/** 读样本(铺全图是最慢的一步)要的时间;GitHub 的机器比本机慢好几倍,几个文件同时跑时更慢 */
const READ_TIMEOUT = 120_000;

const FIX_IT = [
  '用的人存好的世界,打开时就是这段代码读出来的。这一项变了,他们已经存好的世界也跟着变,所以请把这次改动对这一项的影响改回去。',
  '要换算法也可以,但存下的世界得继续读出原来的结果。',
].join('\n');

describe.each(SAMPLES)('存下的世界读出来不变:$title', (s) => {
  let read: SampleReading;
  beforeAll(async () => {
    read = await readSample(s);
  }, READ_TIMEOUT);

  it.each(GROUPS)('$title', ({ id, title }) => {
    const base = BASE[s.name];
    const items = read.items.filter((x) => x.group === id);
    const lines = items.map((x) => (base[x.id] ? itemChange(base[x.id], x) : `${x.label}:基准里没有这一项`)).filter(Boolean);
    if (lines.length) throw new Error(`存下的世界读出来变了(${s.title} · ${title}):\n${lines.join('\n')}\n\n${FIX_IT}\n`);
  });

  it('基准里的每一项都还在比', () => {
    expect(read.items.map((x) => x.id).sort()).toEqual(Object.keys(BASE[s.name]).sort());
  });

  it('编年史', () => {
    const change = chronicleChange(CHRONICLE[s.name], read.chronicle);
    if (change) {
      throw new Error(
        [
          `存下的世界读出来变了(${s.title} · 编年史):`,
          change,
          '',
          '编年史现在还是打开世界时由代码现写的,写法一改,存好的世界里的文字也跟着改。',
          '不是有意改写法的话,请改回去。',
          '确实是有意改的:运行 npx tsx scripts/saved-worlds.ts chronicle 更新基准,再在 PR 里写明为什么改。',
          '',
        ].join('\n'),
      );
    }
  });
});

/**
 * 默认世界(3.6 万地块、3000 年)打包压缩后最多多少字节(1 MB = 100 万字节)。
 *
 * 定这个数时:种子 7 是 4.86 MB,种子 2024 是 4.90 MB,这里留了两成多的余量。
 * 世界存在用的人的浏览器里,也要上传、下载;它变重,打开、存、传都跟着变慢,占的地方也跟着变大,所以一变重就要有人知道。
 * 只量种子 7:两个种子差不到 1%,再量一个要多等一倍。
 */
const WORLD_BUDGET = 6_000_000;

describe('世界的重量', () => {
  it(
    `默认世界打包压缩后不超过 ${WORLD_BUDGET / 1e6} MB`,
    async () => {
      const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
      const civ = generateCiv(world);
      // 地图、历史和网站打包世界同一个办法(地图不带形成过程的回放快照);编年史、国旗也是这个世界要给人看的内容,一起算重量
      const parts = [
        await makePart('map', { ...world, history: [] }),
        await makePart('eras', { baseKey: '', eras: [] }),
        await makePart('civ', civ),
        await makePart('chronicle', fullChronicle(civ)),
        await makePart('flags', flagBook(world, civ)),
      ];
      const size = parts.reduce((n, p) => n + p.data.byteLength, 0);
      const each = parts.map((p) => `${p.name} ${(p.data.byteLength / 1e6).toFixed(2)} MB`).join(',');
      expect(size, `默认世界打包后 ${(size / 1e6).toFixed(2)} MB(${each}),超过了预算。世界变重,存、打开、上传、下载都跟着变慢。先看是哪一块变重了,能减就减;确实要加重的,调大 WORLD_BUDGET,在 PR 里写明为什么。`).toBeLessThanOrEqual(WORLD_BUDGET);
    },
    READ_TIMEOUT,
  );
});
