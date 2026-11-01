/**
 * 后台线程里边推边交的历史(gen/civ/grow.ts):同一张地图、同一个文明种子,几段历史各按一套规则推,推到交历史的年份就交一份。
 * 主线程那一头在 src/ui/compare/compareClient.ts。这一块挂在照故事找世界的线程(src/finderWorker.ts)上:那个线程本来就只有
 * 生成地图、推历史的代码,不另打包一份;收到的消息带 grow 这一项的归这里,别的照旧是找世界的活。
 *
 * 消息:
 *   主线程 → 线程  { grow: 'start', map, setup, sides }
 *     这个线程要推哪几段(sides,一段一个 side 编号 + key):同一张地图上已经在推的、key 没变的接着推(推完了的不再推),
 *     key 变了的从头推,没列的不推了;换了地图的全部从头推。地图(map)和设定(setup)对所有段一样,每段只是规则(tuning)不同
 *   线程 → 主线程
 *     { grow: 'progress', side, key, year }      推到哪一年了(推的时候每隔一会儿报一次)
 *     { grow: 'civ', side, key, civ, done }      交一份推到 civ.endYear 的整理好的历史;done = 最后一份
 *     { grow: 'failed', side, key, at, civ }     推不下去了(见 grow.ts 的 failed)
 * 主线程按 side + key 认是不是现在要的那一段(换过 key 的旧消息不管)。
 *
 * 几段轮流推:每段推一小会儿(SLICE_MS)就换下一段,两段一起往前长;每推一小会儿让一下,新到的消息先处理(换规则、换地图不用等推完)。
 * 交出去的历史是复制的一份(线程里留着原来那份接着推)。纯计算,不碰 DOM。
 */
import { generateWorld, type World, type WorldParams } from './gen/world';
import { planetTempo, type Civ, type CivParams } from './gen/civ';
import { startGrow, type Grower } from './gen/civ/grow';
import { tuningPatch } from './gen/civ/tuningPatch';
import { sketchGrid, type SketchEdit } from './gen/sketch';
import type { TerrainOp } from './gen/edits';
import type { TuningValues } from './gen/civ/tuning';
import type { Frontier, Origins } from './gen/civ/frontier';
import type { Calamity } from './gen/civ/calamity';
import type { NameMix } from './gen/names';

/** 哪张地图:参数、地形修改、草图(和世界存档里的一样) */
export interface GrowMap {
  params: WorldParams;
  terrain?: TerrainOp[];
  sketch?: SketchEdit;
}

/** 几段历史共用的设定(不给的 = 默认;文明种子不给 = 地图种子) */
export interface GrowSetup {
  civSeed?: number;
  frontier?: Frontier;
  origins?: Origins;
  calamity?: Calamity;
  names?: NameMix;
}

/** 一段历史:side = 第几段(主线程定的编号),key = 这一次推的编号(规则改了换一个),tuning = 规则里改过的项(不给 = 官方规则) */
export interface GrowSide {
  side: number;
  key: number;
  tuning?: TuningValues;
}

export interface GrowRequest {
  grow: 'start';
  map: GrowMap;
  setup: GrowSetup;
  sides: GrowSide[];
}

export type GrowReply =
  | { grow: 'progress'; side: number; key: number; year: number }
  | { grow: 'civ'; side: number; key: number; civ: Civ; done: boolean }
  | { grow: 'failed'; side: number; key: number; at: number; civ: Civ | null };

/** 是不是边推边交的消息(别的是找世界的活) */
export function isGrowRequest(m: unknown): m is GrowRequest {
  return !!m && typeof m === 'object' && (m as { grow?: unknown }).grow === 'start';
}

/** 一段推多久就换下一段、让一下(毫秒) */
const SLICE_MS = 50;
/** 推到哪一年最多多久报一次(毫秒) */
const PROGRESS_MS = 200;

const mapKey = (m: GrowMap) => JSON.stringify([Object.entries(m.params).sort(([a], [b]) => (a < b ? -1 : 1)), m.terrain ?? [], m.sketch ?? null]);

interface Running {
  side: number;
  key: number;
  grower: Grower;
  /** 上一次报的年份、时刻 */
  said: number;
  saidAt: number;
}

/** 这个线程手上的地图、在推的几段、推完了的几段(side → key) */
let here: { key: string; world: World; tempo: CivParams['tempo'] | undefined } | null = null;
let running: Running[] = [];
let finished = new Map<number, number>();
let post: (r: GrowReply) => void = () => {};
let pumping: Promise<void> | null = null;

/** 让一下(排到下一个任务),这期间到了的消息先处理。用 MessageChannel:没有 setTimeout(0) 连着用时的 4 毫秒下限 */
let yieldTask: (() => Promise<void>) | null = null;
function pause(): Promise<void> {
  if (!yieldTask) {
    if (typeof MessageChannel === 'undefined') yieldTask = () => new Promise((r) => setTimeout(r, 0));
    else {
      const ch = new MessageChannel();
      // Node(单测)里别让这个口子拖住进程不退出;浏览器里没有 unref
      (ch.port1 as { unref?: () => void }).unref?.();
      const waiting: (() => void)[] = [];
      ch.port1.onmessage = () => waiting.shift()?.();
      yieldTask = () =>
        new Promise<void>((r) => {
          waiting.push(r);
          ch.port2.postMessage(0);
        });
    }
  }
  return yieldTask();
}

/**
 * 推这段历史用的参数:和推一个世界时一样(worker.ts 的 setupOpt、tempoOf):规则换成一套旋钮;
 * 改过地形、没给文明种子的,扩张节拍照没改过地形的那颗星球
 */
function paramsOf(setup: GrowSetup, tuning: TuningValues | undefined, tempo: CivParams['tempo'] | undefined): Partial<CivParams> {
  const knobs = tuning ? tuningPatch(tuning) : undefined;
  return {
    ...(tempo !== undefined ? { tempo } : {}),
    ...(setup.names ? { names: setup.names } : {}),
    ...(setup.frontier ? { frontier: setup.frontier } : {}),
    ...(setup.origins ? { origins: setup.origins } : {}),
    ...(setup.civSeed !== undefined ? { civSeed: setup.civSeed } : {}),
    ...(setup.calamity ? { calamity: setup.calamity } : {}),
    ...(knobs ? { knobs } : {}),
  };
}

/**
 * 收到一条边推边交的消息。reply = 往主线程发消息的办法。
 * 返回手上的几段都推完(或者都不推了)时兑现的 Promise(单测等它;线程里不用等)
 */
export function growMessage(m: GrowRequest, reply: (r: GrowReply) => void): Promise<void> {
  post = reply;
  // 改过地形的世界给不给文明种子,扩张节拍的取法不同(见 paramsOf):算在地图里
  const key = `${mapKey(m.map)}|${m.setup.civSeed === undefined ? 'own' : 'seed'}`;
  if (!here || here.key !== key) {
    // 换了地图:先放掉旧的,生成新的时候不同时占着两张
    here = null;
    running = [];
    finished = new Map();
    const world = generateWorld(m.map.params, undefined, m.map.terrain, sketchGrid(m.map.sketch));
    const tempo = m.map.terrain?.length && m.setup.civSeed === undefined ? (planetTempo(m.map.params, undefined, sketchGrid(m.map.sketch)) ?? null) : undefined;
    here = { key, world, tempo };
  }
  const world = here.world;
  const tempo = here.tempo;
  const next: Running[] = [];
  const keep = new Map<number, number>();
  for (const s of m.sides) {
    if (finished.get(s.side) === s.key) {
      keep.set(s.side, s.key);
      continue;
    }
    const old = running.find((r) => r.side === s.side && r.key === s.key);
    next.push(old ?? { side: s.side, key: s.key, grower: startGrow(world, paramsOf(m.setup, s.tuning, tempo)), said: -1, saidAt: 0 });
  }
  running = next;
  finished = keep;
  return (pumping ??= pump().finally(() => (pumping = null)));
}

/** 几段轮流推,直到都推完 */
async function pump(): Promise<void> {
  let turn = 0;
  while (running.length) {
    const r = running[turn % running.length];
    turn++;
    const e = r.grower.step(SLICE_MS);
    if (e?.kind === 'civ') post({ grow: 'civ', side: r.side, key: r.key, civ: e.civ, done: e.done });
    else if (e?.kind === 'failed') post({ grow: 'failed', side: r.side, key: r.key, at: e.at, civ: e.civ });
    else {
      const year = Math.floor(r.grower.year);
      const t = performance.now();
      if (year > r.said && t - r.saidAt >= PROGRESS_MS) {
        r.said = year;
        r.saidAt = t;
        post({ grow: 'progress', side: r.side, key: r.key, year });
      }
    }
    if (r.grower.done) {
      running = running.filter((x) => x !== r);
      finished.set(r.side, r.key);
    }
    await pause();
  }
}
