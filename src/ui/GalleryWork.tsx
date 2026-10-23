/**
 * 作品墙:打开一个世界 / 地图作品以后才用到的几样(作品墙那一页和空页面的精选在 Gallery.tsx;单独一个文件,首页不用下载星球那一套)
 *
 *   WorkBar           打开一个世界 / 地图作品时地图左上那一条:作品名、署名、一句话;「拿来用」(世界:另存一份接着改 /
 *                     用这张地图打造新文明;地图:直接「用这张地图打造文明」)、「举报」(举过的是灰的「已举报」)
 *   MapWorkView       地图作品:整屏是这颗星球(封面那张实景贴成球,能拖着转、能切「平面」、能放大缩小),没有文明
 *   ReportDialog      举报:六个理由选一个,不能打字;提交以后"收到了,谢谢"。同一台设备对同一个作品只能举报一次
 *
 * 样式在 gallery.css。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { Dialog } from './AccountDialogs';
import { PlanetGL } from './studio/planetGL';
import { StudioScene } from './studio/scene';
import { coverUrl, useGallery, wasReported, type GalleryWork } from '../account/gallery';
import { ReportDialog, workWho } from './Gallery';
import './gallery.css';

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

export interface WorkBarProps {
  phone: boolean;
  work: GalleryWork;
  /** 地图作品:「‹ 作品墙」在这一条里(世界作品的在侧栏左上) */
  onBack?: () => void;
  /** 另存一份接着改(世界作品) */
  onSaveCopy?: () => void;
  /** 用这张地图打造新文明 */
  onNewCiv: () => void;
}

export function WorkBar({ phone, work, onBack, onSaveCopy, onNewCiv }: WorkBarProps) {
  const g = useGallery();
  const reported = g.rev >= 0 && wasReported(work.id);
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const useBtn = useRef<HTMLButtonElement>(null);
  /** 菜单挂在「拿来用」下面,比按钮往左错开一点 */
  const [menuAt, setMenuAt] = useState<{ left: number; top: number } | null>(null);
  const map = work.kind === 'map';
  useLayoutEffect(() => {
    const b = useBtn.current;
    const r = root.current;
    if (!menu || phone || !b || !r) return setMenuAt(null);
    setMenuAt({ left: Math.max(0, b.getBoundingClientRect().left - r.getBoundingClientRect().left - 70), top: r.offsetHeight + 4 });
  }, [menu, phone]);
  useEffect(() => {
    if (!menu || phone) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setMenu(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menu, phone]);
  const who = workWho(work);
  const pick = (f: (() => void) | undefined) => () => {
    setMenu(false);
    f?.();
  };
  return (
    <>
      <div ref={root} className={`gw-bar${phone ? ' phone' : ''}${map ? ' map' : ''}`} data-testid="gallery-bar" onPointerDown={stop} onClick={stop} onDoubleClick={stop} onWheel={stop}>
        {map && onBack && (
          <button className="gw-back" data-act="gallery-back" onClick={onBack} title="回到作品墙">
            <Icon name="back" size={16} />
            {!phone && '作品墙'}
          </button>
        )}
        <div className="gw-tx">
          <div className="gw-1">
            <span className="gw-pill">{map ? '地图' : '作品墙'}</span>
            <b>{work.title || '未命名'}</b>
            {!phone && work.by && <span>{work.by}</span>}
          </div>
          {phone && work.by && <span className="gw-by">{work.by}</span>}
          {work.blurb && (
            <div className="gw-2" title={work.blurb}>
              {work.blurb}
            </div>
          )}
        </div>
        <div className="gw-acts">
          {map ? (
            <button className="gw-btn blue" data-act="gallery-new-civ" onClick={onNewCiv}>
              {phone ? '打造文明' : '用这张地图打造文明'}
              {!phone && <Icon name="chevron" size={14} />}
            </button>
          ) : (
            <button ref={useBtn} className={`gw-btn blue${menu ? ' on' : ''}`} data-act="gallery-use" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((o) => !o)}>
              拿来用
              {!phone && <Icon name={menu ? 'up' : 'down'} size={14} />}
            </button>
          )}
          <button className={`gw-btn${phone ? ' ic' : ''}`} data-act="gallery-report" disabled={reported} onClick={() => setReport(true)} title={reported ? '已举报' : '举报这个作品'}>
            <Icon name={reported ? 'check' : 'flag'} size={15} />
            {!phone && (reported ? '已举报' : '举报')}
          </button>
        </div>
        {menu && !phone && (
          <div className="gw-menu" role="menu" style={menuAt ?? { visibility: 'hidden' }}>
            <button className="gw-mi" role="menuitem" data-act="gallery-copy" onClick={pick(onSaveCopy)}>
              <Icon name="copy" size={18} />
              <span>
                <b>另存一份接着改</b>
                <small>存进「我的世界」，写上出处：{who}</small>
              </span>
            </button>
            <button className="gw-mi" role="menuitem" data-act="gallery-new-civ" onClick={pick(onNewCiv)}>
              <Icon name="globe" size={18} />
              <span>
                <b>用这张地图打造新文明</b>
                <small>地形照搬，文明和历史从头推演</small>
              </span>
            </button>
            <hr />
            <div className="gw-foot">不另存也能随便看；改了名字或历史，也会自动另存一份。</div>
          </div>
        )}
      </div>
      {menu && phone && (
        <Dialog phone label={`拿来用「${work.title || '未命名'}」`} onClose={() => setMenu(false)} testId="gallery-use">
          <div className="acct-body">
            <div className="acct-grp gw-big">
              <button className="acct-gr" data-act="gallery-copy" onClick={pick(onSaveCopy)}>
                <Icon name="copy" size={22} />
                <span>
                  <b>另存一份接着改</b>
                  <small>存进「我的世界」，写上出处：{who}</small>
                </span>
                <Icon name="chevron" size={14} className="gw-chev" />
              </button>
              <button className="acct-gr" data-act="gallery-new-civ" onClick={pick(onNewCiv)}>
                <Icon name="globe" size={22} />
                <span>
                  <b>用这张地图打造新文明</b>
                  <small>地形照搬，文明和历史从头推演</small>
                </span>
                <Icon name="chevron" size={14} className="gw-chev" />
              </button>
            </div>
            <p className="acct-small">不另存也能随便看；改了名字或历史，也会自动另存一份。</p>
          </div>
          <div style={{ height: 8 }} />
        </Dialog>
      )}
      {report && <ReportDialog phone={phone} work={work} onClose={() => setReport(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// 地图作品:整屏是这颗星球

/** 放大缩小一下乘多少、最多最少 */
const ZOOM_STEP = 1.3;
const ZOOM_RANGE: [number, number] = [0.6, 3];

export function MapWorkView({ phone, work, onBack, onNewCiv }: { phone: boolean; work: GalleryWork; onBack: () => void; onNewCiv: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const scene = useRef<StudioScene | null>(null);
  const [flat, setFlat] = useState(false);
  /** WebGL 用不了、封面取不到:平铺一张封面 */
  const [plain, setPlain] = useState(false);
  const zoom = useRef(1);
  useLayoutEffect(() => {
    const canvas = cv.current;
    const el = box.current;
    if (!canvas || !el) return;
    const gl = PlanetGL.create(canvas, { small: phone });
    if (!gl) {
      setPlain(true);
      return;
    }
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    // 大气光(和新建界面一样):越接近地球仪越亮
    const frame = ({ cx, cy, r, m }: { cx: number; cy: number; r: number; m: number }) => {
      const g = glow.current;
      if (!g) return;
      const R = r * 1.2;
      g.style.opacity = m > 0.02 ? String(Math.pow(m, 3)) : '0';
      g.style.width = g.style.height = `${R * 2}px`;
      g.style.transform = `translate(${cx - R}px, ${cy - R}px)`;
    };
    const s = new StudioScene(gl, { frame, flat: () => {}, touched: () => {}, still: () => {} }, reduce);
    scene.current = s;
    const fit = () => s.setViewport(el.clientWidth, el.clientHeight, devicePixelRatio || 1);
    fit();
    s.setLayout({ l: 0, r: 0, b: phone ? 60 : 0, bar: false, phone }, false);
    s.showProj('globe');
    // 宽屏上没有新建界面左边那块面板,星球放大一点,和新建界面里看到的一样大
    s.zoom = zoom.current = phone ? 1 : 1.14;
    s.spin = true;
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    ro?.observe(el);
    let alive = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!alive || gl.isLost) return;
      gl.setStyle('cover', img);
      s.showStyle('cover');
      s.start();
    };
    img.onerror = () => alive && setPlain(true);
    img.src = coverUrl(work.id);
    gl.onLost = () => alive && setPlain(true);
    return () => {
      alive = false;
      ro?.disconnect();
      scene.current = null;
      s.dispose();
    };
  }, [work.id, phone]);
  const toggle = () => {
    const s = scene.current;
    const next = !flat;
    setFlat(next);
    if (!s) return;
    s.spin = false;
    void s.setProj(next ? 'equirect' : 'globe');
  };
  const zoomBy = (f: number) => {
    const s = scene.current;
    const z = Math.min(ZOOM_RANGE[1], Math.max(ZOOM_RANGE[0], zoom.current * f));
    zoom.current = z;
    if (s) void s.tween('zoom', z, 260);
  };
  const url = coverUrl(work.id);
  return (
    <div ref={box} className={`gw-map${phone ? ' phone' : ''}`} data-theme="dark" role="main" aria-label={work.title} data-testid="gallery-map" onWheel={stop}>
      {plain ? (
        <div className="gw-plain" style={url ? { backgroundImage: `url("${url}")` } : undefined} />
      ) : (
        <>
          <div ref={glow} className="gw-glow" aria-hidden="true" />
          <canvas ref={cv} className="gw-cv" aria-label="这颗星球" />
        </>
      )}
      <WorkBar phone={phone} work={work} onBack={onBack} onNewCiv={onNewCiv} />
      <div className="gw-hint">{phone ? '拖动看看这颗星球；它还没有文明' : '拖动看看这颗星球；它还没有文明，点「用这张地图打造文明」从头推演'}</div>
      {!plain && (
        <div className="gw-ctl">
          <button className="gw-glass" data-act="gallery-flat" onClick={toggle}>
            <Icon name={flat ? 'globe' : 'map'} size={16} />
            {flat ? '地球' : '平面'}
          </button>
          <div className="gw-glass gw-zoom">
            <button data-act="zoom-in" onClick={() => zoomBy(ZOOM_STEP)} aria-label="放大">
              <Icon name="plus" size={16} />
            </button>
            <button data-act="zoom-out" onClick={() => zoomBy(1 / ZOOM_STEP)} aria-label="缩小">
              <Icon name="minus" size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
