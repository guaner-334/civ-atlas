/**
 * 存下的世界,软件更新以后打开还要是原来的样子。
 *
 * 存下的数据是胶片,读它的代码是放映机:数据原样存着,读的代码一变,世界照样变样。这里从仓库里的样本
 * (tests/fixtures/saved-worlds/)读出世界,用样本记的那一版读取代码算出结果和基准比,**不重新生成世界**,所以升生成器版本不用动样本。
 *
 * 比什么:用的人看得出是「这个世界本身」的东西,打开世界和放大时读出来的都算。
 *   - 铺全图像素:水陆、地貌、海拔、气温、降水、海冰(程度、浓度、色调)、湿地、河边、沟壑、细沟、每个像素归哪个地块;
 *     地形大事以后界面上拼出来的那张主图也比(大事以后真正铺的主图贴到原来那张上)。
 *   - 放大时的分块:上面这些在放大的块里的样子(2、4、8、16 倍都有块,块挑在河口、高山、东西接缝、冰缘、湿地、细沟、地形大事的地方),
 *     河口的颜色系数,还有放大现算要用的线(河和小溪的河道、河口、细沟)。放大后的细部也是世界的一部分,所以和全图一样不许变。
 *   - 人口和城市等级;某年的归属、主体民族和信仰;某年的史实:国都、国号、国家在不在、在位的君主、港口、遗址、开发度、物产、实控、思潮。
 *   - 国旗(从哪年起、第几朝、什么样)和编年史原文。这两样现在还是打开时由代码现写的,以后存进世界就不靠代码了。
 *
 * 不比什么:这些可以随软件变好,老世界打开也跟着变好,比了反而拦住改进。
 *   画风渲染(同样的海拔画成什么颜色)、界面、国界的抖动和平滑、地名避让、卡片上的解说文字(包括旗帜详情里讲旗的意思的那些字)、
 *   手绘风的符号怎么摆。导出大图用的是同一套铺像素的代码,只是倍数不同,不再单独比。
 *
 * 基准长什么样见 tests/lib/savedWorlds.ts。
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
  '要换算法也可以,但存下的世界得继续读出原来的结果:把旧代码留一份,新世界才用新算法,做法见 src/gen/readers/index.ts 的文件头。',
].join('\n');

/** 国旗还没有存进世界,也不分版本,没有留旧代码这条路 */
const FIX_FLAGS = '用的人存好的世界,打开时国旗是这段代码现算的。这一项变了,他们已经存好的世界里的旗也跟着变,所以请把这次改动对旗的影响改回去。';

describe.each(SAMPLES)('存下的世界读出来不变:$title', (s) => {
  let read: SampleReading;
  beforeAll(async () => {
    read = await readSample(s);
  }, READ_TIMEOUT);

  it.each(GROUPS)('$title', ({ id, title }) => {
    const base = BASE[s.name];
    const items = read.items.filter((x) => x.group === id);
    const lines = items.map((x) => (base[x.id] ? itemChange(base[x.id], x) : `${x.label}:基准里没有这一项`)).filter(Boolean);
    if (lines.length) throw new Error(`存下的世界读出来变了(${s.title} · ${title}):\n${lines.join('\n')}\n\n${id === 'flags' ? FIX_FLAGS : FIX_IT}\n`);
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
