/**
 * 地区图的「导出这一页」(电脑:底条右边「导出图片」点开的卡片,贴在底条右上;手机:右上「导出」拉起的底部卡片):
 *   标题(和底条上的是同一个,这里改了那边也变)、版式(整页 / 只要地图)、清晰度(2 倍 / 4 倍,重画不是放大)、格式(PNG / JPEG)。
 *   画风、填色、年份照地图上现在的;文件名「文明与地图-种子7-玉屏山一带-第3000年-经典卫星.png」。
 * 2 倍整页就是屏幕上那一页(画好了直接存);4 倍按 4 倍整个重画(细地形后台线程算,按钮上写进度)。
 * 手机上叫「存图片」:能走分享菜单的,画好了在提示条上点「存到相册」;选 4 倍时多一行橙字提醒内存。
 */
import { useEffect, useRef, useState } from 'react';
import { IMAGE_FORMATS, type ImageFormat } from '../../render/export';
import type { RegionPage } from '../../render/regionMap';
import { downloadBlob } from '../filmStore';
import { showToast } from '../toastStore';
import { noteDismiss } from '../dismissClick';
import { setRegionTitle } from '../terrain3dStore';
import { buildRegionMap, drawRegionSheet, sameRegion, type RegionInput, type RegionMap, type RegionText } from './regionMap';

interface Props {
  phone: boolean;
  page: RegionPage;
  /** 现在的标题(改过的,或按地名起的) */
  title: string;
  /** 屏幕上那一页(细的画好了才直接用) */
  map: RegionMap | null;
  /** 按几倍重画时交给 buildRegionMap 的(D = 几倍) */
  inputFor: (D: number) => RegionInput;
  text: Omit<RegionText, 'title'>;
  /** 说明里写的:画风、填色 */
  styleName: string;
  fillName: string;
  /** 文件名开头(文明与地图-种子7)、年份(第3000年) */
  fileBase: string;
  fileYear: string;
  onClose: () => void;
}

type Layout = 'page' | 'map';

/** 文件名里不能有的字去掉 */
// eslint-disable-next-line no-control-regex
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim();

export function RegionExport(p: Props) {
  const [layout, setLayout] = useState<Layout>('page');
  const [scale, setScale] = useState<2 | 4>(2);
  const [format, setFormat] = useState<ImageFormat>('png');
  const [draft, setDraft] = useState(p.title);
  /** 正在导出:画到几成(null = 没在导出) */
  const [busy, setBusy] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // 点卡片外面、Esc:收起(正在导出时不收;点「导出图片」本身由它自己开关)
  const busyRef = useRef(false);
  busyRef.current = busy !== null;
  const close = useRef(p.onClose);
  close.current = p.onClose;
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (busyRef.current || root.current?.contains(t) || t.closest?.('[data-act=region-export]')) return;
      close.current();
      noteDismiss(e);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busyRef.current) return;
      e.stopPropagation();
      close.current();
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  const { page } = p;
  const size = (D: number) => (layout === 'page' ? `${page.w * D}×${page.h * D}` : `${page.mapW * D}×${page.mapH * D}`);
  const ext = IMAGE_FORMATS[format].ext;
  const name = `${p.fileBase}-${safeName(p.title) || '地区图'}-${p.fileYear}-${p.styleName}${layout === 'map' ? '-只要地图' : ''}${scale === 4 ? '-4x' : ''}.${ext}`;

  const run = async () => {
    if (busy !== null) return;
    setBusy(0);
    const t0 = performance.now();
    let own: RegionMap | null = null;
    try {
      // 2 倍:屏幕上那一页画好了、画的正是现在这样(换了画风、填色还没重画完的不算)就直接用
      let m = p.map?.fine && scale === 2 && sameRegion(p.map.input, p.inputFor(2)) ? p.map : null;
      if (!m) {
        own = await buildRegionMap(p.inputFor(scale), { coarse: false, progress: (f) => alive.current && setBusy(f * 0.95), alive: () => alive.current });
        m = own;
      }
      if (!m) throw new Error('没画出来');
      const cv = await drawRegionSheet(m, { ...p.text, title: p.title }, layout);
      if (!cv) throw new Error('没画出来');
      const fmt = IMAGE_FORMATS[format];
      const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, fmt.mime, fmt.quality));
      cv.width = cv.height = 0;
      if (!blob) throw new Error('图片太大,浏览器存不下');
      deliver(blob, name, `${size(scale)}，${mbText(blob.size)}，${Math.max(1, Math.round((performance.now() - t0) / 1000))} 秒`, p.phone);
      if (alive.current) p.onClose();
    } catch (e) {
      showToast({ id: 'region-export', kind: 'warn', text: '地区图没导出来', more: [e instanceof Error ? e.message : String(e), scale === 4 ? '换成 2 倍试试' : '回到地图再框一次试试'] });
      if (alive.current) setBusy(null);
    } finally {
      if (own) {
        own.map.width = own.map.height = 0;
        own.terrain.width = own.terrain.height = 0;
      }
    }
  };

  const seg = <T extends string | number>(value: T, set: (v: T) => void, opts: [T, string][]) => (
    <div className="ab-seg rx-seg">
      {opts.map(([v, label]) => (
        <button key={String(v)} type="button" className={value === v ? 'on' : ''} aria-pressed={value === v} disabled={busy !== null} onClick={() => set(v)}>
          {label}
        </button>
      ))}
    </div>
  );
  const rows = (
    <>
      <div className="rx-row">
        <span className="rx-lab">标题</span>
        <input
          className="rx-field"
          value={draft}
          maxLength={40}
          disabled={busy !== null}
          aria-label="地区图的标题"
          onChange={(e) => {
            setDraft(e.target.value);
            setRegionTitle(e.target.value);
          }}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      <div className="rx-row">
        <span className="rx-lab">版式</span>
        {seg<Layout>(layout, setLayout, [
          ['page', p.phone ? '整页' : '整页（标题、图例）'],
          ['map', '只要地图'],
        ])}
      </div>
      <div className="rx-row">
        <span className="rx-lab">清晰度</span>
        {seg<2 | 4>(scale, setScale, [
          [2, size(2)],
          [4, size(4)],
        ])}
      </div>
      {p.phone && scale === 4 && <p className="rx-warn">大图要多占三四百 MB 内存，手机上可能闪退，建议在电脑上导出（照样能导）</p>}
      <div className="rx-row">
        <span className="rx-lab">格式</span>
        {seg<ImageFormat>(format, setFormat, [
          ['png', 'PNG'],
          ['jpeg', 'JPEG（小几倍）'],
        ])}
      </div>
    </>
  );
  const going = busy !== null ? `正在画… ${Math.round(busy * 100)}%` : null;

  if (p.phone)
    return (
      <>
        <div className="rx-scrim" onClick={() => busy === null && p.onClose()} />
        <div ref={root} className="rx rx-phone" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <div className="rv-grab" />
          <h3>导出这一页</h3>
          {rows}
          <div className="rx-row rx-acts">
            <button type="button" className="rx-b" disabled={busy !== null} onClick={p.onClose}>
              取消
            </button>
            <button type="button" className="rx-b pri" data-act="region-save" disabled={busy !== null} onClick={() => void run()}>
              {going ?? '存图片'}
            </button>
          </div>
        </div>
      </>
    );
  return (
    <div ref={root} className="rx" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <h3>导出这一页</h3>
      {rows}
      <p className="rx-small">
        画风、填色、年份照地图上现在的：{p.styleName}、{p.fillName}、{p.text.year}
        <br />
        {name}
      </p>
      <button type="button" className="rx-go" data-act="region-save" disabled={busy !== null} onClick={() => void run()}>
        {going ?? '导出'}
      </button>
    </div>
  );
}

function mbText(bytes: number): string {
  const mb = bytes / 1e6;
  return `${mb >= 5 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/** 存下来:手机上能分享的走分享菜单(提示条上点「存到相册」),别的直接下载 */
function deliver(blob: Blob, name: string, more: string, phone: boolean) {
  const file = typeof File !== 'undefined' ? new File([blob], name, { type: blob.type }) : null;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (phone && file && nav.canShare?.({ files: [file] })) {
    showToast({
      id: 'region-export',
      kind: 'ok',
      text: '地区图画好了',
      more: [more],
      ttl: 0,
      dismissible: true,
      action: { label: '存到相册', primary: true, onClick: () => void navigator.share({ files: [file] }).catch(() => {}) },
    });
    return;
  }
  downloadBlob(blob, name);
  showToast({ id: 'region-export', kind: 'ok', text: `已导出 ${name}`, more: [more] });
  const g = window as unknown as { __wfRegionExport?: unknown };
  g.__wfRegionExport = { name, bytes: blob.size, type: blob.type };
}
