/**
 * 生成、打开世界的代码(./worldMessages.ts、./useWorldLoad.ts)要读要改的 App 状态,按块收拢成对象传:
 *   GenRefs   这个世界是按什么生成的、正在生成的那一次
 *   CivRefs   最近一次请求的文明带着什么(干预、地形大事、地名风格、推演年数、拓荒起源、逐年推演的进度)
 *   MapRefs   地图上那张整图、各段的主图补丁、地图现在怎么画
 *   ResimRefs 重推、再推、逐年推演那边的(换世界时作废)
 *   OpenRefs  只有打开世界的代码用的(useOpenRefs 建)
 * 前几块里的 ref、setter 还在 App 里(别的地方也用),App 收拢成对象传进来;收拢的对象每次渲染新建,里面的 ref、setter 不换
 */
import { useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { WorkerRequest, WorkerResponse } from '../../worker';
import type { World, WorldParams } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import type { RasterPatch } from '../../gen/rasterPatch';
import type { Civ } from '../../gen/civ/types';
import type { Intervention, PlayState, TerrainOp, Upheaval } from '../../gen/edits';
import type { SketchEdit } from '../../gen/sketch';
import type { NameMix } from '../../gen/names/mix';
import type { EraMaps } from '../eras';
import type { PatchStats, PatchView, PreProjected } from '../terrainPatch';
import type { ExtendJob, RenameCheck, ResimInfo, SwitchNote, useSimResults } from '../sim/useSimResults';
import type { CivSetup, Target } from './worldTarget';

export type Ref<T> = MutableRefObject<T>;
export type Setter<T> = Dispatch<SetStateAction<T>>;

/** 正在进行的"按新地形重新生成"(App 的 regenRef):那次生成的请求编号、发出去的时刻、带着的地形修改和草图 */
export interface RegenJob {
  id: number;
  t0: number;
  terrain: readonly TerrainOp[];
  sketch?: SketchEdit;
  workerMs?: number;
  arrived?: number;
  /** 线程交回来的时刻(毫秒,从发出去算起)、线程里铺像素用了多久、按块换上的备料统计(冒烟检查、测速用) */
  got?: number;
  rasterMs?: number;
  patch?: PatchStats;
  /** 地形图换上以后的下一帧(从发出去算起,毫秒) */
  shown?: number;
}

/** 地图先交的生成(App 的 mapFirst):先到的世界、地图换上了没有、地图换上之前先到了的历史(done) */
export interface MapFirst {
  id: number;
  world: World;
  shown: boolean;
  done: Extract<WorkerResponse, { type: 'done' }> | null;
}

/** 生成进度(提示条"正在生成世界"):regen = 按新地形重新生成;seed = 正在生成的种子 */
export type GenProgress = { stage: string; pct: number; regen?: boolean; seed?: number };

/** 这个世界是按什么生成的、正在生成的那一次 */
export interface GenRefs {
  /** 现在这个世界的请求编号(线程交回的编号对不上就是上一个世界的) */
  reqId: Ref<number>;
  /** 正在打开 / 已经打开的世界 */
  targetRef: Ref<Target | null>;
  genParams: Ref<WorldParams | null>;
  genTerrain: Ref<readonly TerrainOp[]>;
  genSketch: Ref<SketchEdit | undefined>;
  /** 换了新世界、还没套上它的修改 */
  fresh: Ref<boolean>;
  regenRef: Ref<RegenJob | null>;
  /** 最近一次发出去的生成请求 */
  genSent: Ref<WorkerRequest | null>;
  /** 地图上那张整图是哪个世界的(线程的 baseKey) */
  baseKeyRef: Ref<string | null>;
  preProj: Ref<PreProjected | null>;
  mapFirst: Ref<MapFirst | null>;
  setMapEarly: Setter<boolean>;
  /** 最近生成完的世界 */
  lastReady: Ref<{ world: World; civ: Civ } | null>;
  /** 地图上这份历史 */
  rawRef: Ref<Civ | null>;
  setParams: Setter<WorldParams>;
  setProgress: Setter<GenProgress | null>;
}

/** 最近一次请求的文明带着什么;地图上这份历史 */
export interface CivRefs {
  civEdits: Ref<readonly Intervention[]>;
  civUps: Ref<readonly Upheaval[] | undefined>;
  genUps: Ref<readonly Upheaval[] | undefined>;
  rawUps: Ref<readonly Upheaval[] | undefined>;
  civNames: Ref<NameMix | undefined>;
  civYears: Ref<number | undefined>;
  civSetup: Ref<CivSetup | undefined>;
  civPlay: Ref<PlayState | undefined>;
  /** 上一次推历史用了多久(毫秒) */
  civMsLast: Ref<number | null>;
  /** 地图上这个世界还没推历史(编辑地形时生成的),要补推 */
  civLater: Ref<boolean>;
  setRawCiv: Setter<Civ | null>;
}

/** 地图上那张整图、各段的主图补丁、地图现在怎么画 */
export interface MapRefs {
  /** 生成出来的世界(地形大事以前的) */
  baseRef: Ref<{ world: World; raster: Raster } | null>;
  setData: Setter<{ world: World; raster: Raster } | null>;
  /** 最近一次编辑地形换上的那一份 */
  editedRef: Ref<object | null>;
  eraPatches: Ref<Map<string, RasterPatch | null>>;
  setPatchVer: Setter<number>;
  eraMapsRef: Ref<EraMaps | null>;
  setEraMaps: Setter<EraMaps | null>;
  /** 换上时备好的是第几段 */
  eraAt: Ref<{ maps: EraMaps | null; base: object | null; k: number } | null>;
  /** 换段前在后台备好的那一段 */
  eraWarm: Ref<{ data: object; key: string } | null>;
  /** 地图现在怎么画、这种底图在缓存里的键 */
  drawView: Ref<PatchView>;
  drawKey: Ref<string>;
}

/** 重推、再推、逐年推演那边的(换世界时作废;读档时记下套上的干预、地形大事,打开时核对改名) */
export interface ResimRefs {
  resimSeq: Ref<number>;
  resimInfo: Ref<ResimInfo | null>;
  setResim: Setter<{ year: number; end?: number; text?: string } | null>;
  resimText: Ref<string | null>;
  switchNote: Ref<SwitchNote | null>;
  storyAfterYears: Ref<boolean | null>;
  restoredIv: Ref<readonly Intervention[] | null>;
  restoredUps: Ref<readonly Upheaval[] | undefined | null>;
  renameCheck: Ref<RenameCheck | null>;
  extendRef: Ref<ExtendJob | null>;
  extendDone: ReturnType<typeof useSimResults>['extendDone'];
  dropExtendUndo: () => void;
}

/** 只有打开世界的代码用的 ref(App 在开线程之前建好,线程的消息处理和 useWorldLoad 都要) */
export function useOpenRefs() {
  return {
    /**
     * 照原样打开的旧世界(读存着的原件,不重新生成):正在读的是哪个世界、建它的生成器版本;
     * 原件读不出来、改成按新版生成的是哪个世界(提示条上说一句)。见 resultStore.frozenResult / worker 的 load
     */
    frozenLoad: useRef<{ id: string; gen: number } | null>(null),
    frozenBroken: useRef<string | null>(null),
    /** 线程里现在这个世界是读原件来的(同样的参数也不能拿来当新版的世界用,反过来也一样) */
    loadedFrozen: useRef(false),
    /** 等原件的这一会儿要发的生成请求(读不出来就照它生成) */
    genReq: useRef<WorkerRequest | null>(null),
    /** 刚另存的新版:打开它以后提示"已另存为…"(from = 原来那一份的名字) */
    savedCopy: useRef<{ id: string; from: string; more: string[] } | null>(null),
    /** 打不开的分享链接(世界还在生成时解开的):生成完再提示 */
    shareErr: useRef<string | null>(null),
    /** 世界生成完的处理(存档:自动恢复 / 读档套修改);线程回调里经 ref 调,拿到的总是最新的 */
    readyRef: useRef<(world: World, civ: Civ) => void>(() => {}),
  };
}
export type OpenRefs = ReturnType<typeof useOpenRefs>;
