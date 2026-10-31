/**
 * 地图飞到某处(App 用;飞到哪、怎么飞的计算见 ../flyTo.ts):
 *   - 选中 → 地图飞过去(flyRef.current('sel'));缩回整张图('home')、飞到民族人最多的州('culture')
 *   - 导播请地图飞到一段事上
 *   - 分享链接的"这一刻":取下现在的镜头(cameraNow)、飞到分享的人那时的镜头(flyCamera)
 *   - 照故事找世界:飞过去看全几个点(flyToPoints)
 *   - 编年史点一条:事发地不在视野里,就把地图平移过去(不改缩放)
 * 视图状态还在 App 里(缩放 / 平移那一段),要读、要改的 ref 和 setter 由 App 传进来(MapFlyDeps)。
 * 这里的函数每次渲染新建(和原来写在 App 里一样),effect 和定时回调经 xxxRef.current 调到最新的那一份。
 */
import { useEffect, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import type { World } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import type { Civ } from '../../gen/civ/types';
import { lifeStops } from '../../gen/characters';
import { cleanCamera, type SaveCamera } from '../../gen/savefile';
import { nearX, wrapOf } from '../../render/common';
import { projectWorldNear, unprojectWorld, wrapLon, type MapProj } from '../../render/projection';
import { highlightBox, highlightMarks } from '../../render/civ/highlight';
import { getMapCenter, lonOfX, publishMapCenter, stageToWorld, worldToStage, xOfLon, type MapView, type StageBox } from '../mapWrap';
import { curvedProj, getProjection, setMapMoving } from '../projection';
import { FLY_MS, animProgress, cultureFocus, curvedFly, easeOutCubic, flatFly, freeArea, markFocus, phoneFree, pointsFocus, selectionFocus, sideRoom, type FlyGoal, type Focus } from '../flyTo';
import { getCivTime, getSelection, useCivHighlight } from '../civView';
import { useDirectorFly } from '../directorStore';
import { getEdits } from '../editsStore';
import { getMarkUi } from '../markStore';
import { draftAsCharacter, getCharUi } from '../characterStore';
import { placeOf } from '../characterInfo';
import { getFinder } from '../finderStore';
import { getStage } from '../stageStore';
import { astRoom } from '../astPanel';
import { NARROW_MAX } from '../device';
import { getGlobeOn, type GlobeApi } from '../Globe';
import { getTerrainTool } from '../TerrainTools';
import type { WorldToClient } from '../EventPins';
import type { MapGeo } from './types';

type Ref<T> = MutableRefObject<T>;

/** App 传进来的:飞的时候要读、要改的视图状态 */
export interface MapFlyDeps {
  data: { world: World; raster: Raster } | null;
  dataRef: Ref<{ world: World; raster: Raster } | null>;
  civ: Civ | null;
  /** 地图框(缩放 1 倍时)的大小 */
  box: { w: number; h: number };
  replayOn: boolean;
  narrow: boolean;
  /** 详情面板开着(手机上底部卡片是半高的) */
  panelOpen: boolean;
  stageRef: RefObject<HTMLDivElement>;
  globeApi: Ref<GlobeApi | null>;
  worldToClient: Ref<WorldToClient | null>;
  mpRef: Ref<MapProj | null>;
  viewRef: Ref<MapView>;
  geo: Ref<MapGeo>;
  clampRef: Ref<(v: MapView, w: number, h: number) => MapView>;
  setView: Dispatch<SetStateAction<MapView>>;
  /** 正在飞的那一帧(0 = 没在飞) */
  flyRaf: Ref<number>;
  stopFly: () => void;
}

export function useMapFly({ data, dataRef, civ, box, replayOn, narrow, panelOpen, stageRef, globeApi, worldToClient, mpRef, viewRef, geo, clampRef, setView, flyRaf, stopFly }: MapFlyDeps) {
  const hl = useCivHighlight();
  const hlStamp = hl?.stamp;
  // ---- 编年史点一条:事发地不在视野里,就把地图平移过去(不改缩放,约 0.4 秒滑过去) ----
  /**
   * 编年史跳转时"看得见的地方"的上、下和目标放在哪个高度(舞台坐标):上面留出世界名、提示条,下面留出时间轴;
   * 窄屏:让出底部的卡片和时间轴胶囊(详情卡片开着时是它上方那一截)
   */
  const jumpBand = (H: number): [number, number, number] => {
    if (!narrow) return [80, H - 110, (H - 16) / 2];
    const [t, b] = phoneFree(H, panelOpen);
    return [t + 8, b - 16, (t + b) / 2];
  };
  /**
   * 弯边投影里的编年史跳转:事发地横向不在视野里就转中央经线过去(走短边),纵向不在就上下平移;约 0.4 秒转过去。
   * b = 事发地的外接框(世界坐标)
   */
  const curvedJump = (b: [number, number, number, number], m: MapProj, W: number, H: number) => {
    const g = geo.current;
    const v0 = viewRef.current;
    const sbx = { sw: W, sh: H, bw: box.w, bh: box.h };
    const bx = (b[0] + b[2]) / 2;
    const by = (b[1] + b[3]) / 2;
    const corners: [number, number][] = [
      [b[0], b[1]],
      [b[2], b[1]],
      [b[0], b[3]],
      [b[2], b[3]],
      [bx, by],
      [bx, b[1]],
      [bx, b[3]],
    ];
    const pts = corners.map(([x, y]) => {
      const [mx, my] = projectWorldNear(m, x, y, bx);
      return worldToStage(mx, my, v0, sbx, g.W, g.H);
    });
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [bandT, bandB, midY] = jumpBand(H);
    // 宽屏左边被侧栏卡片、右边被助手面板挡住的那一截不算看得见;转过去以后事发地落在两边中间那一块的正中(按赤道上每度多少像素估)
    const L = sideRoom(W);
    const R = astRoom(W);
    const inX = Math.min(...xs) >= L + 30 && Math.max(...xs) <= W - R - 30;
    const inY = Math.min(...ys) >= bandT && Math.max(...ys) <= bandB;
    if (inX && inY) return;
    const pxPerDeg = v0.k * (box.w / m.W) * m.s * m.def.kx(0) * (Math.PI / 180);
    const dLon = inX ? 0 : wrapLon(lonOfX(bx, g.W) - m.lon0 - (pxPerDeg > 0 ? (L - R) / 2 / pxPerDeg : 0));
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const toY = inY ? v0.y : Math.min(0, Math.max(H - H * v0.k, v0.y + midY - cy));
    if (Math.abs(dLon) < 0.5 && Math.abs(toY - v0.y) < 1) return;
    (window as unknown as { __wfPan: unknown }).__wfPan = { dLon, dy: toY - v0.y, stamp: hlStamp };
    const lon0 = m.lon0;
    const t0 = performance.now();
    let raf = 0;
    setMapMoving(true);
    const step = (now: number) => {
      const t = animProgress(now, t0, 400);
      const e = 1 - (1 - t) ** 3;
      if (dLon) publishMapCenter(wrapLon(lon0 + dLon * e));
      setView(clampRef.current({ k: v0.k, x: v0.x, y: v0.y + (toY - v0.y) * e }, W, H));
      if (t < 1) raf = requestAnimationFrame(step);
      else setMapMoving(false);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      setMapMoving(false);
    };
  };
  useEffect(() => {
    const el = stageRef.current;
    if (!hl || !data || !civ || !el || civ.regions.of.length !== data.world.mesh.n || getGlobeOn()) return;
    // 照故事找世界标两国:地图自己飞过去看全两国(不在这里另平移,两边同时挪会打架)
    if (getFinder().open && getStage().stage === 'draft') return;
    let b = highlightBox(data.world, civ, highlightMarks(civ, hl));
    if (!b) return;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const v0 = viewRef.current;
    const ww = wrapOf(data.world);
    const m = mpRef.current;
    if (m && box.w) return curvedJump(b, m, W, H);
    // 宽屏左边被侧栏卡片、右边被助手面板挡住的那一截不算看得见,平移到两边中间那一块的正中
    const L = sideRoom(W);
    const R = astRoom(W);
    if (box.w) {
      // 事发地取离看得见那一块的中心最近的那一份 —— 平移走短边(不会绕地球大半圈)
      // 那一块的中心(展开的世界坐标,和 sx 同一套:主图那一份左边起算)
      const c = stageToWorld((L + W - R) / 2, 0, v0, { sw: W, sh: H, bw: box.w, bh: box.h }, ww, 1)[0];
      const bc = (b[0] + b[2]) / 2;
      const sh = nearX(bc, c, ww) - bc;
      b = [b[0] + sh, b[1], b[2] + sh, b[3]];
    }
    // 世界坐标 → 舞台上的屏幕坐标(地图框在舞台里居中,再整体平移 x/y、放大 k)
    const sx = (wx: number) => v0.x + ((W - box.w) / 2 + (wx / data.world.width) * box.w) * v0.k;
    const sy = (wy: number) => v0.y + ((H - box.h) / 2 + (wy / data.world.height) * box.h) * v0.k;
    const x0 = sx(b[0]);
    const x1 = sx(b[2]);
    const y0 = sy(b[1]);
    const y1 = sy(b[3]);
    // 上面留出提示条,下面留出时间轴(窄屏:底部卡片和时间轴胶囊上方)
    const [bandT, bandB, midY] = jumpBand(H);
    if (x0 >= L + 30 && x1 <= W - R - 30 && y0 >= bandT && y1 <= bandB) return;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    // 左右不夹(每一帧再挪整数圈,画面是连着的);上下夹在两极以内
    const to = { k: v0.k, x: v0.x + (L + W - R) / 2 - cx, y: Math.min(0, Math.max(H - H * v0.k, v0.y + midY - cy)) };
    // 事发地差不多在背面时,让开侧栏那一点会让平移超过半圈:东西相连,改走另一边(差一整圈)
    if (box.w) {
      const turn = v0.k * box.w;
      if (to.x - v0.x > turn / 2) to.x -= turn;
      else if (to.x - v0.x < -turn / 2) to.x += turn;
    }
    if (Math.abs(to.x - v0.x) < 1 && Math.abs(to.y - v0.y) < 1) return;
    (window as unknown as { __wfPan: unknown }).__wfPan = { dx: to.x - v0.x, dy: to.y - v0.y, stamp: hlStamp };
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = animProgress(now, t0, 400);
      const e = 1 - (1 - t) ** 3;
      const v = { k: v0.k, x: v0.x + (to.x - v0.x) * e, y: v0.y + (to.y - v0.y) * e };
      setView(clampRef.current(v, W, H));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // 只在点了新的一条时平移
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hlStamp]);

  // ---- 选中 → 暂停 + 地图飞过去(国家面板):不管选中来自点地图、面板里的链接、概览还是搜索 ----
  // 国家:平移缩放到能看全当年的疆域,右边让出面板;城 / 州 / 地理实体:平移过去,缩放不变或适度放大;0.6 秒,ease-out 三次方。
  // 地球仪用它自己的 flyTo。选目标时 / 下了令之后缩回整张图('home')
  const flyNow = (to: 'sel' | 'home' | 'culture') => {
    stopFly();
    const el = stageRef.current;
    if (!data || !el || !box.w || replayOn || getTerrainTool().on) return;
    const sel = getSelection().sel;
    const year = civ ? Math.min(civ.endYear, Math.max(0, getCivTime().year ?? civ.endYear)) : 0;
    // 民族:飞到它这一年人最多的州(侧栏、世界概览、搜索里点民族;点地图、卡片里的族名不飞),和点州一样只平移
    const focus =
      to === 'culture'
        ? sel?.kind === 'culture' && civ
          ? cultureFocus(data.world, civ, sel.id, year)
          : null
        : to === 'sel' && sel && civ
          ? sel.kind === 'mark'
            ? selectedMarkFocus(civ, sel.id)
            : sel.kind === 'character'
              ? selectedCharacterFocus(civ, sel.id)
              : selectionFocus(data.world, civ, sel, year)
          : null;
    if (to !== 'home' && (!focus || !sel)) return;
    // 人物按他的国家飞(看全疆域)
    const goal: FlyGoal = { focus, kind: to === 'culture' ? 'region' : to === 'sel' && sel ? (sel.kind === 'person' ? 'polity' : sel.kind) : 'home' };
    if (getGlobeOn()) {
      // 作者标记:已经在球的正面、看得见的地方就不转
      if (focus && sel?.kind === 'mark') {
        const p = globeApi.current?.worldToClient(focus.x, focus.y);
        const r = el.getBoundingClientRect();
        if (p && p[0] > r.left + sideRoom(r.width) + 60 && p[0] < r.right - 60 && p[1] > r.top + 80 && p[1] < r.bottom - 110) return;
      }
      if (focus) globeApi.current?.flyTo(focus.lon, focus.lat);
      return;
    }
    const b: StageBox = { sw: el.clientWidth, sh: el.clientHeight, bw: box.w, bh: box.h, padB: geo.current.padB };
    const W = data.world.width;
    const H = data.world.height;
    const m = mpRef.current;
    const flat = m ? null : flatFly(viewRef.current, b, W, H, goal);
    const step = m ? curvedFly(viewRef.current, b, m, (lon) => curvedProj(getProjection(), lon, W, H) ?? m, goal) : flat && ((e: number) => ({ v: flat(e), lon: null }));
    if (!step) return;
    runFly(step, !!m);
  };
  /** 一帧帧飞过去(FLY_MS,ease-out 三次方);用户自己拖动 / 缩放时 stopFly 让给用户(按下地图、滚轮、右下的 + −) */
  const runFly = (step: (e: number) => { v: MapView; lon: number | null }, curvedNow: boolean) => {
    let t0 = -1;
    const frame = (now: number) => {
      // 第一帧地图不动:点选时刚打开的面板先画到屏幕上(反馈不等地图重画),下一帧起飞,时长不变
      if (t0 < 0) {
        t0 = now;
        flyRaf.current = requestAnimationFrame(frame);
        return;
      }
      if (curvedNow) setMapMoving(true);
      const t = animProgress(now, t0, FLY_MS);
      const r = step(easeOutCubic(t));
      if (r.lon !== null) publishMapCenter(wrapLon(r.lon));
      viewRef.current = r.v;
      setView(r.v);
      if (t < 1) flyRaf.current = requestAnimationFrame(frame);
      else stopFly();
    };
    flyRaf.current = requestAnimationFrame(frame);
  };
  /**
   * 导播请地图飞到一段事上(Director.tsx):看全事发地周围几个州,放在字幕条上面那块地方的正中;
   * 事发地已经在那块的中间一半里、缩放也差不多(不到 1.4 倍)就不动。地球仪转过去
   */
  const flyDirector = (focus: Focus) => {
    const el = stageRef.current;
    if (!data || !el || !box.w || replayOn || getTerrainTool().on) return;
    const r = el.getBoundingClientRect();
    const b: StageBox = { sw: el.clientWidth, sh: el.clientHeight, bw: box.w, bh: box.h, padB: geo.current.padB };
    // 看得见的地方:宽屏让开侧栏、助手、顶上的按钮;手机让开收起的世界卡片;都让开时间轴和它上面的字幕条
    const phoneNow = b.sw <= NARROW_MAX;
    const [l, t, rr, bb] = freeArea(b, !phoneNow);
    const row = document.querySelector('.app .bottom-row')?.getBoundingClientRect();
    // 逐年推演停一下:让开"这一段的大事"卡片(宽屏在时间轴上面,手机是底部卡片)
    const card = document.querySelector('.app .sw-review, .app .sw-sheet')?.getBoundingClientRect();
    const capTop = card && card.height ? card.top - r.top - 12 : row && row.height ? row.top - r.top - (phoneNow ? 115 : 100) : bb;
    const area: [number, number, number, number] = [l, t, rr, Math.max(t + 80, Math.min(bb, capTop))];
    const near = (p: [number, number] | null | undefined) => {
      if (!p) return false;
      const x = p[0] - r.left;
      const y = p[1] - r.top;
      const qw = (area[2] - area[0]) / 4;
      const qh = (area[3] - area[1]) / 4;
      return x > area[0] + qw && x < area[2] - qw && y > area[1] + qh && y < area[3] - qh;
    };
    if (getGlobeOn()) {
      if (!near(globeApi.current?.worldToClient(focus.x, focus.y))) globeApi.current?.flyTo(focus.lon, focus.lat);
      return;
    }
    stopFly();
    const goal: FlyGoal = { focus, kind: 'polity' };
    const W = data.world.width;
    const H = data.world.height;
    const m = mpRef.current;
    const flat = m ? null : flatFly(viewRef.current, b, W, H, goal, area);
    const step = m ? curvedFly(viewRef.current, b, m, (lon) => curvedProj(getProjection(), lon, W, H) ?? m, goal, area) : flat && ((e: number) => ({ v: flat(e), lon: null }));
    if (!step) return;
    const k = step(1).v.k / viewRef.current.k;
    if (k < 1.4 && k > 1 / 1.4 && near(worldToClient.current?.(focus.x, focus.y))) return;
    runFly(step, !!m);
  };
  const flyDirectorRef = useRef(flyDirector);
  flyDirectorRef.current = flyDirector;
  const directorFly = useDirectorFly();
  useEffect(() => {
    if (directorFly) flyDirectorRef.current(directorFly.focus);
  }, [directorFly]);
  /** 选中的作者标记(正在填的那一份优先:新建的还没存)在地图上的位置 */
  const selectedMarkFocus = (civ: Civ, id: number) => {
    if (!data) return null;
    const d = getMarkUi().draft;
    if (d && d.id === id) return markFocus(data.world, civ, d.scope === 'point' ? { at: d.at ?? undefined } : { regions: d.regions });
    const m = getEdits().marks?.find((x) => x.id === id);
    return m ? markFocus(data.world, civ, m) : null;
  };
  /** 选中的作者人物(正在填的那一份优先)一生去过的地方的范围 */
  const selectedCharacterFocus = (civ: Civ, id: number) => {
    if (!data) return null;
    const d = getCharUi().draft;
    const year = Math.min(civ.endYear, Math.max(0, getCivTime().year ?? civ.endYear));
    const c = d && d.id === id ? draftAsCharacter(d, year) : getEdits().characters?.find((x) => x.id === id);
    if (!c) return null;
    const pts = lifeStops(c)
      .map((s) => placeOf(civ, data.world, data.raster, s.where, s.year).at)
      .filter((p): p is [number, number] => !!p);
    return pointsFocus(data.world, pts);
  };
  const flyRef = useRef(flyNow);
  flyRef.current = flyNow;
  useEffect(() => () => stopFly(), []);

  // ---- 分享链接的"这一刻"(shareMoment.tsx、gen/savefile.ts 的 SaveMoment):复制时取下现在的,打开时照它停好 ----
  /**
   * 现在的镜头:看得见的那一块(宽屏让开侧栏;手机让开底部卡片和胶囊,见 flyTo.ts 的 freeArea)正中的经纬度,
   * 放大倍数按宽度算(整圈经线正好占满画面的宽 = 1;电脑发给手机,横着看到的差不多一样宽)。地球仪:球心的经纬度、它自己的倍数
   */
  const cameraNow = (): SaveCamera | null => {
    if (getGlobeOn()) {
      const c = globeApi.current?.camera();
      return c ? cleanCamera({ lon: c.lon, lat: c.lat, zoom: c.k }) : null;
    }
    const el = stageRef.current;
    const g = geo.current;
    if (!el || !g.bw || !dataRef.current) return null;
    const b: StageBox = { sw: el.clientWidth, sh: el.clientHeight, bw: g.bw, bh: g.bh, padB: g.padB };
    const [l, t, r, btm] = freeArea(b, panelOpenRef.current);
    const v = viewRef.current;
    let [x, y] = stageToWorld((l + r) / 2, (t + btm) / 2, v, b, g.W, g.H);
    const m = mpRef.current;
    if (m) {
      const u = unprojectWorld(m, x, y);
      [x, y] = u ?? [xOfLon(getMapCenter(), g.W), g.H / 2];
    }
    return cleanCamera({ lon: lonOfX(x, g.W), lat: 90 - (y / g.H) * 180, zoom: (v.k * g.bw) / b.sw });
  };
  /** 镜头飞到分享的人那时的样子(倍数换算成这块屏幕的,夹在能放的范围里);地球仪还没出来就等它出来 */
  const flyCamera = (cam: SaveCamera, tries = 0) => {
    stopFly();
    const el = stageRef.current;
    if (!data || !el || !box.w || replayOn) return;
    if (getGlobeOn()) {
      const api = globeApi.current;
      if (api?.viewSig()) return api.flyTo(cam.lon, cam.lat, cam.zoom);
      if (tries < 120) requestAnimationFrame(() => flyCameraRef.current(cam, tries + 1));
      return;
    }
    const b: StageBox = { sw: el.clientWidth, sh: el.clientHeight, bw: box.w, bh: box.h, padB: geo.current.padB };
    const W = data.world.width;
    const H = data.world.height;
    const x = xOfLon(cam.lon, W);
    const y = ((90 - cam.lat) / 180) * H;
    const goal: FlyGoal = { focus: { box: null, x, y, lon: cam.lon, lat: cam.lat }, kind: 'polity', zoom: Math.min(12, Math.max(1, (cam.zoom * b.sw) / b.bw)) };
    const area = freeArea(b, panelOpenRef.current);
    const m = mpRef.current;
    const flat = m ? null : flatFly(viewRef.current, b, W, H, goal, area);
    const step = m ? curvedFly(viewRef.current, b, m, (lon) => curvedProj(getProjection(), lon, W, H) ?? m, goal, area) : flat && ((e: number) => ({ v: flat(e), lon: null }));
    if (step) runFly(step, !!m);
  };
  const flyCameraRef = useRef(flyCamera);
  flyCameraRef.current = flyCamera;
  /**
   * 照故事找世界:地图飞过去看全这几个点(故事里两国的州、隘口、交界)。where = 'finder' 让开找世界的卡片(电脑左边、手机底部卡片),
   * 'world' 照平常的侧栏让;zoom = 只飞到一个点时放大几倍
   */
  const flyToPoints = (pts: readonly (readonly [number, number])[], where: 'finder' | 'world', zoom?: number) => {
    stopFly();
    const el = stageRef.current;
    if (!data || !el || !box.w || replayOn) return;
    const focus = pointsFocus(data.world, pts);
    if (!focus) return;
    if (getGlobeOn()) return globeApi.current?.flyTo(focus.lon, focus.lat);
    const b: StageBox = { sw: el.clientWidth, sh: el.clientHeight, bw: box.w, bh: box.h, padB: geo.current.padB };
    const W = data.world.width;
    const H = data.world.height;
    const phoneNow = b.sw <= NARROW_MAX;
    const area: [number, number, number, number] =
      where === 'world' ? freeArea(b, false) : phoneNow ? [12, 56, b.sw - 12, Math.round(b.sh * 0.5) - 10] : [448, 64, b.sw - 24, b.sh - 24];
    const goal: FlyGoal = { focus, kind: 'polity', ...(zoom ? { zoom } : {}) };
    const m = mpRef.current;
    const flat = m ? null : flatFly(viewRef.current, b, W, H, goal, area);
    const step = m ? curvedFly(viewRef.current, b, m, (lon) => curvedProj(getProjection(), lon, W, H) ?? m, goal, area) : flat && ((e: number) => ({ v: flat(e), lon: null }));
    if (step) runFly(step, !!m);
  };
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;
  return { flyRef, flyCamera, flyCameraRef, flyToPoints, cameraNow };
}
