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
 * 期望值是 GENERATOR_VERSION 24 算的(civ.religion 是后加的字段,加它时别的字段一个没变;地图上画的关隘(civ.places 里的 pass,算在 civ.places.pass)也是后加的,加它时别的字段、别的地名一个没变,后来关隘又记上在那里据险断后的史事(Place.pass.stands),也只变了 civ.places.pass;10 加了邦交、11 加了君主性格和扩张算账,历史都重排;12 只改了 civ.people:多了名臣,将领有了字号、籍贯、官职,撞名的将领换了名字;13 改了宜居度和城的人口上限,地形一个字段没变,历史重排;多了 civ.capNorm;14 处理了封闭内海、贴着海的湖、湖心小块地,地形局部变了、历史重排;15 立国更早、多了边缘立国和民族分化,历史重排;civ.development 是后加的字段,加它时别的字段一个没变;16 有了航海时代,历史重排;17 发展度反过来影响人口、打仗和远航,各国自己进航海时代,历史重排;18 降水分夏冬两半年算、河多了,地形不变,气候、河流、历史重排;19 仗短而狠、乘胜连下、前线拉锯,历史重排;20 有了饥荒、民变、大崩解,历史重排;23 推完以后的整理只看每样东西出现以前的历史,归属、日志、史事、检查点一个没变,民族、州、城、国家、人物、地名、道路、信仰重排,多了 civ.capSpacing;24 推演里走过的航线不通到遗址,只有 civ.routes 变了;36 君主有了诸子、王子领兵、争储,宗室据地自立,历史重排;39 有了立约与中立地,历史重排;40 有了掌实权的人和两国宗室联姻,历史重排;41 开战看内政,历史重排;42 亡国之君先出奔中立地,疆域兴亡不变,只多了出奔的史事(civ.annals、civ.people、civ.development 里记的史事条数、civ.places.pass 里记的史事下标跟着变);43 战争节奏(议和了还会再打、仗打得密、罢兵割地),历史重排;44 亡国之君出奔邻国,疆域兴亡不变,只多了出奔的史事(和 42 一样只变了 civ.annals、civ.people、civ.development、civ.places.pass);46 有了大迁徙,历史重排,多了 civ.migrations;civ.ideology(思潮,只算不用)是后加的字段,加它时别的字段一个没变))。经纬度换算、沿大圆走、球面三角形面积这些三角函数都舍入到 24 位,
 * 推演里的超越函数也一样,所以各 CPU、各浏览器逐位一致
 */
const EXPECTED: Record<number, Record<string, string>> = {
  2024: {
    'civ.annals': '5c0a306fbc38',
    'civ.capNorm': '9b2058f28291',
    'civ.capSpacing': '8fda3225da8f',
    'civ.checkpoints': '188d1ad1b8a4',
    'civ.culture': '2009bd4095d2',
    'civ.cultures': '2105c9e889d5',
    'civ.development': '2d31695691b2',
    'civ.endYear': 'c1d83dcab0a1',
    'civ.habitat': '35d8ad95d249',
    'civ.ideology': '7833446f95f2',
    'civ.log': 'cb2a34157443',
    'civ.migrations': 'ee67928c5bf2',
    'civ.people': '5c462f0539aa',
    'civ.places': 'e82d872374d7',
    'civ.places.pass': 'dd48866138e1',
    'civ.polities': 'c420eee4eb17',
    'civ.polity': '9b35de944c5e',
    'civ.polityYears': 'e5d380617183',
    'civ.regions': '0173e4690e41',
    'civ.religion': '5a978100e192',
    'civ.routes': 'c2b13583a223',
    'civ.sailFrom': '5bd9534e2395',
    'civ.seed': '3ff6de7b7854',
    'civ.settlements': 'ebb6e4ee854b',
    'civ.spreadYears': '61c69775ebc4',
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
    'civ.annals': '78803884ffcf',
    'civ.capNorm': '993fb8af314c',
    'civ.capSpacing': '8fda3225da8f',
    'civ.checkpoints': 'f63eb2b1bcb0',
    'civ.culture': '9d45a45fb6ad',
    'civ.cultures': '8227c71ad06d',
    'civ.development': '501ce7ff9756',
    'civ.endYear': 'c1d83dcab0a1',
    'civ.habitat': '1268425e378a',
    'civ.ideology': '79504b8c9539',
    'civ.log': 'dbce5ae12985',
    'civ.migrations': 'd492024fc8f6',
    'civ.people': '40fc6b96fe1c',
    'civ.places': '1648605488de',
    'civ.places.pass': '689fcebf63db',
    'civ.polities': 'b61137053e40',
    'civ.polity': 'fb1eb712929d',
    'civ.polityYears': 'e5d380617183',
    'civ.regions': '68ad6171e112',
    'civ.religion': 'c5bec17f5418',
    'civ.routes': '0266568fe5a2',
    'civ.sailFrom': '5bd9534e2395',
    'civ.seed': '0096064c9137',
    'civ.settlements': '5c67d07dcddc',
    'civ.spreadYears': '3f4246767d58',
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
    'civ.annals': '6b2fcf06711d',
    'civ.capNorm': '92c2a5c30ea1',
    'civ.capSpacing': '8fda3225da8f',
    'civ.checkpoints': '924f8b0849ba',
    'civ.culture': '9a129724fb2a',
    'civ.cultures': 'b01a75ea5425',
    'civ.development': '1e2dac01f01e',
    'civ.endYear': 'c1d83dcab0a1',
    'civ.habitat': '91e9fb0abefb',
    'civ.ideology': '6c745835f730',
    'civ.log': '32dc361f72ae',
    'civ.migrations': '6f69ce5daf26',
    'civ.people': '4c56ef7afca0',
    'civ.places': '4f5c7e90ec98',
    'civ.places.pass': 'ae436f01003f',
    'civ.polities': '98c0f744ae11',
    'civ.polity': '0a823e56f034',
    'civ.polityYears': 'e5d380617183',
    'civ.regions': 'ad6fa9967066',
    'civ.religion': 'd0635e02e627',
    'civ.routes': '54fc59d5990b',
    'civ.sailFrom': '5bd9534e2395',
    'civ.seed': '6b5deaaf6a3b',
    'civ.settlements': 'efce315311b7',
    'civ.spreadYears': 'cd11167707e7',
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
