/**
 * 地图插件试跑:把插件关进 QuickJS,在一个种子上长一张图,和不带插件的比一比。
 *
 *   npx tsx scripts/map-plugin-try.ts examples/plugins/craters                      # 种子 7、默认参数
 *   npx tsx scripts/map-plugin-try.ts <插件文件夹或 .civplugin> [更多插件 ...] [seed=2024] [cells=36000] [years=3000] [滑条名=数 ...]
 *
 * 几个插件按给的先后出手;滑条交给清单里有这个名字的插件。打印:每一口用了多久、插件里 console.log 的、几样统计(官方 → 带插件)、图层;
 * 给了 years 再推这么多年,看长不长得出文明。插件出错、超时停下的打印那句错,退出码 1。
 */
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { BIOMES } from '../src/gen/biomes';
import { MAP_PLUGIN_TIME, MapClock, timedMapPlugins, type MapStage } from '../src/gen/mapHooks';
import type { QuickJSMapPlugin } from '../src/gen/quickjs/map';
import { simParamsOf } from '../src/plugin/pluginWorld';
import { mapPluginInNode, openMapPlugin, type MapFile } from './lib/mapPluginFile';

const args = process.argv.slice(2);
const paths = args.filter((a) => !a.includes('='));
if (!paths.length) {
  console.error('用法:npx tsx scripts/map-plugin-try.ts <插件文件夹或 .civplugin> [更多插件 ...] [seed=7] [cells=36000] [years=0] [滑条名=数 ...]');
  process.exit(1);
}
let seed = 7;
let cells = DEFAULT_PARAMS.cells;
let years = 0;
const given: Record<string, number> = {};
for (const a of args) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(-?[\d.]+(?:e-?\d+)?)$/.exec(a);
  if (!m) continue;
  if (m[1] === 'seed') seed = Number(m[2]);
  else if (m[1] === 'cells') cells = Number(m[2]);
  else if (m[1] === 'years') years = Number(m[2]);
  else given[m[1]] = Number(m[2]);
}

function stop(e: unknown): never {
  console.error(`出错停下:${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

const files: MapFile[] = [];
for (const p of paths) files.push(await openMapPlugin(p).catch(stop));
for (const k of Object.keys(given)) if (!files.some((f) => f.opened.manifest.map?.params?.[k])) stop(new Error(`哪个插件的清单 map.params 里都没有 ${k}`));
for (const f of files) {
  const spec = f.opened.manifest.map!.params;
  f.params = simParamsOf(spec, Object.fromEntries(Object.entries(given).filter(([k]) => spec && Object.prototype.hasOwnProperty.call(spec, k))));
}

const P = { ...DEFAULT_PARAMS, seed, cells };
for (const f of files) {
  const m = f.opened.manifest;
  const ps = Object.entries(f.params).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`${m.name} ${m.version}(${m.id}):${m.map!.stages.join('、')}${ps ? `;滑条 ${ps}` : ''}`);
}
console.log(`种子 ${seed},${cells} 块`);

const STAGE: Record<MapStage, string> = { height: '改海拔', climate: '改气候', layers: '出图层' };
const spent: string[] = [];
let total = 0;
class Clock extends MapClock {
  spend(id: string, stage: MapStage, ms: number): void {
    spent.push(`${id} ${STAGE[stage]} ${ms.toFixed(1)} 毫秒`);
    total += ms;
    super.spend(id, stage, ms);
  }
}
const logs: string[] = [];
const LOGS_MAX = 50;
const boxes: QuickJSMapPlugin[] = [];
const plain = generateWorld(P);
let world: World;
try {
  for (const f of files) {
    const id = f.opened.manifest.id;
    boxes.push(await mapPluginInNode(f, (method, text, stage) => logs.push(`  [${id}${stage ? ` ${STAGE[stage]}` : ''}] ${method === 'log' ? '' : `${method}: `}${text}`)));
  }
  world = generateWorld(P, undefined, undefined, undefined, undefined, timedMapPlugins(boxes, new Clock()));
} catch (e) {
  spent.forEach((s) => console.log(`  ${s}`));
  logs.slice(0, LOGS_MAX).forEach((l) => console.log(l));
  stop(e);
} finally {
  boxes.forEach((b) => b.dispose());
}

console.log(`插件一共用了 ${total.toFixed(1)} 毫秒(一口最多 ${MAP_PLUGIN_TIME.stage / 1000} 秒,一次生成合计最多 ${MAP_PLUGIN_TIME.total / 1000} 秒):`);
spent.forEach((s) => console.log(`  ${s}`));
if (logs.length) {
  console.log(`console 打印的${logs.length > LOGS_MAX ? `(前 ${LOGS_MAX} 条,一共 ${logs.length} 条)` : ''}:`);
  logs.slice(0, LOGS_MAX).forEach((l) => console.log(l));
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
function stats(w: World) {
  const n = w.mesh.n;
  let land = 0;
  let lake = 0;
  let t = 0;
  let p = 0;
  const biome = new Float64Array(BIOMES.length);
  for (let i = 0; i < n; i++) {
    if (w.water[i] === 2) lake++;
    if (w.water[i] !== 0) continue;
    land++;
    t += w.temperature[i];
    p += w.precipitation[i];
    biome[w.biome[i]]++;
  }
  return { land, lake, rivers: w.rivers.length, peak: w.maxElevation, t: t / land, p: p / land, biome: [...biome].map((b) => b / land), n };
}
const a = stats(plain);
const b = stats(world);
console.log('统计(不带 → 带插件):');
console.log(`  陆地 ${pct(a.land / a.n)} → ${pct(b.land / b.n)},湖 ${a.lake} → ${b.lake} 块,河 ${a.rivers} → ${b.rivers} 条,陆地最高 ${Math.round(a.peak)} → ${Math.round(b.peak)} 米`);
console.log(`  陆地平均气温 ${a.t.toFixed(1)} → ${b.t.toFixed(1)} °C,平均年降水 ${Math.round(a.p)} → ${Math.round(b.p)} 毫米`);
const shown = BIOMES.map((x, k) => ({ name: x.name, k })).filter(({ k }) => a.biome[k] >= 0.005 || b.biome[k] >= 0.005);
console.log(`  群落占陆地:${shown.map(({ name, k }) => `${name} ${pct(a.biome[k])} → ${pct(b.biome[k])}`).join(',')}`);

for (const L of world.mapLayers ?? []) {
  const spec = files.find((f) => f.opened.manifest.id === L.by)?.opened.manifest.map?.layers?.find((l) => l.id === L.id);
  let k = 0;
  let lo = Infinity;
  let hi = -Infinity;
  let sum = 0;
  const count = new Map<number, number>();
  for (const v of L.values) {
    if (Number.isNaN(v)) continue;
    k++;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
    sum += v;
    if (spec?.classes) count.set(v, (count.get(v) ?? 0) + 1);
  }
  const head = `图层 ${L.by}/${L.id}「${spec?.title ?? ''}」:${k} 块有值`;
  if (!k) console.log(`${head}(全是 NaN,什么都不画)`);
  else if (spec?.classes) {
    const top = [...count].sort((x, y) => y[1] - x[1]);
    const label = (v: number) => spec.classes!.find((c) => c.value === v)?.label ?? `${v}(没登记,不画)`;
    console.log(`${head},${count.size} 类:${top.map(([v, c]) => `${label(v)} ${c}`).join(',')}`);
  } else console.log(`${head};最小 ${lo.toFixed(2)} 平均 ${(sum / k).toFixed(2)} 最大 ${hi.toFixed(2)}`);
}

if (years > 0) {
  const grow = (w: World) => {
    const civ = generateCiv(w, { endYear: years });
    const alive = civ.polities.filter((x) => x.ended === undefined || x.ended > civ.endYear).length;
    return { stuck: civ.stuck, polities: civ.polities.length, alive, towns: civ.settlements.length };
  };
  const c0 = grow(plain);
  const c1 = grow(world);
  if (c1.stuck) console.log(`带插件的推到一半推不下去了:${JSON.stringify(c1.stuck)}`);
  console.log(`推 ${years} 年(不带 → 带插件):出现过的国家 ${c0.polities} → ${c1.polities},最后还在的 ${c0.alive} → ${c1.alive},城 ${c0.towns} → ${c1.towns}`);
}
