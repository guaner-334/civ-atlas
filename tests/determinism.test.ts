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
 * 期望值是 GENERATOR_VERSION 24 算的(civ.religion 是后加的字段,加它时别的字段一个没变;地图上画的关隘(civ.places 里的 pass,算在 civ.places.pass)也是后加的,加它时别的字段、别的地名一个没变,后来关隘又记上在那里据险断后的史事(Place.pass.stands),也只变了 civ.places.pass;10 加了邦交、11 加了君主性格和扩张算账,历史都重排;12 只改了 civ.people:多了名臣,将领有了字号、籍贯、官职,撞名的将领换了名字;13 改了宜居度和城的人口上限,地形一个字段没变,历史重排;多了 civ.capNorm;14 处理了封闭内海、贴着海的湖、湖心小块地,地形局部变了、历史重排;15 立国更早、多了边缘立国和民族分化,历史重排;civ.development 是后加的字段,加它时别的字段一个没变;16 有了航海时代,历史重排;17 发展度反过来影响人口、打仗和远航,各国自己进航海时代,历史重排;18 降水分夏冬两半年算、河多了,地形不变,气候、河流、历史重排;19 仗短而狠、乘胜连下、前线拉锯,历史重排;20 有了饥荒、民变、大崩解,历史重排;23 推完以后的整理只看每样东西出现以前的历史,归属、日志、史事、检查点一个没变,民族、州、城、国家、人物、地名、道路、信仰重排,多了 civ.capSpacing;24 推演里走过的航线不通到遗址,只有 civ.routes 变了;36 君主有了诸子、王子领兵、争储,宗室据地自立,历史重排;39 有了立约与中立地,历史重排;40 有了掌实权的人和两国宗室联姻,历史重排;41 开战看内政,历史重排;42 亡国之君先出奔中立地,疆域兴亡不变,只多了出奔的史事(civ.annals、civ.people、civ.development 里记的史事条数、civ.places.pass 里记的史事下标跟着变);43 战争节奏(议和了还会再打、仗打得密、罢兵割地),历史重排;44 亡国之君出奔邻国,疆域兴亡不变,只多了出奔的史事(和 42 一样只变了 civ.annals、civ.people、civ.development、civ.places.pass);46 有了大迁徙,历史重排,多了 civ.migrations;civ.ideology(思潮,只算不用)是后加的字段,加它时别的字段一个没变;47 季节进推演,历史重排;48 一部分人物换成女的,只变了 civ.people(性别、名字、字、西幻的序数)))。经纬度换算、沿大圆走、球面三角形面积这些三角函数都舍入到 24 位,
 * 推演里的超越函数也一样,所以各 CPU、各浏览器逐位一致
 */
const EXPECTED: Record<number, Record<string, string>> = {
  2024: {
    'civ.annals': '2a8dea6edb60',
    'civ.capNorm': '9b2058f28291',
    'civ.capSpacing': '8fda3225da8f',
    'civ.checkpoints': '33cd67a6aff6',
    'civ.culture': 'b3517578d840',
    'civ.cultures': '1c95eea8ded9',
    'civ.development': '9366174c3510',
    'civ.endYear': 'c1d83dcab0a1',
    'civ.habitat': '35d8ad95d249',
    'civ.ideology': '3906a1bc9088',
    'civ.log': '14924b8072a5',
    'civ.migrations': '541e3ad5d39c',
    'civ.people': '5e62dbc3f97b',
    'civ.places': 'e82d872374d7',
    'civ.places.pass': '73961d2dd743',
    'civ.polities': 'fd5253ab96b3',
    'civ.polity': '50c3ebaf96ac',
    'civ.polityYears': 'e5d380617183',
    'civ.regions': 'c591e64e8f47',
    'civ.religion': 'eeb33ebf3267',
    'civ.routes': 'c322b14bed9d',
    'civ.sailFrom': '5bd9534e2395',
    'civ.seed': '3ff6de7b7854',
    'civ.settlements': 'a5b6d3076015',
    'civ.spreadYears': '61c69775ebc4',
    'civ.trade': '4a35f4fa9089',
    'civ.viable': '139cfad50334',
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
  },
  7: {
    'civ.annals': 'd8b34f61a179',
    'civ.capNorm': '993fb8af314c',
    'civ.capSpacing': '8fda3225da8f',
    'civ.checkpoints': 'c52ab954139d',
    'civ.culture': 'fa037ea0a60c',
    'civ.cultures': 'bf820ef45d22',
    'civ.development': 'e6595cb06b6f',
    'civ.endYear': 'c1d83dcab0a1',
    'civ.habitat': '1268425e378a',
    'civ.ideology': '7f375ee4522a',
    'civ.log': '12b686cce7d4',
    'civ.migrations': '1594c31f2fa6',
    'civ.people': 'bba58f05e876',
    'civ.places': '1648605488de',
    'civ.places.pass': '15075b9e88cb',
    'civ.polities': '98539e63fe71',
    'civ.polity': 'b46efa4f0ed8',
    'civ.polityYears': 'e5d380617183',
    'civ.regions': '10807d730a07',
    'civ.religion': '484e1e358e61',
    'civ.routes': '3e9a5061c582',
    'civ.sailFrom': '5bd9534e2395',
    'civ.seed': '0096064c9137',
    'civ.settlements': '80d1bf90d1ae',
    'civ.spreadYears': '3f4246767d58',
    'civ.trade': '6c295a2f9d70',
    'civ.viable': '139cfad50334',
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
  },
  555: {
    'civ.annals': 'b0ecb31519fa',
    'civ.capNorm': '92c2a5c30ea1',
    'civ.capSpacing': '8fda3225da8f',
    'civ.checkpoints': '8cfe3022da16',
    'civ.culture': 'b8e7bb973251',
    'civ.cultures': '5b7824737a63',
    'civ.development': '7a5fd5d23455',
    'civ.endYear': 'c1d83dcab0a1',
    'civ.habitat': '91e9fb0abefb',
    'civ.ideology': 'd138829e203f',
    'civ.log': '309d06860a98',
    'civ.migrations': '0d27a6aa47de',
    'civ.people': 'cf8065371987',
    'civ.places': '4f5c7e90ec98',
    'civ.places.pass': '87a4effb0d16',
    'civ.polities': '894cd58ebe71',
    'civ.polity': '2f5d55c3e281',
    'civ.polityYears': 'e5d380617183',
    'civ.regions': '0406c488a867',
    'civ.religion': 'f6218527df07',
    'civ.routes': '1c133388a7b5',
    'civ.sailFrom': '5bd9534e2395',
    'civ.seed': '6b5deaaf6a3b',
    'civ.settlements': 'b091eac21542',
    'civ.spreadYears': 'cd11167707e7',
    'civ.trade': 'e6fcce2a70fb',
    'civ.viable': '139cfad50334',
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
  },
};

describe('同一个种子在任何电脑上都是同一个世界', () => {
  it.each([2024, 7, 555])('seed %i(12k 地块):地形、文明全部数据的指纹逐字段对得上', (seed) => {
    const fp = fingerprint(seed);
    if (process.env.PRINT_FINGERPRINT) console.log(`${seed}: ${JSON.stringify(fp, null, 2)}`);
    expect(fp).toEqual(EXPECTED[seed]);
  }, 60_000);
});
