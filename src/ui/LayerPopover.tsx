/**
 * 图层面板:宽屏是右上按钮条最后的「底图」按钮(小图 + 底图名),手机是右上竖排的图层图标;点开:
 *   底图   四张缩略图(手绘、卫星、地理图、白模);选卫星时下面一行「卫星画法 经典 | 细节」;一行说明
 *   数据底图  生态、高程、板块、气温 / 降水、气候、洋流(选了它,上面四张都不亮)
 *   填色   不填 / 国家 / 民族 / 信仰 / 时代(按钮条前几段也是它);一行说明;民族、信仰下面是色块列表。任何底图都能配任何填色
 *   叠加   地名、州、城址、道路、战事、宜居度、物产(CivPanel.tsx 的 CivToggles);经纬网(间隔 10° / 15° / 30°);
 *          等值线(等高线 / 等温线 / 等降水线选一种,画在 ContourLayer.tsx)
 *   投影   一行,点开是投影列表和中央经线(ProjectionPanel.tsx 的 ProjectionSection)
 * 点底图、填色都不收起(看着换);点外面(包括旁边的按钮)、Esc 收起。窄屏(手机):弹层是从底部升起的抽屉。
 * 换到还没画过的底图:那张缩略图上转小圈,地图先留着原来的,画好一下子换过去(App 的 pickBase)。
 *
 * 缩略图是当前世界真实画出来的小图:App 给 baseCanvas(画风键)取整张底图(画过的直接从缓存拿,没画过的画一张放进缓存),
 * 政区 / 民族 / 信仰(新建界面用)再叠上文明底图,缩成小图存成 dataURL。当前底图的一张在世界出来后就做;其余的等弹层第一次打开时
 * 一张一张做(每张之间让出主线程),没做好的先显示占位。缓存里还没有的整张底图先分小步画好(ui/thumbPrep.ts,每段十毫秒左右
 * 就让出主线程;编辑地形后写实、手绘只重画变了的那块),不一口气占住主线程几百毫秒。
 * 换世界全部作废;历史重推(干预、改地形)只作废政区、民族、信仰三张。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { World } from '../gen/world';
import type { Raster } from '../gen/raster';
import type { Civ } from '../gen/civ/types';
import { CIV_SHOW_OFF, drawCivOverlay } from '../render/civ/overlay';
import {
  DATA_BASES,
  FILLS,
  MAIN_BASES,
  baseHint,
  baseName,
  baseThumb,
  layerDef,
  type BaseId,
  type FillId,
  type MapLayer,
  type SatLook,
  type ThumbId,
} from './mapLayers';
import { Icon } from './icons';
import { GraticuleSteps, ProjectionSection, projectionName } from './ProjectionPanel';
import { setContourKind, setGraticule, useContourKind, useGraticule, useProjection } from './projection';
import type { ContourKind } from '../gen/savefile';
import { getCivTime } from './civView';
import { CivToggles, CultureLegend, FaithLegend } from './CivPanel';
import './overview.css';
import { noteDismiss } from './dismissClick';
import { terrainPatchPending } from './terrainPatch';
import { baseReady, dropThumbPrep } from './thumbPrep';

/** 缩略图大小(显示时 88×44 左右,按两倍像素做) */
const TW = 192;
const TH = 96;

/** 调试字段(检查脚本量缩略图多久换好用):data = 最近在做 / 做完的是哪个世界的,busy = 还有没做完的 */
function noteThumbs(data: unknown, busy: boolean): void {
  (window as unknown as { __wfThumbs: unknown }).__wfThumbs = { data, busy };
}

/** 画风键:手绘 / 写实 / data:某数据图层(和 App 的底图缓存同一套键) */
export function styleKey(id: MapLayer): string {
  const d = layerDef(id);
  return d.style === 'data' ? `data:${d.data}` : d.style;
}

/** 缩略图在底图缓存里的键(写实的几种画法是 realistic:画法) */
function thumbKey(id: ThumbId): string {
  return id.startsWith('realistic:') ? id : styleKey(id as MapLayer);
}

export interface ThumbSource {
  data: { world: World; raster: Raster } | null;
  /** 生成出来的文明(不含改名:缩略图只画色块);有地形大事时是时间轴那一段的(州、宜居度和 data 的地形对得上) */
  civ: Civ | null;
  /** 取某画风的整张底图(等距圆柱,和 raster 一样大);取不到 = null */
  baseCanvas: (key: string) => HTMLCanvasElement | null;
}

/** 缩略图:当前底图的先做,其余的按需排队做 */
export function useLayerThumbs(src: ThumbSource, current: ThumbId) {
  const [thumbs, setThumbs] = useState<Partial<Record<ThumbId, string>>>({});
  const srcRef = useRef(src);
  srcRef.current = src;
  const queue = useRef<ThumbId[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const have = useRef<Partial<Record<ThumbId, string>>>({});
  have.current = thumbs;

  const make = (id: ThumbId): string | null => {
    const { data, civ, baseCanvas } = srcRef.current;
    if (!data) return null;
    const def = id.startsWith('realistic:') ? layerDef('realistic') : layerDef(id as MapLayer);
    const base = baseCanvas(thumbKey(id));
    if (!base || !base.width) return null;
    const t = document.createElement('canvas');
    t.width = TW;
    t.height = TH;
    const ctx = t.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(base, 0, 0, TW, TH);
    const civOk = !!civ && civ.viable && civ.habitat.suitability.length === data.world.mesh.n;
    if ((def.polities || def.cultures || def.faiths) && civOk) {
      const { raster, world } = data;
      const cv = document.createElement('canvas');
      cv.width = raster.w;
      cv.height = raster.h;
      const cctx = cv.getContext('2d');
      if (cctx) {
        const y = Math.min(civ!.endYear, Math.max(0, getCivTime().year ?? civ!.endYear));
        drawCivOverlay(cctx, { world, raster, civ: civ!, style: def.style, year: y, show: { ...CIV_SHOW_OFF, polities: def.polities, cultures: def.cultures, faiths: def.faiths } });
        ctx.drawImage(cv, 0, 0, TW, TH);
      }
      cv.width = cv.height = 0;
    }
    const url = t.toDataURL('image/jpeg', 0.82);
    t.width = t.height = 0;
    return url;
  };

  const pump = useCallback(() => {
    if (timer.current !== undefined) return;
    const step = () => {
      timer.current = undefined;
      // 编辑地形后新地图正在后台分小步备着(ui/terrainPatch.ts):先让地图换上再做
      if (terrainPatchPending()) {
        timer.current = setTimeout(step, 100);
        return;
      }
      const data = srcRef.current.data;
      const id = queue.current[0];
      if (!id) return noteThumbs(data, false);
      noteThumbs(data, true);
      if (data && !have.current[id]) {
        // 整张底图缓存里还没有:先在后台分小步备好(ui/thumbPrep.ts),备好了再来;换了世界就不等了(队列也重新排过)
        const ready = baseReady(thumbKey(id), data.world, data.raster, { alive: () => srcRef.current.data === data, done: pump });
        if (!ready) return;
        const url = make(id);
        if (url) {
          have.current = { ...have.current, [id]: url };
          setThumbs(have.current);
        }
        dropThumbPrep();
      }
      if (queue.current[0] === id) queue.current.shift();
      if (queue.current.length) timer.current = setTimeout(step, 30);
      else noteThumbs(data, false);
    };
    timer.current = setTimeout(step, 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 缓存是哪个世界的。换了世界:排着的、做好的全部作废 */
  const haveFor = useRef(src.data);
  const reset = useCallback(() => {
    queue.current = [];
    have.current = {};
    haveFor.current = srcRef.current.data;
    setThumbs({});
  }, []);

  /** 把这几张排进队(已有的、已排着的跳过) */
  const request = useCallback(
    (ids: ThumbId[]) => {
      // 子组件的 effect 比下面换世界的 effect 先跑:这时缓存还是上一个世界的,先作废再排
      if (haveFor.current !== srcRef.current.data) reset();
      for (const id of ids) if (!have.current[id] && !queue.current.includes(id)) queue.current.push(id);
      pump();
    },
    [pump, reset],
  );

  // 换世界:全部作废(request 已经作废过就不再清,不然刚排上的又没了);文明重推:政区、民族、信仰作废
  const { data, civ } = src;
  useEffect(() => {
    if (haveFor.current !== data) reset();
  }, [data, reset]);
  const civSeen = useRef<Civ | null>(null);
  useEffect(() => {
    if (civSeen.current && civSeen.current !== civ) {
      const next = { ...have.current };
      delete next.political;
      delete next.cultures;
      delete next.faith;
      have.current = next;
      setThumbs(next);
    }
    civSeen.current = civ;
  }, [civ]);
  // 当前底图的缩略图(底图按钮上用):世界出来、画好以后过一会儿做
  useEffect(() => {
    if (!data || thumbs[current]) return;
    const t = setTimeout(() => request([current]), 700);
    return () => clearTimeout(t);
  }, [data, civ, current, thumbs, request]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return { thumbs, request };
}

export interface LayerPopoverProps {
  base: BaseId;
  fill: FillId;
  /** 卫星记着的画法(经典 / 细节) */
  sat: SatLook;
  /** 界面上的文明 */
  civ?: Civ | null;
  onBase: (b: BaseId) => void;
  onFill: (f: FillId) => void;
  onSat: (s: SatLook) => void;
  /** 正在画的底图(那张缩略图上转小圈;画好之前地图先留着原来的) */
  pending?: { base: BaseId; sat: SatLook } | null;
  thumbs: Partial<Record<ThumbId, string>>;
  requestThumbs: (ids: ThumbId[]) => void;
  disabled?: boolean;
  /** 按钮的样子:seg = 底图按钮(小图 + 底图名,宽屏右上按钮条的最后一段);icon = 只有一个图层图标(手机右上竖排的毛玻璃按钮) */
  trigger?: 'seg' | 'icon';
}

export function LayerPopover({ base, fill, sat, civ = null, onBase, onFill, onSat, pending = null, thumbs, requestThumbs, disabled, trigger = 'icon' }: LayerPopoverProps) {
  const [open, setOpen] = useState(false);
  const proj = useProjection();
  const rootRef = useRef<HTMLDivElement>(null);
  const name = baseName(base, sat);

  useEffect(() => {
    if (!open) return;
    requestThumbs(MAIN_BASES.map((b) => baseThumb(b.id, sat)));
    const onDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      noteDismiss(e);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, sat, requestThumbs]);

  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  const hint = pending ? `正在画${baseName(pending.base, pending.sat)}，画好之前先显示${name}` : baseHint(base, sat);
  return (
    <div className={`lp ${trigger === 'seg' ? 'lp-seg' : 'lp-icon'}`} ref={rootRef} onPointerDown={stop} onDoubleClick={stop}>
      {trigger === 'seg' ? (
        <button
          className={`seg-btn lp-btn lp-base${open ? ' open' : ''}`}
          data-act="layers"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title="换底图、地图上显示什么、投影"
        >
          <Thumb src={thumbs[baseThumb(base, sat)]} className="lp-swatch" />
          {name}
          <svg className="seg-caret" width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <button
          className={`pb-btn lp-btn${open ? ' on' : ''}`}
          data-act="layers"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`图层(现在是${name}${fill === 'none' ? '' : `加${FILLS.find((f) => f.id === fill)!.name}`}，${projectionName(proj)})`}
          title="图层"
        >
          <Icon name="layers" size={19} />
        </button>
      )}
      {open && (
        <div className="lp-pop" role="dialog" aria-label="图层">
          {/* 窄屏是底部抽屉:顶上一条拖动条的样子(宽屏不显示) */}
          <div className="lp-head">
            <span className="lp-grip" aria-hidden="true" />
          </div>
          <div className="lp-sec">底图</div>
          <div className="lp-layers" role="radiogroup" aria-label="底图">
            {MAIN_BASES.map((b) => (
              <button key={b.id} className={`lp-layer${base === b.id ? ' on' : ''}`} role="radio" aria-checked={base === b.id} data-base={b.id} onClick={() => onBase(b.id)}>
                <Thumb src={thumbs[baseThumb(b.id, sat)]} busy={pending?.base === b.id} />
                <span>{b.name}</span>
              </button>
            ))}
          </div>
          {base === 'satellite' && (
            <div className="lp-grat lp-sat">
              <span>卫星画法</span>
              <span className="grat-seg" role="radiogroup" aria-label="卫星画法">
                {(['classic', 'detail', 'simple'] as const).map((s) => (
                  <button key={s} className={s === sat ? 'on' : undefined} role="radio" aria-checked={s === sat} data-sat={s} onClick={() => onSat(s)}>
                    {s === 'classic' ? '经典' : s === 'detail' ? '细节' : '简化'}
                  </button>
                ))}
              </span>
            </div>
          )}
          <div className="lp-hint">{hint}</div>
          <div className="lp-sec">数据底图</div>
          <div className="lp-chips" role="radiogroup" aria-label="数据底图">
            {DATA_BASES.map((id) => (
              <button key={id} className={`lp-chip${base === id ? ' on' : ''}${pending?.base === id ? ' busy' : ''}`} role="radio" aria-checked={base === id} data-base={id} onClick={() => onBase(id)}>
                {layerDef(id as MapLayer).name}
              </button>
            ))}
          </div>
          <div className="lp-line" />
          <div className="lp-sec">填色</div>
          <div className="lp-fills grat-seg" role="radiogroup" aria-label="填色">
            {FILLS.map((f) => (
              <button key={f.id} className={f.id === fill ? 'on' : undefined} role="radio" aria-checked={f.id === fill} data-fill={f.id} onClick={() => onFill(f.id)}>
                {f.name}
              </button>
            ))}
          </div>
          <div className="lp-hint">{FILLS.find((f) => f.id === fill)!.hint}</div>
          {fill === 'cultures' && <CultureLegend civ={civ} />}
          {fill === 'faiths' && <FaithLegend civ={civ} />}
          <div className="lp-line" />
          <div className="lp-sec">叠加</div>
          <div className="lp-overlays">
            <CivToggles />
            <GraticuleRow />
            <ContourRow globe={proj === 'globe'} />
          </div>
          <div className="lp-line" />
          <ProjectionRow />
        </div>
      )}
    </div>
  );
}

/** 经纬网一行:左边开关,右边间隔 10° / 15° / 30°(关着时灰掉,点一档顺手打开) */
function GraticuleRow() {
  const grat = useGraticule();
  return (
    <div className="lp-grat">
      <button className={`lp-check lp-tog${grat ? ' on' : ''}`} role="checkbox" aria-checked={grat} data-act="graticule" onClick={() => setGraticule(!grat)}>
        <span className="lp-box" aria-hidden="true">
          {grat ? '✓' : ''}
        </span>
        经纬网
      </button>
      <GraticuleSteps />
    </div>
  );
}

/** 投影一行:右边是现在的投影,点开是投影列表和中央经线 */
function ProjectionRow() {
  const proj = useProjection();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="lp-grat lp-projrow">
        <span>投影</span>
        <button className={`lp-pick${open ? ' open' : ''}`} data-act="projections" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {projectionName(proj)}
          <svg className="seg-caret" width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
            <path d={open ? 'M2 6.5l3-3 3 3' : 'M2 3.5l3 3 3-3'} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open && <ProjectionSection />}
    </>
  );
}

const CONTOUR_TABS: { id: ContourKind; name: string }[] = [
  { id: 'elev', name: '等高线' },
  { id: 'temp', name: '等温线' },
  { id: 'precip', name: '等降水线' },
];
/** 关掉时记着上次叠的是哪种,再勾上还是它 */
let lastContour: ContourKind = 'elev';

/** 等值线一行:左边开关,右边三种选一种(一次只叠一种);关着时三档灰掉,点一档顺手打开;地球仪上先不画,整行灰掉 */
function ContourRow({ globe }: { globe: boolean }) {
  const kind = useContourKind();
  if (kind) lastContour = kind;
  const on = !!kind && !globe;
  const shown = kind ?? lastContour;
  return (
    <div className={`lp-grat lp-iso${globe ? ' disabled' : ''}`} title={globe ? '地球仪上暂不显示' : undefined}>
      <button className={`lp-check lp-tog${on ? ' on' : ''}`} role="checkbox" aria-checked={on} data-act="contours" disabled={globe} onClick={() => setContourKind(kind ? null : lastContour)}>
        <span className="lp-box" aria-hidden="true">
          {on ? '✓' : ''}
        </span>
        等值线
      </button>
      <span className={`grat-seg${on ? '' : ' off'}`} role="radiogroup" aria-label="等值线种类">
        {CONTOUR_TABS.map((t) => (
          <button key={t.id} className={t.id === shown ? 'on' : undefined} role="radio" aria-checked={t.id === shown} data-iso={t.id} disabled={globe} onClick={() => setContourKind(t.id)}>
            {t.name}
          </button>
        ))}
      </span>
    </div>
  );
}

function Thumb({ src, busy, className }: { src?: string; busy?: boolean; className?: string }) {
  return (
    <span className={`lp-thumb${src ? '' : ' empty'}${className ? ` ${className}` : ''}`} style={src ? { backgroundImage: `url(${src})` } : undefined} aria-hidden="true">
      {busy && <i className="lp-spin" />}
    </span>
  );
}
