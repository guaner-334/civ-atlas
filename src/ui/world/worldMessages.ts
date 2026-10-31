/**
 * 后台线程交回的生成、打开世界那几种消息(App 开线程时交给 SimClient 的 on;和线程打交道的那一层见 ../sim/simClient.ts):
 *   done / map   世界和地图到了(地图先交的新建中的世界:先换上地图,历史随后到):整张的在后台分小步备好再换上,
 *                编辑地形按块重铺的只贴变了的那块;历史到了记下速度、换上,套上要打开的那个世界的修改(App 的 readyRef)
 *   progress     生成进度
 *   loadFailed   照原样打开的旧世界原件读不出来:按现在的规则生成
 *   snapshot     这次生成 / 重推的原件(对得上存着的存档就存进浏览器)
 *   eraPatch     一段的主图补丁
 *   upPreview    地形大事的"会怎么样"
 * 回调在 App 第一次渲染时定下、之后不换;要读要改的界面状态都是 ref 和 setter(按块收拢传进来,见 ./worldRefs.ts),
 * 发请求、按新地形重新生成完的处理经 App 的 ref 调到最新的那一份
 */
import type { WorkerRequest, WorkerResponse } from '../../worker';
import type { World } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import type { Civ } from '../../gen/civ/types';
import { EMPTY_EDITS } from '../../gen/edits';
import { dropRealisticBasesExcept, realisticRiverSteps, takeRealisticPainted } from '../../render/realistic';
import { adoptPlan, dropFantasyBasesExcept } from '../../render/fantasy';
import { civOpenSteps } from '../CivLayer';
import { getCivTime } from '../civView';
import { civAtEra, composedOf, dropComposed, eraData, eraIndex, eraMapsOf, eraShown, patchKey } from '../eras';
import { noteExtendSpeed } from '../extendStore';
import { noteGenSpeed } from '../genSpeed';
import type { Style } from '../mapLayers';
import { noteMapSum, offerSnapshot } from '../resultStore';
import { patchSourceOf, startTerrainFull, startTerrainPatch } from '../terrainPatch';
import { later, thumbPrepSteps } from '../thumbPrep';
import { takeUpPreview } from '../upheavalStore';
import type { SimHandlers } from '../sim/simClient';
import type { CivRefs, GenRefs, MapRefs, OpenRefs } from './worldRefs';

/** 主线程最多留多少块各段的主图补丁(换了地形大事、撤销回去时用得上;先丢最早的) */
const PATCH_KEEP = 24;

/** 线程消息处理要的:App 的状态(按块)、发请求、告诉线程(不算一件活)、按新地形重新生成完的处理 */
export interface WorldMessageDeps {
  gen: GenRefs;
  civ: CivRefs;
  map: MapRefs;
  open: OpenRefs;
  send: (req: WorkerRequest) => void;
  tell: (req: WorkerRequest) => void;
  terrainDone: (world: World, civ: Civ | null, ms: number) => void;
}

/** 生成、打开世界那几种消息的回调 */
export type WorldHandlers = Pick<SimHandlers, 'eraPatch' | 'upPreview' | 'loadFailed' | 'snapshot' | 'progress' | 'done' | 'map'>;

export function worldMessages(deps: WorldMessageDeps): WorldHandlers {
  const { send, tell, terrainDone } = deps;
  const { reqId, fresh, regenRef, genSent, baseKeyRef, preProj, mapFirst, setMapEarly, setProgress } = deps.gen;
  const { civEdits, civUps, genUps, rawUps, civMsLast, civLater, setRawCiv } = deps.civ;
  const { baseRef, setData, editedRef, eraPatches, setPatchVer, eraMapsRef, setEraMaps, eraAt, eraWarm, drawView, drawKey } = deps.map;
  const { frozenLoad, frozenBroken, loadedFrozen, genReq, readyRef } = deps.open;
  /** 历史到了(和地图一起到的;地图先交了的,是地图换上以后):记下速度,换上历史,套上要打开的那个世界的修改 */
  const takeCiv = (d: { id: number; civ: Civ | null; ms: number; genMs: number; civMs?: number; reused?: true }, world: World) => {
    // 读原件来的、只算了后一半的(编辑地形接着上一次)不算生成速度
    if (!frozenLoad.current && !d.reused) noteGenSpeed(world.params.cells, d.genMs, d.ms);
    // 推文明那一步用了多久:「再推」的弹层拿它估这台电脑再推几年要多久
    if (d.civMs && d.civ) {
      noteExtendSpeed(0, d.civ.endYear, d.civMs);
      civMsLast.current = d.civMs;
    }
    setRawCiv(d.civ);
    // 编辑地形时生成的(没推历史):收起编辑地形时补推
    civLater.current = !d.civ;
    setProgress(null);
    setMapEarly(false);
    const rg = regenRef.current;
    if (rg && rg.id === d.id) terrainDone(world, d.civ, d.ms);
    else {
      fresh.current = false;
      if (d.civ) readyRef.current(world, d.civ);
    }
  };
  /** 地图先换上了的(mapFirst)历史到了:接上;检查脚本看的"世界齐了"这时才算(地图画好时没算,见地图那一层的 __wf) */
  const civAfterMap = (d: Extract<WorkerResponse, { type: 'done' }>, world: World) => {
    mapFirst.current = null;
    takeCiv(d, world);
    const w = (window as unknown as { __wf?: { ready: boolean } }).__wf;
    if (w) w.ready = true;
  };
  /** 世界和地图到了(done 没先交地图的;map = 地图先交、还没推文明):照常备好、换上地图,历史等随后的 done */
  const takeMap = (m: Exclude<Extract<WorkerResponse, { type: 'done' }>, { mapSent: true }> | Extract<WorkerResponse, { type: 'map' }>) => {
    const early = m.type === 'map';
    const civ = early ? null : m.civ;
    if (early) mapFirst.current = { id: m.id, world: m.world, shown: false, done: null };
    const rg0 = regenRef.current;
    if (rg0 && rg0.id === m.id) {
      rg0.got = performance.now() - rg0.t0;
      rg0.rasterMs = m.rasterMs;
    }
    // 各段的世界(有地形大事的;换上时 setEraMaps 用同一份:备好的那一段的世界、拼好的主图对得上)
    const maps = m.eras ? eraMapsOf(m.world, m.baseKey, m.eras) : null;
    /** 换上时画第几段(打开世界时备好了的那一段;按块换上的 = null,换上时照常定) */
    let openK: number | null = null;
    const finish = (raster: Raster) => {
      // 换了世界:别的世界的各段主图补丁都作废(这个世界的几段在备地图的时候可能已经先到了,留着)
      const chain = new Set((m.eras ?? []).map((e, i, a) => patchKey(i ? a[i - 1].key : m.baseKey, e.key)));
      for (const k of [...eraPatches.current.keys()]) if (!chain.has(k)) eraPatches.current.delete(k);
      dropComposed(raster);
      // 换了主图:各画风缓存里别的主图的像素层连旧主图现在就放掉,不等下次画那种画风(按块换上的留着它是从哪张改来的;
      // 打开时拼好、备好了的那一段的主图也留着)
      const keepBases = [raster, patchSourceOf(raster)?.r0, ...composedOf(raster)];
      dropRealisticBasesExcept(keepBases);
      dropFantasyBasesExcept(keepBases);
      baseRef.current = { world: m.world, raster };
      baseKeyRef.current = m.baseKey;
      editedRef.current = regenRef.current?.id === m.id ? baseRef.current : null;
      setData(baseRef.current);
      setEraMaps(maps);
      // 备好的是第几段:换上以后时间轴要的那一段要是还没备(备的时候又到了补丁),先画备好的这段,另一段在后台备好再换(eraK)
      eraAt.current = openK === null ? null : { maps, base: baseRef.current, k: openK };
      eraWarm.current = null;
      rawUps.current = genUps.current;
      if (!early) return takeCiv(m, m.world);
      // 地图先换上:上一个世界的历史不能留在新地图上;提示条照旧("文明"那一步),历史到了才收
      setRawCiv(null);
      civLater.current = false;
      setMapEarly(true);
      const mf = mapFirst.current;
      if (!mf || mf.id !== m.id) return;
      mf.shown = true;
      if (mf.done) civAfterMap(mf.done, mf.world);
    };
    if (m.raster) {
      // 整张交回来的(打开世界、换世界、刷新、新建……):现在这种底图的整张图先分小步在后台备好再换上,
      // 不在换上那一下在主线程上一口气画半秒到几秒;备的时候加载画面照旧
      const raster = m.raster;
      // 线程算好的手绘符号规划(推了文明的才带)
      if (m.plan) adoptPlan(m.world, m.plan);
      // 线程画好的写实像素层(新建中的世界):下面备这种底图、新建界面的星球要那一张时直接贴上
      if (m.type === 'map' && m.painted) takeRealisticPainted(raster, m.painted);
      // 换上时画的那一段:有地形大事、时间轴在大事以后、那一段的主图补丁已经在手里的,是拼好的那张(拼也放在后台的一步里)。
      // 那一段的整张底图、写实 / 卫星画风整张图上的河(矢量,换上时描)、文明层第一次要画的,都一起备好,和地图一起换上
      const view = drawView.current;
      const civ0 = civ;
      const k = civ0 ? eraShown(maps, eraPatches.current, eraIndex(civ0, getCivTime().year)) : 0;
      openK = k;
      const base = { world: m.world, raster };
      const stepsFor = (d: { world: World; raster: Raster }) => [
        ...thumbPrepSteps(drawKey.current, d.world, d.raster),
        ...(view.style === 'realistic' ? realisticRiverSteps(d.world, d.raster, view.look) : []),
        ...(civ0 ? civOpenSteps({ world: d.world, raster: d.raster, civ: civAtEra(civ0, k), style: view.style as Style, mp: view.mp }) : []),
      ];
      let shown = base;
      const prep = k > 0 ? [() => void (shown = eraData(base, maps, eraPatches.current, k)), later(() => stepsFor(shown))] : stepsFor(base);
      startTerrainFull({ world: m.world, raster, view, prep, shown: () => shown }, (st, pre) => {
        if (m.id !== reqId.current) return;
        (window as unknown as { __wfOpenPrep: unknown }).__wfOpenPrep = st;
        preProj.current = pre;
        finish(raster);
      });
    } else {
      // 编辑地形按块重铺的:只带回变了的那块,贴到地图上那张整图上;按块重画的像素层分小步备好再一次换上
      const b = baseRef.current;
      if (!b || baseKeyRef.current !== m.from) {
        // 地图上那张不是线程比的那张(不该发生):这次按整张重新要一遍
        const req = genSent.current;
        if (req?.type === 'generate' && req.id === m.id) send({ ...req, from: undefined });
        return;
      }
      adoptPlan(m.world, m.plan);
      startTerrainPatch({ w0: b.world, r0: b.raster, w1: m.world, patch: m.patch, view: drawView.current }, (r1, st, pre) => {
        if (m.id !== reqId.current) return;
        const rg = regenRef.current;
        if (rg && rg.id === m.id) rg.patch = st;
        preProj.current = pre;
        finish(r1);
        // 换上了:线程不用再留着怎么改回上一张(还没换上就又涂了一笔时,线程照上一张接着按块重铺要用)
        tell({ type: 'shown', id: m.id, key: m.baseKey } satisfies WorkerRequest);
      });
    }
  };
  return {
    eraPatch: (m) => {
      // 一段的主图补丁:记下,地图那一段换上(eras.ts);最多留 PATCH_KEEP 块,先丢最早的(现在这份历史要用的不丢;
      // 丢了的以后又要用,下一次推演时线程看 have 里没有会重新铺)
      const map = eraPatches.current;
      const k = patchKey(m.prev, m.key);
      map.delete(k);
      map.set(k, m.patch);
      const cur = eraMapsRef.current;
      const keep = new Set(cur ? cur.keys.map((key, i) => patchKey(i ? cur.keys[i - 1] : cur.baseKey, key)) : []);
      for (const old of [...map.keys()]) if (map.size > PATCH_KEEP && !keep.has(old)) map.delete(old);
      setPatchVer((v) => v + 1);
    },
    upPreview: (m) => takeUpPreview(m.pid, m.preview, m.water, m.ms),
    // 原件读不出来:按现在的规则生成(提示条上说一句)
    loadFailed: () => {
      const req = genReq.current;
      frozenBroken.current = frozenLoad.current?.id ?? null;
      frozenLoad.current = genReq.current = null;
      loadedFrozen.current = false;
      civEdits.current = EMPTY_EDITS.interventions;
      civUps.current = genUps.current = undefined;
      if (req) send(req);
    },
    // 这次生成 / 重推的原件:对得上存着的存档就存进浏览器(resultStore.ts)
    snapshot: (m) => {
      void offerSnapshot(m.snapshot);
      void noteMapSum(m.snapshot);
    },
    progress: (m) => setProgress((s) => ({ stage: m.stage, pct: m.pct, regen: regenRef.current?.id === m.id, seed: s?.seed })),
    done: (m) => {
      if (!m.mapSent) return takeMap(m);
      // 地图先交了的(mapFirst):地图换上了就接上历史;还在备地图的,换上时再接
      const mf = mapFirst.current;
      if (!mf || mf.id !== m.id) return;
      if (!mf.shown) return void (mf.done = m);
      civAfterMap(m, mf.world);
    },
    map: takeMap,
  };
}
