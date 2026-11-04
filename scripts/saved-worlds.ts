/**
 * 「存下的世界」测试(tests/saved-world-stable.test.ts)的样本和基准。
 *
 *   npx tsx scripts/saved-worlds.ts chronicle   编年史的写法有意改了:用现在的代码重写编年史的基准(PR 里写明为什么)
 *   npx tsx scripts/saved-worlds.ts baseline --force   重写全部基准
 *   npx tsx scripts/saved-worlds.ts samples --force    重新生成样本
 *
 * 样本是「老世界」,基准是它们该读出来的样子。除了编年史,这两样一重写,测试就看不住了:
 * 用的人存好的世界会跟着变,而测试是绿的。所以后两条要加 --force,只在第一次建立、或确实要添一个新样本时用。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateCiv } from '../src/gen/civ';
import { upheavalSteps } from '../src/gen/civ/upheaval';
import { GENERATOR_VERSION, type TerrainOp, type Upheaval } from '../src/gen/edits';
import { rasterize } from '../src/gen/raster';
import { zoomSource } from '../src/gen/rasterWindow';
import { makePart } from '../src/gen/snapshot';
import { DEFAULT_PARAMS, generateWorld, type World, type WorldParams } from '../src/gen/world';
import { BASELINE_FILE, CHRONICLE_FILE, FIXTURE_DIR, SAMPLES_FILE, readSample, readSamples, type SampleInfo, type WindowSpec } from '../tests/lib/savedWorlds';

/**
 * 样本的规格:小世界(4000 地块、1000 年)。一个普通的世界,一个带地形大事的:大事以后的世界是单独一块存的,读回来要接原来的网格;
 * 历史也多了各段的州、宜居度(某年的归属按当时那一段读)。换个种子,再多看住一份地形和历史
 */
const SPECS: { name: string; title: string; seed: number; upheavals: Upheaval[] }[] = [
  { name: 'seed7', title: '种子 7', seed: 7, upheavals: [] },
  {
    name: 'seed2024-upheaval',
    title: '种子 2024,带地形大事',
    seed: 2024,
    upheavals: [
      {
        year: 500,
        ops: [
          { kind: 'sink', pts: [1509, 779, 1567, 736], r: 40, s: 1.1 },
          { kind: 'volcano', pts: [1310, 763], r: 60, s: 1.5 },
        ],
      },
    ],
  },
];
const CELLS = 4000;
const END_YEAR = 1000;
/**
 * 比人口、归属、信仰的那几年。归属和信仰每 100 年存一份、中间翻日志,整百年只读到存着的那份,所以多半挑不整的年份(也有带小数的:时间轴是连续的);
 * 500 是样本里地形大事那一年,1000 是最后一年
 */
const YEARS = [137, 342.5, 500, 688, 913, 1000];

/** 256 像素一块,对齐到块的左上角 */
const tile = (v: number) => Math.floor(v / 256) * 256;

/** 在要比的那段世界上挑几块:一个河口,再加最高的山和东西接缝;带地形大事的把后两块换成大事发生的地方 */
function pickWindows(world: World, ups: Upheaval[]): WindowSpec[] {
  const whole = rasterize(world, 1);
  const src = zoomSource(world, whole);
  const out: WindowSpec[] = [];
  const mouth = src.mouths[0];
  if (mouth) out.push({ name: '河口', S: 4, x0: tile(mouth.ex * 4), y0: tile(mouth.ey * 4) });
  if (ups.length) {
    const op: TerrainOp = ups[ups.length - 1].ops[0];
    out.push({ name: '大事', S: 4, x0: tile(op.pts[0] * 4), y0: tile(op.pts[1] * 4) });
    return out;
  }
  let top = 0;
  for (let i = 0; i < whole.elev.length; i++) if (whole.water[i] === 0 && whole.elev[i] > whole.elev[top]) top = i;
  out.push({ name: '高山', S: 8, x0: tile((top % whole.w) * 8), y0: tile(Math.floor(top / whole.w) * 8) });
  // 中低纬度里第 0 列附近陆地最多的一行:这一块要跨过东西接缝取邻居
  let seam = 0;
  let best = -1;
  for (let y = Math.floor(whole.h / 6); y < Math.floor((whole.h * 5) / 6); y++) {
    let land = 0;
    for (let x = 0; x < 16; x++) if (whole.water[y * whole.w + x] === 0) land++;
    if (land > best) {
      best = land;
      seam = y;
    }
  }
  out.push({ name: '接缝', S: 4, x0: 0, y0: tile(seam * 4) });
  return out;
}

/** 世界的键:和网站记各段世界用的同一个写法 */
const keyOf = (p: WorldParams, terrain: readonly TerrainOp[]) => JSON.stringify([Object.entries(p).sort(([a], [b]) => (a < b ? -1 : 1)), terrain, null]);

async function writeSamples(): Promise<void> {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const list: SampleInfo[] = [];
  for (const spec of SPECS) {
    const params: WorldParams = { ...DEFAULT_PARAMS, seed: spec.seed, cells: CELLS };
    const world = generateWorld(params);
    const steps = upheavalSteps(params, [], null, spec.upheavals, { endYear: END_YEAR });
    const civ = generateCiv(world, { endYear: END_YEAR, ...(steps.length ? { upheavals: steps } : {}) });
    let all: TerrainOp[] = [];
    const eraList = steps.map((s) => {
      all = [...all, ...s.ops];
      const { mesh: _m, history: _h, ...rest } = s.world;
      return { key: keyOf(params, all), world: { ...rest, history: [] } };
    });
    const { history: _h, ...rest } = world;
    const parts = [await makePart('map', { ...rest, history: [] }), await makePart('eras', { baseKey: keyOf(params, []), eras: eraList }), await makePart('civ', civ)];
    const files = parts.map((p) => {
      const file = `${spec.name}.${p.name}.gz`;
      writeFileSync(join(FIXTURE_DIR, file), new Uint8Array(p.data));
      return { name: p.name, bytes: p.bytes, sum: p.sum, zip: p.zip, file };
    });
    list.push({
      name: spec.name,
      title: spec.title,
      seed: spec.seed,
      cells: CELLS,
      endYear: END_YEAR,
      generator: GENERATOR_VERSION,
      upheavals: spec.upheavals,
      years: YEARS,
      windows: pickWindows(steps[steps.length - 1]?.world ?? world, spec.upheavals),
      parts: files,
    });
    console.log(spec.name, parts.map((p) => `${p.name} ${(p.data.byteLength / 1e6).toFixed(2)} MB`).join(','));
  }
  writeFileSync(SAMPLES_FILE, `${JSON.stringify(list, null, 1)}\n`);
}

/** 一项一行,改基准时看差异清楚 */
function writeTable(file: string, table: Record<string, Record<string, unknown>>): void {
  const body = Object.entries(table).map(([s, items]) => {
    const rows = Object.entries(items).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    return `  ${JSON.stringify(s)}: {\n${rows.join(',\n')}\n  }`;
  });
  writeFileSync(file, `{\n${body.join(',\n')}\n}\n`);
}

async function writeBaseline(chronicleOnly: boolean): Promise<void> {
  const base: Record<string, Record<string, unknown>> = {};
  const chron: Record<string, Record<string, unknown>> = {};
  for (const s of readSamples()) {
    const r = await readSample(s);
    base[s.name] = Object.fromEntries(r.items.map((it) => [it.id, it.digest]));
    chron[s.name] = { ...r.chronicleDigest };
  }
  if (!chronicleOnly) writeTable(BASELINE_FILE, base);
  writeTable(CHRONICLE_FILE, chron);
}

const [mode] = process.argv.slice(2);
const force = process.argv.includes('--force');
if (mode === 'chronicle') await writeBaseline(true);
else if (mode === 'baseline' && (force || !existsSync(BASELINE_FILE))) await writeBaseline(false);
else if (mode === 'samples' && (force || !existsSync(SAMPLES_FILE))) await writeSamples();
else {
  console.error('用法见文件头。baseline、samples 会换掉已有的基准和样本,要加 --force');
  process.exitCode = 1;
}
