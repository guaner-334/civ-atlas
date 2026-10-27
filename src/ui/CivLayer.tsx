/**
 * 文明叠加层(截图脚本能叠到):
 *
 * 1. 文明底图(canvas.civ):和地图同样大小,只在文明数据、画风、开关、年份变化时重画,地形图不动。
 *    国土色块、国界、道路画在这里。
 * 2. 文字层(canvas.civ-labels):只盖住视口里看得见的那一块地图,分辨率 = 屏幕像素 × devicePixelRatio,
 *    缩放、平移、换年份时重画。它不在被 CSS 放大的地图框里,而是在最上面的屏幕层里(App 传进来的 labelsHost,
 *    见 mapWrap.ts 的"屏幕层"),按地图框的位置摆,一个画布像素对一个屏幕像素 —— 放大到 12 倍字和城镇符号也是清晰的。
 *    画的东西:地理名、国名、城名和城镇符号,一起避让(render/labels/draw.ts 的 placeMap);
 *    底下先画战事的战线和双剑(render/civ/warfare.ts,不参与避让)。
 *    回放 / 拖时间轴时城名只排国都和大城的,每帧更快;停下来就补上城、镇、村的名字。
 *
 * 3. 高亮层(canvas.civ-hl,阶段 3 编年史):点编年史的一条,事发的州、相关国家的国土闪约两秒;天灾页的预览(受灾的州)一直亮着
 *    (render/civ/highlight.ts 画一次,闪烁是 Web Animations 改不透明度,不重画)。夹在底图和文字层之间,地名不被盖住。
 * 4. 选中层(canvas.civ-sel,阶段 4 点选):选中的国家(当年的国土)/ 州淡淡罩染 + 细描边,选中的大河、山脉一道淡光;常亮。
 *    选中的城画一圈细环、选中的东西的名字底下垫一层光晕 —— 这两样画在文字层上。
 *    文字层排完就把放上去的字和符号记下(ui/mapPick.ts),单击地图时按它查点到了什么。
 *
 * 5. 文明细节层(CivDetail.tsx,放大到 1.2 倍以上):底图、选中层、高亮层看得见的那一块按屏幕像素重画,放在不缩放的屏幕层里
 *    (App 传进来的 detailHost);这时上面 1、3、4 这几张被 CSS 放大的画布藏起来,底图、选中层也先不重画(回放时每帧省一次整图),
 *    缩回 1.2 倍以下再画。
 *
 * 弯边投影(罗宾森、摩尔威德……,mp 不为空):底图、选中层、高亮层按投影重画在地图平面上 —— 色块、罩染这样的"面"
 * 按等距圆柱算好再按行重投影,国界、州界、道路、描边逐点投影(线宽、虚线处处一致);拖动中心时底图先把等距圆柱原图
 * 整图重投影(ui/projection.ts 的 ProjLayer,快),停下来再按投影重画。文字层按投影排(LabelView.proj),
 * 国名按投影后的国土拟合 —— 拖动中心时先用世界坐标拟合的摆法投过去,停下来再重新拟合。
 *
 * 画字前先等字体加载好(ensureFonts),第一次画出来就是正确的字体,不会先闪一下默认字体。
 * 要等的字是这个文明所有可能出现的字(各国各档国号、所有城名),回放时国号升格、新城出现都不用再等字体。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { World } from '../gen/world';
import type { Raster } from '../gen/raster';
import type { Civ, Year } from '../gen/civ/types';
import { civOverlaySteps, drawCivOverlay, type CivDrawParams, type CivStyle, type CivViewport } from '../render/civ/overlay';
import { civProjPrep } from '../render/civ/territory';
import { cancelDetailJob, detailAsync, submitDetailJob, type WorkStep } from './detailJobs';
import { civLabelChars, civLabelItems, civMapLayer, labelViewExtras, reserveCanvasBoxes, type CivMapLayer } from '../render/civ/labels';
import { drawSettlementMarks, type CapitalFlags } from '../render/civ/settlements';
import { drawWarfare, warFront, warsShown } from '../render/civ/warfare';
import { drawPlacedLabels, placeMap, placedMarkBox, toCanvas, type LabelItem, type LabelView, type Placement } from '../render/labels/draw';
import { ensureFonts, fontsReady, preloadFonts } from '../render/labels/fonts';
import { drawHighlight, drawSelection, drawSelectionLabels } from '../render/civ/highlight';
import {
  getCivHighlight,
  getCivShow,
  getCivTime,
  getSelection,
  setCivHighlight,
  useCivHighlight,
  useCivShow,
  useCivTime,
  useResourceView,
  useSelection,
  type MapSelection,
} from './civView';
import { primePolityField, territoryGrid } from '../render/labels/polity';
import { polityNamesOn } from '../render/civ/show';
import { faithKey, personKey, placeKeyOf, polityKey, resolveKey, resolvePersonKey, settlementKey, treatyKey } from '../gen/edits';
import { setMapPlacement } from './mapPick';
import { mapBoxOf, mirrorCanvas, placeOnScreen, visibleBox, watchMapBox } from './mapWrap';
import { whenDone } from './holdMark';
import { nearX } from '../render/common';
import { labelProjection, projector, type MapProj } from '../render/projection';
import { DETAIL_K } from '../render/detail';
import { ProjLayer, useMapMoving, useProjection } from './projection';
import { useAvoidBoxes } from './uiAvoid';
import { CivDetail } from './CivDetail';
import { playSmooth, useDrawnYear, usePlayQuality } from './playQuality';
import { drawHolyDot, holyCities } from '../render/civ/faith';
import { drawResourceLayer, resourceBadges } from '../render/civ/resources';
import { faithFocusOf, selectionOnMap } from './faithSelection';
import { flagOf, type FlagView } from './flagStore';
import { flagImage, useFlagImages } from './flagImages';

/** 高亮闪烁:约两秒,亮 → 暗 → 亮 → 暗 → 亮,最后淡出 */
const FLASH: Keyframe[] = [
  { opacity: 0 },
  { opacity: 1, offset: 0.08 },
  { opacity: 0.3, offset: 0.24 },
  { opacity: 1, offset: 0.4 },
  { opacity: 0.3, offset: 0.56 },
  { opacity: 1, offset: 0.72 },
  { opacity: 0 },
];
const FLASH_MS = 2200;
/** 一直亮着的高亮(天灾页的预览):淡入 */
const HOLD: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
/** 淡淡涂着(天灾推完、提示条开着时) */
const HOLD_FAINT: Keyframe[] = [{ opacity: 0 }, { opacity: 0.5 }];
const HOLD_MS = 200;

// 页面一打开就开始下载字体,和生成世界同时进行
preloadFonts();

// ---- 地球仪(Globe.tsx)借用这里画好的东西:文明底图、选中层、高亮层三张画布(和主图一样大的等距圆柱,
// 直接当贴图贴到球上),这一年的国名、城镇符号(排版在球上另做)。每画完一张就通知一次 ----

export interface CivFeed {
  base: HTMLCanvasElement | null;
  sel: HTMLCanvasElement | null;
  hl: HTMLCanvasElement | null;
  /** 各自画过几次(地球仪按它判断要不要重新上传贴图) */
  baseVer: number;
  selVer: number;
  hlVer: number;
  /** 高亮是哪一次点的(每点一次编年史都不同;没有高亮 = 0) */
  hlStamp: number;
  /** 这一年的国名、城名、城镇符号(和主图文字层同一份) */
  layer: CivMapLayer | null;
  /** 地理名(海、山、河……) */
  places: LabelItem[];
  /** 字体已加载好 */
  fontsOk: boolean;
}

let feed: CivFeed = { base: null, sel: null, hl: null, baseVer: 0, selVer: 0, hlVer: 0, hlStamp: 0, layer: null, places: [], fontsOk: false };
const feedSubs = new Set<() => void>();

function patchFeed(p: Partial<CivFeed>) {
  feed = { ...feed, ...p };
  for (const f of feedSubs) f();
}

export function getCivFeed(): CivFeed {
  return feed;
}

export function subscribeCivFeed(f: () => void): () => void {
  feedSubs.add(f);
  return () => feedSubs.delete(f);
}

export interface CivLayerProps {
  world: World;
  raster: Raster;
  /** 套上用户改名的 civ(阶段 4;地图文字用它) */
  civ: Civ | null;
  /**
   * 生成出来的原始 civ(阶段 4):底图、高亮、选中层只看地理和归属、不看名字,用它画 ——
   * 改名时只重排文字,不重画底图。不给 = civ
   */
  geo?: Civ | null;
  style: CivStyle;
  /** 画哪一年;不传 = 时间轴上的年份(civView.ts),时间轴也没定 = civ.endYear */
  year?: Year;
  view?: CivViewport;
  /** 弯边投影(当前投影 + 中心);等距圆柱 = null / 不给 */
  mp?: MapProj | null;
  /** 文字层放在哪(屏幕层,不随地图 CSS 缩放;还没有 = 先不画字) */
  labelsHost?: HTMLElement | null;
  /** 放大后的文明细节层放在哪(屏幕层:地形细节层之上、这一层地图框之下;没有 = 不画细节层) */
  detailHost?: HTMLElement | null;
  /**
   * 各国历代的旗(手绘风国都城堡插旗用;改旗、预览时跟着换)。由 App 和 civ 同一轮算好传进来,
   * 改名、重推时只画一遍(要是自己订阅 flagStore,会先按旧旗画一遍、旗到了再画一遍)
   */
  flags?: FlagView | null;
}

const VIEW_1: CivViewport = { k: 1, x: 0, y: 0 };

/** 这一层现在画的是哪份历史(换上新的历史、还在后台备的时候照旧画它) */
interface Shown {
  civ: Civ | null;
  geo: Civ | null | undefined;
  flags: FlagView | null;
  world: World;
  raster: Raster;
}

/** 世界和文明是同一次生成的(地块数对得上、州是同一份)才画 */
function fitsWorld(world: World, civ: Civ | null, base: Civ | null | undefined): boolean {
  return !!civ && !!base && base.habitat.suitability.length === world.mesh.n && base.regions === civ.regions;
}

/** 换上新的历史以前在后台分小步备料的活名(detailJobs.ts) */
const CIV_SWAP_JOB = 'civ-swap';

/**
 * 打开世界(打开存档、刷新、换世界、新建……):世界交回来以后、地图换上以前,文明层第一次要画的
 * (色块、国界、道路、战事、瘟疫,弯边投影 · 手绘的符号遮罩,战线,国名要用的国土场)拆成一小步一小步,
 * 和地图一起在后台备好(ui/terrainPatch.ts 的 startTerrainFull),换上那一下只是把备好的贴上、描线,不用当场一口气算。
 * 换上时画哪一年、哪些开关、哪种画风和投影,按这一刻的猜(和这一层换上时取的一样:时间轴、开关、选中的信仰);
 * 换上以前这几样变了,换上时照旧当场画 —— 画出来一样,只是没省下。
 * 备料出了错:剩下的不备了(不连累地图那几步),换上时照常当场画,错误照常报出去
 */
export function civOpenSteps(o: { world: World; raster: Raster; civ: Civ; style: CivStyle; mp: MapProj | null }): WorkStep[] {
  const { world, raster, civ, style, mp } = o;
  if (!fitsWorld(world, civ, civ)) return [];
  const t = getCivTime();
  // 回放 / 拖时间轴时这一层每帧当场画半分辨率的,不用备
  if (t.playing || t.scrubbing) return [];
  const show = getCivShow();
  const year = t.year ?? civ.endYear;
  const p: CivDrawParams = { world, raster, civ, style, year, show, fast: false, faithFocus: show.faiths ? faithFocusOf(getSelection().sel) : null };
  const pp: CivDrawParams = mp ? { ...p, proj: projector(mp) } : p;
  const steps: WorkStep[] = [
    ...civOverlaySteps(pp),
    ...civProjPrep(pp),
    () => void (warsShown(p) && warFront(p)),
    // 国名要用的国土栅格、国土场各一步(弯边投影的国名按投影后的国土拟合,另算)
    () => void (!mp && polityNamesOn(show) && territoryGrid(world, raster, civ)),
    () => void (!mp && polityNamesOn(show) && primePolityField(world, raster, civ, year)),
  ];
  let failed = false;
  return steps.map((s): WorkStep => (deadline) => {
    if (failed) return;
    try {
      return s(deadline);
    } catch (e) {
      failed = true;
      setTimeout(() => {
        throw e;
      });
    }
  });
}

/**
 * 选中的东西从新的历史(civ、地名在 base 上)的编号换成还画着的那份(was、wasBase)里的,按稳定键;指不到 = null。
 * 换上新的历史以前用:选中的编号已经按新的历史换好了,这一层还画着原来那份
 */
function selectionIn(sel: MapSelection | null, civ: Civ, base: Civ, was: Civ, wasBase: Civ): MapSelection | null {
  if (!sel) return null;
  if (sel.kind === 'person') {
    const id = civ.people?.[sel.id] ? resolvePersonKey(was, personKey(civ, sel.id)) : -1;
    return id >= 0 ? { kind: 'person', id } : null;
  }
  const key =
    sel.kind === 'polity' && civ.polities[sel.id]
      ? polityKey(civ, sel.id)
      : sel.kind === 'settlement' && civ.settlements[sel.id]
        ? settlementKey(civ, sel.id)
        : sel.kind === 'faith' && civ.religion?.faiths[sel.id]
          ? faithKey(civ, sel.id)
          : sel.kind === 'place' && base.places[sel.id]
            ? placeKeyOf(base, sel.id)
            : sel.kind === 'treaty'
              ? treatyKey(civ, sel.id) || null
              : null;
  // 州(两份历史的州是同一份)、作者的标记和人物:编号不变
  if (key === null) return sel.kind === 'region' || sel.kind === 'mark' || sel.kind === 'character' ? sel : null;
  const r = resolveKey(sel.kind === 'place' ? wasBase : was, key);
  return r && r.kind === sel.kind ? ({ kind: sel.kind, id: r.id } as MapSelection) : null;
}

/** 同上,编年史高亮的国家(指不到的去掉) */
function politiesIn(ids: number[], civ: Civ, was: Civ): number[] {
  const out: number[] = [];
  for (const id of ids) {
    const r = civ.polities[id] ? resolveKey(was, polityKey(civ, id)) : null;
    if (r && r.kind === 'polity') out.push(r.id);
  }
  return out;
}

/**
 * 国名、族名、城名和城镇符号(civMapLayer):按 civ 记最近一次的。换上新的历史以前在后台先排好,换上时直接用;
 * 参数(年份、开关、画风、投影……)一样才用
 */
const mapLayerMemo = new WeakMap<Civ, { p: CivDrawParams; fast: boolean; proj: MapProj | null; sides: boolean; layer: CivMapLayer }>();
function mapLayerOf(p: CivDrawParams, opt: { fast: boolean; proj: MapProj | null; sides: boolean }): CivMapLayer {
  const hit = mapLayerMemo.get(p.civ);
  const q = hit?.p;
  if (
    hit &&
    q &&
    hit.fast === opt.fast &&
    hit.proj === opt.proj &&
    hit.sides === opt.sides &&
    q.world === p.world &&
    q.raster === p.raster &&
    q.style === p.style &&
    q.year === p.year &&
    q.show === p.show
  )
    return hit.layer;
  const layer = civMapLayer(p, opt);
  mapLayerMemo.set(p.civ, { p, ...opt, layer });
  return layer;
}

/** 这个文明的地图文字可能用到的字(civLabelChars,按 civ 记下) */
const charsMemo = new WeakMap<Civ, string>();
function labelCharsOf(civ: Civ): string {
  let s = charsMemo.get(civ);
  if (s === undefined) charsMemo.set(civ, (s = civLabelChars(civ)));
  return s;
}

interface LabelsDebug {
  ready: boolean;
  drawn: number;
  /** 画了几个城镇符号、几个国名 */
  marks: number;
  polities: number;
  year: number;
  fast: boolean;
  ms: number;
  fontOk: boolean;
  /** 第一次画字时字体是否已就绪(冒烟检查"不闪默认字体"用) */
  firstFontOk?: boolean;
  style: string;
  k: number;
  /** 画出来的文字(冒烟检查"改名后地图上的字变了"用) */
  texts: string[];
  /** 按哪种投影、哪条中央经线排的;国名是不是按投影后的国土拟合的 */
  proj?: string;
  lon?: number;
  fitted?: boolean;
  /** 画了几段战线、几个双剑(战事关着 / 没在打仗 = null 或 0) */
  wars?: { lines: number; marks: number } | null;
}

/** 弯边投影停下来以后文明底图按投影重画(后台分小步)的活名 */
const CIV_PROJ_JOB = 'proj-civ';

/** 配角名(不是跟着填色的那种名字):拖时间轴、回放停下以后再等这么久才排上,再用这么久淡入 */
const SIDE_SETTLE_MS = 300;
const SIDE_FADE_MS = 220;

/** 停稳:still 变成 true 以后再过 ms 毫秒才算停稳(变 false 是马上) */
function useSettled(still: boolean, ms: number): boolean {
  const [settled, setSettled] = useState(still);
  useEffect(() => {
    if (!still) return setSettled(false);
    const h = window.setTimeout(() => setSettled(true), ms);
    return () => window.clearTimeout(h);
  }, [still, ms]);
  return still && settled;
}

/** moving 变成 false 以后再等一个任务才变 false(变 true 是马上) */
function useLateStop(moving: boolean): boolean {
  const [late, setLate] = useState(moving);
  useEffect(() => {
    if (moving) return setLate(true);
    const h = window.setTimeout(() => setLate(false), 0);
    return () => window.clearTimeout(h);
  }, [moving]);
  return moving || late;
}

export function CivLayer({ world, raster, civ: civIn, geo: geoIn, style, year, view, mp = null, labelsHost = null, detailHost = null, flags: flagsIn = null }: CivLayerProps) {
  // 时间轴:画哪一年;回放 / 拖动时色块用半分辨率。流畅优先地播放时画的那一年隔一会儿才换(playQuality.ts)
  const time = useCivTime();
  const fast = time.playing || time.scrubbing;
  const smooth = playSmooth(usePlayQuality());
  const y = useDrawnYear(year ?? time.year, smooth && time.playing && !time.scrubbing);
  // ---- 换上一段新的历史(再推、重推、试推演、打开存档……):这一层要画的先在后台分小步备好,备好了再一起换上 ----
  // 备的时候这一层(底图、文字、选中层、细节层)照旧是原来那份;回放 / 拖时间轴时、世界换了时不等,当场画;
  // 开着地球仪时也不等(地球仪自己按新的历史画国界、贴图借这一层的,一起换才不会一半新一半旧)
  const shown = useRef<Shown | null>(null);
  /** 备好了的那份历史(底图用的 civ) */
  const prepared = useRef<Civ | null>(null);
  const [, setPrepTick] = useState(0);
  const incoming = geoIn ?? civIn;
  const was = shown.current;
  const wasBase = was ? (was.geo ?? was.civ) : null;
  const globeOn = useProjection() === 'globe';
  const hold =
    detailAsync &&
    !fast &&
    !globeOn &&
    !!was &&
    !!wasBase &&
    !!incoming &&
    !!civIn &&
    incoming !== wasBase &&
    prepared.current !== incoming &&
    was.world === world &&
    was.raster === raster &&
    fitsWorld(world, civIn, incoming);
  if (!hold) shown.current = { civ: civIn, geo: geoIn, flags: flagsIn, world, raster };
  const civ = hold ? was!.civ : civIn;
  const geo = hold ? was!.geo : geoIn;
  const flags = hold ? was!.flags : flagsIn;
  const ref = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLCanvasElement>(null);
  const hlRef = useRef<HTMLCanvasElement>(null);
  const selRef = useRef<HTMLCanvasElement>(null);
  // 底图、选中层、高亮层在右边接的那一份(左右无限拖动,见 mapWrap.ts)
  const refCopy = useRef<HTMLCanvasElement>(null);
  const selCopy = useRef<HTMLCanvasElement>(null);
  const hlCopy = useRef<HTMLCanvasElement>(null);
  // 文明细节层的高亮画布(闪烁动画和上面的高亮层一起放);细节层盖住时上面几张不用重画
  const detailHl = useRef<HTMLCanvasElement>(null);
  const [detailOn, setDetailOn] = useState(false);
  const hlIn = useCivHighlight();
  // 备的时候点的编年史(编年史已经是新的历史了)高亮的国家按还画着的那份历史的编号画;开始备以前点的本来就是那份的
  const hlFrom = useRef(0);
  if (!hold) hlFrom.current = hlIn?.stamp ?? 0;
  const hl = useMemo(
    () => (hold && civ && hlIn && hlIn.stamp > hlFrom.current && hlIn.polities.length ? { ...hlIn, polities: politiesIn(hlIn.polities, civIn!, civ) } : hlIn),
    [hold, hlIn, civIn, civ],
  );
  const { sel: pickedIn } = useSelection();
  // 备的时候选中的东西按还画着的那份历史的编号画(备料按新的历史的编号)
  const picked = useMemo(
    () => (hold && civ && wasBase ? selectionIn(pickedIn, civIn!, incoming!, civ, wasBase) : pickedIn),
    [hold, pickedIn, civIn, incoming, civ, wasBase],
  );
  // 选中人物:地图上亮出他的国家;选中一种信仰:圈它的城,信仰图层上别的信仰变淡(selectionOnMap、faithFocus)
  const sel = useMemo(() => selectionOnMap(civ, picked), [civ, picked]);
  const faithFocus = faithFocusOf(picked);
  const faithFocusIn = faithFocusOf(pickedIn);
  const mpRef = useRef(mp);
  mpRef.current = mp;
  const show = useCivShow();

  // 世界和文明必须是同一次生成的(地块数对得上)才画
  const base = geo ?? civ;
  const ok = fitsWorld(world, civ, base);
  // 底图(国土、国界、道路……)用原始 civ:改名不重画
  const params = useMemo<CivDrawParams | null>(
    () => (ok && base ? { world, raster, civ: base, style, year: y ?? base.endYear, show, fast, faithFocus: show.faiths ? faithFocus : null } : null),
    [ok, world, raster, base, style, y, show, fast, faithFocus],
  );
  // 国名、城名、城镇符号:同一年、同样的开关,换成套了改名的 civ
  const mapParams = useMemo<CivDrawParams | null>(() => (params && civ ? { ...params, civ } : null), [params, civ]);
  // 文字层不随年份变:单独一份参数,回放时不用每帧重排地名
  const labelParams = useMemo<CivDrawParams | null>(
    () => (ok && civ ? { world, raster, civ, style, year: civ.endYear, show } : null),
    [ok, world, raster, civ, style, show],
  );

  // ---- 1. 文明底图 ----
  // 右边接的那一份只在视窗里看得见它的时候才复制(视窗没跨过主图右边 = 180° 经线时看不见):
  // 回放、拖时间轴时每帧省一次整张图的复制(没有显卡加速的机器上这一下很慢);看不见时记下"过期",平移到看得见时再补
  const copyStale = useRef(false);
  /** 选中层右边接的那一份过期了(同 copyStale) */
  const selCopyStale = useRef(false);
  const copyVisible = () => {
    const box = ref.current?.parentElement;
    const vis = box ? visibleBox(box) : null;
    return !!vis && vis.x1 > vis.bw + 0.5;
  };
  // 弯边投影:停着的时候按投影重画(色块按行重投影,国界、道路逐点投影);拖动中心时把等距圆柱原图(离屏)整图重投影到 ref 上
  // (快)。baseDrawn = 原图是按哪份参数画的(只改中心时不重画原图);preciseDrawn = 按投影重画的是哪份参数
  const baseProj = useRef(new ProjLayer());
  const baseDrawn = useRef<unknown>(null);
  const preciseDrawn = useRef<unknown>(null);
  /** 等距圆柱时画布上画的是哪份参数(换到弯边投影时拿它当原图,不用重画一遍) */
  const flatDrawn = useRef<unknown>(null);
  const moving = useMapMoving();
  // 停下来以后底图晚一个任务再按投影精画:和地形图的精画、国名重新拟合分在两个任务里,不挤成一次长卡顿
  const baseMoving = useLateStop(moving);
  // 放大到细节层以上:文明细节层马上会盖住这一张(画上去之前它还露着)。不按投影精画(整图精画一次几百毫秒),整图重铺就够
  const covered = !!mp && (view?.k ?? 1) > DETAIL_K;
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    // 放大后细节层盖住了这一张(藏着):先不画,细节层关了再画
    if (detailOn) return;
    if (mp) {
      copyStale.current = false;
      mirrorCanvas(refCopy.current, null, false);
      const L = baseProj.current;
      if (!params) {
        baseDrawn.current = preciseDrawn.current = null;
        L.release();
        if (cv.width) cv.getContext('2d')!.clearRect(0, 0, cv.width, cv.height);
        return;
      }
      const t0 = performance.now();
      // 刚从等距圆柱换过来、参数没变:画布上那张就是原图,接过来(拖动、换投影都用它)
      if (flatDrawn.current === params && baseDrawn.current !== params && cv.width === raster.w && cv.height === raster.h) {
        const src = L.source(raster.w, raster.h);
        const sctx = src.getContext('2d')!;
        sctx.clearRect(0, 0, src.width, src.height);
        sctx.drawImage(cv, 0, 0);
        baseDrawn.current = params;
      }
      flatDrawn.current = null;
      if (!baseMoving && !covered) {
        const fresh = preciseDrawn.current !== params;
        const pj = projector(mp);
        const pp = { ...params, proj: pj };
        const draw = (ctx: CanvasRenderingContext2D) => drawCivOverlay(ctx, pp);
        // 参数没变、只换了投影或中心(换投影、地球仪切回来、滑条改中心):先整图重投影铺上,下面照刚停下来的办法在后台精画,
        // 不在换的那一下整张精画(弱一点的电脑上要卡一秒多)
        if (detailAsync && baseDrawn.current === params && !L.presenting(mp) && !L.redrawn(mp.key)) L.present(cv, mp, null, true);
        // 刚停下来(屏幕上是这份参数、这个中心的整图重投影):按投影重画在后台分小步备,和地形图的一起贴上
        if (detailAsync && baseDrawn.current === params && L.presenting(mp)) {
          const p0 = params;
          L.refine(
            CIV_PROJ_JOB,
            cv,
            raster.w,
            raster.h,
            mp.key,
            null,
            (ctx) => [
              ...civProjPrep(pp),
              () => {
                const c = ctx();
                if (c) draw(c);
              },
            ],
            draw,
            (ms, st) => {
              const w = window as unknown as { __wfCiv: unknown; __wfCivProj: unknown };
              w.__wfCivProj = { ms, lon: mp.lon0, proj: mp.def.id, precise: true, prep: st.prep, slices: st.slices };
              if (preciseDrawn.current !== p0) w.__wfCiv = { ready: true, ms, show, year: p0.year, fast, proj: mp.def.id };
              preciseDrawn.current = p0;
            },
          );
          return;
        }
        L.redraw(cv, raster.w, raster.h, mp.key, null, draw, fresh);
        preciseDrawn.current = params;
        const w = window as unknown as { __wfCiv: unknown; __wfCivProj: unknown };
        const ms = performance.now() - t0;
        w.__wfCivProj = { ms, lon: mp.lon0, proj: mp.def.id, precise: true };
        if (fresh) w.__wfCiv = { ready: true, ms, show, year: params.year, fast, proj: mp.def.id };
        // 空闲时先把拖动用的等距圆柱原图备好:一开始拖就能整图重投影,不卡第一帧(回放、拖时间轴时不备)
        if (fast || baseDrawn.current === params) return;
        const p0 = params;
        const win = window as unknown as {
          requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number;
          cancelIdleCallback?: (h: number) => void;
        };
        const prep = () => {
          if (baseDrawn.current === p0) return;
          const src = L.source(raster.w, raster.h, true);
          const sctx = src.getContext('2d')!;
          sctx.clearRect(0, 0, src.width, src.height);
          drawCivOverlay(sctx, p0);
          baseDrawn.current = p0;
        };
        if (win.requestIdleCallback) {
          const h = win.requestIdleCallback(prep, { timeout: 3000 });
          return () => win.cancelIdleCallback?.(h);
        }
        const h = window.setTimeout(prep, 400);
        return () => window.clearTimeout(h);
      }
      const redraw = baseDrawn.current !== params || !L.has();
      if (redraw) {
        const src = L.source(raster.w, raster.h);
        const sctx = src.getContext('2d')!;
        sctx.clearRect(0, 0, src.width, src.height);
        drawCivOverlay(sctx, params);
        baseDrawn.current = params;
      }
      const t1 = performance.now();
      L.present(cv, mp, null, true);
      const w = window as unknown as { __wfCiv: unknown; __wfCivProj: unknown };
      w.__wfCivProj = { ms: performance.now() - t1, lon: mp.lon0, proj: mp.def.id };
      if (redraw) w.__wfCiv = { ready: true, ms: performance.now() - t0, show, year: params.year, fast, proj: mp.def.id };
      return;
    }
    baseDrawn.current = preciseDrawn.current = flatDrawn.current = null;
    baseProj.current.release();
    if (cv.width !== raster.w || cv.height !== raster.h) {
      cv.width = raster.w;
      cv.height = raster.h;
    }
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    copyStale.current = false;
    if (!params) {
      patchFeed({ base: cv, baseVer: feed.baseVer + 1 });
      return mirrorCanvas(refCopy.current, cv, false);
    }
    const t0 = performance.now();
    drawCivOverlay(ctx, params);
    flatDrawn.current = params;
    patchFeed({ base: cv, baseVer: feed.baseVer + 1 });
    if (copyVisible()) mirrorCanvas(refCopy.current, cv, true);
    else copyStale.current = true;
    (window as unknown as { __wfCiv: unknown }).__wfCiv = { ready: true, ms: performance.now() - t0, show, year: params.year, fast };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, raster, show, mp, baseMoving, covered, detailOn]);
  useLayoutEffect(() => {
    if (!(copyStale.current || selCopyStale.current) || !copyVisible()) return;
    if (copyStale.current) mirrorCanvas(refCopy.current, ref.current, true);
    if (selCopyStale.current) mirrorCanvas(selCopy.current, selRef.current, true);
    copyStale.current = selCopyStale.current = false;
  });

  // ---- 3. 高亮层(编年史点一条):只在点的那一下画一次 ----
  const curvedMode = !!mp;
  useEffect(() => {
    const cv = hlRef.current;
    if (!cv) return;
    if (cv.width !== raster.w || cv.height !== raster.h) {
      cv.width = raster.w;
      cv.height = raster.h;
    }
    const ctx = cv.getContext('2d')!;
    const copy = hlCopy.current;
    if (!hl || !ok || !base) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      mirrorCanvas(copy, cv, false);
      patchFeed({ hl: cv, hlVer: feed.hlVer + 1, hlStamp: 0 });
      return;
    }
    const t0 = performance.now();
    const m = mpRef.current;
    // 弯边投影:按投影直接画在地图平面上(罩染按行重投影,描边逐点投影;不接右边那一份)
    const marks = drawHighlight(ctx, world, raster, base, hl, style, view?.k ?? 1, m ? projector(m) : null);
    let lit = 0;
    for (const m of marks) if (m) lit++;
    // 闪约两秒;steady(天灾页的预览)淡入以后一直亮着
    const play = (el: HTMLCanvasElement) => {
      for (const a of el.getAnimations?.() ?? []) a.cancel();
      return el.animate?.(hl.steady ? (hl.faint ? HOLD_FAINT : HOLD) : FLASH, { duration: hl.steady ? HOLD_MS : FLASH_MS, easing: 'ease-in-out', fill: 'forwards' });
    };
    const anim = play(cv);
    // 细节层的高亮(放大后画的是它)一起闪
    const dh = detailHl.current;
    if (dh) play(dh);
    mirrorCanvas(copy, cv, !m);
    // 地球仪借用的是等距圆柱那一张(弯边投影时这张是投影过的,地球仪也不在)
    if (!m) patchFeed({ hl: cv, hlVer: feed.hlVer + 1, hlStamp: hl.stamp });
    if (copy && !m) play(copy);
    // 闪完就把高亮清掉(之后切画风、换年份不会再闪一次);一直亮着的由打开它的那一页清掉
    const stamp = hl.stamp;
    if (anim && !hl.steady) anim.onfinish = () => getCivHighlight()?.stamp === stamp && setCivHighlight(null);
    (window as unknown as { __wfHighlight: unknown }).__wfHighlight = { stamp, lit, year: hl.year, ms: performance.now() - t0 };
    // 画风切换时不重画(闪过就算了);只跟着新的高亮、新的世界走(换成 / 换回弯边投影时按新的办法重画)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hl, ok, base, world, raster, curvedMode]);
  // 弯边投影里高亮闪着的时候转了中心:按新中心重画(不重新闪)
  const hlShown = useRef(false);
  useEffect(() => {
    const cv = hlRef.current;
    if (!hlShown.current) {
      hlShown.current = true;
      return;
    }
    if (!cv || !mp || !hl || !ok || !base) return;
    drawHighlight(cv.getContext('2d')!, world, raster, base, hl, style, view?.k ?? 1, projector(mp));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mp]);

  // ---- 4. 选中层:选中的国家 / 州 / 大河、山脉。国家的国土随年份变(回放时一年画一次);描边按缩放倍数变细 ----
  const selYear = params ? Math.floor(params.year) : 0;
  const selZoom = Math.round(Math.log2(Math.max(1, view?.k ?? 1)) * 2) / 2;
  // 回放 / 拖时间轴时每 5 年才重画一次(一次约 10 毫秒,不拖慢回放)
  const selPolityYear = sel?.kind === 'polity' ? (fast ? selYear - (selYear % 5) : selYear) : 0;
  useEffect(() => {
    const cv = selRef.current;
    if (!cv) return;
    // 放大后细节层盖住了这一张:先不画(选中的轮廓由细节层画)
    if (detailOn) return;
    if (!sel || !ok || !base || sel.kind === 'settlement') {
      if (cv.width) cv.width = cv.height = 0;
      selCopyStale.current = false;
      mirrorCanvas(selCopy.current, cv, false);
      patchFeed({ sel: cv, selVer: feed.selVer + 1 });
      return;
    }
    if (cv.width !== raster.w || cv.height !== raster.h) {
      cv.width = raster.w;
      cv.height = raster.h;
    }
    const t0 = performance.now();
    const m = mp;
    if (m) {
      // 弯边投影:按投影直接画在地图平面上(罩染按行重投影,描边逐点投影;转中心时每次重画,约十毫秒)
      const lit = drawSelection(cv.getContext('2d')!, world, raster, base, sel, selPolityYear, style, 2 ** selZoom, projector(m));
      selCopyStale.current = false;
      mirrorCanvas(selCopy.current, null, false);
      (window as unknown as { __wfSelection: unknown }).__wfSelection = { kind: sel.kind, id: sel.id, lit, ms: performance.now() - t0 };
      return;
    }
    const lit = drawSelection(cv.getContext('2d')!, world, raster, base, sel, selPolityYear, style, 2 ** selZoom);
    // 右边接的那一份同底图:看得见时才复制,看不见记下"过期",平移到看得见时再补
    selCopyStale.current = !copyVisible();
    if (!selCopyStale.current) mirrorCanvas(selCopy.current, cv, true);
    patchFeed({ sel: cv, selVer: feed.selVer + 1 });
    (window as unknown as { __wfSelection: unknown }).__wfSelection = { kind: sel.kind, id: sel.id, lit, ms: performance.now() - t0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, ok, base, world, raster, style, selPolityYear, selZoom, mp, detailOn]);

  // ---- 2. 文字层 ----
  // 地理名不随年份变:回放时不用每帧重新生成;国名、城名、城镇符号随年份变
  const geoItems = useMemo(() => (labelParams ? civLabelItems(labelParams) : []), [labelParams]);
  // 弯边投影:国名按投影后的国土拟合;拖动中心时(moving)先用世界坐标拟合的那一份投过去,停下来再按新中心拟合
  const fitMp = mp && !moving ? mp : null;
  // 配角名(如民族填色上的国名、国家填色上的族名):拖时间轴、回放时先收起,停稳 0.3 秒后再排上、淡入(主角名一直在)
  const sides = useSettled(!fast, SIDE_SETTLE_MS);
  const mapLayer = useMemo(() => (mapParams ? mapLayerOf(mapParams, { fast, proj: fitMp, sides }) : null), [mapParams, fast, fitMp, sides]);
  // 配角名这一次是从收起到排上的:从这一刻起淡入(刚打开、只是换了开关时直接画)
  const sideFadeFrom = useRef(0);
  const sidesBefore = useRef(sides);
  useLayoutEffect(() => {
    if (sides && !sidesBefore.current) sideFadeFrom.current = performance.now();
    sidesBefore.current = sides;
  }, [sides]);
  const [fadeTick, setFadeTick] = useState(0);
  const extras = useMemo(() => (labelParams ? labelViewExtras(labelParams) : null), [labelParams]);
  const text = useMemo(() => (ok && civ ? labelCharsOf(civ) : ''), [ok, civ]);
  const fontStyle = style;
  const want = `${fontStyle}|${text}`;
  const [loaded, setLoaded] = useState('');
  // 清理函数在模块里建(whenDone):不拉住这一次渲染时的历史,下一回换字以前历史换了也放得掉
  useEffect(() => (text ? whenDone(ensureFonts(fontStyle, text), () => setLoaded(want)) : undefined), [fontStyle, text, want]);
  // 字体早已加载好(比如切换画风、开关地名)时不必等一帧,直接画
  const fontsOk = loaded === want || (text !== '' && fontsReady(fontStyle, text));
  useEffect(() => patchFeed({ layer: mapLayer, places: geoItems, fontsOk }), [mapLayer, geoItems, fontsOk]);

  // 换上新的历史:后台分小步备好底图(色块、国界、道路、战事、瘟疫)、国名城名、战线、要等的字,备好了再换上(见上面的 hold)
  // 地图在动(拖动、飞过去)、配角名收起没有、弯边投影的中心:做到那一步时按当时的(这几样变了不用从头备;对不上的换上时当场算)
  const target = hold ? incoming : null;
  const textOpt = useRef({ moving, sides });
  textOpt.current = { moving, sides };
  const curved = !!mp;
  useEffect(() => {
    if (!target || !civIn) return;
    const p: CivDrawParams = { world, raster, civ: target, style, year: y ?? target.endYear, show, fast: false, faithFocus: show.faiths ? faithFocusIn : null };
    const named: CivDrawParams = { ...p, civ: civIn };
    const mp0 = mpRef.current;
    // 弯边投影 · 手绘:符号遮罩按投影重算的那几步(按这一刻的投影;停着的时候缓存里本来就有,什么也不做)
    let projSteps: WorkStep[] | null = null;
    let pi = 0;
    const projPrep: WorkStep = (deadline) => {
      const cur = mpRef.current;
      projSteps ??= cur ? civProjPrep({ ...p, proj: projector(cur) }) : [];
      if (pi < projSteps.length && projSteps[pi](deadline) !== true) pi++;
      return pi < projSteps.length;
    };
    const steps: WorkStep[] = [
      // 色块只看是不是弯边投影(手绘按投影后的符号层让位,另存一份),和中心在哪无关
      ...civOverlaySteps(mp0 ? { ...p, proj: projector(mp0) } : p),
      projPrep,
      () => void (warsShown(p) && warFront(p)),
      () => {
        const cur = mpRef.current;
        mapLayerOf(named, { fast: false, proj: cur && !textOpt.current.moving ? cur : null, sides: textOpt.current.sides });
      },
      () => void labelCharsOf(civIn),
    ];
    // 备料出了错(比如手机上画布内存不够):不再等,放开换上(换上时照常当场画),错误照常报出去
    let failed = false;
    const guarded = steps.map((s): WorkStep => (deadline) => {
      if (failed) return;
      try {
        return s(deadline);
      } catch (e) {
        failed = true;
        setTimeout(() => {
          throw e;
        });
      }
    });
    submitDetailJob(
      CIV_SWAP_JOB,
      guarded,
      () => {
        prepared.current = target;
        setPrepTick((n) => n + 1);
      },
      { alone: true },
    );
    return () => cancelDetailJob(CIV_SWAP_JOB);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 投影只看弯不弯(中心、大小在做到那一步时取当时的)
  }, [target, civIn, world, raster, style, y, show, faithFocusIn, curved]);

  // 地图框大小变了(窗口缩放)也要重画
  const [tick, setTick] = useState(0);
  useEffect(() => watchMapBox(textRef.current, setTick), [labelsHost]);

  // 地图上盖着的界面(四角的字、时间轴、面板 / 抽屉、提示条……):它们下面不放字和符号(和地球仪同一份清单,见 uiAvoid.ts)
  const avoid = useAvoidBoxes(textRef);
  // 物产图层:这一年州治上的圆章(只看哪一样、显示不显示没发现的由侧栏列表定)
  const resView = useResourceView();
  const badges = useMemo(
    () => (params?.show.resources && base?.development ? resourceBadges(base.development, params.year, base.regions.count, resView.focus, resView.hidden) : null),
    [params, base, resView],
  );
  // 手绘风国都城堡插的国旗:旗的小图加载好了重画
  const flagImages = useFlagImages();
  // 上一次排版的结果:排版看的东西(文字、符号、视口、要让开的框、字体)都没变就接着用 —— 只换了选中、旗子、物产圆章时不重排
  const lastPlace = useRef<{ geo: LabelItem[]; layer: unknown; extras: unknown; mp: unknown; key: string; placed: Placement } | null>(null);

  useLayoutEffect(() => {
    const cv = textRef.current;
    const box = mapBoxOf(cv);
    if (!cv || !box) return;
    const ctx = cv.getContext('2d')!;
    const clear = () => {
      setMapPlacement(null);
      ctx.clearRect(0, 0, cv.width, cv.height);
    };
    const items = mapLayer ? geoItems.concat(mapLayer.items) : geoItems;
    const marks = mapLayer?.marks ?? [];
    const wars = !!params && warsShown(params);
    if ((!items.length && !marks.length && !wars && !badges?.length) || !extras || !fontsOk) return clear();
    const t0 = performance.now();
    // 看得见的那块:地图框(已被 CSS 放大)和舞台(视口)的交集,换回地图框自己的坐标
    // (舞台换成视窗,地图框往右多算一份 —— 见 mapWrap.ts 的 visibleBox)
    const vis = visibleBox(box);
    if (!vis) return clear();
    const { k, bw } = vis;
    const dpr = window.devicePixelRatio || 1;
    const lx0 = vis.x0;
    const ly0 = vis.y0;
    const W = Math.max(1, Math.round((vis.x1 - vis.x0) * k * dpr));
    const H = Math.max(1, Math.round((vis.y1 - vis.y0) * k * dpr));
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    } else clear();
    Object.assign(cv.style, { width: `${W / dpr}px`, height: `${H / dpr}px` });
    placeOnScreen(cv, vis, lx0, ly0, k);
    const scale = (bw / extras.worldW) * k * dpr;
    const lv: LabelView = { ...extras, scale, ox: -lx0 * k * dpr, oy: -ly0 * k * dpr, dpr, k, mapCss: bw, canvasW: W, canvasH: H };
    if (mp) {
      // 弯边投影:整张图就在画布上(不挪整圈);字不出外轮廓(罗盘在轮廓外面,不用另外让)
      lv.proj = labelProjection(mp);
      lv.wrap = 0;
      lv.frameLeft = 0;
      lv.reserved = [];
    } else {
      // 外框画在视窗上(不随平移),文字不出外框、不压左下角的罗盘
      const fl = (vis.frameX / bw) * extras.worldW;
      lv.frameLeft = fl;
      lv.reserved = extras.reserved?.map((r) => [r[0] + fl, r[1], r[2] + fl, r[3]] as [number, number, number, number]);
    }
    // 界面(屏幕坐标)→ 文字层画布像素(画布左上角 = 看得见的那一块的左上角,一个 CSS 像素 = dpr 个画布像素)
    const ui = avoid.map((b) => [(b[0] - vis.left) * dpr, (b[1] - vis.top) * dpr, (b[2] - vis.left) * dpr, (b[3] - vis.top) * dpr] as const);
    if (ui.length) lv.reserved = reserveCanvasBoxes(lv, ui);
    const fontOk = fontsReady(fontStyle, text);
    const pkey = [W, H, lv.scale, lv.ox, lv.oy, dpr, k, bw, lv.frameLeft, lv.wrap, fontStyle, text, fontOk, JSON.stringify(lv.reserved ?? null)].join('|');
    const lp = lastPlace.current;
    const raw =
      lp && lp.geo === geoItems && lp.layer === mapLayer && lp.extras === extras && lp.mp === mp && lp.key === pkey ? lp.placed : placeMap(items, marks, lv);
    lastPlace.current = { geo: geoItems, layer: mapLayer, extras, mp, key: pkey, placed: raw };
    // 国都的符号总要画(排版时不看重叠),但压在界面下面的也不画(和地球仪一样)
    const placed: Placement = !ui.length
      ? raw
      : {
          ...raw,
          marks: raw.marks.filter((pm) => {
            const b = placedMarkBox(pm);
            return !ui.some((r) => r[0] < b[2] && r[2] > b[0] && r[1] < b[3] && r[3] > b[1]);
          }),
        };
    // 选中的城(符号没画出来时按它的位置画圈)、选中的东西的名字底下的光晕
    let at: [number, number] | null = null;
    if (sel?.kind === 'settlement' && civ?.settlements[sel.id]) {
      const c = civ.settlements[sel.id].cell;
      const cx = (W / 2 - lv.ox) / lv.scale;
      at = mp ? toCanvas(lv, world.mesh.x[c], world.mesh.y[c]) : [nearX(world.mesh.x[c], cx, lv.wrap ?? 0) * lv.scale + lv.ox, world.mesh.y[c] * lv.scale + lv.oy];
    }
    // 战线、双剑压在国界上、城镇符号和字底下
    const war = wars && params ? drawWarfare(ctx, params, lv, mp ? projector(mp) : null) : null;
    drawSelectionLabels(ctx, placed, lv, sel, style, at);
    const capFlags: CapitalFlags | undefined =
      style === 'fantasy' && flags && flags.civ === civ && params
        ? {
            minPx: 13 * dpr,
            flag: (id) => {
              const e = flagOf(flags, id, params.year);
              const image = e && flagImage(e.spec);
              return image ? { image, shape: e.spec.shape } : null;
            },
          }
        : undefined;
    drawSettlementMarks(ctx, placed.marks, style, capFlags);
    // 配角名淡入中:按过了多久调淡,下一帧再画(排版用上面缓存的,不重排)
    const fade = mapLayer?.sides.size && sideFadeFrom.current ? Math.min(1, (performance.now() - sideFadeFrom.current) / SIDE_FADE_MS) : 1;
    const fading = fade < 1 && placed.labels.some((l) => mapLayer!.sides.has(l.item));
    drawPlacedLabels(ctx, fading ? placed.labels.map((l) => (mapLayer!.sides.has(l.item) ? { ...l, alpha: l.alpha * fade } : l)) : placed.labels, lv);
    // 信仰图层:圣城符号右上方一个这个教颜色的小圆点(符号没排上时按城的位置;压在界面下面的不画)
    if (params?.show.faiths && base) {
      const cx = (W / 2 - lv.ox) / lv.scale;
      for (const h of holyCities(base, params.year, params.faithFocus)) {
        const pm = placed.marks.find((m) => m.mark.id === h.settlement);
        let x: number;
        let y: number;
        if (pm) [x, y] = [pm.x, pm.y];
        else {
          const c = base.settlements[h.settlement].cell;
          [x, y] = mp ? toCanvas(lv, world.mesh.x[c], world.mesh.y[c]) : [nearX(world.mesh.x[c], cx, lv.wrap ?? 0) * lv.scale + lv.ox, world.mesh.y[c] * lv.scale + lv.oy];
          if (!Number.isFinite(x) || x < 0 || y < 0 || x > W || y > H || ui.some((r) => r[0] < x && r[2] > x && r[1] < y && r[3] > y)) continue;
        }
        drawHolyDot(ctx, x, y, h.color, dpr);
      }
    }
    // 物产图层:州治上的圆章(稀有的先放,挤了就让;压着地名、界面的不画)
    if (badges?.length && base && params)
      drawResourceLayer(ctx, base, world, params.year, lv, placed.labels, resView, (x, y) => ui.some((q) => q[0] < x && q[2] > x && q[1] < y && q[3] > y), badges);
    setMapPlacement({ canvas: cv, placed, view: lv });
    const w = window as unknown as { __wfLabels?: LabelsDebug };
    w.__wfLabels = {
      ready: true,
      drawn: placed.labels.length,
      marks: placed.marks.length,
      polities: placed.labels.filter((l) => l.item.pick?.kind === 'polity').length,
      year: params?.year ?? 0,
      fast: !!fast,
      ms: performance.now() - t0,
      fontOk,
      firstFontOk: w.__wfLabels?.firstFontOk ?? fontOk,
      style: fontStyle,
      k,
      texts: placed.labels.map((l) => l.item.text),
      wars: war,
      proj: mp?.def.id ?? 'equirect',
      lon: mp?.lon0,
      fitted: !!fitMp,
    };
    if (!fading) return;
    const h = requestAnimationFrame(() => setFadeTick((n) => n + 1));
    return () => cancelAnimationFrame(h);
  }, [geoItems, mapLayer, extras, fontsOk, fontStyle, style, text, view, tick, params, fast, sel, civ, world, mp, fitMp, avoid, labelsHost, flags, flagImages, badges, resView, fadeTick]);

  return (
    <>
      <canvas ref={ref} className="civ" style={{ pointerEvents: 'none' }} />
      <canvas ref={refCopy} className="civ wrap-copy" style={{ pointerEvents: 'none' }} />
      <canvas ref={selRef} className="civ-sel" style={{ pointerEvents: 'none' }} />
      <canvas ref={selCopy} className="civ-sel wrap-copy" style={{ pointerEvents: 'none' }} />
      <canvas ref={hlRef} className="civ-hl" style={{ pointerEvents: 'none', opacity: 0 }} />
      <canvas ref={hlCopy} className="civ-hl wrap-copy" style={{ pointerEvents: 'none', opacity: 0 }} />
      {labelsHost && createPortal(<canvas ref={textRef} className="civ-labels" style={{ pointerEvents: 'none' }} />, labelsHost)}
      <CivDetail
        world={world}
        raster={raster}
        params={params}
        civ={ok ? base : null}
        style={style}
        sel={sel}
        selYear={selPolityYear}
        hl={hl}
        view={view ?? VIEW_1}
        mp={mp}
        host={detailHost}
        hlRef={detailHl}
        hide={[ref, refCopy, selRef, selCopy, hlRef, hlCopy]}
        onCover={setDetailOn}
      />
    </>
  );
}
