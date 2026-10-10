/**
 * 新建世界(和平常的地图页面分开的一套深色界面)。两种,在「新建世界」弹窗里选(NewWorldDialog.tsx),进来以后不能换成另一种:
 *
 * 随机生成(mode = 'random')
 *   中间     这颗星球(StudioScene + PlanetGL):进来就是地球仪、自转;拖动转动。改地形时摊成平面,换成平常的平面地图和改地形覆盖层
 *            (App 按 studioStore 的 flat 摆地图)
 *   左边     设定(电脑贴着窗口左边、能收起;手机是底部卡片,平时只露种子和「创建世界」):
 *            种子 + 换一颗、世界参数;地形(改地形工具、让助手改);名字(世界名、地名风格);底部「创建世界」。
 *            点「地名风格」左边换成配比例的那一页(NameMixPage.tsx),左上返回;手机上卡片里换页、拉到最高
 *   右边     样式(不用历史的 7 种,带缩略图)和投影(地球仪 + 5 种平面);手机上是右上两个按钮,点开是列表
 *
 * 照手绘图生成(mode = 'image')
 *   左边     图片那一行(换一张)和三步:认出海陆 → 用笔修改 → 参数和名字(零件在 SketchSteps.tsx)。做到哪步展开哪步,
 *            做过的打勾、组头写着结果;第 1 步「照这样长出星球」以后才能点开后两步。手机上是占大半屏的底部卡片
 *   中间     平时是平面地图(比随机生成摊平的大:没有右边的面板;上方留出切换条,电脑上下方一句提示),
 *            切换条:原图 / 认出来的 / 长出来的、叠上原图、样式,平面 / 地球仪。地球仪和随机生成的一样能拖动转
 *
 *   助手     「让助手改」打开:电脑上贴着右边,手机上是盖住设定卡片的底部卡片(上面留出星球)。
 *            新建时助手只改地形、回答问题;列出来还没执行的改地形在星球上用白色虚线圈出来、编号和清单对上,
 *            星球先转过去正对着那一块。执行后和手动改地形一样重新生成、星球淡入新样子(不放提示条)
 *   确认框   点「创建世界」先列出建好以后不能改的四样(种子 / 照的图、世界参数、地形、地名风格);确认后面板滑出、星球展开成平常的地图、淡出
 *
 * 没有 WebGL(或显卡丢了):中间一直是平常的平面地图;样式照样能换。
 * 系统设了"减少动态效果":地球仪不自转,换样式和投影只做很短的过渡。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { World, WorldParams } from '../../gen/world';
import { DEFAULT_PARAMS } from '../../gen/world';
import type { Civ } from '../../gen/civ/types';
import type { Raster } from '../../gen/raster';
import { TITLE_MAX, worldKey } from '../../gen/savefile';
import type { DraftBase } from '../stageStore';
import { getEdits, useEdits } from '../editsStore';
import {
  TerrainCaption,
  TerrainPanel,
  applyImport,
  getTerrainTool,
  setTerrainTool,
  terrainCount,
  terrainSide,
  useTerrainHint,
  useTerrainKeys,
  useTerrainTool,
} from '../TerrainTools';
import {
  ImportPanel,
  cancelImport,
  dropSource,
  importCaption,
  importOn,
  importProgress,
  importSummary,
  layerSummary,
  pickImage,
  resumeImport,
  setSourceView,
  useImport,
  useSource,
  useSourceView,
} from '../ImportImage';
import { ParamSlider, SLIDERS, paramsSide } from '../WorldOverviewGenesis';
import { openAiSettings } from '../AiSettings';
import { AiSettingsItem, MenuItem, MenuSep, PopMenu } from '../PopMenu';
import { AssistantPanel } from '../Assistant';
import { useAssistant } from '../assistantStore';
import { useAiOn } from '../../ai/client';
import { AST_W, closeAssistant, openAssistant, useAstOpen } from '../astPanel';
import { PRIVACY_URL, SOURCE_URL, TERMS_URL } from '../links';
import { APP_VERSION } from '../version';
import { Icon } from '../icons';
import { styleKey } from '../LayerPopover';
import type { MapLayer } from '../mapLayers';
import { getProjection, lastFlatProjection, setProjection, type MapProjection } from '../projection';
import type { ProjectionId } from '../../render/projection';
import { getMapCenter } from '../mapWrap';
import { landCenterLon, plateTexels, type PlanetProjection } from '../../render/planet';
import { PlanetGL } from './planetGL';
import { StudioScene, type SceneHooks, type StillPose } from './scene';
import { NameMixPage } from './NameMixPage';
import { ImageCard, StepGroup, StepParams, ViewBar, paramsBrief } from './SketchSteps';
import { mixSummary } from '../nameMix';
import { drawPlanetLabels } from './planetLabels';
import { drawPlanetMarks, marksCenter, type PlanetMark } from './planetMarks';
import { getCivFeed, subscribeCivFeed } from '../CivLayer';
import { labelSurface } from '../../render/civ/labels';
import type { LabelView } from '../../render/labels/draw';
import { LEFT_W, RIGHT_W, appPose, flatRect } from './layout';
import { flatGeom, getStudioFlat, setStudioFlat } from './studioStore';
import '../worlds.css';
import './studio.css';

/** 新建时能看的样式(不用历史的;政区、民族建好以后才有) */
export const STUDIO_STYLES: { id: MapLayer; name: string; hint: string }[] = [
  { id: 'realistic', name: '实景', hint: '像卫星照片' },
  { id: 'terrain', name: '地形', hint: '手绘地图' },
  { id: 'biomes', name: '生态', hint: '森林、草原、沙漠' },
  { id: 'elevation', name: '高程', hint: '按海拔上色' },
  { id: 'plates', name: '板块', hint: '板块和漂移方向' },
  { id: 'temperature', name: '气温', hint: '冷暖分布' },
  { id: 'precipitation', name: '降水', hint: '干湿分布' },
];
const STYLE_IDS = STUDIO_STYLES.map((s) => s.id);

/** 投影:名字、一句说明、小图标的宽高圆角(按这种投影整张图的轮廓) */
const PROJS: { id: PlanetProjection; name: string; hint: string; icon: [number, number, string] }[] = [
  { id: 'globe', name: '地球仪', hint: '拖动转动', icon: [22, 22, '50%'] },
  { id: 'equirect', name: '等距圆柱', hint: '经纬线横平竖直', icon: [34, 17, '1px'] },
  { id: 'robinson', name: '罗宾森', hint: '地图集常用', icon: [34, 18, '40% / 50%'] },
  { id: 'naturalEarth', name: '自然地球', hint: '介于前两种之间', icon: [34, 18, '28% / 45%'] },
  { id: 'mollweide', name: '摩尔魏德', hint: '等面积', icon: [34, 17, '50%'] },
  { id: 'mercator', name: '墨卡托', hint: '航海图，高纬度放大', icon: [24, 22, '1px'] },
];

/** 手机上助手的底部卡片占屏幕多高(和 studio.css 的 .st-phone > .ast-panel 一致) */
const AST_SHEET = 0.58;
/** 手机上照手绘图那一页的底部卡片占屏幕多高(和 studio.css 的 .sk-sheet 一致;拉到最高时盖住地图,地图不跟着挪) */
const SK_SHEET = 0.642;
/** 照手绘图那一页:电脑上地图下边到那句提示有多远 */
const CAP_GAP = 34;

/** 板块贴图的大小(找陆地最多的那一面用) */
const PLATE_W = 1024;
const PLATE_H = 512;

export interface StudioProps {
  phone: boolean;
  /** 怎么生成:随机 / 照手绘图(新建时定下,两种不能互换) */
  mode: 'random' | 'image';
  params: WorldParams;
  /** 名字(打开没建完的世界时是它存的名字;以别的世界为底稿时先填好"原名(二)") */
  title: string;
  base: DraftBase | null;
  /** 左上返回(我的世界 / 底稿那个世界) */
  back: { label: string; onClick: () => void } | null;
  onSeed: (seed: number) => void;
  /** 换一个随机种子(随机生成的「换一颗」;照手绘图的「山河、地名换一种」:海陆照图,不变) */
  onRandomSeed: () => void;
  onParams: (p: WorldParams) => void;
  onTitle: (title: string) => void;
  /** 确认创建:名字、正中的经度(度,平常的地图从这里接着看);true = 建好了 */
  onCreate: (title: string, lon: number) => boolean;
  /** 正在生成(换了种子、调了参数、改了地形):创建不了 */
  busy: boolean;
  /** 世界出来了(不在生成) */
  ready: boolean;
  noCiv: boolean;
  data: { world: World; raster: Raster } | null;
  /** 这颗星球推演出来的历史(套上改名的、没套的):助手要用 */
  civ: Civ | null;
  raw: Civ | null;
  /** 正在生成 / 按新地形重新生成:助手这时发不了话、确认单也不能执行 */
  worldBusy: boolean;
  /** 平常页面现在的图层(新建时 = 这里选的样式) */
  layer: MapLayer;
  onLayer: (id: MapLayer) => void;
  /** 某画风的整张图(等距圆柱;App 的缓存) */
  baseCanvas: (key: string) => HTMLCanvasElement | null;
  thumbs: Partial<Record<MapLayer, string>>;
  requestThumbs: (ids: MapLayer[]) => void;
  /** 创建以后:星球展开完、开始淡出(App 把平常的地图露出来) */
  onFade: () => void;
  /** 淡出完了(App 卸掉新建界面) */
  onGone: () => void;
}

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Studio(p: StudioProps) {
  const edits = useEdits();
  const tool = useTerrainTool();
  const imp = useImport();
  const importing = !!imp;
  const src = useSource();
  const sv = useSourceView();
  const terrainHint = useTerrainHint();
  useTerrainKeys();
  const image = p.mode === 'image';
  /** 照手绘图:已经照图长出了星球(草图里有那张图) */
  const applied = !!edits.sketch?.image;
  const reduce = useMemo(reducedMotion, []);
  const style: MapLayer = STYLE_IDS.includes(p.layer) ? p.layer : 'realistic';
  const styleRef = useRef(style);
  styleRef.current = style;

  const rootRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<StudioScene | null>(null);
  const labRef = useRef<HTMLCanvasElement>(null);
  const pRef = useRef(p);
  pRef.current = p;
  /** 显卡:null = 还没试,false = 没有 / 丢了(退回平面地图) */
  const [glOk, setGlOk] = useState<boolean | null>(null);
  const [tip, setTip] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [proj, setProj] = useState<PlanetProjection>('globe');
  const [confirm, setConfirm] = useState(false);
  /** 创建以后:1 = 面板滑出、星球展开;2 = 淡出 */
  const [out, setOut] = useState<0 | 1 | 2>(0);
  const gone = useRef(false);
  /** 平面地图露出来了(改地形 / 没有 WebGL):星球藏起来 */
  const [flatShown, setFlatShown] = useState(false);
  // 手机:底部卡片拉开没有、右上哪个列表开着、卡片多高
  const [sheetFull, setSheetFull] = useState(false);
  /** 左边换成「地名风格」页(手机上卡片里换页) */
  const [namesPage, setNamesPage] = useState(false);
  /** 地名风格页还没交的份数(见 NameMixPage 的 flush) */
  const mixFlush = useRef<(() => void) | null>(null);
  const [drawer, setDrawer] = useState<'style' | 'proj' | null>(null);
  const [sheetH, setSheetH] = useState(0);
  const [vw, setVw] = useState(() => (typeof innerWidth === 'number' ? innerWidth : 1280));
  const [vh, setVh] = useState(() => (typeof innerHeight === 'number' ? innerHeight : 800));

  // ---- 照手绘图:哪一步开着(null = 都收着)、开过哪几步(组头打勾)、地图是平面还是地球仪、样式列表开着没有 ----
  const [step, setStep] = useState<1 | 2 | 3 | null>(() => (!image ? null : getEdits().sketch?.image && !importOn() ? 2 : 1));
  const [seen, setSeen] = useState(0);
  useEffect(() => {
    if (step) setSeen((s) => s | (1 << step));
  }, [step]);
  const [imgFlat, setImgFlat] = useState(true);
  const [styOpen, setStyOpen] = useState(false);
  /** 地图摊成平面:改地形的时候;照手绘图的平时也是(切到地球仪才卷起来) */
  const wantFlat = tool.on || (image && imgFlat);

  // ---- 设定(和原来的新建卡片一样) ----
  const [paramsOpen, setParamsOpen] = useState(false);
  const [name, setName] = useState(p.title);
  useEffect(() => setName(p.title), [p.title]);
  const [seedText, setSeedText] = useState(String(p.params.seed));
  useEffect(() => setSeedText(String(p.params.seed)), [p.params.seed]);
  const [seedBad, setSeedBad] = useState(false);

  // ---- 助手(只改地形、回答问题;对话、确认单在 assistantStore) ----
  const astOpen = useAstOpen();
  const ast = useAssistant();
  // 「使用 AI 功能」关着:没有「让助手改」(左边那行、手机右上第三个按钮)
  const aiOn = useAiOn();
  const astShown = aiOn && astOpen && !!p.data && !!p.civ && !!p.raw;
  /** 列出来、还没执行的那一份(最新的) */
  const pending = useMemo(() => {
    for (let i = ast.turns.length - 1; i >= 0; i--) {
      const t = ast.turns[i];
      if (t.status === 'done' && t.proposal && !t.applied && !t.dismissed && t.lock === 'history') return t;
    }
    return null;
  }, [ast.turns]);
  /** 星球上要圈出来的几处(勾着的改地形;编号 = 清单上第几条) */
  const marks = useMemo<PlanetMark[]>(() => {
    if (!pending?.proposal) return [];
    const off = new Set(pending.off ?? []);
    return pending.proposal.items.flatMap((x, i) => (x.change?.kind === 'terrain' && !off.has(i) ? [{ n: i + 1, op: x.change.op }] : []));
  }, [pending]);
  const marksRef = useRef<PlanetMark[]>([]);
  marksRef.current = astShown ? marks : [];

  // ---- 进来时平常的地图换成等距圆柱(改地形、没有 WebGL 时露出来的是它;藏着的时候换图层也最省事);
  //      没创建就离开时换回原来的投影 ----
  const prevProj = useRef<MapProjection>('equirect');
  /** 进来之前的平面投影(原来是地球仪时,从地球仪切回平面要回到的那个) */
  const prevFlat = useRef<ProjectionId>('equirect');
  const created = useRef(false);
  useLayoutEffect(() => {
    prevProj.current = getProjection();
    prevFlat.current = lastFlatProjection();
    if (prevProj.current !== 'equirect') setProjection('equirect');
    // 平常页面上开着的助手不跟进来(新建里从「让助手改」打开);离开时也收起
    closeAssistant();
    // 照手绘图:进来就是摊平的地图和认图(或第 2 步的笔)
    if (image) setTerrainTool({ on: true });
    return () => {
      closeAssistant();
      setStudioFlat(null);
      // 正在认的、留着的那张图只属于这一次新建
      dropSource();
      if (!created.current && prevProj.current !== 'equirect' && getProjection() === 'equirect') setProjection(prevProj.current, prevFlat.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 星球上的地名:停住时排一次,一动就藏起来 ----
  const stillRef = useRef<StillPose | null>(null);
  const labTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [labOn, setLabOn] = useState(false);
  const markRef = useRef<HTMLCanvasElement>(null);
  const [markOn, setMarkOn] = useState(false);
  const surf = useRef<{ data: object; fn: LabelView['surface'] } | null>(null);
  const queueLabels = () => {
    clearTimeout(labTimer.current);
    if (!stillRef.current) {
      setLabOn(false);
      setMarkOn(false);
      return;
    }
    // 停稳一下再排(拖完松手、变形刚停时不急着排)
    labTimer.current = setTimeout(() => {
      const cv = labRef.current;
      const d = pRef.current.data;
      const pose = stillRef.current;
      if (!cv || !d || !pose || gone.current) return;
      if (surf.current?.data !== d) surf.current = { data: d, fn: labelSurface(d.world, d.raster, 1) };
      const feed = getCivFeed();
      const dpr = Math.min(2, devicePixelRatio || 1);
      const n = drawPlanetLabels(cv, feed.fontsOk ? feed.places : [], pose, d.world, surf.current.fn, dpr);
      setLabOn(n > 0);
      const mc = markRef.current;
      if (mc) setMarkOn(drawPlanetMarks(mc, marksRef.current, pose, d.world, dpr) > 0);
    }, 160);
  };
  // 地名换了(换了样式、换了一颗、字体刚加载好):停着的话重排
  useEffect(
    () =>
      subscribeCivFeed(() => {
        if (stillRef.current) queueLabels();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => () => clearTimeout(labTimer.current), []);

  // ---- 星球 ----
  const hooks = useRef<SceneHooks>({
    frame: () => {},
    flat: () => {},
    touched: () => {},
    still: () => {},
  });
  hooks.current = {
    frame: ({ cx, r, m, cy }) => {
      const g = glowRef.current;
      if (g) {
        const R = r * 1.2;
        g.style.opacity = m > 0.02 ? String(Math.pow(m, 3)) : '0';
        g.style.width = g.style.height = `${R * 2}px`;
        g.style.transform = `translate(${cx - R}px, ${cy - R}px)`;
      }
      if (!p.phone && tipRef.current) tipRef.current.style.left = `${cx}px`;
    },
    flat: (rect, lon) => {
      setStudioFlat(rect, lon);
      setFlatShown(!!rect);
    },
    touched: () => {
      setTip(false);
      setDrawer(null);
      setStyOpen(false);
    },
    still: (pose) => {
      stillRef.current = pose;
      queueLabels();
    },
  };

  useLayoutEffect(() => {
    const cv = glRef.current;
    const root = rootRef.current;
    if (!cv || !root) return;
    const gl = PlanetGL.create(cv, { small: p.phone });
    if (!gl) {
      setGlOk(false);
      return;
    }
    const sc = new StudioScene(
      gl,
      {
        frame: (i) => hooks.current.frame(i),
        flat: (r, l) => hooks.current.flat(r, l),
        touched: () => hooks.current.touched(),
        still: (pose) => hooks.current.still(pose),
      },
      reduce,
    );
    sceneRef.current = sc;
    const size = () => {
      const w = root.clientWidth || innerWidth;
      const h = root.clientHeight || innerHeight;
      setVw(w);
      setVh(h);
      sc.setViewport(w, h, devicePixelRatio || 1);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(root);
    gl.onLost = () => {
      // 显卡丢了:退回平面地图(这一次新建里不再用星球)
      sc.dispose();
      sceneRef.current = null;
      setGlOk(false);
    };
    sc.start();
    setGlOk(true);
    return () => {
      ro.disconnect();
      if (sceneRef.current === sc) {
        sc.dispose();
        sceneRef.current = null;
      }
    };
    // 只在进来时建一次(手机 / 电脑跨断点时贴图大小不变)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 没有 WebGL:窗口大小跟着变
  useEffect(() => {
    if (glOk !== false) return;
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => {
      setVw(root.clientWidth || innerWidth);
      setVh(root.clientHeight || innerHeight);
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [glOk]);

  // 手机:底部卡片多高(星球摆在它上面)
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!p.phone || !el) return setSheetH(0);
    const ro = new ResizeObserver(() => setSheetH(el.offsetHeight));
    ro.observe(el);
    setSheetH(el.offsetHeight);
    return () => ro.disconnect();
  }, [p.phone, glOk]);

  // 两边让出多少;面板滑进滑出时星球跟着挪(第一次直接摆好)
  const laidOut = useRef(false);
  // 助手开着:电脑上右边是助手面板(随机生成的换掉样式和投影);手机上助手的底部卡片占屏幕的 58%(星球摆在它上面)。
  // 照手绘图的没有右边的面板;手机上底部卡片的高是定的(拉到最高时盖住地图)
  const insets = useMemo(() => {
    if (p.phone) return { l: 0, r: 0, b: astShown ? Math.round(vh * AST_SHEET) : image ? Math.round(vh * SK_SHEET) : sheetH };
    return { l: collapsed ? 0 : LEFT_W, r: astShown ? AST_W : image ? 0 : RIGHT_W, b: 0 };
  }, [p.phone, collapsed, sheetH, astShown, vh, image]);
  useLayoutEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    sc.setLayout({ ...insets, bar: image, phone: p.phone }, laidOut.current);
    laidOut.current = true;
  }, [insets, image, p.phone, glOk]);
  /** 中间那一块(两边面板、底部卡片让完以后) */
  const box = { x: insets.l, y: 0, w: Math.max(1, vw - insets.l - insets.r), h: Math.max(1, vh - insets.b) };

  // 没有 WebGL:右边样式的缩略图照样要做
  useEffect(() => {
    if (glOk === false && p.ready) p.requestThumbs(STYLE_IDS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glOk, p.ready, p.data]);

  // 没有 WebGL:平常的地图一直铺在中间那块(刚铺上时带上正中的经线:从放大着的地图进来,也放回 1 倍看整颗星球)
  useEffect(() => {
    if (glOk !== false || out) return;
    setStudioFlat(flatRect(box, { phone: p.phone, bar: image }), getStudioFlat() ? undefined : getMapCenter());
    setFlatShown(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glOk, insets, vw, vh, p.phone, out, image]);

  // ---- 世界:贴图;第一颗直接是地球仪,换了一颗、调了参数、改了地形都淡过去 ----
  const tagRef = useRef(0);
  const shown = useRef<{ data: object; tag: number; seed: number; pkey: string } | null>(null);
  const landLon = useRef(0);
  /** 把某样式的整张图放上显卡(App 缓存里有就直接拿;没有就画一张,要等一会儿) */
  const upload = (sc: StudioScene, tag: number, id: MapLayer): boolean => {
    const key = `${tag}:${id}`;
    if (sc.gl.hasStyle(key)) return true;
    const c = p.baseCanvas(styleKey(id));
    if (!c || !c.width) return false;
    sc.gl.setStyle(key, c);
    return true;
  };

  /** 第一颗星球出来:开始自转(摊平着的等卷回来再转)、缩略图开始做 */
  const settle = () => {
    const sc = sceneRef.current;
    setProj('globe');
    if (!image && !p.base) setTip(true);
    if (sc) {
      sc.spin = true;
      sc.setFlatBack('globe');
    }
    p.requestThumbs(STYLE_IDS);
  };

  useEffect(() => {
    const sc = sceneRef.current;
    const d = p.data;
    if (!glOk || !sc || !d || !p.ready || gone.current) return;
    if (shown.current?.data === d) return;
    const prev = shown.current;
    const tag = ++tagRef.current;
    if (!upload(sc, tag, 'realistic')) return;
    if (style !== 'realistic') upload(sc, tag, style);
    const t = d.world.tect;
    const px = plateTexels(d.raster.cell, d.raster.w, d.raster.h, t.plate, d.world.water, t.plateContinental, PLATE_W, PLATE_H);
    const pkey = worldKey({ ...p.params, seed: 0 });
    shown.current = { data: d, tag, seed: p.params.seed, pkey };
    const latest = () => sc.gl.keepStyles((k) => k.startsWith(`${tagRef.current}:`));
    // 每换一颗都重算陆地最多的那一面(手机建好时转过去)
    landLon.current = landCenterLon(px, PLATE_W, PLATE_H);
    if (!prev) {
      sc.showStyle(`${tag}:${style}`);
      if (!sc.flatOn) {
        sc.showProj('globe');
        sc.lon = landLon.current;
      }
      settle();
      return;
    }
    // 换了一颗、改了地形慢慢淡入新样子;同一颗调了参数淡得快
    void sc.setStyle(`${tag}:${style}`, prev.seed === p.params.seed && prev.pkey !== pkey ? 450 : 1100).then(latest);
    p.requestThumbs(STYLE_IDS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glOk, p.data, p.ready]);

  // 换样式:淡过去
  useEffect(() => {
    const sc = sceneRef.current;
    const sh = shown.current;
    if (!sc || !sh || gone.current) return;
    if (!upload(sc, sh.tag, style)) return;
    void sc.setStyle(`${sh.tag}:${style}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style]);

  // 助手列出了要改的地方:星球转过去正对着它(新的一份才转);圈、编号停住时画,勾掉一条重画
  const faced = useRef(0);
  useEffect(() => {
    if (!astShown || !pending || faced.current === pending.id || !p.data) return;
    faced.current = pending.id;
    const c = marksCenter(marks, p.data.world);
    if (c) void sceneRef.current?.face(c[0], c[1]);
  }, [astShown, pending, marks, p.data]);
  useEffect(() => {
    if (stillRef.current) queueLabels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, astShown]);

  // 改地形(照手绘图的平时也是):摊成平面,换成平常的地图;改完从平常的地图现在的样子变回去
  useEffect(() => {
    if (tool.on) closeAssistant();
  }, [tool.on]);
  const flatAsked = useRef(false);
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc || gone.current) return;
    if (wantFlat) {
      flatAsked.current = true;
      setTip(false);
      setDrawer(null);
      void sc.enterFlat();
    } else if (flatAsked.current) {
      flatAsked.current = false;
      void sc.exitFlat(flatGeom());
      // 随机生成画了草图:卷回地球仪时提示一句"换一颗"会照同一张草图长
      if (!image && getEdits().sketch) setTip(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantFlat, glOk]);

  // ---- 照手绘图的三步 ----
  // 开始认一张图(进来时、「换一张」、把图拖到地图上):回到第 1 步,地图摊平
  useEffect(() => {
    if (!image || !importing) return;
    setStep(1);
    setImgFlat(true);
    setStyOpen(false);
    if (!getTerrainTool().on) setTerrainTool({ on: true });
  }, [importing, image]);
  // 第 2 步的笔收起了(按了 Esc、切到地球仪、打开助手):这一步也收起
  useEffect(() => {
    if (image && !tool.on && step === 2) setStep(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.on]);
  /** 点组头:开着的收起(第 1 步还没长出星球时收不起),收着的展开(后两步要先长出星球) */
  const toggleStep = (n: 1 | 2 | 3) => {
    setStyOpen(false);
    if (step === n) {
      if (n === 1) {
        if (!applied) return;
        cancelImport();
      }
      if (n !== 3) setTerrainTool({ on: false });
      setStep(null);
      return;
    }
    if (n === 1) {
      // 接着上次的认法认;那张图已经不在了(刷新过)就重新选一张
      if (!importOn() && !resumeImport()) return pickImage();
      setImgFlat(true);
      setTerrainTool({ on: true });
      setStep(1);
      return;
    }
    if (!applied) return;
    cancelImport();
    setSourceView({ show: 'grown' });
    if (n === 2) {
      setImgFlat(true);
      setTerrainTool({ on: true });
    } else setTerrainTool({ on: false });
    setStep(n);
  };
  /** 「照这样长出星球」 */
  const growPlanet = () => {
    if (!p.ready || !applyImport()) return;
    setSourceView({ show: 'grown' });
    setStep(2);
  };
  /** 切换条上的平面 / 地球仪 */
  const setImageFlat = (f: boolean) => {
    setStyOpen(false);
    if (f) return setImgFlat(true);
    if (importOn() || !applied) return;
    // 卷成地球仪:笔收起,看长出来的
    if (tool.on) setTerrainTool({ on: false });
    setSourceView({ show: 'grown' });
    setImgFlat(false);
  };

  const pickStyle = (id: MapLayer) => {
    setDrawer(null);
    if (id !== p.layer) p.onLayer(id);
  };
  const pickProj = (id: PlanetProjection) => {
    setDrawer(null);
    const sc = sceneRef.current;
    if (!sc || tool.on) return;
    setProj(id);
    setTip(false);
    if (id !== 'globe') sc.spin = false;
    void sc.setProj(id);
  };

  // ---- 创建 ----
  const commitName = () => {
    if (name !== p.title) p.onTitle(name);
  };
  const askCreate = () => {
    commitName();
    mixFlush.current?.();
    setDrawer(null);
    setStyOpen(false);
    setConfirm(true);
  };
  /** 「地名风格」页:手机上卡片拉到最高 */
  const openNames = () => {
    setDrawer(null);
    if (p.phone) setSheetFull(true);
    setNamesPage(true);
  };
  /** 「让助手改」:改地形工具开着就先收起(星球卷回来,圈画在星球上) */
  const askAssistant = () => {
    setDrawer(null);
    setStyOpen(false);
    setTip(false);
    setSheetFull(false);
    if (p.phone) setNamesPage(false);
    if (tool.on) setTerrainTool({ on: false });
    if (image) {
      setSourceView({ show: 'grown' });
      setImgFlat(false);
    }
    openAssistant();
  };
  const doCreate = async () => {
    setConfirm(false);
    const sc = glOk ? sceneRef.current : null;
    // 建好以后平常的地图用哪种投影:这里选的平面投影;选的是地球仪就回到进来之前的平面投影
    const target: MapProjection = proj === 'globe' ? prevFlat.current : proj;
    const g = flatGeom();
    const flatLon = g?.lon ?? 0;
    gone.current = true;
    setOut(1);
    setTip(false);
    setStyOpen(false);
    closeAssistant();
    cancelImport();
    if (tool.on) setTerrainTool({ on: false });
    setSourceView({ show: 'grown' });
    setStudioFlat(null);
    setFlatShown(false);
    // 摊平着建:从平面地图现在正中的经线接着展开
    if (sc?.flatOn && g) sc.lon = (g.lon * Math.PI) / 180;
    // 手机竖屏建好以后只看得到八十来个经度:展开的同时转到陆地最多的那一面(不然可能正对着一片海)
    let to = sc?.lon ?? 0;
    if (sc && p.phone && vh > vw) {
      const d = landLon.current - sc.lon;
      to = sc.lon + d - 2 * Math.PI * Math.round(d / (2 * Math.PI));
    }
    if (sc) await sc.leave(target, appPose(target, vw, vh), to);
    else await new Promise((r) => setTimeout(r, reduce ? 0 : 360));
    const lon = sc ? (((((to * 180) / Math.PI + 180) % 360) + 360) % 360) - 180 : flatLon;
    if (target !== getProjection()) setProjection(target);
    const ok = p.onCreate(name, lon);
    if (!ok) {
      // 没建成(还在生成):回到新建
      gone.current = false;
      setOut(0);
      if (getProjection() !== 'equirect') setProjection('equirect');
      if (sc) {
        void sc.setProj(proj);
        if (proj === 'globe') sc.spin = true;
      }
      if (image) setImgFlat(false);
      return;
    }
    created.current = true;
    setOut(2);
    p.onFade();
    setTimeout(p.onGone, reduce ? 0 : 420);
  };

  // 确认框:Esc = 再改改
  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirm(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm]);

  // ---- 左边的设定 ----
  const base = p.base;
  const carried = !!base && base.names + base.interventions > 0;
  const commitSeed = () => {
    const n = Math.floor(Number(seedText));
    if (n > 0 && n !== p.params.seed) p.onSeed(n);
    else setSeedText(String(p.params.seed));
  };
  const intro0 = base
    ? `设定都带过来了，改完存成一个新世界，${base.title}本身不变。`
    : image
      ? '海和陆地照你的图长，山、河、气候由程序补上。'
      : '按种子随机生成。先定下这颗星球的样子，创建以后再推演它三千年的历史。';
  const isDefault = SLIDERS.every((s) => p.params[s.key] === DEFAULT_PARAMS[s.key]);
  const canAsk = p.ready && !!p.civ && !!p.raw;
  const ico = p.phone ? 18 : 17;
  const peek = !image && p.phone && !sheetFull && !tool.on;

  const seedRow = base ? (
    <div className="sb-row nw-seed locked" data-act="seed-locked">
      <span className="sb-row-main">
        <b>种子</b>
        <small>换种子就是另一颗星球，请直接新建</small>
      </span>
      <span className="sb-row-side">{p.params.seed}</span>
      <Icon name="lock" size={15} className="nw-lock" />
    </div>
  ) : (
    <div className="sb-row nw-seed">
      <span className="sb-row-main">
        <b>种子</b>
        {seedBad && <small className="nw-seed-bad">只能填数字</small>}
      </span>
      <span className="nw-seed-ctl">
        <input
          className="nw-field nw-seed-input"
          aria-label="种子"
          value={seedText}
          inputMode="numeric"
          onChange={(e) => {
            const v = e.target.value;
            const d = v.replace(/\D/g, '');
            setSeedBad(d !== v);
            setSeedText(d.slice(0, 9));
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          onBlur={() => {
            setSeedBad(false);
            commitSeed();
          }}
        />
        <button
          className="nw-btn tint"
          data-act="new-seed"
          onClick={() => {
            setTip(false);
            p.onRandomSeed();
          }}
          title="随机换一个种子"
        >
          <Icon name="dice" size={16} />
          换一颗
        </button>
      </span>
    </div>
  );
  const paramsRow = (
    <>
      <button className={`sb-row nw-params${paramsOpen ? ' open' : ''}`} data-act="params" aria-expanded={paramsOpen} onClick={() => setParamsOpen((o) => !o)}>
        <Icon name="sliders" size={ico} className="sb-ico" />
        <span className="sb-row-main">
          <b>世界参数</b>
        </span>
        {paramsOpen ? (
          !isDefault && (
            <span
              className="sb-link"
              role="button"
              data-act="params-reset"
              onClick={(e) => {
                e.stopPropagation();
                p.onParams({ ...DEFAULT_PARAMS, seed: p.params.seed });
              }}
            >
              恢复默认
            </span>
          )
        ) : (
          <span className="sb-row-side">{paramsSide(p.params)}</span>
        )}
        <Icon name={paramsOpen ? 'down' : 'chevron'} size={14} className="sb-chev" />
      </button>
      {paramsOpen && (
        <div className="nw-sliders">
          {SLIDERS.map((s) => (
            <ParamSlider key={s.key} s={s} value={p.params[s.key]} onCommit={(v) => p.onParams({ ...p.params, [s.key]: v })} />
          ))}
        </div>
      )}
    </>
  );
  const terrainRow = (
    <button className="sb-row terrain-toggle" data-act="terrain" disabled={!p.ready} onClick={() => setTerrainTool({ on: true })} title="涂大陆、山和海，放火山、湖和河">
      <Icon name="sketch" size={ico} className="sb-ico" />
      <span className="sb-row-main">
        <b>编辑地形</b>
      </span>
      <span className="sb-row-side">{terrainSide(edits, '还没改')}</span>
      <Icon name="chevron" size={14} className="sb-chev" />
    </button>
  );
  const askRow = (
    <button className={`sb-row st-ask${astShown ? ' on' : ''}`} data-act="ask-assistant" disabled={!canAsk} onClick={askAssistant} title="说说想要什么样，助手替你放火山、拉山脉、挖湖">
      <Icon name="bubble" size={ico} className="sb-ico" />
      <span className="sb-row-main">
        <b>让助手改</b>
      </span>
      <span className="sb-row-side">说一句话就行</span>
      <Icon name="chevron" size={14} className="sb-chev" />
    </button>
  );
  const noCivHint = p.noCiv && <div className="nw-note warn">{image ? '这颗星球长不出文明，多画些陆地试试' : '这颗星球长不出文明，换一颗或调大陆地比例'}</div>;
  const baseRows = base && (
    <>
      <div className="sb-row static" data-act="base-names">
        <Icon name="rename" size={ico} className="sb-ico" />
        <span className="sb-row-main">
          <b>改过的名字</b>
        </span>
        <span className="sb-row-side">{base.names} 处</span>
      </div>
      <div className="sb-row static" data-act="base-interventions">
        <Icon name="intervene" size={ico} className="sb-ico" />
        <span className="sb-row-main">
          <b>干预历史</b>
        </span>
        <span className="sb-row-side">{base.interventions} 条</span>
      </div>
      <div className="nw-group-hint">地形改了以后，有的地方会变成海、历史也会不同；对不上的改名和干预先留着不生效，创建后会列出来。</div>
    </>
  );
  const carriedSec = carried && (
    <section className="sb-sec">
      <div className="sb-sec-head">
        <span>跟过去的修改</span>
      </div>
      <div className="sb-group">{baseRows}</div>
    </section>
  );
  const moreMenu = (
    <div className="nw-more-wrap">
      <PopMenu className="sb-pill sb-more" icon={<Icon name="more" size={17} />} title="更多" act="world-more" align="right">
        <AiSettingsItem onClick={() => openAiSettings()} />
        <MenuSep />
        <MenuItem icon={<Icon name="info" size={16} />} href={SOURCE_URL} act="source">
          源代码
        </MenuItem>
        <MenuItem href={PRIVACY_URL} act="privacy">
          隐私政策
        </MenuItem>
        <MenuItem href={TERMS_URL} act="terms">
          用户协议
        </MenuItem>
        <div className="pm-foot" data-version>
          版本 {APP_VERSION}
        </div>
      </PopMenu>
    </div>
  );
  const heading = base ? `以${base.title}为底稿新建` : image ? '照手绘图新建' : '新建世界';
  const backLink = p.back && (
    <button className="nw-back" data-act="back" onClick={p.back.onClick}>
      <Icon name="back" size={18} />
      {p.back.label}
    </button>
  );
  const nameField = (
    <input
      className="nw-field nw-name"
      data-act="world-name"
      value={name}
      maxLength={TITLE_MAX}
      placeholder="给这个世界起个名字"
      spellCheck={false}
      aria-label="世界名"
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      onBlur={commitName}
    />
  );
  const mixRow = (
    <button className="sb-row" data-act="name-mix" onClick={openNames}>
      <span className="sb-row-main">
        <b>地名风格</b>
      </span>
      <span className="sb-row-side">{mixSummary(edits.nameMix)}</span>
      <Icon name="chevron" size={14} className="sb-chev" />
    </button>
  );
  const createBtn = (
    <button className="nw-create" data-act="create-world" disabled={p.busy || !p.ready || out > 0 || importing || (image && !applied)} onClick={askCreate}>
      {base ? '创建新世界' : '创建世界'}
    </button>
  );
  const mixShown = namesPage && !tool.on && !peek;
  const mixPage = mixShown && <NameMixPage backLabel={heading} onBack={() => setNamesPage(false)} civ={p.raw} busy={p.busy} ready={p.ready} phone={p.phone} flush={mixFlush} />;

  // ---- 照手绘图:图片那一行和三步 ----
  const nameNow = name.trim();
  const strokes = terrainCount(edits);
  const done = (n: 1 | 2 | 3) => (n === 1 ? applied : (seen & (1 << n)) !== 0);
  const stepSummary = (n: 1 | 2 | 3): string => {
    if (n === 1) {
      if (step === 1) return imp && !p.phone ? importProgress(imp) : '';
      if (src) return importSummary(src);
      return edits.sketch?.image ? layerSummary(edits.sketch.image.cells) : '';
    }
    if (n === 2) return !applied ? '认好海陆以后' : strokes ? `画了 ${strokes} 笔` : '还没画';
    return step === 3 ? '' : nameNow || paramsBrief(p.params);
  };
  const stepGroup = (n: 1 | 2 | 3, title: string, body: React.ReactNode) => (
    <StepGroup key={n} n={n} title={title} summary={stepSummary(n)} open={step === n} done={done(n)} locked={n > 1 && !applied} onToggle={() => toggleStep(n)}>
      {body}
    </StepGroup>
  );
  const rerollRow = (
    <button className="sb-row" data-act="new-seed" disabled={!!base || !p.ready} onClick={p.onRandomSeed} title="海陆照图不变，山、河、地名换一种长法">
      <Icon name="dice" size={ico} className="sb-ico" />
      <span className="sb-row-main">
        <b>山河、地名换一种</b>
      </span>
      <span className="sb-row-side">海陆不变</span>
    </button>
  );
  const imageSteps = image && (
    <>
      <ImageCard phone={p.phone} />
      {stepGroup(
        1,
        '认出海陆',
        importing ? (
          <ImportPanel phone={p.phone} onUse={growPlanet} wait={!p.ready} />
        ) : (
          <div className="tp imp imp-step">
            <button className="imp-use" data-act="import-repick" onClick={pickImage}>
              选一张图
            </button>
          </div>
        ),
      )}
      {stepGroup(2, '用笔修改', <TerrainPanel disabled={p.busy} phone={p.phone} mode="image" extra={aiOn && askRow} />)}
      {stepGroup(
        3,
        '参数和名字',
        <>
          <StepParams params={p.params} onParams={p.onParams} disabled={p.busy} />
          {rerollRow}
          <div className="sk-name">{nameField}</div>
          {mixRow}
        </>,
      )}
      {noCivHint}
      {carriedSec}
    </>
  );

  const settings = tool.on ? (
    <TerrainPanel disabled={p.busy} phone={p.phone} />
  ) : (
    <>
      <section className="sb-sec">
        {!peek && (
          <div className="sb-sec-head">
            <span>星球</span>
          </div>
        )}
        <div className="sb-group">
          {seedRow}
          {!peek && paramsRow}
        </div>
        {!peek && noCivHint}
      </section>
      {!peek && (
        <section className="sb-sec">
          <div className="sb-sec-head">
            <span>地形</span>
            <small>可选</small>
          </div>
          <div className="sb-group">
            {terrainRow}
            {aiOn && askRow}
          </div>
        </section>
      )}
      {!peek && carriedSec}
      {!peek && (
        <section className="sb-sec">
          <div className="sb-sec-head">
            <span>名字</span>
          </div>
          {nameField}
          <div className="sb-group">{mixRow}</div>
        </section>
      )}
    </>
  );

  const grip = (
    <button
      className="st-grip"
      data-act="new-sheet"
      aria-label={sheetFull ? '收起' : '展开'}
      aria-expanded={sheetFull}
      onClick={() => {
        if (sheetFull) setNamesPage(false);
        setSheetFull(!sheetFull);
      }}
    >
      <i aria-hidden="true" />
    </button>
  );
  let left: React.ReactNode;
  if (p.phone && image) {
    left = (
      <section ref={sheetRef} className="st-sheet nw-sheet nw-card sk-sheet" aria-label={heading} onPointerDown={stop} onClick={stop} onWheel={stop}>
        {grip}
        {!mixShown && (
          <div className="sk-phd">
            {p.back && (
              <button className="sk-bk" data-act="back" aria-label={`返回${p.back.label}`} onClick={p.back.onClick}>
                <Icon name="back" size={20} />
              </button>
            )}
            <div className="nw-title">{heading}</div>
            {moreMenu}
          </div>
        )}
        <div className={`st-in nw-body${mixShown ? ' nm-page' : ' sk-in'}`}>{mixPage || imageSteps}</div>
        <footer className="st-foot">{createBtn}</footer>
      </section>
    );
  } else if (p.phone) {
    left = (
      <section ref={sheetRef} className={`st-sheet nw-sheet nw-card${peek ? ' peek' : ''}${tool.on ? ' tools' : ''}`} aria-label="新建世界" onPointerDown={stop} onClick={stop} onWheel={stop}>
        {grip}
        <div className={`st-in nw-body${mixShown ? ' nm-page' : ''}`}>
          {mixPage || (
            <>
              {!tool.on && backLink}
              {!tool.on && (
                <div className="nw-title-row">
                  <div className="nw-title">{heading}</div>
                  {moreMenu}
                </div>
              )}
              {!peek && !tool.on && <div className="nw-intro">{intro0}</div>}
              {settings}
            </>
          )}
        </div>
        {!tool.on && <footer className="st-foot">{createBtn}</footer>}
      </section>
    );
  } else {
    left = (
      <aside className="st-left nw-card" aria-label={heading} onPointerDown={stop} onDoubleClick={stop} onClick={stop}>
        <div className={`st-in nw-body${mixShown ? ' nm-page' : image ? ' sk-in' : ''}`}>
          {mixPage || (
            <>
              <div className="st-top">
                {backLink ?? <span />}
                <button className="sb-collapse" data-act="side-collapse" aria-label="收起侧栏" data-tip="收起侧栏" onClick={() => setCollapsed(true)}>
                  <Icon name="sidebar" size={19} />
                </button>
              </div>
              <div className="nw-title-row">
                <div className="nw-title">{heading}</div>
                {moreMenu}
              </div>
              {(image || !tool.on) && <div className="nw-intro">{intro0}</div>}
              {image ? imageSteps : settings}
            </>
          )}
        </div>
        <footer className="st-foot">{createBtn}</footer>
      </aside>
    );
  }

  const thumb = (id: MapLayer) => p.thumbs[id];
  const styleRows = STUDIO_STYLES.map((s) => (
    <button key={s.id} className="sb-row st-opt" role="radio" aria-checked={style === s.id} data-style={s.id} onClick={() => pickStyle(s.id)}>
      <span className="st-thumb" style={thumb(s.id) ? { backgroundImage: `url(${thumb(s.id)})` } : undefined} />
      <span className="sb-row-main">
        <b>{s.name}</b>
        <small>{s.hint}</small>
      </span>
    </button>
  ));
  const shownProj = tool.on || glOk === false ? 'equirect' : proj;
  const projRows = PROJS.map((x) => (
    <button
      key={x.id}
      className="sb-row st-opt"
      role="radio"
      aria-checked={shownProj === x.id}
      data-proj={x.id}
      disabled={tool.on || !glOk}
      onClick={() => pickProj(x.id)}
    >
      <span className="st-shape">
        <i style={{ width: x.icon[0], height: x.icon[1], borderRadius: x.icon[2] }} />
      </span>
      <span className="sb-row-main">
        <b>{x.name}</b>
        <small>{x.hint}</small>
      </span>
    </button>
  ));
  const curProj = PROJS.find((x) => x.id === shownProj) ?? PROJS[0];
  const right = !image && (
    <aside className="st-right" aria-label="样式和投影" onPointerDown={stop} onClick={stop} onWheel={stop}>
      {(!p.phone || drawer === 'style') && (
        <>
          <div className="sb-sec-head">
            <span>样式</span>
          </div>
          <div className="sb-group" role="radiogroup" aria-label="样式">
            {styleRows}
          </div>
        </>
      )}
      {(!p.phone || drawer === 'proj') && (
        <>
          <div className="sb-sec-head">
            <span>投影</span>
          </div>
          <div className="sb-group" role="radiogroup" aria-label="投影">
            {projRows}
          </div>
          {tool.on && <p className="st-note">编辑地形时用平面地图，编辑完回到原来的投影</p>}
          {glOk === false && <p className="st-note">这台设备画不了地球仪，先用平面地图</p>}
        </>
      )}
    </aside>
  );

  // 照手绘图:地图上方的切换条、电脑上地图下边的一句提示
  const flatNow = wantFlat || glOk === false;
  const viewBar = image && (
    <ViewBar
      phone={p.phone}
      importing={importing}
      grown={applied}
      flat={flatNow}
      onFlat={(f) => (glOk === false ? undefined : setImageFlat(f))}
      style={style}
      styles={STUDIO_STYLES}
      thumbs={p.thumbs}
      onStyle={pickStyle}
      styleOpen={styOpen}
      onStyleOpen={setStyOpen}
      left={p.phone ? undefined : box.x + box.w / 2}
    />
  );
  let capText: string | null = null;
  if (image && !p.phone && !out) {
    if (importing) capText = importCaption(imp);
    else if (step === 2 && tool.on) capText = terrainHint;
    else if (!flatNow) capText = '拖动转动这颗星球；点「平面」回去接着改';
    else if (sv.show === 'grown' && src) capText = '拖「叠上原图」对照长出来的和你画的';
  }
  const fr = flatRect(box, { phone: p.phone, bar: true });
  const imageCap = capText && (
    <div className="st-cap st-tip sk-cap" style={{ left: box.x + box.w / 2, top: fr.y + fr.h + CAP_GAP, bottom: 'auto' }}>
      {capText}
    </div>
  );

  const cls = [
    'studio',
    p.phone ? 'st-phone' : 'st-desk',
    image ? 'st-image' : '',
    collapsed && !p.phone ? 'collapsed' : '',
    flatShown ? 'flat' : '',
    out ? 'out' : '',
    out === 2 ? 'fade' : '',
    drawer ? `drawer-${drawer}` : '',
    sheetFull ? 'sheet-full' : '',
    astShown ? 'ast' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div ref={rootRef} className={cls} data-theme="dark" style={p.phone ? ({ '--sheet-h': `${sheetH}px` } as React.CSSProperties) : undefined}>
      <div ref={glowRef} className="st-glow" aria-hidden="true" />
      <canvas ref={glRef} className="st-gl" aria-label="这颗星球" />
      <canvas ref={labRef} className={`st-labels${labOn && !tool.on && !out && glOk ? ' on' : ''}`} aria-hidden="true" />
      <canvas ref={markRef} className={`st-labels st-marks${markOn && astShown && !tool.on && !out && glOk ? ' on' : ''}`} data-marks={markOn && astShown ? marks.length : 0} aria-hidden="true" />
      {(drawer || styOpen) && (
        <div
          className="st-dismiss"
          onPointerDown={() => {
            setDrawer(null);
            setStyOpen(false);
          }}
        />
      )}
      {left}
      {!p.phone && (
        <button className="side-open glass st-pill" data-act="side-expand" aria-label={`展开侧栏:${heading}`} onPointerDown={stop} onClick={() => setCollapsed(false)}>
          <Icon name="sidebar" size={19} />
          <span className="side-open-name">{heading}</span>
        </button>
      )}
      {p.phone && !image && (
        <div className="st-ph-btns" onPointerDown={stop} onClick={stop}>
          <button className={`st-ph-btn${drawer === 'style' ? ' on' : ''}`} data-act="studio-style" aria-label="样式" aria-expanded={drawer === 'style'} onClick={() => setDrawer((d) => (d === 'style' ? null : 'style'))}>
            <span className="st-thumb" style={thumb(style) ? { backgroundImage: `url(${thumb(style)})` } : undefined} />
          </button>
          <button className={`st-ph-btn${drawer === 'proj' ? ' on' : ''}`} data-act="studio-proj" aria-label="投影" aria-expanded={drawer === 'proj'} onClick={() => setDrawer((d) => (d === 'proj' ? null : 'proj'))}>
            <span className="st-shape">
              <i style={{ width: Math.round(curProj.icon[0] * 0.8), height: Math.round(curProj.icon[1] * 0.8), borderRadius: curProj.icon[2] }} />
            </span>
          </button>
          {aiOn && (
            <button
              className={`st-ph-btn${astShown ? ' on' : ''}`}
              data-act="assistant"
              aria-label="让助手改"
              aria-pressed={astShown}
              disabled={!canAsk}
              onClick={() => (astShown ? closeAssistant() : askAssistant())}
            >
              <Icon name="bubble" size={22} />
            </button>
          )}
        </div>
      )}
      {right}
      {viewBar}
      {astShown && <AssistantPanel phone={p.phone} world={p.data!.world} raster={p.data!.raster} civ={p.civ!} raw={p.raw!} lock="history" busy={p.worldBusy} />}
      {!image && (
        <div ref={tipRef} className={`st-cap st-tip${tip && !tool.on && !out && !(p.phone && (drawer || sheetFull)) ? '' : ' off'}`}>
          {edits.sketch ? '拖动看看这颗星球；「换一颗」会照同一张草图长出新的山河' : '拖动看看这颗星球；不满意就点「换一颗」'}
        </div>
      )}
      {imageCap}
      {tool.on && (!image || (p.phone && !importing)) && <TerrainCaption phone={p.phone} />}
      {confirm && (
        <div className="st-scrim" onPointerDown={stop} onClick={() => setConfirm(false)}>
          <div className="st-dlg" role="alertdialog" aria-modal="true" aria-labelledby="st-dlg-title" onClick={stop}>
            <div className="st-dlg-ico">
              <Icon name="lock" size={22} />
            </div>
            <h2 id="st-dlg-title">{nameNow ? `创建「${nameNow}」？` : '创建这个世界？'}</h2>
            <p>创建以后，这颗星球的样子就定下来了，下面四样不能再改：</p>
            <div className="sb-group">
              {image ? (
                <div className="sb-row static">
                  <Icon name="lock" size={16} className="sb-ico" />
                  <span className="sb-row-main">
                    <b>图片</b>
                  </span>
                  <span className="sb-row-side" data-confirm="image">
                    {edits.sketch?.image?.name}
                  </span>
                </div>
              ) : (
                <div className="sb-row static">
                  <Icon name="lock" size={16} className="sb-ico" />
                  <span className="sb-row-main">
                    <b>种子</b>
                  </span>
                  <span className="sb-row-side" data-confirm="seed">
                    {p.params.seed}
                  </span>
                </div>
              )}
              <div className="sb-row static">
                <Icon name="lock" size={16} className="sb-ico" />
                <span className="sb-row-main">
                  <b>世界参数</b>
                </span>
                <span className="sb-row-side">{paramsSide(p.params)}</span>
              </div>
              <div className="sb-row static">
                <Icon name="lock" size={16} className="sb-ico" />
                <span className="sb-row-main">
                  <b>地形</b>
                </span>
                <span className="sb-row-side" data-confirm="terrain">
                  {terrainSide(edits, '没改过')}
                </span>
              </div>
              <div className="sb-row static">
                <Icon name="lock" size={16} className="sb-ico" />
                <span className="sb-row-main">
                  <b>地名风格</b>
                </span>
                <span className="sb-row-side" data-confirm="name-mix">
                  {mixSummary(edits.nameMix)}
                </span>
              </div>
            </div>
            <p className="st-dlg-note">世界名、历史和一个个国名地名，创建以后随时能改。</p>
            <div className="st-dlg-btns">
              <button className="st-b2" data-act="confirm-back" onClick={() => setConfirm(false)}>
                再改改
              </button>
              <button className="st-b1" data-act="confirm-create" autoFocus onClick={() => void doCreate()}>
                确认创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
