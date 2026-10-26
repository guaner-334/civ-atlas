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
  for (const k of Object.keys(civ).sort()) {
    // 地图上画的关隘(Place.kind = 'pass')是后加的:别的地名单算一份(加关隘时它一个字没变),关隘另算一份
    if (k === 'places') {
      out['civ.places'] = print(civ.places.filter((p) => p.kind !== 'pass'));
      out['civ.places.pass'] = print(civ.places.filter((p) => p.kind === 'pass'));
    } else out[`civ.${k}`] = print((civ as unknown as Record<string, unknown>)[k]);
  }
  return out;
}

/**
 * 期望值是 GENERATOR_VERSION 24 算的(civ.religion 是后加的字段,加它时别的字段一个没变;地图上画的关隘(civ.places 里的 pass,算在 civ.places.pass)也是后加的,加它时别的字段、别的地名一个没变;10 加了邦交、11 加了君主性格和扩张算账,历史都重排;12 只改了 civ.people:多了名臣,将领有了字号、籍贯、官职,撞名的将领换了名字;13 改了宜居度和城的人口上限,地形一个字段没变,历史重排;多了 civ.capNorm;14 处理了封闭内海、贴着海的湖、湖心小块地,地形局部变了、历史重排;15 立国更早、多了边缘立国和民族分化,历史重排;civ.development 是后加的字段,加它时别的字段一个没变;16 有了航海时代,历史重排;17 发展度反过来影响人口、打仗和远航,各国自己进航海时代,历史重排;18 降水分夏冬两半年算、河多了,地形不变,气候、河流、历史重排;19 仗短而狠、乘胜连下、前线拉锯,历史重排;20 有了饥荒、民变、大崩解,历史重排;23 推完以后的整理只看每样东西出现以前的历史,归属、日志、史事、检查点一个没变,民族、州、城、国家、人物、地名、道路、信仰重排,多了 civ.capSpacing;24 推演里走过的航线不通到遗址,只有 civ.routes 变了;36 君主有了诸子、王子领兵、争储,宗室据地自立,历史重排)。经纬度换算、沿大圆走、球面三角形面积这些三角函数都舍入到 24 位,
 * 推演里的超越函数也一样,所以各 CPU、各浏览器逐位一致
 */
const EXPECTED: Record<number, Record<string, string>> = {
  2024: {
    'world.biome': 'e3a907d36819',
    'world.climate': 'de99136bdcb4',
    'world.currents': '41ded18e783d',
    'world.elevation': '3371d4f88502',
    'world.flux': 'eb38bf365d77',
    'world.height': 'fd7f315bb385',
    'world.history': '15db6dec2bfa',
    'world.maxElevation': 'd1ba197be798',
    'world.mesh': 'bfa5bc2bb9fd',
    'world.params': '192477c360fd',
    'world.precipitation': '9136b576c0bb',
    'world.riverThreshold': 'e2e2f2922c0a',
    'world.rivers': '1f198061413e',
    'world.seaIce': '036578bd5088',
    'world.tect': '46e2825b8bd6',
    'world.temperature': '66911484f50e',
    'world.volcanoes': '1184f5b8d4b6',
    'world.water': '78ebae4644e5',
    'world.waterLevel': 'eb3f3f7cdd31',
    'world.width': '2fd8ac4eb585',
    'civ.annals': '024b5296ac1d',
    'civ.capNorm': '9b2058f28291',
    'civ.capSpacing': '8fda3225da8f',
    'civ.checkpoints': '302abd9c2eef',
    'civ.culture': '1e8912aff3af',
    'civ.cultures': '4f29bd8d54ec',
    'civ.development': '001e01090227',
    'civ.endYear': 'c1d83dcab0a1',
    'civ.habitat': '35d8ad95d249',
    'civ.log': '8e924057f22b',
    'civ.people': '5471b3b2dc5d',
    'civ.places': 'e82d872374d7',
    'civ.places.pass': '19a5fa278977',
    'civ.polities': 'faa163977442',
    'civ.polity': '0400bb0f86d5',
    'civ.polityYears': 'e5d380617183',
    'civ.regions': '27066bf6c8a7',
    'civ.religion': '3bede5e4e8ef',
    'civ.routes': '8e0f7cd9ec52',
    'civ.sailFrom': '5bd9534e2395',
    'civ.seed': '3ff6de7b7854',
    'civ.settlements': 'cca540f62fa7',
    'civ.spreadYears': '61c69775ebc4',
    'civ.viable': '139cfad50334',
  },
  7: {
    'world.biome': '4cdf863704e1',
    'world.climate': 'd66f2d1ccdb0',
    'world.currents': '12874885f306',
    'world.elevation': 'f01aa0301717',
    'world.flux': 'b2ed8d63c492',
    'world.height': 'fd7f315bb385',
    'world.history': 'c6e74f54fbd3',
    'world.maxElevation': 'e1e7e5545349',
    'world.mesh': 'c2903f932177',
    'world.params': 'd5d90d26a425',
    'world.precipitation': 'b28a1616b918',
    'world.riverThreshold': '5cd46994cd42',
    'world.rivers': 'dab6acc2c8e1',
    'world.seaIce': 'b525553d04bc',
    'world.tect': '3ceab03d7b8c',
    'world.temperature': '72dda8cb251f',
    'world.volcanoes': '1184f5b8d4b6',
    'world.water': '3b5ac6e5ff00',
    'world.waterLevel': '35508e445f12',
    'world.width': '2fd8ac4eb585',
    'civ.annals': 'addfaf99b28f',
    'civ.capNorm': '993fb8af314c',
    'civ.capSpacing': '8fda3225da8f',
    'civ.checkpoints': '41f3a8085edc',
    'civ.culture': 'abf449accae8',
    'civ.cultures': '63ae715e7bbc',
    'civ.development': '549cd6385ff1',
    'civ.endYear': 'c1d83dcab0a1',
    'civ.habitat': '1268425e378a',
    'civ.log': 'd48f45eab382',
    'civ.people': '6d7872833131',
    'civ.places': '1648605488de',
    'civ.places.pass': 'a240a54ce73e',
    'civ.polities': '6198a87ef218',
    'civ.polity': '6f8b9137e8de',
    'civ.polityYears': 'e5d380617183',
    'civ.regions': '373c58b1fe5a',
    'civ.religion': '9aab3c781e5d',
    'civ.routes': '746a4db57367',
    'civ.sailFrom': '5bd9534e2395',
    'civ.seed': '0096064c9137',
    'civ.settlements': '8a1e10699694',
    'civ.spreadYears': '3f4246767d58',
    'civ.viable': '139cfad50334',
  },
  555: {
    'world.biome': 'cca45da35de5',
    'world.climate': '80fc89f4397e',
    'world.currents': 'a72b7b25c092',
    'world.elevation': 'c7fce070eac0',
    'world.flux': '2a85dab2ca5d',
    'world.height': 'fd7f315bb385',
    'world.history': '0062cb3dd341',
    'world.maxElevation': '1f608fcaeec9',
    'world.mesh': '078ef2351116',
    'world.params': '812ced2cd033',
    'world.precipitation': '50516b576134',
    'world.riverThreshold': '4d0838ba97f9',
    'world.rivers': 'bf362e700894',
    'world.seaIce': '348ee892db40',
    'world.tect': '1067700095d3',
    'world.temperature': '53ea8de0446e',
    'world.volcanoes': '1184f5b8d4b6',
    'world.water': '050e7112dd1c',
    'world.waterLevel': '52d96cb0744c',
    'world.width': '2fd8ac4eb585',
    'civ.annals': 'c007bf2b3b50',
    'civ.capNorm': '92c2a5c30ea1',
    'civ.capSpacing': '8fda3225da8f',
    'civ.checkpoints': '726be938b59b',
    'civ.culture': 'f9b155eb911f',
    'civ.cultures': '64b0a35c34b5',
    'civ.development': '0526f53413e5',
    'civ.endYear': 'c1d83dcab0a1',
    'civ.habitat': '91e9fb0abefb',
    'civ.log': '6f422c3b42a4',
    'civ.people': '9ac1601f6a4a',
    'civ.places': '4f5c7e90ec98',
    'civ.places.pass': 'f5fb6a9d72d3',
    'civ.polities': '926a110befe5',
    'civ.polity': '465becb4f166',
    'civ.polityYears': 'e5d380617183',
    'civ.regions': '201f4e655690',
    'civ.religion': '6b4f37643de9',
    'civ.routes': 'b41d2d054b9f',
    'civ.sailFrom': '5bd9534e2395',
    'civ.seed': '6b5deaaf6a3b',
    'civ.settlements': '885bc2e7894e',
    'civ.spreadYears': 'cd11167707e7',
    'civ.viable': '139cfad50334',
  },
};

describe('同一个种子在任何电脑上都是同一个世界', () => {
  it.each([2024, 7, 555])('seed %i(12k 地块):地形、文明全部数据的指纹逐字段对得上', (seed) => {
    const fp = fingerprint(seed);
    if (process.env.PRINT_FINGERPRINT) console.log(`${seed}: ${JSON.stringify(fp, null, 2)}`);
    expect(fp).toEqual(EXPECTED[seed]);
  }, 60_000);
});
