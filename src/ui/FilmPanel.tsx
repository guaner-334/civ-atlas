/**
 * 导出回放视频的面板。宽屏:替换左边侧栏的一张卡片(位置、大小和侧栏一样);手机:底部一张小卡片,只放最常用的几样
 * (画面、拍哪里、时长、字幕和片头片尾两个开关),标题用世界名。
 *
 * 选项改了,地图上的预览(FilmStage.tsx)、时间轴上的一段(CivTimeline.tsx)跟着变;点「导出视频」一帧一帧画、编码
 * (filmStore.ts 的 runFilm),面板里换成进度和「取消」;做完自动下载(手机上能分享的,提示条上点「存到相册」)。
 * 浏览器做不了视频(没有 WebCodecs / H.264 编码)时说一句,按钮变灰。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CivStyle } from '../render/civ/overlay';
import type { LayerId } from '../render/layers';
import { useFilmSource } from './filmSource';
import { filmSupported } from './filmEncode';
import { closeFilm, cancelFilm, deliverFilm, etaText, filmRangeOf, filmSetup, filmTitleOf, holeRegion, runFilm, setFilm, useFilm } from './filmStore';
import { FILM_BITRATE, filmClock, filmMegabytes, rangeText, rateText, type FilmSeconds } from './filmPlan';
import { showToast } from './toastStore';
import './film.css';

export interface FilmPanelProps {
  phone: boolean;
  style: CivStyle;
  layer: LayerId;
}

/** 浏览器能不能导视频(查一次,记住) */
export function useFilmSupported(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void filmSupported().then((v) => live && setOk(v));
    return () => {
      live = false;
    };
  }, []);
  return ok;
}

interface SegProps<T extends string | number> {
  value: T | null;
  items: readonly (readonly [T, string])[];
  onPick: (v: T) => void;
  act: string;
}

function Seg<T extends string | number>({ value, items, onPick, act }: SegProps<T>) {
  return (
    <div className="film-seg" role="group">
      {items.map(([v, label]) => (
        <button key={String(v)} className={v === value ? 'on' : ''} aria-pressed={v === value} data-act={`${act}-${v}`} onClick={() => onPick(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Switch({ on, onFlip, label, act }: { on: boolean; onFlip: () => void; label: string; act: string }) {
  return <button className={`film-sw${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} data-act={act} onClick={onFlip} />;
}

const SHAPES = [
  ['land', '横屏 16:9'],
  ['port', '竖屏 9:16'],
] as const;
const AREAS = [
  ['whole', '整张地图'],
  ['region', '框里这一块'],
] as const;
const LENGTHS = [
  [30, '30 秒'],
  [60, '1 分钟'],
  [120, '2 分钟'],
] as const;
const LENGTH_TEXT: Record<FilmSeconds, string> = { 30: '30 秒', 60: '1 分钟', 120: '2 分钟' };

/** 画面、拍哪里下面那一句 */
function shapeHint(shape: 'land' | 'port', area: 'whole' | 'region'): string {
  if (shape === 'land') {
    return `1920×1080，适合 B 站、西瓜视频、电脑上看。${area === 'whole' ? '整个世界放进画面，上下留一点边' : '拖动、缩放地图，框住的就是视频里的样子'}`;
  }
  return `1080×1920，适合抖音、小红书、视频号。上面写年份，${area === 'whole' ? '中间一条是整个世界，下面是最近五条大事' : '中间正方形是框住的那块地图，下面是最近三条大事'}`;
}

/** "约 40 MB" */
function sizeText(seconds: number): string {
  const mb = filmMegabytes(FILM_BITRATE, seconds);
  return `约 ${mb >= 15 ? Math.round(mb / 10) * 10 : Math.max(1, Math.round(mb))} MB`;
}

export function FilmPanel({ phone, style, layer }: FilmPanelProps) {
  const s = useFilm();
  const src = useFilmSource();
  const ok = useFilmSupported();
  const full = src?.full ?? null;
  const end = full ? Math.floor(full.endYear) : 0;
  const range = full ? filmRangeOf(full) : { from: 0, to: end };
  const clock = filmClock(range, s.seconds, s.cards);
  const run = s.run;
  const busy = !!run;
  const title = filmTitleOf();
  // 手机:卡片多高,时间轴就浮在它上面多高(film.css 的 --film-sheet-h)
  const sheetRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = sheetRef.current;
    const app = el?.closest('.app') as HTMLElement | null;
    if (!el || !app) return;
    const set = () => app.style.setProperty('--film-sheet-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      app.style.removeProperty('--film-sheet-h');
    };
  }, [phone]);

  const start = async () => {
    if (!src || busy || !ok) return;
    const region = s.area === 'region' ? holeRegion() : undefined;
    if (s.area === 'region' && !region) return;
    try {
      const d = await runFilm(src, filmSetup(src, { style, layer }, region));
      if (d) deliverFilm(d, phone, 'video');
    } catch (e) {
      console.error('导出视频失败', e);
      showToast({ id: 'film', kind: 'error', text: '导出视频失败', more: [e instanceof Error ? e.message : String(e)] });
    }
  };

  const pct = run ? Math.min(100, Math.floor(((run.f + 1) / run.frames) * 100)) : 0;
  const eta = run && run.f > 10 ? etaText(((performance.now() - run.t0) / (run.f + 1)) * (run.frames - run.f - 1)) : '';
  const progressLine = run ? `正在画第 ${run.year} 年${eta ? `，${eta}` : ''}` : '';
  const warn = ok === false && (
    <div className="film-warn">
      <b>这个浏览器导不了视频</b>
      <span>换新版的 Chrome、Edge 或 Safari 再试。竖版长图不受影响。</span>
    </div>
  );
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

  if (phone) {
    return (
      <div className="film-sheet" ref={sheetRef} onPointerDown={stop} onClick={stop} onDoubleClick={stop}>
        {run ? (
          <>
            <div className="film-sheet-hd">
              <b>正在导出</b>
              <span className="val">{pct}%</span>
            </div>
            <div className="film-bar">
              <s style={{ width: `${pct}%` }} />
            </div>
            <div className="film-hint">{progressLine}。先别锁屏、别切到别的应用，不然会停下。</div>
            <button className="film-btn plain" data-act="film-cancel" onClick={cancelFilm}>
              取消
            </button>
          </>
        ) : (
          <>
            <div className="film-sheet-hd">
              <b>导出回放视频</b>
              <button className="film-link" data-act="film-close" onClick={closeFilm}>
                取消
              </button>
            </div>
            <Seg value={s.shape} items={SHAPES} act="film-shape" onPick={(v) => setFilm({ shape: v })} />
            <Seg value={s.area} items={AREAS} act="film-area" onPick={(v) => setFilm({ area: v })} />
            <Seg value={s.seconds} items={LENGTHS} act="film-len" onPick={(v) => setFilm({ seconds: v })} />
            <div className="film-two">
              <div>
                大事字幕
                <Switch on={s.captions} label="大事字幕" act="film-captions" onFlip={() => setFilm({ captions: !s.captions })} />
              </div>
              <div>
                片头片尾
                <Switch on={s.cards} label="片头片尾" act="film-cards" onFlip={() => setFilm({ cards: !s.cards })} />
              </div>
            </div>
            {warn}
            <button className="film-btn primary" data-act="film-start" disabled={!ok || !src} onClick={() => void start()}>
              导出视频
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <aside className="film-side" onPointerDown={stop} onClick={stop} onDoubleClick={stop}>
      <button className="film-back" data-act="film-close" onClick={closeFilm}>
        回到地图
      </button>
      <div className="film-ttl">
        <b>导出回放视频</b>
        <span>把时间轴放一遍，存成一段视频</span>
      </div>
      <div className={`film-grp${busy ? ' off' : ''}`}>
        <div className="film-lbl">
          <b>画面</b>
          <Seg value={s.shape} items={SHAPES} act="film-shape" onPick={(v) => !busy && setFilm({ shape: v })} />
        </div>
        <div className="film-lbl">
          <b>拍哪里</b>
          <Seg value={s.area} items={AREAS} act="film-area" onPick={(v) => !busy && setFilm({ area: v })} />
        </div>
        <div className="film-hint">{shapeHint(s.shape, s.area)}</div>
      </div>
      <div className={`film-grp${busy ? ' off' : ''}`}>
        <div className="film-lbl">
          <b>年份</b>
          <span className="val">{rangeText(range)}</span>
        </div>
        <Seg
          value={s.rangeKind === 'custom' ? null : s.rangeKind}
          items={[
            ['polities', '有国家以后'],
            ['all', '全部历史'],
          ]}
          act="film-range"
          onPick={(v) => !busy && setFilm({ rangeKind: v, range: null })}
        />
        <div className="film-hint">也可以拖底下时间轴两头的把手</div>
      </div>
      <div className={`film-grp${busy ? ' off' : ''}`}>
        <div className="film-lbl">
          <b>时长</b>
          <Seg value={s.seconds} items={LENGTHS} act="film-len" onPick={(v) => !busy && setFilm({ seconds: v })} />
        </div>
        <div className="film-hint">{rateText(clock.rate, end)}</div>
      </div>
      <div className={`film-grp${busy ? ' off' : ''}`}>
        <div className="film-lbl">
          <b>大事字幕</b>
          <span className="sp" />
          <Switch on={s.captions} label="大事字幕" act="film-captions" onFlip={() => !busy && setFilm({ captions: !s.captions })} />
        </div>
        <div className="film-line" />
        <div className="film-lbl">
          <b>片头片尾</b>
          <span className="sp" />
          <Switch on={s.cards} label="片头片尾" act="film-cards" onFlip={() => !busy && setFilm({ cards: !s.cards })} />
        </div>
        <div className="film-lbl">
          <b>标题</b>
          <input
            className="film-field"
            value={title}
            maxLength={40}
            disabled={busy}
            data-act="film-title"
            onChange={(e) => setFilm({ title: e.target.value })}
          />
        </div>
        <div className="film-hint">片头写标题和年份；片尾写「用文明与地图推演生成」和网址</div>
      </div>
      {!busy && ok !== false && (
        <div className="film-fine">
          地图上画什么照屏幕上的：画风、图层、地名，可以在右上角换。{s.area === 'region' ? '字幕只写框里的国家的大事。' : ''}视频没有声音。
        </div>
      )}
      <div className="film-foot">
        {run ? (
          <>
            <div className="film-grp">
              <div className="film-lbl">
                <b>正在导出</b>
                <span className="sp" />
                <span className="val">{pct}%</span>
              </div>
              <div className="film-bar">
                <s style={{ width: `${pct}%` }} />
              </div>
              <div className="film-hint">{progressLine}</div>
            </div>
            <button className="film-btn plain" data-act="film-cancel" onClick={cancelFilm}>
              取消
            </button>
          </>
        ) : (
          <>
            {warn}
            <button className="film-btn primary" data-act="film-start" disabled={!ok || !src} onClick={() => void start()}>
              导出视频
            </button>
            {ok !== false && (
              <div className="film-fine center">
                MP4，{LENGTH_TEXT[s.seconds]}，{sizeText(s.seconds)}。在这台电脑上做，不上传。
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
