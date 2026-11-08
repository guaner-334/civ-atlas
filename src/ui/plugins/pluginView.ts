/** 给插件的「看的状态」(view.get、view.year、view.select):工具、只交图层的插件、开发者模式载入的插件共用 */
import type { MutableRefObject } from 'react';
import type { Civ } from '../../gen/civ/types';
import type { ViewInfo } from '../../plugin/types';
import { getCivShow, getCivTime, getSelection, subscribeCivTime, subscribeSelection } from '../civView';
import { selectionKey } from '../flyTo';
import { fillOf } from '../mapLayers';
import type { MarkApi } from '../MarkLayer';
import { getProjection } from '../projectionStore';

/** 算看的状态要的:历史(套没套改名的两份)、地图换算(看得见的范围) */
export interface ViewEnv {
  civ: Civ | null;
  raw: Civ | null;
  api: MutableRefObject<MarkApi | null> | null;
}

/** 当前年份(取整,夹在历史里) */
export function yearNow(civ: Civ | null): number {
  const end = civ?.endYear ?? 0;
  return Math.floor(Math.min(end, Math.max(0, getCivTime().year ?? end)));
}

export function viewOf(p: ViewEnv): ViewInfo {
  const sel = getSelection().sel;
  let visible: ViewInfo['visible'] = null;
  const f = getProjection() === 'equirect' ? p.api?.current?.frame() : null;
  const a = f?.pt(0, 0);
  const b = f?.pt(1000, 1000);
  if (f && a && b && b[0] > a[0]) {
    const k = (b[0] - a[0]) / 1000;
    visible = { x0: -a[0] / k, y0: -a[1] / k, x1: (f.w - a[0]) / k, y1: (f.h - a[1]) / k };
  }
  const key = sel && p.raw ? selectionKey(p.raw, sel) : '';
  return { year: yearNow(p.civ), selected: sel ? { kind: sel.kind, id: sel.id, ...(key ? { key } : {}) } : null, visible, layer: fillOf(getCivShow()) };
}

/** 看的年份、选中的东西变了就调 fn;返回取消的函数 */
export function watchView(fn: () => void): () => void {
  const a = subscribeCivTime(() => fn());
  const b = subscribeSelection(fn);
  return () => {
    a();
    b();
  };
}
