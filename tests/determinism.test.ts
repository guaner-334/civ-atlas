/**
 * 同一个种子在任何电脑上都生成逐位一致的世界:
 * 地形、文明的**全部数据**(每个类型化数组逐字节、每个小数按 64 位原样,名字也算)按字段各算一个指纹,钉住。
 * CI(x64 Linux)和本地(Apple 芯片 macOS)都要过 —— 推演里 Math.pow / exp / log 算出来、之后要比较或存下来的量
 * 都舍入到 24 位(gen/civ/rand.ts 的 round24),最后一位的差别不会漏进世界里。
 *
 * 对不上时,失败信息里是"哪几个字段变了"。生成算法有意改了(GENERATOR_VERSION 加一)时更新期望值:
 *   PRINT_FINGERPRINT=1 npx vitest run tests/determinism.test.ts
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';

const f64 = new Float64Array(1);
const f64b = new Uint8Array(f64.buffer);

/** 一个值的指纹:类型化数组逐字节,数按 64 位原样,对象按键名排序 */
function print(v: unknown): string {
  const h = createHash('sha1');
  const feed = (x: unknown): void => {
    if (x === null || x === undefined) return void h.update(`~${x}`);
    if (ArrayBuffer.isView(x)) {
      h.update(`<${x.constructor.name}:${x.byteLength}>`);
      return void h.update(new Uint8Array(x.buffer, x.byteOffset, x.byteLength));
    }
    if (Array.isArray(x)) {
      h.update(`[${x.length}`);
      x.forEach(feed);
      return void h.update(']');
    }
    if (typeof x === 'object') {
      for (const k of Object.keys(x as object).sort()) {
        h.update(`.${k}`);
        feed((x as Record<string, unknown>)[k]);
      }
      return;
    }
    if (typeof x === 'number') {
      f64[0] = x;
      h.update('n');
      return void h.update(f64b);
    }
    h.update(`${typeof x}:${String(x)}`);
  };
  feed(v);
  return h.digest('hex').slice(0, 12);
}

/** 地形、文明各字段的指纹(字段名前加 world. / civ.) */
function fingerprint(seed: number): Record<string, string> {
  const w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed });
  const civ = generateCiv(w);
  const out: Record<string, string> = {};
  for (const k of Object.keys(w).sort()) out[`world.${k}`] = print((w as unknown as Record<string, unknown>)[k]);
  for (const k of Object.keys(civ).sort()) out[`civ.${k}`] = print((civ as unknown as Record<string, unknown>)[k]);
  return out;
}

/**
 * 期望值是 GENERATOR_VERSION 10 算的(civ.religion 是后加的字段,加它时别的字段一个没变;10 加了邦交,历史重排)。经纬度换算、沿大圆走、球面三角形面积这些三角函数都舍入到 24 位,
 * 推演里的超越函数也一样,所以各 CPU、各浏览器逐位一致
 */
const EXPECTED: Record<number, Record<string, string>> = {
  2024: {
    'world.biome': 'b2232fa09ac8',
    'world.climate': 'de99136bdcb4',
    'world.currents': 'c1e46947fe67',
    'world.elevation': '39969675c0c3',
    'world.flux': '73f0f86e8cd1',
    'world.height': 'fd7f315bb385',
    'world.history': '3c479ef4810a',
    'world.maxElevation': '5758b63b2859',
    'world.mesh': 'bfa5bc2bb9fd',
    'world.params': '07a29a2f2d8b',
    'world.precipitation': '9eeced9e67ec',
    'world.riverThreshold': '0e691d82f410',
    'world.rivers': '7b1c3d1cfae4',
    'world.seaIce': '6e95af797d23',
    'world.tect': '65c2e4cbd18f',
    'world.temperature': '8cdb493fb809',
    'world.volcanoes': '1184f5b8d4b6',
    'world.water': 'b8b1b2dec1cc',
    'world.waterLevel': '984bd1fa82c4',
    'world.width': '2fd8ac4eb585',
    'civ.annals': '198b0a8e97e3',
    'civ.checkpoints': 'a3dff367e3d6',
    'civ.culture': 'f4216cad1cbe',
    'civ.cultures': '74235ab90a4f',
    'civ.endYear': 'c1d83dcab0a1',
    'civ.habitat': '0770b4ec6d1f',
    'civ.log': 'd2f5f27e1dbc',
    'civ.people': 'f57f67dff762',
    'civ.places': '018f21a6463c',
    'civ.polities': '1b6a38837738',
    'civ.polity': '53ab2c3040cc',
    'civ.polityYears': 'e5d380617183',
    'civ.regions': '424bcc56c069',
    'civ.religion': 'd69dcb562b32',
    'civ.routes': 'fd2d5a88cefd',
    'civ.seed': '3ff6de7b7854',
    'civ.settlements': '2079879099cc',
    'civ.spreadYears': 'c6823047ce89',
    'civ.viable': '139cfad50334',
  },
  7: {
    'world.biome': 'cd5199a8f015',
    'world.climate': 'd66f2d1ccdb0',
    'world.currents': 'ab8cb1978a52',
    'world.elevation': '8dd2243190fe',
    'world.flux': 'f328c57ed71d',
    'world.height': 'fd7f315bb385',
    'world.history': '46fb0f6b62a1',
    'world.maxElevation': '026a5ab67a87',
    'world.mesh': 'c2903f932177',
    'world.params': 'e48d0dd04f61',
    'world.precipitation': '64a4db7fd02c',
    'world.riverThreshold': '54110659ac90',
    'world.rivers': 'c703a73bafaf',
    'world.seaIce': 'b16745284c0d',
    'world.tect': 'ca74fad97a86',
    'world.temperature': '6b2db55adccb',
    'world.volcanoes': '1184f5b8d4b6',
    'world.water': '9dafa02952ec',
    'world.waterLevel': '1376ef2bd877',
    'world.width': '2fd8ac4eb585',
    'civ.annals': 'f336cd1a272c',
    'civ.checkpoints': '2ba14aa4d25b',
    'civ.culture': '154fc97177d9',
    'civ.cultures': 'fa55a9473a9f',
    'civ.endYear': 'c1d83dcab0a1',
    'civ.habitat': 'a791d67c4be9',
    'civ.log': '3fb19349b0c4',
    'civ.people': '2afc8d03f9f6',
    'civ.places': '56dea8d59f93',
    'civ.polities': '6f5970092792',
    'civ.polity': 'a812b47f3b4d',
    'civ.polityYears': 'e5d380617183',
    'civ.regions': '0c38bc61e9cb',
    'civ.religion': 'cbfbee39fe3f',
    'civ.routes': '197b25ded6ab',
    'civ.seed': '0096064c9137',
    'civ.settlements': '35378e5f9112',
    'civ.spreadYears': 'd7a11af211a1',
    'civ.viable': '139cfad50334',
  },
};

describe('同一个种子在任何电脑上都是同一个世界', () => {
  it.each([2024, 7])('seed %i(12k 地块):地形、文明全部数据的指纹逐字段对得上', (seed) => {
    const fp = fingerprint(seed);
    if (process.env.PRINT_FINGERPRINT) console.log(`${seed}: ${JSON.stringify(fp, null, 2)}`);
    expect(fp).toEqual(EXPECTED[seed]);
  }, 60_000);
});
